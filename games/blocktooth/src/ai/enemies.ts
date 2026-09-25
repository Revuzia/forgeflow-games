// BLOCKTOOTH — HALVARD CIVIL DEFENSE ground/air AI (ai lane, CONTRACT §5.3, §9).
// THREE-free, DOM-free, deterministic: randomness only from world.rng.ai (behaviour) and
// world.rng.spawn (ring placement, used by the director + recycling).
//
// Every kind has a distinct, readable behaviour (state names are what the foes-view animates):
//   android  enter → advance → hold (strafe at range) → aim → (pellet) → hold
//   squad    enter → advance (leader) / form (followers in a wedge) → hold → aim → volley ×3 → …
//   drone    enter → orbit (altitude 4 m → 0.8 H) → lock → dive (0.85 s circle tell) → climb → orbit
//   buggy    enter → drive (road grid) → strafe (circles via streets, rockets = 1.1 s circle tell)
//   apc      enter → drive → hold (pellet turret) → deploy (PICKET SQUAD, max 2) → hold | evade
//   tank     enter → crawl → hold → aim → tell (1.4 s lane) → reload → hold
//   walker   enter → walk → plant → hold → aim → barrage (3 lobbed 1.8 s circle tells) → hold | unplant/retreat
//   elite    enter → approach → aim → tell (1.6 s lane) → charge (30 m/s, contact dmg, smashes props) → recover
//
// Honesty (doctrine §2 / CONTRACT §9): each attack decision rolls ONE 300–800 ms reaction delay
// + an aim jitter (rng.ai) and latches them; pellets are slow; everything heavier paints the
// ground first. Hostile damage is × RANKS[titan.rank].hpMul at the moment the shot is spawned.
// Ground units never tunnel through buildings: they route along the street grid and are pushed
// out of every standing building (resolveCircleVsCity with canFlatten −1).

import type { CityLayout, Enemy, EnemyDef, EnemyKind, Telegraph, Tier, World } from '../core/types.ts';
import { CAMERA, CITY, ENEMY_AIM_LEAD, ENEMY_DMG_RANK_MUL, ENEMY_HP_PER_MIN, ENEMY_HP_RANK_MUL, ENEMY_REACH_H, RANKS, spawnView, titanSpeed } from '../core/config.ts';
import { TAU, clamp, dist, easeInCubic, headingOf, lerp, turnToward, wrapAngle } from '../core/math.ts';
import { newId } from '../core/world.ts';
import { ENEMIES } from '../data/enemies.ts';
import { buildingById, buildingsInRect, damageProp, propsInRect, resolveCircleVsCity } from '../city/citysim.ts';
import { spawnProjectile } from '../combat/projectiles.ts';
import { spawnTelegraph } from '../combat/telegraphs.ts';
import { damageTitanArea } from '../combat/damage.ts';

// ─────────────────────────────── lane-local tuning ───────────────────────────────
const REACT_MIN = 0.3, REACT_SPAN = 0.5;          // 300–800 ms reaction (§9)
const PELLET_SPEED: Record<string, number> = { android: 10, squad: 12, apc: 13 };
const VOLLEY_ROUNDS = 3, VOLLEY_GAP_S = 0.18;
/** GNAT dive tell (s). Was 0.6 s: a 0.25 s-reaction player on a slow titan could not step out of
 *  a lead-aimed circle in the 0.35 s left, so 51 % of dives landed on HEARTHBACK — paint noise, not
 *  a readable threat (PC-06). 0.85 s leaves ~0.6 s to walk the ~0.6 H it takes to clear. */
const DRONE_TELL_S = 0.85;
const ROCKET_TELL_S = 1.1, ROCKET_R = 3;
const TANK_TELL_S = 1.4, TANK_LANE_W = 2.5, TANK_RELOAD_S = 0.8;
const MORTAR_TELL_S = 1.8, MORTAR_R = 6, MORTAR_SHOTS = 3, MORTAR_GAP_S = 0.35;
const WALKER_PLANT_S = 0.8, WALKER_UNPLANT_S = 0.6;
const RAM_TELL_S = 1.6, RAM_LEN = 80, RAM_W = 8, RAM_SPEED = 30, RAM_RECOVER_S = 1.5;
const APC_DEPLOY_EVERY = 12, APC_DEPLOY_S = 1.2, APC_MAX_SQUADS = 2, SQUAD_SIZE = 5;
/** BULWARK deployments stop while this many squad members are already on the field (all sources). */
const SQUAD_FIELD_MAX = 90;
/** Enemies farther than this × the spawn ring are recycled back onto the ring (§9). The ring is one
 *  view height D·k (2026-09-24) and ringPoint lands spawns at ≤ (1.37 + 0.12) × 1.2 ≈ 1.79 D·k (the
 *  far screen corners), so 1.9 recycles only what the titan has left behind off-screen. (2.4 × the old
 *  0.55 D·k ring — at Size IV/V that was past the city edge, so nothing was ever recycled.) */
const RECYCLE_MUL = 1.9;
/** Knockback velocity decay (1/s, CONTRACT Enemy.kx comment: ~8/s). */
const KNOCK_DECAY = 8;
/** opts.elite on a regular kind (a "veteran"): hp multiplier. */
const VETERAN_HP_MUL = 4;
/** canFlatten −1: enemies are blocked by EVERY standing building (and tier-1 props). */
const NO_FLATTEN = -1 as unknown as Tier;
/** Wedge offsets per slot: [right, forward] metres relative to slot 0 (leader). */
const WEDGE: readonly (readonly [number, number])[] = [[0, 0], [-2.4, -2.2], [2.4, -2.2], [-4.8, -4.4], [4.8, -4.4]];

const ALERT_OF: Partial<Record<EnemyKind, 'contractors' | 'squads' | 'drones' | 'vehicles' | 'armor' | 'artillery'>> = {
  android: 'contractors', squad: 'squads', drone: 'drones', buggy: 'vehicles', apc: 'armor', tank: 'armor', walker: 'artillery',
};

// ─────────────────────────────── per-enemy AI memory ───────────────────────────────
interface AiMem {
  react: number;               // latched reaction delay for the current decision (s)
  arm: number;                 // countdown to a fire-while-moving shot (s), −1 = idle
  jx: number; jz: number;      // latched aim jitter (m)
  off: number;                 // lateral street offset (m): vehicles keep right, infantry spread
  side: number; sideT: number; // strafe / orbit direction ±1 and time until it may flip
  navT: number; navClear: number;
  shots: number; shotT: number;
  sub: number;                 // kind timer (apc deploy clock, walker retreat flag)
  tx: number; tz: number;      // latched target point (dive point, barrage centre)
  sx: number; sz: number; sy: number;  // latched start (drone dive)
  dir: number;                 // latched heading (tank lane / ram charge / barrage angle)
  travel: number; hit: number; // charge distance so far, contact landed
  sqA: number; sqB: number;    // apc: the squads it deployed (−1 = none)
  owner: number;               // squad member deployed by this apc id (−1 = director)
  tg: Telegraph | null;        // pending telegraph owned by this enemy (cancelled if it dies)
}
type AiEnemy = Enemy & { ai: AiMem };

function newMem(): AiMem {
  return {
    react: 0.5, arm: -1, jx: 0, jz: 0, off: 0, side: 1, sideT: 3, navT: 0, navClear: 0,
    shots: 0, shotT: 0, sub: 0, tx: 0, tz: 0, sx: 0, sz: 0, sy: 0, dir: 0, travel: 0, hit: 0,
    sqA: -1, sqB: -1, owner: -1, tg: null,
  };
}
function mem(e: Enemy): AiMem {
  const a = e as AiEnemy;
  if (!a.ai) a.ai = newMem();
  return a.ai;
}

const isVehicle = (k: EnemyKind) => k === 'buggy' || k === 'apc' || k === 'tank' || k === 'elite';
const hostile = (w: World, base: number) => base * RANKS[w.titan.rank].hpMul * (ENEMY_DMG_RANK_MUL[w.titan.rank] ?? 1);
/** Engagement range from the titan's SURFACE (m): the §9 range + ENEMY_REACH_H × titan height. */
const reach = (w: World, def: EnemyDef) => def.range + (ENEMY_REACH_H[def.kind] ?? 0) * w.titan.height;
/** Ground tells grow with the titan so they stay readable at the Size V camera (§9 honesty). */
const tellScale = (w: World, perH: number) => 1 + perH * w.titan.height;
const LEADP = { x: 0, z: 0 };
/** Where the titan will be after ENEMY_AIM_LEAD[rank] × `windup` seconds at its current velocity
 *  (capped at its walk speed so a dash never throws the aim), clamped to the city. */
