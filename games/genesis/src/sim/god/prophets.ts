// GENESIS — prophets (LIVING.md §3.4.1–3.4.3, §3.4.6): the god's lever of influence, in place of the creature.
//
// A prophet is an ordinary grown person who speaks for the god. The god CALLS one (`prophet.call { agent }`: one per
// settlement, six per world; credibility 0.30, or 0.45 when the call comes with a sign that ten people saw), or a pious
// person RISES on their own after witnessing a wonder close by (god/omens.ts: credibility 0.15 — the god's next act
// decides: a sign near them within 2 days confirms, +0.2; an act against them discredits them). The god may ABANDON one
// (`prophet.abandon`: credibility × 0.3, "the god turned from Hesh"; below 0.1 nobody listens).
//
// What a prophet does, by day, around their own needs (god/relationship.ts decides it): PREACHES (listeners' faith grows
// by the prophet's credibility; preaching yields worship × (1 + credibility)), reads every omen to the town within a day
// (god/omens.ts), FORETELLS, founds a shrine at a sacred place (credibility ≥ 0.5, none within 1 km: god/sacred.ts),
// leads pilgrimages, and CARRIES THE FAITH (credibility ≥ 0.6) to the nearest town of their people with less faith in
// the god, staying 2–5 days to preach there.
//
// PROPHECY: `{ kind, settlement, from, until }` (window 1–5 days) from the god — `prophet.foretell { agent, what, days }`,
// the god commits itself — or from the prophet: while a prayer is open they foretell its answer (p = 0.5 × credibility);
// after an omen they foretell its meaning. FULFILLED when the god does a matching act there inside the window (harm: a
// harmful act; sign: any omen): credibility + 0.25 × (1 − credibility) (0.30 → 0.48 → 0.61 → 0.71), the town faith
// +0.15, trust +0.10, loyalty +0.10. FAILED when the window closes: credibility −0.25, faith −0.05, trust −0.08,
// loyalty −0.05. This is the player's lever: say it through someone, then make it true.
//
// PERSECUTION: a ruler persecutes the prophet when their own loyalty to the god is below 0.3 and the prophet's
// credibility above 0.4 (a rival authority), or when the town fears more than it trusts (by 0.3) and the prophet
// foretold a harm that came (blame) — daily p 0.12–0.24 while it holds, escalating: silenced (no preaching for 3 days)
// → exiled (walks to another town) → killed (the ruler's aggression > 0.7 and the town's fear > 0.7). The god's answer
// matters: a ward over the prophet, or an act against the ruler, within 2 days → "the god defends its prophet" (loyalty
// +0.15, fear +0.1); silence → credibility −0.2. A martyr with credibility ≥ 0.6 makes their place a pilgrimage site.

import type { CommandRegistry } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { Prophecy, ProphetState } from './state.ts';
import type { ActInfo } from './prayers.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, GODS, MEMK, NT, TASK, TRAIT } from '../people/defs.ts';
import { interrupt } from '../people/people.ts';
import { die } from '../people/lifecycle.ts';
import { statusGain } from '../people/outlets.ts';
import { tell } from '../people/story.ts';
import { agentName, agentRef, settlementRef, vars } from '../people/util.ts';
import { distM, spotInCell } from '../people/world.ts';
import { fail, ok } from './util.ts';
import { meansNow, moveSettlement, relOf, relStat, rise, srel } from './regard.ts';
import { actReaches, PRAYER_WORDS } from './prayers.ts';
import { addSacredPlace, foundShrine, sacredNear } from './sacred.ts';

/** prophets a world may have at once */
export const MAX_PROPHETS = 6;
export const PROPHECY_KINDS = ['rain', 'food', 'healing', 'warmth', 'protection', 'rebuilding', 'harm', 'sign'] as const;

const WORDS: Record<string, string> = { ...PRAYER_WORDS, harm: 'the god\'s anger', sign: 'a sign', rebuilding: 'help to rebuild' };
const _p = [0, 0, 0];
const _q = [0, 0, 0];

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ───────────────────────────── lookups ─────────────────────────────

export function prophetOf(u: Universe, planet: number, agent: number): ProphetState | undefined {
  return u.god.rel?.prophets.find((q) => q.planet === planet && q.agent === agent);
}

