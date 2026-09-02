// =============================================================================
//  ASCENDANT — runtime/hazards/pendulum.js
//  Swinging axe / guillotine blade / wrecking ball on a chain.
//
//  DETERMINISM LAW (CONTRACT §16):
//      angle(t) = amp * sin(TAU * t / period + phase)          [phase in RADIANS]
//      omega(t) = amp * (TAU / period) * cos(TAU * t / period + phase)
//  Both are closed form. The arm transform, every kill capsule and the wrecking
//  ball's solid box all derive from angle(t); reset(t) is update(t, 0).
//
//  The CHAIN IS SAFE. Only the head and the blade carry kill volumes, and they
//  are analytic capsules/spheres sized to the geometry — never mesh tests, and
//  deliberately slightly UNDER the silhouette so a near miss reads as a miss.
//
//  Frame: the arm is authored hanging down local -Y, swinging in the local XY
//  plane about local +Z. `alignQ` is a yaw about world +Y that carries local +Z
//  onto the requested swing axis, so the arm still hangs truly downward for any
//  horizontal axis the stage asks for.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider, KillVolume } from '../world/collider.js';

// ---------------------------------------------------------------------------
// module-scope scratch
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _ZA = new THREE.Vector3(0, 0, 1);
const _YA = new THREE.Vector3(0, 1, 0);

let _lastWhoosh = -1e9;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

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

/**
 * Real axe head: a crescent silhouette in the span/height plane, extruded with a
 * bevel far larger than the core depth so the rim tapers to an actual edge
 * instead of a slab face. Returned in the arm frame: span -> Z, height -> Y,
 * thickness -> X, cutting edge sweeping downward from y = 0 to y = -h.
 */
function axeBladeGeo(w, h, d) {
  const bev = Math.max(0.012, d * 0.42);
  const ww = Math.max(0.12, w - bev * 1.9);
  const hh = Math.max(0.12, h - bev * 1.9);
  const s = new THREE.Shape();
  s.moveTo(-ww * 0.5, 0);
  s.lineTo(-ww * 0.30, hh * 0.16);
  s.lineTo(ww * 0.30, hh * 0.16);
  s.lineTo(ww * 0.5, 0);
  s.quadraticCurveTo(ww * 0.455, -hh * 0.74, ww * 0.10, -hh * 0.985);
  s.quadraticCurveTo(0, -hh * 1.02, -ww * 0.10, -hh * 0.985);
  s.quadraticCurveTo(-ww * 0.455, -hh * 0.74, -ww * 0.5, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.006, d * 0.16), bevelEnabled: true,
    bevelThickness: bev, bevelSize: bev, bevelOffset: 0,
    bevelSegments: 2, curveSegments: 8, steps: 1,
  });
  g.translate(0, 0, -d * 0.08);
  g.rotateY(-Math.PI / 2);      // shape X -> Z (span), extrude Z -> X (thickness)
  return g;
}

function ringGeo(r, tube, rseg = 6, tseg = 16) { return new THREE.TorusGeometry(r, tube, rseg, tseg); }

