// runtime/hazards/lasers.js
// ASCENDANT — beam hazards (laser, laserGrid, laserSweep, turret) + the shared hazard kit.
//
// NOTE ON FILE LAYOUT: the `Hazard` base class and the shared hazard helpers live at the top of
// this file rather than in a separate `_kit.js` because the hazard package is split across two
// authors and the file set is fixed by the module contract. `index.js` re-exports `Hazard` from
// here (and imports this module FIRST) so that any sibling that does
// `import { Hazard } from './index.js'` links against an already-evaluated binding.
//
// DETERMINISM LAW (CONTRACT §16): every hazard's state is a pure function of the stage clock `t`
// and its `def`. Nothing here integrates position frame to frame. `reset(t)` runs the same math as
// `update(t)` with one-shot effects (sfx / particle bursts) suppressed.
//
// SPACE CONVENTION: hazard geometry is authored in WORLD coordinates inside `hazard.mesh`, which is
// left at identity. Colliders and kill volumes are world-space structs (CONTRACT §11), so keeping
// the render group at identity means art and physics can never drift apart. The one exception is a
// sweeping beam, which lives under an explicit pivot whose transform is computed analytically.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider, KillVolume } from '../world/collider.js';
import { Mats } from '../world/materials.js';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/util.js';

/* ======================================================================================
   SHARED HAZARD KIT
   ====================================================================================== */

const _kv = new THREE.Vector3();
const _kv2 = new THREE.Vector3();
const _kq = new THREE.Quaternion();
const _km = new THREE.Matrix4();
const _kc = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

/** Fallback palette used when a theme has not been handed to the hazard. */
const FALLBACK_PALETTE = {
  safe: 0xbcd6ff, safeEdge: 0x7ef0ff, kill: 0xff2f4d, killGlow: 0xff7a3c,
  checkpoint: 0x35e0ff, checkpointOn: 0x9dffe0, finish: 0xffe066,
  accent: 0x5ec8ff, deco: 0x6d7f9c,
};

/** number-with-default that tolerates null/undefined/NaN. */
export function num(v, d) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : d;
}

/** Build a Vector3 from [x,y,z] | {x,y,z} | Vector3 | number, with a default. */
export function v3(src, dx = 0, dy = 0, dz = 0, out) {
  const o = out || new THREE.Vector3();
  if (src == null) return o.set(dx, dy, dz);
  if (Array.isArray(src)) return o.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  if (typeof src === 'number') return o.set(src, src, src);
  if (typeof src.x === 'number') return o.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  return o.set(dx, dy, dz);
}

/** Full-size vector (a stage `s` is FULL extents, not half extents). */
export function sizeVec(src, dx, dy, dz, out) {
  const o = v3(src, dx, dy, dz, out);
  o.x = Math.max(1e-3, Math.abs(o.x));
  o.y = Math.max(1e-3, Math.abs(o.y));
  o.z = Math.max(1e-3, Math.abs(o.z));
  return o;
}

/** Normalised direction with a safe fallback when the input is degenerate. */
export function dirVec(src, fx = 0, fy = 1, fz = 0, out) {
  const o = v3(src, fx, fy, fz, out);
  if (o.lengthSq() < 1e-10) o.set(fx, fy, fz);
  return o.normalize();
}

/** Theme palette with fallbacks so a hazard never renders untinted. */
export function palette(ctx) {
  const p = (ctx && (ctx.palette || (ctx.theme && ctx.theme.palette))) || null;
  if (!p) return FALLBACK_PALETTE;
  const out = {};
  for (const k in FALLBACK_PALETTE) out[k] = p[k] !== undefined ? p[k] : FALLBACK_PALETTE[k];
  return out;
}

export function themeId(ctx) {
  return (ctx && (ctx.themeId || (ctx.theme && ctx.theme.id))) || 'neon';
}

/** Shared PBR material from the Mats registry. Never cloned per object. */
export function hazMat(ctx, key) {
  const reg = (ctx && ctx.mats) || Mats;
  try {
    const m = reg && typeof reg.get === 'function' ? reg.get(key, themeId(ctx)) : null;
    if (m) return m;
  } catch (e) { /* fall through to the safety-net material below */ }
  return fallbackMat(key);
}

// --- safety-net materials (only reached if world/materials.js is unavailable) --------------
const _fallbackMats = new Map();
const FALLBACK_SPEC = {
  stone:    [0x8d94a3, 0.92, 0.02], metal:  [0x9aa6b8, 0.42, 0.85],
  panel:    [0x7f8ba0, 0.58, 0.35], grate:  [0x6a7486, 0.60, 0.70],
  ice:      [0xbfe8ff, 0.12, 0.05], glass:  [0xcfe8ff, 0.06, 0.02],
  emissive: [0x7ef0ff, 0.35, 0.00], lava:   [0xff5a1e, 0.72, 0.05],
  obsidian: [0x1b1f2a, 0.30, 0.25], crystal:[0x9fd8ff, 0.14, 0.10],
  wood:     [0x8a6740, 0.86, 0.00], sand:   [0xd8c49a, 0.95, 0.00],
  neon:     [0x54e8ff, 0.30, 0.10], checker:[0xa8b3c6, 0.70, 0.10],
  hazard:   [0xff3247, 0.55, 0.20], rubber: [0x2b3040, 0.88, 0.05],
  conveyor: [0x3a4152, 0.78, 0.18], cloud:  [0xdfe9ff, 1.00, 0.00],
};
function fallbackTex() {
  if (fallbackTex._t) return fallbackTex._t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  const r = mulberry32(0x51ce);
  for (let i = 0; i < 64 * 64; i++) {
    const n = 150 + Math.floor(r() * 90);
    img.data[i * 4] = n; img.data[i * 4 + 1] = n; img.data[i * 4 + 2] = n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  fallbackTex._t = t; return t;
}
function fallbackMat(key) {
  let m = _fallbackMats.get(key);
  if (m) return m;
  const spec = FALLBACK_SPEC[key] || FALLBACK_SPEC.stone;
  m = new THREE.MeshStandardMaterial({
    color: spec[0], roughness: spec[1], metalness: spec[2],
    map: fallbackTex(), roughnessMap: fallbackTex(),
    emissive: (key === 'lava' || key === 'emissive' || key === 'neon' || key === 'hazard') ? spec[0] : 0x000000,
    emissiveIntensity: (key === 'lava' || key === 'emissive' || key === 'neon' || key === 'hazard') ? 1.2 : 0,
  });
  _fallbackMats.set(key, m);
  return m;
}

// --- additive VFX materials ----------------------------------------------------------------
const _addCache = new Map();
/**
 * Additive, unlit, depth-transparent material for beams / glows / chevrons.
 * `cached:true` returns a shared instance (never disposed by a hazard);
 * `cached:false` returns a private instance the caller owns and must dispose.
 */
export function additiveMaterial(color, opts = {}) {
  const opacity = num(opts.opacity, 1);
  const key = `${color}|${opacity}|${opts.depthTest === false ? 0 : 1}|${opts.side || 0}`;
  if (opts.cached !== false) {
    const hit = _addCache.get(key);
    if (hit) return hit;
  }
  const m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
    depthTest: opts.depthTest !== false,
    side: opts.side || THREE.FrontSide,
    toneMapped: false,
    fog: false,
  });
  if (opts.cached !== false) _addCache.set(key, m);
  return m;
}

// --- procedural sprite/point textures -------------------------------------------------------
const _texCache = new Map();
function canvasTexture(key, size, draw) {
  const hit = _texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  _texCache.set(key, t);
  return t;
}

