"""PLAYTEST — THE KEEP, run 15 (last): is the wall-kick tower actually built, the
balcony long jump with its real 8 m run-up, and a walk of the whole courtyard."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

BOX = """(q) => { const THREE = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
    const aabb = new THREE.Box3(new THREE.Vector3(q[0],q[1],q[2]), new THREE.Vector3(q[3],q[4],q[5]));
    const res = []; bp.query(aabb, res);
    return res.map(c => ({ y:[+c.aabb.min.y.toFixed(2),+c.aabb.max.y.toFixed(2)],
      x:[+c.aabb.min.x.toFixed(1),+c.aabb.max.x.toFixed(1)], z:[+c.aabb.min.z.toFixed(1),+c.aabb.max.z.toFixed(1)] }))
      .sort((a,b)=>a.y[0]-b.y[0]).slice(0, 26); }"""

with Play("keep") as P:
    P.n = 800
    P.click_title(); P.wait(3000)

    P.say("=== 1. IS THE WALL-KICK TOWER BUILT? colliders in the drum (x -20..-14, z 33..39) ===")
    for b in P.js(BOX, [-20.5, -1, 32.5, -13.5, 14, 39.5]):
        P.say("   y %6.2f..%6.2f  x %6.1f..%6.1f  z %6.1f..%6.1f" % (b["y"][0], b["y"][1], b["x"][0], b["x"][1], b["z"][0], b["z"][1]))
    P.tp(-17.0, 1.0, 35.0); P.wait(1200)
    P.say("   standing in the shaft ->", P.pos(), "surface", P.state()["surface"])
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.75; c.dist = 3.0; }")
    P.wait(700)
    P.shot("tower_shaft_up")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.15; c.dist = 9.0; }")
    P.tp(-17.0, 1.0, 44.0); P.wait(1000)
    P.face(-17, 33); P.wait(400)
    P.shot("tower_from_the_north")
    P.tp(-9.0, 1.0, 35.0); P.wait(1000)
    P.face(-17, 35); P.wait(400)
    P.shot("tower_from_the_east")

    P.say("=== 2. THE BALCONY LONG JUMP WITH ITS REAL RUN-UP (from the gallery, z 9) ===")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.05; c.dist = 6.8; }")
    for (z0, tag) in [(9.0, "8.2 m run-up"), (11.0, "6.2 m run-up")]:
        P.tp(0.0, 6.60, z0); P.wait(1200)
        P.face(0, 40); P.wait(400)
        P.shot("lj_start_%s" % tag.split()[0])
        P.down("W"); P.wait(950)
        P.down("C"); P.wait(60); P.tap("SPACE", 220); P.wait(60); P.up("C")
        P.wait(1600); P.up("W"); P.wait(1400)
        st = P.state()
        made = st["pos"][1] > 5.5
        P.say("   %s -> %s  %s  %s" % (tag, st["pos"], st["pstate"], "MADE THE LOFT" if made else "FELL INTO THE COURTYARD"))
        P.shot("lj_end_%s" % tag.split()[0])
    P.say("   and a TRIPLE jump across (safe 6.11 per keep.js):")
    P.tp(0.0, 6.60, 9.0); P.wait(1200)
    P.face(0, 40)
    P.down("W"); P.wait(600)
    P.tap("SPACE", 190); P.wait(470)
    P.tap("SPACE", 190); P.wait(470)
    P.tap("SPACE", 190); P.wait(1700)
    P.up("W"); P.wait(1300)
    st = P.state()
    P.say("   triple -> %s %s %s" % (st["pos"], st["pstate"], "MADE THE LOFT" if st["pos"][1] > 5.5 else "FELL"))
    P.shot("lj_triple_end")

    P.say("=== 3. WALK THE WHOLE COURTYARD (lawn x -24..26, z 13..48) ===")
    P.tp(0.0, 0.5, 17.0); P.wait(900)
    for (x, z, tag) in [(-20, 18, "SW of the lawn"), (-20, 44, "NW, by the tower"),
                        (0, 46, "the CRESTWAY, 60 crests"), (22, 44, "NE"),
                        (24, 30, "the azure-1 glass"), (10, 18, "back toward the doors")]:
        P.walk_to(x, z, tol=2.2, max_ms=12000, tag=tag)
        P.shot("yard_" + tag.split(",")[0].replace(" ", "_"))
        P.say("     surface", P.state()["surface"], "y", P.pos()[1])

    P.say("=== 4. WHAT FLOATS IN THE LOBBY? decos with no floor under them ===")
    P.say("   ", P.js("""() => { const objs = CRESTBOUND.game.course.def.objects||[];
        return objs.filter(o => o.kind === 'deco' && o.p && o.p[1] > 1.0 && o.p[1] < 6.0 &&
              Math.abs(o.p[0]) < 22 && o.p[2] > -14 && o.p[2] < 14)
          .map(o => ({kindOf:o.kindOf, p:o.p, s:o.s})).slice(0, 18); }"""))

    P.dump("keep15")
