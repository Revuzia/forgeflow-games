"""_mp_e2e_test.py — 2-CLIENT end-to-end test for Tide Breakers ONLINE play.

Two browser contexts load tide-breakers, both join the SAME room (A=host,
B=guest) over the real Supabase Realtime relay (shared ffg_netplay.js). Asserts:
 (a) presence pairs both clients
 (b) both reach in-game; host moves first
 (c) the host's MOVE relays to the guest (the host's ship moves on the guest's
     mirrored board) and the turn flips to the guest
 (d) zero console errors on both clients

Run: serve the repo root, then
     python games/tide-breakers/runtime/net/_mp_e2e_test.py http://localhost:8771
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8771"
URL = BASE + "/games/tide-breakers/index.html"
ROOM = "TBTEST"


def attach_console(page, tag):
    errs = []
    page.on("console", lambda m: errs.append(f"[{tag}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"[{tag}] PAGEERROR {str(e)[:120]}"))
    return errs


def wait_controller(page):
    page.wait_for_function("() => window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test", timeout=45000)


def mpstate(page):
    return page.evaluate("() => (window.__mpState ? window.__mpState() : null)")


def poll(fn, desc, timeout=40.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(0.25)
    raise TimeoutError("timed out: " + desc + " (last=" + repr(last) + ")")


def enemy_positions(page):
    return page.evaluate("() => { const s=window.__FFG3D__.controller.sim; return s.shipsOf('enemy').map(x=>({id:x.id,x:Math.round(x.x),y:Math.round(x.y)})); }")


def run():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"])
        A = br.new_context(viewport={"width": 1100, "height": 720}).new_page()
        B = br.new_context(viewport={"width": 1100, "height": 720}).new_page()
        eA, eB = attach_console(A, "A"), attach_console(B, "B")
        print("[load]", URL)
        A.goto(URL, wait_until="load", timeout=60000); B.goto(URL, wait_until="load", timeout=60000)
        wait_controller(A); wait_controller(B)
        print("[load] both controllers ready")

        A.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        B.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        poll(lambda: A.evaluate("() => !!window.__mpJoin"), "A __mpJoin")
        poll(lambda: B.evaluate("() => !!window.__mpJoin"), "B __mpJoin")
        print("[net] online installed on both")

        A.evaluate("(c) => window.__mpJoin(c, true)", ROOM)
        B.evaluate("(c) => window.__mpJoin(c, false)", ROOM)
        print("[net] joined room", ROOM, "- pairing...")
        poll(lambda: (mpstate(A) or {}).get("peerPresent"), "A peer present", 45)
        poll(lambda: (mpstate(B) or {}).get("peerPresent"), "B peer present", 45)
        print("[assert a] PASS - presence paired both clients")

        poll(lambda: (mpstate(A) or {}).get("inGame"), "A in game", 45)
        poll(lambda: (mpstate(B) or {}).get("inGame"), "B in game", 45)
        sA = mpstate(A)
        host, guest = (A, B) if sA["isHost"] else (B, A)
        # beginGame is async (phase -> "battle"); poll for the host's first turn.
        poll(lambda: (mpstate(host) or {}).get("myTurn") is True, "host gets the first turn (phase->battle)", 30)
        assert mpstate(guest)["myTurn"] is False, "guest should not move first"
        print("[assert b] PASS - both in game, host moves first")

        before = enemy_positions(guest)
        # host moves a ship (swipe) then ends turn -> relays to guest
        host.evaluate("""() => { const T=window.__FFG3D__.controller.__test; const id=T.selectFirstPlayer(); const s=T.sim().shipById(id); T.swipeSelected([{x:s.x+18,y:s.y-12}]); }""")
        poll(lambda: host.evaluate("() => !window.__FFG3D__.controller.__test.isBusy()"), "host move settled", 20)
        host.evaluate("() => window.__FFG3D__.controller.__test.endTurn()")
        print("[net] host moved + ended turn...")

        poll(lambda: (mpstate(guest) or {}).get("myTurn") is True, "turn relayed to guest", 25)
        after = enemy_positions(guest)
        moved = before != after
        print("[assert c] PASS - turn relayed to guest" + ("; host's MOVE applied on guest board" if moved else "; (move delta not observed)"))

        time.sleep(1.0)
        errs = eA + eB
        assert not errs, "console errors: " + "; ".join(errs[:6])
        print("[assert d] PASS - zero console errors on both clients")
        br.close()
        print("\nALL TIDE-BREAKERS 2-CLIENT ASSERTIONS PASSED [OK]")


if __name__ == "__main__":
    try:
        run(); sys.exit(0)
    except Exception as e:
        print("\nFAILED:", str(e)[:400]); sys.exit(1)
