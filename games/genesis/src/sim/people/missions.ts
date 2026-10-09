// GENESIS — missions (CONTRACT.md §8.6, §12 boats): agents who leave home together on an errand — a trade caravan or
// trading boat, bearers of a gift or a tribute, a raiding party, a war band that may lay siege. The members are real
// agents carrying real goods in their hands; the mission only coordinates them:
//
//   0 muster    members gather at the store; when most are there (or after a few hours) they set out with the goods,
//               food for the road, and boats if the way crosses water
//   1 outbound  each member walks the mission's route in legs (the route is one A* path computed when the mission is
//               made: by land, or by boat — raft, boat, sailship — over the water); on water they sail
//   2 target    traders barter at the other's store; bearers hand over what they carry; a war band fights (war.ts) or
//               lays siege
//   3 homeward  back along the route; at home they put what they carry into the store and go back to their lives
//
// Routes between settlements are cached (land / sea / distance) and saved. Each member's progress along the route is
// its task data (`tData2` = route index of the leg's end), so a loaded game walks the very same legs.

import type { PCtx } from './ctx.ts';
import type { Mission, Route, Settlement } from './state.ts';
import type { TaskSpec } from './tasks.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { findPath } from '../grid/pathfind.ts';
import { INV, MEMK, NT, ROLE, TASK, TRAIT } from './defs.ts';
import { storeAdd, storeHas, storeTake, bestFood } from './store.ts';
import { storePoint } from './tasks.ts';
import { cellPos, distM, offsetPoint, spotInCell } from './world.ts';
import { pathOptsFor } from './resources.ts';
import { schedule } from './sched.ts';
import { contact } from '../life/disease.ts';
import { tradeExchange, tradeDone } from './economy.ts';
import { resolveArrival, warDone } from './war.ts';
import { meet } from './culture.ts';

/** a leg along a route is about this many metres (people walk ~15 m an hour: a leg is half a day) */
const LEG_M = 160;
/** give up a journey after this many days (or four times the expected walk) */
const MAX_DAYS = 9;

function legCells(x: PCtx): number {
  return Math.max(1, Math.round(LEG_M / x.p.edgeM));
}

/** expected ticks to walk a route of n cells (a little slower than flat ground) */
export function travelTicks(x: PCtx, n: number): number {
  return Math.round((n * x.p.edgeM * 1.4) / 0.25);
}

const _p = [0, 0, 0];
const _q = [0, 0, 0];
const _path: number[] = [];

// ───────────────────────────── boats ─────────────────────────────

/** speed in water of a boat item (× walking): raft 1.3, boat 2.2, sailship 3.5 */
export function boatSwim(x: PCtx, item: number): number {
  const it = x.c.items.list[item];
  if (!it) return 0;
  return it.tags.includes('ship') ? 3.5 : it.id === 'raft' ? 1.3 : 2.2;
}

/** people a boat carries */
export function boatSeats(x: PCtx, item: number): number {
  const it = x.c.items.list[item];
  if (!it) return 0;
  return it.tags.includes('ship') ? 16 : it.id === 'raft' ? 3 : 6;
}

/** the best boat in a settlement's store (-1 none) */
export function bestBoat(x: PCtx, st: Settlement): number {
  let best = -1, bv = 0;
  for (const it of x.c.itemsByTag.get('boat') ?? []) {
    if (storeHas(st, it) < 1) continue;
    const v = boatSwim(x, it);
    if (v > bv) { bv = v; best = it; }
  }
  return best;
}

// ───────────────────────────── routes ─────────────────────────────

function routeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** how settlements a and b reach each other (cached for ten days; saved) */
export function routeBetween(x: PCtx, a: Settlement, b: Settlement): Route {
  const key = routeKey(a.id, b.id);
  const r = x.ps.routes[key];
  if (r && x.tick - r.tick < 10 * x.day) return r;
  // on foot: wading, but no swimming with the goods (amphibious peoples swim)
  const opts = pathOptsFor(x, a.species);
  if (opts.swim < 1) opts.swim = 0;
  opts.maxExpand = 9000;
  let land = findPath(x.p, a.cell, b.cell, opts, _path);
  let dist = land ? _path.length * x.p.edgeM : 0;
  let sea = false;
  if (!land) {
    // over the water, in a boat
    const bo = pathOptsFor(x, a.species);
    bo.swim = 2.2;
    bo.maxExpand = 9000;
    sea = findPath(x.p, a.cell, b.cell, bo, _path);
    if (sea) dist = _path.length * x.p.edgeM;
  }
  if (land && dist > 3200) land = false;
  const out: Route = { land, sea, dist: Math.round(dist), tick: x.tick };
  x.ps.routes[key] = out;
  return out;
}

