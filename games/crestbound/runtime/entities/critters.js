/**
 * CRESTBOUND — runtime/entities/critters.js
 * ---------------------------------------------------------------------------
 * CONTRACT §23. The five course creatures: GNASHER (chained lunger), BUMBLER
 * (waddling patroller), SKITTER (swooping flyer), WARDEN (3-hit mini-boss) and
 * OLD FEN (the Keep caretaker NPC).
 *
 *   export const CRITTERS = { gnasher, bumbler, skitter, warden, fen };
 *   export function makeCritter(def, ctx) -> Critter
 *   Critter = { mesh, colliders, kills, events, update(dt, player), reset(),
 *               onPound(player, pos), onDive(player), onStand(player), dispose() }
 *
 * DESIGN
 *  - Every creature is an ARTICULATED, multi-part procedural body (doctrine:
 *    no naked primitives). Static parts are merged per material into one mesh
 *    with geometry groups (one draw call per material); moving parts (jaws,
 *    legs, wings, arms) hang off pivot Object3Ds and are posed every frame by
 *    a damped pose vector — the same critically-damped blend the hero uses.
 *    Eyes are a merged sclera mesh + one 2-instance pupil mesh so they can
 *    track the hero and wobble ("googly") for two draw calls.
 *  - Behaviour is a small explicit state machine per creature. Anything that
 *    does not read the player (patrol paths, flight paths, idle cycles) is a
 *    pure function of the creature clock, so reset() reproduces the exact
 *    frame. Randomness comes from a per-creature mulberry32 stream seeded from
 *    the course id + kind + index, re-seeded on reset() (doctrine §4).
 *  - Kill volumes (KillVolume) are exposed in `kills` and are ACTIVE only for
 *    the frames the creature is actually lethal (gnasher: the lunge; warden:
 *    only when def.lethal). Everything else is FAIR: `ctx.hurt(player, dir,
 *    {knockback, stun})` knocks the hero back without a death.
 *  - Solid parts are Colliders in `colliders`, `ref` = the creature, which
 *    publishes `linVel` so the resolver carries/pushes the hero correctly.
 *  - Optional GLTF path: `def.model` loads assets/critters/<model> through
 *    GLTFLoader, strips embedded lights, repairs materials, plays clips by
 *    state. The procedural rig is the DEFAULT and stays the collision truth.
 *
 * ctx (from Course): { scene|group, mats, theme, fx, audio, save, courseId, world,
 *   quality, camera?, hurt(player, dir, opts)?, say(text)?, trigger(id)?,
 *   collectibles?, awardCoins(n, pos)?, shake(amount, ms)?, input?, index? }
 *
 * PERF: update() allocates nothing; all vectors/quaternions are module scratch.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  clamp, damp, dampAngle, smoothstep, easeOutCubic, easeOutBack,
  mulberry32, hashString, Emitter, TAU, wrapAngle,
} from '../core/util.js';
import { TUNE, headingFromYaw, yawFromHeading } from '../core/tuning.js';
import {
  bevelBoxGeometry, prismGeometry, tubeGeometry, ringProfileGeometry, discGeometry,
  getMaterial, getEmissive, getGlow,
} from '../world/builders.js';
import { Collider, KillVolume } from '../world/collider.js';

/* ===========================================================================
 * 0. Scratch — update paths never allocate
 * ======================================================================== */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _s0 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();
const _cap = { a: _capA, b: _capB, r: TUNE.radius };
const _rayOut = { t: 0, normal: new THREE.Vector3(), collider: null };
const _sfxOpts = { rate: 1, gain: 1, pos: null, listener: null };
const _burstOpts = { color: 0, strength: 1 };
const _hurtOpts = { knockback: 6, stun: 0.4, source: 'critter' };
const _hurtDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/* ===========================================================================
 * 1. Helpers
 * ======================================================================== */

function fin(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

function readV3(src, out, dx, dy, dz) {
  out.set(dx || 0, dy || 0, dz || 0);
  if (!src) return out;
  if (Array.isArray(src)) out.set(fin(src[0], out.x), fin(src[1], out.y), fin(src[2], out.z));
  else if (typeof src === 'object') out.set(fin(src.x, out.x), fin(src.y, out.y), fin(src.z, out.z));
  return out;
}

function capsuleOf(player) {
  const c = player.capsule;
  if (c && c.a && c.b) {
    _capA.copy(c.a); _capB.copy(c.b);
    _cap.r = fin(c.r, TUNE.radius);
    return _cap;
  }
  const p = player.pos || player.position;
  const r = fin(player.radius, TUNE.radius);
  const h = fin(player.height, TUNE.height);
  _capA.set(p.x, p.y + r, p.z);
  _capB.set(p.x, p.y + Math.max(h - r, r + 0.01), p.z);
  _cap.r = r;
  return _cap;
}

function segPointDistSq(a, b, px, py, pz) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Capsule vs sphere overlap. */
function capsuleHitsSphere(cap, cx, cy, cz, r) {
  const rr = r + cap.r;
  return segPointDistSq(cap.a, cap.b, cx, cy, cz) <= rr * rr;
}

function paletteOf(theme) {
  return (theme && typeof theme === 'object' && theme.palette) ? theme.palette : null;
}

/** Deterministic triangle wave 0..1..0 over period 1. */
function tri(u) { u = u - Math.floor(u); return u < 0.5 ? u * 2 : 2 - u * 2; }

/* ===========================================================================
 * 2. Materials — critter skins, cached module-wide
 * ======================================================================== */

const _matCache = new Map();

function skinMat(color, roughness, metalness, emissive, emissiveI) {
  const key = 'skin:' + (color >>> 0).toString(16) + ':' + roughness + ':' + (metalness || 0) + ':' + (emissive || 0) + ':' + (emissiveI || 0);
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color, roughness, metalness: metalness || 0,
    emissive: emissive || 0x000000, emissiveIntensity: emissiveI || 0,
  });
  m.name = 'cb.critter.' + key;
  _matCache.set(key, m);
  return m;
}

function eyeWhiteMat() {
  const key = 'eyewhite';
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({ color: 0xfff6ea, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  m.name = 'cb.critter.eyewhite';
  _matCache.set(key, m);
  return m;
}

function pupilMat() {
  const key = 'pupil';
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.25, metalness: 0.1, emissive: 0x111111, emissiveIntensity: 0.3 });
  m.name = 'cb.critter.pupil';
  _matCache.set(key, m);
  return m;
}

function wingMat() {
  const key = 'wing';
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color: 0xbfefff, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false, iridescence: 0.8, iridescenceIOR: 1.4,
    emissive: 0x2a6f8a, emissiveIntensity: 0.25,
  });
  m.name = 'cb.critter.wing';
  _matCache.set(key, m);
  return m;
}

/** Resolve a Mats key against the world material bank (with builders' fallback). */
function worldMat(key, ctx) {
  try { return getMaterial(key, ctx.theme, ctx.mats); } catch (e) { return skinMat(0x777777, 0.7); }
}

/* ===========================================================================
 * 3. Geometry helpers
 * ======================================================================== */

const _geoCache = new Map();

function cached(key, factory) {
  let g = _geoCache.get(key);
  if (g) return g;
  g = factory();
  g.userData.__shared = true;
  _geoCache.set(key, g);
  return g;
}

function normalizeAttrs(g) {
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (g.index) { const n = g.toNonIndexed(); g.dispose(); return n; }
  return g;
}

function sphereGeo(r, ws, hs, phiStart, phiLen, thetaStart, thetaLen) {
  const g = new THREE.SphereGeometry(r, ws || 16, hs || 12, phiStart || 0, phiLen === undefined ? TAU : phiLen,
    thetaStart || 0, thetaLen === undefined ? Math.PI : thetaLen);
  return normalizeAttrs(g);
}

function capsuleGeo(r, len, seg) {
  return normalizeAttrs(new THREE.CapsuleGeometry(r, len, 3, seg || 10));
}

function coneGeo(rBot, h, sides) {
  return tubeGeometry(0, rBot, h, sides || 6, 1);
}

function bbox(w, h, d, bevel) {
  return bevelBoxGeometry(w, h, d, bevel === undefined ? Math.min(w, h, d) * 0.22 : bevel, 1);
}

/**
 * Transform a geometry in place (build time only).
 * (x,y,z) translate, (rx,ry,rz) Euler XYZ, (sx,sy,sz) scale.
 */
function place(g, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (sx !== undefined) g.scale(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  if (rx || ry || rz) {
    _q0.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'XYZ'));
    _v0.set(x || 0, y || 0, z || 0);
    _s0.set(1, 1, 1);
    _m0.compose(_v0, _q0, _s0);
    g.applyMatrix4(_m0);
  } else if (x || y || z) {
    g.translate(x || 0, y || 0, z || 0);
  }
  return g;
}

/**
 * Merge a list of {g, m} parts into ONE mesh with one geometry group per
 * distinct material (draw calls = distinct materials). Part geometries are
 * consumed (disposed) — pass fresh geometries, never cached ones.
 */
/**
 * Coalescing key for a critter material.
 *
 * A critter's body is authored as a dozen small parts, each with its own flat
 * colour — skin, belly, cheeks, snout, ear linings.  `mergeParts` emits ONE
 * draw per distinct material, so a bumbler cost 13 draw calls and seven of
 * them differed in nothing but `color`.  Any map-free, opaque standard
 * material can carry its colour in a `color` ATTRIBUTE instead, letting every
 * part in the same shading family share one material and one draw.
 *
 * Materials with textures (the world bank's copper/brass/wood), physical
 * materials (eye whites, wings) and anything transparent are excluded: they
 * differ in more than colour and keep their own group.
 * Roughness and metalness are bucketed to 0.1 so "0.62 skin" and "0.60 belly"
 * do not split the family over a difference nothing can see.
 */
function vcKey(m) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return null;
  if (m.map || m.normalMap || m.roughnessMap || m.metalnessMap || m.emissiveMap || m.alphaMap) return null;
  if (m.transparent || m.side !== THREE.FrontSide) return null;
  const r = Math.round((m.roughness || 0) * 10) / 10;
  const mt = Math.round((m.metalness || 0) * 10) / 10;
  const e = m.emissive ? m.emissive.getHexString() : '000000';
  const ei = Math.round((m.emissiveIntensity || 0) * 20) / 20;
  return 'vc:' + r + ':' + mt + ':' + e + ':' + ei;
}

/** The shared vertex-coloured material for a coalescing family. */
function vcMat(m, key) {
  let out = _matCache.get(key);
  if (out) return out;
  out = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true,
    roughness: Math.round((m.roughness || 0) * 10) / 10,
    metalness: Math.round((m.metalness || 0) * 10) / 10,
    emissive: m.emissive ? m.emissive.getHex() : 0x000000,
    emissiveIntensity: m.emissiveIntensity || 0,
  });
  out.name = 'cb.critter.' + key;
  _matCache.set(key, out);
  return out;
}

const _WHITE = new THREE.Color(1, 1, 1);

/** Write a flat colour into a geometry's `color` attribute (working space). */
function bakeColor(g, col) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function mergeParts(parts, name) {
  /* Colour-only differences collapse into one vertex-coloured material — see
     vcKey.  Everything else groups by material identity as before. */
  const byMat = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const k = vcKey(p.m);
    const mat = k ? vcMat(p.m, k) : p.m;
    let b = null;
    for (let j = 0; j < byMat.length; j++) if (byMat[j].m === mat) { b = byMat[j]; break; }
    if (!b) { b = { m: mat, gs: [] }; byMat.push(b); }
    /* Every part gets a `color` attribute, white when it is not coalescing:
       mergeGeometries refuses a batch whose inputs disagree on their attribute
       set, and the multi-material merge below mixes both kinds. */
    const g = normalizeAttrs(p.g);
    b.gs.push(bakeColor(g, k ? p.m.color : _WHITE));
  }
  const geos = [], mats = [];
  for (let k = 0; k < byMat.length; k++) {
    const gs = byMat[k].gs;
    const g = gs.length === 1 ? gs[0] : mergeGeometries(gs, false);
    if (gs.length > 1) for (const x of gs) x.dispose();
    geos.push(g);
    mats.push(byMat[k].m);
  }
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
  if (geos.length > 1) for (const x of geos) x.dispose();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
  mesh.name = name || 'part';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * A pair of eyes: merged sclera mesh + a 2-instance pupil mesh. Returns
 * {group, pupils, r, sep, look(x, y)} where look() nudges the pupils (googly).
 * Eyes face +Z (the creature's forward is +Z in local space; yaw handles the rest).
 */
function makeEyes(r, sep, x, y, z, tilt) {
  const group = new THREE.Group();
  group.name = 'eyes';
  const white = eyeWhiteMat();
  const sL = sphereGeo(r, 14, 10), sR = sphereGeo(r, 14, 10);
  place(sL, -sep * 0.5, 0, 0);
  place(sR, sep * 0.5, 0, 0);
  // brow ridge: a thin bevelled bar over both eyes, gives the eyes a "face"
  const sclera = mergeParts([{ g: sL, m: white }, { g: sR, m: white }], 'sclera');
  sclera.castShadow = false;
  group.add(sclera);
  const pupilGeo = cached('pupil:' + r.toFixed(3), () => { const g = sphereGeo(r * 0.42, 10, 8); g.computeBoundingSphere(); return g; });
  const pupils = new THREE.InstancedMesh(pupilGeo, pupilMat(), 2);
  pupils.name = 'pupils';
  pupils.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pupils.castShadow = false;
  pupils.frustumCulled = false;
  group.add(pupils);
  group.position.set(x, y, z);
  if (tilt) group.rotation.x = tilt;
  const eyes = {
    group, pupils, r, sep, lx: 0, ly: 0,
    /** Place both pupils on the front of the sclera, offset by a look vector (−1..1). */
    look(lx, ly) {
      this.lx = lx; this.ly = ly;
      const px = clamp(lx, -1, 1) * r * 0.55, py = clamp(ly, -1, 1) * r * 0.5;
      const pz = Math.sqrt(Math.max(0.05 * r * r, r * r - px * px - py * py)) * 0.92;
      _s0.set(1, 1, 1);
      _q0.identity();
      _v0.set(-sep * 0.5 + px, py, pz);
      _m0.compose(_v0, _q0, _s0);
      pupils.setMatrixAt(0, _m0);
      _v0.set(sep * 0.5 + px, py, pz);
      _m0.compose(_v0, _q0, _s0);
      pupils.setMatrixAt(1, _m0);
      pupils.instanceMatrix.needsUpdate = true;
    },
  };
  eyes.look(0, 0);
  return eyes;
}

/** Polyline helpers: pts Float32Array(n*3), cum = cumulative lengths (n). */
function polylineLengths(pts, n, loop, cum) {
  let L = 0;
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3, b = i * 3;
    L += Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
    cum[i] = L;
  }
  if (loop && n > 1) {
    const a = (n - 1) * 3;
    L += Math.hypot(pts[0] - pts[a], pts[1] - pts[a + 1], pts[2] - pts[a + 2]);
  }
  return L;
}

