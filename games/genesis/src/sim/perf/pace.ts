// GENESIS — LIVING PACE (LIVING.md §1): slow and realistic by default, with speed steps.
//
// THE CLOCK. 1 tick = 1 game minute; 1x = 1 tick per real second (types.ts TICKS_PER_SECOND_1X): a game hour lasts a
// real minute, a day 24 real minutes, a 12-day year 4.8 real hours. The speed presets (types.ts SPEED_PRESETS) are
// ticks per real second: 1x 2x 3x 5x 10x 30x 100x 300x run the plain sim (time-lapse level 0), 1000x the time-lapse
// (level 1 — the old 100x code path), 3000x the deep time-lapse (level 2 — the old 1000x path); perf/lapse.ts
// levelOfTps. The worker issues `time.scale { tps }` when the preset changes the level (logged, saved, replayed); the
// legacy `{ scale }` keeps its old meaning. `query('pace')` tells the UI what a preset means in real time.
//
// THE WORKING DAY (the rules and their constants are here; people/decide.ts, work.ts, needs.ts and plapse.ts call
// them through one-line hooks): people walk BASE_WALK = 2 m per game
// minute (people/defs.ts; 2 m/s on screen at 1x); everyday work lies within a DAY_TRIP of walking from home; work that
// is far by nature or farther than that is a trip with a camp at the site (TASK.camp); no far work is begun that cannot
// be walked to, worked and walked back from before dusk.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import type { TaskSpec } from '../people/tasks.ts';
import { AgentFlag, SPEED_PRESETS, TICKS_PER_SECOND_1X } from '../types.ts';
import { lapseLevel, levelOfTps } from './lapse.ts';
import { BASE_WALK, DAY_TRIP, INV, TASK } from '../people/defs.ts';
import { distM, sunElevation, ticksUntilSun } from '../people/world.ts';
import { MAX_WORK_COST, dayTripCost, flowCost } from '../people/resources.ts';
import { bestFood, capacity, stored, storeTake } from '../people/store.ts';
import { storePoint } from '../people/tasks.ts';
import { FOOD, NEED_N } from '../people/needs.ts';

export { levelOfTps, DAY_TRIP };

/** a trip (work that is far, with a camp at the site) lasts at most this many game days (rule 2) */
export const TRIP_DAYS = 3;
/** a worker's full load (kg): carried home when full, at the day's end, or when the trip is over (rule 4) */
export const LOAD_KG = 20;
/** the haul of a trip (kg): cached at the camp and carried home when the trip is over (or this much is gathered) */
export const TRIP_LOAD_KG = 40;
/** food-days a trip's haul brings home at most before the trip turns home (the village eats while they are away: a
 * fishing camp that sat on sixty days of fish while the store at home ran empty starved the town) */
export const TRIP_FOOD_DAYS = 12;
/** within this of the store point (m) a worker is at home: no provisions to carry, no dusk rule */
export const NEAR_HOME_M = 40;
/** at night, a walk home to bed longer than this (ticks: three quarters of an hour, beyond the village) is not walked:
 * they camp where night fell (rule 3) */
export const ROAD_CAMP_TICKS = 45;
/**
 * Work sessions of realistic lengths (game minutes; rule 4: forage 2–3 h, fish 2–4 h, field work 3–4 h) — the plain
 * sim's sessions were 1.5–2 h with a walk home after each. Yields per session are those of the old sessions.
 */
export const SESSION = { gather: 150, fish: 180, sow: 180, tend: 180, harvest: 210, field: 210, herd: 180, hunt: 120 } as const;
/**
 * Food a session of foraging or fishing yields, × the plain sim's (rule 4: the hours fast walking frees go to rest,
 * faith, crafts and building, not to twice the food — food gathered per adult-day stays within ±25 % of the old 1.25
 * units). Calibrated with the daily probe (_harness/scratch/living/pace).
 */
