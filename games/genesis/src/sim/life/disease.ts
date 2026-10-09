// GENESIS — plagues among people (CONTRACT.md §9 diseases.json, §10): SEIR over the individuals AND the cohort of a
// settlement, carried between settlements by the people who travel (traders, war bands, refugees, colonists by boat)
// and by animals (rats in the granary, a sick flock), eased by medicine.
//
//   S  susceptible: disease -1 and not immune to it (immunity bits)
//   E  exposed:     disease d, the tick it turns infectious (infectT) still ahead — carries it unseen
//   I  infectious:  disease d, sick flag, until sickEnd; a case turns GRAVE with chance mortality × 2.5 × the
//                   settlement's relief (herbalism, medicine, vaccination: recipe effect 'mortality'); grave cases waste
//                   away (needs.ts reads `caseHarm`) unless a healer with medicine cures them; mild ones recover
//   R  recovered:   immune with the disease's immunity chance
// The cohort runs the same compartments as fractions of its members. The force of infection inside a settlement is
// one number (infectious share × contacts × contagion), so individuals and the cohort infect each other alike.
// Every roll is a stateless hash of (agent id, disease, tick, salt).

import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { MEMK } from '../people/defs.ts';
import { tell } from '../people/story.ts';
import { accident, libraryEffect } from '../people/knowledge.ts';
import { settlementRef, vars } from '../people/util.ts';

/** contacts per hour a person has inside their settlement (a village of forty; more in a crowd, fewer in a hamlet) */
const MEETS = 4;

/** case fatality of a disease before relief */
export function caseFatality(x: PCtx, d: number): number {
  return Math.min(0.9, (x.c.diseases.list[d]?.mortality ?? 0) * 2.5);
}

/** the settlement's relief from what it knows (herbalism, medicine, vaccination...) */
export function relief(x: PCtx, st: Settlement | undefined): number {
  if (!st) return 1;
  return libraryEffect(x, st, 'mortality');
}

/** how much quarantine and hygiene cut contagion (recipe effect 'contagion') */
function guard(x: PCtx, st: Settlement): number {
  return libraryEffect(x, st, 'contagion');
}

/** is agent s sick and infectious now (I) */
export function infectious(x: PCtx, s: number): boolean {
  return x.A.disease[s] >= 0 && x.tick >= x.A.infectT[s];
}

/** is the current case of agent s grave (it kills unless treated) */
export function grave(x: PCtx, s: number): boolean {
  const A = x.A;
  const d = A.disease[s];
  if (d < 0) return false;
  const st = x.ps.settlement(A.settlement[s]);
  return hashFloat(A.id[s], d, A.infectT[s], 0x9a7e) < caseFatality(x, d) * relief(x, st);
}

/** health lost per day by a sick agent (needs.ts): grave cases waste away within the illness, mild ones barely */
export function caseHarm(x: PCtx, s: number): number {
  if (!infectious(x, s)) return 0;
  const def = x.c.diseases.list[x.A.disease[s]];
  if (!def) return 0;
  // (a mild case wears a healthy body a little but never kills on its own: a weak one it would finish off, and those
  // deaths were the plague's, whatever medicine the town knew)
  return grave(x, s) ? 1.35 / Math.max(0.5, def.duration) : x.A.health[s] > 0.35 ? 0.06 : 0;
}

/** can disease d infect agent s */
export function susceptible(x: PCtx, s: number, d: number): boolean {
  const A = x.A;
  if (A.disease[s] >= 0) return false;
  if (d < 32 && A.immune[s] & (1 << d)) return false;
  const def = x.c.diseases.list[d];
  if (def.species && !def.species.includes(x.c.species.list[A.species[s]].id)) return false;
  return true;
}

/** agent s catches disease d (exposed: sick and infectious after the incubation) */
export function infect(x: PCtx, s: number, d: number): boolean {
  if (!susceptible(x, s, d)) return false;
  const A = x.A;
  const def = x.c.diseases.list[d];
  A.disease[s] = d;
  A.infectT[s] = x.tick + Math.max(1, Math.round((def.incubation ?? 1) * x.day));
  A.sickEnd[s] = A.infectT[s] + Math.round(def.duration * x.day);
  return true;
}

/** a settlement's epidemic bookkeeping (in st.recent): which disease, since when, deaths so far */
function epidemicOf(st: Settlement): number {
  return (st.recent.epidemic ?? 0) - 1;
}

function beginEpidemic(x: PCtx, st: Settlement, d: number, source: string | null): void {
  if (epidemicOf(st) === d) return;
  st.recent.epidemic = d + 1;
  st.recent.epidemicSince = x.tick;
  st.recent.epidemicDead = 0;
  const def = x.c.diseases.list[d];
  const v = vars(x, st, -1, { disease: def.name.toLowerCase(), other: source ?? undefined });
  tell(x.u, x.p, source ? 'plague.spread' : 'plague', v, st, [settlementRef(x, st)]);
  x.u.emit({ t: 'plague', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], text: def.name, ref: settlementRef(x, st), data: { disease: def.id, from: source } });
  accident(x, st, 'plague', st.cell);
}

