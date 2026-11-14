#!/usr/bin/env python
"""Name the collider that roofs the verdant-1 wall-kick shaft at y 14.40."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))

JS = r"""
() => {
  const G = CRESTBOUND.game, bp = G.course.broadphase, THREE = CRESTBOUND.THREE;
  const desc = (c) => {
    if (!c) return null;
    const a = c.aabb || (c.aabb = null);
    const o = {};
    try { o.min = [+c.aabb.min.x.toFixed(2), +c.aabb.min.y.toFixed(2), +c.aabb.min.z.toFixed(2)];
          o.max = [+c.aabb.max.x.toFixed(2), +c.aabb.max.y.toFixed(2), +c.aabb.max.z.toFixed(2)]; }
    catch (e) { o.aabb = 'n/a'; }
    o.surface = c.surface || null; o.group = c.group || null; o.solid = c.solid !== false;
    try { o.ref = c.ref && (c.ref.name || c.ref.kind || c.ref.id) || null; } catch (e) {}
    try { o.center = [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)],
          o.half = [+c.half.x.toFixed(2), +c.half.y.toFixed(2), +c.half.z.toFixed(2)]; } catch (e) {}
    return o;
  };
  const out = {};
  const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
  const shots = [[-9.2, -32.8], [-9.2, -31.8], [-9.2, -33.8], [-8.4, -32.8], [-10.0, -32.8]];
  out.up = shots.map((s) => {
    const o = new THREE.Vector3(s[0], 9.60, s[1]);
    const ok = bp.raycast(o, new THREE.Vector3(0, 1, 0), 60, hit);
    return {at: s, hit: ok, t: ok ? +hit.t.toFixed(2) : null,
            y: ok ? +(9.60 + hit.t).toFixed(2) : null, c: ok ? desc(hit.collider) : null};
  });
  // everything whose AABB straddles the shaft column between y 13 and 17
  const box = new THREE.Box3(new THREE.Vector3(-11.2, 13.0, -34.8),
                             new THREE.Vector3(-7.2, 17.5, -30.8));
  const arr = [];
  bp.query(box, arr);
  out.over_shaft = arr.filter((c) => c.solid !== false).map(desc);
  return out;
}"""

with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 900, "height": 520})
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
    r = pg.evaluate(JS)
    print("UP-RAYS from y 9.60 inside the shaft:")
    for u in r["up"]:
        print("   at %-16s -> y %s  %s" % (u["at"], u["y"], json.dumps(u["c"])))
    print("\nSOLID COLLIDERS overlapping the shaft column y 13.0..17.5:")
    for c in r["over_shaft"]:
        print("   %s" % json.dumps(c))
    json.dump(r, open(os.path.join(HERE, "_feelarc5.json"), "w"), indent=1)
    b.close()
