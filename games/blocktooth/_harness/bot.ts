// BLOCKTOOTH — deterministic headless player policy (harness lane, CONTRACT §15 gate 2).
//
// `botInput(w)` maps the current World to a TitanInput. It never writes gameplay state and
// never touches an RNG stream: every decision is a pure function of the world plus a small
// per-world memory (target hysteresis, stuck detector) that is itself a deterministic
// function of the tick history — so the same seed gives the same run, bit for bit.
//
// Policy, in priority order:
//   1. THREAT  — a hostile telegraph (or hostile hazard) whose shape covers the titan: step
//                out along the cheapest exit (perpendicular for lanes/cones, radial for
//                circles/rings/ovals); if the paint fires before walking out is possible,
//                DASH out (dash i-frames also carry the titan through a ring).
//   2. BOSS    — once the boss is in, hold the titan's attack reach (VOLT-KITE: inside its 0.8 H
//                detonation radius, strafe-dashing wires past the parts) from the nearest boss
//                part and strafe around it (the telegraph layer above keeps it out of paint).
//   3. FOOD    — bin every flattenable building / prop / pickup within ~10 H into a coarse
//                grid and head for the densest cell (value ÷ (1 + distance/4H)).
//   4. STUCK   — if progress stalls (an oversized building in the way), detour
//                perpendicular for 1.2 s and blacklist that target spot for 12 s.
// HOOK usage is titan-appropriate (see hookDecision). Drafts: botPickUpgrade scores
// offered cards (prefers damage / area / growth) — deterministic, first-in-offer wins ties.
//
// THREE-free, DOM-free: runs under plain node (type stripping) in probe_sim.ts.

import type { Enemy, Shape, StatKey, TitanInput, TitanState, UpgradeDef, World } from '../src/core/types.ts';
import { CRUSH_RATIO, RANKS, TITAN, lootMass, lootXp, titanSpeed } from '../src/core/config.ts';
import { circleInShape, clamp, wrapAngle } from '../src/core/math.ts';
import { buildingsInRect, propsInRect } from '../src/city/citysim.ts';
import { UPGRADE_BY_ID } from '../src/data/upgrades.ts';
// v2 bot hooks (FEATURES_V2 §2.7; L0 stubs — lanes L1 / L2 / L4 fill them)
import { botUltimate } from './bot_ult.ts';
import { botDraftScore, botRecipeBonus } from './bot_draft.ts';
import { botDetour } from './bot_map.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const PLAN_EVERY_TICKS = 6;          // re-plan the food target at 5 Hz
const STUCK_CHECK_TICKS = 30;        // progress check window (1 s at 30 Hz)
const STUCK_FRAC = 0.2;              // < 20 % of expected travel in the window = stuck
const DETOUR_TICKS = 36;             // 1.2 s perpendicular detour
const AVOID_TICKS = 360;             // blacklist a stuck target spot for 12 s
const THREAT_LOOKAHEAD_S = 3.0;      // ignore paint that fires later than this
const LOW_HP = 0.4;                  // below this the food search avoids enemy crowds
/** Human perception latency: a freshly painted telegraph is ignored for this long (s). A
 *  competent player needs ~0.25–0.4 s to see paint and start moving; a bot that reacts on the
 *  spawn tick dodges every boss attack in the game and makes the balance gate meaningless. */
const REACTION_S = 0.25;
/** …plus a per-telegraph spread: human choice-reaction under load is ~250–650 ms, not a
 *  constant. Each hostile telegraph gets REACTION_S + REACTION_SPREAD_S × h, where h ∈ [0,1) is a
 *  hash of (telegraph id, world seed) — deterministic, no RNG stream touched. Mean ≈ 0.45 s. */
const REACTION_SPREAD_S = 0.4;
/** Lapse: this share of telegraphs is noticed LAPSE_S later than the reaction above. */
const LAPSE_S = 1.1;
function reactionOf(w: World, id: number): number {
  let h = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(w.seed | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f) >>> 0; h ^= h >>> 13;
  const u = (h >>> 0) / 4294967296;
  // attention lapse: a human watching the titan, the HUD and three other paints misses the odd
  // tell until it is nearly full — LAPSE_P of telegraphs are seen LAPSE_S late (same hash, so
  // it is deterministic and uncorrelated with the reaction spread's low bits)
  const lapse = ((h >>> 7) % 1000) / 1000 < BOT_TUNE.lapseP ? LAPSE_S : 0;
  return (REACTION_S + REACTION_SPREAD_S * u + lapse) * BOT_TUNE.reactionScale;
}

