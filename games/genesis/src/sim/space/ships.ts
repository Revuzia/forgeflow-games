// GENESIS — ships: why a people leaves, what it must know and have, and the work of getting a ship off the ground
// (CONTRACT.md §12).
//
//   chain       a ship kind (ships.json) is a recipe chain: EVERY id in its `knowledge` must be in the settlement's
//               library, its pad building must stand complete in its lands, its hull item (made by its own crafters
//               from that recipe's inputs — a rocket from engines, steel, guidance and fuel) and its fuel must be in the
//               store. No chain, no launch, ever: not even when the god pushes (the god can teach and give instead).
//   seeing      a people that knows astronomy sees the other worlds as wandering lights (level 1); with telescopes it
//               sees their seas, air and green (2); with telescopes and radio, or an orbiter of its own, it sees their
//               peoples (3). Targets are chosen from what it has seen.
//   why         daily per settlement that knows a chain: overcrowding, persecution (a besieged or subject town, a faith
//               apart), curiosity (unvisited worlds in its sky), trade (a peopled world seen, a market at home), a dying
//               world (air it cannot breathe, cold or heat past bearing, a falling moon, a cracked world), or the god's
//               push. The strongest reason, if strong enough, starts a program.
//   program     'building'  the pad is raised if missing (the construction system's builders, and the ground crew haul
//                           and build on its site), the hull is crafted at the pad by the ground crew who know how (the
//                           real crafting code, a novice can spoil the batch); missing parts are crafted where they can
//                           be, and the job list asks the town's crafters for them
//               'fuelling'  fuel, food for the crossing and the goods of the voyage are loaded while the ground crew work
//                           at the pad
//               'boarding'  the crew (by purpose: whole households for a colony, everyone for an exodus, the bold and
//                           skilled for a visit) walk to the pad; the ship goes with whoever is there at the countdown,
//                           a family together or not at all
//               'pad'       the countdown; then the crew are lifted out of the world (crew.ts) and the flight begins (an
//                           uncrewed orbiter goes straight from fuelling to its countdown)
//   set aside   from the hour a program starts, the hull's parts and then the flight's fuel are taken out of the store
//               into the ship's own stock as they come in (`sh.stock`): a town's builders and smiths spent the steel of
//               a half-made rocket on a power plant and steel tools, and its hull never rose. A part the ground crew
//               craft may draw on that stock (a rocket engine is made of the hull's steel). Given up, it all goes back.
//   patience    a program lives as long as it gets somewhere — the pad rising, parts set aside, the hull worked, fuel
//               coming in — and is given up after STALL_DAYS without progress (a star gate's ring takes weeks to raise;
//               a fixed limit dropped every gate and most airships)
// Agents are steered through the decisions hook (people/hooks.ts `crew`): a crew or ground-crew member carries
// mission id −(ship id), which every peoples system already treats as "busy elsewhere". They camp at the pad: they
// sleep beside it and carry a day's food from the store, so their hours go into the ship, not the walk home.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { ShipKindDef } from '../content.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Building, Settlement } from '../people/state.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { Purpose, ShipState, V3 } from './state.ts';
import { stKey } from './state.ts';
import { AgentFlag } from '../types.ts';
import { ERAS } from '../content.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { NEED, NN, NS, NT, SKILL, TASK, TRAIT } from '../people/defs.ts';
import { storeAdd, storeAny, storeHas, storeTake, foodDays, bestFood } from '../people/store.ts';
import { cohortTotal, promote } from '../people/cohorts.ts';
import { planBuilding } from '../people/buildings.ts';
import { placeFor } from '../people/context.ts';
import { inputsAvailable, toolsAvailable, isNight } from '../people/decide.ts';
import { hasMarket } from '../people/economy.ts';
import { distM, offsetPoint, spotInCell, cellPos, isLand, drinkable as drinkableAt, snowWater } from '../people/world.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars } from '../people/util.ts';
import { storePoint } from '../people/tasks.ts';
import { phonologyOf, word } from '../people/names.ts';
import { schedule } from '../people/sched.ts';
import { bestSiteOnPlanet } from '../people/spawn.ts';
import { siteScore } from '../people/settlement.ts';
import { breathable, suitItems } from './habitat.ts';
import { craft } from '../recipes/crafting.ts';
import { addCargo, kindName } from './crew.ts';

/** a program is judged hourly; a settlement's reasons daily */
export const PROGRAM_CADENCE = 60;
/** days a program may go without getting anywhere before its people give up; and the most it may take at all */
const STALL_DAYS = 12;
const MAX_DAYS = 160;
/** days of waiting for the fuel; a voyage home that has fuel one way goes then only to a world its people can live on */
const FUEL_DAYS = 20;
/** hours the crew have to reach the pad */
const BOARD_HOURS = 24;
/** days before a settlement that launched (or gave up) starts again */
const COOLDOWN_DAYS = 12;

// ───────────────────────────── the chain ─────────────────────────────

/** the complete, standing pad building of this kind in a settlement's lands (null none) */
export function standingPad(x: PCtx, st: Settlement, def: ShipKindDef): Building | null {
  const t = x.c.buildings.idx(def.pad);
  if (t < 0) return null;
  let best: Building | null = null, bd = Infinity;
  for (const b of x.ps.of(st.id)) {
    if (b.type !== t || b.progress < 1 || b.flags & 2 || b.damage >= 0.7) continue;
    const d = distM(x.p, b.pos, st.pos);
    if (d < bd || (d === bd && best && b.id < best.id)) { bd = d; best = b; }
  }
  return best;
}

/** knowledge of the chain the settlement lacks (recipe ids) */
export function missingKnowledge(x: PCtx, st: Settlement, def: ShipKindDef): string[] {
  const out: string[] = [];
  for (const id of def.knowledge) {
    const k = x.rt.byId.get(id);
    if (k === undefined || !st.library.includes(k)) out.push(id);
  }
  return out;
}

/** the hull's crafting recipe this settlement knows (-1 none) */
export function hullRecipe(x: PCtx, st: Settlement, def: ShipKindDef): number {
  if (!def.hull) return -1;
  const it = x.c.items.idx(def.hull);
  if (it < 0) return -1;
  for (const k of x.rt.producers[it] ?? []) if (st.library.includes(k)) return k;
  return -1;
}

/**
 * Everything still standing between a settlement and a launch of this kind, in words a player can act on (empty: it
 * could go now). `stage`: 'program' asks only for the knowledge (a program may raise the pad and build the hull);
 * 'launch' asks for all of it.
 */
export function chainGaps(x: PCtx, st: Settlement, def: ShipKindDef, stage: 'program' | 'launch'): string[] {
  const gaps: string[] = [];
  const miss = missingKnowledge(x, st, def);
  if (miss.length) gaps.push(`they do not know ${miss.map((id) => x.c.recipes.find(id)?.name.toLowerCase() ?? id).join(', ')}`);
  if (stage === 'program') return gaps;
  if (!standingPad(x, st, def)) gaps.push(`they have no ${x.c.buildings.find(def.pad)?.name.toLowerCase() ?? def.pad}`);
  // what a program of theirs has already set aside at the pad counts as theirs (it is no longer in the store)
  const mine = x.u.space.ships.filter((sh) => sh.home === x.p.id && sh.owner === st.id && sh.kind === def.id && (sh.phase === 'building' || sh.phase === 'fuelling'));
  if (def.hull) {
    const it = x.c.items.idx(def.hull);
    if (it < 0 || (storeHas(st, it) < 1 && !mine.some((sh) => sh.hull === it))) gaps.push(`there is no ${x.c.items.find(def.hull)?.name.toLowerCase() ?? def.hull} in their store`);
  }
  for (const io of def.fuel) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    const set = it < 0 ? 0 : mine.reduce((q, sh) => q + stockOf(sh, [it]) + sh.fuelBack.reduce((f, [i, n]) => f + (i === it ? n : 0), 0), 0);
    if (it < 0 || storeHas(st, it) + set < io.qty) gaps.push(`they lack ${io.qty} ${x.c.items.find(io.item ?? '')?.name.toLowerCase() ?? io.item}`);
  }
  return gaps;
}

// ───────────────────────────── the goods set aside ─────────────────────────────

