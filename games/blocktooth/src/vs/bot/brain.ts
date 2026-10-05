// BLOCKTOOTH VS — the in-sim bot brain (vs_design.md §10). Lane B-VS.
//
// A port of _harness/bot.ts (the deterministic headless player policy) that lives IN the sim: it fills every bot seat of a
// VS match. Differences from the harness bot:
//   * memory is PER SEAT (PlayerState.bot : BotMemory), not one WeakMap entry per World, so 3 bots can share a match, a
//     seat can be handed to a bot (a human leaves) and back (a human takes it over) without losing its stuck / plan state;
//   * three VS layers are added to the original THREAT -> BOSS -> FOOD -> STUCK order:
//        RING   in FINAL NOTICE / LAST CALL (and the 30 s before it) stay inside the NEXT ring step with a 1 H margin;
//        RIVAL  after 4:00 engage a rival when my HP and the size edge allow it; prefer hurt / third-party-fighting /
//               crowned rivals; ANTI-DOGPILE (never the 3rd attacker on one target unless it wears the crown); flee under
//               the difficulty's flee HP; target choice never looks at who is human;
//        TENDER walk to a PUBLIC TENDER when it is closer to me than to at least one rival, or when I am in last place;
//   * three difficulties (VS.bots): reaction delay to new paint, the share of telegraphs dodged ("dodge chance" is a HASH
//     of the telegraph id, never an rng draw, so the sim stays reproducible), hook use, UPROAR use, engage / flee HP;
//   * hostile paint includes RIVAL paint (a rival's magma stomp, wires) once PvP is live;
//   * drafts: a rail offer is answered through TitanInput.railPick (the sim never pauses): the REGULAR / VETERAN brain
//     takes the auto-pick scorer's card, ROOKIE a hash-weighted card, each after a difficulty-dependent reading delay.
//
// THREE-free, DOM-free, deterministic: every decision is a pure function of the world + the seat's BotMemory; the only
// "random" is hash01 of (tick-independent ids, seed, slot). It never mutates gameplay state except the seat's own BotMemory
// and one numeric kit hint (kit.sim_aimLead) the HEARTHBACK stomp reads.
//
// CALLING CONVENTION: botThink(w, slot) must run with `slot` BOUND (the caller uses withPlayer): the policy reads the
// cursor (w.titan, w.upgrades, w.ult ...) exactly like the harness bot.

import { atan2, cos, hypot, sin } from '../../core/detmath.ts';
import type { Enemy, Shape, TitanInput, TitanState, World } from '../../core/types.ts';
import { CRUSH_RATIO, RANKS, TITAN, VS, lootMass, lootXp, titanSpeed } from '../../core/config.ts';
import { circleInShape, clamp, wrapAngle } from '../../core/math.ts';
import { buildingsInRect, propsInRect } from '../../city/citysim.ts';
import { kitReach } from '../../titans/kits/index.ts';
import { autoPickIndex, autoPickScore } from '../../upgrades/autopick.ts';
import type { BotMemory } from '../types.ts';
import { matchClock, pvpOnIn } from '../clock.ts';
import { ringOf } from '../ring.ts';
import { sizeEdge } from '../formula.ts';
import { VSX } from '../tune.ts';
import { botDetour } from './map.ts';
import { botGate } from './gate.ts';
import { botUltimateVs } from './ult.ts';

// ─────────────────────────────── tuning ───────────────────────────────
const PLAN_EVERY_TICKS = 6;          // re-plan the food target at 5 Hz
const STUCK_CHECK_TICKS = 30;        // progress check window (1 s at 30 Hz)
const STUCK_FRAC = 0.2;              // < 20 % of expected travel in the window = stuck
const DETOUR_TICKS = 36;             // 1.2 s perpendicular detour
const AVOID_TICKS = 360;             // blacklist a stuck target spot for 12 s
const THREAT_LOOKAHEAD_S = 3.0;      // ignore paint that fires later than this
const LOW_HP = 0.4;                  // below this the food search avoids enemy crowds
const FLEE_HOLD_TICKS = 90;          // a flee lasts at least 3 s once started (hysteresis)
const RING_PREPOSITION_S = 30;       // start drifting toward the next ring step this long before it starts shrinking

/** Policy switches for sensitivity experiments (probe scripts may flip them; defaults = the shipped bot). */
export const VS_BOT_TUNE = { threatDash: true, rivalLayer: true, ringLayer: true, tenderLayer: true };

/** Attack reach of each titan's auto attack, in titan heights (bot.ts REACH_H). BRIARWICK comes from the kit. */
const REACH_H: Record<string, number> = { molo: 0.9, voltkite: 3.2, hearthback: 2.5 };

const BUF_B: number[] = [];
const BUF_P: number[] = [];
const ESC = { x: 0, z: 0, need: 0 };
const DETOUR = { x: 0, z: 0 };
const GATE_OUT = { x: 0, z: 0 };

// ─────────────────────────────── small helpers ───────────────────────────────
function norm(x: number, z: number, out: { x: number; z: number }): number {
  const m = hypot(x, z);
  if (m < 1e-9) { out.x = 0; out.z = 0; return 0; }
  out.x = x / m; out.z = z / m;
  return m;
}