/** Policy switches for sensitivity experiments (probe scripts may flip them; defaults = the gate bot). */
export const BOT_TUNE = { threatDash: true, reactionScale: 1, lapseP: 0.12 };

/** Attack reach of each titan's auto attack, in titan heights (CONTRACT §8). */
const REACH_H: Record<string, number> = { molo: 0.9, voltkite: 3.2, hearthback: 2.5, briarwick: 2.6 };

interface AvoidSpot { x: number; z: number; until: number }

interface BotMemory {
  hasTarget: boolean;
  tx: number; tz: number;
  planTick: number;
  lastX: number; lastZ: number; checkTick: number; wasMoving: boolean;
  detourUntil: number; detourX: number; detourZ: number; detourSign: number;
  avoid: AvoidSpot[];
  holdAbilityUntil: number;
  strafeSign: number; strafeFlipTick: number;
}

const MEMORY = new WeakMap<World, BotMemory>();

function memoryOf(w: World): BotMemory {
  let m = MEMORY.get(w);
  if (!m) {
    m = {
      hasTarget: false, tx: w.titan.x, tz: w.titan.z, planTick: -1_000_000,
      lastX: w.titan.x, lastZ: w.titan.z, checkTick: w.tick, wasMoving: false,
      detourUntil: -1, detourX: 0, detourZ: 0, detourSign: 1,
      avoid: [], holdAbilityUntil: -1, strafeSign: 1, strafeFlipTick: w.tick,
    };
    MEMORY.set(w, m);
  }
  return m;
}

/** Forget the per-world memory (a probe re-using a World object after a manual reset). */
export function resetBot(w: World): void { MEMORY.delete(w); }

// Scratch buffers reused across calls (no per-tick allocation in the scans).
const BUF_B: number[] = [];
const BUF_P: number[] = [];
const ESC = { x: 0, z: 0, need: 0 };

// ─────────────────────────────── helpers ───────────────────────────────
function norm(x: number, z: number, out: { x: number; z: number }): number {
  const m = Math.hypot(x, z);
  if (m < 1e-9) { out.x = 0; out.z = 0; return 0; }
  out.x = x / m; out.z = z / m;
  return m;
}

function reachOf(w: World): number {
  const T = w.titan;
  let h = REACH_H[T.id] ?? 1.5;
  if (T.id === 'briarwick') h *= Math.max(0.5, T.stats.vineLength || 1);
  return h * T.height * Math.max(0.5, T.stats.attackRange || 1);
}

function maxSpeedOf(T: TitanState): number {
  return titanSpeed(T.height) * Math.max(0.3, T.stats.moveSpeed || 1);
}

/** Can the titan crush this enemy by walking over it? */
function crushable(T: TitanState, e: Enemy): boolean {
  return e.kind !== 'elite' && e.height < T.height * CRUSH_RATIO;
}

/**
 * Minimal exit from shape `s` for a circle of radius R at (x,z). Writes a unit direction to
 * ESC.x/ESC.z and the distance still to travel to ESC.need (≤ 0 = already clear).
 */