/** Soft radial falloff — the workhorse for glows, motes and sparkles. */
export function glowTexture(power = 2.2) {
  return canvasTexture(`glow${power}`, 128, (g, s) => {
    const img = g.createImageData(s, s);
    const c = (s - 1) * 0.5;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x - c) / c, dy = (y - c) / c;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const a = Math.pow(1 - d, power);
        const i = (y * s + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** A four-point star flare, used for ice sparkle and laser muzzle pops. */
export function sparkTexture() {
  return canvasTexture('spark4', 128, (g, s) => {
    g.clearRect(0, 0, s, s);
    const c = s * 0.5;
    const rg = g.createRadialGradient(c, c, 0, c, c, c);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      g.save(); g.translate(c, c); g.rotate((Math.PI / 4) * k);
      const lg = g.createLinearGradient(-c, 0, c, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, k % 2 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(-c, -(k % 2 === 0 ? s * 0.012 : s * 0.007), s, (k % 2 === 0 ? s * 0.024 : s * 0.014));
      g.restore();
    }
  });
}

/** Glow sprite with its own (owned) material so per-hazard opacity can animate. */
export function makeGlowSprite(color, size, opacity = 1, power = 2.2) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(power), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    toneMapped: false, fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

// --- geometry helpers ------------------------------------------------------------------------
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w * 0.5, y = -h * 0.5;
  r = Math.max(1e-4, Math.min(r, Math.min(w, h) * 0.5 - 1e-4));
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A chamfered box centred on the origin — the "no naked BoxGeometry" primitive.
 * Extruded along Y with a real bevel on every edge, so it catches a highlight.
 *
 * `detail` (0..1) trades corner/bevel tessellation for triangles. Hero geometry the player looks
 * at up close stays at 1; repeated small parts (conveyor treads, rotor teeth, hairline frames)
 * drop to ~0.34, which is a 3x saving nobody can see at that scale.
 */
export function bevelBox(w, h, d, bevel = 0.04, corner = 1.7, detail = 1) {
  const b = clamp(bevel, 0.002, Math.min(w, h, d) * 0.33);
  const shape = roundedRectShape(w - b * 2, d - b * 2, Math.max(0.004, b * corner));
  const depth = Math.max(0.002, h - b * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: 0,
    bevelSegments: Math.max(1, Math.round(2 * detail)),
    curveSegments: Math.max(1, Math.round(3 * detail)),
    steps: 1,
  });
  geo.translate(0, 0, -depth * 0.5);
  geo.rotateX(-Math.PI * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/** Merge a list of geometries into one draw call. Sources are disposed. */
export function mergeAll(geos) {
  const list = geos.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (let i = 0; i < list.length; i++) if (flat[i] !== list[i]) list[i].dispose();
  const merged = mergeGeometries(flat, false);
  for (const g of flat) g.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  return merged;
}

/** Transform a geometry in place: scale -> rotate(+Y to dir) -> translate. */
export function placeGeo(geo, pos, dir, rollRad = 0) {
  if (dir) {
    _kq.setFromUnitVectors(UP, _kv.copy(dir).normalize());
    if (rollRad) { _kq.multiply(_kq.clone().setFromAxisAngle(UP, rollRad)); }
    geo.applyQuaternion(_kq);
  }
  if (pos) geo.translate(pos.x, pos.y, pos.z);
  return geo;
}

/** Deterministic RNG for a hazard, seeded from its def so art is identical every run. */
export function hazRandom(def, salt = 0) {
  let s = 0x9e3779b9 ^ (salt | 0);
  const src = (def && (def.seed !== undefined ? String(def.seed) : JSON.stringify(defSeedKey(def)))) || 'hz';
  for (let i = 0; i < src.length; i++) s = (Math.imul(s ^ src.charCodeAt(i), 0x01000193) >>> 0);
  return mulberry32(s >>> 0);
}
function defSeedKey(def) {
  return [def.kind || '', def.p || def.a || 0, def.s || def.b || 0, def.period || 0];
}

// --- collider / kill helpers -----------------------------------------------------------------
function copyVec(o, k, v) {
  const cur = o[k];
  if (cur && cur.isVector3) cur.copy(v); else o[k] = v.clone();
}

/**
 * Build a world-space solid Collider. `props` are surface parameters read by
 * runtime/player/collide.js (CONTRACT §11/§12).
 */
export function makeCollider({ center, half, quat = null, surface = 'normal', ref = null, group = 'world', props = null }) {
  const c = new Collider({
    center: center.clone(), half: half.clone(),
    quat: quat ? quat.clone() : new THREE.Quaternion(),
    surface, ref, group, props: props || {},
  });
  if (!c.props) c.props = {};
  if (props) Object.assign(c.props, props);
  if (c.surface === undefined) c.surface = surface;
  if (c.ref === undefined || c.ref === null) c.ref = ref;
  if (c.active === undefined) c.active = true;
  if (!c.center || !c.center.isVector3) c.center = center.clone();
  if (!c.half || !c.half.isVector3) c.half = half.clone();
  if (typeof c.update === 'function') c.update();
  return c;
}

/** Move a collider box and refresh its broadphase AABB. */
export function setColliderBox(c, center, half) {
  if (!c) return;
  copyVec(c, 'center', center);
  if (half) copyVec(c, 'half', half);
  if (typeof c.update === 'function') c.update();
}

/**
 * Build a KillVolume. The contract fixes `type` / `kind` / `ref` but leaves the per-type geometry
 * field names open, so every plausible alias is written (aliases share the same Vector3 instances,
 * so `updateKill*` keeps them all coherent).
 */
export function makeKill(spec) {
  const s = { type: spec.type, kind: spec.kind, ref: spec.ref || null, active: spec.active !== false };
  if (spec.type === 'box') {
    const center = spec.center.clone();
    const half = spec.half.clone();
    const size = half.clone().multiplyScalar(2);
    s.center = center; s.p = center; s.pos = center;
    s.half = half; s.halfExtents = half;
    s.s = size; s.size = size;
    s.quat = spec.quat ? spec.quat.clone() : new THREE.Quaternion();
  } else if (spec.type === 'sphere') {
    const center = spec.center.clone();
    s.center = center; s.p = center; s.pos = center;
    s.radius = spec.radius; s.r = spec.radius;
  } else if (spec.type === 'capsule') {
    const a = spec.a.clone(), b = spec.b.clone();
    s.a = a; s.p0 = a; s.start = a;
    s.b = b; s.p1 = b; s.end = b;
    s.radius = spec.radius; s.r = spec.radius;
  } else {
    // plane: collider.js kills the half-space `n . p + c >= 0`, and treats a bare `y` as
    // "everything below y". Passing both would silently zero the constant, so pick one.
    if (spec.normal || spec.n) {
      s.normal = (spec.normal || spec.n).clone();
      s.constant = num(spec.constant !== undefined ? spec.constant : spec.c, 0);
    } else {
      s.y = num(spec.y, 0);
    }
  }
  const kv = new KillVolume(s);
  if (kv.kind === undefined) kv.kind = s.kind;
  if (kv.type === undefined) kv.type = s.type;
  if (kv.ref === undefined || kv.ref === null) kv.ref = s.ref;
  if (kv.active === undefined) kv.active = s.active;
  // Keep the authoritative geometry reachable even if KillVolume copied it internally.
  kv.__spec = s;
  return kv;
}

export function updateKillBox(kv, center, half) {
  if (!kv) return;
  const s = kv.__spec;
  if (s) {
    s.center.copy(center); s.half.copy(half); s.s.copy(half).multiplyScalar(2);
  }
  copyVec(kv, 'center', center);
  copyVec(kv, 'half', half);
  _kv.copy(half).multiplyScalar(2);
  if (kv.size && kv.size.isVector3) kv.size.copy(_kv);
  if (kv.s && kv.s.isVector3) kv.s.copy(_kv);
  if (typeof kv.update === 'function') kv.update();
}

export function updateKillCapsule(kv, a, b, radius) {
  if (!kv) return;
  const s = kv.__spec;
  if (s) { s.a.copy(a); s.b.copy(b); if (radius !== undefined) { s.radius = radius; s.r = radius; } }
  copyVec(kv, 'a', a); copyVec(kv, 'b', b);
  if (kv.p0 && kv.p0.isVector3) kv.p0.copy(a);
  if (kv.p1 && kv.p1.isVector3) kv.p1.copy(b);
  if (kv.start && kv.start.isVector3) kv.start.copy(a);
  if (kv.end && kv.end.isVector3) kv.end.copy(b);
  if (radius !== undefined) { kv.radius = radius; kv.r = radius; }
  if (typeof kv.update === 'function') kv.update();
}

export function updateKillSphere(kv, center, radius) {
  if (!kv) return;
  const s = kv.__spec;
  if (s) { s.center.copy(center); if (radius !== undefined) { s.radius = radius; s.r = radius; } }
  copyVec(kv, 'center', center);
  if (radius !== undefined) { kv.radius = radius; kv.r = radius; }
  if (typeof kv.update === 'function') kv.update();
}

// --- service resolution -------------------------------------------------------------------
// runtime/world/stage.js builds the hazard ctx from what it has to hand; the player, the post
// stack and the audio listener each live one hop away from it. These resolvers find them without
// making any hazard depend on the exact shape of that ctx.

/** The live Player, or null. Re-resolved per frame: a respawn can swap the instance. */
export function resolvePlayer(ctx) {
  if (!ctx) return null;
  if (ctx.player && ctx.player.pos) return ctx.player;
  const st = ctx.stage;
  if (st) {
    if (st._playerRef && st._playerRef.pos) return st._playerRef;
    if (st.player && st.player.pos) return st.player;
    if (st.ctx && st.ctx.player && st.ctx.player.pos) return st.ctx.player;
  }
  return null;
}

/** The Post stack (fx/post.js), which the stage ctx reaches through the engine. */
export function resolvePost(ctx) {
  if (!ctx) return null;
  if (ctx.post) return ctx.post;
  if (ctx.engine && ctx.engine.post) return ctx.engine.post;
  if (ctx.stage && ctx.stage.engine && ctx.stage.engine.post) return ctx.stage.engine.post;
  return null;
}

/** The audio listener — Audio.sfx spatialises when given `{pos, listener}`. */
export function resolveListener(ctx) {
  if (!ctx) return null;
  return ctx.listener || ctx.camera
    || (ctx.engine && ctx.engine.camera)
    || (ctx.stage && ctx.stage.engine && ctx.stage.engine.camera)
    || null;
}

// --- audio / particle bridges ------------------------------------------------------------------
/**
 * Fire a sfx by name (core/audio.js resolves its own aliases). Pass `opts.pos` and the listener is
 * filled in automatically, which buys distance falloff, stereo pan and air absorption for free.
 * Silent, and never throwing, if audio is absent.
 */
export function hazSfx(ctx, name, opts) {
  const a = ctx && ctx.audio;
  if (!a || typeof a.sfx !== 'function') return;
  if (opts && opts.pos && !opts.listener) {
    const l = resolveListener(ctx);
    if (l) opts.listener = l;
  }
  try { a.sfx(name, opts); } catch (e) { /* audio must never break a hazard */ }
}

function particleSystem(ctx) {
  const fx = ctx && ctx.fx;
  if (!fx) return null;
  if (typeof fx.burst === 'function') return fx;
  if (fx.particles && typeof fx.particles.burst === 'function') return fx.particles;
  if (fx.ps && typeof fx.ps.burst === 'function') return fx.ps;
  return null;
}

export function hazBurst(ctx, preset, pos, opts) {
  const ps = particleSystem(ctx);
  if (!ps) return;
  try { ps.burst(preset, pos, opts); } catch (e) { /* never break a hazard on a VFX hiccup */ }
}

/** Bind a continuous emitter and return a handle whose stop() unbinds it from the system. */
export function hazAmbient(ctx, preset, box, rate, opts) {
  const ps = particleSystem(ctx);
  if (!ps || typeof ps.ambient !== 'function') return null;
  try {
    const h = ps.ambient(preset, box, rate, opts);
    if (!h) return null;
    return {
      handle: h,
      stop() {
        try {
          if (typeof ps.removeAmbient === 'function') ps.removeAmbient(h);
          else if (h.enabled !== undefined) h.enabled = false;
        } catch (e) { /* teardown must never throw */ }
      },
    };
  } catch (e) { return null; }
}

let _loopSeq = 0;

/**
 * A positional LOOPING voice. core/audio.js synthesises four of them —
 * 'saw_whirr', 'wind', 'portal_hum', 'lava_flow' — and they are what a continuous hazard
 * (a lava pool, a wind tunnel, an advancing molten front) should sound like; one-shots alone
 * leave those hazards silent between events.
 *
 * Starts lazily: Audio.loop() hands back a dead stub until init() has run on a user gesture, so
 * a hazard built during the title screen retries about once a second until the voice takes.
 * Position updates are throttled to ~8 Hz — Audio.setPos schedules three AudioParam ramps and
 * a listener cannot hear the difference above that.
 */
export class HazLoop {
  constructor(ctx, name, opts) {
    this.ctx = ctx;
    this.name = name;
    this.opts = opts || {};
    this.opts.key = 'hz' + (++_loopSeq);
    this.handle = null;
    this.baseGain = num(this.opts.gain, 1);
    this._gain = this.baseGain;
    this._nextTry = -1;
    this._nextPos = -1;
    this._stopped = false;
  }

  _start() {
    const a = this.ctx && this.ctx.audio;
    if (!a || typeof a.loop !== 'function') return;
    if (!this.opts.listener) {
      const l = resolveListener(this.ctx);
      if (l) this.opts.listener = l;
    }
    try {
      const h = a.loop(this.name, this.opts);
      if (h && h.alive && typeof h.stop === 'function') this.handle = h;
    } catch (e) { this.handle = null; }
  }

  /** Once per frame: where the sound is coming from, and how loud it should be (0..1). */
  update(t, pos, gain) {
    if (this._stopped) return;
    if (!this.handle || this.handle.alive === false) {
      this.handle = null;
      if (t < this._nextTry) return;
      this._nextTry = t + 1;
      this._start();
      if (!this.handle) return;
      this._nextPos = -1;
    }
    if (gain !== undefined && Math.abs(gain - this._gain) > 0.02) {
      this._gain = gain;
      if (typeof this.handle.setGain === 'function') this.handle.setGain(this.baseGain * gain);
      this._nextPos = -1;                       // gain only lands on the next setPos
    }
    if (pos && t >= this._nextPos) {
      this._nextPos = t + 0.12;
      try { this.handle.setPos(pos, resolveListener(this.ctx)); } catch (e) { this.handle = null; }
    }
  }

  stop(fadeMs) {
    this._stopped = true;
    if (this.handle && typeof this.handle.stop === 'function') {
      try { this.handle.stop(fadeMs === undefined ? 220 : fadeMs); } catch (e) { /* already gone */ }
    }
    this.handle = null;
  }
}

/** Quality scalars with sane defaults (CONTRACT §2 QUALITY). */
export function qualityOf(ctx) {
  const q = (ctx && (ctx.quality || (ctx.settings && typeof ctx.settings.quality === 'function' && ctx.settings.quality()))) || null;
  return {
    particles: q ? num(q.particles, 1) : 1,
    decor: q ? num(q.decor, 1) : 1,
    bloom: q ? q.bloom !== false : true,
    shadowMap: q ? q.shadowMap !== false : true,
  };
}

// --- cycle timing ------------------------------------------------------------------------------
/**
 * Cycle semantics used by every telegraphed hazard in this package:
 *   period = on + off. The hazard is dangerous/solid for `on` seconds, then dormant for `off`.
 *   `warn` is the TAIL of the off window — the telegraph that immediately precedes the next `on`.
 *   `phase` shifts the cycle EARLIER (a hazard with phase = on fires immediately at t = 0).
 * Returns a caller-owned scratch object; never allocates.
 */
export function makeCycleState() {
  return { state: 'off', k: 0, index: 0, period: 0, local: 0, on: 0, off: 0, warn: 0, sinceOn: 0 };
}
const _sharedCycle = makeCycleState();

export function cycleState(t, cycle, out, phaseExtra = 0) {
  const o = out || _sharedCycle;
  const on = Math.max(0, num(cycle && cycle.on, 1.4));
  const off = Math.max(0, num(cycle && cycle.off, 1.4));
  const warn = clamp(num(cycle && cycle.warn, Math.min(0.6, off * 0.45)), 0, off);
  const period = on + off;
  o.on = on; o.off = off; o.warn = warn; o.period = period;
  if (period <= 1e-6) {
    o.state = on > 0 ? 'on' : 'off'; o.k = 1; o.index = 0; o.local = 0; o.sinceOn = 0;
    return o;
  }
  const phase = num(cycle && cycle.phase, 0) + phaseExtra;
  const shifted = t + phase;
  let local = shifted % period;
  if (local < 0) local += period;
  o.index = Math.floor(shifted / period);
  o.local = local;
  if (local < on) {
    o.state = 'on'; o.sinceOn = local; o.k = on > 0 ? local / on : 1;
  } else {
    const offLocal = local - on;
    o.sinceOn = -1;
    if (warn > 0 && offLocal >= off - warn) {
      o.state = 'warn'; o.k = clamp((offLocal - (off - warn)) / warn, 0, 1);
    } else {
      o.state = 'off';
      o.k = off - warn > 0 ? clamp(offLocal / (off - warn), 0, 1) : 0;
    }
  }
  return o;
}

// --- disposal ----------------------------------------------------------------------------------
export function disposeObject3D(root, keepMaterials) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry) { try { o.geometry.dispose(); } catch (e) { /* already gone */ } }
    if (!keepMaterials && o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) { try { m.dispose(); } catch (e) { /* already gone */ } }
    }
  });
  if (root.parent) root.parent.remove(root);
}