function leadPt(w: World, windup: number): { x: number; z: number } {
  const T = w.titan, B = w.city.bounds;
  let vx = Number.isFinite(T.vx) ? T.vx : 0, vz = Number.isFinite(T.vz) ? T.vz : 0;
  const sp = Math.hypot(vx, vz), cap = 1.1 * titanSpeed(T.height);
  if (sp > cap) { vx *= cap / sp; vz *= cap / sp; }
  const s = (ENEMY_AIM_LEAD[T.rank] ?? 0) * Math.max(0, windup);
  LEADP.x = clamp(T.x + vx * s, B.minX, B.maxX);
  LEADP.z = clamp(T.z + vz * s, B.minZ, B.maxZ);
  return LEADP;
}

// ─────────────────────────────── spawn ring + street helpers ───────────────────────────────
/** Spawn ring radius (m): one view height D·k at the default-zoom view the camera shows (config
 *  spawnView — the run-long curve, widened + slid while a boss is alive, with the rig's own lag; zoom
 *  excluded so the sim stays deterministic), min 14 m. This is the nominal ring (director HUD data, recycle distance ×
 *  RECYCLE_MUL); ringPoint shapes it to the screen. */
export function ringRadius(w: World): number {
  const r = RING_VIEW_MUL * spawnView(w).d * CAM_K;
  return Number.isFinite(r) ? Math.max(14, r) : 14;
}
const CAM_K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
const RING_VIEW_MUL = 1.0;
/** margin (× D·k) added past the screen edge before the street snap. Small on purpose (was 0.12 with a
 *  ×1.02–1.2 radius): ringPoint now CHECKS each snapped candidate through the default-zoom camera
 *  (screenOut, the velocity lead included), so the ring only needs to start just past the edge — a
 *  further ring slowed the Size I economy (enemies walk in later). */
const RING_EDGE_MARGIN = 0.04;
const FP = { rank: -1, n: 0, f: 0, hn: 0, hf: 0, s: 0 };
/** Distance (in units of D·k) from the look target to the edge of the visible ground along world
 *  heading `a`, for the rank's camera pitch at a 16:9 screen (config RANKS.pitchDeg, CAMERA yaw) —
 *  the view footprint is a trapezoid: near edge ≈ 0.52, far edge ≈ 0.77, half-widths 0.74 / 1.10 at 54°. */
function footprintEdge(rank: number, a: number): number {
  if (FP.rank !== rank) {
    const al = (CAMERA.fovDeg * Math.PI) / 360, p = (RANKS[rank].pitchDeg * Math.PI) / 180, A = 16 / 9;
    const h = Math.sin(p), b = Math.cos(p), tw = A * Math.tan(al) * Math.cos(al);
    FP.n = (b - h / Math.tan(p + al)) / CAM_K;
    FP.f = (p - al > 0.05 ? h / Math.tan(p - al) - b : 4) / CAM_K;
    FP.hn = (h / Math.sin(p + al)) * tw / CAM_K;
    FP.hf = (p - al > 0.05 ? (h / Math.sin(p - al)) * tw : 4) / CAM_K;
    FP.s = (FP.hf - FP.hn) / (FP.n + FP.f);
    FP.rank = rank;
  }
  const yaw = (CAMERA.yawDeg * Math.PI) / 180, sa = Math.sin(a), ca = Math.cos(a);
  const v = -(sa * Math.sin(yaw) + ca * Math.cos(yaw));        // + = toward the top of the screen
  const u = Math.abs(sa * Math.cos(yaw) - ca * Math.sin(yaw));  // across the screen
  let t = v > 1e-6 ? FP.f / v : v < -1e-6 ? FP.n / -v : Infinity;
  const den = u - FP.s * v;
  if (den > 1e-6) t = Math.min(t, (FP.hn + FP.s * FP.n) / den);
  return Number.isFinite(t) ? t : FP.f;
}

/** Off-screen measure of a ground point for the DEFAULT-ZOOM camera (spawnView, the rank's pitch,
 *  fixed yaw, 16:9, the look target at CAMERA.targetYFrac·H plus the velocity lead the rig adds):
 *  max(|ndc x|, |ndc y|) of its projection — > 1 = off-screen (Infinity behind the camera). */
const SO = { rank: -1, ox: 0, oy: 0, oz: 0, ux: 0, uy: 0, uz: 0 };
const RIGHT_X = Math.cos((CAMERA.yawDeg * Math.PI) / 180), RIGHT_Z = -Math.sin((CAMERA.yawDeg * Math.PI) / 180);
const TAN_HALF_FOV = Math.tan((CAMERA.fovDeg * Math.PI) / 360);
const SCREEN_ASPECT = 16 / 9;
const LEAD_MAX_FRAC = 0.22;
function screenOut(w: World, D: number, x: number, z: number): number {
  const T = w.titan;
  if (SO.rank !== T.rank) {
    const p = (RANKS[T.rank].pitchDeg * Math.PI) / 180, yaw = (CAMERA.yawDeg * Math.PI) / 180;
    const cp = Math.cos(p), sp = Math.sin(p);
    SO.ox = cp * Math.sin(yaw); SO.oy = sp; SO.oz = cp * Math.cos(yaw);   // target → camera (unit)
    SO.ux = -sp * Math.sin(yaw); SO.uy = cp; SO.uz = -sp * Math.cos(yaw); // camera up
    SO.rank = T.rank;
  }
  let lx = (Number.isFinite(T.vx) ? T.vx : 0) * CAMERA.leadS, lz = (Number.isFinite(T.vz) ? T.vz : 0) * CAMERA.leadS;
  const lm = Math.hypot(lx, lz), lmax = LEAD_MAX_FRAC * D * CAM_K;
  if (lm > lmax) { lx *= lmax / lm; lz *= lmax / lm; }
  const ty = T.height * CAMERA.targetYFrac;
  const off = spawnView(w);
  const dx = x - (T.x + off.ox + lx + D * SO.ox), dy = -(ty + D * SO.oy), dz = z - (T.z + off.oz + lz + D * SO.oz);
  const depth = -(dx * SO.ox + dy * SO.oy + dz * SO.oz);
  if (!(depth > 0.1)) return Infinity;
  const sx = (dx * RIGHT_X + dz * RIGHT_Z) / depth, sy = (dx * SO.ux + dy * SO.uy + dz * SO.uz) / depth;
  return Math.max(Math.abs(sx) / (TAN_HALF_FOV * SCREEN_ASPECT), Math.abs(sy) / TAN_HALF_FOV);
}
/** a spawn point counts as off-screen when it is still past the edge after being pulled this far
 *  toward the titan (m): body radius + the director's cluster scatter (≤ 5 m) + slack */
const OFFSCREEN_PAD = 7;
/** ... and by at least this much in NDC (the camera eases; the frame edge is not a hard line) */
const OFFSCREEN_MIN = 1.03;
/** candidate spawn points per ringPoint call (all are judged; the nearest off-screen one wins) */
const SPAWN_TRIES = 8;

function roadIdx(v: number, origin: number, pitch: number, n: number): number {
  const i = Math.round((v - origin) / pitch);
  return i < 0 ? 0 : i > n ? n : i;
}
const corrHalf = (c: CityLayout) => c.roadW / 2 + c.sidewalkW;

/** Snap a point onto the street grid: vehicles onto a road lane, infantry onto road/sidewalk. */
function snapToStreet(c: CityLayout, x: number, z: number, vehicle: boolean, r01: number, out: { x: number; z: number }): void {
  const P = c.pitch, corr = corrHalf(c);
  const ix = roadIdx(x, c.originX, P, c.blocksX), jz = roadIdx(z, c.originZ, P, c.blocksZ);
  const rx = c.originX + ix * P, rz = c.originZ + jz * P;
  const x0 = c.originX, x1 = c.originX + c.blocksX * P, z0 = c.originZ, z1 = c.originZ + c.blocksZ * P;
  const lat = vehicle ? (r01 < 0.5 ? -1 : 1) * (c.roadW * 0.25) : (r01 * 2 - 1) * (corr - 1.5);
  const dxr = Math.abs(x - rx), dzr = Math.abs(z - rz);
  if (!vehicle && (dxr <= corr - 1 || dzr <= corr - 1)) { out.x = clamp(x, x0 - corr, x1 + corr); out.z = clamp(z, z0 - corr, z1 + corr); return; }
  if (dxr <= dzr) { out.x = rx + lat; out.z = clamp(z, z0, z1); }
  else { out.z = rz + lat; out.x = clamp(x, x0, x1); }
}

