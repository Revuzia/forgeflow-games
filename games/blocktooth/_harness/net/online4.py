#!/usr/bin/env python
"""online4 - ONLINE_PLAN gates H4 and H6 (lane O-REPORT): the online VS stack in SEPARATE BROWSERS on REAL Supabase Realtime + real WebRTC.

    python _harness/net/online4.py                     # H4: quick2 + room4 (short matches, ~4 min each)
    python _harness/net/online4.py --scenario quick2   # (a) quick match, 2 humans + 2 bots
    python _harness/net/online4.py --scenario room4    # (b) a room code with 4 humans, (c) host tab closed mid-match, (d) a tab hidden / frozen
    python _harness/net/online4.py --scenario h6       # H6: Chromium + Firefox + WebKit in ONE match (full 10:45 unless --short)
    python _harness/net/online4.py --scenario all --full-length   # the real 10:45 clock everywhere (about 12 min per scenario)
    python _harness/net/online4.py --hide-mode tab     # (d) as a REAL hidden tab (a 2nd tab opened over it) instead of a CDP freeze

Each peer is its own browser process (own launch: Chromium with --disable-renderer-backgrounding --disable-background-timer-throttling
--disable-backgrounding-occluded-windows; Firefox / WebKit for H6), loading a portal stand-in page (portal/bridge_host.html, a signed-in
account u1..u4) whose game frame is _harness/net/online4.html = ONE OnlineSession + the real vsWorldPort + PortalClient/VsIdentityBook.
The page's `build` string is unique per run (h4-<run>): room layer groups only identical builds, so no real player's lobby or room can
ever match a test page, and the Supabase message volume of a run is a few hundred messages. `short` matches (default) run VS.phase =
40/80/125/150 s on every page (a pacing override only; the same on every peer); --full-length plays the real 10:45.

Checks (H4): (a) both humans START with the same match id and 2 bot seats; every peer finishes; no hash mismatch; every common checkpoint
hash is identical across peers; (c) the host's tab is closed -> the others elect a new authority, finish, and their hashes equal the
dead host's pre-close ones; (d) a tab frozen / hidden for 12 s catches up (its tick is back within 60 ticks of the others at the end) and
its hashes after the stall equal the others'; (e) the final standings hash is identical on every surviving client and the places are
1..4; plus the REPORTING: each survivor's forgeflow:vs_result payload -> a fresh stand-in DB (vs_rpc_mirror.cjs): one row per reporter,
the match row's winner confirmed exactly when the winner is a reporting human.
Exit 0 pass, 1 a check FAILED, 3 NOT RUN (environment: Supabase / esm.sh unreachable, or the browser could not run), 2 could not start.
Report: _harness/_reports/online4_<scenario>.json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.dirname(HERE)
ROOT = os.path.dirname(HARNESS)
sys.path.insert(0, HARNESS)
sys.path.insert(0, os.path.join(HARNESS, "portal"))
import common as C  # noqa: E402
import portalcheck as PC  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CHROMIUM_FLAGS = ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
                  "--autoplay-policy=no-user-gesture-required"]
SUPABASE = "https://wugoxdewcdxzfppgzohy.supabase.co/rest/v1/"
ESM = "https://esm.sh/@supabase/supabase-js@2.117.2"


def log(m):
    print("[%s] %s" % (time.strftime("%H:%M:%S"), m), flush=True)


def reachable(url, timeout=10):
    """True when the host answers at all (any HTTP status, incl. 401 / 404)."""
    try:
        urllib.request.urlopen(urllib.request.Request(url, method="GET", headers={"User-Agent": "blocktooth-online4/1.0"}), timeout=timeout)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


class Peer:
    """One browser process = one human."""

    def __init__(self, pw, engine, idx, user, args):
        self.engine, self.idx, self.user, self.args = engine, idx, user, args
        self.name = "p%d" % idx
        launcher = getattr(pw, engine)
        kw = {"headless": not args.headed}
        if engine == "chromium":
            kw["args"] = list(CHROMIUM_FLAGS)
        self.browser = launcher.launch(**kw)
        self.ctx = self.browser.new_context(viewport={"width": 900, "height": 560})
        self.page = self.ctx.new_page()
        self.console, self.page_errors, self.failed = [], [], []
        self.page.on("console", lambda m: self.console.append((m.type, m.text)))
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.page.on("requestfailed", lambda r: self.failed.append("%s %s" % (r.url[:140], r.failure)))
        self.closed = False
        self.cover = None
        self.cdp = None
        self.pre_close = None            # hash log + final snapshot taken just before the tab is closed
        self.version = self.browser.version

    def open(self, run, mode, code, wait, short, seed, biome, start_now_ms=0):
        q = {"run": run, "name": self.name, "mode": mode, "code": code, "wait": str(wait), "short": "1" if short else "0",
             "seed": str(seed), "biome": biome, "startNow": str(start_now_ms)}
        base = self.args.base.rstrip("/")
        game = "%s/_harness/net/online4.html?%s" % (base, urllib.parse.urlencode(q))
        frames = [{"game": game, "user": self.user}]
        hq = {"mode": "signed", "frames": json.dumps(frames), "sandbox": PC.read_portal_attrs()[0] or "", "allow": ""}
        self.page.goto(PC.PORTAL["origin"] + PC.PORTAL_PATH + "?" + urllib.parse.urlencode(hq), wait_until="load", timeout=90_000)

    def frame(self):
        if self.closed:
            return None
        for f in self.page.frames:
            if f != self.page.main_frame and "online4.html" in f.url:
                return f
        return None

    def js(self, expr, arg=None, default=None):
        f = self.frame()
        if f is None:
            return default
        try:
            return f.evaluate(expr) if arg is None else f.evaluate(expr, arg)
        except Exception as e:
            return default if default is not None else {"__error": str(e).splitlines()[0][:200]}

    def snap(self):
        r = self.js("() => (window.__H4__ && window.__H4__.snap) ? window.__H4__.snap() : (window.__H4__ ? { phase: window.__H4__.phase, error: window.__H4__.error } : null)", default=None)
        return r if isinstance(r, dict) and not r.get("__error") else None

    def hashes(self):
        r = self.js("() => (window.__H4__ && window.__H4__.hashes) ? window.__H4__.hashes() : []", default=[])
        return r if isinstance(r, list) else []

    def state(self):
        r = self.js("() => { const H = window.__H4__; return H ? { phase: H.phase, error: H.error, standings: H.standings || null, agreed: H.agreed === undefined ? null : H.agreed, report: H.report || null, reportError: H.reportError || null, ledger: H.ledger || null, events: H.events, matchId: H.matchId || null, seat: H.seat === undefined ? null : H.seat, host: H.host === undefined ? null : H.host, humans: H.humans === undefined ? null : H.humans, unreachable: H.unreachable || null, id: H.id || null, portalState: H.portalState || null } : null; }", default=None)
        return r if isinstance(r, dict) and not r.get("__error") else None

    def bridge_calls(self):
        f = None
        try:
            return self.page.evaluate("() => window.__BRIDGE ? window.__BRIDGE.log.filter(x => x.dir === 'in' && x.fromGame && (x.type === 'forgeflow:vs_result' || x.type === 'forgeflow:achievement')).map(x => ({ type: x.type, msg: x.msg })) : []")
        except Exception:
            return []

    def close_tab(self):
        """closing the tab = an abrupt departure (no goodbye): the page's sockets / channels / timers die with it"""
        self.pre_close = {"hashes": self.hashes(), "snap": self.snap(), "state": self.state()}
        try:
            self.page.close(run_before_unload=False)
        except Exception:
            pass
        self.closed = True

    def freeze(self):
        """a hard-throttled / discarded-like tab: the whole page (Worker clock included) stops until thaw()"""
        if self.engine != "chromium":
            return False
        self.cdp = self.ctx.new_cdp_session(self.page)
        self.cdp.send("Page.enable")
        self.cdp.send("Page.setWebLifecycleState", {"state": "frozen"})
        return True

    def thaw(self):
        if self.cdp is not None:
            try:
                self.cdp.send("Page.setWebLifecycleState", {"state": "active"})
            except Exception as e:
                log("thaw failed: %s" % e)
        return True

    def cover_tab(self):
        """hide this page for real: open a 2nd tab in the same window and bring it to front"""
        self.cover = self.ctx.new_page()
        self.cover.goto("about:blank")
        self.cover.bring_to_front()

    def uncover_tab(self):
        if self.cover is not None:
            try:
                self.page.bring_to_front()
                self.cover.close()
            except Exception:
                pass
            self.cover = None

    def errors(self):
        errs = [t for (k, t) in self.console if k == "error" and "__cf_bm" not in t]       # (Firefox warns about Supabase's Cloudflare cookie: not ours)
        return {"console": errs[:8], "page": self.page_errors[:5], "failed": [f for f in self.failed if "favicon" not in f][:5]}

    def shutdown(self):
        try:
            self.browser.close()
        except Exception:
            pass


