// GENESIS — needs (CONTRACT.md §8.2): food, water, warmth, rest, safety, belonging, status, curiosity, faith (+ wetness
// for coastal folk, methane for the drifters, hive for the hive), each 0..1 satisfaction.
//
// Needs are updated LAZILY: an agent is only touched when a segment or task ends, so `updateNeeds` integrates the
// elapsed interval at once (decay at species rates; warmth, safety, wetness, methane and hive drift toward what the
// place and the hour allow). Needs at zero hurt: health falls by the most pressing deprivation and the dominant cause
// is kept for the death notice. Health heals when the body is fed, watered and warm.

import type { PCtx } from './ctx.ts';
import { AgentFlag } from '../types.ts';
import { NEED, NT, TASK, TRAIT } from './defs.ts';
import { DEATH } from './defs.ts';
import { airTemp, sunElevation } from './world.ts';
import { caseHarm } from '../life/disease.ts';
// SIM phase 4: a pressure suit or a habitat dome seals a body in its own air and warmth (space/habitat.ts)
import { sealed } from '../space/habitat.ts';

const FOOD = NEED.food, WATER = NEED.water, WARMTH = NEED.warmth, REST = NEED.rest, SAFETY = NEED.safety;
const BELONG = NEED.belonging, STATUS = NEED.status, CURIO = NEED.curiosity, FAITH = NEED.faith;
const WET = NEED.wetness, METHANE = NEED.methane, HIVE = NEED.hive;

/** is there a lit fire (hearth, kiln, furnace) or a burning cell where agent s stands */
export function fireAt(x: PCtx, cell: number): boolean {
  const p = x.p;
  if (p.f.fire[cell] > 0.05 || p.f.lava[cell] > 0.01) return true;
  const ids = x.ps.bByCell.get(cell);
  for (let i = 0; i < ids.length; i++) {
    const b = x.ps.building(ids[i]);
    if (b && b.fuel > 0 && b.progress >= 1 && x.c.buildings.list[b.type].heat > 0) return true;
  }
  return false;
}

/** shelter insulation at the agent's spot (0 outside) */
export function shelterAt(x: PCtx, s: number): number {
  const A = x.A;
  if (!(A.flags[s] & AgentFlag.sleepingIndoors) || A.inside[s] < 0) return 0;
  const b = x.ps.building(A.inside[s]);
  if (!b || b.progress < 1) return 0.4;
  return x.c.materials.list[b.material]?.insulation ?? 0.5;
}

/** body heat of the others sharing the shelter (°C): a full hut, a packed mound or an igloo is warm */
function bodyHeat(x: PCtx, s: number): number {
  const b = x.ps.building(x.A.inside[s]);
  if (!b || b.progress < 1) return 0;
  return Math.min(8, Math.max(0, b.occupants - 1) * 1.2);
}

/** effective temperature an agent feels, and the resulting cold / heat stress (0 comfortable .. 1 deadly) */
export function thermalStress(x: PCtx, s: number, out?: { teff: number; cold: number; heat: number }): number {
  const A = x.A;
  const sp = x.info[A.species[s]];
  const [tMin, lo, hi, tMax] = sp.def.temp;
  const cell = A.cell[s];
  // the interval since the last update felt the average of then and now (a night outdoors is not judged by the dawn)
  const now = airTemp(x.p, cell);
  const before = A.needT[s] > 0 || A.tAir[s] !== 0 ? A.tAir[s] : now;
  let t = Math.min(now, (now + before) * 0.5 + (before < now ? (before - now) * 0.25 : 0));
  if (out) A.tAir[s] = now;
  const ins = shelterAt(x, s);
  const fire = fireAt(x, cell);
  let clothes = 0;
  if (A.gear[s] >= 0) clothes = x.c.items.list[A.gear[s]]?.warmth ?? 0;
  // against cold: shelter evens the temperature toward comfort, a fire warms up to it, clothes help;
  // against heat: shelter gives shade; nobody has to sit in the fire, and clothes come off
  const mid = (lo + hi) * 0.5;
  let tc = t;
  if (ins > 0 && tc < mid) tc = Math.min(mid, tc + (mid - tc) * ins * 0.7 + bodyHeat(x, s) * ins);
  if (fire && tc < mid) tc = Math.min(mid, tc + 16);
  tc += clothes * 26;
  const cold = tc < lo ? Math.min(2, (lo - tc) / Math.max(4, lo - tMin)) : 0;
  let th = t;
  if (ins > 0 && th > mid) th -= (th - mid) * ins * 0.45;
  if (th > mid) {
    // water cools a body far better than shade (standing or bathing in it); trees give shade
    const f = x.p.f;
    const inWater = f.water[cell] > 0.3 || (A.task[s] === TASK.bathe && A.phase[s] === 1);
    if (inWater) th -= (th - mid) * 0.6;
    else if (f.tree[cell] > 0.3) th -= (th - mid) * 0.25 * Math.min(1, f.tree[cell]);
  }
  const heat = th > hi ? Math.min(2, (th - hi) / Math.max(4, tMax - hi)) : 0;
  // sealed in a suit or a dome, the world's cold and heat stay outside (asked only past bearing: a cheap path)
  if ((cold > 0.3 || heat > 0.3) && sealed(x, s)) {
    if (out) { out.teff = (lo + hi) * 0.5; out.cold = 0; out.heat = 0; }
    return 0;
  }
  if (out) { out.teff = cold > 0 ? tc : th; out.cold = cold; out.heat = heat; }
  return Math.max(cold, heat);
}

