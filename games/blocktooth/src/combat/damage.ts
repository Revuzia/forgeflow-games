// BLOCKTOOTH — damage resolution (CONTRACT §5.3 / §5.4, combat lane).
// THREE-free, DOM-free, deterministic (crits from world.rng.combat, loot rolls from world.rng.loot).
//
// Two sides:
//   * TITAN side (src 'titan' | 'hazard'): damageArea / damageEnemy / killEnemy hit enemies (via the
//     spatial grid), boss parts (damageBoss per overlapping part) and the city (damageBuilding /
//     damageProp × buildingMul × stats.buildingDamage × OVERSIZE_DAMAGE_MUL for tiers the titan
//     cannot flatten yet). Crits, knockback (caller-scaled impulse × body-size resistance), aggregated
//     enemyHit events, capped lifesteal.
//   * HOSTILE side (src 'enemy' | 'boss'): damageTitanArea → hurtTitan, with thorns reflecting
//     stats.thorns × dmg back to the attacker.
//
// Every number the titan deals is a BASE number passed through titanDamage() by the caller.

import type { DamageKind, DamageOpts, Enemy, Prop, Shape, SimEvent, World } from '../core/types.ts';
import { KILL_MASS_RANK_MUL, OVERSIZE_DAMAGE_MUL, RANKS } from '../core/config.ts';
import { circleInShape, clamp, rectInShape, shapeBounds } from '../core/math.ts';
import { enemiesInShape, nearestEnemy } from './spatial.ts';
import { spawnPickup } from './pickups.ts';
import { ENEMIES } from '../data/enemies.ts';
import { damageBoss } from '../ai/bosses/index.ts';
import { buildingById, buildingsInRect, damageBuilding, damageProp, propsInRect } from '../city/citysim.ts';
import { healTitan, hurtTitan } from '../titans/titansim.ts';
import { stat } from '../upgrades/stats.ts';

// ─────────────────────────────── tuning (lane-local) ───────────────────────────────
/** Lifesteal heals at most this fraction of maxHp per tick (CONTRACT §5.4). */
const LIFESTEAL_CAP_PER_TICK = 0.02;
/** Hit-flash duration written to Enemy.flash (s). */
const HIT_FLASH_S = 0.12;
/** Chance a (non-elite) kill also drops a small heal pickup (rng.loot). */
const HEAL_DROP_CHANCE = 0.012;
/** Vehicles/heavies (director cost ≥ 5) drop heals a little more often. */
const HEAL_DROP_CHANCE_HEAVY = 0.05;
/** Knockback velocity is clamped to this magnitude (m/s) after stacking. */
const KNOCK_CAP_MIN = 40;
/** damageArea vs a multi-part boss: true = the shape's damage is SHARED by the overlapping parts
 *  (AoE ≈ single-target vs bosses); false = every overlapping part takes the full amount. */
const BOSS_AOE_SPLIT = true;

// ─────────────────────────────── scratch pools (re-entrant) ───────────────────────────────
// damageBuilding / damageBoss may call back into combat (e.g. a collapse shockwave) — each
// nesting level borrows its own scratch array so an outer loop is never corrupted.
const enemyPool: Enemy[][] = [];
let enemyDepth = 0;
function takeEnemies(): Enemy[] {
  if (enemyDepth >= enemyPool.length) enemyPool.push([]);
  const a = enemyPool[enemyDepth++];
  a.length = 0;
  return a;
}
function giveEnemies(): void { enemyDepth--; }

const idPool: number[][] = [];
let idDepth = 0;
function takeIds(): number[] {
  if (idDepth >= idPool.length) idPool.push([]);
  const a = idPool[idDepth++];
  a.length = 0;
  return a;
}
function giveIds(): void { idDepth--; }

// ─────────────────────────────── per-world tick bookkeeping ───────────────────────────────
type EnemyHitEvent = Extract<SimEvent, { type: 'enemyHit' }>;
interface TickBook {
  tick: number;
  hits: Map<number, EnemyHitEvent>;   // enemy id → this tick's aggregated enemyHit event
  healed: number;                      // lifesteal healed this tick
}
const books = new WeakMap<World, TickBook>();
function bookOf(w: World): TickBook {
  let b = books.get(w);
  if (!b) { b = { tick: w.tick, hits: new Map(), healed: 0 }; books.set(w, b); }
  if (b.tick !== w.tick) { b.tick = w.tick; b.hits.clear(); b.healed = 0; }
  return b;
}

