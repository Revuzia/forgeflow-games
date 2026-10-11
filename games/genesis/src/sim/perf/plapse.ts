// GENESIS — SIM perf push 3: the PEOPLES' TIME-LAPSE (CONTRACT.md §5 note; the levels are perf/lapse.ts's logged
// `time.scale`: 1x / 10x → 0, 100x → 1, 1000x → 2).
//
// At level 0 nothing here acts and no state is kept: the people sim is exactly the plain one (every helper returns the
// plain answer before touching anything). At level 1 / 2 people live their days in coarser chunks — deterministically:
// every rule is a pure function of the saved state and the level, which is itself in the command log.
//
//   * STRETCHED TASKS. A task of the day's work (gathering, fishing, hunting, crafting, tending fields, teaching,
//     study, preaching, courting, healing, keeping watch, herding; wandering and idling too) stands for k ≤
//     STRETCH[level] = 2 / 4 sessions back to back — as many as the agent would work through anyway before a need or
//     the day calls it away: k is cut to the time left until water, food or rest would win the next decision (the
//     utility thresholds of decide.ts), until dusk (dawn for a night owl's work), and nothing is stretched under
//     thermal stress. Round 2: also to the time until ANOTHER activity might win a decision between the sessions
//     (decide.ts noteRivals → `rival`: none while a rival is within the decision jitter's reach, else until company,
//     faith, curiosity or a bath, rising as their needs decay, come within it) — a stretch otherwise inflated the share
//     of whatever was chosen (work +9 %, a child's company +40 % of the day); and a child's company is no longer
//     stretched at all (a session fills the need). The walk there is walked once (batched, below); the work phase lasts k sessions plus, for the
//     work whose yield is carried home (gathering, fishing, hunting), the k − 1 round trips to the store it stands
//     for (estimated from the distance: an agent's day keeps its totals of work AND of walking, and the ways are worn
//     as often). Its effect is k sessions: work.ts finishTask runs k times at the sessions' own ticks, so every chance
//     roll is the one a session ending at that tick draws, and yields, the land's depletion, skills and learning add
//     up as k sessions do (the k loads are carried home in one trip). An agent decides up to k times less often.
//     AgentStore.dmg — an unused per-agent float of the store, always 0 in the plain sim — holds k + 16 × (the extra
//     ticks per session) while such a task runs (0 otherwise; never written at level 0). An agent woken early (an
//     interruption, a mission) is credited with the whole sessions it worked (round 2: people.ts interrupt runs
//     `creditStretched` — it used to drop them all). Tasks a need drives (eating, drinking,
//     sleep, warmth, a bath, flight, company, prayer, worship, curiosity — a need tops out after a session or two, so
//     k sessions would only burn the hours), fires (a hearth takes what it needs), repairs and the errands that
//     happen once (sowing, harvest, storing, hauling and building, mourning, burial, exploring, a band's march),
//     missions, boats, the possessed and the god's disciples are never stretched.
//   * BATCHED WALKS. A walk's segment runs on through several waypoints (straight between them, as the renderer's
//     snapshots 1-2 game hours apart draw it anyway) up to a longer leg (tasks.ts MAX_LEG × LEG[level]): a couple of
//     wake-ups per walk instead of one per cell. Every cell passed is still worn. (Round 2: a flight from fire is
//     walked as at 1x — plain legs, woken on arrival: see mergeArrival.)
//   * COARSE SETTLEMENT STEP. settlement.ts settlementStep runs every SETTLE_HOURS[level] = 2 / 4 hours (staggered
//     by id) and integrates the hours it stands for: the hearths burn the elapsed time, births, old age and the
//     accidents of daily life take the window's probability, sickness and the cohort step run hour by hour at the
//     window's own ticks, and what is due once a day or every few hours (the daily round, jobs, wants, roles,
//     construction, the resource caches) runs when its hour falls inside the window. Each settlement keeps the tick
//     it last stepped in settings.lapse.run (`<planet>:s<id>`) while time-lapse is or was on, so a step after a level
//     switch integrates exactly the hours since the last one (lapse.ts's rule); back at level 0 the record is
//     consumed by the next hourly step. Bands stay hourly (their march is a sequence of short decisions).
//   * CONTEXT CACHES (decide.ts, tasks.ts): what a decision reads off its settlement's buildings (the hearth most in
//     need of fuel, the store point, a lit fire, the temple, a pen) comes from the settlement's buildings sorted by
//     what they are for once per change of its building list (`ctxOf`), with each building's state read live — so the
//     answer is always the plain one, and a save / load at any tick continues bit for bit.
//   * IN PASSING (`inPassing`): water at hand and food in the hand are taken when the agent decides — what a 1x agent
//     takes where it stands (no walk is skipped; meals from the store keep their walk home). Round 2: a drink takes
//     its time (DRINK_TICKS: the task decided with it starts that much later) — a free drink gave the day's drinking
//     time to work and food in store ran 10-25 % high from the third game year.
//   * A world the camera is not on (lapse.ts planetLevel 3) takes the 4th column of each table: 4 sessions, legs ×4,
//     a settlement step every 6 hours.
//
// What this costs in fidelity is measured against 1x over FIVE game years (round 2; population, food in store by
// year, ideas, era, discoveries, buildings, births, deaths by cause; 6 seeds, against a 1x twin perturbed once as the
// noise yardstick; deaths by cause over 12 seeds): _harness/scratch/perf3/r2/curves.ts + cmp12.ts (by year; deaths by
// cause); the numbers are in CONTRACT §5. (Those runs predate the seed salt of the peoples' dice — lifecycle.ts
// worldSalt: agent ids repeat from world to world, so plain runs of any seed drew the same initial ages and old-age
// rolls; the harness's SALT=1 runs — all 12 deaths-by-cause seeds, 6 of the 12 curve seeds — offset the ids per seed.)
// Nothing here draws those dice: settlement.ts rolls births, old age and accidents with the window's chance itself.

