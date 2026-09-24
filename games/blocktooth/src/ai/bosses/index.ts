// BLOCKTOOTH — containment boss hub (ai lane, CONTRACT §5.3, §10). THREE-free, DOM-free,
// deterministic: every boss roll comes from world.rng.boss.
//
// Contract exports: spawnBoss / stepBoss / damageBoss. The rest of this file is the shared boss
// toolkit the two boss modules (caisson4.ts, irongully.ts) are built from — lane-internal.
//
// Shared rules implemented here (§10):
//   * HP = BossDef.hp × BOSS_HP_SCALE[titan.rank]; 4 s intro walk-in from the city edge
//     (CAISSON-4 wades in from the harbour side on LOCKWATER), invulnerable while introT > 0.
//   * damageBoss: part hpMul, ×2 while staggered, meter (STRAIN / FRACTURE) fills from damage to
//     high-strainMul parts; meter 1 → 5 s stagger (`bossStagger`), meter resets, the current
//     attack is interrupted (painted-but-unfired tells are wiped, the winch lets go).
//   * Phase 2 at 66 % hp, phase 3 at 33 % (`bossPhase` + alert bossPhase2/bossPhase3).
//   * Defeat → alive = false, `bossDefeated`; every pending boss tell is cancelled.
//   * Every tick: timers, the module's AI, titan shove (hook knock), titan pushed out of the body,
//     bounds clamp, part world positions, leg-crush of the city underfoot, subtitle.
//   * "Never two unreadable telegraphs stacked on the same spot at once": bossTelegraph() delays
//     a new tell that would land on the same spot within 0.45 s of a pending one.

import type { BossId, BossPart, BossState, DamageOpts, Shape, Telegraph, Tier, World } from '../../core/types.ts';
import { BOSS_DMG_MUL, BOSS_FATIGUE, BOSS_HP_SCALE, BOSS_KIND_MUL, BOSS_PHASE_DMG_MUL, RANKS, titanSpeed } from '../../core/config.ts';
import { clamp, dist, shapeCenter, turnToward, wrapAngle } from '../../core/math.ts';
import { BOSSES, bossSubtitle } from '../../data/bosses.ts';
import { spawnTelegraph } from '../../combat/telegraphs.ts';
import type { TelegraphSpawn } from '../../combat/telegraphs.ts';
import { buildingsInRect, damageBuilding, damageProp, propsInRect, resolveCircleVsCity } from '../../city/citysim.ts';
import * as caisson4 from './caisson4.ts';
import * as irongully from './irongully.ts';

// ─────────────────────────────── tuning (lane-local) ───────────────────────────────
export const INTRO_S = 4;
export const STAGGER_S = 5;
/** Meter gained = dealt × strainMul / (METER_HP_FRAC × maxHp). */
const METER_HP_FRAC = 0.45;
/** Meter bleeds off after this long without gain, at METER_DECAY per second. */
const METER_IDLE_S = 4, METER_DECAY = 0.03;
/** Titan shove decay (1/s). */
const SHOVE_DECAY = 5;
/** Leg crush cadence (s) and damage (× the building's floor HP). */
const CRUSH_EVERY = 0.3, CRUSH_FLOORS = 2.5;
/** Pending boss tells closer than this × their radius and firing within STACK_DT s are "stacked". */
const STACK_FRAC = 0.6, STACK_DT = 0.45;
/** Past its range band the boss closes at up to this × the titan's walk speed (see keepRange). */
const BOSS_CLOSE_FRAC = 0.6;
/** Boss entry: preferred distance from the titan (m) and minimum room. */
const ENTRY_D = 230, ENTRY_MIN = 160;

interface BossModule {
  create(w: World): BossState;
  step(w: World, b: BossState): void;
  onDamage?(w: World, b: BossState, part: number, dmg: number): void;
}
const MODS: Record<BossId, BossModule> = { caisson4, irongully };

