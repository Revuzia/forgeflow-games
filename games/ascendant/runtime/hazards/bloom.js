// =============================================================================
//  ASCENDANT — runtime/hazards/bloom.js
//  WORLD 5 (PRISM CROWN) trap B: COLOUR BLOOM — an expanding shockwave ring.
//  LOW class rolls along the deck (jump it); HIGH class hangs overhead (duck).
//
//  DETERMINISM LAW (CONTRACT §16): the ring is closed-form in the stage clock —
//      tau = ((t / period) + phase) mod 1
//      r   = SPEED_BY_BAND[band] * tau * period   while r <= rmax, else dormant
//  reset(t) is update(t, 0). No Math.random() anywhere.
//
//  KILLS: n = clamp(ceil(2*pi*r / 1.2), 12, 64) SPHERES re-spaced around the
//  circumference EVERY update (sphere kills are engine-native — the pendulum
//  ball precedent). 1.2 m spacing vs kill r >= 0.26 plus player r 0.35 gives
//  0.61 m combined reach > 0.60 half-spacing, so adjacent spheres always
//  overlap the capsule — design 0's fixed-16 phantom-gap bug is structurally
//  impossible at any radius.
//    LOW : sphere r = clamp(ringW*0.6, 0.26, 0.30), ONE row centred at
//          deck + (ringH - killR): band top = ringH <= 1.1 vs full-hold apex
//          2.09 m, and the shortest legal capsule (crouch 1.05, r 0.35) spans
//          feet+0.35..feet+0.70, so any grounded body meets the 0.70 centre
//          at dy 0 — the deck stays sealed by a single row, and the sphere
//          count stays = n (the _trapmath count law). The 0.30 CAP is the
//          jump guarantee's other half (design §5 acceptance: body airborne
//          at LOW-ring arrival SURVIVES): lethal radial band = 2*(killR +
//          0.35) = 1.3 m = 0.433 s at the 3.0 m/s bands < 0.44 s of
//          feet-above-band airtime. The old max(ringW*0.6, ringH*0.5) = 0.5
//          made that 1.7 m = 0.567 s — a stationary full-hold jump died at
//          EVERY lead (rainbow-1 B1 teacher, 11/11, 2026-09-15).
//    HIGH: FIXED numbers, no data override — band 1.25..2.75 m, spheres r 0.75
//          centred at deck + 2.00 m. Crouch 1.05 clears under with 0.20 m
//          margin; band top 2.75 > apex 2.09, so jumping over is structurally
//          impossible — the read is load-bearing, the margin generous.
//  `gaps` sectors (authored shadow behind cover) spawn NO kill spheres, and the
//  light visibly breaks around cover. Sector frame: 0 deg = +X, increasing
//  toward +Z, i.e. deg = atan2(z - p.z, x - p.x) — spheres are GENERATED in
//  this frame so data and kills can never disagree.
//
//  SPEED_BY_BAND is a game-wide LAW (brief §5, graft J2-3): monotonic
//  non-increasing with band, asserted at module scope; index.js SEMANTIC
//  refuses any per-def override.
//
//  GLARE (brief §3): hue rides the ring tube (cross-section <= ringW 0.5 m),
//  the HOT leading-edge thread (0.07 m) and pips; the housing and the deck
//  furniture are dark or etched (<= 0.35 emissive). No lit planes.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KillVolume } from '../world/collider.js';

// ---------------------------------------------------------------------------
// module-scope scratch
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

// global throttles so a court of emitters cannot machine-gun the mixer
let _lastTickSfx = -1e9;
let _lastWhooshSfx = -1e9;

// ---------------------------------------------------------------------------
// WORLD 5 palette + the speed LAW (single game-wide table — brief §3/§5)
// ---------------------------------------------------------------------------
/** Band 0..6 = red..violet. Slot position AND hue AND speed class in one index. */
export const BAND_HEX = Object.freeze([
  0xff5a4d, // 0 RED    — vermilion, deliberately held off HOT 0xff1044
  0xffa03c, // 1 ORANGE — pip/strip only (foundry accent is 0xff8a3c)
  0xf5e63d, // 2 YELLOW — lemon; GOLD signage stays text-on-post form
  0x3ddc84, // 3 GREEN  — trim only (MINT 0x18d69a = checkpoints keeps its form)
  0x38b6ff, // 4 BLUE
  0x4f6bff, // 5 INDIGO
  0x9a5cff, // 6 VIOLET — deep, far from finish lavender 0xd9b6ff
]);
export const HOT = 0xff1044;    // THE kill colour — every lethal leading edge
export const IVORY = 0xfff8e6;  // safe edges + the aperture frame you aim for
export const GOLD = 0xffc35c;   // teaching signs + embossed pips

