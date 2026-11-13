"""KEEP playtest pass B, run 5 — THE SPIRAL STAIR (lobby <-> undercroft).

The lobby sign says THE UNDERCROFT / mind the stair. Walk DOWN it from the
lobby, then walk back UP it, steering tread by tread the way a player steers
with the camera. Dump the tread stack so the risers can be judged.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB") as P:
    P.click_title(); P.wait(1200)

    # ---- the tread stack, as the collider sees it ----
    treads = P.js("""() => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase, hits = [];
        bp.query(new T.Box3(new T.Vector3(-18,-9.5,1.5), new T.Vector3(-8,1.5,12)), hits);
        return hits.map(c => ({ min:[+c.aabb.min.x.toFixed(2),+c.aabb.min.y.toFixed(2),+c.aabb.min.z.toFixed(2)],
                                max:[+c.aabb.max.x.toFixed(2),+c.aabb.max.y.toFixed(2),+c.aabb.max.z.toFixed(2)] }))
                   .sort((a,b) => a.max[1] - b.max[1]); }""")
    P.say("colliders in the stair well, by top height (%d):" % len(treads))
    for t in treads:
        P.say("   top y %6.2f   x %6.2f..%6.2f  z %6.2f..%6.2f" % (
            t["max"][1], t["min"][0], t["max"][0], t["min"][2], t["max"][2]))

    # tread centres, ordered top-down, for the descent
    centres = [((t["min"][0] + t["max"][0]) / 2, t["max"][1], (t["min"][2] + t["max"][2]) / 2)
               for t in treads if t["max"][1] < 0.2 and (t["max"][0] - t["min"][0]) < 5]
    centres.sort(key=lambda c: -c[1])
    P.say("tread centres (top-down):", json.dumps([[round(v, 2) for v in c] for c in centres]))

    # ---- descend from the lobby ----
    P.say("--- walking DOWN from the lobby ---")
    P.tp(-13.5, 0.2, 9.5); P.wait(500)
    P.shot("well_from_lobby")
    y = P.pos()[1]
    for i, c in enumerate(centres[:26]):
        P.face(c[0], c[2])
        P.hold(["W"], 520, sample_ms=520)
        st = P.state()
        if i % 4 == 0:
            P.shot("descend_%02d" % i)
        if st["pos"][1] < -7.6:
            P.say("  reached the undercroft floor after %d treads at %s" % (i, st["pos"]))
            break
    st = P.state()
    P.say("  DESCENT: y %.2f -> %.2f  pos %s state %s" % (y, st["pos"][1], st["pos"], st["pstate"]))
    P.shot("descend_end")

    # ---- climb back up ----
    P.say("--- walking UP from the undercroft ---")
    P.tp(-13.5, -7.8, 6.6); P.wait(500)
    P.shot("well_from_undercroft")
    up = sorted(centres, key=lambda c: c[1])
    y = P.pos()[1]
    best = y
    for i, c in enumerate(up[:26]):
        P.face(c[0], c[2])
        P.hold(["W"], 520, sample_ms=520)
        st = P.state()
        best = max(best, st["pos"][1])
        if i % 4 == 0:
            P.shot("ascend_%02d" % i)
        if st["pos"][1] > -0.2:
            P.say("  reached the lobby floor after %d treads at %s" % (i, st["pos"]))
            break
    st = P.state()
    P.say("  ASCENT: y %.2f -> %.2f (best %.2f)  pos %s state %s" % (y, st["pos"][1], best, st["pos"], st["pstate"]))
    P.shot("ascend_end")
    P.dump("keepB5")
