/**
 * CRESTBOUND — runtime/world/water.js
 * ---------------------------------------------------------------------------
 * Swimmable water. CONTRACT §19.
 *
 * Three jobs, in the order they matter to the player:
 *
 *  1. PHYSICS. A `Volume` of kind `'water'` whose `props.surfaceY` is the exact
 *     Y the visual surface oscillates around. controller.js swims against that
 *     number (CONTRACT §11 WATER), so the mesh is authored TO it rather than the
 *     other way round: Gerstner waves displace the RENDER, never the swim plane.
 *  2. READABILITY. Deep water is dark and saturated, shallow water is bright,
 *     and the boundary wears a broken, moving foam line. That gradient is what
 *     tells a player "this is waist deep, wade it" versus "this is the bottom
 *     of the course".
 *  3. BEAUTY. Three summed Gerstner waves with analytic tangents, a Schlick
 *     fresnel against an analytic sky, a sun glint, ripple-perturbed normals and
 *     whitecaps on the crests.
 *
 * WHO OWNS THE SHADER. `Mats.get('water')` is the contract's shared Gerstner
 * instance (materials.js §14) and this module is its CONSUMER, not a second
 * implementation: we clone it per body — materials.js's water `clone()` keeps
 * the clock and the wave SHAPE shared by reference while handing each body its
 * own colour uniforms — enable its `CB_WATER_SHORE` define, and feed it the
 * `aShore` attribute it is waiting for. A local Gerstner material exists ONLY
 * as the standalone fallback for a caller with no Mats service (harnesses, unit
 * tests); it speaks the same attribute so the two paths cannot diverge.
 *
 * THE SHORELINE. A screen-space depth fade would need a depth pre-pass this
 * game does not run. Instead every vertex carries **`aShore`**, baked at build
 * time from the course's terrain heightfield (or any `def.sampleY(x, z)` the
 * caller supplies) with the convention materials.js expects:
 *
 *     aShore = clamp(1 − (surfaceY − groundY) / fade, 0, 1)
 *             → 1 exactly at the waterline, 0 in water `fade` metres deep
 *
 * It is free at runtime and — unlike a depth fade — it stays correct when the
 * camera is UNDER the surface.
 *
 * ROUND 3 (2026-09-04, surface lane, critic r2 "GIANT white foam blobs ... no
 * sky reflection"): `aShore` is now a vec2. `.x` is the shallowness above;
 * `.y` is the HORIZONTAL distance in metres to the nearest DRY ground, so the
 * shader can put foam on the bank (< ~1 m from the line) and nowhere else —
 * a 20 m wading shelf 0.5 m deep is water, not milk. course.js never passes
 * a heightfield, so the ground comes from terrain.js's registry of the
 * heightfields it built for this course (`terrainGroundAt`). The reflection is
 * the scene's PMREM sky dome, handed to the material by `mesh.onBeforeRender`
 * (see `waterBeforeRender`).
 *
 * FLOW. `def.flow = [x, z]` (metres/second) scrolls the surface detail AND
 * emits a second `Volume` of kind `'current'`, so what you see pushing you is
 * literally what pushes you.
 *
 * CAUSTICS. materials.js's `sand` (and `dirt`) bakes carry a caustic injection
 * driven by the shared uniform `uCbCaustic = (surfaceY, strength, scale,
 * speed)`. `buildWater` writes it, so every sand surface below the water picks
 * up the moving light of the water above it.
 *
 * @module runtime/world/water
 */

import * as THREE from 'three';
import { Volume } from './collider.js';
import { terrainGroundAt } from './terrain.js';

/* ---------------------------------------------------------------------------
 * shared clock + local fallback bank
 * ------------------------------------------------------------------------ */

/** Fallback clock, used when this module built the material itself. */
const WATER_TIME = { value: 0 };

/** Shore-distance bake: sample rings (metres) and the 8 compass directions. */
const SHORE_FAR = 4.0;
const SHORE_RINGS = [0.3, 0.6, 0.9, 1.25, 1.7, 2.3, 3.0, 4.0];
const SHORE_DIR = (() => {
  const a = new Float32Array(16);
  for (let k = 0; k < 8; k++) { a[k * 2] = Math.cos(k * Math.PI / 4); a[k * 2 + 1] = Math.sin(k * Math.PI / 4); }
  return a;
})();