/** "a" or "an" before a noun */
export function article(noun: string): string {
  return /^[aeiou]/i.test(noun) && !/^(eu|uni|one)/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** does the voyage mean to come home (fuel both ways): a visit, or any airship */
export function roundTrip(sh: ShipState, def: ShipKindDef): boolean {
  return def.returns && (sh.purpose === 'trade' || sh.purpose === 'curiosity' || sh.purpose === 'god' || def.class === 'air');
}

/** how much of any of these items the ship has set aside */
export function stockOf(sh: ShipState, items: readonly number[]): number {
  let q = 0;
  for (const [it, n] of sh.stock) if (items.includes(it)) q += n;
  return q;
}

function stockAdd(sh: ShipState, it: number, q: number): void {
  if (q <= 0 || it < 0) return;
  for (const e of sh.stock) if (e[0] === it) { e[1] = Math.round((e[1] + q) * 1000) / 1000; return; }
  sh.stock.push([it, Math.round(q * 1000) / 1000]);
  sh.stock.sort((a, b) => a[0] - b[0]);
}

/** take up to q of any of these items out of the ship's stock (first listed first); returns [item, qty] taken */
function stockTake(sh: ShipState, items: readonly number[], q: number): [number, number][] {
  const out: [number, number][] = [];
  let left = q;
  for (const it of items) {
    if (left <= 1e-9) break;
    const e = sh.stock.find((s) => s[0] === it);
    if (!e) continue;
    const got = Math.min(e[1], left);
    e[1] = Math.round((e[1] - got) * 1000) / 1000;
    left -= got;
    out.push([it, got]);
  }
  sh.stock = sh.stock.filter((e) => e[1] > 1e-6);
  return out;
}

/** everything set aside goes back into the store */
function unstock(x: PCtx, st: Settlement, sh: ShipState): void {
  for (const [it, q] of sh.stock) storeAdd(x, st, it, q);
  sh.stock = [];
}

/** is the flight's fuel loaded (past the building, and in fuelling once it is aboard) */
function loaded(sh: ShipState): boolean {
  return sh.phase !== 'building' && (sh.phase !== 'fuelling' || sh.work > 0);
}

/**
 * What the program sets aside now ([acceptable items, qty]): the hull's parts until it is made; the flight's fuel (both
 * ways for a voyage home) once the parts are all in — a part may need the same goods to be made (an engine burns
 * rocket fuel on its test stand), and a stock that held them back would never let the hull be finished.
 */
function wants(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): { items: number[]; qty: number }[] {
  const out: { items: number[]; qty: number }[] = [];
  const add = (items: readonly number[], qty: number) => {
    const ex = out.find((w) => w.items.length === items.length && w.items.every((v, i) => v === items[i]));
    if (ex) ex.qty += qty; else out.push({ items: items.slice(), qty });
  };
  let partsIn = true;
  const hullItem = def.hull ? x.c.items.idx(def.hull) : -1;
  if (sh.phase === 'building' && hullItem >= 0 && sh.hull < 0) {
    const k = hullRecipe(x, st, def);
    if (k >= 0) for (const io of x.rt.list[k].inputs) { add(io.items, io.qty); if (stockOf(sh, io.items) < io.qty) partsIn = false; }
    else partsIn = false;
  }
  if (partsIn && !loaded(sh)) {
    const mult = roundTrip(sh, def) ? 2 : 1;
    for (const io of def.fuel) { const it = io.item ? x.c.items.idx(io.item) : -1; if (it >= 0) add([it], io.qty * mult); }
  }
  return out;
}

/** take what the program still lacks out of the store into the ship's stock; returns the units taken */
export function reserve(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): number {
  let took = 0;
  const ws = wants(x, st, sh, def);
  // what is no longer wanted (the hull is made, a part used other goods) goes back into the store
  for (const [it, q] of sh.stock.slice()) {
    let cap = 0;
    for (const w of ws) if (w.items.includes(it)) cap += w.qty;
    if (q > cap + 1e-6) for (const [i, n] of stockTake(sh, [it], q - cap)) storeAdd(x, st, i, n);
  }
  for (const w of ws) {
    let short = w.qty - stockOf(sh, w.items);
    for (const it of w.items) {
      if (short <= 1e-9) break;
      const got = storeTake(st, it, Math.min(short, storeHas(st, it)));
      if (got > 0) { stockAdd(sh, it, got); short -= got; took += got; }
    }
  }
  return took;
}

/** put back into the store what recipe k needs and the store lacks, from the ship's stock (a part of the hull's own goods) */
function release(x: PCtx, st: Settlement, sh: ShipState, k: number): void {
  for (const io of x.rt.list[k].inputs) {
    const short = io.qty - storeAny(st, io.items);
    if (short <= 0) continue;
    for (const [it, q] of stockTake(sh, io.items, short)) storeAdd(x, st, it, q);
  }
}

/** are recipe k's inputs in the store and the ship's stock together */
function inputsWithStock(x: PCtx, st: Settlement, sh: ShipState, k: number): boolean {
  for (const io of x.rt.list[k].inputs) if (storeAny(st, io.items) + stockOf(sh, io.items) < io.qty) return false;
  return true;
}

/** how far the program has got (a number that only grows while it gets anywhere) */
function progressOf(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): number {
  const t = x.c.buildings.idx(def.pad);
  let pad = 0;
  for (const b of x.ps.of(st.id)) if (b.type === t && !(b.flags & 2)) pad = Math.max(pad, b.progress + b.delivered / Math.max(1, x.c.buildings.list[t].cost) * 0.25);
  let units = 0;
  for (const [, q] of sh.stock) units += q;
  for (const [, q] of sh.fuelBack) units += q;
  return Math.round((pad * 10 + sh.work * 5 + units * 0.05 + (sh.hull >= 0 ? 20 : 0)) * 10000) / 10000;
}

/** note progress; true when the program has stalled past bearing (or run past the longest a people would try) */
function stalled(u: Universe, x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): boolean {
  const v = progressOf(x, st, sh, def);
  if (v > sh.mark + 1e-4) { sh.mark = v; sh.markAt = u.tick; }
  return u.tick - sh.markAt > STALL_DAYS * x.day || u.tick - sh.created > MAX_DAYS * x.day;
}

/** a new phase: progress is reckoned from here */
function phaseTo(u: Universe, x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef, phase: ShipState['phase']): void {
  sh.phase = phase;
  sh.t0 = u.tick;
  sh.markAt = u.tick;
  sh.mark = progressOf(x, st, sh, def);
}

// ───────────────────────────── seeing the other worlds ─────────────────────────────

const knows = (x: PCtx, st: Settlement, id: string) => { const k = x.rt.byId.get(id); return k !== undefined && st.library.includes(k); };

/** how well a settlement sees the other worlds (0 not at all .. 3 their peoples) */
export function sightLevel(u: Universe, x: PCtx, st: Settlement): number {
  if (!knows(x, st, 'astronomy')) return 0;
  const scope = knows(x, st, 'telescopes') || storeHas(st, x.c.items.idx('telescope')) >= 1;
  if (!scope) return 1;
  // an orbiter of its own circling overhead sees everything
  for (const sh of u.space.ships) if (sh.owner === st.id && sh.home === x.p.id && sh.phase === 'orbit' && u.content.ships.find(sh.kind)?.class === 'orbit') return 3;
  return knows(x, st, 'radio') ? 3 : 2;
}

/** a world in words, as instruments of that level see it */
export function describeWorld(u: Universe, q: Planet, level: number): string {
  const kind = u.content.planetkinds.find(q.st.kind);
  if (level <= 1) return 'a wandering light';
  const air = q.st.atmosphere.pressure >= 0.02;
  const sea = q.hydro.oceanCells > q.count * 0.05;
  const green = q.vegTotal > q.count * 0.05;
  const ice = q.st.kind === 'ice' || q.st.kind === 'methane';
  const parts: string[] = [];
  if (!air) parts.push('a dead rock without air');
  else if (q.st.kind === 'methane') parts.push('a world wrapped in orange haze over cold seas');
  else if (ice) parts.push('a world of ice');
  else if (sea && green) parts.push('a blue world of seas and cloud, green on its land');
  else if (sea) parts.push('a world of seas and cloud');
  else if (green) parts.push('a green world');
  else parts.push(`a ${kind ? kind.name.toLowerCase() : 'strange'} world`);
  if (level >= 3) {
    const n = (q.people?.settlements ?? []).filter((s) => s.fallen < 0).length;
    if (n) parts.push(n === 1 ? 'with lights of one people on it' : `with the lights of ${n} towns on it`);
  }
  return parts.join(', ');
}

/** daily: a settlement looks at the sky; what it sees now it remembers (a better instrument is chronicled) */
export function observe(u: Universe, x: PCtx, st: Settlement): void {
  const lvl = sightLevel(u, x, st);
  const key = stKey(x.p.id, st.id);
  if (lvl <= 0) return;
  const o = (u.space.observed[key] ??= {});
  for (const q of u.planets) {
    if (!q.alive || q.id === x.p.id) continue;
    const before = o[String(q.id)] ?? 0;
    // a moon of their own world is seen without instruments; worlds they have stood on are known
    const visited = u.space.ships.some((sh) => sh.owner === st.id && sh.home === x.p.id && sh.visits.includes(q.id));
    const now = Math.max(lvl, visited ? 3 : 0, q.st.orbit.parent === x.p.id ? Math.max(lvl, 2) : 0);
    if (now <= before) continue;
    o[String(q.id)] = now;
    if (now >= 2 && before < 2) {
      tell(u, x.p, 'space.observe', vars(x, st, -1, { planet: q.name, desc: describeWorld(u, q, now) }), st, [settlementRef(x, st), { kind: 'planet', id: q.id, planet: q.id }]);
    }
  }
}

// ───────────────────────────── why they go ─────────────────────────────

/** a settlement's adults (individuals), their traits' means */
function meanTrait(x: PCtx, st: Settlement, t: number): number {
  const A = x.A;
  let s = 0, n = 0;
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.flags[m] & AgentFlag.child) continue;
    s += A.traits[m * NT + t];
    n++;
  }
  return n ? s / n : x.info[st.species].def.traits[(['curiosity', 'boldness', 'sociability', 'piety', 'aggression', 'diligence'] as const)[t]] ?? 0.5;
}

