// GENESIS — tasks and movement (CONTRACT.md §8.3). A task is { kind, target, data, waypoints, work }: the agent walks
// its waypoints (analytic segments: position between ticks is interpolated, the sim does nothing meanwhile), works for
// `work` ticks at the goal, and when the work ends the task's effect is applied and the agent decides again.
//
// Paths: inside the settlement's territory the flow field gives the route (both directions, via the tree's common
// ancestor); elsewhere a bounded A*. Segment duration = distance / (walk speed × species × age × health × terrain ×
// road × weather). Every segment wears the cell it enters (roads emerge from traffic).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag, AnimState } from '../types.ts';
import { flowPath, findPath } from '../grid/pathfind.ts';
import { PATH_MAX, PHASE, TASK, NS, SKILL } from './defs.ts';
import { distM, spotInCell, stepFactor, walkSpeed } from './world.ts';
import { pathOptsFor } from './resources.ts';
import { schedule } from './sched.ts';
import { wearRoad } from './roads.ts';
import { boatSwim } from './missions.ts';
import { libraryEffect } from './knowledge.ts';
import { hashFloat } from '../core/rng.ts';
import { DEATH } from './defs.ts';
import { die } from './lifecycle.ts';
import { tell } from './story.ts';
import { vars, settlementRef } from './util.ts';

const _path: number[] = [];
/** the longest a walker goes without waking (ticks): longer legs are walked in parts */
export const MAX_LEG = 120;
const _a = [0, 0, 0];
const _b = [0, 0, 0];

/** the animation a task shows while working */
export function workAnim(kind: number): number {
  switch (kind) {
    case TASK.sleep: return AnimState.sleep;
    case TASK.eat: case TASK.drink: return AnimState.eat;
    case TASK.forage: case TASK.dig: case TASK.cutIce: case TASK.collectAir: case TASK.farm: return AnimState.dig;
    case TASK.chop: return AnimState.chop;
    case TASK.quarry: case TASK.mine: return AnimState.dig;
    case TASK.fish: return AnimState.fish;
    case TASK.hunt: return AnimState.fight;
    case TASK.craft: case TASK.cook: case TASK.experiment: case TASK.reverse: case TASK.tendFire: case TASK.secrete: case TASK.repair: return AnimState.work;
    case TASK.build: return AnimState.build;
    case TASK.teach: case TASK.preach: return AnimState.teach;
    case TASK.learn: return AnimState.sit;
    case TASK.pray: case TASK.worship: return AnimState.pray;
    case TASK.mourn: case TASK.bury: return AnimState.mourn;
    case TASK.socialize: case TASK.court: case TASK.raiseChild: return AnimState.sit;
    case TASK.flee: return AnimState.flee;
    case TASK.bathe: return AnimState.swim;
    case TASK.warm: return AnimState.sit;
    case TASK.store: case TASK.haul: return AnimState.carry;
    case TASK.herd: return AnimState.walk;
    case TASK.guard: return AnimState.idle;
    case TASK.heal: return AnimState.work;
    case TASK.trade: return AnimState.work;
    case TASK.raid: case TASK.fight: return AnimState.fight;
    case TASK.sail: return AnimState.sail;
    default: return AnimState.idle;
  }
}

export interface TaskSpec {
  kind: number;
  /** goal point (unit vector) and its cell; null = work where you stand */
  goal: number[] | null;
  goalCell: number;
  work: number;
  target?: number;
  data?: number;
  data2?: number;
}

