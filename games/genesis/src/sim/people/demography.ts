// GENESIS — LIVING LAND (LIVING.md §2.8): demography. Villages were 60-80 % children: births had no spacing (a mother's
// births came 0.69 game years apart), every couple bore at the full rate whatever the number of mouths, and childhood
// was safe (6 % of births died before 15, three of them "of old age").
//
//   spacing    a mother conceives again only 2-3 game years after her last birth (AgentStore.lastBirth, saved; her own
//              gap, drawn from the world's dice) — nursing and weaning, as in every people without contraception
//   fertility  × clamp(1.5 − children / adults, 0.3, 1): many mouths to feed, fewer births; it rises over the six
//              years after maturity and wanes after 30; a full store no longer raises it (plentyFactor ≤ 1)
//   childhood  the hazards of growing up, per year of age: under 1 9 %, 1-5 1.6 %, 5-15 0.3 % (a "childhood fever",
//              DEATH.childhood); ×2.5 in famine, ×0.8 where herbalism is known, ×0.6 with medicine. Old age no longer
//              takes children (settlement.ts oldAge).
// Why these numbers: an under-15 share of 35-45 % (real pre-modern peoples) goes with growth of ~1.5-3 % a year for a
// people that matures at 14 and lives ~55 years (stable-population arithmetic: share ≈ (1 − e^(−15r)) / (1 − e^(−55r)),
// 0.39 at r = 2 %).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { DEATH } from './defs.ts';
import { libHas } from './knowledge.ts';
import { chanceIn } from '../perf/plapse.ts';
import { famine } from './hunt.ts';
import { worldSalt } from './lifecycle.ts';

/** a mother's births are at least this many game years apart (her own gap is drawn in [GAP_MIN, GAP_MAX]) */
export const GAP_MIN = 2.0, GAP_MAX = 3.0;
/** yearly hazards of childhood by age: under 1, 1 to 5, 5 to 15 */
export const CHILD_HAZARD = [0.09, 0.016, 0.003] as const;
/** fertility wanes from this age (years) to nothing at the species' elder age − 5 */
export const WANE_FROM = 30;
/** a young woman's fertility rises from nothing at maturity to full this many years later (first births come at ~18-20) */
export const FIRST_RAMP = 6;

/** the gap (years) between mother m's births, her own (the world's dice: ids repeat from world to world) */
export function birthGap(x: PCtx, m: number): number {
  return GAP_MIN + (GAP_MAX - GAP_MIN) * hashFloat(x.A.id[m], worldSalt(x, 0x6a9));
}

/** may mother m conceive now (her last birth far enough behind her) */
export function spaced(x: PCtx, m: number): boolean {
  const last = x.A.lastBirth[m];
  return last === 0 || (x.tick - last) / x.year >= birthGap(x, m);
}

/** the settlement's fertility factor: many children to the adults, fewer births (LIVING §2.8) */
export function mouths(x: PCtx, st: Settlement): number {
  const A = x.A;
  let kids = st.cohort.n[0], adults = st.cohort.n[1] + st.cohort.n[2];
  for (const m of x.ps.members.get(st.id) ?? []) if (A.flags[m] & AgentFlag.child) kids++; else adults++;
  const v = 1.5 - kids / Math.max(1, adults);
  return v < 0.3 ? 0.3 : v > 1 ? 1 : v;
}

/**
 * How well fed a people is, as a factor of a mother's chance to conceive: food in store (days a head / 3) or full
 * bellies, up to 1 — hunger lowers fertility, plenty does not raise it above nature's rate. (It used to reach 1.4 with
 * a full granary: farming towns kept 12-54 days of food a head, so every mother bore 40 % more, and with the needs
 * of LIVING §2.9 met, moods — another factor — rose too: births ran at 4-5 % a year and villages stayed half children.)
 */
export function plentyFactor(daysAHead: number, fed: number): number {
  const v = Math.max(daysAHead / 3, fed * 0.8);
  return v < 1 ? v : 1;
}

/** a mother's fertility by her age: rising from 0 at maturity to 1 FIRST_RAMP years later, 1 to WANE_FROM, then down to
 * 0 at the species' last fertile age `last` */
export function ageFertility(age: number, last: number, maturity = 0): number {
  if (age < maturity) return 0;
  const young = age < maturity + FIRST_RAMP ? (age - maturity) / FIRST_RAMP : 1;
  if (age <= WANE_FROM) return young;
  if (age >= last) return 0;
  return young * (1 - (age - WANE_FROM) / Math.max(1, last - WANE_FROM));
}

/** the yearly hazard of childhood at `age` years in settlement st */
export function childHazard(x: PCtx, st: Settlement, age: number): number {
  let h = age < 1 ? CHILD_HAZARD[0] : age < 5 ? CHILD_HAZARD[1] : CHILD_HAZARD[2];
  if (famine(x, st)) h *= 2.5;
  const med = x.rt.byId.get('medicine'), herb = x.rt.byId.get('herbalism');
  if (med !== undefined && libHas(st, med)) h *= 0.6;
  else if (herb !== undefined && libHas(st, herb)) h *= 0.8;
  return h;
}

/** the deaths of childhood over the last `hours` hours (settlement.ts settlementStep; perf/plapse.ts: the window's chance) */
export function childhood(x: PCtx, st: Settlement, hours: number, die: (x: PCtx, s: number, cause: number) => void): void {
  const A = x.A;
  const members = x.ps.members.get(st.id);
  if (!members || !members.length) return;
  const maturity = x.info[st.species].def.maturity;
  const dice = worldSalt(x, 0xc41d);
  let kids: number[] | null = null;
  for (const m of members) {
    if (!(A.flags[m] & AgentFlag.child)) continue;
    (kids ??= []).push(m);
  }
  if (!kids) return;
  for (const m of kids) {
    if (!A.alive[m]) continue;
    const age = (x.tick - A.birth[m]) / x.year;
    if (age >= Math.min(15, maturity)) continue;
    const p = chanceIn((childHazard(x, st, age) * 60) / x.year, hours);
    if (hashFloat(A.id[m], x.tick, dice) < p) die(x, m, DEATH.childhood);
  }
}
