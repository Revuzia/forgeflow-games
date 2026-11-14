"""Deterministic GPU cost bench: Size V + 250 foes, sim frozen, then in-page: render the SAME frame N
times back-to-back and sync with readPixels → true GPU ms per frame at saturated clocks (no DVFS,
no vsync). Groups are excluded via object layers (camera sees layer 0 only)."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--rscale", default="1")
ap.add_argument("--drive", type=float, default=4.0); ap.add_argument("--n", type=int, default=30)
ap.add_argument("phases", nargs="*", default=[""])
args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5, rscale=args.rscale)
PREP = """async () => {
  const core = window.__BT__.debugCore, sc = core.scene;
  const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('BufferGeometryUtils'));
  const U = url ? await import(url) : null;
  let Basic = null; sc.traverse((o) => { if (!Basic && o.material && o.material.type === 'MeshBasicMaterial') Basic = o.material.constructor; });
  window.__OVR__ = Basic ? new Basic({ color: 0x888888 }) : null;
  window.__GEO_ORIG__ = new Map(); window.__GEO_MERGED__ = new Map();
  if (U) sc.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.isOutline && !/impostor/.test(o.name) && !o.geometry.index && o.geometry.getAttribute('position') && o.geometry.getAttribute('position').count > 30) {
    const g = o.geometry; if (window.__GEO_MERGED__.has(g)) return; try { window.__GEO_MERGED__.set(g, U.mergeVertices(g)); } catch (e) {} } });
  let v0 = 0, v1 = 0; for (const [a, b] of window.__GEO_MERGED__) { v0 += a.getAttribute('position').count; v1 += b.getAttribute('position').count; }
  const top = []; const seen = new Set(); sc.traverse((o) => { if (!o.isMesh || o.userData.isOutline) return; const m = window.__GEO_MERGED__.get(o.geometry); if (!m || seen.has(o.geometry)) return; seen.add(o.geometry);
    const inst = o.isInstancedMesh ? o.count : 1; const a = o.geometry.getAttribute('position').count, b = m.getAttribute('position').count; top.push([o.name, a, b, inst, (a - b) * Math.max(1, inst) * (o.visible ? 1 : 0)]); });
  top.sort((x, y) => y[4] - x[4]);
  return { utils: !!U, url, basic: !!Basic, merged: window.__GEO_MERGED__.size, verts: [v0, v1], top: top.slice(0, 25) };
}"""
BENCH = """([re, n, shadow]) => {
  const core = window.__BT__.debugCore, R = core.renderer, gl = R.getContext(), sc = core.scene, cam = core.camera;
  window.__HID__ = window.__HID__ || []; for (const o of window.__HID__) o.layers.set(0); window.__HID__ = [];
  window.__NC__ = window.__NC__ || []; for (const o of window.__NC__) o.castShadow = true; window.__NC__ = [];
  sc.overrideMaterial = re === 'OVR' ? window.__OVR__ : null;
  sc.traverse((o) => { if (o.isMesh && /^city:(road|sidewalk|lot|plaza)/.test(o.name)) { if (o.userData.__ro === undefined) o.userData.__ro = o.renderOrder; o.renderOrder = re === 'ORD' ? 800 : o.userData.__ro; } });
  const swap = (toMerged) => sc.traverse((o) => { if (!o.isMesh) return; const src = o.userData.isOutline ? null : o;
    if (!src) return; const cur = o.geometry; if (toMerged) { const m = window.__GEO_MERGED__.get(cur); if (m) { window.__GEO_ORIG__.set(o, cur); o.geometry = m; } } else { const g0 = window.__GEO_ORIG__.get(o); if (g0) o.geometry = g0; } });
  swap(false); window.__GEO_ORIG__.clear(); if (re === 'MERGE') swap(true);
  if (re && re.startsWith('NOCAST:')) { const r = new RegExp(re.slice(7)); sc.traverse((o) => { if (o.isMesh && o.castShadow && r.test(o.name)) { o.castShadow = false; window.__NC__.push(o); } }); }
  else if (re && re !== 'NOSHADOW') { const r = new RegExp(re); sc.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && r.test(o.name)) { o.layers.set(5); window.__HID__.push(o); } }); }
  let sun = null; sc.traverse((o) => { if (o.isDirectionalLight && o.castShadow) sun = o; });
  const px = new Uint8Array(4);
  const one = () => { if (sun) { sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = shadow && re !== 'NOSHADOW'; } R.info.reset(); R.render(sc, cam); };
  one(); one(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) one();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ms = (performance.now() - t0) / n;
  return { ms, hidden: window.__HID__.length, draws: R.info.render.calls, tris: R.info.render.triangles, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
}"""
s = Session(args, "gpubench"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    t0 = time.time(); i = 0
    while time.time() - t0 < args.drive:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") == "draft": s.release_all(); s.press("Digit1")
    s.release_all(); time.sleep(0.3)
    st = s.state() or {}
    if st.get("screen") == "draft": s.press("Digit1"); time.sleep(0.5)
    s.js("() => window.__BT__.freeze(true)"); time.sleep(0.5)
    print("state: rank", st.get("rank"), "enemies", st.get("enemies"), "x,z", st.get("x"), st.get("z"))
    res = {}
    print("prep", s.js(PREP))
    s.js(BENCH, ["", 120, True])   # clock ramp
    for rep in range(int(os.environ.get("REPS", "3"))):
        for ph in args.phases:
            b = s.js(BENCH, ["", args.n, True]); res.setdefault("", []).append(b["ms"])
            r = s.js(BENCH, [ph, args.n, True]); res.setdefault(ph, []).append(r["ms"]); res.setdefault("_" + ph, r)
    for ph in args.phases:
        r = res["_" + ph]; v = sorted(res[ph])
        print("%-44s min %6.2f med %6.2f ms/frame  draws %4d tris %8d  hidden %4d  buf %dx%d" % (repr(ph)[:44], v[0], v[len(v)//2], r["draws"], r["tris"], r["hidden"], r["w"], r["h"]))
    v = sorted(res[""]); print("%-44s min %6.2f med %6.2f  (all interleaved baselines, n=%d)" % ("BASELINE", v[0], v[len(v)//2], len(v)))
finally:
    s.close()
