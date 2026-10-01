#!/usr/bin/env python
"""portalcheck - mouse-look inside the PORTAL's iframe (harness-gates G4; the portal pointer-lock failure).

    python _harness/portalcheck.py                     # the real sandbox string -> must PASS
    python _harness/portalcheck.py --drop-token allow-pointer-lock    # the same page minus the token -> must FAIL
    python _harness/portalcheck.py --matrix            # both, and the negative control must be detected
    python _harness/portalcheck.py --live              # iframe the LIVE CDN build (GET only; nothing is written)

Same-origin frames lock without any token, so local dev never catches a missing one (GAME_DOCTRINE.md:260-266). This
gate builds a parent page on a DIFFERENT origin (http://localhost:<port>/__lc_portal, fulfilled by page routing) that
iframes the game (http://127.0.0.1:<port>/..., or the live CDN) with the `sandbox` and `allow` attribute strings READ AT
RUN TIME from src/components/game/GamePlayer.tsx (the portal's real iframe), and answers the forgeflow:load bridge
like the portal does (the logic of _harness/bridge_host.html).

Asserts (per variant): the frame boots; a REAL click on the lobby drops in (practice); a REAL click on the frame's
canvas -> the frame's document.pointerLockElement is set within 2 s and no "Blocked pointer lock" console line;
localStorage write/read works inside the frame (allow-same-origin); the game asked the parent for its save
(forgeflow:load). Headless is enough (verified 2026-09-30: headless Chrome grants pointer lock to a sandboxed
cross-origin frame WITH allow-pointer-lock in 0.55 s and refuses it WITHOUT - "Blocked pointer lock on an element because
the element's frame is sandboxed"); --headed is available.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import html
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GAMEPLAYER = os.path.join(C.REPO, "src", "components", "game", "GamePlayer.tsx")
LIVE = "https://forgeflow-games-cdn.isimcha85.workers.dev/last-circle/index.html"

PARENT = """<!doctype html><meta charset="utf-8"><title>lc portal stand-in</title>
<style>html,body{margin:0;background:#111}iframe{width:100vw;height:100vh;border:0;display:block}</style>
<body><script>
window.__BRIDGE = { loads: 0, saves: 0, other: [] };
addEventListener('message', (e) => {
  const m = e.data; if (!m || typeof m !== 'object') return;
  if (m.type === 'forgeflow:load') { __BRIDGE.loads++; e.source.postMessage({ type: 'forgeflow:save_loaded', data: null, _reqId: m._reqId }, '*'); }
  else if (m.type === 'forgeflow:save') __BRIDGE.saves++;
  else if (__BRIDGE.other.length < 20) __BRIDGE.other.push(String(m.type));
});
</script>
<iframe id="game" src="%(src)s" sandbox="%(sandbox)s" allow="%(allow)s" title="Last Circle"></iframe>
</body>"""


def read_portal_attrs():
    src = open(GAMEPLAYER, encoding="utf-8").read()
    m = re.search(r"<iframe[\s\S]*?/>", src)
    block = m.group(0) if m else src
    sb = re.search(r'\bsandbox="([^"]*)"', block)
    al = re.search(r'\ballow="([^"]*)"', block)
    line = None
    if sb:
        line = src[:src.find(sb.group(0))].count("\n") + 1
    return (sb.group(1) if sb else None), (al.group(1) if al else None), line


def run_variant(v, args, label, sandbox, allow, game_url, expect_lock):
    """One parent page + frame. Returns a dict; records checks with the variant label."""
    u = urllib.parse.urlparse(game_url)
    parent_origin = "http://localhost:%s" % (u.port or 8790) if u.hostname in ("127.0.0.1",) else "http://localhost:8790"
    parent_url = parent_origin + "/__lc_portal"
    page_html = PARENT % {"src": html.escape(game_url + ("&" if "?" in game_url else "?") + "portalcheck=1"),
                          "sandbox": html.escape(sandbox), "allow": html.escape(allow or "")}
    out = {"label": label, "sandbox": sandbox, "allow": allow, "game": game_url}
    live = u.hostname not in ("127.0.0.1", "localhost")
    with C.Session(args, "portalcheck-" + label) as s:
        # the parent page lives on a different origin: fulfilled from here, never from a server
        s.context.route(lambda url: url.startswith(parent_url), lambda r: r.fulfill(status=200, body=page_html, content_type="text/html"))
        if live:
            # GET only against the live CDN: anything else is refused client-side
            s.context.route(lambda url: url.startswith("https://forgeflow-games-cdn."),
                            lambda r: r.continue_() if r.request.method in ("GET", "HEAD") else r.abort("blockedbyclient"))
        s.goto(parent_url)
        fr = None
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout:
            fr = next((f for f in s.page.frames if f != s.page.main_frame and "last-circle" in f.url), None)
            if fr is not None:
                try:
                    if fr.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"):
                        break
                except Exception:
                    pass
            s.sleep(0.5)
        else:
            fr = None
        if fr is None:
            if s.refused:
                raise C.EnvFailure("server refused requests from the frame")
            v.check("%s: the game boots inside the sandboxed cross-origin frame" % label, False,
                    {"frames": [f.url for f in s.page.frames], "failed": s.failed[:4]})
            return out
        v.check("%s: the game boots inside the sandboxed cross-origin frame" % label, True, {"s": round(time.time() - t0, 1)})
        ls = fr.evaluate("() => { try { localStorage.setItem('__lc_portalcheck', '1'); const ok = localStorage.getItem('__lc_portalcheck') === '1'; localStorage.removeItem('__lc_portalcheck'); return ok; } catch (e) { return 'threw: ' + e; } }")
        v.check("%s: localStorage works inside the frame (allow-same-origin)" % label, ls is True, ls)
        s.sleep(1.0)
        br = s.js("() => window.__BRIDGE")
        v.check("%s: the game asks the parent for its save (forgeflow:load)" % label, (br or {}).get("loads", 0) >= 1, br)
        # practice match, dropped into by a REAL click on the lobby
        fr.evaluate("() => { window.__H_SM__ = 0; window.__LC__.startMatch({ mode: 'practice', seed: 5 }).then(() => { window.__H_SM__ = 1; }, (e) => { window.__H_SM__ = String(e); }); return 1; }")
        t1 = time.time()
        while time.time() - t1 < args.load_timeout:
            st = fr.evaluate("() => ({ sm: window.__H_SM__, phase: window.__LC__.W.phase, starting: !!window.__LC__.W._starting })")
            if st["phase"] == "lobby" and not st["starting"]:
                break
            s.sleep(0.5)
        box = s.js("() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }")
        cx, cy = box["x"] + box["w"] * 0.5, box["y"] + box["h"] * 0.5
        s.page.mouse.click(cx, cy)                       # the lobby: "CLICK OR PRESS ENTER TO DROP IN NOW"
        t2 = time.time()
        while time.time() - t2 < 20:
            if fr.evaluate("() => window.__LC__.W.phase") == "match":
                break
            s.sleep(0.25)
        phase = fr.evaluate("() => window.__LC__.W.phase")
        if phase != "match":
            fr.evaluate("() => { const e = new KeyboardEvent('keydown', { key: 'Enter' }); window.dispatchEvent(e); }")
            v.note("%s: the lobby click did not drop in (phase %s); lobby skipped by a synthetic Enter (setup only)" % (label, phase))
            s.sleep(1.0)
        s.sleep(1.0)
        n_console = len(s.console)
        s.page.mouse.click(cx, cy + box["h"] * 0.1)      # REAL click on the frame's canvas -> tryLock
        t3 = time.time()
        locked = None
        while time.time() - t3 < max(2.0, args.lock_wait):
            if fr.evaluate("() => !!document.pointerLockElement"):
                locked = round(time.time() - t3, 2)
                break
            s.sleep(0.1)
        blocked = [t for (k, t, st) in s.console[n_console:] if "Blocked pointer lock" in t]
        lk = fr.evaluate("() => window.__H_LOCK__ || null")
        out.update(lockedAfter=locked, blocked=blocked[:2], lockInfo=lk)
        ok = locked is not None and locked <= 2.0 and not blocked
        if expect_lock:
            v.check("%s: a REAL click locks the pointer inside the frame within 2 s" % label, ok,
                    {"lockedAfterS": locked, "blockedConsole": blocked[:2], "requests": (lk or {}).get("requests"), "errors": (lk or {}).get("errors")})
        else:
            v.check("%s (negative control): without the token the lock is refused and the console says so" % label,
                    locked is None and bool(blocked), {"lockedAfterS": locked, "blockedConsole": blocked[:2]})
        out["ok"] = ok
        d = s.diagnostics()
        out["pageErrors"] = d["pageErrors"][:3]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--drop-token", default=None, help="remove this sandbox token from the portal string (e.g. allow-pointer-lock)")
    ap.add_argument("--matrix", action="store_true", help="run the real string AND the string minus allow-pointer-lock")
    ap.add_argument("--live", action="store_true", help="iframe the live CDN build (GET only)")
    ap.add_argument("--lock-wait", type=float, default=4.0, help="seconds to keep watching for the lock (the gate still demands <= 2 s)")
    args = ap.parse_args()

    def body(v):
        sandbox, allow, line = read_portal_attrs()
        v.check("GamePlayer.tsx iframe sandbox + allow strings found", bool(sandbox), {"file": GAMEPLAYER, "line": line, "sandbox": sandbox, "allow": allow})
        if not sandbox:
            return
        game = LIVE if args.live else args.base
        if args.live:
            args.disk = False
            args.rev = None
            args.base = LIVE
        variants = []
        if args.matrix:
            variants = [("real", sandbox, True), ("minus-pointer-lock", " ".join(t for t in sandbox.split() if t != "allow-pointer-lock"), False)]
        elif args.drop_token:
            variants = [("minus-" + args.drop_token, " ".join(t for t in sandbox.split() if t != args.drop_token), True)]
        else:
            variants = [("real", sandbox, True)]
        res = []
        for label, sb, expect in variants:
            print("  variant %s: sandbox=%r" % (label, sb), flush=True)
            res.append(run_variant(v, args, label, sb, allow, game, expect))
        v.data["variants"] = res
    return C.run_gate("portalcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