/** A uniform [0,1) hash of three integers (no rng stream touched). */
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c + 0x7f4a7c15 | 0, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function reachOf(w: World): number {
  const T = w.titan;
  if (T.id === 'briarwick') {
    const r = kitReach(w);
    if (r > 0) return r;
  }
  const h = REACH_H[T.id] ?? 1.5;
  return h * T.height * Math.max(0.5, T.stats.attackRange || 1);
}

function maxSpeedOf(T: TitanState): number {
  return titanSpeed(T.height) * Math.max(0.3, T.stats.moveSpeed || 1);
}

function crushable(T: TitanState, e: Enemy): boolean {
  return e.kind !== 'elite' && e.height < T.height * CRUSH_RATIO;
}

/** An enemy that is this seat's business (Civil Defense is ASSIGNED to one titan in VS; unassigned = anyone's). */
function mineEnemy(w: World, e: Enemy): boolean {
  return e.tslot === undefined || e.tslot === w.cur;
}

/** Minimal exit from shape `s` for a circle of radius R at (x,z): unit direction in ESC.x/z, distance still to go in ESC.need. */
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
      const d = hypot(dx, dz);
      if (d < R) {
        ESC.x = -sin(s.dir); ESC.z = -cos(s.dir); ESC.need = R - d + s.r * 0.05;
        return;
      }
      const th = atan2(dx, dz);
      const ang = wrapAngle(th - s.dir);
      const radialNeed = s.r + R - d;
      const sideNeed = d * sin(Math.max(0, s.half - Math.abs(ang))) + R;
      if (radialNeed <= sideNeed) { ESC.x = sin(th); ESC.z = cos(th); ESC.need = radialNeed; }
      else {
        const sg = ang >= 0 ? 1 : -1;
        ESC.x = cos(th) * sg; ESC.z = -sin(th) * sg; ESC.need = sideNeed;
      }
      return;
    }
    case 'lane': {
      const fx = sin(s.dir), fz = cos(s.dir);
      const nx = fz, nz = -fx;
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
      const fx = sin(s.rot), fz = cos(s.rot);
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
      if (d < 1e-6) {
        if (norm(-vz, vx, ESC) < 1e-9) { ESC.x = 1; ESC.z = 0; }
      }
      ESC.need = s.r + R - d;
      return;
    }
  }
}

// ─────────────────────────────── per-seat config + memory ───────────────────────────────
function cfgOf(m: BotMemory): { reactTicks: number; dodge: number; engageHp: number; engageEdge: number; fleeHp: number } {
  return VS.bots[m.level];
}

function initMemory(w: World, m: BotMemory): void {
  const T = w.titan;
  m.inited = true;
  m.hasTarget = false;
  m.tx = T.x; m.tz = T.z; m.planTick = -1_000_000;
  m.lastX = T.x; m.lastZ = T.z; m.checkTick = w.tick; m.wasMoving = false;
  m.detourUntil = -1; m.detourX = 0; m.detourZ = 0; m.detourSign = 1;
  m.avoid.length = 0;
  m.holdAbilityUntil = -1;
  m.strafeSign = 1; m.strafeFlipTick = w.tick;
  m.engagedTick = -1; m.fleeUntil = -1;
  m.targetSlot = -1; m.mode = 'food'; m.modeT = w.t;
}

function setMode(w: World, m: BotMemory, mode: string): void {
  if (m.mode !== mode) { m.mode = mode; m.modeT = w.t; }
}

// ─────────────────────────────── threat: hostile paint + hazards ───────────────────────────────
interface Threat { dx: number; dz: number; tLeft: number; need: number; count: number }

/** Is this telegraph / hazard owner's paint hostile to bot `slot`? Enemy / boss paint always; a titan-owned one only when it
 *  belongs to a RIVAL and PvP is live (OPEN HOUSE rival paint only shoves). */
function hostileOwner(w: World, owner: string, ownerSlot: number | undefined, slot: number): boolean {
  if (owner !== 'titan') return true;
  return ownerSlot !== undefined && ownerSlot !== slot && pvpOnIn((w.vs as NonNullable<World['vs']>).phase);
}

/** Does bot `slot` notice (and bother to dodge) telegraph `id`? Reaction delay in ticks + a hashed dodge share. */
function perceives(w: World, m: BotMemory, slot: number, id: number, age: number): boolean {
  const cfg = cfgOf(m);
  if (age < cfg.reactTicks * w.dt) return false;
  return hash01(id, w.seed, slot) < cfg.dodge;
}

function assessThreat(w: World, m: BotMemory): Threat | null {
  const T = w.titan;
  const slot = w.cur;
  const R = T.radius + T.radius * 0.35 + 1.5;
  let sx = 0, sz = 0, tMin = Infinity, needAtMin = 0, count = 0;
  for (let i = 0; i < w.telegraphs.length; i++) {
    const tg = w.telegraphs[i];
    if (!tg.alive || !hostileOwner(w, tg.owner, tg.oslot, slot)) continue;
    if (!perceives(w, m, slot, tg.id, tg.t)) continue;
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
    if (!hz.alive) continue;
    const own = hz.oslot !== undefined ? hz.oslot : (hz.data.own as number | undefined);
    if (!hostileOwner(w, hz.owner, own, slot)) continue;
    if (!(hz.dps > 0 || hz.kind === 'frost')) continue;
    if (!circleInShape(hz.shape, T.x, T.z, T.radius)) continue;
    escapeFrom(hz.shape, T.x, T.z, T.radius);
    if (ESC.need <= 0) continue;
    sx += ESC.x * 0.6; sz += ESC.z * 0.6; count++;
    if (1.0 < tMin) { tMin = 1.0; needAtMin = ESC.need; }
  }
  if (count === 0) return null;
  const o = { x: 0, z: 0 };
  if (norm(sx, sz, o) < 1e-9) { o.x = sin(T.heading + Math.PI / 2); o.z = cos(T.heading + Math.PI / 2); }
  return { dx: o.x, dz: o.z, tLeft: tMin, need: needAtMin, count };
}

