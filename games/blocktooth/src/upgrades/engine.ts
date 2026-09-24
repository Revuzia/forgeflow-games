// BLOCKTOOTH — upgrade engine (CONTRACT §5.3, §5.5, §11). Lane: upgrades.
// THREE-FREE, DOM-free, deterministic (randomness: world.rng.combat only).
//
// Exports (contract): applyUpgrade, stepUpgrades, processTriggers.
//
// Trigger model
//   * processTriggers reads THIS tick's w.events and maps them to TriggerOn:
//       propDestroyed → smash · floorBreak → floorBreak + smash · smash → smash
//       buildingCollapse → collapse · enemyKilled → kill (+ crush when crushed)
//       enemyHit → hit (+ crit when crit) · bossHit → hit · dash → dash · ability → ability
//       titanHurt → hurt · pickup → pickup · rankUp → rankUp · levelUp → levelUp
//     De-dupe: citysim emits a `smash` juice beat NEXT TO the floorBreak/propDestroyed it
//     describes (and titansim emits an aggregated one per contact tick), so within one batch of
//     events a `smash` event only counts as a smash when no floorBreak/propDestroyed is present
//     (a pure "chewing" beat). One destroyed thing = one smash trigger opportunity.
//     'interval' triggers run from stepUpgrades on p.every seconds.
//   * chance × (1 + 0.1·luck), capped at 1; rolled on rng.combat only when < 1.
//   * per-trigger internal cooldown in upgrades.icd (key = upgrade id, or `${id}#${n}` for the
//     n-th trigger of a multi-trigger card). The icd starts only when the trigger actually procs.
//   * Every proc pushes { type: 'upgradeProc', id, x, z }.
//   * Re-trigger guard (a proc can feed OTHER upgrades but never itself):
//       - same tick: events produced BY a proc are processed immediately with that upgrade (and its
//         ancestors) excluded, to a max depth of 2;
//       - later ticks: trigger damage carries DamageOpts.fromUpgrade, but SimEvents do not carry it,
//         so an action whose damage LINGERS (rubbleShot/meteor projectiles in flight, magma / damaging
//         frost pools) holds that trigger's icd for at least the linger time (flight time / pool
//         life). Its own hits therefore land while it is still on cooldown.
//   * Stack scaling: p.dmg / p.amount / p.dps / p.mul × stacks (see data/upgrades.ts).
//
// sparkChance (no other owner) is realised here: every smash-mapped event rolls it (luck-scaled)
// for a free 6-dmg spark with 2 + chains jumps (0.1 s internal cooldown).
// NOT here (other lanes own them): thorns = combat/damage.ts reflectThorns (stats.thorns × damage
// taken, back at the attacker); rubbleHeal = combat/pickups.ts (× rank hp× per rubble pickup).
//
// Hazards spawned by upgrades (documented data keys — generic hazard fields only):
//   * magma / frost: owner 'titan', circle shape, `dps`, `life`; data = { upg: 1 }.
//     At most UPG_HAZARD_CAP upgrade-spawned pools of each kind (oldest removed).
//   * bloom: owner 'titan', kind 'bloom', circle shape (r = 0.3·H at the event point),
//     life = p.dur (default 20 s), dps 0, data = { cd: 0.4, spore: 4, h: H, upg: 1 } — the SAME
//     keys the BRIARWICK kit writes (cd = s to next seed, spore = s to next spore pulse, h = titan
//     height at spawn) plus upg = 1. Cap = turretCap stat across ALL titan blooms (oldest removed).
//     Emits { type: 'bloomSpawn', id, x, z }.
//     BRIARWICK's kit drives every titan-owned bloom (titanHazards). For the other three titans the
//     kit never runs, so stepUpgrades drives upgrade blooms (upg = 1) itself with the kit's §8 numbers
//     (seed at the nearest enemy within 3.5·H every 1.2 s ÷ turretRate, 8 dmg, crit-rolled; every 4 s
//     spores heal 1 % maxHp × sporeHeal when the titan is within 2·H).

import type {
  Enemy, Hazard, HazardKind, Shape, SimEvent, StatKey, Tier, TriggerOn, UpgradeDef, UpgradeEffect, World,
} from '../core/types.ts';
import { RANKS, lootMass, lootXp } from '../core/config.ts';
import { dist2 } from '../core/math.ts';
import { UPGRADE_BY_ID, STACK_SCALED_KEYS } from '../data/upgrades.ts';
import { recomputeStats, stat, STAT_KEYS } from './stats.ts';
import { titanDamage, damageArea, rollCrit } from '../combat/damage.ts';
import { enemiesInCircle, nearestEnemies, nearestEnemy } from '../combat/spatial.ts';
import { findTarget, targetPos, hitTarget } from '../combat/targeting.ts';
import { spawnProjectile } from '../combat/projectiles.ts';
import { spawnHazard } from '../combat/hazards.ts';
import { magnetAll } from '../combat/pickups.ts';
import { healTitan, gainMass, gainXp } from '../titans/titansim.ts';