/** Position (out) and tangent (outDir) at arc length s along the polyline. */
function polylineAt(pts, n, cum, L, loop, s, out, outDir) {
  if (n === 1 || L <= 1e-6) { out.set(pts[0], pts[1], pts[2]); outDir.set(0, 0, -1); return; }
  if (loop) { s = s % L; if (s < 0) s += L; } else { s = clamp(s, 0, L); }
  let i = 0;
  const segs = loop ? n : n - 1;
  for (i = 0; i < segs; i++) {
    const s0 = cum[i], s1 = (i + 1 < n) ? cum[i + 1] : L;
    if (s <= s1 || i === segs - 1) {
      const a = i * 3, b = ((i + 1) % n) * 3;
      const len = Math.max(1e-6, s1 - s0);
      const u = clamp((s - s0) / len, 0, 1);
      outDir.set(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
      out.set(pts[a] + outDir.x * u, pts[a + 1] + outDir.y * u, pts[a + 2] + outDir.z * u);
      if (outDir.lengthSq() > 1e-9) outDir.normalize(); else outDir.set(0, 0, -1);
      return;
    }
  }
}

/* ===========================================================================
 * 4. Critter base
 * ======================================================================== */

let _critterIndex = 0;

export class Critter {
  constructor(def, ctx, kind) {
    this.kind = kind;
    this.def = def || {};
    this.ctx = ctx || {};
    this.mesh = new THREE.Group();
    this.mesh.name = 'critter_' + kind;
    /** Procedural body lives here; a loaded GLTF replaces it visually. */
    this.rig = new THREE.Group();
    this.rig.name = 'rig';
    this.mesh.add(this.rig);
    this.colliders = [];
    this.kills = [];
    this.events = new Emitter();
    this.time = 0;
    this.enabled = true;
    this.alive = true;
    this.hud = null;
    /** Linear velocity published for Collider.velocityAt (carry/push). */
    this.linVel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this._silent = true;
    this._owned = [];
    this._epoch = 0;

    this.theme = this.ctx.theme || null;
    this.mats = this.ctx.mats || null;
    this.audio = this.ctx.audio || null;
    this.camera = this.ctx.camera || (this.ctx.engine && this.ctx.engine.camera) || null;
    this.world = this.ctx.world || null;
    const pal = paletteOf(this.theme);
    this.realmColor = pal && pal.crest !== undefined ? pal.crest : (pal && pal.accent !== undefined ? pal.accent : 0x4fd1ff);
    this.accentColor = pal && pal.accent !== undefined ? pal.accent : 0x7ec8ff;
    this.coinColor = pal && pal.coin !== undefined ? pal.coin : 0xffcf4d;

    const fx = this.ctx.fx || null;
    this.ps = fx ? (typeof fx.burst === 'function' ? fx
      : (fx.ps && typeof fx.ps.burst === 'function') ? fx.ps
      : (fx.particles && typeof fx.particles.burst === 'function') ? fx.particles : null) : null;

    const idx = this.ctx.index !== undefined ? this.ctx.index : (_critterIndex++);
    this.index = idx;
    this.seed = hashString((this.ctx.courseId || 'course') + ':' + kind + ':' + idx);
    this.rng = mulberry32(this.seed);

    // GLTF path (optional)
    this.model = null;
    this.mixer = null;
    this._clips = null;
    this._clipState = '';
    this._clipAction = null;
    if (this.def.model) this._loadModel(this.def.model);
  }

  /* ---- context helpers -------------------------------------------------- */

  own(res) { if (res) this._owned.push(res); return res; }

  _sfx(name, pos, rate, gain) {
    if (this._silent || !this.audio || typeof this.audio.sfx !== 'function') return;
    _sfxOpts.rate = rate === undefined ? 1 : rate;
    _sfxOpts.gain = gain === undefined ? 1 : gain;
    _sfxOpts.pos = pos || null;
    _sfxOpts.listener = this.camera;
    try { this.audio.sfx(name, _sfxOpts); } catch (e) { /* audio never breaks a critter */ }
  }

  _burst(preset, pos, color, strength) {
    if (this._silent || !this.ps) return;
    _burstOpts.color = color === undefined ? this.accentColor : color;
    _burstOpts.strength = strength === undefined ? 1 : strength;
    try { this.ps.burst(preset, pos, _burstOpts); } catch (e) { /* VFX never breaks a critter */ }
  }

  _shake(amount, ms) {
    const c = this.ctx;
    try {
      if (typeof c.shake === 'function') c.shake(amount, ms);
      else if (c.cam && typeof c.cam.shake === 'function') c.cam.shake(amount, ms);
    } catch (e) { /* noop */ }
  }

  /**
   * Fair hit: knock the hero back along (dx, dz) — never a death.
   * Routes through ctx.hurt when the game provides it; otherwise applies the
   * knockback to the player's velocity directly.
   */
  _hurt(player, dx, dz, knockback, stun) {
    if (!player || player.dead) return;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) _hurtDir.set(dx / l, 0, dz / l); else headingFromYaw(this.yaw, _hurtDir);
    _hurtOpts.knockback = knockback;
    _hurtOpts.stun = stun;
    _hurtOpts.source = this.kind;
    const c = this.ctx;
    if (typeof c.hurt === 'function') {
      try { c.hurt(player, _hurtDir, _hurtOpts); } catch (e) { /* noop */ }
    } else if (player.vel) {
      player.vel.x = _hurtDir.x * knockback;
      player.vel.z = _hurtDir.z * knockback;
      if (player.vel.y < 3.5) player.vel.y = 3.5;
      if (typeof player.stun === 'function') player.stun(stun);
      else player.stunT = stun;
    }
    this.events.emit('hurt', player, this);
  }

  /** Fire a course trigger id ('gnasher-freed', 'warden-down'). */
  _trigger(id) {
    const c = this.ctx;
    try {
      if (typeof c.trigger === 'function') c.trigger(id, this);
      else if (c.collectibles && typeof c.collectibles.trigger === 'function') c.collectibles.trigger(id);
      else if (c.events && typeof c.events.emit === 'function') c.events.emit('trigger', id, this);
    } catch (e) { /* noop */ }
    this.events.emit('trigger', id, this);
  }

  _awardCoins(n, pos) {
    const c = this.ctx;
    try { if (typeof c.awardCoins === 'function') c.awardCoins(n, pos); } catch (e) { /* noop */ }
    this.events.emit('coins', n, pos);
  }

  /** Ground height under (x, z) via the broadphase raycast, else fallback. */
  _groundY(x, y, z, fallback) {
    const w = this.world;
    if (!w || typeof w.raycast !== 'function') return fallback;
    _v3.set(x, y + 2.0, z);
    _rayOut.t = 0; _rayOut.collider = null;
    let hit = false;
    try { hit = w.raycast(_v3, DOWN, 40, _rayOut); } catch (e) { hit = false; }
    return hit ? _v3.y - _rayOut.t : fallback;
  }

  _solidBox(cx, cy, cz, hx, hy, hz, surface, props) {
    const c = new Collider({
      center: [cx, cy, cz], half: [hx, hy, hz], surface: surface || 'normal',
      props: props || null, ref: this, group: 'critter',
    });
    this.colliders.push(c);
    return c;
  }

  _killSphere(cx, cy, cz, r, kind) {
    const k = new KillVolume({ type: 'sphere', kind, center: [cx, cy, cz], radius: r, ref: this, active: false });
    this.kills.push(k);
    return k;
  }

  /* ---- GLTF path -------------------------------------------------------- */

  /**
   * Load an authored model for this creature. The procedural rig is hidden when
   * the model arrives; behaviour and collision are unchanged. Epoch-guarded so a
   * disposed creature never receives a late load (doctrine §4).
   */
  _loadModel(file) {
    const epoch = ++this._epoch;
    let url;
    try { url = new URL('../../assets/critters/' + file, import.meta.url).href; } catch (e) { return; }
    const loader = new GLTFLoader();
    loader.loadAsync(url).then((gltf) => {
      if (epoch !== this._epoch) return;
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) return;
      // strip embedded lights — theme lighting is ours (doctrine §3)
      const lights = [];
      root.traverse((o) => { if (o.isLight) lights.push(o); });
      for (const l of lights) if (l.parent) l.parent.remove(l);
      const aniso = (this.ctx.renderer && this.ctx.renderer.capabilities && this.ctx.renderer.capabilities.getMaxAnisotropy)
        ? Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy()) : 4;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = false;
        if (o.isSkinnedMesh) o.frustumCulled = false;   // bind-pose bounds lie
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = aniso; }
          if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          for (const k of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
            if (m[k]) { m[k].colorSpace = THREE.NoColorSpace; m[k].anisotropy = aniso; }
          }
          if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) m.envMapIntensity = 1.0;
          m.shadowSide = THREE.FrontSide;
        }
      });
      // fit to the creature's natural height
      const box = new THREE.Box3().setFromObject(root);
      const h = Math.max(1e-3, box.max.y - box.min.y);
      const want = fin(this.def.scale, 0) || this.naturalHeight || 1;
      const s = fin(this.def.scale, 0) ? this.def.scale : want / h;
      root.scale.setScalar(s);
      root.position.y -= box.min.y * s;
      this.model = root;
      this.mesh.add(root);
      this.rig.visible = false;
      if (gltf.animations && gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(root);
        this._clips = gltf.animations;
        this._playClip(this._clipState || 'idle', 0);
      }
      this.events.emit('model', this);
    }).catch((e) => {
      console.warn('[critters] model "' + file + '" failed to load; procedural body kept', e && e.message);
    });
  }

  /** Cross-fade to the clip that best matches an animation state. */
  _playClip(state, fade) {
    this._clipState = state;
    if (!this.mixer || !this._clips) return;
    const names = CLIP_MAP[state] || CLIP_MAP.idle;
    let clip = null;
    for (let i = 0; i < names.length && !clip; i++) {
      for (let k = 0; k < this._clips.length; k++) {
        if (this._clips[k].name.toLowerCase().indexOf(names[i]) >= 0) { clip = this._clips[k]; break; }
      }
    }
    if (!clip) clip = this._clips[0];
    const action = this.mixer.clipAction(clip);
    if (this._clipAction === action) return;
    if (this._clipAction) this._clipAction.fadeOut(fade === undefined ? 0.18 : fade);
    action.reset().fadeIn(fade === undefined ? 0.18 : fade).play();
    if (state === 'death' || state === 'hit') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    this._clipAction = action;
  }

  /* ---- lifecycle -------------------------------------------------------- */

  update(dt, player) {
    this.time += dt;
    if (this.mixer) this.mixer.update(dt);
  }

  /** Deterministic reset: clock 0, rng re-seeded, subclasses restore pose. */
  reset() {
    this._silent = true;
    this.time = 0;
    this.rng = mulberry32(this.seed);
    this.linVel.set(0, 0, 0);
    this._reset();
    this._silent = false;
  }

  _reset() {}

  onPound(/* player, pos */) {}
  onDive(/* player */) {}
  onStand(/* player */) {}

  dispose() {
    this._epoch++;
    this.events.clear();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData.__shared) o.geometry.dispose();
    });
    for (const r of this._owned) { try { r.dispose(); } catch (e) { /* noop */ } }
    this._owned.length = 0;
    for (const c of this.colliders) if (c._bp && typeof c._bp.remove === 'function') c._bp.remove(c);
    this.colliders.length = 0;
    this.kills.length = 0;
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.model = null;
  }
}

/** Animation-state → candidate clip name fragments (lower-case substring match). */
const CLIP_MAP = {
  idle: ['idle', 'breath', 'stand'],
  walk: ['walk', 'run', 'move', 'fly'],
  telegraph: ['charge', 'windup', 'prepare', 'idle'],
  attack: ['attack', 'bite', 'jump', 'lunge', 'stomp'],
  hit: ['hitreact', 'hit', 'damage', 'stun'],
  dizzy: ['dizzy', 'stun', 'idle'],
  squish: ['death', 'die', 'flat'],
  death: ['death', 'die', 'fall'],
  roar: ['roar', 'yell', 'taunt', 'attack'],
};

/* ===========================================================================
 * 5. GNASHER — spiked iron ball on a chain
 * ======================================================================== */

const GN_R = 0.55;             // body radius
const GN_LINK = 0.30;          // chain pitch (metres per link)
const GN_TELE = 0.5, GN_RECOVER = 1.2, GN_LUNGE_SPEED = 21, GN_LUNGE_MAX_T = 0.5;
const GN_POUNDS_TO_FREE = 3;

class Gnasher extends Critter {
  constructor(def, ctx) {
    super(def, ctx, 'gnasher');
    this.naturalHeight = GN_R * 2;
    const d = this.def;
    readV3(d.p, this.pos);
    this.chainLen = Math.max(2, fin(d.chain, 6));
    this.yaw = fin(d.yaw, 0);
    this.groundY = this._groundY(this.pos.x, this.pos.y, this.pos.z, this.pos.y - GN_R);
    this.rest = new THREE.Vector3(this.pos.x, this.groundY + GN_R, this.pos.z);
    this.pos.copy(this.rest);

    // post: authored or 1.4 m behind the rest point
    this.post = new THREE.Vector3();
    if (d.post) readV3(d.post, this.post);
    else { headingFromYaw(this.yaw, _v0); this.post.set(this.rest.x - _v0.x * 1.4, this.groundY, this.rest.z - _v0.z * 1.4); }
    this.post.y = this._groundY(this.post.x, this.post.y + 0.5, this.post.z, this.groundY);
    this.anchor = new THREE.Vector3(this.post.x, this.post.y + 1.15, this.post.z);
    this.postSink = 0;

    this.state = 'idle';
    this.stateT = 0;
    this.pounds = 0;
    this.freed = false;
    this.lungeDir = new THREE.Vector3();
    this.lungeFrom = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.jaw = 0;          // 0 closed .. 1 open
    this.jawT = 0;
    this.crouch = 0;
    this.idleHopT = 1.5 + this.rng() * 1.5;
    this.hopDir = new THREE.Vector3();
    this.hopT = 0;
    this.boundT = 0;
    this.boundDir = new THREE.Vector3();
    this.bodyYaw = this.yaw;

    this._build();
    this._buildChain();
    this._buildPost();

    this.bodyCol = this._solidBox(this.pos.x, this.pos.y, this.pos.z, GN_R * 0.85, GN_R * 0.85, GN_R * 0.85, 'normal', null);
    this.postCol = this._solidBox(this.post.x, this.post.y + 0.6, this.post.z, 0.22, 0.6, 0.22, 'normal', null);
    this.kill = this._killSphere(this.pos.x, this.pos.y, this.pos.z, GN_R * 1.05, 'gnasher');

    this._pose();
    this._silent = false;
  }