// ─────────────────────────────── ring plan (RING layer) ───────────────────────────────
interface RingPlan { active: boolean; urgent: boolean; safeR: number; dist: number; ux: number; uz: number }
const RING_PLAN: RingPlan = { active: false, urgent: false, safeR: Infinity, dist: 0, ux: 0, uz: 0 };

/**
 * Where the bot must be: inside the NEXT ring step with a VS.bots.ringMarginH margin. Active in FINAL NOTICE / LAST CALL
 * and for RING_PREPOSITION_S before the first step starts. `urgent` = already outside the radius the ring has NOW.
 */
function ringPlan(w: World, T: TitanState): RingPlan {
  const P = RING_PLAN;
  P.active = false; P.urgent = false; P.safeR = Infinity;
  const vs = w.vs as NonNullable<World['vs']>;
  const c = matchClock(w);
  const steps = VS.ring.steps;
  const R = ringOf(w);
  P.dist = hypot(T.x - R.cx, T.z - R.cz);
  norm(R.cx - T.x, R.cz - T.z, ESC);
  P.ux = ESC.x; P.uz = ESC.z;
  if (!VS_BOT_TUNE.ringLayer) return P;
  const margin = VS.bots.ringMarginH * T.height;
  const live = vs.phase === 'final' || vs.phase === 'last';
  let target = R.r;
  if (live || c >= steps[0].atS - RING_PREPOSITION_S) {
    // the radius the ring settles at next: a step in progress lands at toR; else the step that starts soonest
    if (w.t < vs.ring.t1) target = Math.min(R.r, R.toR);
    else {
      const next = R.step + 1;
      if (next < steps.length && c >= steps[next].atS - RING_PREPOSITION_S) target = R.r0 * steps[next].frac;
      else target = R.r;
    }
    P.active = true;
    P.safeR = Math.max(T.radius, target - margin);
    P.urgent = P.dist > R.r - 0.5 * margin;
  }
  return P;
}

