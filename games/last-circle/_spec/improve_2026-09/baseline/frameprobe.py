"""Read-only frame-pipeline probe for Last Circle (audit lane: frame-pipeline).

Drives the LIVE page on the already-running scoped server (127.0.0.1:8790) in a
real headed Chrome (same flags as _harness/botcheck.py), and records per rendered
frame: rAF gap, draw calls, triangles, program count, update-closure ms, mixer ms,
composer ms. Also: CDP Performance metrics (layouts per frame), a heap allocation
sample of the match, a scene census, and a frame-rate-dependence test of weapon
cadence through the real weapons.js update. Writes JSON next to this file.
Modifies nothing on disk except its own output.
"""
import sys, json, time, os
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--enable-precise-memory-info"]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frameprobe_out.json")

INSTALL = r"""
() => {
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer;
  if (window.__FP__) return 'already';
  const FP = window.__FP__ = { frames: [], on: false, updMs: 0, mixMs: 0, compMs: 0, progLog: [] };
  r.info.autoReset = false;
  // time the royale frame-pipeline closure(s)
  for (let i = 0; i < k._updaters.length; i++) {
    const f = k._updaters[i];
    k._updaters[i] = function (dt, el) { const t0 = performance.now(); try { return f(dt, el); } finally { FP.updMs += performance.now() - t0; } };
  }
  // time every AnimationMixer.update (the kernel ticks ~50 skeletons directly)
  const MP = W.THREE.AnimationMixer.prototype, mu = MP.update;
  MP.update = function (dt) { const t0 = performance.now(); try { return mu.call(this, dt); } finally { FP.mixMs += performance.now() - t0; } };
  // time the render submission (composer = RenderPass + bloom chain + OutputPass)
  const wrapRender = (obj, name) => { const o = obj[name].bind(obj); obj[name] = function (...a) { const t0 = performance.now(); try { return o(...a); } finally { FP.compMs += performance.now() - t0; } }; };
  if (k.composer) wrapRender(k.composer, 'render'); else wrapRender(r, 'render');
  let last = performance.now(), lastProg = r.info.programs ? r.info.programs.length : 0;
  const tick = () => {
    const now = performance.now();
    if (FP.on) {
      const prog = r.info.programs ? r.info.programs.length : 0;
      const row = [ +(now - last).toFixed(2), r.info.render.calls, r.info.render.triangles, prog, W.phase,
                    +FP.updMs.toFixed(2), +FP.mixMs.toFixed(2), +FP.compMs.toFixed(2), +(W.t || 0).toFixed(2) ];
      FP.frames.push(row);
      if (prog !== lastProg) FP.progLog.push({ frame: FP.frames.length - 1, phase: W.phase, t: +(W.t||0).toFixed(2), from: lastProg, to: prog, gap: row[0] });
      lastProg = prog;
    }
    r.info.reset(); FP.updMs = 0; FP.mixMs = 0; FP.compMs = 0;
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'ok';
}
"""

ENV = r"""
() => {
  const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext();
  let gpu = '';
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); gpu = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) {}
  const s = new W.THREE.Vector2(); r.getDrawingBufferSize(s);
  return { dpr: window.devicePixelRatio, rendererPR: r.getPixelRatio(), buffer: [s.x, s.y],
           css: [r.domElement.clientWidth, r.domElement.clientHeight], gpu,
           programs: r.info.programs ? r.info.programs.length : 0,
           shadowType: r.shadowMap.type, shadows: r.shadowMap.enabled, graphics: W.settings.graphics,
           composer: !!W.kernel.composer, bloomEnabled: W.kernel.bloom ? W.kernel.bloom.enabled : null,
           timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
}
"""