export function prophetOfSettlement(u: Universe, planet: number, sid: number): ProphetState | undefined {
  return u.god.rel?.prophets.find((q) => q.planet === planet && q.settlement === sid);
}

/** is the prophet listened to at all (credibility ≥ 0.1, not silenced) */
export function heard(u: Universe, ph: ProphetState): boolean {
  return ph.credibility >= 0.1 && ph.silenced <= u.tick;
}

function grownYears(x: PCtx, s: number): number {
  return (x.tick - x.A.birth[s]) / x.year;
}

// ───────────────────────────── calling, rising, abandoning ─────────────────────────────

/** make agent slot s a prophet (the god's call, or risen on their own); null when refused, with the reason */
export function makeProphet(x: PCtx, s: number, how: 'called' | 'risen', credibility: number): ProphetState | string {
  const u = x.u, A = x.A;
  const R = relOf(u);
  const st = x.ps.settlement(A.settlement[s]);
  if (!st || st.fallen >= 0) return `${agentName(x, s)} belongs to no settlement to speak to.`;
  const id = A.id[s];
  if (prophetOf(u, x.p.id, id)) return `${agentName(x, s)} is already your prophet.`;
  const other = prophetOfSettlement(u, x.p.id, st.id);
  if (other) {
    const os = A.slotOf(other.agent);
    return `${st.name} already has a prophet: ${os >= 0 ? agentName(x, os) : 'another'}. One voice to a town — abandon them first.`;
  }
  if (R.prophets.filter((q) => q.planet === x.p.id).length >= MAX_PROPHETS) return `There are already ${MAX_PROPHETS} prophets on ${x.p.name}.`;
  const ph: ProphetState = {
    agent: id, planet: x.p.id, settlement: st.id, credibility: r3(credibility), since: x.tick, how, confirmed: how === 'called',
    fulfilled: 0, failed: 0, silenced: 0, persecution: 0, persecutedAt: -1, abandoned: false, journey: null, shrine: -1, readAt: -1,
    name: agentName(x, s),
  };
  R.prophets.push(ph);
  // the prophet believes, and follows
  const i = s * GODS;
  A.faith[i] = Math.max(A.faith[i], how === 'called' ? 1 : 0.8);
  A.loyalty[i] = Math.max(A.loyalty[i], how === 'called' ? 0.9 : 0.6);
  A.flags[s] |= AgentFlag.sees_god;
  A.remember(s, MEMK.disciple, x.tick, 0);
  relStat(u, how === 'called' ? 'prophets.called' : 'prophets.risen');
  u.emit({ t: 'prophet.called', planet: x.p.id, pos: posOf(x, s), ref: agentRef(x, s), data: { agent: id, settlement: st.id, credibility: ph.credibility, how } });
  return ph;
}

function posOf(x: PCtx, s: number): [number, number, number] {
  x.A.posAt(s, x.tick, _p);
  return [_p[0], _p[1], _p[2]];
}

/** a sign seen by at least 10 people near the agent in the last 2 hours: the call comes with it */
function signedCall(u: Universe, p: Planet, pos: ArrayLike<number>): boolean {
  for (const o of u.god.rel?.omens ?? []) {
    if (o.planet !== p.id || u.tick - o.tick > 120) continue;
    if (distM(p, o.pos, pos) > 300) continue;
    if (o.seen >= 10) return true;
  }
  return false;
}

// ───────────────────────────── prophecies ─────────────────────────────

/** a prophecy spoken: the god's (it commits itself) or the prophet's own reading */
export function foretell(x: PCtx, ph: ProphetState, kind: string, days: number, by: 'god' | 'prophet'): Prophecy {
  const u = x.u;
  const R = relOf(u);
  const d = Math.max(1, Math.min(5, days));
  const pr: Prophecy = { id: R.next++, kind, planet: ph.planet, settlement: ph.settlement, agent: ph.agent, from: x.tick, until: x.tick + Math.round(d * x.day), by };
  R.prophecies.push(pr);
  relStat(u, 'prophecies');
  const s = x.A.slotOf(ph.agent);
  const st = x.ps.settlement(ph.settlement);
  if (st && s >= 0) {
    const what = WORDS[kind] ?? kind;
    tell(u, x.p, 'prophet.foretold', vars(x, st, s, { what, What: what.charAt(0).toUpperCase() + what.slice(1), days: d }), st, [agentRef(x, s), settlementRef(x, st)], 1);
  }
  u.emit({ t: 'prophet.foretold', planet: x.p.id, pos: st ? [st.pos[0], st.pos[1], st.pos[2]] : undefined, data: { prophecy: pr.id, agent: ph.agent, settlement: ph.settlement, kind, until: pr.until, by } });
  return pr;
}