  _build() {
    const iron = worldMat('metal', this.ctx);
    const dark = skinMat(0x2b2e36, 0.55, 0.75);
    const gullet = skinMat(0x8a1a2a, 0.6, 0.0, 0x4a0810, 0.6);
    const tooth = skinMat(0xe9e2cc, 0.35, 0.05);

    // body: rear 62% of the sphere, ridged with a plated band
    const body = new THREE.Group();
    body.name = 'body';
    const shell = sphereGeo(GN_R, 22, 16, Math.PI * 0.32, Math.PI * 1.36);   // leaves the front open
    const band = ringProfileGeometry(GN_R * 0.98, [0.05, 0.035, 0.012], 24, 1);
    place(band, 0, 0, 0, 0, 0, 0);
    const bandB = ringProfileGeometry(GN_R * 0.98, [0.05, 0.035, 0.012], 24, 1);
    place(bandB, 0, 0, 0, Math.PI / 2, 0, 0);
    const bodyMesh = mergeParts([{ g: shell, m: dark }, { g: band, m: iron }, { g: bandB, m: iron }], 'shell');
    body.add(bodyMesh);
    // gullet: a red inner sphere so the open mouth reads red
    const gul = new THREE.Mesh(cached('gn:gullet', () => sphereGeo(GN_R * 0.82, 16, 12)), gullet);
    gul.castShadow = false;
    body.add(gul);
    // spikes: 4-sided forged points on a fibonacci sphere, skipping the mouth cone
    const spikeGeo = cached('gn:spike', () => {
      const g = coneGeo(0.075, 0.30, 4);
      place(g, 0, 0.15, 0);
      return g;
    });
    const nSp = 26;
    const spikes = new THREE.InstancedMesh(spikeGeo, iron, nSp);
    spikes.name = 'spikes';
    let placed = 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 64 && placed < nSp; i++) {
      const y = 1 - (i / 63) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = golden * i;
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      if (z > 0.35) continue;   // mouth side
      _v0.set(x, y, z);
      _q0.setFromUnitVectors(UP, _v0);
      _v1.copy(_v0).multiplyScalar(GN_R * 0.93);
      _s0.set(1, 1, 1);
      _m0.compose(_v1, _q0, _s0);
      spikes.setMatrixAt(placed++, _m0);
    }
    spikes.count = placed;
    spikes.castShadow = true;
    body.add(spikes);

    // jaws: two quarter-shells hinged at the sphere centre on the X axis
    const mkJaw = (upper) => {
      const piv = new THREE.Group();
      piv.name = upper ? 'jawUpper' : 'jawLower';
      const th0 = upper ? 0 : Math.PI * 0.5;
      const shellJ = sphereGeo(GN_R * 1.02, 22, 8, 0, Math.PI, th0, Math.PI * 0.5);
      // SphereGeometry phi 0..π spans +X → −X through +Z: the front half
      const lip = ringProfileGeometry(GN_R * 0.96, [0.03, 0.03, 0.01], 24, 1);
      place(lip, 0, 0, 0, Math.PI / 2, 0, 0);
      // keep only the front half of the lip by offsetting it slightly forward — a full ring
      // reads as a hinge collar, which is exactly what a hinged jaw needs
      const jaw = mergeParts([{ g: shellJ, m: dark }, { g: lip, m: iron }], 'jawShell');
      piv.add(jaw);
      // teeth along the front rim
      const n = 7;
      const teeth = new THREE.InstancedMesh(cached('gn:tooth', () => { const g = coneGeo(0.045, 0.16, 4); place(g, 0, 0.08, 0); return g; }), tooth, n);
      teeth.name = 'teeth';
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * Math.PI * 0.8 + Math.PI * 0.1;   // across the front arc
        const x = Math.cos(a) * GN_R * 0.9, z = Math.sin(a) * GN_R * 0.9;
        _v0.set(x, 0, z);
        // teeth point across the mouth: upper teeth down, lower up
        _v1.set(0, upper ? -1 : 1, 0);
        _q0.setFromUnitVectors(UP, _v1);
        _s0.set(1, 1, 1);
        _m0.compose(_v0, _q0, _s0);
        teeth.setMatrixAt(i, _m0);
      }
      teeth.castShadow = false;
      piv.add(teeth);
      body.add(piv);
      return piv;
    };
    this.jawUpper = mkJaw(true);
    this.jawLower = mkJaw(false);

    // eyes on the upper jaw brow
    this.eyes = makeEyes(0.1, 0.34, 0, GN_R * 0.55, GN_R * 0.72, -0.35);
    this.jawUpper.add(this.eyes.group);

    this.body = body;
    this.rig.add(body);
  }

  _buildChain() {
    const n = Math.max(4, Math.round(this.chainLen / GN_LINK));
    this.linkCount = n;
    this.chainP = new Float32Array((n + 1) * 3);
    this.chainQ = new Float32Array((n + 1) * 3);   // previous positions
    const linkGeo = cached('gn:link', () => {
      const g = ringProfileGeometry(0.085, [0.03, 0.03, 0.01], 10, 1);
      g.computeBoundingSphere();
      return g;
    });
    const links = new THREE.InstancedMesh(linkGeo, worldMat('metal', this.ctx), n);
    links.name = 'chain';
    links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    links.castShadow = false;
    links.frustumCulled = false;
    this.chainMesh = links;
    this.rig.add(links);
    this._layChain();
  }

  /** Lay the chain straight between anchor and body (reset / build). */
  _layChain() {
    const n = this.linkCount, P = this.chainP, Q = this.chainQ;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      P[i * 3] = this.anchor.x + (this.pos.x - this.anchor.x) * u;
      P[i * 3 + 1] = this.anchor.y + (this.pos.y - this.anchor.y) * u;
      P[i * 3 + 2] = this.anchor.z + (this.pos.z - this.anchor.z) * u;
      Q[i * 3] = P[i * 3]; Q[i * 3 + 1] = P[i * 3 + 1]; Q[i * 3 + 2] = P[i * 3 + 2];
    }
    this._writeChain();
  }

  _simChain(dt) {
    const n = this.linkCount, P = this.chainP, Q = this.chainQ;
    const g = -9.8 * 0.55 * dt * dt;
    // integrate interior particles
    for (let i = 1; i < n; i++) {
      const k = i * 3;
      const x = P[k], y = P[k + 1], z = P[k + 2];
      const vx = (x - Q[k]) * 0.985, vy = (y - Q[k + 1]) * 0.985, vz = (z - Q[k + 2]) * 0.985;
      Q[k] = x; Q[k + 1] = y; Q[k + 2] = z;
      P[k] = x + vx; P[k + 1] = y + vy + g; P[k + 2] = z + vz;
    }
    // pins
    P[0] = this.anchor.x; P[1] = this.anchor.y; P[2] = this.anchor.z;
    const e = n * 3;
    P[e] = this.pos.x; P[e + 1] = this.pos.y; P[e + 2] = this.pos.z;
    // distance constraints
    const rest = this.chainLen / n;
    const floor = Math.min(this.groundY, this.post.y) + 0.05;
    for (let it = 0; it < 5; it++) {
      for (let i = 0; i < n; i++) {
        const a = i * 3, b = a + 3;
        let dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d;
        const wa = i === 0 ? 0 : 0.5, wb = i === n - 1 ? 0 : 0.5;
        const wsum = wa + wb || 1;
        dx *= diff; dy *= diff; dz *= diff;
        P[a] += dx * (wa / wsum); P[a + 1] += dy * (wa / wsum); P[a + 2] += dz * (wa / wsum);
        P[b] -= dx * (wb / wsum); P[b + 1] -= dy * (wb / wsum); P[b + 2] -= dz * (wb / wsum);
      }
      for (let i = 1; i < n; i++) if (P[i * 3 + 1] < floor) P[i * 3 + 1] = floor;
    }
    this._writeChain();
  }

  _writeChain() {
    const n = this.linkCount, P = this.chainP, m = this.chainMesh;
    for (let i = 0; i < n; i++) {
      const a = i * 3, b = a + 3;
      _v1.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
      if (_v1.lengthSq() < 1e-9) _v1.set(0, 0, 1); else _v1.normalize();
      _v0.set((P[a] + P[b]) * 0.5, (P[a + 1] + P[b + 1]) * 0.5, (P[a + 2] + P[b + 2]) * 0.5);
      _q0.setFromUnitVectors(X_AXIS, _v1);
      _q1.setFromAxisAngle(_v1, (i & 1) ? Math.PI / 2 : 0);
      _q1.multiply(_q0);
      _s0.set(1, 1, 1);
      _m0.compose(_v0, _q1, _s0);
      m.setMatrixAt(i, _m0);
    }
    m.instanceMatrix.needsUpdate = true;
  }

  _buildPost() {
    const iron = worldMat('metal', this.ctx);
    const stone = worldMat('stone', this.ctx);
    const shaft = tubeGeometry(0.16, 0.2, 1.2, 10, 1);
    place(shaft, 0, 0.6, 0);
    const cap = prismGeometry(0.22, 0.12, 8, 1);
    place(cap, 0, 1.22, 0);
    const ring = ringProfileGeometry(0.2, [0.025, 0.02, 0.006], 12, 1);
    place(ring, 0, 1.0, 0);
    const base = prismGeometry(0.42, 0.14, 8, 1);
    place(base, 0, 0.07, 0);
    const eye = ringProfileGeometry(0.11, [0.028, 0.028, 0.008], 10, 1);
    place(eye, 0, 1.15, 0, Math.PI / 2, 0, 0);
    const postMesh = mergeParts([{ g: shaft, m: iron }, { g: cap, m: iron }, { g: ring, m: iron }, { g: eye, m: iron }, { g: base, m: stone }], 'post');
    this.postMesh = postMesh;
    postMesh.position.copy(this.post);
    this.rig.add(postMesh);
  }

  _pose() {
    // body transform
    this.body.position.copy(this.pos);
    this.body.rotation.set(0, this.bodyYaw, 0);
    const sq = 1 - this.crouch * 0.22;
    this.body.scale.set(1 + this.crouch * 0.12, sq, 1 + this.crouch * 0.12);
    // jaws
    this.jawUpper.rotation.x = -this.jaw * 0.55;
    this.jawLower.rotation.x = this.jaw * 0.75;
    // post sink
    this.postMesh.position.y = this.post.y - this.postSink;
    this.postMesh.updateMatrixWorld(false);
    // colliders / kill
    this.bodyCol.setCenter(this.pos.x, this.pos.y, this.pos.z);
    this.postCol.setCenter(this.post.x, this.post.y + 0.6 - this.postSink, this.post.z);
    this.postCol.active = this.postSink < 1.0;
    this.kill.center.copy(this.pos);
    this.kill.update();
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.enabled) return;
    const t = this.time;
    this.stateT += dt;
    const prevX = this.pos.x, prevY = this.pos.y, prevZ = this.pos.z;
    const alive = !!player && !player.dead;
    let pdx = 0, pdz = 0, pd = 1e9;
    if (player) {
      const pp = player.pos || player.position;
      pdx = pp.x - this.pos.x; pdz = pp.z - this.pos.z;
      pd = Math.hypot(pdx, pdz);
    }

    switch (this.state) {
      case 'idle': {
        this.crouch = damp(this.crouch, 0, 12, dt);
        this.jaw = 0.12 + 0.1 * Math.sin(t * 7.3);
        // restless: pull toward rest, occasional short hops around the post
        this.idleHopT -= dt;
        if (this.idleHopT <= 0 && this.hopT <= 0) {
          this.idleHopT = 1.6 + this.rng() * 2.0;
          this.hopT = 0.45;
          const a = this.rng() * TAU;
          this.hopDir.set(Math.cos(a), 0, Math.sin(a));
          this._sfx('step_metal', this.pos, 0.6, 0.5);
        }
        if (this.hopT > 0) {
          this.hopT -= dt;
          const u = 1 - this.hopT / 0.45;
          this.pos.x += this.hopDir.x * 2.2 * dt;
          this.pos.z += this.hopDir.z * 2.2 * dt;
          this.pos.y = this.groundY + GN_R + 0.35 * Math.sin(u * Math.PI);
        } else {
          this.pos.y = this.groundY + GN_R + 0.02 * Math.abs(Math.sin(t * 6));
          this.pos.x = damp(this.pos.x, this.rest.x, 1.4, dt);
          this.pos.z = damp(this.pos.z, this.rest.z, 1.4, dt);
        }
        this._clampChain();
        if (alive && pd < this.chainLen + 1.6 && pd > 0.5) {
          this.state = 'telegraph'; this.stateT = 0;
          this._sfx('gnasher_bite', this.pos, 0.55, 0.7);   // rattle
          this._playClip('telegraph');
        }
        break;
      }
      case 'telegraph': {
        // crouch and rattle for GN_TELE seconds, jaw chattering wide
        const u = clamp(this.stateT / GN_TELE, 0, 1);
        this.crouch = damp(this.crouch, 0.9, 16, dt);
        this.jaw = 0.35 + 0.35 * Math.abs(Math.sin(t * 26));
        this.pos.x += Math.sin(t * 41) * 0.012;
        this.pos.z += Math.cos(t * 37) * 0.012;
        this.pos.y = this.groundY + GN_R;
        if (player) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(pdx, pdz), 14, dt);
        if (u >= 1) {
          this.state = 'lunge'; this.stateT = 0;
          this.lungeFrom.copy(this.pos);
          if (player) { const pp = player.pos || player.position; this.lungeDir.set(pp.x - this.pos.x, 0, pp.z - this.pos.z); }
          else headingFromYaw(this.bodyYaw, this.lungeDir);
          if (this.lungeDir.lengthSq() < 1e-6) headingFromYaw(this.bodyYaw, this.lungeDir);
          this.lungeDir.normalize();
          this.bodyYaw = Math.atan2(this.lungeDir.x, this.lungeDir.z);
          this.kill.active = true;
          this._sfx('gnasher_bite', this.pos, 1.0, 1.0);
          this._burst('dust', this.pos, 0x8a7a66, 0.8);
          this._playClip('attack');
        }
        break;
      }
      case 'lunge': {
        this.crouch = damp(this.crouch, -0.25, 20, dt);
        this.jaw = 1;
        this.pos.x += this.lungeDir.x * GN_LUNGE_SPEED * dt;
        this.pos.z += this.lungeDir.z * GN_LUNGE_SPEED * dt;
        const u = clamp(this.stateT / GN_LUNGE_MAX_T, 0, 1);
        this.pos.y = this.groundY + GN_R + 0.5 * Math.sin(u * Math.PI);
        const taut = this._clampChain();
        // bite check (belt and braces with the KillVolume)
        if (alive && capsuleHitsSphere(capsuleOf(player), this.pos.x, this.pos.y, this.pos.z, GN_R * 1.02)) {
          if (typeof player.kill === 'function') { try { player.kill('gnasher'); } catch (e) { /* noop */ } }
        }
        if (taut || u >= 1) {
          this.state = 'recover'; this.stateT = 0;
          this.kill.active = false;
          this.jaw = 0;
          this._sfx('crusher_slam', this.pos, 1.3, 0.7);   // jaws snap
          this._burst('spark', this.pos, 0xffd27a, 0.6);
          this._shake(0.12, 160);
          this._playClip('idle');
        }
        break;
      }
      case 'recover': {
        // hangs at the chain end, then is dragged back
        this.crouch = damp(this.crouch, 0.2, 8, dt);
        this.jaw = damp(this.jaw, 0.08, 6, dt);
        const u = clamp(this.stateT / GN_RECOVER, 0, 1);
        if (u > 0.4) {
          const k = 1 - Math.exp(-dt * 2.2);
          this.pos.x += (this.rest.x - this.pos.x) * k;
          this.pos.z += (this.rest.z - this.pos.z) * k;
        }
        this.pos.y = this.groundY + GN_R;
        if (u >= 1) { this.state = 'idle'; this.stateT = 0; this.idleHopT = 1.0 + this.rng(); }
        break;
      }
      case 'freed': {
        // bounds away in big hops for 4 s, then is gone
        this.boundT += dt;
        this.jaw = 0.3 + 0.3 * Math.sin(t * 9);
        this.crouch = 0;
        const hop = this.boundT % 0.55;
        const u = hop / 0.55;
        this.pos.x += this.boundDir.x * 7.5 * dt;
        this.pos.z += this.boundDir.z * 7.5 * dt;
        this.pos.y = this.groundY + GN_R + 1.4 * Math.sin(u * Math.PI);
        if (u < 0.08 && this.boundT > 0.2 && !this._hopEdge) { this._hopEdge = true; this._sfx('step_metal', this.pos, 0.8, 0.6); this._burst('dust', this.pos, 0x8a7a66, 0.5); }
        if (u > 0.2) this._hopEdge = false;
        this.bodyYaw += dt * 5.5;
        if (this.boundT > 4.0) { this.state = 'gone'; this.body.visible = false; this.chainMesh.visible = false; this.bodyCol.active = false; }
        break;
      }
      case 'gone':
        break;
    }

    if (this.state !== 'freed' && this.state !== 'gone') {
      if (this.state === 'idle' || this.state === 'recover') {
        if (player && pd < 9) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(pdx, pdz), 4, dt);
      }
    }
    // eyes track the hero
    if (player && this.eyes) {
      const ly = clamp(((player.pos || player.position).y + 1.0 - this.pos.y) / 4, -1, 1);
      const rel = wrapAngle(Math.atan2(pdx, pdz) - this.bodyYaw);
      this.eyes.look(clamp(rel / 1.2, -1, 1), ly);
    }

    this.linVel.set((this.pos.x - prevX) / Math.max(dt, 1e-4), (this.pos.y - prevY) / Math.max(dt, 1e-4), (this.pos.z - prevZ) / Math.max(dt, 1e-4));
    this._pose();
    if (this.state !== 'gone') this._simChain(dt);
  }

  /** Keep the body within chain length of the anchor. Returns true when taut. */
  _clampChain() {
    const dx = this.pos.x - this.anchor.x, dy = this.pos.y - this.anchor.y, dz = this.pos.z - this.anchor.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > this.chainLen) {
      const f = this.chainLen / d;
      this.pos.x = this.anchor.x + dx * f;
      this.pos.z = this.anchor.z + dz * f;
      // keep the ball on the ground rather than lifting toward the anchor
      if (this.pos.y < this.groundY + GN_R) this.pos.y = this.groundY + GN_R;
      return true;
    }
    return false;
  }

  /** Pounding the post within 1.2 m sinks it; three pounds free the gnasher. */
  onPound(player, pos) {
    if (this.freed || this.state === 'gone') return;
    const p = pos || (player && (player.pos || player.position));
    if (!p) return;
    const dx = p.x - this.post.x, dz = p.z - this.post.z;
    if (dx * dx + dz * dz > 1.2 * 1.2) return;
    if (Math.abs(p.y - this.post.y) > 2.0) return;
    this.pounds++;
    this.postSink = Math.min(1.2, this.pounds * 0.4);
    this.anchor.y = this.post.y + 1.15 - this.postSink;
    _v0.set(this.post.x, this.post.y + 0.3, this.post.z);
    this._sfx('crusher_slam', _v0, 0.8, 1.0);
    this._burst('poundShock', _v0, 0x8a7a66, 0.9);
    this._shake(0.18, 200);
    this.events.emit('pound', this.pounds, this);
    if (this.pounds >= GN_POUNDS_TO_FREE) {
      this.freed = true;
      this.state = 'freed'; this.stateT = 0; this.boundT = 0;
      this.kill.active = false;
      this.postCol.active = false;
      // bound away from the hero
      const pp = player ? (player.pos || player.position) : null;
      if (pp) this.boundDir.set(this.pos.x - pp.x, 0, this.pos.z - pp.z); else headingFromYaw(this.yaw + Math.PI, this.boundDir);
      if (this.boundDir.lengthSq() < 1e-6) headingFromYaw(this.yaw + Math.PI, this.boundDir);
      this.boundDir.normalize();
      // the chain goes with it: the anchor becomes the dragged link end
      this.chainLen = Math.max(this.chainLen, 3);
      this._sfx('gate_open', this.pos, 1.1, 1.0);
      this._burst('gateOpen', this.pos, this.accentColor, 1);
      this.events.emit('freed', this);
      this._trigger(this.def.trigger || 'gnasher-freed');
    }
  }

  _reset() {
    this.state = 'idle'; this.stateT = 0;
    this.pounds = 0; this.freed = false; this.postSink = 0;
    this.anchor.set(this.post.x, this.post.y + 1.15, this.post.z);
    this.chainLen = Math.max(2, fin(this.def.chain, 6));
    this.pos.copy(this.rest);
    this.bodyYaw = this.yaw;
    this.jaw = 0; this.crouch = 0; this.hopT = 0; this.boundT = 0;
    this.idleHopT = 1.5 + this.rng() * 1.5;
    this.kill.active = false;
    this.body.visible = true; this.chainMesh.visible = true;
    this.bodyCol.active = true; this.postCol.active = true;
    this._pose();
    this._layChain();
    this._playClip('idle', 0);
  }
}

