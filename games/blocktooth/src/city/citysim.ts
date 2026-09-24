// BLOCKTOOTH — city simulation (CONTRACT.md §5.3, §5.4, §7.2). THREE-FREE, deterministic.
// Owner: city-sim lane.
//
// Notes for callers:
//   * damageBuilding / damageProp take the FINAL amount. The caller (combat damageArea /
//     hitTarget, titan contact smash) applies buildingMul × stats.buildingDamage × the
//     oversize rule (OVERSIZE_DAMAGE_MUL) before calling — per CONTRACT §5.4.
//   * Titan counters (floorsEaten / buildingsLeveled / propsEaten) are credited when
//     opts.src is 'titan' or 'hazard'. Pickups, events and tonnage happen for every source.
//   * Loot randomness (pickup split + scatter, heal drops) uses world.rng.loot.
//   * Rect queries CLEAR `out` and return it. Collapsed buildings / dead props are excluded.
//   * resolveCircleVsCity writes the RESOLVED circle centre into out.x/out.z (unchanged
//     position when nothing blocks) and out.bumpTier = highest blocking tier touched (−1 none).

import type { Building, CityLayout, DamageOpts, PickupKind, Tier, World } from '../core/types.ts';
import { TIERS, lootMass, lootXp } from '../core/config.ts';
import { clamp } from '../core/math.ts';
import { rInt } from '../core/rng.ts';
import { spawnPickup } from '../combat/pickups.ts';
import { stepTraffic } from './traffic.ts';
import { PROP_INFO, propRadius } from './citygen.ts';

/** A single hit breaks at most this many floors (a huge hit pancakes several). */
const MAX_FLOORS_PER_HIT = 4;
/** Chance a tier ≥ 2 collapse also drops a heal pickup. */
const COLLAPSE_HEAL_CHANCE = 0.2;

// ─────────────────────────────── per-city bookkeeping ───────────────────────────────
interface CityIndex {
  blockTotal: Int32Array;   // buildings per block
  blockLive: Int32Array;    // non-collapsed buildings per block
  leveled: Uint8Array;      // 1 once every building in the block has collapsed
}
const INDEX = new WeakMap<CityLayout, CityIndex>();

function buildIndex(city: CityLayout): CityIndex {
  const n = city.blocksX * city.blocksZ;
  const blockTotal = new Int32Array(n), blockLive = new Int32Array(n), leveled = new Uint8Array(n);
  for (const b of city.buildings) {
    blockTotal[b.block]++;
    if (!b.collapsed) blockLive[b.block]++;
  }
  for (let i = 0; i < n; i++) leveled[i] = blockTotal[i] > 0 && blockLive[i] === 0 ? 1 : 0;
  return { blockTotal, blockLive, leveled };
}

function cityIndex(city: CityLayout): CityIndex {
  let idx = INDEX.get(city);
  if (!idx) { idx = buildIndex(city); INDEX.set(city, idx); }
  return idx;
}

function countLeveled(idx: CityIndex): number {
  let c = 0;
  for (let i = 0; i < idx.leveled.length; i++) c += idx.leveled[i];
  return c;
}

// ─────────────────────────────── tick ───────────────────────────────
export function stepCity(w: World): void {
  stepTraffic(w);
  // blocks-leveled: incremented immediately by damageBuilding; every second re-derive it from
  // building state (authoritative + self-healing if anything collapsed a building directly).
  if (w.tick % 30 === 0) {
    const idx = buildIndex(w.city);
    INDEX.set(w.city, idx);
    w.run.blocksLeveled = countLeveled(idx);
  }
}

// ─────────────────────────────── spatial queries ───────────────────────────────
const RANGE = [0, 0, 0, 0];
/**
 * How far (m) anything listed under a block cell can reach outside that cell. Buildings never
 * leave their cell (parcels sit inside ±PARCEL_HALF of the centre); props are listed by their
 * CENTRE, so the worst overhang is the largest prop bounding radius (bus ≈ 5.65 m — arterial
 * traffic drives 5.25 m off a cell boundary). Things generated outside the grid (outer-road
 * furniture, harbour boats) are listed under the clamped edge cell, and the query clamps the
 * same way, so they are always found.
 */
const CELL_PAD = 6;
/** Block cells the rect (grown by CELL_PAD) overlaps, clamped to the grid → RANGE. This is the
 *  contract's "cells overlapped by the rect ±1" with the margin expressed in metres: identical
 *  results, but a small rect walks 1–4 cells instead of 9+. */
function cellRange(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number): void {
  const p = city.pitch;
  RANGE[0] = clamp(Math.floor((minX - CELL_PAD - city.originX) / p), 0, city.blocksX - 1);
  RANGE[1] = clamp(Math.floor((minZ - CELL_PAD - city.originZ) / p), 0, city.blocksZ - 1);
  RANGE[2] = clamp(Math.floor((maxX + CELL_PAD - city.originX) / p), 0, city.blocksX - 1);
  RANGE[3] = clamp(Math.floor((maxZ + CELL_PAD - city.originZ) / p), 0, city.blocksZ - 1);
}

