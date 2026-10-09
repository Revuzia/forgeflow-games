// GENESIS — herds as entities (CONTRACT.md §6.4, §10): an animal group of one species with a head count, a position
// moving like an agent (analytic segments between hourly decisions, so the renderer can extrapolate), hunger, an owner
// when domestic, and the ecological state the long-term model reads (migration goal, isolation, drift, sickness).
// This file holds the herd basics every system shares: positions, the species of a herd (content animals, then the
// species born on this world by speciation), how well a species suits a cell, spawning, and new herds drifting into a
// living world. The dynamics (grazing, hunting, breeding, migrating, speciating, dying out) live in life/ecology.ts.

import type { PCtx } from '../people/ctx.ts';
import type { Herd } from '../people/state.ts';
import type { AnimalDef } from '../content.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { airSupportsLife } from '../fields/vegetation.ts';

export const HERD_CADENCE = 60;

/** herd position at tick (unit vector) */
export function herdPos(h: Herd, tick: number, out: number[] | Float32Array): void {
  let u = h.t1 > h.t0 ? (tick - h.t0) / (h.t1 - h.t0) : 1;
  if (u < 0) u = 0; else if (u > 1) u = 1;
  let x = h.from[0] + (h.to[0] - h.from[0]) * u;
  let y = h.from[1] + (h.to[1] - h.from[1]) * u;
  let z = h.from[2] + (h.to[2] - h.from[2]) * u;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  out[0] = x; out[1] = y; out[2] = z;
}

/** the definition of an animal species: content animals first, then those born on this world */
export function animalDef(x: PCtx, sp: number): AnimalDef {
  const n = x.c.animals.size;
  if (sp < n) return x.c.animals.list[sp];
  return x.ps.species[sp - n]?.def ?? x.c.animals.list[0];
}

/** the content animal a species descends from (the body the renderer draws) */
export function animalBase(x: PCtx, sp: number): number {
  const n = x.c.animals.size;
  if (sp < n) return sp;
  return x.ps.species[sp - n]?.base ?? 0;
}

/** every species index known on this world (content + derived) */
export function speciesCount(x: PCtx): number {
  return x.c.animals.size + x.ps.species.length;
}

/** an animal species by id (content or derived), or -1 */
export function animalIdx(x: PCtx, id: string): number {
  const i = x.c.animals.idx(id);
  if (i >= 0) return i;
  for (const d of x.ps.species) if (d.def.id === id) return d.idx;
  return -1;
}

/** does this species eat vegetation (and so graze the fields) */
export function grazer(a: AnimalDef): boolean {
  return a.kind === 'herbivore' || a.kind === 'domestic' || a.kind === 'insect';
}

/** a hunter of other animals */
export function hunter(a: AnimalDef): boolean {
  return a.kind === 'predator' || (a.kind === 'scavenger' && a.diet.includes('meat') && a.habitat === 'land');
}

/** how well an animal species suits cell c (0 cannot live there .. 1 ideal) */
export function habitatFit(x: PCtx, sp: number, c: number): number {
  const a = animalDef(x, sp);
  const f = x.p.f;
  const w = f.water[c];
  if (a.habitat === 'water' || a.habitat === 'sea') {
    if (w < 0.4) return 0;
    if (a.habitat === 'sea' && !x.p.s.ocean[c]) return 0;
  } else if (a.habitat === 'land' && (w > 0.5 || x.p.s.ocean[c])) return 0;
  // animals live by the weather of days, not of the hour (the slow mean: a hot afternoon does not kill a herd)
  const t = x.p.s.tempMean[c] || f.temperature[c];
  const [mn, lo, hi, mx] = a.temp;
  if (t <= mn || t >= mx) return 0;
  const tf = t < lo ? (t - mn) / Math.max(1, lo - mn) : t > hi ? (mx - t) / Math.max(1, mx - hi) : 1;
  let food = 1;
  if (grazer(a)) food = forage(x, a, c);
  return tf * (0.2 + 0.8 * food);
}

/** grazing a species finds at cell c (0..1) */
export function forage(x: PCtx, a: AnimalDef, c: number): number {
  const f = x.p.f;
  let food = 0;
  for (const d of a.diet) food += d === 'grass' ? f.grass[c] : d === 'shrub' ? f.shrub[c] * 0.8 : d === 'tree' ? f.tree[c] * 0.4 : d === 'crop' ? f.crop[c] * 1.2 : d === 'grain' ? f.crop[c] * 0.8 : 0.3;
  return Math.min(1, food);
}