/** the god's acts fulfil the prophecies they match (and confirm, discredit or defend prophets): god/relationship.ts */
export function prophetsAct(u: Universe, p: Planet, acts: ActInfo[]): void {
  const R = u.god.rel;
  if (!R || !acts.length || !p.people) return;
  const x = makeCtx(u, p);
  // prophecies fulfilled
  for (const pr of R.prophecies.slice()) {
    if (pr.planet !== p.id || pr.until < u.tick || pr.from > u.tick) continue;
    const st = x.ps.settlement(pr.settlement);
    if (!st || st.fallen >= 0) continue;
    const hit = acts.find((a) => a.god === 0 && (a.kind === pr.kind || (pr.kind === 'sign' && a.kind === 'sign')) && actReaches(p, st, a));
    if (hit) fulfilled(x, pr, st);
  }
  for (const ph of R.prophets) {
    if (ph.planet !== p.id) continue;
    const s = x.A.slotOf(ph.agent);
    if (s < 0) continue;
    x.A.posAt(s, u.tick, _p);
    for (const a of acts) {
      if (a.god !== 0 || !a.pos) continue;
      const near = distM(p, a.pos, _p) <= Math.max(60, Math.min(a.radius, 400));
      // a risen prophet waits on the god's next act: a sign near them confirms, an act against them discredits
      if (ph.how === 'risen' && !ph.confirmed && u.tick - ph.since <= 2 * x.day && near) {
        const st = x.ps.settlement(ph.settlement);
        if (a.kind === 'sign' || a.kind === 'protection') {
          ph.confirmed = true;
          ph.credibility = r3(Math.min(1, ph.credibility + 0.2));
          if (st) tell(u, p, 'prophet.confirmed', vars(x, st, s), st, [agentRef(x, s)], 2);
        } else if (a.kind === 'harm') {
          ph.confirmed = true;
          ph.credibility = r3(ph.credibility * 0.3);
          if (st) tell(u, p, 'prophet.discredited', vars(x, st, s), st, [agentRef(x, s)], 1);
        }
      }
      // the god defends its prophet: a ward over them, or a blow at the ruler, within 2 days of a persecution
      if (ph.persecutedAt >= 0 && u.tick - ph.persecutedAt <= 2 * x.day && !ph.defended) {
        const st = x.ps.settlement(ph.settlement);
        const ruler = st ? x.A.slotOf(st.leader) : -1;
        let atRuler = false;
        if (ruler >= 0 && a.kind === 'harm') { x.A.posAt(ruler, u.tick, _q); atRuler = distM(p, a.pos, _q) <= Math.max(40, Math.min(a.radius, 300)); }
        if ((a.kind === 'protection' && near) || atRuler) defend(x, ph, st);
      }
    }
  }
}

function fulfilled(x: PCtx, pr: Prophecy, st: Settlement): void {
  const u = x.u;
  const R = relOf(u);
  R.prophecies = R.prophecies.filter((q) => q !== pr);
  const ph = prophetOf(u, pr.planet, pr.agent);
  const s = x.A.slotOf(pr.agent);
  if (ph) {
    ph.credibility = r3(ph.credibility + 0.25 * (1 - ph.credibility));
    ph.fulfilled++;
    if (pr.kind === 'harm') ph.harmCame = x.tick;
    // (LIVING §2.9: a fulfilled prophecy is the prophet's standing — LAND's outlet, wired at integration 2026-10-20)
    if (s >= 0) statusGain(x, s, 0.3);
  }
  relStat(u, 'prophecies.fulfilled');
  moveSettlement(x, st, { faith: 0.15, trust: 0.1, loyalty: 0.1 });
  for (const m of x.ps.members.get(st.id) ?? []) x.A.remember(m, MEMK.prophecy, x.tick, pr.agent);
  const what = WORDS[pr.kind] ?? pr.kind;
  if (s >= 0) tell(u, x.p, 'prophet.fulfilled', vars(x, st, s, { what }), st, [agentRef(x, s), settlementRef(x, st)], 2);
  u.emit({ t: 'prophet.fulfilled', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], data: { prophecy: pr.id, agent: pr.agent, settlement: st.id, kind: pr.kind, credibility: ph?.credibility ?? 0 } });
}

