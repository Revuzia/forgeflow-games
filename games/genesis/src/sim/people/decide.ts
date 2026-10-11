// GENESIS — decisions (CONTRACT.md §8.2, §8.3): utility AI over needs, role, knowledge, danger, the hour, the weather
// and faith. An agent decides only when its task ends (event-driven): needs are integrated, death is checked, then
// every candidate activity gets a utility (survival needs dominate when low; work follows the agent's role and the
// settlement's wants; curiosity, faith and company pull the rest of the day) with a small deterministic jitter, and the
// best one that can find a target becomes the next task.

import type { PCtx } from './ctx.ts';
import type { Building, Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { DEATH, NS, NT, PHASE, ROLE, SKILL, TASK, TRAIT } from './defs.ts';
import { BELONG, CURIO, FAITH, FOOD, REST, SAFETY, WARMTH, WATER, WET, NEED_N, fireAt, lastStress, updateNeeds } from './needs.ts';
import { ageFlags, die } from './lifecycle.ts';
import { startTask, nextSegment, storePoint, type TaskSpec } from './tasks.ts';
import { airTemp, cellPos, distM, drinkable, freshWater, isLand, snowWater, spotInCell, sunElevation, ticksUntilSun, wellFlows } from './world.ts';
import { availability, itemIdx, pathOptsFor } from './resources.ts';
import { findPath } from '../grid/pathfind.ts';
import { bestFood, foodDays, storeAny, storeHas } from './store.ts';
import { hasPrereqs } from '../recipes/recipes.ts';
import { libHas, isTaboo, planExperiment } from './knowledge.ts';
import { placeFor } from './context.ts';
import { animalDef, herdPos } from '../life/herds.ts';
import { eat, finishTask } from './work.ts';
import { fireSourceNear } from './fire.ts';
import { boatSwim, missionOf, planMission } from './missions.ts';
import { sacredAnimal } from './culture.ts';
import { offsetPoint } from './world.ts';
import { godHooks } from './hooks.ts';
import { FIRE_HERE, fireDanger, fleeTarget } from './danger.ts';
// SIM perf push 3 — the peoples' time-lapse (stretched tasks, per-settlement context caches: perf/plapse.ts)
import { ctxOf, finishStretched, inPassing, litOf, lowHearthOf, penIn, rival, templeIn } from '../perf/plapse.ts';

const _p = [0, 0, 0];
const _q = [0, 0, 0];

/** while walking, needs are integrated at a leg's end at most this often (ticks) */
const NEED_STEP = 60;

/** the time wheel woke agent s */
export function onDue(x: PCtx, s: number): void {
  const A = x.A;
  if (!A.alive[s]) return;
  // held in the god's hand or flying: no decisions until set down (the landing wakes them)
  if (godHooks.held && godHooks.held(x, s)) return;
  if (A.phase[s] === PHASE.moving) {
    // a long walk is lived leg by leg: thirst, hunger and cold are felt (and can kill) on the road, not all at once at
    // its end — agents on day-long errands carried days of deprivation into one decision and died 20 ticks after
    // looking healthy. A need turned critical that this walk does not serve ends the walk here.
    if (x.tick - A.needT[s] >= NEED_STEP) {
      const h = updateNeeds(x, s);
      if (h <= 0) { die(x, s, A.cause[s] || DEATH.injury); return; }
      if (urgent(x, s)) { decide(x, s); return; }
    }
    nextSegment(x, s);
    return;
  }
  // the task's interval is integrated where it was lived — inside the shelter for a night's sleep or a warm-up at home.
  // (finishTask steps out of the shelter; integrating after it judged a whole night in a hut as a night in the open.)
  if (updateNeeds(x, s) <= 0) { die(x, s, A.cause[s] || DEATH.injury); return; }
  // (SIM perf push 3: a task stretched at 100x / 1000x yields its k sessions — perf/plapse.ts; A.dmg is 0 at level 0)
  const chained = A.dmg[s] > 1 ? finishStretched(x, s, finishTask) : finishTask(x, s);
  if (!A.alive[s] || chained) return;
  decide(x, s);
}

/** a need has turned critical and the current task does not answer it (the agent should decide again now) */
function urgent(x: PCtx, s: number): boolean {
  const A = x.A;
  if (A.mission[s]) return false;
  const k = A.task[s];
  // walking into (or through) fire: decide again (flee)
  if (k !== TASK.flee && fireDanger(x.p, A.cell[s]) >= 1) return true;
  const N = A.needs, nb = s * NEED_N;
  const sp = x.info[A.species[s]];
  if (sp.needW[WATER] > 0 && N[nb + WATER] < 0.12 && k !== TASK.drink && A.boat[s] < 0) return true;
  // on a long way to a drinking place with water right here after all: drink now
  if (k === TASK.drink && N[nb + WATER] < 0.2 && A.gcell[s] !== A.cell[s] && waterHere(x, s)) return true;
  if (sp.needW[FOOD] > 0 && N[nb + FOOD] < 0.06 && k !== TASK.eat && k !== TASK.forage && k !== TASK.fish && k !== TASK.hunt && k !== TASK.store) return true;
  if (sp.needW[WARMTH] > 0 && N[nb + WARMTH] < 0.1 && lastStress > 0.3 && k !== TASK.warm && k !== TASK.sleep && k !== TASK.flee) return true;
  return false;
}

/** gather task for an item (by the recipes that list it; basics by kind) */
export function gatherTaskOf(x: PCtx, item: number): number {
  for (const r of x.rt.list) {
    if (!r.gatherTask || !r.gatherItems.includes(item)) continue;
    const t = GATHER_KIND[r.gatherTask];
    if (t !== undefined) return t;
  }
  const id = x.c.items.list[item]?.id;
  if (id === 'wood' || id === 'stick') return TASK.chop;
  if (id === 'stone') return TASK.quarry;
  return TASK.forage;
}

export const GATHER_KIND: Record<string, number> = {
  forage: TASK.forage, chop: TASK.chop, quarry: TASK.quarry, dig: TASK.dig, mine: TASK.mine, 'cut-ice': TASK.cutIce,
  'collect-air': TASK.collectAir, secrete: TASK.secrete, fish: TASK.fish, hunt: TASK.hunt, herd: TASK.herd,
};

/** is it night for this agent (inverted for nocturnal peoples) */
export function isNight(x: PCtx, s: number): boolean {
  x.A.posAt(s, x.tick, _p);
  const night = sunElevation(x.u, x.p, x.tick, _p) < -0.03;
  return night !== x.info[x.A.species[s]].def.nocturnal;
}

function jitter(x: PCtx, s: number, salt: number): number {
  return (hashFloat(x.A.id[s], x.tick, salt, 0xd3c1) - 0.5) * 0.12;
}

// candidate activities (indices into the utility table)
const C = {
  flee: 0, drink: 1, eat: 2, warm: 3, sleep: 4, bathe: 5, fearWarm: 6, follow: 7, bandGather: 8, work: 9, tendFire: 10,
  store: 11, social: 12, pray: 13, curious: 14, court: 15, mourn: 16, bury: 17, wander: 18, exhausted: 19,
} as const;
const NC = 20;
const _u = new Float64Array(NC);
const _order: number[] = [];

/** choose and start the next task */
export function decide(x: PCtx, s: number): void {
  const A = x.A;
  ageFlags(x, s);
  const h = updateNeeds(x, s);
  if (h <= 0) { die(x, s, A.cause[s] || DEATH.injury); return; }
  const home = x.ps.settlement(A.settlement[s]);
  if (A.flags[s] & AgentFlag.possessed) {
    // the player drives this one (god/possess.ts): its next order, else it stands and waits
    const t = godHooks.possessed ? godHooks.possessed(x, s) : null;
    if (t) startTask(x, s, t); else idle(x, s, 60);
    return;
  }
  // on the road with a caravan or a war band: eat what they carry, drink and sleep where they are, keep going
  const mission = A.mission[s] ? missionOf(x, s) : undefined;
  const away = !!mission && mission.phase >= 1 && mission.phase <= 3;
  const st = away ? undefined : home;
  // (SIM perf push 3: at 100x / 1000x water and food at hand are taken in passing — perf/plapse.ts; nothing at 1x.
  // Round 2: a drink takes its time — the task decided below starts that many ticks later)
  // danger before needs (people/danger.ts): in the flames, flight is the only candidate; beside them it outranks all
  const danger = fireDanger(x.p, A.cell[s]);
  const sip = danger >= 1 ? 0 : inPassing(x, s, st, waterHere, eat);
  const nb = s * NEED_N;
  const N = A.needs;
  const sp = x.info[A.species[s]];
  // a boat carries water casks: no rowing back to the shore for a drink
  if (A.boat[s] >= 0 && N[nb + WATER] < 0.75) N[nb + WATER] = 0.75;
  const child = (A.flags[s] & AgentFlag.child) !== 0;
  const elder = (A.flags[s] & AgentFlag.elder) !== 0;
  const night = isNight(x, s);
  const U = _u;
  U.fill(0);
  // danger first. (Was: flee = 4 for fire > 0.15 underfoot — below a parched body's drink utility of up to ~7.4, and
  // above the 0.1 at which the fire step already hurt and interrupted them: thirsty villagers drank in their burning village.)
  if (danger >= 1) {
    const t = planFlee(x, s);
    if (t) { startTask(x, s, t); return; }
    // nowhere better within reach: the least-burning neighbour is no better either — stand, and decide again at once
    idle(x, s, 2);
    return;
  }
  if (danger > 0) U[C.flee] = 8 + danger * 2;
  if (sp.needW[WATER] > 0) {
    const w = N[nb + WATER];
    U[C.drink] = sq(1 - w) * 3.2 * sp.needW[WATER] + (w < 0.4 ? 1 : 0);
    // thirst kills in a day or two, hunger in weeks: a parched body drinks before it eats (with water weighted below
    // food, parched and hungry coastal folk walked to the store again and again and died of thirst beside a lake), and
    // water at hand is drunk at once
    if (w < 0.15) U[C.drink] += 1.6;
    if (w < 0.6 && waterHere(x, s)) U[C.drink] += 0.6;
  }
  if (sp.needW[FOOD] > 0) U[C.eat] = sq(1 - N[nb + FOOD]) * 3 * sp.needW[FOOD] + (N[nb + FOOD] < 0.2 ? 1 : 0);
  const stress = lastStress;
  if (stress > 0.05) U[C.warm] = (1 - N[nb + WARMTH]) * 2.6 + stress * 1.2;
  const rest = N[nb + REST];
  U[C.sleep] = night ? (rest < 0.95 ? 1.45 + (1 - rest) : 0.4) : rest < 0.25 ? 1.8 : rest < 0.45 ? 0.5 : 0;
  if (rest < 0.08) U[C.exhausted] = 3.5;
  if (sp.needW[WET] > 0 && N[nb + WET] < 0.6) U[C.bathe] = (1 - N[nb + WET]) * 1.8;
  if (night && N[nb + SAFETY] < 0.6) U[C.fearWarm] = (0.6 - N[nb + SAFETY]) * 1.5;
  if (st && st.band) {
    // a band on the move: keep up with the leader, forage on the way — and in the last day's walk, keep walking (a
    // coastal band within 200 m of its site never got there: half of it was always off bathing at the sea)
    let close = false;
    if (st.target) { A.posAt(s, x.tick, _p); close = distM(x.p, _p, st.target) < 400; }
    U[C.follow] = night ? 0.2 : close ? 1.6 : 0.95;
    U[C.bandGather] = night ? 0 : 0.5;
  } else if (st) {
    const day = night ? 0.25 : 1;
    const dil = A.traits[s * NT + TRAIT.diligence];
    const cur = A.traits[s * NT + TRAIT.curiosity];
    const piety = A.traits[s * NT + TRAIT.piety];
    if (!child) {
      U[C.work] = (0.55 + dil * 0.35) * day * (elder ? 0.6 : 1);
      const low = lowHearth(x, st);
      if (low) U[C.tendFire] = (night ? 1.1 : 0.7) * (low.fuel <= 0 ? 1.4 : 1);
      if (carriesGoods(x, s)) U[C.store] = 1.15;
    }
    U[C.social] = (1 - N[nb + BELONG]) * 0.75 * (0.5 + A.traits[s * NT + TRAIT.sociability]) * (child ? 1.6 : 1);
    U[C.pray] = (1 - N[nb + FAITH]) * 0.55 * piety * day;
    if (!child) U[C.curious] = (1 - N[nb + CURIO]) * 0.85 * cur * day + (A.role[s] === ROLE.scholar ? 0.4 * day : 0);
    // courting grows more pressing the longer a grown-up has been alone (pairs also form daily, settlement.ts pairUp)
    const grown = (x.tick - A.birth[s]) / x.year - sp.def.maturity - 1;
    if (!child && !elder && !A.partner[s] && !sp.def.hive && grown > 0) U[C.court] = (0.32 + 0.45 * Math.min(1, grown / 3)) * day * (0.4 + A.traits[s * NT + TRAIT.sociability]);
    if (recentKinDeath(x, s)) U[C.mourn] = 0.9;
    if (st.recent.death !== undefined && x.tick - st.recent.death < x.day / 2 && (st.recent.buried ?? -1) < st.recent.death && !child) U[C.bury] = 0.6;
  }
  if (mission && home) {
    // the errand comes first while it lasts (by day; the road waits for the night)
    U[C.work] = night && mission.phase !== 2 ? 0.2 : 1.25;
    U[C.social] = 0;
    U[C.curious] = 0;
  }
  U[C.wander] = mission ? 0 : 0.15;
  // a disciple carries its god's will (god/disciples.ts) unless a body's need is pressing
  if (A.flags[s] & AgentFlag.disciple && godHooks.disciple && !mission) {
    const pressing = Math.max(U[C.flee], U[C.drink], U[C.eat], U[C.warm], U[C.sleep], U[C.exhausted]);
    if (pressing < 1.3) { const t = godHooks.disciple(x, s, st, night); if (t) { startTask(x, s, t); return; } }
  }
  // enlisted for a ship (mission −ship id, space/ships.ts): building, fuelling or boarding it comes first, unless a
  // body's need is pressing (they sleep in a camp by the pad: the hook decides that)
  if (A.mission[s] < 0 && godHooks.crew) {
    const pressing = Math.max(U[C.flee], U[C.drink], U[C.eat], U[C.exhausted]);
    if (pressing < 1.3) { const t = godHooks.crew(x, s, st); if (t) { startTask(x, s, t); return; } }
  }
  // best first; a candidate that finds no target falls through to the next
  _order.length = 0;
  const lapsed = x.u.settings.lapse !== undefined; // (SIM perf push 3, round 2: the utilities before the jitter, below)
  if (lapsed) _raw.set(U);
  for (let i = 0; i < NC; i++) if (U[i] > 0.02) { U[i] += jitter(x, s, i); _order.push(i); }
  _order.sort((a, b) => U[b] - U[a] || a - b);
  for (let o = 0; o < _order.length; o++) {
    const k = _order[o];
    const t = k === C.work && mission && home ? planMission(x, s, home, mission) : plan(x, s, st, k, night);
    if (t) {
      if (lapsed) noteRivals(x, s, k, o, !!st && !st.band && !mission, night, child);
      if (sip > 0) { x.tick += sip; startTask(x, s, t); x.tick -= sip; } else startTask(x, s, t);
      return;
    }
  }
  idle(x, s, 45);
}

/** the utilities of the last decision before the jitter (levels ≥ 1 only: noteRivals) */
const _raw = new Float64Array(NC);

/**
 * SIM perf push 3, round 2 (perf/plapse.ts `rival`): how long a 1x agent would keep choosing activity k, for the stretch
 * of the task it starts. A stretched task stood for up to 4 sessions whenever needs and daylight allowed, but between
 * sessions a 1x agent decides again — and company, prayer, curiosity, courting or a bath win some of those decisions:
 * the stretch inflated the share of whatever was chosen (work +9 %, a child's company +40 % of the day at 1000x; food in
 * store ran 15-25 % high from the third game year). Now: no stretch while an untried rival is within the jitter's reach
 * of k (0.12, both ±0.06), else up to the time a rival driven by a decaying need — company, faith, curiosity, a bath —
 * would come within that reach (needs decay linearly: needs.ts updateNeeds).
 */
function noteRivals(x: PCtx, s: number, k: number, o: number, settled: boolean, night: boolean, child: boolean): void {
  const U = _raw;
  const reach = U[k] - 0.12;
  for (let i = o + 1; i < _order.length; i++) if (U[_order[i]] >= reach) { rival.ticks = 0; return; }
  const A = x.A, nb = s * NEED_N, N = A.needs, sp = x.info[A.species[s]], dec = sp.decay, day = x.day;
  let ticks = Infinity;
  if (settled) {
    const dayF = night ? 0.25 : 1;
    const soc = A.traits[s * NT + TRAIT.sociability], piety = A.traits[s * NT + TRAIT.piety], cur = A.traits[s * NT + TRAIT.curiosity];
    ticks = riseTo(ticks, C.social, k, o, reach, U[C.social], (0.75 * (0.5 + soc) * (child ? 1.6 : 1) * dec[BELONG] * (0.5 + soc)) / day);
    ticks = riseTo(ticks, C.pray, k, o, reach, U[C.pray], (0.55 * piety * dayF * dec[FAITH] * (0.3 + piety)) / day);
    if (!child) ticks = riseTo(ticks, C.curious, k, o, reach, U[C.curious], (0.85 * cur * dayF * dec[CURIO] * (0.4 + cur)) / day);
  }
  // a bath: wanted below 0.6 wetness, at (1 − wet) × 1.8 (decide's utility)
  if (sp.needW[WET] > 0 && dec[WET] > 0 && k !== C.bathe && !triedBefore(C.bathe, o)) {
    const t = ((N[nb + WET] - Math.min(0.6, 1 - reach / 1.8)) * day) / dec[WET];
    if (t < ticks) ticks = t < 0 ? 0 : t;
  }
  rival.ticks = ticks;
}

/** the ticks until rival j (utility u0 now, rising `perTick`) comes within reach of k — or `ticks`, if sooner (a rival
 * that was tried before k found nothing to do: not a rival) */
function riseTo(ticks: number, j: number, k: number, o: number, reach: number, u0: number, perTick: number): number {
  if (j === k || perTick <= 0 || triedBefore(j, o)) return ticks;
  const t = (reach - u0) / perTick;
  return t < ticks ? (t < 0 ? 0 : t) : ticks;
}

function triedBefore(j: number, o: number): boolean {
  for (let i = 0; i < o; i++) if (_order[i] === j) return true;
  return false;
}

function plan(x: PCtx, s: number, st: Settlement | undefined, k: number, night: boolean): TaskSpec | null {
  switch (k) {
    case C.flee: return planFlee(x, s);
    case C.drink: return planDrink(x, s, st);
    case C.eat: return planEat(x, s, st);
    case C.warm: case C.fearWarm: return planWarm(x, s, st);
    case C.sleep: case C.exhausted: return planSleep(x, s, st, night);
    case C.bathe: return planBathe(x, s, st);
    case C.follow: return st ? planFollow(x, s, st) : null;
    case C.bandGather: return planGather(x, s, st, true);
    case C.work: return st ? planWork(x, s, st) : null;
    case C.tendFire: { if (!st) return null; const low = lowHearth(x, st); return low ? planTendFire(x, s, st, low) : null; }
    case C.store: return st ? planStore(x, s, st) : null;
    case C.social: return st ? planSocial(x, s, st) : null;
    case C.pray: return st ? planPray(x, s, st) : null;
    case C.curious: return st ? planCurious(x, s, st) : null;
    case C.court: return st ? planCourt(x, s, st) : null;
    case C.mourn: return st ? planMourn(x, s, st) : null;
    case C.bury: return st ? planBury(x, s, st) : null;
    default: return planWander(x, s, st);
  }
}

function sq(v: number): number {
  return v * v;
}

function idle(x: PCtx, s: number, ticks: number): void {
  startTask(x, s, { kind: TASK.idle, goal: null, goalCell: x.A.cell[s], work: ticks });
}

/** goal spot in cell c for agent s */
function spot(x: PCtx, s: number, c: number, salt: number): number[] {
  return spotInCell(x.p, c, x.A.id[s], salt, [0, 0, 0]);
}

/** an agent's own cell or the nearest cell (ring search) satisfying pred */
function nearestCell(x: PCtx, from: number, rings: number, pred: (c: number) => boolean): number {
  if (pred(from)) return from;
  const g = x.p.grid;
  const seen = new Set<number>([from]);
  let fr = [from];
  for (let d = 0; d < rings; d++) {
    const nf: number[] = [];
    for (const c of fr) {
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (seen.has(o)) continue;
        seen.add(o);
        nf.push(o);
      }
    }
    nf.sort((a, b) => a - b);
    for (const o of nf) if (pred(o)) return o;
    fr = nf;
  }
  return -1;
}

