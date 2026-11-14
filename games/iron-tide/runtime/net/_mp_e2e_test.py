"""_mp_e2e_test.py — 2-CLIENT end-to-end test for Iron Tide ONLINE play.

Spins up TWO independent browser contexts, both load the iron-tide index, both
join the SAME private room (A=host, B=guest) over the real Supabase Realtime
transport, both auto-place their fleets and signal ready, then trade fire over
the network. Asserts:
  (a) presence pairs the two clients,
  (b) both reach the in-game state with the host moving first,
  (c) a fire from A produces a result back to A AND registers on B's own board,
  (d) turns alternate (A fires, then B fires, then A again),
  (e) ZERO console errors on either client,
  (f) the WebGL canvas renders (captured via canvas.toDataURL — NOT page.screenshot,
      which hangs on a continuously-rendering WebGL page).

Requires network access (esm.sh for supabase-js + the Supabase Realtime WS).

Run:  python runtime/net/_mp_e2e_test.py <base_url>
      e.g. python runtime/net/_mp_e2e_test.py http://localhost:8771
"""
import sys
import time
import base64

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8771"
URL = BASE + "/games/iron-tide/index.html"
ROOM = "TEST"  # both clients pair on this shared code

errors = {"A": [], "B": []}


def attach_console(page, tag):
    def on_console(msg):
        if msg.type == "error":
            errors[tag].append(msg.text)
    page.on("console", on_console)
    page.on("pageerror", lambda exc: errors[tag].append("PAGEERROR: " + str(exc)))


def wait_controller(page, timeout=45000):
    page.wait_for_function(
        "() => window.__FFG3D__ && window.__FFG3D__.controller && window.__FFG3D__.controller.__test",
        timeout=timeout,
    )


def mp_state(page):
    return page.evaluate("() => (window.__mpState ? window.__mpState() : null)")


