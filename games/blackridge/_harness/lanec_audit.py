#!/usr/bin/env python
"""LANE C scene audit — coplanar ground stacks + red objects, from the LIVE scene.

Two instruments, both run against the running game's real scene graph:

  1. COPLANAR SCAN — raycast straight down on a grid over the whole map and
     report every spot where two or more OPAQUE, depth-writing surfaces land
     within 1 mm of each other. Two opaque surfaces at the same depth IS
     z-fighting; no eyeballing required.

  2. RED HUNT — walk every mesh in the scene and report any whose material
     colour / emissive is red-dominant and whose geometry sits low (< 2.5 m),
     with its world AABB, so a "red wedge on the ground" has a name.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server  # noqa: E402

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"

COPLANAR = """(a) => {
  const F = globalThis.__FPS__, THREE = globalThis.__THREE_NS__;
  const rc = new THREE.Raycaster();
  rc.camera = F.camera;   // Sprite.raycast dereferences it
  rc.far = 60;
  rc.layers.set(0);
  const down = new THREE.Vector3(0, -1, 0);
  const org = new THREE.Vector3();
  const pairs = new Map();
  let probes = 0;
  // Candidate set: FLAT, WIDE meshes only (a ground slab / decal sheet / pool
  // quad). Raycasting the whole scene 13k times kills the tab.
  const bb = new THREE.Box3();
  const cand = [];
  F.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    try { bb.setFromObject(o); } catch (e) { return; }
    const h = bb.max.y - bb.min.y, w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
    if (h > 1.2) return;
    if (w < 2 || d < 2) return;
    if (bb.min.y > 3) return;
    cand.push(o);
  });
  for (let x = a.x0; x <= a.x1; x += a.step) {
    for (let z = a.z0; z <= a.z1; z += a.step) {
      org.set(x, 12, z);
      rc.set(org, down);
      const hits = rc.intersectObjects(cand, false);
      const solid = [];
      for (const h of hits) {
        const o = h.object;
        if (!o.visible || !o.isMesh) continue;
        let m = o.material;
        if (Array.isArray(m)) m = m[0];
        if (!m || m.transparent || m.depthWrite === false) continue;
        solid.push(h);
      }
      probes++;
      for (let i = 0; i < solid.length - 1; i++) {
        if (Math.abs(solid[i].distance - solid[i + 1].distance) > 0.001) continue;
        const a = solid[i].object, b = solid[i + 1].object;
        const ma = Array.isArray(a.material) ? a.material[0] : a.material;
        const mb = Array.isArray(b.material) ? b.material[0] : b.material;
        const tag = (o, m) => (o.name || '?') + '#' + o.uuid.slice(0, 4) +
                              '[' + (m.name || m.type) + '@' + m.uuid.slice(0, 4) + ']';
        const key = (a === b ? 'SELF ' : '') + tag(a, ma) + ' :: ' + tag(b, mb);
        const e = pairs.get(key) || { key, n: 0, y: +solid[i].point.y.toFixed(4),
                                      minx: 1e9, maxx: -1e9, minz: 1e9, maxz: -1e9 };
        e.n++;
        e.minx = Math.min(e.minx, x); e.maxx = Math.max(e.maxx, x);
        e.minz = Math.min(e.minz, z); e.maxz = Math.max(e.maxz, z);
        pairs.set(key, e);
      }
    }
  }
  return { probes, cand: cand.map(o => o.name || o.type), pairs: [...pairs.values()].sort((a, b) => b.n - a.n) };
}"""

REDHUNT = """() => {
  const F = globalThis.__FPS__, THREE = globalThis.__THREE_NS__;
  const box = new THREE.Box3();
  const out = [];
  F.scene.traverse((o) => {
    if (!o.isMesh && !o.isSprite && !o.isPoints) return;
    let mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const c = m.color, e = m.emissive;
      const red = (v) => v && v.r > 0.16 && v.r > v.g * 1.7 + 0.03 && v.r > v.b * 1.7 + 0.03;
      if (!red(c) && !red(e)) continue;
      let bb = null;
      try { box.setFromObject(o); bb = [ +box.min.x.toFixed(1), +box.min.y.toFixed(2), +box.min.z.toFixed(1),
                                          +box.max.x.toFixed(1), +box.max.y.toFixed(2), +box.max.z.toFixed(1) ]; }
      catch (err) { bb = null; }
      if (bb && bb[1] > 3.0) continue;   // only low / ground-level things
      out.push({ name: o.name || '(unnamed)', parent: (o.parent && o.parent.name) || '',
                 type: o.type, mat: m.name || m.type,
                 color: c ? '#' + c.getHexString() : null,
                 emissive: e ? '#' + e.getHexString() : null,
                 transparent: !!m.transparent, blending: m.blending,
                 depthWrite: m.depthWrite, side: m.side, visible: o.visible,
                 tris: o.geometry && o.geometry.index ? o.geometry.index.count / 3 :
                       (o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : null),
                 aabb: bb });
      break;
    }
  });
  return out;
}"""


def main():
    ensure_server()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 120 and not pg.evaluate(READY):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(2000)
        pg.evaluate("() => __FPS__.__test.startMission({seed: 7})")
        pg.wait_for_timeout(1500)
        # THREE is not on __FPS__; import the SAME module instance the page uses.
        pg.add_script_tag(type="module", content=(
            'import * as THREE from "three"; globalThis.__THREE_NS__ = THREE;'))
        pg.wait_for_function("() => !!globalThis.__THREE_NS__", timeout=30000)

        print("=== COPLANAR OPAQUE STACKS (down-raycast grid, 1 m, |dz| <= 1 mm) ===")
        r = pg.evaluate(COPLANAR, {"x0": -57.6297, "x1": 58, "z0": -57.3713, "z1": 54, "step": 1.0})
        print(f"probes: {r['probes']}  candidates: {sorted(set(r['cand']))}")
        for e in r["pairs"][:25]:
            print(f"  n={e['n']:5d}  y={e['y']}  x[{e['minx']},{e['maxx']}] z[{e['minz']},{e['maxz']}]  {e['key']}")
        if not r["pairs"]:
            print("  (none)")

        print("\n=== RED / MAROON LOW OBJECTS ===")
        reds = pg.evaluate(REDHUNT)
        for o in reds:
            print("  " + json.dumps(o))
        if not reds:
            print("  (none)")
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