// ─────────────────────────────── food planning ───────────────────────────────
function planFood(w: World, m: BotMemory, enemyPenalty: boolean, ring: RingPlan): void {
  const T = w.titan, city = w.city;
  const H = T.height;
  const canF = RANKS[T.rank].canFlatten;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const rg = ringOf(w);
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
      if (p.pslot !== undefined && p.pslot >= 0 && p.pslot !== w.cur) continue;     // rubble is private to its titan in VS
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
        if (ring.active && hypot(cx - rg.cx, cz - rg.cz) > ring.safeR) continue;      // food outside the next ring is not food
        let blocked = false;
        for (let a = 0; a < m.avoid.length; a++) {
          const s = m.avoid[a];
          if (s.until > w.tick && Math.abs(s.x - cx) < C && Math.abs(s.z - cz) < C) { blocked = true; break; }
        }
        if (blocked) continue;
        const d = hypot(cx - T.x, cz - T.z);
        let score = v / (1 + d / D0);
        if (enemyPenalty) {
          let crowd = 0;
          const rr = Math.max(10, 4 * H);
          for (let e = 0; e < w.enemies.length; e++) {
            const en = w.enemies[e];
            if (!en.alive || crushable(T, en) || !mineEnemy(w, en)) continue;
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
  // nothing edible in reach: head for the ring centre while it matters, else the downtown middle of the map
  if (ring.active) { m.hasTarget = true; m.tx = rg.cx; m.tz = rg.cz; return; }
  const b = city.bounds;
  m.hasTarget = true;
  m.tx = (b.minX + b.maxX) / 2 + sin(w.tick * 0.001 + w.cur) * (b.maxX - b.minX) * 0.3;
  m.tz = (b.minZ + b.maxZ) / 2 + cos(w.tick * 0.001 + w.cur) * (b.maxZ - b.minZ) * 0.3;
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
    if (!e.alive || !mineEnemy(w, e)) continue;
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
    if (p.pslot !== undefined && p.pslot >= 0 && p.pslot !== w.cur) continue;
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
    if (hypot(p.x - T.x, p.z - T.z) - p.r <= r) return true;
  }
  return false;
}

/** This seat's own live VOLT-KITE wires, how many enemies / boss parts / (rival centre within reach) sit on them. */
function wireState(w: World, rival: TitanState | null): { wires: number; loaded: number; onRival: number; expiring: boolean } {
  let wires = 0, loaded = 0, onRival = 0, expiring = false;
  const H = w.titan.height;
  for (let i = 0; i < w.hazards.length; i++) {
    const hz = w.hazards[i];
    if (!hz.alive || hz.owner !== 'titan' || hz.kind !== 'wire') continue;
    const own = hz.oslot !== undefined ? hz.oslot : ((hz.data.own as number | undefined) ?? 0);
    if (own !== w.cur) continue;
    wires++;
    if (hz.life - hz.t < 0.5) expiring = true;
    const s = hz.shape;
    const r = 0.8 * H * Math.max(0.5, w.titan.stats.area || 1);
    for (let e = 0; e < w.enemies.length; e++) {
      const en = w.enemies[e];
      if (en.alive && mineEnemy(w, en) && circleInShape(s, en.x, en.z, en.radius + r * 0.5)) loaded++;
    }
    const b = w.boss;
    if (b && b.alive) for (let p = 0; p < b.parts.length; p++) {
      const bp = b.parts[p];
      if (circleInShape(s, bp.x, bp.z, bp.r + r * 0.5)) loaded += 4;
    }
    if (rival && circleInShape(s, rival.x, rival.z, rival.radius + r * 0.5)) onRival++;
  }
  return { wires, loaded, onRival, expiring };
}

/** Should the hook fire this tick? Titan-appropriate rules (bot.ts hookDecision) + RIVAL contexts; ROOKIE fires on cooldown. */
function hookDecision(w: World, m: BotMemory, rival: TitanState | null): boolean {
  const T = w.titan;
  if (T.abilityCd > 0) return false;
  if (m.level === 'rookie' && T.id !== 'molo') return true;            // "on cooldown"
  const H = T.height;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const bossIn = !!(w.boss && w.boss.alive && w.boss.introT <= 0);
  const rd = rival ? hypot(rival.x - T.x, rival.z - T.z) - rival.radius : Infinity;
  switch (T.id) {
    case 'molo': {                         // GULLET VACUUM
      const r = 6 * H * Math.max(0.5, T.stats.vacuumRadius || 1) * Math.max(0.5, T.stats.area || 1);
      const a = scanEnemies(w, r, 2 * H);
      if (m.level === 'rookie') return true;
      const rivalDrag = rival !== null && rd < r * 0.55 && (rival.height < 0.7 * H || rd < 2 * H);
      return countPickupsWithin(w, r) >= 5 || a.crushNear >= 2 || a.near >= 4 || (bossIn && bossNear(w, r)) || (hpFrac < 0.5 && a.near > 0) || rivalDrag;
    }
    case 'voltkite': {                     // RECAST: DETONATE
      const ws = wireState(w, rival);
      if (ws.wires > 0) {
        if (m.level === 'veteran' && ws.onRival >= 1) return true;               // wires then DETONATE: the combo
        if (ws.onRival >= 2 || (ws.onRival >= 1 && ws.expiring)) return true;
        return ws.loaded >= 2 || (ws.expiring && ws.loaded >= 1) || ws.wires >= 5;
      }
      const a = scanEnemies(w, 1.2 * H, 1.2 * H);
      return a.near >= 3 || (bossIn && bossNear(w, 1.2 * H)) || (rival !== null && rd < 1.2 * H);
    }
    case 'hearthback': {                   // SHELL VENT
      const cap = T.kit.cap || 0, stored = T.kit.stored || 0;
      const fill = cap > 0 ? stored / cap : 0;
      const reach = (1.5 + 2.5 * fill) * H;
      const a = scanEnemies(w, reach, 2 * H);
      const rivalIn = rival !== null && rd <= reach;
      return fill >= 0.6 || (fill >= 0.3 && (a.near >= 2 || rivalIn)) || (hpFrac < 0.45 && stored > 0)
        || (bossIn && fill >= 0.25 && bossNear(w, reach)) || (rivalIn && fill >= 0.15);
    }
    case 'briarwick': {                    // POP-UP PARK
      const ripe = T.kit.ripe || 0;
      return ripe >= 3 || scanEnemies(w, 3 * H, 3 * H).near >= 1 || bossIn || (rival !== null && rd < 3 * H);
    }
  }
  return false;
}

// ─────────────────────────────── RIVAL layer ───────────────────────────────
/** Distinct rivals that hit `victim` in the last botFightingS seconds, excluding `except`. */
function recentAttackers(w: World, victim: number, except: number): number {
  const hits = w.players[victim].vs.hits;
  let mask = 0, n = 0;
  const cut = w.t - VSX.botFightingS;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.t < cut || h.from === except || h.from < 0 || h.from > 30) continue;
    const bit = 1 << h.from;
    if (!(mask & bit)) { mask |= bit; n++; }
  }
  return n;
}

/** Was `slot` hit by (or hitting) anyone recently: "already fighting someone" (a third-party opportunity). */
function isFighting(w: World, slot: number): boolean {
  const hits = w.players[slot].vs.hits;
  const cut = w.t - VSX.botFightingS;
  for (let i = 0; i < hits.length; i++) if (hits[i].t >= cut) return true;
  return false;
}

/**
 * Is this bot LOSING a fight it should run from: under the difficulty's flee HP AND either two or more rivals are close or
 * one close rival is clearly healthier than me. A rival that is as hurt as I am (or hurter) is a fight to finish, not to
 * flee: two bots at 25 % that both ran away would never end a duel.
 */
function shouldFlee(w: World, m: BotMemory, T: TitanState, hpFrac: number): boolean {
  const cfg = cfgOf(m);
  if (hpFrac >= cfg.fleeHp) return false;
  let near = 0, healthier = 0;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur) continue;
    const P = w.players[i];
    if (P.vs.eliminated || !P.titan.alive || P.vs.spawnProtT > 0) continue;
    const R = P.titan;
    if (hypot(R.x - T.x, R.z - T.z) > 8 * Math.max(T.height, R.height)) continue;
    near++;
    const rh = R.maxHp > 0 ? R.hp / R.maxHp : 1;
    if (rh > hpFrac + 0.05) healthier++;
  }
  return near >= 2 || healthier >= 1;
}