export const FOOD_YIELD = 0.6;
/**
 * Days of food a head kept (store and hauls, perishables weighted: keptFood) below which a settled people's gatherers go
 * for food (decide.ts gatherWork; the plain sim's 4 days were never reached while walking ate the day — rule 4)
 */
export const LEAN_DAYS = 4;
/** days of food a head kept at which fishers and hunters rest their nets and spears and turn to the settlement's other
 * wants, as gatherers do (decide.ts planWork): fish rot in a full store */
export const PLENTY_DAYS = LEAN_DAYS;
/**
 * Sessions of food work (foraging, fishing) in a working day (A.dayWork, counted since the agent last slept): a day's
 * food work is one long session — then the settlement's other wants, crafts, building, company, faith (rule 4: what fast
 * walking frees is not spent on more food). One more while the store holds under HUNGRY_DAYS a head; the hungry
 * themselves are never held back (decide.ts planEat). Measured (pace.ts daily, 6 seeds): food gathered 1.51 units per
 * adult-day against 1.45 eaten (the plain sim at 0.25 m a minute: 1.25 gathered, 1.43 eaten — its stores ran down);
 * two sessions a day gathered 2.30 against 1.58 eaten, the stores filling and rotting.
 */
export const FOOD_SESSIONS = 1;
export const HUNGRY_DAYS = 1.5;

/** what a preset means (query 'pace'): the speed now (ticks per real second), its time-lapse level, the presets, and
 * how long a game day and year of planet p last in real seconds at this speed (null while paused) */
export function paceQuery(u: Universe, tps: number, p: Planet | undefined): Record<string, unknown> {
  const dayHours = p ? p.st.dayHours : 24;
  const day = Math.max(60, Math.round(dayHours * 60));
  const year = p ? p.st.orbit.period : day * 12;
  const rate = tps * TICKS_PER_SECOND_1X;
  return {
    tps,
    ticksPerSecond1x: TICKS_PER_SECOND_1X,
    level: lapseLevel(u),
    levelOfPreset: levelOfTps(tps),
    presets: SPEED_PRESETS.map((s) => ({ preset: s, tps: s * TICKS_PER_SECOND_1X, level: levelOfTps(s * TICKS_PER_SECOND_1X), realSecondsPerDay: s > 0 ? day / (s * TICKS_PER_SECOND_1X) : null })),
    realSecondsPerDay: rate > 0 ? day / rate : null,
    realSecondsPerYear: rate > 0 ? year / rate : null,
    gameMinutesPerTick: 1,
  };
}

// ───────────────────────────── the working day (LIVING.md §1.3) ─────────────────────────────
//
// A worker setting out from home for work beyond the village takes the day's food (a meal from the store) and a water
// skin: A.trip holds the tick the provisions last until (sunset for a day trip), and while it holds, water is at hand
// (decide.ts waterHere) and the meal is eaten where they work. Loads go home when full (LOAD_KG), when the day's work is
// done, or when the agent is at home anyway — not after every session (store walks were a third of the walking at
// 2 m/tick). Work farther than a DAY_TRIP from home — and every hunt — is a TRIP: food for up to TRIP_DAYS, nights at a
// camp at the site (TASK.camp, warmed by a camp fire where fire is known), the work repeated around the camp, and the
// yield carried home at the end (A.camp holds the camp cell). No far work is begun after dusk, nor any whose walk out,
// work and walk back do not fit in the daylight left; a worker overtaken by the night far from home camps where they
// are instead of walking home in the dark.

/** work that may be a trip with a camp (gathering, mining, fishing, hunting, taming at pasture); the rest is day work */
const TRIP_WORK = new Set<number>([
  TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.mine, TASK.cutIce, TASK.collectAir, TASK.secrete, TASK.fish, TASK.hunt, TASK.herd,
]);

/** the walk home at night that is not walked (ticks): ROAD_CAMP_TICKS, and never less than from the ring of cells around
 * home (on a coarse world the next cell is home ground — resources.ts dayTripCost) */
