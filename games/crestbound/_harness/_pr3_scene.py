"""Scene / spawn-frame probe for rime-3 (no THREE global needed)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

with P("scene") as g:
    g.start("rime-3")
    g.shot("spawn_frame")
    g.say("cam object keys:", g.js("() => { const c=CRESTBOUND.game.cam; return c?Object.keys(c).slice(0,40):null; }"))
    g.say("engine keys:", g.js("() => Object.keys(CRESTBOUND.game.engine).slice(0,40)"))
    g.say("camera pos:", g.js("""() => { const e=CRESTBOUND.game.engine; const c=e.camera||e.cam||(CRESTBOUND.game.cam&&CRESTBOUND.game.cam.camera);
        return c?{p:[+c.position.x.toFixed(2),+c.position.y.toFixed(2),+c.position.z.toFixed(2)],
                  q:[+c.quaternion.x.toFixed(3),+c.quaternion.y.toFixed(3),+c.quaternion.z.toFixed(3),+c.quaternion.w.toFixed(3)],
                  fov:c.fov}:null; }"""))
    g.say("-- objects within 30 m of the camera, sorted by distance --")
    near = g.js("""() => {
      const G=CRESTBOUND.game, e=G.engine;
      const c=e.camera||e.cam||(G.cam&&G.cam.camera); if(!c) return {err:'no camera'};
      const cp=c.position, out=[];
      e.scene.updateMatrixWorld(true);
      e.scene.traverse(o=>{
        if (!o.visible) return;
        if (!(o.isMesh||o.isInstancedMesh||o.isBatchedMesh||o.isSprite||o.isPoints||o.isLine)) return;
        const m=o.matrixWorld.elements, x=m[12],y=m[13],z=m[14];
        const d=Math.hypot(x-cp.x,y-cp.y,z-cp.z);
        if (d<30) out.push({n:(o.name||o.type).slice(0,34), d:+d.toFixed(1),
                            p:[+x.toFixed(1),+y.toFixed(1),+z.toFixed(1)],
                            cnt:o.count===undefined?null:o.count});
      });
      out.sort((a,b)=>a.d-b.d); return out.slice(0,40); }""")
    if isinstance(near, list):
        for r in near: g.say("    ", r)
    else:
        g.say("    ", near)
    g.say("-- everything whose name mentions ring / wing / hat --")
    rings = g.js("""() => { const G=CRESTBOUND.game, e=G.engine, out=[];
      e.scene.updateMatrixWorld(true);
      e.scene.traverse(o=>{ const n=(o.name||''); if(/ring|wing|hat|power/i.test(n)){
        const m=o.matrixWorld.elements;
        out.push({n:n.slice(0,40), t:o.type, vis:o.visible,
                  p:[+m[12].toFixed(1),+m[13].toFixed(1),+m[14].toFixed(1)],
                  cnt:o.count===undefined?null:o.count}); } });
      return out.slice(0,60); }""")
    for r in (rings or []): g.say("    ", r)
    g.say("-- named top-level groups --")
    g.say(g.js("""() => CRESTBOUND.game.engine.scene.children.map(o=>({n:o.name||o.type, t:o.type, vis:o.visible, kids:o.children.length}))"""))
    g.dump()