/**
 * Introduce a disease into a settlement (contact, animals, the god, ships): up to n members are exposed (or, without
 * individuals, the cohort). `source` names where it came from for the chronicle ("traders from Bel", "rats").
 */
export function seedDisease(x: PCtx, st: Settlement, d: number, n = 1, source: string | null = null): number {
  const members = x.ps.members.get(st.id) ?? [];
  let k = 0;
  const off = Math.floor(hashFloat(st.id, d, x.tick, 0x5eed) * Math.max(1, members.length));
  for (let i = 0; i < members.length && k < n; i++) {
    const m = members[(i + off) % members.length];
    if (infect(x, m, d)) k++;
  }
  if (k < n && st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2] >= 1) {
    const co = st.cohort;
    if (!co.sick) co.sick = { d, e: 0, i: 0, r: 0 };
    if (co.sick.d === d) {
      const total = co.n[0] + co.n[1] + co.n[2];
      co.sick.e = Math.min(1 - co.sick.i - co.sick.r, co.sick.e + (n - k) / total);
      k = n;
    }
  }
  if (k > 0) beginEpidemic(x, st, d, source);
  return k;
}

/**
 * A traveller (slot s) meets a settlement: an infectious traveller may seed what they carry; a healthy one may catch
 * what rages there. Called by missions on arrival and on return home.
 */
export function contact(x: PCtx, s: number, st: Settlement, from: string): void {
  const A = x.A;
  const d = A.disease[s];
  if (d >= 0) {
    const def = x.c.diseases.list[d];
    if (hashFloat(A.id[s], st.id, x.tick, 0xc0a) < Math.min(0.9, def.contagion * 3)) seedDisease(x, st, d, 1, from);
    return;
  }
  const ep = epidemicOf(st);
  if (ep < 0) return;
  const share = infectiousShare(x, st, ep);
  if (share > 0 && hashFloat(A.id[s], st.id, x.tick, 0xc0b) < Math.min(0.8, share * x.c.diseases.list[ep].contagion * 12)) infect(x, s, ep);
}

/** the share of a settlement (individuals + cohort) infectious with d now */
export function infectiousShare(x: PCtx, st: Settlement, d: number): number {
  const members = x.ps.members.get(st.id) ?? [];
  let inf = 0;
  for (const m of members) if (x.A.disease[m] === d && x.tick >= x.A.infectT[m]) inf++;
  const co = st.cohort;
  const cn = co.n[0] + co.n[1] + co.n[2];
  if (co.sick && co.sick.d === d) inf += co.sick.i * cn;
  const total = members.length + cn;
  return total > 0 ? inf / total : 0;
}

/**
 * Is this settlement's hourly disease step one of its two outbreak rolls of the day? The gate is on the hour: the step
 * runs once an hour per settlement at its own minute, and the old gate on the tick (t % half-day equal to a minute
 * derived from the id) only ever opened for settlements whose id was a multiple of 15.
 */
export function outbreakDue(x: { tick: number; day: number }, st: { id: number }): boolean {
  const halfDay = Math.max(1, Math.round(x.day / 120));
  return (Math.floor(x.tick / 60) + st.id) % halfDay === 0;
}

