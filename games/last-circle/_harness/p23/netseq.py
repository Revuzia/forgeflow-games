#!/usr/bin/env python
"""netseq - LC-49 netcode (P3 lane net): sequence numbers + server-time stamps in pack(); rejoin within 60 s on ?room=. Plan gate: "out-of-order
injection never pulls a remote backwards" (+ section 5 Online "rejoin within 60 s; no backward pulls from out-of-order packets"). Two REAL pages over
the squad relay stand-in (squadguard_live's FAKE_SB + p23lib.fake_sb_plus: the inbound REORDER switch holds every 3rd state packet 250 ms and delivers
it after newer ones) - and the same switch on the guest's DataChannel receive (state travels P2P over unordered DataChannels first).

    python _harness/p23/netseq.py --disk
    python _harness/p23/netseq.py --rev 9aa2b746                # control: the P2 base (no sequence numbers: a late packet pulls the body back) - MUST FAIL
    python _harness/p23/netseq.py --disk --plant pull-back      # the guest's copy of the host is set back 0.3 m along its walk every 4th frame
                                                                # (what an applied late packet does) - MUST FAIL (no-backward / baseline)
    python _harness/p23/netseq.py --lanes all                   # validation: every lane's work served over the base

Rows:
  baseline        reorder OFF: the host walks straight (real W, 3 s); the guest's copy of the host only moves forward (control of the measure)
  no-backward     reorder ON (every 3rd state packet late by 250 ms): the guest's copy of the host never moves backwards along the walk by > 0.05 m
                  (sampled every 50 ms), while >= 10 late packets were delivered
  rejoin          the guest's page closed; a NEW page in the same context opens ?room=<code>: within 60 s it is back in the RUNNING match as the
                  same actor (slot id), alive, and the host sees that body move again
  errors          both pages
SETUP (D16, could-not-judge, never FAIL): the pair is ONE squad session after the landing (both pages' W.net, the host drives the guest's body
from its packets) and both match clocks run at >= 0.6 x real time (a starved page trips net.js's wall-clock watchdogs by itself); during the
rejoin wait the host's clock must keep >= 0.6 x real time. Fix-round finding: every rejoin miss traced on 10-26 was this - the host's watchdog
took s1 (12 s of wall-clock silence) and the guest's rejoin record went stale (refreshed every 2 s by its game loop, fresh 75 s), so the new
page asked nothing and the host said 'busy'.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

# the planted fault proves the MEASURE: a body pulled back the way a stale snapshot pulls it must fail the no-backward row (the base build is the
# logic control: --rev BASE_P23 has no sequence numbers at all)
PLANTS = {
    "pull-back": "window.__P23PB__ = { n: 0 }; W.kernel._updaters.push(() => { const P = window.__P23PB__; if (!P.id || (++P.n % 4)) return; const a = W.actorById.get(P.id);"
                 " if (!a || !a.vel) return; const sp = Math.hypot(a.vel.x, a.vel.z); if (sp < 0.5) return; a.pos.x -= 0.3 * a.vel.x / sp; a.pos.z -= 0.3 * a.vel.z / sp; })",
}

TRACK_JS = r"""([id, ms, dx, dz]) => new Promise((res) => { const W = window.__LC__.W; const out = []; const t0 = performance.now();
  const iv = setInterval(() => { const a = W.actorById.get(id); if (a) out.push(+(a.pos.x * dx + a.pos.z * dz).toFixed(3));
    if (performance.now() - t0 > ms) { clearInterval(iv); res(out); } }, 50); })"""


GUEST_DIAG_JS = r"""() => { const W = window.__LC__ && window.__LC__.W; if (!W) return { booted: false };
  const st = document.querySelector('[data-net-rejoin]'); const S = W.net;
  return { phase: W.phase, vis: document.visibilityState, rejoinAttr: st ? st.getAttribute('data-net-rejoin') : null,
    status: st ? (st.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : null, asks: S && S.rejoinAsk ? S.rejoinAsk.tries : null,
    rejoin: S && S.rejoin ? S.rejoin.state : null, room: S && S.net ? S.net.room : null, inMsgs: (window.__SQ_LOG__ || []).filter((m) => m.dir === 'in' && m.t === 'rejoin').map((m) => m.d && (m.d.k + ':' + (m.d.code || '') + ':' + (m.d.why || ''))).slice(-4) }; }"""
HOST_DIAG_JS = r"""(id) => { const W = window.__LC__.W, S = W.net || {}; const now = performance.now(); const a = W.actorById.get(id);
  return { phase: W.phase, vis: document.visibilityState, simT: +(W.t || 0).toFixed(2), goneAt: S.goneAt && S.goneAt[id] != null ? Math.round(now - S.goneAt[id]) : null,
    lastSeenAgoMs: S.lastSeen && S.lastSeen[id] != null ? Math.round(now - S.lastSeen[id]) : null, silentTake: !!(S.silentTake && S.silentTake[id]),
    rejoinLog: (S.rejoinLog || []).slice(-3).map((r) => r.why + '@' + Math.round((now - r.at) / 1000) + 's ago'), rejoined: !!(S.rejoined && S.rejoined[id]),
    body: a ? { alive: a.alive, netRemote: !!a.netRemote, isBot: !!a.isBot } : null }; }"""


def safe_eval(pg, js, arg=None):
    try:
        return pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    except Exception as e:
        return {"error": str(e).splitlines()[0][:120]}


def compress_trace(trace):
    """the trace rows where anything but the clocks changed (the full trace is in the report's rejoinTrace)"""
    out, prev = [], None
    for r in trace:
        g, h = dict(r.get("guest") or {}), dict(r.get("host") or {})
        for k in ("simT", "goneAt", "lastSeenAgoMs"):
            h.pop(k, None)
        key = repr((g, h))
        if key != prev:
            out.append(r)
            prev = key
    return out[:14]


SIM_RATE_MIN_HOST = 0.6


def rejoin_setup_miss(trace):
    """a rejoin that missed because the HARNESS never let the host run (D16): the host page's sim clock stood still across the wait (a hidden /
    throttled tab runs no frames, so its watchdog can never see the old page leave). None = the setup was sound: the miss is a verdict."""
    hs = [r.get("host") or {} for r in trace]
    ts = [(r["t"], h.get("simT")) for r, h in zip(trace, hs) if isinstance(h.get("simT"), (int, float))]
    if len(ts) >= 3:
        rate = (ts[-1][1] - ts[0][1]) / max(0.001, ts[-1][0] - ts[0][0])
        if rate < SIM_RATE_MIN_HOST:
            return "the host's match clock ran at %.3f x real time over the wait (%d polls): a starved / stalled page" % (rate, len(ts))
    g = [r.get("guest") or {} for r in trace]
    if g and all(not x.get("booted", True) for x in g):
        return "the rejoining page never booted"
    return None


def walk_and_track(hpg, gpg, h_id, ms=3000):
    yaw = hpg.evaluate("() => window.__LC__.W.player.input.yaw")
    import math
    dx, dz = -math.sin(yaw), -math.cos(yaw)
    hpg.keyboard.down("KeyW")
    tr = gpg.evaluate(TRACK_JS, [h_id, ms, dx, dz])
    hpg.keyboard.up("KeyW")
    steps = [tr[i - 1] - tr[i] for i in range(1, len(tr))]
    back = max(steps, default=None)
    at = steps.index(back) + 1 if steps else None
    return {"samples": len(tr), "progress": round(tr[-1] - tr[0], 2) if tr else None, "maxBackM": round(back, 3) if back is not None else None,
            "backSteps>0.05": sum(1 for x in steps if x > 0.05), "atSample": at, "around": tr[max(0, (at or 0) - 4):(at or 0) + 3] if at else None}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--close", default="plain", choices=("plain", "unload"),
                    help="how the guest's first page is closed: plain = Playwright close (no beforeunload, so no 'bye': a crash-like leave), "
                         "unload = close running beforeunload (a tab closed by a player: net.js sends its 'bye')")
    args = L.parse(ap)

    def body(v):
        rig, SQ = L.squad_rig(args)
        try:
            ctx, hpg, hrec, gpg, grec, code = L.squad_pair(rig, SQ, args, "netseq")
            h_id = hpg.evaluate("() => window.__LC__.W.player.id")
            g_id = gpg.evaluate("() => window.__LC__.W.player.id")
            # SETUP (D16): the pair must still be ONE squad session before anything is judged
            ok_s, sess = L.pair_session(hpg, gpg, h_id, g_id)
            v.info("pair session after the landing", sess)
            if not ok_s:
                v.cnj("session (both pages in the squad session, the host drives the guest's body)", "SETUP missed: %s" % sess)
                return
            # a starved box (D16): both pages must run their match clock at >= SIM_RATE_MIN of real time, else every row measures the box
            # (netseq_4 10-26 23:20, 100 % CPU: the host's clock ran at ~0.03 x real time, its watchdog gave s1 to a bot and the guest's rejoin
            # record went stale - 'busy' on the new page)
            hpg.bring_to_front()
            rates = L.sim_rates(hpg, gpg)
            v.info("sim rate (match-clock s per wall s) host / guest", rates)
            if min(rates) < L.SIM_RATE_MIN:
                v.cnj("pair (both pages' match clocks at >= %.1f x real time)" % L.SIM_RATE_MIN, "SETUP missed: the box is starved - sim rates %s" % rates)
                return
            if args.plant:
                gpg.evaluate("() => { const W = window.__LC__.W, K = W.SIM; %s; return true; }" % PLANTS[args.plant])
                gpg.evaluate("(id) => { window.__P23PB__.id = id; }", h_id)
            # the state envelope travels P2P first: ffg_rtc.js DataChannels, UNORDERED ({ordered:false, maxRetransmits:0}) - the relay stand-in's
            # REORDER switch never saw a state packet when the DCs were open (netseq_all3 10-26: 0 late packets). The same switch on the guest's
            # DataChannel receive (W.net.rtc.onMessage, read per message by RTCMesh) - out-of-order delivery as the wire can really do it
            hook = gpg.evaluate("""() => { const W = window.__LC__.W, S = W.net; if (!S || !S.rtc || S.rtc.__p23ro) return !!(S && S.rtc && S.rtc.__p23ro); const om = S.rtc.onMessage;
                S.rtc.onMessage = function (m) { const R = window.__SQ_REORDER__; if (R && m && m.t === 'state' && !m.__late) { R.n = (R.n || 0) + 1;
                  if (R.n % R.every === 0) { R.held = (R.held || 0) + 1; const mm = Object.assign({}, m, { __late: true }); setTimeout(() => S.rtc.onMessage(mm), R.holdMs); return; } }
                  return om.call(this, m); }; S.rtc.__p23ro = true; return true; }""")
            v.info("reorder hook on the guest's DataChannel receive", {"hooked": hook})
            spot = hpg.evaluate(L.FLAT_SPOT_JS, [0, 0, 6.0, 700, []])
            if spot:
                hpg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.input.yaw = 0; }", [spot["x"], spot["z"]])
            hpg.bring_to_front()          # the walker's page must tick (a hidden tab gets no rAF)
            hpg.wait_for_timeout(1500)
            v.info("page visibility during the walks", {k: pg.evaluate("() => document.visibilityState") for k, pg in (("host", hpg), ("guest", gpg))})
            b = walk_and_track(hpg, gpg, h_id)
            v.check("baseline (reorder off: the guest's copy of the host moves forward only)", b["progress"] is not None and b["progress"] > 5 and (b["maxBackM"] or 0) <= 0.05,
                    b, "> 5 m, never back > 0.05 m")
            hpg.evaluate("() => { const p = window.__LC__.W.player; p.input.yaw += Math.PI; }")
            gpg.evaluate("() => { window.__SQ_REORDER__ = { every: 3, holdMs: 250 }; }")
            hpg.wait_for_timeout(800)
            r = walk_and_track(hpg, gpg, h_id, 4000)
            held = gpg.evaluate("() => (window.__SQ_REORDER__ || {}).held || 0")
            gpg.evaluate("() => { window.__SQ_REORDER__ = null; }")
            r["latePackets"] = held
            v.check("no-backward (every 3rd state packet 250 ms late: the remote never pulled back > 0.05 m)", held >= 10 and r["progress"] is not None and r["progress"] > 5
                    and (r["maxBackM"] or 0) <= 0.05, r, ">= 10 late, never back > 0.05 m")
            # rejoin. Fix round: the row records WHERE a miss stopped (both pages polled every 1 s until back / 60 s): the new page's boot time,
            # phase, its lobby status (data-net-rejoin + text) and asks left, and the host's view (ticking? its rejoin log, goneAt, lastSeen of
            # the slot, silentTake) - so a miss names net / boot, or a harness setup that never let the host see the old page leave
            url = gpg.url.split("?")[0] + "?room=" + code
            close_mode = getattr(args, "close", "plain")
            gpg.close(run_before_unload=(close_mode == "unload"))
            t0 = time.time()
            g2, grec2 = rig.page(ctx, "netseq/guest-rejoin")
            boot_s = SQ.boot_url(g2, url, args.boot_timeout)
            t_boot = round(time.time() - t0, 1)
            trace = []
            back = None
            back_js = "(id) => { const W = window.__LC__ && window.__LC__.W; return W && ['drop', 'match'].includes(W.phase) && W.player && W.player.id === id && W.player.alive ? true : null; }"
            while True:
                el = round(time.time() - t0, 1)
                try:
                    back = g2.evaluate(back_js, g_id)
                except Exception:
                    back = None
                trace.append({"t": el, "guest": safe_eval(g2, GUEST_DIAG_JS), "host": safe_eval(hpg, HOST_DIAG_JS, g_id)})
                if back or el >= 60:
                    break
                g2.wait_for_timeout(1000)
            took = round(time.time() - t0, 1)
            moved = None
            if back:
                p0 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return a ? [a.pos.x, a.pos.z] : null; }", g_id)
                g2.bring_to_front()
                g2.keyboard.down("KeyW")
                g2.wait_for_timeout(2000)
                g2.keyboard.up("KeyW")
                hpg.wait_for_timeout(600)
                p1 = hpg.evaluate("(id) => { const a = window.__LC__.W.actorById.get(id); return a ? [a.pos.x, a.pos.z] : null; }", g_id)
                moved = round(((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2) ** 0.5, 2) if p0 and p1 else None
            last = trace[-1] if trace else {}
            diag = {"backAfterS": took if back else None, "slot": g_id, "movedOnHostM": moved, "close": close_mode, "bootS": boot_s, "bootDoneAtS": t_boot,
                    "guestLast": last.get("guest"), "hostLast": last.get("host"), "trace": compress_trace(trace)}
            v.data["rejoinTrace"] = trace
            ok = bool(back) and took <= 60 and (moved or 0) > 1.0
            name = "rejoin (?room=<code> in a new page: back in the running match as the same actor within 60 s; the host sees it move)"
            setup_miss = rejoin_setup_miss(trace)
            if not ok and setup_miss:
                v.cnj(name, "SETUP missed (%s): %s" % (setup_miss, diag))
            else:
                v.check(name, ok, diag, "<= 60 s, > 1 m")
            for rec in (hrec, grec2):
                v.check("errors [%s] (0 console / page errors, 0 failed requests)" % rec.name.split("/")[1], rec.clean(), rec.problems())
        finally:
            rig.close()
    return C.run_gate("p23_netseq", body, args)


if __name__ == "__main__":
    sys.exit(main())
