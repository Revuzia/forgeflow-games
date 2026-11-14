#!/usr/bin/env python
"""RENDER LANE (owner P7) — isolate a ground seam by toggling one thing at a time
and READING the frame each time.

For a station (course, hero position, camera aim) the engine is FROZEN
(engine.stop, so grass/water/coins do not move between renders), then ONE
composed frame is rendered per configuration and read back off the GPU:

    base          the shipped frame
    noTerrain     terrain group hidden          -> is the band terrain at all?
    noGrass       blade rings hidden            -> is it grass through the slab?
    terrainDown   terrain sunk 2 mm             -> if the band vanishes, it was coplanar z-fight
    polyOffset    terrain material polygonOffset (the generator fix)
    slopeOff      terrain slope blend disabled  -> is the hard line the dirt blend?

Every frame is saved as a PNG, and each configuration is DIFFED against
`terrainDown` (the ground truth "slab wins") over the whole frame minus the HUD
corners: a z-fight footprint is where base != terrainDown, and a fix is proven
when fix ~= terrainDown.

    python _rn_seam.py --station keep_apron
    python _rn_seam.py --station azure1_court --tag after
    python _rn_seam.py --list
"""
import argparse, base64, json, os, re, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.environ.get("RNURL", "http://localhost:8788/games/crestbound/index.html")
FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist",
         "--use-angle=d3d11", "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

# station: course, hero (x,y,z), cam yaw, pitch, dist
STATIONS = {
    # THE KEEP — the apron (stone, top 0.00) on the lawn flat (0.00): owner screenshot 3 / K3
    "keep_apron":     ("keep", (0.0, 0.6, 15.5), 0.0, -0.55, 4.0),
    "keep_apron_down": ("keep", (0.0, 0.6, 15.5), 0.0, 0.55, 4.0),
    "keep_apron_e":   ("keep", (8.0, 0.6, 16.0), 0.0, -0.55, 4.0),
    "keep_apron_low": ("keep", (-8.0, 0.6, 18.0), -1.57, 0.05, 2.5),   # along the seam, grazing
    "keep_doorway":   ("keep", (0.0, 0.6, 13.2), 0.0, -0.55, 4.0),    # lobby floor / heightfield overlap z 13..13.8
    "keep_path":      ("keep", (0.0, 0.6, 22.0), 3.1416, -0.5, 4.0),  # the path to the water (top -0.02)
    # AZURE-1 — the tester's two P7 spots
    "azure1_court":   ("azure-1", (-8.0, 2.0, -46.0), -1.65, -0.6, 4.0),
    "azure1_terrace": ("azure-1", (-14.0, 4.95, -22.0), -1.60, -0.55, 4.0),
    # VERDANT-1 fort apron (the sward-through-the-paving history)
    "verdant1_fort":  ("verdant-1", (0.0, 9.0, -8.0), 3.1416, -0.5, 4.5),
    # RIME-3 the gorge bridge mouth (hairlines) and the west face (dark/light split)
    "rime3_bridge":   ("rime-3", (-36.59, 6.6, -14.71), -0.14, 0.12, 6.8),
    "rime3_west":     ("rime-3", (-25.59, 3.4, 31.85), 0.0, 0.22, 6.8),
    # RIME-2 the mid station looking SW (the "dark ellipse")
    "rime2_mid":      ("rime-2", (36.0, 17.0, -4.0), 2.80, 0.22, 6.8),
    "rime2_mid_level":("rime-2", (36.0, 17.0, -4.0), 2.80, -0.02, 9.0),
    # EMBER-1 the shore
    "ember1_shore":   ("ember-1", (-8.44, 3.06, 35.93), -0.34, 0.22, 6.8),
    # VERDANT-2 the scarp from the spawn
    "verdant2_scarp": ("verdant-2", (0.0, 2.30, 53.0), 0.0, 0.22, 6.8),
}