import type { PCtx } from '../people/ctx.ts';
import type { Settlement, Building } from '../people/state.ts';
import { AgentFlag } from '../types.ts';
import { BASE_WALK, PATH_MAX, PHASE, TASK } from '../people/defs.ts';
import { distM, spotInCell, stepFactor, sunElevation, ticksUntilSun, walkSpeed } from '../people/world.ts';
import { FOOD, NEED_N, REST, WATER, lastStress } from '../people/needs.ts';
import { wearRoad } from '../people/roads.ts';
import { planetLevel } from './lapse.ts';

/** most sessions a stretched task stands for, per level (lapse.ts planetLevel: 3 = a world the camera is not on) */
export const STRETCH: readonly [number, number, number, number] = [1, 2, 4, 4];
/** longest walking leg (× tasks.ts MAX_LEG), per level */
export const LEG: readonly [number, number, number, number] = [1, 2, 4, 4];
/** hours a settlement step integrates, per level */
export const SETTLE_HOURS: readonly [number, number, number, number] = [1, 2, 4, 6];

/** how a task kind takes stretching: not at all, k sessions (finishTask k times), or time only (wander, idle) */
const NONE = 0, REPEAT = 1, ONCE = 2;
const MODE = new Uint8Array(64);
for (const k of [
  TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.mine, TASK.cutIce, TASK.collectAir, TASK.secrete, TASK.fish, TASK.hunt,
  TASK.guard, TASK.craft, TASK.herd, TASK.teach, TASK.learn, TASK.preach, TASK.court, TASK.heal,
]) MODE[k] = REPEAT;
for (const k of [TASK.wander, TASK.idle]) MODE[k] = ONCE;
/** work whose yield is carried home: each session stands for a round trip to the store as well */
const CARRY = new Uint8Array(64);
for (const k of [TASK.forage, TASK.chop, TASK.quarry, TASK.dig, TASK.mine, TASK.cutIce, TASK.collectAir, TASK.secrete, TASK.fish, TASK.hunt]) CARRY[k] = 1;
/** the need levels below which decide.ts's utilities put drink / food / rest ahead of the day's work (≈ 0.7-0.9) */
const WATER_AT = 0.5, FOOD_AT = 0.45, REST_DAY = 0.3, REST_NIGHT = 0.95;

/**
 * Round 2: the ticks a 1x agent would go on choosing the activity just decided, before a rival might win a decision
 * between its sessions (decide.ts noteRivals writes it right before startTask at levels ≥ 1; stretchFor reads and
 * resets it; Infinity = no rival, 0 = a rival is within reach now). Not state: written and read within one decision.
 */