function escapeFrom(s: Shape, x: number, z: number, R: number): void {
  switch (s.k) {
    case 'circle': {
      const d = norm(x - s.x, z - s.z, ESC);
      if (d < 1e-6) { ESC.x = 1; ESC.z = 0; }
      ESC.need = s.r + R - d;
      return;
    }
    case 'ring': {
      const d = norm(x - s.x, z - s.z, ESC);
      if (d < 1e-6) { ESC.x = 1; ESC.z = 0; }
      const outNeed = s.r1 + R - d;
      const inNeed = s.r0 - R > 0 ? d - (s.r0 - R) : Infinity;
      if (inNeed < outNeed) { ESC.x = -ESC.x; ESC.z = -ESC.z; ESC.need = inNeed; }
      else ESC.need = outNeed;
      return;
    }
    case 'cone': {
      const dx = x - s.x, dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d < R) {                       // at the apex: get behind the emitter
        ESC.x = -Math.sin(s.dir); ESC.z = -Math.cos(s.dir); ESC.need = R - d + s.r * 0.05;
        return;
      }
      const th = Math.atan2(dx, dz);
      const ang = wrapAngle(th - s.dir);
      const radialNeed = s.r + R - d;
      const sideNeed = d * Math.sin(Math.max(0, s.half - Math.abs(ang))) + R;
      if (radialNeed <= sideNeed) { ESC.x = Math.sin(th); ESC.z = Math.cos(th); ESC.need = radialNeed; }
      else {
        const sg = ang >= 0 ? 1 : -1;       // leave on the side we are already on
        ESC.x = Math.cos(th) * sg; ESC.z = -Math.sin(th) * sg; ESC.need = sideNeed;
      }
      return;
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir);
      const nx = fz, nz = -fx;               // lane-local "side" axis (matches circleInShape)
      const dx = x - s.x, dz = z - s.z;
      const along = dx * fx + dz * fz;
      const side = dx * nx + dz * nz;
      const sg = side >= 0 ? 1 : -1;
      const sideNeed = s.w / 2 + R - Math.abs(side);
      const frontNeed = s.len + R - along;
      if (frontNeed < sideNeed) { ESC.x = fx; ESC.z = fz; ESC.need = frontNeed; }
      else { ESC.x = nx * sg; ESC.z = nz * sg; ESC.need = sideNeed; }
      return;
    }
    case 'oval': {
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
      const nx = fz, nz = -fx;
      const dx = x - s.x, dz = z - s.z;
      const lz = dx * fx + dz * fz, lx = dx * nx + dz * nz;
      const ax = s.rx + R, az = s.rz + R;
      const q = Math.sqrt((lx / ax) * (lx / ax) + (lz / az) * (lz / az));
      const gx = lx / (ax * ax), gz = lz / (az * az);
      if (norm(nx * gx + fx * gz, nz * gx + fz * gz, ESC) < 1e-9) { ESC.x = nx; ESC.z = nz; }
      ESC.need = (1 - q) * Math.min(ax, az) + 0.5;
      return;
    }
    case 'capsule': {
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0;
      const L2 = vx * vx + vz * vz;
      const t = L2 > 1e-9 ? clamp(((x - s.x0) * vx + (z - s.z0) * vz) / L2, 0, 1) : 0;
      const cx = s.x0 + vx * t, cz = s.z0 + vz * t;
      const d = norm(x - cx, z - cz, ESC);
      if (d < 1e-6) {                        // on the spine: go perpendicular
        if (norm(-vz, vx, ESC) < 1e-9) { ESC.x = 1; ESC.z = 0; }
      }
      ESC.need = s.r + R - d;
      return;
    }
  }
}

interface Threat { dx: number; dz: number; tLeft: number; need: number; count: number }

/** Combined escape from every hostile paint / hazard covering the titan (null = safe). */
function assessThreat(w: World): Threat | null {
  const T = w.titan;
  const R = T.radius + T.radius * 0.35 + 1.5;          // body + safety margin
  let sx = 0, sz = 0, tMin = Infinity, needAtMin = 0, count = 0;
  for (let i = 0; i < w.telegraphs.length; i++) {
    const tg = w.telegraphs[i];
    if (!tg.alive || tg.owner === 'titan') continue;
    if (tg.t < reactionOf(w, tg.id)) continue;          // not perceived yet (see REACTION_S)
    let tLeft: number;
    if (!tg.fired) tLeft = tg.windup - tg.t;
    else if (tg.active > 0 && tg.t < tg.windup + tg.active) tLeft = 0;
    else continue;
    if (tLeft > THREAT_LOOKAHEAD_S) continue;
    if (!circleInShape(tg.shape, T.x, T.z, R)) continue;
    escapeFrom(tg.shape, T.x, T.z, R);
    if (ESC.need <= 0) continue;
    const wgt = 1 / (0.15 + Math.max(0, tLeft));
    sx += ESC.x * wgt; sz += ESC.z * wgt; count++;
    if (tLeft < tMin) { tMin = tLeft; needAtMin = ESC.need; }
  }
  for (let i = 0; i < w.hazards.length; i++) {
    const hz = w.hazards[i];
    if (!hz.alive || hz.owner === 'titan') continue;
    if (!(hz.dps > 0 || hz.kind === 'frost')) continue;
    if (!circleInShape(hz.shape, T.x, T.z, T.radius)) continue;
    escapeFrom(hz.shape, T.x, T.z, T.radius);
    if (ESC.need <= 0) continue;
    sx += ESC.x * 0.6; sz += ESC.z * 0.6; count++;
    if (1.0 < tMin) { tMin = 1.0; needAtMin = ESC.need; }
  }
  if (count === 0) return null;
  const o = { x: 0, z: 0 };
  if (norm(sx, sz, o) < 1e-9) { o.x = Math.sin(T.heading + Math.PI / 2); o.z = Math.cos(T.heading + Math.PI / 2); }
  return { dx: o.x, dz: o.z, tLeft: tMin, need: needAtMin, count };
}