/**
 * A spawn point on the ring just off-screen (§9): vehicles snapped onto road lanes, infantry onto
 * streets/sidewalks, drones anywhere; inside the city bounds; never inside a building.
 * Uses world.rng.spawn. Returns false when only a clamped fallback could be found.
 */
export function ringPoint(w: World, kind: EnemyKind, out: { x: number; z: number }): boolean {
  const T = w.titan, c = w.city, B = c.bounds, def = ENEMIES[kind];
  const R = ringRadius(w), rs = w.rng.spawn;
  const view = spawnView(w);
  const Dk = view.d * CAM_K;
  const vehicle = isVehicle(kind);
  const moving = T.speed > 0.5;
  const vh = headingOf(T.vx, T.vz);
  const m = def.radius + 1;
  const D = Dk / CAM_K;
  // the ring is centred on the view (the titan, or the boss-framing look target while a boss is alive)
  const fcx = T.x + view.ox, fcz = T.z + view.oz;
  let bestX = NaN, bestZ = NaN, bestD = -1, bestR01 = 0.5;
  let ok = false, okX = 0, okZ = 0, okD = Infinity;
  // every candidate is tried; the NEAREST one that is off-screen wins (the street snap can throw a
  // point well past the edge — taking the first that clears the frame made Size I foes walk in late)
  for (let tries = 0; tries < SPAWN_TRIES; tries++) {
    const a = moving && rs() < 0.35 ? vh + (rs() - 0.5) * 2.2 : rs() * TAU;
    // just past the screen edge in this direction (§9 "spawn off-screen"), at least the 14 m ring; a
    // flier is not street-snapped, so its candidate also clears the pad the off-screen check pulls it
    // back by (else it never passes and falls back to a point on the frame edge)
    const edge = Math.max(14, (footprintEdge(T.rank, a) + RING_EDGE_MARGIN) * Dk + (def.flies ? OFFSCREEN_PAD : 0));
    const rr = edge * (1.0 + 0.08 * rs());
    let x = fcx + Math.sin(a) * rr, z = fcz + Math.cos(a) * rr;
    const r01 = def.flies ? 0.5 : rs();
    if (!def.flies) { snapToStreet(c, x, z, vehicle, r01, out); x = out.x; z = out.z; }
    if (x < B.minX + m || x > B.maxX - m || z < B.minZ + m || z > B.maxZ - m) {
      if (bestD < 0) { bestX = clamp(x, B.minX + m, B.maxX - m); bestZ = clamp(z, B.minZ + m, B.maxZ - m); bestD = 0; }
      continue;
    }
    // the street snap can pull a point back on-screen: judge the SNAPPED point through the
    // default-zoom camera (pulled OFFSCREEN_PAD toward the titan), not by its radius
    const d = dist(x, z, T.x, T.z);
    const k = d > OFFSCREEN_PAD ? 1 - OFFSCREEN_PAD / d : 0;
    const o = screenOut(w, D, T.x + (x - T.x) * k, T.z + (z - T.z) * k);
    const score = Math.min(o, 50);
    if (score > bestD) { bestD = score; bestX = x; bestZ = z; bestR01 = r01; }
    if (o >= OFFSCREEN_MIN && d < okD) { ok = true; okD = d; okX = x; okZ = z; }
  }
  if (ok) { bestX = okX; bestZ = okZ; }
  else if (bestD > 0 && Number.isFinite(bestX)) {
    // no candidate cleared the frame (the snap pulled them all back on-screen): walk the least-visible
    // one outward from the view centre, re-snapping onto the same street lane, until it does (no RNG)
    const ux = bestX - fcx, uz = bestZ - fcz, ul = Math.hypot(ux, uz) || 1;
    for (let step = 1; step <= 8; step++) {
      const rr = ul + step * 0.12 * Dk;
      let x = fcx + (ux / ul) * rr, z = fcz + (uz / ul) * rr;
      if (!def.flies) { snapToStreet(c, x, z, vehicle, bestR01, out); x = out.x; z = out.z; }
      if (x < B.minX + m || x > B.maxX - m || z < B.minZ + m || z > B.maxZ - m) break;
      const d = dist(x, z, T.x, T.z);
      const k = d > OFFSCREEN_PAD ? 1 - OFFSCREEN_PAD / d : 0;
      if (screenOut(w, D, T.x + (x - T.x) * k, T.z + (z - T.z) * k) >= OFFSCREEN_MIN) { bestX = x; bestZ = z; ok = true; break; }
    }
  }
  if (!Number.isFinite(bestX)) { bestX = clamp(T.x, B.minX + m, B.maxX - m); bestZ = clamp(T.z, B.minZ + m, B.maxZ - m); }
  out.x = bestX; out.z = bestZ;
  if (!def.flies) pushOutOfCity(c, out, def.radius);
  return ok;
}

const RES = { x: 0, z: 0, bumpTier: -1 };
function pushOutOfCity(c: CityLayout, p: { x: number; z: number }, r: number): number {
  RES.x = p.x; RES.z = p.z; RES.bumpTier = -1;
  if (!resolveCircleVsCity(c, p.x, p.z, r, NO_FLATTEN, RES)) return 0;
  if (!Number.isFinite(RES.x) || !Number.isFinite(RES.z)) return 0;
  const d = Math.hypot(RES.x - p.x, RES.z - p.z);
  p.x = RES.x; p.z = RES.z;
  return d;
}

// ─────────────────────────────── navigation (street grid) ───────────────────────────────
const bBuf: number[] = [];
/** Segment vs every standing building AABB (inflated by r). */
function lineClear(c: CityLayout, x0: number, z0: number, x1: number, z1: number, r: number): boolean {
  buildingsInRect(c, Math.min(x0, x1) - r, Math.min(z0, z1) - r, Math.max(x0, x1) + r, Math.max(z0, z1) + r, bBuf);
  const dx = x1 - x0, dz = z1 - z0;
  for (let i = 0; i < bBuf.length; i++) {
    const b = buildingById(c, bBuf[i]);
    if (!b || b.collapsed || b.alive <= 0) continue;
    const minx = b.x - b.w / 2 - r, maxx = b.x + b.w / 2 + r, minz = b.z - b.d / 2 - r, maxz = b.z + b.d / 2 + r;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < minx || x0 > maxx) continue; }
    else {
      let ta = (minx - x0) / dx, tb = (maxx - x0) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < minz || z0 > maxz) continue; }
    else {
      let ta = (minz - z0) / dz, tb = (maxz - z0) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    bBuf.length = 0;
    return false;
  }
  bBuf.length = 0;
  return true;
}

/**
 * Manhattan routing on the road grid: leave a block interior by the nearest street, run along
 * the current road to an intersection that lies toward the goal, turn, repeat; drive on the right
 * (vehicles) or spread across road + sidewalk (infantry) via `off`.
 */
function streetWaypoint(c: CityLayout, x: number, z: number, gx: number, gz: number, off: number, out: { x: number; z: number }): void {
  const P = c.pitch, corr = corrHalf(c);
  const ix = roadIdx(x, c.originX, P, c.blocksX), jz = roadIdx(z, c.originZ, P, c.blocksZ);
  const rx = c.originX + ix * P, rz = c.originZ + jz * P;
  const dxr = x - rx, dzr = z - rz;
  const onV = Math.abs(dxr) <= corr, onH = Math.abs(dzr) <= corr;
  const gi = roadIdx(gx, c.originX, P, c.blocksX), gj = roadIdx(gz, c.originZ, P, c.blocksZ);
  if (!onV && !onH) {
    if (Math.abs(dxr) <= Math.abs(dzr)) { out.x = rx; out.z = z; } else { out.x = x; out.z = rz; }
    return;
  }
  let alongV: boolean, tgt: number;
  if (onV && onH) {
    if (gi !== ix) { alongV = false; tgt = c.originX + (ix + Math.sign(gi - ix)) * P; }
    else if (gj !== jz) { alongV = true; tgt = c.originZ + (jz + Math.sign(gj - jz)) * P; }
    else { out.x = gx; out.z = gz; return; }
  } else if (onV) {
    alongV = true;
    if (gi === ix) tgt = gz;
    else {
      const s = Math.sign(gz - z) || 1;
      let j = jz;
      if ((c.originZ + j * P - z) * s < -corr) j += s;
      tgt = c.originZ + clamp(j, 0, c.blocksZ) * P;
    }
  } else {
    alongV = false;
    if (gj === jz) tgt = gx;
    else {
      const s = Math.sign(gx - x) || 1;
      let i = ix;
      if ((c.originX + i * P - x) * s < -corr) i += s;
      tgt = c.originX + clamp(i, 0, c.blocksX) * P;
    }
  }
  if (alongV) { const s = Math.sign(tgt - z) || 1; out.x = rx - s * off; out.z = tgt; }
  else { const s = Math.sign(tgt - x) || 1; out.x = tgt; out.z = rz + s * off; }
}