/** create a herd at a cell */
export function spawnHerd(x: PCtx, sp: number, c: number, count: number, owner = -1): Herd {
  const id = x.u.ids.alloc('herd');
  const P = x.p.grid.pos;
  const pos: [number, number, number] = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  const h: Herd = {
    id, species: sp, count, from: [...pos], to: [...pos], t0: x.tick, t1: x.tick, cell: c, state: owner >= 0 ? 4 : 0, owner,
    hunger: 0.2, scared: -1, goal: -1, iso: 0, drift: 0, envT: x.p.f.temperature[c], sick: -1, inv: -1,
  };
  x.ps.herds.push(h);
  x.ps.hIndex.set(id, x.ps.herds.length - 1);
  x.ps.version++;
  const key = String(sp);
  if (x.ps.eco.seen[key] === undefined) x.ps.eco.seen[key] = x.tick;
  if (x.ps.eco.extinct[key] !== undefined) delete x.ps.eco.extinct[key];
  return h;
}

/** rebuild the herd id index after herds were removed */
export function reindexHerds(x: PCtx): void {
  x.ps.hIndex.clear();
  x.ps.herds.forEach((h, i) => x.ps.hIndex.set(h.id, i));
}

/** wild species that would form herds at cell c, with weights (predators are rarer than their prey) */
function candidates(x: PCtx, c: number, minFit: number, out: { sp: number; w: number }[]): { sp: number; w: number }[] {
  out.length = 0;
  const biome = x.c.biomes.list[x.p.f.biome[c]]?.id ?? '';
  const n = speciesCount(x);
  for (let i = 0; i < n; i++) {
    const a = animalDef(x, i);
    if (a.domestic || !a.biomes.includes(biome)) continue;
    // a species that died out here does not walk back in from nowhere
    if (x.ps.eco.extinct[String(i)] !== undefined) continue;
    if (habitatFit(x, i, c) <= minFit) continue;
    out.push({ sp: i, w: hunter(a) ? 0.3 : a.swarm ? 0.15 : 1 });
  }
  return out;
}

const _cands: { sp: number; w: number }[] = [];

function pick(cands: { sp: number; w: number }[], roll: number): number {
  let total = 0;
  for (const c of cands) total += c.w;
  let r = roll * total;
  for (const c of cands) { r -= c.w; if (r <= 0) return c.sp; }
  return cands[cands.length - 1].sp;
}

/** the herd count a living world holds (by its green cover) */
export function herdTarget(x: PCtx, density = 1): number {
  return Math.min(80, Math.round((Math.floor(x.p.vegTotal / 600) + 2) * density));
}

/** daily: herds drift into a living world where pasture is plentiful and animals few */
export function herdArrivals(x: PCtx): void {
  const p = x.p;
  if (!x.ps.eco.immigration) return;
  if (!airSupportsLife(p) || p.vegTotal < p.count * 0.08) return;
  const target = herdTarget(x);
  let wild = 0;
  for (const h of x.ps.herds) if (h.owner < 0) wild++;
  if (wild >= target) return;
  const tries = Math.min(4, target - wild);
  for (let t = 0; t < tries; t++) {
    const c = hash32(x.tick, p.seed, t, 0x4e7d) % p.count;
    candidates(x, c, 0.3, _cands);
    if (!_cands.length) continue;
    const sp = pick(_cands, hashFloat(c, x.tick, 0x4e7e));
    const a = animalDef(x, sp);
    spawnHerd(x, sp, c, a.herd[0] + (hash32(c, sp, 0x4e7f) % Math.max(1, a.herd[1] - a.herd[0] + 1)));
  }
}

/** initial herds of a living world (scenario build) */
export function initHerds(x: PCtx, density = 1): number {
  const p = x.p;
  if (!airSupportsLife(p) || p.vegTotal <= 0) return 0;
  const target = herdTarget(x, density);
  let n = 0;
  for (let t = 0; t < target * 6 && n < target; t++) {
    const c = hash32(p.seed, t, 0x1e4d) % p.count;
    candidates(x, c, 0.35, _cands);
    if (!_cands.length) continue;
    const sp = pick(_cands, hashFloat(c, t, 0x1e4e));
    const a = animalDef(x, sp);
    spawnHerd(x, sp, c, a.herd[0] + (hash32(c, sp, 0x1e4f) % Math.max(1, a.herd[1] - a.herd[0] + 1)));
    n++;
  }
  return n;
}