def fresh_run_id():
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))


def room_code():
    return "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))


def compare_hashes(logs):
    """logs: {peerName: [[tick, a, b], ...]} -> (compared ticks, mismatching ticks, first mismatch)"""
    by_tick = {}
    for name, lst in logs.items():
        for t, a, b in lst:
            by_tick.setdefault(t, {})[name] = (a, b)
    compared = bad = 0
    first = None
    for t in sorted(by_tick):
        vals = by_tick[t]
        if len(vals) < 2:
            continue
        compared += 1
        if len(set(vals.values())) > 1:
            bad += 1
            if first is None:
                first = {"tick": t, "values": vals}
    return compared, bad, first


def standings_view(st):
    if not st:
        return None
    return {"hash": st.get("hash"), "endTick": st.get("endTick"), "result": st.get("result"),
            "places": [[s.get("slot"), s.get("kind"), s.get("place"), s.get("titan"), s.get("won")] for s in st.get("seats", [])]}


def replay_reports(peers_any, reports):
    """Replay every reporter's payload (arrival order = peer order) into a FRESH vs_rpc_mirror DB in a live page: the server's verdict."""
    page = next((p.page for p in peers_any if not p.closed), None)
    if page is None:
        return None
    users = sorted({p["uid"] for p in reports})
    try:
        return page.evaluate("""(args) => {
          const db = new window.BT_VS_RPC.FakeBtDb();
          for (const u of args.users) db.addProfile(u, u);
          const acks = args.reports.map((r) => db.report(r.uid, r.payload));
          return JSON.parse(JSON.stringify({ acks, matches: db.bt_vs_matches, results: db.bt_vs_results, stats: db.bt_player_stats }));
        }""", {"users": users, "reports": reports})
    except Exception as e:
        return {"error": str(e)[:300]}


