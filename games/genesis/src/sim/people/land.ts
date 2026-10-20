// GENESIS — LIVING LAND (LIVING.md §2): the hooks that tie living off the land into the peoples' day.
//
//   decide.ts   landUtilities sets the utility of one LAND candidate (C.land) — a gathering of the settlement, a child's
//               play or chores, a parent raising an infant — and adjusts the others it bears on (children wander less;
//               the parched do not set out for far work); planLand plans the chosen one.
//   settlement  landHourly (crops on the season's clock, the hunting party, the settlement's calendar of gatherings, the
//               deaths of childhood) and landDaily (the ledger's census, the status of standing).
//   views       landFlags2 (MoverBlock.flags2: festive, camp, hunter, herder) and the settlement card's livelihood.
// The mechanisms live in hunt.ts, herding.ts, fishing.ts, crops.ts, demography.ts, gatherings.ts, outlets.ts and the
// books in ledger.ts.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { Gathering } from './ledger.ts';
import type { TaskSpec } from './tasks.ts';
import { AgentFlag, AgentFlag2 } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { NT, ROLE, TASK, TRAIT } from './defs.ts';
import { BELONG, NEED_N, REST, WATER } from './needs.ts';
import { cropsHourly, pruneFields } from './crops.ts';
import { huntHourly } from './hunt.ts';
import { canChore, canPlay, choreTask, gatherTask, gatheringEvents, gatheringFor, gatheringsHourly, infantToRaise, playTask, raiseTask, GATHER_KIND } from './gatherings.ts';
import { childhood } from './demography.ts';
import { ledgerDaily } from './ledger.ts';
import { statusDaily } from './outlets.ts';
import { die } from './lifecycle.ts';
import { waterHere } from './decide.ts';

/** what the LAND candidate of the decision now running stands for (planLand reads it; not state) */
const choice = { kind: 0, g: null as Gathering | null, infant: -1 };
const PLAY = 1, CHORE = 2, GATHER = 3, RAISE = 4;

/**
 * The LAND candidate's utility (decide.ts, a settled agent not on a mission). `C` is decide.ts's candidate table.
 * A gathering of the settlement outranks the day's work and a night's sleep for its few hours (not a body's pressing
 * need); children play (2-10) and do chores (6-14) by day instead of wandering; a parent tends a hungry infant.
 */
export function landUtilities(x: PCtx, s: number, st: Settlement, U: Float64Array, C: Readonly<Record<string, number>>, night: boolean, child: boolean): void {
  const A = x.A;
  choice.kind = 0; choice.g = null; choice.infant = -1;
  const N = A.needs, nb = s * NEED_N;
  // the parched do not set out for far work without a water skin: they drink first
  if (N[nb + WATER] < 0.5 && A.trip[s] <= x.tick && !waterHere(x, s)) U[C.work] = Math.min(U[C.work], 0.3);
  // a gathering they are called to (not from a camp far out)
  if (A.camp[s] < 0 && N[nb + REST] > 0.12) {
    const g = gatheringFor(x, s, st);
    if (g) {
      choice.kind = GATHER; choice.g = g;
      U[C.land] = g.kind === 'wedding' || g.kind === 'funeral' ? 1.75 : 1.95;
      return;
    }
  }
  if (child) {
    const age = (x.tick - A.birth[s]) / x.year;
    // a child wanders only when nothing else calls — and an infant not at all: it stays by home and its people (in the
    // integrated acceptance run the under-twos, kept from prayer, wandered 13 % of the child time; integration 2026-10-14)
    U[C.wander] = age < 2 ? 0 : Math.min(U[C.wander], 0.05);
    if (night) return;
    const play = canPlay(age), chore = canChore(age, x.info[A.species[s]].def.maturity);
    if (!play && !chore) return;
    const belong = N[nb + BELONG];
    const uPlay = play ? 0.5 + 0.45 * (1 - belong) : 0;
    const uChore = chore ? 0.48 + 0.3 * A.traits[s * NT + TRAIT.diligence] + (age >= 10 ? 0.15 : 0) : 0;
    // both open (6-10): the day is shared between them by turns
    const turn = play && chore ? hashFloat(A.id[s], Math.floor(x.tick / 90), 0x1a7) < 0.5 : true;
    if (uChore > 0 && (!play || !turn || uChore > uPlay + 0.2)) { choice.kind = CHORE; U[C.land] = uChore; }
    else { choice.kind = PLAY; U[C.land] = uPlay; }
    return;
  }
  // a parent with an infant to feed and hold
  if (!night || N[nb + REST] > 0.5) {
    const inf = infantToRaise(x, s, st);
    if (inf >= 0) { choice.kind = RAISE; choice.infant = inf; U[C.land] = 0.85; }
  }
}

/** plan the LAND candidate chosen by landUtilities (decide.ts plan) */
export function planLand(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  switch (choice.kind) {
    case GATHER: return choice.g ? gatherTask(x, s, st, choice.g) : null;
    case PLAY: return playTask(x, s, st);
    case CHORE: return choreTask(x, s, st) ?? playTaskIfYoung(x, s, st);
    case RAISE: return choice.infant >= 0 && x.A.alive[choice.infant] ? raiseTask(x, s, choice.infant) : null;
    default: return null;
  }
}

function playTaskIfYoung(x: PCtx, s: number, st: Settlement): TaskSpec | null {
  const age = (x.tick - x.A.birth[s]) / x.year;
  return canPlay(age) ? playTask(x, s, st) : null;
}

/** the settlement step's LAND share (settlement.ts settlementStep; `hours` the window it stands for, perf/plapse.ts) */
export function landHourly(x: PCtx, st: Settlement, hours: number): void {
  if (st.band || st.fallen >= 0) return;
  cropsHourly(x, st);
  huntHourly(x, st);
  gatheringsHourly(x, st);
  gatheringEvents(x, st, hours);
  childhood(x, st, hours, die);
}

/** the daily LAND round (settlement.ts daily): the books' census, the status of standing */
export function landDaily(x: PCtx, st: Settlement): void {
  ledgerDaily(x, st);
  statusDaily(x, st);
  pruneFields(x, st);
}

/** the deaths of childhood of a wandering band (settlement.ts settlementStep: a band ages as it walks) */
export function bandHourly(x: PCtx, st: Settlement, hours: number): void {
  childhood(x, st, hours, die);
}

/** MoverBlock.flags2 bits LAND sets for agent s (people/snapshot.ts) */
export function landFlags2(x: PCtx, s: number): number {
  const A = x.A;
  let f = 0;
  const k = A.task[s];
  if (k === TASK.gather && A.phase[s] === 1 && A.tData[s] !== GATHER_KIND.funeral) f |= AgentFlag2.festive;
  if (k === TASK.camp || A.camp[s] >= 0) f |= AgentFlag2.camp;
  const role = A.role[s];
  if ((role === ROLE.hunter && !(A.flags[s] & AgentFlag.child)) || k === TASK.hunt) f |= AgentFlag2.hunter;
  if (role === ROLE.herder || k === TASK.herd) f |= AgentFlag2.herder;
  return f;
}