// ─────────────────────────────── toolkit (used by the boss modules) ───────────────────────────────
/** Aim lead per phase, as a fraction of the attack's windup: the paint is laid where the titan
 *  WILL be if it keeps its current heading (the paint is on the ground for the whole windup, so it
 *  stays an honest tell — the player must read it and turn, not just keep strafing). */
const LEAD_FRAC: readonly number[] = [0, 0.5, 0.65, 0.8];
/** Velocity used for the lead is capped at this × the body's walk speed (a dash never throws it). */
const LEAD_SPEED_CAP = 1.2;

/** Predicted titan position `windup × LEAD_FRAC[phase] × frac` seconds ahead, clamped to bounds. */
export function leadPoint(w: World, b: BossState, windup: number, out: { x: number; z: number }, frac = 1): { x: number; z: number } {
  const T = w.titan, B = w.city.bounds;
  let vx = Number.isFinite(T.vx) ? T.vx : 0, vz = Number.isFinite(T.vz) ? T.vz : 0;
  const sp = Math.hypot(vx, vz), cap = LEAD_SPEED_CAP * titanSpeed(T.height);
  if (sp > cap) { vx *= cap / sp; vz *= cap / sp; }
  const s = Math.max(0, windup) * (LEAD_FRAC[b.phase] ?? 0) * frac;
  out.x = clamp(T.x + vx * s, B.minX, B.maxX);
  out.z = clamp(T.z + vz * s, B.minZ, B.maxZ);
  return out;
}

/** × every telegraph/lob windup by phase: the boss gets quicker as it breaks down (a P3 hook
 *  drop paints for 1.1 s instead of 1.5 s — still ≥ 2 × a player's reaction time). */
const WINDUP_MUL: readonly number[] = [1, 1, 0.8, 0.68];
export function bossWindupMul(b: BossState): number { return WINDUP_MUL[b.phase] ?? 1; }

/** Hostile damage scaled by the titan's rank HP multiplier (§5.4). */
export function bossHostile(w: World, base: number): number {
  const ph = w.boss ? w.boss.phase : 1;
  return base * BOSS_DMG_MUL * (BOSS_PHASE_DMG_MUL[ph] ?? 1) * RANKS[w.titan.rank].hpMul;
}

export function makePart(name: string, ox: number, oz: number, r: number, y0: number, y1: number, hpMul = 1, strainMul = 0.3): BossPart {
  return { name, ox, oz, r, y0, y1, hpMul, strainMul, x: 0, z: 0 };
}

/** A fresh BossState (the module fills parts/position; spawnBoss sets hp). */
export function baseBoss(id: BossId, x: number, z: number, heading: number, parts: BossPart[]): BossState {
  const b: BossState = {
    id, alive: true,
    x, z, heading, px: x, pz: z, pheading: heading,
    hp: 1, maxHp: 1, phase: 1, meter: 0, staggerT: 0,
    attack: null, attackT: 0, cd: 1.2, introT: INTRO_S,
    parts, subtitle: bossSubtitle(id, null),
    data: { t: 0, speed: 0, walk: 0, meterIdle: 0, crushT: 0, kvx: 0, kvz: 0, last: -1, last2: -1, leash: 0, charge: 0, breath: 0, flash: 0 },
  };
  refreshParts(b);
  return b;
}

/** Local (ox,oz) → world, exactly as THREE applies rotation.y = heading to a +Z-facing model. */
export function refreshParts(b: BossState): void {
  const c = Math.cos(b.heading), s = Math.sin(b.heading);
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i];
    p.x = b.x + p.ox * c + p.oz * s;
    p.z = b.z - p.ox * s + p.oz * c;
  }
}

/** World position of a boss-local point (same rotation as refreshParts). */
export function localToWorld(b: BossState, ox: number, oz: number, out: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(b.heading), s = Math.sin(b.heading);
  out.x = b.x + ox * c + oz * s;
  out.z = b.z - ox * s + oz * c;
  return out;
}

