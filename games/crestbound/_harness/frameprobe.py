#!/usr/bin/env python
"""CRESTBOUND frame probe — WHERE the frame time and the draw calls go.

Ported from ascendant/_harness/frameprobe.py + passcost.py and extended for a
third-person open-diorama platformer. Every perf claim about this game should
quote this tool, never an estimate.

It reports, for one course:

  * GPU identity (WebGL unmasked renderer) and the drawing-buffer size.
  * The composer configuration: pass list, target size + type, bloom mip chain.
  * A LIGHT census and a SHADOW-CASTER census (how many meshes the depth-only
    shadow pass has to draw, and how many triangles that costs).
  * A MESH census split into InstancedMesh / merged-static / individual, with
    the biggest individual draw-call contributors named.
  * DRAW ATTRIBUTION: `renderer.renderBufferDirect` is wrapped for exactly ONE
    frame, so every draw call is charged to the object that issued it and
    grouped by a name prefix. This is the instrument for "360 draw calls" —
    it says which 360.
  * PASS COST in real milliseconds using the passcost.py method: the game loop
    is stopped, the composer renders OFFSCREEN, and a batch is bracketed by a
    1-pixel gl.readPixels() to force a GPU round trip. T(n) and T(2n) are timed
    and subtracted so the fixed readback cost cancels exactly:
        T(n) = C + n*m,  T(2n) = C + 2n*m  =>  m = (T(2n) - T(n)) / n
    Configurations are measured INTERLEAVED and reduced with the MINIMUM
    (contention only ever adds time).

Why not count requestAnimationFrame callbacks: rAF measures the browser's
schedule, not the renderer, and on a loaded machine every row collapses to the
same number. engine.stats.fps is 1/clamped-dt and saturates at the clamp.

    python frameprobe.py --course keep
    python frameprobe.py --course verdant-1 --quality high --width 1920 --height 1080

Absolute milliseconds are machine-specific; the RELATIVE deltas are the signal.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"

# --disable-gpu-vsync / --disable-frame-rate-limit are MANDATORY: this machine's
# panel is 50 Hz, so without them every configuration faster than 50 fps reads
# exactly 20.00 ms and the probe silently reports a vsync floor as render cost.
FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit",
         "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return want;
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

LOAD_JS = r"""
async (id) => {
  const G = globalThis.CRESTBOUND && CRESTBOUND.game;
  if (!G || !G.__dev) return {error: '__dev missing (?dev=1)'};
  const t0 = performance.now();
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  try { await G.__dev.goto(id); } catch (e) { return {error: 'goto threw: ' + e}; }
  const tick = () => new Promise(r => { let d = false; const f = () => { if (!d) { d = true; r(); } };
    requestAnimationFrame(f); setTimeout(f, 60); });
  const deadline = t0 + 40000;
  while (performance.now() < deadline && !live()) await tick();
  if (!live()) return {error: 'never arrived (state ' + G.state + ')'};
  return {loadMs: +(performance.now() - t0).toFixed(1), courseId: G.courseId};
}
"""

# Move the player to a station so the probe measures the view a player has.
STATION_JS = r"""
(name) => {
  const A = globalThis.CRESTBOUND, G = A.game, C = G.course, THREE = A.THREE;
  const posOf = (o) => { if (!o) return null;
    if (typeof o.x === 'number') return o;
    if (o.pos) return posOf(o.pos);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.position) return posOf(o.position); return null; };
  let p = null;
  if (name === 'spawn') { const sp = C.spawnFor ? C.spawnFor(0) : null; p = sp && posOf(sp.pos); }
  else { const i = parseInt(name.replace(/\D/g, ''), 10) - 1;
         p = posOf((C.checkpoints || [])[i]); }
  if (!p) return {error: 'no station ' + name};
  const P = G.player;
  if (P && P.__test) {
    P.__test.teleport(new THREE.Vector3(p.x, p.y + 0.6, p.z));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
  }
  return {p: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]};
}
"""

CENSUS_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, THREE = A.THREE;
  const scene = E.scene, cam = E.camera;

  /* ---- lights ---- */
  const lights = {}; let shadowLights = 0;
  scene.traverse(o => { if (o.isLight) { lights[o.type] = (lights[o.type] || 0) + 1;
    if (o.castShadow) shadowLights++; } });

  /* ---- meshes ---- */
  const cen = {instanced: 0, instancedCount: 0, merged: 0, individual: 0, skinned: 0,
               points: 0, lines: 0, sprites: 0, visibleMeshes: 0, transparent: 0,
               transparentBig: 0, castShadow: 0, castShadowTris: 0, matKeys: {}};
  const tri = (g) => { if (!g) return 0;
    const idx = g.index; const pos = g.attributes && g.attributes.position;
    const n = idx ? idx.count : (pos ? pos.count : 0); return n / 3 | 0; };
  const byName = [];
  const visible = (o) => { let n = o; while (n) { if (!n.visible) return false; n = n.parent; } return true; };
  scene.traverse(o => {
    if (o.isPoints) { cen.points++; return; }
    if (o.isLine) { cen.lines++; return; }
    if (o.isSprite) { cen.sprites++; return; }
    if (!o.isMesh) return;
    const vis = visible(o);
    if (vis) cen.visibleMeshes++;
    const t = tri(o.geometry) * (o.isInstancedMesh ? (o.count || 1) : 1);
    if (o.isInstancedMesh) { cen.instanced++; cen.instancedCount += (o.count || 0); }
    else if (o.isSkinnedMesh) cen.skinned++;
    else if (o.geometry && o.geometry.groups && o.geometry.groups.length > 1) cen.merged++;
    else cen.individual++;
    if (o.castShadow && vis) { cen.castShadow++; cen.castShadowTris += t; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (!m) continue;
      cen.matKeys[m.type] = (cen.matKeys[m.type] || 0) + 1;
      if (m.transparent && vis) { cen.transparent++;
        /* a big alpha-blended surface is the Intel UHD overdraw killer */
        const g = o.geometry;
        if (g) { if (!g.boundingSphere) g.computeBoundingSphere();
          const r = g.boundingSphere ? g.boundingSphere.radius * Math.max(
            Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) : 0;
          if (r > 6) cen.transparentBig++; } }
    }
    if (vis && !o.isInstancedMesh)
      byName.push({n: o.name || (o.parent && o.parent.name) || '?', t: t,
                   g: (o.geometry && o.geometry.groups ? o.geometry.groups.length : 1)});
  });
  byName.sort((a, b) => b.t - a.t);

  /* ---- unique materials / programs / geometries ---- */
  const mset = new Set(); scene.traverse(o => { if (o.isMesh) {
    const mm = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mm) if (m) mset.add(m.uuid); } });

  /* ---- composer ---- */
  const P = E.post, c = P && P.composer;
  const comp = !c ? null : {
    passes: c.passes.map(p => p.constructor.name + (p.enabled ? '' : ' (off)')),
    rt: {w: c.renderTarget1.width, h: c.renderTarget1.height,
         type: c.renderTarget1.texture.type, samples: c.renderTarget1.samples},
    bloom: (() => { const b = c.passes.find(p => /Bloom/.test(p.constructor.name));
      return b ? {res: [b.resolution.x, b.resolution.y], strength: b.strength,
                  radius: b.radius, threshold: b.threshold,
                  mips: b.renderTargetsHorizontal ? b.renderTargetsHorizontal.length : null,
                  scale: b.bloomScale} : null; })(),
  };

  const sun = E.sun;
  return {
    gpu: (() => { const cv = document.createElement('canvas'); const g = cv.getContext('webgl2');
      const d = g && g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; })(),
    drawingBuffer: [R.domElement.width, R.domElement.height],
    pixelRatio: R.getPixelRatio(),
    lights, shadowLights,
    shadowMap: sun && sun.shadow ? {size: [sun.shadow.mapSize.x, sun.shadow.mapSize.y],
      extent: E._shadow ? E._shadow.extent : null} : null,
    census: {instanced: cen.instanced, instancedCount: cen.instancedCount,
             merged: cen.merged, individual: cen.individual, skinned: cen.skinned,
             points: cen.points, lines: cen.lines, sprites: cen.sprites,
             visibleMeshes: cen.visibleMeshes, transparent: cen.transparent,
             transparentBig: cen.transparentBig,
             castShadow: cen.castShadow, castShadowTris: cen.castShadowTris,
             materials: mset.size, materialTypes: cen.matKeys},
    memory: {geometries: R.info.memory.geometries, textures: R.info.memory.textures,
             programs: R.info.programs ? R.info.programs.length : null},
    heaviest: byName.slice(0, 18),
    composer: comp,
  };
}
"""

