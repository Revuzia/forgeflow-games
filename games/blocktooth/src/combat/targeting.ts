// BLOCKTOOTH — auto-attack targeting (CONTRACT §5.3, §8, combat lane). THREE-free, deterministic.
//
// findTarget(w, x, z, range, preferEnemies = true):
//   preferEnemies = true  → nearest enemy (drones included) → nearest boss part → nearest
//                           flattenable building/prop → nearest oversize building/prop.
//   preferEnemies = false → nearest of anything (enemy, boss part, flattenable city) by surface
//                           distance; oversize buildings/props only when nothing else is in range.
// All distances are SURFACE distances (to the enemy/part circle, the building footprint, the prop's
// radius). Ties: enemies < boss < buildings < props, then lower id / part index.

import type { DamageOpts, Enemy, World } from '../core/types.ts';
import { RANKS } from '../core/config.ts';
import { clamp } from '../core/math.ts';
import { cityDamageAmount, damageEnemy, lifestealFromBoss, propRadius, resolveTitanCrit } from './damage.ts';
import { nearestEnemy } from './spatial.ts';
import { damageBoss } from '../ai/bosses/index.ts';
import { buildingById, buildingsInRect, damageBuilding, damageProp, propsInRect } from '../city/citysim.ts';

export type Target =
  | { kind: 'enemy'; e: Enemy }
  | { kind: 'boss'; part: number }
  | { kind: 'building'; id: number }
  | { kind: 'prop'; id: number };

const PROP_PAD = 5.5;   // largest prop radius + slack for the rect query
const idScratch: number[] = [];

interface Best { d: number; cat: number; id: number; }
function better(d: number, cat: number, id: number, b: Best): boolean {
  if (d < b.d) return true;
  if (d > b.d) return false;
  if (cat !== b.cat) return cat < b.cat;
  return id < b.id;
}

/** Nearest boss part within range (surface distance); −1 if none / boss not hittable. */
function nearestBossPart(w: World, x: number, z: number, range: number, out: Best): number {
  const B = w.boss;
  if (!B || !B.alive || B.introT > 0) return -1;
  let best = -1;
  for (let i = 0; i < B.parts.length; i++) {
    const p = B.parts[i];
    const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - p.r);
    if (d > range) continue;
    if (best < 0 || d < out.d || (d === out.d && i < best)) { best = i; out.d = d; }
  }
  return best;
}

// module-level scratch (findTarget is not re-entrant: nothing it calls can call back into it)
const bestPart: Best = { d: Infinity, cat: 1, id: 0 };
const bestAny: Best = { d: Infinity, cat: 9, id: -1 };
const bestFlat: Best = { d: Infinity, cat: 9, id: 0 };
const bestOver: Best = { d: Infinity, cat: 9, id: 0 };

/** Fills bestFlat / bestOver with the nearest flattenable / oversize building or prop in range. */
function scanCity(w: World, x: number, z: number, range: number): void {
  bestFlat.d = Infinity; bestFlat.cat = 9; bestFlat.id = -1;
  bestOver.d = Infinity; bestOver.cat = 9; bestOver.id = -1;
  const city = w.city;
  if (!city) return;
  const can = RANKS[w.titan.rank].canFlatten;
  idScratch.length = 0;
  const bs = buildingsInRect(city, x - range, z - range, x + range, z + range, idScratch);
  for (let i = 0; i < bs.length; i++) {
    const b = buildingById(city, bs[i]);
    if (!b || b.collapsed || b.alive <= 0) continue;
    const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
    const dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    const slot = b.tier <= can ? bestFlat : bestOver;
    if (better(d, 2, b.id, slot)) { slot.d = d; slot.cat = 2; slot.id = b.id; }
  }
  idScratch.length = 0;
  const ps = propsInRect(city, x - range - PROP_PAD, z - range - PROP_PAD, x + range + PROP_PAD, z + range + PROP_PAD, idScratch);
  for (let i = 0; i < ps.length; i++) {
    const p = city.props[ps[i]];
    if (!p || !p.alive) continue;
    const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - propRadius(p));
    if (d > range) continue;
    const slot = p.tier <= can ? bestFlat : bestOver;
    if (better(d, 3, p.id, slot)) { slot.d = d; slot.cat = 3; slot.id = p.id; }
  }
  idScratch.length = 0;
}

function cityTarget(b: Best): Target | null {
  if (b.id < 0) return null;
  return b.cat === 2 ? { kind: 'building', id: b.id } : { kind: 'prop', id: b.id };
}

