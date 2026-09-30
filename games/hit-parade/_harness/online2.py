"""HIT PARADE - _harness/online2.py (lane NET; CONTRACT §10, §13 G10).

Two REAL Chromes (two separate Chromium processes, not two tabs of one browser) play online.

Modes
  --lab            works today: both open /lab/net.html?room=<CODE>&auto=1&secs=N&tag=a|b. They meet in one
                   Supabase room (NetPlay presence + HELLO), open the WebRTC DataChannels (signalling over the room
                   channel; or the relay with --relay), measure RTT (1 s settle + 10 pings), run the blind-select
                   commit-reveal, then N seconds of rollback netplay on the toy sim with human-like random inputs,
                   and exchange RESULT {final confirmed checksum}. PASS = both done + ok, same final checksum,
                   0 desyncs, 0 page errors.
  --game           integration skeleton (needs SHELL game.ts + UI menus wired to net/online.ts): both open the real
                   game with ?dev=1, one creates a room (__HP__.dev / menus), the other joins by code, one full bout,
                   identical final checksums (window.__HP__.net()). Marked TODO below until the shell exposes it.

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
    extra = ("&relay=1" if opts.relay else "") + ("&lag=%d" % opts.lag if opts.lag else "") + ("&rematch=%d" % opts.rematch if opts.rematch else "") + ("&again=1" if opts.again else "")
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
    out["pass"] = ok
    name = "online2_lab%s%s%s%s%s%s%s.json" % ("_again" if opts.again else "", "_rematch" if opts.rematch else "", "_quick" if opts.quick else "", "_relay" if opts.relay else "", "_lag%d" % opts.lag if opts.lag else "",
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


def run_game(opts):
    """TODO(integration): drive the real game once SHELL wires net/online.ts into game.ts + menus.
    Plan (kept here so the integration pass only fills the selectors):
      1. both Chromes open  <url>/?dev=1  (A with &online=create, B with &room=<code from A>) or use quick match
      2. wait for window.__HP__.net() -> {phase:'select'}; pick fighters through real key presses on charselect
      3. play the bout with real key presses (or dev.setInputs on each side's LOCAL player only)
      4. on results: compare window.__HP__.net().session.checksum of the final confirmed frame on both
    """
    print("SKIP online2 --game: the shell/menus online wiring is integration work (see run_game docstring)")
    return 1


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
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-mdns", dest="no_mdns", action="store_true")
    ap.add_argument("--url", default="http://localhost:%d" % PORT)
    opts = ap.parse_args()
    os.makedirs(REPORTS, exist_ok=True)
    proc = None
    try:
        if opts.url.startswith("http://localhost:%d" % PORT):
            proc = start_server(PORT)
        if opts.game:
            return run_game(opts)
        return run_lab(opts)
    finally:
        stop_server(proc)


if __name__ == "__main__":
    sys.exit(main())
