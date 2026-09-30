"""Read-only frame-pipeline probe v2 for Last Circle (audit lane: frame-pipeline).

rAF on this box is throttled (about:blank measured 14.9 rAF/s headed, 0.4 headless),
so frame timing cannot come from rAF. Instead this stops the kernel's own rAF loop
and PUMPS full frames by hand — the exact body of Kernel3D.start()'s loop
(ffg_kernel_3d.js:475-491: tweens, mixers, updaters, composer.render) — at a fixed
dt of 1/60, timing each section, plus gl.finish() so GPU work is included
(CPU+GPU serialized = an upper bound on a pipelined frame). Draw calls, triangles and
program counts are exact regardless of timing. Also: forced synchronous layouts per
frame (CDP LayoutCount across a pump that never yields — any layout inside it was
forced by a JS read), a sampled heap-allocation profile of the pumped match, a scene
census, and weapon cadence vs frame rate through the real weapons.js update.
Modifies nothing on disk except its own output JSON.
"""
import sys, json, time, os
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--enable-precise-memory-info"]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "framepump_out.json")

INSTALL = r"""
() => {
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer, gl = r.getContext();
  if (window.__FP__) return 'already';
  const FP = window.__FP__ = { upd: 0, mix: 0, comp: 0 };
  r.info.autoReset = false;
  for (let i = 0; i < k._updaters.length; i++) {
    const f = k._updaters[i];
    k._updaters[i] = function (dt, el) { const t0 = performance.now(); try { return f(dt, el); } finally { FP.upd += performance.now() - t0; } };
  }
  const MP = W.THREE.AnimationMixer.prototype, mu = MP.update;
  MP.update = function (dt) { const t0 = performance.now(); try { return mu.call(this, dt); } finally { FP.mix += performance.now() - t0; } };
  // one frame = the body of Kernel3D.start()'s loop, verbatim order, fixed dt
  FP.frame = (dt) => {
    FP.upd = 0; FP.mix = 0; r.info.reset();
    const p0 = r.info.programs ? r.info.programs.length : 0;
    const t0 = performance.now();
    k._stepTweens(dt);
    for (let i = 0; i < k._mixers.length; i++) k._mixers[i].update(dt);
    for (const u of k._updaters) u(dt, k.clock.elapsedTime);
    const t1 = performance.now();
    if (k.composer) k.composer.render(dt); else r.render(k.scene, k.camera);
    const t2 = performance.now();
    gl.finish();
    const t3 = performance.now();
    const p1 = r.info.programs ? r.info.programs.length : 0;
    return [ +(t3 - t0).toFixed(2), +(t1 - t0).toFixed(2), +FP.upd.toFixed(2), +FP.mix.toFixed(2), +(t2 - t1).toFixed(2), +(t3 - t2).toFixed(2),
             r.info.render.calls, r.info.render.triangles, p1, p1 - p0, W.phase, +(W.t || 0).toFixed(2) ];
  };
  FP.pump = (n, dt) => { const rows = []; for (let i = 0; i < n; i++) { rows.push(FP.frame(dt)); if (W.phase === 'match' && FP.stopOnMatch) break; } return rows; };
  return 'ok';
}
"""
# row: [total, simAndView, updaterClosure, mixers, renderSubmit, glFinish, draws, tris, programs, newPrograms, phase, W.t]

ENV = r"""
() => {
  const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext();
  let gpu = '';
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); gpu = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) {}
  const s = new W.THREE.Vector2(); r.getDrawingBufferSize(s);
  return { dpr: window.devicePixelRatio, rendererPR: r.getPixelRatio(), buffer: [s.x, s.y],
           programs: r.info.programs ? r.info.programs.length : 0, shadowMapSize: W.kernel.sun.shadow.mapSize.x,
           shadows: r.shadowMap.enabled, graphics: W.settings.graphics, composer: !!W.kernel.composer,
           bloomEnabled: W.kernel.bloom ? W.kernel.bloom.enabled : null, bloomStrength: W.kernel.bloom ? W.kernel.bloom.strength : null,
           composerPasses: W.kernel.composer ? W.kernel.composer.passes.map((p) => p.constructor.name + (p.enabled ? '' : '(off)')) : null,
           preserveDrawingBuffer: gl.getContextAttributes().preserveDrawingBuffer, antialias: gl.getContextAttributes().antialias, gpu };
}
"""