/** begin a task: plan the route and take the first step (or start working at once) */
export function startTask(x: PCtx, s: number, t: TaskSpec): void {
  const A = x.A;
  A.task[s] = t.kind;
  A.tTarget[s] = t.target ?? -1;
  A.tData[s] = t.data ?? -1;
  A.tData2[s] = t.data2 ?? -1;
  A.tWork[s] = Math.max(1, Math.round(t.work));
  // settle where we are now (end of the last segment)
  A.posAt(s, x.tick, _a);
  A.fx[s] = _a[0]; A.fy[s] = _a[1]; A.fz[s] = _a[2];
  A.tx[s] = _a[0]; A.ty[s] = _a[1]; A.tz[s] = _a[2];
  A.t0[s] = x.tick; A.t1[s] = x.tick;
  // out of the shelter, unless staying in the very same one (a second sleep, warming up at home)
  if (A.inside[s] >= 0 && !(t.target === A.inside[s] && (t.kind === TASK.sleep || t.kind === TASK.warm))) leaveShelter(x, s);
  if (!t.goal || distM(x.p, _a, t.goal) < 2.5) {
    if (t.goal) { A.gx[s] = t.goal[0]; A.gy[s] = t.goal[1]; A.gz[s] = t.goal[2]; A.gcell[s] = A.cell[s]; }
    beginWork(x, s);
    return;
  }
  A.gx[s] = t.goal[0]; A.gy[s] = t.goal[1]; A.gz[s] = t.goal[2];
  A.gcell[s] = x.p.cellAt(t.goal);
  planRoute(x, s, A.cell[s], t.goalCell);
  A.phase[s] = PHASE.moving;
  nextSegment(x, s);
}

/** waypoints from cell `from` to `to` into the agent's path */
function planRoute(x: PCtx, s: number, from: number, to: number): void {
  const A = x.A;
  const st = x.ps.settlement(A.settlement[s]);
  let ok = false;
  // the home flow field routes through home: right for errands at home, wrong for a caravan's leg or a boat at sea
  if (st && st.flow && from !== to && !A.mission[s] && A.boat[s] < 0) ok = flowPath(st.flow, from, to, _path);
  if (!ok && from !== to) {
    const opts = pathOptsFor(x, A.species[s]);
    if (A.boat[s] >= 0) opts.swim = Math.max(opts.swim, boatSwim(x, A.boat[s]));
    // short hops need little search; long journeys a bit more (bounded either way)
    opts.maxExpand = 1500;
    findPath(x.p, from, to, opts, _path);
  }
  if (from === to) _path.length = 0;
  const n = Math.min(PATH_MAX, _path.length);
  const base = s * PATH_MAX;
  for (let i = 0; i < n; i++) A.path[base + i] = _path[i];
  A.pathLen[s] = n;
  A.pathPos[s] = 0;
}