/** how deadly its own world has become for this people (0 fine .. 1 leave or die) */
export function doom(u: Universe, x: PCtx, st: Settlement): number {
  const p = x.p;
  const sp = x.info[st.species].def;
  let d = 0;
  if (!breathable(sp, p.st.atmosphere)) d = 1;
  const t = p.s.tempYear[st.cell] || p.f.temperature[st.cell];
  const [tMin, lo, hi, tMax] = sp.temp;
  if (t < lo) d = Math.max(d, Math.min(1, (lo - t) / Math.max(1, lo - tMin)) * 0.95);
  if (t > hi) d = Math.max(d, Math.min(1, (t - hi) / Math.max(1, tMax - hi)) * 0.95);
  if (p.f.radiation[st.cell] > 0.25) d = Math.max(d, Math.min(1, p.f.radiation[st.cell]));
  for (const ds of u.god.disasters) if (ds.planet === p.id && (ds.kind === 'moon-fall' || ds.kind === 'rogue-flyby' || ds.kind === 'supervolcano')) d = Math.max(d, 0.9);
  if (p.firsts.cracked !== undefined && u.tick - p.firsts.cracked < x.year) d = Math.max(d, 0.7);
  if ((st.recent.thermalDead ?? 0) >= 4 && u.tick - (st.recent.thermalAt ?? -1e9) < 10 * x.day) d = Math.max(d, 0.6);
  return d;
}

/** the reasons a settlement has to leave, 0..1 each */
export function motives(u: Universe, x: PCtx, st: Settlement): Record<string, number> {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length + cohortTotal(st);
  let beds = 0;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && !(b.flags & 2)) beds += x.c.buildings.list[b.type].capacity;
  const crowd = Math.max(0, Math.min(1, (pop / Math.max(4, beds) - 1.05) * 2 + (pop > 40 && foodDays(x, st) / Math.max(1, pop) < 1.5 ? 0.3 : 0)));
  // persecution: under siege, a subject town, or a faith apart from its neighbours'
  let persecution = st.besieged >= 0 ? 0.7 : 0;
  const pol = x.ps.polity(st.polity);
  if (pol && pol.overlord >= 0) persecution = Math.max(persecution, 0.35);
  if (st.god >= 0 && u.god.gods.some((g) => g.kind === 'rival' && g.alive)) {
    const others = x.ps.settlements.filter((o) => o.id !== st.id && o.fallen < 0 && !o.band);
    const apart = others.filter((o) => o.god >= 0 && o.god !== st.god).length;
    if (others.length && apart / others.length > 0.6) persecution = Math.max(persecution, 0.45);
  }
  // curiosity: worlds seen and never stood on
  const seen = u.space.observed[stKey(x.p.id, st.id)] ?? {};
  let unvisited = 0, peopled = 0;
  for (const [pid, lvl] of Object.entries(seen)) {
    const q = u.planet(Number(pid));
    if (!q || !q.alive || lvl < 1) continue;
    const visited = u.space.ships.some((sh) => sh.owner === st.id && sh.home === x.p.id && sh.visits.includes(q.id));
    if (!visited) unvisited++;
    if (lvl >= 3 && (q.people?.settlements ?? []).some((o) => o.fallen < 0 && !o.band)) peopled++;
  }
  const cur = meanTrait(x, st, TRAIT.curiosity);
  const curiosity = unvisited ? 0.3 + 0.5 * cur : 0;
  const soc = meanTrait(x, st, TRAIT.sociability);
  let trade = peopled && hasMarket(x, st) ? 0.3 + 0.35 * soc : 0;
  // a road between the worlds that has paid: the trade runs become regular
  if (tradeRoute(u, x, st) >= 0) trade = Math.max(trade, 0.6 + 0.3 * soc);
  void A;
  return { crowd: r3(crowd), persecution: r3(persecution), curiosity: r3(curiosity), trade: r3(trade), dying: r3(doom(u, x, st)) };
}

const PURPOSE_OF: Record<string, Purpose> = { dying: 'exodus', persecution: 'refuge', crowd: 'colony', trade: 'trade', curiosity: 'curiosity' };
const WHY: Record<string, string> = {
  exodus: 'their world is dying under them', refuge: 'they are not free to live as they believe at home', colony: 'they have outgrown their land',
  trade: 'there are goods to be had on another world', curiosity: 'they want to know what the other lights in the sky are', god: 'the god told them to go',
  survey: 'they want to see every world of the sky clearly',
};

// ───────────────────────────── where to ─────────────────────────────

/** how a people would fare on a world (0 death .. 1 home): air, warmth through the year, water, green */
export function habitability(u: Universe, q: Planet, species: number): { score: number; breathe: boolean } {
  const sp = u.content.species.list[species];
  const breathe = breathable(sp, q.st.atmosphere);
  const [tMin, lo, hi, tMax] = sp.temp;
  let n = 0, fit = 0, wet = 0;
  const step = Math.max(1, Math.floor(q.count / 600));
  for (let c = 0; c < q.count; c += step) {
    if (q.f.water[c] > 0.5) { wet++; continue; }
    n++;
    const t = q.s.tempYear[c] || q.f.temperature[c];
    fit += t >= lo && t <= hi ? 1 : t >= tMin && t <= tMax ? 0.4 : 0;
  }
  const tempFit = n ? fit / n : 0;
  const water = Math.min(1, (wet / Math.max(1, wet + n)) * 3);
  const green = Math.min(1, q.vegTotal / Math.max(1, q.count * 0.3));
  const base = 0.5 * tempFit + 0.25 * water + 0.25 * (sp.forage.includes('air') ? 1 : green);
  // sealed in suits, a people still drinks: a world without water they can drink is no home at all
  return { score: r3((breathe ? 1 : drinkable(u, q, species) ? 0.12 : 0.01) * base), breathe };
}

/**
 * Does a world hold water this people can drink (fresh water standing anywhere; snow and ice for peoples of the cold)?
 * A people that needs no water (the methane drifters) drinks nothing; seas of another liquid are no drink at all.
 */
export function drinkable(u: Universe, q: Planet, species: number): boolean {
  const sp = u.content.species.list[species];
  if (sp && (sp.needs?.water ?? 1) <= 0) return true;
  if (q.st.liquid.id !== 'water') return false;
  const cold = sp?.habitat.includes('cold') ?? false;
  // (by the peoples' own rule for a drink: fresh water, wet ground over a full aquifer, rain; snow for the cold folk)
  const step = Math.max(1, Math.floor(q.count / 800));
  let n = 0, m = 0;
  for (let c = 0; c < q.count; c += step) {
    m++;
    if (drinkableAt(q, c) || (cold && snowWater(q, c))) n++;
  }
  return n >= Math.max(2, m * 0.004);
}

/**
 * Can settlers of st live sealed on world q (its air would kill them): suits known and one in the store for every
 * settler, water there they can drink — and, if they know how to raise domes, what a dome is made of. Returns what is
 * missing in words (empty: ready).
 */
export function sealGaps(u: Universe, x: PCtx, st: Settlement, q: Planet, settlers: number): string[] {
  const gaps: string[] = [];
  if (!canSeal(x, st)) gaps.push('they cannot seal themselves against its air');
  const suit = suitStock(x, st);
  if (suit < settlers) gaps.push(`${suit} pressure suits for ${settlers} settlers`);
  if (!drinkable(u, q, st.species)) gaps.push(`no water they could drink on ${q.name}`);
  if (knows(x, st, 'habitat-domes') && domeMaterial(x, st) < 0) gaps.push('nothing to raise a dome with');
  return gaps;
}

/** pressure suits (items tagged 'suit') in a settlement's store */
function suitStock(x: PCtx, st: Settlement): number {
  const t = suitItems(x.c);
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t[i]) n += storeHas(st, i);
  return Math.floor(n);
}

/** the material a dome would be raised in from this store (-1: they cannot afford one) */
function domeMaterial(x: PCtx, st: Settlement): number {
  const t = x.c.buildings.idx('habitat-dome');
  if (t < 0) return -1;
  const def = x.c.buildings.list[t];
  for (const mid of def.materials) {
    const m = x.c.materials.idx(mid);
    if (m < 0) continue;
    if (x.c.materials.list[m].items.every((io) => { const it = io.item ? x.c.items.idx(io.item) : -1; return it >= 0 && storeHas(st, it) >= io.qty * def.cost; })) return m;
  }
  return -1;
}

/** a guess at a world's welcome from a wandering light alone (its kind's reputation) */
function guessHabitability(u: Universe, q: Planet): number {
  return ({ terran: 0.6, ocean: 0.5, jungle: 0.55, desert: 0.3, ice: 0.25 } as Record<string, number>)[q.st.kind] ?? 0.05;
}

/** can this settlement seal itself against a world's air (suits known, or domes) */
export function canSeal(x: PCtx, st: Settlement): boolean {
  return knows(x, st, 'pressure-suits') || knows(x, st, 'habitat-domes');
}

/** the settlers a settlement would send (by its size), before a ship kind is chosen */
export function settlersOf(x: PCtx, st: Settlement, purpose: Purpose): number {
  const pop = (x.ps.members.get(st.id)?.length ?? 0);
  return purpose === 'exodus' ? Math.max(3, Math.min(120, pop)) : Math.max(3, Math.min(14, Math.round(pop * 0.3)));
}

