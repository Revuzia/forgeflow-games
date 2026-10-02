"""HIT PARADE - _harness/online2.py (lane NET; CONTRACT §10, §13 G10).

Two REAL Chromes (two separate Chromium processes, not two tabs of one browser) play online.

Modes
  --lab            works today: both open /lab/net.html?room=<CODE>&auto=1&secs=N&tag=a|b. They meet in one
                   Supabase room (NetPlay presence + HELLO), open the WebRTC DataChannels (signalling over the room
                   channel; or the relay with --relay), measure RTT (1 s settle + 10 pings), run the blind-select
                   commit-reveal, then N seconds of rollback netplay on the toy sim with human-like random inputs,
                   and exchange RESULT {final confirmed checksum}. PASS = both done + ok, same final checksum,
                   0 desyncs, 0 page errors.
  --game           (P2) the REAL game on both sides: two Chrome processes on two dev-server origins (--ports A,B; default
                   5325,5330 - any free pair works, a port without a dev server gets its own HP_FROZEN vite for the run;
                   two origins = two localStorages), driven ONLY by real key presses (menus, character select, the
                   bout, pause, results). Scenarios (--scenarios quick,code,link; also forfeit, relay):
                     quick: QUICK MATCH on both -> blind select (picks by real arrows: --fa / --fb, any grid row) -> a
                            full best-of-3 played by two key bots that circle-walk (STEP held) and sidestep (STEP tapped)
                            -> RESULT agreement (both agreed, same winner, identical final checksum, same MATCH_END frame)
                            -> REMATCH on both -> second select (new seed) -> A's pause card (the peer keeps advancing) ->
                            RESUME -> A's TAB CLOSES mid-round -> B wins by disconnect after the presence grace -> B's
                            REMATCH (nobody to rematch) -> B on the ONLINE lobby; A's tab is reopened
                     code:  A CREATE ROOM (4-letter code on the status line) -> B types it into JOIN -> full best-of-3 ->
                            agreement -> REMATCH on both -> B's TAB CLOSES mid-round -> A wins after the grace -> A's
                            REMATCH -> A on the ONLINE lobby "opponent left"; B's tab is reopened
                     link:  A CREATE ROOM -> B opens /?room=CODE (deep link auto-join) -> both in the select -> B's tab
                            goes away -> A back on the ONLINE lobby "opponent left" (5 s presence grace)
                     forfeit: QUICK MATCH -> select -> a short bout -> A pauses and FORFEITS -> B wins by forfeit ->
                            REMATCH with nobody to rematch -> both on the ONLINE lobby (the pre-wf7 quick tail)
                   CHANGED(wf7 online) VO-D8: --ports, a picker that walks the real grid (RANDOM spans both rows and always
                   exits to row 0; ArrowDown does nothing on it) and refuses nothing silently (the pick check fails when
                   the cursor is not the wanted fighter), bots that circle-walk / sidestep on a sim-frame cadence, a
                   mid-round LEAVE (tab closed) in quick + code, and a per-page supabase-js GoTrueClient warning check.
  --pick-test      CHANGED(wf7 online): one Chrome on port A: VERSUS -> character select -> the picker walks P1's cursor to
                   EVERY slot (both rows, RANDOM, the bosses' column) by real arrow keys; PASS = every slot reached
                   Measures per bout: transport + ICE pair, sync / session RTT, D, frames, gameSpeed (session ticks),
                   wallSpeed (vs real time), stall ticks, rollbacks, local loop drops + fps (two 3D Chromes share one
                   GPU here: --quality low by default), Supabase sends per side. --relay forces the relay tier (keep it
                   short: 40 events/s of the project's shared 100/s). Report -> _harness/_reports/online2_game[_relay].json,
                   screenshots -> _shots/online2/.

Lab options (default mode = --lab):
  --secs N        lab match length (default 20)
  --lag MS        +MS one-way on each receive per side (RTT += 2 x MS): exercises rollback over the real DataChannel
  --quick         pair through quick match (ffg-lobby:hit-parade) instead of a room code
  --rematch N     accept N rematches (new commit-reveal select + seed, match epoch + 1 each)
  --again         after both LEAVE, the same OnlineFlow object runs a second session (game.ts keeps one Online)
  --killrtc S     B closes its DataChannels S s into the match -> 5 s silence -> host claims the relay slot -> both
                  continue on the relay (spends relay events for the rest of the match)
  --drop-b-at S   B's browser closes S s into the match -> A wins by disconnect after the 5 s presence grace
  --relay         force the 10 Hz relay tier (keep it short: 40 events/s of the project's shared 100/s)
  --headed --no-mdns (Chrome flag exposing raw host candidates) --url http://localhost:5325
Supabase budget per lab run on the direct path: <= 40 messages per side is enforced (measured 7-9: presence, HELLO,
~3 signalling batches, path/final); the inputs never touch Supabase. The relay path adds 10/s per side.

Exit 0 = PASS, 1 = FAIL. Report -> _harness/_reports/online2_lab[_variant].json (or online2_game.json).
"""
import argparse
import json
import math
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(ROOT, "_harness", "_reports")
PORT = 5325


def port_open(port):
    # vite binds "localhost", which is ::1 only on this Windows/Node 22 setup: try every address it resolves to
    try:
        socket.create_connection(("localhost", port), timeout=0.3).close()
        return True
    except OSError:
        return False