CENSUS = r"""
() => {
  const W = window.__LC__.W, cam = W.camera;
  const out = { mesh: 0, skinned: 0, instanced: 0, lines: 0, sprites: 0, points: 0, visibleDrawables: 0, materials: new Set(), skeletons: 0, bonesMax: 0 };
  W.scene.traverseVisible((o) => {
    if (o.isSkinnedMesh) { out.skinned++; if (o.skeleton) out.bonesMax = Math.max(out.bonesMax, o.skeleton.bones.length); }
    else if (o.isInstancedMesh) out.instanced++;
    else if (o.isMesh) out.mesh++;
    if (o.isLine) out.lines++;
    if (o.isSprite) out.sprites++;
    if (o.isPoints) out.points++;
    if (o.isMesh || o.isLine || o.isSprite || o.isPoints) { out.visibleDrawables++; const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => x && out.materials.add(x.uuid)); }
  });
  out.materials = out.materials.size;
  // per-actor drawables
  const per = [];
  let chutes = 0, tags = 0, wpnVis = 0;
  for (const a of W.actors) {
    let n = 0, sk = 0;
    a.obj.traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite) n++; if (o.isSkinnedMesh) sk++; });
    per.push(n);
    if (a.chute) chutes++;
    if (a.nameTag && a.nameTag.visible) tags++;
    if (a.weaponMesh && a.weaponMesh.visible) wpnVis++;
  }
  per.sort((x, y) => x - y);
  const groups = {};
  for (const name in W._groups) { let n = 0; W._groups[name].traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite || o.isPoints) n++; }); groups[name] = n; }
  return { phase: W.phase, t: W.t, alive: W.match ? W.match.aliveCount() : null, actors: W.actors.length,
           perActorDrawables: { min: per[0], med: per[per.length >> 1], max: per[per.length - 1] },
           skinnedPerActor: (() => { const a = W.actors[1] || W.actors[0]; let s = 0; a.obj.traverse((o) => { if (o.isSkinnedMesh) s++; }); return s; })(),
           chutesOut: chutes, nameTagsVisible: tags, weaponsVisible: wpnVis, groups, mixers: W.kernel._mixers.length, ...out,
           geometries: W.kernel.renderer.info.memory.geometries, textures: W.kernel.renderer.info.memory.textures };
}
"""

CADENCE = r"""
async () => {
  // Frame-rate dependence of weapon cadence, through the REAL weapons.js update.
  const C = window.__LC__, W = C.W;
  const V = new URL(document.querySelector('script[type=module]').src).search;
  const wm = await import('/games/last-circle/runtime/3d/royale/weapons.js' + V);
  await C.startMatch({ mode: 'practice', seed: 7, mapId: 'isla_viva' });
  // wait for the lobby to hand off
  for (let i = 0; i < 200 && W.phase !== 'match'; i++) await new Promise((r) => setTimeout(r, 50));
  const a = W.player;
  let shots = 0;
  W.events.on('shotFired', (who) => { if (who === a) shots++; });
  const res = {};
  const run = (wid, h, jitterMs) => {
    a.weapon = { id: wid, rarity: 0, magAmmo: 1e9, state: 'ready', cd: 0, reloadT: 0 };
    a.inventory.slots[0] = { kind: 'weapon', id: wid, rarity: 0, mag: 1e9 };
    a.gliding = false; a.healing = null; a.swimming = false; a.mantleT = null;
    a.inventory.ammo = { light: 1e9, medium: 1e9, shells: 1e9, heavy: 1e9, grenades: 1e9 };
    shots = 0;
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let t = 0;
    while (t < 10) {
      const dt = Math.min(0.05, h + (jitterMs ? (rnd() - 0.5) * 2 * jitterMs / 1000 : 0));
      a.input.fire = true; a.input.slot = -1; a.input.reload = false;
      wm.update(W, dt);
      t += dt;
    }
    a.input.fire = false;
    return Math.round(shots * 6);   // shots in 10 s -> rpm
  };
  for (const wid of ['smg', 'ar']) {
    res[wid] = {};
    for (const hz of [165, 144, 120, 75, 60, 50, 30, 20]) res[wid][hz + 'Hz'] = run(wid, 1 / hz, 0);
    res[wid]['60Hz_jitter0.5ms'] = run(wid, 1 / 60, 0.5);
  }
  return res;
}
"""

