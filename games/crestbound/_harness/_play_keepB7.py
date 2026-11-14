"""KEEP playtest pass B, run 7 — THE COURTYARD: the paving seam (P7) and the
fountain (P8).

Walk out of the south doors, look at the ground where paving meets grass, then
walk into the parterre, swim, and try to get back out over the rim.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keepB7") as P:
    P.click_title(); P.wait(1200)

    # ---------- walk out of the south doors ----------
    P.say("--- out of the lobby's south doors ---")
    P.tp(0, 0.2, 8.0); P.wait(500)
    r = P.walk_to(0, 15.0, tol=1.5, max_ms=14000, tag="south doors")
    P.shot("courtyard_arrival")
    P.say("  arrival:", json.dumps(P.state()))
    r = P.walk_to(0, 20.0, tol=1.5, max_ms=8000, tag="onto the lawn")
    P.shot("courtyard_on_the_lawn")

    # ---------- P7: the paving/grass seam ----------
    P.say("--- P7: where the paving meets the grass ---")
    seam = P.js("""() => { const G = CRESTBOUND.game, C = G.course, out = [];
        const bp = C.broadphase, hf = (bp.heightfields||[])[0];
        for (let z = 17.5; z <= 22.5; z += 0.5) {
          const y = hf ? hf.heightAt(0, z) : NaN;
          out.push({z, hf: Number.isNaN(y) ? null : +y.toFixed(3)}); }
        return {hfBounds: hf ? {ox:hf.originX, oz:hf.originZ, sx:hf.sizeX, sz:hf.sizeZ, surf:hf.surface} : null,
                samples: out, waters: (C.waters||[]).length,
                terrainMeshes: C.group.children.filter(o=>o.name&&/terrain/i.test(o.name)).length}; }""")
    P.say("  heightfield across the apron seam:", json.dumps(seam))
    # stand right on the seam and look down
    for z in (18.4, 19.0, 19.6):
        P.tp(0, 0.6, z); P.wait(500)
        P.js("() => { const G=CRESTBOUND.game; G.cam.pitch = -0.5; }")
        P.wait(400)
        P.shot("seam_z%.1f" % z)
        P.say("  standing at z=%.1f: %s" % (z, json.dumps(P.state())))
    # a wide look down the seam line
    P.tp(-8.0, 0.6, 19.0); P.wait(400)
    P.face(12.0, 19.0)
    P.js("() => { CRESTBOUND.game.cam.pitch = -0.15; }")
    P.wait(500); P.shot("seam_along")

    # ---------- P8: the fountain ----------
    P.say("--- P8: the parterre / fountain ---")
    water = P.js("""() => { const G = CRESTBOUND.game, C = G.course, out = [];
        C.group.traverse(o => { if (o.isMesh && o.material && /water/i.test(o.material.name||o.name||'')) {
            o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
            out.push({name:o.name||o.material.name, worldY:+o.getWorldPosition(new CRESTBOUND.THREE.Vector3()).y.toFixed(3),
                      bbTop:+bb.max.y.toFixed(3), bbBot:+bb.min.y.toFixed(3)}); } });
        const vols = (C.volumes||[]).filter(v => v.kind === 'water').map(v => ({
            kind:v.kind, cy:+v.center.y.toFixed(3), half:+v.half.y.toFixed(3),
            top:+(v.center.y+v.half.y).toFixed(3), surfaceY: v.props && v.props.surfaceY }));
        return {meshes: out, volumes: vols}; }""")
    P.say("  water meshes and volumes:", json.dumps(water))
    P.say("  (authored: rim top 1.10, water surface 0.95 — the surface should sit 0.15 m BELOW the rim)")

    # walk at the rim and look
    P.tp(0, 0.3, 22.0); P.wait(500)
    r = P.walk_to(0, 25.0, tol=1.0, max_ms=8000, tag="up to the rim")
    P.shot("fountain_at_the_rim")
    P.say("  at the rim:", json.dumps(P.state()))
    # jump the rim
    P.face(0, 30.0)
    P.down("W"); P.wait(420); P.tap("SPACE", 240); P.wait(1100); P.up("W"); P.wait(900)
    st = P.state()
    P.say("  after jumping the rim: %s inWater=%s state=%s" % (st["pos"], st["inWater"], st["pstate"]))
    P.shot("fountain_after_jump_in")
    # swim about
    P.face(0, 33.0)
    P.hold(["W"], 1600, sample_ms=400, tag="swimming north")
    st = P.state()
    P.say("  swimming: %s inWater=%s submerged=%s state=%s" % (st["pos"], st["inWater"], st["submerged"], st["pstate"]))
    P.shot("fountain_swimming")
    # dive
    P.down("C"); P.wait(1500); P.up("C"); P.wait(600)
    st = P.state()
    P.say("  after holding crouch (dive): %s submerged=%s state=%s" % (st["pos"], st["submerged"], st["pstate"]))
    P.shot("fountain_dived")
    # surface + get out over the rim
    for i in range(6):
        P.tap("SPACE", 200); P.wait(500)
    st = P.state()
    P.say("  after 6 strokes: %s state=%s" % (st["pos"], st["pstate"]))
    P.shot("fountain_surfaced")
    P.face(0, 22.0)
    got_out = False
    for i in range(10):
        P.down("W"); P.wait(500); P.tap("SPACE", 220); P.wait(700); P.up("W"); P.wait(400)
        st = P.state()
        if not st["inWater"] and st["pos"][1] > 0.9:
            got_out = True
            break
    st = P.state()
    P.say("  GETTING OUT: %s after %d tries -> %s inWater=%s y=%.2f" % (
        "OUT" if got_out else "STILL IN THE WATER", i + 1, st["pos"], st["inWater"], st["pos"][1]))
    P.shot("fountain_getting_out")
    P.dump("keepB7")
