#!/usr/bin/env python
"""Attribution probe for the spire sun-disc blowout (LIGHTING ROUND 2).

Faces the camera INTO the sun (sunDir [-0.78, 0.10, -0.61] -> yaw ~0.907) at
checkpoint 0 of spire-1, then captures three frames:
  sunprobe_on.png      current state
  sunprobe_off.png     uSunIntensity forced to 0 (sky dome uniform)
  sunprobe_nobloom.png sun back on, bloom strength forced to 0

If the blowout survives sunprobe_off, the sun is NOT the source.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "..", "_shots")
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]

POSE = r"""
async (yaw) => {
  const A = globalThis.ASCENDANT;
  const G = A.game, S = G.stage, P = G.player;
  const T = { Vector3: P.pos.constructor };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const cp = S.checkpoints[0];
  P.__test.teleport(new T.Vector3(cp.pos.x, cp.pos.y + 0.6, cp.pos.z));
  P.__test.setVel(new T.Vector3(0, 0, 0));
  P.yaw = yaw;
  P.pitch = 0.02;
  for (let k = 0; k < 40; k++) await frame();
  return { x: cp.pos.x, y: cp.pos.y, z: cp.pos.z };
}
"""

SET_SUN = r"""
async (v) => {
  const A = globalThis.ASCENDANT;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let scene = null;
  let o = A.game.stage.group;
  while (o.parent) o = o.parent;
  scene = o;
  let hit = 0;
  scene.traverse(m => {
    if (m.material && m.material.uniforms && m.material.uniforms.uSunIntensity) {
      m.material.uniforms.uSunIntensity.value = v;
      hit++;
    }
  });
  for (let k = 0; k < 6; k++) await frame();
  return hit;
}
"""

SET_BLOOM = r"""
async (v) => {
  const A = globalThis.ASCENDANT;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const g = A.game;
  const eng = g.engine || g._engine || null;
  const post = (eng && eng.post) || (g.post) || null;
  if (!post) return 'no post handle';
  if (typeof post.setBloom === 'function') { post.setBloom({ strength: v, radius: 0.6, threshold: 1.1 }); }
  else if (post.bloom) { post.bloom.strength = v; }
  else return 'no bloom control';
  for (let k = 0; k < 6; k++) await frame();
  return 'ok';
}
"""

CLICK_JS = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const want of ['NEW RUN', 'PLAY', 'CONTINUE']) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (b.__activate) b.__activate(); else b.click();
      return want;
    }
  }
  return null;
}"""


def main():
    os.makedirs(SHOTS, exist_ok=True)
    yaw = 0.907
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1600, "height": 900})
        pg.goto(f"{BASE}?dev=1&quality=high&stage=spire-1", wait_until="load", timeout=60_000)
        deadline = time.time() + 70
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        deadline = time.time() + 25
        while time.time() < deadline:
            st = None
            try:
                st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
            except Exception:
                pass
            if st and st != "title":
                break
            try:
                pg.evaluate(CLICK_JS)
            except Exception:
                pass
            pg.wait_for_timeout(400)
        pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", "spire-1")
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(ASCENDANT.game.stage && ASCENDANT.game.stage.def && ASCENDANT.game.stage.def.id==='spire-1')"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(2000)

        print("pose:", pg.evaluate(POSE, yaw))
        pg.screenshot(path=os.path.join(SHOTS, "sunprobe_on.png"))
        print("sun off, domes touched:", pg.evaluate(SET_SUN, 0.0))
        pg.screenshot(path=os.path.join(SHOTS, "sunprobe_off.png"))
        print("sun restored, domes touched:", pg.evaluate(SET_SUN, 2.6))
        print("bloom:", pg.evaluate(SET_BLOOM, 0.0))
        pg.screenshot(path=os.path.join(SHOTS, "sunprobe_nobloom.png"))
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
