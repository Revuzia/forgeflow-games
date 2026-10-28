// GENESIS — LIVING LAND (LIVING.md §2.10, §2.11): children's days, and the gatherings that make a settlement a people.
//
// CHILDREN wandered 17 % of their time, never played, did chores in one seed of six, and nobody raised them:
//   play     ages 2-10, near the hearth or home, with the other children (belonging, curiosity) — TASK.play
//   chores   ages 6-14: fetching water, firewood, picking berries near home, minding the herds by the village, and
//            following a parent to work (apprenticeship: the parent's craft is practised) — TASK.chore
//   raising  a parent feeds and carries an infant under two (TASK.raiseChild: the child fed from the store, both closer)
//   company  is sought within 100 m — someone at hand, the village hearth — not a member across the territory
// GATHERINGS of the settlement (TASK.gather; Settlement.land.gatherings), at the hearth or the shrine, in the evening:
//   festivals  two a settlement-year: the harvest feast (after the year's harvest, or late summer for those who do not
//              farm) and midwinter (in the tropics and on worlds without seasons: the rains) — everyone comes, they
//              dance (belonging, curiosity: the stories told; faith where they know the god)
//   weddings   the evening a couple forms (social.ts formCouple): the couple's kin and a few friends
//   funerals   the evening after a death at home: the dead's kin and about a third of the town mourn them
// At most one gathering line a settlement-year goes to the chronicle. The books count festivals and how many came,
// weddings held for the couples formed, and funerals held for the deaths at home.

import type { PCtx } from './ctx.ts';
import type { Settlement, Building } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import { AgentFlag, AnimState } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { MEMK, NS, NT, SKILL, TASK, TRAIT } from './defs.ts';
import { BELONG, CURIO, FAITH, FOOD, NEED_N, WATER } from './needs.ts';
import { distM, offsetPoint, spotInCell, ticksUntilSun } from './world.ts';
import { availability, itemIdx } from './resources.ts';
import { storeAdd } from './store.ts';
import { practise } from './lifecycle.ts';
import { tell } from './story.ts';
import { emitSt, settlementRef, vars } from './util.ts';
import { landOf, ledger, noteGathered, yearOf, type Gathering } from './ledger.ts';
import { curiosityGain } from './outlets.ts';
import { yearPhase } from './crops.ts';
import { ownHerds } from './herding.ts';
import { herdPos } from '../life/herds.ts';
import { reachOf, REACH_DAY } from '../perf/pace.ts';
import { libHas } from './knowledge.ts';

/** what a gathering task (TASK.gather) is, in its tData */
export const GATHER_KIND = { festival: 1, wedding: 2, funeral: 3 } as const;
/** how long a gathering lasts (ticks): a festival into the night, a wedding or funeral an evening */
const LASTS = { festival: 210, wedding: 150, funeral: 120 } as const;
/** company and playmates are sought within this (m) */
export const NEAR_M = 100;

const _p = [0, 0, 0];
const _q = [0, 0, 0];
const _r = [0, 0, 0];

// ───────────────────────────── where people gather ─────────────────────────────

/** the place of a gathering: the shrine or temple, else a lit hearth, else the centre */
function gatheringPlace(x: PCtx, st: Settlement, kind: string): { cell: number; pos: [number, number, number] } {
  let best: Building | null = null, bv = -1;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2) continue;
    const fn = x.c.buildings.list[b.type].function;
    const v = fn === 'temple' ? (kind === 'funeral' ? 3 : 2) : fn === 'hearth' ? (b.fuel > 0 ? 2.5 : 1) : -1;
    if (v > bv) { bv = v; best = b; }
  }
  if (best) return { cell: best.cell, pos: [best.pos[0], best.pos[1], best.pos[2]] };
  return { cell: st.cell, pos: [st.pos[0], st.pos[1], st.pos[2]] };
}

