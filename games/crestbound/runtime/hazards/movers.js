// =============================================================================
//  CRESTBOUND — runtime/hazards/movers.js
//  Moving platforms: linear / circle / orbit / oscillate / sink / elevator.
//
//  DETERMINISM LAW (CONTRACT §21): every physical transform produced here is a
//  PURE FUNCTION of the course clock `t` and this object's `def`. Nothing is
//  integrated frame-to-frame. `reset(t)` places the mover exactly where
//  `update(t)` would. The only retained state is a *trigger timestamp*
//  (sink / elevator), which is itself expressed on the course clock so that a
//  clock rewind on respawn restores the machine bit-for-bit.
//
//  Velocity handed to the collision layer:
//      velocityAt(p) = linVel + angVel * (angAxis × (p − angCenter))
//  so for a spinning `circle` mover we publish angCenter = the orbit centre and
//  linVel = 0 (the orbit is *entirely* described by the rotation), while every
//  purely translating type publishes angVel = 0 and the analytic linear velocity.
//
//  Ported from Ascendant. Crestbound changes: update(t, dt, player) receives the
//  live player; onStand(player, collider) is the Course's stand hook; the
//  self-detect fallback uses the kit's standingOn() (grounded + ON this deck).
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider, KillVolume } from '../world/collider.js';
import { buildPlatform } from '../world/builders.js';
import { hazSfx, hazBurst, resolvePlayer, standingOn, hazTex } from './lasers.js';

// ---------------------------------------------------------------------------
// module-scope scratch — no per-frame heap allocation anywhere below
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const FD_H = 1 / 240;              // central-difference step for analytic velocity

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scale1 = new THREE.Vector3(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function fract(v) { return v - Math.floor(v); }
function smooth(v) { return v * v * (3 - 2 * v); }
function easeOutCubic(v) { return 1 - Math.pow(1 - v, 3); }

function readVec(src, out, dx, dy, dz) {
  if (Array.isArray(src) && src.length >= 3) out.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  else if (src && typeof src === 'object' && 'x' in src) out.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  else if (typeof src === 'string') {
    const s = src.toLowerCase();
    out.set(s === 'x' ? 1 : 0, s === 'y' ? 1 : 0, s === 'z' ? 1 : 0);
    if (out.lengthSq() < 1e-8) out.set(dx, dy, dz);
  } else out.set(dx, dy, dz);
  return out;
}

function clampLen(v, m) {
  const l = v.length();
  if (l > m && l > 1e-9) v.multiplyScalar(m / l);
  return v;
}

const EASE = {
  linear: (u) => u,
  sine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),
  inout: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  snap: (u) => smooth(clamp01((u - 0.30) / 0.38)),
};

// ---------------------------------------------------------------------------
// geometry kit — every visible piece is chamfered, never a naked box
// ---------------------------------------------------------------------------
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.max(0.0005, Math.min(r, Math.min(w, h) / 2 - 1e-4));
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
  return s;
}

/** Chamfered box centred on the origin. w→X, h→Y, d→Z. Real bevels, smooth normals. */
export function chamferBox(w, h, d, bev = 0.05, seg = 1) {
  const b = Math.max(0.004, Math.min(bev, Math.min(w, h, d) * 0.30));
  const iw = Math.max(0.002, w - 2 * b);
  const ih = Math.max(0.002, h - 2 * b);
  const dep = Math.max(0.002, d - 2 * b);
  const r = Math.min(0.16, Math.min(iw, ih) * 0.24);
  const g = new THREE.ExtrudeGeometry(roundedRectShape(iw, ih, r), {
    depth: dep, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelOffset: 0, bevelSegments: seg, curveSegments: seg + 1, steps: 1,
  });
  g.translate(0, 0, -dep / 2);
  return g;
}

/** Chevron / arrow-head plate lying in XZ, pointing +Z, thickness t. */
function chevronGeo(w, len, t) {
  const s = new THREE.Shape();
  const hw = w / 2, hl = len / 2, k = w * 0.30;
  s.moveTo(-hw, -hl);
  s.lineTo(0, hl);
  s.lineTo(hw, -hl);
  s.lineTo(hw - k, -hl);
  s.lineTo(0, hl - k * 1.7);
  s.lineTo(-hw + k, -hl);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.35, bevelSize: t * 0.35, bevelSegments: 1, curveSegments: 1, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, t / 2, 0);
  return g;
}

function ringGeo(r, tube, rseg = 6, tseg = 16) { return new THREE.TorusGeometry(r, tube, rseg, tseg); }

function boltRing(count, r, br, bh) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const g = new THREE.CylinderGeometry(br, br * 1.12, bh, 6);
    g.rotateX(Math.PI / 2);
    g.translate(Math.cos(a) * r, Math.sin(a) * r, 0);
    out.push(g);
  }
  return out;
}

/** Merge a list into one geometry (all normalised to non-indexed). Inputs kept alive on failure. */
export function mergeAll(list) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const prepped = new Array(list.length);
  for (let i = 0; i < list.length; i++) prepped[i] = list[i].index ? list[i].toNonIndexed() : list[i];
  let merged = null;
  try { merged = mergeGeometries(prepped, false); } catch (err) { merged = null; }
  for (let i = 0; i < prepped.length; i++) if (prepped[i] !== list[i]) prepped[i].dispose();
  if (merged) for (let i = 0; i < list.length; i++) list[i].dispose();
  return merged;
}