// ─────────────────────────────── helpers ───────────────────────────────
/** Approximate footprint radius (m) of a prop (props carry no radius field). Lane-internal helper. */
export function propRadius(p: Prop): number {
  switch (p.kind) {
    case 'car': case 'taxi': return 2.1;
    case 'van': return 2.4;
    case 'bus': return 5.2;
    case 'truck': return 4.2;
    case 'kiosk': return 1.3;
    case 'hydrant': return 0.35;
    case 'lamp': return 0.35;
    case 'tree': return 1.2;
    case 'bench': return 0.9;
    case 'vending': return 0.6;
    case 'signpost': return 0.35;
    case 'barrier': return 1.2;
    case 'drum': return 0.45;
    case 'forklift': return 1.5;
    case 'container': return 3.1;
    case 'bollard': return 0.3;
    case 'boat': return 3.8;
    case 'pylon': return 0.5;
    case 'snowbank': return 1.6;
  }
  return 1;
}

const isTitanSide = (src: DamageOpts['src']): boolean => src === 'titan' || src === 'hazard';
const finitePos = (v: number): boolean => v > 0 && v < Infinity;

/** Anchor used for knockback direction and hurt-source position. */
function shapeOrigin(s: Shape, px: number, pz: number, out: { x: number; z: number }): { x: number; z: number } {
  if (s.k === 'capsule') {
    // knock away from the closest point of the segment
    const vx = s.x1 - s.x0, vz = s.z1 - s.z0;
    const L2 = vx * vx + vz * vz;
    const t = L2 > 1e-9 ? clamp(((px - s.x0) * vx + (pz - s.z0) * vz) / L2, 0, 1) : 0;
    out.x = s.x0 + vx * t; out.z = s.z0 + vz * t;
  } else if (s.k === 'lane') {
    // knock sideways out of the lane AND forward along it: origin = closest centreline point, pulled back
    const fx = Math.sin(s.dir), fz = Math.cos(s.dir);
    const along = clamp((px - s.x) * fx + (pz - s.z) * fz, 0, s.len);
    out.x = s.x + fx * (along - Math.max(1, s.w * 0.5)); out.z = s.z + fz * (along - Math.max(1, s.w * 0.5));
  } else {
    out.x = s.x; out.z = s.z;
  }
  return out;
}
const originScratch = { x: 0, z: 0 };

/** Knockback resistance from body size: small androids fly, tanks barely budge, elites shrug. */
function knockScale(e: Enemy): number {
  const s = clamp(1.1 / (0.5 + e.radius), 0.08, 1.2);
  return e.elite || e.kind === 'elite' ? s * 0.35 : s;
}

/**
 * Knockback: opts.knock is the finished impulse (m/s) — every caller (kits' knockFor, the upgrade
 * engine) already folds in stats.knockback, so it is NOT re-applied here (that would square the stat).
 * Only the body-size resistance is applied.
 */
function applyKnock(w: World, e: Enemy, knock: number, ox: number, oz: number): void {
  if (!finitePos(knock) || !e.alive) return;
  const k = knock * knockScale(e);
  if (!(k > 0)) return;
  let dx = e.x - ox, dz = e.z - oz;
  let d = Math.hypot(dx, dz);
  if (d < 1e-4) { dx = Math.sin(w.titan.heading); dz = Math.cos(w.titan.heading); d = 1; }
  e.kx += (dx / d) * k;
  e.kz += (dz / d) * k;
  const cap = Math.max(KNOCK_CAP_MIN, knock * 1.5);
  const m = Math.hypot(e.kx, e.kz);
  if (m > cap) { e.kx *= cap / m; e.kz *= cap / m; }
  // a short stagger so a knocked foe does not fire mid-flight
  if (k >= 2) e.stun = Math.max(e.stun, Math.min(0.45, 0.1 + 0.02 * k));
}

function emitEnemyHit(w: World, e: Enemy, dmg: number, crit: boolean): void {
  const b = bookOf(w);
  const prev = b.hits.get(e.id);
  if (prev) {
    prev.dmg += dmg;
    prev.crit = prev.crit || crit;
    prev.x = e.x; prev.z = e.z;
    return;
  }
  const ev: EnemyHitEvent = { type: 'enemyHit', id: e.id, x: e.x, z: e.z, dmg, crit };
  b.hits.set(e.id, ev);
  w.events.push(ev);
}