/** the trade partner of another world this settlement has a good road to: its planet id (-1 none) */
export function tradeRoute(u: Universe, x: PCtx, st: Settlement): number {
  const me = stKey(x.p.id, st.id);
  let best = -1, bv = 0;
  for (const r of u.space.relations) {
    if (r.a !== me && r.b !== me) continue;
    const other = r.a === me ? r.b : r.a;
    const pid = Number(other.split(':')[0]);
    const q = u.planet(pid);
    if (!q || !q.alive || pid === x.p.id) continue;
    const them = q.people?.settlement(Number(other.split(':')[1]));
    if (!them || them.fallen >= 0) continue;
    const op = r.a === me ? r.op[0] : r.op[1];
    const v = r.trade > 0 && r.war < 0 ? 0.5 + op + Math.min(1, r.trade / 200) : -1;
    if (v > bv) { bv = v; best = pid; }
  }
  return best;
}

/** the world a settlement would go to for this purpose (-1 none it has seen) */
export function chooseTarget(u: Universe, x: PCtx, st: Settlement, purpose: Purpose, cls: string): number {
  if (cls === 'orbit') return -1;
  if (cls === 'air') return x.p.id;
  const seen = u.space.observed[stKey(x.p.id, st.id)] ?? {};
  const home = u.centerOf(x.p, u.tick, [0, 0, 0]);
  const route = purpose === 'trade' ? tradeRoute(u, x, st) : -1;
  let best = -1, bs = 0.08;
  for (const q of u.planets) {
    if (!q.alive || q.id === x.p.id) continue;
    const lvl = seen[String(q.id)] ?? 0;
    if (lvl < 1) continue;
    const hab = lvl >= 2 ? habitability(u, q, st.species) : { score: guessHabitability(u, q), breathe: true };
    const peopled = lvl >= 3 && (q.people?.settlements ?? []).some((o) => o.fallen < 0 && !o.band);
    const visited = u.space.ships.some((sh) => sh.owner === st.id && sh.home === x.p.id && sh.visits.includes(q.id));
    let v = 0;
    if (purpose === 'colony' || purpose === 'exodus' || purpose === 'refuge') {
      // a world whose air would kill them only sealed: suits for every settler, water to drink, a dome's makings
      if (!hab.breathe && (lvl < 2 || sealGaps(u, x, st, q, settlersOf(x, st, purpose)).length)) continue;
      v = hab.breathe ? hab.score : hab.score * 0.5 + 0.1;
      if (purpose === 'colony' && peopled) v -= 0.12;
      if (lvl < 2) v *= 0.5;
    } else if (purpose === 'trade') {
      v = (peopled ? 1 : 0) + 0.2 * hab.score + (q.id === route ? 1 : 0);
    } else {
      v = 0.45 + (visited ? 0 : 0.3) + (peopled ? 0.3 : 0) + 0.1 * hab.score;
    }
    const c = u.centerOf(q, u.tick, [0, 0, 0]);
    v -= 0.08 * Math.hypot(c[0] - home[0], c[1] - home[1], c[2] - home[2]) / 1.5e6;
    v += (hashFloat(st.id, q.id, 0x7a6e) - 0.5) * 0.05;
    if (v > bs) { bs = v; best = q.id; }
  }
  return best;
}

/** the kind of ship a settlement would send for a purpose (null: it cannot) */
export function chooseKind(u: Universe, x: PCtx, st: Settlement, purpose: Purpose, prefer?: string): ShipKindDef | null {
  const ok = (d: ShipKindDef) => missingKnowledge(x, st, d).length === 0;
  if (prefer) { const d = u.content.ships.find(prefer); return d && ok(d) ? d : null; }
  const list = u.content.ships.list.filter(ok);
  if (!list.length) return null;
  const by = (cls: string) => list.filter((d) => d.class === cls);
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
  // to see the sky first: an orbiter, if they have none up there
  if ((purpose === 'curiosity' || purpose === 'survey') && by('orbit').length && !u.space.ships.some((sh) => sh.owner === st.id && sh.home === x.p.id && sh.phase === 'orbit' && u.content.ships.find(sh.kind)?.class === 'orbit')) {
    if (sightLevel(u, x, st) < 3) return by('orbit')[0];
  }
  if (purpose === 'survey') return by('orbit')[0] ?? null;
  const gate = by('gate').find((d) => standingPad(x, st, d));
  if (gate) return gate;
  const inter = by('interplanetary').slice().sort((a, b) => b.crew[1] - a.crew[1] || (a.id < b.id ? -1 : 1));
  if (inter.length) {
    const big = inter.find((d) => d.crew[1] >= 40);
    const small = inter.find((d) => d.crew[1] < 40) ?? inter[inter.length - 1];
    if ((purpose === 'exodus' || purpose === 'colony') && big && pop >= 30) return big;
    return small;
  }
  if (purpose === 'colony' || purpose === 'refuge' || purpose === 'exodus') return by('air')[0] ?? null;
  return null;
}

// ───────────────────────────── a program ─────────────────────────────

function shipName(x: PCtx, st: Settlement, id: number): string {
  const ph = phonologyOf(x.c, st.species);
  const w = word(ph, st.langSeed, hash32(id, 0x5a1b), 2, 3);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** start building a ship of `def` at settlement st for `purpose` (to: target world, -1 none / chosen later) */
export function startProgram(u: Universe, x: PCtx, st: Settlement, def: ShipKindDef, purpose: Purpose, to: number, why: string): ShipState {
  const id = u.ids.alloc('ship');
  const pad = standingPad(x, st, def);
  const sh: ShipState = {
    id, kind: def.id, name: shipName(x, st, id), owner: st.id, ownerName: st.name, home: x.p.id, species: st.species, purpose, why,
    phase: 'building', t0: u.tick, t1: -1, created: u.tick, from: x.p.id, to,
    padPos: pad ? [pad.pos[0], pad.pos[1], pad.pos[2]] : [st.pos[0], st.pos[1], st.pos[2]], padCell: pad ? pad.cell : st.cell, padBuilding: pad ? pad.id : -1,
    dest: [0, 0, 1], destCell: -1, destSettlement: -1, altitude: def.altitude, orbitA: [0, 0, 1], orbitB: [1, 0, 0], orbitPeriod: 0, bez: [],
    launchTick: -1, arriveTick: -1, work: 0, hull: -1, fuelBack: [], stock: [], markAt: u.tick, mark: 0, carried: [], descFrom: null,
    crewIds: [], ground: [], crew: [], cargo: [], food: 0, reliability: 0,
    cause: '', lostIn: '', lostAt: null, returning: false, visits: [], outcome: '', dead: 0, born: 0, lastDay: 0, log: [], era: st.era,
  };
  u.space.ships.push(sh);
  u.space.cooldown[stKey(x.p.id, st.id)] = u.tick + COOLDOWN_DAYS * x.day;
  // a hull already standing (one that came home, or the god's gift) is this ship's; what it lacks is set aside at once
  const hullItem = def.hull ? x.c.items.idx(def.hull) : -1;
  if (hullItem >= 0 && storeHas(st, hullItem) >= 1) { storeTake(st, hullItem, 1); sh.hull = hullItem; }
  reserve(x, st, sh, def);
  const target = to >= 0 ? u.planet(to) : undefined;
  const padName = x.c.buildings.find(def.pad)?.name.toLowerCase() ?? def.pad;
  const words = `${why}${target && target.id !== x.p.id ? ` (bound for ${target.name})` : ''}`;
  tell(u, x.p, 'space.program', vars(x, st, -1, { ship: `${article(def.name.toLowerCase())} named ${sh.name}`, building: padName, why: words }), st, [settlementRef(x, st), { kind: 'ship', id, planet: x.p.id }]);
  sh.log.push(`Laid down at ${st.name} (${purpose}).`);
  u.emit({ t: 'ship.program', planet: x.p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id, planet: x.p.id }, text: sh.name, data: { kind: def.id, purpose, settlement: st.id, to } });
  return sh;
}

/** daily per settlement: look at the sky, weigh the reasons to go, start a program when they are strong enough */
export function spaceDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length || !u.content.ships.size) return;
  const x = makeCtx(u, p);
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    if (st.era < ERAS.indexOf('classical')) continue; // nobody below the classical age watches the sky with purpose
    observe(u, x, st);
    const key = stKey(p.id, st.id);
    if (u.space.ships.some((sh) => sh.owner === st.id && sh.home === p.id && (sh.phase === 'building' || sh.phase === 'fuelling' || sh.phase === 'boarding' || sh.phase === 'pad'))) continue;
    const order = u.space.orders.find((o) => o.planet === p.id && o.settlement === st.id);
    if (!order && (u.space.cooldown[key] ?? -1) > u.tick) continue;
    // a chain they know at all (cheap test before weighing reasons)
    if (!order && !u.content.ships.list.some((d) => missingKnowledge(x, st, d).length === 0)) continue;
    const m = motives(u, x, st);
    u.space.motives[key] = m;
    let purpose: Purpose;
    let strength: number;
    if (order) { purpose = order.purpose; strength = 1; } else {
      let bestK = '', bv = 0;
      for (const k of ['dying', 'persecution', 'crowd', 'trade', 'curiosity']) if (m[k] > bv) { bv = m[k]; bestK = k; }
      if (!bestK) continue;
      purpose = PURPOSE_OF[bestK];
      strength = bv;
    }
    const drive = Math.max(0, u.god.law('space.drive'));
    if (!order && hashFloat(st.id, Math.floor(u.tick / x.day), 0x5ace, p.id) >= (strength - 0.3) * 1.4 * drive) continue;
    const def = chooseKind(u, x, st, purpose, order?.kind || undefined);
    if (!def) { if (order) refuseOrder(u, x, st, order, 'they know no ship that could do it'); continue; }
    const to = order && order.to >= 0 ? order.to : chooseTarget(u, x, st, def.class === 'orbit' ? 'survey' : purpose, def.class);
    if (def.class !== 'orbit' && to < 0) { if (order) refuseOrder(u, x, st, order, 'they have seen no world to go to'); continue; }
    if (order) u.space.orders = u.space.orders.filter((o) => o !== order);
    startProgram(u, x, st, def, def.class === 'orbit' ? 'survey' : purpose, to, def.class === 'orbit' ? WHY.survey : order ? WHY.god : WHY[purpose]);
  }
}