function failed(x: PCtx, pr: Prophecy): void {
  const u = x.u;
  const R = relOf(u);
  R.prophecies = R.prophecies.filter((q) => q !== pr);
  const ph = prophetOf(u, pr.planet, pr.agent);
  if (ph) { ph.credibility = r3(Math.max(0, ph.credibility - 0.25)); ph.failed++; }
  relStat(u, 'prophecies.failed');
  const st = x.ps.settlement(pr.settlement);
  if (!st || st.fallen >= 0) return;
  moveSettlement(x, st, { faith: -0.05, trust: -0.08, loyalty: -0.05 });
  const s = x.A.slotOf(pr.agent);
  if (s >= 0) tell(u, x.p, 'prophet.failed', vars(x, st, s, { what: WORDS[pr.kind] ?? pr.kind }), st, [agentRef(x, s), settlementRef(x, st)], 1);
  if (ph && ph.credibility < 0.1 && s >= 0) tell(u, x.p, 'prophet.ignored', vars(x, st, s), st, [agentRef(x, s)], 1);
  u.emit({ t: 'prophet.failed', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], data: { prophecy: pr.id, agent: pr.agent, settlement: st.id, kind: pr.kind, credibility: ph?.credibility ?? 0 } });
}

function defend(x: PCtx, ph: ProphetState, st: Settlement | undefined): void {
  ph.defended = true;
  ph.persecution = 0;
  ph.silenced = 0;
  relStat(x.u, 'prophets.defended');
  if (!st) return;
  moveSettlement(x, st, { loyalty: 0.15, fear: 0.1 });
  const r = x.A.slotOf(st.leader);
  tell(x.u, x.p, 'prophet.defended', vars(x, st, -1, { ruler: r >= 0 ? agentName(x, r) : 'its ruler' }), st, [settlementRef(x, st)], 2);
}

// ───────────────────────────── the prophet's hour and day ─────────────────────────────

/**
 * Hourly per world: prophecies whose window closed fail; a dead prophet is mourned (and a successor may rise from the
 * Called); preaching works on those who hear it; a prophet with an open prayer before them foretells its answer.
 */
export function prophetsHourly(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R || !p.people) return;
  if (!R.prophets.some((q) => q.planet === p.id) && !R.prophecies.some((q) => q.planet === p.id)) return;
  const x = makeCtx(u, p);
  const A = x.A;
  for (const pr of R.prophecies.slice()) if (pr.planet === p.id && pr.until < u.tick) failed(x, pr);
  for (const ph of R.prophets.slice()) {
    if (ph.planet !== p.id) continue;
    const s = A.slotOf(ph.agent);
    if (s < 0) { died(x, ph); continue; }
    // carrying the faith: back home when the stay is over
    if (ph.journey && ph.journey.until <= u.tick) ph.journey = null;
    // preaching: those within earshot grow in faith by the prophet's credibility
    if (A.task[s] === TASK.preach && heard(u, ph)) preachHour(x, ph, s);
    // an open prayer before them: they foretell its answer (once a prayer, p = 0.5 × credibility)
    const r = srel(u, p.id, ph.settlement);
    for (const pr of r.prayers) {
      const key = `f:${pr.id}`;
      if (r.since[key] !== undefined || !heard(u, ph)) continue;
      r.since[key] = u.tick;
      if (hashFloat(ph.agent, pr.id, 0xf07e) < 0.5 * ph.credibility) foretell(x, ph, pr.kind, Math.max(1, Math.round((pr.until - u.tick) / x.day)), 'prophet');
    }
    for (const k of Object.keys(r.since)) if (k.startsWith('f:') && !r.prayers.some((q) => `f:${q.id}` === k)) delete r.since[k];
  }
}