/* ===========================================================================
 * 6. BUMBLER — round waddler with a hat
 * ======================================================================== */

const BM_R = 0.42;
const BM_SQUISH_T = 8.0;
const BM_HIT_CD = 0.7;

class Bumbler extends Critter {
  constructor(def, ctx) {
    super(def, ctx, 'bumbler');
    this.naturalHeight = BM_R * 2.2;
    const d = this.def;
    this.speed = Math.max(0.2, fin(d.speed, 1.6));
    this.loop = d.loop !== undefined ? !!d.loop : true;

    // path
    const src = Array.isArray(d.path) && d.path.length ? d.path : [d.p || [0, 0, 0]];
    this.n = src.length;
    this.pts = new Float32Array(this.n * 3);
    this.cum = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      readV3(src[i], _v0);
      const gy = this._groundY(_v0.x, _v0.y + 0.5, _v0.z, _v0.y);
      this.pts[i * 3] = _v0.x; this.pts[i * 3 + 1] = gy; this.pts[i * 3 + 2] = _v0.z;
    }
    if (this.n < 3) this.loop = false;
    this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
    this.pathOffset = fin(d.offset, 0) * this.L;

    this.state = 'walk';
    this.stateT = 0;
    this.hitCd = 0;
    this.squashY = 1;
    this.spread = 1;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pupilWobble = 0;

    this._build();
    this.col = this._solidBox(0, 0, 0, BM_R * 0.9, BM_R * 0.95, BM_R * 0.9, 'bounce', { power: 2.2 });
    this._placeAt(0);
    this._pose(0);
    this._silent = false;
  }

  _build() {
    const skin = skinMat(fin(this.def.color, 0x6fb35a), 0.62, 0.02);
    const belly = skinMat(0xeadfb0, 0.7, 0.0);
    const cheek = skinMat(0xe98a7a, 0.7, 0.0);
    const cloth = worldMat('cloth', this.ctx);
    const brass = worldMat('copper', this.ctx);
    const foot = skinMat(0x3b2f2a, 0.8, 0.0);

    // body: ellipsoid + belly patch + cheeks (one mesh, 3 materials)
    const bodyG = sphereGeo(BM_R, 22, 16);
    place(bodyG, 0, 0, 0, 0, 0, 0, 1.0, 0.86, 0.96);
    const bellyG = sphereGeo(BM_R * 0.62, 16, 12);
    place(bellyG, 0, -BM_R * 0.12, BM_R * 0.42, 0, 0, 0, 1.0, 0.9, 0.6);
    const cheekL = sphereGeo(BM_R * 0.16, 10, 8);
    place(cheekL, -BM_R * 0.58, BM_R * 0.12, BM_R * 0.62);
    const cheekR = sphereGeo(BM_R * 0.16, 10, 8);
    place(cheekR, BM_R * 0.58, BM_R * 0.12, BM_R * 0.62);
    // a stubby beak/nose
    const nose = coneGeo(0.07, 0.16, 6);
    place(nose, 0, BM_R * 0.05, BM_R * 0.98, Math.PI / 2, 0, 0);
    const body = new THREE.Group();
    body.name = 'body';
    body.add(mergeParts([{ g: bodyG, m: skin }, { g: bellyG, m: belly }, { g: cheekL, m: cheek }, { g: cheekR, m: cheek }, { g: nose, m: brass }], 'bodyShell'));

    // hat: crown + brim + bobble, tilted jauntily
    const crown = tubeGeometry(0.17, 0.22, 0.28, 12, 1);
    place(crown, 0, 0.14, 0);
    const brim = ringProfileGeometry(0.27, [0.07, 0.014, 0.006], 16, 1);
    const bobble = sphereGeo(0.06, 8, 6);
    place(bobble, 0, 0.31, 0);
    const bandG = ringProfileGeometry(0.2, [0.02, 0.03, 0.006], 12, 1);
    place(bandG, 0, 0.05, 0);
    const hat = mergeParts([{ g: crown, m: cloth }, { g: brim, m: cloth }, { g: bobble, m: brass }, { g: bandG, m: brass }], 'hat');
    hat.position.set(0.04, BM_R * 0.78, -0.02);
    hat.rotation.set(0.08, 0, -0.22);
    body.add(hat);
    this.hat = hat;

    // eyes: big and googly
    this.eyes = makeEyes(0.11, 0.26, 0, BM_R * 0.32, BM_R * 0.78, -0.1);
    body.add(this.eyes.group);

    // legs: stubby capsules with bevelled feet, hinged at the hips
    const mkLeg = (side) => {
      const piv = new THREE.Group();
      piv.name = side < 0 ? 'legL' : 'legR';
      const leg = capsuleGeo(0.075, 0.16, 8);
      place(leg, 0, -0.1, 0);
      const ft = bbox(0.2, 0.07, 0.28, 0.02);
      place(ft, 0, -0.22, 0.05);
      piv.add(mergeParts([{ g: leg, m: skin }, { g: ft, m: foot }], 'leg'));
      piv.position.set(side * BM_R * 0.42, -BM_R * 0.62, 0);
      body.add(piv);
      return piv;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    this.body = body;
    this.rig.add(body);
  }

  /** Path position at clock t (pure function). */
  _placeAt(t) {
    const s = this.pathOffset + this.speed * t;
    let ss = s;
    if (!this.loop) ss = tri(s / (2 * Math.max(this.L, 1e-6))) * this.L;
    polylineAt(this.pts, this.n, this.cum, this.L, this.loop, ss, _v0, _v1);
    if (!this.loop && Math.floor(s / Math.max(this.L, 1e-6)) % 2 === 1) _v1.negate();
    this.pos.set(_v0.x, _v0.y + BM_R * 0.92, _v0.z);
    if (_v1.lengthSq() > 1e-6) this.dir.copy(_v1);
    return s;
  }

  _pose(phase) {
    const b = this.body;
    b.position.copy(this.pos);
    const targetYaw = Math.atan2(this.dir.x, this.dir.z);
    this.yaw = targetYaw;
    b.rotation.set(0.05 * Math.sin(phase * 2), this.yaw, 0.13 * Math.sin(phase));
    b.scale.set(this.spread, this.squashY, this.spread);
    b.position.y += 0.03 * Math.abs(Math.sin(phase)) * this.squashY - BM_R * 0.92 * (1 - this.squashY);
    this.legL.rotation.x = 0.7 * Math.sin(phase);
    this.legR.rotation.x = -0.7 * Math.sin(phase);
    this.col.setCenter(this.pos.x, this.pos.y - BM_R * 0.92 * (1 - this.squashY), this.pos.z);
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.enabled) return;
    const t = this.time;
    this.stateT += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    const alive = !!player && !player.dead;
    const prevX = this.pos.x, prevY = this.pos.y, prevZ = this.pos.z;

    if (this.state === 'walk') {
      const s = this._placeAt(t);
      const phase = (s / 0.55) * TAU;
      this.squashY = damp(this.squashY, 1, 10, dt);
      this.spread = damp(this.spread, 1, 10, dt);
      this._pose(phase);
      // footsteps on the beat
      const beat = Math.floor(s / 0.55);
      if (beat !== this._beat) { this._beat = beat; if (player) { const pp = player.pos || player.position; if (Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < 18) this._sfx('step_wood', this.pos, 0.85 + 0.1 * (beat & 1), 0.28); } }

      if (alive) {
        const cap = capsuleOf(player);
        const cy = this.pos.y;
        if (capsuleHitsSphere(cap, this.pos.x, cy, this.pos.z, BM_R * 1.02)) {
          const pp = player.pos || player.position;
          const feetAbove = pp.y - (cy + BM_R * 0.25);
          const falling = player.vel ? player.vel.y <= 0.6 : true;
          if (feetAbove > 0 && falling) {
            this._squish(player, true);
          } else if (this.hitCd <= 0) {
            this.hitCd = BM_HIT_CD;
            this._hurt(player, pp.x - this.pos.x, pp.z - this.pos.z, 6, 0.4);
            this._sfx('bumbler_squish', this.pos, 1.4, 0.5);
            this._burst('dust', this.pos, 0x8a7a66, 0.4);
            // recoil wobble
            this.squashY = 0.85; this.spread = 1.1;
          }
        }
      }
    } else if (this.state === 'squished') {
      this.squashY = damp(this.squashY, 0.22, 18, dt);
      this.spread = damp(this.spread, 1.45, 18, dt);
      this._pose(0);
      if (this.stateT >= BM_SQUISH_T) {
        this.state = 'respawn'; this.stateT = 0;
        this._placeAt(t);
        this.col.active = true;
        this.body.visible = true;
        this._burst('dust', this.pos, 0x8a7a66, 0.6);
        this._sfx('bounce', this.pos, 1.5, 0.5);
      }
    } else if (this.state === 'respawn') {
      const u = clamp(this.stateT / 0.35, 0, 1);
      const k = easeOutBack(u, 1.8);
      this.squashY = Math.max(0.01, k); this.spread = Math.max(0.01, k);
      this._placeAt(t);
      this._pose(0);
      if (u >= 1) { this.state = 'walk'; this.stateT = 0; this._playClip('walk'); }
    }

    // eyes: look at the hero, googly wobble while waddling
    if (player) {
      const pp = player.pos || player.position;
      const rel = wrapAngle(Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z) - this.yaw);
      const wob = this.state === 'walk' ? 0.35 * Math.sin(t * 13) : 0;
      this.eyes.look(clamp(rel / 1.3, -1, 1) + wob, clamp((pp.y + 0.9 - this.pos.y) / 3, -1, 1) + wob * 0.5);
    }

    const inv = 1 / Math.max(dt, 1e-4);
    this.linVel.set((this.pos.x - prevX) * inv, (this.pos.y - prevY) * inv, (this.pos.z - prevZ) * inv);
  }

  _squish(player, byLanding) {
    if (this.state !== 'walk') return;
    this.state = 'squished'; this.stateT = 0;
    this.col.active = false;
    this.linVel.set(0, 0, 0);
    this._sfx('bumbler_squish', this.pos, 1.0, 1.0);
    this._burst('squish', this.pos, 0x9fd67a, 1);
    _v0.copy(this.pos); _v0.y += 0.5;
    for (let i = 0; i < 3; i++) {
      _v1.set(_v0.x + Math.cos(i * 2.09) * 0.3, _v0.y, _v0.z + Math.sin(i * 2.09) * 0.3);
      this._burst('coin', _v1, this.coinColor, 0.8);
    }
    this._sfx('coin', _v0, 1.2, 0.8);
    this._awardCoins(3, _v0);
    this._shake(0.06, 120);
    this.eyes.look(0, -1);
    this.events.emit('squish', this, byLanding);
    this._playClip('squish');
  }

  onPound(player, pos) {
    const p = pos || (player && (player.pos || player.position));
    if (!p || this.state !== 'walk') return;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz <= 1.6 * 1.6 && Math.abs(p.y - this.pos.y) < 2.0) this._squish(player, false);
  }

  onDive(player) {
    if (!player || this.state !== 'walk') return;
    if (capsuleHitsSphere(capsuleOf(player), this.pos.x, this.pos.y, this.pos.z, BM_R * 1.25)) this._squish(player, false);
  }

  onStand(player) {
    if (this.state === 'walk') this._squish(player, true);
  }

  _reset() {
    this.state = 'walk'; this.stateT = 0; this.hitCd = 0;
    this.squashY = 1; this.spread = 1; this._beat = -1;
    this.col.active = true; this.body.visible = true;
    this._placeAt(0);
    this._pose(0);
    this.eyes.look(0, 0);
    this._playClip('walk', 0);
  }
}