function refuseOrder(u: Universe, x: PCtx, st: Settlement, order: { tick: number }, why: string): void {
  u.space.orders = u.space.orders.filter((o) => o !== order);
  u.emit({ t: 'ship.refused', planet: x.p.id, pos: [...st.pos] as V3, text: `${st.name} cannot go: ${why}.`, ref: settlementRef(x, st) });
}

/** the words for a program's purpose */
export function whyOf(purpose: Purpose): string {
  return WHY[purpose] ?? WHY.curiosity;
}

// ───────────────────────────── the program's hours ─────────────────────────────

/** ids of adults free to help (not children, not away, healthy), best by `score` first */
function free(x: PCtx, st: Settlement, score: (s: number) => number, n: number, exclude: number[] = []): number[] {
  const A = x.A;
  const c: [number, number][] = [];
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.flags[m] & AgentFlag.child || A.mission[m] || A.health[m] < 0.5 || exclude.includes(A.id[m])) continue;
    if (A.id[m] === st.leader) continue;
    c.push([m, score(m)]);
  }
  c.sort((a, b) => b[1] - a[1] || x.A.id[a[0]] - x.A.id[b[0]]);
  return c.slice(0, n).map(([m]) => m);
}

/** enlist agents: mission −(ship id), their next turn soon */
function enlist(x: PCtx, sh: ShipState, slots: number[], into: number[]): void {
  const A = x.A;
  for (const s of slots) {
    A.mission[s] = -sh.id;
    if (!into.includes(A.id[s])) into.push(A.id[s]);
    if (A.task[s] !== TASK.sleep) schedule(x, s, Math.min(A.next[s], x.tick + 5));
  }
  into.sort((a, b) => a - b);
}

/** let enlisted agents go back to their lives */
export function dismiss(x: PCtx, sh: ShipState, ids: number[]): void {
  const A = x.A;
  for (const id of ids) {
    const s = A.slotOf(id);
    if (s >= 0 && A.mission[s] === -sh.id) { A.mission[s] = 0; schedule(x, s, x.tick + 1); }
  }
}

/** the ground crew: up to four who know the hull's making (or are the best makers) */
function groundCrew(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): void {
  const A = x.A;
  sh.ground = sh.ground.filter((id) => { const s = A.slotOf(id); return s >= 0 && A.mission[s] === -sh.id; });
  if (sh.ground.length >= 4) return;
  const k = hullRecipe(x, st, def);
  const pick = free(x, st, (s) => (k >= 0 && A.knows(s, k) ? 2 : 0) + A.skills[s * NS + SKILL.smith] + A.skills[s * NS + SKILL.craft] * 0.6, 4 - sh.ground.length, [...sh.ground, ...sh.crewIds]);
  enlist(x, sh, pick, sh.ground);
}

/** how many people go, by purpose (0: an uncrewed machine — an orbiter sent up to look) */
export function crewSize(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): number {
  const pop = (x.ps.members.get(st.id)?.length ?? 0);
  const [lo, hi] = def.crew;
  if (hi <= 0) return 0;
  switch (sh.purpose) {
    case 'exodus': return Math.min(hi, pop);
    case 'colony': case 'refuge': return Math.max(lo, Math.min(hi, Math.round(pop * 0.3)));
    case 'survey': return lo;
    default: return Math.max(lo, Math.min(hi, lo + 2));
  }
}

/** settlers mean to stay where they come down */
export function isSettlers(purpose: Purpose): boolean {
  return purpose === 'colony' || purpose === 'exodus' || purpose === 'refuge';
}

/** the ids of a person's family that goes with them or not at all: their household and their partner */
function familyIds(x: PCtx, st: Settlement, id: number): number[] {
  const A = x.A;
  const s = A.slotOf(id);
  const out = new Set<number>([id]);
  const hh = st.households.find((h) => h.members.includes(id));
  if (hh) for (const m of hh.members) out.add(m);
  if (s >= 0 && A.partner[s]) out.add(A.partner[s]);
  return [...out].sort((a, b) => a - b);
}

/** does this person have a child of their own living in the settlement */
function hasChild(x: PCtx, st: Settlement, id: number): boolean {
  const A = x.A;
  for (const m of x.ps.members.get(st.id) ?? []) if (A.flags[m] & AgentFlag.child && (A.mother[m] === id || A.father[m] === id)) return true;
  return false;
}

/** choose who goes: whole households for settlers (a family together or not at all), the bold and skilled for a visit */
function chooseCrew(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): void {
  const A = x.A;
  const want = crewSize(x, st, sh, def);
  if (want <= 0) return;
  const settlers = isSettlers(sh.purpose);
  // a colony takes its people from the cohort too: promote some so whole families can go
  const have = (x.ps.members.get(st.id)?.length ?? 0);
  if (settlers && have < want + 6 && cohortTotal(st) >= 1) promote(x, st, Math.min(Math.ceil(cohortTotal(st)), want + 6 - have));
  const chosen: number[] = [];
  const taken = new Set<number>([...sh.ground, ...sh.crewIds]);
  const count = () => chosen.length + sh.crewIds.length;
  if (settlers) {
    const hhs = st.households.slice().sort((a, b) => hash32(a.id, sh.id) - hash32(b.id, sh.id) || a.id - b.id);
    for (const hh of hhs) {
      if (count() >= want) break;
      const ids = new Set<number>(hh.members);
      for (const id of hh.members) { const s = A.slotOf(id); if (s >= 0 && A.partner[s]) ids.add(A.partner[s]); }
      const slots = [...ids].sort((a, b) => a - b).map((id) => A.slotOf(id));
      // everyone of it must be free to go: alive here, not the leader, not busy elsewhere (nobody is left behind)
      if (slots.some((s) => s < 0 || A.settlement[s] !== st.id || A.id[s] === st.leader || A.mission[s] || taken.has(A.id[s]))) continue;
      if (count() + slots.length > def.crew[1]) continue;
      for (const s of slots) { chosen.push(s); taken.add(A.id[s]); }
    }
  }
  if (count() < want) {
    // the bold and the skilled; settlers fill up only with people who leave no partner or child behind
    const more = free(x, st, (s) => A.traits[s * NT + TRAIT.boldness] + A.traits[s * NT + TRAIT.curiosity] * 0.8 + A.skills[s * NS + SKILL.sail] + A.skills[s * NS + SKILL.lore] * 0.7, want - count() + (settlers ? 12 : 0), [...taken]);
    for (const s of more) {
      if (count() >= want) break;
      if (settlers && (A.partner[s] || hasChild(x, st, A.id[s]))) continue;
      chosen.push(s); taken.add(A.id[s]);
    }
  }
  // the ground crew stay at home; they see the ship off
  enlist(x, sh, chosen, sh.crewIds);
}

/** of the crew at the pad, those whose family is all there (settlers go as families: the rest wait with theirs) */
export function familiesPresent(x: PCtx, st: Settlement, sh: ShipState, present: number[]): number[] {
  if (!isSettlers(sh.purpose)) return present;
  const A = x.A;
  const here = new Set(present.map((s) => A.id[s]));
  const chosen = new Set(sh.crewIds);
  return present.filter((s) => familyIds(x, st, A.id[s]).every((id) => !chosen.has(id) || here.has(id)));
}

/** can the crew live on world q without a way home (its air, its warmth, water, green) */
export function livable(u: Universe, sh: ShipState, q: Planet): boolean {
  const sp = u.content.species.list[sh.species];
  return !!sp && breathable(sp, q.st.atmosphere) && habitability(u, q, sh.species).score >= 0.3;
}