// ─────────────────────────────── tuning ───────────────────────────────
/** Max recursion depth for proc → events → other procs within one tick. */
const MAX_DEPTH = 2;
/** Shield pool from upgrades is capped at this fraction of maxHp (never cuts an existing larger pool). */
const SHIELD_CAP_FRAC = 0.5;
/** Shield pool decays by this fraction of itself per second ("temporary absorb"). */
const SHIELD_DECAY_PER_S = 0.03;
/** Max concurrent frenzy buffs (oldest dropped). */
const MAX_BUFFS = 12;
/** Max upgrade-spawned magma pools / frost fields alive at once. */
const UPG_HAZARD_CAP = 8;
const SPARK_ICD = 0.1;
const FREE_SPARK_DMG = 6;
const FREE_SPARK_JUMPS = 2;
const K_SPARK = '~spark';

// ─────────────────────────────── helpers ───────────────────────────────
function num(p: Record<string, number | string>, k: string, d = 0): number {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function isStatKey(s: unknown): s is StatKey {
  return typeof s === 'string' && (STAT_KEYS as readonly string[]).includes(s);
}
function trigKey(id: string, n: number): string { return n === 0 ? id : `${id}#${n}`; }

/** Knockback impulse (m/s) matching the kits' curve: k × (2 + √H) × knockback stat. */
function knockImpulse(w: World, k: number): number {
  return k * (2 + Math.sqrt(Math.max(0.1, w.titan.height))) * Math.max(0, stat(w, 'knockback'));
}

function circle(x: number, z: number, r: number): Shape { return { k: 'circle', x, z, r }; }

function emitProc(w: World, id: string, x: number, z: number): void {
  w.events.push({ type: 'upgradeProc', id, x, z });
}

/** First owned upgrade that touches a stat (for fromUpgrade / proc attribution). */
function sourceOf(w: World, key: StatKey): string {
  for (const id of w.upgrades.order) {
    const u = UPGRADE_BY_ID[id];
    if (!u) continue;
    for (const e of u.effects) if (e.stat === key && ((e.add ?? 0) > 0 || (e.mul ?? 0) > 0)) return id;
  }
  return key;
}

function luckMul(w: World): number { return Math.max(0, 1 + 0.1 * stat(w, 'luck')); }

// ─────────────────────────────── per-world trigger index ───────────────────────────────
interface Entry { id: string; key: string; eff: UpgradeEffect; stacks: number; }
interface TrigIndex { sig: number; by: Record<TriggerOn, Entry[]>; }
const INDEX = new WeakMap<object, TrigIndex>();

function emptyBy(): Record<TriggerOn, Entry[]> {
  return {
    smash: [], floorBreak: [], collapse: [], kill: [], crush: [], hit: [], crit: [], dash: [], ability: [],
    hurt: [], pickup: [], rankUp: [], levelUp: [], interval: [],
  };
}

const ID_HASH = new Map<string, number>();
function idHash(id: string): number {
  let h = ID_HASH.get(id);
  if (h === undefined) {
    h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h = (h >>> 0) || 1;
    ID_HASH.set(id, h);
  }
  return h;
}

/** Cheap ownership fingerprint: changes whenever any card is added or gains a stack. */
function signature(w: World): number {
  const U = w.upgrades;
  let s = U.order.length | 0;
  let t = 0;
  for (const id in U.owned) {
    const n = U.owned[id] | 0;
    s = (s + Math.imul(idHash(id), n + 1)) | 0;
    t = (t + n) | 0;
  }
  return (Math.imul(s, 31) ^ t) | 0;
}

function triggerIndex(w: World): TrigIndex {
  const U = w.upgrades;
  let ix = INDEX.get(U);
  const sig = signature(w);
  if (ix && ix.sig === sig) return ix;
  const by = ix ? ix.by : emptyBy();
  for (const k in by) by[k as TriggerOn].length = 0;
  for (const id in U.owned) {
    const u = UPGRADE_BY_ID[id];
    const n = Math.min(U.owned[id], u ? u.maxStacks : 0);
    if (!u || n <= 0) continue;
    let t = 0;
    for (const eff of u.effects) {
      if (!eff.trigger) continue;
      by[eff.trigger.on].push({ id, key: trigKey(id, t), eff, stacks: n });
      t++;
    }
  }
  ix = { sig, by };
  INDEX.set(U, ix);
  return ix;
}

// ─────────────────────────────── applyUpgrade ───────────────────────────────
/**
 * Add one stack of an upgrade: ownership + pick order, stat recompute (HP ratio kept), and the
 * immediate one-shots: a card that raises the dash-charge cap refills EVERY dash charge, newly
 * granted rerolls are usable in the current draft, and interval triggers start their clock.
 * Unknown ids, maxed cards and other titans' cards are ignored.
 */
export function applyUpgrade(w: World, id: string): void {
  const u: UpgradeDef | undefined = UPGRADE_BY_ID[id];
  if (!u) return;
  if (u.titan && u.titan !== w.titanId) return;
  const U = w.upgrades;
  const n0 = U.owned[id] ?? 0;
  if (n0 >= u.maxStacks) return;
  const T = w.titan;
  const prevCharges = T.stats ? T.stats.dashCharges : 1;
  const prevRerolls = T.stats ? T.stats.rerolls : 1;

  U.owned[id] = n0 + 1;
  if (n0 === 0) U.order.push(id);
  recomputeStats(w);

  const s = T.stats;
  if (s.dashCharges > prevCharges) {
    T.dashCharges = Math.max(T.dashCharges, Math.floor(s.dashCharges));
    T.dashRecharge = 0;
  }
  const dr = s.rerolls - prevRerolls;
  if (dr !== 0) U.rerolls = Math.max(0, U.rerolls + dr);

  if (n0 === 0) {
    let t = 0;
    for (const eff of u.effects) {
      if (!eff.trigger) continue;
      if (eff.trigger.on === 'interval') U.icd[trigKey(id, t)] = Math.max(0.1, num(eff.trigger.p, 'every', 10));
      t++;
    }
  }
}

// ─────────────────────────────── stepUpgrades ───────────────────────────────
const SCR_HAZ: Hazard[] = [];

/** Tick icd timers, frenzy buffs, shield decay, 'interval' triggers and non-BRIARWICK bloom turrets. */
export function stepUpgrades(w: World): void {
  const U = w.upgrades;
  const dt = w.dt;

  for (const k in U.icd) {
    const v = U.icd[k];
    if (v > 0) U.icd[k] = v - dt > 0 ? v - dt : 0;
  }

  // frenzy buffs (in-place compaction, no allocation)
  const B = U.buffs;
  let j = 0;
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    b.t -= dt;
    if (b.t > 0) B[j++] = b;
  }
  B.length = j;

  // temporary absorb pool
  if (U.shield > 0) {
    U.shield -= U.shield * SHIELD_DECAY_PER_S * dt;
    if (U.shield < 0.01) U.shield = 0;
  }

  if (!w.titan.alive) return;

  // interval triggers
  const ix = triggerIndex(w);
  const iv = ix.by.interval;
  for (let i = 0; i < iv.length; i++) {
    const en = iv[i];
    const g = en.eff.trigger!;
    if ((U.icd[en.key] ?? 0) > 0) continue;
    U.icd[en.key] = Math.max(num(g.p, 'every', 10), g.icd, 0.1);
    const c = Math.min(1, g.chance * luckMul(w));
    if (c < 1 && w.rng.combat() >= c) continue;
    const start = w.events.length;
    LINGER = 0;
    if (execute(w, en, w.titan.x, w.titan.z)) {
      if (LINGER > U.icd[en.key]) U.icd[en.key] = LINGER;
      emitProc(w, en.id, w.titan.x, w.titan.z);
      // interval procs' own events flow through processTriggers this tick with this id excluded
      pendingOf(w).push(start, w.events.length, en.id);
    }
  }

  if (w.titanId !== 'briarwick') driveUpgradeBlooms(w);
}

