// GENESIS — LIVING drought (LIVING.md §2.7): the water people can walk to.
//
// A band in a dust bowl judges where it goes by the water it can actually reach on foot, not by green land or a straight
// line, and a thirsty body looks for water the same way: a walking-cost Dijkstra over route planning's step costs (cliffs
// of grade > 0.9 and deep water stop a walker; swimmers swim; a carried boat crosses). Pure function of the world now (no
// randomness; ties break by lower cell index): deterministic. The search scratch is kept PER WORLD (a WeakMap on the
// planet), so two worlds in one process (tests run sims side by side) never share a cached answer or read each other's
// arrays; the per-person memo is keyed by tick, so a loaded save rebuilds the same answers the live sim gave.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { drinkable, freshWater, snowWater, stepFactor, wellFlows } from './world.ts';
import { pathOptsFor } from './resources.ts';
import { bestBoat, boatSwim } from './missions.ts';
import { FIRE_BURN } from './danger.ts';

/** a day's walk in walking cost (metre-equivalents on flat dry ground): 12 waking hours at 120 m an hour */
export const DAY_WALK = 1500;
/** water within this walk of where a band stands is "water here" (a short fetch, under two hours there and back) */
export const WATER_NEAR = 300;

export interface WaterReach {
  from: number;
  /** the drinking spots reached, cheapest walk from `from` first */
  water: number[];
}

/** one search's answer for a thirsty body: the nearest drinking spot and the nearest soak on foot (-1: none) */
export interface WaterOnFoot { drink: number; drinkCost: number; soak: number; soakCost: number; }

// Within a world, reachCost reads the reach of the LAST waterReach call (callers use it right after it, within one band
// step); waterOnFoot has its own arrays, so a body's search never clobbers a band's reach.
interface Scratch {
  n: number;
  g: Float64Array;
  stamp: Uint32Array; closed: Uint32Array;
  gen: number;
  last: WaterReach | null;
  lastKey: string;
  fg: Float64Array; fstamp: Uint32Array; fclosed: Uint32Array;
  fgen: number;
  memoTick: number;
  /** this tick's searches: the answer and the budget it was searched to */
  memo: Map<string, { r: WaterOnFoot; budget: number }>;
}
const _scratch = new WeakMap<object, Scratch>();
function scratchOf(x: PCtx): Scratch {
  const n = x.p.count;
  let s = _scratch.get(x.p);
  if (!s || s.n !== n) {
    s = {
      n, g: new Float64Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n),
      gen: 0, last: null, lastKey: '', fg: new Float64Array(n), fstamp: new Uint32Array(n), fclosed: new Uint32Array(n), fgen: 0, memoTick: -1, memo: new Map(),
    };
    _scratch.set(x.p, s);
  }
  return s;
}
// the heap is transient (emptied at the start of each pass; a pass never yields): one for the process
let _hc = new Int32Array(1024), _hf = new Float64Array(1024), _hn = 0;

function push(c: number, f: number): void {
  if (_hn >= _hc.length) { const a = new Int32Array(_hc.length * 2); a.set(_hc); _hc = a; const b = new Float64Array(_hf.length * 2); b.set(_hf); _hf = b; }
  let i = _hn++;
  while (i > 0) {
    const pi = (i - 1) >> 1;
    if (_hf[pi] < f || (_hf[pi] === f && _hc[pi] < c)) break;
    _hc[i] = _hc[pi]; _hf[i] = _hf[pi]; i = pi;
  }
  _hc[i] = c; _hf[i] = f;
}
function pop(): number {
  const top = _hc[0];
  const c = _hc[--_hn], f = _hf[_hn];
  let i = 0;
  for (;;) {
    let m = i * 2 + 1;
    if (m >= _hn) break;
    if (m + 1 < _hn && (_hf[m + 1] < _hf[m] || (_hf[m + 1] === _hf[m] && _hc[m + 1] < _hc[m]))) m++;
    if (_hf[m] > f || (_hf[m] === f && _hc[m] > c)) break;
    _hc[i] = _hc[m]; _hf[i] = _hf[m]; i = m;
  }
  _hc[i] = c; _hf[i] = f;
  return top;
}

/** can the people of species `sp` drink at cell c now (planDrink's test: fresh or seeping water, rain pools, snow for
 * the cold, a well or cistern that still draws — a ruin's too)? */
export function drinkAt(x: PCtx, species: number, c: number): boolean {
  const p = x.p, f = p.f;
  if (f.water[c] >= 0.6 || f.fire[c] > FIRE_BURN) return false;
  if (drinkable(p, c)) return true;
  const g = p.grid;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (freshWater(p, g.nbr[e])) return true;
  if (x.info[species].def.habitat.includes('cold') && snowWater(p, c)) return true;
  const ids = x.ps.bByCell.get(c);
  for (let i = 0; i < ids.length; i++) {
    const b = x.ps.building(ids[i]);
    if (b && b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].provides.includes('water') && wellFlows(p, b.cell)) return true;
  }
  return false;
}