/**
 * ROUND 3: hand the surface the scene's PMREM sky dome. Runs right before the
 * draw (three calls object.onBeforeRender ahead of setProgram, so a changed
 * envMap recompiles on the same draw). Setting `material.envMap` is what makes
 * three emit USE_ENVMAP + ENVMAP_TYPE_CUBE_UV + the CUBEUV_* size defines for
 * this ShaderMaterial; the shader samples the texture through its own
 * `uEnvMap` uniform. One compare per frame, zero allocation. Module-level so
 * every water mesh shares the one function object.
 */
function waterBeforeRender(renderer, scene, camera, geometry, material) {
  const u = material.uniforms;
  if (!u) return;
  const env = (scene && scene.environment) ? scene.environment : null;
  if (material.envMap !== env) {
    material.envMap = env;
    if (u.uEnvMap) u.uEnvMap.value = env;
    material.needsUpdate = true;
  }
  if (u.uEnvIntensity) {
    const k = (scene && typeof scene.environmentIntensity === 'number') ? scene.environmentIntensity : 1;
    u.uEnvIntensity.value = k;
  }
}

const _fallbackMats = new Map();
const _themedMats = new Map();

/**
 * Per-`kind2` look. `fade` is the depth in metres over which the shore
 * attribute ramps; `amp` scales materials.js's `uAmp`, so a pool ripples where
 * a sea rolls.
 */
export const WATER_LOOK = {
  /* 2026-09-04 (surface lane, O4/C8): whitecaps OFF for still water — a lake
   * or a pool foams only where it meets the ground. `crestFoam` stays on the
   * sea. `amp` is written for every non-pool body (one ocean per course). */
  /* `shoreWidth` is METRES OF DEPTH back from the waterline. ROUND 2
   * (2026-09-04, surface lane, critic "the shore band is a barcode of
   * white/yellow stripes ... a 4 m striped band"): materials.js WATER_FRAG
   * now caps it at 0.8 m and breaks it with noise, so the foam is a soft
   * 0.6 m edge where the water meets the ground, not a band. `gloss`
   * 240/200/280 -> 140/120/160: the glint lobe broadened so it reads at a
   * 0.60 render scale (O4). */
  lake: { deep: 0x0d3a4a, shallow: 0x4fbfc4, foam: 0xeaf9ff, amp: 0.42, shoreWidth: 0.6, crestFoam: 0.0, ripple: 0.55, opacity: 0.86, fade: 3.0, gloss: 140 },
  sea:  { deep: 0x07293f, shallow: 0x2f9fc0, foam: 0xf2fbff, amp: 1.05, shoreWidth: 0.7, crestFoam: 0.70, ripple: 0.70, opacity: 0.90, fade: 5.0, gloss: 120 },
  pool: { deep: 0x125a63, shallow: 0x76e2dd, foam: 0xffffff, amp: 0.18, shoreWidth: 0.4, crestFoam: 0.0, ripple: 0.40, opacity: 0.72, fade: 1.6, gloss: 160 },
};

/* ---------------------------------------------------------------------------
 * the standalone fallback shader (NO Mats service available)
 * ------------------------------------------------------------------------ */

const FALLBACK_VERT = /* glsl */`
uniform float uTime;
uniform vec4  uWaveA;
uniform vec4  uWaveB;
uniform vec4  uWaveC;
uniform float uAmp;
uniform vec2  uFlow;
attribute vec2 aShore;
varying vec3  vW;
varying vec3  vN;
varying vec2  vUvW;
varying float vCrest;
varying vec2  vShore;

vec3 gerst(vec4 w, vec3 p, float t, inout vec3 tang, inout vec3 bino) {
  vec2 d = normalize(w.xy + vec2(1e-5, 1e-5));
  float len = max(w.w, 0.25);
  float k = 6.283185307 / len;
  float c = sqrt(9.81 / k);
  float s = clamp(w.z, 0.0, 1.0) * uAmp;
  float a = s / k;
  float f = k * (dot(d, p.xz) - c * t);
  float sf = sin(f), cf = cos(f);
  tang += vec3(-d.x * d.x * s * sf, d.x * s * cf, -d.x * d.y * s * sf);
  bino += vec3(-d.x * d.y * s * sf, d.y * s * cf, -d.y * d.y * s * sf);
  return vec3(d.x * a * cf, a * sf, d.y * a * cf);
}

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 tang = vec3(1.0, 0.0, 0.0), bino = vec3(0.0, 0.0, 1.0), off = vec3(0.0);
  off += gerst(uWaveA, wp, uTime, tang, bino);
  off += gerst(uWaveB, wp, uTime, tang, bino);
  off += gerst(uWaveC, wp, uTime, tang, bino);
  vec3 disp = wp + off;
  vW = disp;
  vN = normalize(cross(bino, tang));
  vUvW = disp.xz + uFlow * uTime;
  vCrest = clamp(off.y / max(0.08, uAmp * 0.65), -1.0, 1.0) * 0.5 + 0.5;
  vShore = aShore;
  gl_Position = projectionMatrix * viewMatrix * vec4(disp, 1.0);
}
`;