CLICK_JS = r"""() => { const words=['CONTINUE','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
  for (const w of words) for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""
LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  if (!live()) await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""
PLACE_JS = r"""([x,y,z,yaw,pitch,dist]) => { const A=CRESTBOUND, G=A.game, THREE=A.THREE, P=G.player;
  G.__dev.tp(x, y, z);
  P.__test.setVel(new THREE.Vector3(0,0,0));
  P.__test.setFacing(yaw);
  return true; }"""
AIM_JS = r"""([yaw,pitch,dist]) => { const G=CRESTBOUND.game;
  if (G.cam) { G.cam.yaw = yaw; G.cam.pitch = pitch; G.cam.dist = dist; G.cam._pitchIdleT = -1e9; G.cam._lastManualT = G.cam._time; G.cam._rcHoldT = 0; G.cam._rcActive = false; G.cam._rcT = 0; }
  const c = G.cam; return [c.yaw, c.pitch, c.dist, 'mode=' + c.mode, 'cine=' + !!c._cine, 'adapt=' + (+c._pitchAdapt || 0).toFixed(3), 'slide=' + (+c._pitchSlide || 0).toFixed(3), 'rc=' + !!c._rcActive, 'peek=' + !!c._peekOn, 'death=' + !!c._deathOn, 'gstate=' + G.state]; }"""

# Freeze, apply a configuration, render once, read back. Returns a data-URL PNG
# plus the raw byte length so Python can diff. Restores the toggle afterwards.
SHOT_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, G = A.game, THREE = A.THREE;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  if (!E.__rnFrozen) { E.stop(); E.__rnFrozen = true; for (let k = 0; k < 3; k++) await frame(); }
  if (opts.pose && !E.__rnPosed) { E.__rnPosed = true; const c = G.cam; c._pitchIdleT = -1e9; c._rcActive = false; c._rcHoldT = 0; for (let k = 0; k < 240; k++) { c.yaw = opts.pose[0]; c.pitch = opts.pose[1]; c.dist = opts.pose[2]; c.update(1 / 60); } }
  const grp = G.course.group;
  const terrains = [], grasses = [], mats = new Set();
  grp.traverse(o => {
    if (o.name === 'terrain' && o.isGroup) terrains.push(o);
    if (o.name === 'terrain.grass' || o.name === 'terrain.grass.far') grasses.push(o);
    if (o.isMesh && o.material && typeof o.material.name === 'string' && o.material.name.indexOf('terrain_') === 0) mats.add(o.material);
  });
  const undo = [];
  const cfg = opts.cfg;
  let trimMeta = null;
  if (cfg === 'noTerrain') { for (const t of terrains) { const v = t.visible; t.visible = false; undo.push(() => t.visible = v); } }
  if (cfg === 'noGrass' || cfg === 'noTerrain') { for (const g of grasses) { const v = g.visible; g.visible = false; undo.push(() => g.visible = v); } }
  if (cfg === 'terrainDown') { for (const t of terrains) { const y = t.position.y; t.position.y = y - 0.002; t.updateMatrix(); t.updateMatrixWorld(true); undo.push(() => { t.position.y = y; t.updateMatrix(); t.updateMatrixWorld(true); }); } }
  if (cfg === 'polyOffset') { for (const m of mats) { const s = [m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits]; m.polygonOffset = true; m.polygonOffsetFactor = opts.pf; m.polygonOffsetUnits = opts.pu; undo.push(() => { m.polygonOffset = s[0]; m.polygonOffsetFactor = s[1]; m.polygonOffsetUnits = s[2]; }); } }
  if (cfg === 'slopeOff') { for (const m of mats) { const P = R.properties.get(m); const u = P && P.uniforms && P.uniforms.uCbSlope; const u2 = (m.uniforms && m.uniforms.uCbSlope) || u; if (u2 && u2.value) { const v = u2.value.clone(); u2.value.set(9, 9); undo.push(() => u2.value.copy(v)); } } }
  if (cfg === 'noShadow') { const s = R.shadowMap.enabled; R.shadowMap.enabled = false; undo.push(() => R.shadowMap.enabled = s); }
  if (cfg === 'farLod') { grp.traverse(o => { if (o.isLOD && o.levels.length > 1) { const d = o.levels[1].distance; o.levels[1].distance = 0; undo.push(() => o.levels[1].distance = d); } }); }
  if (cfg === 'jitter') { const c = E.camera; const px = c.position.x; c.position.x = px + 0.0004; c.updateMatrixWorld(true); undo.push(() => { c.position.x = px; c.updateMatrixWorld(true); }); }
  if (cfg === 'noFx') { A.engine.scene.traverse(o => { if (o.isMesh && /^fx\./.test(o.name || '')) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); grp.traverse(o => { if (o.isMesh && /^fx\./.test(o.name || '')) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  if (cfg === 'noWind') { A.engine.scene.traverse(o => { if ((o.isMesh || o.isLine || o.isPoints) && /wind|gust|streak|current|aurora/i.test(o.name || '')) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  if (cfg === 'noHazards') { for (const h of (G.course.hazards || [])) { const m = h && (h.mesh || (h.hazard && h.hazard.mesh)); if (m && m.visible !== false) { m.visible = false; undo.push(() => m.visible = true); } } }
  if (cfg === 'noSky') { const bg = A.engine.scene.background; A.engine.scene.background = null; undo.push(() => A.engine.scene.background = bg); A.engine.scene.traverse(o => { if (o.isMesh && /sky|dome|cloud|sun/i.test(o.name || '')) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  if (cfg === 'noLines') { A.engine.scene.traverse(o => { if (o.isLine) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  if (cfg === 'noPoints') { A.engine.scene.traverse(o => { if (o.isPoints) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  if (cfg === 'noFxMat' || cfg === 'noDecals' || cfg === 'noCoins' || cfg === 'noGlow') { const re = cfg === 'noFxMat' ? /^fx\.particles|^fx\.trail/ : (cfg === 'noDecals' ? /^fx\.decals/ : (cfg === 'noCoins' ? /^coins|^sigils|^crest/ : /glow|beam|pulse|em_/)); A.engine.scene.traverse(o => { if (o.isMesh && re.test(o.name || '') && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { const v = m.visible; m.visible = false; undo.push(() => m.visible = v); } } }); }
  if (cfg === 'noUnnamed') { A.engine.scene.traverse(o => { if (o.isMesh && !o.name && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { const v = m.visible; m.visible = false; undo.push(() => m.visible = v); } } }); }
  if (cfg === 'noBloom') { for (const p of (E.post && E.post.composer ? E.post.composer.passes : [])) { if (/Bloom/i.test(p.constructor.name)) { const v = p.enabled; p.enabled = false; undo.push(() => p.enabled = v); } } }
  if (cfg === 'noGrain') { const pp = E.post && E.post.presentPass; if (pp) { const v = pp.uniforms.uGrain.value; pp.uniforms.uGrain.value = 0; undo.push(() => pp.uniforms.uGrain.value = v); } }
  if (cfg.indexOf('blank:') === 0) { const re = new RegExp(cfg.slice(6)); A.engine.scene.traverse(o => { if (o.isMesh && re.test(o.name || '') && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { const v = m.visible; m.visible = false; undo.push(() => m.visible = v); } } }); }
  if (cfg === 'noPolyOffset' || cfg === 'noPolyOffsetJitter') { for (const m of mats) { const v = m.polygonOffset; m.polygonOffset = false; undo.push(() => m.polygonOffset = v); } }
  if (cfg === 'jitter' || cfg === 'noPolyOffsetJitter') { if (cfg !== 'jitter') { const c = E.camera; const px = c.position.x; c.position.x = px + 0.0004; c.updateMatrixWorld(true); undo.push(() => { c.position.x = px; c.updateMatrixWorld(true); }); } }
  if (cfg.indexOf('blankParent:') === 0) { const re = new RegExp(cfg.slice(12)); A.engine.scene.traverse(o => { if (!o.isMesh || !o.material) return; let q = o.parent, hit = false; while (q) { if (re.test(q.name || '')) { hit = true; break; } q = q.parent; } if (!hit) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { const v = m.visible; m.visible = false; undo.push(() => m.visible = v); } }); }
  if (cfg === 'trimFog' || cfg === 'trimInfo') { A.engine.scene.traverse(o => { if (o.isMesh && /^hz_batch:hz\.trim/.test(o.name || '') && o.material) { const m = o.material; trimMeta = { fog: m.fog, toneMapped: m.toneMapped, depthTest: m.depthTest, depthWrite: m.depthWrite, transparent: m.transparent, blending: m.blending, type: m.type, name: m.name, emissive: m.emissive ? '#' + m.emissive.getHexString() : null, emissiveIntensity: m.emissiveIntensity, color: m.color ? '#' + m.color.getHexString() : null }; if (cfg === 'trimFog') { const v = m.fog; m.fog = true; m.needsUpdate = true; undo.push(() => { m.fog = v; m.needsUpdate = true; }); } } }); }
  if (cfg === 'noWater') { grp.traverse(o => { if (o.isMesh && /^water\./.test(o.name || '')) { const v = o.visible; o.visible = false; undo.push(() => o.visible = v); } }); }
  const info = { trim: trimMeta, terrains: terrains.length, grasses: grasses.length, mats: [...mats].map(m => m.name),
                 hasSlopeU: [...mats].some(m => { const P = R.properties.get(m); return !!(P && P.uniforms && P.uniforms.uCbSlope); }),
                 batchOutliers: (() => { const out = []; const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(); A.engine.scene.traverse(o => { if (!o.isBatchedMesh) return; const n = o.maxInstanceCount || (o._instanceInfo ? o._instanceInfo.length : 0); let bad = 0, tot = 0, ex = null; for (let i = 0; i < n; i++) { const info = o._instanceInfo && o._instanceInfo[i]; if (info && !info.active) continue; try { o.getMatrixAt(i, M); } catch (e) { continue; } tot++; M.decompose(P, Q, S); const big = Math.max(S.x, S.y, S.z), small = Math.min(S.x, S.y, S.z); if (!(P.x === P.x) || Math.abs(P.x) > 400 || Math.abs(P.z) > 400 || Math.abs(P.y) > 400 || big > 60 || big / Math.max(1e-6, small) > 400) { bad++; if (!ex) ex = { i, p: [+P.x.toFixed(1), +P.y.toFixed(1), +P.z.toFixed(1)], s: [+S.x.toFixed(2), +S.y.toFixed(2), +S.z.toFixed(2)] }; } } out.push({ name: o.name, instances: tot, bad, ex, geoms: o._geometryInfo ? o._geometryInfo.length : (o._geometryCount || null) }); }); return out; })(),
                 rtType: (E.post && E.post.composer && E.post.composer.renderTarget1) ? E.post.composer.renderTarget1.texture.type : null,
                 passes: (E.post && E.post.composer) ? E.post.composer.passes.map(p => p.constructor.name + (p.enabled ? '' : '(off)')) : null,
                 unnamed: (() => { const out = {}; A.engine.scene.traverse(o => { if (o.isMesh && !o.name && o.visible) { const chain = []; let q = o.parent; while (q && chain.length < 3) { chain.push(q.name || q.type); q = q.parent; } const k = chain.join('<') + ' | ' + (o.material && (o.material.name || o.material.type)) + (o.isInstancedMesh ? ' inst' : ''); out[k] = (out[k] || 0) + 1; } }); return out; })(),
                 linesPoints: (() => { const out = []; A.engine.scene.traverse(o => { if ((o.isLine || o.isPoints) && o.visible) { const g = o.geometry; const m = o.material; out.push({ type: o.type, name: o.name, parent: o.parent && (o.parent.name || o.parent.type), n: g && g.attributes && g.attributes.position ? g.attributes.position.count : -1, mat: m && (m.name || m.type), color: m && m.color ? '#' + m.color.getHexString() : null, size: m && m.size, blend: m && m.blending, depthTest: m && m.depthTest }); } }); return out; })(),
                 names: (() => { const m = {}; A.engine.scene.traverse(o => { if ((o.isMesh || o.isLine || o.isPoints) && o.visible) { const k = (o.name || o.type); m[k] = (m[k] || 0) + 1; } }); return m; })() };
  if (cfg === 'rawScene') { R.setRenderTarget(null); R.render(E.scene, E.camera); } else E.render(0);
  const gl = R.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  // to PNG via a 2D canvas (flip Y)
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 4;
    img.data.set(buf.subarray(src, src + w * 4), dst);
  }
  ctx.putImageData(img, 0, 0);
  return { w, h, png: cv.toDataURL('image/png'), info };
}
"""
UNFREEZE_JS = r"""() => { const E = CRESTBOUND.engine; if (E.__rnFrozen) { E.__rnFrozen = false; E.start((dt) => CRESTBOUND.game.update(dt)); } return true; }"""


