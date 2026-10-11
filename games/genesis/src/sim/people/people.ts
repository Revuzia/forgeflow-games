// GENESIS — the peoples system of a planet (CONTRACT.md §6.3, §8): one entry per tick.
//
//   every tick       agents whose segment or task ends (time wheel, ascending id) -> walk on / finish + decide
//   every 5 (fire)   buildings in burning cells take damage; people in fire are hurt and run
//   hourly           each settlement (staggered by id): caches, roles, jobs, construction, births, old age, accidents,
//                    disease, cohorts, homes (and daily: culture, factions, economy, ages); the ecology (herds graze,
//                    hunt, breed, flee, migrate); missions (caravans, war bands) muster, travel, trade, fight; blight
//                    grows; roads published
//   daily            herds drift in, merge, migrate, speciate, die out; blight breaks out; roads fade; settlements meet;
//                    politics (relations, war, peace, campaigns)
// Hooks into the field systems: buildings are fire fuel (fire.ts fuelHooks); lightning strikes and impacts are
// accident triggers (weather.ts strikeHooks, terrain.ts impactHooks); disasters later call harmArea / damageArea.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { collectFlags } from '../core/activeset.ts';
import { hashFloat } from '../core/rng.ts';
import { fuelHooks } from '../fields/fire.ts';
import { strikeHooks } from '../fields/weather.ts';
import { impactHooks } from '../fields/terrain.ts';
import { makeCtx, type PCtx } from './ctx.ts';
import { DEATH, PHASE, TASK, MEMK } from './defs.ts';
import { onDue } from './decide.ts';
import { schedule } from './sched.ts';
import { leaveShelter } from './tasks.ts';
import { burnBuildings, buildingFuel, ruin } from './buildings.ts';
import { settlementStep, SETTLEMENT_CADENCE } from './settlement.ts';
import { herdArrivals, HERD_CADENCE } from '../life/herds.ts';
import { ecoStep, ecoDaily } from '../life/ecology.ts';
import { blightStep, blightDaily } from '../life/plants.ts';
import { decayRoads, publishRoads } from './roads.ts';
import { die } from './lifecycle.ts';
import { accident } from './knowledge.ts';
import { distM } from './world.ts';
import { missionStep } from './missions.ts';
import { politicsDaily } from './war.ts';
import { contactsDaily, flushReadings } from './culture.ts';
import { finishTask } from './work.ts';
import { creditStretched } from '../perf/plapse.ts';
import { FIRE_HERE, FIRE_NEAR } from './danger.ts';

export const FIRE_CHECK = 5;

let hooksInstalled = false;
/** register the peoples' hooks into the field systems (idempotent) */
export function installPeopleHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  fuelHooks.push(buildingFuel);
  strikeHooks.push(onLightning);
  impactHooks.push(onImpact);
}
installPeopleHooks();

const _due: number[] = [];
const _list = { buf: new Int32Array(0) };
const _cell: number[] = [];

/** the peoples' share of a planet tick */
export function peopleStep(u: Universe, p: Planet, t: number): void {
  const ps = p.people;
  if (!ps) return;
  ps.contentRef = u.content;
  ps.now = t;
  const w = ps.wheel;
  const busy = ps.agents.count > 0 || ps.settlements.length > 0 || ps.herds.length > 0;
  if (!busy) {
    w.now = t + 1;
    // a greening world fills with animals even before anyone lives there
    if ((t + p.id * 97) % 1440 === 700) herdArrivals(makeCtx(u, p));
    return;
  }
  const x = makeCtx(u, p);
  // 0. god acts witnessed since the last step are read (chronicle)
  if (ps.pending.length) flushReadings(x);
  // 1. agents due now
  if (w.count > 0) {
    _due.length = 0;
    w.drain(t, _due);
    const A = x.A;
    for (let i = 0; i < _due.length; i++) {
      const s = A.slotOf(_due[i]);
      if (s >= 0 && A.alive[s]) {
        ps.counters.turns++;
        if (A.phase[s] === 1) ps.counters.byTask[A.task[s]]++;
        onDue(x, s);
      }
    }
  } else w.now = t + 1;
  // 2. fire among people and buildings
  if (t % FIRE_CHECK === 1) fireCheck(x);
  // 3. settlements, staggered over the hour
  const sts = ps.settlements;
  for (let i = 0; i < sts.length; i++) {
    const st = sts[i];
    if ((t + st.id * 7) % SETTLEMENT_CADENCE === 0) settlementStep(x, st);
  }
  // 4. hourly: ecology, missions, blight, roads; daily: arrivals, long-term ecology, outbreaks, contacts, politics
  const ts = t + p.id * 13;
  if (ts % HERD_CADENCE === 17 && ps.herds.length) ecoStep(x);
  if (ts % 60 === 29 && ps.missions.length) missionStep(x);
  if (ts % 60 === 41 && ps.blight.length) blightStep(x);
  if (ts % 60 === 59) publishRoads(x);
  const td = ts % x.day;
  if (td === 700 % x.day) { herdArrivals(x); decayRoads(x); ecoDaily(x); blightDaily(x); }
  if (td === 820 % x.day && ps.settlements.length) { contactsDaily(x); politicsDaily(x); }
}