/** Build one mesh (or a Group if merging was refused) from a geometry list. */
export function partMesh(list, material, D, castShadow = true, receiveShadow = true) {
  const merged = mergeAll(list);
  if (merged) {
    D.push(merged);
    const m = new THREE.Mesh(merged, material);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow;
    return m;
  }
  const g = new THREE.Group();
  for (const geo of list) {
    D.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.castShadow = castShadow; m.receiveShadow = receiveShadow;
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------------------
// material / texture / palette access (all guarded — Mats is owned elsewhere)
// ---------------------------------------------------------------------------
const _fallbackMats = new Map();
function fallbackMat(key) {
  let m = _fallbackMats.get(key);
  if (m) return m;
  const spec = {
    metal: { color: 0x8d9bab, roughness: 0.36, metalness: 0.92 },
    panel: { color: 0x5c6675, roughness: 0.55, metalness: 0.55 },
    stone: { color: 0x8b8b8b, roughness: 0.9, metalness: 0.03 },
    grate: { color: 0x4a5361, roughness: 0.48, metalness: 0.78 },
    rubber: { color: 0x23262c, roughness: 0.95, metalness: 0.02 },
    wood: { color: 0x8a6740, roughness: 0.86, metalness: 0.0 },
  }[key] || { color: 0x9aa4b2, roughness: 0.5, metalness: 0.4 };
  m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness, envMapIntensity: 0.9 });
  _fallbackMats.set(key, m);
  return m;
}

export function getMat(ctx, key) {
  try {
    if (ctx && ctx.mats && typeof ctx.mats.get === 'function') {
      const m = ctx.mats.get(key, ctx.theme ? ctx.theme.id : ctx.themeId);
      if (m) return m;
    }
  } catch (err) { /* fall through */ }
  return fallbackMat(key);
}

export function pal(ctx, key, dflt) {
  const p = ctx && ctx.theme && ctx.theme.palette;
  const v = p ? p[key] : undefined;
  return (v === undefined || v === null) ? dflt : v;
}

/**
 * Animated emissive trim. Mats.get() materials are shared+cached and MUST NOT be
 * mutated, so every strobing/colour-shifting surface owns its own material here
 * (disposed in dispose()). It still carries procedural maps, never a bare colour.
 */
export function glowMat(ctx, color, intensity, M, opts) {
  const o = opts || {};
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.base !== undefined ? o.base : 0x0b0e14),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: num(o.roughness, 0.34),
    metalness: num(o.metalness, 0.22),
    toneMapped: true,
  });
  const rt = hazTex(ctx, 'grunge') || hazTex(ctx, 'noise');
  if (rt) { m.roughnessMap = rt; m.emissiveMap = rt; }
  M.push(m);
  return m;
}

// ---------------------------------------------------------------------------
// collider plumbing
// ---------------------------------------------------------------------------
export function snapshotLocal(c) {
  if (!c) return;
  c.__lc = (c.center && c.center.clone) ? c.center.clone() : new THREE.Vector3();
  c.__lq = (c.quat && c.quat.clone) ? c.quat.clone() : new THREE.Quaternion();
}

export function placeCollider(c, pos, quat) {
  if (!c) return;
  if (c.center && c.center.copy) c.center.copy(c.__lc).applyQuaternion(quat).add(pos);
  if (c.quat && c.quat.copy) c.quat.copy(quat).multiply(c.__lq);
  if (typeof c.update === 'function') c.update();
}

// ---------------------------------------------------------------------------
// fallback platform (used only if builders.buildPlatform is unavailable)
// ---------------------------------------------------------------------------
export function fallbackPlatform(size, ctx, D, matKey, surface, hz) {
  const grp = new THREE.Group();
  const body = chamferBox(size[0], size[1], size[2], Math.min(0.09, size[1] * 0.35));
  const inset = chamferBox(size[0] * 0.82, size[1] * 0.30, size[2] * 0.82, 0.04);
  inset.translate(0, size[1] * 0.42, 0);
  grp.add(partMesh([body], getMat(ctx, matKey || 'metal'), D));
  grp.add(partMesh([inset], getMat(ctx, 'panel'), D));
  const rail = [];
  for (let s = -1; s <= 1; s += 2) {
    const gx = chamferBox(size[0] + 0.06, 0.05, 0.09, 0.02);
    gx.translate(0, size[1] * 0.5 + 0.01, s * (size[2] / 2 - 0.03));
    rail.push(gx);
    const gz = chamferBox(0.09, 0.05, size[2] + 0.06, 0.02);
    gz.translate(s * (size[0] / 2 - 0.03), size[1] * 0.5 + 0.01, 0);
    rail.push(gz);
  }
  const stripeMat = glowMat(ctx, pal(ctx, 'safeEdge', pal(ctx, 'accent', 0x7ef0ff)), 2.2, hz.__mats);
  grp.add(partMesh(rail, stripeMat, D, false, false));
  const col = new Collider({
    center: new THREE.Vector3(0, 0, 0),
    half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
    quat: new THREE.Quaternion(),
    surface: surface || 'normal',
    ref: hz, group: 'hazard',
  });
  return { mesh: grp, colliders: [col] };
}

/**
 * Build a platform deck through builders.buildPlatform (themed), falling back to the local
 * chamfered slab. Shared by mover / sinker / seesaw. Returns {mesh, colliders}.
 */