/**
 * The evening a gathering is held: early in the night it is now; else the next sunset, at least `ahead` ticks away (a
 * funeral is held the evening after the death, not an hour after it)
 */
function eveningAt(x: PCtx, st: Settlement, ahead: number): number {
  // (the next sunset: a couple that forms at night is wed the next evening — held at once, the town was asleep and one
  // wedding in four had nobody at it)
  let t = x.tick + ticksUntilSun(x.u, x.p, x.tick, st.pos, 'set', 6 * 60);
  if (t - x.tick < ahead) t += x.day;
  return t;
}

/** add a gathering (or join one of the same kind that evening): `about` the people it is for, `kin` theirs */
function schedule(x: PCtx, st: Settlement, kind: string, about: number[], at: number, kin: number[] = []): Gathering {
  const L = landOf(st);
  const fam = kind === 'wedding' || kind === 'funeral' ? kind : 'festival';
  for (const g of L.gatherings) {
    if (g.kind === kind && Math.abs(g.from - at) < 6 * 60) {
      for (const id of about) if (!g.about.includes(id)) g.about.push(id);
      if (kin.length) { g.kin ??= []; for (const id of kin) if (!g.kin.includes(id)) g.kin.push(id); }
      return g;
    }
  }
  const pl = gatheringPlace(x, st, kind);
  const g: Gathering = { kind, from: at, until: at + LASTS[fam as keyof typeof LASTS], cell: pl.cell, pos: pl.pos, about: about.slice(), came: [] };
  if (kin.length) g.kin = kin.slice().sort((a, b) => a - b);
  L.gatherings.push(g);
  L.gatherings.sort((a, b) => a.from - b.from || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return g;
}

/** a couple formed (social.ts formCouple): their wedding that evening */
export function weddingFor(x: PCtx, st: Settlement, a: number, b: number): void {
  if (st.band || st.fallen >= 0) return;
  ledger(x, st).couples++;
  const A = x.A, kin: number[] = [];
  for (const s of [a, b]) for (const id of [A.mother[s], A.father[s]]) if (id) kin.push(id);
  schedule(x, st, 'wedding', [A.id[a], A.id[b]], eveningAt(x, st, 0), kin);
}

/** a death at home (lifecycle.ts die, `kin` the dead's partner, parents and household): their funeral, the evening after */
export function funeralFor(x: PCtx, st: Settlement, id: number, kin: number[]): void {
  if (st.band || st.fallen >= 0) return;
  schedule(x, st, 'funeral', [id], eveningAt(x, st, 3 * 60), kin);
}

// ───────────────────────────── the settlement's calendar ─────────────────────────────

/**
 * Hourly (people/land.ts): festivals are announced in their season (once a settlement-year each); gatherings that are
 * over are counted in the books (and the year's first is told in the chronicle).
 */
export function gatheringsHourly(x: PCtx, st: Settlement): void {
  const L = landOf(st);
  if (st.band || st.fallen >= 0) { if (L.gatherings.length) L.gatherings = []; return; }
  const y = yearOf(x);
  const ph = yearPhase(x, st.cell);
  const frac = (x.tick % x.year) / x.year;
  const announced = (k: string) => L.gatherings.some((g) => g.kind === k);
  // the harvest feast: after the year's first harvest, or in late summer for a people that does not farm
  if (L.fest.harvest !== y && !announced('harvest')) {
    const row = ledger(x, st);
    let harvested = 0;
    for (const k in row.harvests) harvested += row.harvests[k];
    const ag = x.rt.byId.get('agriculture');
    const farms = ag !== undefined && libHas(st, ag) && st.fields.length > 0;
    const season = ph >= 0 ? ph >= 0.4 && ph <= 0.65 : frac >= 0.55 && frac <= 0.7;
    const late = ph >= 0 ? ph > 0.55 : frac > 0.62;
    if (season && (!farms || harvested > 0 || late)) { L.fest.harvest = y; schedule(x, st, 'harvest', [], eveningAt(x, st, 0)); }
  }
  // midwinter (the rains where the year has no winter)
  if (L.fest.winter !== y && !announced('midwinter') && !announced('rains')) {
    const season = ph >= 0 ? ph >= 0.72 && ph <= 0.9 : frac >= 0.15 && frac <= 0.3;
    if (season) { L.fest.winter = y; schedule(x, st, ph >= 0 ? 'midwinter' : 'rains', [], eveningAt(x, st, 0)); }
  }
  // what is over goes into the books
  if (!L.gatherings.length) return;
  const keep: Gathering[] = [];
  for (const g of L.gatherings) {
    if (x.tick <= g.until) { keep.push(g); continue; }
    closeGathering(x, st, g);
  }
  L.gatherings = keep;
}

function closeGathering(x: PCtx, st: Settlement, g: Gathering): void {
  const row = ledger(x, st);
  const L = landOf(st);
  const members = x.ps.members.get(st.id)?.length ?? 0;
  if (g.kind === 'wedding') { if (g.came.length >= 2) row.weddings += Math.max(1, Math.floor(g.about.length / 2)); return; }
  if (g.kind === 'funeral') { if (g.came.length >= 1) row.funerals += g.about.length; return; }
  row.festivals++;
  row.festivalAttend = Math.round((row.festivalAttend + g.came.length / Math.max(1, members)) * 1000) / 1000;
  const y = yearOf(x, g.from);
  if (L.told !== y && g.came.length >= 3) {
    L.told = y;
    // (a people without fire — sworn off it, or not keeping it yet — feasts without one: LIVING.md §9.1's note for LAND)
    tell(x.u, x.p, `festival.${g.kind}${fireless(x, st) ? '.nofire' : ''}`, vars(x, st, -1, { count: g.came.length }), st, [settlementRef(x, st)], 0);
  }
}

/** st keeps no fire: fire-making or fire-keeping is taboo there, or it does not know how to keep a fire */
export function fireless(x: PCtx, st: Settlement): boolean {
  const make = x.rt.byId.get('fire-making'), keep = x.rt.byId.get('fire-keeping');
  for (const k of st.culture.taboos) if (k === make || k === keep) return true;
  return keep === undefined || !libHas(st, keep);
}

/** the gathering agent s of st is called to now (it is on, or begins within the walk there), or null — their own (a
 * wedding or funeral of theirs or their kin) before one they are merely called to */
export function gatheringFor(x: PCtx, s: number, st: Settlement): Gathering | null {
  const L = st.land;
  if (!L || !L.gatherings.length) return null;
  const A = x.A, id = A.id[s];
  let best: Gathering | null = null, bv = 0;
  for (const g of L.gatherings) {
    if (x.tick > g.until - 20 || x.tick < g.from - 45) continue;
    if (g.came.includes(id)) continue;
    if (!invited(x, s, st, g)) continue;
    const v = g.about.includes(id) ? 3 : g.kin?.includes(id) ? 2 : 1;
    if (v > bv) { bv = v; best = g; }
  }
  return best;
}

/**
 * Ticks until the next gathering agent s is called to opens (Infinity: none). At 100x and 1000x a decision may stand for
 * hours of work (perf/plapse.ts stretches it to the next rival): decide.ts cuts the stretch here, so the agent decides
 * again when the gathering's evening comes (festivals there drew 65 % of the town, weddings went unattended).
 */
export function nextGathering(x: PCtx, s: number, st: Settlement): number {
  const L = st.land;
  if (!L || !L.gatherings.length) return Infinity;
  const id = x.A.id[s];
  for (const g of L.gatherings) {
    const open = g.from - 45;
    if (open <= x.tick || g.came.includes(id)) continue;
    if (invited(x, s, st, g)) return open - x.tick;
  }
  return Infinity;
}

/** is agent s called to gathering g: a festival everyone; a wedding or funeral its people's kin and some of the town */
function invited(x: PCtx, s: number, st: Settlement, g: Gathering): boolean {
  if (g.kind !== 'wedding' && g.kind !== 'funeral') return true;
  const A = x.A, id = A.id[s];
  if (g.about.includes(id) || g.kin?.includes(id)) return true;
  for (const o of g.about) {
    // their children, and (a wedding) their brothers and sisters and their households
    if (A.mother[s] === o || A.father[s] === o) return true;
    const os = A.slotOf(o);
    if (os >= 0 && (A.household[os] === A.household[s] || (A.mother[os] && A.mother[os] === A.mother[s]))) return true;
  }
  const share = g.kind === 'funeral' ? 0.32 : 0.25;
  return hashFloat(id, g.from, g.kind.length, 0x9a7) < share;
}

/** the gathering task for agent s (people/land.ts) */
export function gatherTask(x: PCtx, s: number, st: Settlement, g: Gathering): TaskSpec {
  const A = x.A;
  const r = g.kind === 'funeral' ? 4 + 8 * hashFloat(A.id[s], g.from, 0x9a8) : 3 + 10 * hashFloat(A.id[s], g.from, 0x9a8);
  const goal = offsetPoint(g.pos, r, hashFloat(A.id[s], g.from, 0x9a9) * Math.PI * 2, x.p.st.radius, [0, 0, 0]);
  const start = Math.max(x.tick, g.from);
  const kind = g.kind === 'wedding' ? GATHER_KIND.wedding : g.kind === 'funeral' ? GATHER_KIND.funeral : GATHER_KIND.festival;
  return { kind: TASK.gather, goal, goalCell: x.p.cellAt(goal), work: Math.max(30, g.until - start), data: kind, target: g.from };
}

/** the animation of a gathering task (tasks.ts beginWork): dancing, or mourning */
export function gatherAnim(kind: number): number {
  return kind === GATHER_KIND.funeral ? AnimState.mourn : AnimState.dance;
}

/** the end of a gathering task (work.ts): who came, and what it gave them */
export function gatherDone(x: PCtx, s: number, st: Settlement | undefined): void {
  if (!st) return;
  const A = x.A, nb = s * NEED_N, N = A.needs;
  const kind = A.tData[s];
  const g = st.land?.gatherings.find((q) => q.from === A.tTarget[s] && (kind === GATHER_KIND.funeral ? q.kind === 'funeral' : kind === GATHER_KIND.wedding ? q.kind === 'wedding' : q.kind !== 'funeral' && q.kind !== 'wedding'));
  if (g && !g.came.includes(A.id[s])) g.came.push(A.id[s]);
  N[nb + BELONG] = Math.min(1, N[nb + BELONG] + (kind === GATHER_KIND.festival ? 0.5 : 0.35));
  if (kind === GATHER_KIND.funeral) {
    N[nb + FAITH] = Math.min(1, N[nb + FAITH] + 0.2);
    A.remember(s, MEMK.mourned, x.tick, g?.about[0] ?? 0);
    return;
  }
  // a feast: the stories told (curiosity), and the god's name where they know it (faith)
  curiosityGain(x, s, 0.2);
  if (A.love[s * 4] > 0.1 || A.fear[s * 4] > 0.1) N[nb + FAITH] = Math.min(1, N[nb + FAITH] + 0.15);
  if (kind === GATHER_KIND.festival) A.remember(s, MEMK.festival, x.tick, g ? g.kind.length : 0);
}

/** a festival announced now: its start event (people/land.ts calls this when a gathering's evening begins) */
export function gatheringEvents(x: PCtx, st: Settlement, hours = 1): void {
  const L = st.land;
  if (!L) return;
  // (the settlement's round covers `hours` hours in a time-lapse window: every gathering begun in it is told once)
  for (const g of L.gatherings) {
    if (g.from > x.tick || g.from <= x.tick - 60 * Math.max(1, hours)) continue;
    const t = g.kind === 'wedding' ? 'wedding' : g.kind === 'funeral' ? 'funeral' : 'festival';
    emitSt(x, st, { t, text: g.kind, data: { settlement: st.id, kind: g.kind, about: g.about.slice(), cell: g.cell } });
  }
}

// ───────────────────────────── children ─────────────────────────────

/** what a child of `age` years may do: play (2-10), chores (6-14) */
export function canPlay(age: number): boolean { return age >= 2 && age < 10; }
export function canChore(age: number, maturity: number): boolean { return age >= 6 && age < Math.min(15, maturity); }

/** a child's play: near other children at play within reach, else by the hearth or home (TASK.play) */
export function playTask(x: PCtx, s: number, st: Settlement): TaskSpec {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  // other children at play nearby: join them
  let best = -1, bd = NEAR_M * 1.5;
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (m === s || A.task[m] !== TASK.play) continue;
    A.posAt(m, x.tick, _q);
    const d = distM(x.p, _p, _q);
    if (d < bd) { bd = d; best = m; }
  }
  let at: number[];
  if (best >= 0) { A.posAt(best, x.tick, _q); at = _q; }
  else {
    const home = x.ps.building(A.home[s]);
    const pl = gatheringPlace(x, st, 'play');
    at = home && home.progress >= 1 && hashFloat(A.id[s], x.tick, 0x91a) < 0.5 ? home.pos : pl.pos;
  }
  const goal = offsetPoint(at, 3 + 9 * hashFloat(A.id[s], x.tick, 0x91b), hashFloat(A.id[s], x.tick, 0x91c) * Math.PI * 2, x.p.st.radius, [0, 0, 0]);
  return { kind: TASK.play, goal, goalCell: x.p.cellAt(goal), work: 60 + Math.floor(hashFloat(A.id[s], x.tick, 0x91d) * 40) };
}