/** the cell path from settlement `from` to `to` (by boat when `swim` > 0), or null */
function pathOf(x: PCtx, from: Settlement, to: Settlement, swim: number): number[] | null {
  const opts = pathOptsFor(x, from.species);
  if (swim > 0) opts.swim = Math.max(opts.swim, swim);
  else if (opts.swim < 1) opts.swim = 0;
  opts.maxExpand = 12000;
  if (!findPath(x.p, from.cell, to.cell, opts, _path)) return null;
  return [from.cell, ..._path];
}

// ───────────────────────────── making missions ─────────────────────────────

/**
 * A new mission of `kind` from `from` to `to` with the given members (slots) and goods to carry out. Returns null
 * when there is no way there (no land route, and no boat for the sea).
 */
export function newMission(x: PCtx, kind: Mission['kind'], from: Settlement, to: Settlement, members: number[], out: [number, number][] = []): Mission | null {
  if (!members.length || from.id === to.id) return null;
  const route = routeBetween(x, from, to);
  let boat = -1, boats = 0;
  let path: number[] | null = null;
  if (route.land) path = pathOf(x, from, to, 0);
  if (!path && route.sea) {
    boat = bestBoat(x, from);
    if (boat < 0) { from.recent.wantBoat = x.tick; return null; }
    boats = Math.min(Math.floor(storeHas(from, boat)), Math.ceil(members.length / boatSeats(x, boat)));
    // fewer go when there are fewer boats
    members = members.slice(0, Math.max(1, boats * boatSeats(x, boat)));
    path = pathOf(x, from, to, boatSwim(x, boat));
  }
  if (!path || path.length < 2) return null;
  const m: Mission = {
    id: x.u.ids.alloc('mission'), kind, from: from.id, to: to.id, members: [], phase: 0, t0: x.tick, tPhase: x.tick,
    sea: boat >= 0, boat, boats, out: out.map(([i, q]) => [i, q] as [number, number]), back: [], strength: 0, siege: 0, note: '', path,
    done: [],
  };
  const A = x.A;
  const role = kind === 'raid' || kind === 'war' ? ROLE.soldier : ROLE.trader;
  for (const s of members.slice().sort((a, b) => A.id[a] - A.id[b])) {
    if (A.mission[s]) continue;
    A.mission[s] = m.id;
    A.role[s] = role;
    A.flags[s] |= role === ROLE.soldier ? AgentFlag.soldier : AgentFlag.trader;
    m.members.push(A.id[s]);
    // they come at the next turn (a sleeper finishes the night)
    if (A.task[s] !== TASK.sleep) schedule(x, s, Math.min(A.next[s], x.tick + 5));
  }
  if (!m.members.length) return null;
  x.ps.missions.push(m);
  return m;
}

/** the mission agent s is on (undefined if none) */
export function missionOf(x: PCtx, s: number): Mission | undefined {
  const id = x.A.mission[s];
  return id ? x.ps.mission(id) : undefined;
}

/** is agent s away from home on a mission (they eat, drink and sleep on the road) */
export function onTheRoad(x: PCtx, s: number): boolean {
  const m = missionOf(x, s);
  return !!m && m.phase >= 1 && m.phase <= 3;
}

/** leave the mission (home, dead, or the mission ended): boat back, flags off */
export function release(x: PCtx, s: number, home: Settlement | undefined): void {
  const A = x.A;
  const m = missionOf(x, s);
  A.mission[s] = 0;
  A.flags[s] &= ~(AgentFlag.trader | AgentFlag.soldier | AgentFlag.boat);
  if (A.boat[s] >= 0) A.boat[s] = -1;
  if (A.role[s] === ROLE.trader || A.role[s] === ROLE.soldier) A.role[s] = ROLE.gatherer;
  if (m) {
    const i = m.members.indexOf(A.id[s]);
    if (i >= 0) m.members.splice(i, 1);
  }
  void home;
}

// ───────────────────────────── the members' turns ─────────────────────────────

