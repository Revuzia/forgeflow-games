"""_sp_smoke_test.py — single-player (vs-AI) regression smoke for Iron Tide.

Confirms the ONLINE work did NOT break the existing vs-AI path: boots the game,
starts via the menu Play hook, auto-places the fleet, fires through the AI turn
loop, plays to a finish, and asserts the game ends with a winner and ZERO console
errors. netMode must remain false the whole time.

Run:  python runtime/net/_sp_smoke_test.py http://127.0.0.1:8771
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
        pg.wait_for_function(
            "() => window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test",
            timeout=45000,
        )
        print("[sp] controller ready")

        # Start single-player via the menu Play hook (the normal vs-AI entry).
        pg.evaluate("() => window.__FFG3D__.controller.__test.menuPlay()")
        # netMode must be false in single-player.
        nm = pg.evaluate("() => window.__FFG3D__.controller.__test.netMode()")
        assert nm is False, "netMode must be FALSE in single-player (got %s)" % nm
        print("[sp] menuPlay -> placement, netMode=false OK")

        # Auto-place the player fleet (enters battle).
        pg.evaluate("() => window.__FFG3D__.controller.__test.placeAuto()")
        time.sleep(0.6)
        st = pg.evaluate("() => window.__FFG3D__.controller.__test.state()")
        assert st["phase"] == "battle", "should be in battle after auto-place (got %s)" % st["phase"]
        assert st["playerShips"] == 5, "player should have exactly 5 ships (got %s)" % st["playerShips"]
        print("[sp] auto-placed -> battle, 5 ships OK")

        # Drive the AI turn loop to a finish (instant logic path), then surface end.
        res = pg.evaluate("() => window.__FFG3D__.controller.__test.playToEnd()")
        assert res["ended"] is True, "game should end (got %s)" % res
        assert res["winner"] in ("player", "enemy"), "should have a winner (got %s)" % res["winner"]
        print("[sp] played to end -> winner=%s, turns=%s" % (res["winner"], res["turns"]))

        real = [e for e in errs if "favicon" not in e.lower()]
        assert not real, "console errors in single-player: %s" % real
        print("[sp] zero console errors OK")
        b.close()
    print("\nSINGLE-PLAYER SMOKE PASSED [OK]")


if __name__ == "__main__":
    try:
        run(); sys.exit(0)
    except Exception as e:
        print("\nSP SMOKE FAILED:", type(e).__name__, str(e))
        print("console:", errs)
        sys.exit(1)