# ONE frame with renderBufferDirect wrapped: attribute every draw to its object
# AND to the pass that issued it (shadow depth / main scene / post chain).
ATTRIB_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer;
  const groups = {}, rows = [];
  const passTot = {shadow: {calls: 0, tris: 0}, main: {calls: 0, tris: 0}, post: {calls: 0, tris: 0}};
  const key = (o) => {
    let n = o; const parts = [];
    while (n && parts.length < 4) { if (n.name) parts.unshift(n.name); n = n.parent; }
    const s = parts.join('/') || (o.type || '?');
    return s.replace(/[.#]?\d+$/g, '').replace(/\d{2,}/g, '#');
  };
  const orig = R.renderBufferDirect.bind(R);
  let n = 0, tris = 0;
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    n++;
    const idx = geometry.index, pos = geometry.attributes && geometry.attributes.position;
    const cnt = group ? group.count : (idx ? idx.count : (pos ? pos.count : 0));
    const inst = object && object.isInstancedMesh ? (object.count || 1) : 1;
    const t = (cnt / 3 | 0) * inst;
    tris += t;
    const depth = !!(material.isMeshDepthMaterial || material.isMeshDistanceMaterial);
    const post = !depth && !!(material.isShaderMaterial && t <= 2 && !object.parent);
    const pass = depth ? 'shadow' : (post ? 'post' : 'main');
    passTot[pass].calls++; passTot[pass].tris += t;
    const k = pass + ' | ' + key(object);
    const g = groups[k] || (groups[k] = {calls: 0, tris: 0, mat: material.type, pass: pass,
                                         inst: !!(object && object.isInstancedMesh)});
    g.calls++; g.tris += t;
    return orig(camera, scene, geometry, material, object, group);
  };
  R.info.reset();
  E.post.composer.render(0.016);
  R.renderBufferDirect = orig;
  for (const k in groups) rows.push(Object.assign({name: k}, groups[k]));
  rows.sort((a, b) => b.calls - a.calls);
  return {total: n, tris: tris, passTot: passTot,
          infoCalls: R.info.render.calls, infoTris: R.info.render.triangles,
          rows: rows.slice(0, 45)};
}
"""

SETUP_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, P = E.post, R = E.renderer;
  const W = (globalThis.__fp = {});
  W.E = E; W.P = P; W.R = R;
  W.saved = P.composer.passes.map(p => p.enabled);
  W.sunShadow = E.sun ? E.sun.castShadow : false;
  W.shadowEnabled = R.shadowMap.enabled;
  W.shadowSize = E.sun && E.sun.shadow ? E.sun.shadow.mapSize.x : 0;
  W.pr = R.getPixelRatio();
  W.bloomScale = (() => { const b = P.composer.passes.find(p => /Bloom/.test(p.constructor.name));
                          return b ? b.bloomScale : null; })();
  W.setPR = (pr) => { R.setPixelRatio(pr); P.setSize ? P.setSize(P.width, P.height)
                      : (P.composer.setPixelRatio(pr), P.composer.setSize(P.width, P.height)); };

  /* GPU timer query around engine.render — the authoritative instrument. rAF
     intervals confound GPU cost with browser pacing, and an offscreen
     readPixels batch under-reports by an order of magnitude on this driver
     (measured: 3 ms/render offscreen vs a 48.65 ms timer query live). */
  const gl = R.getContext();
  W.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  W.gpu = []; W.pending = [];
  if (W.ext) {
    W.origRender = E.render.bind(E);
    E.render = function (dt) {
      let q = null;
      if (W.pending.length < 4) {
        try { q = gl.createQuery(); gl.beginQuery(W.ext.TIME_ELAPSED_EXT, q); } catch (e) { q = null; }
      }
      const r = W.origRender(dt);
      if (q) { try { gl.endQuery(W.ext.TIME_ELAPSED_EXT); W.pending.push(q); } catch (e) {} }
      for (let i = W.pending.length - 1; i >= 0; i--) {
        const pq = W.pending[i];
        if (gl.getQueryParameter(pq, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(W.ext.GPU_DISJOINT_EXT))
            W.gpu.push(gl.getQueryParameter(pq, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(pq); W.pending.splice(i, 1);
        }
      }
      return r;
    };
  }
  return {passes: P.composer.passes.map(p => p.constructor.name), timerQuery: !!W.ext};
}
"""