function roadCampTicks(x: PCtx): number {
  const ring = (x.p.edgeM * 1.6) / BASE_WALK;
  return ring > ROAD_CAMP_TICKS ? ring : ROAD_CAMP_TICKS;
}

/** where an agent's work may be planned: 0 out of reach, 1 everyday work (a day trip), 2 a trip with a camp */
export const REACH_NO = 0, REACH_DAY = 1, REACH_TRIP = 2;

/** is agent s provisioned for work away from home (a day trip or a camp trip) */
export function provisioned(x: PCtx, s: number): boolean {
  return x.A.trip[s] > x.tick;
}

/** is agent s away on a trip, sleeping at a camp (A.camp the camp cell) */
export function camping(x: PCtx, s: number): boolean {
  return x.A.camp[s] >= 0 && x.A.trip[s] > x.tick;
}

/** the trip is over (the provisions are home, or eaten) */
export function endTrip(x: PCtx, s: number): void {
  x.A.trip[s] = 0;
  x.A.camp[s] = -1;
  x.A.tripTask[s] = 0;
}

/** the weight an agent carries (kg) */
export function loadKg(x: PCtx, s: number): number {
  const A = x.A, items = x.c.items.list;
  let kg = 0;
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it >= 0) kg += A.invQty[s * INV + k] * (items[it]?.weight ?? 1);
  }
  return kg;
}

/** an agent's walking speed on the flat (m per tick: species, age, health — tasks.ts nextSegment's factors) */
export function walkRate(x: PCtx, s: number): number {
  const A = x.A;
  const age = A.flags[s] & AgentFlag.child ? 0.75 : A.flags[s] & AgentFlag.elder ? 0.7 : 1;
  return Math.max(0.05, BASE_WALK * x.info[A.species[s]].def.speed * age * (0.45 + 0.55 * A.health[s]));
}

/** ticks to walk from a to b (a way is ~25 % longer than the straight line) */
export function walkTicks(x: PCtx, s: number, a: ArrayLike<number>, b: ArrayLike<number>): number {
  return (distM(x.p, a, b) * 1.25) / walkRate(x, s);
}

const _h = [0, 0, 0];
const _a = [0, 0, 0];
const _c = [0, 0, 0];

/** daylight left for agent s (ticks; 0 at night — for a nocturnal people, night is their day) */
export function daylightLeft(x: PCtx, s: number): number {
  const A = x.A;
  A.posAt(s, x.tick, _a);
  const noct = x.info[A.species[s]].def.nocturnal;
  const night = sunElevation(x.u, x.p, x.tick, _a) < -0.03;
  if (night !== noct) return 0;
  return ticksUntilSun(x.u, x.p, x.tick, _a, noct ? 'rise' : 'set', 8 * 60);
}

/** where work at cell c may be planned for agent s of settlement st: at the camp of a trip only around it; else within
 * a day trip of home (everyday work), or beyond it within the work reach (a trip) */
export function reachOf(x: PCtx, s: number, st: Settlement, c: number): number {
  const A = x.A;
  if (A.camp[s] >= 0 && A.trip[s] > x.tick) {
    const P = x.p.grid.pos, k = A.camp[s];
    const d = P[k * 3] * P[c * 3] + P[k * 3 + 1] * P[c * 3 + 1] + P[k * 3 + 2] * P[c * 3 + 2];
    return Math.acos(d > 1 ? 1 : d) * x.p.st.radius <= 1.2 * x.p.edgeM ? REACH_DAY : REACH_NO;
  }
  const k = flowCost(st, c);
  return k <= dayTripCost(x.p) ? REACH_DAY : k <= MAX_WORK_COST ? REACH_TRIP : REACH_NO;
}

