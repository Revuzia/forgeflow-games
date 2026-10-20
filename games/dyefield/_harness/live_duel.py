"""LIVE DUEL smoke (owner 2026-10-19): two real browsers, the LIVE CDN page, the DEPLOYED relay, the real PLAY ONLINE screens.
Part 1 (room): A picks DUEL and creates a room -> B joins by code -> A starts -> the match has exactly 2 runners, both human, on
opposite crews, and each page sees the OTHER human's runner move.
Part 2 (quick match): both pick DUEL and press QUICK MATCH -> they are paired with each other at once (one room, a live match).
Reuses netlobby_live.Page. Usage: python _harness/live_duel.py [base_url]. Prints a JSON verdict; exit 0 only on PASS."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import netlobby_live as N

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://forgeflow-games-cdn.isimcha85.workers.dev/dyefield/index.html"
checks = []


def check(name, ok, detail=""):
    checks.append((name, bool(ok), str(detail)[:240]))
    print(("PASS " if ok else "FAIL ") + name + ("  -  " + str(detail)[:200] if detail else ""), flush=True)
    return ok


RUNNERS_JS = """() => { try { const m = window.__DF__.match(); return (m.runners || []).map(r => ({ id: r.id, name: r.name, team: r.team, x: r.x, z: r.z })); } catch (e) { return null; } }"""
LIVE_JS = "() => (window.__DF__ && window.__DF__.match && (window.__DF__.match() || {}).phase) === 'live' || null"


def set_profile(p, name):
    p.ev("(n) => { try { const k = 'dyefield.profile.v1'; const o = JSON.parse(localStorage.getItem(k) || '{}'); o.name = n; o.mode = 'duel'; o.rule = 'turf'; localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }", name)


def click_to_play(p, tries=40):
    for _ in range(tries):
        if p.ev(N.PLAY_GATE_JS):
            p.page.mouse.click(550, 320)
            return True
        time.sleep(0.5)
    return False


def snap(viewer):
    return {r["name"]: (r["x"], r["z"]) for r in (viewer.ev(RUNNERS_JS) or [])}


def moved(viewer, before):
    after = snap(viewer)
    return {n: round(((after[n][0] - before[n][0]) ** 2 + (after[n][1] - before[n][1]) ** 2) ** 0.5, 2) for n in before if n in after}


def fresh_pair(b):
    A, B = N.Page(b, "A", BASE), N.Page(b, "B", BASE)
    for p, nm in ((A, "Alder"), (B, "Birch")):
        check("%s: the live page boots to the title menu" % p.name, p.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase) === 'menu' || null", 120), p.errors[:2])
        set_profile(p, nm)
        p.page.reload(); p.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase) === 'menu' || null", 120)
    return A, B


with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"])
    A = B = None
    try:
        # ---------------- part 1: CREATE ROOM / JOIN ROOM in DUEL ----------------
        A, B = fresh_pair(b)
        check("A: PLAY ONLINE opens the online home", A.click("#dfm-play-online", 60) and bool(A.wait_screen("home", 60)), A.screen())
        check("A: DUEL is the picked online mode", A.ev("() => { const x = document.getElementById('dfo-mode-duel'); return !!x && x.classList.contains('on'); }"))
        check("A: CREATE ROOM reaches the room screen", A.click("#dfo-door-create") and bool(A.wait_screen("room", 60)), A.screen())
        code = ""
        for _ in range(40):
            code = N.room_code(A)
            if len(code) >= 4: break
            time.sleep(0.5)
        check("A: the deployed relay issued a room code", len(code) >= 4, code)
        check("B: PLAY ONLINE opens the online home", B.click("#dfm-play-online", 60) and bool(B.wait_screen("home", 60)), B.screen())
        check("B: JOIN ROOM reaches the code screen", B.click("#dfo-door-join") and bool(B.wait_screen("join", 30)), B.screen())
        B.page.keyboard.type(code, delay=60)
        B.click("#dfo-join-go")
        check("B: joining by the code reaches the room screen", bool(B.wait_screen("room", 60)), B.screen())
        time.sleep(3)
        room = A.ev("() => ({ mode: (document.querySelector('.dfo-roomsetup [data-opt=mode] .dfo-val') || {}).textContent || null, count: (document.querySelector('.dfo-count') || {}).textContent || null, seats: [...document.querySelectorAll('.dfo-seat')].filter(s => !s.hidden).length })")
        check("A: the room reads DUEL with 2 seats (2 / 2)", room and "DUEL" in str(room.get("mode")) and room.get("count") == "2 / 2" and room.get("seats") == 2, room)
        A.shot("duelroom"); B.shot("duelroom")
        check("A: START is available (the second duelist is seated)", A.click("#dfo-start"), A.errors[-1:])
        for p in (A, B):
            click_to_play(p)
        live = {p.name: bool(p.wait(LIVE_JS, 120)) for p in (A, B)}
        check("both pages reach a LIVE duel", all(live.values()), live)
        time.sleep(2)
        ra, rb = A.ev(RUNNERS_JS) or [], B.ev(RUNNERS_JS) or []
        HUMANS = {"Alder", "Birch"}
        human = lambda r: r["name"] in HUMANS or str(r["name"]).startswith("GUEST-")   # the saved name, else the relay's guest name
        check("the duel has exactly 2 runners, both the two humans, on opposite crews",
              len(ra) == 2 and all(human(r) for r in ra) and len({r["team"] for r in ra}) == 2, ra)
        check("both pages agree on the 2 runners", sorted(r["name"] for r in ra) == sorted(r["name"] for r in rb), rb)
        b_before = snap(B)
        A.page.keyboard.down("KeyW"); time.sleep(3.5); A.page.keyboard.up("KeyW"); time.sleep(1.5)
        mv1 = moved(B, b_before)
        check("A walks, B idles: on B's screen exactly one runner moved >= 3 m (A's, over the relay)", sorted(v >= 3.0 for v in mv1.values()) == [False, True], mv1)
        a_before = snap(A)
        B.page.keyboard.down("KeyD"); time.sleep(3.5); B.page.keyboard.up("KeyD"); time.sleep(1.5)
        mv2 = moved(A, a_before)
        check("B strafes, A idles: on A's screen exactly one runner moved >= 2 m (B's, over the relay)", sorted(v >= 2.0 for v in mv2.values()) == [False, True], mv2)
        A.shot("duelmatch"); B.shot("duelmatch")
        errs = {p.name: p.real_errors()[:3] for p in (A, B)}
        check("no page / console errors (room duel)", not any(errs.values()), errs)
        A.close(); B.close(); A = B = None

        # ---------------- part 2: QUICK MATCH in DUEL ----------------
        A, B = fresh_pair(b)
        for p in (A, B):
            check("%s: PLAY ONLINE opens the online home" % p.name, p.click("#dfm-play-online", 60) and bool(p.wait_screen("home", 60)), p.screen())
        t0 = time.time()
        A.click("#dfo-door-qm"); time.sleep(0.4); B.click("#dfo-door-qm")
        for p in (A, B):
            click_to_play(p)
        live = {}
        for p in (A, B):
            live[p.name] = bool(p.wait(LIVE_JS, 90))
            click_to_play(p, 4)
        took = time.time() - t0
        check("DUEL quick match: both reach a LIVE match", all(live.values()), live)
        ra = A.ev(RUNNERS_JS) or []
        check("DUEL quick match: they were paired with EACH OTHER (2 human runners, no bot fill)",
              len(ra) == 2 and {r["name"] for r in ra} <= {"Alder", "Birch"} | {r["name"] for r in ra if str(r["name"]).startswith("GUEST-")}, ra)
        check("DUEL quick match: paired in under 30 s (no 30-60 s fill wait)", took < 30, "%.1f s" % took)
        errs = {p.name: p.real_errors()[:3] for p in (A, B)}
        check("no page / console errors (quick duel)", not any(errs.values()), errs)
    except Exception as e:
        check("live duel test ran to the end", False, repr(e)[:300])
    finally:
        for p in (A, B):
            if p:
                try: p.shot("end"); p.close()
                except Exception: pass
        b.close()

fails = [c for c in checks if not c[1]]
print(json.dumps({"verdict": "PASS" if not fails else "FAIL", "passed": len(checks) - len(fails), "failed": [c[0] for c in fails]}))
sys.exit(0 if not fails else 1)
