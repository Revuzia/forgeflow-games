// GENESIS — cohorts (CONTRACT.md §8.7): beyond the individual cap a settlement's extra members live as aggregate counts
// by age band (children, adults, elders) with the fraction of adults knowing each recipe, simulated statistically each
// settlement hour: they eat from the store, gather, are born, grow up, age and die, and learn what their settlement
// knows. The logged 'focus' command (the camera dwelling on a place) promotes up to N of them to named individuals
// there (traits and knowledge sampled from the cohort) and demotes individuals of far settlements to make room —
// deterministic, because focus is a command in the log.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { hashFloat } from '../core/rng.ts';
import { AgentFlag } from '../types.ts';
import { NEED_N, FOOD } from './needs.ts';
import { spawnAgent, worldSalt } from './lifecycle.ts';
import { storeAdd, bestFood, storeTake } from './store.ts';
import { distM } from './world.ts';
import { itemIdx } from './resources.ts';
import { leaveShelter } from './tasks.ts';

export function cohortTotal(st: Settlement): number {
  return st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2];
}

/** hourly statistics of a settlement's cohort */
export function cohortStep(x: PCtx, st: Settlement): void {
  const co = st.cohort;
  const total = co.n[0] + co.n[1] + co.n[2];
  if (total <= 0) return;
  const sp = x.info[st.species].def;
  const hoursPerYear = x.year / 60;
  const perDay = x.info[st.species].decay[FOOD] || 0.5;
  // work: adults gather about what they eat and a little more (the settlement's land permitting)
  const grain = itemIdx(x, 'grain'), roots = itemIdx(x, 'roots');
  const produce = co.n[1] * (1.15 / 24) * (0.6 + co.skill);
  storeAdd(x, st, grain >= 0 && st.crop >= 0 ? grain : roots, produce * 3);
  // eat
  let need = (total * (1 / 24));
  for (let g = 0; g < 4 && need > 0.001; g++) {
    const it = bestFood(x, st);
    if (it < 0) break;
    const val = x.info[st.species].edible[it];
    need -= storeTake(st, it, need / Math.max(0.05, val)) * val;
  }
  const hungry = need > 0.001 ? Math.min(1, need * 24 / Math.max(1, total)) : 0;
  void perDay;
  // ageing, births, deaths (expected values, rounded deterministically)
  const grow = co.n[0] / Math.max(1, sp.maturity * hoursPerYear);
  const old = co.n[1] / Math.max(1, (sp.elder - sp.maturity) * hoursPerYear);
  const births = co.n[1] * 0.5 * (sp.fertility / hoursPerYear) * (1 - hungry);
  const deaths = co.n[2] / Math.max(1, (sp.lifespan - sp.elder) * hoursPerYear) + total * hungry * 0.02;
  co.n[0] = round(co.n[0] + births - grow - deaths * 0.15);
  co.n[1] = round(co.n[1] + grow - old - deaths * 0.25);
  co.n[2] = round(co.n[2] + old - deaths * 0.6);
  for (let i = 0; i < 3; i++) if (co.n[i] < 0) co.n[i] = 0;
  // they learn what their settlement knows
  for (const k of st.library) {
    const key = String(k);
    const f = co.know[key] ?? 0;
    co.know[key] = round(f + (1 - f) * 0.01);
  }
  co.skill = round(Math.min(0.8, co.skill + 0.0005));
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** move agent s into its settlement's cohort (no death: they are still there, only not individually simulated) */
export function demote(x: PCtx, s: number): void {
  const A = x.A;
  const st = x.ps.settlement(A.settlement[s]);
  if (!st) return;
  const co = st.cohort;
  const band = A.flags[s] & AgentFlag.child ? 0 : A.flags[s] & AgentFlag.elder ? 2 : 1;
  const adults = co.n[1] + co.n[2];
  // knowledge fractions absorb this adult
  if (band > 0) {
    const kw = A.kw;
    const keys = new Set<string>(Object.keys(co.know));
    for (let w = 0; w < kw; w++) for (let b = 0; b < 32; b++) if (A.know[s * kw + w] & (1 << b)) keys.add(String(w * 32 + b));
    for (const key of [...keys].sort((a, b) => Number(a) - Number(b))) {
      const k = Number(key);
      const f = co.know[key] ?? 0;
      co.know[key] = round((f * adults + (A.knows(s, k) ? 1 : 0)) / (adults + 1));
    }
  }
  co.n[band] += 1;
  // leave the individual simulation quietly
  const id = A.id[s];
  for (const hh of st.households) { const i = hh.members.indexOf(id); if (i >= 0) hh.members.splice(i, 1); }
  st.households = st.households.filter((h) => h.members.length > 0);
  for (let k = 0; k < 4; k++) { const it = A.invItem[s * 4 + k]; if (it >= 0) storeAdd(x, st, it, A.invQty[s * 4 + k]); }
  if (A.inside[s] >= 0) leaveShelter(x, s);
  x.ps.buckets.move(s, -1);
  x.ps.wheel.cancel(id);
  x.ps.removeMember(st.id, s);
  A.release(s);
}

/** promote up to n cohort members of st to individuals; returns how many */
export function promote(x: PCtx, st: Settlement, n: number): number {
  const co = st.cohort;
  let made = 0;
  const sp = x.info[st.species].def;
  // their ages and what they know are the world seed's draw (settlement ids and ticks repeat from world to world;
  // lifecycle.ts worldSalt)
  const ageDice = worldSalt(x, 0xc040), knowDice = worldSalt(x, 0xc041);
  for (let i = 0; i < n; i++) {
    const band: number = co.n[1] >= 1 ? 1 : co.n[0] >= 1 ? 0 : co.n[2] >= 1 ? 2 : -1;
    if (band < 0) break;
    co.n[band] -= 1;
    const r = hashFloat(st.id, x.tick, i, ageDice);
    const age = band === 0 ? r * sp.maturity : band === 1 ? sp.maturity + r * (sp.elder - sp.maturity) : sp.elder + r * Math.max(1, sp.lifespan - sp.elder);
    const knowledge: number[] = [];
    if (band > 0) for (const [key, f] of Object.entries(co.know)) if (hashFloat(st.id, Number(key), x.tick + i, knowDice) < f) knowledge.push(Number(key));
    knowledge.sort((a, b) => a - b);
    const s = spawnAgent(x, st, { ageYears: age, knowledge, skill: co.skill + 0.1 });
    x.A.needs[s * NEED_N + FOOD] = 0.7;
    made++;
  }
  return made;
}

/**
 * The camera dwells at pos: promote cohort members of settlements near it (up to `max`) and, when the planet is at
 * its cap, demote individuals of the farthest settlements to make room.
 */
export function focusPeople(x: PCtx, pos: ArrayLike<number>, max = 40): { promoted: number; demoted: number } {
  const cap = x.u.settings.maxAgents;
  const near = x.ps.settlements.filter((st) => st.fallen < 0 && cohortTotal(st) >= 1 && distM(x.p, st.pos, pos) < 700)
    .sort((a, b) => distM(x.p, a.pos, pos) - distM(x.p, b.pos, pos) || a.id - b.id);
  if (!near.length) return { promoted: 0, demoted: 0 };
  let want = 0;
  for (const st of near) want += Math.min(max, Math.floor(cohortTotal(st)));
  want = Math.min(max, want);
  let demoted = 0;
  const room = cap - x.A.count;
  if (room < want) {
    // demote individuals of far settlements, youngest-id last (deterministic order)
    const far = x.ps.settlements.filter((st) => st.fallen < 0 && distM(x.p, st.pos, pos) > 1500)
      .sort((a, b) => distM(x.p, b.pos, pos) - distM(x.p, a.pos, pos) || a.id - b.id);
    for (const st of far) {
      const members = (x.ps.members.get(st.id) ?? []).slice();
      // keep a core of individuals in every settlement
      for (let i = members.length - 1; i >= 8 && demoted < want - room; i--) { demote(x, members[i]); demoted++; }
      if (demoted >= want - room) break;
    }
  }
  let promoted = 0;
  for (const st of near) {
    const free = cap - x.A.count;
    if (free <= 0) break;
    promoted += promote(x, st, Math.min(free, max - promoted, Math.floor(cohortTotal(st))));
    if (promoted >= max) break;
  }
  return { promoted, demoted };
}