/** one hour of a prophet's preaching: faith (and a little trust and loyalty) by credibility, rivals' hold loosens */
function preachHour(x: PCtx, ph: ProphetState, s: number): void {
  const A = x.A;
  A.posAt(s, x.tick, _p);
  const c = ph.credibility;
  let heardBy = 0, effect = 0;
  for (let o = 0; o < A.hi; o++) {
    if (!A.alive[o] || o === s) continue;
    A.posAt(o, x.tick, _q);
    if (distM(x.p, _p, _q) > 70) continue;
    const i = o * GODS;
    // converts by credibility against their loyalty to other gods
    let other = 0;
    for (let g = 1; g < GODS; g++) other = Math.max(other, A.loyalty[i + g]);
    const k = c * (1 - 0.7 * other);
    // (faith and trust taper near the top: god/regard.ts rise — no pinned meter, LIVING §3.8)
    A.faith[i] = rise(A.faith[i], 0.04 * k);
    A.love[i] = rise(A.love[i], 0.008 * k);
    A.loyalty[i] = Math.min(1, A.loyalty[i] + 0.012 * k);
    for (let g = 1; g < GODS; g++) { A.loyalty[i + g] *= 1 - 0.02 * c; A.faith[i + g] *= 1 - 0.01 * c; }
    A.flags[o] |= AgentFlag.sees_god;
    heardBy++;
    effect += k;
  }
  relStat(x.u, 'prophet.heard', heardBy);
  relStat(x.u, 'prophet.effect', Math.round(effect * 1000) / 1000);
}

/** a prophet is dead: the chronicle; a martyr's place made sacred; a successor from the Called */
function died(x: PCtx, ph: ProphetState): void {
  const u = x.u;
  const R = relOf(u);
  R.prophets = R.prophets.filter((q) => q !== ph);
  R.prophecies = R.prophecies.filter((q) => !(q.planet === ph.planet && q.agent === ph.agent));
  const st = x.ps.settlement(ph.settlement);
  if (!st || st.fallen >= 0) return;
  u.chronicleAdd(x.p, 'god', `The prophet ${ph.name ? `${ph.name} ` : ''}of ${st.name} is dead.`, 2, [settlementRef(x, st)]);
  u.emit({ t: 'prophet.died', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], data: { agent: ph.agent, settlement: st.id } });
  // one of the Called takes up the word
  const called = u.god.disciples.filter((d) => d.planet === x.p.id && d.god === 0).map((d) => x.A.slotOf(d.agent)).filter((q) => q >= 0 && x.A.settlement[q] === st.id);
  if (called.length && ph.credibility >= 0.3) {
    const s = called[0];
    const nw = makeProphet(x, s, 'called', ph.credibility * 0.5);
    if (typeof nw !== 'string') tell(u, x.p, 'prophet.successor', vars(x, st, s), st, [agentRef(x, s)], 2);
  }
}

/**
 * Daily per world: persecution (the ruler against the prophet; the god's silence costs credibility), carrying the faith
 * to a town with less of it, founding a shrine at a sacred place, revolt against the Called where fear rules.
 */
