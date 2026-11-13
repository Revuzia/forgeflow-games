// =============================================================================
//  ASCENDANT — runtime/hazards/crushers.js
//  Hydraulic pistons: single / pair / wall.
//
//  DETERMINISM LAW (CONTRACT §16): the extension u(t) in [0,1] is a closed-form
//  piecewise curve over the cycle — dwell, accelerating slam, dwell, slow
//  retract. Position, warning lights and the kill face all derive from u(t).
//  Nothing integrates; reset(t) is update(t, 0).
//
//  READABILITY LAW: a crusher is LETHAL ONLY on its crushing face, and only
//  while that face is actually driving forward. A parked crusher — extended or
//  retracted — is a safe platform you can stand on. That is the whole reason
//  crusher timing is learnable instead of a coin flip.
//
//  The lethal face is SWEPT: its thickness this frame is 0.16 + |v| * dt, grown
//  backwards from the exact front plane, so a 30 m/s slam can never step over a
//  player between two frames while never reaching ahead of the real face.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider, KillVolume } from '../world/collider.js';

// ---------------------------------------------------------------------------
// module-scope scratch
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const FD_H = 1 / 480;
const SWEEP_STEP = 1 / 30;      // nominal frame used for the anti-tunnel sweep

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);

let _lastCrushSfx = -1e9;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function fract(v) { return v - Math.floor(v); }
function easeInQuint(x) { return x * x * x * x * x; }
function easeInOutSine(x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); }

/** Accepts [x,y,z], {x,y,z}, 'x'|'y'|'z' and '-x'|'-y'|'-z'. */
function readVec(src, out, dx, dy, dz) {
  if (Array.isArray(src) && src.length >= 3) out.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  else if (src && typeof src === 'object' && 'x' in src) out.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  else if (typeof src === 'string') {
    const s = src.toLowerCase().trim();
    const sign = s.charAt(0) === '-' ? -1 : 1;
    const k = s.replace('-', '').replace('+', '');
    out.set(k === 'x' ? sign : 0, k === 'y' ? sign : 0, k === 'z' ? sign : 0);
    if (out.lengthSq() < 1e-8) out.set(dx, dy, dz);
  } else out.set(dx, dy, dz);
  return out;
}

// ---------------------------------------------------------------------------
// geometry kit
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

function chamferBox(w, h, d, bev = 0.05, seg = 1) {
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

function ringGeo(r, tube, rseg = 6, tseg = 16) { return new THREE.TorusGeometry(r, tube, rseg, tseg); }

function boltRow(count, span, br, bh, y, z) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : (-span / 2 + (i / (count - 1)) * span);
    const g = new THREE.CylinderGeometry(br, br * 1.15, bh, 6);
    g.translate(x, y, z);
    out.push(g);
  }
  return out;
}

function mergeAll(list) {
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

function partMesh(list, material, D, castShadow = true, receiveShadow = false) {
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
// materials
// ---------------------------------------------------------------------------
const _fallbackMats = new Map();
function fallbackMat(key) {
  let m = _fallbackMats.get(key);
  if (m) return m;
  const spec = {
    metal: { color: 0x8f9daf, roughness: 0.33, metalness: 0.93 },
    panel: { color: 0x59636f, roughness: 0.54, metalness: 0.58 },
    grate: { color: 0x47505d, roughness: 0.46, metalness: 0.80 },
    hazard: { color: 0xd8a022, roughness: 0.62, metalness: 0.30 },
    obsidian: { color: 0x1b1e24, roughness: 0.30, metalness: 0.52 },
    rubber: { color: 0x22252b, roughness: 0.95, metalness: 0.02 },
  }[key] || { color: 0x9aa4b2, roughness: 0.5, metalness: 0.45 };
  m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness, envMapIntensity: 0.9 });
  _fallbackMats.set(key, m);
  return m;
}
function getMat(ctx, key) {
  try {
    if (ctx && ctx.mats && typeof ctx.mats.get === 'function') {
      const m = ctx.mats.get(key, ctx.theme ? ctx.theme.id : undefined);
      if (m) return m;
    }
  } catch (err) { /* fall through */ }
  return fallbackMat(key);
}
function getTex(ctx, name) {
  try {
    if (ctx && ctx.mats && typeof ctx.mats.tex === 'function') { const t = ctx.mats.tex(name); if (t) return t; }
  } catch (err) { /* ignore */ }
  return null;
}
function pal(ctx, key, dflt) {
  const p = ctx && ctx.theme && ctx.theme.palette;
  const v = p ? p[key] : undefined;
  return (v === undefined || v === null) ? dflt : v;
}
function glowMat(ctx, color, intensity, M, opts) {
  const o = opts || {};
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.base !== undefined ? o.base : 0x0b0e14),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: num(o.roughness, 0.34),
    metalness: num(o.metalness, 0.20),
  });
  const rt = getTex(ctx, 'grunge') || getTex(ctx, 'noise');
  if (rt) { m.roughnessMap = rt; m.emissiveMap = rt; }
  M.push(m);
  return m;
}