/** the end of play: company and the joy of it */
export function playDone(x: PCtx, s: number): void {
  const A = x.A, nb = s * NEED_N;
  A.needs[nb + BELONG] = Math.min(1, A.needs[nb + BELONG] + 0.3);
  curiosityGain(x, s, 0.08);
  practise(x, s, SKILL.fight, 0.002);
}

/** chore kinds (TASK.chore tData) */
export const CHORE = { water: 1, wood: 2, berries: 3, herd: 4, follow: 5 } as const;

/**
 * A chore for a child of 6-14 (TASK.chore): follow a parent at work nearby (apprenticeship), mind the herds by the
 * village, fetch firewood or pick berries within a short walk, fetch water. Null: nothing within reach.
 */
export function choreTask(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  const roll = hashFloat(A.id[s], Math.floor(x.tick / 120), 0xc40);
  // a parent at work within reach: go along and learn the work
  if (roll < 0.35) {
    for (const pid of [A.mother[s], A.father[s]]) {
      if (!pid) continue;
      const m = A.slotOf(pid);
      if (m < 0 || A.phase[m] !== 1 || !WORKS.has(A.task[m])) continue;
      A.posAt(m, x.tick, _q);
      if (distM(x.p, _p, _q) > 250) continue;
      const goal = offsetPoint(_q, 2 + 3 * hashFloat(A.id[s], x.tick, 0xc41), hashFloat(A.id[s], x.tick, 0xc42) * 6.283, x.p.st.radius, [0, 0, 0]);
      return { kind: TASK.chore, goal, goalCell: x.p.cellAt(goal), work: 90, data: CHORE.follow, target: A.id[m] };
    }
  }
  // the herds by the village
  if (roll < 0.55) {
    for (const h of ownHerds(x, st)) {
      herdPos(h, x.tick, _q);
      if (distM(x.p, _q, st.pos) > 300) continue;
      const goal = offsetPoint(_q, 4 + 6 * hashFloat(A.id[s], x.tick, 0xc43), hashFloat(A.id[s], x.tick, 0xc44) * 6.283, x.p.st.radius, [0, 0, 0]);
      return { kind: TASK.chore, goal, goalCell: x.p.cellAt(goal), work: 90, data: CHORE.herd, target: h.id };
    }
  }
  // firewood or berries close to home
  const wood = itemIdx(x, 'stick'), berry = itemIdx(x, 'berries');
  const want = roll < 0.75 ? wood : berry;
  if (want >= 0) {
    const c = nearHome(x, st, (c) => availability(x, want, c) > 0.12, s);
    if (c >= 0) return { kind: TASK.chore, goal: spotInCell(x.p, c, A.id[s], 0xc45, [0, 0, 0]), goalCell: c, work: 90, data: want === wood ? CHORE.wood : CHORE.berries, target: want };
  }
  // water for the household
  if (st.res && st.res.water.length) {
    const c = st.res.water[0];
    const P = x.p.grid.pos;
    _r[0] = P[c * 3]; _r[1] = P[c * 3 + 1]; _r[2] = P[c * 3 + 2];
    if (distM(x.p, _r, st.pos) < 250) return { kind: TASK.chore, goal: spotInCell(x.p, c, A.id[s], 0xc46, [0, 0, 0]), goalCell: c, work: 40, data: CHORE.water };
  }
  return null;
}