// --- shared GLSL -------------------------------------------------------------------------------
export const GLSL_NOISE = `
float hzHash(vec2 p){ p = fract(p * vec2(127.331, 311.727)); p += dot(p, p + 43.21); return fract(p.x * p.y); }
float hzNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hzHash(i), b = hzHash(i + vec2(1.0, 0.0));
  float c = hzHash(i + vec2(0.0, 1.0)), d = hzHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float hzFbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * hzNoise(p); p *= 2.07; a *= 0.5; }
  return v;
}
`;

/* ======================================================================================
   HAZARD BASE
   ====================================================================================== */

export class Hazard {
  constructor(def, ctx, kind) {
    this.kind = kind;
    this.def = def || {};
    this.ctx = ctx || {};
    this.mesh = new THREE.Group();
    this.mesh.name = 'hz_' + kind;
    this.mesh.matrixAutoUpdate = false;   // world-authored geometry: identity, updated once
    this.mesh.updateMatrix();
    this.colliders = [];
    this.kills = [];
    this.fields = [];        // non-solid influence volumes (wind); see module notes
    this.lights = [];
    this.hud = null;         // {type, label, value01} — optional HUD danger readout
    this.enabled = true;
    this.time = 0;
    this._owned = [];        // materials/textures this hazard created and must dispose
    this._ambients = [];
    this._loops = [];        // HazLoop voices this hazard owns
    this._silent = true;     // suppresses one-shot effects during reset()/build
  }