APPLY_JS = r"""
(cfg) => {
  const W = globalThis.__fp, E = W.E, R = W.R, P = W.P;
  const off = cfg.off || [];
  P.composer.passes.forEach((p, i) => { p.enabled = W.saved[i] && !off.includes(p.constructor.name); });
  const wantShadow = cfg.shadows === false ? false : true;
  if (E.sun) E.sun.castShadow = wantShadow && W.sunShadow;
  R.shadowMap.enabled = wantShadow && W.shadowEnabled;
  if (E.sun && E.sun.shadow && W.shadowSize) {
    const want = cfg.shadowMap || W.shadowSize;
    if (E.sun.shadow.mapSize.x !== want) {
      E.sun.shadow.mapSize.set(want, want);
      if (E.sun.shadow.map) { E.sun.shadow.map.dispose(); E.sun.shadow.map = null; }
    }
  }
  const b = P.composer.passes.find(p => /Bloom/.test(p.constructor.name));
  if (b && W.bloomScale !== null) {
    const want = cfg.bloomScale || W.bloomScale;
    if (b.bloomScale !== want) { b.bloomScale = want;
      b.setSize(P.width * R.getPixelRatio(), P.height * R.getPixelRatio()); }
  }
  const pr = cfg.pr || W.pr;
  if (Math.abs(R.getPixelRatio() - pr) > 1e-3) W.setPR(pr);
  /* --- shading isolation ------------------------------------------- */
  if (!W.pointLights) { W.pointLights = []; E.scene.traverse(o => {
    if (o.isPointLight || o.isSpotLight) W.pointLights.push(o); }); }
  for (const L of W.pointLights) L.visible = cfg.noPointLights ? false : true;
  if (E.fill) E.fill.visible = cfg.oneLight ? false : true;
  if (E.rim) E.rim.visible = cfg.oneLight ? false : true;
  if (W.env === undefined) W.env = E.scene.environment;
  E.scene.environment = cfg.noEnv ? null : W.env;
  if (W.fog === undefined) W.fog = E.scene.fog;
  E.scene.fog = cfg.noFog ? null : W.fog;
  /* anisotropy: 4x AF quadruples texture bandwidth per fetch on an iGPU */
  if (cfg.aniso !== undefined) {
    if (!W.texes) { W.texes = []; E.scene.traverse(o => { if (!o.isMesh) return;
      const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) { if (!m) continue;
        for (const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])
          if (m[k] && W.texes.indexOf(m[k]) < 0) W.texes.push(m[k]); } }); }
    for (const t of W.texes) { if (W.aniso0 === undefined) W.aniso0 = t.anisotropy;
      if (t.anisotropy !== cfg.aniso) { t.anisotropy = cfg.aniso; t.needsUpdate = true; } }
  } else if (W.texes && W.aniso0 !== undefined) {
    for (const t of W.texes) if (t.anisotropy !== W.aniso0) { t.anisotropy = W.aniso0; t.needsUpdate = true; }
  }
  /* shadow filter: PCFSoft is 9 lerped taps per fragment, Basic is 1 */
  if (W.shadowType === undefined) W.shadowType = R.shadowMap.type;
  const wantType = cfg.shadowType !== undefined ? cfg.shadowType : W.shadowType;
  if (R.shadowMap.type !== wantType) { R.shadowMap.type = wantType; R.shadowMap.needsUpdate = true;
    E.scene.traverse(o => { if (o.isMesh) { const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) if (m) m.needsUpdate = true; } }); }
  /* tone mapping runs per fragment in every material shader */
  if (W.tone === undefined) W.tone = R.toneMapping;
  const wantTone = cfg.noTone ? 0 : W.tone;
  if (R.toneMapping !== wantTone) { R.toneMapping = wantTone;
    E.scene.traverse(o => { if (o.isMesh) { const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) if (m) m.needsUpdate = true; } }); }
  /* normal mapping: a TBN plus a fetch per fragment */
  if (cfg.noNormalMap) {
    if (!W.nmaps) { W.nmaps = []; E.scene.traverse(o => { if (!o.isMesh) return;
      const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) if (m && m.normalMap) { W.nmaps.push([m, m.normalMap]);
        m.normalMap = null; m.needsUpdate = true; } }); }
  } else if (W.nmaps && W.nmaps.length) {
    for (const [m, t] of W.nmaps) { m.normalMap = t; m.needsUpdate = true; } W.nmaps.length = 0;
  }
  /* depth prepass: on/off and the occluder size threshold */
  const rp = P.renderPass;
  if (rp && rp.prepass !== undefined) {
    if (W.prepass0 === undefined) { W.prepass0 = rp.prepass; W.minOcc0 = rp.minOccluderRadius; }
    rp.prepass = cfg.prepass === false ? false : W.prepass0;
    const want = cfg.minOcc !== undefined ? cfg.minOcc : W.minOcc0;
    if (rp.minOccluderRadius !== want) { rp.minOccluderRadius = want; rp.markDirty(); }
  }
  if (cfg.override === 'basic') {
    if (!W.basic) W.basic = new (globalThis.CRESTBOUND.THREE.MeshBasicMaterial)({color: 0x808080});
    E.scene.overrideMaterial = W.basic;
  } else E.scene.overrideMaterial = null;
  if (cfg.hideTransparent !== undefined) {
    if (!W.hidden) W.hidden = [];
    if (cfg.hideTransparent) {
      if (!W.hidden.length) E.scene.traverse(o => {
        if (o.isMesh && o.visible) { const mm = Array.isArray(o.material) ? o.material : [o.material];
          if (mm.some(m => m && m.transparent)) { W.hidden.push(o); o.visible = false; } } });
    } else { for (const o of W.hidden) o.visible = true; W.hidden.length = 0; }
  }
  return true;
}
"""

