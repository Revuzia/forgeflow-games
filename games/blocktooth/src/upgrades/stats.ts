// BLOCKTOOTH — upgrade stat math (CONTRACT §5.3, §5.5, §8). Lane: upgrades.
// THREE-FREE, DOM-free, deterministic.
//
//   final(stat) = (base + Σ add·stacks) × Π(1 + mul·stacks)          (recomputeStats → titan.stats)
//   stat(w, k)  = final(stat) × Π(1 + buff.mul) over active frenzy buffs, re-clamped
//
// `base` is TITANS[w.titanId].base (a complete StatBlock). maxHp additionally × RANKS[rank].hpMul.
// Cooldown stats (abilityCooldown, dashCooldown) are MULTIPLIERS on cooldown time, floored at 0.35.
// Every stat has a sane clamp (below) so no stack of trade-off mutations can produce a negative
// speed, a zero-width attack or an infinite reroll count.

import type { StatBlock, StatKey, UpgradeState, World } from '../core/types.ts';
import { DRAFT_V2, RANKS } from '../core/config.ts';
import { TITANS } from '../data/titans.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';

/** Every StatKey, in a fixed order (lane-internal; probes + engine iterate it). */
export const STAT_KEYS: readonly StatKey[] = [
  'maxHp', 'regen', 'armor', 'iframes', 'thorns', 'lifesteal', 'rubbleHeal',
  'moveSpeed', 'dashCharges', 'dashCooldown', 'dashDistance',
  'pickupRadius', 'massGain', 'xpGain', 'luck', 'rerolls',
  'damage', 'attackRate', 'attackRange', 'area', 'critChance', 'critMult', 'knockback',
  'chains', 'chainRange', 'projectiles', 'buildingDamage',
  'smashDamage', 'smashRadius', 'sparkChance',
  'abilityCooldown', 'abilityPower',
  'biteCleave', 'pulseEvery', 'vacuumRadius',
  'arcForks', 'wireDuration', 'wireDamage',
  'shellCapacity', 'stompDelay', 'magmaDuration',
  'turretCap', 'turretRate', 'sporeHeal', 'vineLength',
  'ultCharge', 'ultPower',
];

/** Cooldown multipliers never drop below this (§5.5). */
export const COOLDOWN_FLOOR = 0.35;

/** §8 base stat defaults — every key. */
export function baseStatBlock(): StatBlock {
  return {
    // survival
    maxHp: 100, regen: 0.5, armor: 0, iframes: 0, thorns: 0, lifesteal: 0, rubbleHeal: 0,
    // movement
    moveSpeed: 1, dashCharges: 1, dashCooldown: 1, dashDistance: 2.2,
    // growth / economy
    pickupRadius: 1.6, massGain: 1, xpGain: 1, luck: 0, rerolls: 1,
    // offence
    damage: 1, attackRate: 1, attackRange: 1, area: 1, critChance: 0.05, critMult: 1.6, knockback: 1,
    chains: 0, chainRange: 1, projectiles: 0, buildingDamage: 1,
    // smash
    smashDamage: 1, smashRadius: 1, sparkChance: 0,
    // hook
    abilityCooldown: 1, abilityPower: 1,
    // MOLO
    biteCleave: 0, pulseEvery: 4, vacuumRadius: 1,
    // VOLT-KITE
    arcForks: 3, wireDuration: 4, wireDamage: 1,
    // HEARTHBACK
    shellCapacity: 1, stompDelay: 0.6, magmaDuration: 0,
    // BRIARWICK
    turretCap: 4, turretRate: 1, sporeHeal: 1, vineLength: 1,
    // v2 UPROAR (FEATURES_V2 §3)
    ultCharge: 1, ultPower: 1,
  };
}

const DEFAULTS: StatBlock = baseStatBlock();

/** [min, max] per stat, applied to the final value (and again after frenzy buffs). */
const LIMITS: Record<StatKey, readonly [number, number]> = {
  maxHp: [1, Infinity], regen: [0, Infinity], armor: [-50, 400], iframes: [0, 1.5], thorns: [0, Infinity],
  lifesteal: [0, 0.5], rubbleHeal: [0, Infinity],
  moveSpeed: [0.3, 3], dashCharges: [1, 6], dashCooldown: [COOLDOWN_FLOOR, 4], dashDistance: [0.5, 8],
  pickupRadius: [0.2, 20], massGain: [0.1, 10], xpGain: [0.1, 10], luck: [-5, 30], rerolls: [0, 9],
  damage: [0.1, Infinity], attackRate: [0.2, 5], attackRange: [0.3, 4], area: [0.3, 4],
  critChance: [0, 1], critMult: [1, 10], knockback: [0, 5],
  chains: [0, 12], chainRange: [0.3, 4], projectiles: [0, 12], buildingDamage: [0.1, Infinity],
  smashDamage: [0.1, Infinity], smashRadius: [0.3, 3], sparkChance: [0, 1],
  abilityCooldown: [COOLDOWN_FLOOR, 4], abilityPower: [0.1, Infinity],
  biteCleave: [0, 6], pulseEvery: [1, 12], vacuumRadius: [0.3, 4],
  arcForks: [0, 16], wireDuration: [0.5, 20], wireDamage: [0.1, Infinity],
  shellCapacity: [0.1, 6], stompDelay: [0.15, 2], magmaDuration: [0, 20],
  turretCap: [1, 16], turretRate: [0.2, 5], sporeHeal: [0, 10], vineLength: [0.3, 4],
  ultCharge: [0.2, 5], ultPower: [0.1, Infinity],
};

