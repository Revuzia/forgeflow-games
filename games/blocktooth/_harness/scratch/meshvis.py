#!/usr/bin/env python
"""Size V + 250 foes: for big NON-instanced meshes, fraction of triangles with a vertex inside the main
camera frustum (and frustumCulled flag)."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--rank", type=int, default=4); args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
PROBE = """() => {
  const core = __BT__.debugCore, sc = core.scene, cam = core.camera;
  const M4 = cam.matrixWorld.constructor, V3 = cam.position.constructor;
  const vp = new M4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const out = []; const v = new V3();
  sc.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    const g = o.geometry, p = g.getAttribute('position'); if (!p) return;
    const idx = g.index; let n = idx ? idx.count : p.count; if (g.drawRange && isFinite(g.drawRange.count)) n = Math.min(n, g.drawRange.count);
    const tris = Math.floor(n / 3); if (tris < 2000) return;
    const m = new M4().multiplyMatrices(vp, o.matrixWorld);
    let vis = 0, degen = 0;
    const inside = (i) => { v.fromBufferAttribute(p, i).applyMatrix4(m); return Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 && v.z >= -1 && v.z <= 1; };
    for (let t = 0; t < tris; t++) {
      const a = idx ? idx.getX(3*t) : 3*t, b = idx ? idx.getX(3*t+1) : 3*t+1, c = idx ? idx.getX(3*t+2) : 3*t+2;
      if (p.getX(a) === p.getX(b) && p.getY(a) === p.getY(b) && p.getZ(a) === p.getZ(b) && p.getX(a) === p.getX(c) && p.getZ(a) === p.getZ(c)) { degen++; continue; }
      if (inside(a) || inside(b) || inside(c)) vis++;
    }
    out.push({ name: o.name, tris, vis, degen, fc: o.frustumCulled, cast: o.castShadow });
  });
  out.sort((a, b) => b.tris - a.tris); return out;
}"""
s = Session(args, "meshvis"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, args.rank, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    for i in range(12):
        s.hold(perfcheck.CIRCLE[i % 8]); time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    s.release_all(); time.sleep(0.4)
    st = s.state() or {}
    if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen")); time.sleep(0.6)
    s.js("() => __BT__.freeze(true)"); time.sleep(0.3)
    print(s.js("""() => { const core = __BT__.debugCore, sc = core.scene, cam = core.camera; const F = new (cam.constructor.prototype.constructor === cam.constructor ? Object : Object)();
      const M4 = cam.matrixWorld.constructor; const vp = new M4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      let tot = 0, vis = 0, inF = 0, triVis = 0, triIn = 0, rs = []; const e = vp.elements;
      const planes = []; const add = (a,b,c,d) => { const l = Math.hypot(a,b,c); planes.push([a/l,b/l,c/l,d/l]); };
      add(e[3]-e[0],e[7]-e[4],e[11]-e[8],e[15]-e[12]); add(e[3]+e[0],e[7]+e[4],e[11]+e[8],e[15]+e[12]); add(e[3]+e[1],e[7]+e[5],e[11]+e[9],e[15]+e[13]); add(e[3]-e[1],e[7]-e[5],e[11]-e[9],e[15]-e[13]); add(e[3]-e[2],e[7]-e[6],e[11]-e[10],e[15]-e[14]); add(e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14]);
      sc.traverse((o) => { if (o.name !== 'city:impostors') return; tot++; if (!o.visible) return; vis++; const bs = o.geometry.boundingSphere; rs.push(Math.round(bs.radius)); triVis += o.geometry.drawRange.count/3;
        let ok = true; for (const p of planes) if (p[0]*bs.center.x+p[1]*bs.center.y+p[2]*bs.center.z+p[3] < -bs.radius) { ok = false; break; } if (ok) { inF++; triIn += o.geometry.drawRange.count/3; } });
      return { tot, vis, inF, triVis, triIn, rs: rs.slice(0, 20), fc: sc.getObjectByName('city:impostors').frustumCulled }; }"""))
    for x in s.js(PROBE):
        print("%-36s tris %7d vis %7d (%3.0f%%) degenerate %7d frustumCulled %s cast %s" % (x["name"][:36], x["tris"], x["vis"], 100.0*x["vis"]/max(1,x["tris"]), x["degen"], x["fc"], x["cast"]))
finally:
    s.close()