/** food for the crossing (person-days) and the goods of the voyage go aboard from the store */
function loadShip(u: Universe, x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): void {
  const sp = x.info[st.species];
  const people = Math.max(1, sh.crewIds.length || crewSize(x, st, sh, def));
  const days = def.class === 'air' ? 2 : def.class === 'gate' ? 1 : def.class === 'orbit' ? 2 : def.days[1] * 1.4 + 2;
  let need = people * days;
  for (const it of sp.foods) {
    if (need <= 0) break;
    const ed = sp.edible[it];
    if (ed <= 0 || (x.c.items.list[it].decay ?? 0) > 0.05) continue;
    const units = Math.min(storeHas(st, it), need / ed);
    if (units <= 0) continue;
    const got = storeTake(st, it, units);
    addCargo(sh, it, got);
    need -= got * ed;
  }
  sh.food = Math.round((people * days - Math.max(0, need)) * 100) / 100;
  // goods: trade goods for a trade voyage; suits first, a dome's makings, then tools, seed, medicine for settlers
  let room = def.cargo;
  const give = (it: number, q: number) => {
    if (it < 0 || room <= 0) return;
    const got = storeTake(st, it, Math.min(q, room));
    if (got > 0) { addCargo(sh, it, got); room -= got; }
  };
  if (isSettlers(sh.purpose)) {
    const to = sh.to >= 0 ? u.planet(sh.to) : undefined;
    if (to && !breathable(x.c.species.list[st.species], to.st.atmosphere)) {
      // a world whose air would kill them: a suit for every one of them before anything else, then a dome's makings
      const t = suitItems(x.c);
      let suits = people;
      for (let i = 0; i < t.length && suits > 0; i++) if (t[i]) { const got = Math.min(suits, Math.floor(storeHas(st, i))); give(i, got); suits -= got; }
      const m = knows(x, st, 'habitat-domes') ? domeMaterial(x, st) : -1;
      if (m >= 0) {
        const cost = x.c.buildings.get('habitat-dome').cost;
        for (const io of x.c.materials.list[m].items) give(io.item ? x.c.items.idx(io.item) : -1, io.qty * cost);
      }
    }
    for (const tag of ['tool', 'seed', 'medicine', 'clothing', 'building']) {
      for (const it of x.c.itemsByTag.get(tag) ?? []) if (storeHas(st, it) >= 1) give(it, Math.max(1, Math.floor(storeHas(st, it) * (sh.purpose === 'exodus' ? 0.9 : 0.3))));
    }
  } else if (sh.purpose === 'trade' || sh.purpose === 'curiosity' || sh.purpose === 'god') {
    // what they make that is worth carrying: valuable, not food, not what ships are made of (they keep their engines)
    const shipParts = new Set<number>();
    for (const d of x.c.ships.list) {
      if (!d.hull) continue;
      const hi = x.c.items.idx(d.hull);
      for (const k of hi >= 0 ? x.rt.producers[hi] ?? [] : []) for (const io of x.rt.list[k].inputs) for (const i of io.items) shipParts.add(i);
    }
    const goods: [number, number][] = [];
    for (let i = 0; i < st.store.length; i++) {
      const q = st.store[i];
      const it = x.c.items.list[i];
      if (!it || q < 2 || shipParts.has(i) || it.tags.includes('food') || it.tags.includes('vehicle') || it.tags.includes('propellant')) continue;
      goods.push([i, q * it.value]);
    }
    goods.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [i] of goods.slice(0, 5)) give(i, Math.max(1, Math.floor(st.store[i] * 0.25)));
  }
}

/**
 * Load the fuel out of the ship's stock (twice for a voyage that means to come home: the second share kept aboard for
 * the way back). False while the stock lacks it. `oneWay`: a voyage home may leave with fuel for the way out only (the
 * caller allows it only toward a world its people could live on).
 */
function takeFuel(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef, oneWay: boolean): boolean {
  const back = roundTrip(sh, def);
  const mult = back ? 2 : 1;
  let full = true, out = true;
  for (const io of def.fuel) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    const have = it < 0 ? 0 : stockOf(sh, [it]);
    if (have < io.qty * mult) full = false;
    if (have < io.qty) out = false;
  }
  if (!full && !(oneWay && out)) return false;
  for (const io of def.fuel) {
    const it = x.c.items.idx(io.item!);
    stockTake(sh, [it], io.qty);
    if (back && full) { const got = stockTake(sh, [it], io.qty).reduce((q, [, n]) => q + n, 0); if (got > 0) sh.fuelBack.push([it, got]); }
  }
  if (back && !full) {
    // fuel for the way out only: they go to stay (whole households, as settlers do)
    sh.purpose = 'colony';
    sh.why = WHY.colony;
    sh.log.push('Fuel for the way out only: they mean to stay.');
  }
  // anything else set aside goes back into the store
  unstock(x, st, sh);
  return true;
}

/** the crafts the program still needs: the hull, else its missing parts; fuel (recipe indices, most direct first) */
function neededCrafts(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): number[] {
  const out: number[] = [];
  const add = (k: number) => { if (k >= 0 && st.library.includes(k) && !out.includes(k)) out.push(k); };
  const hullItem = def.hull ? x.c.items.idx(def.hull) : -1;
  if (sh.phase === 'building' && hullItem >= 0 && sh.hull < 0) {
    const k = hullRecipe(x, st, def);
    if (k >= 0) {
      add(k);
      for (const io of x.rt.list[k].inputs) {
        if (storeAny(st, io.items) + stockOf(sh, io.items) >= io.qty) continue;
        for (const it of io.items) for (const q of x.rt.producers[it] ?? []) add(q);
      }
    }
  }
  if (!loaded(sh)) {
    const mult = roundTrip(sh, def) ? 2 : 1;
    for (const io of def.fuel) {
      const it = io.item ? x.c.items.idx(io.item) : -1;
      if (it >= 0 && storeHas(st, it) + stockOf(sh, [it]) < io.qty * mult) for (const q of x.rt.producers[it] ?? []) add(q);
    }
  }
  return out;
}

/** keep the program's crafts at the head of the settlement's job list (the job planner rewrites it hourly) */
export function ensureJobs(x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): void {
  const want = neededCrafts(x, st, sh, def);
  const hull = hullRecipe(x, st, def);
  for (let i = want.length - 1; i >= 0; i--) {
    const k = want[i];
    // (the hull itself is the ground crew's work at the pad, hour by hour: hullWork)
    if (k === hull || st.jobs.some((j) => j.k === k)) continue;
    const r = x.rt.list[k];
    if (r.kind !== 'craft') continue;
    const place = placeFor(x, r, st, String(k));
    if (!place) continue;
    st.jobs.unshift({ k, n: 1, cell: place.cell, building: place.building });
  }
  if (st.jobs.length > 14) st.jobs.length = 14;
}

/** people of the program within reach of the pad (agent slots) */
function atPadSlots(x: PCtx, sh: ShipState, ids: number[], within: number): number[] {
  const A = x.A;
  const p = [0, 0, 0];
  const out: number[] = [];
  for (const id of ids) {
    const s = A.slotOf(id);
    if (s < 0) continue;
    A.posAt(s, x.tick, p);
    if (distM(x.p, p, sh.padPos) <= within) out.push(s);
  }
  return out;
}

function atPad(x: PCtx, sh: ShipState, ids: number[], within = 70): number {
  return atPadSlots(x, sh, ids, within).length;
}

/** give the program up (the hull, the fuel and everything set aside back into the store) */
export function abandonProgram(u: Universe, x: PCtx, st: Settlement | undefined, sh: ShipState, why: string): void {
  dismiss(x, sh, sh.ground);
  dismiss(x, sh, sh.crewIds);
  if (st) {
    if (sh.hull >= 0) storeAdd(x, st, sh.hull, 1);
    for (const [it, q] of sh.fuelBack) storeAdd(x, st, it, q);
    for (const [it, q] of sh.cargo) storeAdd(x, st, it, q);
    unstock(x, st, sh);
    tell(u, x.p, 'space.program.gone', vars(x, st, -1, { ship: `${kindName(x, sh)} ${sh.name}`, why }), st, [settlementRef(x, st)]);
    u.space.cooldown[stKey(x.p.id, st.id)] = u.tick + COOLDOWN_DAYS * x.day;
  }
  sh.hull = -1; sh.fuelBack = []; sh.cargo = []; sh.stock = [];
  sh.phase = 'done';
  sh.outcome = 'abandoned';
  sh.log.push(`Given up: ${why}.`);
}

