// GENESIS — LIVING LAND (LIVING.md §2.6): materials drive gathering. A settlement's wants came from a short fixed list
// (fuel, the site's material, the inputs of jobs that could already run, a little of every raw input it knew) — a
// recipe whose inputs were missing never became a job, so its inputs were never really wanted: the census gathered 12
// kinds of thing over every seed together, no ore was smelted, no honey or resin brought in.
//
// Now wants come from SHORTFALLS, chained: what the settlement wants made — tools for its workers, spears for its hunters,
// clothes before the winter, containers, the material of its sites, ore it holds smelted, its raw food prepared, and
// now and then everything it knows (practice) — is followed down its recipes: an input short in the store is wanted from
// the land if it can be gathered, else the recipes that make it are followed in turn (wood → charcoal → smelting →
// tools; sand + charcoal → glass), up to three steps, each step wanting a little less. Fuel for a hot recipe is an input
// too. The result: items to gather (settlement.ts planWants takes the ones within reach, most wanted first) and the
// crafts in between to put on the job list when their own inputs are in (planJobs).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { ROLE } from './defs.ts';
import { storeAny, storeHas } from './store.ts';
import { libHas } from './knowledge.ts';
import { seasonTemps } from './settlement.ts';

/** the demand of a settlement: items to gather (item -> weight) and crafts to run on the way (recipe -> weight) */
export interface Demand {
  items: Map<number, number>;
  crafts: Map<number, number>;
}

/** how many of an input the store should hold before it is no longer wanted (× the recipe's quantity) */
const STOCK = 3;
/** how much less each step down a chain is wanted */
const STEP = 0.75;
/** the deepest chain followed */
const DEPTH = 3;

/**
 * The settlement's demand (settlement.ts planWants and planJobs). `gatherable` holds the items its people know how to
 * gather (from the land). Deterministic: roots in a fixed order, recipes in index order.
 */
export function wantChain(x: PCtx, st: Settlement, gatherable: ReadonlySet<number>): Demand {
  const out: Demand = { items: new Map(), crafts: new Map() };
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let adults = 0, hunters = 0;
  for (const m of members) { if (!(A.flags[m] & AgentFlag.child)) adults++; if (A.role[m] === ROLE.hunter) hunters++; }
  // what the settlement holds, by tag (store + tools in hand + clothes worn)
  const tagCount = new Map<string, number>();
  const bumpTag = (it: number, q: number) => { for (const t of x.c.items.list[it].tags) tagCount.set(t, (tagCount.get(t) ?? 0) + q); };
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0) bumpTag(i, st.store[i]);
  for (const m of members) { if (A.tool[m] >= 0) bumpTag(A.tool[m], 1); if (A.gear[m] >= 0) bumpTag(A.gear[m], 1); }
  const count = (tag: string) => tagCount.get(tag) ?? 0;
  const root = (tag: string, w: number) => {
    for (const it of x.c.itemsByTag.get(tag) ?? []) for (const k of x.rt.producers[it] ?? []) expand(x, st, k, w, 0, gatherable, out, new Set());
  };
  // tools for the workers, spears for the hunters, clothes before the cold, containers
  if (count('tool') < adults * 0.8) root('tool', 2);
  if (hunters > 0 && count('hunt') < hunters) root('hunt', 1.6);
  const sp = x.info[st.species].def;
  if (Math.min(x.p.s.tempMean[st.cell], seasonTemps(x, st.cell).winter) < sp.temp[1] + 4 && count('clothing') < members.length) root('clothing', 1.5);
  if (count('container') < Math.max(2, st.households.length)) root('container', 0.8);
  // the material of the sites
  for (const id of st.sites) {
    const b = x.ps.building(id);
    if (!b) continue;
    for (const io of x.c.materials.list[b.material].items) {
      const it = io.item ? x.c.items.idx(io.item) : -1;
      if (it < 0 || storeHas(st, it) >= io.qty * 4) continue;
      if (gatherable.has(it)) addItem(out, it, 3);
      for (const k of x.rt.producers[it] ?? []) expand(x, st, k, 2.5, 0, gatherable, out, new Set());
    }
  }
  // ore in store is smelted; raw food in store is prepared
  for (let i = 0; i < st.store.length; i++) {
    if (st.store[i] < 1) continue;
    const tags = x.c.items.list[i].tags;
    const ore = tags.includes('ore'), raw = tags.includes('raw') && tags.includes('food');
    if (!ore && !raw) continue;
    for (const r of x.rt.list) {
      if (r.kind !== 'craft' || !libHas(st, r.idx)) continue;
      if (!r.inputs.some((io) => io.items.includes(i))) continue;
      expand(x, st, r.idx, ore ? 2 : 0.8, 0, gatherable, out, new Set());
    }
  }
  // practice: everything they know, a little (in index order)
  for (const k of st.library) if (x.rt.list[k]?.kind === 'craft') expand(x, st, k, 0.3, DEPTH, gatherable, out, new Set());
  // a stock of every raw material a known craft takes, wanted the more the less of it is in store: a town with 700
  // stone and 1 200 wood in store went on fetching stone, wood, fibre and reeds (all it wanted) while flint, resin,
  // bark, honey and clay lay within reach and its crafts took them
  const target = STOCK_HEAD * Math.max(10, members.length);
  for (const k of st.library) {
    const r = x.rt.list[k];
    if (!r || r.kind !== 'craft') continue;
    for (const io of r.inputs) for (const it of io.items) if (gatherable.has(it)) addItem(out, it, (0.6 * target) / (target + storeHas(st, it)));
  }
  return out;
}