def judge_reports(chk, label, peers, live, start_humans, standings, out):
    """The reporting verdict for the surviving humans."""
    reports = []
    for p in live:
        st = p.state() or {}
        rep = st.get("report")
        calls = p.bridge_calls()
        sent = [c for c in calls if c["type"] == "forgeflow:vs_result"]
        chk.check("%s: peer %s (%s) sent exactly ONE forgeflow:vs_result through the portal frame" % (label, p.name, p.engine), len(sent) == 1,
                  {"sent": len(sent), "report": rep, "reportError": st.get("reportError")})
        if sent:
            reports.append({"uid": PC.VS_USERS[p.user], "payload": sent[0]["msg"].get("payload"), "peer": p.name})
    out["reports"] = reports
    if not reports:
        return
    ids = {r["payload"].get("match_id") for r in reports}
    chk.check("%s: every reporter filed under the SAME match id" % label, len(ids) == 1, list(ids))
    places = [r["payload"].get("placement") for r in reports]
    chk.check("%s: reporters' placements are distinct, within 1..4" % label, len(set(places)) == len(places) and all(x in (1, 2, 3, 4) for x in places), places)
    chk.check("%s: humans in the payloads = the START humans (%s), bots = %d" % (label, start_humans, 4 - start_humans),
              all(r["payload"].get("humans") == start_humans and r["payload"].get("bots") == 4 - start_humans for r in reports), [(r["payload"].get("humans"), r["payload"].get("bots")) for r in reports])
    verdict = replay_reports(peers, reports)
    out["server"] = verdict
    if not verdict or verdict.get("error"):
        chk.check("%s: the replay into the server mirror ran" % label, False, verdict)
        return
    chk.check("%s: every report was ACCEPTED by the server mirror (no rejection)" % label, all(a.get("ok") for a in verdict["acks"]), verdict["acks"])
    win_slot = next((s["slot"] for s in (standings or {}).get("seats", []) if s.get("won")), None)
    seat_of = {}
    for p in live:
        st = p.state() or {}
        seat_of[p.name] = st.get("seat")
    winner_reporters = [r for r in reports if seat_of.get(r["peer"]) == win_slot]
    m = list(verdict["matches"].values())[0] if verdict["matches"] else {}
    if winner_reporters and len(reports) >= 2:
        chk.check("%s: the winner (seat %s) is a reporting human and >= 2 humans reported: winner_id CONFIRMED = that account" % (label, win_slot),
                  m.get("winner_id") == winner_reporters[0]["uid"], {"match": m, "acks": verdict["acks"]})
    else:
        chk.check("%s: the winner (seat %s) is a bot / a non-reporter / only one human reported: winner_id stays NULL" % (label, win_slot), m.get("winner_id") is None, {"match": m})
    chk.check("%s: one bt_vs_results row per reporter + 1 bt_vs_matches row" % label, len(verdict["results"]) == len(reports) and len(verdict["matches"]) == 1, verdict)


