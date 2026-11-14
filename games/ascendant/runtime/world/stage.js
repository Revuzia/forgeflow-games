/**
 * ASCENDANT — runtime/world/stage.js
 * ---------------------------------------------------------------------------
 * THE STAGE COMPILER.
 *
 * Takes a plain data file (runtime/data/stages/*.js) and turns it into a
 * playable, performant world:
 *
 *   - dispatches static kinds  (platform / beam / ice / deco / text / light)
 *     to builders.js + GLB props
 *   - dispatches every dynamic kind to the hazard factory (hazards/index.js)
 *   - builds the Broadphase, the killVolume list and the void volume
 *   - bakes static art into per-chunk merged meshes (a 200-platform stage is a
 *     handful of draw calls) and culls those chunks itself by distance+frustum
 *   - builds real checkpoint pads (ring / rotating glyph / volumetric light
 *     column), a finish portal (shader surface + particle vortex + beacon) and
 *     floating coin orbs — all instanced, ~9 draw calls for the whole set
 *   - owns the deterministic stage clock: hazards are a pure function of it,
 *     and `resetFrom(cp)` rewinds it so a gauntlet presents an identical phase
 *     on every attempt.  That is what makes ASCENDANT learnable instead of lucky.
 *
 * CONTRACT: section 17.  Signatures here are load-bearing — do not rename.
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

import * as UtilMod from '../core/util.js';
import * as SettingsMod from '../core/settings.js';
import * as ColliderMod from './collider.js';
import * as MatsMod from './materials.js';
import * as ThemesMod from './themes.js';
import * as Builders from './builders.js';
import * as HazardLib from '../hazards/index.js';

/* ── dependency handles ─────────────────────────────────────────────────────
 * Namespace imports (never a hard link error if a sibling agent ships late);
 * _assertDeps() below turns any genuinely missing symbol into one loud,
 * actionable message instead of a cryptic "undefined is not a constructor".
 */
const clamp      = UtilMod.clamp;
const damp       = UtilMod.damp;
const mulberry32 = UtilMod.mulberry32;

const Settings = SettingsMod.Settings;
const QUALITY  = SettingsMod.QUALITY;
const Collider = ColliderMod.Collider;
const KillVol  = ColliderMod.KillVolume;
const Broadphase = ColliderMod.Broadphase;
const Mats     = MatsMod.Mats;
const THEMES   = ThemesMod.THEMES;

const mergeGeometries = BGU.mergeGeometries || BGU.mergeBufferGeometries;

/* ── module-scope scratch (NO per-frame allocation below this line) ───────── */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _box1 = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _scale1 = new THREE.Vector3(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);
const _FWD = new THREE.Vector3(0, 0, 1);

/* ── kind routing ────────────────────────────────────────────────────────────
 * NOT a local table. hazards/index.js owns the map from kind to owner
 * ('hazard' -> makeHazard, 'builder' -> builders.js) and derives it from the
 * factory registry itself, so this compiler cannot drift out of step with it.
 * A duplicated list here is what previously sent `ice` down the static path and
 * left `sticky` / `lasergrid` / `lasersweep` with no route at all.
 */
function routeOf(kind) {
  if (typeof HazardLib.routeOf === 'function') return HazardLib.routeOf(kind);
  const t = HazardLib.KIND_ROUTE;
  if (t && typeof kind === 'string' && Object.prototype.hasOwnProperty.call(t, kind)) return t[kind];
  return null;
}
const isHazardKind  = (k) => routeOf(k) === 'hazard';
const isBuilderKind = (k) => routeOf(k) === 'builder';

/** Hazards that are huge or stage-spanning: never distance-cull their visuals. */
const NEVER_CULL = new Set(['chase', 'risinglava', 'wind']);

/* ── tunables for the compiler itself ────────────────────────────────────── */
const CHUNK_SIZE      = 40;   // m, minimum chunk span along the run axis
const CHUNK_MAX       = 160;  // m, maximum (see _computeChunkSize)
const HAZARD_VIS_DIST = 90;   // m, contract: visual-only skip beyond this
const SHADOW_KEEP     = 46;   // m, chunks nearer than this stay visible off-screen
const MAX_TEXT        = 40;
const MAX_LIGHTS      = 64;   // authored `kind:'light'` SITES a stage may declare
const MAX_DEBUG_BOXES = 4096;

/* ── the light budget ────────────────────────────────────────────────────────
 * A `kind:'light'` object is a light SITE, not a THREE.PointLight. Every site
 * gets its own visible source — an emissive bulb, a soft additive halo and a
 * pool of light on the floor under it, all baked into ONE extra draw call for
 * the whole stage (see _buildGlowField). Only LIGHT_POOL_SIZE real PointLights
 * ever exist, they are allocated once at build time, and the per-frame budget
 * only ever MOVES and re-tints them.
 *
 * Never add or remove a light from a live scene: three.js keys its program
 * cache on the light counts, so a light appearing mid-run recompiles every
 * material in the scene and the frame hitches (feedback_forgeflow_games_fps).
 * That is also why an unused slot sits at intensity 0 instead of visible=false
 * — an invisible light is dropped from the render list, which changes the
 * count, which is the same recompile by another route.
 *
 * 21 point lights was the measured cost of the old one-light-per-site model on
 * Intel UHD: three.js evaluates every light in the list per fragment. */
/* Six, not four. Measured on the target Intel UHD at 1280x720, foundry-1:
 * dropping 23 live point lights to 4 bought 1.48 ms/frame, i.e. ~0.08 ms per
 * point light — real, but far from the dominant cost, and two more slots buy
 * back the local fill on decor standing next to a fixture that four slots was
 * visibly losing. Six is also exactly what QUALITY.high.maxLights already
 * asked for; the pool is the ceiling and the preset still picks the number in
 * use (low 2, medium 4, high/ultra 6). */
const LIGHT_POOL_SIZE = 6;    // real PointLights allocated per stage, forever
const LIGHT_FADE_IN   = 5.0;  // 1/s
const LIGHT_FADE_OUT  = 9.0;  // 1/s — a slot must reach 0 before it re-targets
const LIGHT_SELECT_HZ = 0.2;  // s between re-selections
/* Clutter under this world-space radius never casts a shadow: it costs a full
 * extra draw in the shadow pass and contributes a sub-pixel blob. */
const SHADOW_MIN_RADIUS = 0.75;

/* =========================================================================
 * Tiny fixed-arity emitter (allocation-free emit)
 * ========================================================================= */
class Emitter {
  constructor() { this._m = new Map(); }
  on(evt, fn) {
    let a = this._m.get(evt);
    if (!a) { a = []; this._m.set(evt, a); }
    a.push(fn);
    return fn;
  }
  off(evt, fn) {
    const a = this._m.get(evt);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  emit(evt, a, b, c) {
    const l = this._m.get(evt);
    if (!l) return;
    for (let i = 0; i < l.length; i++) {
      try { l[i](a, b, c); } catch (e) { console.error('[Stage] listener "' + evt + '" threw', e); }
    }
  }
  clear() { this._m.clear(); }
}

/* =========================================================================
 * small pure helpers
 * ========================================================================= */
function fin(n) { return typeof n === 'number' && Number.isFinite(n); }

/* NOTE: deliberately NOT `fin(+a[0])` — unary + coerces null/''/[] to 0, which
 * would let an authoring typo through as a silent (0,0,0). Require real numbers. */
function fin3(a) {
  return Array.isArray(a) && a.length >= 3 && fin(a[0]) && fin(a[1]) && fin(a[2]);
}

function v3(a, dx, dy, dz) {
  if (Array.isArray(a) && a.length >= 3) return new THREE.Vector3(+a[0], +a[1], +a[2]);
  if (a && typeof a === 'object' && fin(a.x)) return new THREE.Vector3(a.x, a.y, a.z);
  return new THREE.Vector3(dx || 0, dy || 0, dz || 0);
}

/** rot may be authored in radians or degrees; >2π on any axis means degrees. */
function applyRot(obj, rot) {
  if (!Array.isArray(rot) || rot.length < 3) return;
  const x = +rot[0] || 0, y = +rot[1] || 0, z = +rot[2] || 0;
  const deg = Math.abs(x) > 6.4 || Math.abs(y) > 6.4 || Math.abs(z) > 6.4;
  const k = deg ? Math.PI / 180 : 1;
  obj.rotation.set(x * k, y * k, z * k);
}

function colorOf(v, fallback) {
  try {
    if (v === undefined || v === null) return new THREE.Color(fallback);
    return new THREE.Color(v);
  } catch (e) { return new THREE.Color(fallback); }
}

/** chamfered box (never a naked BoxGeometry) */
function chamferBox(w, h, d, b) {
  const bev = Math.max(0.004, Math.min(b, w * 0.34, h * 0.34, d * 0.34));
  const sw = Math.max(0.002, w - 2 * bev);
  const sh = Math.max(0.002, h - 2 * bev);
  const shape = new THREE.Shape();
  shape.moveTo(-sw / 2, -sh / 2);
  shape.lineTo(sw / 2, -sh / 2);
  shape.lineTo(sw / 2, sh / 2);
  shape.lineTo(-sw / 2, sh / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, d - 2 * bev),
    bevelEnabled: true, bevelSize: bev, bevelThickness: bev,
    bevelSegments: 2, curveSegments: 1, steps: 1,
  });
  g.center();
  g.computeVertexNormals();
  return g;
}

/** chamfered disc via lathe — the checkpoint pad base */
function chamferDisc(r, h, b, seg) {
  const bev = Math.max(0.004, Math.min(b, r * 0.4, h * 0.45));
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r - bev, 0),
    new THREE.Vector2(r, bev),
    new THREE.Vector2(r, h - bev),
    new THREE.Vector2(r - bev, h),
    new THREE.Vector2(Math.max(0.001, r * 0.34), h),
    new THREE.Vector2(0, h * 0.86),
  ];
  const g = new THREE.LatheGeometry(pts, seg || 40);
  g.computeVertexNormals();
  return g;
}

/* =========================================================================
 * SHADERS — checkpoint / coin / finish FX
 * ========================================================================= */

const GLSL_NOISE = `
float sh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh21(i), sh21(i + vec2(1.0, 0.0)), f.x),
             mix(sh21(i + vec2(0.0, 1.0)), sh21(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

/** Volumetric light column. Density = chord length through the cylinder, so it
 *  is bright through the middle and falls off softly to nothing at the edges. */
function beamVertexSrc(instanced) {
  return `