/** at a segment end: walk on, or arrive */
export function nextSegment(x: PCtx, s: number): void {
  const A = x.A;
  const p = x.p;
  // where we are (end of the previous segment)
  _a[0] = A.tx[s]; _a[1] = A.ty[s]; _a[2] = A.tz[s];
  const from = A.cell[s];
  let to: number;
  const goal = _b;
  if (A.pathPos[s] < A.pathLen[s]) {
    to = A.path[s * PATH_MAX + A.pathPos[s]];
    A.pathPos[s]++;
    if (A.pathPos[s] >= A.pathLen[s] && to === goalCell(x, s)) {
      goal[0] = A.gx[s]; goal[1] = A.gy[s]; goal[2] = A.gz[s];
    } else spotInCell(p, to, A.id[s], A.pathPos[s] + 7, goal);
  } else {
    // final approach to the goal point (it may lie in the current cell, or the path ran out: re-plan once more)
    goal[0] = A.gx[s]; goal[1] = A.gy[s]; goal[2] = A.gz[s];
    to = goalCell(x, s);
    if (to !== from && A.pathLen[s] >= PATH_MAX) {
      planRoute(x, s, from, to);
      if (A.pathLen[s] > 0) { nextSegment(x, s); return; }
    }
    const d0 = distM(p, _a, goal);
    if (d0 < 1.5) { arrive(x, s); return; }
    // no route reached the goal's neighbourhood (across water, up a cliff): work where we stand instead of walking a
    // straight line over whatever lies between
    if (to !== from && !adjacentCells(p, from, to)) { arrive(x, s); return; }
  }
  const d = distM(p, _a, goal);
  const sp = x.info[A.species[s]].def;
  const afloat = A.boat[s] >= 0;
  const swim = afloat ? Math.max(sp.swim, boatSwim(x, A.boat[s])) : sp.swim;
  // a hull glides over deep water as over shallow (a swimmer tires in the deep; a boat does not)
  let k = to === from ? 1 : afloat && p.f.water[to] > 0.6 && !sp.fly ? 1 / swim : stepFactor(p, from, to, swim, !!sp.fly);
  if (k === Infinity) {
    // blocked (the water rose, a cliff): give up the route and work where we stand
    A.pathLen[s] = 0;
    arrive(x, s);
    return;
  }
  const age = A.flags[s] & AgentFlag.child ? 0.75 : A.flags[s] & AgentFlag.elder ? 0.7 : 1;
  const v = walkSpeed(p, to, sp.speed * speedEffect(x, A.settlement[s]), age * (0.45 + 0.55 * A.health[s])) / k;
  let dur = Math.max(1, Math.round(d / Math.max(0.01, v)));
  // a leg longer than MAX_LEG is walked in parts (the same cell, the same spot: the next part goes on toward it), so
  // the walker is woken on the way — needs are lived on the road and a need turned critical can end the walk (one-cell
  // legs on a coarse world took a weak child 13-23 hours without a single decision)
  if (dur > MAX_LEG) {
    const f = MAX_LEG / dur;
    const gx = _a[0] + (goal[0] - _a[0]) * f, gy = _a[1] + (goal[1] - _a[1]) * f, gz = _a[2] + (goal[2] - _a[2]) * f;
    const gl = Math.hypot(gx, gy, gz) || 1;
    goal[0] = gx / gl; goal[1] = gy / gl; goal[2] = gz / gl;
    dur = MAX_LEG;
    // walk on toward the same waypoint next time
    if (A.pathPos[s] > 0 && to === A.path[s * PATH_MAX + A.pathPos[s] - 1]) A.pathPos[s]--;
  }
  A.fx[s] = _a[0]; A.fy[s] = _a[1]; A.fz[s] = _a[2];
  A.tx[s] = goal[0]; A.ty[s] = goal[1]; A.tz[s] = goal[2];
  A.t0[s] = x.tick; A.t1[s] = x.tick + dur;
  A.heading[s] = bearing(_a, goal);
  const onWater = p.f.water[to] > 0.6 && !sp.fly;
  if (afloat && onWater) {
    A.anim[s] = AnimState.sail;
    A.flags[s] |= AgentFlag.boat;
    if (p.f.precip[to] > 5 && capsize(x, s, to)) return;
  } else {
    A.flags[s] &= ~AgentFlag.boat;
    A.anim[s] = A.task[s] === TASK.flee ? AnimState.flee : onWater ? AnimState.swim : sp.fly ? AnimState.fly : A.carryItem(s) >= 0 ? AnimState.carry : AnimState.walk;
  }
  if (to !== A.cell[s]) {
    A.cell[s] = to;
    x.ps.buckets.move(s, to);
    if (!sp.fly) wearRoad(x, to);
  }
  schedule(x, s, A.t1[s]);
}

/** a storm at sea: a raft goes over easily, a sailship rarely; the drowned are remembered (taboo on boats, culture.ts) */
function capsize(x: PCtx, s: number, c: number): boolean {
  const A = x.A;
  const it = x.c.items.list[A.boat[s]];
  const p = it?.id === 'raft' ? 0.05 : it?.tags.includes('ship') ? 0.004 : 0.015;
  if (hashFloat(A.id[s], c, x.tick, 0xb0a7) >= p * Math.min(3, x.p.f.precip[c] / 5)) return false;
  const st = x.ps.settlement(A.settlement[s]);
  if (st) {
    st.recent.drowned = (st.recent.drowned ?? 0) + 1;
    if (st.recent.boatLost === undefined || x.tick - st.recent.boatLost > x.day) {
      st.recent.boatLost = x.tick;
      tell(x.u, x.p, 'boat.lost', vars(x, st, -1, { count: 1 }), st, [settlementRef(x, st)], 1);
    }
  }
  die(x, s, DEATH.drowning);
  return true;
}

/** the cell of the agent's goal point (kept with it; recomputed if an old save has none) */
function goalCell(x: PCtx, s: number): number {
  const A = x.A;
  if (A.gcell[s] < 0) A.gcell[s] = x.p.cellAt([A.gx[s], A.gy[s], A.gz[s]]);
  return A.gcell[s];
}

function adjacentCells(p: PCtx['p'], a: number, b: number): boolean {
  const g = p.grid;
  for (let e = g.nbrStart[a]; e < g.nbrStart[a + 1]; e++) if (g.nbr[e] === b) return true;
  return false;
}