// ─────────────────────────────── food planning ───────────────────────────────
function planFood(w: World, m: BotMemory, enemyPenalty: boolean): void {
  const T = w.titan, city = w.city;
  const H = T.height;
  const canF = RANKS[T.rank].canFlatten;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  let R = clamp(10 * H + 25, 30, 700);
  for (let attempt = 0; attempt < 2; attempt++) {
    const C = Math.max(8, 2.5 * H);
    const G = Math.max(1, Math.ceil((2 * R) / C));
    const x0 = T.x - R, z0 = T.z - R;
    const acc = new Float64Array(G * G * 3);
    const add = (x: number, z: number, v: number): void => {
      const gx = Math.floor((x - x0) / C), gz = Math.floor((z - z0) / C);
      if (gx < 0 || gz < 0 || gx >= G || gz >= G) return;
      const i = (gz * G + gx) * 3;
      acc[i] += v; acc[i + 1] += v * x; acc[i + 2] += v * z;
    };
    BUF_B.length = 0;
    const bids = buildingsInRect(city, x0, z0, T.x + R, T.z + R, BUF_B);
    for (let k = 0; k < bids.length; k++) {
      const b = city.buildings[bids[k]];
      if (!b || b.collapsed || b.alive <= 0 || b.tier > canF) continue;
      add(b.x, b.z, b.alive * (lootXp(b.tier, T.rank) + lootMass(b.tier, T.rank)) * (b.tier === canF ? 1.3 : 1));
    }
    BUF_P.length = 0;
    const pids = propsInRect(city, x0, z0, T.x + R, T.z + R, BUF_P);
    for (let k = 0; k < pids.length; k++) {
      const p = city.props[pids[k]];
      if (!p || !p.alive || p.tier > canF) continue;
      add(p.x, p.z, lootXp(p.tier, T.rank) + lootMass(p.tier, T.rank));
    }
    for (let k = 0; k < w.pickups.length; k++) {
      const p = w.pickups[k];
      if (!p.alive) continue;
      let v = (p.xp + p.mass) * 1.2;
      if (p.kind === 'heal') v += hpFrac < 0.6 ? 60 : 5;
      if (p.kind === 'chest') v += 250;
      add(p.x, p.z, v);
    }
    const D0 = Math.max(12, 4 * H);
    const b = city.bounds;
    const margin = Math.max(2, T.radius);
    let best = -1, bx = 0, bz = 0;
    for (let gz = 0; gz < G; gz++) {
      for (let gx = 0; gx < G; gx++) {
        const i = (gz * G + gx) * 3;
        const v = acc[i];
        if (v <= 0) continue;
        const cx = acc[i + 1] / v, cz = acc[i + 2] / v;
        if (cx < b.minX + margin || cx > b.maxX - margin || cz < b.minZ + margin || cz > b.maxZ - margin) continue;
        let blocked = false;
        for (let a = 0; a < m.avoid.length; a++) {
          const s = m.avoid[a];
          if (s.until > w.tick && Math.abs(s.x - cx) < C && Math.abs(s.z - cz) < C) { blocked = true; break; }
        }
        if (blocked) continue;
        const d = Math.hypot(cx - T.x, cz - T.z);
        let score = v / (1 + d / D0);
        if (enemyPenalty) {
          let crowd = 0;
          const rr = Math.max(10, 4 * H);
          for (let e = 0; e < w.enemies.length; e++) {
            const en = w.enemies[e];
            if (!en.alive || crushable(T, en)) continue;
            if (Math.abs(en.x - cx) < rr && Math.abs(en.z - cz) < rr) crowd++;
          }
          score /= 1 + crowd * 0.5;
        }
        if (score > best) { best = score; bx = cx; bz = cz; }
      }
    }
    if (best > 0) { m.hasTarget = true; m.tx = bx; m.tz = bz; return; }
    R = Math.min(1400, R * 2.5);
  }
  // Nothing edible in reach: head for the downtown middle of the map (buildings regrow nothing,
  // but the far side of the city is always unexplored food for a starving bot).
  const b = city.bounds;
  m.hasTarget = true;
  m.tx = (b.minX + b.maxX) / 2 + Math.sin(w.tick * 0.001) * (b.maxX - b.minX) * 0.3;
  m.tz = (b.minZ + b.maxZ) / 2 + Math.cos(w.tick * 0.001) * (b.maxZ - b.minZ) * 0.3;
}

// ─────────────────────────────── hook / dash ───────────────────────────────
interface Around { near: number; nearTight: number; cx: number; cz: number; crushNear: number }
const AROUND: Around = { near: 0, nearTight: 0, cx: 0, cz: 0, crushNear: 0 };

