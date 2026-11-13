#!/usr/bin/env python
"""BLACKRIDGE levers — CONTENTION-INDEPENDENT A/B pricing of render levers.

    python levers.py --pose S3
    python levers.py --pose traversal --levers lights6,noaug,noenv
    python levers.py --list

WHY THIS EXISTS AND WHY IT IS NOT perfprobe.py
----------------------------------------------
perfprobe reports ABSOLUTES. This box runs the owner's own Chrome (17+
processes) on the same iGPU, so every absolute here is contended and the
contention is not constant across minutes. iter08's own hand-off recorded a
46% swing between sessions on numbers that reproduced to 1.5% inside one
session — which is exactly the signature of a *slowly drifting* shared load.

A ratio measured INSIDE one page, seconds apart, cannot drift like that. So
every lever here is measured as an interleaved round:

    base -> lever -> base -> lever -> ... (R rounds)

and the reported figure is the MEDIAN OF THE PER-ROUND RATIOS. The absolutes
are printed beside it so the reader can see the drift for themselves; the
ratio is what is trusted, per the measurement-hygiene rule.

INSTRUMENT: EXT_disjoint_timer_query_webgl2 around __FPS__.__test.step(1),
identical to perfprobe instrument 2 — pure GPU time for the real
step+dispatch+post path, discarded outright when GPU_DISJOINT_EXT fires.

A lever that changes a shader-permutation key (light count, envMap presence,
shadow filter) forces a program rebuild. Every apply/revert is therefore
followed by WARM frames before any query is issued, so no compile lands
inside a measured block.
"""
import argparse, json, os, statistics, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server  # noqa: E402

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"