def poll_match(peers, deadline_s, triggers, tick_s=1.0):
    """Poll every live peer until all are done / errored / no-match, running `triggers` (callables f(elapsed, peers) -> None). Returns the timeline."""
    t0 = time.time()
    timeline = []
    last_log = 0
    while time.time() - t0 < deadline_s:
        el = time.time() - t0
        live = [p for p in peers if not p.closed]
        snaps = {p.name: p.snap() for p in live}
        for tr in triggers:
            tr(el, peers, snaps)
        if el - last_log >= 15:
            last_log = el
            log("  t+%3.0fs %s" % (el, " | ".join("%s %s tick %s/%s%s" % (p.name, (snaps.get(p.name) or {}).get("phase"), (snaps.get(p.name) or {}).get("simTick"),
                                                                       (snaps.get(p.name) or {}).get("confirmed"), " FROZEN" if p.cdp is not None and getattr(p, "frozen", False) else "") for p in live)))
        timeline.append({"t": round(el, 1), "snaps": {k: (v or {}).get("simTick") for k, v in snaps.items()}})
        if live and all((snaps.get(p.name) or {}).get("phase") in ("done", "error", "nomatch") for p in live):
            return timeline, True
        time.sleep(tick_s)
    return timeline, False


def env_check(chk):
    ok1, ok2 = reachable(SUPABASE), reachable(ESM)
    log("environment: Supabase Realtime host reachable=%s, esm.sh reachable=%s" % (ok1, ok2))
    return ok1 and ok2


def scenario_quick2(pw, args, chk, out):
    L = "quick2"
    run = fresh_run_id()
    peers = [Peer(pw, "chromium", i, "u%d" % (i + 1), args) for i in range(2)]
    out["run"] = run
    try:
        log("%s: run %s, 2 chromium browsers (%s); quick match wait 6 s" % (L, run, peers[0].version))
        for i, p in enumerate(peers):
            p.open(run, "quick", "", 6000, not args.full_length, 1337, "grideast")
            time.sleep(0.8)
        deadline = (900 if args.full_length else 330)
        tl, finished = poll_match(peers, deadline, [])
        return judge_common(chk, out, L, peers, tl, finished, start_humans=2, expect_started=2)
    finally:
        for p in peers:
            p.shutdown()