/** Per world: [start, end, id] triples recorded by stepUpgrades so processTriggers can exclude the source. */
const PENDING = new WeakMap<object, (number | string)[]>();
function pendingOf(w: World): (number | string)[] {
  let a = PENDING.get(w.upgrades);
  if (!a) { a = []; PENDING.set(w.upgrades, a); }
  return a;
}

const SCR_BLOOM: Hazard[] = [];
function driveUpgradeBlooms(w: World): void {
  const T = w.titan;
  const H = T.height;
  SCR_BLOOM.length = 0;
  for (const h of w.hazards) if (h.alive && h.owner === 'titan' && h.kind === 'bloom' && h.data.upg === 1) SCR_BLOOM.push(h);
  if (SCR_BLOOM.length === 0) return;
  const rate = Math.max(0.2, stat(w, 'turretRate'));
  const heal = stat(w, 'sporeHeal');
  for (const h of SCR_BLOOM) {
    const hx = h.shape.k === 'circle' ? h.shape.x : T.x;
    const hz = h.shape.k === 'circle' ? h.shape.z : T.z;
    const range = 3.5 * H;
    let fire = (h.data.cd ?? 0.4) - w.dt;
    if (fire <= 0) {
      const e = nearestEnemy(w, hx, hz, range, liveEnemy);
      if (e) {
        const dx = e.x - hx, dz = e.z - hz;
        const d = Math.max(0.01, Math.hypot(dx, dz));
        const speed = Math.max(10, 7 * H);
        const c = rollCrit(w, titanDamage(w, 8));
        spawnProjectile(w, {
          owner: 'titan', kind: 'seed', x: hx, z: hz, y: Math.max(0.3, 0.35 * H),
          vx: (dx / d) * speed, vz: (dz / d) * speed, dmg: c.dmg, crit: c.crit,
          r: Math.max(0.3, 0.12 * H), life: ((range + e.radius) / speed) * 1.4, pierce: 0,
        });
        fire = 1.2 / rate;
      } else {
        fire = 0.25;   // nothing in reach — look again soon
      }
    }
    h.data.cd = fire;
    let spore = (h.data.spore ?? 4) - w.dt;
    if (spore <= 0) {
      spore += 4;
      w.events.push({ type: 'spore', x: hx, z: hz, r: 2 * H });
      if (heal > 0 && dist2(T.x, T.z, hx, hz) <= (2 * H + T.radius) * (2 * H + T.radius)) {
        healTitan(w, 0.01 * T.maxHp * heal);
      }
    }
    h.data.spore = spore;
  }
}