/** Start an attack: latch id, reset its clock, subtitle, `bossAttack` event. */
export function beginAttack(w: World, b: BossState, id: string, x: number, z: number): void {
  b.attack = id;
  b.attackT = 0;
  b.subtitle = bossSubtitle(b.id, id);
  b.data.last2 = b.data.last;
  b.data.last = attackIndex(b.id, id);
  w.events.push({ type: 'bossAttack', attack: id, x, z });
}

/** Finish the current attack; the next decision comes after `gap` seconds. */
export function endAttack(b: BossState, gap: number): void {
  b.attack = null;
  b.attackT = 0;
  b.cd = Math.max(0.2, gap);
  b.subtitle = bossSubtitle(b.id, null);
  b.data.charge = 0; b.data.breath = 0;
}

export function attackIndex(id: BossId, attack: string): number {
  const list = BOSSES[id].attacks;
  for (let i = 0; i < list.length; i++) if (list[i].id === attack) return i;
  return -1;
}

/** Anti-spam weight: the same attack a third time in a row is strongly discouraged. */
export function repeatMul(b: BossState, attack: string): number {
  const i = attackIndex(b.id, attack);
  if (i === b.data.last && i === b.data.last2) return 0.1;
  if (i === b.data.last) return 0.45;
  return 1;
}

/** Weighted pick from parallel arrays (rng.boss). */
export function pickWeighted(w: World, ids: readonly string[], wts: readonly number[]): string | null {
  let total = 0;
  for (let i = 0; i < wts.length; i++) total += Math.max(0, wts[i]);
  if (!(total > 0)) return null;
  let x = w.rng.boss() * total;
  for (let i = 0; i < ids.length; i++) { x -= Math.max(0, wts[i]); if (x <= 0) return ids[i]; }
  return ids[ids.length - 1];
}

function spotRadius(s: Shape): number {
  switch (s.k) {
    case 'circle': return s.r;
    case 'ring': return s.r1;
    case 'oval': return Math.max(s.rx, s.rz);
    case 'cone': return s.r * 0.5;
    case 'lane': return Math.max(s.w, s.len * 0.25);
    case 'capsule': return s.r;
  }
}

/**
 * Spawn a boss-owned telegraph. If an unfired boss tell of the same style already covers the
 * same spot and would fire within STACK_DT of this one, this tell is pushed back so the two read
 * as a sequence (never an unreadable stack).
 */
export function bossTelegraph(w: World, spec: Omit<TelegraphSpawn, 'owner'>): Telegraph {
  // later phases paint faster (the winch oval and the charge lane keep their scripted timing)
  const b = w.boss;
  const scale = b && spec.tag !== 'winch' && spec.tag !== 'ridgeCharge' ? bossWindupMul(b) : 1;
  let windup = spec.windup * scale;
  const c = shapeCenter(spec.shape), r = spotRadius(spec.shape);
  for (let guard = 0; guard < 4; guard++) {
    let moved = false;
    for (let i = 0; i < w.telegraphs.length; i++) {
      const o = w.telegraphs[i];
      if (!o.alive || o.fired || o.owner !== 'boss' || o.style !== spec.style) continue;
      const oc = shapeCenter(o.shape), orr = spotRadius(o.shape);
      if (dist(c.x, c.z, oc.x, oc.z) > STACK_FRAC * Math.min(r, orr)) continue;
      const oFire = o.windup - o.t;
      if (Math.abs(oFire - windup) < STACK_DT) { windup = oFire + STACK_DT + 0.05; moved = true; }
    }
    if (!moved) break;
  }
  return spawnTelegraph(w, { ...spec, windup, owner: 'boss' });
}

/** Cancel unfired boss tells. `keepLobs` keeps the circles under projectiles already in flight. */
export function cancelBossTells(w: World, keepLobs: boolean): void {
  for (let i = 0; i < w.telegraphs.length; i++) {
    const t = w.telegraphs[i];
    if (!t.alive || t.owner !== 'boss') continue;
    if (t.fired && t.active <= 0) continue;
    if (keepLobs && t.tag.startsWith('lob:')) continue;
    t.alive = false;
  }
  if (!keepLobs) for (let i = 0; i < w.projectiles.length; i++) {
    const p = w.projectiles[i];
    if (p.alive && p.owner === 'boss') p.alive = false;
  }
}

