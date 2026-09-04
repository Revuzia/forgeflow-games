// =============================================================================
//  CRESTBOUND — runtime/hazards/crushers.js
//  Hydraulic pistons: single / pair / wall.
//
//  DETERMINISM LAW (CONTRACT §21): the extension u(t) in [0,1] is a closed-form piecewise
//  curve over the cycle — dwell, accelerating slam, dwell, slow retract. Position, warning
//  lights and the kill face all derive from u(t). Nothing integrates; `reset(t)` is
//  `update(t, 0)`.
//
//  READABILITY LAW: a crusher is LETHAL ONLY on its crushing face, and only while that face
//  is actually driving forward. A parked crusher — extended or retracted — is a safe
//  platform you can stand on. That is the whole reason crusher timing is learnable instead
//  of a coin flip, and it is why the head publishes `linVel` for the carry.
//
//  The lethal face is SWEPT: its thickness this frame is 0.16 + |v| * dt, grown BACKWARDS
//  from the exact front plane, so a 30 m/s slam can never step over a player between two
//  frames while never reaching ahead of the real face. The margin uses a FIXED nominal step
//  so the volume stays a pure function of t and `reset(t)` reproduces `update(t)` exactly.
//
//  Ported from Ascendant by transliteration; kit from ./lasers.js and ./movers.js.
// =============================================================================

import * as THREE from 'three';
import { Collider, KillVolume } from '../world/collider.js';
import { hazSfx, hazBurst, hazShake, resolvePlayer } from './lasers.js';
import { chamferBox, mergeAll, getMat, pal } from './movers.js';
import { BatchRig, trimK } from './batchkit.js';

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
const _lampCol = new THREE.Color();

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
 *                      mode?:'single'|'pair'|'wall', gap?, mat?, surface?}
 *   `p`      the head's RETRACTED centre, world metres.
 *   `s`      FULL extents of the head.
 *   `axis`   the CRUSH DIRECTION (default [0,-1,0] — it slams downward).
 *   `travel` metres of stroke (non-zero).
 *   `period` SECONDS per full cycle.
 *   `phase`  FRACTION OF THE CYCLE (0..1) — NOT seconds.
 *   `dwell`  SECONDS parked at each end (clamped to 40 % of the period each).
 *   `gap`    (pair mode) face-to-face clearance at full closure, metres.
 * @param {object} ctx {mats, theme, themeId, fx, audio, cam, broadphase, quality}
 */