def judge_common(chk, out, L, peers, timeline, finished, start_humans, expect_started):
    live = [p for p in peers if not p.closed]
    states = {p.name: p.state() for p in peers if not p.closed}
    snaps = {p.name: p.snap() for p in live}
    out["states"] = {k: {kk: vv for kk, vv in (v or {}).items() if kk != "events"} for k, v in states.items()}
    out["events"] = {k: (v or {}).get("events", [])[-60:] for k, v in states.items()}
    started = [p for p in live if (states.get(p.name) or {}).get("phase") in ("started", "done")]
    closed_started = [p for p in peers if p.closed and p.pre_close and ((p.pre_close.get("state") or {}).get("phase") in ("started", "done"))]
    chk.check("%s: every browser got a match (%d; %d still open + %d closed on purpose after it started)" % (L, expect_started, len(started), len(closed_started)),
              len(started) == len(live) and len(started) + len(closed_started) >= expect_started,
              {k: (v or {}).get("phase") for k, v in states.items()})
    out["errors"] = {p.name: p.errors() for p in peers}
    out["consoleTail"] = {p.name: p.console[-12:] for p in peers}
    if len(started) + len(closed_started) < expect_started:
        out["notRunReason"] = "no match formed: " + json.dumps({k: ((v or {}).get("phase"), (v or {}).get("error")) for k, v in states.items()})[:400]
        return
    mids = {(states[p.name] or {}).get("matchId") for p in started}
    chk.check("%s: every peer's START carries the SAME match id" % L, len(mids) == 1, list(mids))
    seats = [(states[p.name] or {}).get("seat") for p in started]
    chk.check("%s: the humans hold distinct seats" % L, len(set(seats)) == len(seats), seats)
    chk.check("%s: %d humans + %d bots in the START" % (L, start_humans, 4 - start_humans), all((states[p.name] or {}).get("humans") == start_humans for p in started), [(states[p.name] or {}).get("humans") for p in started])
    chk.check("%s: every live peer reached the end of the match" % L, finished and all((snaps.get(p.name) or {}).get("phase") == "done" for p in live), {k: (v or {}).get("phase") for k, v in snaps.items()})
    chk.check("%s: no peer reports an error / desync (mismatches 0, state not desynced)" % L,
              all(not (snaps[p.name] or {}).get("error") and (snaps[p.name] or {}).get("mismatches") == 0 and (snaps[p.name] or {}).get("state") != "desynced" for p in live if snaps.get(p.name)),
              {k: (v or {}).get("mismatches") for k, v in snaps.items()})
    logs = {p.name: p.hashes() for p in live}
    for p in peers:
        if p.closed and p.pre_close:
            logs[p.name + "(closed)"] = p.pre_close["hashes"]
    compared, bad, first = compare_hashes(logs)
    out["hashes"] = {"compared": compared, "bad": bad, "first": first, "peers": {k: len(v) for k, v in logs.items()}}
    chk.check("%s: every common checkpoint hash is IDENTICAL across peers (%d compared, %d mismatched)" % (L, compared, bad), compared >= 20 and bad == 0, first)
    sv = {p.name: standings_view((states[p.name] or {}).get("standings")) for p in live}
    out["standings"] = sv
    hs = {(v or {}).get("hash") for v in sv.values()}
    chk.check("%s: (e) the final STANDINGS hash is identical on every surviving client" % L, len(hs) == 1 and None not in hs, sv)
    anyst = next(((states[p.name] or {}).get("standings") for p in live if (states[p.name] or {}).get("standings")), None)
    if anyst:
        pl = sorted(s.get("place") for s in anyst["seats"])
        chk.check("%s: the places are 1..4 and the match was decided (result %s)" % (L, anyst.get("result")), pl == [1, 2, 3, 4] and anyst.get("result") == "vs", {"places": pl, "result": anyst.get("result")})
    agreed = [(states[p.name] or {}).get("agreed") for p in live]
    chk.check("%s: every client saw the other clients' RESULT hashes agree (resultsAgree)" % L, all(a is True for a in agreed), agreed)
    judge_reports(chk, L, peers, live, start_humans, anyst, out)
    errs = {p.name: p.errors() for p in peers}
    out["errors"] = errs
    bad_err = {k: v for k, v in errs.items() if v["page"] or v["console"]}
    chk.check("%s: 0 page errors / console errors in any browser" % L, not bad_err, bad_err)
    out["timeline"] = timeline[-6:]


