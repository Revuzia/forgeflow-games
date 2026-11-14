#!/usr/bin/env python
"""Size V + 250 foes: for every visible InstancedMesh, how many instances intersect the MAIN camera
frustum and the sun's SHADOW camera frustum (bounding sphere per instance). Tris weighted."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
PROBE = """() => {
  const core = __BT__.debugCore, sc = core.scene, cam = core.camera;
  const T = cam.constructor; // PerspectiveCamera -> get THREE classes via prototypes
  const M4 = cam.matrixWorld.constructor, V3 = cam.position.constructor;
  let sun = null; sc.traverse((o) => { if (o.isDirectionalLight && o.castShadow) sun = o; });
  // frustum from a projection*view matrix (planes as [a,b,c,d])
  const planes = (m) => { const e = m.elements; const P = [];
    const add = (a,b,c,d) => { const l = Math.hypot(a,b,c); P.push([a/l,b/l,c/l,d/l]); };
    add(e[3]-e[0],e[7]-e[4],e[11]-e[8],e[15]-e[12]); add(e[3]+e[0],e[7]+e[4],e[11]+e[8],e[15]+e[12]);
    add(e[3]+e[1],e[7]+e[5],e[11]+e[9],e[15]+e[13]); add(e[3]-e[1],e[7]-e[5],e[11]-e[9],e[15]-e[13]);
    add(e[3]-e[2],e[7]-e[6],e[11]-e[10],e[15]-e[14]); add(e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14]); return P; };
  const vp = new M4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const Fm = planes(vp);
  let Fs = null; if (sun) { const sc2 = sun.shadow.camera; sc2.updateMatrixWorld(); const m = new M4().multiplyMatrices(sc2.projectionMatrix, sc2.matrixWorldInverse); Fs = planes(m); }
  const inF = (F, x, y, z, r) => { for (const p of F) if (p[0]*x+p[1]*y+p[2]*z+p[3] < -r) return false; return true; };
  const out = []; const im = new M4(); const c = new V3(); const wm = new M4();
  sc.traverseVisible((o) => {
    if (!o.isInstancedMesh || !o.count) return;
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const bs = g.boundingSphere;
    const n = g.index ? g.index.count/3 : g.getAttribute('position').count/3;
    let vm = 0, vs = 0, live = 0;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, im); wm.multiplyMatrices(o.matrixWorld, im);
      const sx = Math.hypot(wm.elements[0],wm.elements[1],wm.elements[2]), sy = Math.hypot(wm.elements[4],wm.elements[5],wm.elements[6]), sz = Math.hypot(wm.elements[8],wm.elements[9],wm.elements[10]);
      const s = Math.max(sx, sy, sz); if (s < 1e-6) continue; live++;
      c.copy(bs.center).applyMatrix4(wm); const r = bs.radius * s;
      if (inF(Fm, c.x, c.y, c.z, r)) vm++;
      if (o.castShadow && Fs && inF(Fs, c.x, c.y, c.z, r)) vs++;
    }
    let root = o; while (root.parent && root.parent !== sc) root = root.parent;
    out.push({ name: o.name, root: root.name, n, count: o.count, live, vm, vs, cast: o.castShadow, tris: n*o.count, visTris: n*vm });
  });
  out.sort((a,b) => b.tris - a.tris);
  return out;
}"""
s = Session(args, "instvis"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    for i in range(12):
        s.hold(perfcheck.CIRCLE[i % 8]); time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    s.release_all(); time.sleep(0.4)
    st = s.state() or {}
    if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen")); time.sleep(0.6)
    s.js("() => __BT__.freeze(true)"); time.sleep(0.3)
    r = s.js(PROBE)
    T = sum(x["tris"] for x in r); V = sum(x["visTris"] for x in r)
    print("instanced tris total %d · in main frustum %d (%.0f%%)" % (T, V, 100.0 * V / max(1, T)))
    for x in r[:60]:
        print("%-40s %-10s n%5d count %5d live %5d main %5d (%3.0f%%) shadow %5s tris %7d vis %7d" % (
            x["name"][:40], x["root"][:10], x["n"], x["count"], x["live"], x["vm"], 100.0 * x["vm"] / max(1, x["count"]),
            x["vs"] if x["cast"] else "-", x["tris"], x["visTris"]))
finally:
    s.close()