/**
 * Game-wide band->speed LAW (m/s): red/orange 6.0, yellow/green 4.2,
 * blue/indigo/violet 3.0. Monotonic NON-INCREASING with band (graft J2-3) so
 * "warmer = faster" is one rule the player learns once. index.js SEMANTIC
 * refuses any stage data that implies a different mapping.
 */
export const SPEED_BY_BAND = Object.freeze([6.0, 6.0, 4.2, 4.2, 3.0, 3.0, 3.0]);
for (let i = 1; i < SPEED_BY_BAND.length; i++) {
  if (SPEED_BY_BAND[i] > SPEED_BY_BAND[i - 1]) {
    throw new Error('bloom.js: SPEED_BY_BAND must be monotonic non-increasing with band (law §6-3)');
  }
}

// HIGH ring — fixed numbers, no override (brief §5): band 1.25..2.75 m.
const HIGH_KILL_R = 0.75;   // sphere radius => band = centre ± 0.75
const HIGH_CENTRE = 2.00;   // crouch 1.05 clears 1.25 by 0.20; apex 2.09 < 2.75

/** Kill-sphere spacing along the circumference (m) — see header maths. */
const SPACING = 1.2;
const MAX_SPHERES = 64;
const MIN_SPHERES = 12;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
function mod1(v) { return ((v % 1) + 1) % 1; }

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
    panel: { color: 0x59636f, roughness: 0.54, metalness: 0.58 },
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
//  bloom(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'bloom', p, rmax, period, band:0..6, ring?:'low'|'high',
 *                      ringH? (1.0, low only), ringW? (0.5), gaps?:[{fromDeg,toDeg}],
 *                      quiet? (1.2), phase? (0..1)}
 *   `p` is the EMITTER CENTRE ON THE DECK. `period` must be >= rmax/speed + quiet
 *   (all seconds — index.js SEMANTIC enforces; one emitter never stacks two rings).
 * @param {object} ctx {mats, theme, fx, audio, broadphase, ...} — all optional.
 */