/**
 * Pick (or keep) the rival to fight. -1 = none. Engagement needs my HP >= engageHp and rank edge >= engageEdge; a target
 * is skipped when it is already under attack by `antiDogpileMax` other titans unless it wears the crown. The score ignores
 * who is human (a bot never prefers a human over a bot).
 */
function chooseRival(w: World, m: BotMemory, fleeing: boolean): number {
  const T = w.titan;
  const slot = w.cur;
  const vs = w.vs as NonNullable<World['vs']>;
  const cfg = cfgOf(m);
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  if (fleeing) { m.targetSlot = -1; return -1; }
  // engageHp is the bar to START a fight; once fighting, the bot stays in until it is LOSING under the flee HP
  // (vs_design.md §10: "engage when myHP% >= engageHp ... disengage under fleeHp")
  const inFight = m.targetSlot >= 0;
  if (!inFight && hpFrac < cfg.engageHp) { m.targetSlot = -1; return -1; }
  const ring = ringOf(w);
  let best = -1, bestS = -Infinity;
  for (let i = 0; i < w.players.length; i++) {
    if (i === slot) continue;
    const P = w.players[i];
    const R = P.titan;
    if (P.vs.eliminated || !R.alive || P.vs.spawnProtT > 0) continue;
    const diff = T.rank - R.rank;
    if (diff < cfg.engageEdge) continue;
    const crowned = vs.crown === i;
    if (!crowned && recentAttackers(w, i, slot) >= VS.bots.antiDogpileMax) continue;
    const d = hypot(R.x - T.x, R.z - T.z);
    if (d > VSX.botPursueH * Math.max(T.height, R.height) * (m.targetSlot === i ? 1.6 : 1) * (crowned ? VSX.botCrownPursueMul : 1)) continue;   // too far to hunt: eat
    const rHp = R.maxHp > 0 ? R.hp / R.maxHp : 1;
    if (VSX.botFinalCaution > 0 && vs.phase === 'final' && m.targetSlot !== i && !crowned && diff < 1 && hpFrac < rHp + 0.1) continue;   // no respawns now: only fights with an edge
    let s = 2.5 * (1 - rHp) + (isFighting(w, i) ? 1.2 : 0) + (crowned ? VSX.botCrownWeight : 0) + 2.0 / (1 + d / (8 * T.height)) + 0.3 * diff;
    if (m.targetSlot === i) s += 0.8;                                   // hysteresis: keep the current target
    if (vs.phase === 'final' || vs.phase === 'last') {                  // never chase a rival outside the ring
      if (hypot(R.x - ring.cx, R.z - ring.cz) > ring.r) s -= 4;
    }
    if (s > bestS + 1e-9) { bestS = s; best = i; }                      // ties: the lower slot
  }
  m.targetSlot = best;
  return best;
}

// ─────────────────────────────── TENDER layer ───────────────────────────────
/** The tender this bot wants to go to, or null: closer to me than to at least one rival, or I am in last place. */
function chooseTender(w: World): { x: number; z: number; live: boolean } | null {
  if (!VS_BOT_TUNE.tenderLayer) return null;
  const vs = w.vs as NonNullable<World['vs']>;
  const T = w.titan;
  const slot = w.cur;
  for (let k = 0; k < vs.tenders.length; k++) {
    const t = vs.tenders[k];
    if (t.state !== 'marker' && t.state !== 'live') continue;
    let tx = t.x, tz = t.z;
    const live = t.state === 'live' && !!w.boss && w.boss.alive;
    if (live && w.boss) { tx = w.boss.x; tz = w.boss.z; }
    const myD = hypot(tx - T.x, tz - T.z);
    let closer = false;
    for (let i = 0; i < w.players.length; i++) {
      if (i === slot) continue;
      const P = w.players[i];
      if (P.vs.eliminated) continue;
      if (myD < hypot(tx - P.titan.x, tz - P.titan.z)) { closer = true; break; }
    }
    // last place: no other seat below me (lowest level; ties: the lower slot counts as last)
    let last = true;
    for (let i = 0; i < w.players.length; i++) {
      if (i === slot || w.players[i].vs.eliminated) continue;
      const L = w.players[i].titan.level;
      if (L < T.level || (L === T.level && i > slot)) { last = false; break; }
    }
    if (closer || last) return { x: tx, z: tz, live };
  }
  return null;
}

// ─────────────────────────────── main policy ───────────────────────────────
function railAnswer(w: World, m: BotMemory, slot: number, out: TitanInput): void {
  const P = w.players[slot];
  const R = P.rail;
  const offer = P.upgrades.offer;
  if (!R.open || !offer || offer.length === 0) return;
  if (m.railSeq === R.seq) return;
  if (w.t - R.openedT < VSX.botRailDelayS[m.level]) return;
  let idx: number;
  if (m.level === 'rookie') idx = weightedPick(w, offer, hash01(R.seq, w.seed, slot + 11));   // weighted random
  else idx = autoPickIndex(w, offer);
  if (idx < 1 || idx > offer.length) idx = 1;
  out.railPick = idx;
  m.railSeq = R.seq;
}