function fireCheck(x: PCtx): void {
  const p = x.p;
  const n = collectFlags(p.s.fAct, ensureList(p.count), p.count);
  if (n === 0) {
    // clear burning flags once fires are out
    for (const b of x.ps.buildings) if (b.flags & BuildingFlag.burning) { b.flags &= ~BuildingFlag.burning; x.ps.version++; }
    return;
  }
  burnBuildings(x);
  const A = x.A;
  const list = _list.buf;
  const g = p.grid;
  for (let i = 0; i < n; i++) {
    const c = list[i];
    const fi = p.f.fire[c];
    if (fi <= FIRE_HERE) continue;
    // in the flames: burned (from 0.1), and turned to flight mid-task at the same threshold decide() flees at
    if (x.ps.buckets.any(c)) {
      x.ps.agentsIn(c, _cell);
      for (const s of _cell) {
        if (!A.alive[s]) continue;
        if (fi > 0.1) {
          A.health[s] -= fi * 0.08;
          A.flags[s] |= AgentFlag.onFire;
          if (A.health[s] <= 0) { die(x, s, DEATH.fire); continue; }
        }
        if (A.task[s] !== TASK.flee) interrupt(x, s);
      }
    }
    // beside a cell burning hard: move away before it spreads (decide() gives flight 8+ there)
    if (fi <= FIRE_NEAR) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (p.f.fire[o] > FIRE_HERE || !x.ps.buckets.any(o)) continue;
      x.ps.agentsIn(o, _cell);
      for (const s of _cell) if (A.alive[s] && A.task[s] !== TASK.flee && !(A.flags[s] & AgentFlag.possessed)) interrupt(x, s);
    }
  }
}

function ensureList(n: number): Int32Array {
  if (_list.buf.length < n) _list.buf = new Int32Array(n);
  return _list.buf;
}

/** stop what an agent is doing and decide again next tick (fire, a predator, the god's hand) */
export function interrupt(x: PCtx, s: number): void {
  const A = x.A;
  // (SIM perf push 3, round 2: a task stretched at 100x / 1000x yields the whole sessions already worked — the 1x agent
  // finished those before the interruption; perf/plapse.ts. A.dmg is 0 at level 0)
  if (A.dmg[s] !== 0) { creditStretched(x, s, finishTask); if (!A.alive[s]) return; }
  const pos = [0, 0, 0];
  A.posAt(s, x.tick, pos);
  A.place(s, pos[0], pos[1], pos[2], x.tick);
  if (A.inside[s] >= 0) leaveShelter(x, s);
  A.task[s] = TASK.idle;
  A.phase[s] = PHASE.working;
  A.pathLen[s] = 0;
  schedule(x, s, x.tick + 1);
}

// ───────────────────────────── hooks for the field systems and later phases ─────────────────────────────

/** settlements whose territory (or a radius) covers a point */
export function settlementsNear(x: PCtx, pos: ArrayLike<number>, radiusM: number): Settlement[] {
  return x.ps.settlements.filter((st) => st.fallen < 0 && distM(x.p, st.pos, pos) <= Math.max(radiusM, st.territory + radiusM));
}