/** the stock of each raw material a settlement keeps, a head (wantChain: wanted at 0.6 when there is none, 0.3 at this) */
const STOCK_HEAD = 0.5;

/**
 * Which of a settlement's n wants (most wanted first) a gatherer turns to first (decide.ts planGather): rank i with a
 * chance ∝ 1 / (i + 1) — the most wanted most often, every want now and then (u: the agent's dice in [0, 1)).
 */
export function wantPick(u: number, n: number): number {
  if (n <= 1) return 0;
  let tot = 0;
  for (let i = 0; i < n; i++) tot += 1 / (i + 1);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += 1 / (i + 1) / tot; if (u < acc) return i; }
  return n - 1;
}

function addItem(d: Demand, it: number, w: number): void {
  if (w > (d.items.get(it) ?? 0)) d.items.set(it, w);
}

/** recipe k is wanted with weight w: its inputs short in the store are wanted, from the land or from their own recipes */
function expand(x: PCtx, st: Settlement, k: number, w: number, depth: number, gatherable: ReadonlySet<number>, d: Demand, seen: Set<number>): void {
  const r = x.rt.list[k];
  if (!r || r.kind !== 'craft' || !libHas(st, k) || seen.has(k)) return;
  seen.add(k);
  if (w > (d.crafts.get(k) ?? 0)) d.crafts.set(k, w);
  for (const io of r.inputs) {
    if (storeAny(st, io.items) >= io.qty * STOCK) continue;
    for (const it of io.items) {
      if (gatherable.has(it)) { addItem(d, it, w * 0.9); continue; }
      if (depth >= DEPTH) continue;
      for (const k2 of x.rt.producers[it] ?? []) expand(x, st, k2, w * STEP, depth + 1, gatherable, d, seen);
    }
  }
  // fuel for a hot recipe (smelting, firing): charcoal or wood
  if (r.hot && r.heat >= 300) {
    let fuel = 0;
    for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0 && (x.c.items.list[i].fuel ?? 0) >= 0.8) fuel += st.store[i];
    if (fuel < 6) {
      for (const it of x.c.itemsByTag.get('fuel') ?? []) {
        if ((x.c.items.list[it].fuel ?? 0) < 0.8) continue;
        if (gatherable.has(it)) addItem(d, it, w * 0.8);
        else if (depth < DEPTH) for (const k2 of x.rt.producers[it] ?? []) expand(x, st, k2, w * STEP, depth + 1, gatherable, d, seen);
      }
    }
  }
}
