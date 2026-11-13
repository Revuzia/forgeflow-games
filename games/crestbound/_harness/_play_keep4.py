"""PLAYTEST — THE KEEP, run 4: the middle flight's colliders, and whether a
player can reach the gallery AT ALL without the grand stair."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

BOXES = """(q) => { const THREE = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
    const aabb = new THREE.Box3(new THREE.Vector3(q[0],q[1],q[2]), new THREE.Vector3(q[3],q[4],q[5]));
    const res = []; bp.query(aabb, res);
    return res.map(c => ({ min:[+c.aabb.min.x.toFixed(2),+c.aabb.min.y.toFixed(2),+c.aabb.min.z.toFixed(2)],
        max:[+c.aabb.max.x.toFixed(2),+c.aabb.max.y.toFixed(2),+c.aabb.max.z.toFixed(2)] }))
      .sort((a,b)=>a.min[2]-b.min[2]); }"""

with Play("keep") as P:
    P.n = 60
    P.click_title(); P.wait(2500)

    P.say("=== MIDDLE FLIGHT COLLIDERS (def says: z -8.34 y2.70  ->  z -2.82 y6.30) ===")
    for b in P.js(BOXES, [-4.5, 2.5, -9.0, 4.5, 7.0, -2.0])[:20]:
        P.say("   ", b)

    P.say("=== WEST FLANK, tread tops as walked (def says low step at the LOBBY end z -4.20) ===")
    P.say("    measured in run 3: z -8.34..-7.88 top 0.30 (landing end) ... z -4.66..-4.20 top 2.70 (lobby end)")

    P.say("=== CAN A PLAYER GET UPSTAIRS AT ALL? ===")
    # 1. the stair, on foot, from the lobby
    P.tp(0.0, 0.05, -1.0); P.wait(400)
    P.face(0, -30)
    s = P.hold(["W"], 4000, sample_ms=250, tag="run north up the middle of the lobby")
    P.say("  straight north from the mosaic ->", P.pos(), "states", sorted(set(x["pstate"] for x in s)))
    P.shot("upstairs_blocked_north")

    # 2. run at it and jump / triple / long jump like a player would when stuck
    P.say("  -- a player who is stuck WILL try to jump the wall. 2.70 m; single apex 1.91 --")
    P.tp(-13.0, 0.05, -1.0); P.wait(400)
    P.face(-13, -30)
    P.down("W"); P.wait(900)
    P.tap("SPACE", 220); P.wait(700)
    P.up("W"); P.wait(400)
    P.say("   run + single jump at the stair face ->", P.pos(), P.state()["pstate"])
    P.shot("upstairs_singlejump")

    P.tp(-13.0, 0.05, -1.0); P.wait(400)
    P.face(-13, -30)
    P.down("W"); P.wait(700)
    for _ in range(3):                       # try to chain a triple into the wall
        P.tap("SPACE", 130); P.wait(260)
    P.wait(600); P.up("W"); P.wait(600)
    P.say("   run + jump chain at the stair face ->", P.pos(), P.state()["pstate"])
    P.shot("upstairs_triple")

    # 3. the balcony/loft route and the tower — is there another way up?
    P.say("=== 4. IS THERE ANY OTHER ROUTE TO y 6.30? (walk the whole lobby perimeter) ===")
    P.tp(0.0, 0.05, 12.0); P.wait(400)
    ring = [(-18, 12), (-18, -12), (18, -12), (18, 12), (0, 12)]
    for (x, z) in ring:
        r = P.walk_to(x, z, tol=1.5, max_ms=9000, tag="perimeter")
        P.shot("perimeter_%d_%d" % (x, z))
        P.say("     y here:", P.pos()[1])

    P.say("=== 5. HOW MANY `kind:'stairs'` FLIGHTS ARE IN THE KEEP, and where do they lead ===")
    st = P.js("""() => { const objs = CRESTBOUND.game.course.def.objects || [];
        return objs.filter(o => o.kind === 'stairs').map(o => ({p:o.p, n:o.n, rise:o.rise, run:o.run,
            rot: o.rot, top:o.top, len:o.len, w:o.w})); }""")
    for s2 in st:
        P.say("   ", s2)

    P.dump("keep4")
