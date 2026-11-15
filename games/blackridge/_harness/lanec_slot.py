#!/usr/bin/env python
"""LANE C — evaluate the wet_specular fragment maths in JS at a named ground
point, per emitter slot, so the red/green blob has a NUMBER and an emitter id
instead of an adjective.
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

EVAL = """(a) => {
  const F = globalThis.__FPS__;
  let mat = null;
  F.scene.traverse(o => { if (o.name === 'wet_specular') mat = o.material; });
  if (!mat) return { error: 'wet_specular not found' };
  const U = mat.uniforms;
  const uAR = U.uAR.value, uAT = U.uAT.value, uGain = U.uGain.value;
  const cam = F.camera.position;
  const out = [];
  for (const P of a.points) {
    const vW = { x: P[0], y: 0.014, z: P[2] };
    const tc = { x: cam.x - vW.x, y: cam.y - vW.y, z: cam.z - vW.z };
    const tl = Math.hypot(tc.x, tc.y, tc.z);
    const V = { x: tc.x / tl, y: tc.y / tl, z: tc.z / tl };
    const graze = 0.22 + 0.78 * smoothstep(0, 0.55, 1 - Math.abs(V.y));
    const N = { x: 0, y: 1, z: 0 };   // ripple-free reference normal
    const rows = [];
    for (let i = 0; i < U.uLPos.value.length; i++) {
      const LP = U.uLPos.value[i], C = U.uLCol.value[i], wide = U.uLWide.value[i];
      const Lv = { x: LP.x - vW.x, y: LP.y - vW.y, z: LP.z - vW.z };
      const dl = Math.hypot(Lv.x, Lv.y, Lv.z);
      if (dl > LP.w) continue;
      const L = { x: Lv.x / dl, y: Lv.y / dl, z: Lv.z / dl };
      let H = { x: V.x + L.x, y: V.y + L.y, z: V.z + L.z };
      const hl = Math.hypot(H.x, H.y, H.z); H = { x: H.x / hl, y: H.y / hl, z: H.z / hl };
      const NoH = H.y;
      if (NoH <= 0) continue;
      const Hn = { x: H.x - N.x * NoH, y: H.y - N.y * NoH, z: H.z - N.z * NoH };
      let T = { x: L.x + 1e-5, y: 0, z: L.z + 1e-5 };
      const tl2 = Math.hypot(T.x, T.z); T = { x: T.x / tl2, y: 0, z: T.z / tl2 };
      const B = { x: -T.z, y: 0, z: T.x };
      const aT = uAT + 0.5 * wide / Math.max(dl, 1);
      const ht = (Hn.x * T.x + Hn.z * T.z) / uAR;
      const hb = (Hn.x * B.x + Hn.z * B.z) / aT;
      const q = ht * ht + hb * hb;
      const lobe = Math.exp(-q / 0.09) * 0.85 + Math.exp(-q) * 0.85 + Math.exp(-q / 4) * 0.018;
      const atten = 1 - smoothstep(LP.w * 0.55, LP.w, dl);
      const v = lobe * atten;
      if (v < 1e-4) continue;
      rows.push({ slot: i, dl: +dl.toFixed(2), reach: LP.w, wide: +wide.toFixed(2),
                  aT: +aT.toFixed(3), q: +q.toFixed(4), lobe: +lobe.toFixed(4),
                  atten: +atten.toFixed(3),
                  rgb: [+(C.r * v * graze * uGain).toFixed(3),
                        +(C.g * v * graze * uGain).toFixed(3),
                        +(C.b * v * graze * uGain).toFixed(3)] });
    }
    rows.sort((p, q2) => (q2.rgb[0] + q2.rgb[1] + q2.rgb[2]) - (p.rgb[0] + p.rgb[1] + p.rgb[2]));
    out.push({ point: P, graze: +graze.toFixed(3), slots: rows.slice(0, 4) });
  }
  return { uAR, uAT, uGain,
           slotWide: U.uLWide.value.map(v => +v.toFixed(2)),
           slotPos: U.uLPos.value.map(v => [v.x, v.y, v.z, v.w]),
           slotCol: U.uLCol.value.map(c => [+c.r.toFixed(3), +c.g.toFixed(3), +c.b.toFixed(3)]),
           points: out };
  function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
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
        pg.wait_for_timeout(1200)
        pg.evaluate("""() => __FPS__.__test.placePlayer(5, 1.65, 8, 240 * Math.PI / 180, -30 * Math.PI / 180)""")
        pg.wait_for_timeout(400)
        pg.add_script_tag(type="module", content=(
            'import * as THREE from "three"; globalThis.__THREE_NS__ = THREE;'))
        pg.wait_for_function("() => !!globalThis.__THREE_NS__", timeout=30000)
        SCREEN = [(250, 470), (60, 500), (40, 620), (150, 380), (560, 330)]
        pts = pg.evaluate("""(a) => {
          const F = globalThis.__FPS__, THREE = globalThis.__THREE_NS__;
          const rc = new THREE.Raycaster(); rc.camera = F.camera; rc.far = 300;
          const out = [];
          for (const s of a) {
            rc.setFromCamera({x: (s[0]/1280)*2-1, y: -(s[1]/720)*2+1}, F.camera);
            let hit = null;
            for (const h of rc.intersectObjects(F.scene.children, true)) {
              if (h.object.visible && h.object.name === 'wet_specular') { hit = h; break; }
            }
            out.push(hit ? [+hit.point.x.toFixed(2), 0, +hit.point.z.toFixed(2)] : [0,0,0]);
          }
          return out;
        }""", SCREEN)
        print("screen->world:", list(zip(SCREEN, pts)))
        r = pg.evaluate(EVAL, {"points": pts})
        print(json.dumps(r, indent=1)[:6000])
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