export const rival = { ticks: Infinity };

/** the time-lapse level of the agents' world (0 without state: the common case costs one property read; 3 on a world
 * the camera is not on — lapse.ts planetLevel) */
function level(x: PCtx): number {
  return x.u.settings.lapse ? planetLevel(x.u, x.p) : 0;
}

/**
 * The stretch of the task about to start (startTask), encoded for AgentStore.dmg: k + 16 × e (k sessions, e extra ticks
 * per session for the round trip home), 0 = not stretched (always at level 0). `t` is the TaskSpec (farm: only
 * tending, data2 1, repeats — sowing and harvest are once-only errands).
 */
export function stretchFor(x: PCtx, s: number, t: { kind: number; data2?: number; goal: number[] | null; work: number }): number {
  // (round 2: the decision's rivals — decide.ts noteRivals — are read once, by the task they were noted for)
  const rv = rival.ticks;
  rival.ticks = Infinity;
  if (!x.u.settings.lapse) return 0;
  const lv = planetLevel(x.u, x.p);
  if (lv === 0) return 0;
  const kind = t.kind;
  const A = x.A;
  // (round 2: a child's company is no longer stretched — a session fills its need for company, so at 1x the next decision
  // is mostly something else; stretched in time it took 40 % more of the children's day at 1000x)
  const mode = kind === TASK.farm ? (t.data2 === 1 ? REPEAT : NONE) : MODE[kind];
  if (mode === NONE || lastStress > 0.05) return 0;
  if (A.mission[s] || A.boat[s] >= 0 || A.flags[s] & (AgentFlag.possessed | AgentFlag.disciple)) return 0;
  const st = x.ps.settlement(A.settlement[s]);
  if (!st || st.band) return 0;
  const cx = ctxOf(x, st);
  if (!cx) return 0;
  // the time until a need or the day calls the agent away
  const sp = x.info[A.species[s]];
  const noct = sp.def.nocturnal;
  A.posAt(s, x.tick, _p);
  const night = sunElevation(x.u, x.p, x.tick, _p) < -0.03 !== noct;
  let budget = ticksUntilSun(x.u, x.p, x.tick, _p, night === noct ? 'set' : 'rise', 8 * 60);
  const N = A.needs, nb = s * NEED_N, day = x.day, dec = sp.decay;
  if (sp.needW[WATER] > 0 && dec[WATER] > 0) budget = Math.min(budget, ((N[nb + WATER] - WATER_AT) * day) / dec[WATER]);
  if (sp.needW[FOOD] > 0 && dec[FOOD] > 0) budget = Math.min(budget, ((N[nb + FOOD] - FOOD_AT) * day) / dec[FOOD]);
  if (dec[REST] > 0) budget = Math.min(budget, ((N[nb + REST] - (night ? REST_NIGHT : REST_DAY)) * day) / dec[REST]);
  // ... or another activity would win a decision between the sessions (round 2: decide.ts noteRivals)
  if (rv < budget) budget = rv;
  // a session: the work, and for carried yields the way home and back (at a plain walk on the flat)
  const w = Math.max(1, Math.round(t.work));
  const v = BASE_WALK * sp.def.speed * 0.8;
  const w0 = t.goal ? distM(x.p, _p, t.goal) / v : 0;
  let e = 0;
  if (CARRY[kind] && t.goal) { storeIn(cx, st, _sp); e = Math.min(4000, Math.round((2 * distM(x.p, t.goal, _sp)) / v) + 10); }
  let k = Math.floor((budget - w0 + e) / (w + e));
  if (k > STRETCH[lv]) k = STRETCH[lv];
  return k > 1 ? k + 16 * e : 0;
}

/** k of an encoded stretch (A.dmg) */
function kOf(d: number): number {
  return d > 1 ? d % 16 : 1;
}

/** the sessions of agent s's current task (its k while stretched, else 1) */
export function stretchOf(x: PCtx, s: number): number {
  return kOf(x.A.dmg[s]);
}

/** the ticks the work phase of agent s's current task lasts (k sessions and their k − 1 trips home; plain: tWork) */
export function workTicks(x: PCtx, s: number): number {
  const A = x.A, d = A.dmg[s];
  if (d <= 1) return A.tWork[s];
  const k = d % 16;
  return A.tWork[s] * k + (k - 1) * Math.floor(d / 16);
}