function optsOf(x: PCtx, st: Settlement): { swim: number; fly: boolean } {
  const o = pathOptsFor(x, st.species);
  const boat = bestBoat(x, st);
  if (boat >= 0) o.swim = Math.max(o.swim, boatSwim(x, boat));
  else if (o.swim < 1) o.swim = 0;
  return { swim: o.swim, fly: o.fly };
}

/**
 * The water band `st` can walk to from cell `from` within `budget` (walking cost); reachCost then gives the walk to any
 * reached cell. Cached for the tick (several callers in one band step).
 */
export function waterReach(x: PCtx, st: Settlement, from: number, budget = DAY_WALK): WaterReach {
  const S = scratchOf(x);
  // (the boat is in the key: a raft lashed as the band leaves changes what it can reach within the same tick)
  const o = optsOf(x, st);
  const key = `${st.id}:${from}:${budget}:${x.tick}:${o.swim}:${o.fly ? 1 : 0}`;
  if (S.last && S.lastKey === key) return S.last;
  const p = x.p, g = p.grid, geo = p.geo, R = p.st.radius;
  S.gen = (S.gen + 1) >>> 0;
  if (S.gen === 0) { S.stamp.fill(0); S.closed.fill(0); S.gen = 1; }
  const gen = S.gen;
  const _g = S.g, _stamp = S.stamp, _closed = S.closed;
  const water: number[] = [];
  _hn = 0;
  _stamp[from] = gen; _g[from] = 0; push(from, 0);
  while (_hn > 0) {
    const c = pop();
    if (_closed[c] === gen) continue;
    _closed[c] = gen;
    if (drinkAt(x, st.species, c)) water.push(c);
    const gc = _g[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const n = g.nbr[e];
      if (_closed[n] === gen) continue;
      const k = stepFactor(p, c, n, o.swim, o.fly);
      if (k === Infinity) continue;
      const ng = gc + geo.len[e] * R * k;
      if (ng > budget) continue;
      if (_stamp[n] !== gen || ng < _g[n]) { _stamp[n] = gen; _g[n] = ng; push(n, ng); }
    }
  }
  S.last = { from, water };
  S.lastKey = key;
  return S.last;
}

/** after waterReach (in world x): the walk from `from` to cell c (Infinity when not reached) */
export function reachCost(x: PCtx, c: number): number {
  const S = _scratch.get(x.p);
  return S && S.closed[c] === S.gen ? S.g[c] : Infinity;
}

/** water that lasts at cell c (fresh surface water at or beside it, a well that draws) — not a rain pool or wet ground */
export function lastingWater(x: PCtx, c: number): boolean {
  const p = x.p;
  if (p.f.water[c] >= 0.6) return false;
  if (freshWater(p, c)) return true;
  const g = p.grid;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (freshWater(p, g.nbr[e])) return true;
  const ids = x.ps.bByCell.get(c);
  for (let i = 0; i < ids.length; i++) {
    const b = x.ps.building(ids[i]);
    if (b && b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].provides.includes('water') && wellFlows(p, b.cell)) return true;
  }
  return false;
}

// ───────────────────────────── a thirsty body's water on foot ─────────────────────────────

/** the walk a thirsty body (water w) will risk to reach water: none at w >= 0.3, a day's walk at 0.3, two at 0 */
export function thirstBudget(w: number): number {
  if (w >= 0.3) return 0;
  return DAY_WALK * (1 + Math.min(1, (0.3 - w) / 0.3));
}
/** the farthest any thirst walks (thirstBudget at w 0) */
export const MAX_BUDGET = 2 * DAY_WALK;
/** townsfolk fetch water and dig near home (about 5 hours' walk out at most): striking out for distant water is the
 * village's decision (settlement.ts abandonCheck: the band walks). Day workers carry skins (decide.ts waterHere); in a
 * dried town, singles walking a day toward a far soak died on the way where the same folk on day trips lived. */
export const TOWN_WALK = 2 * WATER_NEAR;
/** a band member whose band has somewhere to go keeps to the band's road while their water is at least this */
export const ROAD_W = 0.05;
/** digging is worth this much walking: real water is preferred unless it is farther than a soak by more than this */
export const SOAK_EXTRA = 400;
/** ground water a hand-dug soak reaches (a well, dug deep, draws from aquifer > 0.02: world.ts wellFlows) */
const SOAK_AQ = 0.08, SOAK_MOIST = 0.3;
/** what one soak drink takes out of the ground (soil moisture, then the ground water under it); the climate step keeps
 * the loss and refills it with rain — one damp hollow gave 75-92 drinks a day before this draw-down */
const SOAK_DRAW_M = 0.006, SOAK_DRAW_A = 0.003;