/* ===========================================================================
 * 7. SKITTER — flying bug
 * ======================================================================== */

const SK_SWOOP_RANGE = 5.0, SK_SWOOP_T = 1.15, SK_SWOOP_CD = 2.6;

class Skitter extends Critter {
  constructor(def, ctx) {
    super(def, ctx, 'skitter');
    this.naturalHeight = 0.6;
    const d = this.def;
    this.speed = Math.max(0.2, fin(d.speed, 2.4));
    this.amp = fin(d.amp, 0.4);
    const src = Array.isArray(d.path) && d.path.length ? d.path : [d.p || [0, 2, 0]];
    this.n = src.length;
    this.pts = new Float32Array(this.n * 3);
    this.cum = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { readV3(src[i], _v0); this.pts[i * 3] = _v0.x; this.pts[i * 3 + 1] = _v0.y; this.pts[i * 3 + 2] = _v0.z; }
    this.loop = this.n >= 3 ? (d.loop !== false) : false;
    this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
    this.hover = this.n === 1 ? Math.max(1.5, fin(d.range, 2.5)) : 0;

    this.state = 'fly';
    this.stateT = 0;
    this.swoopCd = 0;
    this.swoopFrom = new THREE.Vector3();
    this.swoopTo = new THREE.Vector3();
    this.base = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.stagger = 0;
    this.hitCd = 0;

    this._build();
    this.col = this._solidBox(0, 0, 0, 0.34, 0.16, 0.34, 'bounce', { power: fin(d.bounce, 3) });
    this._reset();
    this._silent = false;
  }

  _build() {
    const shell = skinMat(fin(this.def.color, 0x3f6f9a), 0.4, 0.35, 0x0a2030, 0.25);
    const dark = skinMat(0x1e2430, 0.5, 0.4);
    const wing = wingMat();
    const brass = worldMat('copper', this.ctx);

    const body = new THREE.Group();
    body.name = 'body';
    // abdomen (horizontal capsule) + thorax + head with a segmented shell band
    const abdomen = capsuleGeo(0.15, 0.32, 10);
    place(abdomen, 0, 0, -0.2, Math.PI / 2, 0, 0);
    const thorax = sphereGeo(0.15, 14, 10);
    place(thorax, 0, 0.02, 0.08, 0, 0, 0, 1, 0.9, 1.1);
    const head = sphereGeo(0.12, 14, 10);
    place(head, 0, 0.03, 0.3, 0, 0, 0, 1.1, 0.95, 1);
    const band1 = ringProfileGeometry(0.14, [0.03, 0.012, 0.005], 12, 1);
    place(band1, 0, 0, -0.16, Math.PI / 2, 0, 0);
    const band2 = ringProfileGeometry(0.12, [0.03, 0.012, 0.005], 12, 1);
    place(band2, 0, 0, -0.3, Math.PI / 2, 0, 0);
    const mandL = coneGeo(0.03, 0.14, 4);
    place(mandL, -0.06, -0.02, 0.42, Math.PI / 2, 0, 0.35);
    const mandR = coneGeo(0.03, 0.14, 4);
    place(mandR, 0.06, -0.02, 0.42, Math.PI / 2, 0, -0.35);
    const parts = [{ g: abdomen, m: shell }, { g: thorax, m: shell }, { g: head, m: dark }, { g: band1, m: brass }, { g: band2, m: brass }, { g: mandL, m: dark }, { g: mandR, m: dark }];
    // six tucked legs + two antennae
    for (let i = 0; i < 3; i++) {
      for (let s = -1; s <= 1; s += 2) {
        const leg = tubeGeometry(0.012, 0.018, 0.26, 5, 1);
        place(leg, s * 0.14, -0.1, 0.12 - i * 0.14, 0.5, 0, s * 1.1);
        parts.push({ g: leg, m: dark });
      }
    }
    for (let s = -1; s <= 1; s += 2) {
      const ant = tubeGeometry(0.008, 0.012, 0.3, 5, 1);
      place(ant, s * 0.05, 0.14, 0.4, -0.9, 0, s * 0.35);
      parts.push({ g: ant, m: dark });
    }
    body.add(mergeParts(parts, 'bug'));

    // eyes: compound, wide-set
    this.eyes = makeEyes(0.05, 0.16, 0, 0.07, 0.38, 0);
    body.add(this.eyes.group);

    // wings: two pairs of thin bevelled blades on pivots at the thorax
    const mkWing = (side, back) => {
      const piv = new THREE.Group();
      piv.position.set(side * 0.08, 0.14, back ? -0.02 : 0.1);
      const g = bbox(0.46, 0.008, 0.16, 0.003);
      place(g, side * 0.24, 0, 0, 0, side * (back ? -0.35 : 0.15), 0);
      const w = new THREE.Mesh(g, wing);
      w.castShadow = false;
      w.name = 'wing';
      piv.add(w);
      body.add(piv);
      return piv;
    };
    this.wings = [mkWing(-1, false), mkWing(1, false), mkWing(-1, true), mkWing(1, true)];
    this.body = body;
    this.rig.add(body);
  }

  /** Base flight position at clock t (pure function): path + sine weave. */
  _baseAt(t, out, outDir) {
    if (this.n === 1) {
      const a = t * this.speed / this.hover;
      out.set(this.pts[0] + Math.cos(a) * this.hover, this.pts[1], this.pts[2] + Math.sin(a) * this.hover);
      outDir.set(-Math.sin(a), 0, Math.cos(a));
    } else {
      let s = this.speed * t;
      if (!this.loop) s = tri(s / (2 * Math.max(this.L, 1e-6))) * this.L;
      polylineAt(this.pts, this.n, this.cum, this.L, this.loop, s, out, outDir);
      if (!this.loop && Math.floor((this.speed * t) / Math.max(this.L, 1e-6)) % 2 === 1) outDir.negate();
    }
    // weave: vertical sine + lateral sway
    out.y += this.amp * Math.sin(t * 2.1);
    const lx = -outDir.z, lz = outDir.x;
    out.x += lx * this.amp * 0.8 * Math.sin(t * 1.35);
    out.z += lz * this.amp * 0.8 * Math.sin(t * 1.35);
  }

  _pose(dt) {
    const b = this.body;
    b.position.copy(this.pos);
    const targetYaw = Math.atan2(this.dir.x, this.dir.z);
    this.yaw = dt > 0 ? dampAngle(this.yaw, targetYaw, 8, dt) : targetYaw;
    const bank = dt > 0 ? clamp(wrapAngle(targetYaw - this.yaw) * 1.5, -0.6, 0.6) : 0;
    const pitch = this.state === 'swoop' ? clamp(this.dir.y * 1.2, -0.8, 0.8) : 0.08 * Math.sin(this.time * 2.1);
    b.rotation.set(-pitch, this.yaw, -bank);
    const dip = 1 - this.stagger * 0.25;
    b.scale.set(1, dip, 1);
    // wings beat at ~22 Hz; a stagger makes them flutter irregularly
    const flap = Math.sin(this.time * 44 * (1 + this.stagger * 0.3)) * (0.85 + this.stagger * 0.4);
    this.wings[0].rotation.z = flap; this.wings[1].rotation.z = -flap;
    this.wings[2].rotation.z = flap * 0.8 + 0.2; this.wings[3].rotation.z = -flap * 0.8 - 0.2;
    this.col.setCenter(this.pos.x, this.pos.y - 0.02, this.pos.z);
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.enabled) return;
    const t = this.time;
    this.stateT += dt;
    if (this.swoopCd > 0) this.swoopCd -= dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    this.stagger = damp(this.stagger, 0, 5, dt);
    const alive = !!player && !player.dead;
    const prevX = this.pos.x, prevY = this.pos.y, prevZ = this.pos.z;

    this._baseAt(t, this.base, _v2);
    if (this.state === 'fly') {
      this.pos.copy(this.base);
      this.dir.copy(_v2);
      if (alive && this.swoopCd <= 0) {
        const pp = player.pos || player.position;
        const dx = pp.x - this.pos.x, dy = pp.y + 1.0 - this.pos.y, dz = pp.z - this.pos.z;
        if (dx * dx + dy * dy + dz * dz < SK_SWOOP_RANGE * SK_SWOOP_RANGE) {
          this.state = 'swoop'; this.stateT = 0;
          this.swoopFrom.copy(this.pos);
          this.swoopTo.set(pp.x, pp.y + 0.9, pp.z);
          this._sfx('skitter', this.pos, 1.3, 0.8);
          this._burst('wingGust', this.pos, 0xbfefff, 0.5);
          this._playClip('attack');
        }
      }
    } else if (this.state === 'swoop') {
      // out (0..0.45) hold (..0.55) back (..1) — ease both ways
      const u = clamp(this.stateT / SK_SWOOP_T, 0, 1);
      let k;
      if (u < 0.45) k = smoothstep(0, 1, u / 0.45);
      else if (u < 0.55) k = 1;
      else k = 1 - smoothstep(0, 1, (u - 0.55) / 0.45);
      _v0.copy(this.swoopTo).sub(this.swoopFrom);
      // the return leg blends back to the moving base, not the stale start point
      const bx = u < 0.55 ? this.swoopFrom.x : this.base.x;
      const by = u < 0.55 ? this.swoopFrom.y : this.base.y;
      const bz = u < 0.55 ? this.swoopFrom.z : this.base.z;
      this.pos.set(bx + _v0.x * k, by + _v0.y * k - 0.35 * Math.sin(k * Math.PI) * 0 , bz + _v0.z * k);
      this.dir.set(this.pos.x - prevX, this.pos.y - prevY, this.pos.z - prevZ);
      if (this.dir.lengthSq() > 1e-6) this.dir.normalize(); else this.dir.copy(_v2);
      // a swoop that connects from the side is a fair shove
      if (alive && this.hitCd <= 0 && u > 0.2 && u < 0.6) {
        const cap = capsuleOf(player);
        if (capsuleHitsSphere(cap, this.pos.x, this.pos.y, this.pos.z, 0.36)) {
          const pp = player.pos || player.position;
          if (pp.y < this.pos.y - 0.1) {
            this.hitCd = 1.0;
            this._hurt(player, pp.x - this.pos.x, pp.z - this.pos.z, 5, 0.3);
            this._sfx('skitter', this.pos, 0.8, 0.9);
          }
        }
      }
      if (u >= 1) { this.state = 'fly'; this.stateT = 0; this.swoopCd = SK_SWOOP_CD; this._playClip('walk'); }
    }

    // landed-on detection: the hero's feet arriving on the shell from above
    if (alive && this.hitCd <= 0) {
      const pp = player.pos || player.position;
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
      const dy = pp.y - (this.pos.y + 0.12);
      if (dx * dx + dz * dz < 0.36 * 0.36 && dy > -0.12 && dy < 0.25 && player.vel && player.vel.y <= 0.5) {
        this.hitCd = 0.5;
        this.stagger = 1;
        this._sfx('skitter', this.pos, 1.6, 0.7);
        this._burst('wingGust', this.pos, 0xbfefff, 0.9);
        this.events.emit('bounced', this, player);
      }
    }

