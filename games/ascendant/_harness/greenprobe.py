#!/usr/bin/env python
"""Attribute the green pad wash by layer toggles. Down-course pose at cp0 of a
given stage; screenshot baseline, then with (a) checkpoint FX group hidden,
(b) stage.glowfield hidden, (c) scene.environment nulled. Prints the mean RGB
of the pad region (bottom-centre band) for each frame."""
import os
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image

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
async () => {
  const A = globalThis.ASCENDANT;
  const G = A.game, S = G.stage, P = G.player;
  const T = { Vector3: P.pos.constructor };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const cp = S.checkpoints[0];
  P.__test.teleport(new T.Vector3(cp.pos.x, cp.pos.y + 0.6, cp.pos.z));
  P.__test.setVel(new T.Vector3(0, 0, 0));
  P.yaw = -Math.PI / 2; P.pitch = -0.06;
  for (let k = 0; k < 40; k++) await frame();
  return 1;
}
"""

TOGGLE = r"""
async (which) => {
  const A = globalThis.ASCENDANT;
  const S = A.game.stage;
  let root = S.group; while (root.parent) root = root.parent;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let msg = 'noop';
  if (which === 'reset') {
    if (S._cpGroup) S._cpGroup.visible = true;
    root.traverse(m => { if (m.name === 'stage.glowfield') m.visible = true; });
    if (globalThis.__ascSavedEnv !== undefined) { root.environment = globalThis.__ascSavedEnv; globalThis.__ascSavedEnv = undefined; }
    msg = 'reset';
  } else if (which === 'cpfx') {
    if (S._cpGroup) { S._cpGroup.visible = false; msg = 'cp group hidden'; }
  } else if (which === 'glowfield') {
    root.traverse(m => { if (m.name === 'stage.glowfield') { m.visible = false; msg = 'glowfield hidden'; } });
  } else if (which === 'env') {
    globalThis.__ascSavedEnv = root.environment;
    root.environment = null;
    msg = 'environment nulled';
  }
  for (let k = 0; k < 8; k++) await frame();
  return msg;
}
"""


def region_mean(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    box = im.crop((int(w * 0.30), int(h * 0.80), int(w * 0.70), int(h * 0.97)))
    px = list(box.getdata())
    n = len(px)
    r = sum(p[0] for p in px) / n
    g = sum(p[1] for p in px) / n
    b = sum(p[2] for p in px) / n
    return f"rgb({r:.0f},{g:.0f},{b:.0f})"


def main():
    stage = sys.argv[1] if len(sys.argv) > 1 else "spire-1"
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
        pg.wait_for_timeout(1500)
        pg.evaluate(POSE)

        for tag, tog in [("base", None), ("nocpfx", "cpfx"), ("noglow", "glowfield"), ("noenv", "env")]:
            if tog:
                print(tag, "->", pg.evaluate(TOGGLE, tog))
            out = os.path.join(SHOTS, f"greenprobe_{stage}_{tag}.png")
            pg.screenshot(path=out)
            print(f"  {tag}: pad region {region_mean(out)}")
            if tog:
                pg.evaluate(TOGGLE, "reset")
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
