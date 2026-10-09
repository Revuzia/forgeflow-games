// GENESIS — knowledge (CONTRACT.md §8.4): per-agent bitsets; the settlement library (living members ∪ readable books ∪
// cohort fractions); learning by teaching, observation, talk, experiment, accident, reverse-engineering, upbringing and
// god teaching (which can be REFUSED: taboo, fear, low faith, conservatism, missing foundations); hoarding ("They hid
// it."); and loss when the last unwritten knower dies ("The secret of bronze died with Hesh of Aru.").
//
// Every roll is a stateless hash of (agent id, tick, recipe, salt), so results never depend on iteration order.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { hashFloat } from '../core/rng.ts';
import { ERAS } from '../content.ts';
import { hasPrereqs } from '../recipes/recipes.ts';
import { accidentChance, experimentCandidates, experimentChance, reverseChance } from '../recipes/discovery.ts';
import { MEMK, NS, NT, SKILL, TRAIT } from './defs.ts';
import { CURIO } from './needs.ts';
import { tell } from './story.ts';
import { agentRef, emitAt, emitSt, kName, settlementRef, vars } from './util.ts';
import { clanOf } from '../chronicle.ts';

export type LearnHow = 'teach' | 'observe' | 'talk' | 'experiment' | 'accident' | 'reverse' | 'god' | 'upbringing' | 'spawn' | 'hive' | 'book';

/** does the settlement's library hold k */
export function libHas(st: Settlement, k: number): boolean {
  return st.library.includes(k);
}

function libAdd(st: Settlement, k: number): boolean {
  const l = st.library;
  if (l.includes(k)) return false;
  let i = l.length;
  while (i > 0 && l[i - 1] > k) i--;
  l.splice(i, 0, k);
  return true;
}

/**
 * Settlement era from its library: an era counts once the settlement knows at least two of its things (one for stone /
 * fire) AND most of the era before it — eras are climbed, not skipped (two lucky recipes of a later era used to lift a
 * city past everything in between).
 */
export function computeEra(x: PCtx, st: Settlement): number {
  const count = new Array<number>(ERAS.length).fill(0);
  for (const k of st.library) { const r = x.rt.list[k]; if (r) count[r.era]++; }
  const total = eraTotals(x, st.species);
  let era = 0;
  for (let e = 1; e < ERAS.length; e++) {
    if (count[e] < (e <= 1 ? 1 : 2)) break;
    if (e > 1 && count[e - 1] < Math.max(1, Math.ceil(total[e - 1] * PREV_ERA_SHARE))) break;
    era = e;
  }
  return era;
}

/** the share of the previous era's knowledge a settlement must hold before the next era counts */
const PREV_ERA_SHARE = 0.5;

/** recipes per era that a species can learn (cached per recipe table) */
const _eraTotals = new WeakMap<object, Map<number, number[]>>();
function eraTotals(x: PCtx, species: number): number[] {
  let m = _eraTotals.get(x.rt);
  if (!m) _eraTotals.set(x.rt, (m = new Map()));
  let t = m.get(species);
  if (!t) {
    t = new Array<number>(ERAS.length).fill(0);
    for (const r of x.rt.list) if (r.base > 0 && (!r.species || r.species.includes(species))) t[r.era]++;
    m.set(species, t);
  }
  return t;
}

/** a learning-speed multiplier from the settlement's knowledge (oral tradition, writing, schools, radio...) */
export function learnBoost(x: PCtx, st: Settlement | undefined): number {
  if (!st) return 1;
  return libraryEffect(x, st, 'teach');
}

/** is k taboo for this settlement (culture) or the agent's species */
export function isTaboo(x: PCtx, st: Settlement | undefined, species: number, k: number): boolean {
  if (st && st.culture.taboos.includes(k)) return true;
  return x.info[species].taboos.includes(k);
}

/**
 * Agent s learns recipe k. Returns true if it was new to them. Grants (alternative paths) come along. A discovery by
 * experiment / accident / reverse-engineering that is new to the SETTLEMENT is chronicled.
 */