# Frame cost from rAF intervals with the GAME LOOP RUNNING. Valid here and NOT
# in ascendant's original probe because this frame costs 40-80 ms: an rAF
# schedule floor of ~1-20 ms cannot be the limit, so the interval IS the work.
# Reduced with the MINIMUM median across interleaved repeats (contention only
# ever adds time).
MEASURE_JS = r"""
async (n) => {
  const W = globalThis.__fp;
  const f = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 20; i++) await f();          // settle: shader compile, culling
  W.gpu.length = 0;
  const t = []; let last = performance.now();
  for (let i = 0; i < n; i++) { await f(); const now = performance.now();
                                t.push(now - last); last = now; }
  t.sort((a, b) => a - b);
  const med = (a) => { if (!a.length) return null;
    const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(2); };
  const R = W.R;
  const rp2 = W.P.renderPass;
  return {gpu: med(W.gpu), gpuN: W.gpu.length, occ: rp2 ? rp2.occluders : null,
          median: +t[t.length >> 1].toFixed(2),
          calls: R.info.render.calls, tris: R.info.render.triangles};
}
"""

RESTORE_JS = r"""
() => { const W = globalThis.__fp, E = W.E, R = W.R, P = W.P;
  P.composer.passes.forEach((p, i) => p.enabled = W.saved[i]);
  if (E.sun) E.sun.castShadow = W.sunShadow;
  R.shadowMap.enabled = W.shadowEnabled;
  if (E.sun && E.sun.shadow && W.shadowSize && E.sun.shadow.mapSize.x !== W.shadowSize) {
    E.sun.shadow.mapSize.set(W.shadowSize, W.shadowSize);
    if (E.sun.shadow.map) { E.sun.shadow.map.dispose(); E.sun.shadow.map = null; } }
  const b = P.composer.passes.find(p => /Bloom/.test(p.constructor.name));
  if (b && W.bloomScale !== null && b.bloomScale !== W.bloomScale) {
    b.bloomScale = W.bloomScale; b.setSize(P.width * W.pr, P.height * W.pr); }
  if (Math.abs(R.getPixelRatio() - W.pr) > 1e-3) W.setPR(W.pr);
  if (W.hidden) { for (const o of W.hidden) o.visible = true; W.hidden.length = 0; }
  if (W.pointLights) for (const L of W.pointLights) L.visible = true;
  if (E.fill) E.fill.visible = true; if (E.rim) E.rim.visible = true;
  if (W.env !== undefined) E.scene.environment = W.env;
  if (W.fog !== undefined) E.scene.fog = W.fog;
  E.scene.overrideMaterial = null;
  if (W.texes && W.aniso0 !== undefined) for (const t of W.texes)
    if (t.anisotropy !== W.aniso0) { t.anisotropy = W.aniso0; t.needsUpdate = true; }
  if (W.nmaps && W.nmaps.length) { for (const [m, t] of W.nmaps) { m.normalMap = t; m.needsUpdate = true; }
    W.nmaps.length = 0; }
  if (P.renderPass && W.prepass0 !== undefined) {
    P.renderPass.prepass = W.prepass0;
    if (P.renderPass.minOccluderRadius !== W.minOcc0) {
      P.renderPass.minOccluderRadius = W.minOcc0; P.renderPass.markDirty(); } }
  if (W.shadowType !== undefined) R.shadowMap.type = W.shadowType;
  if (W.tone !== undefined) R.toneMapping = W.tone; }
"""