const _th = { teff: 0, cold: 0, heat: 0 };
/** the thermal stress computed by the last updateNeeds (decide reads it instead of computing it again) */
export let lastStress = 0;
const _pos = [0, 0, 0];

/**
 * Integrate needs and health from needT[s] to now. Returns the health after the update (<= 0 = the agent dies; the
 * cause is in A.cause[s]).
 */
export function updateNeeds(x: PCtx, s: number): number {
  const A = x.A;
  const now = x.tick;
  const dt = now - A.needT[s];
  if (dt <= 0) { lastStress = thermalStress(x, s, _th); return A.health[s]; }
  A.needT[s] = now;
  const days = dt / x.day;
  const sp = x.info[A.species[s]];
  const nb = s * NEED_N;
  const N = A.needs;
  const decay = sp.decay;
  const asleep = A.task[s] === TASK.sleep && A.phase[s] === 1;
  _h.dmg = 0; _h.cause = 0; _h.worst = 0;
  // food and water: linear decay; time spent at zero hurts
  if (sp.needW[FOOD] > 0) hurt(zeroDays(N, nb + FOOD, decay[FOOD] * (asleep ? 0.6 : 1), days) * 0.13, DEATH.starvation);
  if (sp.needW[WATER] > 0) hurt(zeroDays(N, nb + WATER, decay[WATER] * (asleep ? 0.5 : 1), days) * 0.45, DEATH.thirst);
  // rest: sleep restores (the sleep task adds it on completion), waking hours tire
  if (!asleep) N[nb + REST] = Math.max(0, N[nb + REST] - decay[REST] * days);
  // social and inner needs drift down
  N[nb + BELONG] = Math.max(0, N[nb + BELONG] - decay[BELONG] * days * (0.5 + A.traits[s * NT + TRAIT.sociability]));
  N[nb + CURIO] = Math.max(0, N[nb + CURIO] - decay[CURIO] * days * (0.4 + A.traits[s * NT + TRAIT.curiosity]));
  N[nb + FAITH] = Math.max(0, N[nb + FAITH] - decay[FAITH] * days * (0.3 + A.traits[s * NT + TRAIT.piety]));
  N[nb + STATUS] = Math.max(0, N[nb + STATUS] - decay[STATUS] * days);
  // warmth from the place
  const stress = thermalStress(x, s, _th);
  lastStress = stress;
  if (sp.needW[WARMTH] > 0) {
    let w = N[nb + WARMTH];
    if (stress > 0.02) {
      const rate = stress * 2.6;
      const after = w - rate * days;
      if (after < 0) {
        const zd = days - w / rate;
        // spent: a mild chill or a warm afternoon wears them down slowly (they seek a roof, a fire, shade, a better
        // place); real cold or heat kills within a day or two. (A flat 0.3 + stress harm let cold folk die of a 9 °C
        // summer day in two days.)
        hurt(zd * Math.max(0.02, (stress - 0.25) * 1.8), _th.heat > _th.cold ? DEATH.heat : DEATH.cold);
        w = 0;
      } else w = after;
    } else w = Math.min(1, w + 2.2 * days);
    N[nb + WARMTH] = w;
  }
  // safety: night without fire, predators, fear of the gods, walls
  {
    A.posAt(s, now, _pos);
    const night = sunElevation(x.u, x.p, now, _pos) < -0.03 !== sp.def.nocturnal;
    const st = x.ps.settlement(A.settlement[s]);
    let target = 1;
    if (night && !fireAt(x, A.cell[s]) && !(A.flags[s] & AgentFlag.sleepingIndoors)) target -= 0.35;
    if (st?.res && st.res.danger >= 0) target -= 0.3;
    target -= Math.min(0.4, A.fear[s * 4] * 0.4);
    if (A.disease[s] >= 0 && now >= A.infectT[s]) target -= 0.15;
    // war at the gates
    if (st && st.besieged >= 0) target -= 0.3;
    const cur = N[nb + SAFETY];
    const k = Math.min(1, days * 2);
    N[nb + SAFETY] = cur + (Math.max(0, target) - cur) * k;
  }
  // species needs
  if (sp.needW[WET] > 0) {
    const f = x.p.f;
    const c = A.cell[s];
    const wet = f.water[c] > 0.05 || f.precip[c] > 0.1 || x.p.s.coast[c] > 0 || f.wetness[c] > 0.5;
    if (wet) N[nb + WET] = Math.min(1, N[nb + WET] + 3 * days);
    else hurt(zeroDays(N, nb + WET, decay[WET], days) * 0.25, DEATH.heat);
  }
  if (sp.needW[METHANE] > 0) {
    const a = x.p.st.atmosphere;
    if (a.methane * a.pressure >= 0.02 || sealed(x, s)) N[nb + METHANE] = 1;
    else hurt(zeroDays(N, nb + METHANE, 3, days) * 1.6, DEATH.suffocation);
  }
  if (sp.needW[HIVE] > 0) {
    const st = x.ps.settlement(A.settlement[s]);
    const home = !!st && !st.band && !!st.res && st.res.contexts.includes('hive');
    if (home) N[nb + HIVE] = Math.min(1, N[nb + HIVE] + 2 * days);
    else N[nb + HIVE] = Math.max(0, N[nb + HIVE] - 0.5 * days);
  }
  // breath: lungs need their gas (a suit or a dome carries its own: space/habitat.ts)
  {
    const a = x.p.st.atmosphere;
    const br = sp.def.breathes;
    const noO2 = br === 'o2' && a.pressure * a.o2 < 0.05;
    const noCH4 = br === 'methane' && a.pressure * a.methane < 0.005 && a.pressure * a.o2 > 0.05;
    const toxic = a.toxicity > 0.5;
    if ((noO2 || noCH4 || toxic) && !sealed(x, s)) {
      if (noO2) hurt(days * 2.5, DEATH.suffocation);
      if (noCH4) hurt(days * 1.5, DEATH.suffocation);
      if (toxic) hurt(days * (a.toxicity - 0.5) * 1.5, DEATH.suffocation);
    }
  }
  // sickness wears the body: a grave case wastes away within the illness unless cured, a mild one barely (disease.ts)
  const sick = A.disease[s] >= 0 && now >= A.infectT[s];
  if (sick) hurt(days * caseHarm(x, s), DEATH.disease);
  // healing
  const cause = _h.cause;
  let h = A.health[s] - _h.dmg;
  if (N[nb + FOOD] > 0.15 && N[nb + WATER] > 0.15 && N[nb + WARMTH] > 0.25 && !sick) h += 0.18 * days * (asleep ? 1.6 : 1);
  if (h > 1) h = 1;
  A.health[s] = h;
  if (cause) A.cause[s] = cause;
  if (h > 0.5 && A.flags[s] & AgentFlag.sick && A.disease[s] < 0) A.flags[s] &= ~AgentFlag.sick;
  // mood: weighted satisfaction
  let wsum = 0, msum = 0;
  for (let k = 0; k < NEED_N; k++) { const w = sp.needW[k]; if (w > 0) { wsum += w; msum += w * N[nb + k]; } }
  A.mood[s] = wsum > 0 ? msum / wsum : 1;
  return h;
}

const NEED_N = 12;

/** harm accumulated by one updateNeeds call (module scratch: no closure per call) */
const _h = { dmg: 0, cause: 0, worst: 0 };
function hurt(amount: number, why: number): void {
  if (amount <= 0) return;
  _h.dmg += amount;
  if (amount > _h.worst) { _h.worst = amount; _h.cause = why; }
}

/** a need decaying linearly at `rate` per day over `days`: the days spent at zero (the need is updated in place) */
function zeroDays(N: Float32Array, i: number, rate: number, days: number): number {
  const before = N[i];
  const after = before - rate * days;
  if (after >= 0) { N[i] = after; return 0; }
  N[i] = 0;
  return rate > 0 ? days - before / rate : 0;
}

/** need index helper for other modules */
export { FOOD, WATER, WARMTH, REST, SAFETY, BELONG, STATUS, CURIO, FAITH, WET, METHANE, HIVE, NEED_N };

/** a new body's needs: comfortable */
export function initNeeds(x: PCtx, s: number, level = 0.85): void {
  const nb = s * NEED_N;
  for (let k = 0; k < NEED_N; k++) x.A.needs[nb + k] = level;
  x.A.needT[s] = x.tick;
  x.A.health[s] = 1;
}
