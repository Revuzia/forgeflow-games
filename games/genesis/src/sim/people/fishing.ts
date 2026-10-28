// GENESIS — LIVING LAND (LIVING.md §2.3): fishing from real fish. Fish used to depend on water depth alone — a net in a
// puddle filled like a net at sea, and nothing a village took ever left the water (12 of 1 023 sessions in the census
// drew on a shoal at all).
//
// Now the catch comes from somewhere. A fish SHOAL (a herd of fish: life/herds.ts) within two cells of the water fished
// fills the nets by its numbers, and each fish caught is a fish gone from it. Rivers and lakes without a shoal hold their
// own RESIDENT STOCK, one per water body (LandWorld.stocks, keyed by the body's lowest cell, found by a flood fill of the
// water from the fished cell and kept for that cell): a carrying capacity by the body's size (STOCK_PER_CELL, more at
// sea), growing back logistically (half the way back to full in ~0.5 game year: r = 4.8 a year). OVERFISHING: below 30 %
// of its capacity a stock gives less to each session (in proportion), and at 10 % the chronicle tells that the fish
// have left those waters (once, until they come back past half). Fishers pass over a water fished out when another is
// near. Shellfish beds (a herd whose products are shellfish) are gathered at the shore; a whale is taken only by a
// people with boats and harpoons. The books keep sessions and catch by source.

