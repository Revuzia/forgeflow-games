// GENESIS — herds as entities (CONTRACT.md §6.4, §10): an animal group of one species with a head count, a position
// moving like an agent (analytic segments between hourly decisions, so the renderer can extrapolate), hunger, an owner
// when domestic, and the ecological state the long-term model reads (migration goal, isolation, drift, sickness).
// This file holds the herd basics every system shares: positions, the species of a herd (content animals, then the
// species born on this world by speciation), how well a species suits a cell, spawning, and new herds drifting into a
// living world. The dynamics (grazing, hunting, breeding, migrating, speciating, dying out) live in life/ecology.ts.

import type { PCtx } from '../people/ctx.ts';
import type { Herd, Settlement } from '../people/state.ts';
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

/**
 * Can herds of species sp drift in from beyond (LIVING CONTENT r2): the real kinds and those the god brought — a kind
 * born on this world lives only where it arose and spreads by its own herds (arrivals made the forms of the 50-year runs
 * the game of the whole world: 'Desert hares' in every guild that had hares).
 */
export function immigrant(x: PCtx, sp: number): boolean {
  return sp < x.c.animals.size || !!x.ps.species[sp - x.c.animals.size]?.god;
}

/** wild species that would form herds at cell c, with weights (predators are rarer than their prey) */
function candidates(x: PCtx, c: number, minFit: number, out: { sp: number; w: number }[]): { sp: number; w: number }[] {
  out.length = 0;
  const biome = x.c.biomes.list[x.p.f.biome[c]]?.id ?? '';
  const n = speciesCount(x);
  for (let i = 0; i < n; i++) {
    const a = animalDef(x, i);
    if (a.domestic || !a.biomes.includes(biome)) continue;
    // a species that died out here does not walk back in from nowhere, nor does a kind born here (LIVING CONTENT r2)
    if (x.ps.eco.extinct[String(i)] !== undefined || !immigrant(x, i)) continue;
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

/** LIVING CONTENT: the herds of the waters, the air and the swarms a world holds — the share of herdTarget that was not
 * the land's game (about a quarter of a census world's herds were); the land's own follow the guilds (guildTargets) */
export function otherTarget(x: PCtx, density = 1): number {
  return Math.round(herdTarget(x, density) * 0.7);
}

// ───────────────────────────── LIVING CONTENT (§4.5): the land's game by biome ─────────────────────────────
//
// The herd target used to be one number for the whole world (its green cover), filled by herds of whatever suited a
// random cell: a handful of land herds on a world (10-17 on the census worlds), the nearest a median 2 km from a band at
// its founding, and five biomes with grazers and no hunter. Now every biome big enough to hold a guild (GUILD_KM2, the
// area of 200 cells of the census grid) holds at least one herd of each grazer that can live there, more by its area
// (PREY_PER_KM2), and one hunter for about every four herds of game (PREY_PER_HUNTER); new herds drift in where a
// biome falls short, toward the country 300-1 500 m from the peoples (the game at the edge of the fields). The herds
// of the waters, the air and the swarms keep the old green-cover target (herdTarget).

/** the least area of a biome (km²) that holds a guild of its own: 200 cells of the census grid (n = 64, r = 3 km) */
export const GUILD_KM2 = 0.62;
/** herds of game per km² of a biome (at least one of each grazer that fits it), and herds of game per hunter */
export const PREY_PER_KM2 = 0.6, PREY_PER_HUNTER = 4;
/** land herds a world keeps at most (the hourly ecology reads every herd against every other) */
export const MAX_LAND_HERDS = 90;
/** game arrives this far from a people (m) */
export const ARRIVE_NEAR: [number, number] = [300, 1500];

export interface Guild {
  biome: number;
  /** land cells of the biome (ascending) */
  cells: number[];
  /** grazers and hunters that can live in it (species indices, ascending) */
  prey: number[];
  pred: number[];
  /** herds it should hold */
  preyTarget: number;
  predTarget: number;
}

/** is this species game of the land (a grazer that walks: not a swarm, an insect or a beast of the water) */
export function landGame(a: AnimalDef): boolean {
  return !a.domestic && a.habitat === 'land' && a.kind === 'herbivore' && !a.swarm;
}

/** a hunter of land game (a beast of prey that walks, or a raptor of the air) */
export function landHunter(a: AnimalDef): boolean {
  return !a.domestic && a.kind === 'predator' && (a.habitat === 'land' || a.habitat === 'air');
}

/** the biome guilds of planet x.p now (biomes move with the climate; asked once a game day, by herdArrivals) */
export function guildTargets(x: PCtx): Guild[] {
  const p = x.p;
  const byBiome = new Map<number, number[]>();
  const f = p.f;
  for (let c = 0; c < p.count; c++) {
    if (p.s.ocean[c] || f.water[c] > 0.5) continue;
    const b = f.biome[c];
    let l = byBiome.get(b);
    if (!l) byBiome.set(b, (l = []));
    l.push(c);
  }
  const cellKm2 = (4 * Math.PI * p.st.radius * p.st.radius) / 1e6 / p.count;
  const n = speciesCount(x);
  const guilds: Guild[] = [];
  for (const b of [...byBiome.keys()].sort((q, w) => q - w)) {
    const cells = byBiome.get(b)!;
    const km2 = cells.length * cellKm2;
    if (km2 < GUILD_KM2) continue;
    const id = x.c.biomes.list[b]?.id ?? '';
    const fits = (sp: number) => {
      // lives somewhere in the biome: a few cells of it, sampled by a hash
      for (let k = 0; k < 24; k++) if (habitatFit(x, sp, cells[hash32(b, sp, k, 0x6d1) % cells.length]) > 0.35) return true;
      return false;
    };
    const prey: number[] = [], pred: number[] = [];
    for (let sp = 0; sp < n; sp++) {
      const a = animalDef(x, sp);
      if (!a.biomes.includes(id) || x.ps.eco.extinct[String(sp)] !== undefined || !immigrant(x, sp)) continue;
      if (landGame(a) && fits(sp)) prey.push(sp);
      else if (landHunter(a) && fits(sp)) pred.push(sp);
    }
    if (!prey.length) continue;
    const preyTarget = Math.max(prey.length, Math.round(km2 * PREY_PER_KM2));
    const predTarget = pred.length ? Math.max(1, Math.round(preyTarget / PREY_PER_HUNTER)) : 0;
    guilds.push({ biome: b, cells, prey, pred, preyTarget, predTarget });
  }
  // a world of many biomes: the land herds it can carry, shared out by the guilds' sizes
  const total = guilds.reduce((q, g) => q + g.preyTarget + g.predTarget, 0);
  if (total > MAX_LAND_HERDS) {
    const k = MAX_LAND_HERDS / total;
    for (const g of guilds) {
      g.preyTarget = Math.max(1, Math.round(g.preyTarget * k));
      g.predTarget = g.pred.length ? Math.max(1, Math.round(g.predTarget * k)) : 0;
    }
  }
  return guilds;
}

/** the wild land herds now in each guild's biome: [game, hunters] by biome index */
function guildCounts(x: PCtx): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const f = x.p.f;
  for (const h of x.ps.herds) {
    if (h.owner >= 0 || h.count < 0.5) continue;
    const a = animalDef(x, h.species);
    const game = landGame(a), hunt = landHunter(a);
    if (!game && !hunt) continue;
    const b = f.biome[h.cell];
    let v = out.get(b);
    if (!v) out.set(b, (v = [0, 0]));
    if (game) v[0]++; else v[1]++;
  }
  return out;
}

/** metres from cell c to the nearest standing settlement (Infinity none) */
function nearestPeopleM(x: PCtx, c: number): number {
  const P = x.p.grid.pos;
  let best = -2;
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0) continue;
    const d = P[c * 3] * st.pos[0] + P[c * 3 + 1] * st.pos[1] + P[c * 3 + 2] * st.pos[2];
    if (d > best) best = d;
  }
  return best < -1 ? Infinity : Math.acos(Math.min(1, best)) * x.p.st.radius;
}