export function learn(x: PCtx, s: number, k: number, how: LearnHow, meta: { trigger?: string; item?: number } = {}): boolean {
  const A = x.A;
  const r = x.rt.list[k];
  if (!r || A.knows(s, k)) return false;
  if (r.species && !r.species.includes(A.species[s])) return false;
  A.setKnows(s, k, true);
  // a little skill comes with understanding
  const sk = s * NS + r.skill;
  A.skills[sk] = Math.min(1, A.skills[sk] + 0.06);
  const st = x.ps.settlement(A.settlement[s]);
  const newToSettlement = st ? libAdd(st, k) : true;
  const discovered = how === 'experiment' || how === 'accident' || how === 'reverse';
  A.remember(s, discovered ? MEMK.discovered : how === 'teach' ? MEMK.taught : MEMK.learned, x.tick, k);
  if (how !== 'spawn' && how !== 'upbringing' && how !== 'hive') {
    // satisfying curiosity
    A.needs[s * 12 + CURIO] = Math.min(1, A.needs[s * 12 + CURIO] + 0.3);
  }
  if (st && newToSettlement && (discovered || how === 'god')) {
    st.stats.discoveries++;
    const v = vars(x, st, s, { knowledge: kName(x, k), cause: meta.trigger ?? '', item: meta.item !== undefined ? x.c.items.list[meta.item]?.name.toLowerCase() : undefined, clan: clanOf(x, s) });
    const id = how === 'experiment' ? 'discovery.experiment' : how === 'accident' ? `discovery.accident.${meta.trigger ?? ''}` : how === 'reverse' ? 'discovery.reverse' : 'discovery.god';
    if (how === 'accident' && meta.trigger) v.cause = TRIGGER_WORDS[meta.trigger] ?? meta.trigger;
    tell(x.u, x.p, id, v, st, [agentRef(x, s), settlementRef(x, st)]);
    emitAt(x, s, { t: 'discovery', a: k, text: r.name, ref: agentRef(x, s), data: { knowledge: r.id, how, settlement: st.id, trigger: meta.trigger } });
    // hoarding: valuable knowledge found by a reserved person may be kept within their house
    if (r.secret > 0 && how !== 'god') {
      const soc = A.traits[s * NT + TRAIT.sociability];
      if (hashFloat(A.id[s], k, x.tick, 0x40a2d) < r.secret * (1.1 - soc) * 0.8 && !st.secrets.includes(k)) {
        st.secrets.push(k);
        tell(x.u, x.p, 'hoard', v, st);
      }
    }
    const era = computeEra(x, st);
    if (era > st.era) {
      st.era = era;
      // each age is announced once per settlement (a lost and regained idea does not begin it again)
      const key = `era:${ERAS[era]}`;
      if (st.firsts[key] === undefined) {
        st.firsts[key] = x.tick;
        tell(x.u, x.p, 'era', vars(x, st, -1, { era: ERAS[era] }), st, [settlementRef(x, st)]);
      }
    }
  } else if (st && newToSettlement) {
    const era = computeEra(x, st);
    if (era > st.era) st.era = era;
  }
  for (const g of r.grants) learn(x, s, g, how === 'spawn' ? 'spawn' : 'hive', meta);
  return true;
}

/** agent s forgets k (the god silences it, or a cohort demotion); checks loss for the settlement */
export function forget(x: PCtx, s: number, k: number, why: 'silenced' | 'death'): void {
  const A = x.A;
  if (!A.knows(s, k)) return;
  A.setKnows(s, k, false);
  A.remember(s, MEMK.forgot, x.tick, k);
  const st = x.ps.settlement(A.settlement[s]);
  if (st) checkLoss(x, st, k, s, why);
}

/** can the settlement read its books (someone alive knows writing, or the cohort does) */
export function canRead(x: PCtx, st: Settlement, exceptSlot = -1): boolean {
  const w = x.rt.byId.get('writing');
  if (w === undefined) return true;
  if ((st.cohort.know[String(w)] ?? 0) > 0) return true;
  for (const m of x.ps.members.get(st.id) ?? []) if (m !== exceptSlot && x.A.knows(m, w)) return true;
  return false;
}

