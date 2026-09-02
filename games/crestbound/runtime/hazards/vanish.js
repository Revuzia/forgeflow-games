// =============================================================================
//  CRESTBOUND — runtime/hazards/vanish.js
//  Disappearing platforms: cycle / flicker / crumble.
//
//  DETERMINISM LAW (CONTRACT §21): the cycle phase, the fade curve, the warning
//  strobe, the falling flakes and the crumble debris are ALL closed-form in the
//  course clock `t`. The only retained state is the crumble trigger timestamp,
//  expressed on the course clock, so `reset(t)` restores the slab exactly.
//
//  FAIRNESS RULE enforced here: the slab is solid IF AND ONLY IF it reads solid.
//  The collider is active whenever the visual scale is >= 0.9, so a platform can
//  never look landable while being air, nor look gone while catching you.
//
//  Materials: this hazard must recolour, strobe and dissolve its slab, so it
//  CLONES the shared materials handed back by builders.buildPlatform (Mats.get()
//  results are cached and shared and must never be mutated). The clones keep the
//  same procedural maps and are disposed with the hazard.
// =============================================================================

import * as THREE from 'three';
import { Collider } from '../world/collider.js';
import { buildPlatform } from '../world/builders.js';
import { hazSfx, hazBurst, resolvePlayer, standingOn } from './lasers.js';
import { chamferBox, partMesh, getMat, pal, glowMat } from './movers.js';

// ---------------------------------------------------------------------------
// module-scope scratch
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _TUMBLE = new THREE.Vector3(1, 0, 0.35).normalize();

// global throttle so a wall of vanish platforms cannot machine-gun the mixer
let _lastVanishSfx = -1e9;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function fract(v) { return v - Math.floor(v); }
function smooth(v) { return v * v * (3 - 2 * v); }
function easeOutBack(v) { const c = 1.70158; return 1 + (c + 1) * Math.pow(v - 1, 3) + c * Math.pow(v - 1, 2); }

/** Deterministic 1-D hash — the flicker mode's "randomness" is this and nothing else. */
function hash11(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readVec(src, out, dx, dy, dz) {
  if (Array.isArray(src) && src.length >= 3) out.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  else if (src && typeof src === 'object' && 'x' in src) out.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  else out.set(dx, dy, dz);
  return out;
}

// =============================================================================
//  vanish(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'vanish', p, s, mat?, surface?, mode?, seed?,
 *                      cycle:{on, off, warn, phase, step?}}
 *   cycle.on/off/warn are SECONDS; `phase` is a FRACTION OF THE CYCLE (0..1).
 *   mode: 'cycle'(default)|'flicker'|'crumble'. crumble: crackDelay, chunkLife (s).
 * @param {object} ctx {mats, theme, fx, audio, builders, broadphase}
 */
