#!/usr/bin/env python
"""PIXEL -> OBJECT -> MATERIAL identifier.

    python a3pick.py --shot S1 --px 300,900 --px 1100,980

Raycasts the shipped camera through the named screen pixels and reports what
the frame is actually made of at that spot: object name, material name/type,
colour, roughness, metalness, which maps are bound, and the augment() opts if
it came from materials.js. Written because "a large flat untextured tan beam"
is a description of PIXELS and the fix has to happen at a NAMED GENERATOR —
guessing which mesh a critic meant is how a lane spends a wave on the wrong
object.
"""
import argparse, json, os, re, sys
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

PICK = """(a) => {
  const F = globalThis.__FPS__;
  const THREE = globalThis.__THREE_NS__;
  const cam = F.camera;
  const rc = new THREE.Raycaster();
  const ndc = { x: (a.x / a.w) * 2 - 1, y: -(a.y / a.h) * 2 + 1 };
  rc.setFromCamera(ndc, cam);
  rc.far = 400;
  const hits = rc.intersectObjects(F.scene.children, true);
  const out = [];
  for (const h of hits) {
    const o = h.object;
    if (!o.visible || !(o.isMesh || o.isSprite)) continue;
    let m = o.material;
    if (Array.isArray(m)) m = m[h.face && h.face.materialIndex != null ? h.face.materialIndex : 0];
    if (!m) continue;
    const maps = [];
    for (const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap'])
      if (m[k]) maps.push(k);
    out.push({
      dist: +h.distance.toFixed(2),
      obj: o.name || '(unnamed)',
      parent: (o.parent && o.parent.name) || '',
      type: o.type,
      mat: m.name || '(unnamed)',
      matType: m.type,
      color: m.color ? '#' + m.color.getHexString() : null,
      rough: m.roughness, metal: m.metalness,
      emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
      maps: maps,
      transparent: !!m.transparent, opacity: m.opacity,
      renderOrder: o.renderOrder,
      a3: (m.userData && m.userData.a3) ? {
        tile: m.userData.a3.tile, wet: m.userData.a3.wet, coat: m.userData.a3.coat,
        grunge: m.userData.a3.grunge, seam: m.userData.a3.seam, wear: m.userData.a3.wear,
        anti: m.userData.a3.anti,
      } : null,
      hasAugment: !!(m.userData && m.userData.a3),
      worldY: +h.point.y.toFixed(2),
    });
    if (out.length >= 4) break;
  }
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", default="S1")
    ap.add_argument("--px", action="append", required=True)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    a = ap.parse_args()
    ensure_server()
    shots_src = re.sub(r"^export\s+", "",
                       open(os.path.join(HERE, "shots.js"), encoding="utf-8").read(),
                       flags=re.M)
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": a.width, "height": a.height})
        pg.goto(URL, wait_until="load", timeout=90000)
        pg.add_script_tag(content=shots_src)
        pg.evaluate("window.__BR_SEEDS__ = SCENARIOS")
        pg.wait_for_function(
            "() => !!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim "
            "&& __FPS__.__test && typeof __FPS__.__test.capture === 'function')",
            timeout=120000)
        for _ in range(30):
            pg.wait_for_timeout(20)
        pg.evaluate("(n) => __FPS__.__test.setScenario(n, SCENARIOS[n])", a.shot)
        pg.evaluate("""() => { try { __FPS__.__test.freeze(true); } catch (e) {} }""")
        for _ in range(40):
            pg.wait_for_timeout(20)
        # THREE is not on __FPS__; import the SAME module instance the page
        # uses (via the page's own importmap) so Raycaster works on its objects.
        pg.add_script_tag(type="module", content=(
            'import * as THREE from "three"; globalThis.__THREE_NS__ = THREE;'))
        pg.wait_for_function("() => !!globalThis.__THREE_NS__", timeout=30000)
        for spec in a.px:
            x, y = [int(v) for v in spec.split(",")]
            try:
                r = pg.evaluate(PICK, {"x": x, "y": y, "w": a.width, "h": a.height})
            except Exception as e:
                r = {"error": str(e)[:300]}
            print(f"PX {x},{y} -> " + json.dumps(r, indent=1))
        br.close()


if __name__ == "__main__":
    main()