/** Counts: floored (a half-bought charge is not a charge). pulseEvery is rounded. */
const INT_KEYS: Partial<Record<StatKey, 'floor' | 'round'>> = {
  dashCharges: 'floor', rerolls: 'floor', chains: 'floor', projectiles: 'floor', arcForks: 'floor',
  turretCap: 'floor', pulseEvery: 'round',
};

function limit(k: StatKey, v: number): number {
  if (!Number.isFinite(v)) v = v > 0 ? LIMITS[k][1] : DEFAULTS[k];
  const mode = INT_KEYS[k];
  if (mode === 'floor') v = Math.floor(v + 1e-9);
  else if (mode === 'round') v = Math.round(v);
  const lo = LIMITS[k][0], hi = LIMITS[k][1];
  return v < lo ? lo : v > hi ? hi : v;
}

export function createUpgradeState(): UpgradeState {
  return {
    owned: {},
    order: [],
    pendingDrafts: 0,
    offer: null,
    rerolls: DEFAULTS.rerolls,
    icd: {},
    buffs: [],
    shield: 0,
    chestDrafts: 0,
    // v2 (FEATURES_V2 §7.5)
    banished: [],
    banishLeft: DRAFT_V2.banishes,
    lockLeft: DRAFT_V2.locks,
    locked: null,
  };
}

// scratch accumulators (fully reset every call → no cross-world leakage)
const ADD: Record<string, number> = {};
const MUL: Record<string, number> = {};

/**
 * Rebuild titan.stats from the titan's base block + every owned upgrade, apply the rank's hp×,
 * and keep the current HP ratio when maxHp changes. Called on apply, on rank-up (titansim), and
 * at world creation. Idempotent: calling it twice changes nothing.
 */
export function recomputeStats(w: World): void {
  const T = w.titan;
  const def = TITANS[w.titanId];
  const base: StatBlock = def ? def.base : DEFAULTS;
  for (let i = 0; i < STAT_KEYS.length; i++) { const k = STAT_KEYS[i]; ADD[k] = 0; MUL[k] = 1; }

  const owned = w.upgrades.owned;
  for (const id in owned) {
    const u = UPGRADE_BY_ID[id];
    let n = owned[id];
    if (!u || !(n > 0)) continue;
    if (n > u.maxStacks) n = u.maxStacks;
    for (let e = 0; e < u.effects.length; e++) {
      const eff = u.effects[e];
      if (!eff.stat) continue;
      if (eff.add) ADD[eff.stat] += eff.add * n;
      if (eff.mul) MUL[eff.stat] *= Math.max(0.05, 1 + eff.mul * n);
    }
  }

  // Never write into the shared TITANS base object (createTitan may have aliased it).
  let s = T.stats;
  if (!s || s === base || s === DEFAULTS) { s = {} as StatBlock; T.stats = s; }
  const rank = RANKS[T.rank] ?? RANKS[0];
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const k = STAT_KEYS[i];
    const b = base[k] !== undefined ? base[k] : DEFAULTS[k];
    let v = (b + ADD[k]) * MUL[k];
    if (k === 'maxHp') v *= rank.hpMul;
    s[k] = limit(k, v);
  }

  const oldMax = T.maxHp;
  const newMax = s.maxHp;
  if (oldMax > 0 && Math.abs(newMax - oldMax) > 1e-9 && T.alive !== false) {
    T.hp = T.hp * (newMax / oldMax);
  }
  T.maxHp = newMax;
  if (T.hp > newMax) T.hp = newMax;
  // a stat drop (trade-off mutation) can shrink the dash pool below the charges held
  if (T.dashCharges > s.dashCharges) T.dashCharges = s.dashCharges;
}

/** Current value of a stat, including active frenzy buffs (re-clamped; cooldown floors hold). */
export function stat(w: World, key: StatKey): number {
  let v = w.titan.stats[key];
  if (v === undefined) v = DEFAULTS[key];
  const buffs = w.upgrades.buffs;
  if (buffs.length === 0) return v;
  let m = 1;
  for (let i = 0; i < buffs.length; i++) if (buffs[i].stat === key) m *= Math.max(0.05, 1 + buffs[i].mul);
  return m === 1 ? v : limit(key, v * m);
}

/** Lane-internal: clamp helper (engine uses it for luck/chance math). */
export function statLimit(k: StatKey, v: number): number { return limit(k, v); }