/** hourly: one step of a ship's program on the ground (building, fuelling, boarding) */
export function programHour(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const p = u.planet(sh.from);
  if (!p || !p.alive) return;
  const x = makeCtx(u, p);
  const st = x.ps.settlement(sh.owner);
  if (!st || st.fallen >= 0) { abandonProgram(u, x, st, sh, `${sh.ownerName} is no more`); return; }
  const target = sh.to >= 0 ? u.planet(sh.to) : undefined;
  if (sh.to >= 0 && (!target || !target.alive)) { abandonProgram(u, x, st, sh, `${target?.name ?? 'the world they meant to reach'} is gone`); return; }
  const pad = standingPad(x, st, def);
  if (pad) { sh.padBuilding = pad.id; sh.padPos = [pad.pos[0], pad.pos[1], pad.pos[2]]; sh.padCell = pad.cell; }
  else {
    // the site of a pad still rising is where the ground crew gather
    const t = x.c.buildings.idx(def.pad);
    const site = x.ps.of(st.id).find((b) => b.type === t && b.progress < 1 && !(b.flags & 2));
    if (site) { sh.padPos = [site.pos[0], site.pos[1], site.pos[2]]; sh.padCell = site.cell; }
  }
  const hullItem = def.hull ? x.c.items.idx(def.hull) : -1;
  if (sh.phase === 'building') {
    if (!pad) {
      // the pad is raised by the town's builders and the ground crew (the construction system takes the site from here)
      const t = x.c.buildings.idx(def.pad);
      const site = x.ps.of(st.id).some((b) => b.type === t && b.progress < 1 && !(b.flags & 2));
      if (!site && t >= 0 && missingKnowledge(x, st, def).length === 0) planBuilding(x, st, t);
    }
    groundCrew(x, st, sh, def);
    if (hullItem >= 0 && sh.hull < 0 && storeHas(st, hullItem) >= 1) { storeTake(st, hullItem, 1); sh.hull = hullItem; }
    reserve(x, st, sh, def);
    if (pad && hullItem >= 0 && sh.hull < 0) hullWork(u, x, st, sh, def);
    if (pad && (hullItem < 0 || sh.hull >= 0)) {
      sh.work = 0;
      phaseTo(u, x, st, sh, def, 'fuelling');
      reserve(x, st, sh, def);
      sh.log.push(def.hull ? `The ${x.c.items.list[hullItem].name.toLowerCase()} stands on the pad.` : 'The gate hums.');
      u.emit({ t: 'ship.built', planet: p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: p.id }, text: sh.name });
      return;
    }
    if (stalled(u, x, st, sh, def)) abandonProgram(u, x, st, sh, 'they could not gather what it needs');
    return;
  }
  if (sh.phase === 'fuelling') {
    groundCrew(x, st, sh, def);
    if (!pad) { abandonProgram(u, x, st, sh, 'its pad was lost'); return; }
    if (!loaded(sh)) {
      reserve(x, st, sh, def);
      const days = (u.tick - sh.t0) / x.day;
      // a voyage home with fuel for the way out only goes after a while — and then only to a world they could live on
      const oneWay = roundTrip(sh, def) && days > FUEL_DAYS / 2 && !!target && livable(u, sh, target);
      if (!takeFuel(x, st, sh, def, oneWay)) {
        if (stalled(u, x, st, sh, def) || days > FUEL_DAYS * 2) abandonProgram(u, x, st, sh, roundTrip(sh, def) ? 'there was never fuel enough for the way home' : 'there was never fuel enough');
        return;
      }
      // the crew are chosen when the ship is fuelled (they put their affairs in order until then)
      if (!sh.crewIds.length) chooseCrew(x, st, sh, def);
      loadShip(u, x, st, sh, def);
      sh.work = Math.max(sh.work, 0.001);
    }
    const workers = atPad(x, sh, sh.ground, 80);
    sh.work = Math.min(1, sh.work + (0.12 + 0.22 * workers) / Math.max(1, def.prep));
    if (sh.work >= 1) {
      if (!sh.crewIds.length) chooseCrew(x, st, sh, def);
      // an uncrewed orbiter goes straight to its countdown
      const crewed = crewSize(x, st, sh, def) > 0;
      phaseTo(u, x, st, sh, def, crewed ? 'boarding' : 'pad');
      sh.t1 = crewed ? -1 : u.tick + 30;
      sh.log.push('Fuelled and loaded.');
      if (!crewed) u.emit({ t: 'ship.countdown', planet: p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: p.id }, text: sh.name });
    }
    return;
  }
  if (sh.phase === 'boarding') {
    // the crew still with us (the dead and those taken away drop out)
    const A = x.A;
    sh.crewIds = sh.crewIds.filter((id) => { const s = A.slotOf(id); return s >= 0 && A.mission[s] === -sh.id; });
    const min = Math.max(1, def.crew[0]);
    if (sh.crewIds.length < min) {
      chooseCrew(x, st, sh, def);
      if (sh.crewIds.length < min) { if (u.tick - sh.t0 > 3 * x.day) abandonProgram(u, x, st, sh, 'nobody would go'); return; }
    }
    const there = familiesPresent(x, st, sh, atPadSlots(x, sh, sh.crewIds, 60)).length;
    // all (nearly) aboard; or, the longer they wait, whoever has come (a family that cannot be found stays behind)
    const waited = u.tick - sh.t0;
    const need = waited > 2 * BOARD_HOURS * 60 ? min : waited > BOARD_HOURS * 60 ? Math.max(def.crew[0], Math.ceil(sh.crewIds.length * 0.5)) : Math.ceil(sh.crewIds.length * 0.85);
    if (there >= Math.max(1, need)) {
      sh.phase = 'pad';
      sh.t0 = u.tick;
      sh.t1 = u.tick + 30;
      sh.log.push(`${there} at the pad; the countdown begins.`);
      u.emit({ t: 'ship.countdown', planet: p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: p.id }, text: sh.name });
    } else if (waited > 4 * BOARD_HOURS * 60 && there < min) abandonProgram(u, x, st, sh, 'nobody would go');
  }
}

/**
 * An hour's work on the hull at the pad: the ground crew who know its making and are at it there put in skilled hours
 * (sh.work, a share of the recipe's time); when the work is done the best of them makes it from the parts set aside —
 * the real crafting: a novice may spoil the whole batch — and the hull is the ship's.
 */
function hullWork(u: Universe, x: PCtx, st: Settlement, sh: ShipState, def: ShipKindDef): void {
  const k = hullRecipe(x, st, def);
  if (k < 0 || !inputsWithStock(x, st, sh, k)) return;
  const A = x.A;
  const r = x.rt.list[k];
  let hours = 0, maker = -1, best = -1;
  for (const id of sh.ground) {
    const s = A.slotOf(id);
    if (s < 0 || A.task[s] !== TASK.launch || A.tTarget[s] !== sh.id || A.tData[s] !== k || A.phase[s] !== 1 || !A.knows(s, k)) continue;
    const sk = A.skills[s * NS + r.skill];
    hours += 0.5 + sk;
    if (sk > best && toolsAvailable(x, st, s, k)) { best = sk; maker = s; }
  }
  if (!hours || maker < 0) return;
  sh.work = Math.min(1, Math.round((sh.work + (hours * 60) / Math.max(60, r.time)) * 10000) / 10000);
  if (sh.work < 1) return;
  // the parts come out of the stock onto the pad, and are made into the hull in the same hour
  release(x, st, sh, k);
  const res = craft(x, maker, st, k, sh.padCell);
  const hullItem = x.c.items.idx(def.hull!);
  if (res.ok && res.made > 0 && storeTake(st, hullItem, 1) >= 1) {
    sh.hull = hullItem;
    sh.work = 0;
    sh.log.push(`The hull was made by ${agentName(x, maker)}.`);
  } else if (!res.ok && res.why === 'spoiled') {
    sh.work = 0;
    sh.log.push('The hull came out wrong: its parts are lost.');
    u.emit({ t: 'ship.spoiled', planet: x.p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: x.p.id }, text: sh.name, data: { why: 'spoiled' } });
  } else {
    // (a tool was missing at the last: the work waits, the parts go back aside)
    sh.work = 0.99;
    reserve(x, st, sh, def);
  }
}

// ───────────────────────────── the crew's turns (people/hooks.ts) ─────────────────────────────

const _sp = [0, 0, 0];

/** a day's food from the store in the hand of someone camping at the pad (they eat it there) */
function provision(x: PCtx, st: Settlement, s: number): void {
  const A = x.A;
  const sp = x.info[A.species[s]];
  let days = 0;
  for (const it of sp.foods) { const q = A.carried(s, it); if (q > 0) days += q * sp.edible[it]; }
  if (days >= 0.3) return;
  const it = bestFood(x, st);
  if (it < 0 || sp.edible[it] <= 0) return;
  const units = storeTake(st, it, Math.min(storeHas(st, it), 1.2 / sp.edible[it]));
  if (units <= 0) return;
  const left = A.give(s, it, units);
  if (left > 0) storeAdd(x, st, it, left);
}

/** work on the site of the pad still rising: build where materials lie delivered, else haul a load from the store */
function padSiteTask(x: PCtx, s: number, st: Settlement, def: ShipKindDef): TaskSpec | null {
  const A = x.A;
  const t = x.c.buildings.idx(def.pad);
  const b = x.ps.of(st.id).find((o) => o.type === t && o.progress < 1 && !(o.flags & 2));
  if (!b) return null;
  const bd = x.c.buildings.list[b.type];
  const R = x.p.st.radius;
  if (b.progress < b.delivered / Math.max(1, bd.cost) - 1e-4) {
    offsetPoint(b.pos, bd.footprint + 0.8, hashFloat(A.id[s], x.tick, 0x9b1) * Math.PI * 2, R, _sp);
    return { kind: TASK.build, goal: [_sp[0], _sp[1], _sp[2]], goalCell: b.cell, work: 120, target: b.id, data2: 0 };
  }
  if (b.delivered >= bd.cost) return null;
  for (const io of x.c.materials.list[b.material].items) {
    const it = io.item ? x.c.items.idx(io.item) : -1;
    if (it < 0 || storeHas(st, it) < io.qty) return null;
  }
  const c = storePoint(x, st, _sp);
  return { kind: TASK.haul, goal: spotInCell(x.p, c, A.id[s], 41, [0, 0, 0]), goalCell: c, work: 12, target: b.id };
}

/**
 * The next task of an agent enlisted for ship −mission (decide.ts asks before the agent's own wants, unless a body's
 * need is pressing): ground crew raise the pad, make the hull and parts or work at the pad; the crew walk to the pad
 * once the ship is fuelled and wait there. Both camp at the pad with food from the store. Returns null (and lets the
 * agent go) when the ship needs it no more.
 */