/** take food for `days` from the store into the hand (a meal for a day trip; the trip's food for a camp) */
function provisionFood(x: PCtx, s: number, st: Settlement, days: number): void {
  const A = x.A;
  const sp = x.info[A.species[s]];
  for (const it of sp.foods) if (A.carried(s, it) * sp.edible[it] >= days * 0.5) return;
  const food = bestFood(x, st);
  if (food < 0) return;
  const got = storeTake(st, food, days / Math.max(0.05, sp.edible[food]));
  if (got > 0) { const left = A.give(s, food, got); if (left > 0) st.store[food] = (st.store[food] ?? 0) + left; }
}

/**
 * The working-day rules for a work task just planned (decide.ts, candidate `work`, a settled agent not on a mission):
 * returns the task (provisioned, or made a trip) or null when it may not be begun now (dusk) — the decision then goes
 * on to its next candidate. Work at home (within NEAR_HOME_M of the store point) and work where the agent stands pass.
 */
export function paceWork(x: PCtx, s: number, st: Settlement, t: TaskSpec): TaskSpec | null {
  const A = x.A;
  if (!t.goal) return t;
  const hunt = t.kind === TASK.hunt;
  const trippable = TRIP_WORK.has(t.kind);
  const home = _h;
  storePoint(x, st, home);
  A.posAt(s, x.tick, _a);
  if (camping(x, s)) {
    // at a camp: the trip's work goes on around it; anything else means the work here is done — home with the yield
    if (reachOf(x, s, st, t.goalCell) === REACH_DAY) return t;
    endTrip(x, s);
    return null;
  }
  if (!hunt && distM(x.p, t.goal, home) <= NEAR_HOME_M) return t;
  const light = daylightLeft(x, s);
  const out = walkTicks(x, s, _a, t.goal);
  // (work at people — teaching, healing — and the fields are day work, however far: no camp for them)
  const far = trippable && (hunt || flowCost(st, t.goalCell) > dayTripCost(x.p));
  const atHome = distM(x.p, _a, home) <= NEAR_HOME_M;
  if (far) {
    // a trip: set out only with the daylight to walk there; food for the days, nights at a camp at the site
    if (out > light) return null;
    A.trip[s] = x.tick + TRIP_DAYS * x.day;
    A.camp[s] = t.goalCell;
    A.tripTask[s] = t.kind | (((t.data ?? -1) + 1) << 8);
    if (atHome) provisionFood(x, s, st, Math.min(TRIP_DAYS, 2));
    return t;
  }
  // a day trip: walk out, work and walk back before dusk
  const back = walkTicks(x, s, t.goal, home);
  if (out + t.work + back > light) return null;
  if (!provisioned(x, s) && atHome) {
    A.trip[s] = x.tick + light;
    A.camp[s] = -1;
    provisionFood(x, s, st, 0.5);
  }
  return t;
}

/**
 * Utility adjustments of the working day (decide.ts, a settled agent not on a mission, after its utilities are set):
 * provisions run out; at a camp the life of home (company, worship, curiosity, courting, mourning, the hearth,
 * wandering) waits; a load goes home only when full, when the day's work is done, or when home is right here.
 * `C` is decide.ts's candidate table.
 */