export function bloom(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const origin = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const rmax = Math.max(0.5, num(def.rmax, 6));
  const band = clamp(Math.round(num(def.band, 4)), 0, 6);
  const speed = SPEED_BY_BAND[band];
  const ring = def.ring === 'high' ? 'high' : 'low';
  // low band height clamped to 1.1 here too: the factory must never out-build
  // the jump guarantee even if a def slips past validation.
  const ringH = ring === 'high' ? (HIGH_KILL_R * 2) : clamp(num(def.ringH, 1.0), 0.2, 1.1);
  const ringW = Math.max(0.1, num(def.ringW, 0.5));
  const quiet = Math.max(0, num(def.quiet, 1.2));
  const period = Math.max(0.2, num(def.period, rmax / speed + quiet));
  const phase = num(def.phase, 0);

  // LOW radial kill reach is BOUNDED (defect rainbow-1, 2026-09-15): a
  // stationary full-hold jump has only 0.44 s with feet above the 1.0 m band,
  // so the lethal band 2*(killR + player r 0.35) must stay <= 1.3 m = 0.433 s
  // at the slowest 3.0 m/s class — the old max(ringW*0.6, ringH*0.5) = 0.5
  // gave 1.7 m = 0.567 s, unsurvivable at every timing. Floor 0.26 keeps the
  // header's no-phantom-gap proof (0.26 + 0.35 = 0.61 > SPACING/2); like the
  // ringH clamp above, the factory holds both bounds even if a wide ringW
  // slips past validation. The row rides at ringH - killR so the band TOP
  // stays exactly ringH (jump margin unchanged); max(killR, ...) only guards
  // a degenerate authored ringH < 2*killR against a below-deck centre.
  const killR = ring === 'high' ? HIGH_KILL_R : clamp(ringW * 0.6, 0.26, 0.30);
  const killY = origin.y + (ring === 'high' ? HIGH_CENTRE : Math.max(killR, ringH - killR));

  /** Normalised shadow sectors [fromDeg, toDeg], 0..360 in the atan2 frame. */
  const gaps = [];
  if (Array.isArray(def.gaps)) {
    for (const g of def.gaps) {
      if (g && isFinite(g.fromDeg) && isFinite(g.toDeg) && g.toDeg > g.fromDeg) {
        gaps.push([clamp(g.fromDeg, 0, 360), clamp(g.toDeg, 0, 360)]);
      }
    }
  }
  function inGap(deg) {
    for (let i = 0; i < gaps.length; i++) if (deg >= gaps[i][0] && deg <= gaps[i][1]) return true;
    return false;
  }

  // --------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'bloom:' + ring;
  root.position.copy(origin);

  const hz = {
    kind: 'bloom', type: ring, def,
    mesh: root, colliders: [], kills: [],
    linVel: new THREE.Vector3(0, 0, 0),
    angVel: 0,
    angAxis: _UP.clone(),
    angCenter: origin.clone(),
    __mats: ownMats,
    /** live clock state for harness probes (_harness/_trapmath.mjs) */
    __debug: { tau: 0, r: 0, alive: false, n: 0 },
  };

  const hex = BAND_HEX[band];
  const matDark = getMat(ctx, 'obsidian');
  const ringMat = glowMat(ctx, hex, 3.2, ownMats, { base: 0x0a0812 });
  const hotMat = glowMat(ctx, HOT, 3.8, ownMats, { base: 0x06080c, metalness: 0.5 });
  const coreMat = glowMat(ctx, hex, 2.4, ownMats, { base: 0x0a0812 });
  const goldMat = glowMat(ctx, GOLD, 1.15, ownMats, { base: 0x0d0a08 });
  const etchMat = glowMat(ctx, IVORY, 0.35, ownMats, { base: 0x0b0e14, roughness: 0.6 });
  const crawlMat = glowMat(ctx, hex, 3.0, ownMats, { base: 0x0a0812 });

  // =========================================================================
  //  emitter housing + deck furniture (all static, all dark or etched)
  // =========================================================================
  {
    const structural = [];
    const body = new THREE.CylinderGeometry(0.42, 0.50, 0.34, 14);
    body.translate(0, 0.17, 0);
    structural.push(body);
    const collar = new THREE.TorusGeometry(0.40, 0.045, 6, 18);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 0.34, 0);
    structural.push(collar);
    root.add(partMesh(structural, matDark, D, true, true));

    // the lens — dims through the 0.6 s inhale before every pulse
    const lens = new THREE.CylinderGeometry(0.26, 0.30, 0.40, 12);
    lens.translate(0, 0.20, 0);
    root.add(partMesh([lens], coreMat, D, false, false));

    // N+1 embossed GOLD pips = speed class (graft J1-3): band 0 = 1 pip ...
    // band 6 = 7 pips — countable at distance, zero hue, zero motion.
    const pips = [];
    for (let i = 0; i <= band; i++) {
      const a = (i / (band + 1)) * TAU;
      const pg = chamferBox(0.09, 0.09, 0.09, 0.015);
      pg.translate(Math.cos(a) * 0.50, 0.24, Math.sin(a) * 0.50);
      pips.push(pg);
    }
    root.add(partMesh(pips, goldMat, D, false, false));

    // etched distance rings every 2 m (readability channel 6) + the sundial
    // tick-ring — a 0.35-intensity etch reads at night without adding glare.
    const etch = [];
    for (let d = 2; d <= rmax + 1e-6; d += 2) {
      const tg = new THREE.TorusGeometry(d, 0.018, 4, Math.max(24, Math.round(d * 10)));
      tg.rotateX(Math.PI / 2);
      tg.translate(0, 0.02, 0);
      etch.push(tg);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const tk = chamferBox(0.16, 0.03, 0.05, 0.008);
      tk.rotateY(-a);
      tk.translate(Math.cos(a) * 1.15, 0.03, Math.sin(a) * 1.15);
      etch.push(tk);
    }
    root.add(partMesh(etch, etchMat, D, false, true));
  }

  // the sundial crawler — one lit marker circling the tick-ring at the ring's
  // own clock (tau), so the pulse position reads even when the ring is occluded
  const crawler = new THREE.Mesh(chamferBox(0.16, 0.07, 0.10, 0.015), crawlMat);
  crawler.castShadow = false;
  D.push(crawler.geometry);
  root.add(crawler);

  // =========================================================================
  //  the ring — instanced tangential segments, constant tube cross-section
  //  (scaling one torus would grow the tube with r and blow the glare budget)
  // =========================================================================
  const tubeH = ring === 'high' ? 0.40 : 0.34;
  const tubeY = ring === 'high' ? HIGH_CENTRE : Math.min(ringH * 0.5, 0.55);
  const radW = Math.min(ringW, 0.5) * 0.6;

  const outerGeo = new THREE.BoxGeometry(1, tubeH, radW);
  D.push(outerGeo);
  const ringMesh = new THREE.InstancedMesh(outerGeo, ringMat, MAX_SPHERES);
  ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ringMesh.castShadow = false; ringMesh.frustumCulled = false;
  root.add(ringMesh);

  // HOT thread on the leading edge. For LOW it rides at ankle height, doubling
  // as the floor-contact read ("a low ring visibly touches the floor"); for
  // HIGH it rides the tube, leaving visible daylight beneath.
  const hotGeo = new THREE.BoxGeometry(1, 0.07, 0.07);
  D.push(hotGeo);
  const hotMesh = new THREE.InstancedMesh(hotGeo, hotMat, MAX_SPHERES);
  hotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  hotMesh.castShadow = false; hotMesh.frustumCulled = false;
  root.add(hotMesh);
  const hotY = ring === 'high' ? HIGH_CENTRE : 0.07;

  // second shape channel (law 6, colourblind-complete): chevron studs point UP
  // on low rings (= jump), pennant fins hang DOWN on high rings (= duck).
  const STUDS = 16;
  const studGeo = new THREE.ConeGeometry(0.10, 0.26, 4);
  if (ring === 'high') studGeo.rotateX(Math.PI); // point DOWN
  D.push(studGeo);
  const studMesh = new THREE.InstancedMesh(studGeo, ringMat, STUDS);
  studMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  studMesh.castShadow = false; studMesh.frustumCulled = false;
  root.add(studMesh);
  const studY = ring === 'high' ? (tubeY - tubeH / 2 - 0.16) : (tubeY + tubeH / 2 + 0.14);

  // =========================================================================
  //  kill spheres — pre-allocated, re-spaced every update
  // =========================================================================
  for (let i = 0; i < MAX_SPHERES; i++) {
    const kv = new KillVolume({ type: 'sphere', kind: 'laser', radius: killR, ref: null });
    kv.active = false;
    hz.kills.push(kv);
  }

  // =========================================================================
  //  update / reset / dispose  (pure in t; sfx edges are the only retained
  //  state and reset() clears them)
  // =========================================================================
  let lastToPulse = Infinity;   // for the T-0.4 s pitched tick
  let lastAlive = false;        // for the pulse-start whoosh

  function hideInstance(mesh, i) {
    _mat4.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, _mat4);
  }

  hz.update = function (t, dt) {
    const tau = mod1(t / period + phase);
    const r = speed * tau * period;
    const alive = r <= rmax + 1e-9;

    hz.__debug.tau = tau;
    hz.__debug.r = alive ? r : 0;
    hz.__debug.alive = alive;

    // ---- kills + ring segments, one pass -----------------------------------
    const n = alive ? clamp(Math.ceil(TAU * r / SPACING), MIN_SPHERES, MAX_SPHERES) : 0;
    hz.__debug.n = n;
    const arc = n > 0 ? Math.max(0.12, (TAU * r / n) * 1.12) : 0; // 12% overlap: no visual dashes
    for (let i = 0; i < MAX_SPHERES; i++) {
      const kv = hz.kills[i];
      if (i < n) {
        const deg = (i / n) * 360;
        if (inGap(deg)) {
          kv.active = false;
          hideInstance(ringMesh, i);
          hideInstance(hotMesh, i);
          continue;
        }
        const a = deg * Math.PI / 180;
        const cx = Math.cos(a), sz = Math.sin(a);
        kv.center.set(origin.x + cx * r, killY, origin.z + sz * r);
        kv.active = true;
        kv.update();
        // tangential segment (local to root): yaw carries +X onto the tangent
        _q.setFromAxisAngle(_UP, -a - Math.PI / 2);
        _a.set(cx * r, tubeY, sz * r);
        _scl.set(arc, 1, 1);
        _mat4.compose(_a, _q, _scl);
        ringMesh.setMatrixAt(i, _mat4);
        _a.set(cx * (r + radW * 0.7), hotY, sz * (r + radW * 0.7));
        _mat4.compose(_a, _q, _scl);
        hotMesh.setMatrixAt(i, _mat4);
      } else {
        kv.active = false;
        hideInstance(ringMesh, i);
        hideInstance(hotMesh, i);
      }
    }
    ringMesh.instanceMatrix.needsUpdate = true;
    hotMesh.instanceMatrix.needsUpdate = true;
    ringMesh.visible = hotMesh.visible = n > 0;

    // studs / fins ride the ring at fixed compass points
    studMesh.visible = n > 0;
    if (n > 0) {
      for (let i = 0; i < STUDS; i++) {
        const deg = (i / STUDS) * 360;
        if (inGap(deg)) { hideInstance(studMesh, i); continue; }
        const a = deg * Math.PI / 180;
        _q.setFromAxisAngle(_UP, -a);
        _a.set(Math.cos(a) * r, studY, Math.sin(a) * r);
        _scl.set(1, 1, 1);
        _mat4.compose(_a, _q, _scl);
        studMesh.setMatrixAt(i, _mat4);
      }
      studMesh.instanceMatrix.needsUpdate = true;
    }

    // ---- telegraphs ---------------------------------------------------------
    const toPulse = (1 - tau) * period;
    // inhale: the lens dims through the last 0.6 s before every pulse
    const inhale = toPulse < 0.6 ? (1 - toPulse / 0.6) : 0;
    coreMat.emissiveIntensity = 2.4 * (1 - 0.75 * inhale) + (alive ? 0.4 : 0);
    ringMat.emissiveIntensity = 3.2 + Math.sin(t * 7.3) * 0.25;

    // sundial crawler = the clock as POSITION
    {
      const a = tau * TAU;
      crawler.position.set(Math.cos(a) * 1.15, 0.05, Math.sin(a) * 1.15);
      crawler.rotation.y = -a;
    }

    // pitched tick at T-0.4 s: pitch rises with band, timbre differs by class
    if (lastToPulse > 0.4 && toPulse <= 0.4) {
      if (t < _lastTickSfx) _lastTickSfx = -1e9;
      if (t - _lastTickSfx > 0.05 && nearPlayer(34)) {
        _lastTickSfx = t;
        playSfx(ctx, 'tick', {
          pos: origin, vol: 0.5,
          rate: (ring === 'high' ? 0.72 : 1.0) + band * 0.12,
        });
      }
    }
    lastToPulse = toPulse;

    // outward-panning whoosh on pulse birth
    if (alive && !lastAlive) {
      if (t < _lastWhooshSfx) _lastWhooshSfx = -1e9;
      if (t - _lastWhooshSfx > 0.05 && nearPlayer(34)) {
        _lastWhooshSfx = t;
        playSfx(ctx, 'whoosh', { pos: origin, vol: 0.55, rate: 0.7 + band * 0.08 });
      }
    }
    lastAlive = alive;
  };

  function nearPlayer(dist) {
    if (!resolvePlayerPos(ctx, _c)) return true;
    return _c.distanceTo(origin) < dist;
  }

  hz.reset = function (t) {
    lastToPulse = Infinity;
    lastAlive = false;
    hz.update(num(t, 0), 0);
    // re-arm the edges to the state AT t so respawn never fires a stale sfx
    lastAlive = hz.__debug.alive;
  };

  hz.velocityAtPoint = function (p, out) { return out.set(0, 0, 0); };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    try { ringMesh.dispose(); } catch (err) { /* ignore */ }
    try { hotMesh.dispose(); } catch (err) { /* ignore */ }
    try { studMesh.dispose(); } catch (err) { /* ignore */ }
    for (const g of D) { try { g.dispose(); } catch (err) { /* ignore */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* ignore */ } }
    D.length = 0; ownMats.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  hz.update(0, 0);
  lastAlive = hz.__debug.alive;
  return hz;
}

export default bloom;
