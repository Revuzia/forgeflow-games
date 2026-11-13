"""PLAYTEST — THE KEEP, run 13: the water surface measured against the rim at eye
level (P8), the REAL paving/grass seam out in the courtyard (P7), the climbable
trees, the wall-kick tower, the roof, and the checkpoint pads."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 600
    P.click_title(); P.wait(3000)

    P.say("=== 1. WATER SURFACE vs RIM, measured (P8) ===")
    P.say("   water mesh + shader:", P.js("""() => { let r = null;
        CRESTBOUND.game.course.group.traverse(o => { if (o.name === 'water.pool' && !r) {
          o.geometry.computeBoundingBox();
          const u = o.material && o.material.uniforms ? Object.keys(o.material.uniforms) : null;
          const amp = o.material && o.material.uniforms && o.material.uniforms.uAmp ? o.material.uniforms.uAmp.value : null;
          const waves = o.material && o.material.uniforms && o.material.uniforms.uWaves ? o.material.uniforms.uWaves.value : null;
          r = { worldY: +o.position.y.toFixed(3), bbY: [+o.geometry.boundingBox.min.y.toFixed(3), +o.geometry.boundingBox.max.y.toFixed(3)],
                uniforms: u, amp, waves }; } }); return r; }"""))
    P.say("   how many water.pool meshes:", P.js("() => { let n=0; CRESTBOUND.game.course.group.traverse(o=>{if(o.name==='water.pool')n++;}); return n; }"))
    P.say("   rim top = 1.10 (collider), water volume top = 0.95")
    # eye-level shot straight across the rim
    P.tp(0.0, 0.05, 21.5); P.wait(900)
    P.js("""() => { const G = CRESTBOUND.game; G.cam.yaw = Math.PI; G.cam.pitch = 0.0; G.cam.dist = 2.2;
        G.player.__test.setFacing(Math.PI); }""")
    P.wait(700)
    P.shot("p8_eye_level_across_the_rim")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.06; c.dist = 4.5; }")
    P.wait(500)
    P.shot("p8_rim_close")
    P.tp(0.0, 1.55, 24.0); P.wait(900)
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.02; c.dist = 3.0; c.yaw = Math.PI; }")
    P.wait(600)
    P.shot("p8_standing_on_the_rim_looking_across")

    P.say("=== 2. P7 — THE REAL APRON / LAWN SEAM (courtyard, z 13..20) ===")
    for (x, z) in [(0, 15.5), (0, 17.5), (-8, 16.0), (8, 16.0), (12, 14.5)]:
        P.tp(x, 0.6, z); P.wait(800)
        P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.55; c.dist = 4.0; }")
        P.wait(500)
        P.say("   at (%s, %s) surface %s  y %.2f" % (x, z, P.state()["surface"], P.pos()[1]))
        P.shot("p7_apron_%d_%d" % (x, z * 10))
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.22; c.dist = 6.8; }")

    P.say("=== 3. THE CLIMBABLE TREES ===")
    trees = P.js("""() => (CRESTBOUND.game.course.def.objects||[]).filter(o=>o.kind==='tree')
        .map(o=>({p:o.p, h:o.h, r:o.r, climbable:!!o.climbable}))""")
    P.say("   trees:", trees)
    climb = [t for t in trees if t["climbable"]] or trees
    if climb:
        t = climb[0]
        P.tp(t["p"][0] + 2.0, 1.0, t["p"][2]); P.wait(900)
        P.walk_to(t["p"][0], t["p"][2], tol=0.6, max_ms=6000, tag="up to the tree")
        P.shot("tree_at_the_trunk")
        P.face(t["p"][0], t["p"][2])
        s = P.hold(["W"], 3000, sample_ms=250, tag="press into the trunk (climb?)")
        P.say("   y trace:", [round(x["pos"][1], 2) for x in s], "states", sorted(set(x["pstate"] for x in s)))
        P.shot("tree_climb_attempt")
        P.say("   -- jump at it then hold W --")
        P.tap("SPACE", 250); P.down("W"); P.wait(2500); P.up("W"); P.wait(600)
        P.say("   after jump+hold:", P.pos(), P.state()["pstate"])
        P.shot("tree_climb_attempt2")

    P.say("=== 4. THE WALL-KICK TOWER (shaft x -18.5..-15.5, z 33.2..36.5; roof 12.60) ===")
    P.tp(-17.0, 0.6, 34.8); P.wait(900)
    P.say("   in the shaft at", P.pos(), "surface", P.state()["surface"])
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.5; }")
    P.wait(400)
    P.shot("tower_shaft_looking_up")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.1; }")
    for i in range(6):
        P.face(-17.0, 33.0 if i % 2 == 0 else 37.0)
        P.down("W"); P.wait(280); P.tap("SPACE", 200); P.wait(420); P.up("W")
        st = P.state()
        P.say("   kick %d -> y %.2f  %s  %s" % (i + 1, st["pos"][1], st["pstate"], st["pos"]))
    P.wait(900)
    P.say("   after 6 kicks:", P.pos())
    P.shot("tower_after_kicks")

    P.say("=== 5. THE CHECKPOINT PADS ===")
    cps = P.js("""() => (CRESTBOUND.game.course.def.checkpoints||[]).map(c=>({id:c.id,name:c.name,p:c.p}))""")
    for c in cps:
        P.tp(c["p"][0], c["p"][1] + 1.2, c["p"][2]); P.wait(1300)
        st = P.state()
        P.say("   %-16s %s -> settled %s  cp now %s" % (c["id"], c["p"], st["pos"],
              P.js("() => CRESTBOUND.game.cpIndex")))
        P.shot("cp_" + c["id"])

    P.dump("keep13")