  /** Register a material/texture the hazard owns (shared Mats materials must NOT go here). */
  own(res) { if (res) this._owned.push(res); return res; }

  add(obj) { if (obj) this.mesh.add(obj); return obj; }

  /**
   * True exactly once, on the frame a discrete event index advances.
   * Returns false on the first observation and while `_silent` (build / reset), so a respawn
   * never replays a stack of sounds. Deliberately callback-free: update paths must not allocate.
   */
  edge(store, key, index) {
    const prev = store[key];
    store[key] = index;
    if (prev === undefined || prev === null || prev === index) return false;
    return !this._silent;
  }

  update(t /* , dt */) { this.time = t; }

  /** Place the hazard exactly where update(t) would, with no audible/visible one-shots. */
  reset(t) {
    this._silent = true;
    this.update(t, 0);
    this._silent = false;
  }

  /** Called by the player when a surface effect on one of our colliders fires. */
  onTouch(/* info */) {}

  dispose() {
    for (const l of this.lights) { if (l.parent) l.parent.remove(l); if (l.dispose) l.dispose(); }
    this.lights.length = 0;
    for (const a of this._ambients) { try { if (a && a.stop) a.stop(); } catch (e) { /* noop */ } }
    this._ambients.length = 0;
    for (const l of this._loops) { try { l.stop(160); } catch (e) { /* noop */ } }
    this._loops.length = 0;
    disposeObject3D(this.mesh, true);         // geometries yes, materials handled below
    for (const r of this._owned) { try { r.dispose(); } catch (e) { /* noop */ } }
    this._owned.length = 0;
    this.colliders.length = 0;
    this.kills.length = 0;
    this.fields.length = 0;
  }
}

/* ======================================================================================
   BEAM SHADERS
   ====================================================================================== */

const BEAM_VERT = `
attribute float aLen;
attribute float aInten;
varying vec2 vUv;
varying vec3 vNrm;
varying vec3 vView;
varying float vLen;
varying float vInten;
void main() {
  vUv = uv;
  vLen = aLen;
  vInten = aInten;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNrm = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const BEAM_FRAG = `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uTime;
varying vec2 vUv;
varying vec3 vNrm;
varying vec3 vView;
varying float vLen;
varying float vInten;
${GLSL_NOISE}
void main() {
  if (vInten <= 0.002) discard;
  // Path length through the tube: 1 at the axis, 0 at the silhouette.
  float thick = pow(clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 0.62);
  float s = vUv.y * vLen;
  float n1 = hzNoise(vec2(s * 2.6 - uTime * 9.0, vUv.x * 5.0));
  float n2 = hzNoise(vec2(s * 9.5 + uTime * 17.0, vUv.x * 11.0 + 4.0));
  float grain = 0.62 + 0.28 * n1 + 0.22 * n2;
  float flick = 0.93 + 0.07 * sin(uTime * 61.0 + s * 3.1);
  float body = thick * grain * flick;
  float core = pow(thick, 5.0);
  vec3 col = uColor * body * 1.55 + uCore * core * 1.9;
  float a = clamp(body * 0.95 + core * 0.6, 0.0, 1.0) * vInten;
  gl_FragColor = vec4(col * vInten, a);
}
`;

const MOTE_VERT = `
attribute vec3 aAxis;
attribute float aLen;
attribute float aSeed;
attribute float aOff;
attribute float aInten;
uniform float uTime;
uniform float uSize;
varying float vA;
void main() {
  float s = fract(aOff + uTime * (0.030 + 0.055 * aSeed));
  vec3 p = position + aAxis * (s * aLen);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float att = 300.0 / max(0.35, -mv.z);
  gl_PointSize = clamp(uSize * (0.45 + 0.75 * aSeed) * att, 1.0, 42.0);
  float edge = smoothstep(0.0, 0.10, s) * smoothstep(1.0, 0.90, s);
  vA = aInten * edge * (0.22 + 0.78 * aSeed);
}
`;

const MOTE_FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  if (vA <= 0.004) discard;
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.02, r);
  gl_FragColor = vec4(uColor * (0.5 + a * 1.7), a * vA);
}
`;

const GLOW_VERT = `
attribute float aInten;
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flick = 1.0 + 0.10 * sin(uTime * 37.0 + aPhase);
  gl_PointSize = clamp(aSize * (0.70 + 0.60 * aInten) * flick * (320.0 / max(0.4, -mv.z)), 0.0, 220.0);
  vA = aInten;
}
`;

const GLOW_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vA;
void main() {
  if (vA <= 0.004) discard;
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor * (1.0 + vA * 1.6), t.a * vA);
}
`;

const AIM_VERT = `
attribute float aLen;
attribute float aWarn;
varying vec2 vUv;
varying float vLen;
varying float vWarn;
void main() {
  vUv = uv; vLen = aLen; vWarn = aWarn;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AIM_FRAG = `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying float vLen;
varying float vWarn;
void main() {
  if (vWarn <= 0.004) discard;
  float s = vUv.y * vLen;
  float dash = step(0.42, fract(s * 1.8 - uTime * 3.4));
  float head = smoothstep(0.0, 0.25, vUv.y);
  float a = dash * head * vWarn;
  gl_FragColor = vec4(uColor * (1.1 + vWarn), a * 0.85);
}
`;

/* ======================================================================================
   EMITTER HOUSING GEOMETRY
   ====================================================================================== */

/**
 * Emitter parts authored in local space with the muzzle pointing along +Y.
 * Returns { housing, rotor, lens } geometries — housing is merged into one draw call.
 */
function buildEmitterGeometry(scale, detail = 1) {
  const S = scale;
  const D = clamp(detail, 0.3, 1);
  const RAD = Math.max(8, Math.round(20 * D));    // radial segments on the lathe parts
  const parts = [];

  // mounting plate + anchor bolts
  const plate = bevelBox(1.05 * S, 0.16 * S, 1.05 * S, 0.022 * S, 1.7, D);
  plate.translate(0, -0.60 * S, 0);
  parts.push(plate);
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI * 0.5) * i + Math.PI * 0.25;
    const bolt = new THREE.CylinderGeometry(0.055 * S, 0.055 * S, 0.09 * S, 6);
    bolt.translate(Math.cos(a) * 0.39 * S, -0.50 * S, Math.sin(a) * 0.39 * S);
    parts.push(bolt);
  }

  // yoke arms rising from the plate
  for (let i = 0; i < 2; i++) {
    const arm = bevelBox(0.14 * S, 0.5 * S, 0.30 * S, 0.02 * S, 1.7, D * 0.7);
    arm.translate((i ? 1 : -1) * 0.40 * S, -0.30 * S, 0);
    parts.push(arm);
  }

  // main barrel body
  const body = new THREE.CylinderGeometry(0.30 * S, 0.345 * S, 0.62 * S, RAD, 1, false);
  body.translate(0, -0.02 * S, 0);
  parts.push(body);

  // heat fins
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.CylinderGeometry(0.43 * S, 0.43 * S, 0.036 * S, RAD, 1, false);
    fin.translate(0, (-0.20 + i * 0.115) * S, 0);
    parts.push(fin);
  }

  // muzzle collar + lens shroud
  const collar = new THREE.CylinderGeometry(0.335 * S, 0.30 * S, 0.10 * S, RAD, 1, false);
  collar.translate(0, 0.335 * S, 0);
  parts.push(collar);
  const shroud = new THREE.CylinderGeometry(0.20 * S, 0.30 * S, 0.20 * S, RAD, 1, true);
  shroud.translate(0, 0.475 * S, 0);
  parts.push(shroud);

  // cable conduit down the back
  const conduit = new THREE.CylinderGeometry(0.05 * S, 0.05 * S, 0.55 * S, 6);
  conduit.rotateZ(0.22);
  conduit.translate(0.34 * S, -0.28 * S, 0.20 * S);
  parts.push(conduit);

  const housing = mergeAll(parts);

  // spin-up rotor: a slotted ring that sits inside the collar
  const rotorParts = [];
  const ring = new THREE.CylinderGeometry(0.265 * S, 0.265 * S, 0.075 * S, Math.max(8, RAD - 2), 1, true);
  rotorParts.push(ring);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 / 6) * i;
    const tooth = bevelBox(0.055 * S, 0.075 * S, 0.11 * S, 0.008 * S, 1.7, 0.34);
    tooth.translate(Math.cos(a) * 0.235 * S, 0, Math.sin(a) * 0.235 * S);
    rotorParts.push(tooth);
  }
  const rotor = mergeAll(rotorParts);
  if (rotor) rotor.translate(0, 0.30 * S, 0);

  // lens disc (emissive)
  const lens = new THREE.CylinderGeometry(0.185 * S, 0.185 * S, 0.02 * S, RAD);
  lens.translate(0, 0.545 * S, 0);

  return { housing, rotor, lens };
}

