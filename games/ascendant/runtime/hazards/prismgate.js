// =============================================================================
//  ASCENDANT — runtime/hazards/prismgate.js
//  WORLD 5 (PRISM CROWN) trap A: PRISM GATE — a travelling-aperture light wall.
//  "The window is the door": the lattice is lethal everywhere EXCEPT one
//  window.w x window.h aperture that slides between seven spectral slots.
//
//  DETERMINISM LAW (CONTRACT §16) — everything derives closed-form from t:
//      u  = ((t / period) + phase) mod 1
//      k  = floor(u * n)                     n = seq.length; current stop
//      f  = u * n - k                        0..1 within this stop
//      tf = travel / (dwell + travel)        travel is the FIRST tf of a stop
//      slot(b) = -(span - window.w)/2 + b * (span - window.w) / 6
//      centre  = f < tf ? lerp(slot(seq[k-1]), slot(seq[k]), smoothstep(f/tf))
//                       : slot(seq[k])       (holding dwell)
//  period MUST equal n * (dwell + travel) — index.js SEMANTIC enforces it to
//  1e-6 so the clock can never drift against the stop table. reset(t) is
//  update(t, 0). The slot formula uses window.w on BOTH axes (brief §4,
//  binding): seven fixed stops whichever entries seq visits.
//
//  KILLS: four axis-aligned box KillVolumes tiling the lattice plane around
//  the aperture, recomputed EVERY update via hz.kills; thickness s[0]. For the
//  house gate s=[0.4, 4.0, 12.0], window 1.6x2.2 at centre offset c:
//  LEFT z in [-6.0, c-0.8], RIGHT z in [c+0.8, +6.0], ABOVE y in
//  [p.y-2.0+2.2, p.y+2.0] over z in [c-0.8, c+0.8], BELOW zero-height when the
//  window sits on the deck (a degenerate box is DEACTIVATED, never left as the
//  1e-3 MIN_HALF sliver that would clip feet at the sill). The aperture
//  interior contributes NOTHING — a true pass-through. colliders:[] (meta
//  solid:false): a failed read is a death, never a wall-bonk ambiguity.
//
//  READABILITY (law 6 — complete without colour): lattice hue = current stop
//  and spectral order IS slot order; a travelling IVORY chevron frame marks the
//  aperture by shape+position; each slot column carries N+1 embossed GOLD pips
//  (zero hue, zero motion, countable at distance) and brightens 0.8 s before
//  the window slides there; every lethal filament carries a HOT 0xff1044 core;
//  a tick SFX marks each slide. (The metronome tower is GATE-COURT furniture
//  per brief §4-6 — it belongs to the stage lanes, not to this factory.)
//
//  GLARE (brief §3): filaments are 0.07 m wide at >= 0.60 m spacing, so the
//  lit area of the gate face is ~11% of its span (budget <= 18% — an open
//  lattice, never a lit wall). Hue rides filaments and pips only; the frame is
//  dark SMOKE-class structure.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KillVolume } from '../world/collider.js';
import { BAND_HEX, HOT, IVORY, GOLD } from './bloom.js';

// ---------------------------------------------------------------------------
// module-scope scratch
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;

const _c = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();

// global throttle so a relay of gates cannot machine-gun the mixer
let _lastTickSfx = -1e9;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function mod1(v) { return ((v % 1) + 1) % 1; }
function lerp(a, b, k) { return a + (b - a) * k; }
function smooth01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }

function readVec(src, out, dx, dy, dz) {
  if (Array.isArray(src) && src.length >= 3) out.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  else if (src && typeof src === 'object' && 'x' in src) out.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  else out.set(dx, dy, dz);
  return out;
}

// ---------------------------------------------------------------------------
// geometry kit (house pattern — each hazard module carries its own copies)
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
    obsidian: { color: 0x241f2e, roughness: 0.30, metalness: 0.42 }, // SMOKE-class dark cloudglass
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

function playSfx(ctx, name, opts) {
  try { if (ctx && ctx.audio && typeof ctx.audio.sfx === 'function') ctx.audio.sfx(name, opts); } catch (err) { /* ignore */ }
}
function resolvePlayerPos(ctx, out) {
  if (!ctx) return false;
  const p = ctx.player || (typeof ctx.getPlayer === 'function' ? ctx.getPlayer() : null) || (ctx.world ? ctx.world.player : null);
  if (p && p.pos && typeof p.pos.x === 'number') { out.set(p.pos.x, p.pos.y, p.pos.z); return true; }
  if (ctx.playerPos && typeof ctx.playerPos.x === 'number') { out.copy(ctx.playerPos); return true; }
  return false;
}