/** work a child may follow a parent to */
const WORKS = new Set<number>([TASK.forage, TASK.chop, TASK.fish, TASK.farm, TASK.herd, TASK.craft, TASK.build, TASK.cook, TASK.quarry, TASK.dig, TASK.repair, TASK.tendFire]);

/** the best cell around home within a child's reach (the settlement's cells within a day trip and 200 m) */
function nearHome(x: PCtx, st: Settlement, pred: (c: number) => boolean, s: number): number {
  const items = st.res?.items;
  if (!items) return -1;
  const P = x.p.grid.pos;
  let best = -1, bd = 200;
  for (const k in items) {
    for (const c of items[k]) {
      // distance first (pred and reachOf are pure, so testing them only for a nearer cell picks the same cell)
      _r[0] = P[c * 3]; _r[1] = P[c * 3 + 1]; _r[2] = P[c * 3 + 2];
      const d = distM(x.p, _r, st.pos);
      if (d >= bd || !pred(c) || reachOf(x, s, st, c) !== REACH_DAY) continue;
      bd = d; best = c;
    }
  }
  return best;
}

/** the end of a chore: a little firewood or berries for the store, the parent's work learned, water fetched */
export function choreDone(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A, nb = s * NEED_N;
  const kind = A.tData[s];
  A.needs[nb + BELONG] = Math.min(1, A.needs[nb + BELONG] + 0.06);
  if (!st) return;
  if (kind === CHORE.water) { A.needs[nb + WATER] = 1; return; }
  if (kind === CHORE.wood || kind === CHORE.berries) {
    const it = A.tTarget[s];
    const av = availability(x, it, A.cell[s]);
    if (av <= 0.02) return;
    const units = Math.round((kind === CHORE.wood ? 1.5 : 2.5) * Math.min(1, av) * (0.6 + A.skills[s * NS + SKILL.gather]) * 100) / 100;
    storeAdd(x, st, it, units);
    noteGathered(x, st, it, units, !!x.c.items.list[it].food);
    practise(x, s, SKILL.gather, 0.01);
    return;
  }
  if (kind === CHORE.herd) { practise(x, s, SKILL.herd, 0.01); return; }
  if (kind === CHORE.follow) {
    const m = A.slotOf(A.tTarget[s]);
    curiosityGain(x, s, 0.12);
    if (m < 0) return;
    // the work watched is the work learned: the parent's skill at it
    const sk = SKILL_OF[A.task[m]];
    if (sk !== undefined) practise(x, s, sk, 0.02);
  }
}