/** ground water near the surface at cell c: a soak dug by hand fills (land, not salt, frozen, burning or under water) */
export function soakable(x: PCtx, c: number): boolean {
  const p = x.p, f = p.f;
  if (p.s.ocean[c] || f.water[c] >= 0.6 || f.salinity[c] > 0.35 || f.fire[c] > FIRE_BURN) return false;
  if (f.temperature[c] < p.st.liquid.freeze - 2) return false;
  return f.aquifer[c] > SOAK_AQ || f.moisture[c] > SOAK_MOIST;
}
/** what a soak at cell c gives: water need raised to this (the seep of an hour; drier ground gives less) */
export function soakGain(x: PCtx, c: number): number {
  const f = x.p.f;
  return Math.min(1, 0.45 + 2 * f.aquifer[c] + Math.max(0, f.moisture[c] - 0.15));
}
/** a soak drink draws the ground down (soil moisture and aquifer, floored at 0) */
export function soakDraw(x: PCtx, c: number): void {
  const f = x.p.f;
  f.moisture[c] = Math.max(0, f.moisture[c] - SOAK_DRAW_M);
  f.aquifer[c] = Math.max(0, f.aquifer[c] - SOAK_DRAW_A);
}

/** water in food (need-points of water per need-point of food) for a thirsty eater */
const MOIST: Record<string, number> = { berries: 0.35, apples: 0.35, olives: 0.1, roots: 0.25, potatoes: 0.25, meat: 0.12, fish: 0.15, milk: 0.6, beer: 0.5, eggs: 0.1, stew: 0.2 };
export function moistOf(id: string): number { return MOIST[id] ?? 0; }

function drinkAtCell(x: PCtx, melt: boolean, c: number): boolean {
  const p = x.p;
  if (p.f.water[c] >= 0.6 || p.f.fire[c] > FIRE_BURN) return false;
  if (drinkable(p, c)) return true;
  const g = p.grid;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (freshWater(p, g.nbr[e])) return true;
  return melt && snowWater(p, c);
}

/**
 * The nearest water (and soak, when `soak`) the people of `species` can walk to from cell `from` within `budget` walking
 * cost: a Dijkstra over route planning's step costs (cliffs and — for those who cannot swim well — the sea stop it), ties
 * by cell index. The search stops at the caller's budget (a dried town's every thirsty body searching two days' walk out
 * cost 56% of the sim at 3000x). One search serves every thirsty body in the same cell this tick (memo keyed by tick, not
 * hour: the fields it reads change within an hour, and a loaded copy starts with an empty memo); a search to a larger
 * budget answers a smaller one — callers compare costs with their own budget, and the nearest drink and soak within a
 * budget are the same whichever search found them, so what a body does never depends on who searched first.
 */
export function waterOnFoot(x: PCtx, species: number, from: number, soak: boolean, budget = MAX_BUDGET): WaterOnFoot {
  const S = scratchOf(x);
  if (S.memoTick !== x.tick) { S.memoTick = x.tick; S.memo.clear(); }
  const key = `${species}:${from}:${soak ? 1 : 0}`;
  const hit = S.memo.get(key);
  if (hit && hit.budget >= budget) return hit.r;
  const p = x.p, g = p.grid, geo = p.geo, R = p.st.radius;
  S.fgen = (S.fgen + 1) >>> 0;
  if (S.fgen === 0) { S.fstamp.fill(0); S.fclosed.fill(0); S.fgen = 1; }
  const gen = S.fgen, _g = S.fg, _stamp = S.fstamp, _closed = S.fclosed;
  const o = pathOptsFor(x, species);
  const swim = o.swim < 1 ? 0 : o.swim;
  const melt = x.info[species].def.habitat.includes('cold');
  const r: WaterOnFoot = { drink: -1, drinkCost: Infinity, soak: -1, soakCost: Infinity };
  _hn = 0;
  _stamp[from] = gen; _g[from] = 0; push(from, 0);
  while (_hn > 0) {
    const c = pop();
    if (_closed[c] === gen) continue;
    _closed[c] = gen;
    const gc = _g[c];
    if (drinkAtCell(x, melt, c)) { r.drink = c; r.drinkCost = gc; break; }
    if (soak && r.soak < 0 && soakable(x, c)) { r.soak = c; r.soakCost = gc; }
    // real water farther than the soak by more than the digging is worth: stop at the soak
    if (r.soak >= 0 && gc > r.soakCost + SOAK_EXTRA) break;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const n = g.nbr[e];
      if (_closed[n] === gen) continue;
      const k = stepFactor(p, c, n, swim, o.fly);
      if (k === Infinity) continue;
      const ng = gc + geo.len[e] * R * k;
      if (ng > budget) continue;
      if (_stamp[n] !== gen || ng < _g[n]) { _stamp[n] = gen; _g[n] = ng; push(n, ng); }
    }
  }
  S.memo.set(key, { r, budget });
  return r;
}