const FALLBACK_FRAG = /* glsl */`
uniform float uTime;
uniform vec3  uShallow;
uniform vec3  uDeep;
uniform vec3  uFoam;
uniform float uShoreWidth;
uniform float uCrestFoam;
uniform float uRipple;
uniform float uGloss;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyTop;
uniform vec3  uSkyHorizon;
uniform float uOpacity;
varying vec3  vW;
varying vec3  vN;
varying vec2  vUvW;
varying float vCrest;
varying vec2  vShore;

float wh(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x),
             mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 N = normalize(vN);
  float r1 = wn(vUvW * 2.1 + uTime * 0.20);
  float r2 = wn(vUvW * 5.3 - uTime * 0.14);
  N = normalize(N + vec3((r1 - 0.5) * uRipple * 0.5, 0.0, (r2 - 0.5) * uRipple * 0.5));
  if (!gl_FrontFacing) N = -N;

  vec3 V = normalize(cameraPosition - vW);
  // Schlick F0 0.02 on the smooth wave normal (the ripples keep the glint)
  vec3 Ng = normalize(vN);
  if (!gl_FrontFacing) Ng = -Ng;
  float ndv = clamp(dot(Ng, V), 0.0, 1.0);
  float fres = clamp(0.02 + 0.98 * pow(1.0 - ndv, 5.0), 0.0, 1.0);

  float depth = clamp(1.0 - vShore.x, 0.0, 1.0);
  float shoreD = vShore.y;
  vec3 body = mix(uShallow, uDeep, depth * depth);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.035);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.42));
  vec3 col = mix(body, sky, fres);

  vec3 H = normalize(normalize(uSunDir) + V);
  col += uSunColor * pow(clamp(dot(N, H), 0.0, 1.0), max(uGloss, 4.0)) * (0.35 + 0.65 * fres) * 2.2;

  // foam: the bank only (shoreD metres from dry ground) + sea whitecaps
  float churn = wn(vUvW * 2.6 + vec2(uTime * 0.35, -uTime * 0.22));
  float band = 1.0 - smoothstep(0.10, clamp(uShoreWidth, 0.3, 1.2), shoreD);
  float foam = clamp(band * smoothstep(0.30, 0.72, churn + band * 0.25)
                   + smoothstep(0.90, 0.99, vCrest * (0.72 + 0.34 * churn)) * uCrestFoam * smoothstep(0.4, 0.7, churn), 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.8);

  float alpha = clamp(mix(uOpacity, 1.0, max(fres * 0.75, foam)), 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.04, depth + foam);
  /* LINEAR HDR out — post.js FinishPass is the one and only tone map.
     See the ROUND 5 note in world/sky.js: a custom ShaderMaterial that ACES'd
     into the composer's half-float target was tone mapped twice, which clamps
     every specular and fresnel highlight to 1.0 and is why the critic measured
     the water as 'one uniform cyan quad with a single specular smear'. */
  gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
}
`;