const SKILL_OF: Record<number, number> = {
  [TASK.forage]: SKILL.gather, [TASK.chop]: SKILL.gather, [TASK.fish]: SKILL.fish, [TASK.farm]: SKILL.farm, [TASK.herd]: SKILL.herd,
  [TASK.craft]: SKILL.craft, [TASK.build]: SKILL.build, [TASK.cook]: SKILL.cook, [TASK.quarry]: SKILL.gather, [TASK.dig]: SKILL.gather,
  [TASK.repair]: SKILL.build, [TASK.tendFire]: SKILL.cook,
};

// ───────────────────────────── raising the little ones ─────────────────────────────

/** an infant (under 2) of agent s's household who is hungry or alone — whom s should tend (slot, or -1) */
export function infantToRaise(x: PCtx, s: number, st: Settlement): number {
  const A = x.A;
  if (A.flags[s] & AgentFlag.child) return -1;
  const id = A.id[s];
  let best = -1, bv = 0.75;
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.mother[m] !== id && A.father[m] !== id) continue;
    if ((x.tick - A.birth[m]) / x.year >= 2) continue;
    const v = Math.min(A.needs[m * NEED_N + FOOD], A.needs[m * NEED_N + BELONG] + 0.2);
    if (v < bv) { bv = v; best = m; }
  }
  return best;
}