/** does anyone keep k alive in st (other than slot `except`): a living member, a readable book, the cohort */
export function keptAlive(x: PCtx, st: Settlement, k: number, except: number): boolean {
  for (const m of x.ps.members.get(st.id) ?? []) if (m !== except && x.A.alive[m] && x.A.knows(m, k)) return true;
  if ((st.cohort.know[String(k)] ?? 0) > 0 && st.cohort.n[1] + st.cohort.n[2] > 0) return true;
  if (st.written.includes(k) && canRead(x, st, except)) return true;
  return false;
}

/**
 * After agent `s` (dying or silenced) stops knowing k: if nobody else in the settlement keeps it, the settlement loses
 * it. The chronicle names the last knower.
 */
export function checkLoss(x: PCtx, st: Settlement, k: number, s: number, why: 'silenced' | 'death' | 'burned'): boolean {
  if (!libHas(st, k)) return false;
  if (keptAlive(x, st, k, s)) return false;
  const i = st.library.indexOf(k);
  if (i >= 0) st.library.splice(i, 1);
  const si = st.secrets.indexOf(k);
  if (si >= 0) st.secrets.splice(si, 1);
  st.stats.lost++;
  st.era = computeEra(x, st);
  // a people's innate ways, or a band dying out entirely, are not "secrets lost": the fall is the story then
  const survivors = (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2];
  if (st.band || survivors < 1 || x.info[st.species].start.includes(k)) return true;
  const v = vars(x, st, s, { knowledge: kName(x, k) });
  const id = why === 'burned' ? 'loss.burned' : why === 'silenced' ? 'loss.silenced' : 'loss';
  tell(x.u, x.p, id, v, st, s >= 0 ? [agentRef(x, s), settlementRef(x, st)] : [settlementRef(x, st)]);
  emitSt(x, st, { t: 'loss', a: k, text: x.rt.list[k].name, data: { knowledge: x.rt.list[k].id, settlement: st.id, why } });
  return true;
}

/** the knowledge written in a settlement's standing buildings */
export function recomputeWritten(x: PCtx, st: Settlement): void {
  const written: number[] = [];
  for (const b of x.ps.of(st.id)) {
    if (b.books.length === 0 || b.damage >= 1) continue;
    for (const k of b.books) if (!written.includes(k)) written.push(k);
  }
  written.sort((a, b) => a - b);
  st.written = written;
}

/** recompute a settlement's written knowledge and library (hourly; after a fire; after load-time repairs) */
export function refreshLibrary(x: PCtx, st: Settlement): void {
  recomputeWritten(x, st);
  const written = st.written;
  const A = x.A, kw = A.kw;
  const n = x.rt.n;
  // one bit per recipe: what any member knows, what the cohort remembers, what they can read in their books
  const nw = Math.max(kw, (n + 31) >>> 5);
  if (_words.length < nw) _words = new Uint32Array(nw);
  const words = _words;
  words.fill(0, 0, nw);
  for (const m of x.ps.members.get(st.id) ?? []) for (let w = 0; w < kw; w++) words[w] |= A.know[m * kw + w];
  if (st.cohort.n[1] + st.cohort.n[2] > 0) for (const key in st.cohort.know) { const k = Number(key); if (st.cohort.know[key] > 0 && k >= 0 && k < n) words[k >>> 5] |= 1 << (k & 31); }
  if (written.length && canRead(x, st)) for (const k of written) if (k >= 0 && k < n) words[k >>> 5] |= 1 << (k & 31);
  // ascending, recipes of this content only
  const lib: number[] = [];
  for (let w = 0; w < nw; w++) {
    let v = words[w];
    while (v) {
      const b = 31 - Math.clz32(v & -v);
      const k = w * 32 + b;
      if (k < n) lib.push(k);
      v &= v - 1;
    }
  }
  st.library = lib;
  st.era = Math.max(computeEra(x, st), 0);
}
let _words = new Uint32Array(0);