function scanEnemies(w: World, r: number, rTight: number): Around {
  const T = w.titan;
  AROUND.near = 0; AROUND.nearTight = 0; AROUND.cx = 0; AROUND.cz = 0; AROUND.crushNear = 0;
  const r2 = r * r, t2 = rTight * rTight;
  for (let i = 0; i < w.enemies.length; i++) {
    const e = w.enemies[i];
    if (!e.alive) continue;
    const dx = e.x - T.x, dz = e.z - T.z, d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    AROUND.near++; AROUND.cx += e.x; AROUND.cz += e.z;
    if (crushable(T, e)) AROUND.crushNear++;
    if (d2 <= t2) AROUND.nearTight++;
  }
  if (AROUND.near > 0) { AROUND.cx /= AROUND.near; AROUND.cz /= AROUND.near; }
  return AROUND;
}

function countPickupsWithin(w: World, r: number): number {
  const T = w.titan, r2 = r * r;
  let n = 0;
  for (let i = 0; i < w.pickups.length; i++) {
    const p = w.pickups[i];
    if (!p.alive) continue;
    const dx = p.x - T.x, dz = p.z - T.z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

function bossNear(w: World, r: number): boolean {
  const b = w.boss, T = w.titan;
  if (!b || !b.alive) return false;
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i];
    if (Math.hypot(p.x - T.x, p.z - T.z) - p.r <= r) return true;
  }
  return false;
}

/** Live titan-owned VOLT-KITE wires and how many enemies (or boss parts) sit on them. */
function wireState(w: World): { wires: number; loaded: number; expiring: boolean } {
  let wires = 0, loaded = 0, expiring = false;
  const H = w.titan.height;
  for (let i = 0; i < w.hazards.length; i++) {
    const hz = w.hazards[i];
    if (!hz.alive || hz.owner !== 'titan' || hz.kind !== 'wire') continue;
    wires++;
    if (hz.life - hz.t < 0.5) expiring = true;
    const s = hz.shape;
    const r = 0.8 * H * Math.max(0.5, w.titan.stats.area || 1);
    for (let e = 0; e < w.enemies.length; e++) {
      const en = w.enemies[e];
      if (en.alive && circleInShape(s, en.x, en.z, en.radius + r * 0.5)) loaded++;
    }
    const b = w.boss;
    if (b && b.alive) for (let p = 0; p < b.parts.length; p++) {
      const bp = b.parts[p];
      if (circleInShape(s, bp.x, bp.z, bp.r + r * 0.5)) loaded += 4;
    }
  }
  return { wires, loaded, expiring };
}

function collapsedWithin(w: World, r: number): number {
  const T = w.titan, city = w.city;
  BUF_B.length = 0;
  const ids = buildingsInRect(city, T.x - r, T.z - r, T.x + r, T.z + r, BUF_B);
  let n = 0;
  for (let k = 0; k < ids.length; k++) {
    const b = city.buildings[ids[k]];
    if (b && b.collapsed && Math.hypot(b.x - T.x, b.z - T.z) <= r) n++;
  }
  return n;
}

/** Should the hook fire this tick? Titan-appropriate rules (CONTRACT §8). */
function hookDecision(w: World): boolean {
  const T = w.titan;
  if (T.abilityCd > 0) return false;
  const H = T.height;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const bossIn = !!(w.boss && w.boss.alive && w.boss.introT <= 0);
  switch (T.id) {
    case 'molo': {                         // GULLET VACUUM — pickups / crushables / shield
      const r = 6 * H * Math.max(0.5, T.stats.vacuumRadius || 1) * Math.max(0.5, T.stats.area || 1);
      const a = scanEnemies(w, r, 2 * H);
      return countPickupsWithin(w, r) >= 5 || a.crushNear >= 2 || a.near >= 4 || (bossIn && bossNear(w, r)) || (hpFrac < 0.5 && a.near > 0);
    }
    case 'voltkite': {                     // RECAST: DETONATE — wires first, static burst otherwise
      const ws = wireState(w);
      if (ws.wires > 0) return ws.loaded >= 2 || (ws.expiring && ws.loaded >= 1) || ws.wires >= 5;
      const a = scanEnemies(w, 1.2 * H, 1.2 * H);
      return a.near >= 3 || (bossIn && bossNear(w, 1.2 * H));
    }
    case 'hearthback': {                   // SHELL VENT — vent a full-ish shell
      const cap = T.kit.cap || 0, stored = T.kit.stored || 0;
      const fill = cap > 0 ? stored / cap : 0;
      const a = scanEnemies(w, (1.5 + 2.5 * fill) * H, 2 * H);
      // vent on cooldown once the shell holds something worth venting (dmg 20 + 2.5 × stored)
      return fill >= 0.6 || (fill >= 0.3 && a.near >= 2) || (hpFrac < 0.45 && stored > 0)
        || (bossIn && fill >= 0.25 && bossNear(w, (1.5 + 2.5 * fill) * H));
    }
    case 'briarwick': {                    // SOW — turrets on rubble + heal cloud
      const a = scanEnemies(w, 3 * H, 2.5 * H);
      return a.near >= 3 || hpFrac < 0.75 || bossIn || collapsedWithin(w, 5 * H) >= 2;
    }
  }
  return false;
}