// ───────────────────────────── survival ─────────────────────────────

function planDrink(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const p = x.p, A = x.A;
  const c0 = A.cell[s];
  if (p.f.precip[c0] > 1.5 && p.f.precipType[c0] === 1) return { kind: TASK.drink, goal: null, goalCell: c0, work: 15 };
  // water at hand — in this cell, or the next one a few steps away — is drunk there, not at the village's usual spot
  // (cold folk walked 400 m past snow they could melt to the settlement's drinking place and died of thirst on the way)
  // (water in the next cell counts as at hand: a cell is ~50–150 m across and people walk ~15 m an hour here — they
  // fetch it in a skin, the drink is not a half-day's walk)
  if (waterHere(x, s)) return { kind: TASK.drink, goal: null, goalCell: c0, work: 20 };
  let c = -1;
  if (st && !st.band && st.res && st.res.water.length) {
    // nearest drinking spot to where the agent is that still holds water (the list is hours old: a rain pool dries)
    let bd = Infinity;
    A.posAt(s, x.tick, _p);
    for (const w of st.res.water) {
      if (!waterAtCell(x, s, w) || p.f.fire[w] > FIRE_HERE) continue;
      const d = distM(p, _p, cellPos(p, w, _q));
      if (d < bd) { bd = d; c = w; }
    }
  }
  // nothing known: search around, farther the thirstier
  const melt = x.info[A.species[s]].def.habitat.includes('cold');
  if (c < 0) c = nearestCell(x, c0, A.needs[s * NEED_N + WATER] < 0.3 ? 7 : 4, (o) => p.f.water[o] < 0.6 && p.f.fire[o] <= FIRE_HERE && (drinkable(p, o) || nbrFresh(x, o) || (melt && snowWater(p, o))));
  if (c < 0) return null;
  return { kind: TASK.drink, goal: spot(x, s, c, 3), goalCell: c, work: 15 };
}

