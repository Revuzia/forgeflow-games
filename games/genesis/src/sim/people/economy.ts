// GENESIS — economy (CONTRACT.md §8.6): stores and what is carried, local prices from scarcity, trade between
// settlements whose surpluses differ (caravans along the roads they wear, boats over the water), markets, gifts to kin
// in need, tribute, and theft.
//
// Prices are a pure function of a settlement's state at the moment they are asked (what it holds against what it
// needs): nothing to save, and a loaded game prices exactly as the running one. A settlement plans trade once a day:
// against each settlement it has met and can reach, it lists what it has too much of that the other lacks and the
// reverse; when both lists are worth a trip it sends traders — real agents carrying the goods — who barter at the
// other's store for what their home needs and walk (or sail) back. Trade wears roads, carries ideas and plagues, warms
// relations, and is an accident trigger (counting, writing, money). Markets double what a caravan can move and make a
// town the place others come to.

import type { PCtx } from './ctx.ts';
import type { Mission, Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { DEATH, INV, MEMK, NT, ROLE, TRAIT } from './defs.ts';
import { foodDays, storeAdd, storeHas, storeTake } from './store.ts';
import { cohortTotal } from './cohorts.ts';
import { accident, learn, isTaboo, libraryEffect } from './knowledge.ts';
import { hasPrereqs } from '../recipes/recipes.ts';
import { tell } from './story.ts';
import { agentRef, agentName, settlementRef, vars } from './util.ts';
import { distM } from './world.ts';
import { die } from './lifecycle.ts';
import { newMission, routeBetween, volunteers, bestBoat } from './missions.ts';
import { atWar, grieve, relationOf, polityOf, strategicItem } from './war.ts';

// ───────────────────────────── prices ─────────────────────────────

/** people to feed (individuals + cohort) */
export function popOf(x: PCtx, st: Settlement): number {
  return (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
}

interface TagSets {
  fuel: Set<number>; tool: Set<number>; weapon: Set<number>; clothing: Set<number>; container: Set<number>; building: Set<number>;
  metal: Set<number>; luxury: Set<number>; boat: Set<number>; medicine: number; coin: number;
}
const tagCache = new WeakMap<object, TagSets>();
function tags(x: PCtx): TagSets {
  let t = tagCache.get(x.c);
  if (!t) {
    const set = (...names: string[]) => { const s = new Set<number>(); for (const n of names) for (const i of x.c.itemsByTag.get(n) ?? []) s.add(i); return s; };
    t = {
      fuel: set('fuel'), tool: set('tool'), weapon: set('weapon'), clothing: set('clothing'), container: set('container'),
      building: set('building', 'thatch'), metal: set('metal', 'alloy', 'ore'), luxury: set('luxury', 'precious'), boat: set('boat'),
      medicine: x.c.items.idx('medicine'), coin: x.c.items.idx('coin'),
    };
    tagCache.set(x.c, t);
  }
  return t;
}

/** inputs of the recipes a settlement knows (it wants a little of each in store) */
function knownInputs(x: PCtx, st: Settlement): Set<number> {
  const out = new Set<number>();
  for (const k of st.library) {
    const r = x.rt.list[k];
    if (r.kind !== 'craft') continue;
    for (const io of r.inputs) for (const it of io.items) out.add(it);
  }
  return out;
}

/** what a settlement would like to hold of every item (its demand), in units */
export function demandOf(x: PCtx, st: Settlement, out = new Float64Array(x.c.items.size)): Float64Array {
  const P = Math.max(1, popOf(x, st));
  const members = x.ps.members.get(st.id) ?? [];
  let adults = 0;
  for (const m of members) if (!(x.A.flags[m] & AgentFlag.child)) adults++;
  adults += st.cohort.n[1] + st.cohort.n[2];
  const T = tags(x);
  const sp = x.info[st.species];
  const cold = x.p.s.tempMean[st.cell] < sp.def.temp[1] + 4;
  const war = atWar(x, st);
  const inputs = knownInputs(x, st);
  const sick = st.recent.epidemic !== undefined;
  const coastal = !!st.res && st.res.fish.length > 0;
  for (let i = 0; i < out.length; i++) {
    let d = 0.5;
    if (sp.edible[i] > 0) d = 0; // food is priced as one need (below)
    else if (T.fuel.has(i)) d = 10 + P * 0.6;
    else if (T.weapon.has(i)) d = adults * (war ? 0.7 : 0.12);
    else if (T.tool.has(i)) d = adults * 0.4;
    else if (T.clothing.has(i)) d = cold ? P : P * 0.15;
    else if (T.container.has(i)) d = st.households.length + 1;
    else if (T.building.has(i)) d = 18 + st.sites.length * 10;
    else if (T.boat.has(i)) d = coastal ? 1.5 : 0;
    else if (T.metal.has(i)) d = inputs.has(i) ? 10 : 2;
    else if (T.luxury.has(i)) d = P * 0.15;
    else if (i === T.medicine) d = sick ? P * 0.3 : 2;
    else if (inputs.has(i)) d = 6;
    out[i] = d;
  }
  return out;
}

const _dem = new Float64Array(512);

/** local prices (value units per unit): scarcity against demand; food as one need; what they cannot make costs more */
export function pricesOf(x: PCtx, st: Settlement, out = new Float64Array(x.c.items.size)): Float64Array {
  const dem = demandOf(x, st, _dem.length >= x.c.items.size ? _dem.subarray(0, x.c.items.size) : new Float64Array(x.c.items.size));
  const P = Math.max(1, popOf(x, st));
  const sp = x.info[st.species];
  const foodScarcity = Math.min(6, Math.max(0.25, Math.pow((P * 8 + 1) / (foodDays(x, st) + 1), 0.8)));
  for (let i = 0; i < out.length; i++) {
    const it = x.c.items.list[i];
    const v = Math.max(0.02, it.value);
    if (sp.edible[i] > 0) { out[i] = v * foodScarcity; continue; }
    const stock = st.store[i] ?? 0;
    let p = Math.min(5, Math.max(0.25, Math.pow((dem[i] + 1) / (stock + 1), 0.7)));
    if (!canMake(x, st, i)) p *= 1.25;
    out[i] = v * p;
  }
  return out;
}

/** can the settlement gather or make this item itself */
export function canMake(x: PCtx, st: Settlement, it: number): boolean {
  if (st.res && (st.res.items[String(it)]?.length ?? 0) > 0) return true;
  for (const k of x.rt.producers[it] ?? []) if (st.library.includes(k)) return true;
  return false;
}

/** surplus of an item beyond what the settlement wants to keep */
function surplus(x: PCtx, st: Settlement, i: number, dem: Float64Array, foodSpare: number): number {
  const have = st.store[i] ?? 0;
  if (have <= 0) return 0;
  if (x.info[st.species].edible[i] > 0) return Math.max(0, Math.min(have * 0.5, foodSpare / Math.max(0.05, x.info[st.species].edible[i])));
  if (x.c.items.list[i].tags.includes('vehicle')) return 0;
  return Math.max(0, have - dem[i] * 1.2 - 1);
}

/** how much a settlement lacks of an item (units below its demand; food by days) */
function deficit(x: PCtx, st: Settlement, i: number, dem: Float64Array, foodLack: number): number {
  if (x.info[st.species].edible[i] > 0) return foodLack / Math.max(0.05, x.info[st.species].edible[i]);
  return Math.max(0, dem[i] - (st.store[i] ?? 0));
}

export interface TradePlan {
  out: [number, number][];
  back: [number, number][];
  value: number;
}

/** what a trip from `a` to `b` would carry each way (barter: the smaller side sets the value) */
export function tradePlan(x: PCtx, a: Settlement, b: Settlement, capacity: number, own?: { pa: Float64Array; da: Float64Array }): TradePlan {
  const n = x.c.items.size;
  // (`own`: a's prices and demand, computed once by planTrade for all its partners — SIM perf push 3; the same values)
  const pa = own ? own.pa : pricesOf(x, a), pb = pricesOf(x, b);
  const da = own ? own.da : demandOf(x, a), db = demandOf(x, b);
  const Pa = Math.max(1, popOf(x, a)), Pb = Math.max(1, popOf(x, b));
  const spareA = foodDays(x, a) - Pa * 8, spareB = foodDays(x, b) - Pb * 8;
  const lackA = Math.max(0, -spareA), lackB = Math.max(0, -spareB);
  const outs: [number, number, number][] = [], backs: [number, number, number][] = [];
  // a monopoly is guarded: iron, copper, tin, coal are not sold to a people one does not trust
  const ra = relationOf(x, a.polity, b.polity);
  const trustAB = a.polity === b.polity || (!!ra && ra.op[ra.a === a.polity ? 0 : 1] >= 0);
  const trustBA = a.polity === b.polity || (!!ra && ra.op[ra.a === b.polity ? 0 : 1] >= 0);
  for (let i = 0; i < n; i++) {
    const guarded = strategicItem(x, i);
    // a different species eats different things: food only goes where it is food
    const sa = guarded && !trustAB ? 0 : surplus(x, a, i, da, Math.max(0, spareA));
    if (sa > 0.5 && pb[i] > pa[i] * 1.35) {
      const want = deficit(x, b, i, db, lackB);
      const q = Math.min(sa, Math.max(want, x.info[b.species].edible[i] > 0 || db[i] > 0.6 ? want : 0));
      if (q > 0.5) outs.push([i, q, (pa[i] + pb[i]) / 2]);
    }
    const sb = guarded && !trustBA ? 0 : surplus(x, b, i, db, Math.max(0, spareB));
    if (sb > 0.5 && pa[i] > pb[i] * 1.35) {
      const q = Math.min(sb, deficit(x, a, i, da, lackA));
      if (q > 0.5) backs.push([i, q, (pa[i] + pb[i]) / 2]);
    }
  }
  // most valuable first, within what the caravan can carry (weight)
  const pick = (l: [number, number, number][]): { list: [number, number][]; value: number } => {
    l.sort((p, q) => q[1] * q[2] - p[1] * p[2] || p[0] - q[0]);
    let w = capacity, value = 0;
    const list: [number, number][] = [];
    for (const [i, q, v] of l) {
      if (list.length >= 3) break;
      const wt = Math.max(0.05, x.c.items.list[i].weight);
      const take = Math.min(q, w / wt);
      if (take < 0.5) continue;
      const qq = Math.round(take * 100) / 100;
      list.push([i, qq]);
      value += qq * v;
      w -= qq * wt;
    }
    return { list, value };
  };
  const o = pick(outs), bk = pick(backs);
  // barter balances: with money on both sides a one-sided trade can still be paid for
  const money = knowsId(x, a, 'money') && knowsId(x, b, 'money');
  const value = money ? Math.max(Math.min(o.value, bk.value), Math.max(o.value, bk.value) * 0.5) : Math.min(o.value, bk.value);
  return { out: o.list, back: bk.list, value };
}

function knowsId(x: PCtx, st: Settlement, id: string): boolean {
  const k = x.rt.byId.get(id);
  return k !== undefined && st.library.includes(k);
}

/** a standing market */
export function hasMarket(x: PCtx, st: Settlement): boolean {
  return x.ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'market');
}

/** weight a trader carries (carts double it, a market's porters too) */
function carry(x: PCtx, st: Settlement): number {
  let m = 14 * libraryEffect(x, st, 'haul');
  if (hasMarket(x, st)) m *= 1.5;
  return m;
}

// ───────────────────────────── daily: trade, gifts, tribute, theft ─────────────────────────────

/** once a day per settlement */
export function economyDaily(x: PCtx, st: Settlement): void {
  if (st.band || st.fallen >= 0) return;
  st.traded = Math.round((st.traded ?? 0) * 0.97 * 1000) / 1000;
  const members = x.ps.members.get(st.id) ?? [];
  if (members.length < 5) return;
  planTrade(x, st);
  giveToKin(x, st);
  payTribute(x, st);
  theft(x, st);
}

function busy(x: PCtx, st: Settlement, kind: Mission['kind']): boolean {
  for (const m of x.ps.missions) if (m.from === st.id && m.kind === kind && m.phase < 3) return true;
  return false;
}

/** the best trading partner within reach, and a caravan to it */
export function planTrade(x: PCtx, st: Settlement): Mission | null {
  if (busy(x, st, 'trade')) return null;
  if (st.recent.closed !== undefined && x.tick - st.recent.closed < x.year) return null;
  const members = x.ps.members.get(st.id) ?? [];
  const traders = Math.min(4, Math.max(1, Math.floor(members.length / 12)) + (hasMarket(x, st) ? 1 : 0));
  const cap = carry(x, st) * traders;
  let best: Settlement | null = null, bv = 1.2, bp: TradePlan | null = null;
  let own: { pa: Float64Array; da: Float64Array } | undefined;
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band || o.id === st.id) continue;
    if (atWarWith(x, st, o)) continue;
    const rel = relationOf(x, st.polity, o.polity);
    if (rel && rel.op[rel.a === st.polity ? 0 : 1] < -0.35) continue;
    // a caravan walks ~15 m an hour: beyond a few days' walk (or sail) it is not worth the road
    const d = distM(x.p, st.pos, o.pos);
    if (d > 4500) continue;
    if (!own) own = { pa: pricesOf(x, st), da: demandOf(x, st) };
    const plan = tradePlan(x, st, o, cap, own);
    // the way there costs: far trips need more to be worth it; a market at the other end draws trade
    const v = plan.value / (1 + d / 700) * (hasMarket(x, o) ? 1.4 : 1) * (rel?.treaties.includes('trade-pact') ? 1.3 : 1);
    if (v > bv) { bv = v; best = o; bp = plan; }
  }
  if (!best || !bp || !bp.out.length) return null;
  const route = routeBetween(x, st, best);
  if (!route.land && !route.sea) return null;
  if (!route.land && bestBoat(x, st) < 0) { st.recent.wantBoat = x.tick; return null; }
  // on foot no further than ~1.8 km; boats go further (they sail at two to three times a walk)
  if (route.land && route.dist > 1800) return null;
  if (!route.land && route.dist > 4500) return null;
  const who = volunteers(x, st, traders, false);
  if (!who.length) return null;
  const m = newMission(x, 'trade', st, best, who, bp.out);
  if (m) m.back = bp.back;
  return m;
}