export function paceUtilities(x: PCtx, s: number, st: Settlement, U: Float64Array, C: Readonly<Record<string, number>>, night: boolean): void {
  const A = x.A;
  if (A.trip[s] !== 0 && A.trip[s] <= x.tick) endTrip(x, s);
  const camp = A.camp[s] >= 0;
  if (camp) {
    U[C.social] = 0; U[C.pray] = 0; U[C.curious] = 0; U[C.court] = 0; U[C.mourn] = 0; U[C.bury] = 0; U[C.tendFire] = 0; U[C.wander] = 0;
    // hungry with nothing in hand: the trip is over (home to the store)
    const sp = x.info[A.species[s]];
    if (A.needs[s * NEED_N + FOOD] < 0.3) {
      let food = false;
      for (const it of sp.foods) if (A.carried(s, it) > 0.05) { food = true; break; }
      if (!food) { endTrip(x, s); return; }
    }
    // a hunter with a kill carries it home; a haul of food goes home while the village needs it
    const meat = x.c.items.idx('meat');
    if (meat >= 0 && A.carried(s, meat) > 0.5) { endTrip(x, s); return; }
    let fd = 0;
    for (const it of sp.foods) fd += A.carried(s, it) * (x.c.items.list[it].food ?? 0);
    if (fd >= TRIP_FOOD_DAYS) { endTrip(x, s); return; }
  }
  if (U[C.store] <= 0) return;
  storePoint(x, st, _h);
  A.posAt(s, x.tick, _c);
  if (distM(x.p, _c, _h) <= NEAR_HOME_M) return;
  const toHome = walkTicks(x, s, _c, _h);
  // at night a load far from home waits for the morning (no walking home in the dark: they camp — paceSleep)
  if (night) { if (camp || toHome > roadCampTicks(x)) U[C.store] = 0.3; return; }
  if (loadKg(x, s) >= (camp ? TRIP_LOAD_KG : LOAD_KG)) return;
  // the day's work done: no time for another session and the walk home
  if (!camp && daylightLeft(x, s) < SESSION.gather + toHome) return;
  // not provisioned (a builder's errand, a gatherer who never passed home): the goods are wanted at home
  if (!provisioned(x, s)) return;
  U[C.store] = 0.3;
}

/** a night where night fell on agent s (a camp, or the road far from home): the sleep task, or null to sleep at home */
export function paceSleep(x: PCtx, s: number, st: Settlement, night: boolean, dur: number): TaskSpec | null {
  const A = x.A;
  if (!camping(x, s)) {
    if (!night) return null;
    // the way to bed: home, else the store point
    const bed = x.ps.building(A.home[s]);
    if (bed) { _h[0] = bed.pos[0]; _h[1] = bed.pos[1]; _h[2] = bed.pos[2]; } else storePoint(x, st, _h);
    A.posAt(s, x.tick, _a);
    if (walkTicks(x, s, _a, _h) <= roadCampTicks(x)) return null;
    // inside their own village they walk home to bed however long the way (a town of a hundred spans more than the 45
    // minutes of ROAD_CAMP_TICKS: in the integrated acceptance run, year 50, 36 of 49 adults of one town slept out in its
    // square after the evening worship and the festival instead of going home — integration, 2026-10-15)
    if (distM(x.p, _a, st.pos) <= st.territory) return null;
  }
  return { kind: TASK.camp, goal: null, goalCell: A.cell[s], work: dur, target: -1 };
}

/** a camper of a people that keeps fire sleeps by a camp fire (needs.ts: warmth and the night's safety) */
export function campFire(x: PCtx, s: number): boolean {
  const A = x.A;
  if (A.task[s] !== TASK.camp || A.phase[s] !== 1) return false;
  const st = x.ps.settlement(A.settlement[s]);
  if (!st) return false;
  const fk = x.rt.byId.get('fire-keeping');
  return fk !== undefined && st.library.includes(fk);
}

/**
 * How much more a day of perishable food counts toward "enough in store": fresh berries and fish are gathered for the
 * next day or two, grain, nuts and dried meat for the season (a day of food that rots at d a day counts 1 + PERISH × d:
 * berries ×3, fish ×4, grain ×1.04). Gatherers who filled the store with four days of berries a head threw a fifth of
 * it away every day and foraged the more for it (food gathered per adult-day ran ×2-3 once walking stopped eating the
 * day — rule 4).
 */
export const PERISH = 10;

/** (one settlement's kept food per tick: decisions of the same tick ask again and again) */
let _kfSt = -1, _kfTick = -1, _kfV = 0;

/**
 * Days of food a head st keeps, weighted for perishables (PERISH): its store, and what its members carry (the meals
 * they took, the hauls of trips not yet home — a store judged lean while the hauls sat at the camps sent everyone
 * foraging). Divided by the people it feeds this is the "days a head" the gatherers fill to (decide.ts gatherWork).
 */