/** the product of a library effect (speed, teach, mortality, blight...) over what a settlement knows (cached per library) */
const _effects = new WeakMap<number[], { n: number; m: Map<string, number> }>();
export function libraryEffect(x: PCtx, st: Settlement, key: string): number {
  let c = _effects.get(st.library);
  if (!c || c.n !== st.library.length) { c = { n: st.library.length, m: new Map() }; _effects.set(st.library, c); }
  let v = c.m.get(key);
  if (v === undefined) {
    v = 1;
    for (const [k, f] of x.rt.effects.get(key) ?? []) if (st.library.includes(k)) v *= f;
    c.m.set(key, v);
  }
  return v;
}

// ───────────────────────────── learning channels ─────────────────────────────

/** one teaching session of master `t` to learner `l` on recipe k; true if learned */
export function teachSession(x: PCtx, t: number, l: number, k: number): boolean {
  const A = x.A;
  const r = x.rt.list[k];
  if (!r || !A.knows(t, k) || A.knows(l, k)) return false;
  if (!hasPrereqs(r, A.know, l * A.kw, A.kw)) return false;
  const st = x.ps.settlement(A.settlement[t]);
  const skill = A.skills[t * NS + r.skill];
  const cur = A.traits[l * NT + TRAIT.curiosity];
  const p = (1 - r.teach * 0.85) * (0.3 + 0.7 * skill) * (0.55 + cur) * 0.55 * learnBoost(x, st);
  if (hashFloat(A.id[t], A.id[l], k, x.tick ^ 0x7eac) >= p) return false;
  learn(x, l, k, 'teach');
  // the teacher grows too
  A.skills[t * NS + SKILL.lore] = Math.min(1, A.skills[t * NS + SKILL.lore] + 0.01);
  return true;
}

const _obs: number[] = [];
const _near: number[] = [];

/** others in the cell watch agent s work recipe k */
export function observe(x: PCtx, s: number, k: number, cell: number): void {
  const A = x.A;
  const r = x.rt.list[k];
  if (!r) return;
  const st = x.ps.settlement(A.settlement[s]);
  const secret = st ? st.secrets.includes(k) : false;
  const boost = learnBoost(x, st);
  // those at hand: the cell and its neighbours (a workshop's yard is wider than a point)
  _near.length = 0;
  x.ps.agentsIn(cell, _obs);
  for (const o of _obs) _near.push(o);
  const g = x.p.grid;
  for (let e = g.nbrStart[cell]; e < g.nbrStart[cell + 1]; e++) { x.ps.agentsIn(g.nbr[e], _obs); for (const o of _obs) _near.push(o); }
  for (const o of _near) {
    if (o === s || A.knows(o, k)) continue;
    if (!hasPrereqs(r, A.know, o * A.kw, A.kw)) continue;
    if (isTaboo(x, st, A.species[o], k)) continue;
    let p = 0.07 * (1 - r.teach * 0.8) * (0.5 + A.traits[o * NT + TRAIT.curiosity]) * boost;
    if (secret && A.household[o] !== A.household[s]) p *= 0.15;
    if (hashFloat(A.id[o], A.id[s], k, x.tick ^ 0x0b5e) < p) learn(x, o, k, 'observe');
  }
}

/** talk: someone in the cell passes on an easy idea (oral spread of low-difficulty knowledge) */
export function talk(x: PCtx, s: number, cell: number): void {
  const A = x.A;
  x.ps.agentsIn(cell, _obs);
  if (_obs.length < 2) return;
  const st = x.ps.settlement(A.settlement[s]);
  const kw = A.kw;
  // pick a partner deterministically
  const o = _obs[Math.floor(hashFloat(A.id[s], x.tick, 0x7a1c) * _obs.length)];
  if (o === s) return;
  // an easy thing o knows and s does not
  const boost = learnBoost(x, st);
  for (let w = 0; w < kw; w++) {
    const diff = A.know[o * kw + w] & ~A.know[s * kw + w];
    if (!diff) continue;
    for (let b = 0; b < 32; b++) {
      if (!(diff & (1 << b))) continue;
      const k = w * 32 + b;
      const r = x.rt.list[k];
      if (!r || r.teach > 0.35) continue;
      if (st && st.secrets.includes(k) && A.household[o] !== A.household[s]) continue;
      if (!hasPrereqs(r, A.know, s * kw, kw)) continue;
      if (hashFloat(A.id[s], A.id[o], k, x.tick ^ 0x7a1d) < 0.12 * (1 - r.teach * 2) * boost) { learn(x, s, k, 'talk'); return; }
    }
  }
}

