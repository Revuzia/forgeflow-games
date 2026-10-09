// GENESIS — society within a settlement (CONTRACT.md §8.5): households, leaders and succession, factions, schisms.
//
//   leaders    the most respected adult leads (age, lore, nerve); from the clay age on, chiefs found DYNASTIES: the
//              eldest grown child of the last leader inherits; the hive's queen rules her hive. A new leader of a
//              sizeable settlement is chronicled with the title of its age (Elder, Chief, First, Speaker).
//   factions   daily, the adults lean: hawks (aggressive) and doves, the devout and the doubters, the seekers of the new
//              (curious) and the elders who keep the old ways; a faction with a real share has a voice. Hawks push for
//              raids and war (war.ts reads them), the devout for temples.
//   schisms    when a large settlement is split down the middle — devout against doubters (a religious split), hawks
//              against doves — the minority's households walk out to found their own place, which soon goes its
//              own way (independence, war.ts).
//   households orphans are taken in by kin or neighbours; empty households dissolve; unpartnered grown-ups pair up
//              (daily, as a settlement's matter: an agent's courtship task alone never won against work, so no couple
//              formed after a band's founding and every people dwindled).

import type { PCtx } from './ctx.ts';
import type { Faction, Household, Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { GODS, MEMK, NEED, NN, NS, NT, SKILL, TRAIT } from './defs.ts';
import { NAME_TITLES } from '../../data/index.ts';
import { tell } from './story.ts';
import { agentRef, settlementRef, vars } from './util.ts';
import { cohortTotal } from './cohorts.ts';
import { insertSorted } from './lifecycle.ts';
import { apprenticeDaily } from './knowledge.ts';

// ───────────────────────────── leaders ─────────────────────────────

/** the title of a leader in a settlement of this era */
export function leaderTitle(st: Settlement): string {
  const t = NAME_TITLES.leader ?? ['Elder', 'Chief', 'First', 'Speaker'];
  const i = st.era <= 1 ? 0 : st.era <= 3 ? 1 : st.era <= 7 ? 2 : 3;
  return (t[Math.min(t.length - 1, i)] ?? 'Elder').toLowerCase();
}

/** choose a leader: the hive's queen; an heir of the dynasty; else the most respected adult */
export function electLeader(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const prev = st.leader;
  const def = x.info[st.species].def;
  let best = -1, bv = -1;
  if (def.hive) {
    for (const m of members) if (def.hive.castes[A.caste[m]] === def.hive.queen) { best = m; break; }
  }
  // a dynasty: the eldest grown child of the last leader
  if (best < 0 && st.era >= 2 && prev) {
    let eldest = -1;
    for (const m of members) {
      if (A.flags[m] & AgentFlag.child || A.mission[m]) continue;
      if (A.mother[m] !== prev && A.father[m] !== prev) continue;
      if (eldest < 0 || A.birth[m] < A.birth[eldest] || (A.birth[m] === A.birth[eldest] && A.id[m] < A.id[eldest])) eldest = m;
    }
    if (eldest >= 0) best = eldest;
  }
  if (best < 0) {
    for (const m of members) {
      if (A.flags[m] & AgentFlag.child) continue;
      const v = (x.tick - A.birth[m]) / x.year * 0.02 + A.skills[m * NS + SKILL.lore] + A.traits[m * NT + TRAIT.boldness] * 0.5 + (A.flags[m] & AgentFlag.master ? 0.2 : 0);
      if (v > bv) { bv = v; best = m; }
    }
  }
  if (best < 0) return;
  for (const m of members) A.flags[m] &= ~AgentFlag.leader;
  A.flags[best] |= AgentFlag.leader;
  if (st.leader === A.id[best]) return;
  st.leader = A.id[best];
  st.leaderSince = x.tick;
  A.remember(best, MEMK.led, x.tick, st.id);
  const pop = members.length + cohortTotal(st);
  if (!st.band && pop >= 15 && prev) {
    const heir = A.mother[best] === prev || A.father[best] === prev;
    tell(x.u, x.p, heir ? 'leader.heir' : 'leader', vars(x, st, best, { title: leaderTitle(st) }), st, [agentRef(x, best), settlementRef(x, st)], 1);
  }
}

// ───────────────────────────── factions ─────────────────────────────

const KINDS = ['hawks', 'doves', 'devout', 'doubters', 'seekers', 'elders'] as const;

/** which way an adult leans on each axis (bit per faction kind) */
function leanings(x: PCtx, st: Settlement, s: number): number {
  const A = x.A;
  const t = s * NT;
  let f = 0;
  const aggr = A.traits[t + TRAIT.aggression];
  if (aggr >= 0.55) f |= 1; else if (aggr <= 0.28) f |= 2;
  const piety = A.traits[t + TRAIT.piety];
  let faith = 0;
  for (let g = 0; g < GODS; g++) faith = Math.max(faith, A.love[s * GODS + g] + A.fear[s * GODS + g]);
  if (piety >= 0.62 && faith >= 0.08) f |= 4; else if (piety <= 0.3 || faith < 0.03) f |= 8;
  if (A.traits[t + TRAIT.curiosity] >= 0.68) f |= 16;
  if (A.flags[s] & AgentFlag.elder || (x.tick - A.birth[s]) / x.year >= x.info[st.species].def.elder * 0.85) f |= 32;
  return f;
}

/** daily: the factions of a settlement and their voices */
export function factionsDaily(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const counts = [0, 0, 0, 0, 0, 0];
  const voice = [-1, -1, -1, -1, -1, -1];
  const strength = [0, 0, 0, 0, 0, 0];
  let adults = 0;
  for (const s of members) {
    if (A.flags[s] & AgentFlag.child) continue;
    adults++;
    const f = leanings(x, st, s);
    for (let k = 0; k < 6; k++) {
      if (!(f & (1 << k))) continue;
      counts[k]++;
      const v = k === 0 ? A.traits[s * NT + TRAIT.aggression] : k === 1 ? 1 - A.traits[s * NT + TRAIT.aggression] : k === 2 ? A.traits[s * NT + TRAIT.piety] : k === 3 ? 1 - A.traits[s * NT + TRAIT.piety] : k === 4 ? A.traits[s * NT + TRAIT.curiosity] : (x.tick - A.birth[s]) / x.year;
      if (v > strength[k] || (v === strength[k] && voice[k] >= 0 && A.id[s] < A.id[voice[k]])) { strength[k] = v; voice[k] = s; }
    }
  }
  const out: Faction[] = [];
  if (adults >= 6) {
    for (let k = 0; k < 6; k++) {
      const share = Math.round((counts[k] / adults) * 1000) / 1000;
      if (share >= 0.12) out.push({ kind: KINDS[k], share, voice: voice[k] >= 0 ? A.id[voice[k]] : 0 });
    }
    out.sort((a, b) => b.share - a.share || (a.kind < b.kind ? -1 : 1));
  }
  st.factions = out;
}

/** the share of a faction kind in a settlement (0 when none) */
export function factionShare(st: Settlement, kind: string): number {
  for (const f of st.factions ?? []) if (f.kind === kind) return f.share;
  return 0;
}

// ───────────────────────────── schisms ─────────────────────────────

/**
 * A large settlement split down the middle may break: the minority faction's households leave to found their own
 * place (settlement.ts splitOff). Returns the households that should leave, with the cause, or null.
 */
export function schismCandidates(x: PCtx, st: Settlement): { leaving: Household[]; cause: string; faction: string } | null {
  if (st.band || st.fallen >= 0) return null;
  const members = x.ps.members.get(st.id) ?? [];
  if (members.length < 30) return null;
  const pairs: [string, string, string][] = [['devout', 'doubters', 'faith'], ['hawks', 'doves', 'war']];
  for (const [a, b, cause] of pairs) {
    const sa = factionShare(st, a), sb = factionShare(st, b);
    if (sa < 0.25 || sb < 0.25) continue;
    const polar = Math.min(sa, sb) * 2;
    if (hashFloat(st.id, x.tick, cause.length, 0x5c15) >= 0.02 * polar) continue;
    const minority = sa < sb ? a : b;
    const bit = 1 << KINDS.indexOf(minority as (typeof KINDS)[number]);
    const leaving = st.households.filter((h) => {
      let lean = 0, n = 0;
      for (const id of h.members) {
        const s = x.A.slotOf(id);
        if (s < 0 || x.A.flags[s] & AgentFlag.child || x.A.mission[s]) continue;
        n++;
        if (leanings(x, st, s) & bit) lean++;
      }
      return n > 0 && lean * 2 >= n && !h.members.includes(st.leader);
    });
    const people = leaving.reduce((acc, h) => acc + h.members.length, 0);
    if (people < 8 || people > members.length * 0.6) continue;
    return { leaving, cause, faction: minority };
  }
  return null;
}

// ───────────────────────────── households ─────────────────────────────

/** orphans are taken in; empty households dissolve */
export function householdsDaily(x: PCtx, st: Settlement): void {
  const A = x.A;
  st.households = st.households.filter((h) => h.members.length > 0);
  for (const h of st.households.slice()) {
    let adults = 0;
    for (const id of h.members) { const s = A.slotOf(id); if (s >= 0 && !(A.flags[s] & AgentFlag.child)) adults++; }
    if (adults > 0) continue;
    // children alone: the smallest household with grown-ups takes them in
    const to = st.households.filter((o) => o !== h && o.members.length > 0).sort((a, b) => a.members.length - b.members.length || a.id - b.id)[0];
    if (!to) continue;
    for (const id of h.members) {
      insertSorted(to.members, id);
      const s = A.slotOf(id);
      if (s >= 0) { A.household[s] = to.id; A.home[s] = to.home >= 0 ? to.home : -1; }
    }
    h.members = [];
  }
  st.households = st.households.filter((h) => h.members.length > 0);
  pairUp(x, st);
  apprenticeDaily(x, st);
}

/**
 * Unpartnered grown-ups pair up: each day a woman without a partner (in id order) may take the best match among the men
 * without one — close in age, not kin — with a chance that grows the longer she has been grown and the fewer children
 * the settlement has (a people that sees few births looks harder). Widows and widowers marry again.
 */
export function pairUp(x: PCtx, st: Settlement): void {
  const A = x.A;
  const def = x.info[st.species].def;
  if (def.hive || st.band) return;
  const members = x.ps.members.get(st.id) ?? [];
  const women: number[] = [], men: number[] = [];
  let kids = 0;
  for (const m of members) {
    const f = A.flags[m];
    if (f & AgentFlag.child) { kids++; continue; }
    if (f & AgentFlag.elder || A.partner[m] || A.mission[m]) continue;
    const age = (x.tick - A.birth[m]) / x.year;
    if (age < def.maturity + 1) continue;
    (f & AgentFlag.female ? women : men).push(m);
  }
  if (!women.length || !men.length) return;
  const fewKids = kids < members.length * 0.25 ? 0.15 : 0;
  const taken = new Set<number>();
  for (const w of women) {
    const grown = (x.tick - A.birth[w]) / x.year - def.maturity - 1;
    const p = 0.12 + 0.1 * Math.min(1, grown / 4) + fewKids + 0.1 * A.traits[w * NT + TRAIT.sociability];
    if (hashFloat(A.id[w], Math.floor(x.tick / x.day), 0xc0f1) >= p) continue;
    const ageW = (x.tick - A.birth[w]) / x.year;
    let best = -1, bv = -Infinity;
    for (const m of men) {
      if (taken.has(m)) continue;
      if (A.mother[w] && A.mother[m] === A.mother[w]) continue; // siblings
      if (A.id[m] === A.mother[w] || A.id[m] === A.father[w] || A.mother[m] === A.id[w] || A.father[m] === A.id[w]) continue;
      const v = -Math.abs((x.tick - A.birth[m]) / x.year - ageW) * 0.15 + A.traits[m * NT + TRAIT.sociability] * 0.5 + hashFloat(A.id[w], A.id[m], 0xc0f2) * 0.4;
      if (v > bv) { bv = v; best = m; }
    }
    if (best < 0) continue;
    taken.add(best);
    formCouple(x, st, w, best);
  }
}

/** two agents become partners and set up a household of their own */
export function formCouple(x: PCtx, st: Settlement, s: number, o: number): void {
  const A = x.A;
  A.partner[s] = A.id[o];
  A.partner[o] = A.id[s];
  A.remember(s, MEMK.partner, x.tick, A.id[o]);
  A.remember(o, MEMK.partner, x.tick, A.id[s]);
  for (const sl of [s, o]) {
    const old = st.households.find((h) => h.id === A.household[sl]);
    if (old) { const i = old.members.indexOf(A.id[sl]); if (i >= 0) old.members.splice(i, 1); }
  }
  st.households = st.households.filter((h) => h.members.length > 0);
  const hh = { id: x.u.ids.alloc('household'), members: [] as number[], home: -1 };
  insertSorted(hh.members, A.id[s]);
  insertSorted(hh.members, A.id[o]);
  st.households.push(hh);
  A.household[s] = hh.id;
  A.household[o] = hh.id;
  A.home[s] = -1;
  A.home[o] = -1;
  A.needs[s * NN + NEED.belonging] = 1;
  A.needs[o * NN + NEED.belonging] = 1;
}

export { MEMK };
