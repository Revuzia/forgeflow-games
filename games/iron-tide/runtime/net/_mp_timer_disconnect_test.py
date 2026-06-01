"""_mp_timer_disconnect_test.py — verifies the 15s turn timer (auto-forfeit) AND
opponent-disconnect handling for Iron Tide online play.

Two clients pair + deploy. Then:
  TIMER: the host does NOT fire; we assert the 15s clock counts down and, on
         expiry, auto-forfeits (fires a random cell -> a shot lands on the guest's
         board and the turn passes), so the game never stalls.
  DISCONNECT: we close the guest context mid-match and assert the host detects the
         drop (peer present:false) and ends with a victory ("Opponent left") and a
         stopped clock.

Run: python runtime/net/_mp_timer_disconnect_test.py http://127.0.0.1:8771
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8771"
URL = BASE + "/games/iron-tide/index.html"
ROOM = "TMR1"
errs = {"A": [], "B": []}


def attach(page, tag):
    page.on("console", lambda m: errs[tag].append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs[tag].append("PAGEERROR: " + str(e)))


def state(page):
    return page.evaluate("() => window.__mpState ? window.__mpState() : null")


def poll(fn, desc, timeout=40.0, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    raise TimeoutError("timeout waiting for: " + desc + " (last=" + repr(last) + ")")


def setup_match(p):
    browser = p.chromium.launch(headless=True)
    ctxA = browser.new_context(viewport={"width": 1000, "height": 700})
    ctxB = browser.new_context(viewport={"width": 1000, "height": 700})
    A = ctxA.new_page(); B = ctxB.new_page()
    attach(A, "A"); attach(B, "B")
    for pg in (A, B):
        pg.goto(URL, wait_until="load", timeout=60000)
        pg.wait_for_function("() => window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test", timeout=45000)
        pg.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
    poll(lambda: A.evaluate("() => !!window.__mpJoin"), "A hooks")
    poll(lambda: B.evaluate("() => !!window.__mpJoin"), "B hooks")
    A.evaluate("(c) => window.__mpJoin(c, true)", ROOM)
    B.evaluate("(c) => window.__mpJoin(c, false)", ROOM)
    poll(lambda: (state(A) or {}).get("peerPresent"), "A peer", timeout=45)
    poll(lambda: (state(B) or {}).get("peerPresent"), "B peer", timeout=45)
    A.evaluate("() => window.__mpReady()")
    B.evaluate("() => window.__mpReady()")
    poll(lambda: (state(A) or {}).get("inGame"), "A in game", timeout=45)
    poll(lambda: (state(B) or {}).get("inGame"), "B in game", timeout=45)
    host = A if state(A)["isHost"] else B
    guest = B if state(A)["isHost"] else A
    return browser, host, guest


def run():
    with sync_playwright() as p:
        browser, host, guest = setup_match(p)
        print("[setup] match started; host moves first")

        # ── TIMER: clock counts down on the host's turn ───────────────────────
        s = poll(lambda: (state(host) or {}).get("secsLeft") if (state(host) or {}).get("secsLeft") is not None else None,
                 "host clock started", timeout=8)
        assert isinstance(s, int) and 0 < s <= 15, "host turn clock should be 1..15 (got %s)" % s
        print("[timer] host clock running at", s, "s")
        # Don't fire. Snapshot guest's own-board shots; wait for auto-forfeit (~15s).
        def guest_shots():
            return guest.evaluate("() => { const g=window.__FFG3D__.controller.sim; let n=0; for(const r of g.player.shots) for(const v of r) if(v) n++; return n; }")
        before = guest_shots()
        print("[timer] waiting up to 20s for the 15s timeout auto-forfeit…")
        poll(lambda: guest_shots() > before, "auto-forfeit fired a shot at the guest", timeout=22)
        # turn must pass to the guest after the forfeit
        poll(lambda: (state(guest) or {}).get("myTurn") is True, "turn passed to guest after forfeit", timeout=20)
        print("[timer] PASS — 15s expiry auto-forfeited (fired a random cell) and passed the turn")

        # ── DISCONNECT: close the guest; host should detect + end the match ───
        print("[disc] closing the guest context mid-match…")
        guest.context.close()
        poll(lambda: (state(host) or {}).get("ended") is True, "host ended after opponent left", timeout=30)
        hs = state(host)
        assert hs["ended"] is True, "host match should be ended"
        assert hs["secsLeft"] is None, "host clock should be stopped after disconnect (got %s)" % hs["secsLeft"]
        # the end overlay should be shown with a victory message
        ended_txt = host.evaluate("() => { const o=document.querySelector('.ffg-shell-overlay'); return o ? o.textContent : ''; }")
        assert "VICTORY" in ended_txt.upper() or "OPPONENT LEFT" in ended_txt.upper(), "host should see a victory/opponent-left end screen (got: %s)" % ended_txt
        print("[disc] PASS — host detected the drop, ended the match, stopped the clock")

        real_a = [e for e in errs["A"] if "favicon" not in e.lower()]
        # B may log benign teardown noise after context close; only A (the survivor) must be clean.
        assert not real_a, "console errors on surviving client: %s" % real_a
        print("[disc] surviving client had zero console errors OK")
        browser.close()
    print("\nTIMER + DISCONNECT TEST PASSED [OK]")


if __name__ == "__main__":
    try:
        run(); sys.exit(0)
    except Exception as e:
        print("\nTIMER/DISCONNECT FAILED:", type(e).__name__, str(e))
        print("console A:", errs.get("A"), "B:", errs.get("B"))
        sys.exit(1)