function nearestOnPath(x: PCtx, path: number[], c: number, hint: number): number {
  if (hint >= 0 && hint < path.length && path[hint] === c) return hint;
  const P = x.p.grid.pos;
  let best = 0, bd = -2;
  for (let i = 0; i < path.length; i++) {
    const o = path[i];
    if (o === c) return i;
    const d = P[o * 3] * P[c * 3] + P[o * 3 + 1] * P[c * 3 + 1] + P[o * 3 + 2] * P[c * 3 + 2];
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

/** the kind of task a mission's members do (travel, barter, fight) */
function taskKind(m: Mission): number {
  return m.kind === 'raid' || m.kind === 'war' ? TASK.raid : TASK.trade;
}

/** a point near a settlement where a party stands (its store for traders; outside the houses for a war band) */
function targetSpot(x: PCtx, s: number, m: Mission, to: Settlement): number[] {
  if (m.kind === 'raid' || m.kind === 'war') {
    const a = hashFloat(x.A.id[s], m.id, 0x7a6) * Math.PI * 2;
    return offsetPoint(to.pos, Math.max(25, Math.min(80, to.territory * 0.5)) + 6 * hashFloat(x.A.id[s], 0x7a7), a, x.p.st.radius, [0, 0, 0]);
  }
  storePoint(x, to, _q);
  return offsetPoint(_q, 2 + 5 * hashFloat(x.A.id[s], m.id, 0x7a8), hashFloat(x.A.id[s], 0x7a9) * 6.283, x.p.st.radius, [0, 0, 0]);
}

/**
 * The next task of mission member s (null: nothing to do now). tData marks what the task is: 1 a leg of the road,
 * 2 the errand at the target, 3 waiting, 4 home again (deposit and go back to normal life).
 */
export function planMission(x: PCtx, s: number, st: Settlement, m: Mission): TaskSpec | null {
  const A = x.A;
  const to = x.ps.settlement(m.to);
  const kind = taskKind(m);
  const path = m.path ?? [];
  if (!to || !path.length) return null;
  A.posAt(s, x.tick, _p);
  switch (m.phase) {
    case 0: {
      // muster at the store
      const c = storePoint(x, st, _q);
      if (distM(x.p, _p, _q) < 30) return { kind, goal: null, goalCell: A.cell[s], work: 30, data: 3 };
      return { kind, goal: spotInCell(x.p, c, A.id[s], 0x6a, [0, 0, 0]), goalCell: c, work: 20, data: 3 };
    }
    case 1: {
      const i = nearestOnPath(x, path, A.cell[s], A.tData2[s]);
      if (i >= path.length - 2) {
        // there: the errand
        const goal = targetSpot(x, s, m, to);
        return { kind: kind === TASK.raid ? TASK.fight : TASK.trade, goal, goalCell: x.p.cellAt(goal), work: kind === TASK.raid ? 40 : 45, data: 2, data2: path.length - 1 };
      }
      const j = Math.min(path.length - 1, i + legCells(x));
      return { kind, goal: spotInCell(x.p, path[j], A.id[s], j, [0, 0, 0]), goalCell: path[j], work: 1, data: 1, data2: j };
    }
    case 2: {
      // at the target: barter once, then wait for the others; a war band holds its ground
      const goal = targetSpot(x, s, m, to);
      const done = (m.done ?? []).includes(A.id[s]);
      if (kind === TASK.raid) return { kind: TASK.fight, goal, goalCell: x.p.cellAt(goal), work: 40, data: 3, data2: path.length - 1 };
      return { kind: TASK.trade, goal, goalCell: x.p.cellAt(goal), work: done ? 30 : 45, data: done ? 3 : 2, data2: path.length - 1 };
    }
    case 3: {
      const i = nearestOnPath(x, path, A.cell[s], A.tData2[s]);
      if (i <= 1) {
        const c = storePoint(x, st, _q);
        return { kind: TASK.store, goal: spotInCell(x.p, c, A.id[s], 0x6b, [0, 0, 0]), goalCell: c, work: 12, data: 4 };
      }
      const j = Math.max(0, i - legCells(x));
      return { kind, goal: spotInCell(x.p, path[j], A.id[s], j + 101, [0, 0, 0]), goalCell: path[j], work: 1, data: 1, data2: j };
    }
    default:
      return null;
  }
}

/** a mission member's task ended (trade / raid / fight / store with mission data); returns true when it chained */
export function missionTaskDone(x: PCtx, s: number): void {
  const A = x.A;
  const m = missionOf(x, s);
  if (!m) return;
  const what = A.tData[s];
  const home = x.ps.settlement(m.from);
  const to = x.ps.settlement(m.to);
  if (what === 2 && m.phase >= 1 && to) {
    if (!(m.done ??= []).includes(A.id[s])) {
      m.done.push(A.id[s]);
      contact(x, s, to, home ? `${kindWords(m)} from ${home.name}` : 'strangers');
      meet(x, home, to);
      if (m.kind === 'trade') tradeExchange(x, s, m, to);
      else if (m.kind === 'gift' || m.kind === 'tribute') handOver(x, s, to);
    }
  } else if (what === 4 && home) {
    // home: what they carry goes into the store, the boat back to the shore
    for (let k = 0; k < INV; k++) {
      const it = A.invItem[s * INV + k];
      if (it < 0) continue;
      storeAdd(x, home, it, A.invQty[s * INV + k]);
      A.invItem[s * INV + k] = -1;
      A.invQty[s * INV + k] = 0;
    }
    if (to) contact(x, s, home, `${kindWords(m)} back from ${to.name}`);
    A.remember(s, m.kind === 'trade' ? MEMK.traded : m.kind === 'raid' || m.kind === 'war' ? MEMK.fought : MEMK.gift, x.tick, m.to);
    release(x, s, home);
  }
}

function kindWords(m: Mission): string {
  return m.kind === 'trade' ? 'traders' : m.kind === 'gift' ? 'bearers of gifts' : m.kind === 'tribute' ? 'tribute bearers' : 'warriors';
}

/** gift and tribute bearers put down what they carry */
function handOver(x: PCtx, s: number, to: Settlement): void {
  const A = x.A;
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it < 0) continue;
    storeAdd(x, to, it, A.invQty[s * INV + k]);
    A.invItem[s * INV + k] = -1;
    A.invQty[s * INV + k] = 0;
  }
}