export function prophetsDaily(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R || !p.people) return;
  const x = makeCtx(u, p);
  for (const ph of R.prophets.slice()) {
    if (ph.planet !== p.id) continue;
    const s = x.A.slotOf(ph.agent);
    const st = x.ps.settlement(ph.settlement);
    if (s < 0 || !st || st.fallen >= 0) continue;
    // the god's silence while its prophet suffered
    if (ph.persecutedAt >= 0 && u.tick - ph.persecutedAt > 2 * x.day && !ph.defended && !ph.unheard) {
      ph.unheard = true;
      ph.credibility = r3(Math.max(0, ph.credibility - 0.2));
      tell(u, p, 'prophet.unheard', vars(x, st, s), st, [agentRef(x, s)], 1);
    }
    persecute(x, ph, s, st);
    if (!x.A.alive[s] || prophetOf(u, p.id, ph.agent) !== ph) continue;
    // a shrine at a sacred place (credibility ≥ 0.5, none within 1 km)
    if (ph.credibility >= 0.5 && ph.shrine < 0 && heard(u, ph)) {
      const place = sacredNear(u, p, st.pos, 2000) ?? addSacredPlace(u, p, st, null, 'prophet');
      if (place && !x.ps.buildings.some((b) => !(b.flags & 2) && x.c.buildings.list[b.type].id === 'shrine' && distM(p, b.pos, place.pos) < 1000)) {
        const b = foundShrine(x, st, place);
        if (b) {
          ph.shrine = b.id;
          tell(u, p, 'prophet.shrine', vars(x, st, s, { place: place.kind === 'site' ? 'holy place' : place.kind }), st, [agentRef(x, s)], 2);
        }
      } else if (place) ph.shrine = 0;
    }
    // carrying the faith (credibility ≥ 0.6): the nearest town of their people with less faith, 2–5 days
    if (!ph.journey && ph.credibility >= 0.6 && heard(u, ph) && hashFloat(ph.agent, u.tick, 0x70a7) < 0.3) {
      const home = meansNow(x, st).faith;
      let best: Settlement | null = null, bd = 5000;
      for (const o of x.ps.settlements) {
        if (o.id === st.id || o.fallen >= 0 || o.band || o.species !== st.species) continue;
        const d = distM(p, o.pos, st.pos);
        if (d >= bd || meansNow(x, o).faith > home - 0.1) continue;
        bd = d; best = o;
      }
      if (best) {
        ph.journey = { target: best.id, until: u.tick + Math.round((2 + 3 * hashFloat(ph.agent, u.tick, 0x70a8)) * x.day) };
        tell(u, p, 'prophet.journey', vars(x, st, s, { other: best.name }), st, [agentRef(x, s), settlementRef(x, best)], 1);
        interrupt(x, s);
      }
    }
  }
}

/** the ruler against the prophet (LIVING §3.4.6) */
function persecute(x: PCtx, ph: ProphetState, s: number, st: Settlement): void {
  const u = x.u, A = x.A;
  const ruler = A.slotOf(st.leader);
  if (ruler < 0 || ruler === s) return;
  const m = meansNow(x, st);
  const rival = A.loyalty[ruler * GODS] < 0.3 && ph.credibility > 0.4;
  const came = ph.harmCame;
  const blame = m.fear > m.trust + 0.3 && came !== undefined && u.tick - came < 5 * x.day;
  if (!rival && !blame) return;
  const aggr = A.traits[ruler * NT + TRAIT.aggression];
  if (hashFloat(ph.agent, u.tick, 0x9e75) >= 0.12 + 0.12 * aggr) return;
  const rulerName = agentName(x, ruler);
  const v = vars(x, st, s, { ruler: rulerName });
  const stage = ph.persecution + 1;
  ph.persecutedAt = u.tick;
  ph.defended = false;
  ph.unheard = false;
  relStat(u, 'prophets.persecuted');
  u.emit({ t: 'prophet.persecuted', planet: x.p.id, pos: posOf(x, s), ref: agentRef(x, s), data: { agent: ph.agent, settlement: st.id, ruler: st.leader, stage: Math.min(3, stage) } });
  // attacking the god's prophet is a provocation: the god's harm in the next days is read as earned
  srel(u, x.p.id, st.id).since.provoked = u.tick;
  if (stage >= 3 && aggr > 0.7 && m.fear > 0.7) {
    ph.persecution = 3;
    tell(u, x.p, 'prophet.killed', v, st, [agentRef(x, s), settlementRef(x, st)], 3);
    martyr(x, ph, s, st);
    die(x, s, DEATH.punished);
    return;
  }
  if (stage >= 2) {
    ph.persecution = 2;
    const to = x.ps.settlements.filter((o) => o.id !== st.id && o.fallen < 0 && !o.band && o.species === st.species).sort((a, b) => distM(x.p, a.pos, st.pos) - distM(x.p, b.pos, st.pos) || a.id - b.id)[0];
    tell(u, x.p, 'prophet.exiled', v, st, [agentRef(x, s), settlementRef(x, st)], 2);
    if (to) { exile(x, s, st, to); ph.settlement = to.id; ph.persecution = 0; }
    else ph.silenced = u.tick + 3 * x.day;
    return;
  }
  ph.persecution = 1;
  ph.silenced = u.tick + 3 * x.day;
  A.remember(s, MEMK.silenced, u.tick, st.leader);
  tell(u, x.p, 'prophet.silenced', v, st, [agentRef(x, s), settlementRef(x, st)], 2);
  interrupt(x, s);
}