/** Lifesteal from titan-side damage actually dealt to enemies/boss, capped at 2 % maxHp per tick. */
function lifesteal(w: World, dealt: number): void {
  if (!(dealt > 0)) return;
  const T = w.titan;
  if (!T.alive || T.hp >= T.maxHp) return;
  const ls = stat(w, 'lifesteal');
  if (!(ls > 0)) return;
  const b = bookOf(w);
  const room = LIFESTEAL_CAP_PER_TICK * T.maxHp - b.healed;
  if (room <= 0) return;
  const amt = Math.min(room, ls * dealt);
  if (amt <= 0) return;
  b.healed += amt;
  healTitan(w, amt);
}

/** Lifesteal from the boss HP actually removed since `hpBefore` (lane-internal). */
export function lifestealFromBoss(w: World, hpBefore: number): void {
  const B = w.boss;
  if (!B || !Number.isFinite(B.hp) || !Number.isFinite(hpBefore)) return;
  lifesteal(w, Math.max(0, hpBefore - Math.max(0, B.hp)));
}

/** Resolve the crit state of an attack: pre-rolled (projectiles), suppressed (hazards) or rolled now. Lane-internal. */
export function resolveTitanCrit(w: World, dmg: number, opts: DamageOpts): { dmg: number; crit: boolean } {
  if (opts.crit !== undefined) return { dmg, crit: opts.crit };
  if (opts.noCrit || opts.src === 'hazard' || opts.kind === 'thorns') return { dmg, crit: false };
  return rollCrit(w, dmg);
}

/** Building/prop damage for a titan-side hit: × buildingMul × stats.buildingDamage × oversize rule. Lane-internal. */
export function cityDamageAmount(w: World, tier: number, dmg: number, opts: DamageOpts): number {
  const mul = opts.buildingMul === undefined ? 1 : opts.buildingMul;
  const over = tier > RANKS[w.titan.rank].canFlatten ? OVERSIZE_DAMAGE_MUL : 1;
  return dmg * mul * Math.max(0, stat(w, 'buildingDamage')) * over;
}

// ─────────────────────────────── contract exports ───────────────────────────────

/** base × RANKS[rank].dmgMul × stats.damage (stat() includes active frenzy buffs). */
export function titanDamage(w: World, base: number): number {
  return base * RANKS[w.titan.rank].dmgMul * Math.max(0, stat(w, 'damage'));
}

/** One crit roll from rng.combat (always consumes exactly one draw → deterministic stream use). */
export function rollCrit(w: World, dmg: number): { dmg: number; crit: boolean } {
  const roll = w.rng.combat();
  const chance = stat(w, 'critChance');
  if (roll < chance) return { dmg: dmg * Math.max(1, stat(w, 'critMult')), crit: true };
  return { dmg, crit: false };
}

/**
 * Area damage. Titan side (src 'titan'/'hazard'): enemies (grid + circleInShape), every boss part
 * whose circle overlaps (damageBoss per part, the shape's damage shared equally between them — see
 * BOSS_AOE_SPLIT), buildings (rectInShape) and props (circleInShape), one crit roll per call. Hostile side (src 'enemy'/'boss'): forwards to damageTitanArea.
 * Returns the number of things hit.
 */
export function damageArea(w: World, s: Shape, dmg: number, opts: DamageOpts): number {
  if (!(dmg > 0)) return 0;
  if (!isTitanSide(opts.src)) {
    // hostile area: boss-sourced damage reflects thorns to the boss; enemy contact kinds find their rammer
    if (opts.src === 'boss') return hurtTitanByShape(w, s, dmg, opts.kind, { kind: 'boss' }) ? 1 : 0;
    return damageTitanArea(w, s, dmg, opts.kind) ? 1 : 0;
  }

  const c = resolveTitanCrit(w, dmg, opts);
  const hitOpts: DamageOpts = c.crit === opts.crit ? opts : { ...opts, crit: c.crit };
  const knock = opts.knock === undefined ? 0 : opts.knock;
  let hits = 0;

  // enemies
  const list = takeEnemies();
  try {
    enemiesInShape(w, s, list);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const o = shapeOrigin(s, e.x, e.z, originScratch);
      hitEnemy(w, e, c.dmg, hitOpts, o.x, o.z, knock);
      hits++;
    }
  } finally { giveEnemies(); }

  // boss parts: ONE shape = one hit's worth of damage on the boss, shared equally by every overlapping
  // part (each share then gets that part's hpMul / strainMul / stagger inside damageBoss). Giving every
  // overlapping part the full amount made a big AoE worth up to 7× a single-target hit (measured: 6.4
  // parts per HEARTHBACK stomp at Size V → CAISSON-4 dead in ~8 s vs ~90 s for MOLO's bite).
  const B = w.boss;
  if (B && B.alive) {
    let n = 0;
    for (let i = 0; i < B.parts.length; i++) { const p = B.parts[i]; if (circleInShape(s, p.x, p.z, p.r)) n++; }
    if (n > 0) {
      const share = BOSS_AOE_SPLIT ? c.dmg / n : c.dmg;
      for (let i = 0; i < B.parts.length && B.alive; i++) {
        const p = B.parts[i];
        if (!circleInShape(s, p.x, p.z, p.r)) continue;
        const before = B.hp;
        damageBoss(w, i, share, hitOpts);
        lifestealFromBoss(w, before);
        hits++;
      }
    }
  }

  // city
  if (!opts.noCity) hits += damageCityArea(w, s, c.dmg, hitOpts);
  return hits;
}