/** Theme-derived sky / sun colours, shared by both material paths. */
function skyAndSun(theme) {
  /* 2026-09-04: the reflection used to take the FOG colour as its horizon —
   * in azure that is 0x1b4d61, a deep teal, so the fresnel term reflected a
   * dark band and the lagoon read as a flat cyan sheet. Water reflects the
   * SKY DOME the player sees; take the dome's own horizon/zenith and its sun
   * (sky.params), and fall back to fog/bg only for a theme without a dome. */
  const sp = (theme && theme.sky && theme.sky.params) || null;
  const fogC = (theme && theme.fog && theme.fog.color);
  const bg = (theme && theme.bg !== undefined && theme.bg !== null) ? theme.bg : null;
  const horizon = (sp && sp.horizon !== undefined) ? sp.horizon
    : ((fogC !== undefined && fogC !== null) ? fogC : (bg !== null ? bg : 0xbcd8ee));
  const top = (sp && sp.mid !== undefined) ? sp.mid
    : ((sp && sp.top !== undefined) ? sp.top : (bg !== null ? bg : 0x2f6fc0));
  const lights = (theme && theme.lights) || null;
  const sunCol = (sp && sp.sunColor !== undefined) ? sp.sunColor
    : ((lights && lights.key && lights.key.color) || 0xfff2d8);
  const dir = (sp && Array.isArray(sp.sunDir)) ? sp.sunDir
    : ((lights && lights.key && lights.key.dir) || [-0.42, 0.86, 0.30]);
  return { top, horizon, sunCol, dir };
}

/**
 * Resolve the look for one body: kind2 defaults <- the THEME's
 * `materialOverrides.water` <- the def's own `look`.
 *
 * 2026-09-04 (surface lane, O4 "cyan TV static"): this used to write
 * `palette.water` into uDeep unconditionally. `palette.water` is the theme's
 * ACCENT water colour (azure: 0x3fd2c8, a saturated cyan) — it was never meant
 * to be the deep body, and the theme author's own `materialOverrides.water.deep`
 * (azure 0x063a56) was being clobbered by it, so the lagoon was one bright
 * cyan sheet with no depth ramp at all. The theme override now wins; the
 * palette colour is only the SHALLOW fallback for a theme without one.
 */
function resolveLook(theme, kind2, look) {
  const K = kind2 || 'lake';
  const o = (theme && theme.materialOverrides && theme.materialOverrides.water) || null;
  const pal = (theme && theme.palette) || null;
  const L = Object.assign({}, WATER_LOOK[K] || WATER_LOOK.lake);
  if (pal && pal.water !== undefined && pal.water !== null && !(o && o.shallow !== undefined)) L.shallow = pal.water;
  if (o) {
    for (const k of ['deep', 'shallow', 'foam', 'opacity', 'shoreWidth', 'crestFoam', 'ripple', 'gloss']) {
      if (o[k] !== undefined) L[k] = o[k];
    }
    if (typeof o.depthFade === 'number') L.fade = o.depthFade;
    if (typeof o.amp === 'number') L.amp = o.amp;
  }
  if (look) Object.assign(L, look);
  // whitecaps belong to open SEA only (owner O4: foam only at the shore band);
  // a theme's crestFoam still applies to its seas, never to a lake or a pool
  if (K !== 'sea' && !(look && look.crestFoam !== undefined)) L.crestFoam = 0;
  return L;
}

/** Write the per-body look onto whichever material we ended up with. */
function applyLook(mat, theme, L, flow) {
  const u = mat.uniforms;
  if (!u) return mat;
  const S = skyAndSun(theme);
  const set = (k, v) => { if (u[k] && u[k].value && u[k].value.isColor) u[k].value.setHex(v); };
  set('uDeep', L.deep);
  set('uShallow', L.shallow);
  set('uFoam', L.foam);
  set('uSkyTop', S.top);
  set('uSkyHorizon', S.horizon);
  set('uSunColor', S.sunCol);
  if (u.uSunDir && u.uSunDir.value && u.uSunDir.value.isVector3) {
    u.uSunDir.value.set(S.dir[0], S.dir[1], S.dir[2]).normalize();
  }
  if (u.uShoreWidth) u.uShoreWidth.value = L.shoreWidth;
  if (u.uCrestFoam) u.uCrestFoam.value = L.crestFoam;
  if (u.uRipple) u.uRipple.value = L.ripple;
  if (u.uOpacity) u.uOpacity.value = L.opacity;
  if (u.uGloss) u.uGloss.value = L.gloss;
  if (u.uDepthFade) u.uDepthFade.value = L.fade;
  if (u.uFlow && u.uFlow.value && u.uFlow.value.isVector2) {
    u.uFlow.value.set(flow ? flow[0] : 0, flow ? flow[1] : 0);
  }
  // uAmp is SHARED with every other body in materials.js's water (one ocean,
  // one wave set). A pool never retunes it (a basin must not flatten the lake
  // it sits beside); a lake or sea does, unless a body opts out.
  if (u.uAmp && (L.ownAmp || (L.kind2 !== 'pool' && L.ownAmp !== false))) u.uAmp.value = L.amp;
  return mat;
}

