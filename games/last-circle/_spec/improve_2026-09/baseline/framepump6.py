"""Read-only frame-pipeline probe v4 for Last Circle (audit lane: frame-pipeline).

Box conditions measured this session: rAF throttled (about:blank 14.9 rAF/s headed), and 7 other
automated Chromes share the Intel UHD; gl.finish() blocked up to 188 s on a menu frame. So:
  * the kernel's rAF loop is STOPPED and frames are pumped by hand (the body of
    Kernel3D.start()'s loop, ffg_kernel_3d.js:475-491) at a fixed dt = 1/60;
  * the render call runs only on SAMPLED frames (every Nth) — those give exact draw calls,
    triangles and first-draw program compiles; the rest advance sim+view (updaters + mixers)
    without touching the GPU, which is what the CPU section timings, forced-layout counts and
    the heap-allocation sample measure.
Modifies nothing on disk except its own output JSON.
"""
import sys, json, os, math
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--enable-precise-memory-info"]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "framepump6_out.json")
EVERY = 30

INSTALL = r"""
() => {
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer;
  if (window.__FP__) return 'already';
  const FP = window.__FP__ = { upd: 0, mix: 0, n: 0, attr: null };
  r.info.autoReset = false;
  // v5: the shared iGPU lost the context under real draws (getProgramInfoLog -> null). Keep every JS-side
  // cost (culling, sorting, uniforms, program link, uploads, info counters) but skip the raster work.
  const gl = r.getContext();
  for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) gl[fn] = function () {};
  // per-draw attribution on sampled frames: pass (shadow / main / post) x top-level W group
  const gname = (o) => { let p = o; while (p && p.parent && p.parent !== W.scene) p = p.parent; return (p && p.parent === W.scene) ? (p.name || p.type) : 'other'; };
  const rbd = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (FP.attr) {
      const pass = scene === null ? 'shadow' : scene === W.scene ? 'main' : 'post';
      const key = pass + ':' + gname(object) + (object.isSkinnedMesh ? '[skinned]' : object.isInstancedMesh ? '[inst]' : '');
      const n = geometry.index ? geometry.index.count : (geometry.attributes.position ? geometry.attributes.position.count : 0);
      const inst = object.isInstancedMesh ? object.count : 1;
      const e = FP.attr[key] || (FP.attr[key] = [0, 0]);
      e[0]++; e[1] += Math.round(n / 3) * inst;
    }
    return rbd(camera, scene, geometry, material, object, group);
  };
  for (let i = 0; i < k._updaters.length; i++) {
    const f = k._updaters[i];
    k._updaters[i] = function (dt, el) { const t0 = performance.now(); try { return f(dt, el); } finally { FP.upd += performance.now() - t0; } };
  }
  const MP = W.THREE.AnimationMixer.prototype, mu = MP.update;
  MP.update = function (dt) { const t0 = performance.now(); try { return mu.call(this, dt); } finally { FP.mix += performance.now() - t0; } };
  FP.frame = (dt, doRender) => {
    FP.upd = 0; FP.mix = 0;
    const t0 = performance.now();
    k._stepTweens(dt);
    for (let i = 0; i < k._mixers.length; i++) k._mixers[i].update(dt);
    for (const u of k._updaters) u(dt, k.clock.elapsedTime);
    const t1 = performance.now();
    let calls = -1, tris = -1, p0 = r.info.programs ? r.info.programs.length : 0, rms = -1;
    if (doRender) {
      if (FP.wantAttr) FP.attr = {};
      r.info.reset();
      if (k.composer) k.composer.render(dt); else r.render(k.scene, k.camera);
      rms = +(performance.now() - t1).toFixed(2);
      calls = r.info.render.calls; tris = r.info.render.triangles;
      if (FP.attr) { FP.lastAttr = FP.attr; FP.attr = null; FP.wantAttr = false; }
    }
    const p1 = r.info.programs ? r.info.programs.length : 0;
    return [ +(t1 - t0).toFixed(2), +FP.upd.toFixed(2), +FP.mix.toFixed(2), rms, calls, tris, p1, p1 - p0, W.phase, +(W.t || 0).toFixed(2) ];
  };
  FP.pump = (n, dt, every, stopOnMatch) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      FP.n++;
      rows.push(FP.frame(dt, every > 0 && FP.n % every === 0));
      if (stopOnMatch && W.phase === 'match') break;
    }
    return rows;
  };
  return 'ok';
}
"""
# row: [simViewMs, updaterMs, mixerMs, renderSubmitMs(-1 = not rendered), draws, tris, programs, newPrograms, phase, W.t]

