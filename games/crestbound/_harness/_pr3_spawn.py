"""rime-3 AUTHORED spawn frame (0,2.2,46 yaw 0) + ring / text-plate audit."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

with P("spawn") as g:
    g.start("rime-3")
    # put the hero exactly where a real gate entry would put him and face -Z
    g.tp(0, 2.2, 46)
    g.js("() => { const G=CRESTBOUND.game; G.player.__test.setFacing(0); if(G.cam){G.cam.yaw=0;G.cam.pitch=0;G.cam.recenter&&G.cam.recenter();} }")
    g.wait(1200)
    g.show("authored spawn")
    g.shot("authored_spawn")
    g.js("() => { const G=CRESTBOUND.game; if(G.cam){G.cam.pitch=-0.25;} }")
    g.wait(600); g.shot("authored_spawn_up")

    g.say("-- hz_rings children (the wing overlay) --")
    g.say(g.js("""() => { const e=CRESTBOUND.game.engine, out=[]; e.scene.updateMatrixWorld(true);
      const grp=e.scene.getObjectByName('hz_rings'); if(!grp) return 'no hz_rings';
      grp.traverse(o=>{ if(o===grp) return; const m=o.matrixWorld.elements;
        out.push({n:(o.name||o.type).slice(0,26), vis:o.visible,
                  p:[+m[12].toFixed(1),+m[13].toFixed(1),+m[14].toFixed(1)]}); });
      return out; }"""))

    g.say("-- every text plate on the course and how big it renders --")
    g.say(g.js("""() => { const e=CRESTBOUND.game.engine, out=[]; e.scene.updateMatrixWorld(true);
      e.scene.traverse(o=>{ if(!o.isMesh||!o.geometry) return;
        const n=(o.name||''); if(!/text|sign|plate|label/i.test(n)) return;
        o.geometry.computeBoundingBox&&o.geometry.computeBoundingBox();
        const bb=o.geometry.boundingBox; const m=o.matrixWorld.elements;
        const sx=Math.hypot(m[0],m[1],m[2]), sy=Math.hypot(m[4],m[5],m[6]);
        out.push({n:n.slice(0,30), p:[+m[12].toFixed(1),+m[13].toFixed(1),+m[14].toFixed(1)],
          w:bb?+((bb.max.x-bb.min.x)*sx).toFixed(2):null, h:bb?+((bb.max.y-bb.min.y)*sy).toFixed(2):null}); });
      return out.slice(0,60); }"""))

    g.say("-- what is the dark mass in front of the camp? sample the terrain --")
    g.say(g.js("""() => { const G=CRESTBOUND.game, out=[];
      const w=G.world||G.course&&G.course.world;
      for (let z=44; z>=20; z-=4) { const row=[];
        for (let x=-12; x<=12; x+=6) { let h=null;
          try { h = G.course && G.course.heightAt ? G.course.heightAt(x,z) : null; } catch(e){}
          row.push(h===null?null:+h.toFixed(2)); }
        out.push({z:z, h:row}); }
      return out; }"""))
    g.dump()