export function crusher(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const mode = String(def.mode || 'single').toLowerCase();
  const period = Math.max(0.4, num(def.period, 3.2));
  const phase = num(def.phase, 0);
  const travel = Math.max(0.2, Math.abs(num(def.travel, 4)));
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
  /* BATCHED (hazards/batchkit.js). Every plate, lamp, band and rod of every crusher in the
     course is an instance in the shared per-material batches; the Groups below are still posed
     exactly as before and `rig.sync()` copies their matrices out once per frame. */
  const rig = new BatchRig(ctx, root);

  const hz = {
    kind: 'crusher', type: mode, def,
    mesh: root, colliders: [], kills: [], volumes: [],
    linVel: new THREE.Vector3(),
    angVel: 0,
    angAxis: axisDir.clone(),
    angCenter: origin.clone(),
    surface: def.surface || 'normal',
    time: 0,
    enabled: true,
    __mats: ownMats,
  };

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
      warnPart: null, facePart: null, safePart: null,
      shaftGroup: null, shaftNode: null, rodNode: null, collarParts: null,
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
    // Landable-face stripe. A parked crusher is a safe platform, so whichever of its six
    // faces currently points most upward gets the standard safe-edge highlight. Computed
    // from the real frame, so it is right for wall crushers and side-slamming pistons too.
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

    rig.solid(matMetal, structural, unit.group, true, true);
    rig.solid(matRubber, dark, unit.group, false, false);
    rig.solid(matHazard, hazardParts, unit.group, true, false);
    // the collar band and the safe-edge stripe were animated-emissive materials: additive trim
    unit.warnPart = rig.trim(glows, unit.group);
    if (safeEdge.length) unit.safePart = rig.trim(safeEdge, unit.group);

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
    rig.solid(matMetal, hoStruct, housingGrp, true, true);
    rig.solid(matDark, hoDark, housingGrp, false, false);
    unit.facePart = rig.trim(hoLights, housingGrp);

    // ---- PISTON SHAFT (telescoping; a cylinder scaled along its own axis is
    //      geometrically exact, so only the collars need per-frame placement) --
    unit.shaftGroup = new THREE.Group();
    unit.shaftGroup.position.copy(localBase).addScaledVector(dir, unit.housingFace);
    unit.shaftGroup.quaternion.copy(frameQ);
    root.add(unit.shaftGroup);

    const shaftR = Math.min(0.34, faceMin * 0.16);
    const sg = new THREE.CylinderGeometry(shaftR, shaftR, 1, 14);
    sg.translate(0, 0.5, 0);
    // the telescoping shaft is a unit cylinder on a node scaled along its own axis
    unit.shaftNode = new THREE.Group();
    unit.shaftGroup.add(unit.shaftNode);
    rig.solid(matGrate, sg, unit.shaftNode, true, true);

    const cg = ringGeo(shaftR * 1.28, shaftR * 0.30, 6, 14);
    cg.rotateX(Math.PI / 2);
    unit.collarParts = [];
    for (let k = 0; k < 4; k++) {
      const part = rig.solid(matMetal, cg.clone(), unit.shaftGroup, false, true);
      rig.setLocal(part, _mat4.identity());
      unit.collarParts.push(part);
    }
    cg.dispose();

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
    unit.rodNode = new THREE.Group();
    unit.shaftGroup.add(unit.rodNode);
    rig.solid(matPanel, rods, unit.rodNode, false, true);

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

  function unitShaftLength(un, dist) {
    // housing face -> back face of the head
    return Math.max(0.04, dist + (-sAlong * 0.5) - un.housingFace);
  }

  function onSlam(t) {
    let vol = 0.85, sh = 1.0;
    const pl = resolvePlayer(ctx, hz.__player);
    if (pl && pl.pos) {
      _b.set(pl.pos.x, pl.pos.y, pl.pos.z);
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
      hazSfx(ctx, 'crush', { pos: units[0].basePos, gain: vol, rate: clamp(0.72 + travel * 0.03, 0.6, 1.3), ref: 14, max: 60 });
    }
    hazShake(ctx, 0.55 * sh, 260);
    for (let i = 0; i < units.length; i++) {
      _a.copy(units[i].basePos).addScaledVector(units[i].dir, travel + sAlong * 0.5);
      hazBurst(ctx, 'dust', _a, { count: 22, spread: Math.max(eA, eB) * 0.6, speed: 6.5, up: 0.4 });
    }
  }

  hz.update = function (t, dt, player) {
    dt = clamp(num(dt, 0), 0, 0.1);
    hz.time = t;
    if (player) hz.__player = player;

    const u = profile(t);
    const uPrev = profile(t - FD_H);
    const uNext = profile(t + FD_H);
    const rate = (uNext - uPrev) / (2 * FD_H);       // du/dt
    const speed = Math.abs(rate) * travel;
    const closing = rate > 0.0015;
    const warn = warnLevel(t);

    hz.linVel.copy(axisDir).multiplyScalar(rate * travel);
    hz.angCenter.copy(origin);

    for (let i = 0; i < units.length; i++) {
      const un = units[i];
      const dist = travel * u;

      // moving head
      un.group.position.copy(un.localBase).addScaledVector(un.dir, dist);
      un.collider.center.copy(un.basePos).addScaledVector(un.dir, dist);
      un.collider.active = hz.enabled;
      if (typeof un.collider.update === 'function') un.collider.update();
      refreshBroad(un.collider);

      // Swept lethal face: front plane exact, thickness grown BACKWARDS only. The margin
      // uses a FIXED nominal step (not the live dt) so the volume stays a pure function of
      // t and reset(t) reproduces update(t) exactly; it only widens on a genuine hitch
      // (dt > SWEEP_STEP), and it is clamped to the head's own thickness so it can never
      // poke out of the safe BACK face and kill someone riding a fast-closing crusher.
      const kv = un.kill;
      const thick = Math.min(0.16 + speed * Math.max(SWEEP_STEP, dt) * 1.15, sAlong + 0.06);
      if (kv.half && kv.half.setY) kv.half.setY(thick * 0.5);
      else if (kv.half) kv.half.y = thick * 0.5;
      _a.copy(un.basePos).addScaledVector(un.dir, dist + sAlong * 0.5 + 0.06 - thick * 0.5);
      if (kv.center && kv.center.copy) kv.center.copy(_a);
      if (kv.quat && kv.quat.copy) kv.quat.copy(un.frameQ);
      kv.active = hz.enabled && closing && speed > 0.55;
      if (typeof kv.update === 'function') kv.update();

      // telescoping shaft
      const shaftLen = Math.max(0.04, unitShaftLength(un, dist));
      un.shaftNode.scale.y = shaftLen;
      un.rodNode.scale.y = shaftLen;
      for (let k = 0; k < 4; k++) {
        _a.set(0, shaftLen * (0.14 + k * 0.245), 0);
        _q.identity();
        _scl.set(1, 1, 1);
        _mat4.compose(_a, _q, _scl);
        rig.setLocal(un.collarParts[k], _mat4);
      }

      // lamps: amber idle -> hard red strobe as the slam arms, blazing on impact. The same
      // emissive curves as before, mapped onto additive trim colour (batchkit.trimK).
      const strobeHz = 2.2 + warn * warn * 16;
      const strobe = 0.5 + 0.5 * Math.sin(t * TAU * strobeHz);
      _lampCol.copy(cIdle).lerp(cKill, warn);
      rig.setColor(un.facePart, _lampCol, trimK(0.7 + warn * (1.4 + strobe * 7.0)));
      _lampCol.copy(closing ? cKill : cIdle).lerp(cKill, Math.max(warn, closing ? 1 : 0));
      rig.setColor(un.warnPart, _lampCol, trimK(0.45 + warn * 3.4 + (closing ? Math.min(4.0, speed * 0.22) : 0)));
      if (un.safePart) rig.setColor(un.safePart, cSafe, trimK(closing ? 0.35 : (2.0 + Math.sin(t * 2.2) * 0.30)));
    }
    rig.sync();

    // slam / retract events (presentation only — never feeds the transform)
    const slamNow = u >= 0.995;
    if (slamNow && !lastPhaseSlam) onSlam(t);
    lastPhaseSlam = slamNow;
    const retNow = (!closing && rate < -0.0015);
    if (retNow && !lastRetract) {
      const pl = resolvePlayer(ctx, hz.__player);
      if (pl && pl.pos) {
        _b.set(pl.pos.x, pl.pos.y, pl.pos.z);
        _a.copy(units[0].basePos).addScaledVector(units[0].dir, travel);
        const dd = _b.distanceTo(_a);
        if (dd < 32) hazSfx(ctx, 'hydraulic', { pos: units[0].basePos, gain: 0.34 * clamp01(1 - dd / 32), rate: 1.0, ref: 12, max: 40 });
      }
    }
    lastRetract = retNow;
  };

  hz.reset = function (t) {
    lastPhaseSlam = false;
    lastRetract = false;
    hz.update(num(t, 0), 0, null);
    lastPhaseSlam = profile(num(t, 0)) >= 0.995;
  };

  /** CONTRACT §21 hooks — a crusher head is a rideable platform, nothing more. */
  hz.onStand = function () {};
  hz.onPound = function () {};
  hz.onTouch = function () {};

  hz.velocityAtPoint = function (p, out) { return out.copy(hz.linVel); };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    rig.dispose();
    for (const g of D) { try { g.dispose(); } catch (err) { /* already gone */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* already gone */ } }
    D.length = 0; ownMats.length = 0; units.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    hz.volumes.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  for (let i = 0; i < hz.colliders.length; i++) {
    const c = hz.colliders[i];
    if (c && typeof c.update === 'function') c.update();
  }
  hz.update(0, 0, null);
  lastPhaseSlam = profile(0) >= 0.995;
  return hz;
}

export default crusher;