def pct(a, p):
    if not a: return None
    s = sorted(a); return s[min(len(s) - 1, max(0, int(-(-p * len(s) // 1)) - 1))]

def summarize(frames, label):
    if not frames: return {"label": label, "frames": 0}
    col = lambda i: [f[i] for f in frames]
    out = {"label": label, "frames": len(frames)}
    for name, i in [("gapMs", 0), ("draws", 1), ("tris", 2), ("updMs", 5), ("mixMs", 6), ("compMs", 7)]:
        c = col(i)
        out[name] = {"p50": pct(c, .5), "p90": pct(c, .9), "p99": pct(c, .99), "max": max(c), "mean": round(sum(c) / len(c), 2)}
    out["programsStart"] = frames[0][3]; out["programsEnd"] = frames[-1][3]
    out["framesOver22ms"] = sum(1 for f in frames if f[0] > 22)
    out["framesOver450draws"] = sum(1 for f in frames if f[1] > 450)
    return out

def main():
    res = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        ctx = br.new_context(viewport={"width": 1280, "height": 720})
        pg = ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text[:300]) if m.type in ("error", "warning") else None)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Performance.enable")
        t0 = time.time()
        pg.goto(URL)
        pg.wait_for_function("() => window.__LC__ && window.__LC__.W && window.__LC__.W.kernel", timeout=120000)
        res["bootToLCs"] = round(time.time() - t0, 2)
        pg.wait_for_timeout(2500)
        res["envMenu"] = pg.evaluate(ENV)
        print("env", res["envMenu"], flush=True)
        pg.evaluate(INSTALL)
        # menu sample
        pg.evaluate("() => { window.__FP__.frames = []; window.__FP__.progLog = []; window.__FP__.on = true; }")
        pg.wait_for_timeout(4000)
        menu = pg.evaluate("() => { window.__FP__.on = false; return window.__FP__.frames; }")
        res["menu"] = summarize(menu, "menu")
        print("menu", res["menu"], flush=True)
        # start a standard 50-player match
        pg.evaluate("() => { window.__FP__.frames = []; window.__FP__.progLog = []; window.__FP__.on = true; }")
        ts = time.time()
        pg.evaluate("async () => { window.__SM_T0 = performance.now(); await window.__LC__.startMatch({ mode: 'standard', seed: 1, mapId: 'isla_viva' }); window.__SM_MS = performance.now() - window.__SM_T0; }")
        res["startMatchMs"] = pg.evaluate("() => Math.round(window.__SM_MS)")
        res["programsAfterStartMatch"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.info.programs.length")
        pg.wait_for_function("() => window.__LC__.W.phase === 'drop' || window.__LC__.W.phase === 'match'", timeout=30000)
        res["programsAtDropStart"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.info.programs.length")
        # restart frame capture at drop start (loading/lobby frames are separate)
        loading = pg.evaluate("() => { const f = window.__FP__.frames; window.__FP__.frames = []; return f; }")
        res["loadingLobby"] = summarize(loading, "loading+lobby")
        pg.wait_for_timeout(6000)
        res["censusDrop"] = pg.evaluate(CENSUS)
        print("census drop", res["censusDrop"], flush=True)
        m0 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        f0 = pg.evaluate("() => window.__FP__.frames.length")
        pg.wait_for_timeout(10000)
        m1 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        f1 = pg.evaluate("() => window.__FP__.frames.length")
        nf = max(1, f1 - f0)
        res["cdpDropWindow"] = {"frames": nf,
            "layoutsPerFrame": round((m1["LayoutCount"] - m0["LayoutCount"]) / nf, 2),
            "styleRecalcsPerFrame": round((m1["RecalcStyleCount"] - m0["RecalcStyleCount"]) / nf, 2),
            "layoutMsPerFrame": round((m1["LayoutDuration"] - m0["LayoutDuration"]) * 1000 / nf, 3),
            "styleMsPerFrame": round((m1["RecalcStyleDuration"] - m0["RecalcStyleDuration"]) * 1000 / nf, 3),
            "scriptMsPerFrame": round((m1["ScriptDuration"] - m0["ScriptDuration"]) * 1000 / nf, 2),
            "heapMBStart": round(m0["JSHeapUsedSize"] / 1e6, 1), "heapMBEnd": round(m1["JSHeapUsedSize"] / 1e6, 1)}
        print("cdp drop", res["cdpDropWindow"], flush=True)
        # wait for landing -> match
        try:
            pg.wait_for_function("() => window.__LC__.W.phase === 'match'", timeout=60000)
        except Exception as e:
            res["matchWaitErr"] = str(e)[:200]
        drop = pg.evaluate("() => { const f = window.__FP__.frames; window.__FP__.frames = []; return f; }")
        res["drop"] = summarize(drop, "drop")
        res["progLogDrop"] = pg.evaluate("() => window.__FP__.progLog.slice(0, 60)")
        print("drop", res["drop"], flush=True)
        # match: heap sampling window
        cdp.send("HeapProfiler.enable")
        cdp.send("HeapProfiler.startSampling", {"samplingInterval": 8192})
        m0 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        f0 = pg.evaluate("() => window.__FP__.frames.length")
        pg.wait_for_timeout(12000)
        m1 = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        f1 = pg.evaluate("() => window.__FP__.frames.length")
        prof = cdp.send("HeapProfiler.stopSampling")["profile"]
        nf = max(1, f1 - f0)
        res["cdpMatchWindow"] = {"frames": nf,
            "layoutsPerFrame": round((m1["LayoutCount"] - m0["LayoutCount"]) / nf, 2),
            "styleRecalcsPerFrame": round((m1["RecalcStyleCount"] - m0["RecalcStyleCount"]) / nf, 2),
            "layoutMsPerFrame": round((m1["LayoutDuration"] - m0["LayoutDuration"]) * 1000 / nf, 3),
            "styleMsPerFrame": round((m1["RecalcStyleDuration"] - m0["RecalcStyleDuration"]) * 1000 / nf, 3),
            "scriptMsPerFrame": round((m1["ScriptDuration"] - m0["ScriptDuration"]) * 1000 / nf, 2),
            "heapMBStart": round(m0["JSHeapUsedSize"] / 1e6, 1), "heapMBEnd": round(m1["JSHeapUsedSize"] / 1e6, 1)}
        # aggregate sampled allocations by (function url:line) — self size
        agg = {}
        def walk(n):
            cf = n["callFrame"]; url = cf.get("url", "")
            key = "%s %s:%d" % (cf.get("functionName") or "(anon)", url.split("/")[-1].split("?")[0], cf.get("lineNumber", -1) + 1)
            if n.get("selfSize", 0): agg[key] = agg.get(key, 0) + n["selfSize"]
            for c in n.get("children", []): walk(c)
        walk(prof["head"])
        top = sorted(agg.items(), key=lambda kv: -kv[1])[:40]
        res["allocTop"] = [[k, round(v / 1024)] for k, v in top]
        res["allocTotalKB"] = round(sum(agg.values()) / 1024)
        pg.wait_for_timeout(8000)
        res["censusMatch"] = pg.evaluate(CENSUS)
        match = pg.evaluate("() => { window.__FP__.on = false; const f = window.__FP__.frames; window.__FP__.frames = []; return f; }")
        res["match"] = summarize(match, "match")
        res["progLogAll"] = pg.evaluate("() => window.__FP__.progLog.slice(0, 80)")
        res["envMatch"] = pg.evaluate(ENV)
        print("match", res["match"], flush=True)
        # cadence (practice match)
        try:
            res["cadenceRpm"] = pg.evaluate(CADENCE)
        except Exception as e:
            res["cadenceErr"] = str(e)[:400]
        print("cadence", res.get("cadenceRpm"), res.get("cadenceErr"), flush=True)
        res["consoleErrors"] = logs[:40]
        br.close()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print("wrote", OUT)

if __name__ == "__main__":
    main()