/**
 * The standalone Gerstner material — ONLY used when no Mats service is
 * available. Cached per (theme, kind2).
 */
export function fallbackWaterMaterial(theme, kind2, look) {
  const id = (theme && theme.id) || 'default';
  const K = kind2 || 'lake';
  const ck = id + '|' + K + (look ? '|' + JSON.stringify(look) : '');
  let m = _fallbackMats.get(ck);
  if (m) return m;
  const L = resolveLook(theme, K, look);
  L.kind2 = K;
  m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: WATER_TIME,
      uWaveA: { value: new THREE.Vector4(1.0, 0.25, 0.26, 7.5) },
      uWaveB: { value: new THREE.Vector4(-0.6, 0.85, 0.20, 4.1) },
      uWaveC: { value: new THREE.Vector4(0.35, -0.95, 0.14, 2.2) },
      uAmp: { value: L.amp },
      uFlow: { value: new THREE.Vector2(0, 0) },
      uShallow: { value: new THREE.Color(L.shallow) },
      uDeep: { value: new THREE.Color(L.deep) },
      uFoam: { value: new THREE.Color(L.foam) },
      uShoreWidth: { value: L.shoreWidth },
      uCrestFoam: { value: L.crestFoam },
      uRipple: { value: L.ripple },
      uGloss: { value: L.gloss },
      uDepthFade: { value: L.fade },
      uSunDir: { value: new THREE.Vector3(-0.42, 0.86, 0.30) },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uSkyTop: { value: new THREE.Color(0x2f6fc0) },
      uSkyHorizon: { value: new THREE.Color(0xbcd8ee) },
      uOpacity: { value: L.opacity },
      uEnvMap: { value: null },
      uEnvIntensity: { value: 1.0 },
    },
    vertexShader: FALLBACK_VERT,
    fragmentShader: FALLBACK_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.name = 'water_fallback_' + K;
  m.userData.cbKey = 'water';
  m.userData.cbLook = L;
  m.userData.cbOwned = true;
  m.customProgramCacheKey = () => 'crestbound-water-fallback';
  _fallbackMats.set(ck, m);
  return m;
}

/**
 * Resolve the material for one body of water. Prefers the contract's shared
 * `Mats.get('water', themeId)` instance, cloned so this body owns its colours
 * while the CLOCK and the WAVE SHAPE stay shared (materials.js's water clone()
 * re-attaches those by reference on purpose — one ocean, many surfaces).
 */
function resolveMaterial(theme, mats, kind2, look) {
  const K = kind2 || 'lake';
  const L = resolveLook(theme, K, look);
  L.kind2 = K;
  const themeId = (theme && theme.id) || 'default';
  const ck = themeId + '|' + K + (look ? '|' + JSON.stringify(look) : '');

  if (mats && typeof mats.get === 'function') {
    const cached = _themedMats.get(ck);
    if (cached) return { mat: cached, look: L, shared: true };
    let base = null;
    try { base = mats.get('water', themeId); } catch (e) { base = null; }
    if (base && base.isShaderMaterial && base.uniforms) {
      const m = (typeof base.clone === 'function') ? base.clone() : base;
      m.name = 'cb.water.' + themeId + '.' + K;
      // tell materials.js's vertex shader that this surface HAS a shore
      // attribute; without the define it compiles the `vCbShore = 0.0` branch
      // and every body renders at full depth with no shoreline at all.
      m.defines = Object.assign({}, m.defines || null, { CB_WATER_SHORE: '' });
      // materials.js's water returns the constant cache key 'cb-water'; a
      // shore-enabled clone must not be able to share a compiled program with a
      // shore-less one, so widen the key by the define we just added.
      m.customProgramCacheKey = function () { return 'cb-water-shore'; };
      m.needsUpdate = true;
      applyLook(m, theme, L, null);
      _themedMats.set(ck, m);
      return { mat: m, look: L, shared: true };
    }
  }
  return { mat: applyLook(fallbackWaterMaterial(theme, K, look), theme, L, null), look: L, shared: false };
}