// ───────────────────────────── the mission's own clock ─────────────────────────────

/** hourly: muster, departure, arrival, the errand, return, the end */
export function missionStep(x: PCtx): void {
  const ms = x.ps.missions;
  if (!ms.length) return;
  const A = x.A;
  for (const m of ms) {
    const from = x.ps.settlement(m.from);
    const to = x.ps.settlement(m.to);
    // members still alive and still of that settlement
    m.members = m.members.filter((id) => { const s = A.slotOf(id); return s >= 0 && A.mission[s] === m.id; });
    if (!from || from.fallen >= 0 || !m.members.length) { finish(x, m); continue; }
    if (!to || (to.fallen >= 0 && m.phase < 3)) { homeward(x, m, 'the place was gone'); continue; }
    const path = m.path ?? [];
    const travel = travelTicks(x, path.length) + 120;
    if (m.phase === 0) {
      storePoint(x, from, _q);
      let here = 0;
      for (const id of m.members) { const s = A.slotOf(id); A.posAt(s, x.tick, _p); if (distM(x.p, _p, _q) < 40) here++; }
      if (here >= m.members.length * 0.7 || x.tick - m.tPhase > 180) depart(x, m, from);
    } else if (m.phase === 1) {
      let there = 0;
      for (const id of m.members) {
        const s = A.slotOf(id);
        A.posAt(s, x.tick, _p);
        if (distM(x.p, _p, to.pos) < Math.max(90, to.territory)) there++;
      }
      if (there >= Math.max(1, m.members.length * 0.6) || (there > 0 && x.tick - m.tPhase > travel * 2.5)) {
        m.phase = 2;
        m.tPhase = x.tick;
        if (m.kind === 'raid' || m.kind === 'war') resolveArrival(x, m, from, to);
      } else if (x.tick - m.t0 > Math.max(MAX_DAYS * x.day, travel * 4)) homeward(x, m, 'lost on the way');
    } else if (m.phase === 2) {
      if (m.kind === 'trade' || m.kind === 'gift' || m.kind === 'tribute') {
        const done = m.done?.length ?? 0;
        if (done >= m.members.length || x.tick - m.tPhase > 900) {
          if (m.kind === 'trade') tradeDone(x, m, from, to);
          else giftDone(x, m, from, to);
          homeward(x, m, '');
        }
      } else if (warDone(x, m, from, to)) homeward(x, m, m.note);
    } else if (m.phase === 3) {
      if (x.tick - m.tPhase > travel * 3 + 600) {
        // stragglers: whoever is still out comes home as best they can
        for (const id of m.members.slice()) { const s = A.slotOf(id); if (s >= 0) release(x, s, from); }
      }
    }
  }
  x.ps.missions = ms.filter((m) => m.phase < 4 && m.members.length > 0);
}