# ---------------------------------------------------------------- page-side
RIG = r"""
(() => {
const F = () => globalThis.__FPS__;

// ---- GPU timer query, perfprobe instrument 2 verbatim ---------------------
window.__lvGpu = (n) => {
  const gl = F().renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { error: 'no EXT_disjoint_timer_query_webgl2' };
  const T = F().__test;
  T.step(1);
  const qs = [];
  for (let i = 0; i < n; i++) {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    T.step(1);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    qs.push(q);
  }
  window.__lvQ = qs;
  return { issued: n };
};
// PEEK: non-destructive availability count, so the driver gets as long as it
// needs. A recompile (light count / envMap / shadow filter) makes the first
// frames after apply() very slow, and a fixed 700 ms wait threw away 18 of 20
// queries and called it an error.
window.__lvPeek = () => {
  const gl = F().renderer.getContext();
  let n = 0;
  for (const q of (window.__lvQ || []))
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) n++;
  return n;
};
window.__lvRead = () => {
  const gl = F().renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
  const ms = [];
  for (const q of (window.__lvQ || [])) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
      ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  window.__lvQ = [];
  return { disjoint, ms };
};
window.__lvWarm = (n) => { const T = F().__test; for (let i=0;i<n;i++) T.step(1); return 1; };
window.__lvCounts = () => {
  const s = F().perfStats || {};
  const sc = F().scene;
  let dir=0, spot=0, point=0, hemi=0, amb=0;
  sc.traverse(o => { if (!o.isLight || o.visible === false) return;
    if (o.isDirectionalLight) dir++; else if (o.isSpotLight) spot++;
    else if (o.isPointLight) point++; else if (o.isHemisphereLight) hemi++;
    else amb++; });
  return { dir, spot, point, hemi, amb, total: dir+spot+point+hemi+amb,
           programs: s.programs|0, draws: s.drawCalls|0, tris: s.triangles|0 };
};

// ---- material bookkeeping -------------------------------------------------
// One pass over the scene, memoised: every material, with the mesh it is on
// and whether that mesh is a "hero" (viewmodel layer 2, skinned character, or
// a name the critics scrutinise). Levers below use it to split hero from bulk.
let _MATS = null;
function mats() {
  if (_MATS) return _MATS;
  const out = [], seen = new Set();
  F().scene.traverse(o => {
    if (!o.isMesh && !o.isPoints && !o.isSprite) return;
    const hero = !!(o.isSkinnedMesh || (o.layers && o.layers.mask & (1<<2)));
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      out.push({ m, hero, name: o.name || '' });
    }
  });
  _MATS = out; return out;
}
window.__lvMats = () => {
  const g = {};
  for (const r of mats()) {
    const k = r.m.type + (r.hero ? ':hero' : ':bulk');
    g[k] = (g[k]|0) + 1;
  }
  return g;
};

const SAVE = {};
function touchAll(pred) { for (const r of mats()) if (!pred || pred(r)) r.m.needsUpdate = true; }

// ---- the levers -----------------------------------------------------------
// Each is { on(), off() }. `on` must leave the frame renderable; `off` must
// restore bit-identical state (asserted by the base-block drift print).
const L = {
  // ---------- LIGHT COUNT ----------
  // lighting.js parks the pool at intensity 0 but visible:true, so the
  // permutation carries all of them. WebGLRenderer.projectObject returns
  // early on visible===false, so hiding a light genuinely removes it from
  // NUM_*_LIGHTS and rebuilds every program — which is what we are pricing.
  _hide(kinds, keepN) {
    const hid = [];
    let seen = 0;
    F().scene.traverse(o => {
      if (!o.isLight || !o.visible) return;
      const k = o.isSpotLight ? 'spot' : o.isPointLight ? 'point'
              : o.isHemisphereLight ? 'hemi' : o.isDirectionalLight ? 'dir' : 'x';
      if (kinds.indexOf(k) < 0) return;
      seen++;
      if (seen > keepN) { o.visible = false; hid.push(o); }
    });
    return hid;
  },
  lights12: { on(){ SAVE.l12 = L._hide(['spot'], 6); }, off(){ (SAVE.l12||[]).forEach(o=>o.visible=true); } },
  lights10: { on(){ SAVE.l10 = L._hide(['spot'], 4); }, off(){ (SAVE.l10||[]).forEach(o=>o.visible=true); } },
  lights8:  { on(){ SAVE.l8  = L._hide(['spot'], 2); }, off(){ (SAVE.l8 ||[]).forEach(o=>o.visible=true); } },
  lights6:  { on(){ SAVE.l6  = L._hide(['spot'], 0); }, off(){ (SAVE.l6 ||[]).forEach(o=>o.visible=true); } },
  // the 4 fx PointLights (parked at intensity 0 in a static pose — they cost
  // a full light iteration per fragment for zero pixels)
  nopoints: { on(){ SAVE.np = L._hide(['point'], 0); }, off(){ (SAVE.np||[]).forEach(o=>o.visible=true); } },
  // everything but moon + hemi
  lights2:  { on(){ SAVE.l2 = L._hide(['spot','point'], 0); }, off(){ (SAVE.l2||[]).forEach(o=>o.visible=true); } },
  // spots AND points gone, i.e. the 8+4 practical/fx pool
  nohemi:   { on(){ SAVE.nh = L._hide(['hemi'], 0); }, off(){ (SAVE.nh||[]).forEach(o=>o.visible=true); } },

  // ---------- PER-FRAGMENT MATERIAL COST ----------
  // The augment() layer in materials.js (5 grunge taps + 2 anti-tile taps +
  // seam/wear/wet/sheen ALU) injected into every world MeshStandardMaterial.
  // Priced by dropping onBeforeCompile and recompiling — the maps and the
  // light loop stay, only the injected code goes.
  noaug: {
    on() {
      SAVE.aug = [];
      for (const r of mats()) {
        if (!r.m.onBeforeCompile || !r.m.userData || !r.m.userData.a3) continue;
        SAVE.aug.push([r.m, r.m.onBeforeCompile, r.m.customProgramCacheKey]);
        r.m.onBeforeCompile = () => {};
        r.m.customProgramCacheKey = () => 'lv-noaug';
        r.m.needsUpdate = true;
      }
    },
    off() { for (const [m,f,k] of (SAVE.aug||[])) { m.onBeforeCompile=f; m.customProgramCacheKey=k; m.needsUpdate=true; } },
  },
  // W-D3/iter09 SURFACE COAT — the roughness-linked GGX lobe + grazing-env
  // Fresnel + diffuse energy term injected at lights_fragment_end. It sits
  // behind `if (uCoat > 0.0)`, a UNIFORM branch, so zeroing the uniform skips
  // the whole block without a recompile: this lever measures exactly the ALU
  // the coat costs and nothing else. Zero texture fetches by construction.
  nocoat: {
    on() {
      SAVE.coat = [];
      for (const r of mats()) {
        const u = r.m.userData && r.m.userData.a3uniforms;
        if (u && u.uCoat && u.uCoat.value > 0) { SAVE.coat.push([u.uCoat, u.uCoat.value]); u.uCoat.value = 0; }
      }
    },
    off() { for (const [u,v] of (SAVE.coat||[])) u.value = v; },
  },
  // envMap / IBL: scene.environment drives getIBLIrradiance + getIBLRadiance
  // (a PMREM cube fetch + DFGApprox) on EVERY standard fragment.
  noenv: {
    on() { SAVE.env = F().scene.environment; F().scene.environment = null; touchAll(); },
    off() { F().scene.environment = SAVE.env; touchAll(); },
  },
  // PCFSoft -> Basic (1 tap instead of the 4x4 poisson-ish kernel)
  shadowbasic: {
    on() { const r=F().renderer; SAVE.st=r.shadowMap.type; r.shadowMap.type=0 /*BasicShadowMap*/; touchAll(); },
    off() { const r=F().renderer; r.shadowMap.type=SAVE.st; touchAll(); },
  },
  noshadow: {
    on() { const r=F().renderer; SAVE.se=r.shadowMap.enabled; r.shadowMap.enabled=false; touchAll(); },
    off() { const r=F().renderer; r.shadowMap.enabled=SAVE.se; touchAll(); },
  },
  nofog: {
    on() { SAVE.fog = F().scene.fog; F().scene.fog = null; touchAll(); },
    off() { F().scene.fog = SAVE.fog; touchAll(); },
  },
  // UPPER BOUND on all per-fragment shading: every BULK standard material
  // becomes unlit basic (hero/viewmodel/skinned untouched). Not shippable —
  // it is the ceiling the other levers are measured against.
  basicbulk: {
    on() {
      SAVE.bb = [];
      for (const r of mats()) {
        if (r.hero || !r.m.isMeshStandardMaterial) continue;
        const b = new THREE_M.MeshBasicMaterial({ map: r.m.map, color: r.m.color,
          transparent: r.m.transparent, opacity: r.m.opacity, side: r.m.side,
          depthWrite: r.m.depthWrite, alphaTest: r.m.alphaTest });
        SAVE.bb.push([r, r.m]);
        r.__swap = b;
      }
      swapApply();
    },
    off() { swapRevert(); },
  },
  // The shippable version of the same idea: bulk standard -> Phong.
  phongbulk: {
    on() {
      SAVE.bb = [];
      for (const r of mats()) {
        if (r.hero || !r.m.isMeshStandardMaterial) continue;
        const p = new THREE_M.MeshPhongMaterial({ map: r.m.map, color: r.m.color,
          normalMap: r.m.normalMap, shininess: 18, specular: 0x111111,
          transparent: r.m.transparent, opacity: r.m.opacity, side: r.m.side,
          depthWrite: r.m.depthWrite, alphaTest: r.m.alphaTest });
        SAVE.bb.push([r, r.m]);
        r.__swap = p;
      }
      swapApply();
    },
    off() { swapRevert(); },
  },

  // ---------- POST ----------
  // post.js seams (added this wave): bloom base = buffer / div, and the HDR
  // scene-buffer format. Both rebuild the composer, so the warm frames after
  // apply() matter.
  _bdiv(v) { globalThis.__BR_POST__.setBloomDiv(v); },
  bloomdiv6:  { on(){ L._bdiv(6);  }, off(){ L._bdiv(4); } },
  bloomdiv8:  { on(){ L._bdiv(8);  }, off(){ L._bdiv(4); } },
  bloomdiv12: { on(){ L._bdiv(12); }, off(){ L._bdiv(4); } },
  // A/B the 4-byte HDR scene buffer against three's derived RGBA16F.
  hdr16: { on(){ globalThis.__BR_POST__.setHdrInternalFormat(null); },
           off(){ globalThis.__BR_POST__.setHdrInternalFormat('R11F_G11F_B10F'); } },
  hdr8: { on(){ globalThis.__BR_POST__.setHdrType(THREE_M.UnsignedByteType); },
          off(){ globalThis.__BR_POST__.setHdrType(THREE_M.HalfFloatType); } },
  nobloom: { on(){ globalThis.__BR_POST__.setBloom(false); }, off(){ globalThis.__BR_POST__.setBloom(true); } },
  nofxaa:  { on(){ const p=globalThis.__BR_POST__.passes(); SAVE.fx=p.fxaaPass.enabled; p.fxaaPass.enabled=false; p.compositePass.renderToScreen=true; },
             off(){ const p=globalThis.__BR_POST__.passes(); p.fxaaPass.enabled=SAVE.fx; p.compositePass.renderToScreen=false; } },
  tier0:   { on(){ globalThis.__BR_POST__.setTier(0); }, off(){ globalThis.__BR_POST__.setTier(1); } },
  noreflect: { on(){ const R=globalThis.__BR_REFLECT_API__; if(R) R.setEnabled(false); },
               off(){ const R=globalThis.__BR_REFLECT_API__; if(R) R.setEnabled(true); } },
  // ---------- WHAT IS THE FLOOR MADE OF ----------
  // `basicbulk` proved ~half the frame is bulk shading. These split the OTHER
  // half: rasterisation+vertex, the shadow pass, weather, sky, HUD, and the
  // whole composer.
  hideworld: {                       // every bulk mesh gone: vertex+raster+shade
    on() { SAVE.hw = []; F().scene.traverse(o => {
            if ((o.isMesh||o.isPoints) && o.visible && !o.isSkinnedMesh
                && !(o.layers && o.layers.mask & (1<<2))) { o.visible=false; SAVE.hw.push(o); } }); },
    off() { (SAVE.hw||[]).forEach(o=>o.visible=true); },
  },
  noshadowpass: {                    // stop re-rendering the 1024 depth map
    on() { const r=F().renderer; SAVE.sau=r.shadowMap.autoUpdate; r.shadowMap.autoUpdate=false; },
    off() { const r=F().renderer; r.shadowMap.autoUpdate=SAVE.sau; },
  },
  noweather: {
    on() { SAVE.wx=[]; F().scene.traverse(o => {
            const n=(o.name||'').toLowerCase();
            if (o.visible && (o.isPoints || n.indexOf('rain')>=0 || n.indexOf('weather')>=0
                || n.indexOf('splash')>=0 || n.indexOf('mist')>=0)) { o.visible=false; SAVE.wx.push(o); } }); },
    off() { (SAVE.wx||[]).forEach(o=>o.visible=true); },
  },
  nosprites: {                       // every THREE.Sprite (glows, fog discs)
    on() { SAVE.sp=[]; F().scene.traverse(o => { if (o.isSprite && o.visible) { o.visible=false; SAVE.sp.push(o); } }); },
    off() { (SAVE.sp||[]).forEach(o=>o.visible=true); },
  },
  notrans: {                         // every transparent mesh — overdraw probe
    on() { SAVE.tr=[]; F().scene.traverse(o => {
            if (!o.isMesh || !o.visible) return;
            const ms = Array.isArray(o.material)?o.material:[o.material];
            if (ms.some(m => m && m.transparent)) { o.visible=false; SAVE.tr.push(o); } }); },
    off() { (SAVE.tr||[]).forEach(o=>o.visible=true); },
  },
  nopost: {                          // composer out of the loop entirely
    on() { const P=globalThis.__BR_POST__; SAVE.pr2=P.render;
           P.render = (s,c) => { const r=F().renderer; r.setRenderTarget(null); r.render(s,c); }; },
    off() { globalThis.__BR_POST__.render = SAVE.pr2; },
  },
  // ---------- OVERDRAW ----------
  // basicbulk leaves 10.6 ms of scene pass with the world UNLIT but textured,
  // against 1.9 ms with the world hidden entirely. 8.7 ms to rasterise one
  // textured layer over 2.07 Mpx is far too much for a single layer, so the
  // question is how many layers there actually are. A depth prepass answers it
  // directly: if overdraw is real, populating depth first and shading with
  // depthFunc EQUAL removes every hidden fragment's shading.
  prepass: {
    on() {
      const P = globalThis.__BR_POST__.passes();
      const RP = P.renderPass;
      SAVE.rp = RP.render;
      const dm = new THREE_M.MeshBasicMaterial({ colorWrite: false });
      SAVE.dm = dm;
      const opaque = mats().filter(r => r.m && !r.m.transparent && r.m.depthWrite !== false);
      SAVE.opq = opaque;
      RP.render = function (renderer, writeBuffer, readBuffer) {
        const target = this.renderToScreen ? null : readBuffer;
        renderer.setRenderTarget(target);
        renderer.clear(true, true, true);
        const sc = this.scene;
        sc.overrideMaterial = dm;
        renderer.render(sc, this.camera);
        sc.overrideMaterial = null;
        for (const r of opaque) { r.m.depthFunc = 2 /* EqualDepth */; r.m.depthWrite = false; }
        const ac = renderer.autoClear; renderer.autoClear = false;
        renderer.render(sc, this.camera);
        renderer.autoClear = ac;
        for (const r of opaque) { r.m.depthFunc = 3 /* LessEqualDepth */; r.m.depthWrite = true; }
      };
    },
    off() { const P = globalThis.__BR_POST__.passes(); P.renderPass.render = SAVE.rp;
            if (SAVE.dm) SAVE.dm.dispose(); },
  },
  noground: {
    on() { SAVE.gr=[]; F().scene.traverse(o => {
            if (o.isMesh && o.visible && (o.name||'') === 'ground') { o.visible=false; SAVE.gr.push(o); } }); },
    off() { (SAVE.gr||[]).forEach(o=>o.visible=true); },
  },
  nonormalmap: {
    on() { SAVE.nm=[]; for (const r of mats()) { if (r.hero || !r.m.normalMap) continue;
            SAVE.nm.push([r.m, r.m.normalMap]); r.m.normalMap = null; r.m.needsUpdate = true; } },
    off() { for (const [m,t] of (SAVE.nm||[])) { m.normalMap = t; m.needsUpdate = true; } },
  },
  norough: {
    on() { SAVE.rm=[]; for (const r of mats()) { if (r.hero || !r.m.roughnessMap) continue;
            SAVE.rm.push([r.m, r.m.roughnessMap]); r.m.roughnessMap = null; r.m.needsUpdate = true; } },
    off() { for (const [m,t] of (SAVE.rm||[])) { m.roughnessMap = t; m.needsUpdate = true; } },
  },
  // ---------- TEXTURE FILTERING ----------
  // materials.js sets anisotropy 8 on every file AND canvas texture. The
  // ground is the largest grazing-angle surface in every pose, and an aniso-8
  // sample can cost up to 8 texel fetches — multiplied by map + roughnessMap +
  // normalMap + the anti-tile second taps + FIVE grunge taps. Priced, not
  // guessed.
  _aniso(v) {
    const seen = new Set(); const saved = [];
    F().scene.traverse(o => {
      if (!o.isMesh && !o.isPoints && !o.isSprite) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (!m) continue;
        for (const k of ['map','roughnessMap','normalMap','metalnessMap','aoMap','emissiveMap','alphaMap']) {
          const t = m[k];
          if (!t || seen.has(t)) continue;
          seen.add(t);
          saved.push([t, t.anisotropy]);
          t.anisotropy = v; t.needsUpdate = false;
        }
        if (m.uniforms) for (const u in m.uniforms) {
          const t = m.uniforms[u] && m.uniforms[u].value;
          if (t && t.isTexture && !seen.has(t)) { seen.add(t); saved.push([t, t.anisotropy]); t.anisotropy = v; }
        }
        if (m.userData && m.userData.a3uniforms) for (const u in m.userData.a3uniforms) {
          const t = m.userData.a3uniforms[u] && m.userData.a3uniforms[u].value;
          if (t && t.isTexture && !seen.has(t)) { seen.add(t); saved.push([t, t.anisotropy]); t.anisotropy = v; }
        }
      }
    });
    // anisotropy is a sampler parameter: three re-applies it on texture upload,
    // so force a re-upload of the sampler state.
    F().renderer.resetState();
    return saved;
  },
  aniso1: { on(){ SAVE.a1 = L._aniso(1); }, off(){ (SAVE.a1||[]).forEach(([t,v])=>t.anisotropy=v); F().renderer.resetState(); } },
  aniso2: { on(){ SAVE.a2 = L._aniso(2); }, off(){ (SAVE.a2||[]).forEach(([t,v])=>t.anisotropy=v); F().renderer.resetState(); } },
  aniso4: { on(){ SAVE.a4 = L._aniso(4); }, off(){ (SAVE.a4||[]).forEach(([t,v])=>t.anisotropy=v); F().renderer.resetState(); } },
  nosky: {
    on() { SAVE.sk=[]; F().scene.traverse(o => { const n=(o.name||'').toLowerCase();
            if (o.visible && (n.indexOf('sky')>=0 || n.indexOf('star')>=0 || n.indexOf('cloud')>=0
                || n.indexOf('moon')>=0 || n.indexOf('shell')>=0)) { o.visible=false; SAVE.sk.push(o); } }); },
    off() { (SAVE.sk||[]).forEach(o=>o.visible=true); },
  },
  // hero-only: every BULK mesh hidden but sky/weather/hud/viewmodel intact
  noshadermat: {
    on() { SAVE.sm=[]; F().scene.traverse(o => {
            if (!o.isMesh || !o.visible) return;
            const ms=Array.isArray(o.material)?o.material:[o.material];
            if (ms.some(m=>m && m.isShaderMaterial)) { o.visible=false; SAVE.sm.push(o); } }); },
    off() { (SAVE.sm||[]).forEach(o=>o.visible=true); },
  },
  // fill-rate control: does the frame still respond to pixels at all?
  _dpr(v) { const r=F().renderer; SAVE['pr'+v]=r.getPixelRatio(); r.setPixelRatio(v); r.setSize(innerWidth, innerHeight, false); },
  _undpr(v) { const r=F().renderer; r.setPixelRatio(SAVE['pr'+v]); r.setSize(innerWidth, innerHeight, false); },
  dpr090: { on(){ L._dpr(0.90); }, off(){ L._undpr(0.90); } },
  dpr085: { on(){ L._dpr(0.85); }, off(){ L._undpr(0.85); } },
  dpr080: { on(){ L._dpr(0.80); }, off(){ L._undpr(0.80); } },
  dpr070: { on(){ L._dpr(0.70); }, off(){ L._undpr(0.70); } },
  dpr075: { on(){ L._dpr(0.75); }, off(){ L._undpr(0.75); } },
  dpr060: { on(){ L._dpr(0.60); }, off(){ L._undpr(0.60); } },
};

// material swap plumbing (needs the mesh, not just the material)
let _SWAPPED = [];
function swapApply() {
  _SWAPPED = [];
  F().scene.traverse(o => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    let hit = false;
    const next = ms.map(m => {
      const r = mats().find(x => x.m === m);
      if (r && r.__swap) { hit = true; return r.__swap; }
      return m;
    });
    if (hit) { _SWAPPED.push([o, o.material]); o.material = Array.isArray(o.material) ? next : next[0]; }
  });
}
function swapRevert() {
  for (const [o, m] of _SWAPPED) o.material = m;
  _SWAPPED = [];
  for (const r of mats()) { if (r.__swap) { r.__swap.dispose && r.__swap.dispose(); r.__swap = null; } }
}

// ---- PER-PASS GPU PROFILER ------------------------------------------------
// Subtraction levers are CONFOUNDED here and the confound is not obvious:
// FxaaShader early-outs on flat pixels, so hiding the world does not just
// remove the scene pass, it also makes FXAA nearly free — which is why
// `hideworld` (-67%) and `nopost` (-58%) sum to 125% of the same frame.
// The honest instrument is a timer query per PASS. Only one TIME_ELAPSED
// query may be active at a time, so they are issued sequentially inside one
// frame, never nested, and the whole-frame query is measured in a separate
// batch.
window.__lvProfile = (n) => {
  const gl = F().renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { error: 'no timer query ext' };
  const P = globalThis.__BR_POST__.passes();
  const passes = P.composer.passes;
  const rec = [];
  const orig = passes.map(p => p.render);
  passes.forEach((p, i) => {
    p.render = function (...a) {
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const r = orig[i].apply(this, a);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      rec.push([i, q]);
      return r;
    };
  });
  const T = F().__test;
  T.step(1); T.step(1);
  rec.length = 0;
  for (let i = 0; i < n; i++) T.step(1);
  passes.forEach((p, i) => { p.render = orig[i]; });
  window.__lvPQ = rec;
  window.__lvPNames = passes.map((p, i) =>
    (p.constructor && p.constructor.name) + '#' + i + (p.enabled === false ? '(off)' : ''));
  return { issued: rec.length, names: window.__lvPNames };
};
window.__lvProfileRead = () => {
  const gl = F().renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
  const by = {};
  let pending = 0;
  for (const [i, q] of (window.__lvPQ || [])) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      (by[i] = by[i] || []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    } else pending++;
    gl.deleteQuery(q);
  }
  window.__lvPQ = [];
  return { disjoint, pending, by, names: window.__lvPNames };
};
window.__lvPPeek = () => {
  const gl = F().renderer.getContext();
  let n = 0;
  for (const [, q] of (window.__lvPQ || []))
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) n++;
  return n;
};

window.__lvApply = (name) => { L[name].on(); return 1; };
window.__lvRevert = (name) => { L[name].off(); return 1; };
window.__lvHas = (name) => !!L[name];
window.__lvNames = () => Object.keys(L).filter(k => k[0] !== '_');
})();
"""