function atWarWith(x: PCtx, a: Settlement, b: Settlement): boolean {
  const r = relationOf(x, a.polity, b.polity);
  return !!r && r.war >= 0;
}

/** a trader barters at the other's store: puts down what was brought, takes what home needs, value for value */
export function tradeExchange(x: PCtx, s: number, m: Mission, to: Settlement): void {
  const A = x.A;
  const from = x.ps.settlement(m.from);
  if (!from) return;
  const pa = pricesOf(x, from), pb = pricesOf(x, to);
  const outIds = new Set(m.out.map(([i]) => i));
  let credit = 0;
  const brought: string[] = [];
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it < 0 || !outIds.has(it)) continue;
    const q = A.invQty[s * INV + k];
    storeAdd(x, to, it, q);
    credit += q * (pa[it] + pb[it]) / 2;
    A.invItem[s * INV + k] = -1;
    A.invQty[s * INV + k] = 0;
    brought.push(x.c.items.list[it].name.toLowerCase());
  }
  const delivered = credit;
  // what home needs, as far as the credit reaches (the other keeps what it needs itself)
  const db = demandOf(x, to);
  const share = Math.max(1, m.members.length);
  for (const [it, want] of m.back) {
    if (credit <= 0.01) break;
    const price = (pa[it] + pb[it]) / 2;
    const spare = Math.max(0, (to.store[it] ?? 0) - db[it] * 1.1);
    const q = Math.min(want / share * 1.5, spare, credit / Math.max(0.01, price));
    if (q < 0.2) continue;
    const got = storeTake(to, it, q);
    if (got <= 0) continue;
    const left = A.give(s, it, got);
    if (left > 0) { storeAdd(x, to, it, left); credit -= (got - left) * price; break; }
    credit -= got * price;
  }
  // money settles what barter could not
  const coin = tags(x).coin;
  if (credit > 0.5 && coin >= 0 && knowsId(x, from, 'money') && knowsId(x, to, 'money') && storeHas(to, coin) >= 1) {
    const c = storeTake(to, coin, Math.min(storeHas(to, coin), credit / Math.max(0.01, x.c.items.list[coin].value)));
    A.give(s, coin, c);
  }
  // the value that changed hands (the mission's tally)
  m.strength = Math.round((m.strength + delivered) * 100) / 100;
  // ideas travel with trade: an easy thing the hosts know, if the trader can grasp it
  const members = x.ps.members.get(to.id) ?? [];
  if (members.length && hashFloat(A.id[s], to.id, x.tick, 0x1dea) < 0.35) {
    const host = members[hash32(A.id[s], x.tick, 0x1deb) % members.length];
    const kw = A.kw;
    for (let w = 0; w < kw; w++) {
      const diff = A.know[host * kw + w] & ~A.know[s * kw + w];
      if (!diff) continue;
      for (let b = 0; b < 32; b++) {
        if (!(diff & (1 << b))) continue;
        const k = w * 32 + b;
        const r = x.rt.list[k];
        if (!r || r.teach > 0.5 || to.secrets.includes(k) || isTaboo(x, from, A.species[s], k)) continue;
        if (r.species && !r.species.includes(A.species[s])) continue;
        if (!hasPrereqs(r, A.know, s * kw, kw)) continue;
        if (learn(x, s, k, 'talk')) { from.recent.tradeIdea = x.tick; w = kw; break; }
      }
    }
  }
  A.remember(s, MEMK.traded, x.tick, to.id);
}

