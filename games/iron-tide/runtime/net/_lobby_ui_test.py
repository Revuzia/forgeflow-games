"""_lobby_ui_test.py — verifies the PLAY ONLINE button + lobby UI render in the DOM.

Boots the game, confirms a "PLAY ONLINE" button exists in the title menu alongside
the normal PLAY button (single-player intact), opens the lobby, and asserts the
three options (Quick Match / Create Room / Join Room) are present. Also checks the
Create Room flow surfaces a 4-character room code.

Run: python runtime/net/_lobby_ui_test.py http://127.0.0.1:8771
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8771"
URL = BASE + "/games/iron-tide/index.html"
errs = []


def run():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1100, "height": 720})
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
        pg.goto(URL, wait_until="load", timeout=60000)
        pg.wait_for_function("() => window.__FFG3D__ && window.__FFG3D__.controller", timeout=45000)
        # Menu renders async after boot; wait for the shell overlay buttons.
        pg.wait_for_function(
            "() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ONLINE/i.test(b.textContent))",
            timeout=15000,
        )
        labels = pg.evaluate("() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim())")
        assert any("PLAY ONLINE" in t for t in labels), "PLAY ONLINE button missing: %s" % labels
        assert any(t for t in labels if "PLAY" in t and "ONLINE" not in t), "vs-AI PLAY button missing: %s" % labels
        print("[ui] title menu has both PLAY (vs-AI) and PLAY ONLINE buttons OK")

        # Open the lobby (same code the button's onclick runs).
        pg.evaluate("() => { window.__FFG3D__.controller.shell.hide(); window.__FFG3D__.controller.shell.phase='playing'; }")
        pg.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        pg.wait_for_function(
            "() => { const o=document.querySelector('.ffg-online-overlay'); return o && /QUICK MATCH/i.test(o.textContent); }",
            timeout=15000,
        )
        txt = pg.evaluate("() => document.querySelector('.ffg-online-overlay').textContent")
        for opt in ("QUICK MATCH", "CREATE ROOM", "JOIN ROOM"):
            assert opt in txt.upper(), "lobby missing option %s (have: %s)" % (opt, txt)
        print("[ui] lobby shows Quick Match / Create Room / Join Room OK")

        # Create Room should show a 4-char code + a 'Waiting for opponent' message.
        pg.evaluate("() => window.FFG_IRONTIDE_ONLINE.controller.startCreateRoom()")
        time.sleep(2.0)  # let it connect + render the code
        info = pg.evaluate(
            "() => { const o=document.querySelector('.ffg-online-overlay'); return o ? o.textContent : ''; }"
        )
        import re
        assert "ROOM CODE" in info.upper(), "Create Room should show a ROOM CODE (have: %s)" % info
        assert re.search(r"[A-Z0-9]{4}", info), "Create Room should display a 4-char code (have: %s)" % info
        assert "WAITING FOR OPPONENT" in info.upper(), "Create Room should say 'Waiting for opponent' (have: %s)" % info
        print("[ui] Create Room shows a 4-char code + 'Waiting for opponent' OK")

        real = [e for e in errs if "favicon" not in e.lower()]
        assert not real, "console errors: %s" % real
        print("[ui] zero console errors OK")
        b.close()
    print("\nLOBBY UI TEST PASSED [OK]")


if __name__ == "__main__":
    try:
        run(); sys.exit(0)
    except Exception as e:
        print("\nLOBBY UI FAILED:", type(e).__name__, str(e))
        print("console:", errs)
        sys.exit(1)