function liveEnemy(e: Enemy): boolean { return e.alive && e.hp > 0; }

// ─────────────────────────────── processTriggers ───────────────────────────────
/** Fire upgrade triggers from this tick's events (runs after stepUpgrades in stepWorld). */
export function processTriggers(w: World): void {
  const T = w.titan;
  const ev = w.events;
  const n0 = ev.length;
  const pend = pendingOf(w);
  if (!T.alive) { pend.length = 0; return; }

  // rank changed this tick → make sure stats follow (idempotent if titansim already recomputed)
  for (let i = 0; i < n0; i++) if (ev[i].type === 'rankUp') { recomputeStats(w); break; }

  const ix = triggerIndex(w);

  // events that interval procs produced in stepUpgrades: process them with their source excluded
  const excl = pend.length ? pend.slice() : pend;
  if (pend.length) pend.length = 0;
  let a = 0;
  for (let i = 0; i < excl.length; i += 3) {
    const s = excl[i] as number, e = excl[i + 1] as number, id = excl[i + 2] as string;
    if (s > a) runRange(w, ix, a, s, null, 0);
    runRange(w, ix, s, e, [id], 1);
    a = Math.max(a, e);
  }
  if (a < n0) runRange(w, ix, a, n0, null, 0);
}

function runRange(w: World, ix: TrigIndex, a: number, b: number, exclude: string[] | null, depth: number): void {
  const ev = w.events;
  // smash de-dupe: a `smash` beat only counts when nothing in this batch was actually destroyed
  let destroyed = false;
  for (let i = a; i < b; i++) {
    const t = ev[i].type;
    if (t === 'floorBreak' || t === 'propDestroyed') { destroyed = true; break; }
  }
  for (let i = a; i < b; i++) {
    const e = ev[i];
    switch (e.type) {
      case 'propDestroyed': EV_TIER = 0; fire(w, ix, 'smash', e.x, e.z, exclude, depth); onSmash(w, e.x, e.z, exclude, depth); break;
      case 'floorBreak':
        EV_TIER = e.tier;
        fire(w, ix, 'floorBreak', e.x, e.z, exclude, depth);
        EV_TIER = e.tier;
        fire(w, ix, 'smash', e.x, e.z, exclude, depth);
        onSmash(w, e.x, e.z, exclude, depth);
        break;
      case 'smash':
        if (destroyed) break;
        EV_TIER = e.tier;
        fire(w, ix, 'smash', e.x, e.z, exclude, depth); onSmash(w, e.x, e.z, exclude, depth);
        break;
      case 'buildingCollapse': EV_TIER = e.tier; fire(w, ix, 'collapse', e.x, e.z, exclude, depth); break;
      case 'enemyKilled':
        fire(w, ix, 'kill', e.x, e.z, exclude, depth);
        if (e.crushed) fire(w, ix, 'crush', e.x, e.z, exclude, depth);
        break;
      case 'enemyHit':
        fire(w, ix, 'hit', e.x, e.z, exclude, depth);
        if (e.crit) fire(w, ix, 'crit', e.x, e.z, exclude, depth);
        break;
      case 'bossHit': fire(w, ix, 'hit', e.x, e.z, exclude, depth); break;
      case 'dash': fire(w, ix, 'dash', e.x1, e.z1, exclude, depth); break;
      case 'ability': fire(w, ix, 'ability', e.x, e.z, exclude, depth); break;
      case 'titanHurt': fire(w, ix, 'hurt', w.titan.x, w.titan.z, exclude, depth); break;
      case 'pickup': fire(w, ix, 'pickup', e.x, e.z, exclude, depth); break;
      case 'rankUp': fire(w, ix, 'rankUp', w.titan.x, w.titan.z, exclude, depth); break;
      case 'levelUp': fire(w, ix, 'levelUp', w.titan.x, w.titan.z, exclude, depth); break;
      default: break;
    }
    if (!w.titan.alive) return;
  }
}