const WP = { x: 0, z: 0 };
/** Resolve the next waypoint toward (gx,gz) into WP (direct when the line is clear). */
function nav(w: World, e: AiEnemy, gx: number, gz: number): void {
  const ai = e.ai;
  const vehicle = isVehicle(e.kind);
  ai.navT -= w.dt;
  if (ai.navT <= 0) {
    ai.navT = 0.35 + 0.01 * (e.id % 10);
    const d = dist(e.x, e.z, gx, gz);
    ai.navClear = d < (vehicle ? 80 : 260) && lineClear(w.city, e.x, e.z, gx, gz, e.radius * 0.8) ? 1 : 0;
  }
  if (ai.navClear) { WP.x = gx; WP.z = gz; return; }
  streetWaypoint(w.city, e.x, e.z, gx, gz, ai.off, WP);
}

// ─────────────────────────────── locomotion ───────────────────────────────
function halt(e: Enemy): void { e.vx = 0; e.vz = 0; }
function face(e: Enemy, x: number, z: number, turn: number, dt: number): void {
  const dx = x - e.x, dz = z - e.z;
  if (dx * dx + dz * dz > 1e-6) e.heading = turnToward(e.heading, Math.atan2(dx, dz), turn * dt);
}
/** Legged / hover: velocity straight at the waypoint, heading follows. */
function walk(e: Enemy, wx: number, wz: number, speed: number, dt: number, turn = 9): void {
  const dx = wx - e.x, dz = wz - e.z, d = Math.hypot(dx, dz);
  if (d < 1e-3) { halt(e); return; }
  const v = speed * Math.min(1, d / 1.5);
  e.vx = (dx / d) * v; e.vz = (dz / d) * v;
  e.heading = turnToward(e.heading, Math.atan2(dx, dz), turn * dt);
}
/** Wheeled / tracked: turn-rate-limited heading, slows to turn, moves along its nose. */
function drive(e: Enemy, wx: number, wz: number, speed: number, turn: number, dt: number): void {
  const dx = wx - e.x, dz = wz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.6) { halt(e); return; }
  const want = Math.atan2(dx, dz);
  e.heading = turnToward(e.heading, want, turn * dt);
  const off = Math.abs(wrapAngle(want - e.heading));
  const f = off > 1.3 ? 0.15 : Math.max(0.2, Math.cos(off));
  const v = speed * f * Math.min(1, d / 4);
  e.vx = Math.sin(e.heading) * v; e.vz = Math.cos(e.heading) * v;
}
/** Strafe around the titan at a preferred surface distance (infantry). */
function holdRing(w: World, e: AiEnemy, sp: number, range: number, dt: number): void {
  const T = w.titan, ai = e.ai;
  const dx = e.x - T.x, dz = e.z - T.z, d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  const sd = d - T.radius - e.radius;
  let radial = 0;
  if (sd < range * 0.45) radial = 0.75; else if (sd > range * 0.95) radial = -0.5;
  ai.sideT -= dt;
  if (ai.sideT <= 0) { ai.side = -ai.side; ai.sideT = 2 + 3 * w.rng.ai(); }
  const tx = -nz * ai.side, tz = nx * ai.side;
  e.vx = (tx * 0.35 + nx * radial) * sp; e.vz = (tz * 0.35 + nz * radial) * sp;
  face(e, T.x, T.z, 8, dt);
}
const surfDist = (w: World, e: Enemy) => dist(e.x, e.z, w.titan.x, w.titan.z) - w.titan.radius - e.radius;

// ─────────────────────────────── separation grid (cheap, local) ───────────────────────────────
const SEP_CELL = 8, SEP_BITS = 11, SEP_MASK = (1 << SEP_BITS) - 1;
const sepHeads = new Int32Array(1 << SEP_BITS);
let sepNext = new Int32Array(512), sepMark = new Int32Array(512);
const sepItems: AiEnemy[] = [];
let sepStamp = 0;
const sepHash = (cx: number, cz: number) => ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) & SEP_MASK;

function buildSep(w: World): void {
  sepHeads.fill(-1);
  sepItems.length = 0;
  const es = w.enemies;
  for (let i = 0; i < es.length; i++) if (es[i].alive) sepItems.push(es[i] as AiEnemy);
  if (sepItems.length > sepNext.length) {
    let cap = sepNext.length;
    while (cap < sepItems.length) cap *= 2;
    sepNext = new Int32Array(cap); sepMark = new Int32Array(cap); sepStamp = 0;
  }
  for (let k = 0; k < sepItems.length; k++) {
    const e = sepItems[k];
    const h = sepHash(Math.floor(e.x / SEP_CELL), Math.floor(e.z / SEP_CELL));
    sepNext[k] = sepHeads[h]; sepHeads[h] = k; sepMark[k] = 0;
  }
}

function separate(e: AiEnemy): void {
  if (++sepStamp > 0x3fffffff) { sepStamp = 1; sepMark.fill(0); }
  const cx = Math.floor(e.x / SEP_CELL), cz = Math.floor(e.z / SEP_CELL);
  const air = e.kind === 'drone';
  let sx = 0, sz = 0;
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
    let i = sepHeads[sepHash(cx + ox, cz + oz)];
    while (i >= 0) {
      const o = sepItems[i];
      const seen = sepMark[i] === sepStamp;
      sepMark[i] = sepStamp;
      i = sepNext[i];
      if (seen || o === e || !o.alive || (o.kind === 'drone') !== air) continue;
      const dx = e.x - o.x, dz = e.z - o.z, rr = e.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2), ov = rr - d;
      const share = (o.radius * o.radius) / (e.radius * e.radius + o.radius * o.radius);
      if (d > 1e-5) { sx += (dx / d) * ov * share; sz += (dz / d) * ov * share; }
      else { const a = (e.id - o.id) * 2.399; sx += Math.sin(a) * ov * 0.5; sz += Math.cos(a) * ov * 0.5; }
    }
  }
  const m = Math.hypot(sx, sz);
  if (m < 1e-6) return;
  const cap = e.radius * 0.6 + 0.2;
  const k = 0.5 * (m > cap ? cap / m : 1);
  e.x += sx * k; e.z += sz * k;
}

// ─────────────────────────────── per-tick shared tables ───────────────────────────────
const sqLeader = new Map<number, AiEnemy>();
const sqCount = new Map<number, number>();
/** alive totals at the start of this tick's stepEnemies (deploy guard vs CITY.maxEnemies) */
const fieldCount = { all: 0, squad: 0 };
const pendingByWorld = new WeakMap<World, AiEnemy[]>();
function pendingOf(w: World): AiEnemy[] {
  let p = pendingByWorld.get(w);
  if (!p) { p = []; pendingByWorld.set(w, p); }
  return p;
}
function holdTelegraph(w: World, e: AiEnemy, tg: Telegraph): void {
  e.ai.tg = tg;
  pendingOf(w).push(e);
}

// ─────────────────────────────── weapons ───────────────────────────────
function startReact(w: World, e: AiEnemy): void {
  const ai = e.ai, T = w.titan, r = w.rng.ai;
  ai.react = REACT_MIN + REACT_SPAN * r();
  const j = 0.4 + 0.45 * T.radius;
  ai.jx = (r() * 2 - 1) * j; ai.jz = (r() * 2 - 1) * j;
}

function firePellet(w: World, e: Enemy, kind: 'pellet' | 'volley', speed: number, dmgBase: number, tx: number, tz: number): void {
  const T = w.titan;
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const x = e.x + ux * (e.radius + 0.25), z = e.z + uz * (e.radius + 0.25);
  spawnProjectile(w, {
    owner: 'enemy', kind, x, z, y: e.y + e.height * 0.65,
    vx: ux * speed, vz: uz * speed, dmg: hostile(w, dmgBase),
    life: Math.min(6, (d + 2 * T.radius + 6) / speed),
  });
  e.aimX = tx; e.aimZ = tz;
  w.events.push({ type: 'enemyFire', id: e.id, kind: e.kind, x: e.x, z: e.z, tx, tz });
}

