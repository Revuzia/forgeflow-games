"""Two decisive maps: (1) the crusher cave floor along z=-2, (2) the shrine cap
and the warden's arena, avoiding the crest so the COURSE CLEAR card never freezes
the sim. Plus one wide shot of the stair viaduct."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run


def drop(g, x, y, z, settle=2200):
    g.tp(x, y, z)
    g.wait(settle)
    s = g.snap()
    p = s.get("p") or [0, 0, 0]
    return p, s


def body(g):
    g.start("rime-3", cp=4)                       # cp-terrace
    g.say("== (1) the CRUSHER CAVE floor along z = -2, dropping from y = 21.5 ==")
    g.say("     (cave floor is authored EXACTLY 19.60; hammers at x 23.0 / 20.5 / 18.0)")
    for x in (25.0, 24.0, 23.0, 22.0, 21.0, 20.0, 19.0, 18.0, 17.0, 16.0, 15.0, 14.0):
        p, s = drop(g, x, 21.5, -2.0)
        g.say("   x=%5.1f -> landed [%6.2f,%7.2f,%6.2f] ps=%s surf=%s %s"
              % (x, p[0], p[1], p[2], s.get("ps"), s.get("surf"),
                 "NO FLOOR - FELL THROUGH" if p[1] < 15 else ""))
        if s.get("ps") == "dead" or p[1] < 0:
            g.wait(1500)
    g.shot("cave_floor_map")

    g.say("== (2) the SHRINE CAP / WARDEN ARENA, dropping from 38.5 (never touching (0,-4)) ==")
    g.say("     arena is c=[0,-4] r=7.0, so it spans z -11 .. +3; the warden stands at (0,-9)")
    for z in (-4, -6, -8, -9, -10, -11, -12):
        row = []
        for x in (-6, -3, 3, 6):
            p, s = drop(g, x, 38.5, z, settle=1800)
            row.append("x%+d:%6.2f%s" % (x, p[1], "*" if math.hypot(p[0] - x, p[2] - z) > 2 else " "))
        g.say("   z=%4d  %s   (* = slid more than 2 m)" % (z, "  ".join(row)))
    g.shot("cap_map")

    g.say("== the warden's own footing at (0, 38.5, -9) ==")
    p, s = drop(g, 0.0, 38.5, -9.0, settle=2600)
    g.say("   -> %s ps=%s surf=%s" % (p, s.get("ps"), s.get("surf")))
    g.look(0, -4); g.wait(600); g.shot("warden_footing")

    g.say("== a wide look at the stair viaduct from the north-east ==")
    g.tp(22.0, 28.0, -16.0); g.wait(1200)
    g.look(12.0, -7.0); g.pitch(0.05); g.wait(900); g.shot("viaduct_wide")
    g.tp(4.0, 30.0, -18.0); g.wait(1200)
    g.look(12.0, -7.0); g.wait(900); g.shot("viaduct_wide2")


run("final", body)