export function buildDeck(def, size, ctx, D, hz) {
  const platDef = {
    kind: 'platform', p: [0, 0, 0], s: size,
    mat: def.mat || 'metal',
    surface: def.surface || 'normal',
    props: def.props,
    // CONTRACT hard rule 2: a landable face carries a leading-edge stripe. The course
    // data may raise the glow or pick which faces are lit, but it can only turn the
    // stripe off deliberately (`stripe: false`) — the default stays ON.
    glow: (def && def.glow) || 1,
    stripe: (def && def.stripe !== undefined) ? def.stripe : true,
  };
  let plat = null;
  const bp = (ctx.builders && typeof ctx.builders.buildPlatform === 'function') ? ctx.builders.buildPlatform : buildPlatform;
  try { plat = bp(platDef, ctx.theme, ctx.mats); } catch (err) { plat = null; }
  if (!plat || !plat.mesh) plat = fallbackPlatform(size, ctx, D, def.mat, def.surface, hz);
  const cols = Array.isArray(plat.colliders) ? plat.colliders.slice() : [];
  if (cols.length === 0) {
    cols.push(new Collider({
      center: new THREE.Vector3(0, 0, 0),
      half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
      quat: new THREE.Quaternion(),
      surface: def.surface || 'normal', ref: hz, group: 'hazard',
    }));
  }
  for (const c of cols) {
    c.ref = hz; c.group = c.group || 'hazard';
    if (def.surface) c.surface = def.surface;
    if (def.props) { c.props = c.props || {}; Object.assign(c.props, def.props); }
    snapshotLocal(c);
  }
  return { mesh: plat.mesh, colliders: cols, plat };
}

// =============================================================================
//  mover(def, ctx)
// =============================================================================
/**
 * @param {object} def  {kind:'mover', p, s, mat?, surface?, kill?, motion:{...}}
 *   motion = {
 *     type: 'linear'|'circle'|'orbit'|'oscillate'|'sink'|'elevator',
 *     to:[x,y,z], radius, axis:[x,y,z]|'x'|'y'|'z', amp,
 *     period (s), phase (0..1 = FRACTION of a cycle), ease:'linear'|'sine'|'inout'|'snap',
 *     dwell (s), dir:±1,
 *     sinkDelay, sinkSpeed, sinkDepth, respawnAfter,      // sink
 *     travel, speed, hold                                  // elevator
 *   }
 * @param {object} ctx {mats, theme, fx, audio, builders, broadphase}
 */