// ---------------------------------------------------------------------------
// audio / fx bridges
// ---------------------------------------------------------------------------
function playSfx(ctx, name, opts) {
  try { if (ctx && ctx.audio && typeof ctx.audio.sfx === 'function') ctx.audio.sfx(name, opts); } catch (err) { /* ignore */ }
}
function burstFX(ctx, preset, pos, opts) {
  try {
    const fx = ctx && ctx.fx;
    if (!fx) return;
    if (typeof fx.burst === 'function') { fx.burst(preset, pos, opts); return; }
    if (fx.particles && typeof fx.particles.burst === 'function') { fx.particles.burst(preset, pos, opts); return; }
    if (fx.ps && typeof fx.ps.burst === 'function') fx.ps.burst(preset, pos, opts);
  } catch (err) { /* ignore */ }
}
function shakeCam(ctx, amount, ms) {
  try {
    const fx = ctx && ctx.fx;
    if (fx) {
      if (typeof fx.shake === 'function') { fx.shake(amount, ms); return; }
      if (fx.camera && typeof fx.camera.shake === 'function') { fx.camera.shake(amount, ms); return; }
      if (fx.cam && typeof fx.cam.shake === 'function') { fx.cam.shake(amount, ms); return; }
    }
    if (ctx.camera && typeof ctx.camera.shake === 'function') { ctx.camera.shake(amount, ms); return; }
    if (typeof ctx.shake === 'function') ctx.shake(amount, ms);
  } catch (err) { /* ignore */ }
}
/** Feet of the live player (slam SFX distance only). Also reads the STAGE's registered
 *  player — `ctx.stage._playerRef` from stage.setPlayer() — which is the only player handle
 *  the shipped stage ctx carries; the old lookup never resolved in the live game. */
function resolvePlayerPos(ctx, out) {
  if (!ctx) return false;
  let p = ctx.player || (typeof ctx.getPlayer === 'function' ? ctx.getPlayer() : null) || (ctx.world ? ctx.world.player : null);
  if (!(p && p.pos) && ctx.stage) {
    const st = ctx.stage;
    p = (st._playerRef && st._playerRef.pos) ? st._playerRef
      : (st.player && st.player.pos) ? st.player
        : (st.ctx && st.ctx.player && st.ctx.player.pos) ? st.ctx.player : null;
  }
  if (p && p.pos && typeof p.pos.x === 'number') { out.set(p.pos.x, p.pos.y, p.pos.z); return true; }
  if (ctx.playerPos && typeof ctx.playerPos.x === 'number') { out.copy(ctx.playerPos); return true; }
  return false;
}

function makeBoxKV(kind, ref, hx, hy, hz2) {
  const kv = new KillVolume({
    type: 'box', center: new THREE.Vector3(),
    half: new THREE.Vector3(hx, hy, hz2), quat: new THREE.Quaternion(), kind, ref,
  });
  kv.active = false;
  return kv;
}

