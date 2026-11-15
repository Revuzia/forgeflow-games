"""_mp_stream_test.py — 2-CLIENT test that the opponent's turn STREAMS one ship at a time.

Regression test for the owner's report: "he has to move all 5 pieces for me to see ANY
movement." The fix streams each action live ("act" msg) so the guest watches the host's turn
unfold ship-by-ship, instead of only after endTurn. Asserts:
  (a) presence pairs; both in game; host moves first
  (b) after EACH host move — with NO endTurn yet — the guest's board changes (live streaming),
      and each change moves exactly ONE ship (one at a time, not a batch)
  (c) endTurn does NOT double-apply (guest board stable across the turn commit) + turn flips
  (d) zero console errors on both clients

Run: serve repo root, then
     python games/tide-breakers/runtime/net/_mp_stream_test.py http://127.0.0.1:8771
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8771"
URL = BASE + "/games/tide-breakers/index.html"
ROOM = "TBSTREAM"


def attach_console(page, tag):
    errs = []
    page.on("console", lambda m: errs.append(f"[{tag}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"[{tag}] PAGEERROR {str(e)[:160]}"))
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
        time.sleep(0.2)
    raise TimeoutError("timed out: " + desc + " (last=" + repr(last) + ")")


def enemy_pos(page):
    # guest sees the host's ships as the ENEMY fleet (mirrored). {id: (x,y)}
    return page.evaluate("() => { const s=window.__FFG3D__.controller.__test.sim(); const o={}; s.shipsOf('enemy').forEach(x=>o[x.id]=[Math.round(x.x),Math.round(x.y)]); return o; }")


def changed_ids(a, b):
    return [k for k in b if k in a and a[k] != b[k]]


def host_move_one_ship(host):
    # pick a READY player ship on the host, select it, swipe a small legal path. Returns its id or None.
    return host.evaluate("""() => {
        const T = window.__FFG3D__.controller.__test, sim = T.sim();
        const ready = sim.shipsOf('player').filter(s => !s.sunk && s.actionsLeft > 0);
        if (!ready.length) return null;
        const s = ready[0];
        T.selectShip(s.id);
        // a short legal swipe (small offset stays within the move budget)
        T.swipeSelected([{ x: s.x + 14, y: s.y - 10 }]);
        return s.id;
    }""")


def run():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"])
        A = br.new_context(viewport={"width": 1100, "height": 720}).new_page()
        B = br.new_context(viewport={"width": 1100, "height": 720}).new_page()
        eA, eB = attach_console(A, "A"), attach_console(B, "B")
        print("[load]", URL)
        A.goto(URL, wait_until="load", timeout=60000); B.goto(URL, wait_until="load", timeout=60000)
        wait_controller(A); wait_controller(B)
        A.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        B.evaluate("() => window.__FFG3D__.controller.__test.startOnline()")
        poll(lambda: A.evaluate("() => !!window.__mpJoin"), "A __mpJoin")
        poll(lambda: B.evaluate("() => !!window.__mpJoin"), "B __mpJoin")
        A.evaluate("(c) => window.__mpJoin(c, true)", ROOM)
        B.evaluate("(c) => window.__mpJoin(c, false)", ROOM)
        poll(lambda: (mpstate(A) or {}).get("peerPresent"), "A peer", 45)
        poll(lambda: (mpstate(B) or {}).get("peerPresent"), "B peer", 45)
        poll(lambda: (mpstate(A) or {}).get("inGame"), "A in game", 45)
        poll(lambda: (mpstate(B) or {}).get("inGame"), "B in game", 45)
        sA = mpstate(A)
        host, guest = (A, B) if sA["isHost"] else (B, A)
        poll(lambda: (mpstate(host) or {}).get("myTurn") is True, "host first turn", 30)
        print("[assert a] PASS - paired, in game, host moves first")

        # (b) stream 3 host moves; after EACH — WITHOUT ending turn — the guest board must change,
        #     and each change must move exactly ONE ship (live, one at a time).
        snap = enemy_pos(guest)
        streamed = 0
        for i in range(3):
            poll(lambda: host.evaluate("() => !window.__FFG3D__.controller.__test.isBusy()"), "host idle before move", 20)
            mid = host_move_one_ship(host)
            if not mid:
                break
            poll(lambda: host.evaluate("() => !window.__FFG3D__.controller.__test.isBusy()"), "host move settled", 20)
            # guest must see it LIVE — turn NOT ended yet
            new = poll(lambda: (enemy_pos(guest) if changed_ids(snap, enemy_pos(guest)) else None), f"guest sees move {i+1} live (pre-endTurn)", 20)
            ch = changed_ids(snap, new)
            assert len(ch) == 1, f"move {i+1}: expected ONE ship to change, got {ch}"
            assert guest.evaluate("() => window.__FFG3D__.controller.__test.liveApplied()") >= i + 1, "guest liveApplied did not increment"
            assert mpstate(guest)["myTurn"] is False, "guest turn should NOT have flipped mid-stream"
            print(f"[stream] move {i+1}: guest saw ship {ch[0]} move LIVE before endTurn (one at a time)")
            snap = new
            streamed += 1
        assert streamed >= 2, f"expected to stream >=2 live moves, got {streamed}"
        print(f"[assert b] PASS - {streamed} host moves streamed to guest ONE AT A TIME (before endTurn)")

        # (c) commit the turn: no double-apply (board stable) + turn flips to guest
        before_commit = enemy_pos(guest)
        host.evaluate("() => window.__FFG3D__.controller.__test.endTurn()")
        poll(lambda: (mpstate(guest) or {}).get("myTurn") is True, "turn flips to guest after commit", 25)
        time.sleep(0.6)
        after_commit = enemy_pos(guest)
        assert before_commit == after_commit, f"endTurn DOUBLE-APPLIED (board jumped): {changed_ids(before_commit, after_commit)}"
        assert guest.evaluate("() => window.__FFG3D__.controller.__test.liveApplied()") == 0, "liveApplied not reset after commit"
        print("[assert c] PASS - endTurn did NOT double-apply; turn flipped to guest")

        time.sleep(0.8)
        errs = eA + eB
        assert not errs, "console errors: " + "; ".join(errs[:6])
        print("[assert d] PASS - zero console errors on both clients")
        br.close()
        print("\nALL TIDE-BREAKERS STREAMING ASSERTIONS PASSED [OK]")


if __name__ == "__main__":
    try:
        run(); sys.exit(0)
    except Exception as e:
        print("\nFAILED:", str(e)[:400]); sys.exit(1)