CENSUS = r"""
() => {
  const W = window.__LC__.W;
  const out = { mesh: 0, skinned: 0, instanced: 0, lines: 0, sprites: 0, points: 0, visibleDrawables: 0, castShadow: 0 };
  const mats = new Set();
  W.scene.traverseVisible((o) => {
    if (o.isSkinnedMesh) out.skinned++; else if (o.isInstancedMesh) out.instanced++; else if (o.isMesh) out.mesh++;
    if (o.isLine) out.lines++; if (o.isSprite) out.sprites++; if (o.isPoints) out.points++;
    if (o.isMesh || o.isLine || o.isSprite || o.isPoints) { out.visibleDrawables++; if (o.castShadow) out.castShadow++; const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => x && mats.add(x.uuid)); }
  });
  out.materials = mats.size;
  const per = []; let chutes = 0, tags = 0, wpnVis = 0, skinnedTotal = 0, bonesMax = 0;
  for (const a of W.actors) {
    let n = 0;
    a.obj.traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite) n++; if (o.isSkinnedMesh) { skinnedTotal++; bonesMax = Math.max(bonesMax, o.skeleton ? o.skeleton.bones.length : 0); } });
    per.push(n);
    if (a.chute) chutes++;
    if (a.nameTag && a.nameTag.visible) tags++;
    if (a.weaponMesh && a.weaponMesh.visible) wpnVis++;
  }
  per.sort((x, y) => x - y);
  const groups = {};
  for (const name in W._groups) { let n = 0; W._groups[name].traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite || o.isPoints) n++; }); groups[name] = n; }
  return { phase: W.phase, t: +W.t.toFixed(1), alive: W.match ? W.match.aliveCount() : null, actors: W.actors.length,
           perActorVisibleDrawables: { min: per[0], med: per[per.length >> 1], max: per[per.length - 1], sum: per.reduce((s, x) => s + x, 0) },
           skinnedMeshesVisibleOnActors: skinnedTotal, bonesPerSkeletonMax: bonesMax,
           chutesOut: chutes, nameTagsVisible: tags, weaponsVisible: wpnVis, groups, mixers: W.kernel._mixers.length, ...out,
           geometries: W.kernel.renderer.info.memory.geometries, textures: W.kernel.renderer.info.memory.textures,
           programs: W.kernel.renderer.info.programs.length };
}
"""