/** Let go of the winch leash (if it is ours). */
export function releaseLeash(w: World, b: BossState): void {
  const T = w.titan;
  if (T.leash) {
    w.events.push({ type: 'leash', on: false, x: T.leash.lx, z: T.leash.lz });
    T.leash = null;
  }
  b.data.leash = 0;
}

/** Shove the titan (hook knock / charge side-swipe): velocity (m/s) that decays over ~0.4 s. */
export function shoveTitan(b: BossState, dx: number, dz: number, speed: number): void {
  const m = Math.hypot(dx, dz);
  if (!(m > 1e-6) || !(speed > 0)) return;
  b.data.kvx = (dx / m) * speed;
  b.data.kvz = (dz / m) * speed;
}

/** Add to the STRAIN / FRACTURE meter (no gain while staggered); full → stagger. */
export function addMeter(w: World, b: BossState, amount: number): void {
  if (!b.alive || b.staggerT > 0 || b.introT > 0 || !(amount > 0)) return;
  b.meter += amount;
  b.data.meterIdle = 0;
  if (b.meter >= 1) {
    b.meter = 0;
    b.staggerT = STAGGER_S;
    if (b.attack) endAttack(b, 1.2);
    cancelBossTells(w, true);
    releaseLeash(w, b);
    b.data.speed = 0;
    w.events.push({ type: 'bossStagger' });
  }
}

/** Turn toward a heading at a limited rate. */
export function turnBoss(b: BossState, want: number, rate: number, dt: number): void {
  b.heading = wrapAngle(turnToward(b.heading, want, rate * dt));
}

/** Move by (vx,vz)·dt; tracks speed + gait distance for the view. */
export function moveBoss(w: World, b: BossState, vx: number, vz: number): void {
  const dt = w.dt;
  b.x += vx * dt; b.z += vz * dt;
  const sp = Math.hypot(vx, vz);
  b.data.speed = sp;
  b.data.walk += sp * dt;
}

/**
 * Ranged footwork: keep the titan between minD and maxD (centre to centre) while facing it;
 * drifts sideways inside the band so the silhouette stays alive.
 */
export function keepRange(w: World, b: BossState, minD: number, maxD: number, speed: number, turn: number): void {
  const T = w.titan, dt = w.dt;
  const dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  turnBoss(b, Math.atan2(dx, dz), turn, dt);
  let vx = 0, vz = 0;
  if (d > maxD) {
    // a Size V titan runs 50+ m/s: past the band the rig strides to close (ramping with the gap)
    // instead of ambling at its §10 walk speed while the fight drifts off-screen
    const over = clamp((d - maxD) / maxD, 0, 1);
    const sp = Math.max(speed, over * BOSS_CLOSE_FRAC * titanSpeed(T.height));
    vx = nx * sp; vz = nz * sp;
  }
  else if (d < minD) { vx = -nx * speed; vz = -nz * speed; }
  else {
    if (!(b.data.side === 1 || b.data.side === -1)) b.data.side = w.rng.boss() < 0.5 ? -1 : 1;
    b.data.sideT = (b.data.sideT ?? 0) - dt;
    if (b.data.sideT <= 0) { b.data.side = -b.data.side; b.data.sideT = 5 + 4 * w.rng.boss(); }
    const s = speed * 0.35 * b.data.side;
    vx = -nz * s; vz = nx * s;
  }
  moveBoss(w, b, vx, vz);
}

/** Entrance walk: head for the titan at `speed` until inside `stopD`. */
export function introWalk(w: World, b: BossState, speed: number, stopD: number): void {
  const T = w.titan;
  const dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz) || 1;
  turnBoss(b, Math.atan2(dx, dz), 1.5, w.dt);
  if (d > stopD) moveBoss(w, b, (dx / d) * speed, (dz / d) * speed);
  else b.data.speed = 0;
}

