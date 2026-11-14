"""KEEP playtest pass B, run 14 — the camera indoors (P10), the balcony long
jump, and the two ramps standing outside the west curtain wall.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB14") as P:
    P.click_title(); P.wait(1500)

    # ---------- P10: camera distance while walking indoors ----------
    P.say("--- camera distance while walking through interiors (TUNE.cam.dist 6.8, minDist 1.6) ---")
    runs = [
        ("library nook", (12.0, 6.5, -18.0), (17.0, -21.0)),
        ("long hall north", (0.0, 6.5, -16.0), (0.0, -30.0)),
        ("undercroft", (-8.0, -7.8, -4.0), (-8.0, -10.5)),
        ("lobby under the stair arcade", (-9.4, 0.2, -6.0), (-9.4, -10.0)),
        ("gallery west leg", (-14.0, 6.5, -6.0), (-14.0, -13.0)),
    ]
    for tag, p, tgt in runs:
        P.tp(p[0], p[1], p[2]); P.wait(700)
        P.face(tgt[0], tgt[1]); P.wait(300)
        dists = []
        occl = 0
        P.down("W")
        for i in range(10):
            P.wait(260)
            st = P.state()
            dists.append(st["camDist"])
            if st["camDist"] is not None and st["camDist"] < 1.7:
                occl += 1
        P.up("W"); P.wait(300)
        P.shot("cam_" + tag.replace(" ", "_"))
        P.say("  %-28s camDist %s  (frames under 1.7 m: %d/10)  end %s" % (
            tag, [round(d, 2) if d else d for d in dists], occl, P.pos()))

    # a still frame at Fen with the numbers
    P.tp(18.2, 6.5, -21.0); P.wait(800); P.face(17.0, -21.0); P.wait(600)
    P.say("  standing 1.2 m from Fen:", json.dumps(P.state()))
    P.shot("cam_at_fen")

    # ---------- the balcony long jump ----------
    P.say("--- balcony (z 13.8..17.2, y 6.30) -> garden loft (z 23.2..27.2): a 6.00 m gap ---")
    P.tp(0, 6.5, 14.2); P.wait(800)
    P.say("  on the balcony:", json.dumps(P.state()))
    P.shot("balcony_standing")
    P.face(0, 30.0); P.wait(300)
    P.shot("balcony_looking_at_the_loft")
    for attempt in range(3):
        P.tp(0, 6.5, 14.0); P.wait(600)
        P.face(0, 30.0)
        P.down("W"); P.wait(760)          # run up
        st = P.state()
        P.say("   attempt %d run-up speed %.2f" % (attempt, (st["vel"][0] ** 2 + st["vel"][2] ** 2) ** 0.5))
        P.down("C"); P.wait(50); P.down("SPACE"); P.wait(180); P.up("SPACE"); P.up("C")
        P.wait(1500); P.up("W"); P.wait(900)
        st = P.state()
        P.say("   attempt %d -> %s state=%s" % (attempt, st["pos"], st["pstate"]))
        P.shot("longjump_attempt%d" % attempt)
        if st["pos"][1] > 5.5 and st["pos"][2] > 23.0:
            P.say("   MADE THE LOFT")
            break

    # ---------- the two ramps outside the west curtain wall ----------
    P.say("--- ramps at x -26.1 / -27.9, y 5.8 / 6.5, z 12.4 (the west curtain wall is x -25.2..-24) ---")
    P.tp(-22.0, 0.3, 12.4); P.wait(700)
    P.face(-30.0, 12.4); P.wait(400)
    P.js("() => { CRESTBOUND.game.cam.pitch = 0.35; }"); P.wait(400)
    P.shot("ramps_from_inside")
    P.tp(-30.0, 8.0, 12.4); P.wait(700)
    P.face(-24.0, 12.4); P.wait(400)
    P.shot("ramps_from_outside")
    P.say("  standing outside the wall:", json.dumps(P.state()))
    outside = P.js("""() => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase, hits = [];
        bp.query(new T.Box3(new T.Vector3(-32,0,8), new T.Vector3(-25,12,18)), hits);
        return hits.map(c => ({y:[+c.aabb.min.y.toFixed(2),+c.aabb.max.y.toFixed(2)],
            x:[+c.aabb.min.x.toFixed(2),+c.aabb.max.x.toFixed(2)],
            z:[+c.aabb.min.z.toFixed(2),+c.aabb.max.z.toFixed(2)]})); }""")
    P.say("  colliders OUTSIDE the west curtain wall (x < -25):")
    for o in outside:
        P.say("     y %5.2f..%5.2f  x %6.2f..%6.2f  z %6.2f..%6.2f" % (
            o["y"][0], o["y"][1], o["x"][0], o["x"][1], o["z"][0], o["z"][1]))
    P.dump("keepB14")