/** how many times the way walked now is worn: the k − 1 trips home a carried yield's stretch stands for go both ways */
export function wearOf(x: PCtx, s: number): number {
  const A = x.A, d = A.dmg[s];
  if (d <= 1 || !CARRY[A.task[s]]) return 1;
  return 2 * (d % 16) - 1;
}

/** the cell of a task's goal point: at 100x / 1000x the cell the plan named (a spot is drawn inside it, or a step from
 * a building in it) instead of locating the point on the grid again; the plain `cellAt(goal)` at level 0 */
export function goalCellOf(x: PCtx, goal: number[], cell: number): number {
  return cell >= 0 && level(x) > 0 ? cell : x.p.cellAt(goal);
}

/** the longest leg (ticks) agent s walks without waking, from the plain `maxLeg` (`kind`: its task. Push 3 round 2: a
 * flight from fire walks as at 1x — see mergeArrival) */
export function legOf(x: PCtx, maxLeg: number, kind = -1): number {
  const lv = level(x);
  return lv === 0 || kind === TASK.flee ? maxLeg : maxLeg * LEG[lv];
}

/** the batched segment found by batchHops: its last waypoint cell, its duration (ticks), and whether it ends at the
 * task's goal point */
export const batch = { to: -1, dur: 0, atGoal: false };
const _g = [0, 0, 0];
const _p = [0, 0, 0];
/** a store point (stretchFor) */
const _sp = [0, 0, 0];

/**
 * A batched walk (levels ≥ 1; tasks.ts nextSegment, on land, not afloat, not flying): the segment that starts toward
 * waypoint cell `to` (goal point `goal`, `dur` ticks) runs on through the following waypoints of the agent's path
 * while the whole leg stays within `maxLeg` ticks, straight from point to point. Each further hop costs what its own
 * segment would have (terrain, slope, roads, weather: the same formulas); every waypoint cell passed on the way is worn
 * `wear` times (wearOf; the cell the segment ends in is worn by the caller).
 * Stops before deep water (swum hop by hop) and impassable steps. Writes the new end point into `goal` and the end
 * cell and duration into `batch`.
 */
export function batchHops(x: PCtx, s: number, to: number, goal: number[], dur: number, speed: number, ageF: number, swim: number, maxLeg: number, gcell: number, wear: number): void {
  const A = x.A, p = x.p, water = p.f.water;
  const base = s * PATH_MAX;
  let at = to, total = dur, atGoal = false;
  while (A.pathPos[s] < A.pathLen[s]) {
    const i = A.pathPos[s];
    const nxt = A.path[base + i];
    if (nxt === at || water[nxt] > 0.6) break;
    const kf = stepFactor(p, at, nxt, swim, false);
    if (kf === Infinity) break;
    // its point: the goal itself at the path's end, else the agent's spot in the cell (nextSegment's salts)
    const last = i + 1 >= A.pathLen[s] && nxt === gcell;
    if (last) { _g[0] = A.gx[s]; _g[1] = A.gy[s]; _g[2] = A.gz[s]; }
    else spotInCell(p, nxt, A.id[s], i + 1 + 7, _g);
    const v = walkSpeed(p, nxt, speed, ageF) / kf;
    const hop = Math.max(1, Math.round(distM(p, goal, _g) / Math.max(0.01, v)));
    if (total + hop > maxLeg) break;
    for (let k = 0; k < wear; k++) wearRoad(x, at);
    A.pathPos[s] = i + 1;
    goal[0] = _g[0]; goal[1] = _g[1]; goal[2] = _g[2];
    at = nxt;
    total += hop;
    atGoal = last;
  }
  batch.to = at;
  batch.dur = total;
  batch.atGoal = atGoal;
}

/**
 * At 1000x a walk that ends at the task's goal point goes straight on into the work (tasks.ts nextSegment →
 * beginWork at the segment's end): the agent is not woken on arrival — one turn less per errand. (At 100x the
 * renderer still draws the walk, so the arrival keeps its own turn.) Never for a flight from fire (push 3 round 2): a
 * walker counts as standing in the cell it walks to (tasks.ts nextSegment) and a fleeing agent is not interrupted by
 * the fire (people.ts fireCheck), so a long merged leg toward a cell the fire then reached burnt it all the way there —
 * 1x wakes it on arrival and it flees on. Fire deaths at 1000x ran far above 1x (seed 3: 137 of 400 in two fires died
 * fleeing on such legs; 5 of 127 at 1x).
 */