CADENCE = r"""
async () => {
  const C = window.__LC__, W = C.W;
  const V = new URL(document.querySelector('script[type=module]').src).search;
  const wm = await import('/games/last-circle/runtime/3d/royale/weapons.js' + V);
  const a = W.player;
  let shots = 0;
  W.events.on('shotFired', (who) => { if (who === a) shots++; });
  const res = {};
  const run = (wid, h, jitterMs) => {
    a.alive = true; a.weapon = { id: wid, rarity: 0, magAmmo: 1e9, state: 'ready', cd: 0, reloadT: 0 };
    a.inventory.slots[0] = { kind: 'weapon', id: wid, rarity: 0, mag: 1e9 }; a.inventory.active = 0;
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
    return shots * 6;   // shots in 10 s -> rounds per minute
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
    s = sorted(a); import math
    return s[min(len(s) - 1, max(0, math.ceil(p * len(s)) - 1))]

def summarize(rows, label):
    if not rows: return {"label": label, "frames": 0}
    out = {"label": label, "frames": len(rows)}
    for name, i in [("totalMs", 0), ("simViewMs", 1), ("updaterMs", 2), ("mixerMs", 3), ("renderSubmitMs", 4), ("glFinishMs", 5), ("draws", 6), ("tris", 7)]:
        c = [r[i] for r in rows]
        out[name] = {"p50": pct(c, .5), "p90": pct(c, .9), "p99": pct(c, .99), "max": max(c), "mean": round(sum(c) / len(c), 2)}
    out["programsStart"] = rows[0][8] - rows[0][9]; out["programsEnd"] = rows[-1][8]
    out["newProgramFrames"] = [{"i": i, "n": r[9], "totalMs": r[0], "submitMs": r[4], "phase": r[10], "t": r[11]} for i, r in enumerate(rows) if r[9] > 0][:30]
    out["framesOver22ms"] = sum(1 for r in rows if r[0] > 22)
    out["framesOver450draws"] = sum(1 for r in rows if r[6] > 450)
    return out

def metrics(cdp):
    return {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}

def mdelta(m0, m1, nf):
    return {"frames": nf,
            "forcedLayoutsPerFrame": round((m1["LayoutCount"] - m0["LayoutCount"]) / nf, 2),
            "forcedStyleRecalcsPerFrame": round((m1["RecalcStyleCount"] - m0["RecalcStyleCount"]) / nf, 2),
            "layoutMsPerFrame": round((m1["LayoutDuration"] - m0["LayoutDuration"]) * 1000 / nf, 3),
            "styleMsPerFrame": round((m1["RecalcStyleDuration"] - m0["RecalcStyleDuration"]) * 1000 / nf, 3),
            "heapMBStart": round(m0["JSHeapUsedSize"] / 1e6, 1), "heapMBEnd": round(m1["JSHeapUsedSize"] / 1e6, 1)}

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
        pg.goto(URL)
        pg.wait_for_function("() => window.__LC__ && window.__LC__.W && window.__LC__.W.kernel", timeout=180000)
        pg.wait_for_timeout(2000)
        res["envMenu"] = pg.evaluate(ENV); print("env", res["envMenu"], flush=True)
        pg.evaluate(INSTALL)
        pg.evaluate("() => window.__LC__.W.kernel.stop()")
        menu = pg.evaluate("() => window.__FP__.pump(120, 1/60)")
        res["menu"] = summarize(menu, "menu"); print("menu", {k: res["menu"][k] for k in ("frames", "totalMs", "draws")}, flush=True)
        # match start (kernel rAF back on: startMatch awaits nextFrame()/compileAsync)
        pg.evaluate("() => window.__LC__.W.kernel.start()")
        pg.evaluate("async () => { const t0 = performance.now(); await window.__LC__.startMatch({ mode: 'standard', seed: 1, mapId: 'isla_viva' }); window.__SM_MS = performance.now() - t0; }")
        res["startMatchMs"] = pg.evaluate("() => Math.round(window.__SM_MS)")
        res["programsAfterStartMatch"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.info.programs.length")
        pg.wait_for_timeout(500)
        pg.keyboard.press("Enter")          # hud.js:1235 lobby skip (offline only)
        pg.wait_for_function("() => ['drop','match'].includes(window.__LC__.W.phase)", timeout=30000)
        pg.evaluate("() => window.__LC__.W.kernel.stop()")
        res["programsAtDropStart"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.info.programs.length")
        res["envDrop"] = pg.evaluate(ENV)
        # drop: pump in chunks, census mid-way
        drop = []
        drop += pg.evaluate("() => window.__FP__.pump(240, 1/60)")
        res["censusDrop"] = pg.evaluate(CENSUS); print("census drop", res["censusDrop"], flush=True)
        m0 = metrics(cdp)
        chunk = pg.evaluate("() => window.__FP__.pump(240, 1/60)")
        m1 = metrics(cdp)
        drop += chunk
        res["cdpDrop"] = mdelta(m0, m1, len(chunk)); print("cdp drop", res["cdpDrop"], flush=True)
        pg.evaluate("() => { window.__FP__.stopOnMatch = true; }")
        for _ in range(12):
            if pg.evaluate("() => window.__LC__.W.phase") == "match": break
            drop += pg.evaluate("() => window.__FP__.pump(240, 1/60)")
        pg.evaluate("() => { window.__FP__.stopOnMatch = false; }")
        res["drop"] = summarize(drop, "drop"); print("drop", {k: res["drop"][k] for k in ("frames", "totalMs", "draws", "renderSubmitMs")}, flush=True)
        res["phaseAfterDrop"] = pg.evaluate("() => window.__LC__.W.phase")
        # match: 20 s of pumped frames, heap sampling over the middle 10 s
        match = pg.evaluate("() => window.__FP__.pump(300, 1/60)")
        cdp.send("HeapProfiler.enable")
        cdp.send("HeapProfiler.startSampling", {"samplingInterval": 4096})
        m0 = metrics(cdp)
        chunk = pg.evaluate("() => window.__FP__.pump(600, 1/60)")
        m1 = metrics(cdp)
        prof = cdp.send("HeapProfiler.stopSampling")["profile"]
        match += chunk
        res["cdpMatch"] = mdelta(m0, m1, len(chunk)); print("cdp match", res["cdpMatch"], flush=True)
        agg = {}; aggFn = {}
        def walk(n):
            cf = n["callFrame"]; url = cf.get("url", "")
            f = url.split("/")[-1].split("?")[0]
            key = "%s %s:%d" % (cf.get("functionName") or "(anon)", f, cf.get("lineNumber", -1) + 1)
            if n.get("selfSize", 0):
                agg[key] = agg.get(key, 0) + n["selfSize"]
                aggFn[f or "(native)"] = aggFn.get(f or "(native)", 0) + n["selfSize"]
            for c in n.get("children", []): walk(c)
        walk(prof["head"])
        res["allocWindowFrames"] = len(chunk)
        res["allocTotalKB"] = round(sum(agg.values()) / 1024)
        res["allocKBPerFrame"] = round(sum(agg.values()) / 1024 / max(1, len(chunk)), 1)
        res["allocTopSites"] = [[k, round(v / 1024)] for k, v in sorted(agg.items(), key=lambda kv: -kv[1])[:45]]
        res["allocByFile"] = [[k, round(v / 1024)] for k, v in sorted(aggFn.items(), key=lambda kv: -kv[1])[:20]]
        match += pg.evaluate("() => window.__FP__.pump(300, 1/60)")
        res["censusMatch"] = pg.evaluate(CENSUS); print("census match", res["censusMatch"], flush=True)
        res["match"] = summarize(match, "match"); print("match", {k: res["match"][k] for k in ("frames", "totalMs", "draws", "renderSubmitMs")}, flush=True)
        # raw series for later inspection (draws + total per frame)
        res["seriesDrop"] = [[r[0], r[6], r[9]] for r in drop]
        res["seriesMatch"] = [[r[0], r[6], r[9]] for r in match]
        try:
            res["cadenceRpm"] = pg.evaluate(CADENCE)
        except Exception as e:
            res["cadenceErr"] = str(e)[:400]
        print("cadence", res.get("cadenceRpm"), res.get("cadenceErr"), flush=True)
        res["consoleErrors"] = logs[:40]
        br.close()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print("wrote", OUT, flush=True)

if __name__ == "__main__":
    main()