/** Pick the auto-attack target around (x, z) within `range` metres (see header for the order). */
export function findTarget(w: World, x: number, z: number, range: number, preferEnemies = true): Target | null {
  if (!(range >= 0)) return null;
  const e = nearestEnemy(w, x, z, range);
  const bp = bestPart; bp.d = Infinity; bp.cat = 1; bp.id = 0;
  if (preferEnemies) {
    if (e) return { kind: 'enemy', e };
    const part = nearestBossPart(w, x, z, range, bp);
    if (part >= 0) return { kind: 'boss', part };
    scanCity(w, x, z, range);
    return cityTarget(bestFlat) ?? cityTarget(bestOver);
  }
  // nearest of anything; oversize city last
  const best = bestAny; best.d = Infinity; best.cat = 9; best.id = -1;
  let pick: Target | null = null;
  if (e) {
    best.d = Math.max(0, Math.hypot(e.x - x, e.z - z) - e.radius); best.cat = 0; best.id = e.id;
    pick = { kind: 'enemy', e };
  }
  const part = nearestBossPart(w, x, z, range, bp);
  if (part >= 0 && better(bp.d, 1, part, best)) {
    best.d = bp.d; best.cat = 1; best.id = part;
    pick = { kind: 'boss', part };
  }
  scanCity(w, x, z, range);
  if (bestFlat.id >= 0 && better(bestFlat.d, bestFlat.cat, bestFlat.id, best)) pick = cityTarget(bestFlat);
  return pick ?? cityTarget(bestOver);
}

/**
 * World position to aim at. Enemies/props/boss parts: their centre. Buildings: the point of the
 * footprint closest to the titan (so short-reach attacks aimed at a big block reach its wall).
 */
export function targetPos(w: World, t: Target): { x: number; z: number } {
  switch (t.kind) {
    case 'enemy': return { x: t.e.x, z: t.e.z };
    case 'boss': {
      const B = w.boss;
      const p = B ? B.parts[t.part] : undefined;
      if (p) return { x: p.x, z: p.z };
      return B ? { x: B.x, z: B.z } : { x: w.titan.x, z: w.titan.z };
    }
    case 'building': {
      const b = buildingById(w.city, t.id);
      if (!b) return { x: w.titan.x, z: w.titan.z };
      return {
        x: clamp(w.titan.x, b.x - b.w / 2, b.x + b.w / 2),
        z: clamp(w.titan.z, b.z - b.d / 2, b.z + b.d / 2),
      };
    }
    case 'prop': {
      const p = w.city.props[t.id];
      return p ? { x: p.x, z: p.z } : { x: w.titan.x, z: w.titan.z };
    }
  }
}

/** Is the target still worth attacking (alive / standing)? */
export function targetAlive(w: World, t: Target): boolean {
  switch (t.kind) {
    case 'enemy': return t.e.alive;
    case 'boss': return !!w.boss && w.boss.alive && t.part >= 0 && t.part < w.boss.parts.length;
    case 'building': { const b = buildingById(w.city, t.id); return !!b && !b.collapsed && b.alive > 0; }
    case 'prop': { const p = w.city.props[t.id]; return !!p && p.alive; }
  }
}

/**
 * Titan-side single-target hit. dmg is the titanDamage-scaled number; a crit is rolled here unless
 * opts.crit / opts.noCrit says otherwise. City targets take buildingMul × stats.buildingDamage ×
 * the oversize rule (unless opts.noCity).
 */
export function hitTarget(w: World, t: Target, dmg: number, opts: DamageOpts): void {
  if (!(dmg > 0)) return;
  const c = resolveTitanCrit(w, dmg, opts);
  const o: DamageOpts = c.crit === opts.crit ? opts : { ...opts, crit: c.crit };
  switch (t.kind) {
    case 'enemy':
      if (t.e.alive) damageEnemy(w, t.e, c.dmg, o);
      return;
    case 'boss': {
      const B = w.boss;
      if (!B || !B.alive || t.part < 0 || t.part >= B.parts.length) return;
      const before = B.hp;
      damageBoss(w, t.part, c.dmg, o);
      lifestealFromBoss(w, before);
      return;
    }
    case 'building': {
      if (opts.noCity) return;
      const b = buildingById(w.city, t.id);
      if (!b || b.collapsed || b.alive <= 0) return;
      const amt = cityDamageAmount(w, b.tier, c.dmg, o);
      if (amt > 0) damageBuilding(w, b.id, amt, o);
      return;
    }
    case 'prop': {
      if (opts.noCity) return;
      const p = w.city.props[t.id];
      if (!p || !p.alive) return;
      const amt = cityDamageAmount(w, p.tier, c.dmg, o);
      if (amt > 0) damageProp(w, p.id, amt, o);
      return;
    }
  }
}