def scenario_room4(pw, args, chk, out):
    L = "room4"
    run = fresh_run_id()
    code = room_code()
    peers = [Peer(pw, "chromium", i, "u%d" % (i + 1), args) for i in range(4)]
    out["run"] = run
    out["code"] = code
    acted = {"close": None, "freeze": None, "thaw": None, "cover": None}
    short = not args.full_length
    CLOSE_AT, HIDE_AT, HIDE_S = (20 * 30, 40 * 30, 12) if short else (60 * 30, 180 * 30, 20)

    def trig(el, ps, snaps):
        host = ps[0]
        hs = snaps.get(host.name) or {}
        if acted["close"] is None and not host.closed and (hs.get("confirmed") or 0) >= CLOSE_AT:
            acted["close"] = {"at_s": round(el, 1), "confirmed": hs.get("confirmed")}
            log("%s: CLOSING the host tab (%s) at confirmed tick %s" % (L, host.name, hs.get("confirmed")))
            host.close_tab()
        g = ps[2]
        gs = snaps.get(g.name) or {}
        ref = max([(snaps.get(p.name) or {}).get("confirmed") or 0 for p in ps if not p.closed and p is not g] or [0])
        if acted["close"] and acted["freeze"] is None and ref >= HIDE_AT:
            if args.hide_mode == "tab":
                g.cover_tab(); ok = True
            else:
                ok = g.freeze()
            g.frozen = True
            acted["freeze"] = {"at_s": round(el, 1), "ref": ref, "mode": args.hide_mode, "ok": ok, "peer_tick": gs.get("simTick")}
            log("%s: %s %s (%s) at others' tick %s" % (L, "HIDING" if args.hide_mode == "tab" else "FREEZING", g.name, args.hide_mode, ref))
        if acted["freeze"] and acted["thaw"] is None and el - acted["freeze"]["at_s"] >= HIDE_S:
            if args.hide_mode == "tab":
                g.uncover_tab()
            else:
                g.thaw()
            g.frozen = False
            acted["thaw"] = {"at_s": round(el, 1)}
            log("%s: %s %s thawed / shown again" % (L, g.name, g.args.hide_mode))

    try:
        log("%s: run %s code %s, 4 chromium browsers (%s)" % (L, run, code, peers[0].version))
        peers[0].open(run, "host", code, 0, short, 1337, "grideast")
        time.sleep(2.5)
        for p in peers[1:]:
            p.open(run, "join", code, 0, short, 1337, "grideast")
            time.sleep(1.0)
        deadline = 960 if args.full_length else 420
        tl, finished = poll_match(peers, deadline, [trig])
        out["actions"] = acted
        chk.check("%s: (c) the host's tab WAS closed mid-match (action taken at tick %s)" % (L, (acted["close"] or {}).get("confirmed")), acted["close"] is not None, acted)
        chk.check("%s: (d) a guest tab WAS %s mid-match and restored (frozen at tick %s)" % (L, "hidden" if args.hide_mode == "tab" else "frozen", (acted["freeze"] or {}).get("peer_tick")),
                  acted["freeze"] is not None and acted["thaw"] is not None and (acted["freeze"] or {}).get("ok") is not False, acted)
        judge_common(chk, out, L, peers, tl, finished, start_humans=4, expect_started=4)
        live = [p for p in peers if not p.closed]
        sn = {p.name: p.snap() for p in live}
        mig = [(sn[p.name] or {}).get("migrations", 0) for p in live if sn.get(p.name)]
        auth = {(sn[p.name] or {}).get("authority") for p in live if sn.get(p.name)}
        ids = {p.name: ((p.state() or {}).get("id")) for p in peers}
        dead_id = ids.get(peers[0].name)
        chk.check("%s: (c) the survivors ELECTED a new authority (not the closed host) and agree on it" % L, len(auth) == 1 and dead_id not in auth and sum(1 for m in mig if m >= 1) >= 1, {"authority": list(auth), "deadHost": dead_id, "migrations": mig})
        ticks = {p.name: (sn[p.name] or {}).get("simTick") for p in live if sn.get(p.name)}
        g = peers[2]
        chk.check("%s: (d) the frozen/hidden peer CAUGHT UP (its tick is within 60 of the others at the end: %s)" % (L, ticks),
                  len(ticks) >= 2 and max(ticks.values()) - ticks.get(g.name, 0) <= 60, ticks)
        gstate = next((e for e in ((g.state() or {}).get("events") or []) if "afk" in e.lower()), None)
        out["frozenPeerAfkEvent"] = gstate
        # hashes of the frozen peer AFTER the stall equal the others' (compare_hashes already covers the whole log; this isolates the post-stall window)
        stall_tick = (acted["freeze"] or {}).get("ref") or 0
        post = {p.name: [h for h in p.hashes() if h[0] > stall_tick + 30 * HIDE_S] for p in live}
        c2, b2, f2 = compare_hashes(post)
        chk.check("%s: (d) hashes AFTER the stall are identical on all survivors (%d compared, %d mismatched)" % (L, c2, b2), c2 >= 3 and b2 == 0, f2)
    finally:
        for p in peers:
            p.shutdown()