function fire(w: World, ix: TrigIndex, when: TriggerOn, x: number, z: number, exclude: string[] | null, depth: number): void {
  const tier = EV_TIER;
  EV_TIER = -1;
  const list = ix.by[when];
  if (list.length === 0) return;
  const U = w.upgrades;
  for (let i = 0; i < list.length; i++) {
    const en = list[i];
    if (exclude && exclude.includes(en.id)) continue;
    if ((U.icd[en.key] ?? 0) > 0) continue;
    const g = en.eff.trigger!;
    const c = Math.min(1, g.chance * luckMul(w));
    if (c <= 0) continue;
    if (c < 1 && w.rng.combat() >= c) continue;
    const start = w.events.length;
    LINGER = 0;
    const ok = execute(w, en, x, z, tier);
    if (!ok) continue;
    const hold = Math.max(g.icd, LINGER);
    if (hold > 0) U.icd[en.key] = hold;
    emitProc(w, en.id, x, z);
    const end = w.events.length;
    if (depth < MAX_DEPTH && end > start) {
      const ex2 = exclude ? exclude.concat(en.id) : [en.id];
      runRange(w, ix, start, end, ex2, depth + 1);
    }
  }
}

/** sparkChance stat: every smash-mapped event may throw a free spark. */
function onSmash(w: World, x: number, z: number, exclude: string[] | null, depth: number): void {
  const U = w.upgrades;
  const sc = stat(w, 'sparkChance');
  if (sc <= 0 || (U.icd[K_SPARK] ?? 0) > 0) return;
  const c = Math.min(1, sc * luckMul(w));
  if (c < 1 && w.rng.combat() >= c) return;
  const src = sourceOf(w, 'sparkChance');
  const start = w.events.length;
  const jumps = FREE_SPARK_JUMPS + Math.floor(stat(w, 'chains'));
  if (!doSpark(w, x, z, FREE_SPARK_DMG, jumps, src)) return;
  U.icd[K_SPARK] = SPARK_ICD;
  emitProc(w, src, x, z);
  const end = w.events.length;
  if (depth < MAX_DEPTH && end > start) runRange(w, triggerIndex(w), start, end, exclude ? exclude.concat(src) : [src], depth + 1);
}

// ─────────────────────────────── actions ───────────────────────────────
/** Set by execute(): seconds the proc's damage keeps landing after this tick (projectile flight,
 *  pool life). fire()/interval hold the trigger's icd at least this long (self-retrigger guard). */
let LINGER = 0;
/** Tier of the building/prop event being dispatched (−1 = the event has no tier). Set by runRange
 *  right before fire(), consumed (and reset) by fire(). */
let EV_TIER = -1;

/** Tier whose floor value prices a 'mass' / 'xp' proc: the triggering building's own tier when the
 *  event has one (never above what the titan can flatten), else the biggest tier it can flatten. */
function valueTier(w: World, evTier: number): number {
  const cf = RANKS[w.titan.rank]?.canFlatten ?? 0;
  return evTier >= 0 ? Math.min(evTier, cf) : cf;
}
const SCR_E: Enemy[] = [];
const SCR_E2: Enemy[] = [];

