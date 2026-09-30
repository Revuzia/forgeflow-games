"""characters-art lane probe v3: drop-cluster worst case (chutes + tags + weapons forced as a real cluster
would have them) and the first-cull bounding-sphere cost of the full roster. Read-only."""
import sys, json, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = __file__.replace("\\", "/").rsplit("/", 1)[0]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--enable-gpu","--disable-gpu-sandbox",
         "--disable-background-timer-throttling","--disable-renderer-backgrounding"]
JS = open(HERE + "/charprobe.js", encoding="utf-8").read()
T0 = time.time()
def log(*a): print(f"{time.time()-T0:6.1f}s", *a, flush=True)

SCEN = r"""
async () => {
  const C = window.__LC__, W = C.W, P = window.__CP, THREE = W.THREE;
  for (let i = 0; i < 10; i++) C.fastForward(1, 1/30);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = {};
  out.base = P.frame({});
  // (1) first-cull cost: forget every body's bounding sphere, then render ONE frame (three recomputes each
  //     visible skinned mesh's sphere by CPU-skinning every vertex at its first frustum test)
  const bodies = []; for (const a of W.actors) if (a.rig) a.rig.scene.traverse((o) => { if (o.isSkinnedMesh) bodies.push(o); });
  const tA = performance.now(); P.frame({}); const warm = performance.now() - tA;
  for (const b of bodies) b.boundingSphere = null;
  const tB = performance.now(); P.frame({}); const cold = performance.now() - tB;
  out.bsphere = { bodies: bodies.length, warmFrameMs: +warm.toFixed(1), coldFrameMs: +cold.toFixed(1) };
  // (2) realistic DROP cluster: every other actor, chute and all, in a 14 m ring 22 m ahead at the camera's
  //     height - 4 m, with nametags and weapons shown as update() would show them inside 70 m / 110 m
  const cam = W.camera; const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const c = cam.position.clone().addScaledVector(fwd, 22);
  const live = W.actors.filter((a) => a.alive && a.rig && a !== W._camFocus);
  const saved = live.map((a) => [a.obj.position.clone(), a.nameTag ? a.nameTag.visible : null, a.weaponMesh ? a.weaponMesh.visible : null]);
  live.forEach((a, i) => { const ang = i * 2.39996, rr = 14 * Math.sqrt((i + 0.5) / live.length);
    a.obj.position.set(c.x + Math.cos(ang) * rr, cam.position.y - 4 + (i % 5) * 0.6, c.z + Math.sin(ang) * rr); });
  out.dropCluster = { n: live.length, chutes: live.filter((a) => a.chute).length };
  out.dc_simVis = P.frame({});
  for (const a of live) { if (a.nameTag) a.nameTag.visible = true; if (a.weaponMesh) a.weaponMesh.visible = true; }
  out.dc_real = P.frame({});
  const chutes = live.map((a) => a.chute).filter(Boolean); for (const ch of chutes) ch.visible = false;
  out.dc_noChute = P.frame({});
  for (const ch of chutes) ch.visible = true;
  for (const a of live) if (a.nameTag) a.nameTag.visible = false;
  out.dc_noTags = P.frame({});
  for (const a of live) if (a.nameTag) a.nameTag.visible = true;
  P.toggle('castShadow', false); out.dc_noCharShadow = P.frame({}); P.toggle('castShadow', true);
  P.toggle('actors', false); out.dc_world = P.frame({}); P.toggle('actors', true);
  live.forEach((a, i) => { a.obj.position.copy(saved[i][0]); if (a.nameTag) a.nameTag.visible = saved[i][1]; if (a.weaponMesh) a.weaponMesh.visible = saved[i][2]; });
  // (3) corpse bookkeeping check after a synchronous fastForward (harness artifact probe)
  for (let i = 0; i < 40; i++) C.fastForward(1, 1/30);
  out.afterFF = { t: +W.t.toFixed(1), alive: W.actors.filter((a) => a.alive).length,
    deadStillParented: W.actors.filter((a) => !a.alive && a.obj.parent).length, mixers: W.kernel._mixers.length,
    tweens: W.kernel._tweens.length };
  await new Promise((r) => setTimeout(r, 6000));
  for (let k = 0; k < 60; k++) await new Promise((r) => requestAnimationFrame(r));
  out.afterRealTime = { deadStillParented: W.actors.filter((a) => !a.alive && a.obj.parent).length, tweens: W.kernel._tweens.length, mixers: W.kernel._mixers.length };
  return out;
}
"""
def short(f): return f"calls={f['calls']} tris={f['tris']:,}"
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.set_default_timeout(3000000)
    pg.goto(URL, wait_until="domcontentloaded", timeout=600000)
    pg.wait_for_function("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", timeout=1200000, polling=2000)
    pg.evaluate("(src) => { (0, eval)(src); return window.__CPinstall(); }", JS)
    log("ready")
    pg.evaluate("() => window.__LC__.startMatch({mapId:'isla_viva', mode:'standard', seed:7})")
    log("startMatch resolved")
    pg.wait_for_function("() => ['drop','match'].includes(window.__LC__.W.phase)", timeout=1200000, polling=500)
    r = pg.evaluate(SCEN)
    log("base", short(r["base"]))
    log("bsphere", json.dumps(r["bsphere"]))
    log("dropCluster", json.dumps(r["dropCluster"]))
    for k in ("dc_simVis", "dc_real", "dc_noChute", "dc_noTags", "dc_noCharShadow", "dc_world"):
        log(k, short(r[k]))
    for k, v in sorted(r["dc_real"]["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:16]:
        print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
    log("afterFF", json.dumps(r["afterFF"]))
    log("afterRealTime", json.dumps(r["afterRealTime"]))
    json.dump(r, open(HERE + "/dropcluster.json", "w"), indent=1)
    br.close()