/** move a person to another settlement (exile): their household loses them, the new town takes them in */
export function exile(x: PCtx, s: number, from: Settlement, to: Settlement): void {
  const A = x.A;
  const id = A.id[s];
  x.ps.removeMember(from.id, s);
  for (const h of from.households) h.members = h.members.filter((m) => m !== id);
  from.households = from.households.filter((h) => h.members.length > 0);
  A.settlement[s] = to.id;
  A.home[s] = -1;
  x.ps.addMember(to.id, s);
  const hid = x.u.ids.alloc('household');
  to.households.push({ id: hid, members: [id], home: -1 });
  A.household[s] = hid;
  A.remember(s, MEMK.exiled, x.tick, from.id);
  interrupt(x, s);
}

/** a martyr's place becomes a pilgrimage site; the towns that knew them believe more */
function martyr(x: PCtx, ph: ProphetState, s: number, st: Settlement): void {
  if (ph.credibility < 0.6) return;
  const u = x.u;
  const pos = posOf(x, s);
  addSacredPlace(u, x.p, st, pos, 'martyr');
  tell(u, x.p, 'prophet.martyr', vars(x, st, s), st, [agentRef(x, s), settlementRef(x, st)], 3);
  for (const o of x.ps.settlements) {
    if (o.fallen >= 0 || (o.id !== st.id && !st.contacts.includes(o.id))) continue;
    moveSettlement(x, o, { faith: 0.1 });
  }
}

// ───────────────────────────── what a prophet does (god/relationship.ts asks) ─────────────────────────────

/**
 * A prophet's own task this turn (null: their own life): preaching by day around their needs, at home or in the town
 * they carry the faith to. `pressing` is the decision's most pressing bodily need.
 */
export function prophetTask(x: PCtx, s: number, st: Settlement | undefined, night: boolean, pressing: number): TaskSpec | null {
  const u = x.u;
  const ph = prophetOf(u, x.p.id, x.A.id[s]);
  if (!ph || night || pressing >= 1.2 || !heard(u, ph)) return null;
  // around their own needs: half the turns
  if (hashFloat(x.A.id[s], x.tick, 0x9a0c) < 0.5) return null;
  const target = ph.journey ? x.ps.settlement(ph.journey.target) : st;
  if (!target || target.fallen >= 0) return null;
  const t = x.ps.of(target.id).find((b) => b.progress >= 1 && b.damage < 0.9 && x.c.buildings.list[b.type].function === 'temple');
  const at = t ? t.cell : target.cell;
  return { kind: TASK.preach, goal: spotInCell(x.p, at, x.A.id[s], 0x9a0d, [0, 0, 0]), goalCell: at, work: 90, target: t?.id ?? -1, data: target.id };
}

// ───────────────────────────── commands ─────────────────────────────