/* ======================================================================================
   LASER HAZARD
   ====================================================================================== */

const _u = {
  a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(),
  mid: new THREE.Vector3(), off: new THREE.Vector3(), tmp: new THREE.Vector3(),
  q: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4(),
  sc: new THREE.Vector3(1, 1, 1), sc2: new THREE.Vector3(1, 1, 1), col: new THREE.Color(),
};

class LaserHazard extends Hazard {
  /**
   * @param {'single'|'grid'|'sweep'} mode
   */
  constructor(def, ctx, mode) {
    super(def, ctx, mode === 'grid' ? 'lasergrid' : mode === 'sweep' ? 'lasersweep' : 'laser');
    this.mode = mode;
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.color = new THREE.Color(def.color !== undefined ? def.color : pal.kill);
    this.coreColor = this.color.clone().lerp(new THREE.Color(0xffffff), 0.72);
    this.radius = clamp(num(def.radius, 0.09), 0.02, 0.6);
    this.cycle = def.cycle || { on: 1.6, off: 1.6, warn: 0.6, phase: 0 };

    /** @type {Array} beam units — each is a straight segment with its own phase offset. */
    this.units = [];

    // ---- geometry authoring -------------------------------------------------------------
    const bake = mode !== 'sweep';
    this.pivot = new THREE.Group();
    this.pivot.matrixAutoUpdate = !bake;
    if (bake) this.pivot.updateMatrix();
    this.mesh.add(this.pivot);

    if (mode === 'sweep') this._buildSweepUnits(def);
    else if (mode === 'grid') this._buildGridUnits(def);
    else this._buildSingleUnit(def);

    this._buildBeamMeshes(bake);
    this._buildEmitters(bake);
    this._buildMotes(bake, q.particles);
    this._buildKills();

    this.hud = null;
    this.reset(0);
  }

