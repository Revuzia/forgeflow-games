"""characters-art lane probe v4: incremental (one small evaluate per step, printed immediately).
Drop-cluster worst case + first-cull bounding-sphere cost. Read-only."""
import sys, json, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = __file__.replace("\\", "/").rsplit("/", 1)[0]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--enable-gpu","--disable-gpu-sandbox",
         "--disable-background-timer-throttling","--disable-renderer-backgrounding"]
JS = open(HERE + "/charprobe.js", encoding="utf-8").read()
T0 = time.time()
res = {}
def log(*a): print(f"{time.time()-T0:6.1f}s", *a, flush=True)
def short(f): return f"calls={f['calls']} tris={f['tris']:,}"
def top(f, n=14):
    for k, v in sorted(f["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:n]:
        print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
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
    for i in range(600):
        ph = pg.evaluate("() => window.__LC__.W.phase")
        if ph in ("drop", "match"): break
        time.sleep(2)
    log("phase", ph)
    for i in range(10):
        pg.evaluate("() => window.__LC__.fastForward(1, 1/30)")
    log("ff10 done")
    r = pg.evaluate("""() => { const P = window.__CP, W = window.__LC__.W; const bodies = [];
        for (const a of W.actors) if (a.rig) a.rig.scene.traverse((o) => { if (o.isSkinnedMesh) bodies.push(o); });
        const tA = performance.now(); const f0 = P.frame({}); const warm = performance.now() - tA;
        for (const b of bodies) b.boundingSphere = null;
        const tB = performance.now(); const f1 = P.frame({}); const cold = performance.now() - tB;
        return { bodies: bodies.length, warmFrameMs: +warm.toFixed(1), coldFrameMs: +cold.toFixed(1), base: f0 }; }""")
    res["bsphere"] = {k: r[k] for k in ("bodies", "warmFrameMs", "coldFrameMs")}
    log("bsphere", json.dumps(res["bsphere"]), "| base", short(r["base"]))
    pg.evaluate("""() => { const W = window.__LC__.W, THREE = W.THREE, P = window.__CP; const cam = W.camera;
        const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
        const c = cam.position.clone().addScaledVector(fwd, 22);
        const live = W.actors.filter((a) => a.alive && a.rig && a !== W._camFocus);
        window.__DC = { live, saved: live.map((a) => [a.obj.position.clone(), a.nameTag ? a.nameTag.visible : null, a.weaponMesh ? a.weaponMesh.visible : null]) };
        live.forEach((a, i) => { const ang = i * 2.39996, rr = 14 * Math.sqrt((i + 0.5) / live.length);
          a.obj.position.set(c.x + Math.cos(ang) * rr, cam.position.y - 4 + (i % 5) * 0.6, c.z + Math.sin(ang) * rr); });
        return live.length; }""")
    steps = [
        ("dc_simVis", "() => window.__CP.frame({})"),
        ("dc_real", "() => { for (const a of window.__DC.live) { if (a.nameTag) a.nameTag.visible = true; if (a.weaponMesh) a.weaponMesh.visible = true; } return window.__CP.frame({}); }"),
        ("dc_noChute", "() => { for (const a of window.__DC.live) if (a.chute) a.chute.visible = false; const f = window.__CP.frame({}); for (const a of window.__DC.live) if (a.chute) a.chute.visible = true; return f; }"),
        ("dc_noTags", "() => { for (const a of window.__DC.live) if (a.nameTag) a.nameTag.visible = false; const f = window.__CP.frame({}); for (const a of window.__DC.live) if (a.nameTag) a.nameTag.visible = true; return f; }"),
        ("dc_noCharShadow", "() => { const P = window.__CP; P.toggle('castShadow', false); const f = P.frame({}); P.toggle('castShadow', true); return f; }"),
        ("dc_world", "() => { const P = window.__CP; P.toggle('actors', false); const f = P.frame({}); P.toggle('actors', true); return f; }"),
    ]
    for name, js in steps:
        f = pg.evaluate(js); res[name] = f
        log(name, short(f))
        if name == "dc_real": top(f, 16)
        json.dump(res, open(HERE + "/dropcluster.json", "w"), indent=1)
    res["meta"] = pg.evaluate("() => ({ n: window.__DC.live.length, chutes: window.__DC.live.filter((a) => a.chute).length, t: window.__LC__.W.t })")
    log("meta", json.dumps(res["meta"]))
    json.dump(res, open(HERE + "/dropcluster.json", "w"), indent=1)
    br.close()