/** weather.ts: lightning struck cell c (and maybe lit a fire) */
export function onLightning(u: Universe, p: Planet, c: number, ignited: boolean): void {
  if (!p.people || p.people.settlements.length === 0) return;
  const x = makeCtx(u, p);
  const P = p.grid.pos;
  const pos = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  const dune = p.f.sand[c] > 0.8 || x.c.biomes.list[p.f.biome[c]]?.id === 'dune' || x.c.biomes.list[p.f.biome[c]]?.id === 'desert';
  for (const st of settlementsNear(x, pos, 300)) {
    accident(x, st, 'lightning', c);
    if (dune) {
      accident(x, st, 'lightning-dune', c);
      // a branch of glass lies in the sand (an artifact to wonder at)
    }
    if (ignited) accident(x, st, 'lightning-fire', c);
  }
  // struck people
  const s = p.people.buckets.head[c];
  if (s >= 0 && hashFloat(c, u.tick, 0x11a) < 0.3) {
    const A = x.A;
    A.health[s] -= 0.6;
    A.remember(s, MEMK.lightning, u.tick, 0);
    if (A.health[s] <= 0) die(x, s, DEATH.disaster);
  }
}

/** terrain.ts / disasters: something struck the ground at pos (radius m); meteor = iron from the sky */
export function onImpact(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, meteor: boolean): void {
  if (!p.people) return;
  const x = makeCtx(u, p);
  harmArea(u, p, pos, radiusM * 1.3, 1, DEATH.disaster);
  damageArea(u, p, pos, radiusM * 1.5, 1, 'impact');
  if (meteor) {
    // star iron lies in the crater
    const c = p.cellAt(pos);
    const it = x.c.items.idx('meteoric-iron');
    if (it >= 0) dropItem(x, it, 3, [pos[0], pos[1], pos[2]], c, true);
    for (const st of settlementsNear(x, pos, 1200)) { accident(x, st, 'meteor-iron', c); st.recent.starIron = x.tick; }
  }
}

/** disasters: hurt people within radius (severity 1 = lethal at the centre) */
export function harmArea(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, severity: number, cause: number): number {
  if (!p.people) return 0;
  const x = makeCtx(u, p);
  const A = x.A;
  let hurt = 0;
  const pt = [0, 0, 0];
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, u.tick, pt);
    const d = distM(p, pt, pos);
    if (d > radiusM) continue;
    const k = severity * (1 - d / radiusM) * 1.4;
    A.health[s] -= k;
    A.fear[s * 4] = Math.min(1, A.fear[s * 4] + 0.2 * severity);
    hurt++;
    if (A.health[s] <= 0) die(x, s, cause);
    else interrupt(x, s);
  }
  return hurt;
}

/** disasters: damage buildings within radius (severity 1 = destroys the weak at the centre) */
export function damageArea(u: Universe, p: Planet, pos: ArrayLike<number>, radiusM: number, severity: number, why: string): number {
  if (!p.people) return 0;
  const x = makeCtx(u, p);
  let n = 0;
  for (const b of x.ps.buildings.slice()) {
    if (b.flags & BuildingFlag.ruined) continue;
    const d = distM(p, b.pos, pos);
    if (d > radiusM) continue;
    const mat = x.c.materials.list[b.material];
    b.damage = Math.min(1, b.damage + severity * (1 - d / radiusM) * 1.5 / Math.max(0.3, mat?.strength ?? 1));
    x.ps.version++;
    if (b.damage >= 1) { ruin(x, x.ps.settlement(b.settlement), b, why); n++; }
  }
  return n;
}

/** an item placed on the ground (gifts refused, artifacts, meteor iron) */
export function dropItem(x: PCtx, item: number, qty: number, pos: [number, number, number], cell: number, artifact: boolean): number {
  const id = x.u.ids.alloc('item');
  x.ps.items.push({ id, item, qty, pos, cell, tick: x.tick, artifact });
  x.ps.iByCell.add(cell, id);
  x.ps.version++;
  return id;
}

/**
 * Witnesses of a god act (CONTRACT §8.8): the hook API is culture.ts `witness(planet, pos, radius, kind, magnitude,
 * god)`; re-exported here for the other lanes that import their hooks from this file.
 */
export { witness } from './culture.ts';

export type { PCtx };
