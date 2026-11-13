"""BLIZZARD PEAK playtest - BEAT 1: base camp, the spawn frame, signs, coins,
the race pad, the bumbler, the pedestals."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

with P("camp") as g:
    g.start("rime-3")
    # ---- THE SPAWN FRAME (owner: "a wing ring was hanging over base camp")
    g.shot("spawn_frame")
    g.say("-- what is in front of the spawn camera --")
    near = g.js("""() => {
      const G=CRESTBOUND.game, cam=G.cam&&G.cam.cam; if(!cam) return null;
      const out=[]; const v=new THREE.Vector3();
      G.engine.scene.traverse(o=>{ if(!o.visible||!o.isMesh&&!o.isInstancedMesh&&!o.isBatchedMesh) return;
        o.getWorldPosition(v);
        const d=v.distanceTo(cam.position);
        if(d<26) out.push({n:o.name||o.type, d:+d.toFixed(1), p:[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]});
      });
      out.sort((a,b)=>a.d-b.d); return out.slice(0,26); }""")
    for r in (near or []):
        g.say("    ", r)
    g.say("-- ring positions (wing overlay) --")
    rings = g.js("""() => { const G=CRESTBOUND.game, out=[];
      G.engine.scene.traverse(o=>{ if(/ring/i.test(o.name||'')) { const v=new THREE.Vector3();
        o.getWorldPosition(v); out.push({n:o.name,p:[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)],vis:o.visible}); } });
      return out.slice(0,40); }""")
    for r in (rings or []):
        g.say("    ", r)

    # ---- can I read the sign from where I stand?
    g.show("at spawn")
    g.look(3.4, 41)
    g.wait(500)
    g.shot("look_at_sign")
    g.walk(3.4, 43.0, tol=1.0, tag="approach the BLIZZARD PEAK sign")
    g.look(3.4, 41)
    g.wait(400)
    g.shot("sign_close")

    # ---- the race pad
    g.walk(0, 40.0, tol=0.8, tag="race start pad")
    g.show("on race pad")
    g.shot("race_pad")

    # ---- the checkpoint pad cp-camp (0,2.2,41)
    g.walk(0, 41.0, tol=0.7, tag="cp-camp pad")
    g.show("on cp-camp")
    g.shot("cp_camp")

    # ---- the two pedestals
    g.walk(-5.0, 41.0, tol=1.0, tag="coin-crest pedestal")
    g.look(-5, 41); g.wait(300); g.shot("pedestal_coins")
    g.walk(6.0, 42.0, tol=1.0, tag="ring-home pedestal")
    g.look(6, 42); g.wait(300); g.shot("pedestal_rings")

    # ---- the trodden trail out of camp: walk it and count coins
    g.say("-- walking the camp trail, counting coins --")
    g.show("before trail")
    g.walk(0, 42.0, tol=1.2, tag="trail head")
    g.walk(-8, 39.0, tol=1.4, max_ms=14000, tag="trail 2")
    g.show("trail 2"); g.shot("trail_2")
    g.walk(-16, 36.0, tol=1.4, max_ms=14000, tag="trail 3")
    g.show("trail 3"); g.shot("trail_3")
    g.walk(-24, 33.0, tol=1.6, max_ms=16000, tag="trail 4 / cp-westface approach")
    g.show("trail 4"); g.shot("trail_4")

    # ---- the bumbler: can it hurt me while I stand still?
    g.say("-- bumbler test: stand still in its path --")
    g.tp(0, 2.4, 41.0); g.wait(400)
    crit = g.js("""() => { const G=CRESTBOUND.game, C=G._critters; if(!C) return null;
      const L=(C.list||C.items||C._list||[]);
      return L.map(c=>({k:c.kind||c.type, p:c.pos?[+c.pos.x.toFixed(1),+c.pos.y.toFixed(1),+c.pos.z.toFixed(1)]:null,
        alive:c.alive===undefined?null:c.alive})).slice(0,20); }""")
    g.say("   critters:", crit)
    g.walk(-3, 40.0, tol=1.2, tag="into the bumbler patrol")
    d0 = g.snap().get("deaths")
    g.say("   standing still for 14 s in the bumbler's path...")
    for i in range(7):
        g.wait(2000)
        s = g.show("stand %d" % i)
        if i == 3:
            g.shot("bumbler_standing")
    s = g.snap()
    g.say("   deaths before=%s after=%s" % (d0, s.get("deaths")))

    g.shot("camp_wide")
    g.dump()