/** a child grows up hearing its parents: low-difficulty knowledge passes by upbringing */
export function upbringing(x: PCtx, child: number, parents: number[]): void {
  const A = x.A, kw = A.kw;
  for (const p of parents) {
    if (p < 0 || !A.alive[p]) continue;
    for (let w = 0; w < kw; w++) {
      const bits = A.know[p * kw + w];
      if (!bits) continue;
      for (let b = 0; b < 32; b++) {
        if (!(bits & (1 << b))) continue;
        const k = w * 32 + b;
        const r = x.rt.list[k];
        if (!r || A.knows(child, k)) continue;
        if (r.species && !r.species.includes(A.species[child])) continue;
        const pr = r.teach <= 0.15 ? 0.95 : (1 - r.teach) * 0.45;
        if (hashFloat(A.id[child], k, A.id[p], 0x0b7b) < pr) A.setKnows(child, k, true);
      }
    }
  }
}

export interface ExperimentPlan {
  k: number;
  triggered: boolean;
}

const _cands: { r: import('../recipes/recipes.ts').CRecipe; w: number; triggered: boolean }[] = [];

/** choose what a curious agent tries to work out (null = nothing within reach) */
export function planExperiment(x: PCtx, s: number, st: Settlement, present: (ctx: string) => boolean): ExperimentPlan | null {
  const A = x.A;
  experimentCandidates(x.rt, A.know, s * A.kw, A.kw, A.species[s], (k) => libHas(st, k), (k) => isTaboo(x, st, A.species[s], k), present, _cands);
  // nobody works out how to make a thing from stuff they have never seen: every input must be in the store, in hand
  // or known to be gatherable nearby (thinking alone carried cities from bronze to steam in four years)
  for (let i = _cands.length - 1; i >= 0; i--) if (!inputsSeen(x, s, st, _cands[i].r)) _cands.splice(i, 1);
  if (!_cands.length) return null;
  let total = 0;
  for (const c of _cands) total += c.w;
  let roll = hashFloat(A.id[s], x.tick, 0xe4a1) * total;
  for (const c of _cands) {
    roll -= c.w;
    if (roll <= 0) return { k: c.r.idx, triggered: c.triggered };
  }
  const last = _cands[_cands.length - 1];
  return { k: last.r.idx, triggered: last.triggered };
}

/** resolve an experiment session; true = discovered */
export function resolveExperiment(x: PCtx, s: number, k: number, triggered: boolean): boolean {
  const A = x.A;
  const r = x.rt.list[k];
  if (!r || A.knows(s, k)) return false;
  const st = x.ps.settlement(A.settlement[s]);
  // each discovery of one's own makes the next harder to come by (the easy ideas within one mind's reach go first)
  const p = experimentChance(r, A.traits[s * NT + TRAIT.curiosity], A.skills[s * NS + r.skill], triggered, learnBoost(x, st)) / (1 + 0.6 * A.found[s]);
  A.skills[s * NS + r.skill] = Math.min(1, A.skills[s * NS + r.skill] + 0.01);
  if (hashFloat(A.id[s], k, x.tick, 0xe4a2) >= p) return false;
  const got = learn(x, s, k, 'experiment');
  if (got && A.found[s] < 255) A.found[s]++;
  return got;
}

/** every input of recipe r is in the settlement's store, in the agent's hands, or gatherable nearby */
function inputsSeen(x: PCtx, s: number, st: Settlement, r: import('../recipes/recipes.ts').CRecipe): boolean {
  for (const inp of r.inputs) {
    let seen = false;
    for (const it of inp.items) {
      if ((st.store[it] ?? 0) > 0 || x.A.carried(s, it) > 0 || (st.res?.items[String(it)]?.length ?? 0) > 0) { seen = true; break; }
    }
    if (!seen) return false;
  }
  return true;
}