/**
 * Build a body of water.
 *
 * @param {object} def WaterDef —
 *   {kind:'water', p:[x,y,z] (CENTRE of the water BOX), s:[sx,sy,sz],
 *    flow?:[x,z] m/s, kind2?:'lake'|'sea'|'pool', res?:metres per quad,
 *    surfaceY?:number, fade?:metres, look?:{}, caustics?:false|string[],
 *    heightfield?:Heightfield, sampleY?:(x,z)=>number, id?:string}
 * @param {object} theme ThemeDef
 * @param {object} [mats] the shared Mats service (CONTRACT §14)
 * @returns {{mesh: THREE.Mesh, volume: Volume, current: Volume|null,
 *            volumes: Volume[], surfaceY: number, bounds: THREE.Box3,
 *            material: THREE.Material, update: function, dispose: function}}
 */
export function buildWater(def, theme, mats) {
  const d = def || {};
  const p = d.p || [0, 0, 0];
  const s = d.s || [40, 4, 40];
  const sx = s[0], sy = (s[1] === undefined ? 4 : s[1]), sz = (s[2] === undefined ? s[0] : s[2]);
  const kind2 = d.kind2 || 'lake';
  const surfaceY = (d.surfaceY === undefined) ? (p[1] + sy * 0.5) : d.surfaceY;
  const flow = (d.flow && (d.flow[0] || d.flow[1])) ? d.flow : null;

  const R = resolveMaterial(theme, mats, kind2, d.look);
  const mat = R.mat;
  const LOOK = R.look;
  const fade = (d.fade === undefined) ? LOOK.fade : d.fade;
  if (flow) applyLook(mat, theme, LOOK, flow);

  // --- geometry -----------------------------------------------------------
  // Subdivision is driven by the WAVELENGTH, not by taste: below ~6 segments
  // per wavelength a Gerstner surface aliases into a moiré of triangles. The
  // shortest wave materials.js ships is uWaveC at 2.2 m.
  const target = d.res || 0.9;
  let segX = Math.min(240, Math.max(1, Math.round(sx / target)));
  let segZ = Math.min(240, Math.max(1, Math.round(sz / target)));
  if (segX * segZ > 60000) {
    const k = Math.sqrt((segX * segZ) / 60000);
    segX = Math.max(1, Math.round(segX / k));
    segZ = Math.max(1, Math.round(segZ / k));
  }

  const plane = new THREE.PlaneGeometry(sx, sz, segX, segZ);
  plane.rotateX(-Math.PI / 2);                     // into the XZ plane, +Y up

  // --- the aShore attribute (vec2) -----------------------------------------
  // materials.js reads .x as SHALLOWNESS: `depth = 1 - aShore.x`, so
  //   aShore.x = 1 at the waterline, 0 in water `fade` metres deep;
  // and .y as the horizontal METRES to the nearest dry ground (ROUND 3): the
  // foam band lives on the bank, whatever the body's fade depth or shelf.
  const posAttr = plane.attributes.position;
  const n = posAttr.count;
  const aShore = new Float32Array(n * 2);
  const hf = d.heightfield || null;
  // ground: the def's own heightfield / sampler first, then the heightfields
  // terrain.js built for this course (course.js passes neither)
  const sampleY = (typeof d.sampleY === 'function') ? d.sampleY : terrainGroundAt;
  const groundAt = (x, z) => {
    let g = NaN;
    if (hf && typeof hf.heightAt === 'function') g = hf.heightAt(x, z);
    if (!(g === g)) g = sampleY(x, z);
    return g;
  };
  const cx = p[0], cz = p[2];
  const invFade = 1 / Math.max(0.05, fade);
  let anyGround = false;
  const dryY = surfaceY - 0.03;
  const isDry = (x, z) => { const g = groundAt(x, z); return g === g && g >= dryY; };
  for (let i = 0; i < n; i++) {
    const wx = posAttr.getX(i) + cx;
    const wz = posAttr.getZ(i) + cz;
    const g = groundAt(wx, wz);
    if (g === g) {
      anyGround = true;
      const depth = surfaceY - g;
      const k = 1 - depth * invFade;
      aShore[i * 2] = k < 0 ? 0 : (k > 1 ? 1 : k);
      // distance to dry ground: rings of 8 samples out to 4 m; the first ring
      // with a dry sample is the distance (vertices sit 0.9-1.4 m apart, so
      // the line interpolates between them)
      let sd = SHORE_FAR;
      if (depth <= 0.03) sd = 0;
      else {
        for (let r = 0; r < SHORE_RINGS.length && sd === SHORE_FAR; r++) {
          const rad = SHORE_RINGS[r];
          for (let k8 = 0; k8 < 8; k8++) {
            if (isDry(wx + SHORE_DIR[k8 * 2] * rad, wz + SHORE_DIR[k8 * 2 + 1] * rad)) { sd = rad; break; }
          }
        }
      }
      aShore[i * 2 + 1] = sd;
    } else {
      aShore[i * 2] = 0;                            // no ground = treat as deep
      aShore[i * 2 + 1] = SHORE_FAR;
    }
  }
  // A body with no ground reference still gets a shoreline: ramp at the RIM, so
  // an authored pool reads as a pool and not as a flat blue rectangle.
  if (!anyGround) {
    const rimFade = Math.min(sx, sz) * 0.14;
    const invRim = 1 / Math.max(0.05, rimFade);
    for (let i = 0; i < n; i++) {
      const lx = Math.abs(posAttr.getX(i)), lz = Math.abs(posAttr.getZ(i));
      const dEdge = Math.min(sx * 0.5 - lx, sz * 0.5 - lz);
      const k = 1 - dEdge * invRim;
      aShore[i * 2] = k < 0 ? 0 : (k > 1 ? 1 : k);
      aShore[i * 2 + 1] = dEdge < 0 ? 0 : (dEdge > SHORE_FAR ? SHORE_FAR : dEdge);
    }
  }
  plane.setAttribute('aShore', new THREE.BufferAttribute(aShore, 2));
  plane.computeBoundingBox();
  plane.computeBoundingSphere();

  const mesh = new THREE.Mesh(plane, mat);
  mesh.name = 'water.' + kind2;
  mesh.position.set(cx, surfaceY, cz);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.def = def;
  mesh.userData.surfaceY = surfaceY;
  mesh.userData.noMerge = true;
  mesh.onBeforeRender = waterBeforeRender;

  // --- volumes ------------------------------------------------------------
  const volume = new Volume({
    center: [cx, p[1], cz],
    half: [sx * 0.5, sy * 0.5, sz * 0.5],
    kind: 'water',
    props: { surfaceY, kind2, flow: flow || null, id: d.id || ('water:' + kind2) },
    ref: mesh,
  });

  let current = null;
  if (flow) {
    const power = Math.hypot(flow[0], flow[1]) || 1;
    current = new Volume({
      center: [cx, p[1], cz],
      half: [sx * 0.5, sy * 0.5, sz * 0.5],
      kind: 'current',
      props: { dir: [flow[0] / power, 0, flow[1] / power], power, id: (d.id || 'water') + ':current' },
      ref: mesh,
    });
  }

  // --- caustics on the floor below ---------------------------------------
  // The caustic uniform is SHARED per material key, so only ONE body may own it
  // per course. A lake or a sea claims it automatically (it is the body a course
  // is built around); a `pool` never does, so a decorative basin at y = 2 cannot
  // yank the effect off the lake at y = 12. `def.caustics` overrides either way:
  // an array of keys forces the link, `false` suppresses it.
  const wantCaustics = Array.isArray(d.caustics)
    ? d.caustics
    : (d.caustics === false ? null : (kind2 === 'pool' ? null : ['sand']));
  if (wantCaustics && mats) {
    for (let i = 0; i < wantCaustics.length; i++) {
      linkCaustics(mats, wantCaustics[i], {
        surfaceY,
        strength: (d.causticStrength === undefined ? 0.9 : d.causticStrength),
        scale: 0.55,
        speed: 0.9,
      });
    }
  }

  const bounds = new THREE.Box3(
    new THREE.Vector3(cx - sx * 0.5, p[1] - sy * 0.5, cz - sz * 0.5),
    new THREE.Vector3(cx + sx * 0.5, Math.max(surfaceY, p[1] + sy * 0.5), cz + sz * 0.5));

  return {
    mesh,
    material: mat,
    volume,
    current,
    volumes: current ? [volume, current] : [volume],
    surfaceY,
    bounds,
    /**
     * Advance the surface. `t` is a clock in seconds; passing the same `t`
     * reproduces the same crests exactly (determinism law, CONTRACT §21).
     * When materials.js owns the material its clock is `Mats.tick()`'s, and
     * this is a harmless idempotent re-write of the same value.
     */
    update(t) {
      if (mat.uniforms && mat.uniforms.uTime) mat.uniforms.uTime.value = t;
      else WATER_TIME.value = t;
    },
    dispose() {
      plane.dispose();
      if (mesh.parent) mesh.parent.remove(mesh);
      volume.dispose();
      if (current) current.dispose();
      // the material is CACHED per (theme, kind2) and outlives any one body —
      // disposeWater() frees the bank, never this.
    },
  };
}