/**
 * Where a boss enters: toward the nearest city edge that still leaves room, ENTRY_D from the
 * titan (at the edge when it is closer). `harbour` forces the −Z (harbour) side when there is
 * room (LOCKWATER's waterfront is the −Z edge).
 */
export function entryPoint(w: World, harbour: boolean, out: { x: number; z: number; heading: number }): void {
  const T = w.titan, B = w.city.bounds;
  const room = [B.maxX - T.x, T.x - B.minX, B.maxZ - T.z, T.z - B.minZ];   // +X, −X, +Z, −Z
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = -1;
  if (harbour && room[3] >= ENTRY_MIN * 0.75) best = 3;
  if (best < 0) {
    let bestRoom = Infinity;
    for (let i = 0; i < 4; i++) if (room[i] >= ENTRY_MIN && room[i] < bestRoom) { bestRoom = room[i]; best = i; }
  }
  if (best < 0) { let m = -1; for (let i = 0; i < 4; i++) if (room[i] > m) { m = room[i]; best = i; } }
  const d = clamp(Math.min(ENTRY_D, room[best] - 6), 0, ENTRY_D);
  // a slight seeded skew so the entrance is not always dead-on the axis
  const skew = (w.rng.boss() - 0.5) * 0.5 * d;
  const [ax, az] = dirs[best];
  out.x = clamp(T.x + ax * d - az * skew, B.minX, B.maxX);
  out.z = clamp(T.z + az * d + ax * skew, B.minZ, B.maxZ);
  out.heading = Math.atan2(T.x - out.x, T.z - out.z);
}

// ─────────────────────────────── internal per-tick helpers ───────────────────────────────
const PUSH = { x: 0, z: 0, bumpTier: -1 };
const idBuf: number[] = [];

/** Apply the hook/charge shove to the titan, keeping it out of blocking buildings and in bounds. */
function applyShove(w: World, b: BossState): void {
  const T = w.titan, dt = w.dt;
  const kx = b.data.kvx, kz = b.data.kvz;
  if (!(kx * kx + kz * kz > 1e-4) || !T.alive) { b.data.kvx = 0; b.data.kvz = 0; return; }
  T.x += kx * dt; T.z += kz * dt;
  const k = Math.max(0, 1 - SHOVE_DECAY * dt);
  b.data.kvx = kx * k; b.data.kvz = kz * k;
  settleTitan(w);
}

function settleTitan(w: World): void {
  const T = w.titan, B = w.city.bounds;
  PUSH.x = T.x; PUSH.z = T.z; PUSH.bumpTier = -1;
  if (resolveCircleVsCity(w.city, T.x, T.z, T.radius, RANKS[T.rank].canFlatten as Tier, PUSH)) {
    if (Number.isFinite(PUSH.x) && Number.isFinite(PUSH.z)) { T.x = PUSH.x; T.z = PUSH.z; }
  }
  T.x = clamp(T.x, B.minX, B.maxX);
  T.z = clamp(T.z, B.minZ, B.maxZ);
}

/** The titan cannot stand inside the boss's body (parts[0]); eased push-out. */
function pushTitanOut(w: World, b: BossState): void {
  const T = w.titan;
  const p = b.parts[0];
  if (!p || !T.alive) return;
  const rr = p.r + T.radius * 0.7;
  const dx = T.x - p.x, dz = T.z - p.z, d = Math.hypot(dx, dz);
  if (d >= rr) return;
  const need = rr - d;
  const step = Math.min(need, Math.max(2, need * 0.5));
  if (d > 1e-4) { T.x += (dx / d) * step; T.z += (dz / d) * step; }
  else { T.x -= Math.sin(b.heading) * step; T.z -= Math.cos(b.heading) * step; }
  settleTitan(w);
}