import type { PCtx } from './ctx.ts';
import type { Herd, Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import { hashFloat } from '../core/rng.ts';
import { NS, SKILL, TASK } from './defs.ts';
import { animalDef } from '../life/herds.ts';
import { availability, itemIdx } from './resources.ts';
import { libHas, libraryEffect } from './knowledge.ts';
import { storeAdd, storeAny } from './store.ts';
import { practise } from './lifecycle.ts';
import { spotInCell } from './world.ts';
import { tell } from './story.ts';
import { settlementRef, vars } from './util.ts';
import { addFood, ledger, landWorld, type FishStock } from './ledger.ts';
import { FOOD_YIELD, foodSessionDone } from '../perf/pace.ts';
import { FOOD_SESSION } from './decide.ts';
import { bestBoat } from './missions.ts';
import { carcass } from './hunt.ts';
import { sacredAnimal } from './culture.ts';

/** units of fish a cell of a river or lake holds at its carrying capacity per metre of depth (½-4 m counted; more at sea) */
export const STOCK_PER_CELL = 12, SEA_PER_CELL = 30;
/** the logistic growth of a stock, per game year (half the way back in ~0.5 year from a tenth of capacity) */
export const STOCK_R = 4.8;
/** a stock below this share of its capacity gives less to each session; below FISHED_OUT the fish have left */
export const THIN = 0.3, FISHED_OUT = 0.1;
/** the largest water body a flood fill follows (cells): beyond it the water is as good as endless */
const BODY_MAX = 400;

const _stack: number[] = [];
const _seen = new Set<number>();

/** water deeper than this joins one body (shallows and marsh between pools keep a lake one lake as its level moves) */
const BODY_WATER = 0.1;

/** the water body of cell c: its id (lowest cell found), its size in cells, the fish it holds at capacity (by the depth
 * of its cells: deep water holds more), and whether it is the sea */
function findBody(x: PCtx, c: number): { id: number; n: number; K: number; sea: boolean } {
  const p = x.p, f = p.f, g = p.grid;
  _seen.clear();
  _stack.length = 0;
  _stack.push(c);
  _seen.add(c);
  let id = c, sea = false, K = 0;
  while (_stack.length && _seen.size < BODY_MAX) {
    const o = _stack.pop()!;
    if (o < id) id = o;
    if (p.s.ocean[o]) sea = true;
    K += Math.max(0.5, Math.min(4, f.water[o]));
    for (let e = g.nbrStart[o]; e < g.nbrStart[o + 1]; e++) {
      const q = g.nbr[e];
      if (_seen.has(q) || f.water[q] <= BODY_WATER) continue;
      _seen.add(q);
      _stack.push(q);
    }
  }
  // (cells found but not yet visited when the search stopped: as deep as the average)
  const n = _seen.size, visited = n - _stack.length;
  K *= n / Math.max(1, visited);
  return { id, n, K: Math.round(K * (sea ? SEA_PER_CELL : STOCK_PER_CELL) * 10) / 10, sea };
}

/** the fish stock of the water at cell c (made the first time it is fished), brought up to date (logistic growth) */
export function stockAt(x: PCtx, c: number): FishStock {
  const W = landWorld(x.ps);
  let id = W.body[String(c)];
  if (id === undefined) {
    const b = findBody(x, c);
    id = b.id;
    W.body[String(c)] = id;
    if (!W.stocks[String(id)]) W.stocks[String(id)] = { K: b.K, S: b.K, t: x.tick, n: b.n, gone: -1 };
  }
  const st = W.stocks[String(id)];
  grow(x, st);
  return st.S < st.K * THIN_FISHER ? rebody(x, c, id, st) : st;
}

/**
 * LIVING integration (2026-10-20): a water fished out is looked at again — it may have grown since it was first fished
 * (a crater pond filled to a lake, a puddle joined to the river). The body is kept per cell from its first session, and
 * on seed 1234 of the acceptance run a pond met at 1.1 m deep (capacity 13 fish) stood 14 m deep a year later with its
 * capacity still 13: the town fished it to nothing and its band of 25 kept at it until 19 starved. Grown in place, the
 * new water brings its fish (the deficit fished out is kept); joined to a larger water, the cell is that water's (a
 * known stock, or a new one short by what was fished here). A water that only shrank keeps its stock, as before.
 */
function rebody(x: PCtx, c: number, id: number, s: FishStock): FishStock {
  const b = findBody(x, c);
  if (b.id === id) {
    if (b.K > s.K) { s.S = Math.round((s.S + b.K - s.K) * 1000) / 1000; s.K = b.K; s.n = Math.max(s.n, b.n); }
    return s;
  }
  if (b.n <= s.n) return s;
  const W = landWorld(x.ps);
  W.body[String(c)] = b.id;
  let ns = W.stocks[String(b.id)];
  if (!ns) {
    ns = { K: b.K, S: Math.round(Math.max(b.K * 0.005, b.K - (s.K - s.S)) * 1000) / 1000, t: x.tick, n: b.n, gone: -1 };
    W.stocks[String(b.id)] = ns;
  } else grow(x, ns);
  return ns;
}
/** the share of its capacity under which a fisher passes a water over (and its body is looked at again) */
const THIN_FISHER = 0.15;

/** bring a stock's numbers up to now (exact logistic solution over the elapsed time) */
function grow(x: PCtx, s: FishStock): void {
  const dt = x.tick - s.t;
  s.t = x.tick;
  if (dt <= 0 || s.S >= s.K) return;
  const S0 = Math.max(s.K * 0.005, s.S);
  const e = Math.exp((-STOCK_R * dt) / x.year);
  s.S = Math.round(((s.K * S0) / (S0 + (s.K - S0) * e)) * 1000) / 1000;
}

/** how much of a full catch a stock gives a session (1 at 30 % of capacity and above, in proportion below) */
export function stockFactor(s: FishStock): number {
  const r = s.S / Math.max(1e-6, s.K);
  return r >= THIN ? 1 : Math.max(0, r / THIN);
}

/** the shoal within two cells of the water fished (the largest), or null — whales only for those who can take them */
function shoalNear(x: PCtx, st: Settlement | undefined, c: number): Herd | null {
  const P = x.p.grid.pos;
  const reach = Math.cos((2 * x.p.edgeM) / x.p.st.radius);
  let best: Herd | null = null;
  let whaler: boolean | undefined;
  for (const h of x.ps.herds) {
    if (h.count < 1 || h.owner >= 0) continue;
    const a = animalDef(x, h.species);
    if (a.kind !== 'fish' && !a.products.some((io) => io.item === 'shellfish')) continue;
    // (fix r3 #18, LIVING §3.4.7) a people never nets, rakes or harpoons the animal it reveres (the whale, the shellfish)
    if (sacredAnimal(x, st, h.species)) continue;
    const d = P[h.cell * 3] * P[c * 3] + P[h.cell * 3 + 1] * P[c * 3 + 1] + P[h.cell * 3 + 2] * P[c * 3 + 2];
    if (d < reach) continue;
    if (a.size >= 5) {
      whaler ??= !!st && bestBoat(x, st) >= 0 && storeAny(st, x.c.itemsByTag.get('harpoon') ?? []) >= 1;
      if (!whaler) continue;
    }
    if (!best || h.count * (a.mass ?? 2) > best.count * (animalDef(x, best.species).mass ?? 2)) best = h;
  }
  return best;
}

/**
 * The fisher's water (decide.ts planFish): one of the settlement's best fishing cells, passing over waters fished out
 * when another is near; a people without a settlement fishes the nearest water.
 */
export function fishTask(x: PCtx, s: number, st: Settlement | undefined, nearest: (rings: number, pred: (c: number) => boolean) => number): TaskSpec | null {
  const A = x.A;
  const k = x.rt.byId.get('fishing') ?? -1;
  const knows = st ? libHas(st, k) : A.knows(s, k);
  if (!knows) return null;
  // (fix r3 #18) where the fish themselves are sacred, nobody fishes: the fisher gathers, farms or herds instead
  if (st && st.culture.sacred.includes('animal:fish-shoal')) return null;
  const p = x.p;
  let c = -1;
  if (st && st.res && st.res.fish.length) {
    const n = Math.min(3, st.res.fish.length);
    const pick = Math.floor(hashFloat(A.id[s], x.tick, 0xf15) * n);
    c = st.res.fish[pick];
    // fished out here: the next of the settlement's waters that is not (stocks it has met before) — and when every one
    // is, no fishing: the fisher gathers instead (LIVING integration, 2026-10-20: the nets went on into a water fished to
    // nothing, a town's fishers and then its whole hungry band, while food grew on land)
    if (thin(x, c)) {
      let o2 = -1;
      for (const o of st.res.fish) if (o !== c && !thin(x, o)) { o2 = o; break; }
      c = o2;
    }
  } else c = nearest(4, (o) => p.f.water[o] > 0.3 && !thin(x, o));
  if (c < 0) return null;
  // stand on the bank unless a swimmer
  const sp = x.info[A.species[s]].def;
  let stand = c;
  if (sp.swim < 1 && p.f.water[c] > 0.6) {
    const g = p.grid;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (p.f.water[g.nbr[e]] < 0.4) { stand = g.nbr[e]; break; }
  }
  return { kind: TASK.fish, goal: spotInCell(p, stand, A.id[s], 29, [0, 0, 0]), goalCell: stand, work: 180, target: c };
}

/** a water already known to be fished out (no flood fill for a water never fished) */
function thin(x: PCtx, c: number): boolean {
  const W = x.ps.land;
  if (!W) return false;
  const id = W.body[String(c)];
  if (id === undefined) return false;
  const s = W.stocks[String(id)];
  if (!s) return false;
  grow(x, s);
  if (s.S >= s.K * THIN_FISHER) return false;
  // (fished out as first found: the water may have grown since — stockAt looks again)
  const now = stockAt(x, c);
  return now.S < now.K * THIN_FISHER;
}

/**
 * The end of a fishing session (work.ts, TASK.fish): the catch, from a shoal near the water or the water's own stock,
 * by the water there, the fisher's skill and gear, what the settlement knows; it is taken from the shoal or the stock.
 * `toolF` is the fisher's gear (work.ts toolFactor), `near` whether the water meant is in reach (else where they stand).
 */
export function fishWork(x: PCtx, s: number, st: Settlement | undefined, toolF: number, near: (a: number, b: number) => boolean): void {
  const A = x.A;
  let target = A.tTarget[s] >= 0 ? A.tTarget[s] : A.cell[s];
  if (target !== A.cell[s] && !near(A.cell[s], target)) target = A.cell[s];
  const it = itemIdx(x, 'fish');
  const av = availability(x, it, target);
  const row = st ? ledger(x, st) : null;
  foodSessionDone(x, s); // (LIVING PACE)
  practise(x, s, SKILL.fish, 0.015);
  if (av <= 0) { if (row) row.fishing.none++; return; }
  const sp = x.info[A.species[s]].def;
  const perUnit = x.c.items.list[it]?.food || 0.5;
  const base = (FOOD_SESSION.fish / perUnit) * av * (0.55 + 1.1 * A.skills[s * NS + SKILL.fish]) * toolF * (st ? libraryEffect(x, st, 'yield.fish') : 1) * (sp.swim >= 1 ? 1.3 : 1) * FOOD_YIELD;
  const shoal = shoalNear(x, st, target);
  if (shoal) {
    const a = animalDef(x, shoal.species);
    if (a.size >= 5) {
      // a whale: a long day's chase in boats, rarely won — the whole beast when it is
      if (hashFloat(A.id[s], shoal.id, x.tick, 0xf17) >= 0.08 || !st) { if (row) row.fishing.shoal++; return; }
      shoal.count = Math.max(0, shoal.count - 1);
      for (const g of carcass(a)) {
        const gi = x.c.items.idx(g.item);
        if (gi < 0) continue;
        storeAdd(x, st, gi, g.qty);
        if (g.item === 'meat') addFood(x, st, 'fish', gi, g.qty);
      }
      if (row) { row.fishing.shoal++; row.catch.shoal = Math.round((row.catch.shoal + 1) * 1000) / 1000; }
      return;
    }
    // a shoal fills the nets by its numbers; shellfish are gathered at the shore
    const what = a.products.find((io) => io.item === 'shellfish') ? x.c.items.idx('shellfish') : it;
    const per = Math.max(0.1, a.products.find((io) => !!io.item && x.c.items.idx(io.item) === what)?.qty ?? 1);
    const k = Math.max(0.6, Math.min(1.6, 0.6 + shoal.count / 80));
    let units = Math.round(base * k * 100) / 100;
    units = Math.min(units, shoal.count * per);
    shoal.count = Math.max(0, Math.round((shoal.count - units / per) * 1000) / 1000);
    give(x, s, st, what < 0 ? it : what, units);
    if (row) { row.fishing.shoal++; row.catch.shoal = Math.round((row.catch.shoal + units) * 1000) / 1000; }
    return;
  }
  // the water's own stock
  const stock = stockAt(x, target);
  let units = Math.round(base * stockFactor(stock) * 100) / 100;
  units = Math.min(units, Math.max(0, stock.S - stock.K * 0.005));
  stock.S = Math.round((stock.S - units) * 1000) / 1000;
  give(x, s, st, it, units);
  if (row) { row.fishing.stock++; row.catch.stock = Math.round((row.catch.stock + units) * 1000) / 1000; }
  // overfished: the chronicle tells it once (until the fish come back past half)
  if (stock.gone < 0 && stock.S < stock.K * FISHED_OUT && st) {
    stock.gone = x.tick;
    tell(x.u, x.p, 'fish.gone', vars(x, st, s), st, [settlementRef(x, st)], 1);
  } else if (stock.gone >= 0 && stock.S > stock.K * 0.5) stock.gone = -1;
}

function give(x: PCtx, s: number, st: Settlement | undefined, it: number, units: number): void {
  if (units <= 0) return;
  const left = x.A.give(s, it, units);
  if (left > 0 && st && !st.band) storeAdd(x, st, it, left);
  if (st) addFood(x, st, 'fish', it, units);
}

/** a stock's state for tests and views: capacity, stock, share */
export function stockInfo(x: PCtx, c: number): { K: number; S: number; share: number } {
  const s = stockAt(x, c);
  return { K: s.K, S: s.S, share: Math.round((s.S / Math.max(1e-6, s.K)) * 1000) / 1000 };
}