function fireLob(w: World, e: Enemy, kind: 'rocket' | 'mortar', dmgBase: number, tx: number, tz: number, aoe: number, life: number): void {
  const B = w.city.bounds;
  tx = clamp(tx, B.minX, B.maxX); tz = clamp(tz, B.minZ, B.maxZ);
  spawnProjectile(w, {
    owner: 'enemy', kind, x: e.x, z: e.z, y: e.y + e.height * 0.9,
    vx: (tx - e.x) / life, vz: (tz - e.z) / life, dmg: hostile(w, dmgBase),
    lob: true, tx, tz, aoe, life,
  });
  e.aimX = tx; e.aimZ = tz;
  w.events.push({ type: 'enemyFire', id: e.id, kind: e.kind, x: e.x, z: e.z, tx, tz });
}

function setState(e: Enemy, s: string): void { e.state = s; e.t = 0; }

// ─────────────────────────────── spawn ───────────────────────────────
/**
 * Create an enemy at (x,z). HP × (1 + ENEMY_HP_PER_MIN · minutes); radius/height/flags from
 * ENEMIES; ground units are pushed out of buildings and clamped to the city bounds.
 * Emits `enemySpawn` and the first-appearance category alert.
 */
export function spawnEnemy(w: World, kind: EnemyKind, x: number, z: number, opts?: { squad?: number; slot?: number; elite?: boolean }): Enemy {
  const def = ENEMIES[kind];
  const T = w.titan, B = w.city.bounds, r = w.rng.ai;
  const elite = kind === 'elite' || opts?.elite === true;
  let hp = def.hp * (1 + ENEMY_HP_PER_MIN * Math.max(0, w.t) / 60) * (ENEMY_HP_RANK_MUL[T.rank] ?? 1);
  if (elite && kind !== 'elite') hp *= VETERAN_HP_MUL;
  if (!Number.isFinite(x) || !Number.isFinite(z)) { x = T.x; z = T.z; }
  const P = { x, z };
  if (!def.flies) pushOutOfCity(w.city, P, def.radius);
  P.x = clamp(P.x, B.minX + def.radius, B.maxX - def.radius);
  P.z = clamp(P.z, B.minZ + def.radius, B.maxZ - def.radius);
  const y = def.flies ? Math.max(4, 0.8 * T.height) : 0;
  const h = headingOf(T.x - P.x, T.z - P.z);
  const ai = newMem();
  ai.react = REACT_MIN + REACT_SPAN * r();
  ai.side = r() < 0.5 ? -1 : 1;
  ai.sideT = 2 + 3 * r();
  const vehicle = isVehicle(kind);
  ai.off = vehicle ? w.city.roadW * 0.25 + (r() - 0.5) * 1.5 : (r() * 2 - 1) * (corrHalf(w.city) - 1.5);
  ai.sub = kind === 'apc' ? 3 : 0;
  ai.navT = 0;
  const e: AiEnemy = {
    id: newId(w), kind, alive: true,
    x: P.x, z: P.z, y, px: P.x, pz: P.z, py: y, pheading: h,
    vx: 0, vz: 0, heading: h,
    hp, maxHp: hp, radius: def.radius, height: def.height,
    state: 'enter', t: 0,
    cd: def.fireCd * (0.35 + 0.5 * r()),
    squad: opts?.squad ?? -1, slot: opts?.slot ?? 0, elite,
    aimX: T.x, aimZ: T.z, flash: 0, stun: 0, slowT: 0, slowMul: 1, kx: 0, kz: 0,
    spawnT: w.t,
    ai,
  };
  w.enemies.push(e);
  w.events.push({ type: 'enemySpawn', id: e.id, kind, x: e.x, z: e.z });
  const key = ALERT_OF[kind];
  if (key) {
    const flag = 'seen_' + key;
    if (!w.director.data[flag]) { w.director.data[flag] = 1; w.events.push({ type: 'alert', key }); }
  }
  return e;
}

/** Put a far-away enemy back onto the spawn ring (keeps its HP; resets its behaviour). */
function recycle(w: World, e: AiEnemy): void {
  const RP = { x: 0, z: 0 };
  ringPoint(w, e.kind, RP);
  const T = w.titan;
  e.x = e.px = RP.x; e.z = e.pz = RP.z;
  e.vx = e.vz = 0; e.kx = e.kz = 0;
  const y = ENEMIES[e.kind].flies ? Math.max(4, 0.8 * T.height) : 0;
  e.y = e.py = y;
  e.heading = e.pheading = headingOf(T.x - e.x, T.z - e.z);
  setState(e, 'enter');
  e.ai.react = REACT_MIN; e.ai.arm = -1; e.ai.navT = 0; e.ai.shots = 0;
}

// ─────────────────────────────── behaviours ───────────────────────────────
function stepAndroid(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.android;
  const sd = surfDist(w, e);
  switch (e.state) {
    case 'enter':
      halt(e); face(e, T.x, T.z, 6, dt);
      if (e.t >= ai.react) setState(e, 'advance');
      break;
    case 'advance':
      nav(w, e, T.x, T.z); walk(e, WP.x, WP.z, sp, dt);
      e.aimX = T.x; e.aimZ = T.z;
      if (sd <= reach(w, def) * 0.9) setState(e, 'hold');
      break;
    case 'hold':
      holdRing(w, e, sp, reach(w, def), dt);
      e.aimX = T.x; e.aimZ = T.z;
      if (sd > reach(w, def) * 1.25) setState(e, 'advance');
      else if (e.cd <= 0) { startReact(w, e); setState(e, 'aim'); }
      break;
    case 'aim':
      halt(e); face(e, T.x, T.z, 10, dt);
      e.aimX = T.x; e.aimZ = T.z;
      if (e.t >= ai.react) {
        firePellet(w, e, 'pellet', PELLET_SPEED.android, def.dmg, T.x + ai.jx, T.z + ai.jz);
        e.cd = def.fireCd * (0.85 + 0.3 * w.rng.ai());
        setState(e, 'hold');
      }
      break;
    default: setState(e, 'advance');
  }
}

function stepSquad(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.squad;
  const L = e.squad >= 0 ? sqLeader.get(e.squad) : undefined;
  const leader = !L || L === e;
  const sd = surfDist(w, e);
  e.aimX = T.x; e.aimZ = T.z;
  switch (e.state) {
    case 'enter':
      halt(e); face(e, T.x, T.z, 6, dt);
      if (e.t >= ai.react) setState(e, leader ? 'advance' : 'form');
      return;
    case 'aim':
      halt(e); face(e, T.x, T.z, 10, dt);
      if (e.t >= ai.react) { setState(e, 'volley'); ai.shots = VOLLEY_ROUNDS; ai.shotT = 0; }
      return;
    case 'volley':
      halt(e); face(e, T.x, T.z, 10, dt);
      ai.shotT -= dt;
      if (ai.shotT <= 0 && ai.shots > 0) {
        const s = 0.35 + 0.1 * T.radius;
        firePellet(w, e, 'volley', PELLET_SPEED.squad, def.dmg, T.x + ai.jx + (w.rng.ai() - 0.5) * s, T.z + ai.jz + (w.rng.ai() - 0.5) * s);
        ai.shots--; ai.shotT = VOLLEY_GAP_S;
      }
      if (ai.shots <= 0) { e.cd = def.fireCd * (0.9 + 0.2 * w.rng.ai()); setState(e, leader ? 'hold' : 'form'); }
      return;
  }
  // movement: the leader advances/holds like a warden; followers keep their wedge slot
  if (leader) {
    if (sd > reach(w, def) * 0.9) {
      if (e.state !== 'advance') setState(e, 'advance');
      nav(w, e, T.x, T.z); walk(e, WP.x, WP.z, sp * 0.85, dt);
    } else {
      if (e.state !== 'hold') setState(e, 'hold');
      holdRing(w, e, sp * 0.8, reach(w, def), dt);
    }
  } else if (L) {
    const lh = L.heading;
    const rxv = -Math.cos(lh), rzv = Math.sin(lh), fx = Math.sin(lh), fz = Math.cos(lh);
    const a = WEDGE[e.slot % WEDGE.length], b = WEDGE[L.slot % WEDGE.length];
    const orx = a[0] - b[0], ofz = a[1] - b[1];
    const gx = L.x + rxv * orx + fx * ofz, gz = L.z + rzv * orx + fz * ofz;
    const d = dist(e.x, e.z, gx, gz);
    const leaderSettled = L.state === 'hold' || L.state === 'aim' || L.state === 'volley';
    if (d < 1.2 && leaderSettled) {
      if (e.state !== 'hold') setState(e, 'hold');
      halt(e); face(e, T.x, T.z, 8, dt);
    } else {
      if (e.state !== 'form') setState(e, 'form');
      if (d > 30) { nav(w, e, gx, gz); walk(e, WP.x, WP.z, sp * 1.3, dt); }
      else walk(e, gx, gz, sp * (d > 3 ? 1.3 : 1), dt);
      if (leaderSettled && d < 4) face(e, T.x, T.z, 8, dt);
    }
  }
  // every member fires its own 3-round volley, staggered by slot
  if (sd <= reach(w, def) * 1.15 && e.cd <= 0) {
    startReact(w, e);
    ai.react += (e.slot % SQUAD_SIZE) * 0.12;
    setState(e, 'aim');
  }
}