/** a caravan's business is done: relations, the chronicle, accidents of trade */
export function tradeDone(x: PCtx, m: Mission, from: Settlement, to: Settlement): void {
  const value = Math.max(0, m.strength);
  from.traded = Math.round(((from.traded ?? 0) + value) * 1000) / 1000;
  to.traded = Math.round(((to.traded ?? 0) + value) * 1000) / 1000;
  const r = relationOf(x, from.polity, to.polity);
  if (r) {
    r.trade = Math.round((r.trade + value) * 1000) / 1000;
    r.op[0] = Math.min(1, r.op[0] + 0.03);
    r.op[1] = Math.min(1, r.op[1] + 0.03);
  }
  accident(x, from, 'trade', from.cell);
  accident(x, to, 'trade', to.cell);
  // the first trade between two peoples is remembered
  const key = `trade:${Math.min(from.id, to.id)}:${Math.max(from.id, to.id)}`;
  if (x.ps.firsts[key] === undefined && value > 0) {
    x.ps.firsts[key] = x.tick;
    const goods = m.out.map(([i]) => x.c.items.list[i].name.toLowerCase()).slice(0, 2).join(' and ') || 'gifts';
    const back = m.back.map(([i]) => x.c.items.list[i].name.toLowerCase()).slice(0, 2).join(' and ') || 'stories';
    tell(x.u, x.p, m.sea ? 'trade.sea' : 'trade.first', vars(x, from, -1, { other: to.name, goods, back }), from, [settlementRef(x, from), settlementRef(x, to)]);
  }
  x.u.emit({ t: 'trade', planet: x.p.id, pos: [to.pos[0], to.pos[1], to.pos[2]], a: Math.round(value * 10) / 10, ref: settlementRef(x, to), data: { from: from.id, to: to.id, sea: m.sea } });
}