export function mergeArrival(x: PCtx, kind = -1): boolean {
  return kind !== TASK.flee && level(x) >= 2;
}

/**
 * Apply the effect of agent s's finished stretched task (decide.ts onDue, when A.dmg[s] > 1): `fin` (work.ts
 * finishTask) once per session worked, each at the tick that session ended (the virtual ticks only salt the chance
 * rolls and date what a session leaves behind; the agent's clock is the real one again before the last). Returns what
 * the last `fin` returns (a chained task). Clears the stretch.
 */
export function finishStretched(x: PCtx, s: number, fin: (x: PCtx, s: number) => boolean): boolean {
  const A = x.A;
  const d = A.dmg[s];
  A.dmg[s] = 0;
  const kind = A.task[s];
  const mode = kind === TASK.farm ? (A.tData2[s] === 1 ? REPEAT : NONE) : kind === TASK.socialize ? ONCE : MODE[kind];
  if (mode !== REPEAT) return fin(x, s);
  // the sessions worked: whole sessions (work + the trip home they stand for) since the work began (A.t1 = arrival)
  const k = kOf(d);
  const w = (A.tWork[s] > 0 ? A.tWork[s] : 1) + Math.floor(d / 16);
  let reps = Math.floor((x.tick - A.t1[s] + Math.floor(d / 16)) / w + 0.5);
  if (reps > k) reps = k;
  if (reps <= 1) return fin(x, s);
  const t = x.tick;
  for (let r = reps - 1; r >= 1; r--) {
    x.tick = t - r * w;
    fin(x, s);
    if (!A.alive[s]) { x.tick = t; return true; }
  }
  x.tick = t;
  return fin(x, s);
}

/**
 * Agent s is interrupted in the middle of a stretched task (people.ts interrupt: a fire close by, a move, the god's
 * hand, a creature or a disciple, a settlement merge — round 2: the interruption used to drop every session already
 * worked, up to 4 sessions and their trips at 1000x where 1x loses at most the one in progress). `fin` (work.ts
 * finishTask) runs once for every WHOLE session worked so far, each at the tick that session ended (session i ends
 * at arrival + i × (work + trip) − trip): the sessions a 1x agent would have finished before the interruption; the
 * one in progress is lost, as at 1x. Clears the stretch. Nothing to do while still walking there.
 */
export function creditStretched(x: PCtx, s: number, fin: (x: PCtx, s: number) => boolean): void {
  const A = x.A;
  const d = A.dmg[s];
  A.dmg[s] = 0;
  if (d <= 1 || A.phase[s] !== PHASE.working) return;
  const kind = A.task[s];
  const mode = kind === TASK.farm ? (A.tData2[s] === 1 ? REPEAT : NONE) : kind === TASK.socialize ? ONCE : MODE[kind];
  if (mode !== REPEAT) return;
  const e = Math.floor(d / 16);
  const w = (A.tWork[s] > 0 ? A.tWork[s] : 1) + e;
  const t = x.tick, t1 = A.t1[s];
  let reps = Math.floor((t - t1 + e) / w);
  const k = kOf(d);
  if (reps > k) reps = k;
  for (let r = 1; r <= reps; r++) {
    x.tick = t1 + r * w - e;
    fin(x, s);
    if (!A.alive[s]) break;
  }
  x.tick = t;
}

/**
 * At 100x / 1000x what is at hand is taken in passing when an agent decides (decide.ts): water beside it is drunk
 * (below 0.85: the drink a 1x day fits between two sessions) and food in the hand is eaten (below 0.7) — the plain sim's
 * own rule ("a meal by water is taken with a drink"), widened to what the 1x agent would take where it stands anyway
 * (planDrink / planEat: no walk). A drink or such a meal then needs no task and no decision of its own. Meals from the
 * store are NOT taken in passing: a 1x agent walks home to eat when hungry, and snacking whenever one passed the store
 * (round 1 of this push) freed those walks — ~5 % of the day went to more crafting, digging and company, and food in
 * store ran ~5 % high over two game years (tests: _harness/scratch/perf3/curves.ts, 6 seeds).
 */