/** can agent s drink where it stands (water at or beside its cell, rain, a well, snow to melt, a boat's casks)? */
export function waterHere(x: PCtx, s: number): boolean {
  const A = x.A;
  // a boat carries casks, a caravan or war band its skins
  if (A.boat[s] >= 0 || A.mission[s]) return true;
  if (x.p.f.precip[A.cell[s]] > 1 && x.p.f.precipType[A.cell[s]] === 1) return true;
  // the cell or one beside it (cells are ~50 m across: water in the next one is a few steps away)
  if (waterAtCell(x, s, A.cell[s])) return true;
  const g = x.p.grid;
  for (let e = g.nbrStart[A.cell[s]]; e < g.nbrStart[A.cell[s] + 1]; e++) if (waterAtCell(x, s, g.nbr[e])) return true;
  return false;
}

/** is there water agent s can drink at cell c (fresh or seeping, a well, snow to melt for peoples of the cold)? */
function waterAtCell(x: PCtx, s: number, c: number): boolean {
  const p = x.p, A = x.A;
  if (p.f.water[c] < 0.6 && (drinkable(p, c) || nbrFresh(x, c))) return true;
  if (x.info[A.species[s]].def.habitat.includes('cold') && snowWater(p, c)) return true;
  // a well (or cistern) in this cell or the next
  const g = p.grid;
  for (let e = g.nbrStart[c] - 1; e < g.nbrStart[c + 1]; e++) {
    const o = e < g.nbrStart[c] ? c : g.nbr[e];
    const ids = x.ps.bByCell.get(o);
    for (let i = 0; i < ids.length; i++) {
      const b = x.ps.building(ids[i]);
      if (b && b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].provides.includes('water') && wellFlows(p, b.cell)) return true;
    }
  }
  return false;
}

/** the nearest drinking spot around the agent other than cell `not` (a drink whose spot proved out of reach) */
export function planDrinkNear(x: PCtx, s: number, not: number): TaskSpec | null {
  const p = x.p, A = x.A;
  const melt = x.info[A.species[s]].def.habitat.includes('cold');
  const c = nearestCell(x, A.cell[s], 4, (o) => o !== not && p.f.water[o] < 0.6 && p.f.fire[o] <= FIRE_HERE && (drinkable(p, o) || nbrFresh(x, o) || (melt && snowWater(p, o))));
  if (c < 0) return null;
  return { kind: TASK.drink, goal: spot(x, s, c, 5), goalCell: c, work: 15, data: 1 };
}