    if (player) {
      const pp = player.pos || player.position;
      const rel = wrapAngle(Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z) - this.yaw);
      this.eyes.look(clamp(rel / 1.3, -1, 1), clamp((pp.y + 0.9 - this.pos.y) / 3, -1, 1));
    }

    const inv = 1 / Math.max(dt, 1e-4);
    this.linVel.set((this.pos.x - prevX) * inv, (this.pos.y - prevY) * inv, (this.pos.z - prevZ) * inv);
    this._pose(dt);
  }

  onStand(player) {
    this.stagger = 1;
    this._burst('wingGust', this.pos, 0xbfefff, 0.9);
    this.events.emit('bounced', this, player);
  }

  onPound(player, pos) {
    const p = pos || (player && (player.pos || player.position));
    if (!p) return;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.4 && Math.abs(p.y - this.pos.y) < 1.5) {
      this.stagger = 1; this.swoopCd = 3.0;
      this._burst('wingGust', this.pos, 0xbfefff, 1);
      this._sfx('skitter', this.pos, 0.7, 0.8);
    }
  }

  _reset() {
    this.state = 'fly'; this.stateT = 0; this.swoopCd = 0; this.hitCd = 0; this.stagger = 0;
    this._baseAt(0, this.pos, this.dir);
    this.base.copy(this.pos);
    this.yaw = Math.atan2(this.dir.x, this.dir.z);
    this._pose(0);
    this.eyes.look(0, 0);
    this._playClip('walk', 0);
  }
}

/* ===========================================================================
 * 8. WARDEN — 3-hit mini-boss
 * ======================================================================== */

const WD_HP = 3;
const WD_STOMP_TELE = 0.6, WD_STOMP_RING_T = 0.55, WD_STOMP_RING_R = 3.5;
const WD_CHARGE_TELE = 0.8, WD_CHARGE_SPEED = 12, WD_DIZZY = 2.5;
const WD_ROAR = 1.2, WD_IDLE = 0.8, WD_HIT = 0.9, WD_DEATH = 2.6;
const WD_BODY_R = 0.95;

// pose vector indices
const P_SHL = 0, P_SHR = 1, P_ELL = 2, P_ELR = 3, P_HIPL = 4, P_HIPR = 5, P_KNL = 6, P_KNR = 7,
  P_TORX = 8, P_TORZ = 9, P_HEADX = 10, P_HEADY = 11, P_HEADZ = 12, P_LIFT = 13, P_SHLZ = 14, P_SHRZ = 15;

class Warden extends Critter {
  constructor(def, ctx) {
    super(def, ctx, 'warden');
    this.naturalHeight = 2.7;
    const d = this.def;
    readV3(d.p, this.home = new THREE.Vector3());
    this.homeYaw = fin(d.yaw, 0);
    const ar = d.arena || {};
    this.arenaC = ar.c ? readV3(ar.c, new THREE.Vector3()) : this.home.clone();
    this.arenaR = Math.max(4, fin(ar.r, 9));
    this.lethal = !!d.lethal;
    this.groundY = this._groundY(this.home.x, this.home.y + 0.5, this.home.z, this.home.y);
    this.home.y = this.groundY;
    this.arenaC.y = this.groundY;
    this.pos.copy(this.home);
    this.yaw = this.homeYaw;

    this.hp = WD_HP;
    this.state = 'dormant';
    this.stateT = 0;
    this.attackIx = 0;
    this.chargeDir = new THREE.Vector3();
    /** Shock-ring centre. Hoisted here so the STOMP branch never allocates. */
    this.ringC = new THREE.Vector3();
    this.ringR = 0;
    this.ringActive = false;
    this.ringHitDone = false;
    this.flash = 0;
    this.runPhase = 0;
    this.hitCd = 0;
    this.hud = { type: 'warden', hp: this.hp, hpMax: WD_HP, phase: 'dormant' };
    this.pose = new Float32Array(16);
    this.poseT = new Float32Array(16);

    this._build();
    this.col = this._solidBox(this.pos.x, this.pos.y + 1.3, this.pos.z, 0.75, 1.3, 0.6, 'normal', null);
    this.kill = this._killSphere(this.pos.x, this.pos.y + 1.2, this.pos.z, WD_BODY_R, 'warden');
    this._pose(0);
    this._silent = false;
  }

