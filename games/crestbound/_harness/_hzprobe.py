#!/usr/bin/env python
"""CRESTBOUND hazard-lane probe: like drawprobe.py, but reports the ACTUAL drawn triangle
count for a THREE.BatchedMesh (sum of _multiDrawCounts over _multiDrawCount) instead of the
whole reserved index buffer, so a batched hazard's cost is comparable with the loose meshes it
replaced. Read-only."""
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
  const t0 = performance.now();
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  await G.__dev.goto(id);
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f,60); });
  const dl = t0 + 30000;
  while (performance.now() < dl && !live()) await tick();
  return live() ? {loadMs:+(performance.now()-t0).toFixed(1)} : {error:'never arrived'};
}"""

PROBE_JS = r"""async () => {
  const A = globalThis.CRESTBOUND, R = A.engine.renderer;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const rows = [];
  const chain = (o) => { const a=[]; let n=o; while(n && a.length<8){a.push(n.name||n.type);n=n.parent;} return a.join(' < '); };
  const tri = (g, grp, object) => {
    if (object && object.isBatchedMesh) {
      let n = 0; const c = object._multiDrawCounts, k = object._multiDrawCount|0;
      for (let i = 0; i < k; i++) n += c[i];
      return (n/3)|0;
    }
    const idx=g.index, pos=g.attributes&&g.attributes.position;
    let n = grp && grp.count!==Infinity && grp.count!=null ? grp.count : (idx?idx.count:(pos?pos.count:0));
    return (n/3)|0;
  };
  const orig = R.renderBufferDirect.bind(R);
  let capture = false;
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (capture) rows.push({
      name: object.name || '', type: object.type,
      mat: (material && (material.name || material.type)) || '',
      tris: tri(geometry, group, object) * (object.isInstancedMesh ? (object.count||1) : 1),
      sub: object.isBatchedMesh ? (object._multiDrawCount|0) : 0,
      shadow: !!(material && material.isMeshDepthMaterial) ? 1 : 0,
      chain: chain(object),
    });
    return orig(camera, scene, geometry, material, object, group);
  };
  for (let i = 0; i < 90; i++) await frame();
  capture = true;
  await frame();
  capture = false;
  R.renderBufferDirect = orig;
  return {rows, info: {calls: R.info.render.calls, tris: R.info.render.triangles,
                       programs: R.info.programs ? R.info.programs.length : null}};
}"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--courses", default="verdant-1")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "_hzprobe.json"))
    a = ap.parse_args()
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=a.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": a.width, "height": a.height})
        pg.goto("%s?dev=1&quality=%s" % (BASE, a.quality), wait_until="load", timeout=60000)
        dl = time.time() + 70
        while time.time() < dl:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(300)
        dl = time.time() + 90
        while time.time() < dl:
            st = pg.evaluate("CRESTBOUND.game.state")
            if st in ("keep", "playing"): break
            pg.evaluate(CLICK_JS); pg.wait_for_timeout(400)
        for cid in [c.strip() for c in a.courses.split(",") if c.strip()]:
            ld = pg.evaluate(LOAD_JS, cid)
            if ld.get("error"): out[cid] = ld; continue
            pg.wait_for_timeout(600)
            r = pg.evaluate(PROBE_JS)
            r["loadMs"] = ld.get("loadMs")
            out[cid] = r
        br.close()
    for cid, r in out.items():
        if r.get("error"): print("%s ERROR %s" % (cid, r["error"])); continue
        rows = r["rows"]
        hz = [x for x in rows if ("hz_" in x["chain"])]
        print("=" * 92)
        print("%s  frame draws=%d  info.calls=%d  info.tris=%s  load=%sms"
              % (cid, len(rows), r["info"]["calls"], f'{r["info"]["tris"]:,}', r.get("loadMs")))
        print("  HAZARD draws=%d  HAZARD tris=%s" % (len(hz), f'{sum(x["tris"] for x in hz):,}'))
        agg = {}
        for row in hz:
            key = (row["chain"].split(" < ")[0] or row["type"]) + (" | SHADOW" if row["shadow"] else "")
            e = agg.setdefault(key, {"n": 0, "tris": 0, "sub": 0})
            e["n"] += 1; e["tris"] += row["tris"]; e["sub"] += row["sub"]
        for k, e in sorted(agg.items(), key=lambda kv: -kv[1]["n"]):
            print("  %4d  %10s tris  %4d sub-draws  %s" % (e["n"], f'{e["tris"]:,}', e["sub"], k[:64]))
    with open(a.json, "w", encoding="utf-8") as f: json.dump(out, f, indent=1)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