/** Legs (parts reaching the ground) pancake the city they stand on; props are flattened. */
const crushOpts: DamageOpts = { src: 'boss', kind: 'slam', noCrit: true };
function crushUnder(w: World, b: BossState): void {
  b.data.crushT -= w.dt;
  if (b.data.crushT > 0) return;
  b.data.crushT = CRUSH_EVERY;
  const c = w.city;
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i];
    const charging = b.data.charge > 0 && i === 0;
    if (p.y0 > 1 && !charging) continue;
    const r = p.r + (charging ? 6 : 1);
    buildingsInRect(c, p.x - r, p.z - r, p.x + r, p.z + r, idBuf);
    for (let k = 0; k < idBuf.length; k++) {
      const bd = c.buildings[idBuf[k]];
      if (!bd || bd.collapsed) continue;
      const qx = clamp(p.x, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(p.z, bd.z - bd.d / 2, bd.z + bd.d / 2);
      if (Math.hypot(p.x - qx, p.z - qz) > r) continue;
      damageBuilding(w, bd.id, bd.floorHpMax * CRUSH_FLOORS * (charging ? 2 : 1), crushOpts);
    }
    idBuf.length = 0;
    propsInRect(c, p.x - r, p.z - r, p.x + r, p.z + r, idBuf);
    for (let k = 0; k < idBuf.length; k++) {
      const pr = c.props[idBuf[k]];
      if (pr && pr.alive && dist(pr.x, pr.z, p.x, p.z) <= r) damageProp(w, pr.id, 1e6, crushOpts);
    }
    idBuf.length = 0;
  }
}

function checkPhase(w: World, b: BossState): void {
  if (!b.alive) return;
  const f = b.maxHp > 0 ? b.hp / b.maxHp : 0;
  while ((b.phase === 1 && f <= 0.66) || (b.phase === 2 && f <= 0.33)) {
    b.phase = (b.phase + 1) as 2 | 3;
    w.events.push({ type: 'bossPhase', phase: b.phase });
    w.events.push({ type: 'alert', key: b.phase === 2 ? 'bossPhase2' : 'bossPhase3' });
    // a short roar before the new procedures (an attack in progress still finishes)
    if (!b.attack) b.cd = Math.max(b.cd, 1.4);
  }
}

function defeat(w: World, b: BossState): void {
  b.hp = 0;
  b.alive = false;
  b.attack = null;
  b.attackT = 0;
  b.staggerT = 0;
  b.subtitle = bossSubtitle(b.id, null);
  b.data.speed = 0; b.data.charge = 0; b.data.breath = 0;
  cancelBossTells(w, false);
  releaseLeash(w, b);
  w.events.push({ type: 'bossDefeated', x: b.x, z: b.z });
}

// ─────────────────────────────── contract exports ───────────────────────────────
/**
 * Field a boss (director at the scheduled time, or the dev cheat). Scales HP by the titan's rank,
 * raises `alert boss`, emits `bossSpawn`, marks the director (so the run can be cleared) and
 * switches run.phase to 'boss'. No-op while a boss is alive.
 */
export function spawnBoss(w: World, id: BossId): void {
  if (w.boss && w.boss.alive) return;
  const mod = MODS[id];
  if (!mod) return;
  const b = mod.create(w);
  const hp = BOSSES[id].hp * BOSS_HP_SCALE[w.titan.rank];
  b.hp = hp; b.maxHp = hp;
  b.phase = 1; b.meter = 0; b.staggerT = 0; b.attack = null; b.attackT = 0;
  b.introT = INTRO_S;
  b.subtitle = bossSubtitle(id, null);
  refreshParts(b);
  w.boss = b;
  const D = w.director;
  D.bossSpawned = true;
  if (!(D.bossT <= w.t)) D.bossT = w.t;
  if (!w.run.result) w.run.phase = 'boss';
  w.events.push({ type: 'alert', key: 'boss' });
  w.events.push({ type: 'bossSpawn', boss: id });
}