/**
 * An accident (trigger event) near settlement st: recipes the trigger can teach are offered to its members who know the
 * prerequisites; at most one learner per recipe (the knowledge then spreads by watching and teaching).
 */
export function accident(x: PCtx, st: Settlement, trigger: string, near = -1): number {
  st.recent[trigger] = x.tick;
  const list = x.rt.byTrigger.get(trigger);
  if (!list) return 0;
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let learned = 0;
  for (const k of list) {
    if (libHas(st, k)) continue;
    const r = x.rt.list[k];
    for (const m of members) {
      if (!A.alive[m] || A.knows(m, k)) continue;
      if (r.species && !r.species.includes(A.species[m])) continue;
      if (!hasPrereqs(r, A.know, m * A.kw, A.kw)) continue;
      if (isTaboo(x, st, A.species[m], k)) continue;
      // those near the event see it best
      const nearF = near >= 0 && A.cell[m] === near ? 1.5 : 1;
      if (hashFloat(A.id[m], k, x.tick, 0xacc1) < accidentChance(r, A.traits[m * NT + TRAIT.curiosity]) * nearF) {
        if (learn(x, m, k, 'accident', { trigger })) { learned++; break; }
      }
    }
  }
  return learned;
}

/** an agent studies an artifact (item index): may learn a recipe that makes it */
export function reverseEngineer(x: PCtx, s: number, item: number): boolean {
  const A = x.A;
  const prods = x.rt.producers[item] ?? [];
  for (const k of prods) {
    const r = x.rt.list[k];
    if (A.knows(s, k)) continue;
    if (r.species && !r.species.includes(A.species[s])) continue;
    if (!hasPrereqs(r, A.know, s * A.kw, A.kw)) continue;
    if (hashFloat(A.id[s], k, x.tick, 0x7e7e) < reverseChance(r, A.traits[s * NT + TRAIT.curiosity], A.skills[s * NS + r.skill])) {
      return learn(x, s, k, 'reverse', { item });
    }
  }
  return false;
}

export type RefusalReason = 'taboo' | 'fear' | 'faith' | 'conservative' | 'grasp';

/** would agent s accept the god's teaching of k? null = yes, else the reason */
export function refusalOf(x: PCtx, s: number, k: number): RefusalReason | null {
  const A = x.A;
  const r = x.rt.list[k];
  const st = x.ps.settlement(A.settlement[s]);
  if (isTaboo(x, st, A.species[s], k)) return 'taboo';
  if (!hasPrereqs(r, A.know, s * A.kw, A.kw)) return 'grasp';
  const love = A.love[s * 4], fear = A.fear[s * 4];
  const bold = A.traits[s * NT + TRAIT.boldness];
  if (fear > love + 0.25 && bold < 0.55) return 'fear';
  const piety = A.traits[s * NT + TRAIT.piety];
  if (love < 0.06 && piety < 0.3 && hashFloat(A.id[s], k, x.tick, 0xfa17) < 0.6) return 'faith';
  const cons = (st?.culture.conservatism ?? 0.3) * (1.2 - A.traits[s * NT + TRAIT.curiosity]);
  if (cons > 0.42 && hashFloat(A.id[s], k, x.tick, 0xc025) < cons) return 'conservative';
  return null;
}

/**
 * The god teaches k to the listed agents. Each may refuse; refusals are events and (per settlement) a chronicle entry.
 * Returns counts.
 */