/** Perform a trigger's action at (x,z). Returns true if something actually happened. */
function execute(w: World, en: Entry, x: number, z: number, evTier = -1): boolean {
  const g = en.eff.trigger!;
  const p = g.p;
  const n = en.stacks;
  const sc = (k: string, d = 0) => num(p, k, d) * (STACK_SCALED_KEYS.includes(k) ? n : 1);
  const T = w.titan;
  const H = Math.max(0.1, T.height);
  const area = stat(w, 'area');
  switch (g.action) {
    case 'spark':
      return doSpark(w, x, z, sc('dmg', 5), Math.max(0, Math.floor(num(p, 'chains', 1) + stat(w, 'chains'))), en.id);

    case 'shockwave': {
      const r = Math.max(0.5, num(p, 'r', 1) * H * area);
      damageArea(w, circle(x, z, r), titanDamage(w, sc('dmg', 8)), {
        src: 'titan', kind: 'shockwave', knock: knockImpulse(w, 1), fromUpgrade: en.id,
      });
      w.events.push({ type: 'explosion', x, z, r, kind: 'shockwave' });
      return true;
    }

    case 'heal': {
      if (T.hp >= T.maxHp) return false;
      const amt = num(p, 'frac') ? sc('amount') * T.maxHp : sc('amount') * (RANKS[T.rank]?.hpMul ?? 1);
      if (amt <= 0) return false;
      healTitan(w, amt);
      return true;
    }

    case 'shield': {
      const U = w.upgrades;
      const cap = SHIELD_CAP_FRAC * T.maxHp;
      const add = sc('amount') * T.maxHp;
      if (add <= 0 || U.shield >= cap) return false;
      U.shield = Math.max(U.shield, Math.min(U.shield + add, cap));
      return true;
    }

    case 'mass': {
      const m = sc('amount') * lootMass(valueTier(w, evTier) as Tier, w.titan.rank);
      if (m <= 0) return false;
      gainMass(w, m);
      return true;
    }

    case 'xp': {
      const xp = sc('amount') * lootXp(valueTier(w, evTier) as Tier, w.titan.rank);
      if (xp <= 0) return false;
      gainXp(w, xp);
      return true;
    }

    case 'magnet':
      return magnetAll(w, Math.max(1, num(p, 'r', 6) * H)) > 0;

    case 'rubbleShot':
      return doRubbleShot(w, Math.max(1, Math.floor(num(p, 'count', 1) + stat(w, 'projectiles'))), sc('dmg', 6), en.id);

    case 'frenzy': {
      const k = p.stat;
      if (!isStatKey(k)) return false;
      const m = sc('mul', 0.2);
      const dur = Math.max(0.1, num(p, 'dur', 3));
      addBuff(w, k, m, dur);
      return true;
    }

    case 'cdReduce': {
      if (T.abilityCd <= 0) return false;
      T.abilityCd = Math.max(0, T.abilityCd - sc('amount', 1));
      return true;
    }

    case 'dashRefund': {
      const cap = Math.floor(stat(w, 'dashCharges'));
      if (T.dashCharges >= cap) return false;
      T.dashCharges = Math.min(cap, T.dashCharges + 1);
      return true;
    }

    case 'meteor':
      return doMeteor(w, x, z, num(p, 'r', 4) * H, sc('dmg', 16), Math.max(0.2, num(p, 'aoe', 0.5)) * H * area, en.id);

    case 'arc':
      return doArc(w, Math.max(1, Math.floor(num(p, 'count', 1))), sc('dmg', 8), num(p, 'r', 3.5), en.id);

    case 'magma': {
      const r = Math.max(0.5, num(p, 'r', 1) * H * area);
      capUpgradeHazards(w, 'magma', UPG_HAZARD_CAP);
      const life = Math.max(0.5, num(p, 'dur', 4));
      spawnHazard(w, {
        owner: 'titan', kind: 'magma', shape: circle(x, z, r),
        life, dps: titanDamage(w, sc('dps', 6)), data: { upg: 1 },
      });
      LINGER = life;
      return true;
    }

    case 'bloom':
      return doBloom(w, x, z, Math.max(1, num(p, 'dur', 20)));

    case 'slowField': {
      const r = Math.max(0.5, num(p, 'r', 2) * H * area);
      capUpgradeHazards(w, 'frost', UPG_HAZARD_CAP);
      const dps = sc('dps');
      const life = Math.max(0.5, num(p, 'dur', 3));
      spawnHazard(w, {
        owner: 'titan', kind: 'frost', shape: circle(x, z, r),
        life, dps: dps > 0 ? titanDamage(w, dps) : 0, data: { upg: 1 },
      });
      if (dps > 0) LINGER = life;
      return true;
    }
  }
  return false;
}

function addBuff(w: World, k: StatKey, m: number, dur: number): void {
  const B = w.upgrades.buffs;
  for (const b of B) {
    if (b.stat === k && Math.abs(b.mul - m) < 1e-9) { if (b.t < dur) b.t = dur; return; }
  }
  if (B.length >= MAX_BUFFS) B.shift();
  B.push({ stat: k, mul: m, t: dur });
}

/** Chain spark from (x,z): greedy nearest-next through enemies; falls back to the nearest
 *  boss part / building / prop when no enemy is in reach. Emits one 'arc' (kind 'upgrade'). */
