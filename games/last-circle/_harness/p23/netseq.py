#!/usr/bin/env python
"""netseq - LC-49 netcode (P3 lane net): sequence numbers + server-time stamps in pack(); rejoin within 60 s on ?room=. Plan gate: "out-of-order
injection never pulls a remote backwards" (+ section 5 Online "rejoin within 60 s; no backward pulls from out-of-order packets"). Two REAL pages over
the squad relay stand-in (squadguard_live's FAKE_SB + p23lib.fake_sb_plus: the inbound REORDER switch holds every 3rd state packet and delivers
it after newer ones) - and the same switch on the guest's DataChannel receive (state travels P2P over unordered DataChannels first).

    python _harness/p23/netseq.py --disk
    python _harness/p23/netseq.py --rev 9aa2b746                # control: the P2 base (no sequence numbers: a late packet pulls the body back) - MUST FAIL
    python _harness/p23/netseq.py --disk --plant pull-back      # the guest's copy of the host is set back 1.5 m along its walk every 300 ms
                                                                # (what an applied late packet does) - MUST FAIL (no-backward / baseline)
    python _harness/p23/netseq.py --lanes all                   # validation: every lane's work served over the base

Rows:
  baseline        reorder OFF: the host walks straight (real W, 3 s); the guest's copy of the host only moves forward (control of the measure)
  no-backward     reorder ON: every 3rd state packet is held and delivered RIGHT AFTER the next REORDER_AFTER (2) newer ones, in the same task
                  (or REORDER_HOLD_MS = 600 ms late if no newer one comes): the guest's copy of the host never moves backwards along the walk by
                  > 0.05 m (sampled every 50 ms), while >= 10 late packets were delivered. Fix round 2: a timer-only hold did not bite the base
                  build (--rev BASE_P23, no sequence numbers): 0.007 / 0.107 m at 250 ms and 0.0 m at 600 ms - a late packet landing between
                  two frames of the (background, 8-15 fps) observing page is overwritten by the next fresh one before any frame draws it. Delivered
                  right after newer ones it is the LAST target applied before the next frame, two intervals (~1 m at a walk) behind the newest -
                  what a reordering wire really does. The same 0.05 m bar.
  rejoin          the guest's page closed; a NEW page in the same context opens ?room=<code>: within 60 s it is back in the RUNNING match as the
                  same actor (slot id), alive, and the host sees that body move again
  errors          both pages
SETUP (D16, could-not-judge, never FAIL): the pair is ONE squad session after the landing (both pages' W.net, the host drives the guest's body
from its packets) and the host's match clock runs at >= 0.6 x real time, the guest >= 5 fps (a starved page trips net.js's wall-clock watchdogs by
itself); during the rejoin wait the host - now the BACKGROUND page, the new page is in front - must draw >= WAIT_FPS_MIN (1) frame per wall
second (its leave watchdog reads the wall clock once a frame, the rejoin answer is message-driven; a quiet box gave it 4.2-7.3 fps). Fix round 2: the wait's old rule (host match clock >= 0.6 x real
time) measured the harness, not the box: the background host read 0.28-0.49 x in EVERY run on a quiet box (0 other Chromes), the passing ones
too (rejoin back in 26.2 s at 0.49 x), so a rejoin that never came back was always could-not-judge and the base control (no rejoin at all) could
never FAIL the row. The match-clock rate stays in the trace as information. Fix-round findings: the misses traced on 10-26 on a box at 100 %
CPU were starvation (the host's watchdog took s1 after 12 s of wall-clock silence, the guest's record went stale, the new page asked nothing,
the host said 'busy'); on a quiet box (10-27) the remaining miss is LC-49's own race - the new tab skips a localStorage record younger than 3 s
('a tab still playing'; the old tab rewrites it every 2 s), computes its candidates ONCE when the lobby joins, finds none, sends a plain hello
and the host answers 'busy' for good. The trace carries the record ages (rjAtClose on the old page, rjAgesMs on the new) to show it.
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
# Fix round 2: the plant was 0.3 m every 4th FRAME from a kernel updater - at the guest's background frame rate (8-15 fps) a frame's own walk
# (~0.35 m) and the lerp that follows in the same frame ate most of it, so it bit in one of two runs (gateA3 09:00: baseline 0.0 m, then
# FAIL on the retry). Now a wall-clock pull: every 300 ms the copy is set 1.5 m back along its motion (what a ~600 ms-old target does).
PLANTS = {
    "pull-back": "window.__P23PB__ = { n: 0 }; setInterval(() => { const P = window.__P23PB__; if (!P.id) return; const a = W.actorById.get(P.id);"
                 " if (!a || !a.vel) return; const sp = Math.hypot(a.vel.x, a.vel.z); if (sp < 0.5) return; P.n++; a.pos.x -= 1.5 * a.vel.x / sp; a.pos.z -= 1.5 * a.vel.z / sp; }, 300)",
}

TRACK_JS = r"""([id, ms, dx, dz]) => new Promise((res) => { const W = window.__LC__.W; const out = []; const t0 = performance.now();
  const iv = setInterval(() => { const a = W.actorById.get(id); if (a) out.push(+(a.pos.x * dx + a.pos.z * dz).toFixed(3));
    if (performance.now() - t0 > ms) { clearInterval(iv); res(out); } }, 50); })"""


GUEST_DIAG_JS = r"""() => { const W = window.__LC__ && window.__LC__.W; if (!W) return { booted: false };
  const st = document.querySelector('[data-net-rejoin]'); const S = W.net;
  return { phase: W.phase, vis: document.visibilityState, rejoinAttr: st ? st.getAttribute('data-net-rejoin') : null,
    status: st ? (st.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : null, asks: S && S.rejoinAsk ? S.rejoinAsk.tries : null,
    rejoin: S && S.rejoin ? S.rejoin.state : null, room: S && S.net ? S.net.room : null, rjAgesMs: (() => { try { const S2 = W.net, room = S2 && S2.net ? S2.net.room : (new URLSearchParams(location.search)).get('room');
      const l = JSON.parse(localStorage.getItem('lc.rejoin.v1.' + room) || 'null'); return Array.isArray(l) ? l.map((r) => Date.now() - r.at) : null; } catch (e) { return 'err'; } })(),
    inMsgs: (window.__SQ_LOG__ || []).filter((m) => m.dir === 'in' && m.t === 'rejoin').map((m) => m.d && (m.d.k + ':' + (m.d.code || '') + ':' + (m.d.why || ''))).slice(-4) }; }"""
HOST_DIAG_JS = r"""(id) => { const W = window.__LC__.W, S = W.net || {}; const now = performance.now(); const a = W.actorById.get(id);
  return { phase: W.phase, vis: document.visibilityState, simT: +(W.t || 0).toFixed(2), fn: W.kernel ? W.kernel.frameNo : null, goneAt: S.goneAt && S.goneAt[id] != null ? Math.round(now - S.goneAt[id]) : null,
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


REORDER_HOLD_MS = 600     # see the docstring (no-backward): a held packet goes out right after REORDER_AFTER newer ones, else after this
REORDER_AFTER = 2


# the host's frames per wall second the rejoin wait needs: its leave watchdog is 12 s of WALL-clock silence checked once a frame and the rejoin
# answer is message-driven, so ~1 frame a second suffices; the background host drew 4.2-7.3 fps on a quiet box (fix round 2), a starved box
# (netseq4 10-26, 100 % CPU) ran its clock at ~0.03 x real time
WAIT_FPS_MIN = 1.0


def host_wait_rates(trace):
    """(host rendered fps, host match-clock rate) over the rejoin wait, from the 1 s trace; None where not read"""
    hs = [(r["t"], r.get("host") or {}) for r in trace]
    fn = [(t, h["fn"]) for t, h in hs if isinstance(h.get("fn"), (int, float))]
    st = [(t, h["simT"]) for t, h in hs if isinstance(h.get("simT"), (int, float))]
    fps = round((fn[-1][1] - fn[0][1]) / max(0.001, fn[-1][0] - fn[0][0]), 1) if len(fn) >= 3 else None
    rate = round((st[-1][1] - st[0][1]) / max(0.001, st[-1][0] - st[0][0]), 3) if len(st) >= 3 else None
    return fps, rate


GUARD_JS = r"""(ids) => { const W = window.__LC__.W, k = W.kernel;
  const g = () => { for (const id of ids) { const a = W.actorById.get(id); if (a && a.alive && !a.downed) { a.hp = Math.max(a.hp, 100); a.shield = Math.max(a.shield || 0, 100); } } };
  k._updaters.push(g); return ids.filter((id) => { const a = W.actorById.get(id); return a && a.alive; }); }"""


def rejoin_setup_miss(trace):
    """a rejoin that missed because the HARNESS never let the host run (D16): the host page drew fewer than WAIT_FPS_MIN frames per wall second
    across the wait (a stalled / starved tab cannot run its watchdog, so it can never see the old page leave). The host is the background page
    here, so its match-clock rate (0.28-0.49 x on a quiet box) is information, not the rule. None = the setup was sound: the miss is a verdict."""
    fps, rate = host_wait_rates(trace)
    if fps is not None and fps < WAIT_FPS_MIN:
        return "the host drew %.1f frames per wall second over the wait (match clock %s x real time, %d polls): a starved / stalled page" % (
            fps, rate, len(trace))
    g = [r.get("guest") or {} for r in trace]
    if g and all(not x.get("booted", True) for x in g):
        return "the rejoining page never booted"
    return None


SETTLE_JS = r"""([id, ms]) => new Promise((res) => { const W = window.__LC__.W; const t0 = performance.now(); let last = null, still = 0;
  const iv = setInterval(() => { const a = W.actorById.get(id); const p = a ? [a.pos.x, a.pos.z] : null;
    if (p && last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.02) still++; else still = 0; last = p;
    if (still >= 3 || performance.now() - t0 > ms) { clearInterval(iv); res({ settled: still >= 3, ms: Math.round(performance.now() - t0) }); } }, 100); })"""


def settle(gpg, h_id, ms=6000):
    """wait until the guest's copy of the host stands still (3 x 100 ms within 2 cm), up to ms"""
    return gpg.evaluate(SETTLE_JS, [h_id, ms])


# which page is in FRONT during a tracked walk. Fix round 2: with the walker (host) in front, the observing guest ran at its background rate and
# its copy of the host trailed the newest target by metres (base: 8.75-9.37 m of progress on the copy in 4 s while the host walked ~18 m), so
# a stale target still lay AHEAD of the drawn copy and no injection could pull it back (0.0 m on the base at 600 ms and after-2-newer).
# The OBSERVER in front draws every target it applies; the walker keeps walking at its background rate (keys reach a background page).
OBSERVER_FRONT = True


def walk_and_track(hpg, gpg, h_id, ms=3000):
    yaw = hpg.evaluate("() => window.__LC__.W.player.input.yaw")
    import math
    dx, dz = -math.sin(yaw), -math.cos(yaw)
    fjs = "() => window.__LC__.W.kernel.frameNo"
    (gpg if OBSERVER_FRONT else hpg).bring_to_front()
    f0 = (time.time(), hpg.evaluate(fjs), gpg.evaluate(fjs))
    hpg.keyboard.down("KeyW")
    tr = gpg.evaluate(TRACK_JS, [h_id, ms, dx, dz])
    hpg.keyboard.up("KeyW")
    f1 = (time.time(), hpg.evaluate(fjs), gpg.evaluate(fjs))
    own = hpg.evaluate("([dx, dz]) => { const p = window.__LC__.W.player.pos; return p.x * dx + p.z * dz; }", [dx, dz])
    dt = max(0.001, f1[0] - f0[0])
    steps = [tr[i - 1] - tr[i] for i in range(1, len(tr))]
    back = max(steps, default=None)
    at = steps.index(back) + 1 if steps else None
    return {"samples": len(tr), "progress": round(tr[-1] - tr[0], 2) if tr else None, "maxBackM": round(back, 3) if back is not None else None,
            "backSteps>0.05": sum(1 for x in steps if x > 0.05), "atSample": at, "around": tr[max(0, (at or 0) - 4):(at or 0) + 3] if at else None,
            "front": "guest" if OBSERVER_FRONT else "host", "hostFps": round((f1[1] - f0[1]) / dt, 1), "guestFps": round((f1[2] - f0[2]) / dt, 1),
            "copyLagM": round(own - tr[-1], 2) if tr else None}


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
            rates = L.pair_rates(hpg, gpg)
            v.info("pair rates (host match clock x real time, host / guest rendered fps)", rates)
            if not rates["ok"]:
                v.cnj("pair (the host's match clock >= %.1f x real time, the guest >= %d fps)" % (L.SIM_RATE_MIN, L.PAIR_FPS_MIN), "SETUP missed: the box is starved - %s" % rates)
                return
            # SETUP ONLY (release prep): the host tops up both players' hp / shield every frame (p23lib.guard_ids' updater, on the host page,
            # where both bodies are simulated). Without it a bot could kill the idle guest's body during the walks: then there is no one to
            # rejoin as (p23_netseq_20261027_192100: s1 dead on the host before the close, rejoin record gone, the new page 'busy' - a setup
            # miss read as an LC-49 FAIL). Nothing in net.js reads hp.
            v.info("guard (host page: both players' hp / shield topped up until the end)", {"guard": hpg.evaluate(GUARD_JS, [h_id, g_id])})
            if args.plant:
                gpg.evaluate("() => { const W = window.__LC__.W, K = W.SIM; %s; return true; }" % PLANTS[args.plant])
                gpg.evaluate("(id) => { window.__P23PB__.id = id; }", h_id)
            # the state envelope travels P2P first: ffg_rtc.js DataChannels, UNORDERED ({ordered:false, maxRetransmits:0}) - the relay stand-in's
            # REORDER switch never saw a state packet when the DCs were open (netseq_all3 10-26: 0 late packets). The same switch on the guest's
            # DataChannel receive (W.net.rtc.onMessage, read per message by RTCMesh) - out-of-order delivery as the wire can really do it
            hook = gpg.evaluate("""() => { const W = window.__LC__.W, S = W.net; if (!S || !S.rtc || S.rtc.__p23ro) return !!(S && S.rtc && S.rtc.__p23ro); const om = S.rtc.onMessage;
                S.rtc.onMessage = function (m) { const R = window.__SQ_REORDER__; if (R && m && m.t === 'state' && !m.__late) { R.n = (R.n || 0) + 1;
                  if (R.n % R.every === 0) { R.held = (R.held || 0) + 1; const mm = Object.assign({}, m, { __late: true }); const e = { mm, left: R.after || 0, done: false };
                    (R.q = R.q || []).push(e); setTimeout(() => { if (!e.done) { e.done = true; R.late = (R.late || 0) + 1; S.rtc.onMessage(mm); } }, R.holdMs); return; }
                  const res = om.call(this, m);
                  for (const e of (R.q || [])) if (!e.done && --e.left <= 0) { e.done = true; R.late = (R.late || 0) + 1; R.afterNewer = (R.afterNewer || 0) + 1; om.call(this, e.mm); }
                  R.q = (R.q || []).filter((e) => !e.done); return res; }
                  return om.call(this, m); }; S.rtc.__p23ro = true; return true; }""")
            v.info("reorder hook on the guest's DataChannel receive", {"hooked": hook})
            spot = hpg.evaluate(L.FLAT_SPOT_JS, [0, 0, 6.0, 700, []])
            if spot:
                hpg.evaluate("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.input.yaw = 0; }", [spot["x"], spot["z"]])
            hpg.bring_to_front()          # the walker's page must tick (a hidden tab gets no rAF)
            hpg.wait_for_timeout(1500)
            v.info("page visibility during the walks", {k: pg.evaluate("() => document.visibilityState") for k, pg in (("host", hpg), ("guest", gpg))})
            v.data["settle1"] = settle(gpg, h_id)
            b = walk_and_track(hpg, gpg, h_id)
            # the walk must be OBSERVED (>= 30 samples of the 50 ms track, > 5 m of progress on the guest's copy): a starved / background guest page
            # that sampled 10 times and saw 1.4 m (gateA2 10-27 06:43) is a setup miss (D16), not a verdict; any pull-back > 0.05 m seen is a FAIL
            def walk_row(name, r, extra_ok=True, extra_why=""):
                back = (r["maxBackM"] or 0) > 0.05
                if not back and (r["samples"] < 30 or r["progress"] is None or r["progress"] <= 5 or not extra_ok):
                    v.cnj(name, "SETUP missed: the walk was not observed well enough (>= 30 samples, > 5 m%s): %s" % (extra_why, r))
                else:
                    v.check(name, not back, r, "> 5 m observed, never back > 0.05 m")
            walk_row("baseline (reorder off: the guest's copy of the host moves forward only)", b)
            hpg.evaluate("() => { const p = window.__LC__.W.player; p.input.yaw += Math.PI; }")
            # SETUP: the guest's copy of the host must have come to REST before the reversed walk is tracked (gateA 10-27 02:53: 800 ms was not
            # enough - the copy was still finishing the baseline walk, 5.4 m 'backwards' along the new direction at samples 1-4)
            v.data["settle2"] = settle(gpg, h_id)
            gpg.evaluate("([ms, after]) => { window.__SQ_REORDER__ = { every: 3, holdMs: ms, after }; }", [REORDER_HOLD_MS, REORDER_AFTER])
            hpg.wait_for_timeout(300)
            r = walk_and_track(hpg, gpg, h_id, 4000)
            held = gpg.evaluate("() => (window.__SQ_REORDER__ || {}).held || 0")
            r["afterNewer"] = gpg.evaluate("() => (window.__SQ_REORDER__ || {}).afterNewer || 0")
            gpg.evaluate("() => { window.__SQ_REORDER__ = null; }")
            r["latePackets"] = held
            walk_row("no-backward (every 3rd state packet delivered right after the %d newer ones, else %d ms late: the remote never pulled back > 0.05 m)" % (REORDER_AFTER, REORDER_HOLD_MS), r, held >= 10, ", >= 10 late packets")
            # rejoin. Fix round: the row records WHERE a miss stopped (both pages polled every 1 s until back / 60 s): the new page's boot time,
            # phase, its lobby status (data-net-rejoin + text) and asks left, and the host's view (ticking? its rejoin log, goneAt, lastSeen of
            # the slot, silentTake) - so a miss names net / boot, or a harness setup that never let the host see the old page leave
            url = gpg.url.split("?")[0] + "?room=" + code
            close_mode = getattr(args, "close", "plain")
            # the old page's rejoin records at the moment it closes (LC-49: a NEW tab skips a record younger than 3 s - 'a tab still playing')
            v.data["rjAtClose"] = safe_eval(gpg, "() => { try { const l = JSON.parse(localStorage.getItem('lc.rejoin.v1.' + window.__LC__.W.net.net.room) || 'null');"
                                                 " return Array.isArray(l) ? l.map((r) => ({ slot: r.slot, ageMs: Date.now() - r.at })) : null; } catch (e) { return String(e); } }")
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
            w_fps, w_rate = host_wait_rates(trace)
            diag = {"backAfterS": took if back else None, "slot": g_id, "movedOnHostM": moved, "close": close_mode, "bootS": boot_s, "bootDoneAtS": t_boot,
                    "hostWaitFps": w_fps, "hostWaitClockRate": w_rate, "rjAtClose": v.data.get("rjAtClose"),
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