export function keptFood(x: PCtx, st: Settlement): number {
  if (_kfSt === st.id && _kfTick === x.tick) return _kfV;
  const A = x.A, items = x.c.items.list;
  const ed = x.info[st.species].edible;
  let d = 0;
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0 && ed[i] > 0) d += st.store[i] * ed[i] * (1 + PERISH * (items[i].decay ?? 0));
  for (const m of x.ps.members.get(st.id) ?? []) {
    for (let k = 0; k < INV; k++) {
      const it = A.invItem[m * INV + k];
      if (it >= 0 && ed[it] > 0) d += A.invQty[m * INV + k] * ed[it] * (1 + PERISH * (items[it].decay ?? 0));
    }
  }
  _kfSt = st.id; _kfTick = x.tick; _kfV = d;
  return d;
}

/** gathering task kinds whose item is A.tData (a trip goes on gathering the same thing around its camp) */
const GATHERING = new Set<number>([TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.mine, TASK.cutIce, TASK.collectAir, TASK.secrete]);

/**
 * The work of a trip goes on around its camp (decide.ts planWork, while camping): the gathering, fishing or hunt it
 * went out for (A.tripTask), whatever the store at home wants this hour — a trip set out for berries does not turn home
 * because the village now wants stone. Null: nothing of it left around the camp (or the day's food work is done).
 */
export function campWork(x: PCtx, s: number, st: Settlement, plan: { gather: (it: number) => TaskSpec | null; fish: () => TaskSpec | null; hunt: () => TaskSpec | null }): TaskSpec | null {
  const A = x.A;
  const k = A.tripTask[s] & 255, it = (A.tripTask[s] >> 8) - 1;
  // (the day's food work done: the afternoon is spent at the camp)
  const food = k === TASK.fish || (GATHERING.has(k) && it >= 0 && (x.c.items.list[it]?.food ?? 0) > 0);
  if (food && foodSessionsLeft(x, s, st) <= 0) return null;
  if (GATHERING.has(k) && it >= 0) return plan.gather(it);
  if (k === TASK.fish) return plan.fish();
  if (k === TASK.hunt) return plan.hunt();
  return null;
}

/** food work an agent may still do today (sessions; decide.ts gatherWork, the fishers and hunters; plapse.ts stretches) */
export function foodSessionsLeft(x: PCtx, s: number, st: Settlement): number {
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[1] + st.cohort.n[0] * 0.5;
  const cap = FOOD_SESSIONS + (foodDaysOf(x, st) < pop * HUNGRY_DAYS ? 1 : 0);
  return cap - x.A.dayWork[s];
}

function foodDaysOf(x: PCtx, st: Settlement): number {
  const ed = x.info[st.species].edible;
  let d = 0;
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0 && ed[i] > 0) d += st.store[i] * ed[i];
  return d;
}

/** a session of food work done (work.ts gather of a food, fish) */
export function foodSessionDone(x: PCtx, s: number): void {
  if (x.A.dayWork[s] < 255) x.A.dayWork[s]++;
}

/**
 * The store is full (its goods fill what its buildings hold: store.ts capacity): what more food comes in rots there
 * (store.ts spoil — up to 15 % a day of every food). Gatherers then turn to the settlement's other wants and the nets
 * rest (decide.ts gatherWork, plenty): a target of four days a head that the store could not hold kept every gatherer
 * foraging all day once walking no longer ate the day (rule 4).
 */
export function storeFull(x: PCtx, st: Settlement): boolean {
  if (_sfSt === st.id && _sfTick === x.tick) return _sfV;
  _sfSt = st.id; _sfTick = x.tick; _sfV = stored(st) >= capacity(x, st);
  return _sfV;
}
let _sfSt = -1, _sfTick = -1, _sfV = false;