/** Buildings + props inside the shape (titan side). */
function damageCityArea(w: World, s: Shape, dmg: number, opts: DamageOpts): number {
  const city = w.city;
  if (!city) return 0;
  const bb = shapeBounds(s);
  let hits = 0;
  const ids = takeIds();
  try {
    const bs = buildingsInRect(city, bb.minX, bb.minZ, bb.maxX, bb.maxZ, ids);
    for (let i = 0; i < bs.length; i++) {
      const b = buildingById(city, bs[i]);
      if (!b || b.collapsed || b.alive <= 0) continue;
      if (!rectInShape(s, b.x, b.z, b.w, b.d)) continue;
      const amt = cityDamageAmount(w, b.tier, dmg, opts);
      if (amt > 0) { damageBuilding(w, b.id, amt, opts); hits++; }
    }
  } finally { giveIds(); }
  const pids = takeIds();
  try {
    // props are points with a small radius — pad the rect by the largest prop radius
    const ps = propsInRect(city, bb.minX - 5.5, bb.minZ - 5.5, bb.maxX + 5.5, bb.maxZ + 5.5, pids);
    for (let i = 0; i < ps.length; i++) {
      const p = city.props[ps[i]];
      if (!p || !p.alive) continue;
      if (!circleInShape(s, p.x, p.z, propRadius(p))) continue;
      const amt = cityDamageAmount(w, p.tier, dmg, opts);
      if (amt > 0) { damageProp(w, p.id, amt, opts); hits++; }
    }
  } finally { giveIds(); }
  return hits;
}

/** Shared single-enemy hit: damage, flash, aggregated enemyHit, lifesteal, kill, then knockback. */
function hitEnemy(w: World, e: Enemy, dmg: number, opts: DamageOpts, ox: number, oz: number, knock: number): boolean {
  if (!e.alive || !(dmg > 0)) return false;
  const before = e.hp;
  e.hp -= dmg;
  e.flash = HIT_FLASH_S;
  const dealt = Math.max(0, Math.min(before, dmg));
  emitEnemyHit(w, e, dmg, opts.crit === true);
  if (isTitanSide(opts.src)) lifesteal(w, dealt);
  if (e.hp <= 0) { killEnemy(w, e, false); return true; }
  if (knock > 0) applyKnock(w, e, knock, ox, oz);
  return false;
}

/**
 * Titan-side damage to one enemy (dmg is final: titanDamage + crit already applied by the caller;
 * opts.crit only tags the event). opts.knock pushes away from the titan. Returns killed.
 */
export function damageEnemy(w: World, e: Enemy, dmg: number, opts: DamageOpts): boolean {
  return hitEnemy(w, e, dmg, opts, w.titan.x, w.titan.z, opts.knock === undefined ? 0 : opts.knock);
}

/** Titan-side single-enemy hit with knockback away from a given origin (lane-internal). */
export function damageEnemyFrom(w: World, e: Enemy, dmg: number, opts: DamageOpts, ox: number, oz: number): boolean {
  return hitEnemy(w, e, dmg, opts, ox, oz, opts.knock === undefined ? 0 : opts.knock);
}

/**
 * Kill an enemy: drops ENEMIES[kind].xp/mass split into 1–4 scrap pickups, an occasional heal
 * pickup, a chest for elites; titan.kills (+ crushed) counters; `enemyKilled` event.
 */