export function buildingsInRect(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
  out.length = 0;
  cellRange(city, minX, minZ, maxX, maxZ);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockBuildings[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const b = city.buildings[list[i]];
        if (b.collapsed) continue;
        const hw = b.w / 2, hd = b.d / 2;
        if (b.x + hw < minX || b.x - hw > maxX || b.z + hd < minZ || b.z - hd > maxZ) continue;
        out.push(b.id);
      }
    }
  }
  return out;
}

export function propsInRect(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
  out.length = 0;
  cellRange(city, minX, minZ, maxX, maxZ);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockProps[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const p = city.props[list[i]];
        if (!p.alive) continue;
        const r = propRadius(p.kind);
        if (p.x + r < minX || p.x - r > maxX || p.z + r < minZ || p.z - r > maxZ) continue;
        out.push(p.id);
      }
    }
  }
  return out;
}

/** Block index of a point (bx + bz·blocksX), −1 outside the grid. */
export function blockOf(city: CityLayout, x: number, z: number): number {
  const bx = Math.floor((x - city.originX) / city.pitch);
  const bz = Math.floor((z - city.originZ) / city.pitch);
  if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return -1;
  return bx + bz * city.blocksX;
}

export function buildingById(city: CityLayout, id: number): Building {
  return city.buildings[id];
}

// nearestRubble scratch (sorted top-k by distance)
const RUB_D: number[] = [];
/** Ids of COLLAPSED buildings whose footprint lies within r of (x,z), nearest first, at most `max`. */
export function nearestRubble(city: CityLayout, x: number, z: number, r: number, max: number, out: number[]): number[] {
  out.length = 0;
  RUB_D.length = 0;
  if (max <= 0) return out;
  cellRange(city, x - r, z - r, x + r, z + r);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockBuildings[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const b = city.buildings[list[i]];
        if (!b.collapsed) continue;
        const qx = clamp(x, b.x - b.w / 2, b.x + b.w / 2), qz = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
        const d = Math.hypot(x - qx, z - qz);
        if (d > r) continue;
        // insertion into the sorted top-k (ties → lower id first, deterministic)
        let at = out.length;
        while (at > 0 && (RUB_D[at - 1] > d || (RUB_D[at - 1] === d && out[at - 1] > b.id))) at--;
        if (at >= max) continue;
        out.splice(at, 0, b.id);
        RUB_D.splice(at, 0, d);
        if (out.length > max) { out.length = max; RUB_D.length = max; }
      }
    }
  }
  return out;
}

// ─────────────────────────────── damage ───────────────────────────────
function creditsTitan(opts: DamageOpts): boolean {
  return opts.src === 'titan' || opts.src === 'hazard';
}

/** Rubble for one broken floor: TIERS[tier] floorXp/floorMass split into 1–3 pickups at the
 *  footprint edge point (ex,ez) nearest the titan, nudged outward. */
function dropFloorRubble(w: World, b: Building, ex: number, ez: number): void {
  const loot = w.rng.loot;
  // rank-relative value (snack rule + rank XP scale) — see the economy table in core/config.ts
  const xp = lootXp(b.tier, w.titan.rank), mass = lootMass(b.tier, w.titan.rank);
  const n = b.tier <= 1 ? rInt(loot, 1, 2) : b.tier === 2 ? 2 : 3;
  let nx = ex - b.x, nz = ez - b.z;
  const nl = Math.hypot(nx, nz);
  if (nl > 1e-6) { nx /= nl; nz /= nl; } else { const a = loot() * Math.PI * 2; nx = Math.sin(a); nz = Math.cos(a); }
  const spread = 1 + 0.12 * Math.max(b.w, b.d);
  for (let i = 0; i < n; i++) {
    const t = (loot() - 0.5) * spread;
    // tangent jitter along the edge + a small outward nudge
    const x = ex + (-nz) * t + nx * (0.4 + loot() * 0.8);
    const z = ez + nx * t + nz * (0.4 + loot() * 0.8);
    spawnPickup(w, 'rubble', x, z, xp / n, mass / n);
  }
}