export function godTeach(x: PCtx, slots: number[], k: number): { taught: number; refused: number; reasons: Record<string, number>; already: number } {
  const A = x.A;
  const out = { taught: 0, refused: 0, reasons: {} as Record<string, number>, already: 0 };
  const perSt = new Map<number, { taught: number; refused: Record<string, number> }>();
  for (const s of slots) {
    if (!A.alive[s]) continue;
    if (A.knows(s, k)) { out.already++; continue; }
    const why = refusalOf(x, s, k);
    const sid = A.settlement[s];
    let e = perSt.get(sid);
    if (!e) perSt.set(sid, (e = { taught: 0, refused: {} }));
    if (why) {
      out.refused++;
      out.reasons[why] = (out.reasons[why] ?? 0) + 1;
      e.refused[why] = (e.refused[why] ?? 0) + 1;
      A.remember(s, MEMK.refused, x.tick, k);
      emitAt(x, s, { t: 'refusal', a: k, text: why, ref: agentRef(x, s), data: { knowledge: x.rt.list[k].id, reason: why } });
    } else {
      // a gift taken: the god is loved a little more
      const already = A.knows(s, k);
      learn(x, s, k, 'god');
      if (!already) { out.taught++; e.taught++; }
      A.love[s * 4] = Math.min(1, A.love[s * 4] + 0.04);
      A.remember(s, MEMK.miracle, x.tick, k);
    }
  }
  // chronicle the refusals per settlement (acceptances were chronicled by learn as discovery.god)
  for (const [sid, e] of [...perSt.entries()].sort((a, b) => a[0] - b[0])) {
    const st = x.ps.settlement(sid);
    if (!st) continue;
    const reasons = Object.entries(e.refused).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (reasons.length && reasons[0][1] > e.taught) {
      tell(x.u, x.p, `refusal.${reasons[0][0]}`, vars(x, st, -1, { knowledge: kName(x, k) }), st, [settlementRef(x, st)]);
    }
  }
  return out;
}

/** hive minds share what any member knows (hourly) */
export function hiveShare(x: PCtx, st: Settlement): void {
  const sp = x.info[st.species];
  if (!sp.def.hive?.sharedMemory) return;
  const A = x.A, kw = A.kw;
  const members = x.ps.members.get(st.id) ?? [];
  if (members.length < 2) return;
  const words = new Uint32Array(kw);
  for (const m of members) for (let w = 0; w < kw; w++) words[w] |= A.know[m * kw + w];
  for (const m of members) for (let w = 0; w < kw; w++) A.know[m * kw + w] |= words[w];
}

/** the god makes agents forget k (silence); the settlement may lose it */
export function silence(x: PCtx, slots: number[], k: number): number {
  let n = 0;
  for (const s of slots) {
    if (!x.A.alive[s] || !x.A.knows(s, k)) continue;
    x.A.setKnows(s, k, false);
    x.A.remember(s, MEMK.silenced, x.tick, k);
    n++;
  }
  const done = new Set<number>();
  for (const s of slots) {
    const sid = x.A.settlement[s];
    if (done.has(sid)) continue;
    done.add(sid);
    const st = x.ps.settlement(sid);
    if (st) checkLoss(x, st, k, -1, 'silenced');
  }
  return n;
}

/** words for accident triggers in running text */
export const TRIGGER_WORDS: Record<string, string> = {
  'lightning': 'lightning', 'lightning-dune': 'lightning in the dunes', 'lightning-fire': 'a fire lit by lightning',
  'wildfire': 'a wildfire', 'fire-on-clay': 'fire on clay', 'rotten-grain': 'spoiled grain', 'meteor-iron': 'iron from the sky',
  'copper-in-fire': 'green stones in the fire', 'spilled-seed': 'spilled seed', 'wolf-cubs': 'orphaned cubs',
  'tame-young': 'young animals', 'flood': 'a flood', 'drought': 'a drought', 'death': 'a death', 'plague': 'a plague',
  'injury': 'a wound', 'eclipse': 'an eclipse', 'comet': 'a comet', 'miracle': 'a miracle', 'trade': 'trade', 'raid': 'a raid',
  'war': 'war', 'famine': 'famine', 'feast': 'a feast', 'tar-seep': 'black water from the ground', 'firework': 'a burst of fire',
  'flint-sparks': 'sparks from flint', 'storm-at-sea': 'a storm at sea', 'birth': 'a birth',
  'blight': 'a blight on the fields', 'battle': 'a battle', 'conquest': 'a conquest', 'contact': 'meeting strangers', 'siege': 'a siege',
  'schism': 'a schism',
};