function nbrFresh(x: PCtx, c: number): boolean {
  const g = x.p.grid;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (freshWater(x.p, g.nbr[e])) return true;
  return false;
}

function planEat(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const A = x.A;
  const sp = x.info[A.species[s]];
  // food in hand
  for (const it of sp.foods) if (A.carried(s, it) > 0.05) return { kind: TASK.eat, goal: null, goalCell: A.cell[s], work: 20, data: 0 };
  if (st && !st.band && bestFood(x, st) >= 0) {
    const c = storePoint(x, st, _q);
    return { kind: TASK.eat, goal: spotInCell(x.p, c, A.id[s], 11, [0, 0, 0]), goalCell: c, work: 25, data: 1 };
  }
  // nothing stored: go and find food (only food: a hungry body does not go quarrying instead)
  return planGather(x, s, st, true, true);
}

function planWarm(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const A = x.A;
  // too hot, not too cold: shade or water, never a hearth (heat-struck people walked to the fire to 'warm up')
  const [, lo, hi] = x.info[A.species[s]].def.temp;
  if (airTemp(x.p, A.cell[s]) > (lo + hi) * 0.5) return planCool(x, s, st);
  if (st && !st.band) {
    // a lit hearth, else home
    let best: Building | null = null, bd = Infinity;
    A.posAt(s, x.tick, _p);
    for (const b of x.ps.of(st.id)) {
      if (b.progress < 1 || b.fuel <= 0) continue;
      if (x.c.buildings.list[b.type].function !== 'hearth') continue;
      const d = distM(x.p, _p, b.pos);
      if (d < bd) { bd = d; best = b; }
    }
    const sp = x.info[A.species[s]].def;
    const heatHurts = sp.temp[2] < 10; // cold peoples seek shade, not fire
    if (best && !heatHurts) return { kind: TASK.warm, goal: spotNear(x, s, best.pos, x.c.buildings.list[best.type].footprint + 1.5), goalCell: best.cell, work: 90 };
    const home = x.ps.building(A.home[s]);
    if (home && home.progress >= 1 && !(home.flags & 2)) return { kind: TASK.warm, goal: [home.pos[0], home.pos[1], home.pos[2]], goalCell: home.cell, work: 120, target: home.id, data2: 1 };
  }
  return null;
}

function spotNear(x: PCtx, s: number, pos: ArrayLike<number>, r: number): number[] {
  const a = hashFloat(x.A.id[s], x.tick, 0x5907) * Math.PI * 2;
  const out = [0, 0, 0];
  // offset point at r metres
  let ex = pos[2], ez = -pos[0];
  let el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = pos[1] * ez, ny = pos[2] * ex - pos[0] * ez, nz = -pos[1] * ex;
  const k = r / x.p.st.radius;
  out[0] = pos[0] + (Math.cos(a) * ex + Math.sin(a) * nx) * k;
  out[1] = pos[1] + Math.sin(a) * ny * k;
  out[2] = pos[2] + (Math.cos(a) * ez + Math.sin(a) * nz) * k;
  el = Math.hypot(out[0], out[1], out[2]);
  out[0] /= el; out[1] /= el; out[2] /= el;
  return out;
}

function planSleep(x: PCtx, s: number, st: Settlement | undefined, night: boolean): TaskSpec | null {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  const nocturnal = x.info[A.species[s]].def.nocturnal;
  let dur = night ? ticksUntilSun(x.u, x.p, x.tick, _p, nocturnal ? 'set' : 'rise', 8 * 60) : 150 + Math.floor(hashFloat(A.id[s], x.tick, 0x51ee) * 90);
  dur = Math.max(60, Math.min(14 * 60, dur + Math.floor(hashFloat(A.id[s], x.tick, 0x51ef) * 30)));
  if (st && !st.band) {
    let home: Building | null | undefined = x.ps.building(A.home[s]);
    if (!home || home.progress < 1 || home.flags & 2) home = findShelter(x, s, st);
    if (home) return { kind: TASK.sleep, goal: [home.pos[0], home.pos[1], home.pos[2]], goalCell: home.cell, work: dur, target: home.id };
    // no roof: by the fire, else by the centre
    const cx = ctxOf(x, st); // (perf/plapse.ts)
    const fireB = cx ? litOf(cx) : x.ps.of(st.id).find((b) => b.fuel > 0 && b.progress >= 1);
    if (fireB) return { kind: TASK.sleep, goal: spotNear(x, s, fireB.pos, 3 + hashFloat(A.id[s], 3) * 4), goalCell: fireB.cell, work: dur, target: -1 };
    return { kind: TASK.sleep, goal: spot(x, s, st.cell, 5), goalCell: st.cell, work: dur, target: -1 };
  }
  return { kind: TASK.sleep, goal: null, goalCell: A.cell[s], work: dur, target: -1 };
}

/**
 * A shelter with room (assigns it as home). The household's home first; else the shelter with the most free beds, a bed
 * counted taken by everyone whose household lives there or who sleeps there now (counting only the people inside, as
 * before, sent the whole band to the first hut in daylight: 41 in a hut for 5 while eight stood empty).
 */
function findShelter(x: PCtx, s: number, st: Settlement): Building | null {
  const A = x.A;
  const hh = st.households.find((hd) => hd.id === A.household[s]);
  if (hh && hh.home >= 0) {
    const b = x.ps.building(hh.home);
    if (b && b.progress >= 1 && !(b.flags & 2)) { A.home[s] = b.id; return b; }
  }
  let best: Building | null = null, bv = 0;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2) continue;
    const def = x.c.buildings.list[b.type];
    if (!def.provides.includes('shelter') || def.capacity <= 0) continue;
    let living = 0;
    for (const o of st.households) if (o.home === b.id) living += o.members.length;
    const free = def.capacity - Math.max(living, b.occupants);
    if (free > bv) { bv = free; best = b; }
  }
  if (best) A.home[s] = best.id;
  return best;
}

/** relief from the heat: a dip in water near at hand, else the shade of home, else the shade of trees */
function planCool(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const p = x.p, A = x.A;
  const w = nearestCell(x, A.cell[s], 3, (o) => p.f.water[o] > 0.1 && p.f.water[o] < 2.5 && p.f.lava[o] <= 0);
  if (w >= 0) return { kind: TASK.bathe, goal: spot(x, s, w, 13), goalCell: w, work: 60 };
  if (st && !st.band) {
    const home = x.ps.building(A.home[s]);
    if (home && home.progress >= 1 && !(home.flags & 2)) return { kind: TASK.warm, goal: [home.pos[0], home.pos[1], home.pos[2]], goalCell: home.cell, work: 120, target: home.id, data2: 1 };
  }
  const t = nearestCell(x, A.cell[s], 3, (o) => p.f.tree[o] > 0.4 && isLand(p, o));
  if (t >= 0) return { kind: TASK.warm, goal: spot(x, s, t, 19), goalCell: t, work: 90 };
  return null;
}

function planBathe(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const p = x.p;
  const c = nearestCell(x, x.A.cell[s], 5, (o) => p.f.water[o] > 0.1);
  if (c < 0) return null;
  return { kind: TASK.bathe, goal: spot(x, s, c, 13), goalCell: c, work: 40 };
}

function planFlee(x: PCtx, s: number): TaskSpec | null {
  // away from the flames, to the nearest clear ground (people/danger.ts fleeTarget)
  const c = fleeTarget(x.p, x.A.cell[s]);
  if (c < 0 || c === x.A.cell[s]) return null;
  return { kind: TASK.flee, goal: spot(x, s, c, 17), goalCell: c, work: 20 };
}

// ───────────────────────────── work ─────────────────────────────