BLOOM = ["UnrealBloomPass", "ScaledBloomPass"]
GRADE = ["FinishPass", "GradePass"]
AA = ["FXAAPass", "SMAAPass"]
AO = ["AOPass"]

CONFIGS = [
    ("full chain",        {"off": []}),
    ("-bloom",            {"off": BLOOM}),
    ("-finish",           {"off": GRADE}),
    ("-AA",               {"off": AA}),
    ("-shadows",          {"off": [], "shadows": False}),
    ("-transparent",      {"off": [], "hideTransparent": True}),
    ("bloomScale 0.5",    {"off": [], "bloomScale": 0.5}),
    ("shadowMap 1024",    {"off": [], "shadowMap": 1024}),
    ("half res (pr .707)", {"off": [], "pr": 0.7071}),
    ("quarter res (pr .5)", {"off": [], "pr": 0.5}),
    ("no point lights",   {"off": [], "noPointLights": True}),
    ("key light only",    {"off": [], "noPointLights": True, "oneLight": True}),
    ("no env map",        {"off": [], "noEnv": True}),
    ("no fog",            {"off": [], "noFog": True}),
    ("basic override",    {"off": [], "override": "basic"}),
    ("basic, no post",    {"off": BLOOM + GRADE + AA + AO, "override": "basic"}),
    ("basic/nopost/half", {"off": BLOOM + GRADE + AA + AO, "override": "basic", "pr": 0.7071}),
    ("basic/nopost/qtr",  {"off": BLOOM + GRADE + AA + AO, "override": "basic", "pr": 0.5}),
    ("basic/nopost/noshd", {"off": BLOOM + GRADE + AA + AO, "override": "basic", "shadows": False}),
    ("basic/noshd/qtr",   {"off": BLOOM + GRADE + AA + AO, "override": "basic",
                           "shadows": False, "pr": 0.5}),
    ("prepass OFF",       {"off": [], "prepass": False}),
    ("prepass r>=1",      {"off": [], "minOcc": 1}),
    ("prepass r>=2",      {"off": [], "minOcc": 2}),
    ("prepass r>=4",      {"off": [], "minOcc": 4}),
    ("prepass r>=6",      {"off": [], "minOcc": 6}),
    ("prepass r>=16",     {"off": [], "minOcc": 16}),
    ("aniso 1",           {"off": [], "aniso": 1}),
    ("shadow Basic 1tap", {"off": [], "shadowType": 0}),
    ("no tone mapping",   {"off": [], "noTone": True}),
    ("no normal maps",    {"off": [], "noNormalMap": True}),
    ("ALL CUTS",          {"off": BLOOM, "aniso": 1, "shadowType": 0,
                           "noPointLights": True, "noNormalMap": True}),
    ("scene only",        {"off": BLOOM + GRADE + AA + AO}),
    ("scene, no shadow",  {"off": BLOOM + GRADE + AA + AO, "shadows": False}),
]