// =============================================================================
//  crusher(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'crusher', p, s, axis?, travel, period, phase?, dwell?,
 *                      mode?:'single'|'pair'|'wall', gap?, mat?}
 *   `p` is the head's RETRACTED centre. `axis` is the CRUSH DIRECTION (default
 *   [0,-1,0] — it slams downward). `phase` is a FRACTION OF THE CYCLE (0..1).
 *   `gap` (pair mode) is the face-to-face clearance at full closure.
 * @param {object} ctx {mats, theme, fx, audio, builders, broadphase, rng}
 */
export function crusher(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const mode = String(def.mode || 'single').toLowerCase();
  const period = Math.max(0.4, num(def.period, 3.2));
  const phase = num(def.phase, 0);
  const travel = Math.max(0.2, num(def.travel, 4));
  const dwellFrac = clamp(num(def.dwell, 0.55) / period, 0, 0.40);
  const rest = Math.max(0.06, 1 - 2 * dwellFrac);
  const slamShare = (mode === 'wall') ? 0.70 : 0.20;
  const slamFrac = rest * slamShare;
  const retFrac = rest * (1 - slamShare);

  const size = Array.isArray(def.s) && def.s.length >= 3
    ? [Math.abs(num(def.s[0], 3)), Math.abs(num(def.s[1], 1.2)), Math.abs(num(def.s[2], 3))]
    : [3, 1.2, 3];

  const origin = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const axisDir = readVec(def.axis === undefined ? [0, -1, 0] : def.axis, new THREE.Vector3(), 0, -1, 0);
  if (axisDir.lengthSq() < 1e-8) axisDir.set(0, -1, 0);
  axisDir.normalize();

  function extentAlong(v) { return Math.abs(size[0] * v.x) + Math.abs(size[1] * v.y) + Math.abs(size[2] * v.z); }

  // orthonormal head frame: X = perpA, Y = crush direction, Z = perpA x dir
  const perpA = new THREE.Vector3(), perpB = new THREE.Vector3();
  {
    const ref = Math.abs(axisDir.y) > 0.92 ? _X : _UP;
    perpA.crossVectors(ref, axisDir);
    if (perpA.lengthSq() < 1e-8) perpA.set(1, 0, 0);
    perpA.normalize();
    perpB.crossVectors(perpA, axisDir).normalize();
  }
  const sAlong = Math.max(0.12, extentAlong(axisDir));
  const eA = Math.max(0.20, extentAlong(perpA));
  const eB = Math.max(0.20, extentAlong(perpB));
  const faceMin = Math.min(eA, eB);

  const gap = Math.max(0.35, num(def.gap, 1.5));

  // --------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'crusher:' + mode;
  root.position.copy(origin);

  const hz = {
    kind: 'crusher', type: mode, def,
    mesh: root, colliders: [], kills: [],
    linVel: new THREE.Vector3(),
    angVel: 0,
    angAxis: axisDir.clone(),
    angCenter: origin.clone(),
    __mats: ownMats,
  };

  const cAccent = new THREE.Color(pal(ctx, 'accent', 0x6fe9ff));
  const cKill = new THREE.Color(pal(ctx, 'kill', 0xff4a24));
  const cSafe = new THREE.Color(pal(ctx, 'safeEdge', pal(ctx, 'safe', 0x9fe8ff)));
  const cIdle = new THREE.Color(pal(ctx, 'deco', 0xffb347));

  const matMetal = getMat(ctx, def.mat || 'metal');
  const matPanel = getMat(ctx, 'panel');
  const matGrate = getMat(ctx, 'grate');
  const matHazard = getMat(ctx, 'hazard');
  const matDark = getMat(ctx, 'obsidian');
  const matRubber = getMat(ctx, 'rubber');

  // =========================================================================
  //  motion profile — pure in t
  // =========================================================================
  function profile(t) {
    const s = fract(t / period + phase);
    if (s < dwellFrac) return 0;
    let k = s - dwellFrac;
    if (k < slamFrac) return easeInQuint(clamp01(k / slamFrac));
    k -= slamFrac;
    if (k < dwellFrac) return 1;
    k -= dwellFrac;
    return 1 - easeInOutSine(clamp01(k / retFrac));
  }

  /** 0..1 "about to slam" telegraph: ramps through the retracted dwell. */
  function warnLevel(t) {
    const s = fract(t / period + phase);
    if (s < dwellFrac) {
      if (dwellFrac < 1e-4) return 1;
      return clamp01((s / dwellFrac - 0.42) / 0.58);
    }
    if (s < dwellFrac + slamFrac) return 1;
    return 0;
  }

  // =========================================================================
  //  one piston assembly
  // =========================================================================
  function makeHead(sign, basePos) {
    const dir = _c.copy(axisDir).multiplyScalar(sign).clone();
    const pA = perpA.clone();
    const pB = _d.crossVectors(pA, dir).normalize().clone();
    _mat4.makeBasis(pA, dir, pB);
    const frameQ = new THREE.Quaternion().setFromRotationMatrix(_mat4);
    const frameM = _mat4.clone();

    const localBase = basePos.clone().sub(origin);      // group-local retracted centre

    const unit = {
      sign, dir, frameQ, basePos: basePos.clone(), localBase,
      group: new THREE.Group(),                          // moving head
      collider: null, kill: null,
      warnMat: null, faceMat: null, safeMat: null,
      shaftGroup: null, shaftMesh: null, collarMesh: null, rodMesh: null,
      housingFace: 0,
    };
    root.add(unit.group);

    // ---- HEAD -------------------------------------------------------------
    const bev = Math.min(0.16, Math.min(sAlong, faceMin) * 0.16);
    const structural = [], dark = [], hazardParts = [], glows = [];

    const body = chamferBox(eA, sAlong, eB, bev);
    structural.push(body);

    // rim around the striking face
    const rimY = sAlong * 0.5 - 0.055;
    for (let s2 = -1; s2 <= 1; s2 += 2) {
      const rx = chamferBox(eA * 1.004, 0.13, 0.12, 0.03);
      rx.translate(0, rimY, s2 * (eB * 0.5 - 0.05));
      structural.push(rx);
      const rz = chamferBox(0.12, 0.13, eB * 1.004, 0.03);
      rz.translate(s2 * (eA * 0.5 - 0.05), rimY, 0);
      structural.push(rz);
    }
    // tread plate on the striking face
    const tread = chamferBox(eA * 0.86, 0.09, eB * 0.86, 0.02);
    tread.translate(0, sAlong * 0.5 + 0.012, 0);
    dark.push(tread);
    // impact ribs
    const nb = Math.max(3, Math.min(7, Math.round(eA / 0.55)));
    for (let i = 0; i < nb; i++) {
      const x = (i / (nb - 1) - 0.5) * eA * 0.80;
      const rib = chamferBox(eA * 0.055, 0.075, eB * 0.86, 0.014);
      rib.translate(x, sAlong * 0.5 + 0.055, 0);
      hazardParts.push(rib);
    }
    // hazard collar band — the "this end kills" read, visible from every side
    for (let s2 = -1; s2 <= 1; s2 += 2) {
      const bx = chamferBox(eA * 0.99, 0.10, 0.055, 0.016);
      bx.translate(0, sAlong * 0.5 - 0.24, s2 * (eB * 0.5 + 0.012));
      glows.push(bx);
      const bz = chamferBox(0.055, 0.10, eB * 0.99, 0.016);
      bz.translate(s2 * (eA * 0.5 + 0.012), sAlong * 0.5 - 0.24, 0);
      glows.push(bz);
    }
    // Landable-face stripe. A parked crusher is a safe platform, so whichever of
    // its six faces currently points most upward gets the standard safe-edge
    // highlight. Computed from the real frame, so it is right for wall crushers
    // and side-slamming pistons too, not just the down-slamming default.
    const safeEdge = [];
    {
      const halfOf = [eA * 0.5, sAlong * 0.5, eB * 0.5];
      let bestAxis = 1, bestSign = -1, bestY = -2;
      for (let ax = 0; ax < 3; ax++) {
        for (let sg = -1; sg <= 1; sg += 2) {
          _a.set(ax === 0 ? sg : 0, ax === 1 ? sg : 0, ax === 2 ? sg : 0).applyMatrix4(frameM);
          if (_a.y > bestY) { bestY = _a.y; bestAxis = ax; bestSign = sg; }
        }
      }
      if (bestY > 0.3) {
        const hu = halfOf[bestAxis];
        const strips = [];
        const wA = bestAxis === 0 ? sAlong : eA;
        const wB = bestAxis === 2 ? sAlong : eB;
        for (let s3 = -1; s3 <= 1; s3 += 2) {
          const sx = chamferBox(wA * 0.99, 0.05, 0.10, 0.018);
          sx.translate(0, hu + 0.008, s3 * (wB * 0.5 - 0.05));
          strips.push(sx);
          const sz = chamferBox(0.10, 0.05, wB * 0.99, 0.018);
          sz.translate(s3 * (wA * 0.5 - 0.05), hu + 0.008, 0);
          strips.push(sz);
        }
        _b.set(bestAxis === 0 ? bestSign : 0, bestAxis === 1 ? bestSign : 0, bestAxis === 2 ? bestSign : 0);
        _q.setFromUnitVectors(_UP, _b);
        for (const g of strips) { g.applyQuaternion(_q); safeEdge.push(g); }
      }
    }

    // back-face bolts + guide collars
    for (const g of boltRow(4, eA * 0.72, 0.055, 0.14, -sAlong * 0.5 - 0.02, 0)) structural.push(g);
    const gcR = Math.min(0.20, faceMin * 0.10);
    for (let i = 0; i < 4; i++) {
      const cx = ((i & 1) ? 1 : -1) * (eA * 0.5 - gcR * 1.6);
      const cz = ((i & 2) ? 1 : -1) * (eB * 0.5 - gcR * 1.6);
      const collar = ringGeo(gcR * 1.35, gcR * 0.42, 5, 12);
      collar.rotateX(Math.PI / 2);
      collar.translate(cx, -sAlong * 0.5 + 0.05, cz);
      structural.push(collar);
    }

    for (const g of structural) g.applyMatrix4(frameM);
    for (const g of dark) g.applyMatrix4(frameM);
    for (const g of hazardParts) g.applyMatrix4(frameM);
    for (const g of glows) g.applyMatrix4(frameM);
    for (const g of safeEdge) g.applyMatrix4(frameM);

    unit.warnMat = glowMat(ctx, cIdle, 0.5, ownMats, { base: 0x0a0c11 });
    unit.group.add(partMesh(structural, matMetal, D, true, true));
    unit.group.add(partMesh(dark, matRubber, D, false, false));
    unit.group.add(partMesh(hazardParts, matHazard, D, true, false));
    unit.group.add(partMesh(glows, unit.warnMat, D, false, false));
    if (safeEdge.length) {
      unit.safeMat = glowMat(ctx, cSafe, 1.45, ownMats, { base: 0x080b10 });
      unit.group.add(partMesh(safeEdge, unit.safeMat, D, false, false));
    }

    // ---- HOUSING (static, behind the retracted head) -----------------------
    const housH = Math.max(1.0, sAlong * 1.15);
    const hoStruct = [], hoDark = [], hoLights = [];
    const hy = -sAlong * 0.5 - housH * 0.5 - 0.05;
    unit.housingFace = hy + housH * 0.5;

    const hous = chamferBox(eA * 1.16, housH, eB * 1.16, 0.10);
    hous.translate(0, hy, 0);
    hoStruct.push(hous);
    const skirt = chamferBox(eA * 1.28, 0.22, eB * 1.28, 0.05);
    skirt.translate(0, hy - housH * 0.5 + 0.10, 0);
    hoStruct.push(skirt);
    const collarBig = chamferBox(eA * 0.62, 0.26, eB * 0.62, 0.05);
    collarBig.translate(0, unit.housingFace - 0.10, 0);
    hoStruct.push(collarBig);
    // cooling vents
    for (let i = 0; i < 5; i++) {
      const y = hy - housH * 0.28 + (i / 4) * housH * 0.56;
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        const v = chamferBox(eA * 0.74, 0.075, 0.06, 0.016);
        v.translate(0, y, s2 * (eB * 0.58 + 0.008));
        hoDark.push(v);
        const v2 = chamferBox(0.06, 0.075, eB * 0.74, 0.016);
        v2.translate(s2 * (eA * 0.58 + 0.008), y, 0);
        hoDark.push(v2);
      }
    }
    for (const g of boltRow(4, eA * 0.92, 0.06, 0.14, hy - housH * 0.42, eB * 0.55)) hoStruct.push(g);
    for (const g of boltRow(4, eA * 0.92, 0.06, 0.14, hy - housH * 0.42, -eB * 0.55)) hoStruct.push(g);
    // warning lamps on the four housing corners
    const lampR = Math.min(0.15, faceMin * 0.075);
    for (let i = 0; i < 4; i++) {
      const cx = ((i & 1) ? 1 : -1) * (eA * 0.56);
      const cz = ((i & 2) ? 1 : -1) * (eB * 0.56);
      const lamp = new THREE.CylinderGeometry(lampR, lampR * 1.25, lampR * 1.5, 10);
      lamp.translate(cx, unit.housingFace - 0.16, cz);
      hoLights.push(lamp);
      const hood = ringGeo(lampR * 1.32, lampR * 0.30, 5, 10);
      hood.rotateX(Math.PI / 2);
      hood.translate(cx, unit.housingFace - 0.30, cz);
      hoStruct.push(hood);
    }

    for (const g of hoStruct) g.applyMatrix4(frameM);
    for (const g of hoDark) g.applyMatrix4(frameM);
    for (const g of hoLights) g.applyMatrix4(frameM);
    const housingGrp = new THREE.Group();
    housingGrp.position.copy(localBase);
    root.add(housingGrp);
    housingGrp.add(partMesh(hoStruct, matMetal, D, true, true));
    housingGrp.add(partMesh(hoDark, matDark, D, false, false));
    unit.faceMat = glowMat(ctx, cIdle, 1.2, ownMats, { base: 0x1a1206 });
    housingGrp.add(partMesh(hoLights, unit.faceMat, D, false, false));

    // ---- PISTON SHAFT (telescoping; a cylinder scaled along its own axis is
    //      geometrically exact, so only the collars need per-frame placement) --
    unit.shaftGroup = new THREE.Group();
    unit.shaftGroup.position.copy(localBase).addScaledVector(dir, unit.housingFace);
    unit.shaftGroup.quaternion.copy(frameQ);
    root.add(unit.shaftGroup);

    const shaftR = Math.min(0.34, faceMin * 0.16);
    const sg = new THREE.CylinderGeometry(shaftR, shaftR, 1, 14);
    sg.translate(0, 0.5, 0);
    D.push(sg);
    unit.shaftMesh = new THREE.Mesh(sg, matGrate);
    unit.shaftMesh.castShadow = true;
    unit.shaftGroup.add(unit.shaftMesh);

    const cg = ringGeo(shaftR * 1.28, shaftR * 0.30, 6, 14);
    cg.rotateX(Math.PI / 2);
    D.push(cg);
    unit.collarMesh = new THREE.InstancedMesh(cg, matMetal, 4);
    unit.collarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    unit.collarMesh.castShadow = false;
    unit.collarMesh.frustumCulled = false;
    unit.shaftGroup.add(unit.collarMesh);

    const rodR = Math.min(0.11, faceMin * 0.055);
    const rods = [];
    for (let i = 0; i < 4; i++) {
      const cx = ((i & 1) ? 1 : -1) * (eA * 0.5 - gcR * 1.6);
      const cz = ((i & 2) ? 1 : -1) * (eB * 0.5 - gcR * 1.6);
      const rg = new THREE.CylinderGeometry(rodR, rodR, 1, 8);
      rg.translate(0, 0.5, 0);
      rg.translate(cx, 0, cz);
      rods.push(rg);
    }
    const rodGeo = mergeAll(rods);
    if (rodGeo) {
      D.push(rodGeo);
      unit.rodMesh = new THREE.Mesh(rodGeo, matPanel);
      unit.rodMesh.castShadow = false;
      unit.shaftGroup.add(unit.rodMesh);
    }

    // ---- physics ----------------------------------------------------------
    unit.collider = new Collider({
      center: basePos.clone(),
      half: new THREE.Vector3(eA * 0.5, sAlong * 0.5, eB * 0.5),
      quat: frameQ.clone(),
      surface: def.surface || 'normal',
      ref: hz, group: 'hazard',
    });
    hz.colliders.push(unit.collider);

    unit.kill = makeBoxKV('crush', hz, eA * 0.5, 0.16, eB * 0.5);
    hz.kills.push(unit.kill);

    // static housing collider so you cannot walk into the machine
    hz.colliders.push(new Collider({
      center: basePos.clone().addScaledVector(dir, hy),
      half: new THREE.Vector3(eA * 0.58, housH * 0.5, eB * 0.58),
      quat: frameQ.clone(),
      surface: 'normal', ref: hz, group: 'hazard',
    }));

    return unit;
  }

  const units = [];
  units.push(makeHead(1, origin));
  if (mode === 'pair') {
    _a.copy(origin).addScaledVector(axisDir, 2 * travel + sAlong + gap);
    units.push(makeHead(-1, _a));
  }
  // =========================================================================
  //  update / reset / dispose
  // =========================================================================
  let bpFailed = false;
  let lastPhaseSlam = false;
  let lastRetract = false;

  function refreshBroad(c) {
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.refresh !== 'function') return;
    try { ctx.broadphase.refresh(c); } catch (err) { bpFailed = true; }
  }

  function onSlam(t) {
    let vol = 0.85, sh = 1.0;
    if (resolvePlayerPos(ctx, _b)) {
      let best = 1e9;
      for (let i = 0; i < units.length; i++) {
        _a.copy(units[i].basePos).addScaledVector(units[i].dir, travel);
        const dd = _b.distanceTo(_a);
        if (dd < best) best = dd;
      }
      if (best > 42) return;
      const f = clamp01(1 - best / 42);
      vol = 0.35 + 0.65 * f * f;
      sh = f * f;
    }
    if (t < _lastCrushSfx) _lastCrushSfx = -1e9;
    if (t - _lastCrushSfx > 0.05) {
      _lastCrushSfx = t;
      playSfx(ctx, 'crush', { pos: units[0].basePos, vol, rate: clamp(0.72 + travel * 0.03, 0.6, 1.3) });
    }
    shakeCam(ctx, 0.55 * sh, 260);
    for (let i = 0; i < units.length; i++) {
      _a.copy(units[i].basePos).addScaledVector(units[i].dir, travel + sAlong * 0.5);
      burstFX(ctx, 'dust', _a, { count: 22, spread: Math.max(eA, eB) * 0.6, speed: 6.5, up: 0.4 });
    }
  }

  hz.update = function (t, dt) {
    dt = clamp(num(dt, 0), 0, 0.1);
    const u = profile(t);
    const uPrev = profile(t - FD_H);
    const uNext = profile(t + FD_H);
    const rate = (uNext - uPrev) / (2 * FD_H);       // du/dt
    const speed = Math.abs(rate) * travel;
    const closing = rate > 0.0015;
    const warn = warnLevel(t);

    hz.linVel.copy(axisDir).multiplyScalar(rate * travel);

    for (let i = 0; i < units.length; i++) {
      const un = units[i];
      const dist = travel * u;

      // moving head
      un.group.position.copy(un.localBase).addScaledVector(un.dir, dist);
      un.collider.center.copy(un.basePos).addScaledVector(un.dir, dist);
      if (typeof un.collider.update === 'function') un.collider.update();
      refreshBroad(un.collider);

      // Swept lethal face: front plane exact, thickness grown BACKWARDS only.
      // The margin uses a FIXED nominal step (not the live dt) so the volume
      // stays a pure function of t and reset(t) reproduces update(t) exactly;
      // it only widens on a genuine hitch (dt > SWEEP_STEP), and it is clamped
      // to the head's own thickness so it can never poke out of the safe back
      // face and kill someone riding a fast-closing crusher from behind.
      //   front plane = +sAlong/2 + 0.06 ahead of the head centre, so the slab's
      //   back = sAlong/2 + 0.06 - thick, which stays inside the head only while
      //   thick <= sAlong + 0.06. The clamp used to be sAlong + 0.12: at slam
      //   speed the slab poked 6 cm out of the safe back face — the deck a rider
      //   stands on (hazcheck: 39 of ~2160 samples out the back, 36 behind the
      //   centre).
      const kv = un.kill;
      const thick = Math.min(0.16 + speed * Math.max(SWEEP_STEP, dt) * 1.15, sAlong + 0.06);
      if (kv.half && kv.half.setY) kv.half.setY(thick * 0.5);
      else if (kv.half) kv.half.y = thick * 0.5;
      _a.copy(un.basePos).addScaledVector(un.dir, dist + sAlong * 0.5 + 0.06 - thick * 0.5);
      if (kv.center && kv.center.copy) kv.center.copy(_a);
      if (kv.quat && kv.quat.copy) kv.quat.copy(un.frameQ);
      kv.active = closing && speed > 0.55;
      if (typeof kv.update === 'function') kv.update();

      // telescoping shaft
      const shaftLen = Math.max(0.04, unitShaftLength(un, dist));
      un.shaftMesh.scale.y = shaftLen;
      if (un.rodMesh) un.rodMesh.scale.y = shaftLen;
      const cm = un.collarMesh;
      for (let k = 0; k < 4; k++) {
        _a.set(0, shaftLen * (0.14 + k * 0.245), 0);
        _q.identity();
        _scl.set(1, 1, 1);
        _mat4.compose(_a, _q, _scl);
        cm.setMatrixAt(k, _mat4);
      }
      cm.instanceMatrix.needsUpdate = true;

      // lamps: amber idle -> hard red strobe as the slam arms, blazing on impact
      const strobeHz = 2.2 + warn * warn * 16;
      const strobe = 0.5 + 0.5 * Math.sin(t * TAU * strobeHz);
      un.faceMat.emissive.copy(cIdle).lerp(cKill, warn);
      un.faceMat.emissiveIntensity = 0.7 + warn * (1.4 + strobe * 7.0);
      un.warnMat.emissive.copy(closing ? cKill : cIdle).lerp(cKill, Math.max(warn, closing ? 1 : 0));
      un.warnMat.emissiveIntensity = 0.45 + warn * 3.4 + (closing ? Math.min(4.0, speed * 0.22) : 0);
      if (un.safeMat) un.safeMat.emissiveIntensity = closing ? 0.35 : (1.35 + Math.sin(t * 2.2) * 0.30);
    }

    // slam / retract events (presentation only — never feeds the transform)
    const slamNow = u >= 0.995;
    if (slamNow && !lastPhaseSlam) onSlam(t);
    lastPhaseSlam = slamNow;
    const retNow = (!closing && rate < -0.0015);
    if (retNow && !lastRetract) {
      if (resolvePlayerPos(ctx, _b)) {
        _a.copy(units[0].basePos).addScaledVector(units[0].dir, travel);
        const dd = _b.distanceTo(_a);
        if (dd < 32) playSfx(ctx, 'hydraulic', { pos: units[0].basePos, vol: 0.34 * clamp01(1 - dd / 32), rate: 1.0 });
      }
    }
    lastRetract = retNow;
  };

  function unitShaftLength(un, dist) {
    // housing face -> back face of the head
    return Math.max(0.04, dist + (-sAlong * 0.5) - un.housingFace);
  }

  hz.reset = function (t) {
    lastPhaseSlam = false;
    lastRetract = false;
    hz.update(num(t, 0), 0);
    lastPhaseSlam = profile(num(t, 0)) >= 0.995;
  };

  hz.velocityAtPoint = function (p, out) { return out.copy(hz.linVel); };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    for (const un of units) {
      if (un.collarMesh) { try { un.collarMesh.dispose(); } catch (err) { /* ignore */ } }
    }
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0; units.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  for (let i = 0; i < hz.colliders.length; i++) {
    const c = hz.colliders[i];
    if (c && typeof c.update === 'function') c.update();
  }
  hz.update(0, 0);
  lastPhaseSlam = profile(0) >= 0.995;
  return hz;
}

export default crusher;