function planWork(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const role = x.A.role[s];
  let t: TaskSpec | null = null;
  // keepers of lore: now and then anyone who holds an idea few others know passes it on in the course of the day
  if (role !== ROLE.teacher && hashFloat(x.A.id[s], x.tick, 0x10e) < 0.1) { t = planTeach(x, s, st, true); if (t) return t; }
  // the role's own work first, then the fall-backs (no closures: this runs at every working agent's turn)
  switch (role) {
    case ROLE.hunter: t = planHunt(x, s, st); break;
    case ROLE.fisher: t = planFish(x, s, st); break;
    case ROLE.farmer: t = planFarm(x, s, st); break;
    case ROLE.herder: t = planHerd(x, s, st) ?? planFarm(x, s, st); break;
    case ROLE.crafter: t = planCraft(x, s, st) ?? planBuild(x, s, st); break;
    // a builder whose site lacks materials fetches them (the site's materials lead the wants): in lean times every
    // gatherer forages for food, and a band's huts stood as bare frames for weeks with stone, reeds and wood at hand
    case ROLE.builder: t = planBuild(x, s, st) ?? (st.sites.length ? planGather(x, s, st, false) : null); break;
    case ROLE.teacher: t = planTeach(x, s, st) ?? planStudy(x, s, st) ?? planCraft(x, s, st); break;
    case ROLE.priest: t = planPreach(x, s, st); break;
    case ROLE.healer: t = planHeal(x, s, st) ?? planCraft(x, s, st); break;
    case ROLE.scholar: return planStudy(x, s, st) ?? planCurious(x, s, st) ?? planCraft(x, s, st);
    case ROLE.leader: t = planBuild(x, s, st) ?? planTeach(x, s, st); break;
    case ROLE.soldier: t = planGuard(x, s, st); break;
    default: return gatherWork(x, s, st) ?? planBuild(x, s, st);
  }
  return t ?? gatherWork(x, s, st);
}

/** gathering as work: a store of four days a head carries a people through a short winter */
function gatherWork(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const lean = foodDays(x, st) < pop(x, st) * 4;
  // firewood even in lean times: while the store is short of food every gatherer forages, and a people that knew how
  // to keep fire sat by a cold hearth for years (no wood ever came home). One gatherer in four (by turns) fetches fuel
  // while the hearth's woodpile is low.
  if (lean && fuelLow(x, st) && hashFloat(x.A.id[s], Math.floor(x.tick / 360), 0xf0e1) < 0.25) {
    const t = planGather(x, s, st, false);
    if (t) return t;
  }
  return planGather(x, s, st, lean);
}

/** a kept hearth (built, and fire-keeping known) whose woodpile is low */
function fuelLow(x: PCtx, st: Settlement): boolean {
  const fk = x.rt.byId.get('fire-keeping');
  if (fk === undefined || !st.library.includes(fk)) return false;
  const wood = itemIdx(x, 'wood');
  if (wood < 0 || storeHas(st, wood) >= 4 + pop(x, st) * 0.2) return false;
  return lowHearth(x, st) !== null;
}