/** a settlement with food to spare sends some to kin or friends who starve */
function giveToKin(x: PCtx, st: Settlement): void {
  if (busy(x, st, 'gift')) return;
  const P = Math.max(1, popOf(x, st));
  const spare = foodDays(x, st) - P * 10;
  if (spare < 20) return;
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band) continue;
    const Po = Math.max(1, popOf(x, o));
    if (foodDays(x, o) > Po * 1.2 || o.stats.starved - (o.recent.starvedGift ?? 0) < 1) continue;
    const kin = o.polity === st.polity;
    const rel = relationOf(x, st.polity, o.polity);
    const fond = kin || (rel && rel.op[rel.a === st.polity ? 0 : 1] > 0.35);
    if (!fond || (rel && rel.war >= 0)) continue;
    const food = x.info[st.species].foods.find((i) => (st.store[i] ?? 0) > 2 && x.info[o.species].edible[i] > 0);
    if (food === undefined) continue;
    const q = Math.min(st.store[food] * 0.4, spare * 0.5 / Math.max(0.05, x.info[st.species].edible[food]));
    const who = volunteers(x, st, Math.min(3, Math.ceil(q / 15)), false);
    if (!who.length) return;
    const m = newMission(x, 'gift', st, o, who, [[food, Math.round(q * 100) / 100]]);
    if (m) {
      o.recent.starvedGift = o.stats.starved;
      tell(x.u, x.p, 'gift.kin', vars(x, st, -1, { other: o.name, item: x.c.items.list[food].name.toLowerCase() }), st, [settlementRef(x, st), settlementRef(x, o)]);
    }
    return;
  }
}

