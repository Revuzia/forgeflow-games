#!/usr/bin/env python
"""What material is the green pad? Raycast down at checkpoint 0 and report."""
import os
import sys
import time
import json

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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

PROBE = r"""
async (stageId) => {
  const A = globalThis.ASCENDANT;
  const G = A.game, S = G.stage;
  let root = S.group; while (root.parent) root = root.parent;
  const cp = S.checkpoints[0];
  const out = [];
  // find every mesh whose bounding sphere covers the checkpoint XZ within 6 m
  root.traverse(m => {
    if (!m.isMesh && !m.isInstancedMesh) return;
    if (!m.geometry) return;
    if (!m.geometry.boundingSphere) { try { m.geometry.computeBoundingSphere(); } catch (e) { return; } }
    const bs = m.geometry.boundingSphere; if (!bs) return;
    const c = bs.center.clone();
    m.updateWorldMatrix(true, false);
    c.applyMatrix4(m.matrixWorld);
    const dx = c.x - cp.pos.x, dy = c.y - cp.pos.y, dz = c.z - cp.pos.z;
    const d = Math.hypot(dx, dy, dz) - bs.radius * Math.max(m.scale.x, 1);
    if (d > 4) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    out.push({
      name: m.name || '(unnamed)',
      type: m.type,
      dist: +d.toFixed(1),
      mats: mats.filter(Boolean).map(mt => ({
        n: mt.name || mt.type,
        color: mt.color ? '#' + mt.color.getHexString() : null,
        emissive: mt.emissive ? '#' + mt.emissive.getHexString() : null,
        eI: mt.emissiveIntensity !== undefined ? +Number(mt.emissiveIntensity).toFixed(2) : null,
      })),
    });
  });
  return out.slice(0, 40);
}
"""


def main():
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
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
        pg.wait_for_timeout(1500)
        print(json.dumps(pg.evaluate(PROBE, "spire-1"), indent=1))
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
