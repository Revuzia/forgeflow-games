#!/usr/bin/env python
"""CRESTBOUND hazard-lane visual check: teleport the hero next to each hazard on a course and
screenshot it, so the batched hazards can be read against the loose-mesh look they replaced."""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist",
         "--use-angle=d3d11", "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

CLICK_JS = r"""() => {
  const words = ['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(want) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return want; }
  return null; }"""

LOAD_JS = r"""async (id) => {
  const G = globalThis.CRESTBOUND.game;
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  await G.__dev.goto(id);
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f,60); });
  const t0 = performance.now();
  while (performance.now() - t0 < 30000 && !live()) await tick();
  return live();
}"""

LIST_JS = r"""() => {
  const C = globalThis.CRESTBOUND.game.course;
  const out = [];
  const box = new CRESTBOUND.THREE.Box3();
  for (const rec of C.hazards) {
    const h = rec.h || rec;
    if (!h || !h.mesh) continue;
    let c = null, r = 2;
    if (h.colliders && h.colliders.length) {
      c = [h.colliders[0].center.x, h.colliders[0].center.y, h.colliders[0].center.z];
      r = Math.max(h.colliders[0].half.x, h.colliders[0].half.y, h.colliders[0].half.z);
    } else if (h.center) { c = [h.center.x, h.center.y, h.center.z]; }
    else if (h.points && h.points.length) { c = [h.points[0].x, h.points[0].y, h.points[0].z]; }
    else if (h.hub) { c = [h.hub.x, h.hub.y, h.hub.z]; }
    if (!c) continue;
    out.push({kind: h.kind, c, r});
  }
  return out;
}"""

LOOK_JS = r"""async (spec) => {
  const G = globalThis.CRESTBOUND.game;
  G.__dev.noclip && G.__dev.noclip(true);
  G.__dev.tp(spec.x, spec.y, spec.z);
  const cam = G.cam;
  if (cam) { cam.yaw = spec.yaw; cam.pitch = spec.pitch; cam.dist = spec.dist; if (cam.mode==='follow') cam.mode='follow'; }
  const tick = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 26; i++) {
    if (cam) { cam.yaw = spec.yaw; cam.pitch = spec.pitch; cam.dist = spec.dist; }
    await tick();
  }
  return true;
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--out", default=os.path.join(HERE, "_hzshots"))
    ap.add_argument("--headless", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=a.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto("%s?dev=1&quality=high" % BASE, wait_until="load", timeout=60000)
        dl = time.time() + 70
        while time.time() < dl:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(300)
        dl = time.time() + 90
        while time.time() < dl:
            st = pg.evaluate("CRESTBOUND.game.state")
            if st in ("keep", "playing"): break
            pg.evaluate(CLICK_JS); pg.wait_for_timeout(400)
        ok = pg.evaluate(LOAD_JS, a.course)
        print("loaded", a.course, ok)
        pg.wait_for_timeout(700)
        haz = pg.evaluate(LIST_JS)
        seen = {}
        import math
        for h in haz:
            k = h["kind"]
            seen[k] = seen.get(k, 0) + 1
            if seen[k] > 1: continue
            cx, cy, cz = h["c"]
            d = max(7.0, h["r"] * 3.0 + 6.0)
            pg.evaluate(LOOK_JS, {"x": cx, "y": cy + 1.2, "z": cz + d * 0.15,
                                  "yaw": 0.0, "pitch": 0.12, "dist": d})
            path = os.path.join(a.out, "%s_%s.png" % (a.course, k))
            pg.screenshot(path=path)
            print("shot", k, path)
        br.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