/** a vassal's capital sends tribute to its overlord every few days */
function payTribute(x: PCtx, st: Settlement): void {
  const pol = polityOf(x, st);
  if (!pol || pol.overlord < 0 || pol.capital !== st.id) return;
  if (st.recent.paid !== undefined && x.tick - st.recent.paid < 3 * x.day) return;
  if (busy(x, st, 'tribute')) return;
  const lord = x.ps.polity(pol.overlord);
  const cap = lord ? x.ps.settlement(lord.capital) : undefined;
  if (!cap || cap.fallen >= 0) { pol.overlord = -1; return; }
  // a tenth of what they have of value: food first, then metal and finery
  const goods: [number, number][] = [];
  const order = [...x.info[st.species].foods.filter((i) => x.info[cap.species].edible[i] > 0), ...(x.c.itemsByTag.get('metal') ?? []), ...(x.c.itemsByTag.get('luxury') ?? [])];
  for (const it of order) {
    const q = Math.floor((st.store[it] ?? 0) * 0.1 * 100) / 100;
    if (q >= 1 && !goods.some(([i]) => i === it)) goods.push([it, q]);
    if (goods.length >= 3) break;
  }
  st.recent.paid = x.tick;
  if (!goods.length) return;
  const route = routeBetween(x, st, cap);
  const who = volunteers(x, st, 2, false);
  if ((route.land || (route.sea && bestBoat(x, st) >= 0)) && who.length) {
    newMission(x, 'tribute', st, cap, who, goods);
    return;
  }
  // no way there for bearers: the overlord's men come and take it
  for (const [it, q] of goods) { const got = storeTake(st, it, q); storeAdd(x, cap, it, got); }
}