ENV = r"""
() => {
  const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext();
  const s = new W.THREE.Vector2(); r.getDrawingBufferSize(s);
  return { dpr: window.devicePixelRatio, rendererPR: r.getPixelRatio(), buffer: [s.x, s.y],
           programs: r.info.programs ? r.info.programs.length : 0, shadowMapSize: W.kernel.sun.shadow.mapSize.x,
           shadowExt: W.kernel.sun.shadow.camera.right, shadows: r.shadowMap.enabled, graphics: W.settings.graphics,
           bloomEnabled: W.kernel.bloom ? W.kernel.bloom.enabled : null, bloomStrength: W.kernel.bloom ? W.kernel.bloom.strength : null,
           composerPasses: W.kernel.composer ? W.kernel.composer.passes.map((p) => p.constructor.name + (p.enabled ? '' : '(off)')) : null,
           composerRTType: W.kernel.composer ? W.kernel.composer.renderTarget1.texture.type : null,
           preserveDrawingBuffer: gl.getContextAttributes().preserveDrawingBuffer, antialias: gl.getContextAttributes().antialias };
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
  const per = []; let chutes = 0, tags = 0, wpnVis = 0, skinnedTotal = 0, bonesMax = 0, wpnMeshes = 0;
  for (const a of W.actors) {
    let n = 0;
    a.obj.traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite) n++; if (o.isSkinnedMesh) { skinnedTotal++; bonesMax = Math.max(bonesMax, o.skeleton ? o.skeleton.bones.length : 0); } });
    per.push(n);
    if (a.chute) chutes++;
    if (a.nameTag && a.nameTag.visible) tags++;
    if (a.weaponMesh && a.weaponMesh.visible) { wpnVis++; a.weaponMesh.traverse((o) => { if (o.isMesh) wpnMeshes++; }); }
  }
  per.sort((x, y) => x - y);
  const groups = {};
  for (const name in W._groups) { let n = 0; W._groups[name].traverseVisible((o) => { if (o.isMesh || o.isLine || o.isSprite || o.isPoints) n++; }); groups[name] = n; }
  return { phase: W.phase, t: +W.t.toFixed(1), alive: W.match ? W.match.aliveCount() : null, actors: W.actors.length,
           perActorVisibleDrawables: { min: per[0], med: per[per.length >> 1], max: per[per.length - 1], sum: per.reduce((s, x) => s + x, 0) },
           skinnedMeshesVisibleOnActors: skinnedTotal, bonesPerSkeletonMax: bonesMax, weaponMeshesVisible: wpnMeshes,
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
    return shots * 6;
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
    s = sorted(a)
    return s[min(len(s) - 1, max(0, math.ceil(p * len(s)) - 1))]

def stats(c):
    return {"p50": pct(c, .5), "p90": pct(c, .9), "p99": pct(c, .99), "max": max(c), "mean": round(sum(c) / len(c), 2)} if c else None

def summarize(rows, label):
    if not rows: return {"label": label, "frames": 0}
    rend = [r for r in rows if r[3] >= 0]
    out = {"label": label, "frames": len(rows), "renderedFrames": len(rend)}
    for name, i in [("simViewMs", 0), ("updaterMs", 1), ("mixerMs", 2)]:
        out[name] = stats([r[i] for r in rows])
    for name, i in [("renderSubmitMs", 3), ("draws", 4), ("tris", 5)]:
        out[name] = stats([r[i] for r in rend])
    out["programsEnd"] = rows[-1][6]
    out["newProgramFrames"] = [{"i": i, "n": r[7], "submitMs": r[3], "phase": r[8], "t": r[9]} for i, r in enumerate(rows) if r[7] > 0][:40]
    out["simViewOver22ms"] = sum(1 for r in rows if r[0] > 22)
    out["renderedOver450draws"] = sum(1 for r in rend if r[4] > 450)
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

def save(res):
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)

def main():
    res = {"every": EVERY}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        ctx = br.new_context(viewport={"width": 1280, "height": 720})
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text[:300]) if m.type in ("error", "warning") else None)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Performance.enable")
        pg.goto(URL)
        pg.wait_for_function("() => window.__LC__ && window.__LC__.W && window.__LC__.W.kernel", timeout=180000)
        pg.wait_for_timeout(1500)
        pg.evaluate("() => window.__LC__.W.kernel.stop()")
        res["envMenu"] = pg.evaluate(ENV); print("env", res["envMenu"], flush=True)
        pg.evaluate(INSTALL)
        menu = pg.evaluate("() => window.__FP__.pump(60, 1/60, 0, false)")
        res["menu"] = summarize(menu, "menu"); print("menu", json.dumps(res["menu"])[:500], flush=True); save(res)
        # match start with the kernel loop OFF (startMatch only needs rAF for nextFrame())
        pg.evaluate("async () => { const t0 = performance.now(); window.__PRE = window.__LC__.W.kernel.renderer.info.programs.length; await window.__LC__.startMatch({ mode: 'standard', seed: 1, mapId: 'isla_viva' }); window.__SM_MS = performance.now() - t0; }")
        res["startMatchMs"] = pg.evaluate("() => Math.round(window.__SM_MS)")
        res["programsBeforeStartMatch"] = pg.evaluate("() => window.__PRE")
        res["programsAfterStartMatch"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.info.programs.length")
        print("startMatch", res["startMatchMs"], res["programsBeforeStartMatch"], "->", res["programsAfterStartMatch"], flush=True)
        pg.wait_for_timeout(300)
        pg.keyboard.press("Enter")          # hud.js:1235 lobby skip (offline only)
        pg.wait_for_function("() => ['drop','match'].includes(window.__LC__.W.phase)", timeout=60000)
        res["envDrop"] = pg.evaluate(ENV); save(res)
        pg.evaluate("() => { window.__FP__.wantAttr = true; }")
        drop = pg.evaluate("() => window.__FP__.pump(1, 1/60, 1, false)")   # FIRST drop frame, rendered
        res["attrFirstDrop"] = pg.evaluate("() => window.__FP__.lastAttr")
        res["firstDropFrame"] = drop[0]; print("first drop frame", drop[0], flush=True)
        drop += pg.evaluate("() => window.__FP__.pump(239, 1/60, 0, false)")
        res["censusDrop"] = pg.evaluate(CENSUS); print("census drop", json.dumps(res["censusDrop"])[:900], flush=True); save(res)
        m0 = metrics(cdp)
        chunk = pg.evaluate("() => window.__FP__.pump(240, 1/60, 0, false)")   # no render: pure CPU window
        m1 = metrics(cdp)
        drop += chunk
        res["cdpDrop"] = mdelta(m0, m1, len(chunk)); print("cdp drop", res["cdpDrop"], flush=True)
        for _ in range(20):
            if pg.evaluate("() => window.__LC__.W.phase") == "match": break
            drop += pg.evaluate("() => window.__FP__.pump(240, 1/60, 0, true)")
        res["drop"] = summarize(drop, "drop"); print("drop", json.dumps(res["drop"])[:900], flush=True); save(res)
        res["phaseAfterDrop"] = pg.evaluate("() => window.__LC__.W.phase")
        match = pg.evaluate("() => window.__FP__.pump(299, 1/60, 0, false)")
        pg.evaluate("() => { window.__FP__.wantAttr = true; }")
        match += pg.evaluate("() => window.__FP__.pump(1, 1/60, 1, false)")
        res["attrMatch5s"] = pg.evaluate("() => window.__FP__.lastAttr")
        res["censusMatch"] = pg.evaluate(CENSUS); print("census match", json.dumps(res["censusMatch"])[:900], flush=True); save(res)
        cdp.send("HeapProfiler.enable")
        cdp.send("HeapProfiler.startSampling", {"samplingInterval": 4096})
        m0 = metrics(cdp)
        chunk = pg.evaluate("() => window.__FP__.pump(600, 1/60, 0, false)")
        m1 = metrics(cdp)
        prof = cdp.send("HeapProfiler.stopSampling")["profile"]
        match += chunk
        res["cdpMatch"] = mdelta(m0, m1, len(chunk)); print("cdp match", res["cdpMatch"], flush=True)
        agg, aggFile = {}, {}
        def walk(n):
            cf = n["callFrame"]; url = cf.get("url", "")
            f = url.split("/")[-1].split("?")[0]
            key = "%s %s:%d" % (cf.get("functionName") or "(anon)", f, cf.get("lineNumber", -1) + 1)
            if n.get("selfSize", 0):
                agg[key] = agg.get(key, 0) + n["selfSize"]
                aggFile[f or "(native)"] = aggFile.get(f or "(native)", 0) + n["selfSize"]
            for c in n.get("children", []): walk(c)
        walk(prof["head"])
        res["allocWindowFrames"] = len(chunk)
        res["allocTotalKB"] = round(sum(agg.values()) / 1024)
        res["allocKBPerFrame"] = round(sum(agg.values()) / 1024 / max(1, len(chunk)), 1)
        res["allocTopSites"] = [[k, round(v / 1024)] for k, v in sorted(agg.items(), key=lambda kv: -kv[1])[:50]]
        res["allocByFile"] = [[k, round(v / 1024)] for k, v in sorted(aggFile.items(), key=lambda kv: -kv[1])[:20]]
        print("alloc", res["allocKBPerFrame"], "KB/frame", res["allocByFile"][:8], flush=True); save(res)
        match += pg.evaluate("() => window.__FP__.pump(300, 1/60, 0, false)")
        res["match"] = summarize(match, "match"); print("match", json.dumps(res["match"])[:900], flush=True)
        res["seriesDropSimView"] = [r[0] for r in drop]
        res["seriesMatchSimView"] = [r[0] for r in match]
        save(res)
        try:
            res["cadenceRpm"] = pg.evaluate(CADENCE)
        except Exception as e:
            res["cadenceErr"] = str(e)[:400]
        print("cadence", res.get("cadenceRpm"), res.get("cadenceErr"), flush=True)
        res["consoleErrors"] = logs[:40]
        save(res)
        br.close()
    print("wrote", OUT, flush=True)

if __name__ == "__main__":
    main()
