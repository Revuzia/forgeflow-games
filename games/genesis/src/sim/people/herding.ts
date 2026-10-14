// GENESIS — LIVING LAND (LIVING.md §2.2): taming and herding — the first herd, and the herds that follow.
//
// The deadlock it breaks: only herders tamed, and a herder was named only for a herd already owned — no people ever
// got its first herd. Now a settlement that knows animal husbandry (or dog taming) names ONE HERDER as soon as it owns a
// herd, or a beast people can tame lives within hunting range, or a hunt brought young home (and one more for each ~15
// head it keeps). The herder tames a wild herd of such a species within hunting range (a trip, with a camp) or keeps the
// settlement's own: out to pasture by day and penned at night (life/ecology.ts moveDomestic), milked, shorn and their
// eggs taken — what a herd gives accrues by the day and is taken when the herder comes. YOUNG FROM THE HUNT: a kill of a
// species people can tame brings 1-2 young home with p = 0.25 (people/hunt.ts) — a herd of its domestic form, the
// oldest road to the first herd. Beasts beyond what the pens and pasture hold are slaughtered (and one now and then in
// lean times). The chronicle tells the first herd and the first milk; the books keep tames, products and slaughter.

import type { PCtx } from './ctx.ts';
import type { Herd, Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import type { AnimalDef } from '../content.ts';
import { hashFloat } from '../core/rng.ts';
import { NS, SKILL, TASK } from './defs.ts';
import { animalDef, herdPos, spawnHerd } from '../life/herds.ts';
import { libHas, accident } from './knowledge.ts';
import { foodDays, storeAdd } from './store.ts';
import { practise } from './lifecycle.ts';
import { distM, offsetPoint } from './world.ts';
import { tell } from './story.ts';
import { emitSt, settlementRef, vars } from './util.ts';
import { addFood, bump, landOf, ledger } from './ledger.ts';
import { carcass, huntRange } from './hunt.ts';
import { cohortTotal } from './cohorts.ts';

/** what a head of livestock gives a day, × its animals.json product quantity (milk is the daily yield of a dairy beast,
 * eggs a hen's lay; wool and the like are the year's clip, spread over the year) */
const DAILY: Record<string, number> = { milk: 1.5, eggs: 0.6 };

const _p = [0, 0, 0];
const _q = [0, 0, 0];

/** does st know how to keep beasts (animal husbandry, or dog taming) */
export function keepsBeasts(x: PCtx, st: Settlement): boolean {
  const hu = x.rt.byId.get('animal-husbandry'), dog = x.rt.byId.get('dog-taming');
  return (hu !== undefined && libHas(st, hu)) || (dog !== undefined && libHas(st, dog));
}

/** a species people of st could tame into the domestic form they know how to keep */
function tameable(x: PCtx, st: Settlement, a: AnimalDef): boolean {
  if (!a.domesticable || !a.domesticatesTo || a.domestic) return false;
  // dog taming alone tames only wolves (to dogs); animal husbandry tames the rest
  const hu = x.rt.byId.get('animal-husbandry');
  if (hu !== undefined && libHas(st, hu)) return true;
  return a.domesticatesTo === 'dog';
}

/** the herds st keeps */
export function ownHerds(x: PCtx, st: Settlement): Herd[] {
  const out: Herd[] = [];
  for (const h of x.ps.herds) if (h.owner === st.id && h.count >= 0.5) out.push(h);
  return out;
}

/** the nearest wild herd within hunting range that st could tame (null none) */
export function wildToTame(x: PCtx, st: Settlement, from: ArrayLike<number> = st.pos): Herd | null {
  const P = x.p.grid.pos, R = x.p.st.radius;
  const range = huntRange(st);
  let best: Herd | null = null, bd = Infinity;
  for (const h of x.ps.herds) {
    if (h.owner >= 0 || h.count < 2) continue;
    const a = animalDef(x, h.species);
    if (!tameable(x, st, a)) continue;
    const hc = h.cell;
    const dHome = Math.acos(Math.min(1, P[hc * 3] * st.pos[0] + P[hc * 3 + 1] * st.pos[1] + P[hc * 3 + 2] * st.pos[2])) * R;
    if (dHome > range) continue;
    const d = Math.acos(Math.min(1, P[hc * 3] * from[0] + P[hc * 3 + 1] * from[1] + P[hc * 3 + 2] * from[2])) * R;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

/** herders wanted (settlement.ts assignRoles): one once beasts can be kept and there is a herd to keep or to tame, and
 * one more for each 15 head kept */
export function herderQuota(x: PCtx, st: Settlement): number {
  if (!keepsBeasts(x, st)) return 0;
  const own = ownHerds(x, st);
  if (own.length) {
    let head = 0;
    for (const h of own) head += h.count;
    return 1 + Math.floor(head / 15);
  }
  return wildToTame(x, st) ? 1 : 0;
}

/**
 * The herder's work (decide.ts planHerd): the settlement's own herd that has waited longest for its herder, else a wild
 * herd within hunting range to tame. Null: nothing to keep or tame.
 */
export function herdTask(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  if (!keepsBeasts(x, st)) return null;
  const A = x.A;
  const L = landOf(st);
  let best: Herd | null = null, bt = Infinity;
  for (const h of ownHerds(x, st)) {
    const t = L.milked[String(h.id)] ?? -1;
    if (t < bt || (t === bt && best && h.id < best.id)) { bt = t; best = h; }
  }
  if (best) {
    herdPos(best, x.tick, _q);
    const goal = offsetPoint(_q, 4 + 6 * hashFloat(A.id[s], x.tick, 0x4e1), hashFloat(A.id[s], 0x4e2) * 6.283, x.p.st.radius, [0, 0, 0]);
    return { kind: TASK.herd, goal, goalCell: x.p.cellAt(goal), work: 180, target: best.id, data2: 0 };
  }
  A.posAt(s, x.tick, _p);
  const w = wildToTame(x, st, _p);
  if (!w) return null;
  herdPos(w, x.tick, _q);
  return { kind: TASK.herd, goal: [_q[0], _q[1], _q[2]], goalCell: x.p.cellAt(_q), work: 150, target: w.id, data2: 1 };
}

/** the end of a herder's session (work.ts, TASK.herd): taming a wild herd, or keeping the settlement's own */
export function herdWork(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  if (!st) return;
  const h = x.ps.herd(A.tTarget[s]);
  if (!h) return;
  const skill = A.skills[s * NS + SKILL.herd];
  if (A.tData2[s] === 1) {
    practise(x, s, SKILL.herd, 0.02);
    const a = animalDef(x, h.species);
    if (h.owner >= 0 || !tameable(x, st, a)) return;
    herdPos(h, x.tick, _q);
    A.posAt(s, x.tick, _p);
    if (distM(x.p, _p, _q) > 2.5 * x.p.edgeM) return; // it moved off
    if (hashFloat(A.id[s], h.id, x.tick, 0x7a3e) >= 0.12 + skill * 0.3) return;
    const dom = x.c.animals.idx(a.domesticatesTo!);
    if (dom < 0) return;
    h.species = dom;
    h.owner = st.id;
    h.count = Math.min(h.count, 6);
    h.state = 4;
    tamed(x, st, h, false);
    return;
  }
  if (h.owner !== st.id) return;
  practise(x, s, SKILL.herd, 0.015);
  const a = animalDef(x, h.species);
  const L = landOf(st);
  const key = String(h.id);
  const last = L.milked[key] ?? x.tick - x.day;
  const days = Math.min(1, Math.max(0, (x.tick - last) / x.day));
  L.milked[key] = x.tick;
  const row = ledger(x, st);
  const head = Math.min(h.count, 40);
  for (const io of a.products) {
    if (!io.item || io.item === 'meat' || io.item === 'hide' || io.item === 'bone' || io.item === 'fur') continue;
    const it = x.c.items.idx(io.item);
    if (it < 0) continue;
    const rate = DAILY[io.item] ?? 1 / 12;
    const q = Math.round(io.qty * head * rate * days * (0.7 + 0.6 * skill) * 100) / 100;
    if (q <= 0) continue;
    storeAdd(x, st, it, q);
    bump(row.herdProducts, io.item, q);
    addFood(x, st, 'herd', it, q);
    if (io.item === 'milk' && L.firsts.milk === undefined) {
      L.firsts.milk = x.tick;
      tell(x.u, x.p, 'herd.milk', vars(x, st, s, { animal: plural(a.name) }), st, [settlementRef(x, st)], 1);
    }
  }
  // beasts beyond what the pens and the pasture hold are slaughtered; in lean times one now and then
  const pens = x.ps.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'pen').length;
  const cap = 8 + pens * 10;
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
  const lean = foodDays(x, st) < pop * 1.5 && h.count > 6 && hashFloat(h.id, x.tick, 0xb07c) < 0.35;
  // the herd's increase: a breeding stock is kept (six head, or 60 % of what the pens hold) and what it breeds beyond
  // that is eaten — about a head a day while there is a surplus (a herd of pigs, which give no milk, otherwise fed nobody:
  // 16 head kept for five years and not one eaten). Dogs are kept, not eaten.
  const keep = Math.max(6, Math.round(cap * 0.6));
  const increase = a.id !== 'dog' && h.count >= keep + 1 && hashFloat(h.id, x.tick, 0xb07d) < days;
  const cull = h.count > cap ? Math.min(2, Math.floor(h.count - cap)) : lean || increase ? 1 : 0;
  if (cull > 0) slaughter(x, st, h, a, cull);
}

/** n head of herd h slaughtered: their meat, hides and bones to the store */
export function slaughter(x: PCtx, st: Settlement, h: Herd, a: AnimalDef, n: number): void {
  if (n <= 0 || h.count - n < 1) return;
  h.count -= n;
  const row = ledger(x, st);
  bump(row.slaughter, a.id, n);
  for (const g of carcass(a)) {
    const it = x.c.items.idx(g.item);
    if (it < 0) continue;
    const q = Math.round(g.qty * n * 100) / 100;
    storeAdd(x, st, it, q);
    bump(row.herdProducts, g.item, q);
    if (g.item === 'meat') addFood(x, st, 'herd', it, q);
  }
}

/**
 * Young brought home from a hunt (people/hunt.ts): n young of a species people can tame become (or join) a herd of its
 * domestic form kept by the settlement — penned if it has a pen, else kept by the hearths. Seeing it done may teach the
 * keeping of beasts (the 'tame-young' accident).
 */
export function youngFromHunt(x: PCtx, st: Settlement, a: AnimalDef, n: number): void {
  if (!a.domesticatesTo) return;
  const dom = x.c.animals.idx(a.domesticatesTo);
  if (dom < 0) return;
  st.recent['tame-young'] = x.tick;
  accident(x, st, 'tame-young', st.cell);
  for (const h of x.ps.herds) {
    if (h.owner === st.id && h.species === dom && h.count >= 0.5) { h.count += n; return; }
  }
  const pen = x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'pen');
  const h = spawnHerd(x, dom, pen ? pen.cell : st.cell, n, st.id);
  tamed(x, st, h, true);
}

/** a first herd of a species for st (the books; the chronicle tells a settlement's first herd) */
function tamed(x: PCtx, st: Settlement, h: Herd, young: boolean): void {
  const a = animalDef(x, h.species);
  bump(ledger(x, st).tames, a.id);
  st.recent['tame-young'] = x.tick;
  const L = landOf(st);
  emitSt(x, st, { t: 'tame', text: a.id, data: { settlement: st.id, species: a.id, herd: h.id, young } });
  if (L.firsts.herd === undefined) {
    L.firsts.herd = x.tick;
    tell(x.u, x.p, young ? 'herd.first.young' : 'herd.first', vars(x, st, -1, { animal: plural(a.name) }), st, [settlementRef(x, st)], 2);
  }
}

function plural(name: string): string {
  const n = name.toLowerCase();
  if (/(deer|sheep|bison|fish|cattle|swine|aurochs)$/.test(n)) return n;
  if (/(x|s|ch|sh)$/.test(n)) return n + 'es';
  if (/[^aeiou]y$/.test(n)) return n.slice(0, -1) + 'ies';
  return n + 's';
}
