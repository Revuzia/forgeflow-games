"""PLAYTEST — THE KEEP, run 11: gate MESH vs gate TRIGGER (P9), then out of the
south doors into the COURTYARD: the paving/grass seam (P7), the fountain (P8 —
swim in it, does the surface sit above the rim, can you get out), the trees, the
wall-kick tower and its roof."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("keep") as P:
    P.n = 400
    P.click_title(); P.wait(3000)

    P.say("=== A. WHAT THE GATE MESH OCCUPIES vs WHERE THE TRIGGER IS (P9) ===")
    rows = P.js("""() => { const G = CRESTBOUND.game, THREE = CRESTBOUND.THREE, out = [];
      for (const g of (G._gates||[])) {
        let box = null;
        // find the drawn gate art nearest this gate's authored point
        G.course.group.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          const w = new THREE.Vector3(); o.getWorldPosition(w);
          if (w.distanceTo(g.pos) > 3.2) return;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          if (!box) box = b; else box.union(b);
        });
        const vol = g.volume;
        out.push({ course: g.course,
          authored_y: +g.pos.y.toFixed(2),
          art_y: box ? [+box.min.y.toFixed(2), +box.max.y.toFixed(2)] : null,
          trigger_y: vol ? [+(vol.center.y - vol.half.y).toFixed(2), +(vol.center.y + vol.half.y).toFixed(2)] : null,
          floor_y: +g.exitPos.y.toFixed(2) });
      } return out; }""")
    for r in rows:
        art = r["art_y"]
        note = ""
        if art:
            sill = art[0] - r["floor_y"]
            if sill > 1.2:
                note = "  << ART SILL %.2f m ABOVE THE FLOOR — reads as a window, not a door" % sill
        P.say("  %-10s floor %6.2f  authored centre %6.2f  ART %s  TRIGGER %s%s"
              % (r["course"], r["floor_y"], r["authored_y"], art, r["trigger_y"], note))

    P.say("=== B. SIGN / PLATE TEXT — what is actually drawn on the crest plates ===")
    P.say("  plates in the def:", P.js("""() => (CRESTBOUND.game.course.def.objects||[])
        .filter(o => o.plate).map(o => ({kind:o.kind, course:o.course||o.id, plate:o.plate, w:o.w, h:o.h}))"""))

    P.say("=== C. OUT THE SOUTH DOORS INTO THE COURTYARD ===")
    P.tp(0.0, 0.05, 8.0); P.wait(600)
    P.face(0, 60)
    s = P.hold(["W"], 6000, sample_ms=300, tag="south, out of the Keep")
    P.say("   ->", P.pos(), "surface", P.state()["surface"])
    P.shot("courtyard_through_the_doors")
    P.walk_to(0.0, 20.0, tol=1.8, max_ms=9000, tag="onto the lawn")
    P.say("   surface here:", P.state()["surface"], P.pos())
    P.shot("courtyard_lawn")

    P.say("=== D. P7 — THE PAVING / GRASS SEAM. walk the apron edge and look down ===")
    for z in [13.6, 14.4, 15.2, 16.0, 17.0]:
        P.tp(0.0, 0.4, z); P.wait(700)
        P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.45; c.dist = 3.2; }")
        P.wait(500)
        P.say("   at z %.1f surface %s y %.2f" % (z, P.state()["surface"], P.pos()[1]))
        P.shot("p7_seam_z%.0f" % (z * 10))
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = 0.22; c.dist = 6.8; }")

    P.say("=== E. P8 — THE FOUNTAIN. rim, water top, swim, and get out ===")
    P.say("   water def:", P.js("""() => (CRESTBOUND.game.course.def.waters||[]).map(w=>({p:w.p,s:w.s,kind2:w.kind2}))"""))
    P.say("   live water volumes:", P.js("""() => (CRESTBOUND.game.course.volumes||[])
        .filter(v=>v.kind==='water').map(v=>({c:[+v.center.x.toFixed(2),+v.center.y.toFixed(2),+v.center.z.toFixed(2)],
          half:[+v.half.x.toFixed(2),+v.half.y.toFixed(2),+v.half.z.toFixed(2)],
          top:+(v.center.y+v.half.y).toFixed(2)}))"""))
    P.say("   fountain rim collider tops:", P.js("""() => { const THREE=CRESTBOUND.THREE, bp=CRESTBOUND.game.course.broadphase;
        const aabb=new THREE.Box3(new THREE.Vector3(-6,-2,24),new THREE.Vector3(6,3,36)); const res=[]; bp.query(aabb,res);
        return res.map(c=>({top:+c.aabb.max.y.toFixed(2), x:[+c.aabb.min.x.toFixed(1),+c.aabb.max.x.toFixed(1)],
          z:[+c.aabb.min.z.toFixed(1),+c.aabb.max.z.toFixed(1)]})).sort((a,b)=>b.top-a.top).slice(0,10); }"""))
    P.tp(0.0, 0.4, 23.0); P.wait(700)
    P.walk_to(0.0, 24.4, tol=1.0, max_ms=7000, tag="up to the fountain rim")
    P.js("() => { const c = CRESTBOUND.game.cam; c.pitch = -0.10; }")
    P.wait(400)
    P.shot("fountain_from_the_lawn")
    P.say("   at the rim:", P.pos(), P.state()["surface"])
    P.say("   -- jump the rim and swim --")
    P.face(0, 30)
    P.down("W"); P.wait(500); P.tap("SPACE", 250); P.wait(900)
    P.wait(1200); P.up("W"); P.wait(1000)
    st = P.state()
    P.say("   after jumping in:", st["pos"], "inWater", st["inWater"], "state", st["pstate"])
    P.shot("fountain_in_the_water")
    P.hold(["W"], 2200, tag="swim across")
    st = P.state()
    P.say("   swum:", st["pos"], "inWater", st["inWater"], "state", st["pstate"])
    P.shot("fountain_swimming")
    P.say("   -- get out: swim at the rim and jump --")
    P.face(0, 20)
    P.down("W"); P.wait(1400)
    for _ in range(4):
        P.tap("SPACE", 200); P.wait(500)
    P.up("W"); P.wait(1200)
    st = P.state()
    P.say("   out?:", st["pos"], "inWater", st["inWater"], "y", st["pos"][1], "state", st["pstate"])
    P.shot("fountain_getting_out")

    P.dump("keep11")