// ─────────────────────────────── main policy ───────────────────────────────
/** The bot's command for this tick. Deterministic; never mutates gameplay state. */
/** scratch point for botDetour */
const DETOUR = { x: 0, z: 0 };

export function botInput(w: World): TitanInput {
  const T = w.titan;
  const m = memoryOf(w);
  const out: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  if (!T.alive || w.run.result) return out;

  const H = T.height;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const speed = maxSpeedOf(T);
  const dir = { x: 0, z: 0 };
  let threatened = false;

  // ── 1. threat: step out of hostile paint, dash when walking out is too slow ──
  const th = assessThreat(w);
  if (th) {
    threatened = true;
    dir.x = th.dx; dir.z = th.dz;
    const walkable = speed * Math.max(0, th.tLeft - 0.05);
    const late = th.tLeft <= TITAN.dashIframes && th.need > 0.25 * T.radius;
    if (BOT_TUNE.threatDash && (late || (th.need > walkable && th.tLeft < 0.9)) && T.dashCharges >= 1 && T.dashT <= 0) out.dash = true;
  }

  // ── 2. boss: hold reach from the nearest part, strafe ──
  const b = w.boss;
  let bossGap = Infinity, bossTanX = 0, bossTanZ = 0;
  if (!threatened && b && b.alive) {
    let best = Infinity, px = b.x, pz = b.z;
    for (let i = 0; i < b.parts.length; i++) {
      const p = b.parts[i];
      const d = Math.hypot(p.x - T.x, p.z - T.z) - p.r;
      if (d < best) { best = d; px = p.x; pz = p.z; }
    }
    if (!isFinite(best)) best = Math.hypot(b.x - T.x, b.z - T.z);
    // VOLT-KITE's boss damage is the detonation (r 0.8 H around each wire): wires must be laid
    // close to the parts, so it holds inside that radius instead of at arc reach.
    const reach = T.id === 'voltkite' ? Math.min(reachOf(w), 0.9 * H) : reachOf(w);
    const to = { x: 0, z: 0 };
    norm(px - T.x, pz - T.z, to);
    if (w.tick - m.strafeFlipTick > 180) { m.strafeSign = -m.strafeSign; m.strafeFlipTick = w.tick; }
    const tx = to.z * m.strafeSign, tz = -to.x * m.strafeSign;   // tangent
    bossGap = best; bossTanX = tx; bossTanZ = tz;
    if (b.introT > 0) {
      // entrance (invulnerable): keep eating but do not wander into its feet
      if (best < reach * 1.2) { dir.x = -to.x; dir.z = -to.z; }
    } else if (best > reach * 0.75) {
      dir.x = to.x * 0.9 + tx * 0.1; dir.z = to.z * 0.9 + tz * 0.1;
    } else if (best < reach * 0.4) {
      dir.x = -to.x * 0.6 + tx * 0.8; dir.z = -to.z * 0.6 + tz * 0.8;
    } else {
      dir.x = to.x * 0.15 + tx; dir.z = to.z * 0.15 + tz;
    }
  }

  // ── 3/4. food with stuck detection ──
  if (!threatened && !(b && b.alive && b.introT <= 0) && dir.x === 0 && dir.z === 0) {
    if (w.tick < m.detourUntil) {
      dir.x = m.detourX; dir.z = m.detourZ;
    } else {
      const reached = m.hasTarget && Math.hypot(m.tx - T.x, m.tz - T.z) < Math.max(1.5, T.radius * 0.8);
      if (!m.hasTarget || reached || w.tick - m.planTick >= PLAN_EVERY_TICKS) {
        planFood(w, m, hpFrac < LOW_HP);
        m.planTick = w.tick;
      }
      norm(m.tx - T.x, m.tz - T.z, dir);
      if (dir.x === 0 && dir.z === 0) { dir.x = Math.sin(T.heading); dir.z = Math.cos(T.heading); }
    }
  }

  // stuck detector (only while freely walking)
  if (w.tick - m.checkTick >= STUCK_CHECK_TICKS) {
    const moved = Math.hypot(T.x - m.lastX, T.z - m.lastZ);
    const expected = speed * ((w.tick - m.checkTick) / 30);
    if (m.wasMoving && !threatened && T.dashT <= 0 && !T.leash && T.slowT <= 0 && moved < STUCK_FRAC * expected) {
      m.detourSign = -m.detourSign;
      const fx = m.hasTarget ? m.tx - T.x : Math.sin(T.heading);
      const fz = m.hasTarget ? m.tz - T.z : Math.cos(T.heading);
      const f = { x: 0, z: 0 };
      if (norm(fx, fz, f) < 1e-9) { f.x = Math.sin(T.heading); f.z = Math.cos(T.heading); }
      m.detourX = f.z * m.detourSign; m.detourZ = -f.x * m.detourSign;
      m.detourUntil = w.tick + DETOUR_TICKS;
      if (m.hasTarget) m.avoid.push({ x: m.tx, z: m.tz, until: w.tick + AVOID_TICKS });
      if (m.avoid.length > 24) m.avoid.splice(0, m.avoid.length - 24);
      m.hasTarget = false;
      dir.x = m.detourX; dir.z = m.detourZ;
    }
    m.lastX = T.x; m.lastZ = T.z; m.checkTick = w.tick;
    m.wasMoving = !threatened;
  }

  // v2 map detour (objectives / power-ups worth the walk; stub → null = no detour)
  if (!threatened) {
    const det = botDetour(w, DETOUR);
    if (det) { dir.x = det.x - T.x; dir.z = det.z - T.z; }
  }

  // keep inside the playable bounds
  const bd = w.city.bounds, edge = Math.max(3, T.radius * 1.5);
  if (T.x < bd.minX + edge && dir.x < 0) dir.x = Math.abs(dir.x) * 0.5;
  if (T.x > bd.maxX - edge && dir.x > 0) dir.x = -Math.abs(dir.x) * 0.5;
  if (T.z < bd.minZ + edge && dir.z < 0) dir.z = Math.abs(dir.z) * 0.5;
  if (T.z > bd.maxZ - edge && dir.z > 0) dir.z = -Math.abs(dir.z) * 0.5;

  const u = { x: 0, z: 0 };
  if (norm(dir.x, dir.z, u) < 1e-9) { u.x = Math.sin(T.heading); u.z = Math.cos(T.heading); }
  out.mx = u.x; out.mz = u.z;

  // ── hook ──
  if (hookDecision(w)) {
    out.ability = true;
    m.holdAbilityUntil = w.tick + 36;       // MOLO's vacuum is a 1.2 s channel: keep holding
  }
  out.abilityHeld = out.ability || w.tick < m.holdAbilityUntil;

  // ── v2 UPROAR (stub → false: never fires) ──
  if (botUltimate(w)) out.ultimate = true;

  // ── offensive / travel dash (never spend the last charge when paint is around) ──
  if (!out.dash && !threatened && T.dashCharges >= 1 && T.dashT <= 0) {
    const maxCharges = Math.max(1, Math.round(T.stats.dashCharges || 1));
    const paintAround = w.telegraphs.some((tg) => tg.alive && tg.owner !== 'titan' && !tg.fired);
    if (T.id === 'voltkite') {
      // lay LIVE WIRE through crowds: dash at the local enemy centroid
      const a = scanEnemies(w, (T.stats.dashDistance || 2.2) * H * 1.6, 1.5 * H);
      if (a.near >= 3 && (T.dashCharges >= 2 || !paintAround)) {
        const c = { x: 0, z: 0 };
        if (norm(a.cx - T.x, a.cz - T.z, c) > 0.5 * H) { out.mx = c.x; out.mz = c.z; out.dash = true; }
      }
      // boss: strafe-dash along the tangent so the LIVE WIRE lies alongside the parts (within the
      // 0.8 H detonation radius); keep one charge spare while hostile paint is on the ground
      if (!out.dash && b && b.alive && b.introT <= 0 && bossGap < 0.8 * H && (bossTanX !== 0 || bossTanZ !== 0)
        && (T.dashCharges >= 2 || !paintAround) && wireState(w).wires < 5) {
        out.mx = bossTanX; out.mz = bossTanZ; out.dash = true;
      }
    }
    if (!out.dash && T.dashCharges >= maxCharges && !paintAround && !(b && b.alive) && m.hasTarget) {
      const dT = Math.hypot(m.tx - T.x, m.tz - T.z);
      if (dT > (T.stats.dashDistance || 2.2) * H * 1.2) out.dash = true;   // 2× smash while travelling
    }
  }
  return out;
}