  // ---- unit construction -----------------------------------------------------------------
  _mkUnit(a, b, phaseExtra) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const safeLen = Math.max(0.05, len);
    dir.divideScalar(safeLen);
    return {
      a: a.clone(), b: b.clone(), dir, len: safeLen,
      wa: a.clone(), wb: b.clone(),
      phaseExtra: phaseExtra || 0,
      cs: makeCycleState(),
      inten: 0, warn: 0, spin: 0,
      vStart: 0, vCount: 0, cStart: 0, cCount: 0, aStart: 0, aCount: 0,
      mStart: 0, mCount: 0,
      lastOn: null, lastWarn: null,
      kill: null,
    };
  }

  _buildSingleUnit(def) {
    const a = v3(def.a, 0, 0, 0);
    const b = v3(def.b, 0, 3, 0);
    this.units.push(this._mkUnit(a, b, 0));
    this.emitterEnds = 2;
  }

  _buildGridUnits(def) {
    const a = v3(def.a, 0, 0, 0);
    const b = v3(def.b, 0, 3, 0);
    const count = Math.max(1, Math.min(16, Math.round(num(def.count, 4))));
    const spacing = num(def.spacing, 1.15);
    const axis = b.clone().sub(a);
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    axis.normalize();

    // Offset axis: explicit, else world-up unless the rack is already vertical.
    let off;
    if (def.offset) off = dirVec(def.offset, 0, 1, 0);
    else if (Math.abs(axis.y) > 0.85) off = new THREE.Vector3(1, 0, 0);
    else off = new THREE.Vector3(0, 1, 0);
    off.sub(axis.clone().multiplyScalar(off.dot(axis)));
    if (off.lengthSq() < 1e-8) off.set(1, 0, 0);
    off.normalize();

    const period = Math.max(0.05, num(this.cycle.on, 1.6) + num(this.cycle.off, 1.6));
    const stagger = num(def.stagger, period / count);
    const span = (count - 1) * spacing;

    for (let i = 0; i < count; i++) {
      const d = (i * spacing) - span * 0.5;
      const ua = a.clone().addScaledVector(off, d);
      const ub = b.clone().addScaledVector(off, d);
      this.units.push(this._mkUnit(ua, ub, stagger * i));
    }
    this.emitterEnds = 2;
  }

  _buildSweepUnits(def) {
    const origin = v3(def.p || def.a, 0, 0, 0);
    const len = Math.max(0.5, num(def.len, num(def.length, 8)));
    this.sweepOrigin = origin.clone();
    this.sweepLen = len;
    this.sweepAxis = dirVec(def.axis, 0, 1, 0);
    // Reference direction at angle 0 — perpendicular to the rotation axis.
    let d0 = def.dir ? dirVec(def.dir, 1, 0, 0) : null;
    if (!d0) {
      d0 = Math.abs(this.sweepAxis.y) > 0.85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, -1, 0);
    }
    d0.sub(this.sweepAxis.clone().multiplyScalar(d0.dot(this.sweepAxis)));
    if (d0.lengthSq() < 1e-8) d0.set(1, 0, 0);
    d0.normalize();
    this.sweepDir0 = d0;
    this.sweepArc = num(def.arc, Math.PI * 0.55);
    this.sweepPeriod = Math.max(0.2, num(def.period, 4.2));
    this.sweepPhase = num(def.phase, 0);
    this.qBase = new THREE.Quaternion().setFromUnitVectors(UP, d0);
    this.qSpin = new THREE.Quaternion();

    // Local-space unit: origin -> +Y * len (the pivot supplies the world transform).
    const u = this._mkUnit(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len, 0), 0);
    this.units.push(u);
    this.pivot.position.copy(origin);
    this.emitterEnds = 1;
  }

  // ---- beam meshes -----------------------------------------------------------------------
  _buildBeamMeshes(bake) {
    const tubeGeos = [];
    const coreGeos = [];
    const aimGeos = [];
    let vTube = 0, vCore = 0, vAim = 0;

    for (const u of this.units) {
      const seg = Math.max(1, Math.min(64, Math.round(u.len / 1.6)));
      const tube = new THREE.CylinderGeometry(this.radius, this.radius, u.len, 14, seg, true);
      const core = new THREE.CylinderGeometry(this.radius * 0.34, this.radius * 0.34, u.len, 8, 1, true);
      const aim = new THREE.CylinderGeometry(this.radius * 0.16, this.radius * 0.16, u.len, 6, seg, true);
      for (const g of [tube, core, aim]) {
        const n = g.attributes.position.count;
        g.setAttribute('aLen', new THREE.Float32BufferAttribute(new Float32Array(n).fill(u.len), 1));
      }
      tube.setAttribute('aInten', new THREE.Float32BufferAttribute(new Float32Array(tube.attributes.position.count), 1));
      core.setAttribute('aInten', new THREE.Float32BufferAttribute(new Float32Array(core.attributes.position.count), 1));
      aim.setAttribute('aWarn', new THREE.Float32BufferAttribute(new Float32Array(aim.attributes.position.count), 1));

      if (bake) {
        _u.mid.copy(u.a).add(u.b).multiplyScalar(0.5);
        for (const g of [tube, core, aim]) placeGeo(g, _u.mid, u.dir);
      } else {
        for (const g of [tube, core, aim]) g.translate(0, u.len * 0.5, 0);
      }

      u.vStart = vTube; u.vCount = tube.attributes.position.count; vTube += u.vCount;
      u.cStart = vCore; u.cCount = core.attributes.position.count; vCore += u.cCount;
      u.aStart = vAim;  u.aCount = aim.attributes.position.count;  vAim += u.aCount;
      tubeGeos.push(tube); coreGeos.push(core); aimGeos.push(aim);
    }

    const uniforms = {
      uColor: { value: this.color.clone() },
      uCore: { value: this.coreColor.clone() },
      uTime: { value: 0 },
    };
    this.beamUniforms = uniforms;

    const beamMat = new THREE.ShaderMaterial({
      uniforms, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.own(beamMat);

    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.coreColor.clone() },
        uCore: { value: new THREE.Color(0xffffff) },
        uTime: uniforms.uTime,
      },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.own(coreMat);

    const aimMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color.clone() }, uTime: uniforms.uTime },
      vertexShader: AIM_VERT, fragmentShader: AIM_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.own(aimMat);

    this.beamMesh = new THREE.Mesh(mergeAll(tubeGeos), beamMat);
    this.coreMesh = new THREE.Mesh(mergeAll(coreGeos), coreMat);
    this.aimMesh = new THREE.Mesh(mergeAll(aimGeos), aimMat);
    for (const m of [this.beamMesh, this.coreMesh, this.aimMesh]) {
      m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 6;
      this.pivot.add(m);
    }
    this.beamAttr = this.beamMesh.geometry.getAttribute('aInten');
    this.coreAttr = this.coreMesh.geometry.getAttribute('aInten');
    this.aimAttr = this.aimMesh.geometry.getAttribute('aWarn');
  }

  // ---- emitter housings -------------------------------------------------------------------
  _buildEmitters(bake) {
    const S = clamp(this.radius / 0.09, 0.55, 2.2);
    // A rack of beams means a rack of emitters; drop their tessellation so a 5-beam grid costs
    // about what a single beam does.
    const detail = this.units.length > 2 ? 0.5 : 1;
    const { housing, rotor, lens } = buildEmitterGeometry(S, detail);
    const n = this.units.length * this.emitterEnds;

    const metal = hazMat(this.ctx, 'metal');
    const panel = hazMat(this.ctx, 'panel');

    this.housingMesh = new THREE.InstancedMesh(housing, metal, n);
    this.housingMesh.castShadow = true;
    this.housingMesh.receiveShadow = true;
    this.housingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.rotorMesh = new THREE.InstancedMesh(rotor || housing.clone(), panel, n);
    this.rotorMesh.castShadow = false;
    this.rotorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const lensMat = additiveMaterial(this.color.getHex(), { cached: false, opacity: 1 });
    this.own(lensMat);
    this.lensMesh = new THREE.InstancedMesh(lens, lensMat, n);
    this.lensMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lensMesh.renderOrder = 5;

    // strobing warning lamp on each housing
    const lampGeo = new THREE.SphereGeometry(0.085 * S, 8, 6);
    lampGeo.translate(0.30 * S, -0.10 * S, 0.24 * S);
    const lampMat = additiveMaterial(0xffb03a, { cached: false, opacity: 1 });
    this.own(lampMat);
    this.lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, n);
    this.lampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lampMesh.renderOrder = 5;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      this.lampMesh.setColorAt(i, white);
      this.lensMesh.setColorAt(i, white);
    }

    this.emitterPods = [];
    let idx = 0;
    for (const u of this.units) {
      if (this.emitterEnds === 1) {
        this.emitterPods.push({ unit: u, pos: bake ? u.a.clone() : new THREE.Vector3(0, 0, 0), dir: bake ? u.dir.clone() : new THREE.Vector3(0, 1, 0), i: idx++ });
      } else {
        this.emitterPods.push({ unit: u, pos: u.a.clone(), dir: u.dir.clone(), i: idx++ });
        this.emitterPods.push({ unit: u, pos: u.b.clone(), dir: u.dir.clone().negate(), i: idx++ });
      }
    }
    for (const pod of this.emitterPods) this._writePod(pod, 0);
    this.housingMesh.instanceMatrix.needsUpdate = true;

    // End glows as ONE additive point cloud rather than a sprite per emitter: a 5-beam grid has
    // 10 emitters, and 10 sprites is 10 draw calls for what is visually a single effect.
    const gp = new Float32Array(this.emitterPods.length * 3);
    const gi = new Float32Array(this.emitterPods.length);
    const gs = new Float32Array(this.emitterPods.length);
    const gph = new Float32Array(this.emitterPods.length);
    for (let i = 0; i < this.emitterPods.length; i++) {
      const pod = this.emitterPods[i];
      _u.tmp.copy(pod.pos).addScaledVector(pod.dir, this.radius * 3.2);
      gp[i * 3] = _u.tmp.x; gp[i * 3 + 1] = _u.tmp.y; gp[i * 3 + 2] = _u.tmp.z;
      gi[i] = 0;
      gs[i] = this.radius * 18;
      gph[i] = i * 1.37;
    }
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    glowGeo.setAttribute('aInten', new THREE.BufferAttribute(gi, 1));
    glowGeo.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
    glowGeo.setAttribute('aPhase', new THREE.BufferAttribute(gph, 1));
    glowGeo.computeBoundingSphere();
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.beamUniforms.uTime,
        uMap: { value: glowTexture(2.4) },
        uColor: { value: this.color.clone().lerp(new THREE.Color(0xffffff), 0.25) },
      },
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, fog: false,
    });
    this.own(glowMat);
    this.glowPoints = new THREE.Points(glowGeo, glowMat);
    this.glowPoints.renderOrder = 7;
    this.glowPoints.frustumCulled = false;
    this.pivot.add(this.glowPoints);
    this.glowAttr = glowGeo.getAttribute('aInten');

    // Sweep pods sit under the pivot (local space); static pods sit in world space.
    const host = bake ? this.mesh : this.pivot;
    host.add(this.housingMesh);
    host.add(this.rotorMesh);
    host.add(this.lensMesh);
    host.add(this.lampMesh);
  }

  _writePod(pod, spin) {
    _u.q.setFromUnitVectors(UP, pod.dir);
    _u.m.compose(pod.pos, _u.q, _u.sc);
    this.housingMesh.setMatrixAt(pod.i, _u.m);
    this.lensMesh.setMatrixAt(pod.i, _u.m);
    this.lampMesh.setMatrixAt(pod.i, _u.m);
    _u.q2.setFromAxisAngle(UP, spin);
    _u.q2.premultiply(_u.q);
    _u.m.compose(pod.pos, _u.q2, _u.sc);
    this.rotorMesh.setMatrixAt(pod.i, _u.m);
  }

  // ---- dust motes -------------------------------------------------------------------------
  _buildMotes(bake, particleScale) {
    const perMetre = 2.4 * clamp(particleScale, 0.15, 1);
    let total = 0;
    for (const u of this.units) {
      u.mCount = Math.max(4, Math.min(160, Math.round(u.len * perMetre)));
      u.mStart = total;
      total += u.mCount;
    }
    if (total === 0) { this.moteMesh = null; return; }

    const pos = new Float32Array(total * 3);
    const axis = new Float32Array(total * 3);
    const lens = new Float32Array(total);
    const seed = new Float32Array(total);
    const off = new Float32Array(total);
    const inten = new Float32Array(total);
    const rnd = hazRandom(this.def, 17);

    for (const u of this.units) {
      const dir = bake ? u.dir : UP;
      // Two perpendiculars to scatter motes around the beam axis.
      _u.tmp.set(0, 1, 0);
      if (Math.abs(dir.dot(_u.tmp)) > 0.9) _u.tmp.set(1, 0, 0);
      const p1 = new THREE.Vector3().crossVectors(dir, _u.tmp).normalize();
      const p2 = new THREE.Vector3().crossVectors(dir, p1).normalize();
      const base = bake ? u.a : new THREE.Vector3(0, 0, 0);
      for (let i = 0; i < u.mCount; i++) {
        const j = u.mStart + i;
        const ang = rnd() * Math.PI * 2;
        const rad = this.radius * (0.35 + rnd() * 3.4);
        _u.tmp.copy(base)
          .addScaledVector(p1, Math.cos(ang) * rad)
          .addScaledVector(p2, Math.sin(ang) * rad);
        pos[j * 3] = _u.tmp.x; pos[j * 3 + 1] = _u.tmp.y; pos[j * 3 + 2] = _u.tmp.z;
        axis[j * 3] = dir.x; axis[j * 3 + 1] = dir.y; axis[j * 3 + 2] = dir.z;
        lens[j] = u.len;
        seed[j] = rnd();
        off[j] = rnd();
        inten[j] = 0;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
    g.setAttribute('aLen', new THREE.BufferAttribute(lens, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 1));
    g.setAttribute('aInten', new THREE.BufferAttribute(inten, 1));
    g.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.beamUniforms.uTime,
        uSize: { value: this.radius * 5.5 },
        uColor: { value: this.color.clone().lerp(new THREE.Color(0xffffff), 0.35) },
      },
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, fog: false,
    });
    this.own(mat);
    this.moteMesh = new THREE.Points(g, mat);
    this.moteMesh.renderOrder = 7;
    this.moteMesh.frustumCulled = false;
    this.pivot.add(this.moteMesh);
    this.moteAttr = g.getAttribute('aInten');
  }

  // ---- kill volumes -----------------------------------------------------------------------
  _buildKills() {
    for (const u of this.units) {
      const a = this.mode === 'sweep' ? this._sweepWorld(u, 0, _u.a) : u.a;
      const b = this.mode === 'sweep' ? this._sweepWorld(u, 1, _u.b) : u.b;
      u.wa.copy(a); u.wb.copy(b);
      u.kill = makeKill({
        type: 'capsule', a: u.wa, b: u.wb, radius: this.radius * 1.15,
        kind: 'laser', ref: this, active: false,
      });
      u.kill.active = false;
      this.kills.push(u.kill);
    }
  }

  _sweepWorld(u, end, out) {
    // Analytic world position of the sweep beam endpoints — no matrixWorld dependency.
    out.copy(this.sweepOrigin);
    if (end === 1) {
      _u.tmp.copy(this.sweepDir0).applyQuaternion(this.qSpin);
      out.addScaledVector(_u.tmp, u.len);
    }
    return out;
  }

  // ---- per-frame --------------------------------------------------------------------------
  update(t, dt) {
    this.time = t;
    this.beamUniforms.uTime.value = t;

    if (this.mode === 'sweep') {
      const ang = Math.sin(((t + this.sweepPhase) / this.sweepPeriod) * Math.PI * 2) * this.sweepArc * 0.5;
      this.qSpin.setFromAxisAngle(this.sweepAxis, ang);
      this.pivot.quaternion.copy(this.qSpin).multiply(this.qBase);
      this.pivot.updateMatrix();
    }

    const beamArr = this.beamAttr ? this.beamAttr.array : null;
    const coreArr = this.coreAttr ? this.coreAttr.array : null;
    const aimArr = this.aimAttr ? this.aimAttr.array : null;
    const moteArr = this.moteAttr ? this.moteAttr.array : null;

    let anyOn = false, anyLit = false, anyWarn = false;
    for (let ui = 0; ui < this.units.length; ui++) {
      const u = this.units[ui];
      const cs = cycleState(t, this.cycle, u.cs, u.phaseExtra);
      let inten = 0, warn = 0, spin = 0;

      if (cs.state === 'on') {
        const attack = Math.min(0.055, cs.on * 0.25);
        inten = attack > 0 ? smoothstep(0, attack, cs.sinceOn) : 1;
        // hot tail-off in the last 40 ms so the beam reads as "shutting down"
        const left = cs.on - cs.sinceOn;
        if (left < 0.05) inten *= clamp(left / 0.05, 0, 1);
        spin = 1;
        anyOn = true;
      } else if (cs.state === 'warn') {
        warn = cs.k;
        spin = cs.k;
        inten = 0.06 * cs.k * cs.k;         // faint pilot glow while charging
      }

      u.inten = inten; u.warn = warn; u.spin = spin;
      if (inten > 0.01) anyLit = true;
      if (warn > 0.01) anyWarn = true;

      if (beamArr) beamArr.fill(inten, u.vStart, u.vStart + u.vCount);
      if (coreArr) coreArr.fill(inten, u.cStart, u.cStart + u.cCount);
      if (aimArr) aimArr.fill(warn, u.aStart, u.aStart + u.aCount);
      if (moteArr) moteArr.fill(inten * 0.9 + warn * 0.15, u.mStart, u.mStart + u.mCount);

      // kill volume — lethal only while fully on (never during warn, never during the ramp tail)
      const lethal = cs.state === 'on';
      if (this.mode === 'sweep') {
        this._sweepWorld(u, 0, u.wa);
        this._sweepWorld(u, 1, u.wb);
        updateKillCapsule(u.kill, u.wa, u.wb, this.radius * 1.15);
      }
      u.kill.active = lethal && this.enabled;

      // one-shot audio on the discrete cycle edges (negative token == "not in this state")
      if (this.edge(u, 'lastOn', cs.state === 'on' ? cs.index : -1 - cs.index) && cs.state === 'on') {
        hazSfx(this.ctx, 'laser_fire', { gain: 0.9, rate: 1, pos: u.wa });
        hazBurst(this.ctx, 'spark', u.wa, { color: this.color.getHex(), count: 6, speed: 3 });
        hazBurst(this.ctx, 'laserHit', u.wb, { color: this.color.getHex(), count: 8, speed: 4 });
      }
      if (this.edge(u, 'lastWarn', cs.state === 'warn' ? cs.index : -1 - cs.index) && cs.state === 'warn') {
        // The spin-up voice: a rising charge tone, not a quiet copy of the fire.
        hazSfx(this.ctx, 'laser_charge', { gain: 0.55, rate: 1, pos: u.wa });
      }
    }

    if (this.beamAttr) this.beamAttr.needsUpdate = true;
    if (this.coreAttr) this.coreAttr.needsUpdate = true;
    if (this.aimAttr) this.aimAttr.needsUpdate = true;
    if (this.moteAttr) this.moteAttr.needsUpdate = true;

    // emitter pods: spin-up + lamp strobe + lens brightness + end glow
    const spinAngle = t * 22;
    for (let i = 0; i < this.emitterPods.length; i++) {
      const pod = this.emitterPods[i];
      const u = pod.unit;
      const spin = u.spin;
      if (this.mode === 'sweep') { pod.pos.set(0, 0, 0); pod.dir.set(0, 1, 0); }
      this._writePod(pod, spinAngle * (0.25 + spin * 1.6));

      const strobe = u.warn > 0
        ? (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * (12 + 26 * u.warn))))
        : (u.inten > 0 ? 1 : 0.12);
      _u.col.setScalar(clamp(strobe, 0.04, 1.6));
      this.lampMesh.setColorAt(pod.i, _u.col);
      _u.col.setScalar(clamp(0.12 + u.inten * 1.8 + u.warn * 0.5, 0, 2));
      this.lensMesh.setColorAt(pod.i, _u.col);

      this.glowAttr.array[i] = clamp(u.inten * 0.95 + u.warn * 0.22, 0, 1);
    }
    this.housingMesh.instanceMatrix.needsUpdate = true;
    this.rotorMesh.instanceMatrix.needsUpdate = true;
    this.lensMesh.instanceMatrix.needsUpdate = true;
    this.lampMesh.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    if (this.lensMesh.instanceColor) this.lensMesh.instanceColor.needsUpdate = true;

    this.beamMesh.visible = anyOn || anyLit;
    this.coreMesh.visible = this.beamMesh.visible;
    this.aimMesh.visible = anyWarn;
  }
}