  _build() {
    // owned copies of the armour materials so the hit flash never touches the shared bank
    const ironBase = worldMat('metal', this.ctx);
    const iron = this.own(ironBase.clone());
    iron.name = 'warden.iron';
    const brass = this.own(worldMat('copper', this.ctx).clone());
    brass.name = 'warden.brass';
    const skin = this.own(skinMat(fin(this.def.color, 0x4d5b3d), 0.68, 0.02).clone());
    skin.name = 'warden.skin';
    const leather = this.own(skinMat(0x4a3325, 0.85, 0.0).clone());
    this.flashMats = [iron, brass, skin, leather];
    const eyeEm = getEmissive(0xff3b2a, 3.2);
    const gemEm = getEmissive(this.realmColor, 2.8);

    const root = new THREE.Group();
    root.name = 'body';
    // ---- hips + torso (one pivot: leans) ----
    this.hips = new THREE.Group(); this.hips.name = 'hips'; this.hips.position.y = 1.25;
    root.add(this.hips);
    this.torso = new THREE.Group(); this.torso.name = 'torso'; this.torso.position.y = 0.2;
    this.hips.add(this.torso);
    const pelvis = bbox(0.95, 0.5, 0.65, 0.09);
    place(pelvis, 0, -0.05, 0);
    const belt = ringProfileGeometry(0.62, [0.06, 0.06, 0.02], 12, 1);
    place(belt, 0, 0.12, 0, 0, 0, 0, 1, 1, 0.75);
    const chest = bbox(1.35, 1.05, 0.85, 0.14);
    place(chest, 0, 0.72, 0);
    const plate = bbox(1.0, 0.7, 0.16, 0.05);
    place(plate, 0, 0.78, 0.44, -0.08, 0, 0);
    const plateTrim = ringProfileGeometry(0.42, [0.04, 0.03, 0.01], 8, 1);
    place(plateTrim, 0, 0.8, 0.5, Math.PI / 2, 0, 0);
    const pauldL = sphereGeo(0.4, 14, 10, 0, TAU, 0, Math.PI * 0.55);
    place(pauldL, -0.78, 1.15, 0, 0, 0, 0.25);
    const pauldR = sphereGeo(0.4, 14, 10, 0, TAU, 0, Math.PI * 0.55);
    place(pauldR, 0.78, 1.15, 0, 0, 0, -0.25);
    const parts = [{ g: pelvis, m: leather }, { g: belt, m: brass }, { g: chest, m: skin }, { g: plate, m: iron }, { g: plateTrim, m: brass }, { g: pauldL, m: iron }, { g: pauldR, m: iron }];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 3; i++) {
        const sp = coneGeo(0.06, 0.24, 4);
        place(sp, s * (0.66 + i * 0.1), 1.42 - i * 0.05, -0.12 + i * 0.12, 0, 0, s * (0.5 + i * 0.25));
        parts.push({ g: sp, m: iron });
      }
    }
    // crest lantern on the back: cage + hook + glowing crest gem
    const cageTop = ringProfileGeometry(0.2, [0.03, 0.03, 0.01], 8, 1);
    place(cageTop, 0, 1.05, -0.62);
    const cageBot = ringProfileGeometry(0.2, [0.03, 0.03, 0.01], 8, 1);
    place(cageBot, 0, 0.55, -0.62);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const barG = tubeGeometry(0.02, 0.02, 0.5, 5, 1);
      place(barG, Math.cos(a) * 0.2, 0.8, -0.62 + Math.sin(a) * 0.2);
      parts.push({ g: barG, m: brass });
    }
    const hook = tubeGeometry(0.03, 0.03, 0.3, 6, 1);
    place(hook, 0, 1.2, -0.5, 0.6, 0, 0);
    parts.push({ g: cageTop, m: brass }, { g: cageBot, m: brass }, { g: hook, m: brass });
    this.torso.add(mergeParts(parts, 'torsoShell'));
    const gem = new THREE.Mesh(cached('wd:gem', () => { const g = prismGeometry(0.12, 0.26, 8, 1); g.computeBoundingSphere(); return g; }), gemEm);
    gem.position.set(0, 0.8, -0.62);
    gem.name = 'crestLantern';
    gem.castShadow = false;
    this.torso.add(gem);
    this.gem = gem;
    const gemGlow = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ color: this.realmColor, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })));
    gemGlow.scale.set(0.9, 0.9, 1);
    gemGlow.position.set(0, 0.8, -0.62);
    this.torso.add(gemGlow);

    // ---- head ----
    this.head = new THREE.Group(); this.head.name = 'head'; this.head.position.set(0, 1.35, 0.1);
    this.torso.add(this.head);
    const skull = bbox(0.6, 0.55, 0.6, 0.12);
    place(skull, 0, 0.25, 0);
    const helm = prismGeometry(0.42, 0.34, 6, 1);
    place(helm, 0, 0.55, 0);
    const crestFin = bbox(0.06, 0.34, 0.5, 0.02);
    place(crestFin, 0, 0.78, -0.05, -0.2, 0, 0);
    const jawG = bbox(0.5, 0.2, 0.42, 0.05);
    place(jawG, 0, 0.02, 0.1);
    const tuskL = coneGeo(0.045, 0.2, 4);
    place(tuskL, -0.16, 0.12, 0.3, -0.3, 0, 0.2);
    const tuskR = coneGeo(0.045, 0.2, 4);
    place(tuskR, 0.16, 0.12, 0.3, -0.3, 0, -0.2);
    const eyeL = bbox(0.14, 0.05, 0.05, 0.01);
    place(eyeL, -0.15, 0.32, 0.3);
    const eyeR = bbox(0.14, 0.05, 0.05, 0.01);
    place(eyeR, 0.15, 0.32, 0.3);
    this.head.add(mergeParts([{ g: skull, m: skin }, { g: helm, m: iron }, { g: crestFin, m: brass }, { g: jawG, m: leather }, { g: tuskL, m: brass }, { g: tuskR, m: brass }, { g: eyeL, m: eyeEm }, { g: eyeR, m: eyeEm }], 'headShell'));

    // ---- limbs ----
    const mkLimb = (side, arm) => {
      const piv = new THREE.Group();
      const ur = arm ? 0.19 : 0.23, lr = arm ? 0.2 : 0.22, ul = arm ? 0.62 : 0.6, ll = arm ? 0.6 : 0.55;
      const upper = capsuleGeo(ur, ul, 10);
      place(upper, 0, -ul * 0.5 - ur * 0.3, 0);
      const cuff = ringProfileGeometry(ur * 1.05, [0.04, 0.05, 0.015], 10, 1);
      place(cuff, 0, -ul * 0.9, 0);
      piv.add(mergeParts([{ g: upper, m: skin }, { g: cuff, m: brass }], arm ? 'upperArm' : 'thigh'));
      const joint = new THREE.Group();
      joint.position.y = -ul - ur * 0.2;
      piv.add(joint);
      const lower = capsuleGeo(lr, ll, 10);
      place(lower, 0, -ll * 0.5 - lr * 0.2, 0);
      const endParts = [{ g: lower, m: arm ? skin : leather }];
      if (arm) {
        const fist = sphereGeo(0.27, 12, 10);
        place(fist, 0, -ll - 0.2, 0.05, 0, 0, 0, 1, 0.85, 1.05);
        const knuck = bbox(0.42, 0.12, 0.2, 0.03);
        place(knuck, 0, -ll - 0.18, 0.22);
        endParts.push({ g: fist, m: skin }, { g: knuck, m: iron });
      } else {
        const foot = bbox(0.46, 0.2, 0.66, 0.05);
        place(foot, 0, -ll - 0.2, 0.12);
        const toeGuard = bbox(0.42, 0.14, 0.2, 0.03);
        place(toeGuard, 0, -ll - 0.14, 0.42);
        endParts.push({ g: foot, m: leather }, { g: toeGuard, m: iron });
      }
      joint.add(mergeParts(endParts, arm ? 'forearm' : 'shin'));
      return { piv, joint };
    };
    const shL = mkLimb(-1, true), shR = mkLimb(1, true), hipL = mkLimb(-1, false), hipR = mkLimb(1, false);
    shL.piv.position.set(-0.85, 1.05, 0); shR.piv.position.set(0.85, 1.05, 0);
    this.torso.add(shL.piv, shR.piv);
    hipL.piv.position.set(-0.36, -0.2, 0); hipR.piv.position.set(0.36, -0.2, 0);
    this.hips.add(hipL.piv, hipR.piv);
    this.shL = shL; this.shR = shR; this.hipL = hipL; this.hipR = hipR;

    // ---- shock ring (stomp) ----
    const ringG = cached('wd:ring', () => { const g = ringProfileGeometry(1, [0.16, 0.12, 0.04], 40, 1); g.computeBoundingSphere(); return g; });
    const ringM = this.own(new THREE.MeshStandardMaterial({ color: 0x1a0c06, emissive: 0xff7a1a, emissiveIntensity: 3.0, roughness: 0.4 }));
    this.ring = new THREE.Mesh(ringG, ringM);
    this.ring.name = 'shockRing';
    this.ring.visible = false;
    this.ring.castShadow = false;
    this.rig.add(this.ring);
    const ringGlow = new THREE.Mesh(cached('wd:ringGlow', () => { const g = discGeometry(1, 40); g.computeBoundingSphere(); return g; }), getGlow(0xff9a3a, { mode: 'radial', speed: 3, power: 1.2, gain: 0.7 }));
    ringGlow.name = 'shockGlow';
    ringGlow.visible = false;
    this.ringGlow = ringGlow;
    this.rig.add(ringGlow);

    // ---- dizzy stars ----
    const starG = cached('wd:star', () => { const g = prismGeometry(0.13, 0.05, 5, 1); g.rotateX(Math.PI / 2); g.computeBoundingSphere(); return g; });
    this.stars = new THREE.InstancedMesh(starG, getEmissive(0xffe066, 3.0), 5);
    this.stars.name = 'dizzyStars';
    this.stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stars.visible = false;
    this.stars.castShadow = false;
    this.stars.frustumCulled = false;
    this.rig.add(this.stars);

    this.body = root;
    this.rig.add(root);
  }

  _setTargets(t, dt) {
    const T = this.poseT;
    for (let i = 0; i < 16; i++) T[i] = 0;
    T[P_SHLZ] = 0.35; T[P_SHRZ] = -0.35;      // arms hang a little out (bulk)
    switch (this.state) {
      case 'dormant':
      case 'idle':
        T[P_SHL] = 0.15 * Math.sin(t * 1.3); T[P_SHR] = 0.15 * Math.sin(t * 1.3 + 1.2);
        T[P_ELL] = -0.4; T[P_ELR] = -0.4;
        T[P_TORX] = 0.08 + 0.02 * Math.sin(t * 1.7);
        T[P_LIFT] = 0.02 * Math.sin(t * 1.7);
        break;
      case 'roar':
        T[P_SHL] = -2.3; T[P_SHR] = -2.3; T[P_ELL] = -1.2; T[P_ELR] = -1.2;
        T[P_SHLZ] = 0.8; T[P_SHRZ] = -0.8;
        T[P_TORX] = -0.25; T[P_HEADX] = -0.45; T[P_LIFT] = 0.06;
        break;
      case 'stompTele':
        T[P_HIPR] = -1.35; T[P_KNR] = 1.4;
        T[P_TORX] = -0.2; T[P_SHL] = -0.9; T[P_SHR] = -0.9; T[P_ELL] = -0.8; T[P_ELR] = -0.8;
        T[P_LIFT] = 0.08; T[P_HEADX] = -0.15;
        break;
      case 'stomp':
        T[P_HIPR] = 0.1; T[P_KNR] = 0.05;
        T[P_TORX] = 0.35; T[P_SHL] = 0.5; T[P_SHR] = 0.5; T[P_ELL] = -0.3; T[P_ELR] = -0.3;
        T[P_LIFT] = -0.1; T[P_HEADX] = 0.25;
        break;
      case 'chargeTele': {
        const scrape = Math.sin(t * 9.5);
        T[P_HIPR] = -0.25 + 0.45 * scrape; T[P_KNR] = 0.6 + 0.3 * scrape;
        T[P_TORX] = 0.38; T[P_HEADX] = 0.35;
        T[P_SHL] = 0.6; T[P_SHR] = 0.6; T[P_ELL] = -1.6; T[P_ELR] = -1.6;
        break;
      }
      case 'charge': {
        const ph = this.runPhase;
        const s = Math.sin(ph), c = Math.sin(ph + Math.PI);
        T[P_HIPL] = 0.95 * s; T[P_HIPR] = 0.95 * c;
        T[P_KNL] = Math.max(0, -1.3 * s) + 0.1; T[P_KNR] = Math.max(0, -1.3 * c) + 0.1;
        T[P_SHL] = -0.9 * c; T[P_SHR] = -0.9 * s; T[P_ELL] = -1.7; T[P_ELR] = -1.7;
        T[P_TORX] = 0.45; T[P_HEADX] = 0.2;
        T[P_LIFT] = 0.06 * Math.abs(Math.sin(ph));
        break;
      }
      case 'dizzy':
        T[P_TORZ] = 0.22 * Math.sin(t * 4.2); T[P_TORX] = 0.15 + 0.1 * Math.sin(t * 3.1);
        T[P_HEADZ] = 0.35 * Math.sin(t * 5.1); T[P_HEADY] = 0.3 * Math.sin(t * 2.3); T[P_HEADX] = 0.25;
        T[P_SHL] = 0.3; T[P_SHR] = 0.3; T[P_ELL] = -0.2; T[P_ELR] = -0.2;
        T[P_KNL] = 0.35; T[P_KNR] = 0.35; T[P_LIFT] = -0.12;
        break;
      case 'hit':
        T[P_TORX] = -0.35; T[P_HEADX] = -0.5; T[P_SHL] = -1.2; T[P_SHR] = -1.2; T[P_ELL] = -0.6; T[P_ELR] = -0.6;
        T[P_LIFT] = 0.08;
        break;
      case 'death': {
        const u = clamp(this.stateT / WD_DEATH, 0, 1);
        T[P_TORX] = 1.35 * smoothstep(0, 0.45, u); T[P_HEADX] = 0.8; T[P_KNL] = 1.2 * smoothstep(0, 0.4, u); T[P_KNR] = 1.2 * smoothstep(0, 0.4, u);
        T[P_HIPL] = -0.8 * smoothstep(0, 0.4, u); T[P_HIPR] = -0.8 * smoothstep(0, 0.4, u);
        T[P_SHL] = -0.4; T[P_SHR] = -0.4; T[P_ELL] = -0.9; T[P_ELR] = -0.9;
        T[P_LIFT] = -1.0 * smoothstep(0, 0.45, u) - 3.0 * smoothstep(0.55, 1, u);
        break;
      }
      case 'dead':
        T[P_LIFT] = -4;
        break;
    }
  }

  _pose(dt) {
    const P = this.pose, T = this.poseT;
    const lam = this.state === 'stomp' ? 40 : (this.state === 'charge' ? 26 : 12);
    for (let i = 0; i < 16; i++) P[i] = dt > 0 ? damp(P[i], T[i], lam, dt) : T[i];
    this.body.position.set(this.pos.x, this.pos.y + P[P_LIFT], this.pos.z);
    this.body.rotation.y = this.yaw;
    this.hips.rotation.set(P[P_TORX] * 0.4, 0, P[P_TORZ] * 0.5);
    this.torso.rotation.set(P[P_TORX] * 0.6, 0, P[P_TORZ] * 0.5);
    this.head.rotation.set(P[P_HEADX], P[P_HEADY], P[P_HEADZ]);
    this.shL.piv.rotation.set(P[P_SHL], 0, P[P_SHLZ]);
    this.shR.piv.rotation.set(P[P_SHR], 0, P[P_SHRZ]);
    this.shL.joint.rotation.x = P[P_ELL];
    this.shR.joint.rotation.x = P[P_ELR];
    this.hipL.piv.rotation.x = P[P_HIPL];
    this.hipR.piv.rotation.x = P[P_HIPR];
    this.hipL.joint.rotation.x = P[P_KNL];
    this.hipR.joint.rotation.x = P[P_KNR];
    // hit flash on the owned armour materials
    if (this.flash > 0 || this._flashApplied) {
      const f = this.flash;
      for (let i = 0; i < this.flashMats.length; i++) {
        const m = this.flashMats[i];
        m.emissive.setRGB(f, f * 0.9, f * 0.7);
        m.emissiveIntensity = f * 2.5;
      }
      this._flashApplied = f > 0;
    }
    this.gem.material.emissiveIntensity = 2.2 + 0.8 * Math.sin(this.time * 3.3) + (this.state === 'dizzy' ? 1.5 : 0);
    this.col.setCenter(this.pos.x, this.pos.y + 1.3, this.pos.z);
    this.kill.center.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    this.kill.update();
  }

  _enter(state) {
    this.state = state; this.stateT = 0;
    this.hud.phase = state;
    this.events.emit('phase', state, this);
    switch (state) {
      case 'roar':
        this._sfx('warden_roar', this.pos, 1, 1);
        this._shake(0.25, 500);
        this._playClip('roar');
        break;
      case 'stompTele':
        this._sfx('vanish_warn', this.pos, 0.6, 0.8);
        this._playClip('telegraph');
        break;
      case 'chargeTele':
        this._sfx('step_stone', this.pos, 0.5, 1);
        this._playClip('telegraph');
        break;
      case 'charge':
        this._sfx('warden_roar', this.pos, 1.3, 0.8);
        this._playClip('walk');
        break;
      case 'dizzy':
        this._sfx('warden_hit', this.pos, 0.6, 1);
        this._playClip('dizzy');
        break;
      case 'hit':
        this._playClip('hit');
        break;
      case 'death':
        this._playClip('death');
        break;
      default:
        this._playClip('idle');
    }
  }

  _nextAttack() {
    // alternate stomp/charge with a seeded chance of a repeat — readable but not metronomic
    const r = this.rng();
    const last = this.attackIx;
    this.attackIx = r < 0.72 ? 1 - last : last;
    this._enter(this.attackIx === 0 ? 'stompTele' : 'chargeTele');
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.enabled) return;
    const t = this.time;
    this.stateT += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);
    const alive = !!player && !player.dead;
    const prevX = this.pos.x, prevZ = this.pos.z;
    let pdx = 0, pdz = 0, pd = 1e9, pp = null;
    if (player) { pp = player.pos || player.position; pdx = pp.x - this.pos.x; pdz = pp.z - this.pos.z; pd = Math.hypot(pdx, pdz); }
    const inArena = alive && Math.hypot(pp.x - this.arenaC.x, pp.z - this.arenaC.z) < this.arenaR && Math.abs(pp.y - this.groundY) < 5;
    const faceHero = () => { if (player) this.yaw = dampAngle(this.yaw, Math.atan2(pdx, pdz), 3.2, dt); };

    switch (this.state) {
      case 'dormant':
        faceHero();
        if (inArena) this._enter('roar');
        break;
      case 'roar':
        if (this.stateT >= WD_ROAR) this._enter('idle');
        break;
      case 'idle':
        faceHero();
        if (!inArena) { if (this.stateT > 2.5) this._enter('dormant'); }
        else if (this.stateT >= WD_IDLE) this._nextAttack();
        break;
      case 'stompTele':
        faceHero();
        if (this.stateT >= WD_STOMP_TELE) {
          this._enter('stomp');
          this.ringR = 0.3; this.ringActive = true; this.ringHitDone = false;
          headingFromYaw(this.yaw, _v0);
          this.ringC.set(this.pos.x + _v0.x * 0.5, this.groundY, this.pos.z + _v0.z * 0.5);
          this.ring.visible = true; this.ringGlow.visible = true;
          this.ring.position.set(this.ringC.x, this.groundY + 0.12, this.ringC.z);
          this.ringGlow.position.set(this.ringC.x, this.groundY + 0.03, this.ringC.z);
          this._sfx('pound_land', this.ringC, 0.7, 1);
          this._burst('poundShock', this.ringC, 0xff9a3a, 1);
          this._shake(0.35, 320);
        }
        break;
      case 'stomp': {
        if (this.ringActive) {
          const u = clamp(this.stateT / WD_STOMP_RING_T, 0, 1);
          this.ringR = 0.3 + (WD_STOMP_RING_R - 0.3) * u;
          this.ring.scale.set(this.ringR, 1, this.ringR);
          this.ring.material.emissiveIntensity = 3.0 * (1 - u * 0.6);
          this.ringGlow.scale.set(this.ringR * 1.05, 1, this.ringR * 1.05);
          if (alive && !this.ringHitDone) {
            const rx = pp.x - this.ringC.x, rz = pp.z - this.ringC.z;
            const rd = Math.hypot(rx, rz);
            const grounded = player.grounded === true || (pp.y - this.groundY) < 0.45;
            if (grounded && Math.abs(rd - this.ringR) < 0.5) {
              this.ringHitDone = true;
              this._hurt(player, rx, rz, 7, 0.4);
              this._sfx('warden_hit', pp, 1.2, 0.8);
            }
          }
          if (u >= 1) { this.ringActive = false; this.ring.visible = false; this.ringGlow.visible = false; }
        }
        if (this.stateT >= 1.0) this._enter('idle');
        break;
      }
      case 'chargeTele':
        faceHero();
        if (Math.floor(this.stateT * 4.8) !== this._scrapeIx) {
          this._scrapeIx = Math.floor(this.stateT * 4.8);
          headingFromYaw(this.yaw, _v0);
          _v1.set(this.pos.x + _v0.x * 0.6, this.groundY + 0.05, this.pos.z + _v0.z * 0.6);
          this._burst('dust', _v1, 0x8a7a66, 0.7);
          this._sfx('step_stone', _v1, 0.55, 0.7);
        }
        if (this.stateT >= WD_CHARGE_TELE) {
          if (player) this.chargeDir.set(pdx, 0, pdz); else headingFromYaw(this.yaw, this.chargeDir);
          if (this.chargeDir.lengthSq() < 1e-6) headingFromYaw(this.yaw, this.chargeDir);
          this.chargeDir.normalize();
          this.yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
          this.kill.active = this.lethal;
          this.runPhase = 0;
          this._enter('charge');
        }
        break;
      case 'charge': {
        this.pos.x += this.chargeDir.x * WD_CHARGE_SPEED * dt;
        this.pos.z += this.chargeDir.z * WD_CHARGE_SPEED * dt;
        this.runPhase += dt * 13;
        if (Math.floor(this.runPhase / Math.PI) !== this._stepIx) {
          this._stepIx = Math.floor(this.runPhase / Math.PI);
          this._sfx('step_stone', this.pos, 0.6, 0.9);
          this._burst('dust', this.pos, 0x8a7a66, 0.5);
          this._shake(0.05, 80);
        }
        // fair shove for anyone in the way (or a kill when the course asks for it)
        if (alive && this.hitCd <= 0 && capsuleHitsSphere(capsuleOf(player), this.pos.x, this.pos.y + 1.2, this.pos.z, WD_BODY_R)) {
          this.hitCd = 0.8;
          if (this.lethal && typeof player.kill === 'function') { try { player.kill('warden'); } catch (e) { /* noop */ } }
          else { this._hurt(player, this.chargeDir.x + pdx * 0.3, this.chargeDir.z + pdz * 0.3, 9, 0.5); this._sfx('warden_hit', this.pos, 1.0, 1); }
        }
        // arena wall
        const ax = this.pos.x - this.arenaC.x, az = this.pos.z - this.arenaC.z;
        const ad = Math.hypot(ax, az);
        if (ad >= this.arenaR - 1.0 || this.stateT > 3.0) {
          if (ad > 1e-6) { const f = (this.arenaR - 1.0) / ad; if (ad > this.arenaR - 1.0) { this.pos.x = this.arenaC.x + ax * f; this.pos.z = this.arenaC.z + az * f; } }
          this.kill.active = false;
          this._enter('dizzy');
          _v1.set(this.pos.x + this.chargeDir.x * 0.9, this.pos.y + 1.4, this.pos.z + this.chargeDir.z * 0.9);
          this._sfx('crusher_slam', _v1, 0.8, 1);
          this._burst('poundShock', _v1, 0xd9c8a6, 1);
          this._burst('spark', _v1, 0xffd27a, 1);
          this._shake(0.4, 420);
          this.stars.visible = true;
        }
        break;
      }
      case 'dizzy': {
        // stars orbit the helm
        const n = 5;
        for (let i = 0; i < n; i++) {
          const a = t * 5.5 + (i / n) * TAU;
          _v0.set(this.pos.x + Math.cos(a) * 0.55, this.pos.y + 3.05 + 0.08 * Math.sin(a * 2), this.pos.z + Math.sin(a) * 0.55);
          _q0.setFromAxisAngle(UP, -a);
          _s0.set(1, 1, 1);
          _m0.compose(_v0, _q0, _s0);
          this.stars.setMatrixAt(i, _m0);
        }
        this.stars.instanceMatrix.needsUpdate = true;
        if (this.stateT >= WD_DIZZY) { this.stars.visible = false; this._enter(this.hp > 0 ? 'roar' : 'death'); }
        break;
      }
      case 'hit':
        if (this.stateT >= WD_HIT) this._enter(this.hp > 0 ? 'roar' : 'death');
        break;
      case 'death':
        if (this.stateT > 0.5 && this.stateT - dt <= 0.5) {
          this._sfx('crusher_slam', this.pos, 0.6, 1);
          this._burst('poundShock', this.pos, 0xd9c8a6, 1);
          this._shake(0.5, 500);
        }
        if (this.stateT >= WD_DEATH) {
          this._enter('dead');
          this.body.visible = false;
          this.col.active = false;
          this.alive = false;
          this._burst('death', this.pos, this.realmColor, 1);
          this._sfx('gate_open', this.pos, 0.9, 1);
          this.events.emit('down', this);
          this._trigger(this.def.trigger || 'warden-down');
        }
        break;
      case 'dead':
        break;
    }

    this._setTargets(t, dt);
    const inv = 1 / Math.max(dt, 1e-4);
    this.linVel.set((this.pos.x - prevX) * inv, 0, (this.pos.z - prevZ) * inv);
    this.hud.hp = this.hp;
    this._pose(dt);
  }

  /** Pounding the exposed back while dizzy lands a hit. */
  onPound(player, pos) {
    if (this.state !== 'dizzy') return;
    const p = pos || (player && (player.pos || player.position));
    if (!p) return;
    headingFromYaw(this.yaw, _v0);
    const bx = this.pos.x - _v0.x * 0.8, bz = this.pos.z - _v0.z * 0.8;
    const dx = p.x - bx, dz = p.z - bz;
    if (dx * dx + dz * dz > 1.7 * 1.7 || Math.abs(p.y - this.pos.y) > 3.6) return;
    this.hp = Math.max(0, this.hp - 1);
    this.hud.hp = this.hp;
    this.flash = 1;
    this.stars.visible = false;
    _v1.set(this.pos.x, this.pos.y + 2.0, this.pos.z);
    this._sfx('warden_hit', _v1, 1.0, 1);
    this._burst('spark', _v1, 0xffd27a, 1);
    this._burst('pound', _v1, this.realmColor, 0.8);
    this._shake(0.3, 300);
    this.events.emit('hit', this.hp, this);
    this._enter('hit');
  }

  onDive() {}

  _reset() {
    this.hp = WD_HP;
    this.state = 'dormant'; this.stateT = 0; this.attackIx = 0;
    this.hud.hp = this.hp; this.hud.phase = 'dormant';
    this.pos.copy(this.home); this.yaw = this.homeYaw;
    this.flash = 0; this.hitCd = 0; this.runPhase = 0;
    this.ringActive = false; this.ring.visible = false; this.ringGlow.visible = false; this.stars.visible = false;
    this.kill.active = false; this.col.active = true; this.body.visible = true; this.alive = true;
    this._scrapeIx = -1; this._stepIx = -1;
    for (let i = 0; i < 16; i++) this.pose[i] = 0;
    for (let i = 0; i < this.flashMats.length; i++) { this.flashMats[i].emissive.setRGB(0, 0, 0); this.flashMats[i].emissiveIntensity = 0; }
    this._flashApplied = false;
    this._setTargets(0, 0);
    this._pose(0);
    this._playClip('idle', 0);
  }
}