def scenario_h6(pw, args, chk, out):
    L = "h6"
    run = fresh_run_id()
    code = room_code()
    out["run"] = run
    out["code"] = code
    short = bool(args.short_h6)
    peers = []
    # which engines can open a WebRTC mesh at all? (Playwright's WebKit build for Windows has no RTCPeerConnection)
    rtc = {}
    for e in ("chromium", "firefox", "webkit"):
        try:
            b = getattr(pw, e).launch(headless=True)
            pg = b.new_page()
            pg.goto("about:blank")
            rtc[e] = {"version": b.version, "rtc": pg.evaluate("() => typeof RTCPeerConnection === 'function'")}
            b.close()
        except Exception as ex:
            rtc[e] = {"version": None, "rtc": False, "error": str(ex)[:200]}
    out["engineProbe"] = rtc
    log("%s: engine probe %s" % (L, json.dumps(rtc)))
    engines = [e for e in ("chromium", "firefox", "webkit") if rtc[e]["rtc"]]
    skipped = [e for e in ("chromium", "firefox", "webkit") if not rtc[e]["rtc"]]
    out["skippedEngines"] = skipped
    if skipped:
        log("%s: NOT RUN (environment) for %s: no RTCPeerConnection in this engine build" % (L, skipped))
    if len(engines) < 2:
        out["notRunReason"] = "fewer than 2 engines can open a WebRTC mesh: %s" % json.dumps(rtc)
        return
    while len(engines) < 3:
        engines.append("chromium")           # keep 3 humans: the missing engine's seat is a 2nd Chromium
    try:
        for i, e in enumerate(engines):
            try:
                peers.append(Peer(pw, e, i, "u%d" % (i + 1), args))
            except Exception as ex:
                chk.check("%s: engine %s launches" % (L, e), False, str(ex)[:300])
                out["notRunReason"] = "engine %s could not launch: %s" % (e, str(ex)[:200])
                return
        log("%s: run %s code %s, engines %s; match %s" % (L, run, code, [p.version for p in peers], "SHORT" if short else "FULL 10:45"))
        peers[0].open(run, "host", code, 0, short, 1337, "grideast", start_now_ms=22000)      # 3 humans + 1 bot: the host starts after 22 s (a slow Firefox launch must not miss the roster)
        time.sleep(2.0)
        for p in peers[1:]:
            p.open(run, "join", code, 0, short, 1337, "grideast")
            time.sleep(1.0)
        deadline = 400 if short else 960
        tl, finished = poll_match(peers, deadline, [])
        judge_common(chk, out, L, peers, tl, finished, start_humans=3, expect_started=3)
        out["engineVersions"] = {p.name: "%s %s" % (p.engine, p.version) for p in peers}
        un = {p.name: ((p.state() or {}).get("unreachable")) for p in peers}
        chk.check("%s: every pair of engines connected directly (no 'unreachable' peers at START)" % L, all(not u for u in un.values()), un)
    finally:
        for p in peers:
            p.shutdown()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:5412/", help="vite dev server root (started here with BT_FROZEN=1 when not up)")
    ap.add_argument("--scenario", choices=("quick2", "room4", "h6", "h4", "all"), default="h4")
    ap.add_argument("--full-length", action="store_true", help="H4: the real 10:45 clock instead of the short 150 s override")
    ap.add_argument("--short-h6", action="store_true", help="H6: a SHORT match (dev loop); the gate is the full 10:45")
    ap.add_argument("--hide-mode", choices=("freeze", "tab"), default="freeze", help="(d): CDP Page.setWebLifecycleState frozen (default), or a real hidden tab")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--report-dir", default=None)
    args = ap.parse_args()

    chk = PC.Checks()
    out = {"scenario": args.scenario, "base": args.base, "fullLength": args.full_length}
    if not env_check(chk):
        print("\nonline4: NOT RUN (environment): cannot reach Supabase / esm.sh from this machine")
        return 3
    os.environ.setdefault("BT_FROZEN", "1")
    try:
        server = C.ensure_server(args.base, not args.no_serve)
    except C.HarnessError as e:
        print("COULD NOT START: %s" % e)
        return 2
    ps = PC.PortalServer().__enter__()
    PC.PORTAL["origin"] = ps.origin
    rc = 0
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            todo = {"quick2": ["quick2"], "room4": ["room4"], "h6": ["h6"], "h4": ["quick2", "room4"], "all": ["quick2", "room4", "h6"]}[args.scenario]
            for sc in todo:
                log("===== scenario %s =====" % sc)
                sub = {}
                out[sc] = sub
                n0 = len(chk.items)
                try:
                    {"quick2": scenario_quick2, "room4": scenario_room4, "h6": scenario_h6}[sc](pw, args, chk, sub)
                except Exception as e:
                    import traceback
                    chk.check("%s: the scenario ran without a harness exception" % sc, False, traceback.format_exc()[-600:])
                sub["checks"] = chk.items[n0:]
    finally:
        ps.__exit__()
        C.stop_server(server)
    out["checks"] = chk.items
    failed = chk.failed
    notrun = [sc for sc in ("quick2", "room4", "h6") if isinstance(out.get(sc), dict) and out[sc].get("notRunReason")]
    verdict = "FAIL" if failed else ("NOT RUN (%s)" % ",".join(notrun) if notrun else "PASS")
    out["verdict"] = verdict
    path = C.save_report("online4_" + args.scenario, out, base=args.base, report_dir=args.report_dir)
    print("\nonline4: %s  (%d checks, %d failed)  report %s" % (verdict, len(chk.items), len(failed), path))
    for c in failed:
        print("  FAILED: %s" % c["name"])
    return 1 if failed else (3 if notrun else 0)


if __name__ == "__main__":
    sys.exit(main())