// =============================================================================
//  prismgate(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'prismgate', p, s:[d,h,w], period, seq:[0..6,...],
 *                      slots?:'z'|'y' ('z'), dwell? (2.4), travel? (0.5),
 *                      window?:{w (1.6), h (2.2)}, phase? (0..1),
 *                      relay?:{group, index}}
 *   `p` is the WALL CENTRE; the lattice plane faces +/-X (d = s[0] <= 0.5).
 *   For slots 'z' the window is bottom-seated (its sill IS the deck); for
 *   slots 'y' the window is z-centred and climbs the slot ladder.
 * @param {object} ctx {mats, theme, fx, audio, broadphase, ...} — all optional.
 */
export function prismgate(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const origin = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const th = Math.max(0.05, Math.abs(num(def.s && def.s[0], 0.4)));
  const H = Math.max(1.0, Math.abs(num(def.s && def.s[1], 4.0)));
  const W = Math.max(1.0, Math.abs(num(def.s && def.s[2], 12.0)));
  const slots = def.slots === 'y' ? 'y' : 'z';
  const dwell = Math.max(0.05, num(def.dwell, 2.4));
  const travel = Math.max(0.05, num(def.travel, 0.5));
  // factory fallback only — real stage data has seq validated in index.js
  // SEMANTIC (non-empty, integers 0..6, pitch/travel <= 6.4 m/s)
  const seq = (Array.isArray(def.seq) && def.seq.length)
    ? def.seq.map((b) => clamp(Math.round(num(b, 0)), 0, 6))
    : [0, 1, 2, 1];
  const n = seq.length;
  const period = Math.max(0.1, num(def.period, n * (dwell + travel)));
  const phase = num(def.phase, 0);
  const winW = Math.max(0.4, num(def.window && def.window.w, 1.6));
  const winH = Math.max(0.4, num(def.window && def.window.h, 2.2));

  const span = slots === 'z' ? W : H;                 // the axis the window rides
  const slotSpan = Math.max(0.01, span - winW);       // binding: window.w on BOTH axes
  const slotOf = (b) => -slotSpan / 2 + b * (slotSpan / 6);
  const tf = travel / (dwell + travel);

  // --------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'prismgate:' + slots;
  root.position.copy(origin);

  const hz = {
    kind: 'prismgate', type: slots, def,
    mesh: root, colliders: [], kills: [],
    linVel: new THREE.Vector3(0, 0, 0),
    angVel: 0,
    angAxis: new THREE.Vector3(0, 1, 0),
    angCenter: origin.clone(),
    __mats: ownMats,
    /** live clock state for harness probes (_harness/_trapmath.mjs) */
    __debug: { u: 0, k: 0, f: 0, c: 0 },
  };

  const matDark = getMat(ctx, 'obsidian');
  const latticeMat = glowMat(ctx, BAND_HEX[seq[0]], 3.2, ownMats, { base: 0x0a0812 });
  const coreMat = glowMat(ctx, HOT, 3.6, ownMats, { base: 0x06080c, metalness: 0.5 });
  const ivoryMat = glowMat(ctx, IVORY, 2.4, ownMats, { base: 0x0d0c0a });
  const pipMats = [];
  for (let b = 0; b < 7; b++) pipMats.push(glowMat(ctx, GOLD, 1.05, ownMats, { base: 0x0d0a08 }));

  // =========================================================================
  //  frame — dark structure, zero hue (glare law: hue on trim, never faces)
  // =========================================================================
  {
    const structural = [];
    for (let s = -1; s <= 1; s += 2) {
      const post = chamferBox(th * 1.6, H + 0.55, 0.24, 0.04);
      post.translate(0, 0, s * (W / 2 + 0.12));
      structural.push(post);
    }
    const header = chamferBox(th * 1.6, 0.24, W + 0.60, 0.04);
    header.translate(0, H / 2 + 0.14, 0);
    structural.push(header);
    const sill = chamferBox(th * 1.6, 0.24, W + 0.60, 0.04);
    sill.translate(0, -H / 2 - 0.14, 0);
    structural.push(sill);
    root.add(partMesh(structural, matDark, D, true, true));
  }

  // =========================================================================
  //  lattice — instanced filament columns, each drawn as up to TWO segments
  //  so the aperture band is a real hole while the rest of the column stays
  //  lit (and lethal). 0.07 m filaments at >= 0.60 m spacing = ~11% lit face.
  // =========================================================================
  const nCols = Math.max(2, Math.min(40, Math.floor(W / 0.62) + 1));
  const colZ = new Float32Array(nCols);
  {
    const inner = W - 0.24; // stay inside the posts
    for (let i = 0; i < nCols; i++) colZ[i] = -inner / 2 + (i / (nCols - 1)) * inner;
  }
  const SEGS = nCols * 2;

  const outerGeo = new THREE.BoxGeometry(0.07, 1, 0.07);
  D.push(outerGeo);
  const latticeMesh = new THREE.InstancedMesh(outerGeo, latticeMat, SEGS);
  latticeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  latticeMesh.castShadow = false; latticeMesh.frustumCulled = false;
  root.add(latticeMesh);

  // HOT core: 0.10 m deep in x so it pokes through both faces of the 0.07 m
  // filament — the kill colour reads from either approach direction.
  const coreGeo = new THREE.BoxGeometry(0.10, 1, 0.030);
  D.push(coreGeo);
  const coreMesh = new THREE.InstancedMesh(coreGeo, coreMat, SEGS);
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coreMesh.castShadow = false; coreMesh.frustumCulled = false;
  root.add(coreMesh);

  // =========================================================================
  //  aperture frame — travelling IVORY chevrons (shape + position channel)
  // =========================================================================
  const apGroup = new THREE.Group();
  root.add(apGroup);
  {
    const bars = [];
    const bt = 0.06;
    const top = chamferBox(bt, bt, winW + 0.16, 0.015);
    top.translate(0, winH / 2 + 0.05, 0);
    bars.push(top);
    const bot = chamferBox(bt, bt, winW + 0.16, 0.015);
    bot.translate(0, -winH / 2 - 0.05, 0);
    bars.push(bot);
    for (let s = -1; s <= 1; s += 2) {
      const side = chamferBox(bt, winH + 0.16, bt, 0.015);
      side.translate(0, 0, s * (winW / 2 + 0.05));
      bars.push(side);
      // chevrons: two ^ marks above and two v marks below — the frame reads as
      // a doorway even in silhouette
      for (let cs = -1; cs <= 1; cs += 2) {
        const cv = chamferBox(bt, 0.22, bt, 0.012);
        cv.rotateX(cs * s * Math.PI / 4);
        cv.translate(0, s * (winH / 2 + 0.20), cs * 0.075);
        bars.push(cv);
      }
    }
    apGroup.add(partMesh(bars, ivoryMat, D, false, false));
  }

  // =========================================================================
  //  slot pips — column b carries b+1 embossed GOLD pips (graft J1-3), on the
  //  sill for 'z' slots / on the near post for 'y' slots
  // =========================================================================
  for (let b = 0; b < 7; b++) {
    const pips = [];
    for (let j = 0; j <= b; j++) {
      const pg = chamferBox(0.10, 0.10, 0.10, 0.015);
      // embossed proud of the lattice face (x = th/2 + 0.06) so the count reads
      // in raking light; stacked at 0.16 m so 7 pips still fit under the window
      if (slots === 'z') pg.translate(th / 2 + 0.06, -H / 2 - 0.14 + j * 0.16, slotOf(b));
      else pg.translate(th / 2 + 0.06, slotOf(b), -W / 2 - 0.12 - j * 0.16);
      pips.push(pg);
    }
    root.add(partMesh(pips, pipMats[b], D, false, false));
  }

  // =========================================================================
  //  kill volumes — four boxes tiling the plane around the aperture
  // =========================================================================
  for (let i = 0; i < 4; i++) {
    const kv = new KillVolume({ type: 'box', kind: 'laser', ref: null });
    kv.active = false;
    hz.kills.push(kv);
  }

  /** Degenerate tiles (zero width/height) are DEACTIVATED — never a MIN_HALF sliver. */
  function setKillBox(kv, y0, y1, z0, z1) {
    const hy = (y1 - y0) / 2;
    const hzz = (z1 - z0) / 2;
    if (hy <= 1e-4 || hzz <= 1e-4) { kv.active = false; return; }
    kv.center.set(origin.x, origin.y + (y0 + y1) / 2, origin.z + (z0 + z1) / 2);
    kv.half.set(th / 2, hy, hzz);
    kv.active = true;
    kv.update();
  }

  // =========================================================================
  //  update / reset / dispose (pure in t; the sfx edge is the only retained
  //  state and reset() re-arms it)
  // =========================================================================
  let lastK = 0;

  hz.update = function (t, dt) {
    // ---- the clock (brief §4, verbatim) ------------------------------------
    const u = mod1(t / period + phase);
    const k = Math.min(n - 1, Math.floor(u * n));
    const f = u * n - k;
    const cur = slotOf(seq[k]);
    const prev = slotOf(seq[(k - 1 + n) % n]);
    const c = f < tf ? lerp(prev, cur, smooth01(f / tf)) : cur;
    hz.__debug.u = u; hz.__debug.k = k; hz.__debug.f = f; hz.__debug.c = c;

    // ---- aperture rect in lattice-local (y, z) -----------------------------
    let apY0, apY1, apZc;
    if (slots === 'z') { apY0 = -H / 2; apY1 = -H / 2 + winH; apZc = c; }
    else { apY0 = c - winH / 2; apY1 = c + winH / 2; apZc = 0; }

    // ---- kills: LEFT / RIGHT / ABOVE / BELOW -------------------------------
    if (slots === 'z') {
      setKillBox(hz.kills[0], -H / 2, H / 2, -W / 2, c - winW / 2);          // LEFT
      setKillBox(hz.kills[1], -H / 2, H / 2, c + winW / 2, W / 2);           // RIGHT
      setKillBox(hz.kills[2], apY1, H / 2, c - winW / 2, c + winW / 2);      // ABOVE
      setKillBox(hz.kills[3], -H / 2, apY0, c - winW / 2, c + winW / 2);     // BELOW (zero => off)
    } else {
      setKillBox(hz.kills[0], apY0, apY1, -W / 2, -winW / 2);                // LEFT of window band
      setKillBox(hz.kills[1], apY0, apY1, winW / 2, W / 2);                  // RIGHT of window band
      setKillBox(hz.kills[2], apY1, H / 2, -W / 2, W / 2);                   // ABOVE, full width
      setKillBox(hz.kills[3], -H / 2, apY0, -W / 2, W / 2);                  // BELOW, full width
    }

    // ---- lattice segments: a real hole where the aperture is ---------------
    const apHalf = winW / 2 + 0.055; // + filament half-width so no strand grazes the hole
    for (let i = 0; i < nCols; i++) {
      const inAp = Math.abs(colZ[i] - apZc) < apHalf;
      let a0, a1, b0, b1;
      if (inAp) { a0 = -H / 2; a1 = apY0; b0 = apY1; b1 = H / 2; }
      else { a0 = -H / 2; a1 = H / 2; b0 = 0; b1 = 0; }
      for (let j = 0; j < 2; j++) {
        const y0 = j === 0 ? a0 : b0;
        const y1 = j === 0 ? a1 : b1;
        const len = y1 - y0;
        const idx = i * 2 + j;
        if (len < 0.02) { _mat4.makeScale(0, 0, 0); }
        else {
          _pos.set(0, (y0 + y1) / 2, colZ[i]);
          _q.identity();
          _scl.set(1, len, 1);
          _mat4.compose(_pos, _q, _scl);
        }
        latticeMesh.setMatrixAt(idx, _mat4);
        coreMesh.setMatrixAt(idx, _mat4);
      }
    }
    latticeMesh.instanceMatrix.needsUpdate = true;
    coreMesh.instanceMatrix.needsUpdate = true;

    // ---- presentation -------------------------------------------------------
    apGroup.position.set(0, (apY0 + apY1) / 2, apZc);
    latticeMat.emissive.setHex(BAND_HEX[seq[k]]);            // hue = current stop
    latticeMat.emissiveIntensity = 3.2 + Math.sin(t * 6.1) * 0.25;
    ivoryMat.emissiveIntensity = 2.4 + (f < tf ? 1.2 : 0);   // frame flares while travelling

    // pips: the NEXT slot's column brightens 0.8 s before the window slides
    // there (during travel the ARRIVING column stays lit)
    const remaining = (1 - f) * (dwell + travel);
    const nextBand = f < tf ? seq[k] : seq[(k + 1) % n];
    const warm = f < tf ? 1 : (remaining <= 0.8 ? 1 - remaining / 0.8 : 0);
    for (let b = 0; b < 7; b++) {
      pipMats[b].emissiveIntensity = 1.05 + (b === nextBand ? warm * 2.4 : 0);
    }

    // tick per slide — fires on the stop change, rate keyed to the new band
    if (k !== lastK) {
      if (t < _lastTickSfx) _lastTickSfx = -1e9;
      if (t - _lastTickSfx > 0.05) {
        let vol = 0.45, near = true;
        if (resolvePlayerPos(ctx, _c)) {
          const dd = _c.distanceTo(origin);
          near = dd < 30;
          vol = 0.55 * (1 - Math.min(1, dd / 30));
        }
        if (near) {
          _lastTickSfx = t;
          playSfx(ctx, 'tick', { pos: origin, vol, rate: 0.85 + seq[k] * 0.10 });
        }
      }
      lastK = k;
    }
  };

  hz.reset = function (t) {
    hz.update(num(t, 0), 0);
    lastK = hz.__debug.k;   // never fire a stale tick on respawn
  };

  hz.velocityAtPoint = function (p, out) { return out.set(0, 0, 0); };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    try { latticeMesh.dispose(); } catch (err) { /* ignore */ }
    try { coreMesh.dispose(); } catch (err) { /* ignore */ }
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  hz.update(0, 0);
  lastK = hz.__debug.k;
  return hz;
}

export default prismgate;
