"""characters-art lane probe v5: ONE synchronous evaluate per scenario (so the frame pipeline cannot re-sync
positions mid-measurement). Drop cluster + ground cluster, each measured as shipped and with the fixes
SIMULATED in-page: decimated LOD0 geometry swapped onto the live SkinnedMeshes (same joints, verified),
canopies/nametags hidden (stand-in for 1-2 instanced draws), weapon shadows off. Snapshots of the real
game canvas before/after the geometry swap. Read-only: nothing is written to the repo."""
import sys, json, time, base64, os
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox",
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
JS = open(os.path.join(HERE, "charprobe.js"), encoding="utf-8").read()
T0 = time.time()
def log(*a): print(f"{time.time()-T0:6.1f}s", *a, flush=True)
def short(f): return f"calls={f['calls']} tris={f['tris']:,}"
SK = ["athlete", "juggernaut", "soldier", "viper", "wraith"]

LOADLOD = r"""
async (b64s) => {
  const W = window.__LC__.W, K = W.kernel;
  const toBuf = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  window.__LOD0 = {};
  for (const k in b64s) {
    const g = await new Promise((res, rej) => K.loader.parse(toBuf(b64s[k]), "", res, rej));
    g.scene.traverse((o) => { if (o.isSkinnedMesh && !window.__LOD0[k]) window.__LOD0[k] = o.geometry; });
  }
  return Object.keys(window.__LOD0);
}
"""

SCEN = r"""
([ffS, air]) => {
  const C = window.__LC__, W = C.W, P = window.__CP, THREE = W.THREE;
  for (let i = 0; i < ffS; i++) C.fastForward(1, 1/30);
  const cam = W.camera; cam.updateMatrixWorld();
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const c = cam.position.clone().addScaledVector(fwd, air ? 22 : 16);
  const live = W.actors.filter((a) => a.alive && a.rig && a !== W._camFocus);
  const saved = live.map((a) => [a.obj.position.clone(), a.nameTag ? a.nameTag.visible : null, a.weaponMesh ? a.weaponMesh.visible : null]);
  live.forEach((a, i) => { const ang = i * 2.39996, rr = 12 * Math.sqrt((i + 0.5) / live.length);
    const x = c.x + Math.cos(ang) * rr, z = c.z + Math.sin(ang) * rr;
    const y = air ? cam.position.y - 4 + (i % 5) * 0.6 : (W.map.heightAt ? W.map.heightAt(x, z) : 0);
    a.obj.position.set(x, y, z); });
  // as update() would show them inside 70 m (tags) / 110 m (weapons)
  for (const a of live) { if (a.nameTag) a.nameTag.visible = true; if (a.weaponMesh) a.weaponMesh.visible = true; }
  const snap = () => W.kernel.renderer.domElement.toDataURL("image/jpeg", 0.85);
  const out = { n: live.length, chutes: live.filter((a) => a.chute).length, t: +W.t.toFixed(1) };
  out.shipped = P.frame({}); out.snapShipped = snap();
  const swaps = [];
  for (const a of W.actors) { if (!a.rig) continue; const g0 = window.__LOD0[a.skin]; if (!g0) continue;
    a.rig.scene.traverse((o) => { if (o.isSkinnedMesh) { swaps.push([o, o.geometry, o.boundingSphere]); o.geometry = g0; } }); }
  out.swapped = swaps.length;
  out.lod0 = P.frame({}); out.snapLod0 = snap();
  const chutes = live.map((a) => a.chute).filter(Boolean); for (const ch of chutes) ch.visible = false;
  for (const a of live) if (a.nameTag) a.nameTag.visible = false;
  for (const a of W.actors) if (a.weaponMesh) a.weaponMesh.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  out.fixedSim = P.frame({});
  const cp = cam.position; const offShadow = [];
  for (const a of W.actors) { if (!a.rig) continue; const d = a.obj.getWorldPosition(new THREE.Vector3()).distanceTo(cp);
    if (d > 45) a.rig.scene.traverse((o) => { if (o.isSkinnedMesh && o.castShadow) { o.castShadow = false; offShadow.push(o); } }); }
  out.fixedSimNearShadow = P.frame({});
  P.toggle('actors', false); out.world = P.frame({}); P.toggle('actors', true);
  for (const o of offShadow) o.castShadow = true;
  for (const a of W.actors) if (a.weaponMesh) a.weaponMesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  for (const ch of chutes) ch.visible = true;
  for (const [o, g, bs] of swaps) { o.geometry = g; o.boundingSphere = bs; }
  live.forEach((a, i) => { a.obj.position.copy(saved[i][0]); if (a.nameTag) a.nameTag.visible = saved[i][1]; if (a.weaponMesh) a.weaponMesh.visible = saved[i][2]; });
  return out;
}
"""

res = {}
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.set_default_timeout(3000000)
    pg.goto(URL, wait_until="domcontentloaded", timeout=600000)
    pg.wait_for_function("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", timeout=1200000, polling=2000)
    pg.evaluate("(src) => { (0, eval)(src); return window.__CPinstall(); }", JS)
    b64s = {k: base64.b64encode(open(os.path.join(HERE, "dec", k + "_lod0.glb"), "rb").read()).decode() for k in SK}
    log("lod0 parsed", pg.evaluate(LOADLOD, b64s))
    pg.evaluate("() => window.__LC__.startMatch({mapId:'isla_viva', mode:'standard', seed:7})")
    log("startMatch resolved")
    ph = None
    for i in range(900):
        ph = pg.evaluate("() => window.__LC__.W.phase")
        if ph in ("drop", "match"): break
        time.sleep(2)
    log("phase", ph)
    for label, ffs, air in (("drop_t10", 10, True), ("ground_t45", 35, False)):
        r = pg.evaluate(SCEN, [ffs, air])
        for key in ("snapShipped", "snapLod0"):
            open(os.path.join(HERE, f"{label}_{key}.jpg"), "wb").write(base64.b64decode(r.pop(key).split(",", 1)[1]))
        res[label] = r
        log(f"[{label}] n={r['n']} chutes={r['chutes']} t={r['t']} swapped={r['swapped']}")
        for k in ("shipped", "lod0", "fixedSim", "fixedSimNearShadow", "world"):
            log(f"   {k:20s} {short(r[k])}")
        for k, v in sorted(r["shipped"]["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:14]:
            print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
        print("      fixedSimNearShadow breakdown:", flush=True)
        for k, v in sorted(r["fixedSimNearShadow"]["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:10]:
            print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
        json.dump(res, open(os.path.join(HERE, "cluster5.json"), "w"), indent=1)
    br.close()