export function vanish(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const mode = String(def.mode || 'cycle').toLowerCase();
  const cyc = def.cycle || {};
  const onDur = Math.max(0.10, num(cyc.on, 2.2));
  const warnDur = Math.max(0.08, num(cyc.warn, 0.75));
  const offDur = Math.max(0.10, num(cyc.off, 1.6));
  const period = onDur + warnDur + offDur;
  const phase = num(cyc.phase, 0);
  const flickStep = Math.max(0.08, num(cyc.step, 0.42));
  const flickBias = clamp(num(cyc.bias, 0.42), 0.05, 0.9);

  const size = Array.isArray(def.s) && def.s.length >= 3
    ? [Math.abs(num(def.s[0], 4)), Math.abs(num(def.s[1], 0.5)), Math.abs(num(def.s[2], 4))]
    : [4, 0.5, 4];
  const origin = readVec(def.p, new THREE.Vector3(), 0, 0, 0);

  const FADE_OUT = Math.min(0.20, offDur * 0.34);
  const FADE_IN = Math.min(0.26, offDur * 0.40);
  const CRACK = Math.max(0.10, num(def.crackDelay, 0.32));
  const CHUNK_LIFE = Math.max(0.8, num(def.chunkLife, 1.9));

  const seed = (num(def.seed, 0) || Math.floor(Math.abs(origin.x * 73.1 + origin.y * 191.7 + origin.z * 419.3)) + 1) >>> 0;
  const rnd = mulberry32(seed);

  let trigT = null;

  const root = new THREE.Group();
  root.name = 'vanish:' + mode;
  root.position.copy(origin);
  const shell = new THREE.Group();
  root.add(shell);

  const hz = {
    kind: 'vanish', type: mode, def,
    mesh: root, colliders: [], kills: [], volumes: [],
    linVel: new THREE.Vector3(0, 0, 0),
    angVel: 0,
    angAxis: _UP.clone(),
    angCenter: origin.clone(),
    time: 0,
    __mats: ownMats,
  };

  const cAccent = new THREE.Color(pal(ctx, 'accent', 0x6fe9ff));
  const cSafe = new THREE.Color(pal(ctx, 'safeEdge', pal(ctx, 'safe', 0x9fe8ff)));
  const cWarn = new THREE.Color(pal(ctx, 'warn', pal(ctx, 'kill', 0xff5124)));

  // =========================================================================
  //  slab (from builders) + per-instance material clones
  // =========================================================================
  const platDef = {
    kind: 'platform', p: [0, 0, 0], s: size,
    mat: def.mat || 'panel',
    surface: def.surface || 'normal',
    props: def.props,
    glow: (def && def.glow) || 1,
    stripe: (def && def.stripe !== undefined) ? def.stripe : true,
  };
  let plat = null;
  const bp = (ctx.builders && typeof ctx.builders.buildPlatform === 'function') ? ctx.builders.buildPlatform : buildPlatform;
  // ctx.mats MUST ride along: buildPlatform(def, theme, mats) only themes its body/panel
  // materials when the registry is handed to it.
  try { plat = bp(platDef, ctx.theme, ctx.mats); } catch (err) { plat = null; }

  const slab = new THREE.Group();
  shell.add(slab);

  /** {mat, baseColor:Color, baseEmissive:Color, baseEI:number, trim:boolean} */
  const skins = [];
  let chunkMatSource = null;

  function adoptMaterials(obj) {
    const seen = new Map();
    obj.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const src = o.material;
      if (Array.isArray(src)) {
        const out = new Array(src.length);
        for (let i = 0; i < src.length; i++) out[i] = adoptOne(src[i], seen);
        o.material = out;
      } else if (src) {
        o.material = adoptOne(src, seen);
      }
    });
  }
  function adoptOne(src, seen) {
    if (!src) return src;
    let cl = seen.get(src);
    if (cl) return cl;
    try { cl = src.clone(); } catch (err) { cl = src; }
    if (cl === src) return src;
    cl.transparent = true;
    cl.opacity = 1;
    cl.depthWrite = true;
    ownMats.push(cl);
    const trim = !!(cl.emissive && (cl.emissive.r + cl.emissive.g + cl.emissive.b) > 0.06);
    skins.push({
      mat: cl,
      baseColor: cl.color ? cl.color.clone() : new THREE.Color(0xffffff),
      baseEmissive: cl.emissive ? cl.emissive.clone() : new THREE.Color(0x000000),
      baseEI: num(cl.emissiveIntensity, 1),
      trim,
    });
    if (!trim && !chunkMatSource) chunkMatSource = cl;
    seen.set(src, cl);
    return cl;
  }

  if (plat && plat.mesh) {
    slab.add(plat.mesh);
    adoptMaterials(plat.mesh);
  } else {
    const body = chamferBox(size[0], size[1], size[2], Math.min(0.10, size[1] * 0.34));
    const inset = chamferBox(size[0] * 0.80, size[1] * 0.34, size[2] * 0.80, 0.04);
    inset.translate(0, size[1] * 0.40, 0);
    const bodyMat = getMat(ctx, def.mat || 'panel').clone();
    bodyMat.transparent = true; ownMats.push(bodyMat);
    skins.push({ mat: bodyMat, baseColor: bodyMat.color.clone(), baseEmissive: bodyMat.emissive ? bodyMat.emissive.clone() : new THREE.Color(0), baseEI: num(bodyMat.emissiveIntensity, 1), trim: false });
    chunkMatSource = bodyMat;
    slab.add(partMesh([body, inset], bodyMat, D, true, true));
    const trimGeoms = [];
    for (let s = -1; s <= 1; s += 2) {
      const gx = chamferBox(size[0] + 0.05, 0.05, 0.10, 0.02);
      gx.translate(0, size[1] * 0.5 + 0.005, s * (size[2] / 2 - 0.04));
      trimGeoms.push(gx);
      const gz = chamferBox(0.10, 0.05, size[2] + 0.05, 0.02);
      gz.translate(s * (size[0] / 2 - 0.04), size[1] * 0.5 + 0.005, 0);
      trimGeoms.push(gz);
    }
    const tm = glowMat(ctx, cSafe, 2.4, ownMats);
    tm.transparent = true;
    skins.push({ mat: tm, baseColor: tm.color.clone(), baseEmissive: tm.emissive.clone(), baseEI: 2.4, trim: true });
    slab.add(partMesh(trimGeoms, tm, D, false, false));
  }

  const warnMat = glowMat(ctx, cWarn, 0.05, ownMats, { base: 0x0a0c11 });
  warnMat.transparent = true;
  {
    const bandGeoms = [];
    const yb = -size[1] * 0.06;
    for (let s = -1; s <= 1; s += 2) {
      const bx = chamferBox(size[0] * 0.995, size[1] * 0.30, 0.055, 0.014);
      bx.translate(0, yb, s * (size[2] * 0.5 + 0.006));
      bandGeoms.push(bx);
      const bz = chamferBox(0.055, size[1] * 0.30, size[2] * 0.995, 0.014);
      bz.translate(s * (size[0] * 0.5 + 0.006), yb, 0);
      bandGeoms.push(bz);
    }
    slab.add(partMesh(bandGeoms, warnMat, D, false, false));
  }

  const cols = (plat && Array.isArray(plat.colliders) && plat.colliders.length) ? plat.colliders.slice() : [];
  if (cols.length === 0) {
    cols.push(new Collider({
      center: origin.clone(),
      half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
      quat: new THREE.Quaternion(),
      surface: def.surface || 'normal', ref: hz, group: 'hazard',
    }));
  } else {
    for (const c of cols) {
      c.ref = hz;
      c.group = c.group || 'hazard';
      if (def.surface) c.surface = def.surface;
      if (c.center && c.center.add) c.center.add(origin);
      if (typeof c.update === 'function') c.update();
    }
  }
  hz.colliders = cols;

  // =========================================================================
  //  wireframe ghost — how the player times the return
  // =========================================================================
  const ghostGroup = new THREE.Group();
  root.add(ghostGroup);
  const ghostMat = new THREE.LineBasicMaterial({
    color: cAccent.clone(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  });
  ownMats.push(ghostMat);
  {
    const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const eg = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    D.push(eg);
    ghostGroup.add(new THREE.LineSegments(eg, ghostMat));
  }
  const bracketMat = glowMat(ctx, cSafe, 3.0, ownMats, { base: 0x000000 });
  bracketMat.transparent = true;
  bracketMat.opacity = 0;
  {
    const br = [];
    const L = Math.min(0.55, Math.min(size[0], size[2]) * 0.24), th = 0.055;
    for (let i = 0; i < 8; i++) {
      const sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1, sz = (i & 4) ? 1 : -1;
      const px = sx * size[0] * 0.5, py = sy * size[1] * 0.5, pz = sz * size[2] * 0.5;
      const gx = chamferBox(L, th, th, th * 0.3);
      gx.translate(px - sx * L * 0.5, py, pz);
      br.push(gx);
      const gy = chamferBox(th, Math.min(L, size[1]), th, th * 0.3);
      gy.translate(px, py - sy * Math.min(L, size[1]) * 0.5, pz);
      br.push(gy);
      const gz = chamferBox(th, th, L, th * 0.3);
      gz.translate(px, py, pz - sz * L * 0.5);
      br.push(gz);
    }
    ghostGroup.add(partMesh(br, bracketMat, D, false, false));
  }

  // =========================================================================
  //  warning flakes — real geometry shed off the slab during the telegraph
  // =========================================================================
  const FLAKES = 7;
  const flakeSeed = new Float32Array(FLAKES * 7);
  for (let i = 0; i < FLAKES; i++) {
    const o = i * 7;
    flakeSeed[o + 0] = (rnd() - 0.5) * size[0] * 0.86;
    flakeSeed[o + 1] = (rnd() - 0.5) * size[2] * 0.86;
    flakeSeed[o + 2] = (rnd() - 0.5) * 1.5;
    flakeSeed[o + 3] = (rnd() - 0.5) * 1.5;
    flakeSeed[o + 4] = rnd() * TAU;
    flakeSeed[o + 5] = 2.2 + rnd() * 4.4;
    flakeSeed[o + 6] = 0.55 + rnd() * 0.75;
  }
  let flakeMesh = null;
  {
    const fg = chamferBox(0.20, 0.075, 0.20, 0.02);
    D.push(fg);
    const fm = (chunkMatSource ? chunkMatSource.clone() : getMat(ctx, def.mat || 'panel').clone());
    fm.transparent = true; fm.opacity = 1; fm.depthWrite = true;
    ownMats.push(fm);
    flakeMesh = new THREE.InstancedMesh(fg, fm, FLAKES);
    flakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flakeMesh.castShadow = false;
    flakeMesh.receiveShadow = false;
    flakeMesh.frustumCulled = false;
    flakeMesh.visible = false;
    root.add(flakeMesh);
    hz.__flakeMat = fm;
  }

  // =========================================================================
  //  crumble debris — a 3x3 split, one InstancedMesh, one draw call
  // =========================================================================
  const CH = 3;
  const CHUNKS = CH * CH;
  let chunkMesh = null;
  const chunkSeed = new Float32Array(CHUNKS * 8);
  if (mode === 'crumble') {
    const cw = size[0] / CH, cd = size[2] / CH;
    for (let i = 0; i < CHUNKS; i++) {
      const gx = (i % CH) - (CH - 1) / 2;
      const gz = Math.floor(i / CH) - (CH - 1) / 2;
      const o = i * 8;
      chunkSeed[o + 0] = gx * cw;
      chunkSeed[o + 1] = gz * cd;
      chunkSeed[o + 2] = gx * (2.1 + rnd() * 1.6) + (rnd() - 0.5) * 1.1;
      chunkSeed[o + 3] = 1.1 + rnd() * 2.3;
      chunkSeed[o + 4] = gz * (2.1 + rnd() * 1.6) + (rnd() - 0.5) * 1.1;
      chunkSeed[o + 5] = (rnd() - 0.5) * 7.5;
      chunkSeed[o + 6] = (rnd() - 0.5) * 7.5;
      chunkSeed[o + 7] = 0.86 + rnd() * 0.22;
    }
    const cg = chamferBox(cw * 0.94, size[1] * 0.94, cd * 0.94, Math.min(0.06, size[1] * 0.24));
    D.push(cg);
    const cm = (chunkMatSource ? chunkMatSource.clone() : getMat(ctx, def.mat || 'panel').clone());
    cm.transparent = true; cm.opacity = 1; cm.depthWrite = true;
    ownMats.push(cm);
    chunkMesh = new THREE.InstancedMesh(cg, cm, CHUNKS);
    chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    chunkMesh.castShadow = true;
    chunkMesh.frustumCulled = false;
    chunkMesh.visible = false;
    root.add(chunkMesh);
    hz.__chunkMat = cm;
  }

  // =========================================================================
  //  STATE  (pure in t)
  // =========================================================================
  // state: 0 = on, 1 = warn, 2 = off, 3 = broken(crumble)
  let state = 0, stateK = 0, lastState = -1;

  function evalState(t) {
    if (mode === 'crumble') {
      if (trigT === null) { state = 0; stateK = 0; return; }
      const el = t - trigT;
      if (el < 0) { state = 0; stateK = 0; return; }
      if (el < CRACK) { state = 1; stateK = clamp01(el / CRACK); return; }
      state = 3; stateK = clamp01((el - CRACK) / CHUNK_LIFE);
      return;
    }
    if (mode === 'flicker') {
      const idx = Math.floor(t / flickStep + phase);
      const here = hash11(idx * 1.6180339 + seed * 0.0173) > flickBias;
      const next = hash11((idx + 1) * 1.6180339 + seed * 0.0173) > flickBias;
      const local = t - (idx - phase) * flickStep;
      const w = Math.min(0.16, flickStep * 0.42);
      if (!here) { state = 2; stateK = clamp01(local / flickStep); return; }
      if (!next && local > flickStep - w) { state = 1; stateK = clamp01((local - (flickStep - w)) / w); return; }
      state = 0; stateK = clamp01(local / flickStep);
      return;
    }
    const s = fract(t / period + phase) * period;
    if (s < onDur) { state = 0; stateK = clamp01(s / onDur); return; }
    if (s < onDur + warnDur) { state = 1; stateK = clamp01((s - onDur) / warnDur); return; }
    state = 2; stateK = clamp01((s - onDur - warnDur) / offDur);
  }

  function visualScale() {
    if (mode === 'crumble') return state === 3 ? 0 : 1;
    if (state !== 2) return 1;
    const el = stateK * (mode === 'flicker' ? flickStep : offDur);
    const total = (mode === 'flicker' ? flickStep : offDur);
    const fo = Math.min(FADE_OUT, total * 0.4);
    const fi = Math.min(FADE_IN, total * 0.45);
    if (el < fo) return 1 - smooth(el / fo) * 0.98;
    const back = total - el;
    if (back < fi) return 0.02 + 0.98 * Math.min(1.13, easeOutBack(1 - back / fi));
    return 0.02;
  }

  // =========================================================================
  //  presentation
  // =========================================================================
  const _warnColor = new THREE.Color();
  const _tmpColor = new THREE.Color();

  function applySkins(t, vis, warnK) {
    const strobe = warnK > 0
      ? 0.5 + 0.5 * Math.sin(TAU * (3 * warnK * warnDur + 6 * warnK * warnK * warnDur))
      : 0;
    for (let i = 0; i < skins.length; i++) {
      const sk = skins[i];
      const mat = sk.mat;
      mat.opacity = vis;
      mat.depthWrite = vis > 0.985;
      if (mat.color) {
        _tmpColor.copy(sk.baseColor).lerp(cWarn, warnK * 0.62);
        mat.color.copy(_tmpColor);
      }
      if (mat.emissive) {
        _warnColor.copy(sk.baseEmissive).lerp(cWarn, warnK);
        mat.emissive.copy(_warnColor);
        const idle = sk.trim ? (sk.baseEI * (0.86 + 0.16 * Math.sin(t * 2.3 + i))) : sk.baseEI;
        mat.emissiveIntensity = idle + warnK * (1.2 + strobe * 5.4) * (sk.trim ? 1 : 0.42);
      }
    }
    warnMat.opacity = vis;
    warnMat.emissiveIntensity = 0.05 + warnK * (1.0 + strobe * 8.5);
  }

  function updateFlakes() {
    if (!flakeMesh) return;
    const show = (state === 1);
    flakeMesh.visible = show;
    if (!show) return;
    const W = (mode === 'crumble') ? CRACK : ((mode === 'flicker') ? Math.min(0.16, flickStep * 0.42) : warnDur);
    const el = stateK * W;
    for (let i = 0; i < FLAKES; i++) {
      const o = i * 7;
      const birth = (i / FLAKES) * W * 0.72;
      const e = el - birth;
      if (e <= 0) {
        _mat4.makeScale(0, 0, 0);
        flakeMesh.setMatrixAt(i, _mat4);
        continue;
      }
      _q.setFromAxisAngle(_UP, flakeSeed[o + 4] + flakeSeed[o + 5] * e);
      _q2.setFromAxisAngle(_XAXIS, flakeSeed[o + 5] * e * 0.8);
      _q.multiply(_q2);
      _a.set(
        flakeSeed[o + 0] + flakeSeed[o + 2] * e,
        -size[1] * 0.5 - 0.5 * 11.0 * e * e,
        flakeSeed[o + 1] + flakeSeed[o + 3] * e
      );
      const sc = flakeSeed[o + 6] * clamp01(1 - e / (W * 1.6));
      _scl.set(sc, sc, sc);
      _mat4.compose(_a, _q, _scl);
      flakeMesh.setMatrixAt(i, _mat4);
    }
    flakeMesh.instanceMatrix.needsUpdate = true;
  }

  function updateChunks() {
    if (!chunkMesh) return;
    const show = (state === 3);
    chunkMesh.visible = show;
    if (!show) return;
    const e = stateK * CHUNK_LIFE;
    for (let i = 0; i < CHUNKS; i++) {
      const o = i * 8;
      _a.set(
        chunkSeed[o + 0] + chunkSeed[o + 2] * e,
        chunkSeed[o + 3] * e - 0.5 * 24.0 * e * e,
        chunkSeed[o + 1] + chunkSeed[o + 4] * e
      );
      _q.setFromAxisAngle(_UP, chunkSeed[o + 5] * e * 0.5);
      _q2.setFromAxisAngle(_TUMBLE, chunkSeed[o + 6] * e);
      _q.multiply(_q2);
      const sc = chunkSeed[o + 7] * clamp01(1.25 - stateK * 1.25);
      _scl.set(sc, sc, sc);
      _mat4.compose(_a, _q, _scl);
      chunkMesh.setMatrixAt(i, _mat4);
    }
    chunkMesh.instanceMatrix.needsUpdate = true;
    if (hz.__chunkMat) hz.__chunkMat.opacity = clamp01(1.35 - stateK * 1.35);
  }

  function updateGhost(t, vis) {
    const gone = clamp01(1 - vis * 1.15);
    let ret = 0;
    if (state === 2) {
      const total = (mode === 'flicker' ? flickStep : offDur);
      const back = total - stateK * total;
      ret = clamp01(1 - back / Math.max(0.08, Math.min(0.9, total * 0.5)));
    }
    const pulse = 0.28 + 0.30 * Math.sin(t * (5 + ret * 26)) * (0.4 + ret);
    ghostMat.opacity = gone * clamp01(0.22 + pulse * 0.7);
    bracketMat.opacity = gone * clamp01(0.34 + ret * 0.6);
    bracketMat.emissiveIntensity = 1.6 + ret * 5.5;
    ghostGroup.visible = gone > 0.02;
  }

  // =========================================================================
  //  crumble trigger
  // =========================================================================
  function tryTrigger(t) {
    if (mode !== 'crumble' || trigT !== null) return;
    trigT = t;
    hazSfx(ctx, 'vanish', { pos: origin, gain: 0.6 });
  }
  /** CONTRACT §21: Course calls onStand(player, collider) on the stand transition. */
  hz.onStand = function () { tryTrigger(hz.time); };
  /** A pound breaks a crumble tile instantly (no crack delay to wait through). */
  hz.onPound = function () {
    if (mode !== 'crumble') return;
    if (trigT === null) trigT = hz.time - CRACK;
    else if (hz.time - trigT < CRACK) trigT = hz.time - CRACK;
  };
  hz.onTouch = function () {};
  hz.trigger = function (t) { tryTrigger(num(t, hz.time)); };

  /**
   * A crumble tile breaks from a STAND — feet on its deck, ground contact reported — and
   * from nothing else: never from a fly-over, a walk underneath or a respawn teleport.
   * Course.update() fires onStand on the transition; this is the fallback for a host that
   * never wires the hook, and asks the same question through the kit's standingOn().
   */
  function selfDetectStand(t, player) {
    if (mode !== 'crumble' || trigT !== null) return;
    if (standingOn(resolvePlayer(ctx, player), hz.colliders, 0.12)) tryTrigger(t);
  }

  // =========================================================================
  //  update / reset / dispose
  // =========================================================================
  let bpFailed = false;
  function refreshBroad(c) {
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.refresh !== 'function') return;
    try { ctx.broadphase.refresh(c); } catch (err) { bpFailed = true; }
  }

  function onTransition(t, from, to, player) {
    if (from < 0) return;
    if (to === 2 || to === 3) {
      if (t < _lastVanishSfx) _lastVanishSfx = -1e9;
      if (t - _lastVanishSfx > 0.07) {
        _lastVanishSfx = t;
        let vol = 0.5;
        const p = resolvePlayer(ctx, player);
        if (p) {
          const dd = p.pos.distanceTo(origin);
          if (dd > 34) return;
          vol = 0.62 * clamp01(1 - dd / 34);
        }
        hazSfx(ctx, 'vanish', { pos: origin, gain: vol, rate: to === 3 ? 0.78 : 1.0 });
      }
      _c.copy(origin); _c.y += size[1] * 0.5;
      hazBurst(ctx, 'dust', _c, { count: to === 3 ? 16 : 9, spread: Math.max(size[0], size[2]) * 0.45 });
    }
  }

  hz.update = function (t, dt, player) {
    hz.time = t;
    selfDetectStand(t, player);
    evalState(t);

    const vis = visualScale();
    const warnK = (state === 1) ? stateK : 0;

    const sc = Math.max(0.0001, vis);
    slab.scale.set(sc, Math.max(0.0001, 0.10 + 0.90 * sc), sc);
    slab.visible = vis > 0.012;
    applySkins(t, clamp01(vis), warnK);

    if (warnK > 0) {
      const j = warnK * warnK * 0.055;
      shell.position.set(
        Math.sin(t * 51.3 + seed) * j,
        Math.sin(t * 43.7 + seed * 1.7) * j * 0.8,
        Math.cos(t * 47.1 + seed * 2.3) * j
      );
      shell.rotation.z = Math.sin(t * 39.0 + seed) * j * 0.14;
    } else if (shell.position.lengthSq() !== 0 || shell.rotation.z !== 0) {
      shell.position.set(0, 0, 0);
      shell.rotation.z = 0;
    }

    updateFlakes();
    updateChunks();
    updateGhost(t, clamp01(vis));

    // SOLID IFF IT READS SOLID
    const solid = (state === 0) || (state === 1) || (state === 2 && vis >= 0.9);
    for (let i = 0; i < hz.colliders.length; i++) {
      const c = hz.colliders[i];
      c.active = solid;
      refreshBroad(c);
    }

    if (state !== lastState) { onTransition(t, lastState, state, player); lastState = state; }
  };

  hz.reset = function (t) {
    trigT = null;
    lastState = -1;
    shell.position.set(0, 0, 0);
    shell.rotation.z = 0;
    if (chunkMesh) chunkMesh.visible = false;
    if (flakeMesh) flakeMesh.visible = false;
    if (hz.__chunkMat) hz.__chunkMat.opacity = 1;
    hz.update(num(t, 0), 0, null);
    lastState = state;
  };

  hz.velocityAtPoint = function (p, out) { return out.set(0, 0, 0); };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    if (chunkMesh) { try { chunkMesh.dispose(); } catch (err) { /* ignore */ } }
    if (flakeMesh) { try { flakeMesh.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0; skins.length = 0;
    if (plat && typeof plat.dispose === 'function') { try { plat.dispose(); } catch (err) { /* ignore */ } }
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  hz.update(0, 0, null);
  lastState = state;
  return hz;
}

export default vanish;