function boltRing(count, r, br, bh, axis) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const g = new THREE.CylinderGeometry(br, br * 1.15, bh, 6);
    if (axis === 'x') { g.rotateZ(Math.PI / 2); g.translate(0, Math.cos(a) * r, Math.sin(a) * r); }
    else { g.translate(Math.cos(a) * r, 0, Math.sin(a) * r); }
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
    metal: { color: 0x93a1b2, roughness: 0.30, metalness: 0.95 },
    panel: { color: 0x59636f, roughness: 0.54, metalness: 0.58 },
    grate: { color: 0x47505d, roughness: 0.44, metalness: 0.82 },
    obsidian: { color: 0x1a1d23, roughness: 0.26, metalness: 0.58 },
    stone: { color: 0x8b8b8b, roughness: 0.9, metalness: 0.03 },
  }[key] || { color: 0x9aa4b2, roughness: 0.5, metalness: 0.45 };
  m = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness, envMapIntensity: 0.95 });
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
    roughness: num(o.roughness, 0.32),
    metalness: num(o.metalness, 0.22),
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
function resolvePlayerPos(ctx, out) {
  if (!ctx) return false;
  const p = ctx.player || (typeof ctx.getPlayer === 'function' ? ctx.getPlayer() : null) || (ctx.world ? ctx.world.player : null);
  if (p && p.pos && typeof p.pos.x === 'number') { out.set(p.pos.x, p.pos.y, p.pos.z); return true; }
  if (ctx.playerPos && typeof ctx.playerPos.x === 'number') { out.copy(ctx.playerPos); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// kill-volume plumbing
// ---------------------------------------------------------------------------
function makeCapsuleKV(kind, ref, r) {
  const kv = new KillVolume({ type: 'capsule', a: new THREE.Vector3(), b: new THREE.Vector3(), radius: r, kind, ref });
  kv.active = true;
  return kv;
}
function setCapsuleKV(kv, a, b, r) {
  if (kv.a && kv.a.copy) kv.a.copy(a); else kv.a = a.clone();
  if (kv.b && kv.b.copy) kv.b.copy(b); else kv.b = b.clone();
  if (kv.p0 && kv.p0.copy) kv.p0.copy(a);
  if (kv.p1 && kv.p1.copy) kv.p1.copy(b);
  if (kv.start && kv.start.copy) kv.start.copy(a);
  if (kv.end && kv.end.copy) kv.end.copy(b);
  if (typeof r === 'number') kv.radius = r;
  if (kv.center && kv.center.copy) kv.center.copy(a).add(b).multiplyScalar(0.5);
  if (typeof kv.update === 'function') kv.update();
}
function makeSphereKV(kind, ref, r) {
  const kv = new KillVolume({ type: 'sphere', center: new THREE.Vector3(), radius: r, kind, ref });
  kv.active = true;
  return kv;
}
function setSphereKV(kv, c) {
  if (kv.center && kv.center.copy) kv.center.copy(c); else kv.center = c.clone();
  if (kv.p && kv.p.copy) kv.p.copy(c);
  if (typeof kv.update === 'function') kv.update();
}

// =============================================================================
//  pendulum(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'pendulum', p, len, amp, period, phase?, axis?,
 *                      blade:{w,h,d}, mode?:'axe'|'blade'|'ball', radius?, ampDeg?}
 *   `p` is the PIVOT. `amp` and `phase` are RADIANS (per contract §18); `ampDeg`
 *   and `phaseCycles` are accepted as author conveniences. `axis` is the swing
 *   axis and defaults to 'z', i.e. the head sweeps along the stage's +X run.
 * @param {object} ctx {mats, theme, fx, audio, builders, broadphase, rng}
 */
export function pendulum(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const mode = String(def.mode || 'axe').toLowerCase();
  const period = Math.max(0.25, num(def.period, 3.0));
  const amp = def.ampDeg !== undefined
    ? clamp(num(def.ampDeg, 55) * Math.PI / 180, -1.55, 1.55)
    : clamp(num(def.amp, 0.95), -1.55, 1.55);
  const phase = def.phaseCycles !== undefined ? num(def.phaseCycles, 0) * TAU : num(def.phase, 0);
  const armLen = Math.max(0.8, num(def.len, 6));
  const w = Math.abs(num(def.blade && def.blade.w, 2.6));
  const h = Math.abs(num(def.blade && def.blade.h, 1.9));
  const th = Math.max(0.06, Math.abs(num(def.blade && def.blade.d, 0.26)));
  const ballR = Math.max(0.35, num(def.radius, Math.max(0.8, w * 0.46)));

  const pivot = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const axis = readVec(def.axis === undefined ? 'z' : def.axis, new THREE.Vector3(), 0, 0, 1);
  if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
  axis.normalize();

  // yaw that carries local +Z onto the swing axis while keeping -Y truly down
  const alignQ = new THREE.Quaternion();
  {
    _a.set(axis.x, 0, axis.z);
    if (_a.lengthSq() > 1e-6) { _a.normalize(); alignQ.setFromAxisAngle(_YA, Math.atan2(_a.x, _a.z)); }
    else alignQ.setFromUnitVectors(_ZA, axis);
  }
  const worldAxis = _ZA.clone().applyQuaternion(alignQ);

  // --------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'pendulum:' + mode;
  root.position.copy(pivot);
  const pivotGroup = new THREE.Group();
  pivotGroup.quaternion.copy(alignQ);
  root.add(pivotGroup);
  const armGroup = new THREE.Group();
  pivotGroup.add(armGroup);

  const hz = {
    kind: 'pendulum', type: mode, def,
    mesh: root, colliders: [], kills: [],
    linVel: new THREE.Vector3(0, 0, 0),
    angVel: 0,
    angAxis: worldAxis.clone(),
    angCenter: pivot.clone(),
    __mats: ownMats,
  };

  const cAccent = new THREE.Color(pal(ctx, 'accent', 0x6fe9ff));
  const cKill = new THREE.Color(pal(ctx, 'kill', 0xff4326));
  const cKillGlow = new THREE.Color(pal(ctx, 'killGlow', cKill.getHex()));

  const matMetal = getMat(ctx, 'metal');
  const matPanel = getMat(ctx, 'panel');
  const matGrate = getMat(ctx, 'grate');
  const matDark = getMat(ctx, 'obsidian');
  const matStone = getMat(ctx, mode === 'ball' ? 'obsidian' : 'metal');

  const trimMat = glowMat(ctx, cAccent, 1.25, ownMats);
  const edgeMat = glowMat(ctx, cKillGlow, 3.4, ownMats, { base: 0x06080c, metalness: 0.55 });

  // =========================================================================
  //  PIVOT BEARING (static)
  // =========================================================================
  {
    const structural = [], glows = [];
    const brR = Math.max(0.26, th * 1.4, ballR * 0.24);
    const housing = chamferBox(brR * 2.6, brR * 2.2, brR * 3.4, 0.06);
    structural.push(housing);
    const yokeGap = brR * 1.15;
    for (let s = -1; s <= 1; s += 2) {
      const cheek = chamferBox(brR * 1.5, brR * 2.4, brR * 0.55, 0.04);
      cheek.translate(0, -brR * 1.5, s * yokeGap);
      structural.push(cheek);
      const bear = ringGeo(brR * 0.62, brR * 0.20, 6, 16);
      bear.translate(0, -brR * 1.9, s * (yokeGap + brR * 0.30));
      structural.push(bear);
    }
    const pin = new THREE.CylinderGeometry(brR * 0.30, brR * 0.30, yokeGap * 2.9, 12);
    pin.rotateX(Math.PI / 2);
    pin.translate(0, -brR * 1.9, 0);
    structural.push(pin);
    // ceiling mount plate + hangers
    const plate = chamferBox(brR * 3.6, 0.22, brR * 4.2, 0.05);
    plate.translate(0, brR * 1.35, 0);
    structural.push(plate);
    for (const g of boltRing(6, brR * 1.5, 0.055, 0.18)) { g.translate(0, brR * 1.35, 0); structural.push(g); }
    const band = ringGeo(brR * 0.70, brR * 0.075, 5, 18);
    band.rotateX(Math.PI / 2);
    band.translate(0, -brR * 1.9, 0);
    glows.push(band);

    pivotGroup.add(partMesh(structural, matMetal, D, true, true));
    pivotGroup.add(partMesh(glows, trimMat, D, false, false));

    hz.colliders.push(new Collider({
      center: pivot.clone(),
      half: new THREE.Vector3(brR * 1.3, brR * 1.1, brR * 1.7),
      quat: alignQ.clone(),
      surface: 'normal', ref: hz, group: 'hazard',
    }));
    hz.__pivotR = brR;
  }
  const brR = hz.__pivotR;

  // =========================================================================
  //  CHAIN — instanced interlocking links following the arm
  // =========================================================================
  const chainTop = brR * 1.9;
  const headTop = (mode === 'ball') ? (armLen - ballR) : armLen;
  const chainLen = Math.max(0.25, headTop - chainTop);
  {
    const linkR = clamp(Math.max(th * 0.55, ballR * 0.14), 0.07, 0.30);
    const tube = linkR * 0.34;
    const spacing = linkR * 1.42;
    const count = Math.max(2, Math.min(64, Math.floor(chainLen / spacing)));
    const lg = ringGeo(linkR, tube, 5, 10);
    D.push(lg);
    const chain = new THREE.InstancedMesh(lg, matGrate, count);
    chain.castShadow = true;
    chain.receiveShadow = false;
    chain.frustumCulled = false;
    const step = chainLen / count;
    for (let i = 0; i < count; i++) {
      _a.set(0, -(chainTop + step * (i + 0.5)), 0);
      _q.setFromAxisAngle(_YA, (i & 1) ? Math.PI / 2 : 0);
      _scl.set(1, step / (linkR * 1.42) * 1.30, 1);
      _mat4.compose(_a, _q, _scl);
      chain.setMatrixAt(i, _mat4);
    }
    chain.instanceMatrix.needsUpdate = true;
    armGroup.add(chain);
    hz.__chain = chain;

    if (mode !== 'ball') {
      // rigid spine behind the chain so an axe reads as swung, not dangled
      const spine = [];
      const sp = chamferBox(th * 0.9, chainLen * 0.99, th * 2.0, 0.03);
      sp.translate(0, -(chainTop + chainLen * 0.5), 0);
      spine.push(sp);
      const nR = Math.max(3, Math.min(9, Math.round(chainLen / 0.9)));
      for (let i = 0; i < nR; i++) {
        const r = chamferBox(th * 1.25, th * 0.30, th * 2.4, 0.02);
        r.translate(0, -(chainTop + chainLen * ((i + 0.5) / nR)), 0);
        spine.push(r);
      }
      armGroup.add(partMesh(spine, matPanel, D, true, false));
    }
  }

  // =========================================================================
  //  HEAD
  // =========================================================================
  let killA = null, killB = null;
  let ballCollider = null;

  if (mode === 'ball') {
    const structural = [], dark = [], glows = [];
    const cy = -armLen;
    const sphere = new THREE.SphereGeometry(ballR, 22, 16);
    sphere.translate(0, cy, 0);
    structural.push(sphere);
    // banded plating
    for (let i = -1; i <= 1; i++) {
      const band = ringGeo(ballR * Math.cos(i * 0.62) * 1.005, ballR * 0.085, 6, 26);
      band.rotateX(Math.PI / 2);
      band.translate(0, cy + Math.sin(i * 0.62) * ballR, 0);
      dark.push(band);
    }
    const seam = ringGeo(ballR * 1.004, ballR * 0.06, 6, 26);
    seam.rotateY(Math.PI / 2);
    seam.translate(0, cy, 0);
    dark.push(seam);
    for (const g of boltRing(8, ballR * 0.82, ballR * 0.055, ballR * 0.30)) { g.translate(0, cy + ballR * 0.42, 0); structural.push(g); }
    // lifting eye
    const eye = ringGeo(ballR * 0.24, ballR * 0.085, 6, 14);
    eye.translate(0, cy + ballR * 1.02, 0);
    structural.push(eye);
    const collarG = new THREE.CylinderGeometry(ballR * 0.30, ballR * 0.38, ballR * 0.22, 12);
    collarG.translate(0, cy + ballR * 0.94, 0);
    structural.push(collarG);
    // hot equator: the read that says this thing is moving
    const hot = ringGeo(ballR * 1.012, ballR * 0.038, 5, 30);
    hot.rotateX(Math.PI / 2);
    hot.translate(0, cy, 0);
    glows.push(hot);

    armGroup.add(partMesh(structural, matStone, D, true, true));
    armGroup.add(partMesh(dark, matDark, D, true, false));
    armGroup.add(partMesh(glows, edgeMat, D, false, false));

    // solid: an inscribed-ish box so the ball pushes without invisible corners
    ballCollider = new Collider({
      center: pivot.clone(),
      half: new THREE.Vector3(ballR * 0.62, ballR * 0.62, ballR * 0.62),
      quat: new THREE.Quaternion(),
      surface: 'nostick', ref: hz, group: 'hazard',
    });
    hz.colliders.push(ballCollider);
    killA = makeSphereKV('crush', hz, ballR * 0.93);
    killA.active = false;
    hz.kills.push(killA);
  } else {
    const structural = [], dark = [], glows = [];
    const headH = Math.max(0.32, h * 0.34);
    const headY = -armLen + headH * 0.5;

    // hub / socket the blade is seated in
    const hub = chamferBox(th * 3.0, headH, w * 0.42, Math.min(0.08, th));
    hub.translate(0, headY, 0);
    structural.push(hub);
    const cheekL = chamferBox(th * 3.6, headH * 0.55, w * 0.20, 0.035);
    cheekL.translate(0, headY, 0);
    structural.push(cheekL);
    for (const g of boltRing(4, headH * 0.30, 0.05, th * 3.4, 'x')) { g.translate(0, headY, 0); structural.push(g); }

    // the blade itself
    const blade = axeBladeGeo(w, h, th);
    blade.translate(0, -armLen, 0);
    if (mode === 'blade') dark.push(blade); else structural.push(blade);

    // hot cutting edge — a slim arc hugging the blade's lower rim
    const nEdge = 9;
    for (let i = 0; i < nEdge; i++) {
      const u = (i / (nEdge - 1)) * 2 - 1;                 // -1..1 across the span
      const zz = u * w * 0.455;
      const yy = -armLen - h * (0.985 - 0.62 * u * u);      // follows the crescent
      const seg = chamferBox(th * 0.55, h * 0.10, w * (1.02 / nEdge), 0.012);
      seg.translate(0, yy + h * 0.055, zz);
      glows.push(seg);
    }
    // spine ridge along the blade back
    const ridge = chamferBox(th * 1.35, h * 0.09, w * 0.90, 0.02);
    ridge.translate(0, -armLen - h * 0.04, 0);
    dark.push(ridge);

    armGroup.add(partMesh(structural, matStone, D, true, true));
    armGroup.add(partMesh(dark, matDark, D, true, false));
    armGroup.add(partMesh(glows, edgeMat, D, false, false));

    // Two analytic capsules: the seated head, and the blade body. Both run
    // across the span (local Z). The chain and spine above are untouched.
    killA = makeCapsuleKV('spike', hz, Math.max(th * 1.7, headH * 0.52));
    killB = makeCapsuleKV('spike', hz, Math.max(th * 1.15, h * 0.30));
    hz.kills.push(killA, killB);
    hz.__headY = headY;
    hz.__bladeY = -armLen - h * 0.52;
    hz.__spanA = w * 0.20;
    hz.__spanB = w * 0.34;
  }

  // =========================================================================
  //  per-frame derivation
  // =========================================================================
  let bpFailed = false;
  let lastSign = 0;
  const _localA = new THREE.Vector3();
  const _localB = new THREE.Vector3();

  function refreshBroad(c) {
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.refresh !== 'function') return;
    try { ctx.broadphase.refresh(c); } catch (err) { bpFailed = true; }
  }

  /** arm-local -> world, given the full swing quaternion in _qF */
  function toWorld(local, out) { return out.copy(local).applyQuaternion(_qF).add(pivot); }

  hz.update = function (t, dt) {
    dt = num(dt, 0);
    const arg = TAU * t / period + phase;
    const angle = amp * Math.sin(arg);
    const omega = amp * (TAU / period) * Math.cos(arg);

    armGroup.rotation.set(0, 0, angle);
    _q.setFromAxisAngle(_ZA, angle);
    _qF.copy(alignQ).multiply(_q);

    hz.angVel = omega;
    hz.angAxis.copy(worldAxis);
    hz.angCenter.copy(pivot);
    hz.linVel.set(0, 0, 0);

    const tipSpeed = Math.abs(omega) * armLen;

    if (mode === 'ball') {
      _localA.set(0, -armLen, 0);
      toWorld(_localA, _a);
      ballCollider.center.copy(_a);
      if (ballCollider.quat && ballCollider.quat.copy) ballCollider.quat.copy(_qF);
      if (typeof ballCollider.update === 'function') ballCollider.update();
      refreshBroad(ballCollider);
      setSphereKV(killA, _a);
      // solid at rest, deadly on the swing — "lethal on impact"
      killA.active = tipSpeed > Math.max(3.2, armLen * 0.55);
      edgeMat.emissiveIntensity = 0.8 + Math.min(6.0, tipSpeed * 0.30);
    } else {
      _localA.set(0, hz.__headY, -hz.__spanA);
      _localB.set(0, hz.__headY, hz.__spanA);
      toWorld(_localA, _a);
      toWorld(_localB, _b);
      setCapsuleKV(killA, _a, _b);

      _localA.set(0, hz.__bladeY, -hz.__spanB);
      _localB.set(0, hz.__bladeY, hz.__spanB);
      toWorld(_localA, _c);
      toWorld(_localB, _d);
      setCapsuleKV(killB, _c, _d);

      edgeMat.emissiveIntensity = 2.4 + Math.min(5.5, tipSpeed * 0.34) + Math.sin(t * 9.1) * 0.2;
    }

    trimMat.emissiveIntensity = 1.10 + Math.sin(t * 2.6) * 0.30;

    // --- wind whoosh: it peaks exactly where |omega| does, at angle 0 ---------
    const sign = Math.sin(arg) >= 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) {
      let vol = 0.55, near = true;
      if (resolvePlayerPos(ctx, _c)) {
        _localA.set(0, -armLen, 0);
        toWorld(_localA, _b);
        const dd = _c.distanceTo(_b);
        near = dd < 34;
        vol = 0.68 * clamp01(1 - dd / 34);
      }
      if (near) {
        if (t < _lastWhoosh) _lastWhoosh = -1e9;
        if (t - _lastWhoosh > 0.05) {
          _lastWhoosh = t;
          const peak = Math.abs(amp) * (TAU / period) * armLen;
          playSfx(ctx, 'whoosh', {
            pos: pivot,
            vol: vol * clamp01(0.28 + peak * 0.055),
            rate: clamp(0.62 + peak * 0.035, 0.55, 1.85),
          });
          if (mode === 'ball' && peak > 9) {
            _localA.set(0, -armLen, 0);
            toWorld(_localA, _a);
            burstFX(ctx, 'dust', _a, { count: 5, speed: 2.4, spread: ballR });
          }
        }
      }
    }
    lastSign = sign;
  };

  hz.reset = function (t) {
    lastSign = 0;
    hz.update(num(t, 0), 0);
    lastSign = Math.sin(TAU * num(t, 0) / period + phase) >= 0 ? 1 : -1;
  };

  hz.velocityAtPoint = function (p, out) {
    _a.subVectors(p, hz.angCenter);
    _b.crossVectors(hz.angAxis, _a).multiplyScalar(hz.angVel);
    return out.copy(_b);
  };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    if (hz.__chain) { try { hz.__chain.dispose(); } catch (err) { /* ignore */ } }
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  for (let i = 0; i < hz.colliders.length; i++) {
    const c = hz.colliders[i];
    if (c && typeof c.update === 'function') c.update();
  }
  hz.update(0, 0);
  lastSign = Math.sin(phase) >= 0 ? 1 : -1;
  return hz;
}

export default pendulum;
