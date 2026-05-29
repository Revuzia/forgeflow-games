"""capture.py — reliable WebGL/Canvas screenshot via Playwright (CDP).

The preview MCP's screenshot times out on a continuously-rendering WebGL page,
and toDataURL-over-eval is lossy. Playwright's page.screenshot() captures the
compositor directly and writes a real PNG — works for three.js (3D) and Phaser
(2D) alike, regardless of preserveDrawingBuffer. This is the capture mechanism
the fidelity gate uses.

Usage:
    python capture.py <url> <out.png>
    python capture.py http://localhost:8767/games/iron-tide/ shot.png
"""
import sys
from playwright.sync_api import sync_playwright


def capture(url, out, settle_ms=3500, pre_eval=None, post_eval_ms=2500):
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.goto(url, wait_until="load", timeout=60000)
        # Wait for either the 3D or 2D game object to exist.
        try:
            pg.wait_for_function(
                "() => (window.__FFG3D__ && window.__FFG3D__.controller) || (window.__FFG_GAME__)",
                timeout=30000,
            )
        except Exception:
            pass  # capture whatever rendered anyway
        pg.wait_for_timeout(settle_ms)  # let GLB models + first frames settle
        if pre_eval:
            # Run a JS snippet to reach a specific game state (e.g. fire some
            # shots) before the screenshot — lets the fidelity gate capture
            # mid-game, not just the opening frame.
            try:
                pg.evaluate(pre_eval)
                pg.wait_for_timeout(post_eval_ms)
            except Exception as e:
                print("pre_eval error:", e)
        pg.screenshot(path=out)
        b.close()
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python capture.py <url> <out.png> [--eval '<js>']")
        sys.exit(2)
    ev = sys.argv[sys.argv.index("--eval") + 1] if "--eval" in sys.argv else None
    print("saved", capture(sys.argv[1], sys.argv[2], pre_eval=ev))