export function killEnemy(w: World, e: Enemy, crushed: boolean): void {
  if (!e.alive) return;
  e.alive = false;
  if (e.hp > 0) e.hp = 0;
  e.kx = 0; e.kz = 0;
  const def = ENEMIES[e.kind];
  const xp = def ? def.xp : 1;
  const mass = (def ? def.mass : 1) * (KILL_MASS_RANK_MUL[w.titan.rank] ?? 1);
  const n = mass >= 40 ? 4 : mass >= 8 ? 3 : mass >= 3 ? 2 : 1;
  for (let i = 0; i < n; i++) spawnPickup(w, 'scrap', e.x, e.z, xp / n, mass / n);
  const elite = e.elite || e.kind === 'elite';
  if (elite) {
    spawnPickup(w, 'chest', e.x, e.z, 0, 0);
  } else {
    const heavy = def ? def.cost >= 5 : false;
    if (w.rng.loot() < (heavy ? HEAL_DROP_CHANCE_HEAVY : HEAL_DROP_CHANCE)) spawnPickup(w, 'heal', e.x, e.z, 0, 0);
  }
  const T = w.titan;
  T.kills++;
  if (crushed) T.crushed++;
  w.events.push({ type: 'enemyKilled', id: e.id, kind: e.kind, x: e.x, z: e.z, crushed });
}

// ─────────────────────────────── hostile side ───────────────────────────────

/** Who reflected thorns go to: an enemy (by id), the boss, or nobody. */
export type Attacker = { kind: 'enemy'; id: number } | { kind: 'boss' } | null;

/** Contact kinds with an obvious attacker even when the caller gives none. */
function contactAttacker(w: World, kind: DamageKind, x: number, z: number): Attacker {
  if (kind !== 'ram' && kind !== 'dive') return null;
  const want = kind === 'ram' ? 'elite' : 'drone';
  const T = w.titan;
  const e = nearestEnemy(w, x, z, T.radius + 8, (c) => c.kind === want);
  return e ? { kind: 'enemy', id: e.id } : null;
}

/**
 * Reflect stats.thorns × dmg to the attacker (lane-internal; projectiles/telegraphs pass the
 * attacker they recorded at spawn). No-op without thorns or when the attacker is gone.
 */
export function reflectThorns(w: World, attacker: Attacker, dmg: number): void {
  if (!attacker || !(dmg > 0)) return;
  const th = stat(w, 'thorns');
  if (!(th > 0)) return;
  const amt = th * dmg;
  const opts: DamageOpts = { src: 'titan', kind: 'thorns', noCrit: true, noCity: true };
  if (attacker.kind === 'enemy') {
    const es = w.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.id === attacker.id) { if (e.alive) damageEnemy(w, e, amt, opts); return; }
    }
    return;
  }
  const B = w.boss;
  if (!B || !B.alive || B.parts.length === 0) return;
  // the part closest to the titan takes it
  const T = w.titan;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < B.parts.length; i++) {
    const p = B.parts[i];
    const d = Math.hypot(p.x - T.x, p.z - T.z) - p.r;
    if (d < bestD) { bestD = d; best = i; }
  }
  damageBoss(w, best, amt, opts);
}

/**
 * Hostile shape vs the titan circle → hurtTitan (armor/iframes/kit/shield handled there),
 * thorns to the attacker when the hit lands outside i-frames. Returns true if the shape overlapped
 * the titan. Lane-internal form of damageTitanArea with an explicit attacker.
 */
export function hurtTitanByShape(w: World, s: Shape, dmg: number, kind: DamageKind, attacker: Attacker, dot = false): boolean {
  const T = w.titan;
  if (!T.alive || !(dmg > 0)) return false;
  if (!circleInShape(s, T.x, T.z, T.radius)) return false;
  // source point for the hurt event: the shape's anchor (lane/cone = the shooter end), capsule = closest point
  let sx: number, sz: number;
  if (s.k === 'capsule') { const o = shapeOrigin(s, T.x, T.z, originScratch); sx = o.x; sz = o.z; }
  else { sx = s.x; sz = s.z; }
  // DoT ticks (hazards, active telegraphs) bypass the post-hit i-frames — see hurtTitan
  const landed = dot ? hurtTitan(w, dmg, kind, sx, sz, true) > 0 : T.iframeT <= 0;
  if (!dot) hurtTitan(w, dmg, kind, sx, sz);
  if (landed && T.alive) reflectThorns(w, attacker, dmg);
  return true;
}

/** Hostile → titan (true if the shape overlapped the titan). Contact kinds ('ram','dive') reflect thorns. */
export function damageTitanArea(w: World, s: Shape, dmg: number, kind: DamageKind): boolean {
  const T = w.titan;
  if (!T.alive || !(dmg > 0)) return false;
  const attacker = kind === 'ram' || kind === 'dive' ? contactAttacker(w, kind, T.x, T.z) : null;
  return hurtTitanByShape(w, s, dmg, kind, attacker);
}