/** hourly per settlement: incubations end, the sick recover or worsen, the disease spreads, outbreaks arise */
export function diseaseStep(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const co = st.cohort;
  const cn = co.n[0] + co.n[1] + co.n[2];
  const total = members.length + cn;
  if (total <= 0) return;
  let active = co.sick ? co.sick.e + co.sick.i > 1e-4 : false;
  // E -> I, I -> R
  let inf = 0;
  for (const m of members) {
    const d = A.disease[m];
    if (d < 0) continue;
    active = true;
    if (x.tick >= A.sickEnd[m]) {
      A.disease[m] = -1;
      A.flags[m] &= ~AgentFlag.sick;
      if (d < 32 && hashFloat(A.id[m], d, x.tick, 0x1a7) < x.c.diseases.list[d].immunity) A.immune[m] |= 1 << d;
      A.remember(m, MEMK.healed, x.tick, d);
      continue;
    }
    if (x.tick >= A.infectT[m]) {
      if (!(A.flags[m] & AgentFlag.sick)) { A.flags[m] |= AgentFlag.sick; A.remember(m, MEMK.sick, x.tick, d); }
      inf++;
    }
  }
  const ep = epidemicOf(st);
  if (active && ep >= 0) {
    const def = x.c.diseases.list[ep];
    // the force of infection this hour: contacts × contagion × the infectious share (individuals and cohort alike)
    const coI = co.sick && co.sick.d === ep ? co.sick.i * cn : 0;
    const share = (inf + coI) / total;
    const crowd = Math.min(2, Math.max(0.5, total / 40));
    const air = def.transmission === 'air' ? 1.4 : 1;
    const lambda = (MEETS * def.contagion / 24) * air * crowd * share * guard(x, st);
    if (lambda > 0) for (const m of members) if (A.disease[m] < 0 && hashFloat(A.id[m], ep, x.tick, 0x5b8) < lambda) infect(x, m, ep);
    // the cohort's compartments
    if (cn >= 1) cohortSeir(x, st, ep, lambda);
  }
  // an epidemic that has burned out is told with its toll
  if (ep >= 0 && !anyCase(x, st, ep)) {
    const dead = st.recent.epidemicDead ?? 0;
    if (dead >= 2) tell(x.u, x.p, 'plague.end', vars(x, st, -1, { disease: x.c.diseases.list[ep].name.toLowerCase(), count: dead }), st, [settlementRef(x, st)]);
    delete st.recent.epidemic;
    delete st.recent.epidemicSince;
    delete st.recent.epidemicDead;
    if (co.sick && co.sick.e + co.sick.i < 1e-4) co.sick = null;
  }
  // outbreaks: a crowd in the disease's home ground (twice a day, staggered by settlement)
  if (!outbreakDue(x, st)) return;
  const f = x.p.f;
  const biome = x.c.biomes.list[f.biome[st.cell]]?.id ?? '';
  x.c.diseases.list.forEach((def, d) => {
    if (total < def.crowd || epidemicOf(st) >= 0) return;
    let p = 0;
    // (rates per roll, two rolls a day: now that every settlement rolls, a disease's home ground breeds it every month
    // or two rather than every fortnight)
    if (def.origin.includes(biome)) p = 0.012;
    if (def.transmission === 'food' && (st.recent['rotten-grain'] ?? -1e9) > x.tick - x.day) p = Math.max(p, 0.05);
    if (def.transmission === 'water' && f.water[st.cell] > 0.2) p = Math.max(p, 0.02);
    if (def.transmission === 'contact' || def.transmission === 'air') p = Math.max(p, 0.004 * (total / Math.max(1, def.crowd)));
    if (p <= 0 || hashFloat(st.id, d, x.tick, 0x0b7) >= p) return;
    seedDisease(x, st, d, 1, null);
  });
}

function anyCase(x: PCtx, st: Settlement, d: number): boolean {
  for (const m of x.ps.members.get(st.id) ?? []) if (x.A.disease[m] === d) return true;
  const s = st.cohort.sick;
  return !!s && s.d === d && s.e + s.i > 1e-4;
}

/** one hour of SEIR among the cohort (fractions of its members); grave cases die out of the cohort */
function cohortSeir(x: PCtx, st: Settlement, d: number, lambda: number): void {
  const co = st.cohort;
  const def = x.c.diseases.list[d];
  if (!co.sick || co.sick.d !== d) {
    if (lambda <= 0) return;
    co.sick = { d, e: 0, i: 0, r: co.sick?.d === d ? co.sick.r : 0 };
  }
  const s = co.sick;
  const S = Math.max(0, 1 - s.e - s.i - s.r);
  const sigma = 1 / Math.max(1, (def.incubation ?? 1) * 24);
  const gamma = 1 / Math.max(1, def.duration * 24);
  const newE = S * lambda;
  const newI = s.e * sigma;
  const out = s.i * gamma;
  s.e = round(s.e + newE - newI);
  s.i = round(s.i + newI - out);
  // of those leaving sickness, the grave cases die; the rest recover, most of them immune
  const total = co.n[0] + co.n[1] + co.n[2];
  const dead = out * caseFatality(x, d) * relief(x, st) * total;
  s.r = round(Math.min(1, s.r + out * def.immunity));
  if (dead > 0) {
    // children and elders are hit hardest
    const w = [co.n[0] * 1.3, co.n[1], co.n[2] * 1.8];
    const ws = w[0] + w[1] + w[2] || 1;
    for (let k = 0; k < 3; k++) co.n[k] = Math.max(0, round(co.n[k] - (dead * w[k]) / ws));
    st.stats.deaths += dead;
    st.recent.epidemicDead = (st.recent.epidemicDead ?? 0) + dead;
  }
  if (s.e < 1e-5) s.e = 0;
  if (s.i < 1e-5) s.i = 0;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** contagion between neighbouring settlements without travellers (visits, shared wells): a small daily chance */
export function neighbourContagion(x: PCtx, st: Settlement): void {
  const ep = epidemicOf(st);
  if (ep < 0) return;
  const share = infectiousShare(x, st, ep);
  if (share <= 0) return;
  const def = x.c.diseases.list[ep];
  // the settlements it knows and visits (first contact made, within a walk of a day or two)
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band || epidemicOf(o) === ep) continue;
    const dx = o.pos[0] - st.pos[0], dy = o.pos[1] - st.pos[1], dz = o.pos[2] - st.pos[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * x.p.st.radius;
    if (d > st.territory + o.territory + 1000) continue;
    if (hashFloat(st.id, o.id, x.tick, 0x9b1) < Math.min(0.8, share * def.contagion * 4)) seedDisease(x, o, ep, 1, `visitors from ${st.name}`);
  }
}