export function inPassing(x: PCtx, s: number, st: Settlement | undefined, waterHere: (x: PCtx, s: number) => boolean, eat: (x: PCtx, s: number, st: Settlement | undefined, fromStore: boolean) => void): number {
  if (level(x) === 0) return 0;
  const A = x.A;
  if (A.mission[s] || A.flags[s] & AgentFlag.possessed) return 0;
  const sp = x.info[A.species[s]];
  const N = A.needs, nb = s * NEED_N;
  let took = 0;
  if (sp.needW[WATER] > 0 && N[nb + WATER] < 0.85 && waterHere(x, s)) {
    took = Math.round(DRINK_TICKS * (1 - N[nb + WATER]));
    N[nb + WATER] = 1;
  }
  if (sp.needW[FOOD] > 0 && N[nb + FOOD] < 0.7) {
    for (const it of sp.foods) if (A.carried(s, it) > 0.05) { eat(x, s, st, false); break; }
  }
  return took;
}

/**
 * Round 2: the time a drink taken in passing takes, per unit of thirst quenched — what a 1x drink at hand (decide.ts
 * planDrink: 20 ticks, chosen at about half thirst) takes. The task decided with it starts that much later (decide.ts):
 * a free drink gave the 1.6 % of the day 1x agents spend drinking to work (+6 % of working time), and food in store
 * ran 10-25 % high from the third game year.
 */
const DRINK_TICKS = 40;

// ───────────────────────────── the coarse settlement step ─────────────────────────────

const stKeys: string[][] = [];
function stKey(planet: number, id: number): string {
  let a = stKeys[planet];
  if (!a) stKeys[planet] = a = [];
  let k = a[id];
  if (k === undefined) a[id] = k = `${planet}:s${id}`;
  return k;
}

/**
 * Hours the settlement step of st integrates now (it is called at the settlement's minute of every hour): 1 at level 0
 * with no record — exactly the plain hourly step — else every SETTLE_HOURS[level] hours the hours since its last step,
 * 0 when not due. A settlement that never stepped coarsely has been stepping hourly: its first coarse step integrates
 * from the hour before. Bands stay hourly. A fallen settlement's record is dropped (its step returns at once).
 */
export function settleHours(x: PCtx, st: Settlement): number {
  const u = x.u;
  const la = u.settings.lapse;
  if (!la) return 1;
  const lv = planetLevel(u, x.p);
  const key = stKey(x.p.id, st.id);
  const last = la.run[key];
  if (st.fallen >= 0) {
    if (last !== undefined) dropRecord(x, key, lv);
    return 1;
  }
  const K = st.band ? 1 : SETTLE_HOURS[lv];
  if (K > 1 && (Math.floor(x.tick / 60) + st.id) % K !== 0) {
    if (last === undefined) la.run[key] = x.tick - 60;
    return 0;
  }
  const h = last === undefined ? 1 : Math.max(1, Math.round((x.tick - last) / 60));
  if (K > 1) la.run[key] = x.tick;
  else if (last !== undefined) dropRecord(x, key, lv);
  return h;
}

function dropRecord(x: PCtx, key: string, lv: number): void {
  const la = x.u.settings.lapse;
  if (!la) return;
  delete la.run[key];
  // back at level 0 with nothing pending: forget time-lapse entirely (lapse.ts's rule)
  if (lv === 0 && Object.keys(la.run).length === 0) delete x.u.settings.lapse;
}

/** does a task due when (v mod period) == 0 fall inside a window of `hours` hours ending at v? (the plain test at 1) */
export function dueIn(v: number, period: number, hours: number): boolean {
  const r = v % period;
  return (r < 0 ? r + period : r) < hours;
}

/** the probability of at least one event in `hours` hours of an hourly chance p (p itself at 1 hour, bit for bit) */
export function chanceIn(p: number, hours: number): number {
  return hours === 1 || p <= 0 ? p : p >= 1 ? 1 : 1 - (1 - p) ** hours;
}

/**
 * Run an hourly settlement routine for each hour of a window of `hours` ending now, at that hour's own tick (the
 * settlement's minute of it): sickness spreads, incubations end and outbreaks arise exactly as hour by hour.
 */