def diff_png(a, b, mask):
    from PIL import Image
    import numpy as np
    A = np.asarray(Image.open(a).convert("RGB")).astype(np.int16)
    B = np.asarray(Image.open(b).convert("RGB")).astype(np.int16)
    d = np.abs(A - B).max(axis=2)
    m = np.ones(d.shape, dtype=bool)
    for (x0, y0, x1, y1) in mask:
        m[y0:y1, x0:x1] = False
    dd = d[m]
    return {"pctOver8": round(100.0 * float((dd > 8).sum()) / dd.size, 3),
            "pctOver24": round(100.0 * float((dd > 24).sum()) / dd.size, 3),
            "meanAbs": round(float(dd.mean()), 3), "worst": int(dd.max())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--station", default="keep_apron")
    ap.add_argument("--tag", default="before")
    ap.add_argument("--cfgs", default="base,noTerrain,noGrass,terrainDown,polyOffset,slopeOff")
    ap.add_argument("--pf", type=float, default=1.0)
    ap.add_argument("--pu", type=float, default=1.0)
    ap.add_argument("--quality", default="low")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pose", action="store_true", help="pose the follow camera while frozen (60 hand-stepped cam.update calls)")
    ap.add_argument("--out", default=os.path.join(ROOT, "_shots", "rn_seam"))
    args = ap.parse_args()
    if args.list:
        for k, v in STATIONS.items(): print(k, v)
        return 0
    st = STATIONS[args.station]
    course, pos, yaw, pitch, dist = st
    os.makedirs(args.out, exist_ok=True)
    url = "%s?dev=1&quality=%s&autoscale=0&course=%s" % (BASE, args.quality, course)
    cfgs = [c for c in args.cfgs.split(",") if c]
    res = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)[:200]))
        pg.goto(url, wait_until="load", timeout=90000)
        for _ in range(160):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
            pg.wait_for_timeout(400)
        for _ in range(80):
            if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"): break
            pg.evaluate(CLICK_JS); pg.wait_for_timeout(400)
        ok = pg.evaluate(LOAD_JS, course)
        print("course", course, "live", ok)
        pg.wait_for_timeout(800)
        pg.evaluate(PLACE_JS, [pos[0], pos[1], pos[2], yaw, pitch, dist])
        pg.wait_for_timeout(1500)
        aim = pg.evaluate(AIM_JS, [yaw, pitch, dist])
        pg.wait_for_timeout(400)
        aim2 = pg.evaluate(AIM_JS, [yaw, pitch, dist])
        pg.wait_for_timeout(120)
        print("hero", pg.evaluate("() => { const p = CRESTBOUND.game.player.pos; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; }"), "cam", aim2)
        files = {}
        for cfg in cfgs:
            r = pg.evaluate(SHOT_JS, {"cfg": cfg, "pf": args.pf, "pu": args.pu, "pose": [yaw, pitch, dist] if args.pose else None})
            fn = os.path.join(args.out, "%s_%s_%s.png" % (args.station, args.tag, re.sub(r"[^A-Za-z0-9]+", "_", cfg)))
            with open(fn, "wb") as f:
                f.write(base64.b64decode(r["png"].split(",", 1)[1]))
            files[cfg] = fn
            if cfg == cfgs[0]:
                print("scene:", json.dumps(r["info"]))
            if r["info"].get("trim"):
                print("trim material [%s]:" % cfg, json.dumps(r["info"]["trim"]))
        pg.evaluate(UNFREEZE_JS)
        if errs: print("console errors:", errs[:5])
        br.close()
    # HUD mask (1280x720 CSS -> drawing buffer may be scaled; scale the boxes)
    from PIL import Image
    w, h = Image.open(files[cfgs[0]]).size
    sx, sy = w / 1280.0, h / 720.0
    mask = [(0, 0, int(390 * sx), int(190 * sy)), (int(1100 * sx), 0, w, int(140 * sy)),
            (0, int(560 * sy), int(230 * sx), h), (int(1160 * sx), int(670 * sy), w, h)]
    ref = files.get("terrainDown") or files[cfgs[0]]
    try:
        import numpy as np
        A = np.asarray(Image.open(files[cfgs[0]]).convert("RGB")).astype(np.int16)
        B = np.asarray(Image.open(ref).convert("RGB")).astype(np.int16)
        D = np.clip(np.abs(A - B).max(axis=2) * 3, 0, 255).astype(np.uint8)
        Image.fromarray(D).save(os.path.join(args.out, "%s_%s_DIFF.png" % (args.station, args.tag)))
    except Exception as e:
        print("diff image failed", e)
    print("\ndiff vs terrainDown (the 'slab wins' ground truth); station %s [%s]" % (args.station, args.tag))
    for cfg in cfgs:
        d = diff_png(files[cfg], ref, mask)
        res[cfg] = d
        print("  %-12s %%>8: %6.3f   %%>24: %6.3f   mean %6.3f   worst %3d   %s" % (
            cfg, d["pctOver8"], d["pctOver24"], d["meanAbs"], d["worst"], os.path.relpath(files[cfg], ROOT)))
    with open(os.path.join(args.out, "%s_%s.json" % (args.station, args.tag)), "w") as f:
        json.dump({"station": args.station, "tag": args.tag, "diff": res, "files": files}, f, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
