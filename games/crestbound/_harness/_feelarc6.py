"""Is the verdant-1 fort courtyard roofed by the rampart deck, or only the
west tower shaft? Up-rays from courtyard height at several (x, z)."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

JS = r"""
(pts) => {
  const bp = CRESTBOUND.game.course.broadphase, THREE = CRESTBOUND.THREE;
  const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
  return pts.map((s) => {
    const o = new THREE.Vector3(s[0], s[1], s[2]);
    const ok = bp.raycast(o, new THREE.Vector3(0, 1, 0), 60, hit);
    let c = null;
    if (ok && hit.collider) {
      try {
        c = [[+hit.collider.center.x.toFixed(2), +hit.collider.center.y.toFixed(2),
              +hit.collider.center.z.toFixed(2)],
             [+hit.collider.half.x.toFixed(2), +hit.collider.half.y.toFixed(2),
              +hit.collider.half.z.toFixed(2)]];
      } catch (e) {}
    }
    return {from: s, hit: ok, y: ok ? +(s[1] + hit.t).toFixed(2) : null, c: c};
  });
}"""

with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 800, "height": 480})
    pg.goto(FS.DEFAULT_URL, wait_until="load", timeout=90_000)
    dl = time.time() + 150
    while time.time() < dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(400)
    FS.leave_title(pg)
    pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
    FS.leave_title(pg, timeout=60)
    pg.wait_for_timeout(1500)
    pts = [[0, 10.0, -24], [0, 10.0, -20], [4, 10.0, -28], [-9.2, 10.0, -32.8],
           [-9.2, 10.0, -28.0], [0, 10.0, -30], [-4, 10.0, -24], [9.2, 10.0, -32.8]]
    for r in pg.evaluate(JS, pts):
        print("  up from %-20s -> ceiling y %s   collider c/h %s" % (r["from"], r["y"], r["c"]))
    b.close()