function pop(x: PCtx, st: Settlement): number {
  return (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[1] + st.cohort.n[0] * 0.5;
}

/**
 * Gather. Food mode (hungry, or the store is low): the known food item and cell with the best expected food per hour
 * of the trip (yield at that availability over walking + working time), among the agent's own cell, its neighbours and
 * the settlement's best cells. Otherwise the settlement's wants in order, each at its best reachable cell.
 */
export function planGather(x: PCtx, s: number, st: Settlement | undefined, food: boolean, onlyFood = false): TaskSpec | null {
  const A = x.A;
  const sp = x.info[A.species[s]];
  const knownItems = gatherKnown(x, s, st);
  const settled = !!st && !st.band && !!st.res;
  A.posAt(s, x.tick, _p);
  const P = x.p.grid.pos;
  const R = x.p.st.radius;
  const travel = (c: number) => {
    const d = _p[0] * P[c * 3] + _p[1] * P[c * 3 + 1] + _p[2] * P[c * 3 + 2];
    return (Math.acos(d > 1 ? 1 : d) * R) / (0.25 * sp.def.speed) * 1.6;
  };
  const c0 = A.cell[s];
  const g = x.p.grid;
  if (food || !settled || !st!.wants.length) {
    const cand: number[] = [c0];
    for (let e = g.nbrStart[c0]; e < g.nbrStart[c0 + 1]; e++) cand.push(g.nbr[e]);
    if (settled) for (const it of sp.foods) for (const c of st!.res!.items[String(it)] ?? []) if (!cand.includes(c)) cand.push(c);
    let best = -1, bit = -1, bv = 0;
    const fishIt = itemIdx(x, 'fish');
    const swimmer = sp.def.swim >= 1 || !!sp.def.fly;
    for (const it of sp.foods) {
      if (!knownItems.has(it) || it === fishIt) continue; // fishing has its own planning (banks, boats)
      const per = FOOD_SESSION[x.c.items.list[it].id] ?? 0;
      if (per <= 0) continue;
      for (const c of cand) {
        if (!swimmer && x.p.f.water[c] > 0.6) continue;
        if (settled && st!.besieged >= 0 && travel(c) > 400) continue;
        const av = availability(x, it, c);
        if (av < 0.05) continue;
        const v = (av * per) / (110 + 2 * travel(c));
        if (v > bv) { bv = v; best = c; bit = it; }
      }
    }
    // the sea may be richer than the land
    if (sp.sea && settled && st!.res!.fish.length && st!.library.includes(x.rt.byId.get('fishing') ?? -1)) {
      const fc = st!.res!.fish[0];
      const v = (availability(x, itemIdx(x, 'fish'), fc) * FOOD_SESSION.fish) / (120 + 2 * travel(fc));
      if (v > bv) return planFish(x, s, st);
    }
    if (bit >= 0 && bv * 600 > 0.15) return { kind: gatherTaskOf(x, bit), goal: spot(x, s, best, bit + 19), goalCell: best, work: 110, data: bit };
    if (sp.sea && food) { const t = planFish(x, s, st); if (t) return t; }
    if (food && (!settled || onlyFood)) return null;
  }
  if (!settled) return null;
  for (const it of st!.wants) {
    if (!knownItems.has(it)) continue;
    const cells = st!.res!.items[String(it)];
    if (!cells || !cells.length) continue;
    let best = -1, bv = 0;
    for (const c of cells) {
      // under siege nobody goes beyond the walls
      if (st!.besieged >= 0 && travel(c) > 400) continue;
      const v = availability(x, it, c) / (110 + 2 * travel(c));
      if (v > bv) { bv = v; best = c; }
    }
    if (best < 0) continue;
    return { kind: gatherTaskOf(x, it), goal: spot(x, s, best, it + 23), goalCell: best, work: 110, data: it };
  }
  return null;
}

/** food-days a full session at availability 1 yields, per food item gathered from the land or the air */
export const FOOD_SESSION: Record<string, number> = {
  berries: 4.6, 'wild-grain': 4.2, roots: 3.2, nuts: 3.6, honey: 1.2, tholin: 4.5, fish: 4.0,
};

/** items this agent's people know how to gather (settlement library, or the agent's own knowledge in a band) */
const _gatherKnown = new WeakMap<number[], { n: number; set: Set<number> }>();
function gatherKnown(x: PCtx, s: number, st: Settlement | undefined): ReadonlySet<number> {
  // a settled people's know-how is its library: the same for every member until the library changes
  if (st && !st.band) {
    const c = _gatherKnown.get(st.library);
    if (c && c.n === st.library.length) return c.set;
  }
  const out = new Set<number>();
  for (const r of x.rt.list) {
    if (!r.gatherTask) continue;
    const knows = st && !st.band ? libHas(st, r.idx) : x.A.knows(s, r.idx);
    if (knows) for (const it of r.gatherItems) out.add(it);
  }
  for (const id of ['stone', 'stick', 'wood']) { const it = itemIdx(x, id); if (it >= 0) out.add(it); }
  if (st && !st.band) _gatherKnown.set(st.library, { n: st.library.length, set: out });
  return out;
}

function planHunt(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  if (!libHas(st, x.rt.byId.get('hunting') ?? -1) || st.besieged >= 0) return null;
  const P = x.p.grid.pos;
  const bold = A.traits[s * NT + TRAIT.boldness];
  let best = -1, bd = Infinity;
  const maxD = 7 * x.p.edgeM;
  for (let i = 0; i < x.ps.herds.length; i++) {
    const h = x.ps.herds[i];
    if (h.owner >= 0 || h.count < 1) continue;
    const a = animalDef(x, h.species);
    if (a.kind === 'insect' || a.kind === 'fish' || a.habitat === 'air' || a.habitat === 'sea') continue;
    if (a.danger > 0.3 + bold * 0.5) continue;
    if (sacredAnimal(x, st, h.species)) continue;
    const d = Math.acos(Math.min(1, P[h.cell * 3] * st.pos[0] + P[h.cell * 3 + 1] * st.pos[1] + P[h.cell * 3 + 2] * st.pos[2])) * x.p.st.radius;
    if (d < bd && d < maxD) { bd = d; best = i; }
  }
  if (best < 0) return null;
  const h = x.ps.herds[best];
  herdPos(h, x.tick, _q);
  const c = x.p.cellAt(_q);
  return { kind: TASK.hunt, goal: [_q[0], _q[1], _q[2]], goalCell: c, work: 90, target: h.id };
}

export function planFish(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const A = x.A;
  const knows = st ? libHas(st, x.rt.byId.get('fishing') ?? -1) : A.knows(s, x.rt.byId.get('fishing') ?? -1);
  if (!knows) return null;
  const p = x.p;
  let c = -1;
  if (st && st.res && st.res.fish.length) c = st.res.fish[Math.floor(hashFloat(A.id[s], x.tick, 0xf15) * Math.min(3, st.res.fish.length))];
  else c = nearestCell(x, A.cell[s], 4, (o) => p.f.water[o] > 0.3);
  if (c < 0) return null;
  // stand on the bank unless a swimmer
  const sp = x.info[A.species[s]].def;
  let stand = c;
  if (sp.swim < 1 && p.f.water[c] > 0.6) {
    const g = p.grid;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (p.f.water[g.nbr[e]] < 0.4) { stand = g.nbr[e]; break; }
  }
  return { kind: TASK.fish, goal: spot(x, s, stand, 29), goalCell: stand, work: 120, target: c };
}

function planFarm(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const ag = x.rt.byId.get('agriculture');
  if (ag === undefined || !libHas(st, ag) || st.crop < 0) return null;
  const f = x.p.f;
  const A = x.A;
  // harvest ripe fields first
  for (const c of st.fields) if (f.crop[c] >= 0.55 && f.cropSpecies[c] === st.crop) return { kind: TASK.farm, goal: spot(x, s, c, 31), goalCell: c, work: 120, data2: 2, target: c };
  const seed = seedItems(x);
  const haveSeed = storeAny(st, seed) >= 1;
  for (const c of st.fields) if (f.crop[c] < 0.04 && haveSeed) return { kind: TASK.farm, goal: spot(x, s, c, 31), goalCell: c, work: 100, data2: 0, target: c };
  const want = Math.min(14, 1 + Math.ceil(pop(x, st) / 3));
  if (st.fields.length < want && haveSeed && st.res) {
    for (const c of st.res.fertile) if (!st.fields.includes(c)) return { kind: TASK.farm, goal: spot(x, s, c, 31), goalCell: c, work: 140, data2: 0, target: c };
  }
  if (st.fields.length) {
    const c = st.fields[Math.floor(hashFloat(A.id[s], x.tick, 0xfa2) * st.fields.length)];
    if (f.crop[c] > 0.03 && f.crop[c] < 0.55) return { kind: TASK.farm, goal: spot(x, s, c, 31), goalCell: c, work: 90, data2: 1, target: c };
  }
  return null;
}

const seedCache = new WeakMap<object, number[]>();
export function seedItems(x: PCtx): number[] {
  let l = seedCache.get(x.c);
  if (!l) { l = x.c.itemsByTag.get('seed')?.slice() ?? []; seedCache.set(x.c, l); }
  return l;
}

function planHerd(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const hu = x.rt.byId.get('animal-husbandry');
  if (hu === undefined || !libHas(st, hu)) return null;
  const cx = ctxOf(x, st); // (perf/plapse.ts)
  const pen = cx ? penIn(cx) : x.ps.of(st.id).find((b) => b.progress >= 1 && x.c.buildings.list[b.type].function === 'pen');
  if (!pen) return null;
  const owned = x.ps.herds.find((h) => h.owner === st.id && h.count >= 1);
  if (owned) return { kind: TASK.herd, goal: spotNear(x, s, pen.pos, 4), goalCell: pen.cell, work: 120, target: owned.id, data2: 0 };
  // tame a wild herd that can be domesticated
  const P = x.p.grid.pos;
  for (const h of x.ps.herds) {
    if (h.owner >= 0 || h.count < 2) continue;
    const a = animalDef(x, h.species);
    if (!a.domesticable || !a.domesticatesTo) continue;
    const d = Math.acos(Math.min(1, P[h.cell * 3] * st.pos[0] + P[h.cell * 3 + 1] * st.pos[1] + P[h.cell * 3 + 2] * st.pos[2])) * x.p.st.radius;
    if (d > 6 * x.p.edgeM) continue;
    herdPos(h, x.tick, _q);
    return { kind: TASK.herd, goal: [_q[0], _q[1], _q[2]], goalCell: x.p.cellAt(_q), work: 150, target: h.id, data2: 1 };
  }
  return null;
}

function planCraft(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  for (const j of st.jobs) {
    if (j.n <= 0) continue;
    const r = x.rt.list[j.k];
    if (!r || !A.knows(s, j.k)) continue;
    if (!inputsAvailable(x, st, j.k)) continue;
    if (r.tools.length && !toolsAvailable(x, st, s, j.k)) continue;
    const b = j.building >= 0 ? x.ps.building(j.building) : undefined;
    const goal = b ? spotNear(x, s, b.pos, x.c.buildings.list[b.type].footprint + 1) : spot(x, s, j.cell, 37);
    return { kind: TASK.craft, goal, goalCell: b ? b.cell : j.cell, work: r.time, data: j.k, target: j.building };
  }
  return null;
}

/** are a recipe's inputs in the store */
export function inputsAvailable(x: PCtx, st: Settlement, k: number): boolean {
  const r = x.rt.list[k];
  for (const io of r.inputs) if (storeAny(st, io.items) < io.qty) return false;
  if (r.hot && r.heat >= 300) {
    let fuel = 0;
    for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0 && (x.c.items.list[i].fuel ?? 0) >= 0.8) fuel += st.store[i];
    let need = 1;
    for (const io of r.inputs) for (const it of io.items) if ((x.c.items.list[it].fuel ?? 0) >= 0.8) need += io.qty;
    if (fuel < need) return false;
  }
  return true;
}

/** a tool of every required tag in hand or store */
export function toolsAvailable(x: PCtx, st: Settlement, s: number, k: number): boolean {
  const r = x.rt.list[k];
  for (const tl of r.tools) {
    if (x.A.tool[s] >= 0 && tl.includes(x.A.tool[s])) continue;
    if (storeAny(st, tl) < 1) return false;
  }
  return true;
}

function planBuild(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  // a building falling down comes before a new one: there is nearly always a site in hand, and repairs waited behind
  // them until whole villages of huts (thatch lasts ~40 days untended, wood ~70) stood in ruins, people still in them
  let worst: Building | null = null;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2 || b.damage < 0.6) continue;
    if (!worst || b.damage > worst.damage) worst = b;
  }
  if (worst) {
    const def = x.c.buildings.list[worst.type];
    return { kind: TASK.repair, goal: spotNear(x, s, worst.pos, def.footprint + 0.8), goalCell: worst.cell, work: 90, target: worst.id };
  }
  for (const id of st.sites) {
    const b = x.ps.building(id);
    if (!b || b.progress >= 1) continue;
    const def = x.c.buildings.list[b.type];
    const needDelivered = Math.min(def.cost, Math.ceil(def.cost * Math.min(1, b.progress + 0.34)));
    if (b.delivered < needDelivered) {
      // haul from the store if it holds the material, else go and fetch it
      const items = x.c.materials.list[b.material].items;
      let ok = true;
      let missing = -1;
      for (const io of items) { const it = io.item ? x.c.items.idx(io.item) : -1; if (it < 0 || storeHas(st, it) < io.qty) { ok = false; if (missing < 0) missing = it; } }
      if (!ok) {
        const cells = missing >= 0 && st.res ? st.res.items[String(missing)] : undefined;
        if (cells && cells.length) {
          const c = cells[Math.floor(hashFloat(A.id[s], x.tick, 0xb11) * Math.min(3, cells.length))];
          return { kind: gatherTaskOf(x, missing), goal: spot(x, s, c, missing + 29), goalCell: c, work: 110, data: missing };
        }
        // (a material nobody can fetch: the settlement revises the site, settlement.ts planConstruction)
        continue;
      }
      const c = storePoint(x, st, _q);
      return { kind: TASK.haul, goal: spotInCell(x.p, c, A.id[s], 41, [0, 0, 0]), goalCell: c, work: 12, target: b.id };
    }
    if (b.progress < b.delivered / Math.max(1, def.cost)) {
      return { kind: TASK.build, goal: spotNear(x, s, b.pos, def.footprint + 0.8), goalCell: b.cell, work: 120, target: b.id, data2: 0 };
    }
  }
  // repair a damaged building
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2 || b.damage < 0.45) continue;
    const def = x.c.buildings.list[b.type];
    return { kind: TASK.repair, goal: spotNear(x, s, b.pos, def.footprint + 0.8), goalCell: b.cell, work: 90, target: b.id };
  }
  return null;
}