function stepDrone(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.drone;
  const alt = Math.max(4, 0.8 * T.height);
  const climb = Math.max(6, alt * 0.8) * dt;
  const R = T.radius + 5 + 0.35 * T.height;
  const d = dist(e.x, e.z, T.x, T.z);
  const orbit = (spd: number) => {
    const ang = Math.atan2(e.x - T.x, e.z - T.z) + ai.side * Math.min(1.2, (spd * 0.6) / R);
    walk(e, T.x + Math.sin(ang) * R, T.z + Math.cos(ang) * R, d > R * 1.8 ? spd * 1.8 : spd, dt, 6);
  };
  switch (e.state) {
    case 'enter':
      orbit(sp); e.y += clamp(alt - e.y, -climb, climb);
      if (e.t >= ai.react) setState(e, 'orbit');
      break;
    case 'orbit':
      orbit(sp); e.y += clamp(alt - e.y, -climb, climb);
      e.aimX = T.x; e.aimZ = T.z;
      if (e.cd <= 0 && d < R + 14) { startReact(w, e); setState(e, 'lock'); }
      break;
    case 'lock':
      orbit(sp * 0.5); e.y += clamp(alt - e.y, -climb, climb);
      face(e, T.x, T.z, 8, dt);
      if (e.t >= ai.react) {
        const L = leadPt(w, DRONE_TELL_S);
        ai.tx = L.x + ai.jx * 0.5; ai.tz = L.z + ai.jz * 0.5;
        ai.sx = e.x; ai.sz = e.z; ai.sy = e.y;
        const r = 2 + 0.12 * T.height;
        const tg = spawnTelegraph(w, {
          owner: 'enemy', style: 'circle', shape: { k: 'circle', x: ai.tx, z: ai.tz, r },
          windup: DRONE_TELL_S, dmg: hostile(w, def.dmg), kind: 'dive', tag: 'gnatDive',
        });
        holdTelegraph(w, e, tg);
        e.aimX = ai.tx; e.aimZ = ai.tz;
        w.events.push({ type: 'enemyFire', id: e.id, kind: e.kind, x: e.x, z: e.z, tx: ai.tx, tz: ai.tz });
        setState(e, 'dive');
      }
      break;
    case 'dive': {
      const u = Math.min(1, (e.t + dt) / DRONE_TELL_S), k = easeInCubic(u);
      const nx = lerp(ai.sx, ai.tx, k), nz = lerp(ai.sz, ai.tz, k);
      e.vx = (nx - e.x) / dt; e.vz = (nz - e.z) / dt;
      e.y = lerp(ai.sy, 0.8, k);
      face(e, ai.tx, ai.tz, 12, dt);
      if (u >= 1) { e.cd = def.fireCd * (0.85 + 0.3 * w.rng.ai()); setState(e, 'climb'); }
      break;
    }
    case 'climb': {
      const dx = e.x - T.x, dz = e.z - T.z, dd = Math.hypot(dx, dz) || 1;
      walk(e, e.x + (dx / dd) * 10, e.z + (dz / dd) * 10, sp, dt, 6);
      e.y = Math.min(alt, e.y + climb * 1.2);
      if (e.y >= alt * 0.9 || e.t > 2) setState(e, 'orbit');
      break;
    }
    default: setState(e, 'orbit');
  }
}

/** Fire-while-moving arm: roll a reaction, count it down, fire. Returns true on the fire tick. */
function armTick(w: World, e: AiEnemy, inRange: boolean, dt: number): boolean {
  const ai = e.ai;
  if (ai.arm >= 0) {
    ai.arm -= dt;
    if (ai.arm < 0) return true;
  } else if (e.cd <= 0 && inRange) {
    startReact(w, e);
    ai.arm = ai.react;
  }
  return false;
}

function stepBuggy(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.buggy;
  const sd = surfDist(w, e);
  switch (e.state) {
    case 'enter':
      halt(e);
      if (e.t >= ai.react) setState(e, 'drive');
      return;
    case 'drive':
      nav(w, e, T.x, T.z); drive(e, WP.x, WP.z, sp, 3.2, dt);
      if (sd <= reach(w, def)) { setState(e, 'strafe'); ai.side = w.rng.ai() < 0.5 ? -1 : 1; ai.sideT = 5 + 3 * w.rng.ai(); }
      break;
    case 'strafe': {
      const want = T.radius + reach(w, def) * 0.75;
      const ang = Math.atan2(e.x - T.x, e.z - T.z) + ai.side * 1.2;
      nav(w, e, T.x + Math.sin(ang) * want, T.z + Math.cos(ang) * want);
      drive(e, WP.x, WP.z, sp, 3.2, dt);
      const m = Math.hypot(e.vx, e.vz), minV = sp * 0.35;
      if (m < minV) { e.vx = Math.sin(e.heading) * minV; e.vz = Math.cos(e.heading) * minV; }
      ai.sideT -= dt;
      if (ai.sideT <= 0) { ai.side = -ai.side; ai.sideT = 5 + 3 * w.rng.ai(); }
      if (sd > reach(w, def) * 1.7) setState(e, 'drive');
      break;
    }
    default: setState(e, 'drive');
  }
  e.aimX = T.x; e.aimZ = T.z;
  if (armTick(w, e, sd <= reach(w, def) * 1.3, dt)) {
    const L = leadPt(w, ROCKET_TELL_S);
    fireLob(w, e, 'rocket', def.dmg, L.x + ai.jx, L.z + ai.jz, ROCKET_R * tellScale(w, 0.04), ROCKET_TELL_S);
    e.cd = def.fireCd * (0.9 + 0.2 * w.rng.ai());
  }
}

function stepApc(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.apc;
  const sd = surfDist(w, e);
  e.aimX = T.x; e.aimZ = T.z;
  switch (e.state) {
    case 'enter':
      halt(e);
      if (e.t >= ai.react) setState(e, 'drive');
      return;
    case 'drive':
      nav(w, e, T.x, T.z); drive(e, WP.x, WP.z, sp, 1.8, dt);
      if (sd <= reach(w, def) * 0.9) setState(e, 'hold');
      break;
    case 'hold': {
      halt(e);
      if (sd > reach(w, def) * 1.35) { setState(e, 'drive'); break; }
      if (sd < def.range * 0.35) {               // minimum standoff is the §9 range's, not the reach's
        const dx = e.x - T.x, dz = e.z - T.z, d = Math.hypot(dx, dz) || 1;
        ai.tx = e.x + (dx / d) * 45; ai.tz = e.z + (dz / d) * 45;
        setState(e, 'evade'); break;
      }
      ai.sub -= dt;
      if (ai.sub <= 0) {
        const live = (ai.sqA >= 0 ? sqCount.get(ai.sqA) ?? 0 : 0) > 0 ? 1 : 0;
        const live2 = (ai.sqB >= 0 ? sqCount.get(ai.sqB) ?? 0 : 0) > 0 ? 1 : 0;
        const room = fieldCount.all + SQUAD_SIZE <= CITY.maxEnemies && fieldCount.squad + SQUAD_SIZE <= SQUAD_FIELD_MAX;
        if (live + live2 < APC_MAX_SQUADS && room) { setState(e, 'deploy'); halt(e); return; }
        ai.sub = 2;
      }
      break;
    }
    case 'deploy':
      halt(e);
      if (e.t >= APC_DEPLOY_S) {
        deploySquad(w, e);
        fieldCount.all += SQUAD_SIZE; fieldCount.squad += SQUAD_SIZE;
        ai.sub = APC_DEPLOY_EVERY;
        setState(e, 'hold');
      }
      return;
    case 'evade':
      nav(w, e, ai.tx, ai.tz); drive(e, WP.x, WP.z, sp, 1.8, dt);
      if (e.t > 2.5) setState(e, 'drive');
      break;
    default: setState(e, 'drive');
  }
  if (armTick(w, e, sd <= reach(w, def) * 1.2, dt)) {
    firePellet(w, e, 'pellet', PELLET_SPEED.apc, def.dmg, T.x + ai.jx, T.z + ai.jz);
    e.cd = def.fireCd * (0.9 + 0.2 * w.rng.ai());
  }
}