export function mover(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const m = def.motion || {};
  const type = String(m.type || 'linear').toLowerCase();
  const period = Math.max(0.08, num(m.period, 4));
  const phase = num(m.phase, 0);
  const easeFn = EASE[String(m.ease || 'sine').toLowerCase()] || EASE.sine;
  const dwellFrac = clamp(num(m.dwell, 0) / period, 0, 0.46);
  const dirSign = num(m.dir, 1) < 0 ? -1 : 1;
  const size = Array.isArray(def.s) && def.s.length >= 3
    ? [Math.abs(num(def.s[0], 4)), Math.abs(num(def.s[1], 0.55)), Math.abs(num(def.s[2], 4))]
    : [4, 0.55, 4];

  const origin = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const hasTo = Array.isArray(m.to) && m.to.length >= 3;
  const toV = hasTo ? readVec(m.to, new THREE.Vector3(), origin.x, origin.y, origin.z) : origin.clone();
  const axis = readVec(m.axis, new THREE.Vector3(), 0, 1, 0);
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
  axis.normalize();
  const radius = Math.max(0.4, Math.abs(num(m.radius, 3)));
  const oscAmp = Math.abs(num(m.amp, 2));

  const bu = new THREE.Vector3(), bv = new THREE.Vector3();
  {
    const ref = Math.abs(axis.y) > 0.94 ? _X : _UP;
    bu.crossVectors(ref, axis);
    if (bu.lengthSq() < 1e-8) bu.copy(_Z);
    bu.normalize();
    bv.crossVectors(axis, bu).normalize();
  }
  const r0 = bu.clone().multiplyScalar(radius);

  const sinkDelay = Math.max(0, num(m.sinkDelay, 0.55));
  const sinkSpeed = Math.max(0.4, num(m.sinkSpeed, 5.5));
  const sinkDepth = Math.max(1.5, num(m.sinkDepth, 9));
  const sinkFall = sinkDepth / sinkSpeed;
  const respawnAfter = Math.max(0.9, num(m.respawnAfter, 2.6));
  const SINK_RISE = 0.42;

  const elevTravelV = new THREE.Vector3();
  if (hasTo) elevTravelV.subVectors(toV, origin);
  else elevTravelV.set(0, num(m.travel, 7), 0);
  const elevDist = Math.max(0.25, elevTravelV.length());
  const elevDir = elevTravelV.clone().multiplyScalar(1 / elevDist);
  const elevSpeed = Math.max(0.4, num(m.speed, 3.4));
  const elevRise = elevDist / elevSpeed;
  const elevArm = Math.max(0, num(m.dwell, 0.30));
  const elevHold = Math.max(0.2, num(m.hold, num(m.topDwell, 2.4)));
  const elevTotal = elevArm + elevRise + elevHold + elevRise;

  let trigT = null;
  const stateful = (type === 'sink' || type === 'elevator');

  // -------------------------------------------------------------------------
  // PURE SAMPLERS
  // -------------------------------------------------------------------------
  function pingpong(t) {
    const s = fract(t / period + phase);
    const leg = 0.5 - dwellFrac;
    if (leg <= 1e-5) return s < 0.5 ? 0 : 1;
    if (s < dwellFrac) return 0;
    if (s < 0.5) return easeFn(clamp01((s - dwellFrac) / leg));
    if (s < 0.5 + dwellFrac) return 1;
    return 1 - easeFn(clamp01((s - 0.5 - dwellFrac) / leg));
  }

  function sampleSink(t, out) {
    out.copy(origin);
    if (trigT === null) return;
    const el = t - trigT;
    if (el <= sinkDelay) return;
    const f = el - sinkDelay;
    if (f < sinkFall) { out.y -= f * sinkSpeed; return; }
    const g = f - sinkFall;
    const hold = respawnAfter - SINK_RISE;
    if (g < hold) { out.y -= sinkDepth; return; }
    if (g < respawnAfter) { out.y -= sinkDepth * (1 - easeOutCubic(clamp01((g - hold) / SINK_RISE))); return; }
  }

  function sampleElevator(t, out) {
    out.copy(origin);
    if (trigT === null) return;
    const el = t - trigT;
    if (el <= elevArm) return;
    const f = el - elevArm;
    if (f < elevRise) { out.addScaledVector(elevDir, elevDist * EASE.sine(clamp01(f / elevRise))); return; }
    const g = f - elevRise;
    if (g < elevHold) { out.addScaledVector(elevDir, elevDist); return; }
    const h = g - elevHold;
    if (h < elevRise) { out.addScaledVector(elevDir, elevDist * (1 - EASE.sine(clamp01(h / elevRise)))); return; }
  }

  function samplePos(t, out) {
    switch (type) {
      case 'circle':
      case 'orbit': {
        _q2.setFromAxisAngle(axis, TAU * (t / period + phase) * dirSign);
        out.copy(r0).applyQuaternion(_q2).add(origin);
        return out;
      }
      case 'oscillate': {
        const k = Math.sin(TAU * (t / period + phase) * dirSign);
        if (hasTo) out.lerpVectors(origin, toV, 0.5 + 0.5 * k);
        else out.copy(origin).addScaledVector(axis, oscAmp * k);
        return out;
      }
      case 'sink': return sampleSink(t, out);
      case 'elevator': return sampleElevator(t, out);
      default: {
        out.lerpVectors(origin, toV, pingpong(t));
        return out;
      }
    }
  }

  function sampleQuat(t, out) {
    if (type === 'circle') out.setFromAxisAngle(axis, TAU * (t / period + phase) * dirSign);
    else out.identity();
    return out;
  }

  // -------------------------------------------------------------------------
  // ART
  // -------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'mover:' + type;
  root.position.copy(origin);

  const carrier = new THREE.Group();
  const shell = new THREE.Group();
  carrier.add(shell);
  root.add(carrier);

  const hz = {
    kind: 'mover', type, def,
    mesh: root, colliders: [], kills: [], volumes: [],
    linVel: new THREE.Vector3(),
    angVel: 0,
    angAxis: axis.clone(),
    angCenter: origin.clone(),
    surface: def.surface || 'normal',
    time: 0,
    __mats: ownMats,
  };

  const deck = buildDeck(def, size, ctx, D, hz);
  shell.add(deck.mesh);
  const plat = deck.plat;
  hz.colliders = deck.colliders;

  const cAccent = new THREE.Color(pal(ctx, 'accent', 0x6fe9ff));
  const cSafe = new THREE.Color(pal(ctx, 'safeEdge', pal(ctx, 'safe', 0x9fe8ff)));
  const cWarn = new THREE.Color(pal(ctx, 'kill', 0xff5a3c));
  const matMetal = getMat(ctx, 'metal');
  const matPanel = getMat(ctx, 'panel');
  const matGrate = getMat(ctx, 'grate');

  const trimMat = glowMat(ctx, cAccent, 2.4, ownMats);
  const dirMat = glowMat(ctx, cSafe, 2.9, ownMats, { base: 0x05070b });
  const thrustMat = glowMat(ctx, cAccent, 3.4, ownMats, { base: 0x04060a, roughness: 0.5 });

  const nacelles = [];
  function buildNacelles() {
    const hx = size[0] * 0.5 - 0.34, hz2 = size[2] * 0.5 - 0.34;
    const y = -size[1] * 0.5;
    const housings = [];
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      const cyl = new THREE.CylinderGeometry(0.20, 0.26, 0.26, 10, 1, false);
      cyl.translate(sx * hx, y - 0.13, sz * hz2);
      housings.push(cyl);
      const collar = ringGeo(0.24, 0.035, 5, 12);
      collar.rotateX(Math.PI / 2);
      collar.translate(sx * hx, y - 0.06, sz * hz2);
      housings.push(collar);
    }
    shell.add(partMesh(housings, matMetal, D, true, false));

    const cones = [];
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      const c1 = new THREE.ConeGeometry(0.185, 0.40, 10, 1, true);
      c1.rotateX(Math.PI);
      c1.translate(sx * hx, y - 0.42, sz * hz2);
      cones.push(c1);
    }
    const glow = partMesh(cones, thrustMat, D, false, false);
    shell.add(glow);
    nacelles.push(glow);
  }

  const chevrons = [];
  let chevGroup = null;
  let vertical = false;
  {
    _c.subVectors(hasTo ? toV : origin, origin);
    if (type === 'elevator') { _c.copy(elevDir); }
    else if (type === 'sink') { _c.set(0, -1, 0); }
    else if (type === 'oscillate' && !hasTo) { _c.copy(axis); }
    else if (type === 'circle' || type === 'orbit') { _c.copy(bv); }
    vertical = _c.lengthSq() > 1e-8 && Math.abs(_c.clone().normalize().y) > 0.72;
  }

  function buildChevrons() {
    chevGroup = new THREE.Group();
    const n = 3;
    for (let i = 0; i < n; i++) {
      const rank = [];
      if (!vertical) {
        const w = Math.min(0.62, size[0] * 0.20), len = Math.min(0.5, size[2] * 0.16);
        const g = chevronGeo(w, len, 0.035);
        g.translate(0, size[1] * 0.5 + 0.004, (i - (n - 1) / 2) * (len * 1.28));
        rank.push(g);
      } else {
        const w = 0.5, len = 0.42;
        for (let s = 0; s < 4; s++) {
          const yaw = s * Math.PI / 2;
          const off = ((s % 2) === 0 ? size[2] : size[0]) / 2;
          const g = chevronGeo(w, len, 0.03);
          g.rotateX(Math.PI / 2);
          g.translate(0, (i - (n - 1) / 2) * (len * 1.2), off + 0.02);
          g.rotateY(yaw);
          rank.push(g);
        }
      }
      const mm = dirMat.clone(); ownMats.push(mm);
      chevGroup.add(partMesh(rank, mm, D, false, false));
      chevrons.push(mm);
    }
    shell.add(chevGroup);
  }

  let armGroup = null;
  let shaftGroup = null;
  let shaftMesh = null;
  const shaftRings = [];
  const pistonAxis = axis.clone();
  let counterweight = null;
  const railGlow = [];

  function buildRailRig() {
    _c.subVectors(toV, origin);
    const L = _c.length();
    if (L < 0.2) return;
    _d.copy(_c).multiplyScalar(1 / L);
    _e.crossVectors(_d, _UP);
    if (_e.lengthSq() < 1e-6) _e.copy(_Z);
    _e.normalize();
    const half = size[0] * 0.5;
    const offY = -size[1] * 0.5 - 0.20;
    const structural = [], glowStrips = [];

    _q.setFromUnitVectors(_X, _d);
    for (let s = -1; s <= 1; s += 2) {
      const rail = chamferBox(L + 1.1, 0.16, 0.16, 0.035);
      _a.copy(_c).multiplyScalar(0.5).addScaledVector(_e, s * (half * 0.62 + 0.18)).setY(_c.y * 0.5 + offY);
      _mat4.compose(_a, _q, _scale1);
      rail.applyMatrix4(_mat4);
      structural.push(rail);

      const strip = chamferBox(L + 0.9, 0.045, 0.05, 0.012);
      _a.y += 0.10;
      _mat4.compose(_a, _q, _scale1);
      strip.applyMatrix4(_mat4);
      glowStrips.push(strip);
    }
    for (let e2 = 0; e2 <= 1; e2++) {
      const at = _a.set(0, 0, 0).lerp(_c, e2);
      const bx = chamferBox(0.55, 0.9, size[2] * 0.72 + 0.4, 0.06);
      bx.translate(at.x + _d.x * (e2 ? 0.42 : -0.42), at.y + offY - 0.18, at.z + _d.z * (e2 ? 0.42 : -0.42));
      structural.push(bx);
      const py = new THREE.CylinderGeometry(0.13, 0.19, 1.5, 8);
      py.translate(at.x + _d.x * (e2 ? 0.42 : -0.42), at.y + offY - 1.2, at.z + _d.z * (e2 ? 0.42 : -0.42));
      structural.push(py);
      const fl = new THREE.CylinderGeometry(0.34, 0.40, 0.13, 10);
      fl.translate(at.x + _d.x * (e2 ? 0.42 : -0.42), at.y + offY - 1.94, at.z + _d.z * (e2 ? 0.42 : -0.42));
      structural.push(fl);
    }
    root.add(partMesh(structural, matMetal, D));
    const gm = partMesh(glowStrips, trimMat, D, false, false);
    root.add(gm);
    railGlow.push(gm);

    const car = [];
    const body = chamferBox(size[0] * 0.5, 0.30, size[2] * 0.5, 0.05);
    body.translate(0, -size[1] * 0.5 - 0.18, 0);
    car.push(body);
    for (let s = -1; s <= 1; s += 2) {
      const collar = ringGeo(0.19, 0.05, 5, 10);
      _q2.setFromUnitVectors(_Z, _d);
      collar.applyQuaternion(_q2);
      collar.translate(_e.x * s * (half * 0.62 + 0.18), -size[1] * 0.5 - 0.20, _e.z * s * (half * 0.62 + 0.18));
      car.push(collar);
    }
    shell.add(partMesh(car, matPanel, D, true, false));
  }

  function buildHubRig() {
    const structural = [], glows = [];
    const colH = 2.4;
    const col1 = new THREE.CylinderGeometry(0.34, 0.46, colH, 12);
    col1.translate(0, -colH * 0.5 - 0.1, 0);
    structural.push(col1);
    const base = new THREE.CylinderGeometry(0.76, 0.92, 0.26, 14);
    base.translate(0, -colH - 0.1, 0);
    structural.push(base);
    for (let i = 0; i < 3; i++) {
      const r = ringGeo(0.40 + i * 0.015, 0.055, 5, 14);
      r.rotateX(Math.PI / 2);
      r.translate(0, -0.35 - i * 0.62, 0);
      structural.push(r);
    }
    const cap = new THREE.CylinderGeometry(0.30, 0.38, 0.34, 12);
    cap.translate(0, 0.14, 0);
    structural.push(cap);
    for (const g of boltRing(6, 0.62, 0.045, 0.10)) { g.rotateX(Math.PI / 2); g.translate(0, -colH - 0.02, 0); structural.push(g); }
    _q.setFromUnitVectors(_UP, axis);
    const hubGeoms = structural.map((g) => { g.applyQuaternion(_q); return g; });
    root.add(partMesh(hubGeoms, matMetal, D));

    const band = ringGeo(0.365, 0.032, 5, 18);
    band.rotateX(Math.PI / 2);
    band.translate(0, -0.02, 0);
    band.applyQuaternion(_q);
    glows.push(band);
    root.add(partMesh(glows, trimMat, D, false, false));

    armGroup = new THREE.Group();
    root.add(armGroup);
    const spokes = [];
    const spokeLen = Math.max(0.2, radius - size[0] * 0.30);
    const sp = chamferBox(spokeLen, 0.22, 0.34, 0.045);
    sp.translate(spokeLen * 0.5 + 0.30, 0, 0);
    spokes.push(sp);
    const strut = chamferBox(spokeLen * 0.92, 0.10, 0.14, 0.03);
    strut.rotateZ(-0.16);
    strut.translate(spokeLen * 0.5 + 0.30, -0.26, 0);
    spokes.push(strut);
    const knuckle = new THREE.CylinderGeometry(0.22, 0.22, 0.44, 10);
    knuckle.rotateZ(Math.PI / 2);
    knuckle.translate(0.32, 0, 0);
    spokes.push(knuckle);
    _e.crossVectors(bu, axis).normalize();
    _mat4.makeBasis(bu, axis, _e);
    for (const g of spokes) g.applyMatrix4(_mat4);
    armGroup.add(partMesh(spokes, matPanel, D));

    const sglow = [];
    const line = chamferBox(spokeLen * 0.86, 0.04, 0.05, 0.012);
    line.translate(spokeLen * 0.5 + 0.30, 0.13, 0);
    line.applyMatrix4(_mat4);
    sglow.push(line);
    const gm2 = partMesh(sglow, trimMat, D, false, false);
    armGroup.add(gm2);
    railGlow.push(gm2);
  }

  function buildPistonRig() {
    if (hasTo) { _c.subVectors(toV, origin); if (_c.lengthSq() > 1e-8) pistonAxis.copy(_c).normalize(); }
    _q.setFromUnitVectors(_UP, pistonAxis);
    const structural = [];
    const housing = new THREE.CylinderGeometry(0.44, 0.52, 0.9, 12);
    structural.push(housing);
    for (let i = 0; i < 2; i++) {
      const r = ringGeo(0.50, 0.06, 5, 14);
      r.rotateX(Math.PI / 2);
      r.translate(0, -0.26 + i * 0.52, 0);
      structural.push(r);
    }
    const flange = new THREE.CylinderGeometry(0.70, 0.78, 0.16, 14);
    flange.translate(0, -0.52, 0);
    structural.push(flange);
    for (const g of boltRing(8, 0.60, 0.04, 0.10)) { g.rotateX(Math.PI / 2); g.translate(0, -0.52, 0); structural.push(g); }
    for (const g of structural) g.applyQuaternion(_q);
    root.add(partMesh(structural, matMetal, D));

    shaftGroup = new THREE.Group();
    root.add(shaftGroup);
    const sh = new THREE.CylinderGeometry(0.20, 0.20, 1, 10);
    sh.translate(0, 0.5, 0);
    D.push(sh);
    shaftMesh = new THREE.Mesh(sh, matGrate);
    shaftMesh.castShadow = true;
    shaftGroup.add(shaftMesh);
    for (let i = 0; i < 3; i++) {
      const rg = ringGeo(0.235, 0.045, 5, 12);
      rg.rotateX(Math.PI / 2);
      D.push(rg);
      const rm = new THREE.Mesh(rg, matMetal);
      rm.castShadow = false;
      shaftRings.push(rm);
      shaftGroup.add(rm);
    }
  }

  function buildElevatorRig() {
    const structural = [], glows = [];
    _q.setFromUnitVectors(_UP, elevDir);
    const H = elevDist + 1.6;
    for (let s = -1; s <= 1; s += 2) {
      const x = s * (size[0] * 0.5 + 0.34);
      const colm = chamferBox(0.30, H, 0.30, 0.05);
      colm.translate(x, H * 0.5 - 0.8, 0);
      structural.push(colm);
      for (let i = 0; i < Math.max(2, Math.floor(H / 1.1)); i++) {
        const rung = chamferBox(0.36, 0.07, 0.13, 0.02);
        rung.translate(x, -0.6 + i * 1.1, 0.20);
        structural.push(rung);
      }
      const foot = chamferBox(0.72, 0.20, 0.72, 0.05);
      foot.translate(x, -0.86, 0);
      structural.push(foot);
      const strip = chamferBox(0.05, H - 0.6, 0.05, 0.012);
      strip.translate(x + 0.17, H * 0.5 - 0.8, 0);
      glows.push(strip);
    }
    const gantry = chamferBox(size[0] + 1.1, 0.26, 0.46, 0.05);
    gantry.translate(0, H - 0.8, 0);
    structural.push(gantry);
    const pulleyA = ringGeo(0.24, 0.07, 6, 14);
    pulleyA.translate(-size[0] * 0.5 - 0.34, H - 1.05, 0);
    structural.push(pulleyA);
    const pulleyB = ringGeo(0.24, 0.07, 6, 14);
    pulleyB.translate(size[0] * 0.5 + 0.34, H - 1.05, 0);
    structural.push(pulleyB);

    for (const g of structural) g.applyQuaternion(_q);
    for (const g of glows) g.applyQuaternion(_q);
    root.add(partMesh(structural, matMetal, D));
    const gm = partMesh(glows, trimMat, D, false, false);
    root.add(gm);
    railGlow.push(gm);

    counterweight = new THREE.Group();
    counterweight.quaternion.copy(_q);
    root.add(counterweight);
    const cw = [];
    const blk = chamferBox(0.42, 0.90, 0.42, 0.05);
    blk.translate(-size[0] * 0.5 - 0.34, 0, 0);
    cw.push(blk);
    for (let i = 0; i < 3; i++) {
      const b2 = chamferBox(0.48, 0.07, 0.48, 0.02);
      b2.translate(-size[0] * 0.5 - 0.34, -0.30 + i * 0.30, 0);
      cw.push(b2);
    }
    counterweight.add(partMesh(cw, matPanel, D));
  }

  let sinkStuds = null, sinkStudMat = null;
  function buildSinkRig() {
    const studs = [];
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      const g = new THREE.CylinderGeometry(0.09, 0.11, 0.10, 8);
      g.translate(sx * (size[0] * 0.5 - 0.20), size[1] * 0.5 + 0.03, sz * (size[2] * 0.5 - 0.20));
      studs.push(g);
    }
    const mm = glowMat(ctx, cSafe, 1.6, ownMats, { base: 0x0a0d12 });
    const mesh = partMesh(studs, mm, D, false, false);
    shell.add(mesh);
    sinkStuds = mesh;
    sinkStudMat = mm;
  }

  switch (type) {
    case 'linear': buildRailRig(); buildNacelles(); break;
    case 'circle':
    case 'orbit': buildHubRig(); buildNacelles(); break;
    case 'oscillate': buildPistonRig(); buildNacelles(); break;
    case 'elevator': buildElevatorRig(); break;
    case 'sink': buildNacelles(); buildSinkRig(); break;
    default: buildNacelles(); break;
  }
  buildChevrons();

  if (def.kill) {
    const kv = new KillVolume({
      type: 'box',
      center: origin.clone(),
      half: new THREE.Vector3(size[0] / 2 + 0.05, size[1] / 2 + 0.05, size[2] / 2 + 0.05),
      quat: new THREE.Quaternion(),
      kind: typeof def.kill === 'string' ? def.kill : 'spike',
      ref: hz,
    });
    kv.active = true;
    hz.kills.push(kv);
  }

  // -------------------------------------------------------------------------
  // trigger handling (sink / elevator)
  // -------------------------------------------------------------------------
  const curPos = origin.clone();
  const curQuat = new THREE.Quaternion();
  let bpFailed = false;
  let lastSpeed = 0;

  function tryTrigger(t) {
    if (!stateful || trigT !== null) return;
    trigT = t;
    hazSfx(ctx, type === 'elevator' ? 'ui_ok' : 'vanish', { pos: curPos, gain: 0.55 });
  }
  /** CONTRACT §21: Course calls onStand(player, collider) on the stand transition. */
  hz.onStand = function () { tryTrigger(hz.time); };
  hz.onPound = function () { tryTrigger(hz.time); };
  hz.onTouch = function () {};
  hz.trigger = function (t) { tryTrigger(num(t, hz.time)); };

  function selfDetectStand(t, player) {
    if (!stateful || trigT !== null) return;
    if (standingOn(resolvePlayer(ctx, player), hz.colliders)) tryTrigger(t);
  }

  function tickTrigger(t, player) {
    if (!stateful) return;
    if (trigT !== null) {
      const el = t - trigT;
      const span = (type === 'sink') ? (sinkDelay + sinkFall + respawnAfter) : elevTotal;
      if (el >= span || el < 0) trigT = null;
    }
    selfDetectStand(t, player);
  }

  // -------------------------------------------------------------------------
  // update / reset / dispose
  // -------------------------------------------------------------------------
  function refreshBroad(c) {
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.refresh !== 'function') return;
    try { ctx.broadphase.refresh(c); } catch (err) { bpFailed = true; }
  }

  function colliderActive(t) {
    if (type !== 'sink' || trigT === null) return true;
    const el = t - trigT;
    if (el <= sinkDelay + sinkFall) return true;
    const g = el - sinkDelay - sinkFall;
    const hold = respawnAfter - SINK_RISE;
    return g >= hold + SINK_RISE * 0.80;
  }

  function animate(t) {
    const speed = lastSpeed;
    const flow = t * (1.1 + Math.min(2.6, speed * 0.34));
    const fwd = (type === 'circle' || type === 'orbit') ? 1 : (dirOfTravel() >= 0 ? 1 : -1);
    for (let i = 0; i < chevrons.length; i++) {
      const k = fract(flow + (fwd > 0 ? -i : i) * 0.30);
      const pulse = 0.32 + 2.9 * Math.pow(Math.max(0, 1 - Math.abs(k - 0.25) * 3.1), 2);
      chevrons[i].emissiveIntensity = pulse * (0.45 + Math.min(1.0, speed * 0.22));
    }
    if (chevGroup && !vertical) {
      _c.copy(hz.linVel);
      if (type === 'circle' || type === 'orbit') {
        _c.crossVectors(axis, _d.subVectors(curPos, origin)).multiplyScalar(dirSign);
      }
      _c.y = 0;
      if (_c.lengthSq() > 0.02) {
        if (type === 'circle') { _q2.copy(curQuat).invert(); _c.applyQuaternion(_q2); }
        chevGroup.rotation.y = Math.atan2(_c.x, _c.z);
      }
    }

    if (nacelles.length) {
      const it = 1.1 + Math.min(4.2, speed * 0.55) + Math.sin(t * 9.3) * 0.16;
      thrustMat.emissiveIntensity = it;
    }
    trimMat.emissiveIntensity = 1.9 + Math.sin(t * 2.1) * 0.28;

    if (shaftGroup && shaftMesh) {
      _c.subVectors(curPos, origin);
      const len = _c.length();
      if (len > 1e-4) {
        _d.copy(_c).multiplyScalar(1 / len);
        shaftGroup.quaternion.setFromUnitVectors(_UP, _d);
      }
      const L = Math.max(0.05, len);
      shaftMesh.scale.y = L;
      for (let i = 0; i < shaftRings.length; i++) {
        shaftRings[i].position.y = L * (0.22 + i * 0.28);
      }
    }

    if (counterweight) {
      _c.subVectors(curPos, origin);
      counterweight.position.copy(elevDir).multiplyScalar(-_c.dot(elevDir)).addScaledVector(elevDir, elevDist * 0.5 + 0.5);
    }

    if (type === 'sink') {
      if (trigT !== null) {
        const el = t - trigT;
        if (el < sinkDelay) {
          const k = clamp01(el / Math.max(0.001, sinkDelay));
          shell.position.set(
            Math.sin(el * 47.3) * 0.024 * k,
            Math.sin(el * 38.1) * 0.036 * k + Math.sin(el * 61.7) * 0.017 * k,
            Math.cos(el * 41.9) * 0.024 * k
          );
          if (sinkStudMat) {
            sinkStudMat.emissiveIntensity = 1.4 + 5.0 * k * (0.5 + 0.5 * Math.sin(el * (9 + 34 * k)));
            sinkStudMat.emissive.copy(cSafe).lerp(cWarn, k);
          }
        } else {
          shell.position.set(0, 0, 0);
          if (sinkStudMat) { sinkStudMat.emissiveIntensity = 5.4; sinkStudMat.emissive.copy(cWarn); }
        }
      } else {
        shell.position.set(0, 0, 0);
        if (sinkStudMat) { sinkStudMat.emissiveIntensity = 1.5 + Math.sin(t * 2.6) * 0.35; sinkStudMat.emissive.copy(cSafe); }
      }
    }
  }

  function dirOfTravel() {
    if (type === 'linear' || type === 'oscillate') {
      _c.subVectors(toV, origin);
      return hz.linVel.dot(_c) >= 0 ? 1 : -1;
    }
    if (type === 'elevator' || type === 'sink') return hz.linVel.y >= 0 ? 1 : -1;
    return 1;
  }

  hz.update = function (t, dt, player) {
    dt = num(dt, 0);
    hz.time = t;
    tickTrigger(t, player);

    samplePos(t, curPos);
    sampleQuat(t, curQuat);
    carrier.position.copy(curPos).sub(origin);
    carrier.quaternion.copy(curQuat);
    if (armGroup) armGroup.setRotationFromAxisAngle(axis, TAU * (t / period + phase) * dirSign);

    if (type === 'circle') {
      hz.linVel.set(0, 0, 0);
      hz.angVel = (TAU / period) * dirSign;
      hz.angAxis.copy(axis);
      hz.angCenter.copy(origin);
    } else {
      // The MEAN velocity over the frame that just elapsed, not the derivative at t:
      // collide.js carries a rider by linVel * (the substeps it runs this frame), and the
      // deck has ALREADY moved by exactly pos(t) - pos(t - dt). dt = 0 (reset / first
      // placement) has no elapsed frame, so it keeps the central-difference derivative.
      if (dt > 1e-6) {
        samplePos(t - dt, _a);
        hz.linVel.subVectors(curPos, _a).multiplyScalar(1 / dt);
      } else {
        samplePos(t - FD_H, _a);
        samplePos(t + FD_H, _b);
        hz.linVel.subVectors(_b, _a).multiplyScalar(1 / (2 * FD_H));
      }
      clampLen(hz.linVel, 48);
      hz.angVel = 0;
      hz.angAxis.copy(axis);
      hz.angCenter.copy(curPos);
    }
    lastSpeed = (type === 'circle') ? (TAU / period) * radius : hz.linVel.length();

    const act = colliderActive(t);
    for (let i = 0; i < hz.colliders.length; i++) {
      const c = hz.colliders[i];
      placeCollider(c, curPos, curQuat);
      c.active = act;
      refreshBroad(c);
    }
    for (let i = 0; i < hz.kills.length; i++) {
      const k = hz.kills[i];
      if (k.center && k.center.copy) k.center.copy(curPos);
      if (k.quat && k.quat.copy) k.quat.copy(curQuat);
      k.active = act;
      if (typeof k.update === 'function') k.update();
    }

    animate(t);
  };

  hz.reset = function (t) {
    trigT = null;
    shell.position.set(0, 0, 0);
    hz.update(num(t, 0), 0, null);
  };

  hz.velocityAtPoint = function (p, out) {
    out.copy(hz.linVel);
    if (hz.angVel !== 0) {
      _a.subVectors(p, hz.angCenter);
      _b.crossVectors(hz.angAxis, _a).multiplyScalar(hz.angVel);
      out.add(_b);
    }
    return out;
  };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    root.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.geometry = null; o.material = null; } });
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0;
    if (plat && typeof plat.dispose === 'function') { try { plat.dispose(); } catch (err) { /* ignore */ } }
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  hz.update(0, 0, null);
  return hz;
}

export default mover;
