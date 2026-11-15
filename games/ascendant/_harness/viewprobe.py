#!/usr/bin/env python
"""One posed screenshot from an arbitrary safe coordinate.
Usage: python viewprobe.py <stage> <x> <y> <z> <yaw> <pitch> <outname>
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

POSE = r"""
async ([x, y, z, yaw, pitch]) => {
  const A = globalThis.ASCENDANT;
  const P = A.game.player;
  const T = { Vector3: P.pos.constructor };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  P.__test.teleport(new T.Vector3(x, y, z));
  P.__test.setVel(new T.Vector3(0, 0, 0));
  P.yaw = yaw; P.pitch = pitch;
  for (let k = 0; k < 30; k++) await frame();
  const dx = P.pos.x - x, dy = P.pos.y - y, dz = P.pos.z - z;
  if (Math.hypot(dx, dy, dz) > 2.0) {
    P.__test.teleport(new T.Vector3(x, y, z));
    P.__test.setVel(new T.Vector3(0, 0, 0));
    P.yaw = yaw; P.pitch = pitch;
    for (let k = 0; k < 8; k++) await frame();
  }
  return { px: +P.pos.x.toFixed(1), py: +P.pos.y.toFixed(1), pz: +P.pos.z.toFixed(1), state: A.game.state };
}
"""


def main():
    stage, x, y, z, yaw, pitch, out = (
        sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]),
        float(sys.argv[5]), float(sys.argv[6]), sys.argv[7])
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1600, "height": 900})
        pg.goto(f"{BASE}?dev=1&quality=high&stage={stage}", wait_until="load", timeout=60_000)
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
        pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", stage)
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                if pg.evaluate("(s)=>!!(ASCENDANT.game.stage && ASCENDANT.game.stage.def && ASCENDANT.game.stage.def.id===s)", stage):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1800)
        print("pose:", pg.evaluate(POSE, [x, y, z, yaw, pitch]))
        path = os.path.join(SHOTS, out)
        pg.screenshot(path=path)
        print(path)
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