/** Boss AI + part colliders (stepWorld, after stepEnemies). */
export function stepBoss(w: World): void {
  const b = w.boss;
  if (!b || !b.alive) return;
  const T = w.titan, dt = w.dt;
  const mod = MODS[b.id];
  b.data.t += dt;
  if (b.data.flash > 0) b.data.flash = Math.max(0, b.data.flash - dt);

  if (!T.alive) {
    b.data.speed = 0;
  } else if (b.introT > 0) {
    b.introT = b.introT - dt <= 1e-6 ? 0 : b.introT - dt;
    mod.step(w, b);                        // the module walks itself in (introT > 0 branch)
  } else if (b.staggerT > 0) {
    b.staggerT = b.staggerT - dt <= 1e-6 ? 0 : b.staggerT - dt;
    b.data.speed = 0;
    if (b.staggerT === 0) b.cd = Math.max(b.cd, 0.9);
  } else {
    if (b.attack) b.attackT += dt; else b.cd -= dt;
    mod.step(w, b);
  }

  applyShove(w, b);
  // structural fatigue (config BOSS_FATIGUE): the long fight wears the rig down
  if (T.alive && b.introT <= 0) {
    b.data.fightT = (b.data.fightT ?? 0) + dt;
    const over = b.data.fightT - BOSS_FATIGUE.startS;
    const rate = over > 0 ? Math.min(BOSS_FATIGUE.maxPerS, BOSS_FATIGUE.rampPerS * over) : 0;
    b.data.fatigue = rate;
    if (rate > 0) {
      b.hp -= rate * b.maxHp * dt;
      if (b.hp <= 1e-6) { defeat(w, b); return; }
    }
  }
  checkPhase(w, b);

  // meter bleed when the player stops working the weak points
  b.data.meterIdle += dt;
  if (b.data.meterIdle > METER_IDLE_S && b.meter > 0) b.meter = Math.max(0, b.meter - METER_DECAY * dt);

  const Bd = w.city.bounds;
  b.x = clamp(b.x, Bd.minX, Bd.maxX);
  b.z = clamp(b.z, Bd.minZ, Bd.maxZ);
  if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) { b.x = b.px; b.z = b.pz; }
  if (!Number.isFinite(b.heading)) b.heading = b.pheading;
  refreshParts(b);
  if (T.alive) pushTitanOut(w, b);
  crushUnder(w, b);
  b.subtitle = bossSubtitle(b.id, b.attack);
}

/**
 * Titan-side damage to one boss part (combat calls this per overlapping part). Applies the part's
 * hpMul and the stagger ×2, fills the meter by strainMul, emits `bossHit`, handles phases/defeat.
 * Invulnerable during the intro.
 */
export function damageBoss(w: World, part: number, dmg: number, opts: DamageOpts): void {
  const b = w.boss;
  if (!b || !b.alive || b.introT > 0) return;
  if (!(dmg > 0) || !Number.isFinite(dmg)) return;
  if (opts.src === 'enemy' || opts.src === 'boss') return;
  const pi = part >= 0 && part < b.parts.length ? part : 0;
  const p = b.parts[pi];
  if (!p) return;
  let d = dmg * (BOSS_KIND_MUL[opts.kind] ?? 1) * p.hpMul * (b.staggerT > 0 ? 2 : 1);
  if (d > b.hp) d = b.hp;
  b.hp -= d;
  b.data.flash = 0.12;
  // balance telemetry (probes read it; views ignore): damage dealt per DamageKind
  const tk = 'by_' + opts.kind;
  b.data[tk] = (b.data[tk] ?? 0) + d;
  w.events.push({ type: 'bossHit', part: p.name, dmg: d, x: p.x, z: p.z });
  const mod = MODS[b.id];
  if (mod.onDamage) mod.onDamage(w, b, pi, d);
  if (b.hp <= 1e-6) { defeat(w, b); return; }
  if (p.strainMul > 0 && b.maxHp > 0) addMeter(w, b, (d * p.strainMul) / (METER_HP_FRAC * b.maxHp));
  checkPhase(w, b);
}