def start_server(port):
    """HP_FROZEN=1 vite on the NET lane port (no HMR). Returns the Popen or None when one is already up."""
    if port_open(port):
        return None
    env = dict(os.environ, HP_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0")
    vite = os.path.join(ROOT, "node_modules", "vite", "bin", "vite.js")
    log = open(os.path.join(REPORTS, "online2_vite.log"), "w", encoding="utf-8")
    proc = subprocess.Popen(["node", vite, "--port", str(port), "--strictPort"], cwd=ROOT, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    for _ in range(120):
        if port_open(port):
            try:
                urllib.request.urlopen("http://localhost:%d/lab/net.html" % port, timeout=5).read()
                return proc
            except Exception:
                pass
        time.sleep(0.25)
    proc.terminate()
    raise RuntimeError("vite did not come up on port %d (see _harness/_reports/online2_vite.log)" % port)


def stop_server(proc):
    if proc is None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def launch(p, headed, no_mdns):
    args = ["--autoplay-policy=no-user-gesture-required"]
    if no_mdns:
        args.append("--disable-features=WebRtcHideLocalIpsWithMdns")
    return p.chromium.launch(headless=not headed, args=args)


def run_lab(opts):
    from playwright.sync_api import sync_playwright
    room = "LAB" + secrets.token_hex(3).upper()
    base = opts.url.rstrip("/")
    extra = ("&relay=1" if opts.relay else "") + ("&nettrace=%d" % opts.nettrace if opts.nettrace else "") + ("&relaypace=%s" % opts.relaypace if opts.relaypace else "") + ("&lag=%d" % opts.lag if opts.lag else "") + ("&rematch=%d" % opts.rematch if opts.rematch else "") + ("&again=1" if opts.again else "")
    if opts.quick:
        q = "quick=1&auto=1&secs=%d%s" % (opts.secs, extra)
    else:
        q = "room=%s&auto=1&secs=%d%s" % (room, opts.secs, extra)
    qb = q + ("&killrtc=%g" % opts.killrtc if opts.killrtc else "")
    mode = "quick" if opts.quick else "room"
    out = {"mode": "lab", "pairing": mode, "room": None if opts.quick else room, "secs": opts.secs, "relay": opts.relay, "lag": opts.lag,
           "killrtc": opts.killrtc, "drop_b_at": opts.drop_b_at, "no_mdns": opts.no_mdns,
           "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "pages": {}}
    errors = {"a": [], "b": []}
    dropped_at = None
    ended_after_drop = None
    with sync_playwright() as p:
        ba = launch(p, opts.headed, opts.no_mdns)
        bb = launch(p, opts.headed, opts.no_mdns)
        out["browser"] = ba.version
        pa = ba.new_page()
        pb = bb.new_page()
        for tag, page in (("a", pa), ("b", pb)):
            page.on("pageerror", lambda e, t=tag: errors[t].append("pageerror: " + str(e)))
            page.on("console", lambda m, t=tag: errors[t].append("console.error: " + m.text) if m.type == "error" else None)
        pa.goto("%s/lab/net.html?%s&tag=a" % (base, q))
        time.sleep(0.4)
        pb.goto("%s/lab/net.html?%s&tag=b" % (base, qb))
        deadline = time.time() + (opts.secs + 30) * (1 + opts.rematch) * (2 if opts.again else 1) + 60
        ra = rb = None
        get = "() => window.__NETLAB__ && JSON.parse(JSON.stringify(window.__NETLAB__))"
        while time.time() < deadline:
            ra = pa.evaluate(get)
            if dropped_at is None:
                rb = pb.evaluate(get)
                if opts.drop_b_at and rb and rb.get("frames", 0) >= opts.drop_b_at * 60:
                    dropped_at = time.time()          # before close(): closing a browser can block for seconds
                    out["b_frames_at_drop"] = rb.get("frames")
                    bb.close()
                    out["b_close_call_s"] = round(time.time() - dropped_at, 2)
            if dropped_at is not None:
                if ra and ra.get("done"):
                    ended_after_drop = round(time.time() - dropped_at, 2)
                    break
            elif ra and rb and ra.get("done") and rb.get("done"):
                break
            time.sleep(0.25)
        time.sleep(0.5)
        out["pages"] = {"a": ra, "b": rb}
        out["log_a"] = pa.evaluate("() => document.getElementById('logtext').textContent")
        if dropped_at is None:
            out["log_b"] = pb.evaluate("() => document.getElementById('logtext').textContent")
            bb.close()
        ba.close()
    out["errors"] = errors
    out["ended_after_drop_s"] = ended_after_drop
    # A's own log: seconds from "peer presence gone" to "matchEnd" (the 5 s grace, measured in the page)
    grace = None
    if opts.drop_b_at and out.get("log_a"):
        t_gone = t_end = None
        for ln in out["log_a"].splitlines():
            parts = ln.split(" ", 1)
            if len(parts) < 2 or not parts[0].endswith("s"):
                continue
            try:
                t = float(parts[0][:-1])
            except ValueError:
                continue
            if parts[1].startswith("peer presence gone") and t_gone is None:
                t_gone = t
            if parts[1].startswith("matchEnd") and t_end is None:
                t_end = t
        if t_gone is not None and t_end is not None:
            grace = round(t_end - t_gone, 2)
    out["grace_s"] = grace
    # Supabase budget guard: on the direct path only lobby/room/HELLO/signalling/control ride Supabase.
    relayish = opts.relay or bool(opts.killrtc)
    sb_budget = 40 if not relayish else 40 + 11 * (opts.secs + 10)
    sb_used = [((r or {}).get("supabase") or {}).get("msgs", 0) + ((r or {}).get("supabase") or {}).get("binary", 0) for r in (ra, rb)]
    out["supabase_budget_per_side"] = sb_budget
    out["supabase_used"] = sb_used
    page_errors = [e for e in errors["a"] + errors["b"] if "pageerror" in e]
    if opts.drop_b_at:
        ok = bool(ra and ra.get("done") and ra.get("reason") == "disconnect" and ended_after_drop is not None
                  and grace is not None and 4.9 <= grace <= 6.5 and ended_after_drop <= 20 and not page_errors)
    else:
        ok = bool(ra and rb and ra.get("done") and rb.get("done") and ra.get("ok") and rb.get("ok")
                  and ra.get("finalCs") is not None and ra.get("finalCs") == rb.get("finalCs")
                  and ra.get("desyncs") == 0 and rb.get("desyncs") == 0
                  and max(sb_used) <= sb_budget and not page_errors)
        if opts.killrtc:
            ok = ok and ra.get("transport") == "relay" and rb.get("transport") == "relay"
        if opts.again:
            sa, sb2 = ra.get("sessions") or [], rb.get("sessions") or []
            ok = ok and len(sa) == len(sb2) == 2 and all(x.get("ok") and y.get("ok") and x.get("finalCs") == y.get("finalCs") for x, y in zip(sa, sb2))
        if opts.rematch:
            ma, mb = ra.get("matches") or [], rb.get("matches") or []
            ok = ok and len(ma) == len(mb) == opts.rematch + 1 and all(
                x.get("agreed") and y.get("agreed") and x.get("finalCs") == y.get("finalCs") and x.get("seed") == y.get("seed")
                for x, y in zip(ma, mb)) and len(set(x.get("seed") for x in ma)) == len(ma)
    if opts.nettrace and ra and rb and ra.get("trace") and rb.get("trace"):
        out["trace_analysis"] = analyze_traces(ra["trace"], rb["trace"])
        print_trace_analysis(out["trace_analysis"])
    out["pass"] = ok
    name = "online2_lab%s%s%s%s%s%s%s%s%s.json" % ("_trace" if opts.nettrace else "", ("_" + opts.relaypace) if opts.relaypace else "", "_again" if opts.again else "", "_rematch" if opts.rematch else "", "_quick" if opts.quick else "", "_relay" if opts.relay else "", "_lag%d" % opts.lag if opts.lag else "",
                                           "_killrtc" if opts.killrtc else "", "_drop" if opts.drop_b_at else "")
    with open(os.path.join(REPORTS, name), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)

    def line(t, r):
        if not r:
            return "%s: no result" % t
        return ("%s: done=%s ok=%s phase=%s reason=%s room=%s transport=%s pair=%s syncRTT=%sms (pings %s) sessionRTT=%sms D=%s frames=%s "
                "speed=%.2f%% stalls=%s rollbacks=%s max=%s desyncs=%s cs@%s=%s agreed=%s supabase=%s errors=%s" % (
                    t, r.get("done"), r.get("ok"), r.get("phase"), r.get("reason"), r.get("room"), r.get("transport"), json.dumps(r.get("pair")),
                    r.get("syncRttMs"), r.get("syncRtts"), r.get("sessionRttMedianMs"), r.get("delay"), r.get("frames"),
                    100.0 * (r.get("gameSpeed") or 0), r.get("stallTicks"), r.get("rollbacks"), r.get("maxRollback"), r.get("desyncs"),
                    r.get("finalCsFrame"), r.get("finalCs"), r.get("agreed"), json.dumps(r.get("supabase")), r.get("errors")))
    print(line("A", ra))
    print(line("B", rb))
    errs = errors["a"] + errors["b"]
    if errs:
        print("browser errors (%d): %s" % (len(errs), " | ".join(errs[:6])))
    if opts.drop_b_at:
        print("%s online2 --lab --drop-b-at %s: A reason=%s winner=local, %s s after B's browser close began; "
              "presence-gone -> matchEnd %s s (grace 5 s)" % (
            "PASS" if ok else "FAIL", opts.drop_b_at, (ra or {}).get("reason"), ended_after_drop, grace))
    else:
        same = (ra or {}).get("finalCs") is not None and (ra or {}).get("finalCs") == (rb or {}).get("finalCs")
        print("%s online2 --lab (%s%s%s) transport=%s/%s final checksum %s; supabase msgs per side %s (budget %d)" % (
            "PASS" if ok else "FAIL", mode, " relay" if opts.relay else "", " killrtc@%gs" % opts.killrtc if opts.killrtc else "",
            (ra or {}).get("transport"), (rb or {}).get("transport"),
            "identical" if same else "%s vs %s" % ((ra or {}).get("finalCs"), (rb or {}).get("finalCs")), sb_used, sb_budget))
    return 0 if ok else 1


def _pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, int(-(-p * len(xs) // 100)) - 1))]


def analyze_traces(ta, tb):
    """Line up two browsers' session traces (?nettrace=N) on the shared epoch clock (both Chromes run on this machine:
    performance.timeOrigin + t). Per direction: sender encode -> relay flush (hold) -> receiver arrival (network), the
    input age at arrival, and when the stall ticks happened (seconds after each side's start)."""
    out = {}
    for src, dst, tag in ((ta, tb, "a->b"), (tb, ta, "b->a")):
        so, do = src.get("timeOrigin", 0), dst.get("timeOrigin", 0)
        ss, ds = src.get("session") or {}, dst.get("session") or {}
        sent = {r[1]: r for r in ss.get("sent", [])}
        flush = {r[1]: r for r in src.get("relayFlush", [])}
        hold, net, total, age = [], [], [], []
        for r in ds.get("recv", []):
            seq, at, newest, lf = r[1], r[0], r[2], r[3]
            s0 = sent.get(seq)
            if not s0:
                continue
            enc = so + s0[0]
            arr = do + at
            f = flush.get(seq)
            if f:
                hold.append(round(f[2], 1))
                net.append(round(arr - (so + f[0]), 1))
            total.append(round(arr - enc, 1))
            age.append(lf - newest)
        stats = lambda xs: None if not xs else {"n": len(xs), "p50": _pct(xs, 50), "p90": _pct(xs, 90), "p99": _pct(xs, 99), "max": max(xs),
                                                   "mean": round(sum(xs) / len(xs), 1)}
        out[tag] = {"holdMs": stats(hold), "networkMs": stats(net), "encodeToArrivalMs": stats(total), "ageFramesAtArrival": stats(age)}
    for side, t in (("a", ta), ("b", tb)):
        s = t.get("session") or {}
        ticks = s.get("ticks", [])
        st0 = s.get("startedAt", -1)
        kinds = {0: 0, 1: 0, 2: 0, 3: 0}
        buckets = {}
        for r in ticks:
            kinds[r[4]] = kinds.get(r[4], 0) + 1
            if r[4] in (1, 2) and st0 >= 0:
                sec = int((r[0] - st0) // 1000)
                buckets[sec] = buckets.get(sec, 0) + 1
        out["stalls_" + side] = {"advanced": kinds[0], "stalled": kinds[1], "skipped": kinds[2], "waiting": kinds[3],
                                 "stallOrSkipTicksPerSecond": dict(sorted(buckets.items()))}
    return out


def print_trace_analysis(an):
    for tag in ("a->b", "b->a"):
        d = an.get(tag) or {}
        print("trace %s: hold %s | network %s | encode->arrival %s | input age at arrival (frames) %s" % (
            tag, json.dumps(d.get("holdMs")), json.dumps(d.get("networkMs")), json.dumps(d.get("encodeToArrivalMs")), json.dumps(d.get("ageFramesAtArrival"))))
    for side in ("a", "b"):
        print("trace stalls %s: %s" % (side, json.dumps(an.get("stalls_" + side))))


# ─────────────────────────────── --game: the REAL game in two Chromes ───────────────────────────────
# P1 keyboard set (runtime/src/input.ts DEFAULT_KEYS; common.P1_KEYS). Online, BOTH peers play with these keys (game.ts
# feeds word 0 = this screen's player-1 controls to the session).
GK = {"up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD", "l": "KeyJ", "m": "KeyK", "h": "KeyL", "s": "KeyI", "pause": "Escape",
      "stepin": "KeyQ", "stepout": "KeyE"}   # CHANGED(integrator) 3D: STEP IN / STEP OUT (CONTRACT §35.2)


def g_step_kind(fs):
    """CHANGED(integrator) 3D: a FighterSnap's step kind ('none' | 'sidestep' | 'sidewalk' | 'settle')"""
    st = (fs or {}).get("step") or {}
    return st.get("kind") or "none"


def g_step_check(checks, label, rep, bots):
    """CHANGED(integrator) 3D: both peers' players stepped by real keys AND each peer's sim showed the OTHER peer's fighter
    in a SIDESTEP / SIDEWALK (its STEP bits reached this peer only over the rollback session); the agreement gates (same
    winner, identical checksums, 0 desyncs) then prove both sims agreed with them"""
    rep["steps"] = {"taps": [b.step_taps for b in bots], "localStepSamples": [b.local_step_samples for b in bots],
                    "remoteStepSamples": [b.remote_step_samples for b in bots],
                    # CHANGED(wf6 fixer) VO-D8: held circle-walks and the SIDEWALK frames each peer saw
                    "circles": [getattr(b, "circles", 0) for b in bots], "localWalkSamples": [getattr(b, "local_walk_samples", 0) for b in bots],
                    "remoteWalkSamples": [getattr(b, "remote_walk_samples", 0) for b in bots]}
    checks.append((label + ": STEP over rollback (each peer saw the remote fighter sidestep / circle)",
                   all(x > 0 for x in rep["steps"]["taps"]) and all(x > 0 for x in rep["steps"]["remoteStepSamples"]), json.dumps(rep["steps"])))
    # CHANGED(wf7 online) VO-D8: per peer now - BOTH players circle-walked (>= 2 held STEPs each) and BOTH peers saw the
    # other's fighter SIDEWALK (was: the sums over both peers > 0)
    checks.append((label + ": circle-walk over rollback (both players held STEP >= 2x; each peer saw the remote fighter SIDEWALK)",
                   all(x >= 2 for x in rep["steps"]["circles"]) and all(x > 0 for x in rep["steps"]["remoteWalkSamples"]),
                   "circles %s, local sidewalk samples %s, remote sidewalk samples %s" % (rep["steps"]["circles"], rep["steps"]["localWalkSamples"],
                                                                                       rep["steps"]["remoteWalkSamples"])))
GAME_PORTS = (5325, 5330)   # CHANGED(wf6 fixer) VO-D8: --ports A,B overrides (a verifier's / fixer's own dev servers)

READ_TICK = """() => { try { const h = window.__HP__; if (!h) return null; const st = h.state(); const n = h.net();
  return { phase: st.phase, screen: st.screen, f: h.fighters(), m: h.match ? h.match() : null,
           local: n && n.online ? n.online.local : null, online: n && n.online ? n.online.phase : null }; } catch (e) { return { err: String(e) }; } }"""


_T0 = [time.time()]


def glog(m):
    print("[%6.1fs] %s" % (time.time() - _T0[0], m), flush=True)


class GSide:
    """one real Chrome process (its own browser, its own dev-server origin = its own localStorage) playing by real keys"""

    def __init__(self, tag, browser, base, query, out_dir, C):
        self.tag, self.base, self.query, self.out, self.C = tag, base.rstrip("/"), query, out_dir, C
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        self.ctx.add_init_script(C.INIT_JS)
        self.console, self.page_errors, self.held, self.notes = [], [], set(), []
        self.shots = []
        self.page = None
        self.pages_opened = 0
        self._new_page()

    def _new_page(self):
        """CHANGED(wf7 online): a page of this side's context (same origin + localStorage); console / errors keep accumulating"""
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(30000)
        self.page.on("console", lambda m: self.console.append((m.type, m.text)))
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.held = set()
        self.pages_opened += 1

    def close_tab(self):
        """CHANGED(wf7 online): the player closes the game's tab (no BYE: the flow's disconnect rule applies); returns the close time"""
        t = time.time()
        try:
            self.page.close(run_before_unload=False)
        except Exception as e:
            self.notes.append("close_tab: %s" % str(e).splitlines()[0])
        self.held = set()
        return t

    def reopen(self):
        """CHANGED(wf7 online): a fresh tab for the next scenario after close_tab()"""
        try:
            if self.page and not self.page.is_closed():
                self.page.close()
        except Exception:
            pass
        self._new_page()

    def gotrue_warnings(self):
        """CHANGED(wf7 online) VO-D7: supabase-js 'Multiple GoTrueClient instances detected' console lines seen on this side"""
        return [t for (k, t) in self.console if "GoTrueClient" in t and "Multiple" in t]

    def goto(self, extra=""):
        self.page.goto("%s/?%s%s" % (self.base, self.query, extra), wait_until="load", timeout=120000)

    def js(self, expr, arg=None, default=None):
        try:
            return self.page.evaluate(expr) if arg is None else self.page.evaluate(expr, arg)
        except Exception:
            return default

    def state(self):
        return self.js("() => window.__HP__ ? __HP__.state() : null") or {}

    def menus(self):
        return self.js("() => window.__HP__ && __HP__.menus ? __HP__.menus() : null") or {}

    def net(self):
        return self.js("() => window.__HP__ ? JSON.parse(JSON.stringify(__HP__.net())) : null")

    def online(self):
        n = self.net() or {}
        return n.get("online") or {}

    def match(self):
        return self.js("() => window.__HP__ ? __HP__.match() : null") or {}

    def perf(self):
        p = self.js("() => { const p = window.__HP__ ? __HP__.perf() : null; return p ? { fps: p.frame && p.frame.fps, p99: p.frame && p.frame.p99,"
                    " dropped: p.counters && p.counters.dropped, ticks: p.counters && p.counters.ticks } : null; }") or {}
        return {k: (round(v, 1) if isinstance(v, float) else v) for k, v in p.items()}

    def text(self, sel):
        return self.js("(s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }", sel)

    def key(self, k, times=1, gap=0.12, hold_ms=60):
        for _ in range(times):
            self.page.keyboard.down(k)
            time.sleep(hold_ms / 1000.0)
            self.page.keyboard.up(k)
            time.sleep(gap)

    def hold(self, keys):
        keys = set(keys)
        for k in sorted(self.held - keys):
            try:
                self.page.keyboard.up(k)
            except Exception:
                pass
        for k in sorted(keys - self.held):
            try:
                self.page.keyboard.down(k)
            except Exception:
                pass
        self.held = keys

    def release_all(self):
        self.hold(set())

    def wait(self, pred, timeout, poll=0.15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                v = pred()
            except Exception:
                v = None
            if v:
                return v
            time.sleep(poll)
        return None

    def screen(self):
        m = self.menus()
        return m.get("screen") if m.get("visible") else None

    def focus_to(self, target, key="ArrowDown", limit=14):
        for _ in range(limit):
            if self.menus().get("focus") == target:
                return True
            self.key(key, gap=0.08)
        for _ in range(60):
            if self.menus().get("focus") == target:
                return True
            self.key("Tab", gap=0.05)
        return self.menus().get("focus") == target

    def shot(self, name):
        p = os.path.join(self.out, "online2_%s_%s.png" % (self.tag, name))
        try:
            self.page.screenshot(path=p, timeout=20000)
            self.shots.append(p)
            return p
        except Exception as e:
            self.notes.append("screenshot %s failed: %s" % (name, str(e).splitlines()[0]))
            return None

    def diag(self):
        C = self.C
        cerr = [t for (k, t) in self.console if k == "error" and not any(i in t for i in C.CONSOLE_IGNORE)]
        werr = self.js("() => window.__H_ERR__ || []", default=[]) or []
        return {"pageErrors": list(self.page_errors), "consoleErrors": cerr, "windowErrors": werr}


class Checks(list):
    """a check list that also prints each check as it is recorded (progress while a long scenario runs)"""

    def append(self, c):
        glog("%s %s  %s" % ("ok  " if c[1] else "FAIL", c[0], c[2]))
        super().append(c)


def g_boot_to_online(s, checks, label):
    ok = s.wait(lambda: s.state().get("phase") == "title" and s.screen() == "title", 120)
    checks.append((label + ":%s title" % s.tag, bool(ok), "phase=%s screen=%s" % (s.state().get("phase"), s.screen())))
    s.key("Enter")
    s.wait(lambda: s.screen() == "main", 10)
    s.focus_to("hpm-main-online")
    s.key("Enter")
    ok = s.wait(lambda: s.screen() == "online", 10)
    checks.append((label + ":%s online screen" % s.tag, bool(ok), "screen=%s focus=%s" % (s.screen(), s.menus().get("focus"))))
    return bool(ok)


def g_wait_idle(sides, where, timeout=90, fps=24.0):
    """a freshly booted page renders the whole roster's portraits and warms assets in the background; on this machine
    (several lanes' Chromes on one GPU) that starved a page for 25 s, which pushed ICE past its budget onto the relay.
    Wait until both loops render >= `fps` before pairing (a player reads the menu for a few seconds anyway)."""
    t0 = time.time()
    last = {}
    while time.time() - t0 < timeout:
        ok = True
        for s in sides:
            f = s.state().get("fps") or 0
            last[s.tag] = f
            if f < fps:
                ok = False
        if ok and time.time() - t0 >= 4.0:
            break
        time.sleep(0.5)
    glog("%s: pages idle after %.1f s (fps %s)" % (where, time.time() - t0, json.dumps(last)))


def g_in_select(s):
    m = s.menus()
    cs = m.get("cs") or {}
    return m.get("visible") and m.get("screen") == "charselect" and cs.get("mode") == "online"


def g_guard_direct(A, B, checks, label, opts):
    """a non-relay scenario that fell back to the relay (ICE did not open within 5 s - seen on this machine when 3+ other
    lanes' Chromes starve the pages) would stream 40 Supabase events/s for a whole bout: stop both pages instead."""
    oa, ob = A.online(), B.online()
    ta, tb = oa.get("transport"), ob.get("transport")
    if opts.relay or (ta == "rtc" and tb == "rtc"):
        return True
    glog("relay fallback: A recent %s" % json.dumps(oa.get("recent")))
    glog("relay fallback: B recent %s" % json.dumps(ob.get("recent")))
    checks.append((label + ": direct path (no relay fallback)", False,
                   "transport A %s / B %s - scenario stopped here to keep Supabase traffic small (relay = 40 events/s)" % (ta, tb)))
    for s in (A, B):
        try:
            s.page.goto("about:blank")
        except Exception:
            pass
    return False


def g_cursor(s):
    """P1's character-select cursor (slot id) from the menus readback"""
    return (((s.menus().get("cs") or {}).get("p") or [{}])[0]).get("cursor")


def g_press_cursor(s, key, cur, trail):
    """one real arrow press; waits (<= 2 s: a starved page handles keys late) until the cursor left `cur`"""
    s.key(key, gap=0.05)
    s.wait(lambda: g_cursor(s) != cur, 2.0, 0.05)
    nxt = g_cursor(s)
    trail.append("%s>%s" % (key.replace("Arrow", "")[0], nxt))
    return nxt


NAV_DIRECT = True     # CHANGED(wf7 online): g_nav tries the layout path first (--pick-test also runs the scan alone)


def g_grid_pos(slots):
    """(col, row) per slot id as ui/charselect.ts buildGrid lays them out from the readback's slot order: 'random' (col 0,
    both rows - its own row 0), the regulars 1 + k % perRow / k // perRow (perRow = ceil(n / 2)), then <= 2 bosses in the
    last column (rows 0, 1). Bosses = the slots after the regulars (readback order: random, regulars, bosses)."""
    ids = [x for x in slots if x != "random"]
    bosses = [x for x in ids if x in ("freak", "ricky")]
    regular = [x for x in ids if x not in bosses]
    per = max(1, -(-len(regular) // 2))
    pos = {"random": (0, 0)}
    for k, fid in enumerate(regular):
        pos[fid] = (1 + k % per, k // per)
    for k, fid in enumerate(bosses[:2]):
        pos[fid] = (1 + per, k)
    return pos


def g_nav_direct(s, fighter, cur, trail):
    """CHANGED(wf7 online): the short path from the grid layout - RANDOM: Left to column 0; else off RANDOM with one Right,
    DOWN / UP to the target row (never on RANDOM), then Left / Right along that row without crossing column 0 (RANDOM would
    reset the row). Each press is checked against the readback; the caller falls back to the scan when it does not land."""
    slots = (s.menus().get("cs") or {}).get("slots") or []
    pos = g_grid_pos(slots)
    if fighter not in pos or cur not in pos:
        return cur
    if fighter == "random":
        for _ in range(8):
            if cur in ("random", None):
                break
            cur = g_press_cursor(s, "ArrowLeft", cur, trail)
        return cur
    if cur == "random":
        cur = g_press_cursor(s, "ArrowRight", cur, trail)
        if cur not in pos:
            return cur
    tc, tr = pos[fighter]
    cc, cr = pos[cur]
    if tr != cr:
        cur = g_press_cursor(s, "ArrowDown" if tr > cr else "ArrowUp", cur, trail)
        if cur not in pos:
            return cur
        cc, cr = pos[cur]
    for _ in range(8):
        if cur == fighter or cur not in pos:
            break
        cc, cr = pos[cur]
        if cc == tc:
            break
        cur = g_press_cursor(s, "ArrowRight" if tc > cc else "ArrowLeft", cur, trail)
    return cur


def g_nav(s, fighter, trail=None):
    """CHANGED(wf7 online) VO-D8: walk P1's cursor to `fighter` by real arrow presses over the real grid (ui/charselect.ts
    buildGrid / moveCursor): RANDOM in column 0 spans BOTH rows (its own row is 0), the regulars fill the next columns 5 per
    row, the bosses sit in the last column; ArrowRight wraps inside a row, RANDOM always exits to row 0, ArrowDown on RANDOM
    does nothing. The wf6 picker pressed ArrowDown once a row had cycled - from RANDOM that press is lost and it could loop on
    row 0. Now: first the layout path (g_nav_direct, <= 7 presses); if the cursor did not land, the scan - the current row
    rightwards until the fighter or RANDOM; from RANDOM row 0; from RANDOM again right once (row 0, first column) and DOWN
    (row 1) and row 1 - which reaches every slot in <= 25 presses whatever the layout. Returns the cursor (the caller checks
    it is `fighter`)."""
    trail = [] if trail is None else trail
    cur = g_cursor(s)
    trail.append("start %s" % cur)
    if cur == fighter:
        return cur
    if NAV_DIRECT:
        cur = g_nav_direct(s, fighter, cur, trail)       # <= 7 presses when the grid is the one buildGrid lays out
        if cur == fighter:
            return cur
    trail.append("| scan")
    for _ in range(9):                                   # pass 1: the current row, rightwards, until RANDOM
        if cur in (fighter, "random") or cur is None:
            break
        cur = g_press_cursor(s, "ArrowRight", cur, trail)
    for row in (0, 1):                                   # pass 2: row 0; pass 3: row 1
        if cur == fighter or cur is None:
            break
        cur = g_press_cursor(s, "ArrowRight", cur, trail)    # RANDOM -> row 0, first regular column
        if row == 1:
            cur = g_press_cursor(s, "ArrowDown", cur, trail)
        for _ in range(9):
            if cur in (fighter, "random") or cur is None:
                break
            cur = g_press_cursor(s, "ArrowRight", cur, trail)
    return cur


def g_pick(s, fighter):
    """move P1's cursor to `fighter` (g_nav) then Enter x3 (fighter, colour, controls = SIMPLE). The returned cursor is what
    the caller's pick check compares - a fighter the picker could not reach FAILS that check (and is still confirmed so the
    blind select's 30 s timer does not decide the scenario)."""
    time.sleep(0.6)
    trail = []
    cur = g_nav(s, fighter, trail)
    s.notes.append("pick %s: %s" % (fighter, " ".join(trail)))
    if cur != fighter:
        glog("PICKER %s: wanted %s, cursor %s (%s)" % (s.tag, fighter, cur, " ".join(trail)))
    s.key("Enter", 3, gap=0.25)
    return cur


def g_wait_fight(sides, timeout):
    def ok():
        for s in sides:
            r = s.js(READ_TICK) or {}
            if r.get("phase") != "bout" or not r.get("m") or (r["m"].get("phase") not in ("intro", "fight")):
                return None
        return True
    return bool(sides[0].wait(ok, timeout, 0.25))


class Bot:
    """real-key fighter: walks in and attacks; 'rush' presses a heavy-leaning string, 'mixed' blocks some of the time."""

    def __init__(self, style, seed):
        import random
        self.style, self.r = style, random.Random(seed)
        self.release_next = False
        self.block_left = 0
        self.i = 0
        self.presses = 0
        # CHANGED(integrator) 3D: STEP taps by real Q / E keys, and how often THIS peer's sim showed the REMOTE fighter
        # (the other peer's player) / its own fighter in a SIDESTEP / SIDEWALK
        self.step_taps = 0
        self.remote_step_samples = 0
        self.local_step_samples = 0
        # CHANGED(wf6 fixer) VO-D8: circle-walks = STEP HELD for a number of SIM frames (poll counts were 4-10 frames on a
        # starved machine, under the 15 f sidestep: the bot never circle-walked)
        self.circle_until = -1
        self.circle_key = None
        self.circles = 0
        self.last_circle_end = -10 ** 9
        self.circle_gap = 150
        self.local_walk_samples = 0
        self.remote_walk_samples = 0

    def step(self, s, info):
        f, loc = info.get("f"), info.get("local")
        m = info.get("m") or {}
        if not f or loc not in (0, 1) or m.get("phase") != "fight":
            s.hold(set())
            return
        me, op = f[loc], f[1 - loc]
        # CHANGED(integrator) 3D: forward = the player's SCREEN side sign (FighterSnap.facing, the sim's LEFT / RIGHT mapping
        # under camN); the gap is planar (x, z) - the x order means nothing once the pair has circled
        fc = me.get("facing")
        fc = fc if fc in (-1, 1) else (1 if op["x"] >= me["x"] else -1)
        fwd = GK["right"] if fc >= 0 else GK["left"]
        back = GK["left"] if fwd == GK["right"] else GK["right"]
        gap = math.hypot(op["x"] - me["x"], (op.get("z") or 0.0) - (me.get("z") or 0.0))
        if g_step_kind(op) in ("sidestep", "sidewalk"):
            self.remote_step_samples += 1
        if g_step_kind(me) in ("sidestep", "sidewalk"):
            self.local_step_samples += 1
        if g_step_kind(me) == "sidewalk":
            self.local_walk_samples += 1
        if g_step_kind(op) == "sidewalk":
            self.remote_walk_samples += 1
        if self.release_next:                                   # attack keys up (a held button never re-triggers)
            self.release_next = False
            s.hold({k for k in s.held if k in (GK["right"], GK["left"], GK["down"])})
            return
        if self.block_left > 0:
            self.block_left -= 1
            s.hold({back})
            return
        reach = 1.15 if self.style == "rush" else 1.5
        # CHANGED(wf6 fixer) VO-D8: a running circle-walk holds STEP until its sim frame; a new one now and then from neutral
        fr = m.get("frame") if isinstance(m.get("frame"), (int, float)) else None
        if self.circle_until >= 0:
            if fr is not None and fr < self.circle_until:
                s.hold({self.circle_key})
                return
            self.circle_until = -1
            s.hold(set())
            return
        # CHANGED(wf7 online) VO-D8: + a sim-frame cadence - a neutral bot that has not circled for 150-260 sim frames starts
        # one (a 3 % per-poll chance alone gave 3-5 circles per bout on a starved machine)
        neutral = (me.get("stateName") or "") in ("idle", "walk_f", "walk_b")
        due = fr is not None and fr - self.last_circle_end >= self.circle_gap
        if fr is not None and neutral and 0.8 < gap < 3.2 and (due or self.r.random() < 0.03):
            self.circle_key = GK["stepin"] if self.circles % 2 == 0 else GK["stepout"]
            self.circle_until = fr + self.r.randint(45, 120)
            self.last_circle_end = self.circle_until
            self.circle_gap = self.r.randint(150, 260)
            self.circles += 1
            s.hold({self.circle_key})
            return
        # CHANGED(integrator) 3D: now and then a sidestep tap (STEP IN / OUT alternate) from neutral range
        if 0.9 < gap < 2.6 and self.r.random() < 0.08 and (me.get("stateName") or "") in ("idle", "walk_f", "walk_b"):
            s.hold({GK["stepin"] if self.step_taps % 2 == 0 else GK["stepout"]})
            self.step_taps += 1
            self.release_next = True
            return
        if gap > reach:
            s.hold({fwd})
            return
        self.i += 1
        if self.style == "mixed" and self.r.random() < 0.28:
            self.block_left = self.r.randint(2, 5)
            s.hold({back})
            return
        if self.style == "rush":
            seq = [(GK["h"],), (GK["m"],), (GK["s"], fwd), (GK["l"],), (GK["h"], GK["down"]), (GK["s"],)]
        else:
            seq = [(GK["m"],), (GK["l"],), (GK["h"],), (GK["s"], fwd), (GK["m"], GK["down"])]
        keys = set(seq[self.i % len(seq)])
        s.hold(keys)
        self.presses += 1
        self.release_next = True


def g_play(sides, bots, timeout, stop_after=None):
    """drive both sides by real keys until both show results (or `stop_after` s of fight have passed); returns timeline"""
    t0 = time.time()
    fight_t0 = None
    timeline = []
    last = 0
    while time.time() - t0 < timeout:
        infos = [s.js(READ_TICK) or {} for s in sides]
        if all(i.get("phase") == "results" for i in infos):
            break
        if any(i.get("phase") == "error" for i in infos):
            break
        for s, b, i in zip(sides, bots, infos):
            if i.get("phase") in ("bout", "paused"):
                b.step(s, i)
            else:
                s.hold(set())
        if fight_t0 is None and all(((i.get("m") or {}).get("phase") == "fight") for i in infos):
            fight_t0 = time.time()
        if stop_after is not None and fight_t0 is not None and time.time() - fight_t0 >= stop_after:
            break
        if time.time() - last >= 2.0:
            last = time.time()
            row = {"t": round(time.time() - t0, 1)}
            for s, i in zip(sides, infos):
                n = s.net() or {}
                m = i.get("m") or {}
                pf = s.perf()
                row[s.tag] = {"phase": i.get("phase"), "round": m.get("round"), "wins": m.get("wins"), "frame": n.get("frame"),
                              "hp": [x.get("hp") for x in (i.get("f") or [])], "depth": n.get("depth"), "rb": n.get("rollbacks"),
                              "stall": n.get("stallTicks"), "rtt": n.get("rttMedianMs"), "wall": n.get("wallSpeed") and round(n.get("wallSpeed"), 3),
                              "fps": pf.get("fps"), "p99": pf.get("p99"), "dropped": pf.get("dropped")}
            timeline.append(row)
            glog("bout %s" % json.dumps(row))
    for s in sides:
        s.release_all()
    return timeline


SESSION_KEYS = ("transport", "status", "frame", "confirmed", "delay", "window", "rttMs", "rttMedianMs", "rollbacks", "rollbackFrames",
                "maxRollback", "stallTicks", "skipTicks", "ticks", "gameSpeed", "wallSpeed", "sent", "recv", "lossPct", "reordered",
                "desyncs", "checksumsCompared", "violations", "rejected", "stale")


def g_netsum(n):
    n = n or {}
    o = n.get("online") or {}
    out = {k: n.get(k) for k in SESSION_KEYS if k in n}
    for k in ("gameSpeed", "wallSpeed"):
        if isinstance(out.get(k), float):
            out[k] = round(out[k], 4)
    out["online"] = {k: o.get(k) for k in ("phase", "room", "local", "matchIndex", "transport", "rttMs", "delay", "pair", "signedIn", "peerSignedIn",
                                           "supabase", "relay", "lastMatch", "result", "endReason", "endCode", "recent")}
    return out


def g_bout_checks(checks, label, a, b, na, nb):
    """the agreement gates for one finished bout"""
    oa, ob = (na or {}).get("online") or {}, (nb or {}).get("online") or {}
    la, lb = oa.get("lastMatch") or {}, ob.get("lastMatch") or {}
    ra, rb = (oa.get("result") or {}), (ob.get("result") or {})
    ma, mb = ra.get("mine") or {}, rb.get("mine") or {}
    checks.append((label + ": both agreed", la.get("agreed") is True and lb.get("agreed") is True, "A %s / B %s" % (la.get("agreed"), lb.get("agreed"))))
    checks.append((label + ": same winner", la.get("winner") == lb.get("winner") and la.get("winner") in (0, 1),
                   "A %s / B %s" % (la.get("winner"), lb.get("winner"))))
    same_cs = ma.get("cs") is not None and ma.get("cs") == mb.get("cs") and ma.get("csFrame") == mb.get("csFrame") and ma.get("frame") == mb.get("frame")
    checks.append((label + ": identical final checksums", same_cs,
                   "A cs@%s=%s (MATCH_END frame %s) / B cs@%s=%s (frame %s)" % (ma.get("csFrame"), ma.get("cs"), ma.get("frame"), mb.get("csFrame"), mb.get("cs"), mb.get("frame"))))
    for s, n in ((a, na), (b, nb)):
        n = n or {}
        checks.append((label + ":%s 0 desyncs / 0 violations" % s.tag, (n.get("desyncs") or 0) == 0 and (n.get("violations") or 0) == 0,
                       "desyncs=%s violations=%s" % (n.get("desyncs"), n.get("violations"))))


def g_perf_delta(p0, p1):
    """the local loop over the bout: ticks it ran, ticks it DROPPED (MAX_STEPS_PER_FRAME guard: a slow page runs the sim slower
    than real time - local perf, not the network), fps at the end"""
    out = {}
    for tag, a, b in (("a", p0[0], p1[0]), ("b", p0[1], p1[1])):
        t = (b.get("ticks") or 0) - (a.get("ticks") or 0)
        d = (b.get("dropped") or 0) - (a.get("dropped") or 0)
        out[tag] = {"ticks": t, "dropped": d, "droppedPct": round(100.0 * d / (t + d), 2) if t + d > 0 else None, "fpsEnd": b.get("fps"), "p99End": b.get("p99")}
    return out


def g_results_ui(s):
    return {"screen": s.screen(), "how": s.text(".hpm-res-how"), "name": s.text(".hpm-res-name"), "note": s.text(".hpm-res-note"),
            "stamp": s.js("() => { const e = document.querySelector('.hpm-res-stamp'); return e ? e.dataset.side || null : null; }"),
            "buttons": s.js("() => Array.from(document.querySelectorAll('[id^=hpm-res-]')).filter((b) => b.tagName === 'BUTTON').map((b) => b.id)"),
            "focus": s.menus().get("focus")}


def scen_quick(A, B, opts, out):
    """QUICK MATCH -> blind select -> full best-of-3 by real keys -> agreement -> REMATCH (both) -> second select -> bout ->
    A's pause card (peer keeps advancing) -> RESUME -> A's tab closes mid-round -> B wins by disconnect after the grace ->
    B's REMATCH -> B on the ONLINE lobby (CHANGED(wf7 online): the forfeit tail moved to scen_forfeit)"""
    checks, rep = Checks(), {"name": "quick"}
    for s in (A, B):
        s.goto()
    if not (g_boot_to_online(A, checks, "quick") and g_boot_to_online(B, checks, "quick")):
        return checks, rep
    g_wait_idle([A, B], "quick")
    A.focus_to("hpm-on-quick")
    A.key("Enter")
    time.sleep(0.3)
    B.focus_to("hpm-on-quick")
    B.key("Enter")
    t0 = time.time()
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 120, 0.25)
    rep["pair_to_select_s"] = round(time.time() - t0, 1)
    checks.append(("quick: both reach the blind select", bool(ok), "A %s / B %s after %.1f s" % (A.screen(), B.screen(), time.time() - t0)))
    if not ok:
        rep["a"], rep["b"] = g_netsum(A.net()), g_netsum(B.net())
        return checks, rep
    oa, ob = A.online(), B.online()
    rep["room"] = oa.get("room")
    checks.append(("quick: same room, slots 0/1", oa.get("room") == ob.get("room") and {oa.get("local"), ob.get("local")} == {0, 1},
                   "room %s/%s local %s/%s transport %s/%s" % (oa.get("room"), ob.get("room"), oa.get("local"), ob.get("local"), oa.get("transport"), ob.get("transport"))))
    A.shot("quick_select")
    if not g_guard_direct(A, B, checks, "quick", opts):
        return checks, rep
    ca, cb = g_pick(A, opts.fa), g_pick(B, opts.fb)
    checks.append(("quick: picks by real keys", ca == opts.fa and cb == opts.fb, "A cursor %s / B cursor %s" % (ca, cb)))
    time.sleep(0.5)
    B.shot("quick_select_locked")
    ok = g_wait_fight([A, B], 150)
    checks.append(("quick: bout starts on both", ok, "A %s / B %s" % ((A.js(READ_TICK) or {}).get("phase"), (B.js(READ_TICK) or {}).get("phase"))))
    if not ok:
        return checks, rep
    ma, mb = A.match(), B.match()
    checks.append(("quick: same match cfg on both (seed, stage, fighters)", ma.get("seed") == mb.get("seed") and ma.get("stage") == mb.get("stage")
                   and [p.get("fighter") for p in ma.get("p") or []] == [p.get("fighter") for p in mb.get("p") or []],
                   "seed %s/%s stage %s/%s p %s/%s" % (ma.get("seed"), mb.get("seed"), ma.get("stage"), mb.get("stage"),
                                                       [p.get("fighter") for p in ma.get("p") or []], [p.get("fighter") for p in mb.get("p") or []])))
    bots = [Bot("rush", 11), Bot("mixed", 23)]
    t0 = time.time()
    shots_taken = [False]

    pf0 = [A.perf(), B.perf()]
    rep["timeline"] = g_play([A, B], bots, opts.bout_timeout)
    rep["bout_s"] = round(time.time() - t0, 1)
    rep["presses"] = [bots[0].presses, bots[1].presses]
    g_step_check(checks, rep["name"], rep, bots)
    na, nb = A.net(), B.net()
    rep["a"], rep["b"] = g_netsum(na), g_netsum(nb)
    rep["perf"] = g_perf_delta(pf0, [A.perf(), B.perf()])
    rep["match_a"], rep["match_b"] = A.match(), B.match()
    fin = A.state().get("phase") == "results" and B.state().get("phase") == "results"
    checks.append(("quick: both reach results", fin, "A %s / B %s after %.1f s" % (A.state().get("phase"), B.state().get("phase"), time.time() - t0)))
    g_bout_checks(checks, "quick", A, B, na, nb)
    mA, mB = rep["match_a"] or {}, rep["match_b"] or {}
    checks.append(("quick: best-of-3 decided (a side has 2 round wins)", max((mA.get("wins") or [0, 0])) == 2 and mA.get("wins") == mB.get("wins"),
                   "wins A %s / B %s" % (mA.get("wins"), mB.get("wins"))))
    time.sleep(0.8)
    rep["results_ui"] = {"a": g_results_ui(A), "b": g_results_ui(B)}
    A.shot("quick_results")
    B.shot("quick_results")
    if not fin:
        return checks, rep
    # ---- REMATCH (both) -> a second blind select -> bout -> A forfeits
    A.key("Enter")
    time.sleep(0.4)
    B.key("Enter")
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 40, 0.25)
    checks.append(("quick: REMATCH (both) opens a second blind select", bool(ok), "A %s / B %s; A matchIndex %s" % (A.screen(), B.screen(), A.online().get("matchIndex"))))
    if not ok:
        return checks, rep
    g_pick(A, opts.fa)
    g_pick(B, opts.fb)
    ok = g_wait_fight([A, B], 120)
    checks.append(("quick: rematch bout starts", ok, "seed %s/%s" % (A.match().get("seed"), B.match().get("seed"))))
    if not ok:
        return checks, rep
    checks.append(("quick: rematch has a new seed", A.match().get("seed") != mA.get("seed") and A.match().get("seed") == B.match().get("seed"),
                   "first %s -> rematch %s/%s" % (mA.get("seed"), A.match().get("seed"), B.match().get("seed"))))
    g_play([A, B], [Bot("rush", 5), Bot("mixed", 7)], 60, stop_after=4.0)
    A.key(GK["pause"])
    okp = A.wait(lambda: A.screen() == "pause", 6)
    g_pause_check(A, B, okp, checks, "quick", rep)
    A.shot("quick_pause")
    # CHANGED(wf7 online): RESUME, a few more seconds of the round, then A's tab closes mid-round -> B wins after the grace
    A.focus_to("hpm-p-resume")
    A.key("Enter")
    okr = A.wait(lambda: A.state().get("phase") == "bout" and not A.menus().get("visible"), 6)
    checks.append(("quick: RESUME from the online pause card", bool(okr), "A phase %s screen %s" % (A.state().get("phase"), A.screen())))
    g_play([A, B], [Bot("rush", 9), Bot("mixed", 13)], 40, stop_after=3.0)
    g_leave_mid_round(A, B, checks, "quick", rep)
    rep["supabase"] = {"a": rep.get("supabase_leaver") or {}, "b": (B.online().get("supabase") or {})}
    return checks, rep


def g_pause_check(A, B, okp, checks, label, rep):
    """CHANGED(wf7 online): A's pause card is up; an online bout keeps running. Over 2 s: both sessions advance and B gets
    MORE than 2 x W frames ahead of where it was - a pausing A that stopped ticking would hold B to <= W (8) frames (the
    rollback window), so the gate is the semantic one. The rate is reported, not gated: it is the machine's speed (the wf7
    run measured 27 frames/s on this starved machine against a > 30 per second gate, a false FAIL)."""
    na0, nb0, t0 = A.net() or {}, B.net() or {}, time.time()
    time.sleep(2.0)
    na1, nb1, t1 = A.net() or {}, B.net() or {}, time.time()
    fa = [na0.get("frame"), na1.get("frame")]
    fb = [nb0.get("frame"), nb1.get("frame")]
    ints = all(isinstance(x, int) for x in fa + fb)
    win = nb1.get("window") or 8
    db = fb[1] - fb[0] if ints else None
    da = fa[1] - fa[0] if ints else None
    rep["pause"] = {"aFrames": fa, "bFrames": fb, "secs": round(t1 - t0, 2), "bStalls": [nb0.get("stallTicks"), nb1.get("stallTicks")],
                    "bWallSpeed": nb1.get("wallSpeed"), "window": win}
    checks.append((label + ": online pause card does not stop the match (both sessions keep advancing past the rollback window)",
                   bool(okp) and ints and da > 0 and db > 2 * win,
                   "A screen %s; over %.1f s A session frame %s -> %s, B %s -> %s (%.0f frames/s; W %s); B stall ticks %s -> %s" % (
                       A.screen(), t1 - t0, fa[0], fa[1], fb[0], fb[1], (db or 0) / max(0.01, t1 - t0), win, nb0.get("stallTicks"), nb1.get("stallTicks"))))


def g_leave_mid_round(leaver, stayer, checks, label, rep):
    """CHANGED(wf7 online): `leaver` closes its tab during a round (no BYE is sent: closing a tab is a disconnect, CONTRACT
    §10). The stayer's session runs out of remote inputs (stalls), its flow sees the peer's presence leave, and after the 5 s
    grace (presence gone AND inputs silent >= 1 s) the stayer wins by disconnect; its REMATCH has nobody to rematch -> the
    ONLINE lobby 'opponent left'. The leaver's tab is reopened for the next scenario."""
    pre = stayer.js(READ_TICK) or {}
    m = pre.get("m") or {}
    ns = stayer.net() or {}
    rep["supabase_leaver"] = leaver.online().get("supabase") or {}
    rep["leave"] = {"leaver": leaver.tag, "round": m.get("round"), "matchPhase": m.get("phase"), "timer": m.get("timer"),
                    "stayerFrame": ns.get("frame"), "stayerLocal": stayer.online().get("local")}
    t0 = leaver.close_tab()
    fr = []
    ok = None
    while time.time() - t0 < 40:
        st = stayer.state().get("phase")
        if st == "results":
            ok = True
            break
        n = stayer.net() or {}
        fr.append((round(time.time() - t0, 1), n.get("frame")))
        time.sleep(0.25)
    dt = round(time.time() - t0, 2)
    o = stayer.online()
    lm = o.get("lastMatch") or {}
    t_gone = t_res = None
    for ln in o.get("recent") or []:
        parts = str(ln).split(" ", 1)
        if len(parts) < 2:
            continue
        try:
            t = float(parts[0])
        except ValueError:
            continue
        if parts[1].startswith("peer presence gone") and t_gone is None:
            t_gone = t
        if parts[1].startswith("phase result") and t_gone is not None and t_res is None:
            t_res = t
    grace = round((t_res - t_gone) / 1000.0, 2) if t_gone is not None and t_res is not None else None
    frozen = [f for (_, f) in fr if isinstance(f, int)]
    time.sleep(0.8)
    ui = g_results_ui(stayer)
    rep["leave"].update({"resultsAfterS": dt, "presenceGoneToResultS": grace, "lastMatch": {k: lm.get(k) for k in ("reason", "winner", "agreed", "rated", "rematch")},
                         "stayerFramesAfterClose": [frozen[0], frozen[-1]] if frozen else None, "ui": ui})
    checks.append(("%s: %s's tab closes mid-round -> %s wins by disconnect after the grace" % (label, leaver.tag.upper(), stayer.tag.upper()),
                   bool(ok) and lm.get("reason") == "disconnect" and lm.get("winner") == o.get("local") and m.get("phase") == "fight"
                   and grace is not None and 4.9 <= grace <= 8.0 and dt <= 25,
                   "left in round %s (%s, timer %s); %s results after %.1f s, presence gone -> result %s s (grace 5 s); lastMatch %s; stayer session frame %s -> %s; "
                   "card how %r name %r note %r" % (m.get("round"), m.get("phase"), m.get("timer"), stayer.tag.upper(), dt, grace, rep["leave"]["lastMatch"],
                                                    frozen[0] if frozen else None, frozen[-1] if frozen else None, ui.get("how"), ui.get("name"), ui.get("note"))))
    stayer.shot("%s_disconnect_win" % label)
    stayer.key("Enter")
    okl = stayer.wait(lambda: stayer.screen() == "online", 12)
    time.sleep(0.5)
    st = stayer.text("#hpm-on-status")
    rep["leave"]["lobby"] = {"screen": stayer.screen(), "status": st}
    checks.append(("%s: %s's REMATCH (nobody to rematch) -> the ONLINE lobby 'opponent left'" % (label, stayer.tag.upper()),
                   bool(okl) and "LEFT" in (st or "").upper(), "screen %s status %r" % (stayer.screen(), st)))
    leaver.reopen()


def scen_forfeit(A, B, opts, out):
    """CHANGED(wf7 online): the pre-wf7 quick tail on its own - QUICK MATCH -> select -> a short bout -> A pauses (the peer
    keeps advancing) and FORFEITS -> B wins by forfeit -> REMATCH with nobody to rematch -> both on the ONLINE lobby"""
    checks, rep = Checks(), {"name": "forfeit"}
    for s in (A, B):
        s.goto()
    if not (g_boot_to_online(A, checks, "forfeit") and g_boot_to_online(B, checks, "forfeit")):
        return checks, rep
    g_wait_idle([A, B], "forfeit")
    A.focus_to("hpm-on-quick")
    A.key("Enter")
    time.sleep(0.3)
    B.focus_to("hpm-on-quick")
    B.key("Enter")
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 120, 0.25)
    checks.append(("forfeit: both reach the blind select", bool(ok), "A %s / B %s" % (A.screen(), B.screen())))
    if not ok or not g_guard_direct(A, B, checks, "forfeit", opts):
        return checks, rep
    g_pick(A, opts.fa)
    g_pick(B, opts.fb)
    ok = g_wait_fight([A, B], 150)
    checks.append(("forfeit: bout starts on both", ok, ""))
    if not ok:
        return checks, rep
    g_play([A, B], [Bot("rush", 5), Bot("mixed", 7)], 60, stop_after=4.0)
    A.key(GK["pause"])
    okp = A.wait(lambda: A.screen() == "pause", 6)
    g_pause_check(A, B, okp, checks, "forfeit", rep)
    A.focus_to("hpm-p-forfeit")
    A.key("Enter")
    time.sleep(0.3)
    if A.menus().get("confirm"):
        A.key("ArrowRight")
        A.key("Enter")
    okA = A.wait(lambda: A.state().get("phase") == "results", 10)
    okB = B.wait(lambda: B.state().get("phase") == "results", 15)
    time.sleep(0.8)
    ua, ub = g_results_ui(A), g_results_ui(B)
    rep["forfeit_ui"] = {"a": ua, "b": ub}
    lb = B.online().get("lastMatch") or {}
    checks.append(("forfeit: A forfeits -> B wins by forfeit", bool(okA and okB) and lb.get("reason") == "forfeit" and lb.get("winner") == B.online().get("local"),
                   "A phase %s how %r / B phase %s how %r lastMatch %s" % (A.state().get("phase"), ua.get("how"), B.state().get("phase"), ub.get("how"),
                                                                        {k: lb.get(k) for k in ("reason", "winner", "rematch")})))
    B.shot("forfeit_win")
    # ---- nobody to rematch: REMATCH on both -> the ONLINE lobby
    A.key("Enter")
    B.key("Enter")
    okl = A.wait(lambda: A.screen() == "online" and B.screen() == "online", 10)
    rep["lobby_status"] = {"a": A.text("#hpm-on-status"), "b": B.text("#hpm-on-status")}
    checks.append(("forfeit: REMATCH with nobody to rematch -> both on the ONLINE lobby", bool(okl),
                   "A %s %r / B %s %r" % (A.screen(), rep["lobby_status"]["a"], B.screen(), rep["lobby_status"]["b"])))
    rep["supabase"] = {"a": (A.online().get("supabase") or {}), "b": (B.online().get("supabase") or {})}
    return checks, rep


def scen_code(A, B, opts, out):
    """CREATE ROOM (A) -> JOIN by typing the code (B) -> blind select -> full best-of-3 -> agreement -> REMATCH (both) ->
    B's tab closes mid-round -> A wins after the grace -> A's REMATCH -> A lands on the ONLINE lobby told the opponent left"""
    checks, rep = Checks(), {"name": "code"}
    for s in (A, B):
        s.goto()
    if not (g_boot_to_online(A, checks, "code") and g_boot_to_online(B, checks, "code")):
        return checks, rep
    g_wait_idle([A, B], "code")
    A.focus_to("hpm-on-create")
    A.key("Enter")
    code = A.wait(lambda: A.online().get("room") or None, 20)
    time.sleep(0.8)
    st = A.text("#hpm-on-status")
    rep["code"], rep["status_a"] = code, st
    checks.append(("code: CREATE ROOM gives a 4-letter code shown on the status line", bool(code) and len(code) == 4 and code.isalpha() and bool(st) and code in st,
                   "code %r status %r" % (code, st)))
    A.shot("code_created")
    if not code:
        return checks, rep
    B.focus_to("hpm-on-code")
    B.page.keyboard.type(code, delay=60)
    typed = B.js("() => { const e = document.getElementById('hpm-on-code'); return e ? e.value : null; }")
    B.focus_to("hpm-on-join")
    B.key("Enter")
    t0 = time.time()
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 90, 0.25)
    rep["join_to_select_s"] = round(time.time() - t0, 1)
    checks.append(("code: JOIN by the typed code -> both in the blind select", bool(ok), "typed %r; A %s / B %s after %.1f s" % (typed, A.screen(), B.screen(), time.time() - t0)))
    if not ok:
        rep["a"], rep["b"] = g_netsum(A.net()), g_netsum(B.net())
        return checks, rep
    if not g_guard_direct(A, B, checks, "code", opts):
        return checks, rep
    ca, cb = g_pick(A, opts.fa2), g_pick(B, opts.fb2)
    checks.append(("code: picks by real keys", ca == opts.fa2 and cb == opts.fb2, "A cursor %s / B cursor %s" % (ca, cb)))
    ok = g_wait_fight([A, B], 180)
    checks.append(("code: bout starts on both", ok, ""))
    if not ok:
        return checks, rep
    A.shot("code_bout_start")
    bots = [Bot("mixed", 31), Bot("rush", 37)]
    t0 = time.time()
    pf0 = [A.perf(), B.perf()]
    rep["timeline"] = g_play([A, B], bots, opts.bout_timeout)
    rep["bout_s"] = round(time.time() - t0, 1)
    rep["presses"] = [bots[0].presses, bots[1].presses]
    g_step_check(checks, rep["name"], rep, bots)
    na, nb = A.net(), B.net()
    rep["a"], rep["b"] = g_netsum(na), g_netsum(nb)
    rep["perf"] = g_perf_delta(pf0, [A.perf(), B.perf()])
    rep["match_a"], rep["match_b"] = A.match(), B.match()
    fin = A.state().get("phase") == "results" and B.state().get("phase") == "results"
    checks.append(("code: both reach results", fin, "A %s / B %s after %.1f s" % (A.state().get("phase"), B.state().get("phase"), time.time() - t0)))
    g_bout_checks(checks, "code", A, B, na, nb)
    mA, mB = rep["match_a"] or {}, rep["match_b"] or {}
    checks.append(("code: best-of-3 decided", max((mA.get("wins") or [0, 0])) == 2 and mA.get("wins") == mB.get("wins"), "wins A %s / B %s" % (mA.get("wins"), mB.get("wins"))))
    time.sleep(0.8)
    rep["results_ui"] = {"a": g_results_ui(A), "b": g_results_ui(B)}
    A.shot("code_results")
    B.shot("code_results")
    if not fin:
        return checks, rep
    # CHANGED(wf7 online): REMATCH (both) -> second blind select -> a few seconds of round 1 -> B's tab closes mid-round ->
    # A wins by disconnect after the grace -> A's REMATCH -> the ONLINE lobby 'opponent left' (was: B declined via MAIN MENU)
    A.key("Enter")
    time.sleep(0.4)
    B.key("Enter")
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 40, 0.25)
    checks.append(("code: REMATCH (both) opens a second blind select", bool(ok), "A %s / B %s; A matchIndex %s" % (A.screen(), B.screen(), A.online().get("matchIndex"))))
    if not ok:
        return checks, rep
    g_pick(A, opts.fa2)
    g_pick(B, opts.fb2)
    ok = g_wait_fight([A, B], 120)
    checks.append(("code: rematch bout starts, new seed", bool(ok) and A.match().get("seed") != mA.get("seed") and A.match().get("seed") == B.match().get("seed"),
                   "first %s -> rematch %s/%s" % (mA.get("seed"), A.match().get("seed"), B.match().get("seed"))))
    if not ok:
        return checks, rep
    g_play([A, B], [Bot("mixed", 17), Bot("rush", 19)], 60, stop_after=6.0)
    g_leave_mid_round(B, A, checks, "code", rep)
    rep["supabase"] = {"a": (A.online().get("supabase") or {}), "b": rep.get("supabase_leaver") or {}}
    return checks, rep


def scen_link(A, B, opts, out):
    """CREATE ROOM (A) -> B opens <game>/?room=CODE (deep link auto-join) -> both in the blind select -> B's tab goes away ->
    A is told the opponent left (5 s presence grace) and lands on the ONLINE lobby"""
    checks, rep = Checks(), {"name": "link"}
    A.goto()
    if not g_boot_to_online(A, checks, "link"):
        return checks, rep
    A.focus_to("hpm-on-create")
    A.key("Enter")
    code = A.wait(lambda: A.online().get("room") or None, 20)
    rep["code"] = code
    if not code:
        checks.append(("link: room created", False, ""))
        return checks, rep
    B.goto("&room=" + code)
    t0 = time.time()
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 90, 0.25)
    checks.append(("link: ?room=CODE deep link auto-joins -> both in the blind select", bool(ok), "code %s; A %s / B %s after %.1f s" % (code, A.screen(), B.screen(), time.time() - t0)))
    B.shot("link_select")
    if not ok:
        return checks, rep
    B.page.goto("about:blank")
    t0 = time.time()
    oka = A.wait(lambda: A.screen() == "online", 15, 0.25)
    rep["left_after_s"] = round(time.time() - t0, 1)
    rep["a_status"] = A.text("#hpm-on-status")
    checks.append(("link: B leaves during the select -> A back on the ONLINE lobby 'opponent left'", bool(oka) and "LEFT" in (rep["a_status"] or "").upper(),
                   "after %.1f s status %r" % (time.time() - t0, rep["a_status"])))
    A.shot("link_peer_left")
    return checks, rep


def scen_relay(A, B, opts, out):
    """SHORT live relay test in the real game: both pages force the relay tier (?relay=1) -> CREATE / deep-link JOIN ->
    blind select -> `--relay-secs` of real-key play -> relay speed / RTT / stalls / pacing measured -> A forfeits.
    Costs ~40 Supabase events/s for the bout (the project's cap is 100/s shared): keep it short."""
    checks, rep = Checks(), {"name": "relay"}
    A.goto("&relay=1")
    if not g_boot_to_online(A, checks, "relay"):
        return checks, rep
    A.focus_to("hpm-on-create")
    A.key("Enter")
    code = A.wait(lambda: A.online().get("room") or None, 20)
    if not code:
        checks.append(("relay: room created", False, ""))
        return checks, rep
    B.goto("&relay=1&room=" + code)
    ok = A.wait(lambda: g_in_select(A) and g_in_select(B), 120, 0.25)
    oa, ob = A.online(), B.online()
    checks.append(("relay: both in the select over the relay tier", bool(ok) and oa.get("transport") == "relay" and ob.get("transport") == "relay",
                   "A %s %s / B %s %s" % (A.screen(), oa.get("transport"), B.screen(), ob.get("transport"))))
    if not ok:
        return checks, rep
    g_pick(A, opts.fa)
    g_pick(B, opts.fb)
    ok = g_wait_fight([A, B], 150)
    checks.append(("relay: bout starts on both", ok, ""))
    if not ok:
        return checks, rep
    pf0 = [A.perf(), B.perf()]
    rep["timeline"] = g_play([A, B], [Bot("rush", 41), Bot("mixed", 43)], opts.relay_secs + 60, stop_after=opts.relay_secs)
    na, nb = A.net(), B.net()
    rep["a"], rep["b"] = g_netsum(na), g_netsum(nb)
    rep["perf"] = g_perf_delta(pf0, [A.perf(), B.perf()])
    for s, n in ((A, na), (B, nb)):
        n = n or {}
        rl = ((n.get("online") or {}).get("relay") or {})
        checks.append(("relay:%s session on the relay, D=4 W=12, 0 desyncs" % s.tag, n.get("transport") == "relay" and n.get("delay") == 4 and n.get("window") == 12
                       and (n.get("desyncs") or 0) == 0, "transport=%s D=%s W=%s desyncs=%s" % (n.get("transport"), n.get("delay"), n.get("window"), n.get("desyncs"))))
        checks.append(("relay:%s pacing = token bucket, no queued packets" % s.tag, rl.get("pacing") == "bucket" and (rl.get("held") or 0) <= 2,
                       json.dumps(rl)))
        checks.append(("relay:%s game speed >= 96%% (session ticks)" % s.tag, (n.get("gameSpeed") or 0) >= 0.96,
                       "gameSpeed=%s wallSpeed=%s stalls=%s rtt=%s rollbacks=%s max=%s" % (n.get("gameSpeed"), n.get("wallSpeed"), n.get("stallTicks"),
                                                                                       n.get("rttMedianMs"), n.get("rollbacks"), n.get("maxRollback"))))
    A.shot("relay_bout")
    A.key(GK["pause"])
    A.wait(lambda: A.screen() == "pause", 6)
    A.focus_to("hpm-p-forfeit")
    A.key("Enter")
    time.sleep(0.3)
    if A.menus().get("confirm"):
        A.key("ArrowRight")
        A.key("Enter")
    okB = B.wait(lambda: B.state().get("phase") == "results", 20)
    checks.append(("relay: A forfeits -> B's results (the session stops, no more relay traffic)", bool(okB), "B phase %s" % B.state().get("phase")))
    time.sleep(3.0)
    sa1, sb1 = (A.online().get("supabase") or {}), (B.online().get("supabase") or {})
    time.sleep(3.0)
    sa2, sb2 = (A.online().get("supabase") or {}), (B.online().get("supabase") or {})
    rep["supabase"] = {"a": sa2, "b": sb2}
    checks.append(("relay: no relay sends after the results card (3 s window)", sb2.get("binary") == sb1.get("binary"),
                   "B binary sends %s -> %s; A %s -> %s" % (sb1.get("binary"), sb2.get("binary"), sa1.get("binary"), sa2.get("binary"))))
    return checks, rep


def run_game(opts):
    """Both peers are the REAL game (menus, character select, 3D bout, HUD, results) in two separate Chrome processes on
    two dev-server origins (5325 = A, 5330 = B: separate localStorage), driven only by real key presses."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import common as C
    from playwright.sync_api import sync_playwright
    shots = os.path.join(ROOT, "_shots", "online2")
    os.makedirs(shots, exist_ok=True)
    q = "nettrace=%d" % opts.nettrace if opts.nettrace else "online2=1"
    if opts.quality:
        q += "&quality=" + opts.quality          # page-only override (main.ts ?quality=): two 3D Chromes share one GPU here
    if opts.relay:
        q += "&relay=1"
    servers = []
    out = {"mode": "game", "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "relay": opts.relay, "quality": opts.quality, "query": q, "scenarios": {}, "checks": []}
    all_checks = []
    global GAME_PORTS
    if getattr(opts, "ports", ""):
        GAME_PORTS = tuple(int(x) for x in opts.ports.split(",")[:2])
    out["ports"] = list(GAME_PORTS)
    try:
        for port in GAME_PORTS:
            servers.append(C.ensure_server("http://localhost:%d/" % port, wait_s=300))
        with sync_playwright() as p:
            args = C.FLAGS + (["--disable-features=WebRtcHideLocalIpsWithMdns"] if opts.no_mdns else [])
            ba = p.chromium.launch(channel="chrome", headless=not opts.headed, args=args)
            bb = p.chromium.launch(channel="chrome", headless=not opts.headed, args=args)
            out["browser"] = ba.version
            A = GSide("a", ba, "http://localhost:%d" % GAME_PORTS[0], q, shots, C)
            B = GSide("b", bb, "http://localhost:%d" % GAME_PORTS[1], q, shots, C)
            for name in [x.strip() for x in opts.scenarios.split(",") if x.strip()]:
                fn = {"quick": scen_quick, "code": scen_code, "link": scen_link, "relay": scen_relay, "forfeit": scen_forfeit}.get(name)
                if not fn:
                    continue
                t0 = time.time()
                try:
                    checks, rep = fn(A, B, opts, shots)
                except Exception as e:
                    checks, rep = [(name + ": crashed", False, repr(e)[:400])], {"name": name}
                rep["seconds"] = round(time.time() - t0, 1)
                out["scenarios"][name] = rep
                all_checks += checks
                print("--- scenario %s (%.0f s)" % (name, time.time() - t0))
                for (n, ok, d) in checks:
                    print("  %s %s  %s" % ("ok  " if ok else "FAIL", n, d))
                if rep.get("perf"):
                    print("  local loop during the bout: %s" % json.dumps(rep["perf"]))
                for tag, r in (("A", rep.get("a")), ("B", rep.get("b"))):
                    if r:
                        o = r.get("online") or {}
                        print("  %s: transport=%s pair=%s syncRTT=%sms sessionRTT=%sms D=%s frames=%s speed=%s wall=%s stalls=%s rollbacks=%s max=%s "
                              "rbFrames=%s loss=%s desyncs=%s cs=%s supabase=%s" % (
                                  tag, r.get("transport"), json.dumps(o.get("pair")), o.get("rttMs") and round(o.get("rttMs"), 1), r.get("rttMedianMs"), r.get("delay"),
                                  r.get("frame"), r.get("gameSpeed"), r.get("wallSpeed"), r.get("stallTicks"), r.get("rollbacks"), r.get("maxRollback"),
                                  r.get("rollbackFrames"), r.get("lossPct"), r.get("desyncs"), (o.get("result") or {}).get("mine"), json.dumps(o.get("supabase"))))
            for s in (A, B):
                out["diag_" + s.tag] = s.diag()
                out["notes_" + s.tag] = s.notes
                out["shots_" + s.tag] = s.shots
                out["gotrue_" + s.tag] = s.gotrue_warnings()
                out["pages_" + s.tag] = s.pages_opened
            ba.close()
            bb.close()
    finally:
        for h in servers:
            C.stop_server(h)
    errs = [e for k in ("diag_a", "diag_b") for e in ((out.get(k) or {}).get("pageErrors") or []) + ((out.get(k) or {}).get("windowErrors") or [])]
    all_checks.append(("no page errors / unhandled rejections in either Chrome", not errs, "; ".join(errs[:4])))
    # CHANGED(wf7 online) VO-D7: supabase-js warns "Multiple GoTrueClient instances detected in the same browser context" when a
    # page creates a 2nd client under the same auth storage key (netplay.ts: one memoised client, own key; ratings.ts: one
    # memoised client, the portal's key) - counted over every page each side opened in this run
    if "gotrue_a" in out:
        ga, gb = out.get("gotrue_a") or [], out.get("gotrue_b") or []
        all_checks.append(("no supabase-js 'Multiple GoTrueClient instances' warning on either side (VO-D7)", not (ga or gb),
                           "A %d / B %d warnings over %s / %s pages%s" % (len(ga), len(gb), out.get("pages_a"), out.get("pages_b"),
                                                                       (": " + (ga or gb)[0][:160]) if (ga or gb) else "")))
    out["checks"] = [{"name": n, "ok": ok, "detail": d} for (n, ok, d) in all_checks]
    failed = [c for c in out["checks"] if not c["ok"]]
    out["pass"] = not failed and bool(all_checks)
    name = "online2_game%s.json" % ("_relay" if opts.relay else "")
    with open(os.path.join(REPORTS, name), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, default=str)
    cerr = [e for k in ("diag_a", "diag_b") for e in ((out.get(k) or {}).get("consoleErrors") or [])]
    if cerr:
        print("console errors (%d): %s" % (len(cerr), " | ".join(x[:200] for x in cerr[:6])))
    print("%s online2 --game: %d/%d checks%s -> _harness/_reports/%s" % ("PASS" if out["pass"] else "FAIL", len(all_checks) - len(failed), len(all_checks),
                                                                    "" if not failed else " FAILED: " + " | ".join(c["name"] for c in failed[:8]), name))
    return 0 if out["pass"] else 1


def run_pick_test(opts):
    """CHANGED(wf7 online) VO-D8: one Chrome on port A (the first of --ports): title -> main -> VERSUS -> GO -> character select;
    g_nav walks P1's cursor to EVERY slot of the grid (both rows, RANDOM, the bosses' column; a locked boss can be hovered)
    by real arrow keys, each from wherever the previous walk ended. PASS = every slot reached. Then a row-1 fighter is
    confirmed by Enter and the select's readback must show it picked (no other fighter silently)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import common as C
    from playwright.sync_api import sync_playwright
    ports = tuple(int(x) for x in opts.ports.split(",")[:2]) if opts.ports else GAME_PORTS
    base = "http://localhost:%d" % ports[0]
    shots = os.path.join(ROOT, "_shots", "online2")
    os.makedirs(shots, exist_ok=True)
    out = {"mode": "pick-test", "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "base": base}
    checks = Checks()
    srv = C.ensure_server(base + "/", wait_s=300)
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel="chrome", headless=not opts.headed, args=C.FLAGS)
            s = GSide("a", br, base, "online2=1&quality=low", shots, C)
            s.goto()
            s.wait(lambda: s.state().get("phase") == "title" and s.screen() == "title", 120)
            s.key("Enter")
            s.wait(lambda: s.screen() == "main", 10)
            s.focus_to("hpm-main-versus")
            s.key("Enter")
            s.wait(lambda: s.screen() == "versus", 10)
            s.focus_to("hpm-versus-go")
            s.key("Enter")
            ok = s.wait(lambda: s.screen() == "charselect" and g_cursor(s), 15)
            cs = s.menus().get("cs") or {}
            slots = cs.get("slots") or []
            checks.append(("pick-test: VERSUS character select open", bool(ok) and len(slots) >= 11, "slots %s locked %s" % (slots, cs.get("locked"))))
            global NAV_DIRECT
            for mode in ("scan", "direct"):                 # the scan alone (the fallback), then the layout path + fallback
                NAV_DIRECT = mode == "direct"
                order = [x for x in slots if x != "random"][::-1] + ["random"]     # reversed: every walk starts somewhere new
                if mode == "direct":
                    order = order[::2] + order[1::2]           # jumps across rows / columns
                reached, walks = [], []
                for fid in order:
                    trail = []
                    cur = g_nav(s, fid, trail)
                    presses = sum(1 for x in trail if ">" in x)
                    walks.append({"want": fid, "got": cur, "presses": presses, "trail": trail})
                    if cur == fid:
                        reached.append(fid)
                    glog("%s walk %-9s -> %-9s %2d presses  %s" % (mode, fid, cur, presses, " ".join(trail)))
                out["walks_" + mode] = walks
                missed = [x for x in order if x not in reached]
                checks.append(("pick-test (%s): the picker reaches every slot by real arrows (%d)" % (mode, len(order)), not missed and bool(order),
                               "reached %d/%d; missed %s; max presses %s" % (len(reached), len(order), missed, max([w["presses"] for w in walks] or [0]))))
            NAV_DIRECT = True
            row1 = [x for x in ("lotus", "boneyard", "spin", "gazza", "rerun") if x in slots and x not in (cs.get("locked") or [])]
            if row1:
                want = row1[len(row1) // 2]
                g_nav(s, "random")
                cur = g_nav(s, want)
                s.key("Enter")
                time.sleep(0.4)
                p0 = ((s.menus().get("cs") or {}).get("p") or [{}])[0]
                s.shot("picktest_%s" % want)
                checks.append(("pick-test: Enter on row-1 fighter %s picks it (no other fighter)" % want, cur == want and p0.get("fighter") == want,
                               "cursor %s, picked %s, step %s" % (cur, p0.get("fighter"), p0.get("step"))))
            out["diag"] = s.diag()
            br.close()
    finally:
        C.stop_server(srv)
    out["checks"] = [{"name": n, "ok": ok, "detail": d} for (n, ok, d) in checks]
    out["pass"] = all(c["ok"] for c in out["checks"]) and bool(checks)
    with open(os.path.join(REPORTS, "online2_picktest.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, default=str)
    print("%s online2 --pick-test: %d/%d checks -> _harness/_reports/online2_picktest.json" % ("PASS" if out["pass"] else "FAIL",
                                                                                         sum(1 for c in out["checks"] if c["ok"]), len(out["checks"])))
    return 0 if out["pass"] else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lab", action="store_true")
    ap.add_argument("--game", action="store_true")
    ap.add_argument("--secs", type=int, default=20)
    ap.add_argument("--relay", action="store_true")
    ap.add_argument("--lag", type=int, default=0, help="lab: extra one-way ms added on receive per side (RTT += 2x)")
    ap.add_argument("--quick", action="store_true", help="lab: pair through quick match (ffg-lobby:hit-parade) instead of a room code")
    ap.add_argument("--rematch", type=int, default=0, help="lab: accept N rematches (new select + seed + match epoch each)")
    ap.add_argument("--again", action="store_true", help="lab: after leaving, the same OnlineFlow runs a second session (reuse)")
    ap.add_argument("--killrtc", type=float, default=0, help="lab: B closes its DataChannels S s into the match (mid-match relay fallback)")
    ap.add_argument("--drop-b-at", dest="drop_b_at", type=float, default=0, help="lab: close B's browser S s into the match (disconnect = win after 5 s)")
    ap.add_argument("--nettrace", type=int, default=0, help="lab: session trace of N ticks + relay flush log; analysed (hold / network / stalls)")
    ap.add_argument("--relaypace", choices=["bucket", "interval"], default=None, help="lab A/B: relay pacing (default bucket = P2; interval = P1)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-mdns", dest="no_mdns", action="store_true")
    ap.add_argument("--url", default="http://localhost:%d" % PORT)
    ap.add_argument("--scenarios", default="quick,code,link", help="game: which scenarios (quick,code,link,relay; relay = a SHORT relay-tier bout)")
    ap.add_argument("--relay-secs", dest="relay_secs", type=float, default=20, help="game relay scenario: seconds of play on the relay")
    ap.add_argument("--quality", default="low", help="game: ?quality= for both pages (low|med|high; '' = the saved setting)")
    ap.add_argument("--bout-timeout", dest="bout_timeout", type=float, default=420, help="game: seconds a full bout may take")
    ap.add_argument("--ports", default="", help="game: the two dev-server ports A,B (default 5325,5330)")
    # CHANGED(wf7 online) VO-D8: the defaults pick from BOTH grid rows (row 1 = lotus boneyard spin gazza rerun)
    ap.add_argument("--fa", default="boneyard", help="game quick / forfeit: A's fighter")
    ap.add_argument("--fb", default="spin", help="game quick / forfeit: B's fighter")
    ap.add_argument("--fa2", default="gazza", help="game code: A's fighter")
    ap.add_argument("--fb2", default="johnny", help="game code: B's fighter")
    ap.add_argument("--pick-test", dest="pick_test", action="store_true", help="game: walk P1's cursor to every character-select slot (VERSUS) on port A")
    opts = ap.parse_args()
    os.makedirs(REPORTS, exist_ok=True)
    proc = None
    try:
        if opts.pick_test:
            return run_pick_test(opts)
        if opts.game:
            return run_game(opts)
        if opts.url.startswith("http://localhost:%d" % PORT):
            proc = start_server(PORT)
        return run_lab(opts)
    finally:
        stop_server(proc)


if __name__ == "__main__":
    sys.exit(main())