function deploySquad(w: World, apc: AiEnemy): void {
  const ai = apc.ai;
  const sid = w.director.squadSeq++;
  const fx = Math.sin(apc.heading), fz = Math.cos(apc.heading);
  const rx = -fz, rz = fx;
  const bx = apc.x - fx * (apc.radius + 2), bz = apc.z - fz * (apc.radius + 2);
  for (let k = 0; k < SQUAD_SIZE; k++) {
    const o = WEDGE[k];
    const m = spawnEnemy(w, 'squad', bx + rx * o[0] * 0.6 - fx * -o[1] * 0.5, bz + rz * o[0] * 0.6 - fz * -o[1] * 0.5, { squad: sid, slot: k }) as AiEnemy;
    m.heading = m.pheading = apc.heading;
    m.ai.owner = apc.id;
    m.ai.react = 0.25 + 0.08 * k;
  }
  const liveA = ai.sqA >= 0 && (sqCount.get(ai.sqA) ?? 0) > 0;
  if (!liveA) ai.sqA = sid; else ai.sqB = sid;
  sqCount.set(sid, SQUAD_SIZE);
}

function stepTank(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.tank;
  const sd = surfDist(w, e);
  const track = () => { e.aimX += (T.x - e.aimX) * Math.min(1, 3 * dt); e.aimZ += (T.z - e.aimZ) * Math.min(1, 3 * dt); };
  switch (e.state) {
    case 'enter':
      halt(e); track();
      if (e.t >= ai.react) setState(e, 'crawl');
      break;
    case 'crawl':
      nav(w, e, T.x, T.z); drive(e, WP.x, WP.z, sp, 1.1, dt); track();
      if (sd <= reach(w, def) * 0.8) setState(e, 'hold');
      break;
    case 'hold':
      halt(e); track();
      if (sd > reach(w, def) * 0.95) setState(e, 'crawl');
      else if (e.cd <= 0) { startReact(w, e); setState(e, 'aim'); }
      break;
    case 'aim':
      halt(e); track();
      if (e.t >= ai.react) {
        const L = leadPt(w, TANK_TELL_S);
        const dir = headingOf(L.x + ai.jx - e.x, L.z + ai.jz - e.z);
        const mx = e.x + Math.sin(dir) * e.radius, mz = e.z + Math.cos(dir) * e.radius;
        ai.dir = dir;
        const tank = e;
        const tg = spawnTelegraph(w, {
          owner: 'enemy', style: 'lane', shape: { k: 'lane', x: mx, z: mz, dir, len: reach(w, def) + 2 * T.radius, w: TANK_LANE_W * tellScale(w, 0.035) },
          windup: TANK_TELL_S, dmg: hostile(w, def.dmg), kind: 'shell', tag: 'tortoiseShell',
          onFire: (w2, t2) => {
            if (!tank.alive) return;
            const s = t2.shape;
            if (s.k === 'lane') w2.events.push({ type: 'enemyFire', id: tank.id, kind: tank.kind, x: tank.x, z: tank.z, tx: s.x + Math.sin(s.dir) * s.len, tz: s.z + Math.cos(s.dir) * s.len });
          },
        });
        holdTelegraph(w, e, tg);
        e.aimX = mx + Math.sin(dir) * (reach(w, def) + 2 * T.radius); e.aimZ = mz + Math.cos(dir) * (reach(w, def) + 2 * T.radius);
        setState(e, 'tell');
      }
      break;
    case 'tell':
      halt(e);
      if (e.t >= TANK_TELL_S) { e.cd = def.fireCd * (0.9 + 0.2 * w.rng.ai()); setState(e, 'reload'); }
      break;
    case 'reload':
      halt(e);
      if (e.t >= TANK_RELOAD_S) setState(e, 'hold');
      break;
    default: setState(e, 'crawl');
  }
}

function stepWalker(w: World, e: AiEnemy, sp: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.walker;
  const sd = surfDist(w, e);
  e.aimX = T.x; e.aimZ = T.z;
  switch (e.state) {
    case 'enter':
      halt(e);
      if (e.t >= ai.react) setState(e, 'walk');
      break;
    case 'walk':
      nav(w, e, T.x, T.z); walk(e, WP.x, WP.z, sp, dt, 2);
      if (sd <= reach(w, def) * 0.85) setState(e, 'plant');
      break;
    case 'plant':
      halt(e); face(e, T.x, T.z, 1.5, dt);
      if (e.t >= WALKER_PLANT_S) setState(e, 'hold');
      break;
    case 'hold':
      halt(e); face(e, T.x, T.z, 1.5, dt);
      if (sd > reach(w, def) * 1.1) { ai.sub = 0; setState(e, 'unplant'); }
      else if (sd < def.range * 0.35) { ai.sub = 1; setState(e, 'unplant'); }   // min range: the §9 range's
      else if (e.cd <= 0) { startReact(w, e); setState(e, 'aim'); }
      break;
    case 'aim':
      halt(e); face(e, T.x, T.z, 1.5, dt);
      if (e.t >= ai.react) {
        ai.tx = T.x + ai.jx; ai.tz = T.z + ai.jz;
        ai.dir = w.rng.ai() * TAU;
        ai.shots = MORTAR_SHOTS; ai.shotT = 0;
        // creeping barrage: a moving titan gets its shells walked along the predicted path
        const L = leadPt(w, MORTAR_TELL_S);
        ai.sx = L.x - T.x; ai.sz = L.z - T.z;
        ai.sy = Math.hypot(ai.sx, ai.sz) > Math.max(4, 0.5 * T.radius) ? 1 : 0;
        setState(e, 'barrage');
      }
      break;
    case 'barrage': {
      halt(e);
      ai.shotT -= dt;
      if (ai.shotT <= 0 && ai.shots > 0) {
        const k = MORTAR_SHOTS - ai.shots;
        const mr = MORTAR_R * tellScale(w, 0.02);
        if (ai.sy > 0) {
          const f = 0.5 + 0.5 * k;                       // 0.5 · 1.0 · 1.5 of the lead vector
          fireLob(w, e, 'mortar', def.dmg, ai.tx + ai.sx * f, ai.tz + ai.sz * f, mr, MORTAR_TELL_S);
        } else {
          const spread = Math.max(7, 0.5 * T.radius);
          const a = ai.dir + (k * TAU) / MORTAR_SHOTS;
          fireLob(w, e, 'mortar', def.dmg, ai.tx + Math.sin(a) * spread, ai.tz + Math.cos(a) * spread, mr, MORTAR_TELL_S);
        }
        ai.shots--; ai.shotT = MORTAR_GAP_S;
      }
      if (ai.shots <= 0) { e.cd = def.fireCd * (0.9 + 0.2 * w.rng.ai()); setState(e, 'hold'); }
      break;
    }
    case 'unplant':
      halt(e);
      if (e.t >= WALKER_UNPLANT_S) {
        if (ai.sub > 0) {
          const dx = e.x - T.x, dz = e.z - T.z, d = Math.hypot(dx, dz) || 1;
          ai.tx = e.x + (dx / d) * 60; ai.tz = e.z + (dz / d) * 60;
          setState(e, 'retreat');
        } else setState(e, 'walk');
      }
      break;
    case 'retreat':
      nav(w, e, ai.tx, ai.tz); walk(e, WP.x, WP.z, sp, dt, 2);
      if (e.t > 4 || sd > def.range * 0.6) setState(e, 'plant');
      break;
    default: setState(e, 'walk');
  }
}

