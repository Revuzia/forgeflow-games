"""PLAYTEST — THE KEEP, run 6: one fair last attempt at the stair face with a
long run-up triple, then the gallery loop done on the RIGHT deck, the long hall,
the library nook, OLD FEN, the three rime paintings and the balcony long jump."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 100
    P.click_title(); P.wait(2500)

    P.say("=== 1. LAST FAIR TRY: a long run-up triple jump at the stair face ===")
    for backoff, t1, t2 in [(8.0, 500, 520), (10.0, 620, 560), (12.0, 700, 600)]:
        P.tp(-13.0, 0.05, -4.20 + backoff); P.wait(450)
        P.face(-13, -40)
        P.down("W"); P.wait(500)
        P.tap("SPACE", 200); P.wait(t1)
        P.tap("SPACE", 200); P.wait(t2)
        P.tap("SPACE", 200); P.wait(1200)
        P.up("W"); P.wait(800)
        p = P.pos()
        P.say("   run-up %.0f m triple -> %s  %s" % (backoff, p, "ON THE LANDING" if p[1] > 2.4 else "no"))
    P.shot("stair_triple_last_try")

    P.say("=== 2. THE GALLERY LOOP, on the decks that actually exist ===")
    P.tp(-18.0, 6.40, -11.0); P.wait(700)
    P.say("  start", P.pos())
    P.shot("gal_west_leg")
    for (x, z, tag) in [(-18.0, 6.0, "west leg south"), (-18.0, 11.5, "SW corner"),
                        (0.0, 11.5, "south leg"), (18.0, 11.5, "SE corner"),
                        (18.0, -11.0, "east leg north"), (10.0, -12.5, "north deck")]:
        P.walk_to(x, z, tol=1.7, max_ms=10000, tag=tag)
        P.shot("gal_" + tag.replace(" ", "_"))
    P.say("  y all the way round:", P.pos()[1])

    P.say("=== 3. NORTH THROUGH THE DOORWAY INTO THE LONG HALL ===")
    P.tp(0.0, 6.40, -12.5); P.wait(500)
    P.face(0, -40)
    s = P.hold(["W"], 5000, sample_ms=250, tag="walk north into the long hall")
    P.say("   ->", P.pos(), "states", sorted(set(x["pstate"] for x in s)))
    P.shot("longhall_entered")
    P.walk_to(0.0, -24.0, tol=1.6, max_ms=9000, tag="up the long hall")
    P.shot("longhall_mid")

    P.say("=== 4. THE RIME PAINTINGS (18 / 22 / 26 crests — SEALED for a new player) ===")
    for g in [x for x in P.gates() if x["course"].startswith("rime")]:
        P.say("  gate", g["course"], g)
        P.walk_to(g["exit"][0], g["exit"][2], tol=1.3, max_ms=10000, tag="to " + g["course"])
        P.face(g["pos"][0], g["pos"][2]); P.wait(400)
        P.shot("rime_%s_readable" % g["course"])
        P.down("W"); P.wait(1800); P.up("W"); P.wait(900)
        st = P.state()
        P.say("   walked into a SEALED gate ->", st["gstate"], "card", st["cardOpen"],
              "toast:", P.js("""() => { const t=[...document.querySelectorAll('.cb-toast,.cb-hud-toast')]
                 .map(e=>e.innerText.trim()).filter(Boolean); return t.slice(-2); }"""))
        P.shot("rime_%s_after_walkin" % g["course"])

    P.say("=== 5. THE LIBRARY NOOK AND OLD FEN (17, 6.35, -21) ===")
    P.tp(14.0, 6.40, -21.0); P.wait(600)
    P.walk_to(16.0, -21.0, tol=1.4, max_ms=9000, tag="into the nook")
    P.face(17.0, -21.0); P.wait(400)
    P.shot("fen_approach")
    P.say("   prompt on screen:", P.js("""() => { const e=document.querySelector('.cb-prompt,.cb-interact');
        return e ? e.innerText.trim() : null; }"""))
    for i in range(7):
        P.tap("E", 140); P.wait(1400)
        line = P.js("""() => { const e=[...document.querySelectorAll('.cb-toast,.cb-say,.cb-dialog,.cb-hud-toast')]
            .map(x=>x.innerText.trim()).filter(Boolean); return e.slice(-1)[0] || null; }""")
        P.say("   FEN %d: %s" % (i + 1, repr(line)[:220]))
        if i < 3:
            P.shot("fen_line%d" % (i + 1))

    P.dump("keep6")