/** keep watch at the edge of the village (soldiers at home while there is war or the threat of raids) */
function planGuard(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const a = hashFloat(A.id[s], Math.floor(x.tick / 240), 0x9a4d) * Math.PI * 2;
  const r = Math.max(20, Math.min(70, st.territory * 0.45));
  const goal = offsetPoint(st.pos, r, a, x.p.st.radius, [0, 0, 0]);
  return { kind: TASK.guard, goal, goalCell: x.p.cellAt(goal), work: 90 };
}

function planTendFire(x: PCtx, s: number, st: Settlement, b: Building): TaskSpec | null {
  const A = x.A;
  const fk = x.rt.byId.get('fire-keeping');
  if (fk === undefined || !A.knows(s, fk)) return null;
  if (b.fuel <= 0 && !fireSourceNear(x, st)) return null;
  const wood = itemIdx(x, 'wood');
  if (storeHas(st, wood) < 1 && storeAny(st, x.c.itemsByTag.get('fuel') ?? []) < 1) return null;
  return { kind: TASK.tendFire, goal: spotNear(x, s, b.pos, 1.6), goalCell: b.cell, work: 25, target: b.id };
}

/** the hearth most in need of fuel (or unlit) */
function lowHearth(x: PCtx, st: Settlement): Building | null {
  const cx = ctxOf(x, st); // (100x / 1000x: the settlement's hearths, sorted out once — perf/plapse.ts)
  if (cx) return lowHearthOf(cx);
  let best: Building | null = null;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2) continue;
    if (x.c.buildings.list[b.type].function !== 'hearth') continue;
    if (b.fuel < 300 && (!best || b.fuel < best.fuel)) best = b;
  }
  return best;
}

function carriesGoods(x: PCtx, s: number): boolean {
  const A = x.A;
  let q = 0;
  for (let k = 0; k < 4; k++) if (A.invItem[s * 4 + k] >= 0) q += A.invQty[s * 4 + k];
  return q >= 1.5;
}

function planStore(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const c = storePoint(x, st, _q);
  return { kind: TASK.store, goal: spotInCell(x.p, c, x.A.id[s], 43, [0, 0, 0]), goalCell: c, work: 10 };
}

/**
 * Teach: an idea this agent knows to a member who lacks it (and could learn it). What few know is taught first, and an
 * idea known by only one or two is taught even by one who has not mastered it — most of what a village worked out used
 * to be known by a single person and died with them (one death erased nine ideas). `atRisk`: only such ideas.
 */
function planTeach(x: PCtx, s: number, st: Settlement, atRisk = false): TaskSpec | null {
  const A = x.A, kw = A.kw;
  const members = x.ps.members.get(st.id) ?? [];
  let bestL = -1, bestK = -1, bv = 0;
  const salt = hashFloat(A.id[s], x.tick, 0x7eac);
  for (let w = 0; w < kw; w++) {
    const mine = A.know[s * kw + w];
    if (!mine) continue;
    for (let b = 0; b < 32; b++) {
      if (!(mine & (1 << b))) continue;
      const k = w * 32 + b;
      const r = x.rt.list[k];
      if (!r) continue;
      const skilled = A.skills[s * NS + r.skill] >= 0.45;
      if (!skilled && !atRisk && members.length > 8) continue;
      const secret = st.secrets.includes(k);
      let knowers = 0, lacking = -1;
      for (let i = 0; i < members.length; i++) {
        const m = members[(i + Math.floor(salt * members.length)) % members.length];
        if (A.knows(m, k)) { if (++knowers > 2 && (atRisk || !skilled)) break; continue; }
        if (lacking >= 0 || m === s) continue;
        if (A.flags[m] & AgentFlag.child && (x.tick - A.birth[m]) / x.year < 6) continue;
        if (secret && A.household[m] !== A.household[s]) continue;
        if (!hasPrereqs(r, A.know, m * kw, kw)) continue;
        lacking = m;
      }
      const risky = knowers <= 2;
      if (lacking < 0 || ((atRisk || !skilled) && !risky)) continue;
      // teach what few know first, what only one or two know before anything
      const v = 1 / (1 + knowers) + (risky ? 1 : 0) + (A.household[lacking] === A.household[s] ? 0.3 : 0);
      if (v > bv) { bv = v; bestL = lacking; bestK = k; }
    }
  }
  if (bestL < 0) return null;
  A.posAt(bestL, x.tick, _q);
  return { kind: TASK.teach, goal: spotNear(x, s, _q, 1.5), goalCell: x.p.cellAt(_q), work: 90, target: A.id[bestL], data: bestK };
}

function planStudy(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const wr = x.rt.byId.get('writing');
  if (wr === undefined || !A.knows(s, wr) || !st.written.length) return null;
  for (const k of st.written) {
    if (A.knows(s, k)) continue;
    const r = x.rt.list[k];
    if (!hasPrereqs(r, A.know, s * A.kw, A.kw)) continue;
    const lib = x.ps.of(st.id).find((b) => b.books.includes(k) && b.damage < 1);
    if (!lib) continue;
    return { kind: TASK.learn, goal: spotNear(x, s, lib.pos, x.c.buildings.list[lib.type].footprint + 1), goalCell: lib.cell, work: 120, data: k, target: lib.id };
  }
  return null;
}

function planPreach(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const t = templeOf(x, st);
  const goal = t ? spotNear(x, s, t.pos, x.c.buildings.list[t.type].footprint + 2) : spot(x, s, st.cell, 47);
  return { kind: TASK.preach, goal, goalCell: t ? t.cell : st.cell, work: 90 };
}

function templeOf(x: PCtx, st: Settlement): Building | undefined {
  const cx = ctxOf(x, st); // (perf/plapse.ts)
  if (cx) return templeIn(cx);
  return x.ps.of(st.id).find((b) => b.progress >= 1 && b.damage < 0.9 && x.c.buildings.list[b.type].function === 'temple');
}

function planHeal(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const med = itemIdx(x, 'medicine');
  const herb = x.rt.byId.get('herbalism');
  if (herb === undefined || !A.knows(s, herb)) return null;
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (m === s || (A.disease[m] < 0 && A.health[m] > 0.6)) continue;
    if (storeHas(st, med) < 0.5 && A.disease[m] >= 0) continue;
    A.posAt(m, x.tick, _q);
    return { kind: TASK.heal, goal: spotNear(x, s, _q, 1.2), goalCell: x.p.cellAt(_q), work: 60, target: A.id[m] };
  }
  return null;
}

// ───────────────────────────── inner life ─────────────────────────────

function planSocial(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  // gather at a lit hearth, else near someone of the household, else the centre
  const cx = ctxOf(x, st); // (perf/plapse.ts)
  const fire = cx ? litOf(cx) : x.ps.of(st.id).find((b) => b.fuel > 0 && b.progress >= 1);
  if (fire) return { kind: TASK.socialize, goal: spotNear(x, s, fire.pos, 2 + hashFloat(A.id[s], 7) * 3.5), goalCell: fire.cell, work: 60 };
  const members = x.ps.members.get(st.id) ?? [];
  if (members.length > 1) {
    const m = members[Math.floor(hashFloat(A.id[s], x.tick, 0x50c) * members.length)];
    if (m !== s) { A.posAt(m, x.tick, _q); return { kind: TASK.socialize, goal: spotNear(x, s, _q, 1.4), goalCell: x.p.cellAt(_q), work: 50, target: A.id[m] }; }
  }
  return { kind: TASK.socialize, goal: spot(x, s, st.cell, 53), goalCell: st.cell, work: 50 };
}