export function registerProphetCommands(r: CommandRegistry): void {
  r.register('prophet.call', ({ u, p }, a) => {
    if (!p.people) return fail('There are no people on this world to speak to.');
    const x = makeCtx(u, p);
    const s = x.A.slotOf(a.agent as number);
    if (s < 0) return fail('That person is not alive.');
    if (x.A.flags[s] & AgentFlag.child || grownYears(x, s) < 16) return fail(`${agentName(x, s)} is too young to speak for you: choose a grown person.`);
    x.A.posAt(s, u.tick, _p);
    const cred = signedCall(u, p, _p) ? 0.45 : 0.3;
    const ph = makeProphet(x, s, 'called', cred);
    if (typeof ph === 'string') return fail(ph);
    const st = x.ps.settlement(ph.settlement)!;
    tell(u, p, 'prophet.called', vars(x, st, s), st, [agentRef(x, s), settlementRef(x, st)], 2);
    interrupt(x, s);
    return ok(`${agentName(x, s)} of ${st.name} is your prophet now (credibility ${Math.round(cred * 100)}%${cred > 0.3 ? ': the call came with a sign' : ''}). Speak through them — "tell ${st.name} through ${agentName(x, s)} that rain will come in two days" — then make it true.`, [agentRef(x, s)]);
  }, { desc: 'Make a grown person your prophet', category: 'Signs', params: { agent: { type: 'int', required: true, min: 1, desc: 'agent id' } } });

  r.register('prophet.abandon', ({ u, p }, a) => {
    if (!p.people) return fail('There is no prophet here.');
    const x = makeCtx(u, p);
    const ph = prophetOf(u, p.id, a.agent as number);
    if (!ph) return fail('That person is not your prophet.');
    const s = x.A.slotOf(ph.agent);
    ph.credibility = r3(ph.credibility * 0.3);
    ph.abandoned = true;
    const R = relOf(u);
    R.prophecies = R.prophecies.filter((q) => !(q.planet === p.id && q.agent === ph.agent));
    const st = x.ps.settlement(ph.settlement);
    if (st && s >= 0) tell(u, p, 'prophet.abandoned', vars(x, st, s), st, [agentRef(x, s), settlementRef(x, st)], 2);
    // where fear rules, a prophet the god has left is driven out
    if (st && s >= 0 && ph.credibility < 0.1) {
      const m = meansNow(x, st);
      if (m.fear > m.trust) {
        const to = x.ps.settlements.filter((o) => o.id !== st.id && o.fallen < 0 && !o.band && o.species === st.species).sort((q, w) => distM(p, q.pos, st.pos) - distM(p, w.pos, st.pos) || q.id - w.id)[0];
        if (to) exile(x, s, st, to);
      }
    }
    R.prophets = R.prophets.filter((q) => q !== ph);
    u.emit({ t: 'prophet.abandoned', planet: p.id, data: { agent: ph.agent, settlement: ph.settlement } });
    return ok(`You turn from ${s >= 0 ? agentName(x, s) : 'your prophet'}; ${st?.name ?? 'the town'} hears that the god has left them.`);
  }, { desc: 'Abandon a prophet', category: 'Signs', params: { agent: { type: 'int', required: true, min: 1, desc: 'agent id' } } });

  r.register('prophet.foretell', ({ u, p }, a) => {
    if (!p.people) return fail('There is no prophet here.');
    const x = makeCtx(u, p);
    const ph = prophetOf(u, p.id, a.agent as number);
    const s = x.A.slotOf(a.agent as number);
    if (!ph) return fail(`${s >= 0 ? agentName(x, s) : 'That person'} is not your prophet. Make them one first ("make ${s >= 0 ? agentName(x, s) : 'Hesh'} my prophet").`);
    if (s < 0) return fail('Your prophet is dead.');
    if (ph.silenced > u.tick) return fail(`${agentName(x, s)} has been silenced by the ruler of ${x.ps.settlement(ph.settlement)?.name ?? 'the town'} — defend them, or wait.`);
    const kind = String(a.what);
    const days = Number(a.days ?? 2);
    const pr = foretell(x, ph, kind, days, 'god');
    const st = x.ps.settlement(ph.settlement);
    return ok(`${agentName(x, s)} tells ${st?.name ?? 'the town'}: ${WORDS[kind] ?? kind} within ${Math.round((pr.until - pr.from) / x.day * 10) / 10} days. Now make it true.`);
  }, {
    desc: 'Speak through your prophet: foretell an act, then make it true', category: 'Signs',
    params: { agent: { type: 'int', required: true, min: 1, desc: 'agent id' }, what: { type: 'enum', values: [...PROPHECY_KINDS], required: true }, days: { type: 'number', min: 1, max: 5, default: 2 } },
  });
}

// ───────────────────────────── queries ─────────────────────────────

/** query 'prophets': every prophet with its open prophecies */
export function prophetsQuery(u: Universe): Record<string, unknown>[] {
  const R = u.god.rel;
  if (!R) return [];
  return R.prophets.map((ph) => {
    const p = u.planet(ph.planet);
    const x = p?.people ? makeCtx(u, p) : null;
    const s = x ? x.A.slotOf(ph.agent) : -1;
    return {
      ...ph, name: x && s >= 0 ? agentName(x, s) : '', settlementName: x?.ps.settlement(ph.settlement)?.name ?? '',
      prophecies: R.prophecies.filter((q) => q.planet === ph.planet && q.agent === ph.agent),
      listened: ph.credibility >= 0.1, silencedUntil: ph.silenced > u.tick ? ph.silenced : 0,
    };
  });
}