// ─────────────────────────────── drafts ───────────────────────────────
const STAT_W: Partial<Record<StatKey, number>> = {
  damage: 3.0, attackRate: 2.6, area: 2.4, massGain: 2.6, xpGain: 2.0, smashDamage: 1.8,
  buildingDamage: 1.6, smashRadius: 1.4, maxHp: 1.6, armor: 1.3, regen: 1.0, lifesteal: 1.2,
  moveSpeed: 1.5, pickupRadius: 1.2, critChance: 1.4, critMult: 1.0, attackRange: 1.6,
  abilityPower: 1.4, abilityCooldown: 1.4, chains: 1.4, projectiles: 1.4, arcForks: 1.3,
  wireDamage: 1.3, wireDuration: 1.0, shellCapacity: 1.2, stompDelay: 1.0, magmaDuration: 1.1,
  turretCap: 1.2, turretRate: 1.2, sporeHeal: 0.9, vineLength: 1.3, biteCleave: 1.2,
  pulseEvery: 1.0, vacuumRadius: 1.0, dashCharges: 1.0, dashCooldown: 0.9, dashDistance: 0.8,
  luck: 0.7, rerolls: 0.5, iframes: 0.8, thorns: 0.8, rubbleHeal: 1.0, knockback: 0.4,
  chainRange: 0.9, sparkChance: 1.2,
};
/** stats where smaller is better (cooldown multipliers, step counts, delays) */
const LOWER_IS_BETTER: ReadonlySet<StatKey> = new Set<StatKey>(['abilityCooldown', 'dashCooldown', 'pulseEvery', 'stompDelay']);
/** typical magnitude for stats whose base can be 0 (normalises flat adds) */
const NORM: Partial<Record<StatKey, number>> = {
  armor: 40, iframes: 0.3, thorns: 10, lifesteal: 0.05, rubbleHeal: 1, luck: 1, chains: 1,
  projectiles: 1, sparkChance: 0.2, biteCleave: 1, magmaDuration: 2, critChance: 0.2, rerolls: 1,
  dashCharges: 1, pulseEvery: 4, turretCap: 4, arcForks: 3,
};
const TAG_BONUS: Record<string, number> = { offense: 1.5, growth: 1.5, smash: 1.0, hook: 0.5, defense: 0.5, survival: 0.5 };
const RARITY_BONUS: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** Deterministic value of taking upgrade `id` now (higher = better). */
export function botScoreUpgrade(w: World, id: string): number {
  const v2 = botDraftScore(w, id);          // v2 override (evolutions, v2 cards); stub → null
  if (v2 !== null) return v2;
  const def: UpgradeDef | undefined = (UPGRADE_BY_ID as Record<string, UpgradeDef | undefined>)[id];
  if (!def) return -1e9;
  const stats = w.titan.stats;
  let s = 0;
  for (const e of def.effects) {
    if (e.stat) {
      const wt = STAT_W[e.stat] ?? 0.8;
      const base = Math.abs(stats[e.stat] ?? 0);
      const nrm = NORM[e.stat] ?? Math.max(base, 1);
      let mag = 0;
      if (e.add) mag += e.add / nrm;
      if (e.mul) mag += e.mul;
      if (LOWER_IS_BETTER.has(e.stat)) mag = -mag;
      s += wt * mag * 10;
    }
    if (e.trigger) s += 3 + Math.min(1, e.trigger.chance) * 2;
  }
  for (const t of def.tags) s += TAG_BONUS[t] ?? 0;
  s += RARITY_BONUS[def.rarity] ?? 0;
  if (def.titan && def.titan === w.titanId) s += 1.5;
  const owned = w.upgrades.owned[id] ?? 0;
  return s / (1 + 0.1 * owned) + botRecipeBonus(w, id);   // F1: lean toward a started evolution recipe
}

/** Pick one card from an offer (first in offer order wins ties). */
export function botPickUpgrade(w: World, offer: readonly string[]): string {
  let best = offer[0], bestS = -Infinity;
  for (const id of offer) {
    const s = botScoreUpgrade(w, id);
    if (s > bestS) { bestS = s; best = id; }
  }
  return best;
}