function planPray(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const t = templeOf(x, st);
  const kind = t ? TASK.worship : TASK.pray;
  if (t) return { kind, goal: spotNear(x, s, t.pos, x.c.buildings.list[t.type].footprint + 1.5), goalCell: t.cell, work: 60, target: t.id };
  return { kind, goal: null, goalCell: x.A.cell[s], work: 40 };
}

const _ctxSet = new Set<string>();

/** curiosity: experiment with what is at hand, study an artifact, or explore */
function planCurious(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  // artifacts first: a strange thing in the store or lying in the territory
  const art = artifactToStudy(x, s, st);
  if (art) return art;
  const recent = (k: string) => st.recent[k] !== undefined && x.tick - st.recent[k] < 2 * x.day;
  const ctxs = st.res?.contexts ?? [];
  const plan = planExperiment(x, s, st, (k) => ctxs.includes(k) || recent(k));
  if (plan) {
    const r = x.rt.list[plan.k];
    // a first try happens where it can (a self-locked craft, like firing a kiln, is first tried at an open fire)
    const tr = r.trial;
    const place = tr.needs.length || tr.heat > 0 || tr.near.length ? placeFor(x, tr, st, `t${r.idx}`) : { cell: st.cell, building: -1 };
    if (place) {
      const b = place.building >= 0 ? x.ps.building(place.building) : undefined;
      const goal = b ? spotNear(x, s, b.pos, x.c.buildings.list[b.type].footprint + 1) : spot(x, s, place.cell, 59);
      return { kind: TASK.experiment, goal, goalCell: place.cell, work: Math.max(60, Math.min(240, r.time || 90)), data: plan.k, data2: plan.triggered ? 1 : 0 };
    }
  }
  // explore beyond the fields
  if (A.traits[s * NT + TRAIT.boldness] > 0.35 || hashFloat(A.id[s], x.tick, 0xe791) < 0.3) return planExplore(x, s, st);
  return null;
}

function artifactToStudy(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const arts = x.c.itemsByTag.get('artifact') ?? [];
  // in the store
  for (const it of arts) {
    if (storeHas(st, it) < 1) continue;
    if (!unknownProducer(x, s, st, it)) continue;
    const c = storePoint(x, st, _q);
    return { kind: TASK.reverse, goal: spotInCell(x.p, c, A.id[s], 61, [0, 0, 0]), goalCell: c, work: 120, data: it, target: -1 };
  }
  // on the ground nearby
  for (const gi of x.ps.items) {
    if (!gi.artifact && !arts.includes(gi.item)) continue;
    if (!unknownProducer(x, s, st, gi.item) && !x.c.items.list[gi.item].food) continue;
    if (distM(x.p, st.pos, gi.pos) > 8 * x.p.edgeM) continue;
    return { kind: TASK.reverse, goal: [gi.pos[0], gi.pos[1], gi.pos[2]], goalCell: gi.cell, work: 120, data: gi.item, target: gi.id };
  }
  return null;
}

function unknownProducer(x: PCtx, s: number, st: Settlement, it: number): boolean {
  for (const k of x.rt.producers[it] ?? []) {
    if (x.A.knows(s, k) || libHas(st, k)) continue;
    if (isTaboo(x, st, x.A.species[s], k)) continue;
    return true;
  }
  return false;
}

function planExplore(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const g = x.p.grid;
  let c = A.cell[s];
  const steps = 4 + Math.floor(hashFloat(A.id[s], x.tick, 0xe8) * 6);
  for (let k = 0; k < steps; k++) {
    const deg = g.nbrStart[c + 1] - g.nbrStart[c];
    const o = g.nbr[g.nbrStart[c] + Math.floor(hashFloat(A.id[s], x.tick, k, 0xe9) * deg)];
    if (!isLand(x.p, o) && x.info[A.species[s]].def.swim < 1) continue;
    c = o;
  }
  if (c === A.cell[s]) return null;
  return { kind: TASK.explore, goal: spot(x, s, c, 67), goalCell: c, work: 30, target: c };
}

function planCourt(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const female = (A.flags[s] & AgentFlag.female) !== 0;
  const members = x.ps.members.get(st.id) ?? [];
  const off = Math.floor(hashFloat(A.id[s], x.tick, 0xc0e7) * Math.max(1, members.length));
  for (let i = 0; i < members.length; i++) {
    const m = members[(i + off) % members.length];
    if (m === s || A.partner[m] || ((A.flags[m] & AgentFlag.female) !== 0) === female) continue;
    if (A.flags[m] & (AgentFlag.child | AgentFlag.elder)) continue;
    if (A.mother[s] && (A.mother[m] === A.mother[s])) continue; // siblings
    if (A.id[m] === A.mother[s] || A.id[m] === A.father[s] || A.mother[m] === A.id[s] || A.father[m] === A.id[s]) continue;
    A.posAt(m, x.tick, _q);
    return { kind: TASK.court, goal: spotNear(x, s, _q, 1.2), goalCell: x.p.cellAt(_q), work: 40, target: A.id[m] };
  }
  return null;
}

function recentKinDeath(x: PCtx, s: number): boolean {
  const A = x.A;
  for (let k = 0; k < 8; k++) {
    if (A.memKind[s * 8 + k] === 5 && x.tick - A.memTick[s * 8 + k] < x.day / 2) {
      // mourned already?
      for (let j = 0; j < 8; j++) if (A.memKind[s * 8 + j] === 26 && A.memTick[s * 8 + j] >= A.memTick[s * 8 + k]) return false;
      return true;
    }
  }
  return false;
}

function planMourn(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const home = x.ps.building(x.A.home[s]);
  if (home) return { kind: TASK.mourn, goal: spotNear(x, s, home.pos, x.c.buildings.list[home.type].footprint + 1), goalCell: home.cell, work: 80 };
  return { kind: TASK.mourn, goal: spot(x, s, st.cell, 71), goalCell: st.cell, work: 80 };
}

function planBury(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  st.recent.buried = x.tick;
  const a = hashFloat(st.id, 0xb0b) * Math.PI * 2;
  const out = spotNear(x, s, st.pos, 22 + 6 * Math.sin(a));
  return { kind: TASK.bury, goal: out, goalCell: x.p.cellAt(out), work: 60 };
}

function planFollow(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const A = x.A;
  const target = st.target ?? st.pos;
  A.posAt(s, x.tick, _p);
  const d = distM(x.p, _p, target);
  if (d < 25) {
    // there already: stay close, forage, rest
    return { kind: TASK.follow, goal: spotNear(x, s, target, 4 + hashFloat(A.id[s], 9) * 10), goalCell: x.p.cellAt(target), work: 40 };
  }
  // walk a leg toward the target, one cell at a time: people walk ~15 m per game hour, so a longer leg kept a band on
  // the move for half a day or more without stopping to drink or sleep (decisions are made only when a task ends).
  // The leg follows a walkable route (A*: round lakes, up gentle slopes); a straight line led into deep water — a
  // 165 m swim that took four days. Swimmers and boat crews may cross water as their route planner allows.
  const opts = pathOptsFor(x, A.species[s]);
  if (A.boat[s] >= 0) opts.swim = Math.max(opts.swim, boatSwim(x, A.boat[s]));
  else if (opts.swim < 1) opts.swim = 0;
  opts.maxExpand = 2500;
  const tc = x.p.cellAt(target);
  findPath(x.p, A.cell[s], tc, opts, _route);
  if (_route.length) {
    const c = _route[0];
    return { kind: TASK.follow, goal: c === tc ? spotNear(x, s, target, 4 + hashFloat(A.id[s], 9) * 10) : spot(x, s, c, 73), goalCell: c, work: 20 };
  }
  const leg = Math.min(d, x.p.edgeM);
  const f = leg / d;
  const out = [_p[0] + (target[0] - _p[0]) * f, _p[1] + (target[1] - _p[1]) * f, _p[2] + (target[2] - _p[2]) * f];
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l; out[1] /= l; out[2] /= l;
  const c = x.p.cellAt(out);
  return { kind: TASK.follow, goal: spot(x, s, c, 73), goalCell: c, work: 20 };
}

const _route: number[] = [];

function planWander(x: PCtx, s: number, st: Settlement | undefined): TaskSpec | null {
  const A = x.A;
  const c = st && !st.band ? st.cell : A.cell[s];
  return { kind: TASK.wander, goal: spot(x, s, c, 79 + (x.tick % 13)), goalCell: c, work: 30 + Math.floor(hashFloat(A.id[s], x.tick, 0xa3) * 40) };
}

export { fireAt };