const propBuf: number[] = [];
function stepElite(w: World, e: AiEnemy, sp: number, spMul: number, dt: number): void {
  const T = w.titan, ai = e.ai, def = ENEMIES.elite;
  const sd = surfDist(w, e);
  switch (e.state) {
    case 'enter':
      halt(e); face(e, T.x, T.z, 1.5, dt);
      if (e.t >= ai.react) setState(e, 'approach');
      break;
    case 'approach':
      nav(w, e, T.x, T.z); drive(e, WP.x, WP.z, sp, 1.5, dt);
      e.aimX = T.x; e.aimZ = T.z;
      if (e.cd <= 0 && sd <= reach(w, def) * 0.75 && ai.navClear) { startReact(w, e); setState(e, 'aim'); }
      break;
    case 'aim':
      halt(e); face(e, T.x, T.z, 3, dt);
      e.aimX = T.x; e.aimZ = T.z;
      if (e.t >= ai.react) {
        const L = leadPt(w, RAM_TELL_S);
        const dir = headingOf(L.x + ai.jx * 0.3 - e.x, L.z + ai.jz * 0.3 - e.z);
        ai.dir = dir; e.heading = dir;
        ai.tx = RAM_LEN + (ENEMY_REACH_H.elite ?? 0) * T.height;   // latched charge length
        const tg = spawnTelegraph(w, {
          owner: 'enemy', style: 'lane', shape: { k: 'lane', x: e.x, z: e.z, dir, len: ai.tx, w: RAM_W * tellScale(w, 0.02) },
          windup: RAM_TELL_S, dmg: 0, kind: 'ram', tag: 'ramrodLane',
        });
        holdTelegraph(w, e, tg);
        e.aimX = e.x + Math.sin(dir) * ai.tx; e.aimZ = e.z + Math.cos(dir) * ai.tx;
        e.cd = def.fireCd;
        setState(e, 'tell');
      }
      break;
    case 'tell':
      halt(e); e.heading = ai.dir;
      if (e.t >= RAM_TELL_S) {
        ai.travel = 0; ai.hit = 0;
        w.events.push({ type: 'enemyFire', id: e.id, kind: e.kind, x: e.x, z: e.z, tx: e.aimX, tz: e.aimZ });
        setState(e, 'charge');
      }
      break;
    case 'charge': {
      e.heading = ai.dir;
      const v = RAM_SPEED * spMul;
      e.vx = Math.sin(ai.dir) * v; e.vz = Math.cos(ai.dir) * v;
      ai.travel += v * dt;
      // contact: the dozer blade (front half of the body circle)
      if (!ai.hit && T.alive) {
        const cx = e.x + Math.sin(ai.dir) * e.radius * 0.4, cz = e.z + Math.cos(ai.dir) * e.radius * 0.4;
        if (damageTitanArea(w, { k: 'circle', x: cx, z: cz, r: e.radius * 0.9 }, hostile(w, def.dmg), 'ram')) ai.hit = 1;
      }
      // smash every prop in its path
      const r = e.radius + 1.5;
      propsInRect(w.city, e.x - r, e.z - r, e.x + r, e.z + r, propBuf);
      for (let i = 0; i < propBuf.length; i++) {
        const p = w.city.props[propBuf[i]];
        if (p && p.alive && dist(p.x, p.z, e.x, e.z) <= r) damageProp(w, p.id, 1e6, { src: 'enemy', kind: 'ram', noCrit: true });
      }
      propBuf.length = 0;
      if (ai.hit || ai.travel >= (ai.tx > 0 ? ai.tx : RAM_LEN)) { halt(e); setState(e, 'recover'); }
      break;
    }
    case 'recover':
      halt(e);
      if (e.t >= RAM_RECOVER_S) setState(e, 'approach');
      break;
    default: setState(e, 'approach');
  }
}

// ─────────────────────────────── integration + collisions ───────────────────────────────
function integrate(w: World, e: AiEnemy, dt: number): number {
  const T = w.titan, B = w.city.bounds;
  const air = ENEMIES[e.kind].flies;
  e.x += (e.vx + e.kx) * dt; e.z += (e.vz + e.kz) * dt;
  const kd = Math.max(0, 1 - KNOCK_DECAY * dt);
  e.kx *= kd; e.kz *= kd;
  if (e.kx * e.kx + e.kz * e.kz < 1e-4) { e.kx = 0; e.kz = 0; }
  separate(e);
  let push = 0;
  const charging = e.state === 'charge';
  if (!air) {
    // titan body: pushed out (never standing inside the titan); a charging dozer stops on contact instead
    if (T.alive && !charging) {
      const dx = e.x - T.x, dz = e.z - T.z, rr = T.radius + e.radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2);
        if (d > 1e-4) { e.x = T.x + (dx / d) * rr; e.z = T.z + (dz / d) * rr; }
        else { e.x = T.x + Math.sin(e.heading + Math.PI) * rr; e.z = T.z + Math.cos(e.heading + Math.PI) * rr; }
      }
    }
    // boss body
    const Bs = w.boss;
    if (Bs && Bs.alive && Bs.parts.length > 0) {
      const p = Bs.parts[0];
      const dx = e.x - p.x, dz = e.z - p.z, rr = p.r + e.radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); e.x = p.x + (dx / d) * rr; e.z = p.z + (dz / d) * rr; }
    }
    // standing buildings (and tier-1 props) — last, so nothing ends inside a building
    push = pushOutOfCity(w.city, e, e.radius);
  }
  e.x = clamp(e.x, B.minX + e.radius, B.maxX - e.radius);
  e.z = clamp(e.z, B.minZ + e.radius, B.maxZ - e.radius);
  if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) { e.x = e.px; e.z = e.pz; e.vx = e.vz = 0; e.kx = e.kz = 0; }
  if (!Number.isFinite(e.y)) e.y = air ? 4 : 0;
  return push;
}

// ─────────────────────────────── step ───────────────────────────────
/** Advance every enemy one tick (AI, movement, firing). Called by stepWorld after stepDirector. */
export function stepEnemies(w: World): void {
  const dt = w.dt, T = w.titan, es = w.enemies;

  // cancel pending tells whose owner died (a dead tank does not fire its shell)
  const pl = pendingOf(w);
  let j = 0;
  for (let i = 0; i < pl.length; i++) {
    const e = pl[i], tg = e.ai.tg;
    if (!tg || tg.fired || !tg.alive) { if (e.ai.tg === tg) e.ai.tg = null; continue; }
    if (!e.alive) { tg.alive = false; e.ai.tg = null; continue; }
    pl[j++] = e;
  }
  pl.length = j;

  // squad table (leader = lowest living slot) + separation grid, from tick-start positions
  sqLeader.clear(); sqCount.clear();
  fieldCount.all = 0; fieldCount.squad = 0;
  for (let i = 0; i < es.length; i++) {
    const e = es[i] as AiEnemy;
    if (!e.alive) continue;
    fieldCount.all++;
    if (e.kind === 'squad') fieldCount.squad++;
    if (e.squad < 0) continue;
    mem(e);
    sqCount.set(e.squad, (sqCount.get(e.squad) ?? 0) + 1);
    const L = sqLeader.get(e.squad);
    if (!L || e.slot < L.slot) sqLeader.set(e.squad, e);
  }
  buildSep(w);

  const R = ringRadius(w), recycleD2 = (R * RECYCLE_MUL) * (R * RECYCLE_MUL);
  const n = es.length;   // enemies spawned this tick (apc squads) start acting next tick
  for (let i = 0; i < n; i++) {
    const e = es[i] as AiEnemy;
    if (!e.alive) continue;
    mem(e);
    e.t += dt;
    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) { e.slowT = 0; e.slowMul = 1; } }
    if (e.cd > 0) e.cd -= dt;
    const spMul = e.slowT > 0 ? clamp(e.slowMul, 0, 1) : 1;
    const sp = ENEMIES[e.kind].speed * spMul;

    if (T.alive && e.state !== 'charge' && e.state !== 'dive' && (e.x - T.x) ** 2 + (e.z - T.z) ** 2 > recycleD2) {
      recycle(w, e);
      continue;
    }

    if (e.stun > 0) {
      e.stun = Math.max(0, e.stun - dt);
      halt(e);
      if (e.state === 'charge') setState(e, 'recover');
      else if (e.state === 'dive') setState(e, 'climb');
      else if (e.state === 'volley' || e.state === 'barrage') { e.ai.shots = 0; e.cd = Math.max(e.cd, 0.5); setState(e, 'hold'); }
    } else if (!T.alive) {
      halt(e);
    } else {
      switch (e.kind) {
        case 'android': stepAndroid(w, e, sp, dt); break;
        case 'squad': stepSquad(w, e, sp, dt); break;
        case 'drone': stepDrone(w, e, sp, dt); break;
        case 'buggy': stepBuggy(w, e, sp, dt); break;
        case 'apc': stepApc(w, e, sp, dt); break;
        case 'tank': stepTank(w, e, sp, dt); break;
        case 'walker': stepWalker(w, e, sp, dt); break;
        case 'elite': stepElite(w, e, sp, spMul, dt); break;
      }
    }

    const push = integrate(w, e, dt);
    // a charging dozer that slams into a standing building stops dead
    if (e.state === 'charge' && push > 0.4) { halt(e); setState(e, 'recover'); }
  }
}