function collapseBuilding(w: World, b: Building, credit: boolean): void {
  const loot = w.rng.loot;
  // fetch (or lazily build) the block index BEFORE flagging the collapse, so a lazily built
  // index never counts this building as already gone (that would double-decrement below)
  const idx = cityIndex(w.city);
  b.collapsed = true;
  b.alive = 0;
  b.floorHp = 0;
  w.events.push({ type: 'buildingCollapse', id: b.id, x: b.x, z: b.z, tier: b.tier, w: b.w, d: b.d, h: b.floors * b.floorH });
  // collapse bonus: collapseBonus × floors worth of floor loot, scattered over the footprint
  const td = TIERS[b.tier];
  const bonus = td.collapseBonus * b.floors;
  const bxp = lootXp(b.tier, w.titan.rank) * bonus, bmass = lootMass(b.tier, w.titan.rank) * bonus;
  const n = Math.min(5, 2 + b.tier);
  for (let i = 0; i < n; i++) {
    const x = b.x + (loot() - 0.5) * b.w * 0.8;
    const z = b.z + (loot() - 0.5) * b.d * 0.8;
    spawnPickup(w, 'rubble', x, z, bxp / n, bmass / n);
  }
  if (b.tier >= 2 && loot() < COLLAPSE_HEAL_CHANCE) spawnPickup(w, 'heal', b.x, b.z, 0, 0);
  if (credit) w.titan.buildingsLeveled++;
  // blocks leveled (incremental; stepCity re-derives it every second)
  idx.blockLive[b.block] = Math.max(0, idx.blockLive[b.block] - 1);
  if (idx.blockLive[b.block] === 0 && idx.blockTotal[b.block] > 0 && !idx.leveled[b.block]) {
    idx.leveled[b.block] = 1;
    w.run.blocksLeveled++;
  }
}

/**
 * Damage a building. `amount` goes into the lowest standing floor; overflow carries into the
 * next floor, at most MAX_FLOORS_PER_HIT floors per call. Each broken floor emits `floorBreak`
 * and drops rubble; contact hits (opts.kind === 'smash') also emit one `smash` beat. The last
 * floor collapses the building (`buildingCollapse`, bonus loot, counters, blocks leveled).
 * Returns the number of floors broken.
 */
export function damageBuilding(w: World, id: number, amount: number, opts: DamageOpts): number {
  const b = w.city.buildings[id];
  if (!b || b.collapsed || b.alive <= 0 || !(amount > 0)) return 0;
  const T = w.titan;
  const credit = creditsTitan(opts);
  // footprint edge point nearest the titan (where the chewing happens)
  const ex = clamp(T.x, b.x - b.w / 2, b.x + b.w / 2);
  const ez = clamp(T.z, b.z - b.d / 2, b.z + b.d / 2);
  let left = amount;
  let broken = 0;
  while (left > 0 && broken < MAX_FLOORS_PER_HIT && b.alive > 0) {
    if (left < b.floorHp) { b.floorHp -= left; left = 0; break; }
    left -= b.floorHp;
    b.alive--;
    broken++;
    w.events.push({ type: 'floorBreak', id: b.id, remaining: b.alive, x: b.x, z: b.z, tier: b.tier });
    dropFloorRubble(w, b, ex, ez);
    w.run.tonnage += TIERS[b.tier].tonsPerFloor;
    if (credit) T.floorsEaten++;
    if (b.alive === 0) { collapseBuilding(w, b, credit); break; }
    b.floorHp = b.floorHpMax;
  }
  if (broken > 0 && opts.kind === 'smash') w.events.push({ type: 'smash', x: ex, z: ez, tier: b.tier });
  return broken;
}

/**
 * Damage a prop. Returns true if this call destroyed it: `propDestroyed` (crushed when the
 * hit is a contact smash), 1–3 pickups worth TIERS[tier] floorXp/floorMass (kiosks and
 * vending machines sometimes also drop a heal), titan.propsEaten, tonnage. Destroyed traffic
 * leaves its lane (traffic.ts drops dead cars).
 */
export function damageProp(w: World, id: number, amount: number, opts: DamageOpts): boolean {
  const p = w.city.props[id];
  if (!p || !p.alive || !(amount > 0)) return false;
  p.hp -= amount;
  if (p.hp > 0) return false;
  p.hp = 0;
  p.alive = false;
  p.speed = 0;
  p.scared = 0;
  const crushed = opts.kind === 'smash';
  w.events.push({ type: 'propDestroyed', id: p.id, kind: p.kind, x: p.x, z: p.z, crushed });
  const info = PROP_INFO[p.kind];
  const td = TIERS[p.tier];
  const loot = w.rng.loot;
  const n = p.tier === 0 ? (loot() < 0.35 ? 2 : 1) : rInt(loot, 2, 3);
  const kind: PickupKind = info.pickup;
  const spread = 0.4 + 0.3 * info.len;
  const pxp = lootXp(p.tier, w.titan.rank), pmass = lootMass(p.tier, w.titan.rank);
  for (let i = 0; i < n; i++) {
    spawnPickup(w, kind, p.x + (loot() - 0.5) * spread, p.z + (loot() - 0.5) * spread, pxp / n, pmass / n);
  }
  if (info.heal > 0 && loot() < info.heal) spawnPickup(w, 'heal', p.x, p.z, 0, 0);
  w.run.tonnage += td.tonsPerFloor;
  if (creditsTitan(opts)) w.titan.propsEaten++;
  return true;
}