/** reached the goal: start the work phase */
export function arrive(x: PCtx, s: number): void {
  const A = x.A;
  A.posAt(s, x.tick, _a);
  A.fx[s] = _a[0]; A.fy[s] = _a[1]; A.fz[s] = _a[2];
  A.tx[s] = _a[0]; A.ty[s] = _a[1]; A.tz[s] = _a[2];
  A.t0[s] = x.tick; A.t1[s] = x.tick;
  beginWork(x, s);
}

function beginWork(x: PCtx, s: number): void {
  const A = x.A;
  A.phase[s] = PHASE.working;
  A.anim[s] = workAnim(A.task[s]);
  A.posAt(s, x.tick, _a);
  const c = x.p.cellAt(_a);
  if (c !== A.cell[s]) { A.cell[s] = c; x.ps.buckets.move(s, c); }
  // under a roof: sleeping at home, warming up inside
  const k = A.task[s];
  // (occupancy is kept against the building entered, A.inside — not A.home, which findShelter / assignHomes may change
  // while they are in: the count then leaked into the wrong building)
  if ((k === TASK.sleep || (k === TASK.warm && A.tData2[s] === 1)) && A.tTarget[s] >= 0 && A.inside[s] < 0) {
    const b = x.ps.building(A.tTarget[s]);
    if (b && b.progress >= 1 && !(b.flags & 2)) {
      A.flags[s] |= AgentFlag.sleepingIndoors;
      A.inside[s] = b.id;
      b.occupants++;
    }
  }
  schedule(x, s, x.tick + A.tWork[s]);
}

/** step out of a shelter (occupancy bookkeeping) */
export function leaveShelter(x: PCtx, s: number): void {
  const A = x.A;
  A.flags[s] &= ~AgentFlag.sleepingIndoors;
  const id = A.inside[s];
  A.inside[s] = -1;
  if (id < 0) return;
  const b = x.ps.building(id);
  if (b && b.occupants > 0) b.occupants--;
}

/**
 * Heal occupancy drift (hourly, per settlement): each shelter's count is the members inside it; anyone inside a building
 * that has gone (burnt, ruined, razed) is outside again.
 */
export function recountShelters(x: PCtx, st: Settlement): void {
  const A = x.A;
  const blds = x.ps.of(st.id);
  for (const b of blds) b.occupants = 0;
  for (const m of x.ps.members.get(st.id) ?? []) {
    const id = A.inside[m];
    if (id < 0) continue;
    const b = x.ps.building(id);
    if (!b || b.progress < 1 || b.flags & 2) { A.inside[m] = -1; A.flags[m] &= ~AgentFlag.sleepingIndoors; continue; }
    if (b.settlement === st.id) b.occupants++;
  }
}

/** bearing (0 = north, + east) from a to b */
export function bearing(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ex = a[2], ez = -a[0];
  let el = Math.hypot(ex, ez);
  if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  const nx = a[1] * ez, ny = a[2] * ex - a[0] * ez, nz = -a[1] * ex;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const de = dx * ex + dz * ez, dn = dx * nx + dy * ny + dz * nz;
  if (Math.abs(de) + Math.abs(dn) < 1e-14) return 0;
  return Math.atan2(de, dn);
}

/** walking-speed multiplier from what the settlement knows (riding, railways, buoyancy...) */
function speedEffect(x: PCtx, sid: number): number {
  const st = x.ps.settlement(sid);
  if (!st) return 1;
  return Math.min(2.2, libraryEffect(x, st, 'speed'));
}

/** the settlement's store point (its first standing store building, else the centre) */
export function storePoint(x: PCtx, st: Settlement, out: number[]): number {
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.damage >= 0.9) continue;
    if (x.c.buildings.list[b.type].provides.includes('store')) {
      out[0] = b.pos[0]; out[1] = b.pos[1]; out[2] = b.pos[2];
      return b.cell;
    }
  }
  out[0] = st.pos[0]; out[1] = st.pos[1]; out[2] = st.pos[2];
  return st.cell;
}

/** skill multiplier for yields: novices 0.6, masters ~1.6 */
export function skillYield(x: PCtx, s: number, skill: number): number {
  return 0.6 + 1.1 * x.A.skills[s * NS + skill];
}

export { SKILL };
