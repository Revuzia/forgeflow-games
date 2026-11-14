#!/usr/bin/env python
"""
Playwright smoke test for Warboard Chess.

Serves games/warboard-chess/ on a FREE port, loads it in headless Chromium,
auto-starts a game, then drives the test controller (window.__FFG3D__.controller
.__test) to:
  1. confirm the scene built (pieces spawned, 0 console errors on load)
  2. make a legal player move (1. e4) and let the AI reply
  3. FORCE A CAPTURE (the fight animation) — 1.e4 d5 2.exd5 captures a black pawn
  4. assert piece counts dropped, no console errors, and the canvas RENDERED
     (canvas.toDataURL — NEVER page.screenshot on WebGL; it hangs)
Saves 1-2 canvas PNGs to the system temp dir. Exits non-zero on any failure.

Run:  python runtime/sim/smoke_test.py
"""
import base64, http.server, os, socket, socketserver, sys, threading, time, tempfile

# Windows consoles default to cp1252 — force UTF-8 so unicode in logs never crashes.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

GAME_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TMP = tempfile.gettempdir()


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=GAME_DIR, **k)

    def log_message(self, *a):
        pass  # quiet


def serve(port):
    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SKIP: playwright not installed")
        return 0

    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"• serving {GAME_DIR}\n• at {url}")

    failures = []
    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 600})

        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # arm autostart BEFORE loading so beginGame() runs without a menu click
        page.add_init_script("try{sessionStorage.setItem('ffg_autostart_warboard-chess','1');}catch(e){}")

        page.goto(url, wait_until="domcontentloaded", timeout=20000)

        # wait for the controller + pieces to exist (GLBs load over the network)
        def ctrl_ready():
            return page.evaluate(
                "() => !!(window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test "
                "&& window.__FFG3D__.controller.__test.state().pieces >= 32)"
            )
        ok = wait_for(ctrl_ready, 25, "controller + 32 pieces")
        if not ok:
            failures.append("controller/pieces never became ready")

        st0 = page.evaluate("() => window.__FFG3D__.controller.__test.state()")
        print(f"• initial state: {st0}")
        if not st0:
            failures.append("no initial state")
        else:
            if st0.get("pieces", 0) < 32:
                failures.append(f"expected >=32 piece views, got {st0.get('pieces')}")
            if st0.get("phase") != "playing":
                failures.append(f"expected phase=playing (autostart), got {st0.get('phase')}")
            if st0.get("sceneChildren", 0) < 40:
                failures.append(f"scene too sparse: {st0.get('sceneChildren')} children")

        # capture #1 — opening position rendered
        save_canvas(page, os.path.join(TMP, "warboard_chess_opening.png"), failures, "opening")

        # ── 1. e4 (legal player move) + GENUINE AI reply ─────────────────────────
        r1 = page.evaluate("() => window.__FFG3D__.controller.__test.move('e2','e4')")
        if not r1:
            failures.append("player move e2-e4 was rejected")
        # The AI reply fires ~420ms after the player's animation settles, so we
        # can't just wait on !busy (there's a gap between the two animations). Wait
        # until the AI has actually moved: white to move again AND >=2 plies logged.
        ai_replied = wait_for(
            lambda: page.evaluate("() => window.__FFG3D__.controller.__test.state().turn") == "w"
            and page.evaluate("() => window.__FFG3D__.controller.__test.state().moveLog.length") >= 2,
            12, "e4 animation + AI reply")
        time.sleep(0.3)
        st1 = page.evaluate("() => window.__FFG3D__.controller.__test.state()")
        print(f"• after 1.e4 (+AI reply): turn={st1.get('turn')} log={st1.get('moveLog')}")
        if not ai_replied:
            failures.append(f"AI did not reply within 12s (turn={st1.get('turn')}, log={st1.get('moveLog')})")
        if len(st1.get("moveLog", [])) < 2:
            failures.append(f"expected >=2 moves logged (e4 + AI), got {st1.get('moveLog')}")

        # ── 2. force a CAPTURE (the FIGHT) ───────────────────────────────────────
        # Restart to a clean game, then play a deterministic capture line via the
        # test-only playLine (no AI interjection): 1.e4 d5 2.exd5 — white captures
        # the black d-pawn. This exercises the full fight-animation + removal path.
        page.evaluate("() => window.__FFG3D__.controller.__test.start()")
        wait_for(lambda: page.evaluate("() => window.__FFG3D__.controller.__test.state().pieces >= 32"), 15, "restart")
        wait_for(lambda: not page.evaluate("() => window.__FFG3D__.controller.__test.busy()"), 8, "restart settle")
        counts_before = page.evaluate("() => window.__FFG3D__.controller.__test.counts()")
        print(f"• playing capture line 1.e4 d5 2.exd5 (deterministic, no AI)")
        page.evaluate(
            "() => window.__FFG3D__.controller.__test.playLine([['e2','e4'],['d7','d5'],['e4','d5']])"
        )
        # playLine resolves when done, but evaluate doesn't await the returned
        # promise here; poll busy + the move log until the capture is applied.
        wait_for(lambda: not page.evaluate("() => window.__FFG3D__.controller.__test.busy()")
                 and page.evaluate("() => window.__FFG3D__.controller.__test.state().moveLog.length") >= 3, 14, "capture line + fight")
        time.sleep(0.8)
        counts_after = page.evaluate("() => window.__FFG3D__.controller.__test.counts()")
        log_after = page.evaluate("() => window.__FFG3D__.controller.__test.state().moveLog")
        print(f"• move log after capture line: {log_after}")
        print(f"• piece counts before capture: {counts_before} -> after: {counts_after}")
        total_before = counts_before["w"] + counts_before["b"]
        total_after = counts_after["w"] + counts_after["b"]
        if not (total_after < total_before):
            failures.append(f"capture did not remove a piece view ({total_before} -> {total_after})")
        # the SAN log should show a pawn capture (contains 'x')
        if not any("x" in (s or "") for s in (log_after or [])):
            failures.append(f"no capture (x) recorded in move log: {log_after}")

        # capture #2 — mid-fight / post-capture frame rendered
        save_canvas(page, os.path.join(TMP, "warboard_chess_capture.png"), failures, "capture")

        # theme sanity: the four themes can all be set without error
        for tk in ["mountains", "forest", "desert", "snow"]:
            got = page.evaluate(f"() => window.__FFG3D__.controller.__test.setTheme('{tk}')")
            if got != tk:
                failures.append(f"setTheme({tk}) returned {got}")

        browser.close()

    httpd.shutdown()

    print("\n" + "=" * 52)
    if console_errors:
        print(f"CONSOLE ERRORS ({len(console_errors)}):")
        for e in console_errors[:10]:
            print("  •", e[:200])
    if page_errors:
        print(f"PAGE ERRORS ({len(page_errors)}):")
        for e in page_errors[:10]:
            print("  •", e[:200])
    if console_errors:
        failures.append(f"{len(console_errors)} console error(s)")
    if page_errors:
        failures.append(f"{len(page_errors)} page error(s)")

    if failures:
        print(f"SMOKE TEST FAILED - {len(failures)} issue(s):")
        for f in failures:
            print("  [X]", f)
        print("=" * 52)
        return 1
    print("SMOKE TEST PASSED - scene rendered, legal move + AI reply + capture (fight) verified, 0 console errors.")
    print("=" * 52)
    return 0




def wait_for(pred, timeout_s, label):
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            if pred():
                return True
        except Exception:
            pass
        time.sleep(0.15)
    print(f"  ! timeout waiting for: {label}")
    return False


def save_canvas(page, path, failures, label):
    """Capture the WebGL canvas via toDataURL (NOT page.screenshot — that hangs on
    WebGL). preserveDrawingBuffer is true in the kernel, so this returns the frame."""
    data_url = page.evaluate(
        """() => {
          const c = document.querySelector('#game-container canvas') || document.querySelector('canvas');
          if (!c) return null;
          try { return c.toDataURL('image/png'); } catch (e) { return 'ERR:' + e.message; }
        }"""
    )
    if not data_url or not data_url.startswith("data:image/png"):
        failures.append(f"canvas toDataURL failed for {label}: {str(data_url)[:80]}")
        return
    b64 = data_url.split(",", 1)[1]
    raw = base64.b64decode(b64)
    if len(raw) < 2000:
        failures.append(f"canvas {label} too small ({len(raw)} bytes) — likely blank")
    with open(path, "wb") as f:
        f.write(raw)
    print(f"• saved canvas [{label}] -> {path} ({len(raw)} bytes)")


if __name__ == "__main__":
    sys.exit(main())