/** raising: the parent goes to the infant (TASK.raiseChild) */
export function raiseTask(x: PCtx, s: number, infant: number): TaskSpec {
  const A = x.A;
  A.posAt(infant, x.tick, _q);
  const goal = offsetPoint(_q, 1, hashFloat(A.id[s], x.tick, 0x7a1) * 6.283, x.p.st.radius, [0, 0, 0]);
  return { kind: TASK.raiseChild, goal, goalCell: x.p.cellAt(goal), work: 40, target: A.id[infant] };
}

/** the end of raising: the infant fed from the store (or the parent's hand), both closer */
export function raiseDone(x: PCtx, s: number, st: Settlement | undefined, feed: (s: number) => void): void {
  const A = x.A;
  const m = A.slotOf(A.tTarget[s]);
  if (m < 0 || !A.alive[m]) return;
  A.posAt(m, x.tick, _q);
  A.posAt(s, x.tick, _p);
  if (distM(x.p, _p, _q) > 30) return;
  if (st && A.needs[m * NEED_N + FOOD] < 0.9) feed(m);
  A.needs[m * NEED_N + BELONG] = Math.min(1, A.needs[m * NEED_N + BELONG] + 0.4);
  A.needs[s * NEED_N + BELONG] = Math.min(1, A.needs[s * NEED_N + BELONG] + 0.15);
  if (A.needs[m * NEED_N + WATER] < 0.8) A.needs[m * NEED_N + WATER] = Math.min(1, A.needs[m * NEED_N + WATER] + 0.3);
}

// ───────────────────────────── company within reach ─────────────────────────────

/**
 * Someone to keep company with within NEAR_M of agent s (planSocial): a member at leisure there first (talking, at
 * rest), else anyone awake there; -1 none.
 */
export function companyNear(x: PCtx, s: number, st: Settlement): number {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  let best = -1, bv = -1;
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (m === s) continue;
    const k = A.task[m];
    if (k === TASK.sleep || k === TASK.camp) continue;
    A.posAt(m, x.tick, _q);
    const d = distM(x.p, _p, _q);
    if (d > NEAR_M) continue;
    const leisure = k === TASK.socialize || k === TASK.idle || k === TASK.wander || k === TASK.play || k === TASK.warm;
    const v = (leisure ? 2 : 1) - d / (NEAR_M * 2) + A.traits[m * NT + TRAIT.sociability] * 0.2;
    if (v > bv || (v === bv && best >= 0 && A.id[m] < A.id[best])) { bv = v; best = m; }
  }
  return best;
}

/** curiosity need of agent s is low (outlets for children: watching the grown-ups) */
export function bored(x: PCtx, s: number): boolean {
  return x.A.needs[s * NEED_N + CURIO] < 0.3;
}