export function hourly(x: PCtx, st: Settlement, hours: number, fn: (x: PCtx, st: Settlement) => void): void {
  if (hours === 1) { fn(x, st); return; }
  const t = x.tick;
  for (let j = hours - 1; j >= 0; j--) {
    x.tick = t - j * 60;
    fn(x, st);
    if (st.fallen >= 0) break;
  }
  x.tick = t;
}

// ───────────────────────────── per-settlement context caches (decisions) ─────────────────────────────

/**
 * What decisions read off a settlement's buildings (levels ≥ 1 only): its buildings sorted by what they are for (a
 * building's type never changes), in the settlement's building order. The cache follows PeopleState.of()'s own list
 * (rebuilt whenever that list is — the sim's building version), and everything that changes in a building — complete,
 * ruined, damaged, fuel — is read live at use: what it answers is a pure function of the saved state at that moment,
 * so a save / load mid-hour continues bit for bit (round 1 kept a view up to an hour old: not reproducible after a load).
 */
export interface StCtx {
  /** PeopleState.of(st.id) the lists were sorted from (the cache key) */
  list: readonly Building[];
  /** hearths (decide.ts lowHearth) */
  hearths: Building[];
  temples: Building[];
  pens: Building[];
  /** buildings that provide a store */
  stores: Building[];
}

const ctxCache = new WeakMap<Settlement, StCtx>();
/** the last settlement asked about and its context (a decision asks several times in a row) */
let _cSt: Settlement | null = null, _cCtx: StCtx | undefined;

/** The decision context of st (null at level 0: callers then compute it as before). */
export function ctxOf(x: PCtx, st: Settlement): StCtx | null {
  if (level(x) === 0) return null;
  const bs = x.ps.of(st.id);
  let c = st === _cSt ? _cCtx : ctxCache.get(st);
  if (c && c.list === bs) { _cSt = st; _cCtx = c; return c; }
  if (!c) { c = { list: bs, hearths: [], temples: [], pens: [], stores: [] }; ctxCache.set(st, c); }
  _cSt = st; _cCtx = c;
  c.list = bs;
  c.hearths.length = 0; c.temples.length = 0; c.pens.length = 0; c.stores.length = 0;
  const defs = x.c.buildings.list;
  for (const b of bs) {
    const def = defs[b.type];
    if (def.function === 'hearth') c.hearths.push(b);
    if (def.function === 'temple') c.temples.push(b);
    if (def.function === 'pen') c.pens.push(b);
    if (def.provides.includes('store')) c.stores.push(b);
  }
  return c;
}

/** the hearth most in need of fuel (complete, standing, fuel < 300, the lowest first; decide.ts lowHearth) */
export function lowHearthOf(c: StCtx): Building | null {
  let best: Building | null = null;
  for (const b of c.hearths) {
    if (b.progress < 1 || b.flags & 2) continue;
    if (b.fuel < 300 && (!best || b.fuel < best.fuel)) best = b;
  }
  return best;
}

/** the first complete lit building (fuel > 0) in the settlement's order (decide.ts planSocial / planSleep) */
export function litOf(c: StCtx): Building | null {
  for (const b of c.list) if (b.fuel > 0 && b.progress >= 1) return b;
  return null;
}

/** the first complete temple not in ruins (decide.ts templeOf) */
export function templeIn(c: StCtx): Building | undefined {
  for (const b of c.temples) if (b.progress >= 1 && b.damage < 0.9) return b;
  return undefined;
}

/** the first complete pen (decide.ts planHerd) */
export function penIn(c: StCtx): Building | undefined {
  for (const b of c.pens) if (b.progress >= 1) return b;
  return undefined;
}

/** the store point: the first complete store building not in ruins, else the centre; its cell (tasks.ts storePoint) */
export function storeIn(c: StCtx, st: Settlement, out: number[]): number {
  for (const b of c.stores) {
    if (b.progress < 1 || b.damage >= 0.9) continue;
    out[0] = b.pos[0]; out[1] = b.pos[1]; out[2] = b.pos[2];
    return b.cell;
  }
  out[0] = st.pos[0]; out[1] = st.pos[1]; out[2] = st.pos[2];
  return st.cell;
}