/** hungry people of a lean settlement may steal from a fat neighbour; caught thieves are punished */
function theft(x: PCtx, st: Settlement): void {
  const P = Math.max(1, popOf(x, st));
  if (foodDays(x, st) > P * 1.2) return;
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  // the boldest hungry hand
  let thief = -1, tv = 0.55;
  for (const m of members) {
    if (A.flags[m] & AgentFlag.child || A.mission[m]) continue;
    const v = A.traits[m * NT + TRAIT.aggression] * 0.7 + A.traits[m * NT + TRAIT.boldness] * 0.3 + (1 - A.needs[m * 12]) * 0.4;
    if (v > tv) { tv = v; thief = m; }
  }
  if (thief < 0) return;
  let target: Settlement | null = null, best = 4;
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band || o.polity === st.polity) continue;
    if (distM(x.p, st.pos, o.pos) > 1800) continue;
    const per = foodDays(x, o) / Math.max(1, popOf(x, o));
    if (per > best) { best = per; target = o; }
  }
  if (!target || hashFloat(A.id[thief], x.tick, 0x7e1f) > 0.25 * tv) return;
  const food = x.info[target.species].foods.find((i) => (target!.store[i] ?? 0) > 2 && x.info[st.species].edible[i] > 0);
  if (food === undefined) return;
  const caught = hashFloat(A.id[thief], target.id, x.tick, 0x7e20) < 0.35;
  const name = agentName(x, thief);
  const v = vars(x, st, thief, { other: target.name, item: x.c.items.list[food].name.toLowerCase() });
  if (caught) {
    grieve(x, target.polity, st.polity, 0.25);
    A.remember(thief, MEMK.stole, x.tick, target.id);
    const harsh = target.culture.alignment < -0.2;
    if (harsh) {
      tell(x.u, x.p, 'theft.punished', v, target, [agentRef(x, thief), settlementRef(x, target)]);
      die(x, thief, DEATH.punished);
    } else {
      A.health[thief] = Math.max(0.1, A.health[thief] - 0.3);
      A.remember(thief, MEMK.wounded, x.tick, target.id);
      if (x.ps.firsts[`theft:${st.id}:${target.id}`] === undefined) {
        x.ps.firsts[`theft:${st.id}:${target.id}`] = x.tick;
        tell(x.u, x.p, 'theft.caught', v, target, [agentRef(x, thief), settlementRef(x, target)]);
      }
    }
    void name;
    return;
  }
  const q = Math.min(target.store[food] * 0.08, P * 2 / Math.max(0.05, x.info[st.species].edible[food]));
  const got = storeTake(target, food, q);
  storeAdd(x, st, food, got);
  grieve(x, target.polity, st.polity, 0.08);
  A.remember(thief, MEMK.stole, x.tick, target.id);
  x.u.emit({ t: 'theft', planet: x.p.id, pos: [target.pos[0], target.pos[1], target.pos[2]], a: got, ref: agentRef(x, thief), data: { from: target.id, to: st.id } });
}

/** a settlement's role for traders in its quota (assignRoles reads it) */
export function traderQuota(x: PCtx, st: Settlement): number {
  let n = 0;
  for (const m of x.ps.missions) if (m.from === st.id && (m.kind === 'trade' || m.kind === 'gift' || m.kind === 'tribute')) n += m.members.length;
  return n;
}

export { ROLE };