/**
 * A cell of guild g for a herd of species sp: of a few cells drawn by a hash, the one it suits best — where peoples
 * live, preferring the country ARRIVE_NEAR from the nearest of them (or -1: none suits it).
 */
function guildCell(x: PCtx, g: Guild, sp: number, salt: number, nearPeople: boolean): number {
  let best = -1, bv = 0.35;
  for (let k = 0; k < 10; k++) {
    const c = g.cells[hash32(salt, sp, k, 0x6d2) % g.cells.length];
    let v = habitatFit(x, sp, c);
    if (v <= 0.35) continue;
    // a world's first herds are spread over the country that can feed them (the first such cell drawn), not heaped on
    // its best pasture: wherever a people sets down, game is not far
    if (!nearPeople) return c;
    if (nearPeople) {
      const d = nearestPeopleM(x, c);
      if (d >= ARRIVE_NEAR[0] && d <= ARRIVE_NEAR[1]) v += 0.5;
      else if (d < ARRIVE_NEAR[0]) v -= 0.3;
    }
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

function herdOf(x: PCtx, sp: number, c: number, salt: number): Herd {
  const a = animalDef(x, sp);
  return spawnHerd(x, sp, c, a.herd[0] + (hash32(c, sp, salt) % Math.max(1, a.herd[1] - a.herd[0] + 1)));
}

/** the herds of the waters, the air and the swarms (everything that is not land game or its hunters) */
function otherKind(x: PCtx, sp: number): boolean {
  const a = animalDef(x, sp);
  return !landGame(a) && !landHunter(a);
}

/** daily: herds drift into a living world where pasture is plentiful and animals few */
export function herdArrivals(x: PCtx): void {
  const p = x.p;
  if (!x.ps.eco.immigration) return;
  if (!airSupportsLife(p) || p.vegTotal < p.count * 0.08) return;
  // the land's game and its hunters: the guild that falls shortest first, toward the peoples
  const guilds = guildTargets(x);
  if (guilds.length) {
    const have = guildCounts(x);
    let landNow = 0;
    for (const v of have.values()) landNow += v[0] + v[1];
    const short = guilds.map((g) => { const v = have.get(g.biome) ?? [0, 0]; return { g, prey: g.preyTarget - v[0], pred: g.predTarget - v[1] }; })
      .filter((q) => q.prey > 0 || q.pred > 0).sort((a, b) => (b.prey + b.pred) - (a.prey + a.pred) || a.g.biome - b.g.biome);
    let made = 0;
    for (const q of short) {
      if (made >= 2) break;
      // game before hunters: a hunter comes to a guild with game enough for it
      const hunters = q.prey <= 0 && q.pred > 0;
      // (LIVING CONTENT r2: a full land keeps out new game, never the hunters its guilds lack — the game's own herds
      // split past MAX_LAND_HERDS, and the 50-year runs ended with 185 herds of game and 3 of hunters, most biomes none)
      if (landNow + made >= MAX_LAND_HERDS && !hunters) continue;
      const list = hunters ? q.g.pred : q.g.prey;
      const sp = list[hash32(x.tick, p.seed, q.g.biome, 0x6d3) % list.length];
      const c = guildCell(x, q.g, sp, hash32(x.tick, q.g.biome, 0x6d4), !hunters);
      if (c < 0) continue;
      herdOf(x, sp, c, 0x4e7f);
      made++;
    }
  }
  // a people with no game within a day's hunting (GAME_NEAR_M) draws a herd of its country's game toward it
  gameToPeople(x, guilds);
  const target = otherTarget(x);
  let wild = 0;
  for (const h of x.ps.herds) if (h.owner < 0 && otherKind(x, h.species)) wild++;
  if (wild >= target) return;
  const tries = Math.min(4, target - wild);
  for (let t = 0; t < tries; t++) {
    const c = hash32(x.tick, p.seed, t, 0x4e7d) % p.count;
    candidates(x, c, 0.3, _cands);
    for (let i = _cands.length - 1; i >= 0; i--) if (!otherKind(x, _cands[i].sp)) _cands.splice(i, 1);
    if (!_cands.length) continue;
    const sp = pick(_cands, hashFloat(c, x.tick, 0x4e7e));
    herdOf(x, sp, c, 0x4e7f);
  }
}

/** a people with no wild game nearer than this (m) draws a herd toward it (herdArrivals), from this far out (m) */
export const GAME_NEAR_M = 1000;
export const DRAW_FROM: [number, number] = [300, 900];

/**
 * Daily: every standing settlement with no wild land game within GAME_NEAR_M draws one herd of the game of its own
 * country (the guild of its biome), DRAW_FROM it — never beyond MAX_LAND_HERDS or half again a guild's target (game
 * comes to the edge of the fields; it is not made from nothing everywhere).
 */
function gameToPeople(x: PCtx, guilds: Guild[], only?: Settlement[]): void {
  const ps = x.ps, P = x.p.grid.pos;
  if (!guilds.length || !ps.settlements.length) return;
  let land = 0;
  const game: Herd[] = [];
  for (const h of ps.herds) {
    if (h.owner >= 0 || h.count < 0.5) continue;
    const a = animalDef(x, h.species);
    if (landGame(a)) { game.push(h); land++; } else if (landHunter(a)) land++;
  }
  if (land >= MAX_LAND_HERDS) return;
  const have = guildCounts(x);
  const reach = Math.cos(GAME_NEAR_M / x.p.st.radius);
  for (const st of only ?? ps.settlements) {
    if (st.fallen >= 0) continue;
    if (game.some((h) => P[h.cell * 3] * st.pos[0] + P[h.cell * 3 + 1] * st.pos[1] + P[h.cell * 3 + 2] * st.pos[2] >= reach)) continue;
    const g = guilds.find((q) => q.biome === x.p.f.biome[st.cell]) ?? guilds.slice().sort((a, b) => b.cells.length - a.cells.length)[0];
    if ((have.get(g.biome)?.[0] ?? 0) >= g.preyTarget * 1.5) continue;
    const sp = g.prey[hash32(x.tick, st.id, 0x6d5) % g.prey.length];
    // the cells ARRIVE_NEAR out from it where the herd can live: the best of a few drawn
    const ring = x.p.cellsNear(st.pos, DRAW_FROM[1]);
    let c = -1, bv = 0.3;
    for (let k = 0; k < 16 && ring.length; k++) {
      const o = ring[hash32(x.tick, st.id, k, 0x6d6) % ring.length];
      const d = nearestPeopleM(x, o);
      if (d < DRAW_FROM[0] || d > DRAW_FROM[1]) continue;
      const v = habitatFit(x, sp, o);
      if (v > bv) { bv = v; c = o; }
    }
    if (c < 0) continue;
    game.push(herdOf(x, sp, c, 0x4e80));
    if (++land >= MAX_LAND_HERDS) return;
  }
}

/**
 * Hourly (ecoStep): a settlement founded within the last HERD_CADENCE ticks with no game near draws its herd at once, as
 * gameToPeople does daily — a people sets down where game is (LIVING §4.5: a wild land herd within 1 km at founding).
 * Stateless: the founding tick says which settlements are new.
 */
export function gameForNew(x: PCtx): void {
  let fresh: Settlement[] | null = null;
  for (const st of x.ps.settlements) {
    const age = x.tick - st.founded;
    if (st.fallen < 0 && age >= 0 && age < HERD_CADENCE) (fresh ??= []).push(st);
  }
  if (fresh) gameToPeople(x, guildTargets(x), fresh);
}

/** initial herds of a living world (scenario build): every guild's game and hunters, then the waters, air and swarms */
export function initHerds(x: PCtx, density = 1): number {
  const p = x.p;
  if (!airSupportsLife(p) || p.vegTotal <= 0) return 0;
  let n = 0;
  for (const g of guildTargets(x)) {
    const preyN = Math.max(1, Math.round(g.preyTarget * density));
    for (let k = 0; k < preyN; k++) {
      // one of each grazer first, then by a roll
      const sp = k < g.prey.length ? g.prey[k] : g.prey[hash32(p.seed, g.biome, k, 0x1e50) % g.prey.length];
      const c = guildCell(x, g, sp, hash32(p.seed, g.biome, k, 0x1e51), false);
      if (c < 0) continue;
      herdOf(x, sp, c, 0x1e4f);
      n++;
    }
    const predN = g.predTarget ? Math.max(1, Math.round(g.predTarget * density)) : 0;
    for (let k = 0; k < predN; k++) {
      const sp = g.pred[hash32(p.seed, g.biome, k, 0x1e52) % g.pred.length];
      const c = guildCell(x, g, sp, hash32(p.seed, g.biome, k, 0x1e53), false);
      if (c < 0) continue;
      herdOf(x, sp, c, 0x1e4f);
      n++;
    }
  }
  const target = otherTarget(x, density);
  let m = 0;
  for (let t = 0; t < target * 6 && m < target; t++) {
    const c = hash32(p.seed, t, 0x1e4d) % p.count;
    candidates(x, c, 0.35, _cands);
    for (let i = _cands.length - 1; i >= 0; i--) if (!otherKind(x, _cands[i].sp)) _cands.splice(i, 1);
    if (!_cands.length) continue;
    const sp = pick(_cands, hashFloat(c, t, 0x1e4e));
    herdOf(x, sp, c, 0x1e4f);
    m++;
  }
  return n + m;
}