function doSpark(w: World, x: number, z: number, dmgBase: number, jumps: number, id: string): boolean {
  const T = w.titan;
  const H = Math.max(0.1, T.height);
  const cr = stat(w, 'chainRange');
  const r0 = Math.max(5, 2.4 * H) * cr;
  const hop = Math.max(4, 1.6 * H) * cr;
  enemiesInCircle(w, x, z, r0 + hop * jumps, SCR_E);
  let dmg = titanDamage(w, dmgBase);
  const pts: number[] = [x, z];
  let cx = x, cz = z, range = r0, hits = 0;
  for (let j = 0; j <= jumps; j++) {
    let best = -1, bd = range * range;
    for (let i = 0; i < SCR_E.length; i++) {
      const e = SCR_E[i];
      if (!liveEnemy(e)) continue;
      const d = dist2(cx, cz, e.x, e.z);
      if (d <= bd) { bd = d; best = i; }
    }
    if (best < 0) break;
    const e = SCR_E[best];
    SCR_E[best] = SCR_E[SCR_E.length - 1]; SCR_E.length--;
    damageArea(w, circle(e.x, e.z, 0.05), dmg, { src: 'titan', kind: 'spark', noCity: true, fromUpgrade: id });
    pts.push(e.x, e.z);
    cx = e.x; cz = e.z; range = hop; dmg *= 0.85; hits++;
  }
  if (hits === 0) {
    const t = findTarget(w, x, z, r0, true);
    if (!t) return false;
    const tp = targetPos(w, t);
    hitTarget(w, t, dmg, { src: 'titan', kind: 'spark', fromUpgrade: id });
    pts.push(tp.x, tp.z);
    hits = 1;
  }
  w.events.push({ type: 'arc', pts, kind: 'upgrade' });
  return true;
}

/** Arc from the titan to the `count` nearest enemies (boss part / city fallback). */
function doArc(w: World, count: number, dmgBase: number, rH: number, id: string): boolean {
  const T = w.titan;
  const H = Math.max(0.1, T.height);
  const R = Math.max(6, rH * H) * stat(w, 'attackRange');
  nearestEnemies(w, T.x, T.z, R, count, SCR_E2);
  const dmg = titanDamage(w, dmgBase);
  const y0x = T.x, y0z = T.z;
  let hits = 0;
  for (let i = 0; i < SCR_E2.length; i++) {
    const e = SCR_E2[i];
    if (!liveEnemy(e)) continue;
    const ex = e.x, ez = e.z;
    damageArea(w, circle(ex, ez, 0.05), dmg, { src: 'titan', kind: 'spark', noCity: true, fromUpgrade: id });
    w.events.push({ type: 'arc', pts: [y0x, y0z, ex, ez], kind: 'upgrade' });
    hits++;
  }
  if (hits === 0) {
    const t = findTarget(w, T.x, T.z, R, true);
    if (!t) return false;
    const tp = targetPos(w, t);
    hitTarget(w, t, dmg, { src: 'titan', kind: 'spark', fromUpgrade: id });
    w.events.push({ type: 'arc', pts: [y0x, y0z, tp.x, tp.z], kind: 'upgrade' });
  }
  return true;
}

/** Direct rubble chunks from the titan at the nearest enemies (cycling when fewer targets than
 *  chunks); with no enemy in reach, a lobbed chunk at the nearest boss part / building / prop. */
function doRubbleShot(w: World, count: number, dmgBase: number, id: string): boolean {
  const T = w.titan;
  const H = Math.max(0.1, T.height);
  const R = Math.max(8, 7 * H) * stat(w, 'attackRange');
  nearestEnemies(w, T.x, T.z, R, count, SCR_E2);
  const dmg = titanDamage(w, dmgBase);
  const speed = Math.max(18, 3.2 * H);
  const pr = 0.3 + 0.12 * H;
  const y = 0.6 * H;
  let live = 0;
  for (let i = 0; i < SCR_E2.length; i++) if (liveEnemy(SCR_E2[i])) SCR_E2[live++] = SCR_E2[i];
  SCR_E2.length = live;
  if (live > 0) {
    for (let c = 0; c < count; c++) {
      const e = SCR_E2[c % live];
      const dx = e.x - T.x, dz = e.z - T.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      // small fan when several chunks share one target
      const fan = live < count ? ((c / Math.max(1, count - 1)) - 0.5) * 0.18 : 0;
      const ang = Math.atan2(dx, dz) + fan;
      const life = d / speed + 0.35;
      spawnProjectile(w, {
        owner: 'titan', kind: 'rubbleShot', x: T.x, z: T.z, y,
        vx: Math.sin(ang) * speed, vz: Math.cos(ang) * speed, dmg, r: pr, life, pierce: 0,
        fromUpgrade: id,
      });
      if (life + w.dt > LINGER) LINGER = life + w.dt;
    }
    return true;
  }
  const t = findTarget(w, T.x, T.z, R, true);
  if (!t) return false;
  const tp = targetPos(w, t);
  const life = 0.55;
  spawnProjectile(w, {
    owner: 'titan', kind: 'rubbleShot', x: T.x, z: T.z, y,
    vx: (tp.x - T.x) / life, vz: (tp.z - T.z) / life, dmg, r: pr,
    lob: true, tx: tp.x, tz: tp.z, aoe: Math.max(0.6, 0.35 * H), life, fromUpgrade: id,
  });
  LINGER = Math.max(LINGER, life + w.dt);
  return true;
}