/** ROOKIE draft: a card drawn with weight 1 + (its score above the worst card's), u in [0,1) a hash (never an rng draw). */
function weightedPick(w: World, offer: readonly string[], u: number): number {
  let lo = Infinity;
  const sc: number[] = [];
  for (let i = 0; i < offer.length; i++) { const v = autoPickScore(w, offer[i]); sc.push(v); if (v < lo) lo = v; }
  let tot = 0;
  for (let i = 0; i < sc.length; i++) { sc[i] = 1 + Math.max(0, Math.min(40, sc[i] - lo)); tot += sc[i]; }
  let r = u * tot;
  for (let i = 0; i < sc.length; i++) { r -= sc[i]; if (r < 0) return i + 1; }
  return offer.length;
}

/** The bot's command for this tick for the BOUND seat. Deterministic. Mutates only the seat's BotMemory (+ kit.sim_aimLead). */
export function botThink(w: World): TitanInput {
  const slot = w.cur;
  const P = w.players[slot];
  const m = P.bot as BotMemory;
  const T = w.titan;
  const out: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  if (!T.alive || P.vs.eliminated || w.run.result) return out;
  if (!m.inited) initMemory(w, m);
  const cfg = cfgOf(m);
  const vs = w.vs as NonNullable<World['vs']>;

  const H = T.height;
  const hpFrac = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const speed = maxSpeedOf(T);
  const dir = { x: 0, z: 0 };
  let threatened = false;
  T.kit.sim_aimLead = m.level === 'veteran' ? 1 : m.level === 'regular' ? 0.5 : 0;   // HEARTHBACK stomp lead (hint)

  // ── CARD RAIL: answer an open offer (one edge per offer) ──
  railAnswer(w, m, slot, out);

  // ── 1. THREAT: step out of hostile paint, dash when walking out is too slow ──
  const th = assessThreat(w, m);
  if (th) {
    threatened = true;
    setMode(w, m, 'threat');
    dir.x = th.dx; dir.z = th.dz;
    const walkable = speed * Math.max(0, th.tLeft - 0.05);
    const late = th.tLeft <= TITAN.dashIframes && th.need > 0.25 * T.radius;
    if (VS_BOT_TUNE.threatDash && (late || (th.need > walkable && th.tLeft < 0.9)) && T.dashCharges >= 1 && T.dashT <= 0) out.dash = true;
  }

  // ── 2. RING: stay inside the next ring step ──
  const ring = ringPlan(w, T);
  let ringed = false;
  if (!threatened && ring.active && ring.dist > ring.safeR) {
    ringed = true;
    setMode(w, m, 'ring');
    dir.x = ring.ux; dir.z = ring.uz;
    if (ring.urgent && T.dashCharges >= 1 && T.dashT <= 0 && ring.dist - ring.safeR > 3 * H && !hasPaintAround(w)) out.dash = true;
  }

  // ── 3. TENDER / BOSS ──
  const tender = !threatened && !ringed && pvpOrOpen(vs.phase) ? chooseTender(w) : null;
  const b = w.boss;
  let bossGap = Infinity, bossTanX = 0, bossTanZ = 0;
  let bossEngaged = false;
  if (!threatened && !ringed && b && b.alive && (tender === null ? false : tender.live)) {
    bossEngaged = true;
    setMode(w, m, 'tender');
    let best = Infinity, px = b.x, pz = b.z;
    for (let i = 0; i < b.parts.length; i++) {
      const p = b.parts[i];
      const d = hypot(p.x - T.x, p.z - T.z) - p.r;
      if (d < best) { best = d; px = p.x; pz = p.z; }
    }
    if (!isFinite(best)) best = hypot(b.x - T.x, b.z - T.z);
    const reach = T.id === 'voltkite' ? Math.min(reachOf(w), 0.9 * H) : reachOf(w);
    const to = { x: 0, z: 0 };
    norm(px - T.x, pz - T.z, to);
    if (w.tick - m.strafeFlipTick > 180) { m.strafeSign = -m.strafeSign; m.strafeFlipTick = w.tick; }
    const tx = to.z * m.strafeSign, tz = -to.x * m.strafeSign;
    bossGap = best; bossTanX = tx; bossTanZ = tz;
    const g = botGate(w, GATE_OUT);
    if (g) norm(g.x - T.x, g.z - T.z, dir);
    else if (b.introT > 0) {
      if (best < reach * 1.2) { dir.x = -to.x; dir.z = -to.z; }
    } else if (best > reach * 0.75) { dir.x = to.x * 0.9 + tx * 0.1; dir.z = to.z * 0.9 + tz * 0.1; }
    else if (best < reach * 0.4) { dir.x = -to.x * 0.6 + tx * 0.8; dir.z = -to.z * 0.6 + tz * 0.8; }
    else { dir.x = to.x * 0.15 + tx; dir.z = to.z * 0.15 + tz; }
  } else if (tender && !threatened && !ringed && !tender.live) {
    // the marker is up: walk to the crosswalk it will arrive at, then wait there eating what is around
    const d = hypot(tender.x - T.x, tender.z - T.z);
    if (d > 3 * H) { setMode(w, m, 'tender'); norm(tender.x - T.x, tender.z - T.z, dir); }
  }

  // ── 4. RIVAL: engage / flee (PvP live) ──
  let rival: TitanState | null = null;
  let rivalSlot = -1;
  let fleeing = false;
  if (VS_BOT_TUNE.rivalLayer && pvpOnIn(vs.phase)) {
    // a person needs a moment to give up a fight: the flee only starts once the bot has been losing for the difficulty's delay
    if (shouldFlee(w, m, T, hpFrac)) {
      if (m.data.loseTick === undefined || m.data.loseTick < 0) m.data.loseTick = w.tick;
      if (w.tick - m.data.loseTick >= VSX.botFleeDelayTicks[m.level]) m.fleeUntil = w.tick + FLEE_HOLD_TICKS;
    } else m.data.loseTick = -1;
    fleeing = w.tick < m.fleeUntil;
    rivalSlot = chooseRival(w, m, fleeing);
    if (rivalSlot >= 0) rival = w.players[rivalSlot].titan;
    if (!threatened && !ringed && !bossEngaged) {
      if (fleeing) {
        const f = nearestThreatRival(w, T);
        if (f !== null) {
          setMode(w, m, 'flee');
          norm(T.x - f.x, T.z - f.z, dir);
          const ringDir = ring.active ? 0.6 : 0;                         // bias toward the ring centre while it matters
          dir.x += ring.ux * ringDir; dir.z += ring.uz * ringDir;
          if (T.dashCharges >= 1 && T.dashT <= 0 && hypot(f.x - T.x, f.z - T.z) < 2.5 * (H + f.height) * 0.5) out.dash = true;
        }
      } else if (rival !== null) {
        setMode(w, m, 'rival');
        if (m.engagedTick < 0) m.engagedTick = w.tick;
        const to = { x: 0, z: 0 };
        const gap = norm(rival.x - T.x, rival.z - T.z, to) - rival.radius;
        const reach = reachOf(w);
        if (w.tick - m.strafeFlipTick > 150) { m.strafeSign = -m.strafeSign; m.strafeFlipTick = w.tick; }
        const tx = to.z * m.strafeSign, tz = -to.x * m.strafeSign;
        if (T.id === 'molo') {
          // CURB BITE only fires inside a narrow cone ahead of the head: a brawler keeps its nose ON the target
          dir.x = to.x; dir.z = to.z;
        } else if (gap > reach * 0.8) { dir.x = to.x * 0.95 + tx * 0.05; dir.z = to.z * 0.95 + tz * 0.05; }
        else if (gap < reach * 0.3) { dir.x = -to.x * 0.5 + tx * 0.8; dir.z = -to.z * 0.5 + tz * 0.8; }
        else { dir.x = to.x * 0.45 + tx * 0.6; dir.z = to.z * 0.45 + tz * 0.6; }
        // offensive dash: close a gap, or tackle / shove when already near (veteran / regular only)
        if (!out.dash && m.level !== 'rookie' && T.dashCharges >= 1 && T.dashT <= 0) {
          const dd = (T.stats.dashDistance || 2.2) * H;
          const finish = rival.maxHp > 0 && rival.hp / rival.maxHp <= VSX.botFinishFrac;      // a hurt rival is run down, not waited for
          if (gap > dd * 0.9 && gap < dd * 2.2 && (finish || T.dashCharges >= Math.max(1, Math.round(T.stats.dashCharges)))) { out.mx = to.x; out.mz = to.z; out.dash = true; }
          else if (m.level === 'veteran' && gap < dd * 0.9 && gap > 0.5 * H && (T.id === 'molo' || T.id === 'hearthback')) { out.mx = to.x; out.mz = to.z; out.dash = true; }
        }
      } else m.engagedTick = -1;
    }
    if (rivalSlot < 0) m.engagedTick = -1;
  } else m.targetSlot = -1;

  // ── 5. FOOD with stuck detection ──
  const inFight = ringed || bossEngaged || (rival !== null && !fleeing && mode(m) === 'rival') || (fleeing && mode(m) === 'flee');
  if (!threatened && !inFight && dir.x === 0 && dir.z === 0) {
    setMode(w, m, 'food');
    if (w.tick < m.detourUntil) {
      dir.x = m.detourX; dir.z = m.detourZ;
    } else {
      const reached = m.hasTarget && hypot(m.tx - T.x, m.tz - T.z) < Math.max(1.5, T.radius * 0.8);
      if (!m.hasTarget || reached || w.tick - m.planTick >= PLAN_EVERY_TICKS) {
        planFood(w, m, hpFrac < LOW_HP, ring);
        m.planTick = w.tick;
      }
      norm(m.tx - T.x, m.tz - T.z, dir);
      if (dir.x === 0 && dir.z === 0) { dir.x = sin(T.heading); dir.z = cos(T.heading); }
    }
  }

  // stuck detector (only while freely walking)
  if (w.tick - m.checkTick >= STUCK_CHECK_TICKS) {
    const moved = hypot(T.x - m.lastX, T.z - m.lastZ);
    const expected = speed * ((w.tick - m.checkTick) / 30);
    if (m.wasMoving && !threatened && T.dashT <= 0 && !T.leash && T.slowT <= 0 && moved < STUCK_FRAC * expected && !(rival !== null && !fleeing && T.id === 'molo')) {
      m.detourSign = -m.detourSign;
      const fx = m.hasTarget ? m.tx - T.x : sin(T.heading);
      const fz = m.hasTarget ? m.tz - T.z : cos(T.heading);
      const f = { x: 0, z: 0 };
      if (norm(fx, fz, f) < 1e-9) { f.x = sin(T.heading); f.z = cos(T.heading); }
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

  // map detour (objectives / power-ups) when nothing more urgent holds the bot
  if (!threatened && !inFight && !ringed) {
    const det = botDetour(w, DETOUR);
    if (det) { dir.x = det.x - T.x; dir.z = det.z - T.z; }
  }

  // keep inside the playable bounds
  const bd = w.city.bounds, edge = Math.max(3, T.radius * 1.5);
  if (T.x < bd.minX + edge && dir.x < 0) dir.x = Math.abs(dir.x) * 0.5;
  if (T.x > bd.maxX - edge && dir.x > 0) dir.x = -Math.abs(dir.x) * 0.5;
  if (T.z < bd.minZ + edge && dir.z < 0) dir.z = Math.abs(dir.z) * 0.5;
  if (T.z > bd.maxZ - edge && dir.z > 0) dir.z = -Math.abs(dir.z) * 0.5;

  if (out.dash && (out.mx !== 0 || out.mz !== 0)) {
    // an offensive dash set its own direction above
  } else {
    const u = { x: 0, z: 0 };
    if (norm(dir.x, dir.z, u) < 1e-9) { u.x = sin(T.heading); u.z = cos(T.heading); }
    out.mx = u.x; out.mz = u.z;
  }

  // ── hook ──
  if (hookDecision(w, m, rival)) {
    out.ability = true;
    m.holdAbilityUntil = w.tick + 36;                    // MOLO's vacuum is a 1.2 s channel: keep holding
  }
  out.abilityHeld = out.ability || w.tick < m.holdAbilityUntil;

  // ── UPROAR ──
  if (botUltimateVs(w, m.level, rival)) out.ultimate = true;

  // ── travel dash (never spend the last charge when paint is around) ──
  if (!out.dash && !threatened && T.dashCharges >= 1 && T.dashT <= 0) {
    const maxCharges = Math.max(1, Math.round(T.stats.dashCharges || 1));
    const paintAround = hasPaintAround(w);
    if (T.id === 'voltkite') {
      const a = scanEnemies(w, (T.stats.dashDistance || 2.2) * H * 1.6, 1.5 * H);
      if (a.near >= 3 && (T.dashCharges >= 2 || !paintAround) && !inFight) {
        const c = { x: 0, z: 0 };
        if (norm(a.cx - T.x, a.cz - T.z, c) > 0.5 * H) { out.mx = c.x; out.mz = c.z; out.dash = true; }
      }
      if (!out.dash && bossEngaged && b && b.alive && b.introT <= 0 && bossGap < 0.8 * H && (bossTanX !== 0 || bossTanZ !== 0)
        && (T.dashCharges >= 2 || !paintAround) && wireState(w, null).wires < 5) {
        out.mx = bossTanX; out.mz = bossTanZ; out.dash = true;
      }
      // lay LIVE WIRE across a rival's path when kiting it (veteran: wires then DETONATE)
      if (!out.dash && m.level === 'veteran' && rival !== null && !fleeing && T.dashCharges >= 2) {
        const gapR = hypot(rival.x - T.x, rival.z - T.z) - rival.radius;
        if (gapR < 2.2 * H && gapR > 0.6 * H) {
          const tt = { x: 0, z: 0 };
          norm(rival.x - T.x, rival.z - T.z, tt);
          out.mx = tt.z * m.strafeSign; out.mz = -tt.x * m.strafeSign; out.dash = true;
        }
      }
    }
    if (!out.dash && T.dashCharges >= maxCharges && !paintAround && !bossEngaged && !(rival !== null && !fleeing) && m.hasTarget && !inFight) {
      const dT = hypot(m.tx - T.x, m.tz - T.z);
      if (dT > (T.stats.dashDistance || 2.2) * H * 1.2) out.dash = true;
    }
  }
  return out;
}

function mode(m: BotMemory): string { return m.mode; }
function pvpOrOpen(phase: string): boolean { return phase === 'open' || phase === 'takeover' || phase === 'final' || phase === 'last'; }

/** Any not-yet-fired hostile paint on the ground (the bot keeps a dash charge spare). */
function hasPaintAround(w: World): boolean {
  for (let i = 0; i < w.telegraphs.length; i++) {
    const tg = w.telegraphs[i];
    if (tg.alive && tg.owner !== 'titan' && !tg.fired) return true;
  }
  return false;
}

/** The living rival closest to me within 10 body heights (what a fleeing bot runs from); null when none. */
function nearestThreatRival(w: World, T: TitanState): TitanState | null {
  let best: TitanState | null = null, bestD = Infinity;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur) continue;
    const P = w.players[i];
    if (P.vs.eliminated || !P.titan.alive) continue;
    const d = hypot(P.titan.x - T.x, P.titan.z - T.z);
    if (d < bestD && d < 10 * Math.max(T.height, P.titan.height)) { bestD = d; best = P.titan; }
  }
  return best;
}

/** Exposed for the probes: the size edge the RIVAL layer would see against `slot` (rank difference). */
export function botRankEdge(w: World, slot: number): number { return sizeEdge(w.titan.rank, w.players[slot].titan.rank); }