/** set out: goods into the members' hands, food for the road, boats off the shore */
function depart(x: PCtx, m: Mission, from: Settlement): void {
  const A = x.A;
  m.phase = 1;
  m.tPhase = x.tick;
  const slots = m.members.map((id) => A.slotOf(id));
  // boats
  if (m.sea && m.boat >= 0) {
    const took = storeTake(from, m.boat, m.boats);
    if (took < 1) { from.recent.wantBoat = x.tick; homeward(x, m, 'no boat'); for (const s of slots) release(x, s, from); return; }
    m.boats = Math.round(took);
    for (const s of slots) A.boat[s] = m.boat;
    from.boatUse = (from.boatUse ?? 0) + 1;
    if (x.ps.firsts.boat === undefined) x.ps.firsts.boat = x.tick;
  }
  // the goods, shared out
  for (const [it, q] of m.out) {
    const got = storeTake(from, it, q);
    if (got <= 0) continue;
    const each = got / slots.length;
    for (const s of slots) { const left = A.give(s, it, each); if (left > 0) storeAdd(x, from, it, left); }
  }
  // food for the road: a day and a half each, plus the journey
  const days = Math.min(4, 1.5 + ((m.path?.length ?? 0) * x.p.edgeM) / (0.25 * x.day) * 2);
  const sp = x.info[from.species];
  for (const s of slots) {
    const food = bestFood(x, from);
    if (food < 0) break;
    const units = days / Math.max(0.05, sp.edible[food]);
    const got = storeTake(from, food, units);
    if (got > 0) { const left = A.give(s, food, got); if (left > 0) storeAdd(x, from, food, left); }
    A.remember(s, m.sea ? MEMK.sailed : MEMK.migrated, x.tick, m.to);
  }
}

/** turn for home */
export function homeward(x: PCtx, m: Mission, note: string): void {
  if (m.phase >= 3) return;
  m.phase = 3;
  m.tPhase = x.tick;
  if (note) m.note = note;
}

/** the mission is over: return boats, release anyone left */
function finish(x: PCtx, m: Mission): void {
  const from = x.ps.settlement(m.from);
  for (const id of m.members.slice()) {
    const s = x.A.slotOf(id);
    if (s >= 0) release(x, s, from);
  }
  if (from && m.sea && m.boat >= 0 && m.boats > 0 && m.phase >= 3) storeAdd(x, from, m.boat, m.boats);
  m.phase = 4;
}

/** gifts and tributes arrive: opinions move; tribute is owed again later */
function giftDone(x: PCtx, m: Mission, from: Settlement, to: Settlement): void {
  const r = x.ps.relation(from.polity, to.polity);
  if (r) {
    const k = r.a === to.polity ? 0 : 1;
    r.op[k] = Math.min(1, r.op[k] + (m.kind === 'gift' ? 0.2 : 0.05));
  }
  from.recent[m.kind === 'gift' ? 'gave' : 'paid'] = x.tick;
}

/** boats come home when the mission has fully ended (called when the last member is home) */
export function settleMissions(x: PCtx): void {
  for (const m of x.ps.missions) {
    if (m.phase === 3 && m.members.length === 0) finish(x, m);
  }
}

/** suitability of an adult to go trading (sociable, bold enough) or fighting (aggressive, healthy) */
export function aptitude(x: PCtx, s: number, war: boolean): number {
  const A = x.A;
  const t = s * NT;
  return war
    ? A.traits[t + TRAIT.aggression] * 0.6 + A.traits[t + TRAIT.boldness] * 0.4 + A.health[s] * 0.5
    : A.traits[t + TRAIT.sociability] * 0.6 + A.traits[t + TRAIT.boldness] * 0.2 + A.traits[t + TRAIT.curiosity] * 0.2;
}

/** pick `n` free adults of a settlement for a mission (best suited first; ascending id breaks ties) */
export function volunteers(x: PCtx, st: Settlement, n: number, war: boolean): number[] {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const cand: [number, number][] = [];
  for (const m of members) {
    if (A.flags[m] & (AgentFlag.child | AgentFlag.elder) || A.mission[m] || A.health[m] < 0.55) continue;
    if (A.id[m] === st.leader && !war) continue;
    if (A.disease[m] >= 0 && x.tick >= A.infectT[m]) continue;
    cand.push([m, aptitude(x, m, war)]);
  }
  cand.sort((a, b) => b[1] - a[1] || A.id[a[0]] - A.id[b[0]]);
  return cand.slice(0, n).map((c) => c[0]);
}

/** cell centre (for callers outside) */
export function missionTarget(x: PCtx, m: Mission): number[] | null {
  const to = x.ps.settlement(m.to);
  return to ? cellPos(x.p, to.cell, [0, 0, 0]) : null;
}

export { routeKey };