/** Lobbed debris meteor onto a random enemy within reach (led by its velocity), else the nearest
 *  boss part / building / prop. The projectile module paints the landing circle. */
function doMeteor(w: World, x: number, z: number, R: number, dmgBase: number, aoe: number, id: string): boolean {
  const T = w.titan;
  const H = Math.max(0.1, T.height);
  enemiesInCircle(w, T.x, T.z, Math.max(6, R), SCR_E);
  let live = 0;
  for (let i = 0; i < SCR_E.length; i++) if (liveEnemy(SCR_E[i])) SCR_E[live++] = SCR_E[i];
  SCR_E.length = live;
  const life = 0.85;
  let tx: number, tz: number;
  if (live > 0) {
    const e = SCR_E[Math.min(live - 1, Math.floor(w.rng.combat() * live))];
    const lead = Math.min(aoe * 2, Math.hypot(e.vx, e.vz) * life);
    const sp = Math.hypot(e.vx, e.vz);
    tx = e.x + (sp > 1e-6 ? (e.vx / sp) * lead : 0);
    tz = e.z + (sp > 1e-6 ? (e.vz / sp) * lead : 0);
  } else {
    const t = findTarget(w, x, z, Math.max(6, R), true);
    if (!t) return false;
    const tp = targetPos(w, t);
    tx = tp.x; tz = tp.z;
  }
  spawnProjectile(w, {
    owner: 'titan', kind: 'rubbleShot', x: T.x, z: T.z, y: 1.2 * H,
    vx: (tx - T.x) / life, vz: (tz - T.z) / life, dmg: titanDamage(w, dmgBase), r: Math.max(0.4, 0.2 * H),
    lob: true, tx, tz, aoe, life, fromUpgrade: id,
  });
  LINGER = Math.max(LINGER, life + w.dt);
  return true;
}

function doBloom(w: World, x: number, z: number, life: number): boolean {
  const T = w.titan;
  const cap = Math.max(1, Math.floor(stat(w, 'turretCap')));
  SCR_HAZ.length = 0;
  for (const h of w.hazards) if (h.alive && h.owner === 'titan' && h.kind === 'bloom') SCR_HAZ.push(h);
  let excess = SCR_HAZ.length - (cap - 1);
  for (let i = 0; i < SCR_HAZ.length && excess > 0; i++) { SCR_HAZ[i].alive = false; excess--; }
  const h = spawnHazard(w, {
    owner: 'titan', kind: 'bloom', shape: circle(x, z, Math.max(0.3, 0.3 * T.height)),
    life, dps: 0, data: { cd: 0.4, spore: 4, h: T.height, upg: 1 },
  });
  w.events.push({ type: 'bloomSpawn', id: h.id, x, z });
  return true;
}

function capUpgradeHazards(w: World, kind: HazardKind, cap: number): void {
  SCR_HAZ.length = 0;
  for (const h of w.hazards) if (h.alive && h.owner === 'titan' && h.kind === kind && h.data.upg === 1) SCR_HAZ.push(h);
  let excess = SCR_HAZ.length - (cap - 1);
  for (let i = 0; i < SCR_HAZ.length && excess > 0; i++) { SCR_HAZ[i].alive = false; excess--; }
}

/** Lane-internal (probe): the SimEvent → TriggerOn mapping used by processTriggers. */
export function triggersForEvent(e: SimEvent): TriggerOn[] {
  switch (e.type) {
    case 'propDestroyed': case 'smash': return ['smash'];
    case 'floorBreak': return ['floorBreak', 'smash'];
    case 'buildingCollapse': return ['collapse'];
    case 'enemyKilled': return e.crushed ? ['kill', 'crush'] : ['kill'];
    case 'enemyHit': return e.crit ? ['hit', 'crit'] : ['hit'];
    case 'bossHit': return ['hit'];
    case 'dash': return ['dash'];
    case 'ability': return ['ability'];
    case 'titanHurt': return ['hurt'];
    case 'pickup': return ['pickup'];
    case 'rankUp': return ['rankUp'];
    case 'levelUp': return ['levelUp'];
    default: return [];
  }
}