ORDER = [
    "lights12", "lights10", "lights8", "lights6", "nopoints", "lights2", "nohemi",
    "noaug", "nocoat", "noenv", "shadowbasic", "noshadow", "nofog",
    "phongbulk", "basicbulk",
    "nobloom", "nofxaa", "tier0", "noreflect", "dpr075",
]


def med(xs):
    return round(statistics.median(xs), 3) if xs else None


def scene_block(page, n, warm):
    """Time ONLY RenderPass#0 (the scene pass). Use for every scene-side lever:
    a whole-frame reading of the same lever is confounded by FxaaShader's
    flat-pixel early-out, which makes FXAA cheaper whenever the world gets
    darker or flatter — so `basicbulk` and `hideworld` both over-report."""
    page.evaluate("(n)=>window.__lvWarm(n)", warm)
    st = page.evaluate("(n)=>window.__lvProfile(n)", n)
    if st.get("error"):
        return None, st["error"]
    dl = time.time() + 25
    while time.time() < dl:
        page.wait_for_timeout(250)
        if page.evaluate("()=>window.__lvPPeek()") >= st["issued"]:
            break
    res = page.evaluate("()=>window.__lvProfileRead()")
    if res.get("disjoint"):
        return None, "GPU_DISJOINT_EXT"
    by = res["by"]
    if "0" not in by and 0 not in by:
        return None, "no RenderPass samples"
    ms = by.get("0", by.get(0))
    if len(ms) < max(4, n // 3):
        return None, f"only {len(ms)}/{n} scene queries retired"
    return ms, None


def block(page, n, warm):
    page.evaluate("(n)=>window.__lvWarm(n)", warm)
    r = page.evaluate("(n)=>window.__lvGpu(n)", n)
    if r.get("error"):
        return None, r["error"]
    # poll until every query has retired (or 20 s) rather than guessing a wait
    deadline = time.time() + 20.0
    while time.time() < deadline:
        page.wait_for_timeout(250)
        if page.evaluate("()=>window.__lvPeek()") >= n:
            break
    res = page.evaluate("()=>window.__lvRead()")
    if res.get("disjoint"):
        return None, "GPU_DISJOINT_EXT — batch spec-invalid"
    ms = res["ms"]
    if len(ms) < max(4, n // 3):
        return None, f"only {len(ms)}/{n} queries retired"
    return ms, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pose", default="S3")
    ap.add_argument("--levers", default=",".join(ORDER))
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--n", type=int, default=24)
    ap.add_argument("--warm", type=int, default=14)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--scene", action="store_true",
                    help="measure RenderPass#0 only (no FXAA early-out confound)")
    ap.add_argument("--profile", action="store_true",
                    help="per-PASS GPU timer profile instead of A/B levers")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    ensure_server()
    shots = open(os.path.join(HERE, "shots.js"), encoding="utf-8").read()
    import re as _re
    shots = _re.sub(r"^export\s+", "", shots, flags=_re.M)

    want = [s.strip() for s in args.levers.split(",") if s.strip()]
    rows = []

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = br.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1.0)
        page.add_init_script("window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));")
        page.goto(URL, wait_until="load", timeout=90_000)
        page.add_script_tag(content=shots)
        page.evaluate("window.__BR_SEEDS__ = SCENARIOS")
        t0 = time.time()
        while time.time() - t0 < 120:
            try:
                if page.evaluate(READY):
                    break
            except Exception:
                pass
            page.wait_for_timeout(400)
        else:
            print("NOT READY", file=sys.stderr); br.close(); return 4
        page.bring_to_front(); page.wait_for_timeout(400)
        # expose THREE for the material-swap levers
        page.evaluate("""async () => {
            const m = await import('./assets/vendor/three/build/three.module.js');
            window.THREE_M = m;
        }""")
        page.evaluate(RIG)

        if args.profile:
            # pose first (below), so this block runs after posing — moved by
            # the caller ordering; here we just note the flag.
            pass

        if args.list:
            print(json.dumps(page.evaluate("window.__lvNames()")))
            br.close(); return 0

        # pose
        if args.pose == "traversal":
            page.evaluate("(s)=>__FPS__.__test.startMission({seed:s})", 48)
            page.wait_for_timeout(500)
            page.evaluate("""()=>{const t=__FPS__.__test;t.teleport(37,0,36);t.aimAt(38,1.5,-48);
                              t.pin('moveZ',1);t.pin('sprint',true);}""")
        else:
            page.evaluate("(n)=>__FPS__.__test.setScenario(n, SCENARIOS[n])", args.pose)
        page.wait_for_timeout(1200)

        env = page.evaluate("""()=>{const gl=__FPS__.renderer.getContext();
            const d=gl.getExtension('WEBGL_debug_renderer_info');
            return {dpr:__FPS__.renderer.getPixelRatio(),
                    buf:[gl.drawingBufferWidth,gl.drawingBufferHeight],
                    gpu:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):null};}""")
        print(f"env: {json.dumps(env)}")
        print(f"lights/counters: {json.dumps(page.evaluate('window.__lvCounts()'))}")
        print(f"materials: {json.dumps(page.evaluate('window.__lvMats()'))}")
        print(f"pose={args.pose} rounds={args.rounds} n={args.n} warm={args.warm}\n")

        if args.profile:
            for rep in range(args.rounds):
                st = page.evaluate("(n)=>window.__lvProfile(n)", args.n)
                if st.get("error"):
                    print(f"profile error: {st['error']}"); break
                dl = time.time() + 25
                while time.time() < dl:
                    page.wait_for_timeout(250)
                    if page.evaluate("()=>window.__lvPPeek()") >= st["issued"]:
                        break
                res = page.evaluate("()=>window.__lvProfileRead()")
                if res.get("disjoint"):
                    print("  disjoint — batch discarded"); continue
                names = res["names"]
                tot = 0.0
                lines = []
                for k in sorted(res["by"], key=lambda x: int(x)):
                    m = statistics.median(res["by"][k])
                    tot += m
                    lines.append((names[int(k)], m, len(res["by"][k])))
                print(f"  --- per-pass profile, round {rep+1} "
                      f"(pending {res['pending']}) ---")
                for nm, m, c in lines:
                    print(f"     {nm:22s} {m:7.3f} ms  ({100*m/tot:5.1f}%)  n={c}")
                # CONTENTION BOUND: this box shares the iGPU with the owner's
                # own Chrome. Preemption can only ADD elapsed time to a timer
                # query, so the MINIMUM sample across a batch is the closest
                # thing to an uncontended reading available here. The spread
                # between min and median is the contention allowance, measured
                # rather than asserted.
                for k in sorted(res["by"], key=lambda x: int(x)):
                    v = sorted(res["by"][k])
                    print(f"       {names[int(k)]:20s} min {v[0]:6.3f}  p10 "
                          f"{v[max(0,int(.10*len(v)))]:6.3f}  med "
                          f"{statistics.median(v):6.3f}  max {v[-1]:6.3f}")
                print(f"     {'SUM OF PASSES':22s} {tot:7.3f} ms")
            # whole-frame reading for the same pose, same batch
            b, e = block(page, args.n, args.warm)
            if b:
                print(f"     {'WHOLE FRAME':22s} {statistics.median(b):7.3f} ms "
                      f"(timer query around the same step)")
            br.close()
            return 0

        base_hist = []
        for name in want:
            if not page.evaluate("(n)=>window.__lvHas(n)", name):
                print(f"  !! unknown lever {name}"); continue
            ratios, bases, levs, counts = [], [], [], None
            err = None
            meter = scene_block if args.scene else block
            for _ in range(args.rounds):
                b, e = meter(page, args.n, args.warm)
                if e: err = e; break
                page.evaluate("(n)=>window.__lvApply(n)", name)
                if counts is None:
                    counts = page.evaluate("window.__lvCounts()")
                l, e = meter(page, args.n, args.warm)
                page.evaluate("(n)=>window.__lvRevert(n)", name)
                if e: err = e; break
                bm, lm = statistics.median(b), statistics.median(l)
                ratios.append(lm / bm); bases.append(bm); levs.append(lm)
            if err:
                print(f"  {name:12s} ERROR {err}"); continue
            r = med(ratios)
            base_hist += bases
            row = {"lever": name, "pose": args.pose, "rounds": args.rounds,
                   "baseMedian": med(bases), "leverMedian": med(levs),
                   "ratio": r, "savedPct": round(100 * (1 - r), 1),
                   "savedMs": round(med(bases) - med(levs), 2),
                   "perRoundRatios": [round(x, 3) for x in ratios],
                   "counts": counts}
            rows.append(row)
            print(f"  {name:12s} base {row['baseMedian']:7.2f} -> {row['leverMedian']:7.2f} ms   "
                  f"ratio {r:.3f}  ({row['savedPct']:+5.1f}%, {row['savedMs']:+6.2f} ms)   "
                  f"rounds {row['perRoundRatios']}")

        if base_hist:
            print(f"\nbaseline drift across the whole run: min {min(base_hist):.2f} "
                  f"max {max(base_hist):.2f} median {statistics.median(base_hist):.2f} ms "
                  f"— spread {100*(max(base_hist)/min(base_hist)-1):.1f}% "
                  f"(this is the contention the ratios are immune to)")
        errs = page.evaluate("window.__err||[]")
        if errs:
            print(f"\nPAGE ERRORS: {errs[:5]}")
        br.close()

    print("\n---- ranked by GPU ms saved ----")
    for r in sorted(rows, key=lambda x: -(x["savedMs"] or 0)):
        print(f"  {r['lever']:12s} {r['savedMs']:+7.2f} ms  ({r['savedPct']:+5.1f}%)")
    if args.out:
        open(args.out, "w", encoding="utf-8").write(json.dumps(rows, indent=1))
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