// ─────────────────────────────── collision ───────────────────────────────
/**
 * Push a circle out of every non-collapsed building with tier > canFlatten (AABB; round
 * shapes — tanks, dishes, chimneys — as circles) and every live tier-1 prop with
 * tier > canFlatten (oriented box). Up to 3 relaxation passes for corners/alleys.
 * out.x/out.z = resolved centre; out.bumpTier = highest blocking tier touched (−1 none).
 * Returns true if the circle was pushed.
 */
export function resolveCircleVsCity(
  city: CityLayout, x: number, z: number, r: number, canFlatten: Tier,
  out: { x: number; z: number; bumpTier: number },
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) {
    out.x = x; out.z = z; out.bumpTier = -1;
    return false;
  }
  let px = x, pz = z;
  let pushed = false;
  let bump = -1;
  // only tier-1 props (bus / truck / container) ever block — street furniture and cars never
  // do, even for callers that pass canFlatten −1 (enemies walking the streets)
  const propsBlock = canFlatten < 1;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    cellRange(city, px - r, pz - r, px + r, pz + r);
    const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const cell = bx + bz * city.blocksX;
        const list = city.blockBuildings[cell];
        for (let i = 0; i < list.length; i++) {
          const b = city.buildings[list[i]];
          if (b.collapsed || b.tier <= canFlatten) continue;
          const hw = b.w / 2, hd = b.d / 2;
          if (px + r <= b.x - hw || px - r >= b.x + hw || pz + r <= b.z - hd || pz - r >= b.z + hd) continue;
          if (b.shape === 'cylinder' || b.shape === 'dish' || b.shape === 'chimney') {
            const dx = px - b.x, dz = pz - b.z;
            const d = Math.hypot(dx, dz), R = hw + r;
            if (d >= R) continue;
            if (d > 1e-6) { px = b.x + (dx / d) * R; pz = b.z + (dz / d) * R; } else { pz = b.z + R; }
          } else {
            const qx = clamp(px, b.x - hw, b.x + hw), qz = clamp(pz, b.z - hd, b.z + hd);
            const dx = px - qx, dz = pz - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 > 1e-12) {
              const d = Math.sqrt(d2), k = (r - d) / d;
              px += dx * k; pz += dz * k;
            } else {
              // centre inside the footprint: exit through the nearest face
              const l = px - (b.x - hw), rr = b.x + hw - px, t = pz - (b.z - hd), bt = b.z + hd - pz;
              const m = Math.min(l, rr, t, bt);
              if (m === l) px = b.x - hw - r; else if (m === rr) px = b.x + hw + r;
              else if (m === t) pz = b.z - hd - r; else pz = b.z + hd + r;
            }
          }
          moved = pushed = true;
          if (b.tier > bump) bump = b.tier;
        }
        if (!propsBlock) continue;
        const plist = city.blockProps[cell];
        for (let i = 0; i < plist.length; i++) {
          const p = city.props[plist[i]];
          if (!p.alive || p.tier < 1 || p.tier <= canFlatten) continue;
          const info = PROP_INFO[p.kind];
          const hl = info.len / 2, hw = info.wid / 2;
          const fx = Math.sin(p.heading), fz = Math.cos(p.heading);   // local +Z (len axis)
          const rx = fz, rz = -fx;                                      // local +X (wid axis)
          const dx0 = px - p.x, dz0 = pz - p.z;
          const lx = dx0 * rx + dz0 * rz, lz = dx0 * fx + dz0 * fz;
          if (Math.abs(lx) >= hw + r || Math.abs(lz) >= hl + r) continue;
          const qx = clamp(lx, -hw, hw), qz = clamp(lz, -hl, hl);
          let ox = lx - qx, oz = lz - qz;
          const d2 = ox * ox + oz * oz;
          let nlx = lx, nlz = lz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2), k = (r - d) / d;
            nlx += ox * k; nlz += oz * k;
          } else {
            const ex = hw - Math.abs(lx), ez = hl - Math.abs(lz);
            if (ex < ez) nlx = (lx >= 0 ? 1 : -1) * (hw + r); else nlz = (lz >= 0 ? 1 : -1) * (hl + r);
          }
          ox = nlx; oz = nlz;
          px = p.x + ox * rx + oz * fx;
          pz = p.z + ox * rz + oz * fz;
          moved = pushed = true;
          if (p.tier > bump) bump = p.tier;
        }
      }
    }
    if (!moved) break;
  }
  out.x = px;
  out.z = pz;
  out.bumpTier = bump;
  return pushed;
}