def poll(fn, desc, timeout=40.0, interval=0.25):
    """Poll fn() until truthy or timeout. Returns last value."""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    raise TimeoutError("poll timed out waiting for: " + desc + " (last=" + repr(last) + ")")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctxA = browser.new_context(viewport={"width": 1100, "height": 720})
        ctxB = browser.new_context(viewport={"width": 1100, "height": 720})
        A = ctxA.new_page()
        B = ctxB.new_page()
        attach_console(A, "A")
        attach_console(B, "B")

        print("[load] opening both clients:", URL)
        A.goto(URL, wait_until="load", timeout=60000)
        B.goto(URL, wait_until="load", timeout=60000)
        wait_controller(A)
        wait_controller(B)
        print("[load] both controllers ready")

        # Boot the online module (lazy import of supabase-js) + install __mp* hooks.
        A.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        B.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        poll(lambda: A.evaluate("() => !!window.__mpJoin"), "A __mpJoin installed")
        poll(lambda: B.evaluate("() => !!window.__mpJoin"), "B __mpJoin installed")
        print("[net] online module installed on both")

        # Join the SAME room: A host, B guest. __mpJoin is async (connects + joins).
        A.evaluate("(code) => window.__mpJoin(code, true)", ROOM)
        B.evaluate("(code) => window.__mpJoin(code, false)", ROOM)
        print("[net] both joined room", ROOM, "— waiting for presence pairing…")

        # (a) presence pairs them
        poll(lambda: (mp_state(A) or {}).get("peerPresent"), "A sees peer present", timeout=45)
        poll(lambda: (mp_state(B) or {}).get("peerPresent"), "B sees peer present", timeout=45)
        print("[assert a] PASS — presence paired both clients")

        sA, sB = mp_state(A), mp_state(B)
        assert sA["isHost"] != sB["isHost"], "exactly one client must be host (A=%s B=%s)" % (sA["isHost"], sB["isHost"])
        host_tag = "A" if sA["isHost"] else "B"
        print("[net] host is client", host_tag)

        # Both auto-place fleets + signal ready.
        A.evaluate("() => window.__mpReady()")
        B.evaluate("() => window.__mpReady()")
        print("[net] both sent ready — waiting for in-game…")

        # (b) both reach in-game; host moves first
        poll(lambda: (mp_state(A) or {}).get("inGame"), "A in game", timeout=45)
        poll(lambda: (mp_state(B) or {}).get("inGame"), "B in game", timeout=45)
        sA, sB = mp_state(A), mp_state(B)
        host_page = A if sA["isHost"] else B
        guest_page = B if sA["isHost"] else A
        host_state = mp_state(host_page)
        assert host_state["myTurn"] is True, "host should move first (got myTurn=%s)" % host_state["myTurn"]
        assert mp_state(guest_page)["myTurn"] is False, "guest should NOT move first"
        print("[assert b] PASS — both in game, host moves first")

        # Snapshot guest's own-board shot count BEFORE the host fires.
        def guest_shotcount():
            return guest_page.evaluate(
                "() => { const s=window.__FFG3D__.controller.sim; let n=0; for(const row of s.player.shots) for(const v of row) if(v) n++; return n; }"
            )
        before = guest_shotcount()

        # (c) host fires at (3,3); result must come back to host AND register on guest's own board.
        host_page.evaluate("() => window.__mpFire(3,3)")
        print("[net] host fired at (3,3)…")

        # guest resolves on its OWN board -> its player.shots gains a cell at (3,3)
        poll(lambda: guest_shotcount() > before, "guest board registered the incoming shot", timeout=20)
        guest_marked = guest_page.evaluate(
            "() => { const s=window.__FFG3D__.controller.sim; return s.player.shots[3] && s.player.shots[3][3] !== 0; }"
        )
        assert guest_marked, "guest's own board must mark (3,3) as shot after resolving"

        # host receives the result: its pendingFire clears and the enemy shot grid marks (3,3)
        poll(lambda: (mp_state(host_page) or {}).get("pendingFire") is None, "host result resolved (pendingFire cleared)", timeout=20)
        host_enemy_marked = host_page.evaluate(
            "() => { const s=window.__FFG3D__.controller.sim; return s.enemy.shots[3] && s.enemy.shots[3][3] !== 0; }"
        )
        assert host_enemy_marked, "host's enemy-tracking board must mark (3,3) after the result"
        print("[assert c] PASS — fire from host resolved on guest's board AND returned a result to host")

        # (d) turns alternate: after the result, it's the GUEST's turn; guest fires back.
        poll(lambda: (mp_state(guest_page) or {}).get("myTurn") is True, "turn passed to guest", timeout=25)
        assert mp_state(host_page)["myTurn"] is False, "host should not have the turn after firing"
        print("[net] turn passed to guest — guest fires at (5,5)…")
        host_own_before = host_page.evaluate(
            "() => { const s=window.__FFG3D__.controller.sim; let n=0; for(const row of s.player.shots) for(const v of row) if(v) n++; return n; }"
        )
        guest_page.evaluate("() => window.__mpFire(5,5)")
        # host (now defender) registers (5,5) on its own board
        poll(lambda: host_page.evaluate(
            "() => { const s=window.__FFG3D__.controller.sim; let n=0; for(const row of s.player.shots) for(const v of row) if(v) n++; return n; }"
        ) > host_own_before, "host board registered guest's shot", timeout=20)
        # turn returns to host -> full alternation cycle observed
        poll(lambda: (mp_state(host_page) or {}).get("myTurn") is True, "turn returned to host", timeout=25)
        print("[assert d] PASS — turns alternate (host -> guest -> host)")

        # (f) canvas renders (toDataURL, NOT screenshot)
        for tag, page in (("A", A), ("B", B)):
            data = page.evaluate(
                "() => { const c=document.querySelector('canvas'); return c ? c.toDataURL('image/png').length : 0; }"
            )
            assert data and data > 5000, "%s canvas toDataURL too small (%s) — not rendering" % (tag, data)
        print("[assert f] PASS — both WebGL canvases render (toDataURL non-trivial)")

        # (e) zero console errors
        # (filter out benign favicon/network noise that isn't a real game error)
        def real_errors(lst):
            out = []
            for e in lst:
                el = e.lower()
                if "favicon" in el:
                    continue
                out.append(e)
            return out
        ea, eb = real_errors(errors["A"]), real_errors(errors["B"])
        if ea or eb:
            print("[assert e] CONSOLE ERRORS — A:", ea, "B:", eb)
        assert not ea and not eb, "console errors present (A=%d, B=%d)" % (len(ea), len(eb))
        print("[assert e] PASS — zero console errors on both clients")

        browser.close()
    print("\nALL 2-CLIENT ASSERTIONS PASSED [OK]")


if __name__ == "__main__":
    try:
        run()
        sys.exit(0)
    except Exception as e:
        print("\nTEST FAILED:", type(e).__name__, str(e))
        print("console A:", errors.get("A"))
        print("console B:", errors.get("B"))
        sys.exit(1)