/**
 * Point a floor material's caustic injection at a water surface.
 * materials.js bakes `uCbCaustic = (surfaceY, strength, scale, speed)` plus
 * `uCbCausticColor` onto the slope-blended ground keys; every fragment below
 * `surfaceY` then picks up the moving light of the water above it.
 *
 * Entirely defensive: a material bank with no caustic uniform is a no-op, never
 * an error. Note the uniform is SHARED per key, so the LAST water body to call
 * this owns the effect for that key — which is what you want, because a course
 * has one main body of water and the rest are set dressing.
 *
 * @param {object} mats the shared Mats service
 * @param {string} key floor material key ('sand', 'dirt', 'stone', …)
 * @param {{surfaceY:number, strength?:number, scale?:number, speed?:number, color?:number}} opt
 * @returns {boolean} true when the uniform was found and written
 */
export function linkCaustics(mats, key, opt) {
  if (!mats || !opt) return false;
  const K = key || 'sand';
  const o = {
    surfaceY: opt.surfaceY,
    strength: opt.strength === undefined ? 0.9 : opt.strength,
    scale: opt.scale === undefined ? 0.55 : opt.scale,
    speed: opt.speed === undefined ? 0.9 : opt.speed,
  };
  if (opt.color !== undefined) o.color = opt.color;

  // supported path: materials.js publishes setCaustics(key, o)
  if (typeof mats.setCaustics === 'function') {
    try { return !!mats.setCaustics(K, o); } catch (e) { /* fall through */ }
  }
  // fallback: write the shared uniforms directly, in materials.js's layout
  //   uCbCaustic       float strength (0 = off, shader branch skipped)
  //   uCbCausticParams vec4(waterSurfaceY, worldScale, speed, unused)
  if (typeof mats.uniforms !== 'function') return false;
  let u = null;
  try { u = mats.uniforms(K); } catch (e) { return false; }
  if (!u || !u.uCbCaustic || !u.uCbCausticParams || !u.uCbCausticParams.value) return false;
  if (typeof o.surfaceY === 'number') u.uCbCausticParams.value.x = o.surfaceY;
  u.uCbCausticParams.value.y = o.scale;
  u.uCbCausticParams.value.z = o.speed;
  u.uCbCaustic.value = Math.max(0, o.strength);
  if (o.color !== undefined && u.uCbCausticColor && u.uCbCausticColor.value) {
    u.uCbCausticColor.value.set(o.color);
  }
  return true;
}

/** Switch a floor key's caustics off again (leaving the water, e.g. a drain). */
export function unlinkCaustics(mats, key) {
  return linkCaustics(mats, key, { surfaceY: -1e9, strength: 0 });
}

/** The fallback water clock uniform object. */
export function waterTimeUniform() { return WATER_TIME; }

/** Advance every FALLBACK water surface in the scene. */
export function setWaterTime(t) { WATER_TIME.value = t; }

/** Release the materials this module created or cloned (level teardown). */
export function disposeWater() {
  for (const m of _fallbackMats.values()) m.dispose();
  _fallbackMats.clear();
  for (const m of _themedMats.values()) m.dispose();
  _themedMats.clear();
}