def boot(pg, url, course):
    pg.goto(url, wait_until="load", timeout=60_000)
    deadline = time.time() + 70
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(400)
    deadline = time.time() + 45
    while time.time() < deadline:
        st = None
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            pass
        if st in ("keep", "playing"):
            break
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    else:
        raise RuntimeError("never left the title screen")
    load = pg.evaluate(LOAD_JS, course)
    if not isinstance(load, dict) or load.get("error"):
        raise RuntimeError("course load: %s" % (load or {}).get("error"))
    return load


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND frame probe")
    ap.add_argument("--course", default="keep")
    ap.add_argument("--station", default="spawn", help="spawn | cp2 | cp3 …")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--frames", type=int, default=40)
    ap.add_argument("--repeats", type=int, default=4)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    url = "%s?dev=1&quality=%s" % (BASE, args.quality)
    out = {"course": args.course, "station": args.station, "quality": args.quality,
           "viewport": [args.width, args.height]}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=args.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        load = boot(pg, url, args.course)
        out["loadMs"] = load.get("loadMs")
        st = pg.evaluate(STATION_JS, args.station)
        out["stationPos"] = st.get("p")
        pg.wait_for_timeout(1500)

        cen = pg.evaluate(CENSUS_JS)
        out["census"] = cen
        attrib = pg.evaluate(ATTRIB_JS)
        out["attribution"] = attrib

        print("=" * 96)
        print("CRESTBOUND frame probe — course %s, station %s (%s), quality %s, %dx%d"
              % (args.course, args.station, st.get("p"), args.quality, args.width, args.height))
        print("GPU: %s   drawing buffer %s  dpr %s   course load %s ms"
              % (cen["gpu"], cen["drawingBuffer"], cen["pixelRatio"], out["loadMs"]))
        print("-" * 96)
        c = cen["composer"]
        print("COMPOSER passes : %s" % (c["passes"] if c else "none"))
        print("        target  : %sx%s type %s samples %s"
              % (c["rt"]["w"], c["rt"]["h"], c["rt"]["type"], c["rt"]["samples"]) if c else "")
        if c and c["bloom"]:
            b = c["bloom"]
            print("        bloom   : res %s scale %s mips %s strength %s radius %s threshold %s"
                  % (b["res"], b["scale"], b["mips"], b["strength"], b["radius"], b["threshold"]))
        print("LIGHTS          : %s   shadow casting lights %s   map %s extent %s"
              % (cen["lights"], cen["shadowLights"],
                 cen["shadowMap"]["size"] if cen["shadowMap"] else "-",
                 cen["shadowMap"]["extent"] if cen["shadowMap"] else "-"))
        z = cen["census"]
        print("MESHES          : instanced %d (%d instances) · merged %d · individual %d · skinned %d"
              % (z["instanced"], z["instancedCount"], z["merged"], z["individual"], z["skinned"]))
        print("                  visible %d · transparent %d (BIG %d) · points %d lines %d sprites %d"
              % (z["visibleMeshes"], z["transparent"], z["transparentBig"],
                 z["points"], z["lines"], z["sprites"]))
        print("SHADOW CASTERS  : %d meshes, %s tris in the depth pass"
              % (z["castShadow"], f'{z["castShadowTris"]:,}'))
        print("MATERIALS       : %d unique · %s" % (z["materials"], z["materialTypes"]))
        print("MEMORY          : %s" % cen["memory"])
        print("-" * 96)
        print("DRAW ATTRIBUTION (one wrapped frame): %d draws / %s tris  [renderer.info says %d / %s]"
              % (attrib["total"], f'{attrib["tris"]:,}',
                 attrib["infoCalls"], f'{attrib["infoTris"]:,}'))
        print("%-46s %6s %10s  %s" % ("object path", "draws", "tris", "material"))
        for r in attrib["rows"]:
            print("%-46s %6d %10s  %s%s"
                  % (r["name"][:46], r["calls"], f'{r["tris"]:,}', r["mat"],
                     " [inst]" if r["inst"] else ""))
        print("-" * 96)

        # ---- pass cost (rAF intervals, game loop running) ---------------
        info = pg.evaluate(SETUP_JS)
        present = set(info["passes"])
        live = [(n, cfg) for n, cfg in CONFIGS
                if not cfg.get("off") or n.startswith("scene")
                or any(o in present for o in cfg["off"])]
        samples = {n: [] for n, _ in live}
        meta = {}
        for r in range(args.repeats + 1):
            for name, cfg in live:
                pg.evaluate(APPLY_JS, cfg)
                m = pg.evaluate(MEASURE_JS, args.frames)
                if r:
                    samples[name].append(m["gpu"] if m.get("gpu") else m["median"])
                    meta[name] = m
            pg.evaluate(RESTORE_JS)
        pg.evaluate(RESTORE_JS)
        br.close()

    base = min(samples["full chain"])
    print("")
    print("FRAME COST — median GPU ms (EXT_disjoint_timer_query), MIN over %d repeats of %d frames"
          % (args.repeats, args.frames))
    print("(falls back to the rAF interval only if the timer-query extension is absent)")
    print("%-22s%10s%10s%9s%8s%11s" % ("config", "ms/frame", "delta", "fps", "draws", "tris"))
    print("-" * 70)
    rows = {}
    for name, _ in live:
        ms = min(samples[name])
        m = meta.get(name, {})
        rows[name] = round(ms, 2)
        print("%-22s%10.2f%+10.2f%9.1f%8s%11s"
              % (name, ms, ms - base, 1000.0 / max(ms, 1e-6),
                 m.get("calls"), f'{m.get("tris", 0):,}'))
    print("-" * 70)
    print("full chain = %.2f ms/frame (%.1f fps)." % (base, 1000.0 / max(base, 1e-6)))
    out["frameCostMs"] = rows
    out["fullChainMs"] = round(base, 2)
    if errs:
        print("page errors: %s" % errs[:5])
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