/* ===========================================================================
 * 9. OLD FEN — the Keep caretaker
 * ======================================================================== */

const FEN_TALK_R = 2.0;

class Fen extends Critter {
  constructor(def, ctx) {
    super(def, ctx, 'fen');
    this.naturalHeight = 1.7;
    const d = this.def;
    readV3(d.p, this.pos);
    this.groundY = this._groundY(this.pos.x, this.pos.y + 0.5, this.pos.z, this.pos.y);
    this.pos.y = this.groundY;
    this.yaw = fin(d.yaw, 0);
    this.homeYaw = this.yaw;
    this.lines = Array.isArray(d.lines) && d.lines.length ? d.lines : ['Mind the ramparts, little one.'];
    this.lineIx = 0;
    this.near = false;
    this.talkT = 0;
    this.lanternSwing = 0;
    this.lanternVel = 0;

    this._build();
    this.col = this._solidBox(this.pos.x, this.pos.y + 0.8, this.pos.z, 0.42, 0.8, 0.42, 'normal', null);
    this._pose(0);
    this._silent = false;
  }

  _build() {
    const cloth = worldMat('cloth', this.ctx);
    const robe = skinMat(fin(this.def.color, 0x5a4a6e), 0.85, 0.0);
    const skin = skinMat(0xd9b48c, 0.7, 0.0);
    const beard = skinMat(0xe8e2d6, 0.9, 0.0);
    const wood = worldMat('wood', this.ctx);
    const brass = worldMat('copper', this.ctx);
    const flame = getEmissive(0xffb347, 3.4);

    const root = new THREE.Group(); root.name = 'body';
    // robe: tapered, with a hem ring; the torso pivot is stooped
    this.torso = new THREE.Group(); this.torso.name = 'torso'; this.torso.position.y = 0.95;
    root.add(this.torso);
    const skirt = tubeGeometry(0.3, 0.46, 0.98, 14, 1);
    place(skirt, 0, 0.47, 0);
    const hem = ringProfileGeometry(0.46, [0.03, 0.02, 0.008], 14, 1);
    place(hem, 0, 0.02, 0);
    root.add(mergeParts([{ g: skirt, m: robe }, { g: hem, m: cloth }], 'skirt'));
    const chest = capsuleGeo(0.3, 0.3, 12);
    place(chest, 0, 0.2, 0, 0, 0, 0, 1, 0.9, 0.85);
    const shoulders = capsuleGeo(0.16, 0.5, 10);
    place(shoulders, 0, 0.4, 0, 0, 0, Math.PI / 2);
    const sash = ringProfileGeometry(0.31, [0.02, 0.05, 0.008], 14, 1);
    place(sash, 0, 0.08, 0);
    this.torso.add(mergeParts([{ g: chest, m: robe }, { g: shoulders, m: robe }, { g: sash, m: cloth }], 'chest'));
    // head + hood + beard
    this.head = new THREE.Group(); this.head.name = 'head'; this.head.position.set(0, 0.62, 0.08);
    this.torso.add(this.head);
    const skull = sphereGeo(0.19, 16, 12);
    const hood = sphereGeo(0.24, 16, 10, 0, TAU, 0, Math.PI * 0.62);
    place(hood, 0, 0.02, -0.03, 0, 0, 0, 1, 1.1, 1);
    const hoodPeak = coneGeo(0.14, 0.3, 8);
    place(hoodPeak, 0, 0.3, -0.08, -0.5, 0, 0);
    const nose = coneGeo(0.035, 0.1, 6);
    place(nose, 0, -0.02, 0.2, Math.PI / 2, 0, 0);
    const beardG = coneGeo(0.12, 0.34, 8);
    place(beardG, 0, -0.26, 0.1, Math.PI, 0, 0);
    this.head.add(mergeParts([{ g: skull, m: skin }, { g: hood, m: robe }, { g: hoodPeak, m: robe }, { g: nose, m: skin }, { g: beardG, m: beard }], 'headShell'));
    this.eyes = makeEyes(0.035, 0.11, 0, 0.03, 0.17, 0);
    this.head.add(this.eyes.group);
    // arms: one holds the staff, one rests on the sash
    const armL = capsuleGeo(0.07, 0.4, 8);
    place(armL, -0.34, 0.15, 0.08, 0.5, 0, 0.5);
    const armR = capsuleGeo(0.07, 0.42, 8);
    place(armR, 0.34, 0.18, 0.15, -1.1, 0, -0.35);
    const handL = sphereGeo(0.075, 8, 6);
    place(handL, -0.44, -0.02, 0.2);
    const handR = sphereGeo(0.075, 8, 6);
    place(handR, 0.42, 0.28, 0.36);
    this.torso.add(mergeParts([{ g: armL, m: robe }, { g: armR, m: robe }, { g: handL, m: skin }, { g: handR, m: skin }], 'arms'));
    // staff, held out front-right, with a lantern swinging from its hook
    this.staff = new THREE.Group(); this.staff.name = 'staff'; this.staff.position.set(0.42, -0.65, 0.36);
    this.torso.add(this.staff);
    const shaft = tubeGeometry(0.03, 0.04, 1.85, 8, 1);
    place(shaft, 0, 0.92, 0);
    const knob = sphereGeo(0.06, 8, 6);
    place(knob, 0, 1.86, 0);
    const hookG = tubeGeometry(0.02, 0.02, 0.28, 6, 1);
    place(hookG, 0.12, 1.74, 0, 0, 0, -1.2);
    this.staff.add(mergeParts([{ g: shaft, m: wood }, { g: knob, m: brass }, { g: hookG, m: brass }], 'staff'));
    this.lantern = new THREE.Group(); this.lantern.name = 'lantern'; this.lantern.position.set(0.24, 1.66, 0);
    this.staff.add(this.lantern);
    const cageTop = prismGeometry(0.1, 0.04, 6, 1);
    place(cageTop, 0, -0.04, 0);
    const cageBot = prismGeometry(0.1, 0.04, 6, 1);
    place(cageBot, 0, -0.34, 0);
    const lanternParts = [{ g: cageTop, m: brass }, { g: cageBot, m: brass }];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const barG = tubeGeometry(0.012, 0.012, 0.3, 5, 1);
      place(barG, Math.cos(a) * 0.085, -0.19, Math.sin(a) * 0.085);
      lanternParts.push({ g: barG, m: brass });
    }
    this.lantern.add(mergeParts(lanternParts, 'lanternCage'));
    const flameMesh = new THREE.Mesh(cached('fen:flame', () => { const g = prismGeometry(0.045, 0.14, 6, 1); g.computeBoundingSphere(); return g; }), flame);
    flameMesh.position.set(0, -0.19, 0);
    flameMesh.castShadow = false;
    this.lantern.add(flameMesh);
    this.flameMesh = flameMesh;
    const glow = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ color: 0xffb347, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })));
    glow.scale.set(0.7, 0.7, 1);
    glow.position.set(0, -0.19, 0);
    this.lantern.add(glow);
    this.glow = glow;
    // a real point light for the lantern only when the quality allows it: fixed pool, never toggled
    const q = this.ctx.quality;
    const wantLight = q === 'high' || q === 'ultra' || (q && (q.key === 'high' || q.key === 'ultra'));
    if (wantLight) {
      const light = new THREE.PointLight(0xffb347, 6, 7, 2);
      light.position.set(0, -0.19, 0);
      light.castShadow = false;
      this.lantern.add(light);
      this.light = light;
    }

    this.body = root;
    this.rig.add(root);
  }

  _pose(dt) {
    const t = this.time;
    const b = this.body;
    b.position.copy(this.pos);
    b.rotation.y = this.yaw;
    // stoop + slow sway; the head lifts toward the hero when they are near
    const sway = 0.04 * Math.sin(t * 0.9);
    this.torso.rotation.set(0.38 + 0.02 * Math.sin(t * 1.3), 0, sway);
    const lift = this.near ? -0.3 : -0.05;
    this.head.rotation.x = damp(this.head.rotation.x, lift, 6, dt || 0.016);
    this.staff.rotation.z = -0.08 + 0.02 * Math.sin(t * 0.9 + 1);
    // lantern: a damped pendulum driven by the sway
    const target = -sway * 2.5 - (this.torso.rotation.x - 0.38) * 3;
    const acc = (target - this.lanternSwing) * 18 - this.lanternVel * 2.2;
    this.lanternVel += acc * (dt || 0.016);
    this.lanternSwing += this.lanternVel * (dt || 0.016);
    this.lantern.rotation.z = this.lanternSwing;
    this.lantern.rotation.x = 0.5 * this.lanternSwing;
    const flick = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 7.3);
    this.flameMesh.material.emissiveIntensity = 3.4 * flick;
    this.glow.material.opacity = 0.32 + 0.18 * flick;
    if (this.light) this.light.intensity = 5 + 2.5 * flick;
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.enabled) return;
    if (this.talkT > 0) this.talkT -= dt;
    if (player) {
      const pp = player.pos || player.position;
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
      const near = !player.dead && dx * dx + dz * dz < FEN_TALK_R * FEN_TALK_R && Math.abs(pp.y - this.pos.y) < 2;
      if (near !== this.near) { this.near = near; this.events.emit('near', near, this); }
      const targetYaw = near ? Math.atan2(dx, dz) : this.homeYaw;
      this.yaw = dampAngle(this.yaw, targetYaw, near ? 3.5 : 1.2, dt);
      const rel = wrapAngle(Math.atan2(dx, dz) - this.yaw);
      this.eyes.look(clamp(rel / 1.2, -1, 1), clamp((pp.y + 1.0 - (this.pos.y + 1.5)) / 2, -1, 1));
      // interact key, when the game hands us the input
      const inp = this.ctx.input;
      if (near && inp && inp.interactPressed && this.talkT <= 0) this.interact(player);
    }
    this._pose(dt);
  }

  /** Speak the next line (cycles). Returns the line spoken, or null when out of range. */
  interact(player) {
    if (player) {
      const pp = player.pos || player.position;
      if (Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) > FEN_TALK_R + 0.5) return null;
    }
    const line = this.lines[this.lineIx % this.lines.length];
    this.lineIx++;
    this.talkT = 0.35;
    try { if (typeof this.ctx.say === 'function') this.ctx.say(line, this); } catch (e) { /* noop */ }
    this._sfx('ui_move', this.pos, 0.9, 0.5);
    this.events.emit('say', line, this);
    return line;
  }

  _reset() {
    this.yaw = this.homeYaw; this.near = false; this.talkT = 0;
    this.lanternSwing = 0; this.lanternVel = 0;
    this.head.rotation.x = -0.05;
    this._pose(0);
    this.eyes.look(0, 0);
    this._playClip('idle', 0);
  }
}

/* ===========================================================================
 * 10. Registry — CONTRACT §23
 * ======================================================================== */

export const CRITTERS = {
  gnasher: (def, ctx) => new Gnasher(def, ctx),
  bumbler: (def, ctx) => new Bumbler(def, ctx),
  skitter: (def, ctx) => new Skitter(def, ctx),
  warden: (def, ctx) => new Warden(def, ctx),
  fen: (def, ctx) => new Fen(def, ctx),
};

/** Kinds by name — used by the course validator. */
export const CRITTER_KINDS = Object.freeze(Object.keys(CRITTERS));

export class CritterDefError extends Error {
  constructor(msg, def) { super(msg); this.name = 'CritterDefError'; this.def = def || null; }
}

/**
 * Build a critter from a course def. Throws CritterDefError for an unknown kind
 * so a typo in course data surfaces at load, never as an empty course.
 * The returned critter's `mesh` is added to ctx.group / ctx.scene when present.
 */
export function makeCritter(def, ctx) {
  const kind = def && def.kind;
  const f = CRITTERS[kind];
  if (!f) throw new CritterDefError('unknown critter kind "' + kind + '" (known: ' + CRITTER_KINDS.join(', ') + ')', def);
  const c = f(def, ctx || {});
  const parent = ctx && (ctx.group || ctx.scene);
  if (parent && typeof parent.add === 'function') parent.add(c.mesh);
  return c;
}

/** Release the module-level geometry + material caches (game teardown). */
export function disposeCritterCaches() {
  for (const g of _geoCache.values()) g.dispose();
  _geoCache.clear();
  for (const m of _matCache.values()) m.dispose();
  _matCache.clear();
}

export { Gnasher, Bumbler, Skitter, Warden, Fen };
export default CRITTERS;
