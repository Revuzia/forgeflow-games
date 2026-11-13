#!/usr/bin/env python
"""Signage-lane scene probe: list every mesh whose world bbox centre lies within
`--r` metres of a point, with its world bbox. python _sig_probe.py --course ember-1 --p 3.4,5.7,42"""
import argparse, json, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from _sig_shots import BASE, FLAGS, HEADLESS_FLAGS, leave_title, goto_course

PROBE_JS = r"""(o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  const out = [];
  const box = new THREE.Box3(), c = new THREE.Vector3(), P = new THREE.Vector3(o.p[0], o.p[1], o.p[2]);
  G.engine.scene.updateMatrixWorld(true);
  G.engine.scene.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    try { box.setFromObject(m); } catch (e) { return; }
    if (box.isEmpty()) return;
    box.getCenter(c);
    if (c.distanceTo(P) > o.r) return;
    const f = (v) => +v.toFixed(2);
    out.push({name: m.name || (m.parent && m.parent.name) || '?', mat: m.material && (m.material.name || (Array.isArray(m.material) ? m.material.map(x=>x.name).join('|') : '')),
      min: [f(box.min.x), f(box.min.y), f(box.min.z)], max: [f(box.max.x), f(box.max.y), f(box.max.z)], ro: m.renderOrder});
  });
  return out;
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", required=True)
    ap.add_argument("--p", required=True)
    ap.add_argument("--r", type=float, default=3.0)
    a = ap.parse_args()
    p = [float(x) for x in a.p.split(",")]
    with sync_playwright() as pw:
        try: br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        except Exception: br = pw.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto("%s?dev=1&quality=low" % BASE, wait_until="load", timeout=60_000)
        deadline = time.time() + 70
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            except Exception: pass
            pg.wait_for_timeout(400)
        leave_title(pg)
        if a.course != "keep": goto_course(pg, a.course)
        pg.wait_for_timeout(1500)
        for r in pg.evaluate(PROBE_JS, {"p": p, "r": a.r}):
            print(json.dumps(r))
        print("ATLAS", pg.evaluate("() => { const C = CRESTBOUND.game.course; const A = C._textAtlas; const e = CRESTBOUND.engine.stats; return {boards: C.texts.length, groups: C._textGroups ? C._textGroups.length : null, atlasH: A ? A.height : null, placed: A ? A.placed : null, draws: e.drawCalls, tris: e.tris}; }"))
        br.close()

if __name__ == "__main__":
    main()
