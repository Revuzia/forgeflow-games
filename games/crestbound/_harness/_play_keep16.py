"""PLAYTEST — THE KEEP, run 16: the tree that grabs you. Walk past it, and once
stuck, try every way a player would try to get down."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 900
    P.click_title(); P.wait(3000)

    P.say("=== WALK PAST THE TREE AT (-13, 0, 20). A player crossing the lawn west. ===")
    P.tp(-6.0, 0.5, 20.0); P.wait(1000)
    P.face(-30, 20)
    s = P.hold(["W"], 4000, sample_ms=250, tag="walk west across the lawn, straight past the tree")
    P.say("   y trace:", [round(x["pos"][1], 2) for x in s])
    P.say("   states :", [x["pstate"] for x in s])
    P.say("   ended  :", P.pos())
    P.shot("tree_grabbed_me")

    if P.pos()[1] > 1.0:
        P.say("   STUCK UP THE TREE. Now every way down a player would try:")
        for name, fn in [
            ("hold S (back away)", lambda: P.hold(["S"], 1800)),
            ("hold A (sidestep)", lambda: P.hold(["A"], 1800)),
            ("jump (climb kick)", lambda: (P.tap("SPACE", 220), P.wait(1200))),
            ("jump twice", lambda: (P.tap("SPACE", 200), P.wait(400), P.tap("SPACE", 200), P.wait(1200))),
            ("crouch (let go)", lambda: P.hold(["C"], 1600)),
            ("S + jump", lambda: (P.down("S"), P.wait(300), P.tap("SPACE", 200), P.wait(1400), P.up("S"))),
        ]:
            before = P.pos()
            fn()
            P.wait(900)
            after = P.pos()
            P.say("     %-22s %s -> %s  %s" % (name, before, after, P.state()["pstate"]))
            P.shot("tree_escape_" + name.split()[0].strip("("))
            if after[1] < 0.6:
                P.say("     ...got down with: %s" % name)
                break

    P.say("=== and can I walk around it? ===")
    P.tp(-6.0, 0.5, 23.5); P.wait(1000)
    r = P.walk_to(-20.0, 23.5, tol=2.0, max_ms=10000, tag="west, 3.5 m south of the tree")
    P.say("   ->", P.pos(), "y", P.pos()[1])
    P.shot("tree_walked_around")

    P.say("=== all five trees: does each one grab? ===")
    for (tx, tz) in [(-13, 20), (13.5, 19.4), (7.8, 25.6), (-9.4, 43), (11.4, 41.5)]:
        P.tp(tx + 4.0, 0.5, tz); P.wait(900)
        P.face(tx - 8, tz)
        P.hold(["W"], 2600, sample_ms=300)
        p = P.pos()
        P.say("   tree (%s, %s): after walking through it the hero is at %s  %s"
              % (tx, tz, p, "GRABBED (y %.2f)" % p[1] if p[1] > 1.0 else "walked past ok"))

    P.dump("keep16")