/** A single timed beam between `a` and `b`. */
export function laser(def, ctx) { return new LaserHazard(def, ctx, 'single'); }

/** A rack of parallel beams with a per-beam phase offset — the classic timing corridor. */
export function laserGrid(def, ctx) { return new LaserHazard(def, ctx, 'grid'); }

/** A beam rotating through an arc about `axis`. */
export function laserSweep(def, ctx) { return new LaserHazard(def, ctx, 'sweep'); }

/* ======================================================================================
   TURRET
   ======================================================================================
   CONTRACT §16 lists `turret` in HAZARDS but §18 defines no ObjectDef for it, and no other
   hazard module was assigned it — so it is implemented here, where the emitter art already
   lives. A turret is a solid pedestal that tracks through an arc and fires deterministic
   energy bolts: bolt k leaves the muzzle at t = k*period + phase and travels at `speed`,
   which makes every bolt position a pure function of the stage clock.
*/

class TurretHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'turret');
    const pal = palette(ctx);
    this.color = new THREE.Color(def.color !== undefined ? def.color : pal.killGlow);
    this.origin = v3(def.p, 0, 0, 0);
    this.scale = clamp(num(def.scale, 1), 0.4, 3);
    this.period = Math.max(0.25, num(def.period, 1.8));
    this.phase = num(def.phase, 0);
    this.speed = clamp(num(def.speed, 16), 3, 60);
    this.range = clamp(num(def.range, 26), 3, 140);
    this.boltRadius = clamp(num(def.radius, 0.26), 0.08, 1.2);
    this.arc = num(def.arc, 0);
    this.sweepPeriod = Math.max(0.4, num(def.sweepPeriod, 5.5));
    this.axis = dirVec(def.axis, 0, 1, 0);
    this.baseDir = dirVec(def.dir || def.aim, 1, 0, 0);
    this.muzzleOffset = 0.62 * this.scale;

    this._aim = new THREE.Vector3().copy(this.baseDir);
    this._q = new THREE.Quaternion();
    this._qs = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();

    this._buildBody();
    this._buildBolts();
    this.reset(0);
  }

  _buildBody() {
    const S = this.scale;
    const metal = hazMat(this.ctx, 'metal');
    const panel = hazMat(this.ctx, 'panel');

    // pedestal — solid, standable, chamfered
    const pedParts = [];
    const base = bevelBox(1.5 * S, 0.34 * S, 1.5 * S, 0.05 * S);
    base.translate(0, 0.17 * S, 0);
    pedParts.push(base);
    const column = new THREE.CylinderGeometry(0.42 * S, 0.55 * S, 0.7 * S, 16);
    column.translate(0, 0.69 * S, 0);
    pedParts.push(column);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.CylinderGeometry(0.50 * S, 0.50 * S, 0.05 * S, 16);
      band.translate(0, (0.45 + i * 0.2) * S, 0);
      pedParts.push(band);
    }
    const ped = new THREE.Mesh(mergeAll(pedParts), metal);
    ped.castShadow = true; ped.receiveShadow = true;
    ped.position.copy(this.origin);
    this.add(ped);

    // rotating head
    const { housing, rotor, lens } = buildEmitterGeometry(S * 0.95);
    this.head = new THREE.Group();
    this.head.position.copy(this.origin).add(_kv.set(0, 1.05 * S, 0));
    const headMesh = new THREE.Mesh(housing, metal);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    if (rotor) {
      this.headRotor = new THREE.Mesh(rotor, panel);
      this.head.add(this.headRotor);
    }
    const lensMat = additiveMaterial(this.color.getHex(), { cached: false });
    this.own(lensMat);
    this.headLens = new THREE.Mesh(lens, lensMat);
    this.headLens.renderOrder = 5;
    this.head.add(this.headLens);
    this.chargeSprite = makeGlowSprite(this.color.getHex(), 0.9 * S, 0, 2.4);
    this.own(this.chargeSprite.material);
    this.chargeSprite.position.set(0, 0.60 * S, 0);
    this.head.add(this.chargeSprite);
    this.add(this.head);

    // pedestal collider — solid so the turret can be used as cover / a platform
    this.colliders.push(makeCollider({
      center: this.origin.clone().add(_kv.set(0, 0.17 * S, 0)),
      half: new THREE.Vector3(0.75 * S, 0.17 * S, 0.75 * S),
      surface: 'normal', ref: this,
    }));
  }

  _buildBolts() {
    this.maxBolts = Math.max(1, Math.ceil((this.range / this.speed) / this.period) + 1);
    const r = this.boltRadius;
    const geoParts = [];
    const core = new THREE.SphereGeometry(r * 0.55, 10, 8);
    geoParts.push(core);
    const tail = new THREE.ConeGeometry(r * 0.5, r * 2.4, 10, 1, true);
    tail.rotateX(Math.PI * 0.5);
    tail.translate(0, 0, -r * 1.3);
    geoParts.push(tail);
    const halo = new THREE.SphereGeometry(r, 12, 8);
    geoParts.push(halo);
    const mat = additiveMaterial(this.color.getHex(), { cached: false, opacity: 0.95, side: THREE.DoubleSide });
    this.own(mat);
    this.boltMesh = new THREE.InstancedMesh(mergeAll(geoParts), mat, this.maxBolts);
    this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.renderOrder = 6;
    this.add(this.boltMesh);

    this.bolts = [];
    for (let i = 0; i < this.maxBolts; i++) {
      const kv = makeKill({
        type: 'sphere', center: this.origin, radius: this.boltRadius * 0.9,
        kind: 'laser', ref: this, active: false,
      });
      kv.active = false;
      this.kills.push(kv);
      this.bolts.push({ kill: kv, pos: new THREE.Vector3(), live: false, index: -1 });
    }
    this._lastFire = null;
  }

  /** Aim direction at absolute stage time `ts` — pure, so a bolt keeps the heading it was fired on. */
  aimAt(ts, out) {
    out.copy(this.baseDir);
    if (this.arc > 0.0001) {
      const a = Math.sin((ts / this.sweepPeriod) * Math.PI * 2) * this.arc * 0.5;
      this._qs.setFromAxisAngle(this.axis, a);
      out.applyQuaternion(this._qs);
    }
    return out.normalize();
  }

  update(t, dt) {
    this.time = t;
    const S = this.scale;

    // head tracking
    this.aimAt(t, this._aim);
    this._q.setFromUnitVectors(UP, this._aim);
    this.head.quaternion.copy(this._q);
    if (this.headRotor) this.headRotor.rotation.y = t * 9;

    // charge tell: brighten in the 0.45 s before the next shot
    const sinceShot = ((t + this.phase) % this.period + this.period) % this.period;
    const toShot = this.period - sinceShot;
    const charge = clamp(1 - toShot / 0.45, 0, 1);
    const flash = clamp(1 - sinceShot / 0.12, 0, 1);
    this.chargeSprite.material.opacity = clamp(charge * 0.8 + flash, 0, 1.6);
    this.chargeSprite.scale.setScalar(S * (0.55 + charge * 0.8 + flash * 1.2));
    this.headLens.material.opacity = clamp(0.25 + charge * 0.7 + flash, 0, 1.7);

    // shot bookkeeping
    const shotIndex = Math.floor((t + this.phase) / this.period);
    if (this.edge(this, '_lastFire', shotIndex)) {
      this._muzzle.copy(this.head.position).addScaledVector(this._aim, this.muzzleOffset);
      hazSfx(this.ctx, 'laser_fire', { gain: 0.7, rate: 1.35, pos: this._muzzle });
      hazBurst(this.ctx, 'spark', this._muzzle, { color: this.color.getHex(), count: 10, speed: 5 });
    }

    // live bolts — every position derived from its own fire time
    let slot = 0;
    for (let k = shotIndex; k > shotIndex - this.maxBolts; k--) {
      const fireT = k * this.period - this.phase;
      const age = t - fireT;
      const b = this.bolts[slot];
      const dist = age * this.speed;
      if (age < 0 || dist > this.range) {
        b.live = false;
        b.kill.active = false;
        _u.m.makeScale(0, 0, 0);
        this.boltMesh.setMatrixAt(slot, _u.m);
      } else {
        this.aimAt(fireT, _u.tmp);
        b.pos.copy(this.head.position).addScaledVector(_u.tmp, this.muzzleOffset + dist);
        b.live = true;
        b.index = k;
        updateKillSphere(b.kill, b.pos, this.boltRadius * 0.9);
        b.kill.active = this.enabled;
        _u.q.setFromUnitVectors(FWD, _u.tmp);
        const pulse = 1 + 0.16 * Math.sin(t * 40 + k * 1.7);
        _u.sc2.set(pulse, pulse, 1.5 * pulse);
        _u.m.compose(b.pos, _u.q, _u.sc2);
        this.boltMesh.setMatrixAt(slot, _u.m);
      }
      slot++;
    }
    this.boltMesh.instanceMatrix.needsUpdate = true;
  }
}

/** Pedestal turret firing deterministic energy bolts along a (optionally sweeping) heading. */
export function turret(def, ctx) { return new TurretHazard(def, ctx); }