${instanced ? 'attribute float aState;\nattribute float aPulse;\nattribute float aSeed;'
            : 'uniform float aState;\nuniform float aPulse;\nuniform float aSeed;'}
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vSeed;
varying float vCore;
varying float vDepth;
varying float vAxisD;
void main(){
  vUv = uv; vState = aState; vSeed = aSeed;
  vec3 p = position;
  float grow = mix(0.60, 1.0, aState) + aPulse * 0.24;
  p.x *= grow; p.z *= grow;
  p.y *= mix(0.52, 1.0, aState);
  vec4 mv = modelViewMatrix * ${instanced ? 'instanceMatrix * ' : ''}vec4(p, 1.0);
  vDepth = -mv.z;
  // horizontal camera-to-column-axis distance, for the whole-column near fade
  vec4 wo = modelMatrix * ${instanced ? 'instanceMatrix * ' : ''}vec4(0.0, 0.0, 0.0, 1.0);
  vAxisD = length(wo.xz - cameraPosition.xz);
  vec3 radial = normalize(vec3(position.x, 0.0, position.z) + vec3(1e-5, 0.0, 1e-5));
  vec3 nrm = normalize(normalMatrix * radial);
  vec3 vdir = normalize(-mv.xyz);
  float axial = abs(dot(nrm, vdir));
  vCore = pow(axial, 1.35) + 0.10 * pow(1.0 - axial, 3.0);
  gl_Position = projectionMatrix * mv;
}`;
}

const BEAM_FRAG = `
uniform vec3  uColorOff;
uniform vec3  uColorOn;
uniform float uTime;
uniform float uGain;
varying vec2  vUv;
varying float vState;
varying float vSeed;
varying float vCore;
varying float vDepth;
varying float vAxisD;
void main(){
  float h = clamp(vUv.y, 0.0, 1.0);
  float fall = pow(1.0 - h, 1.65);
  float cap  = smoothstep(1.0, 0.52, h);
  float band = 0.5 + 0.5 * sin(h * 21.0 - uTime * (1.05 + 2.6 * vState) + vSeed * 6.2831);
  float a = fall * cap * vCore * (0.70 + 0.30 * band);
  a *= mix(0.26, 1.0, vState) * uGain;
  a *= mix(1.0, 0.58, smoothstep(70.0, 250.0, vDepth));
  // Near fade: standing ON a pad puts the camera INSIDE this cylinder, and
  // without it the beam's near wall painted the entire frame with an additive
  // wash (measured 2026-08-31: hiding the column dropped foundry-1's mean frame
  // luma from 197 to 117 at a checkpoint station). Beyond ~3.5 m it is a no-op.
  a *= smoothstep(0.35, 3.5, vDepth);
  // ...but the fragment fade alone was not enough: the column is 9.2 m tall,
  // and its UPPER half sits 4-9 m from a camera standing on the pad — far
  // enough to pass the vDepth fade, close enough to arc a tinted dome across
  // the whole upper frame (round-2 toggle probe, 2026-08-31: hiding the cp
  // group turned foundry's green sky back to smoke). Fade the WHOLE column
  // once the camera is within ~3.2 m of its axis; from across the stage the
  // beacon is untouched.
  a *= smoothstep(1.5, 3.2, vAxisD);
  if (a <= 0.0025) discard;
  vec3 col = mix(uColorOff, uColorOn, vState);
  col *= 0.85 + 1.15 * vState + 0.30 * band;
  gl_FragColor = vec4(col, a);
}`;

const RING_VERT = `
attribute float aState;
attribute float aPulse;
attribute float aSeed;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vSeed;
varying float vDepth;
void main(){
  vUv = uv; vState = aState; vPulse = aPulse; vSeed = aSeed;
  vec3 p = position;
  float s = 1.0 + aPulse * 0.42 + aState * 0.05;
  p.x *= s; p.z *= s;
  p.y *= 1.0 + aPulse * 0.55;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = `
uniform vec3  uColorOff;
uniform vec3  uColorOn;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vSeed;
varying float vDepth;
void main(){
  float dash = 0.5 + 0.5 * sin(vUv.x * 84.0 - uTime * (0.75 + 2.4 * vState) + vSeed * 6.2831);
  float tube = 0.55 + 0.45 * sin(vUv.y * 6.2831);
  float a = (0.34 + 0.66 * vState) * mix(0.48, 1.0, dash) * (0.7 + 0.3 * tube);
  a *= mix(1.0, 0.65, smoothstep(80.0, 260.0, vDepth));
  vec3 col = mix(uColorOff, uColorOn, vState);
  // 1.0+1.5+1.1+0.4 drove the armed ring to ~4x — THE white-hot rim of the
  // round-2 critic. Held to ~2x peak: still clears every bloom threshold for
  // a halo, but the ring keeps its hue instead of clipping to white.
  col *= 0.90 + 0.85 * vState + 0.80 * vPulse + 0.28 * dash;
  gl_FragColor = vec4(col, a);
}`;

/** Activation shockwave: born small+bright, expands outward as it fades. */
const WAVE_VERT = `
attribute float aPulse;
attribute float aState;
varying float vPulse;
void main(){
  vPulse = aPulse;
  float grow = 1.0 + (1.0 - aPulse) * 5.4;
  vec3 p = position;
  p.x *= grow; p.z *= grow;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`;

const WAVE_FRAG = `
uniform vec3 uColorOn;
varying float vPulse;
void main(){
  float a = pow(clamp(vPulse, 0.0, 1.0), 1.35) * 0.9;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColorOn * (1.4 + 1.6 * vPulse), a);
}`;

const GLYPH_VERT = `
attribute float aState;
attribute float aPulse;
attribute float aAngle;
attribute float aSeed;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vAxisD;
void main(){
  vUv = uv; vState = aState; vPulse = aPulse;
  float c = cos(aAngle), s = sin(aAngle);
  vec3 p = position;
  vec3 r = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  r *= mix(0.74, 1.0, aState);
  r.y += 0.34 + 0.30 * aState + 0.075 * sin(uTime * 1.5 + aSeed * 6.2831);
  vec4 wo = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vAxisD = length(wo.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(r, 1.0);
}`;

const GLYPH_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColorOff;
uniform vec3 uColorOn;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vAxisD;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * (0.30 + 0.85 * vState) * (1.0 + 0.9 * vPulse);
  // The glyph floats 0.4-0.7 m under a standing player's eye: at full gain it
  // was the floor-filling colour wash in every station shot (round-2 toggle
  // probe, 2026-08-31 — hiding the cp group flipped spire's pad region from
  // rgb(74,147,137) back to the deck's true rgb(46,67,91)). Fade it away as
  // the camera closes in; from approach range it still reads as the marker.
  a *= smoothstep(1.3, 2.8, vAxisD);
  if (a <= 0.004) discard;
  // 0.85+1.5+1.0 pushed the armed glyph to ~2.9x — past every theme's bloom
  // threshold, so it read white-hot, not its colour. Controlled emissive:
  vec3 col = mix(uColorOff, uColorOn, vState) * (0.80 + 0.90 * vState + 0.75 * vPulse);
  gl_FragColor = vec4(col, a);
}`;

/** Coin core — faceted gem, keyed off the theme key light, rim + emissive pulse. */
const COIN_CORE_VERT = `
attribute float aState;
attribute float aPop;
attribute float aSeed;
uniform float uTime;
varying vec3  vN;
varying vec3  vV;
varying float vSeed;
void main(){
  vSeed = aSeed;
  float sc = aState * (1.0 + aPop * 0.85);
  vec3 p = position * sc;
  float ang = uTime * 1.65 + aSeed * 6.2831;
  float c = cos(ang), s = sin(ang);
  vec3 rp = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 rn = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(rp, 1.0);
  vN = normalize(normalMatrix * rn);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const COIN_CORE_FRAG = `
uniform vec3  uColor;
uniform vec3  uHot;
uniform vec3  uKey;
uniform float uTime;
varying vec3  vN;
varying vec3  vV;
varying float vSeed;
void main(){
  vec3 n = normalize(vN);
  float k  = max(dot(n, normalize(uKey)), 0.0);
  float fl = max(dot(n, normalize(vec3(-0.4, 0.7, -0.5))), 0.0);
  float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.3);
  float pulse = 0.72 + 0.28 * sin(uTime * 3.1 + vSeed * 6.2831);
  vec3 col = uColor * (0.22 + 0.70 * k + 0.20 * fl) + uHot * (rim * 1.30 + 0.40 * pulse);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Coin shell + halo + shaft: one additive shader, mode switched by uniform. */
const COIN_FX_VERT = `
attribute float aState;
attribute float aPop;
attribute float aSeed;
uniform float uTime;
uniform float uGhost;   // 1 => shrink-and-dim when collected instead of vanishing
uniform float uSpin;
varying vec2  vUv;
varying vec3  vN;
varying vec3  vV;
varying float vState;
varying float vPop;
varying float vSeed;
void main(){
  vUv = uv; vState = aState; vPop = aPop; vSeed = aSeed;
  float sc = mix(aState, mix(0.40, 1.0, aState), uGhost) * (1.0 + aPop * 1.1);
  float ang = uTime * uSpin + aSeed * 6.2831;
  float c = cos(ang), s = sin(ang);
  vec3 p = position * sc;
  vec3 rp = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 rn = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(rp, 1.0);
  vN = normalize(normalMatrix * rn);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const COIN_FX_FRAG = `
uniform vec3  uColor;
uniform float uTime;
uniform float uMode;    // 0 shell(fresnel)  1 halo(dash)  2 shaft(vertical falloff)
uniform float uGain;
varying vec2  vUv;
varying vec3  vN;
varying vec3  vV;
varying float vState;
varying float vPop;
varying float vSeed;
void main(){
  float a;
  if (uMode < 0.5) {
    float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.6);
    a = fres * 0.9;
  } else if (uMode < 1.5) {
    float dash = 0.5 + 0.5 * sin(vUv.x * 52.0 - uTime * 2.1 + vSeed * 6.2831);
    a = mix(0.30, 1.0, dash) * 0.85;
  } else {
    a = pow(1.0 - clamp(vUv.y, 0.0, 1.0), 2.0) * 0.55;
  }
  a *= uGain * mix(0.16, 1.0, vState) * (1.0 + 2.2 * vPop);
  if (a <= 0.0035) discard;
  gl_FragColor = vec4(uColor * (1.0 + 1.6 * vPop), a);
}`;

/** Finish portal surface — arch-masked swirling vortex plate. */
const PORTAL_VERT = `
varying vec2 vP;
void main(){
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PORTAL_FRAG = `
uniform float uTime;
uniform float uPower;
uniform float uR;
uniform float uArchY;
uniform vec3  uColA;
uniform vec3  uColB;
varying vec2  vP;
${GLSL_NOISE}
void main(){
  float mask;
  if (vP.y < uArchY) mask = 1.0 - smoothstep(uR - 0.16, uR, abs(vP.x));
  else               mask = 1.0 - smoothstep(uR - 0.16, uR, length(vec2(vP.x, vP.y - uArchY)));
  mask *= smoothstep(-0.02, 0.30, vP.y);
  if (mask <= 0.004) discard;

  vec2 c = vec2(vP.x, vP.y - uArchY * 0.62) / uR;
  float r = clamp(length(c), 0.0, 1.4);
  float ang = atan(c.y, c.x);
  float swirl = ang + (1.0 - r) * 3.5 - uTime * (0.65 + 0.9 * uPower);
  float n1 = vnoise(vec2(swirl * 1.7, r * 5.0 - uTime * 0.85));
  float n2 = vnoise(vec2(swirl * 3.3 + 7.0, r * 9.5 + uTime * 1.5));
  float band = 0.5 + 0.5 * sin(swirl * 3.0 + n1 * 4.2);
  float core = pow(clamp(1.0 - r, 0.0, 1.0), 1.7);
  float edge = smoothstep(1.05, 0.84, r) * (0.32 + 0.68 * band);
  float a = clamp(core * 1.1 + edge * 0.55 + n2 * 0.24 * (1.0 - r), 0.0, 1.0);
  vec3 col = mix(uColB, uColA, clamp(core + band * 0.35, 0.0, 1.0));
  col *= 0.85 + 1.6 * uPower + 0.55 * n1;
  gl_FragColor = vec4(col, a * mask * (0.52 + 0.48 * uPower));
}`;

/** Particle vortex — every particle's position is a pure function of uTime. */
const VORTEX_VERT = `
attribute float aAngle;
attribute float aRadius;
attribute float aSpeed;
attribute float aSeed;
attribute float aSize;
attribute float aDepth;
uniform float uTime;
uniform float uPower;
uniform float uDpr;
uniform float uArchY;
varying float vA;
void main(){
  float t = fract(uTime * aSpeed * (0.55 + 0.75 * uPower) + aSeed);
  float r = aRadius * (1.0 - t) + 0.05;
  float ang = aAngle + t * (7.5 + 5.0 * uPower);
  vec3 p = vec3(cos(ang) * r, uArchY * 0.62 + sin(ang) * r, aDepth * (1.0 - t) * 0.6);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float fade = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.70, 1.0, t));
  vA = fade * (0.45 + 0.85 * uPower);
  gl_PointSize = aSize * uDpr * (150.0 / max(-mv.z, 1.0)) * (0.65 + 0.6 * uPower);
  gl_Position = projectionMatrix * mv;
}`;

const VORTEX_FRAG = `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.04, d) * vA;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor * (1.0 + 0.8 * a), a);
}`;

/* =========================================================================
 * STAGE
 * ========================================================================= */
export class Stage {
  /**
   * @param {object} def  stage data (runtime/data/stages/*.js)
   * @param {object} engine  Engine instance (renderer/scene/camera)
   * @param {object} ctx  {mats, fx, audio, save}
   */
  constructor(def, engine, ctx) {
    this.def = def;
    this.engine = engine || null;
    this.ctx = ctx || {};

    this.mats  = this.ctx.mats  || Mats  || null;
    this.fx    = this.ctx.fx    || null;
    this.audio = this.ctx.audio || null;
    this.save  = this.ctx.save  || null;

    this.id = def && def.id ? def.id : 'unknown';
    this.themeId = (def && (def.theme || def.world)) || 'neon';
    this.theme = null;
    this.palette = null;

    this.group = new THREE.Group();
    this.group.name = 'stage:' + this.id;
    this.group.matrixAutoUpdate = false;

    this.broadphase = null;
    this.killVolumes = [];
    this.hazards = [];
    this.checkpoints = [];
    this.coins = [];
    this.finish = null;
    this.lights = [];
    this.texts = [];

    this.clock = 0;
    this.cpIndex = -1;
    this.bounds = new THREE.Box3();
    this.killY = fin(def && def.killY) ? def.killY : -45;

    /**
     * checkpoint(i, cp) / coin(i, c) / finish(f) — the ONLY way a checkpoint,
     * an orb or the gate leaves this module. Stage detects and animates; Game
     * subscribes and owns save, HUD, audio, particles and progression. There is
     * deliberately no flag that lets Stage do those itself: one owner, always.
     */
    this.events = new Emitter();
    /** Convenience bundle for Player/collide (`world` argument). */
    this.world = { broadphase: null, killVolumes: this.killVolumes, stage: this };

    // internals
    this._built = false;
    this._disposed = false;
    this._chunks = [];
    this._chunkMap = new Map();
    this._allColliders = [];
    this._staticColliders = [];
    this._ownedGeo = new Set();
    this._ownedMat = new Set();
    this._ownedTex = new Set();
    this._mergeSources = new Set();
    this._matCache = new Map();
    this._propCache = new Map();
    this._loader = null;
    this._rng = mulberry32(hashId(this.id));
    this._pp = new THREE.Vector3();
    this._ppValid = false;
    this._playerRef = null;
    this._standOn = null;   // the collider the player last stood on — see _detectStand()
    this._lightTimer = 0;
    this._lightIdx = [];
    this._maxLights = 3;
    /** the ONLY THREE.PointLights this stage ever owns — see LIGHT_POOL_SIZE */
    this._lightPool = [];
    this._lightFirst = true;
    /** authored + hazard-registered glow proxies, merged by _buildGlowField */
    this._glowSites = [];
    this._glowField = null;
    this._cullFar = 240;
    this._detailFar = 90;
    this._cullTimer = 0;
    this._cpDirty = true;
    this._coinDirty = true;
    this._debugOn = false;
    this._debugGroup = null;
    this._settingsCb = null;
    this._warnedBuilders = false;
    this._warnedCameraFallback = false;
    this._progPts = [];
    this._progCum = [];
    this._progSeg = [];
    this._progTotal = 0;
    this._time = 0;      // wall-ish visual time (drives FX shaders)
  }

  /* ───────────────────────────────────────────── static load / validate ── */

  /**
   * Build a complete, playable stage. Awaits GLB prop loading.
   * @returns {Promise<Stage>}
   */
  static async load(def, engine, ctx) {
    Stage.validate(def);
    const stage = new Stage(def, engine, ctx);
    await stage._build();
    return stage;
  }

  /**
   * Authoring validator. Throws with the offending object index AND kind so a
   * data mistake is diagnosable in one read. Returns {ok, warnings[]}.
   */
  static validate(def) {
    const warnings = [];
    const sid = (def && def.id) || '<no id>';
    const fail = (msg) => { throw new Error('[Stage.validate ' + sid + '] ' + msg); };
    const failObj = (i, kind, msg) =>
      fail('objects[' + i + '] (kind "' + kind + '"): ' + msg);

    if (!def || typeof def !== 'object') fail('stage definition is not an object');
    if (typeof def.id !== 'string' || !def.id) fail('missing required field "id" (string)');
    if (typeof def.world !== 'string' || !def.world) fail('missing required field "world" (string)');
    if (!def.spawn || !fin3(def.spawn.p)) fail('missing/!finite "spawn.p" — expected [x,y,z]');
    /* THE HUB HAS NO FINISH. `isHub: true` is the ONLY licence to omit one: there is
       nothing to clear in the sanctum, so a finish trigger there would be a lie. Every
       other stage must carry one — a stage you cannot complete is a dead end. */
    const isHub = def.isHub === true;
    if (isHub) {
      if (def.finish !== null && def.finish !== undefined && !fin3(def.finish.p))
        fail('"isHub" stage declared a "finish" but its "finish.p" is missing/!finite — use finish: null');
    } else if (!def.finish || !fin3(def.finish.p)) {
      fail('missing/!finite "finish.p" — expected [x,y,z] (only an "isHub: true" stage may omit it)');
    }
    const hasFinish = !!(def.finish && fin3(def.finish.p));
    if (!fin(def.killY)) fail('missing/!finite "killY" (number)');
    if (!Array.isArray(def.objects)) fail('missing required field "objects" (array)');
    /* `par: null` reads as "this stage has no par", which is the truth in the hub
       (nothing to race) and is how hub.js writes it. Only a par that is present
       and nonsense is an error. A missing par on a real stage is a warning, so an
       author notices without the stage refusing to load. */
    if (def.par !== undefined && def.par !== null && (!fin(def.par) || def.par <= 0))
      fail('"par" must be a positive number of ms, or null for a stage with no par');
    if (!isHub && (def.par === undefined || def.par === null))
      warnings.push('no "par" set — the HUD will show no target time for this stage');

    /* checkpoints ordered along the run */
    const cps = Array.isArray(def.checkpoints) ? def.checkpoints : [];
    let prev = { x: def.spawn.p[0], y: def.spawn.p[1] };
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (!cp || !fin3(cp.p)) fail('checkpoints[' + i + '].p missing or not finite [x,y,z]');
      if (cp.clockOffset !== undefined && (!fin(cp.clockOffset) || cp.clockOffset < 0))
        fail('checkpoints[' + i + '].clockOffset must be a finite number >= 0');
      if (cp.yaw !== undefined && !fin(cp.yaw)) fail('checkpoints[' + i + '].yaw is not finite');
      const x = cp.p[0], y = cp.p[1];
      // stages run along +X; a vertical climb is allowed to hold X steady.
      if (x < prev.x - 2.0 && y <= prev.y + 1.0)
        fail('checkpoints out of order: checkpoints[' + i + '] is at x=' + x.toFixed(2) +
             ', behind the previous point at x=' + prev.x.toFixed(2) +
             ' (stages must progress along +X)');
      prev = { x, y };
    }

    /* finish must be reachable forward in X (or upward on a vertical finale) */
    if (hasFinish) {
      const fx = def.finish.p[0], fy = def.finish.p[1];
      if (fx < prev.x - 2.0 && fy <= prev.y + 1.0)
        fail('finish unreachable in X: finish.p.x=' + fx.toFixed(2) +
             ' is behind the last checkpoint/spawn at x=' + prev.x.toFixed(2));
    }

    /* coins */
    if (def.coins !== undefined) {
      if (!Array.isArray(def.coins)) fail('"coins" must be an array');
      for (let i = 0; i < def.coins.length; i++) {
        if (!def.coins[i] || !fin3(def.coins[i].p))
          fail('coins[' + i + '].p missing or not finite [x,y,z]');
      }
    }

    /* objects */
    let lowest = Infinity;
    let supportNearFinish = false;
    for (let i = 0; i < def.objects.length; i++) {
      const o = def.objects[i];
      if (!o || typeof o !== 'object') fail('objects[' + i + '] is not an object');
      const k = o.kind;
      if (typeof k !== 'string' || !k) fail('objects[' + i + '] missing required field "kind"');
      if (!routeOf(k))
        failObj(i, k, 'unknown kind — hazards/index.js KIND_ROUTE has no builder or hazard for it');

      /* NaN sweep over every vector-ish field */
      const vecFields = ['p', 's', 'rot', 'to', 'a', 'b', 'dir', 'axis', 'blade'];
      for (let f = 0; f < vecFields.length; f++) {
        const name = vecFields[f];
        const val = o[name];
        if (val === undefined || val === null) continue;
        if (Array.isArray(val)) {
          for (let c = 0; c < val.length; c++) {
            if (!fin(val[c]))
              failObj(i, k, 'field "' + name + '[' + c + ']" is not a finite number (got ' +
                            (typeof val[c]) + ' ' + String(val[c]) + ')');
          }
        }
      }
      if (o.motion && o.motion.to !== undefined && !fin3(o.motion.to))
        failObj(i, k, 'motion.to must be a finite [x,y,z]');

      /* HAZARD KINDS: one contract, owned by hazards/index.js.
         This validator used to keep its own per-kind field list, and it drifted
         from the one makeHazard enforces: hazcheck's contract section measured
         29 defs on which the two disagreed. The dangerous direction is "this
         accepts, makeHazard rejects" — Stage.load passes, the factory throws in
         _buildHazard, the throw is logged and the hazard is DROPPED, and the
         stage ships with a hole (four pendulums authored with `ampDeg` were
         missing from spire-1, foundry-3 and temple-2 while every gate was green).
         Delegating makes the verdicts identical by construction, and turns a
         silent drop into a load-time error that names the object. */
      if (isHazardKind(k) && typeof HazardLib.validateHazardDef === 'function') {
        try {
          HazardLib.validateHazardDef(o, { stageId: sid, objectIndex: i });
        } catch (e) {
          failObj(i, k, (e && e.message) ? e.message : String(e));
        }
      }

      /* BUILDER KINDS: positions the builders read directly. Hazard kinds have
         theirs checked by the contract above (beam kinds author endpoints a/b,
         a chase authors from/to — neither carries a `p`). */
      if (isBuilderKind(k) && o.p !== undefined && !fin3(o.p))
        failObj(i, k, '"p" must be a finite [x,y,z]');
      if (isBuilderKind(k) && o.p === undefined)
        failObj(i, k, 'missing required field "p"');
      if (k === 'text' && (typeof o.text !== 'string' || !o.text.length))
        failObj(i, k, '"text" must be a non-empty string');
      if (k === 'light' && o.intensity !== undefined && (!fin(o.intensity) || o.intensity < 0))
        failObj(i, k, '"intensity" must be a finite number >= 0, got ' + String(o.intensity));

      /* soft signals */
      if (fin3(o.p)) {
        const half = Array.isArray(o.s) ? (+o.s[1] || 0) * 0.5 : 0;
        lowest = Math.min(lowest, o.p[1] - half);
        if (hasFinish) {
          const dx = o.p[0] - def.finish.p[0], dz = o.p[2] - def.finish.p[2];
          if (dx * dx + dz * dz < 144) supportNearFinish = true;
        }
      }
    }

    /* A respawn pad swept by a SOLID rotor bar. geomcheck's static sweep exempts
       bar rotors on purpose (they push, they do not kill) — but a push off a deck
       into lava is a death all the same. hazcheck's live respawn walk measured
       foundry-3 cp4 (pad 176.6,18.4 under a 2-arm bar of len 3.0 at the same
       point): 2 of 4 respawns shoved 3.6 m off the deck edge into the pool
       within 1.4 s. Nothing at runtime can make such a pad safe; the data must
       move the pad or the rotor, so this names it at validate time. */
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (!cp || !fin3(cp.p)) continue;
      for (let j = 0; j < def.objects.length; j++) {
        const o = def.objects[j];
        if (!o || o.kind !== 'rotor' || !fin3(o.p) || o.kill) continue;
        if ((o.style || 'bar') !== 'bar') continue;              // saws/blades are lethal: geomcheck's sweep owns them
        const reach = (fin(o.len) ? o.len : 6) + 0.8;            // arm length + the player's radius
        const dx = cp.p[0] - o.p[0], dz = cp.p[2] - o.p[2], dy = cp.p[1] - o.p[1];
        if (dx * dx + dz * dz <= reach * reach && dy > -2.2 && dy < 1.2)
          warnings.push('checkpoints[' + i + '] at ' + cp.p.join(',') + ' is inside the sweep of the solid rotor bar ' +
                        'objects[' + j + '] (len ' + (fin(o.len) ? o.len : 6) + ') — a respawn there can be pushed off the deck');
      }
    }

    if (def.objects.length && Number.isFinite(lowest) && def.killY > lowest - 1.5)
      warnings.push('killY (' + def.killY + ') sits at or above the lowest geometry (' +
                    lowest.toFixed(2) + ') — players may die standing on real ground');
    if (hasFinish && def.objects.length && !supportNearFinish)
      warnings.push('no object within 12 m of the finish — the goal may be unreachable');
    if (cps.length === 0)
      warnings.push('stage has no checkpoints — every death restarts the whole run');
    if (def.objects.length > 400)
      warnings.push(def.objects.length + ' objects: expect merge cost at load, verify draw calls');

    return { ok: true, warnings };
  }

  /* ────────────────────────────────────────────────────────────── build ── */

  _assertDeps() {
    const missing = [];
    if (typeof Collider !== 'function') missing.push('Collider (world/collider.js)');
    if (typeof Broadphase !== 'function') missing.push('Broadphase (world/collider.js)');
    if (typeof KillVol !== 'function') missing.push('KillVolume (world/collider.js)');
    if (typeof mergeGeometries !== 'function') missing.push('mergeGeometries (addons/utils/BufferGeometryUtils.js)');
    if (typeof clamp !== 'function' || typeof mulberry32 !== 'function') missing.push('clamp/mulberry32 (core/util.js)');
    if (typeof HazardLib.routeOf !== 'function' && !HazardLib.KIND_ROUTE)
      missing.push('KIND_ROUTE / routeOf (hazards/index.js) — nothing can be routed without it');
    if (missing.length) {
      throw new Error('[Stage ' + this.id + '] required exports unavailable: ' + missing.join(', '));
    }
  }

  async _build() {
    this._assertDeps();

    const report = Stage.validate(this.def);
    for (let i = 0; i < report.warnings.length; i++) {
      console.warn('[Stage ' + this.id + '] ' + report.warnings[i]);
    }

    this._resolveTheme();
    this._applyQuality();

    this._chunkSize = this._computeChunkSize();
    this.broadphase = new Broadphase(6);
    this.world.broadphase = this.broadphase;

    if (this.engine && this.engine.scene) this.engine.scene.add(this.group);

    /* 1. hazards first (they keep their own meshes; nothing merges them) */
    const objects = Array.isArray(this.def.objects) ? this.def.objects : [];
    const pending = [];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (!o || typeof o.kind !== 'string') continue;
      if (isHazardKind(o.kind)) {
        const p = this._buildHazard(o, i);
        if (p) pending.push(p);
      }
    }

    /* 2. static art */
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (!o || typeof o.kind !== 'string') continue;
      if (!isBuilderKind(o.kind)) continue;
      const p = this._buildStatic(o, i);
      if (p) pending.push(p);
    }

    /* 3. props / hazard factories that returned promises */
    if (pending.length) await Promise.all(pending);

    /* 4. the interactive furniture */
    this._buildCheckpoints();
    this._buildFinish();
    this._buildCoins();
    this._buildProgressPath();

    /* 5. bounds, void kill volume, merge + chunk */
    this._computeBounds();
    this._buildVoidVolume();
    /* The pool and the glow field are allocated BEFORE the first render and
     * never touched again — see the LIGHT_POOL_SIZE note. The glow field needs
     * the colliders, so it has to come after every builder and hazard. */
    this._buildLightPool();
    this._buildGlowField();
    this._mergeStatic();
    this._disposeMergeSources();

    /* 6. place everything at t = 0 */
    this.clock = 0;
    this._time = 0;
    for (let i = 0; i < this.hazards.length; i++) {
      const rec = this.hazards[i];
      try { rec.h.reset(0); } catch (e) { /* reset optional-safe */ }
      try { rec.h.update(0, 0); } catch (e) { this._hazardError(rec, e); }
      this._measureHazard(rec);
    }
    this._refreshHazardColliders();
    this._syncCheckpointAttrs(true);
    this._syncCoinAttrs(true);

    /* 7. react to quality changes */
    if (Settings && typeof Settings.on === 'function') {
      this._settingsCb = () => { this._applyQuality(); };
      Settings.on(this._settingsCb);
    }

    this._built = true;
    return this;
  }

  _resolveTheme() {
    const base = (THEMES && (THEMES[this.themeId] || THEMES[this.def.world])) || null;
    let theme = base;
    if (this.def.ambience && base) {
      theme = Object.assign({}, base);
      const amb = this.def.ambience;
      for (const k in amb) {
        if (!Object.prototype.hasOwnProperty.call(amb, k)) continue;
        const cur = theme[k];
        const inc = amb[k];
        if (cur && inc && typeof cur === 'object' && typeof inc === 'object' &&
            !Array.isArray(cur) && !Array.isArray(inc)) {
          theme[k] = Object.assign({}, cur, inc);
        } else {
          theme[k] = inc;
        }
      }
    }
    if (!theme) {
      console.warn('[Stage ' + this.id + '] theme "' + this.themeId + '" not found in THEMES — using neutral fallback');
      theme = {
        id: this.themeId, name: this.themeId,
        palette: {}, fog: { near: 20, far: 240 }, lights: {},
      };
    }
    this.theme = theme;
    const pal = theme.palette || {};
    this.palette = {
      safe:         colorOf(pal.safe, 0xb9c7d6),
      safeEdge:     colorOf(pal.safeEdge, 0x8ef0ff),
      kill:         colorOf(pal.kill, 0xff3a1f),
      killGlow:     colorOf(pal.killGlow, 0xff7a3a),
      checkpoint:   colorOf(pal.checkpoint, 0x2f5f8a),
      checkpointOn: colorOf(pal.checkpointOn, 0x62f5c8),
      finish:       colorOf(pal.finish, 0xffd166),
      accent:       colorOf(pal.accent, 0x5ec8ff),
      deco:         colorOf(pal.deco, 0x6d7f96),
    };
    /* key light direction, used by the coin gem shader */
    const key = theme.lights && theme.lights.key;
    this._keyDir = v3(key && key.dir, -0.45, 0.82, 0.36).normalize();
  }

  _quality() {
    let q = null;
    try {
      if (Settings && typeof Settings.quality === 'function') q = Settings.quality();
    } catch (e) { q = null; }
    if (!q || typeof q !== 'object' || !fin(q.decor)) {
      let name = 'high';
      try {
        if (Settings && typeof Settings.get === 'function') {
          const s = Settings.get();
          if (s && typeof s.quality === 'string') name = s.quality;
        }
      } catch (e) { /* defaults */ }
      q = (QUALITY && (QUALITY[name] || QUALITY.high)) || null;
    }
    if (!q) q = { dpr: 1.5, shadowMap: 2048, bloom: true, smaa: true, ssao: false, particles: 1, decor: 1, shadowDistance: 60 };
    return q;
  }

  _applyQuality() {
    const q = this._quality();
    this.quality = q;
    const decor = fin(q.decor) ? clamp(q.decor, 0, 1) : 1;
    this._decor = decor;
    /* The preset owns this number (settings.js QUALITY[*].maxLights); the pool
     * is the hard ceiling, because slots cannot be allocated after the first
     * render. Raising quality mid-run therefore lights more of the pool, it
     * never grows it. */
    const wantLights = fin(q.maxLights) ? q.maxLights : (decor >= 0.6 ? 3 : 2);
    this._maxLights = Math.max(1, Math.min(LIGHT_POOL_SIZE, Math.round(wantLights)));
    const fogFar = (this.theme && this.theme.fog && fin(this.theme.fog.far)) ? this.theme.fog.far : 220;
    this._cullFar = Math.max(150, fogFar * (0.9 + 0.5 * decor));
    this._detailFar = Math.max(52, 96 * (0.55 + 0.55 * decor));
    // force one culling re-evaluation with the new distances
    this._cullTimer = 0;
  }

  /* ── static object dispatch ─────────────────────────────────────────── */

  /**
   * Only kinds KIND_ROUTE marks 'builder' arrive here.
   *
   * `ice` is deliberately NOT one of them: hazards/surfaces.js IceHazard owns it
   * (frosted rim, sparkle field, step_ice footstep voice and the slippery
   * collider), and the flat static slab this switch used to build was a strictly
   * worse duplicate of it. A platform that merely wants ice PHYSICS still says
   * {kind:'platform', surface:'ice'} and is built here.
   */
  _buildStatic(o, index) {
    switch (o.kind) {
      case 'platform': return this._buildSurface(o, index, o.mat || 'stone', o.surface || 'normal');
      case 'beam':     return this._buildBeam(o, index);
      case 'deco':     return this._buildDeco(o, index);
      case 'text':     return this._buildText(o, index);
      case 'light':    return this._buildLight(o, index);
      default:         return null;
    }
  }

  _buildSurface(o, index, mat, surface) {
    const bdef = Object.assign({}, o, { mat, surface });
    let built = null;
    if (typeof Builders.buildPlatform === 'function') {
      try { built = Builders.buildPlatform(bdef, this.theme, this.mats); }
      catch (e) { console.error('[Stage ' + this.id + '] buildPlatform failed on objects[' + index + ']', e); built = null; }
    } else if (!this._warnedBuilders) {
      this._warnedBuilders = true;
      console.warn('[Stage ' + this.id + '] builders.buildPlatform unavailable — using the stage-local fallback platform');
    }
    if (!built || !built.mesh) built = this._fallbackPlatform(bdef);
    this._placeBuilt(built, bdef, index, false);
    return null;
  }

  _buildBeam(o, index) {
    const bdef = Object.assign({}, o, { mat: o.mat || 'metal' });
    let built = null;
    if (typeof Builders.buildBeam === 'function') {
      try { built = Builders.buildBeam(bdef, this.theme, this.mats); }
      catch (e) { console.error('[Stage ' + this.id + '] buildBeam failed on objects[' + index + ']', e); built = null; }
    }
    if (!built || !built.mesh) built = this._fallbackPlatform(bdef);
    this._placeBuilt(built, bdef, index, false);
    return null;
  }

  /**
   * Common tail for a builder result: position, collect colliders, chunk it.
   *
   * A builder may return art already placed at `p` (baked into the geometry or
   * into mesh.position) or art built around the origin. Double-offsetting a
   * whole stage is the worst possible failure, so decide by geometry: if the
   * built bounds sit nearer to `p` than to the origin, it is already placed.
   */
  _placeBuilt(built, bdef, index, detail) {
    const mesh = built.mesh;
    const p = v3(bdef.p, 0, 0, 0);
    if (mesh) {
      let baked = mesh.position.lengthSq() > 1e-9;
      if (!baked) {
        mesh.updateMatrixWorld(true);
        let boxed = false;
        try { _box1.setFromObject(mesh); boxed = !_box1.isEmpty(); } catch (e) { boxed = false; }
        if (boxed) {
          _box1.getCenter(_v1);
          baked = _v1.distanceTo(p) + 1e-3 < _v1.length();
        }
        if (!baked) mesh.position.copy(p);
      }
      if (!baked && bdef.rot &&
          mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0) {
        applyRot(mesh, bdef.rot);
      }
      // builders bake their own matrix and set matrixAutoUpdate=false, so any
      // transform we applied above has to be folded in explicitly.
      if (!mesh.matrixAutoUpdate) mesh.updateMatrix();
      mesh.userData.stageIndex = index;
      this._chunkAdd(mesh, p, detail);
    }
    const cols = built.colliders;
    if (Array.isArray(cols)) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c) continue;
        if (bdef.surface && c.surface !== bdef.surface) c.surface = bdef.surface;
        if (bdef.props && !c.props) c.props = bdef.props;
        this._addCollider(c, null);
        this._staticColliders.push(c);
      }
    }
  }

  /** Never a naked box: slab + inset top plate + four leading-edge stripes. */
  _fallbackPlatform(o) {
    const s = Array.isArray(o.s) && o.s.length >= 3
      ? [Math.abs(+o.s[0]) || 4, Math.abs(+o.s[1]) || 0.5, Math.abs(+o.s[2]) || 4]
      : [4, 0.5, 4];
    const g = new THREE.Group();

    const body = chamferBox(s[0], s[1], s[2], Math.min(0.09, s[1] * 0.3));
    this._own(body);
    const bodyMesh = new THREE.Mesh(body, this._mat(o.mat || 'stone'));
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    g.add(bodyMesh);

    const plate = chamferBox(Math.max(0.05, s[0] - 0.22), 0.05, Math.max(0.05, s[2] - 0.22), 0.02);
    plate.translate(0, s[1] * 0.5 + 0.005, 0);
    this._own(plate);
    const plateMesh = new THREE.Mesh(plate, this._mat('panel'));
    plateMesh.receiveShadow = true;
    g.add(plateMesh);

    if (o.stripe !== false) {
      const stripe = this._edgeStripeGeo(s[0], s[2], s[1] * 0.5 + 0.028, 0.10);
      this._own(stripe);
      const sm = new THREE.Mesh(stripe, this._stripeMat());
      g.add(sm);
    }
    const half = new THREE.Vector3(s[0] * 0.5, s[1] * 0.5, s[2] * 0.5);
    const center = v3(o.p, 0, 0, 0);
    const quat = new THREE.Quaternion();
    if (Array.isArray(o.rot)) {
      applyRot(_e1Holder, o.rot);
      quat.setFromEuler(_e1Holder.rotation);
      g.quaternion.copy(quat);
    }
    const col = new Collider({
      center, half, quat,
      surface: o.surface || 'normal',
      ref: null, group: 'world',
    });
    if (o.props) col.props = Object.assign(col.props || {}, o.props);
    return { mesh: g, colliders: [col] };
  }

  _edgeStripeGeo(sx, sz, y, w) {
    const parts = [];
    const mk = (x, z, dx, dz) => {
      const q = new THREE.BoxGeometry(dx, 0.035, dz);
      q.translate(x, y, z);
      parts.push(q);
    };
    mk(0, sz * 0.5 - w * 0.5, sx, w);
    mk(0, -sz * 0.5 + w * 0.5, sx, w);
    mk(sx * 0.5 - w * 0.5, 0, w, Math.max(0.01, sz - 2 * w));
    mk(-sx * 0.5 + w * 0.5, 0, w, Math.max(0.01, sz - 2 * w));
    const merged = mergeParts(parts);
    for (let i = 0; i < parts.length; i++) if (parts[i] !== merged) parts[i].dispose();
    return merged || new THREE.BoxGeometry(sx, 0.035, w);
  }

  _stripeMat() {
    if (this._stripeMaterial) return this._stripeMaterial;
    const m = new THREE.MeshBasicMaterial({
      color: this.palette.safeEdge.clone().multiplyScalar(1.15),
      toneMapped: false, fog: true,
    });
    this._own(m);
    this._stripeMaterial = m;
    return m;
  }

  /* ── deco (procedural + GLB props) ──────────────────────────────────── */

  _buildDeco(o, index) {
    if (this._decor <= 0) return null;
    let count = fin(o.count) ? Math.max(1, Math.round(o.count)) : 1;
    count = Math.max(1, Math.round(count * (0.35 + 0.65 * this._decor)));
    if (this._decor < 0.4) count = Math.min(count, Math.max(1, Math.floor(count * 0.5)));

    if (typeof o.model === 'string' && o.model.length) {
      return this._buildProp(o, index, count);
    }

    const bdef = Object.assign({}, o, { count });
    if (typeof Builders.buildDeco === 'function') {
      let built = null;
      try { built = Builders.buildDeco(bdef, this.theme, this.mats); }
      catch (e) { console.error('[Stage ' + this.id + '] buildDeco failed on objects[' + index + ']', e); built = null; }
      if (built && built.mesh) { this._placeBuilt(built, bdef, index, true); return null; }
    }
    /* fallback decor: a seeded cluster of chamfered shards — silhouette only */
    const rng = mulberry32(hashId(this.id + ':deco:' + index + ':' + (o.seed || 0)));
    const spread = fin(o.spread) ? o.spread : 2.2;
    const scale = fin(o.scale) ? o.scale : 1;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const h = (0.5 + rng() * 1.5) * scale;
      const w = (0.25 + rng() * 0.5) * scale;
      const gg = chamferBox(w, h, w * (0.7 + rng() * 0.6), Math.min(0.06, w * 0.25));
      _m1.makeRotationY(rng() * Math.PI * 2);
      _m1.setPosition((rng() - 0.5) * spread * 2, h * 0.5, (rng() - 0.5) * spread * 2);
      gg.applyMatrix4(_m1);
      parts.push(gg);
    }
    const merged = mergeParts(parts);
    for (let i = 0; i < parts.length; i++) if (parts[i] !== merged) parts[i].dispose();
    if (!merged) return null;
    this._own(merged);
    const mesh = new THREE.Mesh(merged, this._mat(o.mat || 'stone'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const p = v3(o.p, 0, 0, 0);
    mesh.position.copy(p);
    applyRot(mesh, o.rot);
    this._chunkAdd(mesh, p, true);
    return null;
  }

  async _buildProp(o, index, count) {
    const url = this._propUrl(o.model);
    const root = await this._loadProp(url);
    if (this._disposed) return null;
    if (!root) {
      /* prop missing -> procedural stand-in so the stage never has a hole */
      const alt = Object.assign({}, o);
      delete alt.model;
      this._buildDeco(alt, index);
      return null;
    }
    const p = v3(o.p, 0, 0, 0);
    const scale = fin(o.scale) ? o.scale : 1;
    const spread = fin(o.spread) ? o.spread : 0;
    const rng = mulberry32(hashId(this.id + ':prop:' + index + ':' + (o.seed || 0)));

    /* one InstancedMesh per source mesh of the prop */
    const sources = [];
    root.updateMatrixWorld(true);
    root.traverse((n) => {
      if (n.isMesh && n.geometry && !Array.isArray(n.material)) {
        sources.push({ geo: n.geometry, mat: n.material, mw: n.matrixWorld.clone() });
      }
    });
    if (!sources.length) return null;

    const container = new THREE.Group();
    container.position.copy(p);
    applyRot(container, o.rot);

    const inst = [];
    for (let i = 0; i < count; i++) {
      const yaw = rng() * Math.PI * 2;
      const sc = scale * (0.85 + rng() * 0.3);
      const ox = spread ? (rng() - 0.5) * spread * 2 : 0;
      const oz = spread ? (rng() - 0.5) * spread * 2 : 0;
      _q1.setFromAxisAngle(_UP, yaw);
      _v1.set(ox, 0, oz);
      _scale1.set(sc, sc, sc);
      inst.push(new THREE.Matrix4().compose(_v1, _q1, _scale1));
    }
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      const im = new THREE.InstancedMesh(src.geo, src.mat, count);
      if (!src.geo.boundingSphere) { try { src.geo.computeBoundingSphere(); } catch (e) { /* ok */ } }
      const rad = (src.geo.boundingSphere ? src.geo.boundingSphere.radius : 1) * scale;
      im.castShadow = rad >= SHADOW_MIN_RADIUS && src.mat.transparent !== true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.userData.noMerge = true;
      for (let i = 0; i < count; i++) {
        _m1.multiplyMatrices(inst[i], src.mw);
        im.setMatrixAt(i, _m1);
      }
      im.instanceMatrix.needsUpdate = true;
      container.add(im);
    }
    this._chunkAdd(container, p, true);
    return null;
  }

  /**
   * Resolve an authored `model` to a URL.
   *
   * The library form is `<theme>/<id>` (e.g. 'spire/torch') — which CONTAINS a
   * slash, and the old rule "has a slash => use verbatim" therefore dropped the
   * `assets/props/` prefix and resolved it against the PAGE
   * (/games/ascendant/index.html), so every one of spire-2's 56 GLB props
   * requested /games/ascendant/spire/*.glb, 404'd, and silently fell back to a
   * procedural stand-in. The real models never rendered.
   *
   * Only a rooted or absolute path is passed through now; everything else is
   * library-relative.
   */
  _propUrl(model) {
    const m = String(model || '').trim();
    if (!m) return '';
    const withExt = /\.(glb|gltf)$/i.test(m) ? m : m + '.glb';
    const rooted = /^[a-z][a-z0-9+.-]*:/i.test(m)   // http:, https:, data:, blob:
      || m.charAt(0) === '/'
      || m.startsWith('./') || m.startsWith('../')
      || m.startsWith('assets/');
    return rooted ? withExt : 'assets/props/' + withExt;
  }

  _loadProp(url) {
    if (this._propCache.has(url)) return this._propCache.get(url);
    if (!this._loader) this._loader = new GLTFLoader();
    const p = new Promise((resolve) => {
      try {
        this._loader.load(
          url,
          (gltf) => resolve((gltf && gltf.scene) || null),
          undefined,
          () => {
            console.warn('[Stage ' + this.id + '] prop not found: ' + url + ' (using procedural stand-in)');
            resolve(null);
          },
        );
      } catch (e) { resolve(null); }
    });
    this._propCache.set(url, p);
    return p;
  }

  /* ── in-world signage ───────────────────────────────────────────────── */

  _buildText(o, index) {
    if (this.texts.length >= MAX_TEXT) return null;
    const size = fin(o.size) ? clamp(o.size, 0.12, 4) : 0.42;
    const col = colorOf(o.color, this.palette.accent.getHex());
    const made = this._makeTextTexture(String(o.text), col);
    if (!made) return null;

    const w = size * made.aspect * 1.02;
    const h = size * 1.02;
    const group = new THREE.Group();

    const plateW = w + size * 0.7;
    const plateH = h + size * 0.62;
    const plate = chamferBox(plateW, plateH, 0.08, 0.05);
    this._own(plate);
    const plateMesh = new THREE.Mesh(plate, this._mat('panel'));
    plateMesh.castShadow = false;
    plateMesh.receiveShadow = true;
    group.add(plateMesh);

    const bar = new THREE.BoxGeometry(plateW * 0.86, 0.028, 0.02);
    bar.translate(0, -plateH * 0.5 + 0.075, 0.052);
    this._own(bar);
    const barMesh = new THREE.Mesh(bar, this._glowMat(col, 1.25));
    group.add(barMesh);

    const planeGeo = new THREE.PlaneGeometry(w, h);
    planeGeo.translate(0, 0.03, 0.055);
    this._own(planeGeo);
    const planeMat = new THREE.MeshBasicMaterial({
      map: made.tex, transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.FrontSide, fog: true,
    });
    this._own(planeMat);
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.userData.noMerge = true;
    planeMesh.renderOrder = 3;
    group.add(planeMesh);

    const p = v3(o.p, 0, 0, 0);
    group.position.copy(p);
    if (Array.isArray(o.rot)) applyRot(group, o.rot);
    else group.rotation.y = -Math.PI / 2;   // stages run +X: face the incoming player

    this.texts.push(group);
    this._chunkAdd(group, p, true);
    return null;
  }

  _makeTextTexture(text, color) {
    if (typeof document === 'undefined') return null;
    const lines = text.split('\n');
    const fs = 84;
    const pad = 30;
    const track = 5;
    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d');
    if (!ctx) return null;
    const font = '600 ' + fs + 'px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif';
    ctx.font = font;
    let maxW = 1;
    for (let i = 0; i < lines.length; i++) {
      const m = ctx.measureText(lines[i]).width + track * Math.max(0, lines[i].length - 1);
      if (m > maxW) maxW = m;
    }
    const W = Math.min(2048, Math.max(64, Math.ceil(maxW + pad * 2)));
    const H = Math.max(32, Math.ceil(lines.length * fs * 1.22 + pad * 2));
    cnv.width = W; cnv.height = H;

    const c2 = cnv.getContext('2d');
    c2.clearRect(0, 0, W, H);
    c2.font = font;
    c2.textBaseline = 'middle';
    const hex = '#' + color.getHexString();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lw = c2.measureText(line).width + track * Math.max(0, line.length - 1);
      let x = (W - lw) * 0.5;
      const y = pad + fs * 0.62 + i * fs * 1.22;
      c2.shadowColor = hex;
      c2.shadowBlur = 22;
      c2.fillStyle = '#ffffff';
      for (let ch = 0; ch < line.length; ch++) {
        const g = line[ch];
        c2.fillText(g, x, y);
        x += c2.measureText(g).width + track;
      }
      c2.shadowBlur = 0;
      x = (W - lw) * 0.5;
      c2.fillStyle = hex;
      c2.globalAlpha = 0.55;
      for (let ch = 0; ch < line.length; ch++) {
        const g = line[ch];
        c2.fillText(g, x, y);
        x += c2.measureText(g).width + track;
      }
      c2.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this._own(tex);
    return { tex, aspect: W / H };
  }

  /** Cached unlit glow material — shared so signage and bulbs still merge. */
  _glowMat(color, boost) {
    const b = fin(boost) ? boost : 1.25;
    const key = 'glow:' + color.getHexString() + ':' + b.toFixed(2);
    let m = this._matCache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(b), toneMapped: false });
    this._own(m);
    this._matCache.set(key, m);
    return m;
  }

  /* ── point lights ───────────────────────────────────────────────────── */

  _buildLight(o, index) {
    if (this.lights.length >= MAX_LIGHTS) return null;
    const p = v3(o.p, 0, 0, 0);
    const color = colorOf(o.color, this.palette.accent.getHex());
    const intensity = fin(o.intensity) ? o.intensity : 6;
    const distance = fin(o.distance) ? o.distance : 14;

    /* a physical bulb so the source is visible, not a floating glow */
    const bulbGeo = new THREE.IcosahedronGeometry(Math.min(0.16, distance * 0.02 + 0.06), 1);
    bulbGeo.translate(p.x, p.y, p.z);
    this._own(bulbGeo);
    const bulb = new THREE.Mesh(bulbGeo, this._glowMat(color, 1.6));
    this._chunkAdd(bulb, p, true);

    /* the part that used to BE a PointLight: a halo around the bulb so the
     * source still reads at range, and a pool of light on the floor beneath it
     * so the fixture keeps lighting its own patch of the world even when no
     * slot of the pool is pointed at it. Both bake flat in _buildGlowField. */
    this._glowSites.push({
      pos: p, color,
      halo: Math.min(2.2, Math.max(0.45, distance * 0.13)),
      pool: Math.min(6.5, Math.max(1.2, distance * 0.42)),
    });

    const site = this.addLightSite({
      p, color, intensity, distance,
      flicker: o.flicker, seed: index * 37.13,
    });
    site.bulb = bulb;
    return null;
  }

  /* ── the light budget ───────────────────────────────────────────────── */

  /**
   * Register a dynamic light SITE. Sites compete for the stage's small fixed
   * pool of real PointLights — registering one never adds a light to the scene,
   * so a hazard may call this at build time or later without risking the
   * program-cache recompile that adding a live light causes.
   *
   * @param {object} o  {p|pos, color, intensity, distance, flicker, seed}
   * @returns {object}  the site record: move it via `site.pos.set(...)`, dim it
   *                    via `site.base = n`, drop it via `site.remove()`.
   */
  addLightSite(o) {
    const pos = (o && o.pos && fin(o.pos.x)) ? o.pos : v3(o && o.p, 0, 0, 0);
    const distance = fin(o && o.distance) ? o.distance : 14;
    const self = this;
    const site = {
      pos,
      color: (o && o.color && o.color.isColor)
        ? o.color
        : colorOf(o && o.color, this.palette.accent.getHex()),
      base: fin(o && o.intensity) ? o.intensity : 6,
      distance,
      decay: fin(o && o.decay) ? o.decay : 2,
      flicker: !!(o && o.flicker),
      flickerAmt: fin(o && o.flicker) ? clamp(o.flicker, 0, 1) : 0.35,
      seed: fin(o && o.seed) ? (o.seed % 100) : (this.lights.length * 37.13) % 100,
      /* beyond this the term is under the dither floor — never a candidate */
      range2: (distance * 3.2) * (distance * 3.2),
      d2: 0, want: false, slot: -1, bulb: null,
      remove() {
        const i = self.lights.indexOf(site);
        if (i < 0) return;
        if (site.slot >= 0 && self._lightPool[site.slot]) {
          self._lightPool[site.slot].site = null;
        }
        site.slot = -1;
        self.lights.splice(i, 1);
        self._lightIdx.length = self.lights.length;
      },
    };
    this.lights.push(site);
    this._lightIdx.push(this.lights.length - 1);
    return site;
  }

  /**
   * Allocate the pool ONCE, before the first render. Slots live on the stage
   * group forever at intensity 0 until the budget points one at a site; they
   * are never added, removed or hidden after this, so the program cache is
   * built for LIGHT_POOL_SIZE point lights and stays valid for the whole run.
   */
  _buildLightPool() {
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.name = 'asc.stage.pointpool.' + i;
      l.castShadow = false;
      l.position.set(0, -1e4, 0);
      this.group.add(l);
      this._lightPool.push({ light: l, site: null, fade: 0 });
    }
  }

  /**
   * Bake every light site's halo + floor pool into ONE additive mesh.
   *
   * A halo is a camera-facing quad; a floor pool is a horizontal disc sitting
   * on whatever collider is under the fixture. Both are the same four verts
   * with a radial falloff, so the fixture glow for a whole stage costs one draw
   * call and no per-fragment light term on any other material in the scene.
   */
  _buildGlowField() {
    const sites = this._glowSites;
    if (!sites.length) return;

    const quads = [];
    for (let i = 0; i < sites.length; i++) {
      const g = sites[i];
      quads.push({ x: g.pos.x, y: g.pos.y, z: g.pos.z, size: g.halo, mode: 0, c: g.color });
      const fy = this._floorUnder(g.pos, g.pool * 2.4);
      if (fy !== null) {
        quads.push({ x: g.pos.x, y: fy + 0.035, z: g.pos.z, size: g.pool, mode: 1, c: g.color });
      }
    }
    if (!quads.length) return;

    const n = quads.length;
    const pos = new Float32Array(n * 4 * 3);
    const cor = new Float32Array(n * 4 * 2);
    const par = new Float32Array(n * 4 * 2);
    const tint = new Float32Array(n * 4 * 3);
    const idx = new Uint32Array(n * 6);
    const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
    for (let q = 0; q < n; q++) {
      const d = quads[q];
      for (let v = 0; v < 4; v++) {
        const o3 = (q * 4 + v) * 3, o2 = (q * 4 + v) * 2;
        pos[o3] = d.x; pos[o3 + 1] = d.y; pos[o3 + 2] = d.z;
        cor[o2] = CX[v]; cor[o2 + 1] = CY[v];
        par[o2] = d.size; par[o2 + 1] = d.mode;
        tint[o3] = d.c.r; tint[o3 + 1] = d.c.g; tint[o3 + 2] = d.c.b;
      }
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
    geo.setAttribute('aParam', new THREE.BufferAttribute(par, 2));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this._own(geo);

    /* Additive geometry cannot take three.js fog (fog ADDS its colour), so the
     * distance fade is folded into alpha here with the theme's own exp2 curve —
     * otherwise every fixture in the stage stays crisp through the haze. */
    const fogDensity = (this.theme && this.theme.fog && fin(this.theme.fog.density))
      ? this.theme.fog.density : 0.0;
    const fogFar = (this.theme && this.theme.fog && fin(this.theme.fog.far))
      ? this.theme.fog.far : 0.0;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHaloGain: { value: 0.80 },
        uPoolGain: { value: 0.40 },
        uFogDensity: { value: fogDensity },
        uFogFar: { value: fogFar },
      },
      vertexShader: [
        'attribute vec2 aCorner;',
        'attribute vec2 aParam;',
        'attribute vec3 aTint;',
        'uniform float uFogDensity;',
        'uniform float uFogFar;',
        'varying vec2 vCorner;',
        'varying vec3 vTint;',
        'varying float vMode;',
        'varying float vFog;',
        'void main() {',
        '  vCorner = aCorner;',
        '  vTint = aTint;',
        '  vMode = aParam.y;',
        '  vec4 mv;',
        '  if (aParam.y < 0.5) {',
        '    mv = modelViewMatrix * vec4(position, 1.0);',
        '    mv.xy += aCorner * aParam.x;',
        '  } else {',
        '    vec3 wp = position;',
        '    wp.x += aCorner.x * aParam.x;',
        '    wp.z += aCorner.y * aParam.x;',
        '    mv = modelViewMatrix * vec4(wp, 1.0);',
        '  }',
        '  float dist = -mv.z;',
        '  float f = 1.0;',
        '  if (uFogDensity > 0.0) { float t = uFogDensity * dist; f = exp(-t * t); }',
        '  else if (uFogFar > 0.0) { f = clamp(1.0 - dist / uFogFar, 0.0, 1.0); }',
        '  vFog = f;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uHaloGain;',
        'uniform float uPoolGain;',
        'varying vec2 vCorner;',
        'varying vec3 vTint;',
        'varying float vMode;',
        'varying float vFog;',
        'void main() {',
        '  float d = length(vCorner);',
        '  float a = 1.0 - clamp(d, 0.0, 1.0);',
        '  a = vMode < 0.5 ? pow(a, 2.6) : pow(a, 1.9);',
        '  a *= vFog * (vMode < 0.5 ? uHaloGain : uPoolGain);',
        '  gl_FragColor = vec4(vTint * a, a);',
        '}',
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this._own(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'stage.glowfield';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;   // spans the stage; one draw call either way
    mesh.matrixAutoUpdate = false;
    mesh.userData.noMerge = true;
    this.group.add(mesh);
    this._glowField = mesh;
  }

  /**
   * Shadow-caster gate. Clutter smaller than SHADOW_MIN_RADIUS costs a full
   * extra draw in the shadow pass and returns a sub-pixel blob; transparent
   * surfaces cast an opaque silhouette, which is worse than no shadow at all.
   * (feedback_forgeflow_games_fps)
   *
   * This runs at the SOURCE of the static merge on purpose: `_mergeInto` ORs
   * the flag across a material group, so one 8 cm bolt used to promote every
   * wall sharing its material into the shadow pass.
   */
  _shouldCast(o) {
    if (!o || !o.castShadow) return false;
    const m = o.material;
    if (m && !Array.isArray(m) && (m.transparent === true || m.isMeshBasicMaterial)) return false;
    const g = o.geometry;
    if (!g) return false;
    if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { return true; } }
    if (!g.boundingSphere) return true;
    _v6.setFromMatrixScale(o.matrixWorld);
    const sc = Math.max(_v6.x, _v6.y, _v6.z) || 1;
    return g.boundingSphere.radius * sc >= SHADOW_MIN_RADIUS;
  }

  /**
   * Highest collider top strictly below `p` and inside its XZ footprint, or
   * null when the fixture hangs over nothing — a light on a bridge rail with
   * the void beneath it must NOT paint a pool of light on empty air.
   */
  _floorUnder(p, maxDrop) {
    const cols = this._allColliders;
    let best = -Infinity;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const b = c && c.aabb;
      if (!b || b.isEmpty()) continue;
      if (p.x < b.min.x - 0.25 || p.x > b.max.x + 0.25) continue;
      if (p.z < b.min.z - 0.25 || p.z > b.max.z + 0.25) continue;
      const top = b.max.y;
      if (top > p.y - 0.08 || top < p.y - maxDrop) continue;
      if (top > best) best = top;
    }
    return best === -Infinity ? null : best;
  }

  /* ── hazards ────────────────────────────────────────────────────────── */

  _buildHazard(o, index) {
    let kind = o.kind;
    const table = HazardLib.HAZARDS || null;
    const make = typeof HazardLib.makeHazard === 'function' ? HazardLib.makeHazard : null;

    const hctx = {
      mats: this.mats, Mats, builders: Builders,
      theme: this.theme, themeId: this.themeId, palette: this.palette,
      quality: this.quality, settings: Settings,
      engine: this.engine,
      renderer: this.engine ? this.engine.renderer : null,
      scene: this.engine ? this.engine.scene : null,
      camera: this.engine ? this.engine.camera : null,
      group: this.group, stage: this,
      fx: this.fx, audio: this.audio, save: this.save,
      rng: mulberry32(hashId(this.id + ':hz:' + index)),
      seed: hashId(this.id + ':hz:' + index),
      index, stageDef: this.def,
    };

    let h = null;
    try {
      if (make) {
        h = make(o, hctx);
      } else if (table) {
        if (kind === 'lava' && o.rising && typeof table.risinglava === 'function') kind = 'risinglava';
        const f = table[kind];
        if (typeof f === 'function') h = f(o, hctx);
      }
    } catch (e) {
      console.error('[Stage ' + this.id + '] hazard factory threw for objects[' + index + '] (kind "' + o.kind + '")', e);
      return null;
    }
    if (h && typeof h.then === 'function') {
      return h.then((res) => { this._registerHazard(res, o, index); })
              .catch((e) => {
                console.error('[Stage ' + this.id + '] async hazard failed objects[' + index + ']', e);
              });
    }
    this._registerHazard(h, o, index);
    return null;
  }

  _registerHazard(h, o, index) {
    if (!h || typeof h.update !== 'function') {
      console.warn('[Stage ' + this.id + '] no hazard produced for objects[' + index + '] (kind "' + o.kind + '")');
      return;
    }
    if (h.mesh && !h.mesh.parent) this.group.add(h.mesh);

    const colliders = [];
    if (Array.isArray(h.colliders)) {
      for (let i = 0; i < h.colliders.length; i++) {
        const c = h.colliders[i];
        if (!c) continue;
        if (c.ref === undefined || c.ref === null) c.ref = h;
        this._addCollider(c, h);
        colliders.push(c);
      }
    }
    if (Array.isArray(h.kills)) {
      for (let i = 0; i < h.kills.length; i++) {
        const k = h.kills[i];
        if (!k) continue;
        if (k.ref === undefined || k.ref === null) k.ref = h;
        this.killVolumes.push(k);
      }
    }

    const rec = {
      h, def: o, index, kind: o.kind, colliders,
      cullable: !NEVER_CULL.has(o.kind),
      far: false, broken: false,
      cx: 0, cy: 0, cz: 0, radius: 4,
    };
    this.hazards.push(rec);
  }

  /** Static culling sphere: the hazard's rest bounds padded by its motion range. */
  _measureHazard(rec) {
    const o = rec.def;
    _box1.makeEmpty();
    if (rec.h.mesh) {
      try { _box1.setFromObject(rec.h.mesh); } catch (e) { _box1.makeEmpty(); }
    }
    if (_box1.isEmpty() && fin3(o.p)) {
      _v1.set(o.p[0], o.p[1], o.p[2]);
      _box1.setFromCenterAndSize(_v1, _v2.set(2, 2, 2));
    }
    if (_box1.isEmpty()) { rec.cullable = false; return; }
    _box1.getCenter(_v1);
    _box1.getSize(_v2);
    rec.cx = _v1.x; rec.cy = _v1.y; rec.cz = _v1.z;
    let r = _v2.length() * 0.5;

    /* pad by everything the def says it can travel */
    let travel = 0;
    if (o.motion) {
      const m = o.motion;
      if (fin3(m.to) && fin3(o.p)) {
        travel = Math.max(travel, Math.hypot(m.to[0] - o.p[0], m.to[1] - o.p[1], m.to[2] - o.p[2]));
      }
      if (fin(m.radius)) travel = Math.max(travel, Math.abs(m.radius) * 2);
      if (fin(m.sinkSpeed) && fin(m.period)) travel = Math.max(travel, Math.abs(m.sinkSpeed * m.period));
    }
    if (fin(o.travel)) travel = Math.max(travel, Math.abs(o.travel));
    if (fin(o.len)) travel = Math.max(travel, Math.abs(o.len) * 2);
    if (fin(o.amp) && fin(o.len)) travel = Math.max(travel, Math.abs(o.len) * 2);
    if (fin(o.from) && fin(o.to)) travel = Math.max(travel, Math.abs(o.to - o.from));
    if (fin3(o.a) && fin3(o.b)) {
      travel = Math.max(travel, Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1], o.b[2] - o.a[2]));
    }
    r += travel;
    rec.radius = r;
    if (r > 45) rec.cullable = false;
  }

  _hazardError(rec, e) {
    if (rec.broken) return;
    rec.broken = true;
    rec.errCount = (rec.errCount || 0) + 1;
    if (rec.errCount <= 3) {
      console.error('[Stage ' + this.id + '] hazard objects[' + rec.index + '] (kind "' + rec.kind +
                    '") threw in update() and has been suspended', e);
      if (rec.errCount === 3) {
        console.error('[Stage ' + this.id + '] ...further errors from objects[' + rec.index + '] silenced');
      }
    }
  }

  /* ── colliders / kill volumes ───────────────────────────────────────── */

  _addCollider(c, ref) {
    if (!c) return;
    if (ref !== undefined && (c.ref === undefined || c.ref === null)) c.ref = ref;
    if (c.active === undefined) c.active = true;
    if (typeof c.update === 'function') { try { c.update(); } catch (e) { /* aabb optional */ } }
    try { this.broadphase.add(c); } catch (e) {
      console.error('[Stage ' + this.id + '] broadphase.add failed', e);
    }
    this._allColliders.push(c);
  }

  /**
   * The void. collider.js documents `{type:'plane', y:killY}` as "kills
   * everything BELOW y", which is exactly the authored semantic — so that is
   * the primary form. The box fields (center/half/min/max, top face exactly at
   * killY) ride along as an equivalent fallback for any KillVolume build that
   * only implements boxes; note we deliberately pass NO `normal`, so the `y`
   * convenience branch is the one that wins.
   */
  _buildVoidVolume() {
    const killY = this.killY;
    let cx = 0, cz = 0;
    if (!this.bounds.isEmpty()) { this.bounds.getCenter(_v1); cx = _v1.x; cz = _v1.z; }
    const halfXZ = 6000;
    const halfY = 600;
    const center = new THREE.Vector3(cx, killY - halfY, cz);
    const half = new THREE.Vector3(halfXZ, halfY, halfXZ);
    const min = new THREE.Vector3(cx - halfXZ, killY - 2 * halfY, cz - halfXZ);
    const max = new THREE.Vector3(cx + halfXZ, killY, cz + halfXZ);
    let kv = null;
    try {
      kv = new KillVol({
        type: 'plane', kind: 'void', ref: null, y: killY,
        center, half, min, max,
        box: new THREE.Box3(min.clone(), max.clone()),
      });
    } catch (e) {
      console.error('[Stage ' + this.id + '] KillVolume(void) construction failed', e);
      kv = null;
    }
    if (kv) {
      if (kv.active === undefined) kv.active = true;
      this.voidVolume = kv;
      this.killVolumes.push(kv);
    }
  }

  /* ── spatial chunks ─────────────────────────────────────────────────── */

  /**
   * Chunk size is chosen so a stage lands at ~10 chunks. Chunks exist to cull
   * the far END of a long stage, not to subdivide what is already on screen -
   * and every extra chunk multiplies the draw calls, because each one needs its
   * own merged mesh per material.
   */
  _computeChunkSize() {
    let minX = Infinity, maxX = -Infinity;
    const see = (x) => { if (fin(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; } };
    if (this.def.spawn && fin3(this.def.spawn.p)) see(this.def.spawn.p[0]);
    if (this.def.finish && fin3(this.def.finish.p)) see(this.def.finish.p[0]);
    const cps = Array.isArray(this.def.checkpoints) ? this.def.checkpoints : [];
    for (let i = 0; i < cps.length; i++) if (fin3(cps[i].p)) see(cps[i].p[0]);
    const objs = Array.isArray(this.def.objects) ? this.def.objects : [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o && fin3(o.p)) see(o.p[0]);
      if (o && fin3(o.a)) see(o.a[0]);
      if (o && fin3(o.b)) see(o.b[0]);
    }
    if (!Number.isFinite(minX) || maxX <= minX) return CHUNK_SIZE;
    return clamp(Math.ceil((maxX - minX) / 10), CHUNK_SIZE, CHUNK_MAX);
  }

  /* Stages run along +X (CONTRACT 18), so chunk on the run axis only.
     Splitting Z as well doubled the chunk count - and the draw calls - for no
     culling benefit on a corridor-shaped stage. */
  _chunkKey(x) {
    return Math.floor(x / (this._chunkSize || CHUNK_SIZE));
  }

  _chunkFor(x) {
    const key = this._chunkKey(x);
    let ch = this._chunkMap.get(key);
    if (!ch) {
      ch = {
        key,
        group: new THREE.Group(),
        main: new THREE.Group(),
        detail: new THREE.Group(),
        box: new THREE.Box3(),
        recsMain: [],
        recsDetail: [],
        visible: true,
        detailVisible: true,
      };
      ch.group.name = 'chunk ' + key;
      ch.group.add(ch.main);
      ch.group.add(ch.detail);
      this.group.add(ch.group);
      this._chunkMap.set(key, ch);
      this._chunks.push(ch);
    }
    return ch;
  }

  _chunkAdd(obj, pos, detail) {
    const ch = this._chunkFor(pos.x);
    (detail ? ch.detail : ch.main).add(obj);
    obj.updateMatrixWorld(true);
    try {
      _box1.setFromObject(obj);
      if (!_box1.isEmpty()) ch.box.union(_box1);
      else ch.box.expandByPoint(pos);
    } catch (e) { ch.box.expandByPoint(pos); }
    (detail ? ch.recsDetail : ch.recsMain).push(obj);
    return ch;
  }

  /* ── static merge ───────────────────────────────────────────────────── */

  _mergeStatic() {
    if (!this._chunks.length) return;
    let drawCalls = 0;
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      drawCalls += this._mergeInto(ch.main, ch.recsMain);
      drawCalls += this._mergeInto(ch.detail, ch.recsDetail);
      ch.recsMain.length = 0;
      ch.recsDetail.length = 0;
      if (ch.box.isEmpty()) ch.box.setFromCenterAndSize(_v1.set(0, 0, 0), _v2.set(1, 1, 1));
    }
    this.staticDrawCalls = drawCalls;
  }

  /**
   * Pull every mergeable mesh out of `roots`, bake its world matrix, group by
   * material and emit one mesh per (chunk, material).
   * @returns {number} resulting draw calls for this group
   */
  _mergeInto(target, roots) {
    if (!roots.length) return 0;
    const recs = [];
    const keep = [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const rootMerged = this._collectMergeables(root, recs);
      if (!rootMerged && (root.children.length > 0 || root.isMesh || root.isLight ||
                          root.isPoints || root.isLine || root.isInstancedMesh)) {
        keep.push(root);
      } else if (!rootMerged) {
        if (root.parent) root.parent.remove(root);
      }
    }
    /* clear then re-add: keeps the graph tidy and predictable */
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (r.parent === target && keep.indexOf(r) < 0) target.remove(r);
    }

    /* group by material */
    const byMat = new Map();
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      let a = byMat.get(rec.mat);
      if (!a) { a = []; byMat.set(rec.mat, a); }
      a.push(rec);
    }

    let calls = keep.length;
    byMat.forEach((list, mat) => {
      // Sole whole-mesh user of this material: reuse its geometry as-is, no copy.
      if (list.length === 1 && list[0].gStart < 0) {
        const rec = list[0];
        const m = new THREE.Mesh(rec.geo, mat);
        m.castShadow = rec.cast;
        m.receiveShadow = rec.recv;
        m.matrixAutoUpdate = false;
        m.matrix.copy(rec.mw);
        m.matrixWorldNeedsUpdate = true;
        target.add(m);
        calls++;
        return;
      }
      const geos = [];
      let cast = false, recv = false;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const g = normaliseGeo(rec.geo, rec.mw, rec.gStart, rec.gCount);
        if (!g) continue;
        cast = cast || rec.cast;
        recv = recv || rec.recv;
        geos.push(g);
        this._mergeSources.add(rec.geo);
      }
      if (!geos.length) return;
      const merged = mergeParts(geos);
      if (!merged) {
        // Every geo here is already a standalone, world-baked copy, so the
        // fallback is one identity-transform mesh each - never the raw source
        // (which for a group slice would draw the WHOLE multi-material mesh).
        console.warn('[Stage ' + this.id + '] merge failed for a material group (' + geos.length +
                     ' parts) — falling back to individual draws');
        for (let i = 0; i < geos.length; i++) {
          this._own(geos[i]);
          const m = new THREE.Mesh(geos[i], mat);
          m.castShadow = cast; m.receiveShadow = recv;
          m.matrixAutoUpdate = false;
          m.updateMatrix();
          target.add(m);
          calls++;
        }
        return;
      }
      for (let i = 0; i < geos.length; i++) if (geos[i] !== merged) geos[i].dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      this._own(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = recv;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      target.add(mesh);
      calls++;
    });
    return calls;
  }

  /**
   * @returns {boolean} true if `root` itself was consumed by the merge
   */
  _collectMergeables(root, out) {
    root.updateMatrixWorld(true);
    const found = [];
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      for (let i = 0; i < o.children.length; i++) stack.push(o.children[i]);
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) continue;
      if (o.userData && (o.userData.noMerge || o.userData.dynamic)) continue;
      if (!o.material) continue;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) continue;
      if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) continue;
      if (Array.isArray(o.material)) {
        // a multi-material mesh is mergeable only if its groups fully describe it
        const groups = o.geometry.groups;
        if (!groups || !groups.length) continue;
        let bad = false;
        for (let gi = 0; gi < groups.length; gi++) {
          const m = o.material[groups[gi].materialIndex];
          if (!m || !m.isMaterial) { bad = true; break; }
        }
        if (bad) continue;
      }
      found.push(o);
    }
    let rootConsumed = false;
    for (let i = 0; i < found.length; i++) {
      const o = found[i];
      const mw = o.matrixWorld.clone();
      const cast = this._shouldCast(o), recv = !!o.receiveShadow;
      if (Array.isArray(o.material)) {
        const groups = o.geometry.groups;
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          out.push({
            geo: o.geometry, mat: o.material[g.materialIndex], mw, cast, recv,
            gStart: g.start, gCount: g.count,
          });
        }
      } else {
        out.push({ geo: o.geometry, mat: o.material, mw, cast, recv, gStart: -1, gCount: 0 });
      }
      if (o === root) rootConsumed = true;
      if (o.parent) o.parent.remove(o);
    }
    return rootConsumed;
  }

  /** Source geometries are safe to free once nothing in the graph references them. */
  _disposeMergeSources() {
    if (!this._mergeSources.size) return;
    const inUse = new Set();
    this.group.traverse((o) => { if (o.geometry) inUse.add(o.geometry); });
    this._mergeSources.forEach((g) => {
      // NEVER dispose a geometry another module owns: builders hand out cached,
      // stage-spanning geometry (GeoCache), and we only ever cloned from it.
      if (!inUse.has(g) && this._ownedGeo.has(g)) {
        this._ownedGeo.delete(g);
        try { g.dispose(); } catch (e) { /* already gone */ }
      }
    });
    this._mergeSources.clear();
  }

  /* ── checkpoints ────────────────────────────────────────────────────── */

  _buildCheckpoints() {
    const defs = Array.isArray(this.def.checkpoints) ? this.def.checkpoints : [];
    this.checkpoints = [];
    if (!defs.length) return;

    const n = defs.length;
    for (let i = 0; i < n; i++) {
      const d = defs[i];
      this.checkpoints.push({
        index: i,
        pos: v3(d.p, 0, 0, 0),
        yaw: fin(d.yaw) ? d.yaw : 0,
        clockOffset: fin(d.clockOffset) ? d.clockOffset : 0,
        radius: fin(d.r) ? d.r : 2.15,
        reached: false,
        state: 0,
        pulse: 0,
        angle: (i * 1.37) % 6.2831,
        lockAngle: 0,
        locking: false,
        seed: (i * 0.271) % 1,
      });
    }

    const g = new THREE.Group();
    g.name = 'checkpoints';
    this.group.add(g);
    this._cpGroup = g;

    /* per-instance animation channels, shared across all five meshes */
    const aState = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aPulse = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aAngle = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aSeed  = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    aState.setUsage(THREE.DynamicDrawUsage);
    aPulse.setUsage(THREE.DynamicDrawUsage);
    aAngle.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) aSeed.setX(i, this.checkpoints[i].seed);
    this._cpAttr = { aState, aPulse, aAngle, aSeed };

    const off = this.palette.checkpoint;
    const on = this.palette.checkpointOn;

    /* 1. physical pad base (Mats material + per-instance tint) */
    const baseGeo = chamferDisc(1.55, 0.14, 0.06, 44);
    this._own(baseGeo);
    const baseMesh = new THREE.InstancedMesh(baseGeo, this._mat('metal'), n);
    baseMesh.castShadow = false;
    baseMesh.receiveShadow = true;
    baseMesh.frustumCulled = false;
    baseMesh.userData.noMerge = true;
    g.add(baseMesh);
    this._cpBase = baseMesh;

    /* 2. glowing ring */
    const ringGeo = new THREE.TorusGeometry(1.42, 0.055, 8, 76);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.translate(0, 0.155, 0);
    this._own(ringGeo);
    this._cpAttachAttrs(ringGeo);
    const ringMat = this._fxMaterial(RING_VERT, RING_FRAG, {
      uTime: { value: 0 }, uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, n);
    ringMesh.frustumCulled = false;
    ringMesh.renderOrder = 6;
    g.add(ringMesh);
    this._cpRing = ringMesh;

    /* 3. activation shockwave */
    const waveGeo = new THREE.RingGeometry(1.30, 1.52, 72, 1);
    waveGeo.rotateX(-Math.PI / 2);
    waveGeo.translate(0, 0.17, 0);
    this._own(waveGeo);
    this._cpAttachAttrs(waveGeo);
    const waveMat = this._fxMaterial(WAVE_VERT, WAVE_FRAG, { uColorOn: { value: on.clone() } });
    const waveMesh = new THREE.InstancedMesh(waveGeo, waveMat, n);
    waveMesh.frustumCulled = false;
    waveMesh.renderOrder = 6;
    g.add(waveMesh);
    this._cpWave = waveMesh;

    /* 4. rotating glyph */
    const glyphGeo = new THREE.PlaneGeometry(1.72, 1.72);
    glyphGeo.rotateX(-Math.PI / 2);
    this._own(glyphGeo);
    this._cpAttachAttrs(glyphGeo);
    const glyphTex = this._makeGlyphTexture();
    const glyphMat = this._fxMaterial(GLYPH_VERT, GLYPH_FRAG, {
      uTime: { value: 0 }, uMap: { value: glyphTex },
      uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const glyphMesh = new THREE.InstancedMesh(glyphGeo, glyphMat, n);
    glyphMesh.frustumCulled = false;
    glyphMesh.renderOrder = 7;
    g.add(glyphMesh);
    this._cpGlyph = glyphMesh;

    /* 5. volumetric light column */
    const colGeo = new THREE.CylinderGeometry(1.02, 1.30, 9.2, 22, 1, true);
    colGeo.translate(0, 4.6, 0);
    this._own(colGeo);
    this._cpAttachAttrs(colGeo);
    const colMat = this._fxMaterial(beamVertexSrc(true), BEAM_FRAG, {
      uTime: { value: 0 }, uGain: { value: 1.0 },
      uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const colMesh = new THREE.InstancedMesh(colGeo, colMat, n);
    colMesh.frustumCulled = false;
    colMesh.renderOrder = 5;
    g.add(colMesh);
    this._cpColumn = colMesh;

    /* instance transforms are static (pads do not move) */
    const meshes = [baseMesh, ringMesh, waveMesh, glyphMesh, colMesh];
    for (let i = 0; i < n; i++) {
      const cp = this.checkpoints[i];
      _m1.makeTranslation(cp.pos.x, cp.pos.y, cp.pos.z);
      for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, _m1);
      baseMesh.setColorAt(i, _colScratch.copy(off).multiplyScalar(0.75));
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
    if (baseMesh.instanceColor) baseMesh.instanceColor.needsUpdate = true;

    /* restore save state (activated pads stay lit) */
    if (this.save && typeof this.save.stage === 'function') {
      try {
        const s = this.save.stage(this.id);
        if (s && fin(s.cpIndex) && s.cpIndex >= 0) {
          this.setCheckpointIndex(Math.min(s.cpIndex, n - 1), true);
        }
      } catch (e) { /* save is advisory here */ }
    }
  }

  _cpAttachAttrs(geo) {
    geo.setAttribute('aState', this._cpAttr.aState);
    geo.setAttribute('aPulse', this._cpAttr.aPulse);
    geo.setAttribute('aAngle', this._cpAttr.aAngle);
    geo.setAttribute('aSeed', this._cpAttr.aSeed);
  }

  _makeGlyphTexture() {
    if (typeof document === 'undefined') return null;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d');
    if (!x) return null;
    x.clearRect(0, 0, S, S);
    x.translate(S / 2, S / 2);
    x.strokeStyle = '#ffffff';
    x.lineCap = 'round';

    /* outer broken ring */
    x.lineWidth = 7;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + 0.16;
      const a1 = a0 + (Math.PI * 2) / 6 - 0.32;
      x.beginPath(); x.arc(0, 0, 104, a0, a1); x.stroke();
    }
    /* mid ring */
    x.lineWidth = 4;
    x.globalAlpha = 0.75;
    x.beginPath(); x.arc(0, 0, 78, 0, Math.PI * 2); x.stroke();
    /* radial ticks */
    x.globalAlpha = 0.9;
    x.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 56 : 66;
      x.beginPath();
      x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      x.lineTo(Math.cos(a) * 72, Math.sin(a) * 72);
      x.stroke();
    }
    /* centre chevron cluster */
    x.globalAlpha = 1;
    x.lineWidth = 11;
    for (let k = 0; k < 3; k++) {
      const off = -20 + k * 20;
      x.beginPath();
      x.moveTo(-26, off + 12);
      x.lineTo(0, off - 12);
      x.lineTo(26, off + 12);
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this._own(tex);
    return tex;
  }

  /* ── finish portal ──────────────────────────────────────────────────── */

  _buildFinish() {
    /* No finish means no portal, no gate volume, no clear condition (the hub).
       `this.finish` stays null and every consumer — _updateFinish, finishAt,
       _checkTriggers, reset, the progress polyline — already reads it as
       "nothing to do", so the absence is handled in exactly one place. */
    const fdef = this.def.finish;
    if (!fdef || !fin3(fdef.p)) { this.finish = null; return; }
    const pos = v3(fdef.p, 0, 0, 0);

    /* face the incoming run direction so the gate always reads as a doorway */
    const prev = this.checkpoints.length
      ? this.checkpoints[this.checkpoints.length - 1].pos
      : v3(this.def.spawn && this.def.spawn.p, pos.x - 10, pos.y, pos.z);
    const forward = new THREE.Vector3(pos.x - prev.x, 0, pos.z - prev.z);
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0);
    forward.normalize();

    const g = new THREE.Group();
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(_FWD, forward);
    this.group.add(g);

    const R = 2.35;
    const PH = 3.1;                 // pillar height (arch springs from here)
    const col = this.palette.finish;
    const acc = this.palette.accent;

    /* pillars */
    const pillarParts = [];
    for (let s = -1; s <= 1; s += 2) {
      const shaft = chamferBox(0.62, PH, 0.62, 0.09);
      shaft.translate(s * (R + 0.31), PH * 0.5, 0);
      pillarParts.push(shaft);
      const foot = chamferBox(1.05, 0.26, 1.05, 0.07);
      foot.translate(s * (R + 0.31), 0.13, 0);
      pillarParts.push(foot);
      const cap = chamferBox(0.86, 0.22, 0.86, 0.06);
      cap.translate(s * (R + 0.31), PH - 0.05, 0);
      pillarParts.push(cap);
    }
    const arch = new THREE.TorusGeometry(R + 0.31, 0.30, 10, 44, Math.PI);
    arch.translate(0, PH, 0);
    pillarParts.push(arch);
    const stone = mergeParts(pillarParts);
    for (let i = 0; i < pillarParts.length; i++) if (pillarParts[i] !== stone) pillarParts[i].dispose();
    if (stone) {
      stone.computeVertexNormals();
      this._own(stone);
      const sm = new THREE.Mesh(stone, this._mat('obsidian'));
      sm.castShadow = true;
      sm.receiveShadow = true;
      g.add(sm);
    }

    /* emissive trim on the arch + pillar inner edges */
    const trimParts = [];
    const trimArc = new THREE.TorusGeometry(R + 0.02, 0.045, 6, 44, Math.PI);
    trimArc.translate(0, PH, 0);
    trimParts.push(trimArc);
    for (let s = -1; s <= 1; s += 2) {
      const rail = new THREE.BoxGeometry(0.06, PH, 0.06);
      rail.translate(s * R, PH * 0.5, 0);
      trimParts.push(rail);
    }
    const trim = mergeParts(trimParts);
    for (let i = 0; i < trimParts.length; i++) if (trimParts[i] !== trim) trimParts[i].dispose();
    let trimMesh = null;
    if (trim) {
      this._own(trim);
      const tm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.5), toneMapped: false });
      this._own(tm);
      trimMesh = new THREE.Mesh(trim, tm);
      g.add(trimMesh);
    }

    /* base ring on the ground — a landing mark you can see from the approach */
    const baseGeo = new THREE.RingGeometry(R * 0.55, R + 0.5, 60, 1);
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.translate(0, 0.02, 0);
    this._own(baseGeo);
    const baseMat = new THREE.MeshBasicMaterial({
      color: col.clone().multiplyScalar(0.85), transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this._own(baseMat);
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.renderOrder = 4;
    g.add(baseMesh);

    /* portal surface */
    const planeGeo = new THREE.PlaneGeometry(R * 2.3, PH + R + 0.6, 1, 1);
    planeGeo.translate(0, (PH + R + 0.6) * 0.5 - 0.28, 0);
    this._own(planeGeo);
    const portalMat = this._fxMaterial(PORTAL_VERT, PORTAL_FRAG, {
      uTime: { value: 0 }, uPower: { value: 0.35 },
      uR: { value: R }, uArchY: { value: PH },
      uColA: { value: col.clone() },
      uColB: { value: acc.clone().lerp(col, 0.35) },
    }, THREE.DoubleSide);
    const portal = new THREE.Mesh(planeGeo, portalMat);
    portal.renderOrder = 5;
    g.add(portal);

    /* particle vortex — position is a pure function of uTime, zero CPU */
    const pcount = Math.max(120, Math.round(700 * (this._decor * 0.7 + 0.3)));
    const vGeo = new THREE.BufferGeometry();
    const posArr = new Float32Array(pcount * 3);
    const aAngle = new Float32Array(pcount);
    const aRadius = new Float32Array(pcount);
    const aSpeed = new Float32Array(pcount);
    const aSeed = new Float32Array(pcount);
    const aSize = new Float32Array(pcount);
    const aDepth = new Float32Array(pcount);
    const rng = mulberry32(hashId(this.id + ':vortex'));
    for (let i = 0; i < pcount; i++) {
      aAngle[i] = rng() * Math.PI * 2;
      aRadius[i] = R * (0.35 + rng() * 0.95);
      aSpeed[i] = 0.12 + rng() * 0.22;
      aSeed[i] = rng();
      aSize[i] = 1.6 + rng() * 3.4;
      aDepth[i] = (rng() - 0.5) * 2.2;
    }
    vGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    vGeo.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    vGeo.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    vGeo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    vGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    vGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    vGeo.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));
    vGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, PH * 0.62, 0), R * 2.4);
    this._own(vGeo);
    const dpr = this.engine && this.engine.renderer && typeof this.engine.renderer.getPixelRatio === 'function'
      ? this.engine.renderer.getPixelRatio() : 1;
    const vortexMat = this._fxMaterial(VORTEX_VERT, VORTEX_FRAG, {
      uTime: { value: 0 }, uPower: { value: 0.35 }, uDpr: { value: dpr },
      uArchY: { value: PH }, uColor: { value: col.clone() },
    });
    const vortex = new THREE.Points(vGeo, vortexMat);
    vortex.frustumCulled = false;
    vortex.renderOrder = 6;
    g.add(vortex);

    /* beacon — the silhouette that says GOAL from across the stage */
    const beaconGeo = new THREE.CylinderGeometry(1.05, 3.1, 52, 22, 1, true);
    beaconGeo.translate(0, 26, 0);
    this._own(beaconGeo);
    const beaconMat = this._fxMaterial(beamVertexSrc(false), BEAM_FRAG, {
      uTime: { value: 0 }, uGain: { value: 0.62 },
      uColorOff: { value: col.clone().multiplyScalar(0.7) },
      uColorOn: { value: col.clone() },
      aState: { value: 1 }, aPulse: { value: 0 }, aSeed: { value: 0.37 },
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.renderOrder = 4;
    g.add(beacon);

    this.finish = {
      group: g,
      pos: pos.clone(),
      yaw: fin(fdef.yaw) ? fdef.yaw : 0,
      forward,
      radius: fin(fdef.r) ? fdef.r : 2.6,
      archY: PH, R,
      triggered: false,
      power: 0.35,
      targetPower: 0.35,
      flash: 0,
      portalMat, vortexMat, beaconMat, trimMesh, baseMat,
    };
  }

  /* ── coins ──────────────────────────────────────────────────────────── */

  _buildCoins() {
    const defs = Array.isArray(this.def.coins) ? this.def.coins : [];
    this.coins = [];
    if (!defs.length) return;

    let saved = null;
    if (this.save && typeof this.save.stage === 'function') {
      try {
        const s = this.save.stage(this.id);
        if (s && Array.isArray(s.coins)) saved = s.coins;
      } catch (e) { saved = null; }
    }

    const n = defs.length;
    for (let i = 0; i < n; i++) {
      const collected = !!(saved && saved.indexOf(i) >= 0);
      this.coins.push({
        index: i,
        pos: v3(defs[i].p, 0, 0, 0),
        collected,
        state: collected ? 0 : 1,
        pop: 0,
        phase: (i * 1.9) % 6.2831,
        seed: (i * 0.437) % 1,
      });
    }

    const g = new THREE.Group();
    g.name = 'coins';
    this.group.add(g);
    this._coinGroup = g;

    const aState = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aPop = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    aState.setUsage(THREE.DynamicDrawUsage);
    aPop.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      aState.setX(i, this.coins[i].state);
      aSeed.setX(i, this.coins[i].seed);
    }
    this._coinAttr = { aState, aPop, aSeed };

    const hot = this.palette.finish.clone().lerp(new THREE.Color(0xffffff), 0.35);
    const body = this.palette.finish.clone();

    const attach = (geo) => {
      geo.setAttribute('aState', aState);
      geo.setAttribute('aPop', aPop);
      geo.setAttribute('aSeed', aSeed);
    };

    /* core gem */
    const coreGeo = new THREE.IcosahedronGeometry(0.27, 1);
    this._own(coreGeo);
    attach(coreGeo);
    const coreMat = new THREE.ShaderMaterial({
      vertexShader: COIN_CORE_VERT, fragmentShader: COIN_CORE_FRAG,
      uniforms: {
        uTime: { value: 0 }, uColor: { value: body }, uHot: { value: hot },
        uKey: { value: this._keyDir.clone() },
      },
      transparent: false, depthWrite: true, depthTest: true, fog: false,
    });
    this._own(coreMat);
    const core = new THREE.InstancedMesh(coreGeo, coreMat, n);
    core.frustumCulled = false;
    core.castShadow = false;
    g.add(core);

    /* fresnel shell */
    const shellGeo = new THREE.IcosahedronGeometry(0.42, 2);
    this._own(shellGeo);
    attach(shellGeo);
    const shellMat = this._fxMaterial(COIN_FX_VERT, COIN_FX_FRAG, {
      uTime: { value: 0 }, uColor: { value: hot.clone() },
      uMode: { value: 0 }, uGain: { value: 1.0 }, uGhost: { value: 0 }, uSpin: { value: 0.9 },
    });
    const shell = new THREE.InstancedMesh(shellGeo, shellMat, n);
    shell.frustumCulled = false;
    shell.renderOrder = 6;
    g.add(shell);

    /* halo ring — the ghost marker left behind once collected */
    const haloGeo = new THREE.TorusGeometry(0.55, 0.022, 6, 56);
    haloGeo.rotateX(-Math.PI / 2.35);
    this._own(haloGeo);
    attach(haloGeo);
    const haloMat = this._fxMaterial(COIN_FX_VERT, COIN_FX_FRAG, {
      uTime: { value: 0 }, uColor: { value: body.clone() },
      uMode: { value: 1 }, uGain: { value: 1.0 }, uGhost: { value: 1 }, uSpin: { value: -1.4 },
    });
    const halo = new THREE.InstancedMesh(haloGeo, haloMat, n);
    halo.frustumCulled = false;
    halo.renderOrder = 6;
    g.add(halo);

    /* vertical shimmer trail so coins read from a distance */
    const shaftGeo = new THREE.CylinderGeometry(0.10, 0.30, 2.1, 12, 1, true);
    shaftGeo.translate(0, 1.05, 0);
    this._own(shaftGeo);
    attach(shaftGeo);
    const shaftMat = this._fxMaterial(COIN_FX_VERT, COIN_FX_FRAG, {
      uTime: { value: 0 }, uColor: { value: hot.clone().multiplyScalar(0.8) },
      uMode: { value: 2 }, uGain: { value: 0.9 }, uGhost: { value: 0 }, uSpin: { value: 0.25 },
    });
    const shaft = new THREE.InstancedMesh(shaftGeo, shaftMat, n);
    shaft.frustumCulled = false;
    shaft.renderOrder = 5;
    g.add(shaft);

    this._coinMeshes = [core, shell, halo, shaft];
    this._syncCoinMatrices();
  }

  _syncCoinMatrices() {
    const meshes = this._coinMeshes;
    if (!meshes) return;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      const bob = Math.sin(this._time * 1.35 + c.phase) * 0.17;
      _m1.makeTranslation(c.pos.x, c.pos.y + bob, c.pos.z);
      for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, _m1);
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
  }

  /* ── progress polyline ──────────────────────────────────────────────── */

  _buildProgressPath() {
    const pts = [];
    pts.push(v3(this.def.spawn && this.def.spawn.p, 0, 0, 0));
    for (let i = 0; i < this.checkpoints.length; i++) pts.push(this.checkpoints[i].pos.clone());
    if (this.finish) pts.push(this.finish.pos.clone());

    const clean = [];
    for (let i = 0; i < pts.length; i++) {
      if (!clean.length || clean[clean.length - 1].distanceToSquared(pts[i]) > 1e-4) clean.push(pts[i]);
    }
    this._progPts = clean;
    this._progSeg = [];
    this._progCum = [0];
    let total = 0;
    for (let i = 0; i < clean.length - 1; i++) {
      const l = clean[i].distanceTo(clean[i + 1]);
      this._progSeg.push(l);
      total += l;
      this._progCum.push(total);
    }
    this._progTotal = total;
  }

  _computeBounds() {
    this.bounds.makeEmpty();
    for (let i = 0; i < this._chunks.length; i++) {
      if (!this._chunks[i].box.isEmpty()) this.bounds.union(this._chunks[i].box);
    }
    for (let i = 0; i < this.hazards.length; i++) {
      const m = this.hazards[i].h.mesh;
      if (!m) continue;
      try {
        _box1.setFromObject(m);
        if (!_box1.isEmpty()) this.bounds.union(_box1);
      } catch (e) { /* ignore odd hazard graphs */ }
    }
    if (this.def.spawn && fin3(this.def.spawn.p)) {
      this.bounds.expandByPoint(_v1.set(this.def.spawn.p[0], this.def.spawn.p[1], this.def.spawn.p[2]));
    }
    for (let i = 0; i < this.checkpoints.length; i++) this.bounds.expandByPoint(this.checkpoints[i].pos);
    for (let i = 0; i < this.coins.length; i++) this.bounds.expandByPoint(this.coins[i].pos);
    if (this.finish) this.bounds.expandByPoint(this.finish.pos);
    if (this.bounds.isEmpty()) this.bounds.setFromCenterAndSize(_v1.set(0, 0, 0), _v2.set(10, 10, 10));
    this.bounds.expandByScalar(2);
  }

  /* ─────────────────────────────────────────────────────────────── loop ── */

  /**
   * Register the player so hazard/decor culling, light selection and pad
   * triggers track the FEET, not the eye. Game.loadStage calls this the moment
   * the stage is built; without it _resolvePlayerPos falls back to the camera,
   * which sits TUNE.eye (1.62 m) higher and skews every proximity test.
   */
  setPlayer(player) {
    this._playerRef = player || null;
    if (this._playerRef) this._warnedCameraFallback = false;
    return this;
  }

  /**
   * @param {number} dt seconds (already clamped by the engine)
   * @param {THREE.Vector3} [playerPos] optional explicit player position
   */
  update(dt, playerPos) {
    if (!this._built || this._disposed) return;
    if (!fin(dt)) dt = 0;
    if (dt > 0.25) dt = 0.25;

    this.clock += dt;
    this._time += dt;

    if (playerPos && fin(playerPos.x)) { this._pp.copy(playerPos); this._ppValid = true; }
    else this._ppValid = this._resolvePlayerPos();

    this._detectStand();
    this._updateHazards(dt);
    this._updateCulling(dt);
    this._updateLights(dt);
    this._updateCheckpoints(dt);
    this._updateCoins(dt);
    this._updateFinish(dt);

    if (this._ppValid) this._checkTriggers();

    if (this.mats && typeof this.mats.update === 'function') {
      try { this.mats.update(dt, this.clock); } catch (e) { /* optional hook */ }
    }
    if (this._debugOn) this._updateDebug();
  }

  /**
   * Feet first: the registered Player, then a player handed in through ctx.
   * The camera is a LAST-DITCH fallback that is 1.62 m too high for every
   * proximity test in this file, so reaching it is reported once, loudly,
   * naming the call that was missed — a silent 1.62 m error is unfindable.
   */
  _resolvePlayerPos() {
    const pr = this._playerRef;
    if (pr && pr.pos && fin(pr.pos.x)) { this._pp.copy(pr.pos); return true; }
    const cpr = this.ctx && this.ctx.player;
    if (cpr && cpr.pos && fin(cpr.pos.x)) { this._pp.copy(cpr.pos); return true; }
    const cam = this.engine && this.engine.camera;
    if (cam) {
      if (!this._warnedCameraFallback) {
        this._warnedCameraFallback = true;
        console.error('[Stage ' + this.id + '] no player registered — trigger detection, ' +
                      'culling and light selection are running against the CAMERA (eye height, ' +
                      '~1.62 m above the feet). Call stage.setPlayer(player) after Stage.load().');
      }
      if (cam.parent) this._pp.setFromMatrixPosition(cam.matrixWorld);
      else this._pp.copy(cam.position);
      return fin(this._pp.x);
    }
    return false;
  }

  /**
   * STAND DETECTION — the collision layer never calls `hazard.onStand()`, and
   * the hazard ctx carries no player handle, so crumble tiles (vanish.js),
   * sinkers and elevators (movers.js) were self-detecting by proximity through
   * a `ctx.player` that the live stage never provides: hazcheck measured every
   * crumble tile on spire-2 and every sinker/elevator on foundry-2, neon-1,
   * neon-2 and temple-3 as INERT in the shipped game. The stage is the one
   * place that knows both the player's ground contact and which hazard owns
   * that collider, so it fires the hook on a STAND TRANSITION — the frame the
   * player's grounded collider becomes this one, whether by landing or by
   * walking on from a neighbour — and never on a fly-over, a walk-underneath
   * or a teleport-in (the player arrives airborne; see Player.respawn()).
   * stage.update() runs before player.update() (game.js), so the contact it
   * reads is last frame's: one physics step of latency, no proximity band.
   */
  _detectStand() {
    const p = this._playerRef;
    const c = (p && p.grounded === true) ? (p.groundCollider || null) : null;
    if (c === this._standOn) return;
    this._standOn = c;
    if (!c) return;
    const ref = c.ref;
    if (ref && typeof ref.onStand === 'function') {
      try { ref.onStand(this.clock, c, p); } catch (e) { /* a hazard hook threw; the sim goes on */ }
    }
  }

  _updateHazards(dt) {
    const t = this.clock;
    const hz = this.hazards;
    const havePP = this._ppValid;
    const px = this._pp.x, py = this._pp.y, pz = this._pp.z;
    for (let i = 0; i < hz.length; i++) {
      const rec = hz[i];
      if (rec.broken) continue;
      const h = rec.h;

      /* DETERMINISM LAW: the transform is never skipped. */
      try { h.update(t, dt); } catch (e) { this._hazardError(rec, e); continue; }

      /* Visual-only gate at 90 m; re-evaluated exactly on re-entry. */
      if (havePP && rec.cullable && h.mesh) {
        const dx = px - rec.cx, dy = py - rec.cy, dz = pz - rec.cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - rec.radius;
        const far = d > HAZARD_VIS_DIST;
        if (far !== rec.far) {
          rec.far = far;
          h.mesh.visible = !far;
          if (typeof h.setVisual === 'function') {
            try { h.setVisual(!far); } catch (e) { /* optional hook */ }
          }
          if (!far) {
            try { h.update(t, dt); } catch (e) { this._hazardError(rec, e); continue; }
          }
        }
      }

      const cs = rec.colliders;
      for (let j = 0; j < cs.length; j++) {
        const c = cs[j];
        if (typeof c.update === 'function') c.update();
        if (typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
    }
  }

  _refreshHazardColliders() {
    for (let i = 0; i < this.hazards.length; i++) {
      const cs = this.hazards[i].colliders;
      for (let j = 0; j < cs.length; j++) {
        const c = cs[j];
        if (typeof c.update === 'function') c.update();
        if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
    }
  }

  _updateCulling(dt) {
    const chunks = this._chunks;
    if (!chunks.length) return;
    this._cullTimer -= dt;
    if (this._cullTimer > 0) return;
    this._cullTimer = 0.08;

    const cam = this.engine && this.engine.camera;
    let haveFrustum = false;
    if (cam) {
      cam.updateMatrixWorld();
      _projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreen);
      haveFrustum = true;
    }
    const px = this._ppValid ? this._pp.x : (cam ? cam.position.x : 0);
    const py = this._ppValid ? this._pp.y : (cam ? cam.position.y : 0);
    const pz = this._ppValid ? this._pp.z : (cam ? cam.position.z : 0);
    _v1.set(px, py, pz);

    const far = this._cullFar;
    const detailFar = this._detailFar;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const d = ch.box.distanceToPoint(_v1);
      let vis;
      if (d > far) vis = false;
      else if (d < SHADOW_KEEP) vis = true;         // keep near shadow casters alive
      else vis = haveFrustum ? _frustum.intersectsBox(ch.box) : true;
      if (vis !== ch.visible) { ch.visible = vis; ch.group.visible = vis; }
      if (vis) {
        const dv = d < detailFar;
        if (dv !== ch.detailVisible) { ch.detailVisible = dv; ch.detail.visible = dv; }
      }
    }
  }

  /**
   * Point the pool at the nearest sites.
   *
   * The pool is fixed: nothing is added, removed or hidden here, only moved,
   * re-tinted and faded. A slot must fade to zero before it re-targets, so a
   * light never visibly slides across a room — it dies on the fixture you left
   * and lifts on the one you reached, under the halo and floor pool that are
   * always there. Allocation-free; safe to call every frame.
   */
  _updateLights(dt) {
    const L = this.lights;
    const P = this._lightPool;
    if (!P.length) return;
    const nActive = Math.min(this._maxLights, P.length);

    this._lightTimer -= dt;
    if (this._lightTimer <= 0 && L.length) {
      this._lightTimer = LIGHT_SELECT_HZ;
      const px = this._pp.x, py = this._pp.y, pz = this._pp.z;
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const dx = px - l.pos.x, dy = py - l.pos.y, dz = pz - l.pos.z;
        l.d2 = this._ppValid ? dx * dx + dy * dy + dz * dz : 0;
        l.want = false;
      }

      /* partial selection sort — only the nActive nearest are ever ordered */
      const idx = this._lightIdx;
      idx.length = L.length;
      for (let i = 0; i < L.length; i++) idx[i] = i;
      const n = Math.min(nActive, L.length);
      for (let a = 0; a < n; a++) {
        let best = a;
        for (let b = a + 1; b < L.length; b++) if (L[idx[b]].d2 < L[idx[best]].d2) best = b;
        const tmp = idx[a]; idx[a] = idx[best]; idx[best] = tmp;
      }
      for (let a = 0; a < n; a++) {
        const l = L[idx[a]];
        if (l.base <= 0.01) continue;               // dark site: never holds a slot
        if (!this._ppValid || l.d2 < l.range2) l.want = true;
      }

      /* release slots whose site fell out of the set (or was removed) */
      for (let s = 0; s < P.length; s++) {
        const slot = P[s];
        const site = slot.site;
        if (!site) continue;
        if (!site.want || site.slot !== s || s >= nActive || this.lights.indexOf(site) < 0) {
          site.slot = -1;
          slot.site = null;
        }
      }

      /* fill free, fully-dark slots with wanted sites, nearest first */
      for (let a = 0; a < n; a++) {
        const l = L[idx[a]];
        if (!l.want || l.slot >= 0) continue;
        for (let s = 0; s < nActive; s++) {
          const slot = P[s];
          if (slot.site || slot.fade > 0.02) continue;
          slot.site = l;
          l.slot = s;
          slot.light.position.copy(l.pos);
          slot.light.color.copy(l.color);
          slot.light.distance = l.distance;
          slot.light.decay = l.decay;
          break;
        }
      }
    }

    const t = this.clock;
    for (let s = 0; s < P.length; s++) {
      const slot = P[s];
      const site = slot.site;
      const target = (site && s < nActive) ? 1 : 0;
      if (this._lightFirst) slot.fade = target;              // no lift-in on spawn
      else {
        const rate = target > slot.fade ? LIGHT_FADE_IN : LIGHT_FADE_OUT;
        slot.fade += (target - slot.fade) * Math.min(1, dt * rate);
      }
      if (!site || slot.fade < 0.004) {
        if (slot.fade < 0.004) slot.fade = 0;
        if (slot.light.intensity !== 0) slot.light.intensity = 0;
        continue;
      }
      /* a site can move (a rising lava pool, a swinging lantern) */
      slot.light.position.copy(site.pos);
      let k = 1;
      if (site.flicker) {
        const f = 0.62 + 0.22 * Math.sin(t * 11.3 + site.seed) +
                         0.16 * Math.sin(t * 27.7 + site.seed * 3.1);
        k = 1 - site.flickerAmt + site.flickerAmt * clamp(f, 0, 1.3);
      }
      slot.light.intensity = site.base * slot.fade * k;
    }
    this._lightFirst = false;
  }

  /* ── checkpoint animation + activation ──────────────────────────────── */

  _updateCheckpoints(dt) {
    const cps = this.checkpoints;
    if (!cps.length) return;
    const t = this._time;
    let dirty = false;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const target = cp.reached ? 1 : 0;
      if (Math.abs(cp.state - target) > 0.0005) {
        cp.state = damp ? damp(cp.state, target, 7.5, dt) : cp.state + (target - cp.state) * Math.min(1, dt * 7.5);
        dirty = true;
      } else if (cp.state !== target) { cp.state = target; dirty = true; }

      if (cp.pulse > 0) {
        cp.pulse = Math.max(0, cp.pulse - dt / 0.9);
        dirty = true;
      }

      if (cp.locking) {
        cp.angle += (cp.lockAngle - cp.angle) * Math.min(1, dt * 5.5);
        if (Math.abs(cp.lockAngle - cp.angle) < 0.004) { cp.angle = cp.lockAngle; cp.locking = false; }
        dirty = true;
      } else if (!cp.reached) {
        cp.angle += dt * 0.75;
        if (cp.angle > 6.2831853) cp.angle -= 6.2831853;
        dirty = true;
      } else {
        // locked: a slow breathing wobble so it is not dead on screen
        cp.angle = cp.lockAngle + Math.sin(t * 0.9 + cp.seed * 6.28) * 0.035;
        dirty = true;
      }
    }
    if (dirty) this._syncCheckpointAttrs(true);
    if (this._cpRing) this._cpRing.material.uniforms.uTime.value = t;
    if (this._cpGlyph) this._cpGlyph.material.uniforms.uTime.value = t;
    if (this._cpColumn) this._cpColumn.material.uniforms.uTime.value = t;
  }

  _syncCheckpointAttrs(withColor) {
    const a = this._cpAttr;
    if (!a) return;
    const cps = this.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      a.aState.setX(i, cp.state);
      a.aPulse.setX(i, cp.pulse);
      a.aAngle.setX(i, cp.angle);
    }
    a.aState.needsUpdate = true;
    a.aPulse.needsUpdate = true;
    a.aAngle.needsUpdate = true;
    if (withColor && this._cpBase) {
      const off = this.palette.checkpoint, on = this.palette.checkpointOn;
      for (let i = 0; i < cps.length; i++) {
        _colScratch.copy(off).lerp(on, cps[i].state).multiplyScalar(0.75 + 0.6 * cps[i].state);
        this._cpBase.setColorAt(i, _colScratch);
      }
      if (this._cpBase.instanceColor) this._cpBase.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Light a checkpoint. Never re-fires and never regresses to a lower index.
   *
   * OWNERSHIP (contract §17/§21): the Stage owns DETECTION and the pad's own
   * presentation — the ring, the glyph lock, the light column. It does NOT play
   * sound, spend particles, write the save or touch the HUD; it emits
   * `checkpoint` and Game does all of that, once. See _checkTriggers.
   *
   * @param {number} i
   * @param {boolean} [silent] skip the event (used when restoring a save)
   * @returns {boolean} whether this call changed the checkpoint index
   */
  activateCheckpoint(i, silent) {
    if (!fin(i) || i < 0 || i >= this.checkpoints.length) return false;
    if (i <= this.cpIndex) return false;

    for (let j = 0; j <= i; j++) {
      const cp = this.checkpoints[j];
      if (cp.reached) continue;
      cp.reached = true;
      cp.pulse = j === i ? 1 : 0;
      cp.lockAngle = Math.round(cp.angle / (Math.PI / 4)) * (Math.PI / 4);
      cp.locking = true;
    }
    this.cpIndex = i;
    this._syncCheckpointAttrs(true);

    if (!silent) this.events.emit('checkpoint', i, this.checkpoints[i]);
    return true;
  }

  /** Restore the lit state up to `i` without firing events (save restore / resetFrom). */
  setCheckpointIndex(i, silent) {
    if (!fin(i)) return;
    const n = this.checkpoints.length;
    const idx = clamp(Math.floor(i), -1, n - 1);
    for (let j = 0; j < n; j++) {
      const cp = this.checkpoints[j];
      const on = j <= idx;
      cp.reached = on;
      cp.state = on ? 1 : 0;
      cp.pulse = 0;
      cp.locking = false;
      if (on) { cp.lockAngle = Math.round(cp.angle / (Math.PI / 4)) * (Math.PI / 4); cp.angle = cp.lockAngle; }
    }
    this.cpIndex = idx;
    this._syncCheckpointAttrs(true);
    if (!silent && idx >= 0) this.events.emit('checkpoint', idx, this.checkpoints[idx]);
  }

  /* ── coins ──────────────────────────────────────────────────────────── */

  _updateCoins(dt) {
    if (!this.coins.length || !this._coinMeshes) return;
    const t = this._time;
    let dirty = false;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      const target = c.collected ? 0 : 1;
      if (Math.abs(c.state - target) > 0.0005) {
        c.state = damp ? damp(c.state, target, 9, dt) : c.state + (target - c.state) * Math.min(1, dt * 9);
        dirty = true;
      } else if (c.state !== target) { c.state = target; dirty = true; }
      if (c.pop > 0) { c.pop = Math.max(0, c.pop - dt / 0.42); dirty = true; }
    }
    if (dirty) this._syncCoinAttrs(false);
    this._syncCoinMatrices();
    const meshes = this._coinMeshes;
    for (let m = 0; m < meshes.length; m++) {
      const u = meshes[m].material.uniforms;
      if (u && u.uTime) u.uTime.value = t;
    }
  }

  _syncCoinAttrs() {
    const a = this._coinAttr;
    if (!a) return;
    for (let i = 0; i < this.coins.length; i++) {
      a.aState.setX(i, this.coins[i].state);
      a.aPop.setX(i, this.coins[i].pop);
    }
    a.aState.needsUpdate = true;
    a.aPop.needsUpdate = true;
  }

  /**
   * Take an orb. The pop animation is the Stage's own presentation; the sound,
   * the particle burst, the HUD line and the save write belong to Game and
   * arrive through the `coin` event.
   * @param {number} i
   * @param {boolean} [silent] skip the event (used when restoring a save)
   * @returns {boolean} true if this call collected it
   */
  collectCoin(i, silent) {
    if (!fin(i) || i < 0 || i >= this.coins.length) return false;
    const c = this.coins[i];
    if (c.collected) return false;
    c.collected = true;
    c.pop = 1;
    this._syncCoinAttrs();
    if (!silent) this.events.emit('coin', i, c);
    return true;
  }

  get coinsCollected() {
    let n = 0;
    for (let i = 0; i < this.coins.length; i++) if (this.coins[i].collected) n++;
    return n;
  }

  /* ── finish ─────────────────────────────────────────────────────────── */

  _updateFinish(dt) {
    const f = this.finish;
    if (!f) return;
    const t = this._time;
    const idle = 0.34 + 0.09 * Math.sin(t * 1.15);
    f.targetPower = f.triggered ? 1.35 : idle;
    f.power = damp ? damp(f.power, f.targetPower, 4.5, dt)
                   : f.power + (f.targetPower - f.power) * Math.min(1, dt * 4.5);
    if (f.flash > 0) f.flash = Math.max(0, f.flash - dt / 0.7);
    const p = f.power + f.flash * 1.6;
    f.portalMat.uniforms.uTime.value = t;
    f.portalMat.uniforms.uPower.value = p;
    f.vortexMat.uniforms.uTime.value = t;
    f.vortexMat.uniforms.uPower.value = p;
    f.beaconMat.uniforms.uTime.value = t;
    f.beaconMat.uniforms.aPulse.value = f.flash;
    f.beaconMat.uniforms.uGain.value = 0.55 + 0.55 * p;
    if (f.baseMat) f.baseMat.opacity = 0.28 + 0.32 * p;
  }

  /**
   * Fire the gate. The portal's own flash/power surge is Stage presentation;
   * the fanfare, the clear card and the save write arrive from Game via the
   * `finish` event. A stage with no finish (the hub) can never fire.
   * @param {boolean} [silent]
   * @returns {boolean} true if this call fired the finish
   */
  triggerFinish(silent) {
    const f = this.finish;
    if (!f || f.triggered) return false;
    f.triggered = true;
    f.flash = 1;
    if (!silent) this.events.emit('finish', f);
    return true;
  }

  /* ── trigger detection ──────────────────────────────────────────────── */

  /**
   * THE ONLY checkpoint / coin / finish detector in the game. Game does not run
   * a second one: it listens to stage.events, so each event fires exactly once
   * with one radius and one height window (see checkpointAt / coinAt / finishAt).
   * Runs against the feet — see _resolvePlayerPos.
   */
  _checkTriggers() {
    const p = this._pp;

    /* checkpoints: only ever look forward, never re-fire a lower index */
    const cp = this.checkpointAt(p);
    if (cp >= 0) this.activateCheckpoint(cp, false);

    /* coins: more than one can be in reach on a fast pass */
    let coin = this.coinAt(p);
    while (coin >= 0) {
      this.collectCoin(coin, false);
      coin = this.coinAt(p);
    }

    if (this.finish && !this.finish.triggered && this.finishAt(p)) this.triggerFinish(false);
  }

  /* ── stateless queries (for a Player/Game that prefers to drive triggers) ─ */

  /** @returns {number} index of the un-reached checkpoint pad at `p`, else -1 */
  checkpointAt(p) {
    if (!p) return -1;
    for (let i = this.cpIndex + 1; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (cp.reached) continue;
      const dx = p.x - cp.pos.x, dz = p.z - cp.pos.z, dy = p.y - cp.pos.y;
      if (dx * dx + dz * dz <= cp.radius * cp.radius && dy > -1.7 && dy < 3.6) return i;
    }
    return -1;
  }

  /** @returns {number} index of an uncollected coin at `p`, else -1 */
  coinAt(p) {
    if (!p) return -1;
    for (let i = 0; i < this.coins.length; i++) {
      const c = this.coins[i];
      if (c.collected) continue;
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z, dy = p.y - c.pos.y;
      if (dx * dx + dz * dz <= 1.75 && dy > -1.9 && dy < 1.9) return i;
    }
    return -1;
  }

  /** @returns {boolean} whether `p` is inside the finish gate */
  finishAt(p) {
    const f = this.finish;
    if (!f || !p) return false;
    const dx = p.x - f.pos.x, dz = p.z - f.pos.z, dy = p.y - f.pos.y;
    return dx * dx + dz * dz <= f.radius * f.radius && dy > -2.0 && dy < 5.2;
  }

  /* ─────────────────────────────────────────────────── reset / queries ── */

  /** Full stage reset (restart run): clock 0, every hazard back to phase 0. */
  reset() {
    this.clock = 0;
    this._time = 0;
    this.setCheckpointIndex(-1, true);
    if (this.finish) {
      this.finish.triggered = false;
      this.finish.flash = 0;
      this.finish.power = 0.35;
    }
    this._resetHazards(0);
    this._cullTimer = 0;
    this._lightTimer = 0;
  }

  /**
   * Respawn reset. Rewinds the stage clock to the checkpoint's authored
   * clockOffset so the gauntlet ahead presents an identical phase every attempt
   * — muscle memory, not luck.
   */
  resetFrom(cpIndex) {
    let idx = fin(cpIndex) ? Math.floor(cpIndex) : -1;
    idx = clamp(idx, -1, this.checkpoints.length - 1);
    const cp = idx >= 0 ? this.checkpoints[idx] : null;
    this.clock = cp && fin(cp.clockOffset) ? cp.clockOffset : 0;
    this.setCheckpointIndex(idx, true);
    if (this.finish) {
      this.finish.triggered = false;
      this.finish.flash = 0;
    }
    this._resetHazards(this.clock);
    this._cullTimer = 0;
  }

  /** Re-arm crumble/vanish, un-sink sinkers, rewind chasers. */
  _resetHazards(t) {
    /* Forget the last stand: a player still grounded on a re-armed tile after a
       reset must re-trigger it on the next frame, not ride it for free. */
    this._standOn = null;
    for (let i = 0; i < this.hazards.length; i++) {
      const rec = this.hazards[i];
      const h = rec.h;
      rec.broken = false;
      if (typeof h.rearm === 'function') { try { h.rearm(t); } catch (e) { /* optional */ } }
      if (typeof h.reset === 'function') {
        try { h.reset(t); } catch (e) { this._hazardError(rec, e); continue; }
      }
      /* reset() must place it exactly where update(t) would; call update so a
         hazard that only moves in update() is still exact on the first frame. */
      try { h.update(t, 0); } catch (e) { this._hazardError(rec, e); continue; }
      if (h.mesh && rec.far) { h.mesh.visible = true; rec.far = false; }
      for (let j = 0; j < rec.colliders.length; j++) {
        const c = rec.colliders[j];
        if (typeof c.update === 'function') c.update();
        if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
    }
  }

  /** @returns {{pos: THREE.Vector3, yaw: number}} */
  spawnFor(cpIndex) {
    const idx = fin(cpIndex) ? Math.floor(cpIndex) : -1;
    if (idx >= 0 && idx < this.checkpoints.length) {
      const cp = this.checkpoints[idx];
      return { pos: cp.pos.clone(), yaw: cp.yaw };
    }
    const sp = this.def.spawn || {};
    return { pos: v3(sp.p, 0, 0, 0), yaw: fin(sp.yaw) ? sp.yaw : 0 };
  }

  /**
   * Distance along the spawn -> checkpoints -> finish polyline, 0..1.
   * Projects onto the nearest segment and accumulates. Allocation-free.
   */
  progress(playerPos) {
    const pts = this._progPts;
    if (!playerPos || pts.length < 2 || this._progTotal <= 0) return 0;
    let bestD = Infinity, bestI = 0, bestT = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      _v2.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const len2 = _v2.lengthSq();
      if (len2 < 1e-8) continue;
      _v3.set(playerPos.x - a.x, playerPos.y - a.y, playerPos.z - a.z);
      let t = _v3.dot(_v2) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + _v2.x * t - playerPos.x;
      const cy = a.y + _v2.y * t - playerPos.y;
      const cz = a.z + _v2.z * t - playerPos.z;
      const d = cx * cx + cy * cy + cz * cz;
      if (d < bestD) { bestD = d; bestI = i; bestT = t; }
    }
    const along = this._progCum[bestI] + bestT * this._progSeg[bestI];
    return clamp(along / this._progTotal, 0, 1);
  }

  /* ──────────────────────────────────────────────────────────── debug ── */

  /** Collider + kill-volume wireframes (dev mode only). */
  /**
   * Force every chunk (and every culled hazard mesh) visible and render two
   * frames so ALL shader programs compile and every merged geometry uploads NOW,
   * while the intro card covers the screen — then restore culling.
   *
   * Why: first visibility is expensive. Measured at temple-1 cp3: respawning
   * into a never-yet-visible chunk compiled 10 programs and uploaded 149
   * geometries in ONE 1712 ms frame (probe 2026-08-31). Death is exactly when a
   * chunk tends to become visible for the first time (the checkpoint may sit in
   * a chunk the player sprinted past), so the hitch landed inside the respawn.
   */
  warmup(renderer, camera) {
    /* Force EVERY object visible and un-culled — not just chunks. State-driven
       art hides descendants until a phase turns them on (a vanish platform's
       ghost wireframe, warn flakes, a crusher's warning lamp glow): a chunk- or
       hazard-level force misses those, and their first appearance mid-death
       still compiled 9 programs in a 1.3 s frame at temple-1 cp3 even after the
       whole-stage-frustum warmup. Save exact flags, restore after. */
    /* Exercise every lazy build path FIRST. resetFrom() is what a death runs,
       and re-arming state hazards (a crumble platform's shard debris, a vanish
       ghost) creates meshes and MATERIAL VARIANTS on their first reset — the
       named culprits at temple-1 cp3 were asc.ice.temple / fb_sand / an
       emissive + six shadow variants, all born inside the first resetFrom(3).
       Run every checkpoint's reset now so those children exist before the
       compile pass below, then restore a pristine stage. */
    try {
      for (let i = 0; i < this.checkpoints.length; i++) this.resetFrom(i);
      this.reset();
    } catch (e) { /* never break a load */ }
    const saved = [];
    for (const ch of this._chunks) {
      saved.push([ch, ch.visible, ch.detailVisible]);
      ch.visible = true; ch.group.visible = true;
      if (ch.detail) { ch.detailVisible = true; ch.detail.visible = true; }
    }
    const objFlags = [];
    /* Traverse the whole SCENE, not stage.group: the nine cp3 programs turned
       out to belong to scene-level containers (props/glow placed beside the
       stage group) whose geometry first renders when the death cam looks down. */
    const sceneRoot = this.group.parent || this.group;
    sceneRoot.traverse((o) => {
      objFlags.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    const hazVis = [];
    for (const h of this.hazards) {
      if (h.mesh) { hazVis.push([h.mesh, h.mesh.visible]); h.mesh.visible = true; }
    }
    try {
      const scene = this.group.parent || this.group;
      /* compile() and render() both respect FRUSTUM culling, so warming up
         through the player's camera misses everything the player cannot see
         from spawn — which is exactly what a death cam then reveals (it pitches
         down): temple-1 cp3 overlooks a well whose interior compiled 10 programs
         in one 1611 ms frame mid-death. Use a synthetic wide-angle camera high
         over the stage centre looking straight down: the whole course fits in
         one frustum, so every material compiles and every geometry uploads in
         these covered renders. */
      const b = this.bounds;
      const warmCam = new THREE.PerspectiveCamera(110, 1.78, 0.1, 4000);
      /* A fresh camera sees only layer 0 — meshes on selective layers (glow /
         bloom overlays) upload their geometry but never DRAW, so their programs
         still compile mid-death. See everything. */
      warmCam.layers.enableAll();
      if (b && isFinite(b.min.x)) {
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const spanX = b.max.x - b.min.x, spanZ = b.max.z - b.min.z;
        const h = Math.max(spanX, spanZ) * 0.42 + (b.max.y - b.min.y) + 20;
        warmCam.position.set(cx, b.max.y + h, cz);
        warmCam.lookAt(cx, b.min.y, cz);
      } else {
        warmCam.copy(camera);
      }
      warmCam.updateMatrixWorld(true);
      /* CRITICAL: render into a LINEAR HalfFloat target, not the canvas. The
         program cache key includes the output colour space, and real frames go
         scene -> composer RT (srgb-linear); a warmup render to the canvas
         compiles only useless `srgb` variants — which is why every earlier
         warmup iteration left the death-frame compiles intact (the cacheKey
         diff finally named it: srgb vs srgb-linear). */
      const warmRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      const prevRT = renderer.getRenderTarget();
      renderer.setRenderTarget(warmRT);
      renderer.render(scene, warmCam);       // compiles + uploads + shadow variants
      renderer.render(scene, warmCam);
      // one pass through the PLAYER camera too, for anything whose shader
      // depends on the real view configuration
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevRT);
      warmRT.dispose();
    } catch (e) { /* a warm-up must never break a load */ }
    for (const [o, v, fc] of objFlags) { o.visible = v; o.frustumCulled = fc; }
    for (const [ch, v, dv] of saved) {
      ch.visible = v; ch.group.visible = v;
      if (ch.detail) { ch.detailVisible = dv; ch.detail.visible = dv; }
    }
    for (const [m, v] of hazVis) m.visible = v;
  }

  debugDraw(on) {
    this._debugOn = !!on;
    if (this._debugOn && !this._debugGroup) this._buildDebug();
    if (this._debugGroup) this._debugGroup.visible = this._debugOn;
    if (this._debugOn) this._updateDebug();
    return this._debugOn;
  }

  _buildDebug() {
    const g = new THREE.Group();
    g.name = 'stage:debug';
    g.matrixAutoUpdate = false;
    this.group.add(g);
    this._debugGroup = g;

    const boxes = Math.min(MAX_DEBUG_BOXES, this._allColliders.length + this.killVolumes.length + 4);
    const verts = boxes * 24;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    const ca = new THREE.BufferAttribute(col, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', ca);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this._own(geo);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      depthTest: false, toneMapped: false, fog: false,
    });
    this._own(mat);
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 999;
    g.add(lines);
    this._debugLines = lines;
    this._debugCap = boxes;

    /* progress polyline */
    if (this._progPts.length >= 2) {
      const pgeo = new THREE.BufferGeometry();
      const parr = new Float32Array(this._progPts.length * 3);
      for (let i = 0; i < this._progPts.length; i++) {
        parr[i * 3] = this._progPts[i].x;
        parr[i * 3 + 1] = this._progPts[i].y;
        parr[i * 3 + 2] = this._progPts[i].z;
      }
      pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
      this._own(pgeo);
      const pmat = new THREE.LineBasicMaterial({
        color: 0xffe066, depthTest: false, toneMapped: false, fog: false,
        transparent: true, opacity: 0.7,
      });
      this._own(pmat);
      const pline = new THREE.Line(pgeo, pmat);
      pline.frustumCulled = false;
      pline.renderOrder = 999;
      g.add(pline);
    }
  }

  _updateDebug() {
    const lines = this._debugLines;
    if (!lines) return;
    const pa = lines.geometry.attributes.position;
    const ca = lines.geometry.attributes.color;
    const pos = pa.array, col = ca.array;
    let box = 0;
    const cap = this._debugCap;

    for (let i = 0; i < this._allColliders.length && box < cap; i++) {
      const c = this._allColliders[i];
      if (!c || !c.center || !c.half) continue;
      let r = 0.25, gch = 1.0, b = 0.45;
      switch (c.surface) {
        case 'ice':      r = 0.45; gch = 0.9; b = 1.0; break;
        case 'bounce':   r = 1.0;  gch = 0.9; b = 0.2; break;
        case 'speed':    r = 1.0;  gch = 0.5; b = 0.1; break;
        case 'conveyor': r = 1.0;  gch = 0.65; b = 0.15; break;
        case 'sticky':   r = 0.8;  gch = 0.35; b = 1.0; break;
        default:         r = 0.25; gch = 1.0; b = 0.45; break;
      }
      const dim = c.active === false ? 0.18 : 1;
      writeBox(pos, col, box, c.center, c.half, c.quat || null, r * dim, gch * dim, b * dim);
      box++;
    }
    for (let i = 0; i < this.killVolumes.length && box < cap; i++) {
      if (!kvBox(this.killVolumes[i], _box1)) continue;
      _box1.getCenter(_v4);
      _box1.getSize(_v5).multiplyScalar(0.5);
      /* clamp the void slab so it does not blow out the debug view */
      if (_v5.x > 60) { _v5.x = 60; _v4.x = this._pp.x; }
      if (_v5.z > 60) { _v5.z = 60; _v4.z = this._pp.z; }
      if (_v5.y > 60) { _v5.y = 60; _v4.y = this.killY - 60; }
      const dim = this.killVolumes[i].active === false ? 0.2 : 1;
      writeBox(pos, col, box, _v4, _v5, null, 1.0 * dim, 0.12 * dim, 0.12 * dim);
      box++;
    }
    lines.geometry.setDrawRange(0, box * 24);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  }

  /* ───────────────────────────────────────────────────────── plumbing ── */

  _own(x) {
    if (!x) return x;
    if (x.isBufferGeometry) this._ownedGeo.add(x);
    else if (x.isMaterial) this._ownedMat.add(x);
    else if (x.isTexture) this._ownedTex.add(x);
    return x;
  }

  _fxMaterial(vert, frag, uniforms, side) {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: side || THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this._own(m);
    return m;
  }

  _mat(key) {
    let m = this._matCache.get(key);
    if (m) return m;
    try {
      if (this.mats && typeof this.mats.get === 'function') m = this.mats.get(key, this.themeId);
    } catch (e) { m = null; }
    if (!m || !m.isMaterial) {
      m = this._makeFallbackMat(key);
      this._own(m);
    }
    this._matCache.set(key, m);
    return m;
  }

  _makeFallbackMat(key) {
    const pal = this.palette;
    const table = {
      stone:    { color: pal.safe.getHex(), rough: 0.86, metal: 0.04 },
      metal:    { color: 0x8f9aa8, rough: 0.36, metal: 0.92 },
      panel:    { color: 0x59677a, rough: 0.55, metal: 0.35 },
      grate:    { color: 0x4a5563, rough: 0.62, metal: 0.7 },
      ice:      { color: 0xbfe9ff, rough: 0.12, metal: 0.05 },
      glass:    { color: 0xcfe8ff, rough: 0.06, metal: 0.0 },
      emissive: { color: pal.accent.getHex(), rough: 0.4, metal: 0.1, emissive: pal.accent.getHex() },
      lava:     { color: 0x2a0a04, rough: 0.75, metal: 0.0, emissive: pal.kill.getHex() },
      obsidian: { color: 0x16181f, rough: 0.34, metal: 0.28 },
      crystal:  { color: 0x9fd8ff, rough: 0.14, metal: 0.1 },
      wood:     { color: 0x6b4a2f, rough: 0.9, metal: 0.0 },
      sand:     { color: 0xc9b184, rough: 0.95, metal: 0.0 },
      neon:     { color: pal.accent.getHex(), rough: 0.3, metal: 0.2, emissive: pal.accent.getHex() },
      checker:  { color: 0x9aa6b4, rough: 0.7, metal: 0.1 },
      hazard:   { color: pal.kill.getHex(), rough: 0.5, metal: 0.2, emissive: pal.kill.getHex() },
      rubber:   { color: 0x2b2f36, rough: 0.98, metal: 0.0 },
      conveyor: { color: 0x3a4048, rough: 0.8, metal: 0.3 },
      cloud:    { color: 0xe7f1ff, rough: 1.0, metal: 0.0 },
    };
    const t = table[key] || table.stone;
    const m = new THREE.MeshStandardMaterial({
      color: t.color, roughness: t.rough, metalness: t.metal,
      emissive: t.emissive !== undefined ? t.emissive : 0x000000,
      emissiveIntensity: t.emissive !== undefined ? 0.9 : 0,
      flatShading: false,
    });
    m.name = 'stage-fallback:' + key;
    return m;
  }

  /* ─────────────────────────────────────────────────────────── dispose ── */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._settingsCb && Settings && typeof Settings.off === 'function') {
      try { Settings.off(this._settingsCb); } catch (e) { /* optional */ }
    }
    this._settingsCb = null;

    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i].h;
      if (h && typeof h.dispose === 'function') {
        try { h.dispose(); } catch (e) { console.error('[Stage ' + this.id + '] hazard dispose failed', e); }
      }
    }

    if (this.broadphase && typeof this.broadphase.remove === 'function') {
      for (let i = 0; i < this._allColliders.length; i++) {
        try { this.broadphase.remove(this._allColliders[i]); } catch (e) { /* best effort */ }
      }
    }

    for (let i = 0; i < this._lightPool.length; i++) {
      const l = this._lightPool[i].light;
      if (l.parent) l.parent.remove(l);
      if (typeof l.dispose === 'function') l.dispose();
    }
    this._lightPool.length = 0;
    if (this._glowField) {
      if (this._glowField.parent) this._glowField.parent.remove(this._glowField);
      this._glowField = null;
    }

    if (this.group.parent) this.group.parent.remove(this.group);

    this._ownedGeo.forEach((g) => { try { g.dispose(); } catch (e) { /* already gone */ } });
    this._ownedMat.forEach((m) => { try { m.dispose(); } catch (e) { /* already gone */ } });
    this._ownedTex.forEach((t) => { try { t.dispose(); } catch (e) { /* already gone */ } });
    this._ownedGeo.clear();
    this._ownedMat.clear();
    this._ownedTex.clear();

    this.events.clear();
    this._matCache.clear();
    this._propCache.clear();
    this._chunkMap.clear();
    this._chunks.length = 0;
    this._allColliders.length = 0;
    this._staticColliders.length = 0;
    this.killVolumes.length = 0;
    this.hazards.length = 0;
    this.checkpoints.length = 0;
    this.coins.length = 0;
    this.lights.length = 0;
    this._glowSites.length = 0;
    this.texts.length = 0;
    this._cpAttr = null;
    this._coinAttr = null;
    this._coinMeshes = null;
    this._debugLines = null;
    this._debugGroup = null;
    this.finish = null;
    this._built = false;
  }
}

/* =========================================================================
 * module-local helpers used by Stage (kept out of the class for hoisting)
 * ========================================================================= */

const _colScratch = new THREE.Color();
const _e1Holder = new THREE.Object3D();

function hashId(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/**
 * mergeGeometries refuses a batch that mixes indexed and non-indexed inputs —
 * and three's primitives disagree (ExtrudeGeometry/LatheGeometry are NOT
 * indexed, Box/Torus/Cylinder/Plane ARE). Give everything a trivial index.
 */
function ensureIndexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  g.setIndex(new THREE.BufferAttribute(arr, 1));
  return g;
}

/**
 * The ONLY merge entry point. Normalises index-ness and the attribute set
 * first, so a mixed batch of primitives can never silently return null.
 * Consumes nothing: the caller still disposes `parts`.
 * @returns {THREE.BufferGeometry|null}
 */
function mergeParts(parts) {
  if (!parts || !parts.length) return null;
  const list = [];
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i];
    if (g && g.attributes && g.attributes.position) list.push(ensureIndexed(g));
  }
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  unifyAttributes(list);
  let m = null;
  try { m = mergeGeometries(list, false); } catch (e) { m = null; }
  return m;
}

/**
 * Lift ONE material group out of a multi-material geometry into a standalone,
 * compacted geometry (vertices remapped, only the group's triangles kept).
 *
 * This is what lets a builder's 5-slot platform mesh take part in the static
 * merge at all: mergeGeometries(..., useGroups=true) rewrites materialIndex to
 * the geometry's position in the batch, so it cannot preserve real slots —
 * splitting first and merging per material is the only path to one draw call
 * per (chunk, material).
 * @returns {THREE.BufferGeometry|null} null if the geometry cannot be split
 */
function extractGroup(src, start, count) {
  const attrs = src.attributes;
  if (!attrs.position) return null;
  for (const name in attrs) {
    if (attrs[name].isInterleavedBufferAttribute) return null;  // not worth unpacking
  }
  const index = src.index;
  const g = new THREE.BufferGeometry();

  if (!index) {
    // groups address vertices directly
    const n = Math.min(count, attrs.position.count - start);
    if (n <= 0) return null;
    for (const name in attrs) {
      const a = attrs[name];
      const its = a.itemSize;
      g.setAttribute(name, new THREE.BufferAttribute(
        a.array.slice(start * its, (start + n) * its), its, a.normalized));
    }
    return g;
  }

  const n = Math.min(count, index.count - start);
  if (n <= 0) return null;
  const srcIdx = index.array;
  const vCount = attrs.position.count;
  const remap = new Int32Array(vCount).fill(-1);
  const newIdx = new Uint32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const oi = srcIdx[start + i];
    let ni = remap[oi];
    if (ni < 0) { ni = next++; remap[oi] = ni; }
    newIdx[i] = ni;
  }
  for (const name in attrs) {
    const a = attrs[name];
    const its = a.itemSize;
    const out = new a.array.constructor(next * its);
    for (let oi = 0; oi < vCount; oi++) {
      const ni = remap[oi];
      if (ni < 0) continue;
      const so = oi * its, no = ni * its;
      for (let c = 0; c < its; c++) out[no + c] = a.array[so + c];
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, its, a.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(next > 65535 ? newIdx : new Uint16Array(newIdx), 1));
  return g;
}

/** clone (or lift a group) + bake matrix + strip to a merge-safe attribute set */
function normaliseGeo(src, matrix, gStart, gCount) {
  let g;
  if (gStart >= 0) {
    g = extractGroup(src, gStart, gCount);
    if (!g) return null;
  } else {
    try { g = src.clone(); } catch (e) { return null; }
  }
  g.applyMatrix4(matrix);
  g.morphAttributes = {};
  g.clearGroups();
  const keep = { position: 1, normal: 1, uv: 1, uv1: 1, color: 1 };
  const names = Object.keys(g.attributes);
  for (let i = 0; i < names.length; i++) {
    if (!keep[names[i]]) g.deleteAttribute(names[i]);
  }
  if (!g.attributes.position) { g.dispose(); return null; }
  if (!g.attributes.normal) g.computeVertexNormals();
  ensureIndexed(g);
  return g;
}

/**
 * mergeGeometries requires an identical attribute set on every input.
 * Take the intersection, then top up the two we can synthesise (uv, normal).
 */
function unifyAttributes(geos) {
  const common = {};
  const first = Object.keys(geos[0].attributes);
  for (let i = 0; i < first.length; i++) common[first[i]] = true;
  for (let i = 1; i < geos.length; i++) {
    const names = Object.keys(common);
    for (let n = 0; n < names.length; n++) {
      if (!geos[i].attributes[names[n]]) delete common[names[n]];
    }
  }
  common.position = true;
  common.normal = true;
  common.uv = true;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    const have = Object.keys(g.attributes);
    for (let h = 0; h < have.length; h++) {
      if (!common[have[h]]) g.deleteAttribute(have[h]);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
  }
}

/** unit-cube edge template: 12 edges as 24 corner indices */
const CUBE_EDGES = [
  0, 1, 1, 3, 3, 2, 2, 0,
  4, 5, 5, 7, 7, 6, 6, 4,
  0, 4, 1, 5, 2, 6, 3, 7,
];
const CUBE_CORNERS = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];

function writeBox(pos, col, boxIndex, center, half, quat, r, g, b) {
  let o = boxIndex * 24 * 3;
  for (let e = 0; e < 24; e++) {
    const c = CUBE_CORNERS[CUBE_EDGES[e]];
    _v6.set(c[0] * half.x, c[1] * half.y, c[2] * half.z);
    if (quat) _v6.applyQuaternion(quat);
    pos[o] = center.x + _v6.x;
    pos[o + 1] = center.y + _v6.y;
    pos[o + 2] = center.z + _v6.z;
    col[o] = r; col[o + 1] = g; col[o + 2] = b;
    o += 3;
  }
}

/** Tolerant KillVolume -> Box3 extraction for the debug view. */
function kvBox(kv, out) {
  if (!kv) return false;
  if (kv.box && kv.box.isBox3 && !kv.box.isEmpty()) { out.copy(kv.box); return true; }
  if (kv.min && kv.max && fin(kv.min.x) && fin(kv.max.x)) { out.set(kv.min, kv.max); return true; }
  if (kv.center && kv.half && fin(kv.center.x) && fin(kv.half.x)) {
    out.setFromCenterAndSize(kv.center, _v3.set(kv.half.x * 2, kv.half.y * 2, kv.half.z * 2));
    return true;
  }
  if (kv.center && fin(kv.radius)) {
    out.setFromCenterAndSize(kv.center, _v3.set(kv.radius * 2, kv.radius * 2, kv.radius * 2));
    return true;
  }
  if (kv.a && kv.b && fin(kv.a.x) && fin(kv.b.x)) {
    out.makeEmpty();
    out.expandByPoint(kv.a);
    out.expandByPoint(kv.b);
    out.expandByScalar(fin(kv.radius) ? kv.radius : 0.4);
    return true;
  }
  return false;
}

export default Stage;