export function crewTask(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const A = x.A;
  const sh = x.u.space.ship(-A.mission[s]);
  const id = A.id[s];
  if (!sh || sh.from !== x.p.id || !st || st.id !== sh.owner) { A.mission[s] = 0; return null; }
  const def = x.u.content.ships.find(sh.kind);
  const ground = sh.ground.includes(id), crew = sh.crewIds.includes(id);
  const pre = sh.phase === 'building' || sh.phase === 'fuelling' || sh.phase === 'boarding' || sh.phase === 'pad';
  if (!def || !pre || (!ground && !crew)) { A.mission[s] = 0; return null; }
  const pad = sh.padBuilding >= 0 ? x.ps.building(sh.padBuilding) : undefined;
  const R = x.p.st.radius;
  const near = (r: number, salt: number) => {
    offsetPoint(sh.padPos, r * (0.6 + 0.4 * hashFloat(id, salt, 0x9ad)), hashFloat(id, salt, 0x9ae) * Math.PI * 2, R, _sp);
    return [_sp[0], _sp[1], _sp[2]];
  };
  const foot = pad ? x.c.buildings.list[pad.type].footprint : x.c.buildings.find(def.pad)?.footprint ?? 6;
  const called = crew && (sh.phase === 'boarding' || sh.phase === 'pad' || (sh.phase === 'fuelling' && loaded(sh)));
  if (crew && !ground && !called) return null; // chosen, not called yet: they live as usual (put their affairs in order)
  // a camp by the pad: food from the store in hand, the night beside it — not the long walk home and back
  provision(x, st, s);
  A.posAt(s, x.tick, _sp);
  const here = distM(x.p, _sp, sh.padPos) < 140;
  const rest = A.needs[s * NN + NEED.rest];
  if (rest < 0.3 || (isNight(x, s) && rest < 0.95)) {
    // (away from the pad at nightfall: they sleep at home as usual)
    if (!here) return null;
    const goal = near(foot * 0.5 + 9, 4);
    return { kind: TASK.sleep, goal, goalCell: x.p.cellAt(goal), work: Math.round(Math.max(120, (1 - rest) * 480)), target: -1 };
  }
  if (called) {
    // to the pad, and wait there (the countdown takes whoever is by it)
    const goal = near(foot * 0.5 + 3, 1);
    return { kind: TASK.board, goal, goalCell: x.p.cellAt(goal), work: 45, target: sh.id };
  }
  // the ground crew: raise the pad, make the hull if they can, else a part, else work at the pad
  if (sh.phase === 'building' && !pad) {
    const t = padSiteTask(x, s, st, def);
    if (t) return t;
  }
  if (sh.phase === 'building' && pad && sh.hull < 0) {
    const k = hullRecipe(x, st, def);
    if (k >= 0 && A.knows(s, k) && inputsWithStock(x, st, sh, k)) {
      // hours of work on the hull at the pad (counted hourly by the program: hullWork)
      const goal = near(foot * 0.5 + 2, 2);
      return { kind: TASK.launch, goal, goalCell: x.p.cellAt(goal), work: 150, data: k, target: sh.id };
    }
  }
  if (sh.phase === 'building' || sh.phase === 'fuelling') {
    const hull = hullRecipe(x, st, def);
    for (const q of neededCrafts(x, st, sh, def)) {
      if (q === hull) continue;
      const r = x.rt.list[q];
      if (r.kind !== 'craft' || !A.knows(s, q) || !inputsWithStock(x, st, sh, q) || !toolsAvailable(x, st, s, q)) continue;
      const busy = sh.ground.some((g) => { const o = A.slotOf(g); return o >= 0 && o !== s && A.task[o] === TASK.craft && A.tData[o] === q; });
      if (busy) continue;
      const place = placeFor(x, r, st, String(q));
      if (!place) continue;
      // a part of the hull's own goods (an engine of its steel): what the store lacks comes out of the ship's stock
      release(x, st, sh, q);
      const goal = spotInCell(x.p, place.cell, id, 0x5bc, [0, 0, 0]);
      return { kind: TASK.craft, goal, goalCell: place.cell, work: r.time, data: q, target: place.building };
    }
  }
  if (!pad) return null;
  const goal = near(foot * 0.5 + 4, 3);
  return { kind: TASK.launch, goal, goalCell: x.p.cellAt(goal), work: 90, data: -2, target: sh.id };
}

/** a dry land cell r metres from a point (searching around it; the point itself when nothing better) */
export function landNear(x: PCtx, pos: ArrayLike<number>, r: number, salt: number): number {
  const R = x.p.st.radius;
  for (let k = 0; k < 12; k++) {
    const at = offsetPoint(pos, r * (1 + 0.15 * k), hashFloat(salt, k, 0x1a7d) * Math.PI * 2, R, [0, 0, 0]);
    const c = x.p.cellAt(at);
    if (isLand(x.p, c) && x.p.f.water[c] < 0.1 && x.p.f.lava[c] <= 0) return c;
  }
  return x.p.cellAt(pos);
}

/**
 * Where a ship comes down on world `x.p`: by a peopled town for a visit (a few hundred metres out; a trade run by the
 * town it traded with before; an airship by a town of another people, never its own); for settlers the best place for
 * their people to live — sometimes within reach of a town already there (kin above all: a people of their own kind
 * that they might join), never on top of one, and an airship's settlers well away from their own towns. Returns the
 * cell and the settlement it seeks (-1 none).
 */
export function landingSite(u: Universe, x: PCtx, sh: ShipState): { cell: number; settlement: number } {
  // (a wandering band is a people too: what a visitor's instruments saw were their fires)
  const towns = x.ps.settlements.filter((o) => o.fallen < 0 && ((x.ps.members.get(o.id)?.length ?? 0) + cohortTotal(o) >= 1))
    .sort((a, b) => ((x.ps.members.get(b.id)?.length ?? 0) + cohortTotal(b)) - ((x.ps.members.get(a.id)?.length ?? 0) + cohortTotal(a)) || a.id - b.id);
  const visit = sh.purpose === 'trade' || sh.purpose === 'curiosity' || sh.purpose === 'god' || sh.purpose === 'return';
  if (sh.purpose === 'return') {
    const home = x.ps.settlement(sh.owner);
    if (home && home.fallen < 0) return { cell: landNear(x, home.pos, Math.max(120, home.territory * 0.6), sh.id), settlement: home.id };
  }
  // over its own world, its own folk are not where it is going
  const homeSt = x.p.id === sh.home ? x.ps.settlement(sh.owner) : undefined;
  const own = (o: Settlement) => x.p.id === sh.home && (o.id === sh.owner || (!!homeSt && homeSt.polity >= 0 && o.polity === homeSt.polity));
  const others = towns.filter((o) => !own(o));
  // a town it was sent to (the god named it): down by it, settlers within its reach
  if (sh.destSettlement >= 0 && x.p.id === sh.to) {
    const t = x.ps.settlement(sh.destSettlement);
    if (t && t.fallen < 0 && !own(t)) return { cell: landNear(x, t.pos, visit ? Math.max(250, t.territory + 120) : Math.max(380, t.territory + 220), sh.id), settlement: t.id };
  }
  if (visit && others.length) {
    // a trade run goes back to the town that traded with them before
    const me = stKey(sh.home, sh.owner);
    const partner = sh.purpose === 'trade' ? others.find((o) => { const r = u.space.relation(me, stKey(x.p.id, o.id)); return !!r && r.trade > 0 && r.war < 0; }) : undefined;
    const t = partner ?? others[0];
    return { cell: landNear(x, t.pos, Math.max(250, t.territory + 120), sh.id), settlement: t.id };
  }
  // settlers who know the world is peopled may seek its people out: their own kind above all
  if (!visit && others.length && x.p.id !== sh.home) {
    const kin = others.find((o) => o.species === sh.species);
    const t = kin ?? others[0];
    if (hashFloat(sh.id, t.id, 0x1a5e) < (kin ? 0.55 : 0.25)) return { cell: landNear(x, t.pos, Math.max(380, t.territory + 220), sh.id), settlement: t.id };
  }
  // the best place to live (an airship's settlers: well away from their own towns)
  const mine = towns.filter(own);
  const away = (c: number) => {
    if (!mine.length) return true;
    const P = x.p.grid.pos;
    const q = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    return mine.every((o) => distM(x.p, o.pos, q) > Math.max(800, o.territory * 3));
  };
  let c = -1, bs = -Infinity;
  const step = Math.max(1, Math.floor(x.p.count / 2500));
  const salt = hash32(sh.id, 0x1a4d);
  for (let k = salt % step; k < x.p.count; k += step) {
    if (!away(k)) continue;
    const v = siteScore(x, sh.species, k) + hashFloat(k, salt, 0x5173) * 0.6;
    if (v > bs) { bs = v; c = k; }
  }
  if (c < 0) c = bestSiteOnPlanet(x, sh.species, salt);
  // the nearest people to that place (they will meet them)
  let near = -1, nd = 2500;
  const P = x.p.grid.pos;
  const pos = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  for (const t of others) { const d = distM(x.p, t.pos, pos); if (d < nd) { nd = d; near = t.id; } }
  // settlers do not come down on top of a town
  const cell = near >= 0 && nd < 300 ? landNear(x, x.ps.settlement(near)!.pos, 450, sh.id) : c;
  return { cell, settlement: near };
}

/** the body-frame point of a cell */
export function cellDir(x: PCtx, c: number): V3 {
  const q = cellPos(x.p, c);
  return [q[0], q[1], q[2]];
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
