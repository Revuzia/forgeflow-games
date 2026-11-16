// GENESIS — reach (_spec/POWERS-GROWTH.md v3): the god grows as belief grows, by two roads, and spends what the people
// gather. Everything here runs ONLY in a bound world (`'reach.bound' in god.laws`, GodState.bound); an unbound world
// (every old save, the sandbox setting) never enters this module's writers and keeps no reach state.
//
//   measure   once a game day (1 440 ticks): the grown, living people of towns the god has been SEEN in who believe
//             (faith >= 0.30) are believers. A believer who trusts (trust >= 0.50) is on the road of trust, one who fears
//             (fear >= 0.35, kept down to 0.04) on the road of fear; a person may be on both. Each believer counts 1,
//             plus 1 if on either road (both roads still 1: a mixed god is neither weaker nor stronger). F = the sum.
//   standing  Unknown, Whispered, Known, Worshipped, Most High. It rises one step when F (or the share S) has been at the
//             next line for that line's hold (a larger Following holds up to twice as fast), and falls one step after
//             `grace` days in a row under 0.7 x its own line.
//   worship   the existing pool (ps.worship[0]). Every writer pays through credit(): no more than the town's daily
//             measure, no more than the cap. NO income without believers (owner 2026-11-16, second ruling).
//   charge    every power that is not on the free list costs its `price` (powers.json) x size; a power one band up costs
//             3 x; further up is refused. Checked before the handler, taken only after it succeeds (god/powers.ts).
//
// Deterministic: whole-number counting in planet id / agent index / settlement id order, pool arithmetic in hundredths,
// no RNG, no clock but u.tick.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { PowerDef } from '../content.ts';
import type { ReachState } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS, NT, TRAIT } from '../people/defs.ts';
import { tell } from '../people/story.ts';
import { ARC } from './arc.ts';
import { nearestSettlement } from './util.ts';
import { wrathLaw } from './wrath.ts';

export const REACH = {
  names: ['Unknown', 'Whispered', 'Known', 'Worshipped', 'Most High'],
  /** the believer line (the float32 tolerance defiance.ts uses) */
  believe: 0.30 - 1e-4,
  trustLine: 0.50, trustKeep: 0.50,
  fearLine: 0.35, fearKeep: 0.04,
  /** F a standing needs; or the share S with at least shareF following */
  f: [0, 3, 30, 150, 500],
  share: [0, 0, 0.5, 0.7, 0.85],
  shareF: [0, 0, 12, 60, 200],
  /** game days the line must have held (a Following up to twice the line holds up to twice as fast) */
  hold: [0, 1, 30, 150, 360],
  /** a day under the line takes this many held days back */
  slip: 2,
  fallAt: 0.7,
  grace: 12,
  capBase: [40, 80, 260, 640, 2600],
  capPerF: 3,
  /** a brand-new bound world starts with this much (the Unknown cap) */
  start: 40,
  /** the first time a standing is reached: one typical cast of its band */
  gift: [0, 10, 20, 100, 400],
  rite: 1,
  /** how much of a person's giving terror (fear 0.8 -> 1.0) takes away */
  terror: 0.2,
  unattended: 0.5,
  attendedDays: 3,
  beyond: 3,
  popMin: 12,
  popEase: 0.02 / 12,
  /** free basics that can be repeated carry a cooldown (ticks) in a bound world */
  /** §2.3: for this many days after the god broke its covenant the town's people count less; it gives half for a year */
  brokenDays: 12, brokenGive: 360,
  /** §3.6 "as the people connect": measure x (1 + linkStep x (trade + pilgrims + kin in the faith)), 1.00 .. 1.45 */
  linkStep: 0.15, tradeFull: 30, kinFull: 3, linkYear: 360,
  /** §3.3: a miracle is this much stronger per standing above its own band */
  widen: 0.25,
  /** §3.6: the first deed in answer to an open question is free up to this band */
  deedTier: 2,
  /** the very basic spells that are always free (owner 2026-11-16, third ruling) */
  freeBasics: ['rain', 'heal-person', 'plant', 'gift', 'extinguish', 'lightning', 'ignite'],
  freeCooldown: { rain: 60, lightning: 60, 'heal-person': 30, gift: 120, ignite: 60, extinguish: 30, plant: 60, throw: 30 } as Record<string, number>,
  /** review 3: the sizes a price also follows. Heads set down (per command, the default count), the units a free gift
   *  carries, the rain's default length, the wrath a free stroke of lightning is cast at */
  heads: { 'life.spawn-people': 20, 'settlement.found': 12, 'settlement.introduce': 8 } as Record<string, number>,
  giftFree: 20, rainTicks: 720, wrathFree: 0.3,
} as const;

export function isBound(u: Universe): boolean {
  return u.god.bound;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function emptyReach(): ReachState {
  return { tier: 0, best: 0, up: 0, down: 0, popMax: REACH.popMin, f: 0, believers: 0, trust: 0, fear: 0, both: 0, inc: 0, incT: 0, incF: 0, day: 0, seen: {}, towns: {}, roads: {}, peopled: {} };
}

function pool(u: Universe): number {
  let w = 0;
  for (const pl of u.planets) w += pl.people?.worship[0] ?? 0;
  return r2(w);
}

export function capOf(u: Universe): number {
  const R = u.god.reach;
  return R ? REACH.capBase[R.tier] + REACH.capPerF * R.f : Infinity;
}

/**
 * Bind or unbind (the setting; `meta.reach`). A first bind creates the state; `fresh` (a brand-new world) also gives
 * the starting pool. Every later bind clamps the pool to the cap. Unbinding keeps the state (best, roads) for good.
 */
export function setBound(u: Universe, on: boolean, fresh = false): void {
  const g = u.god;
  if (!on) {
    if (g.bound) { delete g.laws['reach.bound']; u.emit({ t: 'reach.unbound', data: {} }); }
    return;
  }
  if (g.bound) return;
  g.laws['reach.bound'] = 1;
  const first = !g.reach;
  const R = (g.reach ??= emptyReach());
  count(u, R);
  if (fresh) {
    const ps = u.planets[0]?.people;
    if (ps) ps.worship[0] = r2((ps.worship[0] ?? 0) + REACH.start);
  } else if (!first) {
    // a later bind: nothing hoarded in the sandbox comes back in (spec §7.6)
    let over = r2(pool(u) - capOf(u));
    for (const pl of u.planets) {
      const w = pl.people?.worship;
      if (!w || over <= 0) continue;
      const take = Math.min(w[0] ?? 0, over);
      w[0] = r2(w[0] - take); over = r2(over - take);
    }
  }
  measures(u, R);
}

/** a god-0 act (not a natural event) was witnessed in this town: its believers count from now on (regard.ts witnessAct) */
export function reachSeen(u: Universe, planet: number, sid: number): void {
  const R = u.god.reach;
  if (!R || !u.god.bound) return;
  R.seen[`${planet}:${sid}`] = u.tick;
}

interface TownTally { believers: number; rite: number; fearRite: number; door: number; nt: number; nf: number; nb: number; grown: number; x: number }

export const TOWN = { proud: 1, defiant: 2, broken: 4, brokenGive: 8 } as const;

/**
 * §2.3: the state of a town that changes what its people count for and what it gives. Read from the people's state
 * (pride, an open defiant act, the god's own broken covenant), never from the player's answer.
 */
export function townState(u: Universe, planet: number, sid: number): number {
  const rel = u.god.rel;
  if (!rel) return 0;
  const r = rel.st[`${planet}:${sid}`];
  let x = 0;
  if ((r?.pride ?? 0) >= ARC.proud) x |= TOWN.proud;
  if (r?.answer) x |= TOWN.defiant;
  let broke = -Infinity;
  for (const c of rel.covenants ?? []) if (c.planet === planet && c.status === 'broken' && c.broken > broke && c.settlements.includes(sid)) broke = c.broken;
  if (broke > -Infinity) {
    const days = (u.tick - broke) / 1440;
    if (days < REACH.brokenDays) x |= TOWN.broken;
    if (days < REACH.brokenGive) x |= TOWN.brokenGive;
  }
  return x;
}

/** the open question a town has put to the god (an open defiant act, a rising Tower not yet answered): its tick, or -1 */
function openQuestion(u: Universe, planet: number, sid: number): number {
  const rel = u.god.rel;
  if (!rel) return -1;
  const a = rel.st[`${planet}:${sid}`]?.answer;
  if (a) return a.tick;
  for (const tw of rel.towers ?? []) {
    if (tw.planet === planet && tw.status === 'rising' && tw.answer === 'none' && tw.choiceAt >= 0 && (tw.host === sid || tw.league.includes(sid))) return tw.choiceAt;
  }
  return -1;
}

/** the count (spec §2): roads with their keep lines, F, believers, the two shares; fills `tally` per town when given */
function count(u: Universe, R: ReachState, tally?: Map<string, TownTally>): number {
  let F = 0, bel = 0, nT = 0, nF = 0, nB = 0, grown = 0;
  const roads: ReachState['roads'] = {};
  const state: Record<string, number> = {};
  for (const p of u.planets) {
    const ps = p.people;
    if (!ps || !p.alive) continue;
    const A = ps.agents;
    if (A.count > 0) R.peopled[p.id] = 1;
    const old = R.roads[p.id] ?? {};
    const now: Record<string, number> = {};
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s] || (A.flags[s] & AgentFlag.child)) continue;
      grown++;
      const sid = A.settlement[s];
      if (sid < 0) continue;
      const key = `${p.id}:${sid}`;
      let t = tally?.get(key);
      if (tally && !t) tally.set(key, (t = { believers: 0, rite: 0, fearRite: 0, door: 0, nt: 0, nf: 0, nb: 0, grown: 0, x: townState(u, p.id, sid) }));
      if (t) t.grown++;
      if (R.seen[key] === undefined) continue;
      const i = s * GODS;
      const faith = A.faith[i], love = A.love[i], fear = A.fear[i];
      if (faith < REACH.believe) continue;
      const was = old[A.id[s]] ?? 0;
      let road = 0;
      if (love >= ((was & 1) ? REACH.trustKeep : REACH.trustLine) - 1e-4) road |= 1;
      if (fear >= ((was & 2) ? REACH.fearKeep : REACH.fearLine) - 1e-4) road |= 2;
      if (road) now[A.id[s]] = road;
      bel++;
      if (road & 1) nT++;
      if (road & 2) nF++;
      if (road === 3) nB++;
      // §2.3: open defiance counts 0; after the god's broken covenant only those on a road count, and 1; pride counts 1
      const x = t ? t.x : (state[key] ??= townState(u, p.id, sid));
      F += x & TOWN.defiant ? 0 : x & TOWN.broken ? (road ? 1 : 0) : x & TOWN.proud ? 1 : road ? 2 : 1;
      if (t) {
        if (road & 1) t.nt++;
        if (road & 2) t.nf++;
        if (road === 3) t.nb++;
        // what this person's rites are worth in a day: the same on either road, no more on both; terror gives less
        // (down to half at fear 1.0, never nothing: the road of fear always earns)
        const calm = fear <= 0.8 ? 1 : 1 - REACH.terror * (fear - 0.8) / 0.2;
        const v = faith * (road ? 1.5 : 1) * (0.5 + A.traits[s * NT + TRAIT.piety]) * calm;
        t.believers++; t.rite += v;
        // the part a person on the road of fear leaves at the door (fear keeps them from the evening worship)
        if (road & 2) t.door += v;
        // by which road it is given (the two bars of the day's giving): a person on both gives half by each
        t.fearRite += road === 2 ? v : road === 3 ? v / 2 : 0;
      }
    }
    if (Object.keys(now).length) roads[p.id] = now;
  }
  R.roads = roads;
  R.popMax = r2(Math.max(REACH.popMin, grown, R.popMax - R.popMax * REACH.popEase));
  R.f = F; R.believers = bel; R.trust = nT; R.fear = nF; R.both = nB;
  return F;
}

/** the town's worship place: temple 1 + min(1, believers / 20), shrine 1, hearth 0.5, else 0.3 */
function place(u: Universe, p: Planet, sid: number, believers: number): number {
  let best = 0.3;
  const list = u.content.buildings.list;
  for (const b of p.people.of(sid)) {
    if (b.progress < 1 || (b.flags & 2)) continue;
    const id = list[b.type].id;
    const v = id === 'temple' ? 1 + Math.min(1, believers / 20) : id === 'shrine' ? 1 : id === 'hearth' ? 0.5 : 0.3;
    if (v > best) best = v;
  }
  return best;
}

/** each town's measure for the coming day (spec §3.6): the most it can give whatever happens in it */
function measures(u: Universe, R: ReachState, roll = false): void {
  const tally = new Map<string, TownTally>();
  count(u, R, tally);
  const towns: ReachState['towns'] = {};
  const day = 1440;
  for (const key of [...tally.keys()].sort()) {
    const t = tally.get(key)!;
    const [pid, sid] = key.split(':').map(Number);
    const p = u.planets.find((q) => q.id === pid);
    if (!p) continue;
    if (t.believers <= 0) continue;
    const attended = u.tick - (R.seen[key] ?? -1e9) <= REACH.attendedDays * day ? 1 : REACH.unattended;
    const lk = link(u, p, sid, tally);
    // §2.3: a town in open defiance gives nothing; one the god broke its covenant with gives half
    const give = t.x & TOWN.defiant ? 0 : t.x & TOWN.brokenGive ? 0.5 : 1;
    const m = r2(REACH.rite * attended * place(u, p, sid, t.believers) * t.rite * lk.l * give);
    const was = R.towns[key];
    towns[key] = { m, g: roll ? 0 : Math.min(m, was?.g ?? 0), ff: t.rite > 0 ? Math.round((t.fearRite / t.rite) * 100) / 100 : 0, fd: t.rite > 0 ? Math.round((t.door / t.rite) * 100) / 100 : 0,
      n: t.believers, nt: t.nt, nf: t.nf, nb: t.nb, l: lk.l, lt: lk.t, lp: lk.p, lk: lk.k, x: t.x, k: t.rite > 0 ? Math.round((m / t.rite) * 10000) / 10000 : 0,
      yg: roll ? was?.g ?? 0 : was?.yg ?? 0, yf: roll ? was?.ff ?? 0 : was?.yf ?? 0 };
    if (roll && (t.x & 7) !== ((was?.x ?? 0) & 7)) townLine(u, p, sid, t.x & 7, (was?.x ?? 0) & 7);
  }
  R.towns = towns;
}

/**
 * §3.6 "as the people connect": trade (the town's rolling trade against 30), pilgrims (a season from here, or pilgrims
 * come here, within a year) and kin in the faith (other living towns it knows where half the grown people believe,
 * three for the whole). It reads no trust and no fear, so it favours neither road.
 */
function link(u: Universe, p: Planet, sid: number, tally: Map<string, TownTally>): { l: number; t: number; p: number; k: number } {
  const st = p.people.settlement(sid);
  if (!st) return { l: 1, t: 0, p: 0, k: 0 };
  const t = r2(Math.min(1, (st.traded ?? 0) / REACH.tradeFull));
  const since = u.god.rel?.st[`${p.id}:${sid}`]?.since;
  const last = Math.max(since?.pilgrimFrom ?? -1e12, since?.pilgT ?? -1e12);
  const pg = u.tick - last <= REACH.linkYear * 1440 ? 1 : 0;
  let n = 0;
  for (const id of st.contacts ?? []) {
    if (id === sid) continue;
    const o = p.people.settlement(id);
    const q = tally.get(`${p.id}:${id}`);
    if (o && o.fallen < 0 && q && q.grown > 0 && q.believers * 2 >= q.grown) n++;
  }
  const k = r2(Math.min(1, n / REACH.kinFull));
  return { l: r2(1 + REACH.linkStep * (t + pg + k)), t, p: pg, k };
}

/** a chronicle line when a town's state begins to change what it counts for and gives (told at the daily pass) */
function townLine(u: Universe, p: Planet, sid: number, now: number, was: number): void {
  const st = p.people.settlement(sid);
  if (!st) return;
  const on = now & ~was;
  const id = on & TOWN.defiant ? 'reach.town.defiant' : on & TOWN.broken ? 'reach.town.broken' : on & TOWN.proud ? 'reach.town.proud' : now === 0 ? 'reach.town.back' : '';
  if (id) tell(u, p, id, { settlement: st.name }, st, [{ kind: 'settlement', id: st.id, planet: p.id }], 2);
}

/**
 * The only writer of god 0's pool in a bound world: pays what is left of the town's measure today and what fits under
 * the cap; the rest is not paid. Returns what was paid.
 */
export function credit(u: Universe, p: Planet, sid: number, amount: number): number {
  const R = u.god.reach;
  const ps = p.people;
  if (!R || !ps || amount <= 0) return 0;
  const t = R.towns[`${p.id}:${sid}`];
  if (!t) return 0;
  const paid = r2(Math.min(amount, t.m - t.g, Math.max(0, capOf(u) - pool(u))));
  if (paid <= 0) return 0;
  t.g = r2(t.g + paid);
  const st = ps.settlement(sid);
  if (st) { st.worshipBy[0] = r2(st.worshipBy[0] + paid); st.worship = st.worshipBy[0]; }
  ps.worship[0] = r2((ps.worship[0] ?? 0) + paid);
  return paid;
}

/** once a game day, for the god as a whole: the door offerings, the count, rise and fall, the new measures */
export function reachDaily(u: Universe): void {
  const R = u.god.reach;
  if (!R || !u.god.bound) return;
  // the offering left at the door (spec §3.6): those who fear and do not trust kept from the evening; their part of the
  // measure, as far as the day left it unfilled, is given now
  let inc = 0, incF = 0;
  for (const key of Object.keys(R.towns).sort()) {
    const t = R.towns[key];
    const [pid, sid] = key.split(':').map(Number);
    const p = u.planets.find((q) => q.id === pid);
    if (p && t.fd > 0) credit(u, p, sid, r2(t.m * t.fd));
    inc += t.g; incF += t.g * t.ff;
  }
  R.inc = r2(inc); R.incF = r2(incF); R.incT = r2(R.inc - R.incF);
  R.day++;
  for (const k of Object.keys(R.seen)) {
    const [pid, sid] = k.split(':').map(Number);
    const st = u.planets.find((q) => q.id === pid)?.people?.settlement(sid);
    if (!st || st.fallen >= 0) delete R.seen[k];
  }
  if (R.off) { for (const k of Object.keys(R.off)) if (u.tick - R.off[k] > 1440) delete R.off[k]; if (!Object.keys(R.off).length) delete R.off; }
  if (R.deeds) for (const k of Object.keys(R.deeds)) { const [pid, sid] = k.split(':').map(Number); if (openQuestion(u, pid, sid) !== R.deeds[k]) delete R.deeds[k]; }
  measures(u, R, true);
  standing(u, R);
}

/**
 * §3.6 the visible offering (TASK.offer, people/work.ts): a believer on the road of fear has left a portion at the door
 * of the worship place before dusk. It pays their own part of the town's measure now; what the day leaves unfilled is
 * still paid at the day's end, so no number changes, only when it is seen.
 */
export function doorOffering(u: Universe, p: Planet, sid: number, s: number): number {
  const R = u.god.reach;
  if (!R || !u.god.bound) return 0;
  const t = R.towns[`${p.id}:${sid}`];
  const A = p.people.agents;
  if (!t || !t.k) return 0;
  const i = s * GODS;
  const fear = A.fear[i];
  const calm = fear <= 0.8 ? 1 : 1 - REACH.terror * (fear - 0.8) / 0.2;
  return credit(u, p, sid, r2(t.k * A.faith[i] * 1.5 * (0.5 + A.traits[s * NT + TRAIT.piety]) * calm));
}

/** will this person leave an offering at the door this evening (god/relationship.ts asks in the hour before dusk) */
export function offersToday(u: Universe, p: Planet, sid: number, s: number): boolean {
  const R = u.god.reach;
  if (!R || !u.god.bound) return false;
  const A = p.people.agents;
  const t = R.towns[`${p.id}:${sid}`];
  if (!t || !t.k || t.m - t.g <= 0 || !((R.roads[p.id]?.[A.id[s]] ?? 0) & 2)) return false;
  const key = `${p.id}:${A.id[s]}`;
  if (u.tick - (R.off?.[key] ?? -1e9) < 720) return false;
  (R.off ??= {})[key] = u.tick;
  return true;
}

/** §2.3 for the temple: half the town's grown believers are on the road of fear (relationship.ts templeWanted) */
export function fearTown(u: Universe, planet: number, sid: number): boolean {
  const t = u.god.bound ? u.god.reach?.towns[`${planet}:${sid}`] : undefined;
  return !!t && (t.n ?? 0) > 0 && (t.nf ?? 0) * 2 >= (t.n ?? 0);
}

/** §3.3: a god-0 miracle is stronger by 0.25 for each standing above its own band (1 when unbound) */
export function reachWiden(u: Universe, god: number, tier: number): number {
  const R = u.god.reach;
  if (god !== 0 || !R || !u.god.bound) return 1;
  return 1 + REACH.widen * Math.max(0, R.tier - tier);
}

/**
 * §7.5: a developed scenario begins with a standing. The god is already known in its towns; the standing is held as a
 * floor for `days` reach days (0: for good) and the pool starts at half its cap.
 */
export function startStanding(u: Universe, tier: number, days: number): void {
  const R = u.god.reach;
  if (!R || !u.god.bound || tier <= 0) return;
  for (const p of u.planets) for (const st of p.people?.settlements ?? []) if (st.fallen < 0) R.seen[`${p.id}:${st.id}`] = u.tick;
  R.tier = Math.min(4, tier); R.best = R.tier; R.up = 0; R.down = 0;
  R.floor = { tier: R.tier, until: days > 0 ? R.day + days : -1 };
  measures(u, R);
  const ps = u.planets.find((q) => q.alive && q.people && q.people.agents.count > 0)?.people ?? u.planets[0]?.people;
  if (ps) { for (const q of u.planets) if (q.people) q.people.worship[0] = 0; ps.worship[0] = r2(capOf(u) / 2); }
}

/** does F (or the share) meet tier t's line x k */
function meets(R: ReachState, t: number, k: number): boolean {
  if (R.f >= REACH.f[t] * k) return true;
  const S = R.f / (2 * R.popMax);
  return REACH.share[t] > 0 && S >= REACH.share[t] * k && R.f >= REACH.shareF[t] * k;
}

/** the chronicle (and so the Book) keeps every change of standing */
function standingLine(u: Universe, R: ReachState, id: string): void {
  const p = u.planets.find((q) => q.alive && q.people && (R.peopled[q.id] ?? 0)) ?? u.planets[0];
  if (p) tell(u, p, id, { title: REACH.names[R.tier], count: R.f }, null, undefined, 3);
}

function standing(u: Universe, R: ReachState): void {
  const from = R.tier;
  if (from < 4 && meets(R, from + 1, 1)) {
    R.up = r2(R.up + Math.max(1, Math.min(2, R.f / REACH.f[from + 1])));
    if (R.up >= REACH.hold[from + 1]) {
      R.tier = from + 1; R.up = 0; R.down = 0;
      if (R.tier > R.best) {
        R.best = R.tier;
        const ps = u.planets.find((p) => p.alive && p.people && (R.peopled[p.id] ?? 0))?.people ?? u.planets[0]?.people;
        const gift = Math.min(REACH.gift[R.tier], Math.max(0, r2(capOf(u) - pool(u))));
        if (ps && gift > 0) ps.worship[0] = r2((ps.worship[0] ?? 0) + gift);
      }
      u.emit({ t: 'reach.rose', data: { from, to: R.tier, f: R.f, name: REACH.names[R.tier] } });
      standingLine(u, R, 'reach.rose');
      return;
    }
  } else R.up = Math.max(0, r2(R.up - REACH.slip));
  if (R.floor && R.floor.until >= 0 && R.day > R.floor.until) delete R.floor;
  if (R.floor && from <= R.floor.tier) { R.down = 0; return; }
  if (from > 0 && !meets(R, from, REACH.fallAt)) {
    R.down++;
    if (R.down === 1) u.emit({ t: 'reach.falling', data: { days: REACH.grace, tier: from } });
    if (R.down >= REACH.grace) {
      R.tier = from - 1; R.down = 0; R.up = 0;
      u.emit({ t: 'reach.fell', data: { from, to: R.tier, f: R.f, name: REACH.names[R.tier] } });
      standingLine(u, R, 'reach.fell');
    }
  } else R.down = 0;
}

// ───────────────────────────── the gate and the charge ─────────────────────────────

export interface Charge { price: number; cooldown: number; key: string; power: string; beyond: boolean; deed?: [string, number] }

/** §3.6 answering by deed: the town this command is aimed at, when it has an open question whose free deed is unspent */
function deedFor(u: Universe, R: ReachState, cmd: Record<string, unknown>, p: Planet | undefined): [string, number] | null {
  if (!p || !p.people) return null;
  let sid = typeof cmd.settlement === 'number' ? cmd.settlement : -1;
  const pos = cmd.pos as ArrayLike<number> | undefined;
  if (sid < 0 && pos && typeof pos[0] === 'number' && pos.length >= 3) {
    const r = typeof cmd.radius === 'number' ? cmd.radius : 0;
    sid = nearestSettlement(p, pos, 600 + r, (st) => st.fallen < 0)?.id ?? -1;
  }
  if (sid < 0) return null;
  const q = openQuestion(u, p.id, sid);
  const key = `${p.id}:${sid}`;
  return q >= 0 && R.deeds?.[key] !== q ? [key, q] : null;
}

/** is this world free clay: no person has ever lived on it (a tier 4 act is free only while no world is peopled) */
function freeClay(u: Universe, R: ReachState, p: Planet | undefined, tier: number): boolean {
  if (p && p.people && p.people.agents.count > 0) R.peopled[p.id] = 1;
  if (tier >= 4 || !p) for (const q of u.planets) if (q.people && q.people.agents.count > 0) R.peopled[q.id] = 1;
  return clayNow(u, R, p, tier);
}

/** the same, changing nothing (the views) */
function clayNow(u: Universe, R: ReachState, p: Planet | undefined, tier: number): boolean {
  const lived = (q: Planet) => !!R.peopled[q.id] || (!!q.people && q.people.agents.count > 0);
  if (tier >= 4 || !p) return !u.planets.some(lived);
  return !lived(p);
}

/** Strict: belief bounds the god AND the old restraint setting is on (spec §3.7) */
export function isStrict(u: Universe): boolean {
  return u.god.bound && !!u.settings.restraint;
}

/**
 * The size of a cast against the power's own default (1: the default or smaller). Radius, power and scale; and
 * (review 3) everything else a cast can be made bigger by: `everywhere`, the heads set down, the units of a gift, the
 * length and weight of rain, the wrath of lightning. `wrath` is the wrath the cast would fall with (its own, else the law).
 */
function sizeK(pw: PowerDef, c: Record<string, unknown> | undefined, wrath: number): number {
  let k = 1;
  if (!c) return k;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const sdef = (key: string) => num(pw.params?.[key]) ?? num(pw.schema?.[key]?.default);
  const def = sdef('radius');
  const radius = num(c.radius);
  if (radius !== undefined && def !== undefined && def > 0) k *= Math.max(1, radius / def);
  // the whole world: as the widest brush there is
  if (c.everywhere === true && def !== undefined && def > 0) k = Math.max(k, (num(pw.schema?.radius?.max) ?? 20000) / def);
  const power = num(c.power);
  if (power !== undefined) k *= Math.max(1, power);
  const scale = num(c.scale);
  if (scale !== undefined && pw.command === 'disaster.spawn') k *= Math.max(1, scale);
  // heads: a people set down costs by how many (the made-people farm)
  const heads = REACH.heads[pw.command];
  if (heads !== undefined) {
    const n = pw.command === 'settlement.introduce' ? (c.people !== undefined ? num(c.qty) : undefined) : num(c.count);
    const base = pw.command === 'settlement.introduce' ? heads : sdef('count') ?? heads;
    if (n !== undefined && base > 0) k *= Math.max(1, n / base);
  }
  if (pw.command === 'settlement.gift' && c.items && typeof c.items === 'object') {
    let total = 0;
    const items = c.items as Record<string, unknown>;
    for (const key of Object.keys(items).sort()) total += Math.max(0, Number(items[key]) || 0);
    k *= Math.max(1, total / REACH.giftFree);
  }
  if (pw.command === 'water.rain') {
    const d = num(c.duration), i = num(c.intensity);
    if (d !== undefined) k *= Math.max(1, d / REACH.rainTicks);
    if (i !== undefined) k *= Math.max(1, i);
  }
  if (pw.command === 'miracle.lightning') k *= Math.max(1, (num(c.wrath) ?? wrath) / REACH.wrathFree);
  return k;
}

/** price x size: a wider, stronger, longer or more numerous cast than the power's default costs in proportion */
export function priceOf(u: Universe, pw: PowerDef, cmd?: Command | Record<string, unknown>): number {
  const k = sizeK(pw, cmd as Record<string, unknown> | undefined, wrathLaw(u));
  // a free basic spell is free at its own size only: cast bigger it costs like the basics (half its old cost x size).
  // (review 3: the player-set law `restraint.costScale` never scales a bound price; it only scales the Strict floor)
  if (pw.free) return k > 1 && pw.id in REACH.freeCooldown ? r2(Math.max(1, Math.round((pw.cost ?? 0) / 2)) * k) : 0;
  // Strict (§3.7): never less than the old restraint cost
  const scale = Math.max(0, u.god.laws['restraint.costScale'] ?? 1);
  const base = isStrict(u) ? Math.max(pw.price ?? 0, (pw.cost ?? 0) * scale) : pw.price ?? 0;
  return r2(base * k);
}

/** the size multiplier alone, for the UI's cost line (`wrath`: the law, when the cast names none) */
export function sizeOf(pw: PowerDef, cmd?: Record<string, unknown>, wrath: number = REACH.wrathFree): number {
  return Math.round(sizeK(pw, cmd, wrath) * 1000) / 1000;
}

function waitText(R: ReachState, need: number): string {
  if (R.believers <= 0) return 'No one gives to you yet. Be seen: rain, a small gift and a stroke of lightning are always yours.';
  if (R.inc <= 0) return 'The people have not given yet today.';
  const d = Math.ceil(need / R.inc);
  return d <= 1 ? 'About a day more.' : `About ${d} days more.`;
}

/** why a power is out of reach at the stored standing (null: in reach, perhaps at 3 x) */
function lockedWhy(R: ReachState, pw: PowerDef): string | null {
  const t = pw.tier ?? 0;
  if (pw.free || t <= R.tier || (t === R.tier + 1 && t < 4)) return null;
  return `Beyond your reach. ${pw.name} opens when you are ${REACH.names[t]}: ${REACH.f[t]} follow, ${R.f} now.`;
}

/**
 * The gate (registry `before`, god 0, bound world): a refusal sentence, a pending charge, or null (free). Changes
 * nothing but the peopled marks; reads the STORED standing and pool, so replay and a mid-day load refuse the same.
 */
export function chargeCheck(u: Universe, cmd: Command, pw: PowerDef | undefined, p: Planet | undefined): string | Charge | null {
  const R = u.god.reach;
  if (!R || !pw) return null;
  const tier = pw.tier ?? 0;
  const key = `0:${pw.id}`;
  const ready = u.god.cooldowns[key] ?? -1;
  const clay = freeClay(u, R, p, tier);
  if (pw.free) {
    const cd = clay ? 0 : REACH.freeCooldown[pw.id] ?? 0;
    if (cd > 0 && ready > u.tick) { const m = Math.ceil(ready - u.tick); return `${pw.name} is still gathering strength (${m} minute${m === 1 ? '' : 's'} more).`; }
    const big = clay ? 0 : priceOf(u, pw, cmd);
    if (big > 0 && pool(u) + 1e-9 < big) return `${pw.name} at this size needs ${big} worship; ${pool(u)} is gathered. ${waitText(R, big - pool(u))}`;
    return cd > 0 || big > 0 ? { price: big, cooldown: cd, key, power: pw.id, beyond: false } : null;
  }
  if (clay) return null;
  if (tier <= REACH.deedTier) {
    const deed = deedFor(u, R, cmd as unknown as Record<string, unknown>, p);
    if (deed) return { price: 0, cooldown: 0, key, power: pw.id, beyond: false, deed };
  }
  const why = lockedWhy(R, pw);
  if (why) return why;
  const beyond = tier === R.tier + 1;
  if (ready > u.tick) {
    const h = Math.ceil((ready - u.tick) / 60);
    return `${pw.name} is still gathering strength (${h} hour${h === 1 ? '' : 's'} more).`;
  }
  const price = r2(priceOf(u, pw, cmd) * (beyond ? REACH.beyond : 1));
  const have = pool(u);
  if (have + 1e-9 < price) {
    return `${pw.name} needs ${price} worship${beyond ? ' (three times its price: it is beyond your standing)' : ''}; ${have} is gathered. ${waitText(R, price - have)}`;
  }
  return { price, cooldown: (pw.cooldown ?? 0) * (beyond ? 2 : 1), key, power: pw.id, beyond };
}

/** the charge (registry `after`, only when the handler succeeded): a failed or refused cast never reaches here */
export function chargeCommit(u: Universe, ch: Charge, p: Planet | undefined): void {
  let left = ch.price;
  const order = p ? [p, ...u.planets.filter((q) => q !== p)] : u.planets;
  for (const pl of order) {
    const w = pl.people?.worship;
    if (!w || left <= 0) continue;
    const take = Math.min(w[0] ?? 0, left);
    w[0] = r2((w[0] ?? 0) - take); left = r2(left - take);
  }
  if (ch.deed && u.god.reach) (u.god.reach.deeds ??= {})[ch.deed[0]] = ch.deed[1];
  if (ch.cooldown > 0) u.god.cooldowns[ch.key] = u.tick + ch.cooldown;
  if (ch.price > 0) u.emit({ t: 'worship.spent', planet: p?.id, data: { power: ch.power, amount: ch.price, beyond: ch.beyond } });
}

// ───────────────────────────── what the UI reads ─────────────────────────────

export interface ReachView {
  bound: boolean; tier: number; standing: string; best: number;
  /** F, and the people behind it */
  following: number; believers: number; trust: number; fear: number; both: number;
  /** the two bars, 0..1: the part of the grown people (at their most) who believe and trust / believe and fear */
  trustShare: number; fearShare: number; share: number;
  pool: number; cap: number;
  /** what the people gave yesterday, by road */
  gathered: { total: number; trust: number; fear: number };
  /** the most all towns together can give today, and what they have given so far */
  measure: number; given: number;
  next: { tier: number; standing: string; f: number; share: number; shareF: number; held: number; hold: number } | null;
  /** days left before the standing falls (0: not falling) */
  falling: number;
  /** the setting: Strict = bound + the old restraint costs; legacy = an old save with restraint on, never bound */
  // (stint 3 fields are typed optional so a hand-built view in a UI test still type-checks; reachView always sends them)
  strict?: boolean; legacy?: boolean;
  /** the very basic spells that are always free (power ids) */
  freeBasics?: string[];
  /** per world: free clay (no person has ever lived on it: every power there is free); clayAll: no world is peopled */
  worlds?: { planet: number; clay: boolean }[]; clayAll?: boolean;
  /** a scenario's starting standing held as a floor: its tier and the days left (-1: for good); null: none */
  floor?: { tier: number; days: number } | null;
  /** every town the god is known in that has believers */
  towns?: TownReach[];
}

/** one town's part in the god's reach (query 'reach' .towns, SettlementView.reach) */
export interface TownReach {
  planet: number; settlement: number; name: string;
  /** grown people who believe; of them on the road of trust, of fear, on both */
  believers: number; trust: number; fear: number; both: number;
  /** the most it can give today, what it has given, what is left of the measure */
  measure: number; given: number; left: number;
  gaveYesterday: { total: number; trust: number; fear: number };
  /** a god-0 act was witnessed here in the last 3 days (else unseen: it gives half) */
  attended: boolean; unseen: boolean;
  /** "as the people connect": the multiplier 1.00 .. 1.45 and its parts, each 0 .. 1 */
  link: number; linkParts: { trade: number; pilgrims: number; kin: number };
  /** §2.3 */
  proud: boolean; defiant: boolean; brokenCovenant: boolean; givesHalf: boolean;
  /** an open question here whose first deed in answer is still free */
  freeDeed: boolean;
}

function townView(u: Universe, R: ReachState, key: string): TownReach | undefined {
  const t = R.towns[key];
  if (!t) return undefined;
  const [pid, sid] = key.split(':').map(Number);
  const st = u.planets.find((q) => q.id === pid)?.people?.settlement(sid);
  const x = t.x ?? 0, yg = t.yg ?? 0, yf = r2(yg * (t.yf ?? 0));
  const attended = u.tick - (R.seen[key] ?? -1e9) <= REACH.attendedDays * 1440;
  const q = openQuestion(u, pid, sid);
  return {
    planet: pid, settlement: sid, name: st?.name ?? '',
    believers: t.n ?? 0, trust: t.nt ?? 0, fear: t.nf ?? 0, both: t.nb ?? 0,
    measure: t.m, given: t.g, left: r2(Math.max(0, t.m - t.g)),
    gaveYesterday: { total: yg, trust: r2(yg - yf), fear: yf },
    attended, unseen: !attended,
    link: t.l ?? 1, linkParts: { trade: t.lt ?? 0, pilgrims: t.lp ?? 0, kin: t.lk ?? 0 },
    proud: !!(x & TOWN.proud), defiant: !!(x & TOWN.defiant), brokenCovenant: !!(x & TOWN.broken), givesHalf: !!(x & TOWN.brokenGive),
    freeDeed: q >= 0 && R.deeds?.[key] !== q,
  };
}

/** one town's reach for the inspector (undefined: unbound, or no believers there) */
export function townReach(u: Universe, planet: number, sid: number): TownReach | undefined {
  const R = u.god.reach;
  return R && u.god.bound ? townView(u, R, `${planet}:${sid}`) : undefined;
}

export function reachView(u: Universe): ReachView {
  const R = u.god.reach;
  if (!u.god.bound || !R) {
    return { bound: false, tier: 4, standing: '', best: R?.best ?? 0, following: 0, believers: 0, trust: 0, fear: 0, both: 0, trustShare: 0, fearShare: 0, share: 0,
      pool: pool(u), cap: -1, gathered: { total: 0, trust: 0, fear: 0 }, measure: 0, given: 0, next: null, falling: 0,
      strict: false, legacy: !!u.settings.restraint, freeBasics: [...REACH.freeBasics], worlds: [], clayAll: false, floor: null, towns: [] };
  }
  const n = R.tier + 1;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    bound: true, tier: R.tier, standing: REACH.names[R.tier], best: R.best,
    following: R.f, believers: R.believers, trust: R.trust, fear: R.fear, both: R.both,
    trustShare: r3(Math.min(1, R.trust / R.popMax)), fearShare: r3(Math.min(1, R.fear / R.popMax)), share: r3(R.f / (2 * R.popMax)),
    pool: pool(u), cap: capOf(u),
    gathered: { total: R.inc, trust: R.incT, fear: R.incF },
    measure: r2(Object.values(R.towns).reduce((a, t) => a + t.m, 0)), given: r2(Object.values(R.towns).reduce((a, t) => a + t.g, 0)),
    next: n <= 4 ? { tier: n, standing: REACH.names[n], f: REACH.f[n], share: REACH.share[n], shareF: REACH.shareF[n], held: R.up, hold: REACH.hold[n] } : null,
    falling: R.down > 0 ? REACH.grace - R.down : 0,
    strict: isStrict(u), legacy: false, freeBasics: [...REACH.freeBasics],
    worlds: u.planets.map((q) => ({ planet: q.id, clay: clayNow(u, R, q, 0) })), clayAll: clayNow(u, R, undefined, 4),
    floor: R.floor ? { tier: R.floor.tier, days: R.floor.until < 0 ? -1 : Math.max(0, R.floor.until - R.day) } : null,
    towns: Object.keys(R.towns).sort().map((k) => townView(u, R, k)!).filter(Boolean),
  };
}

function readyText(u: Universe, ready: number): string | null {
  if (ready <= u.tick) return null;
  const m = Math.ceil(ready - u.tick);
  if (m < 60) return `Ready in ${m} minute${m === 1 ? '' : 's'}.`;
  const h = Math.ceil(m / 60);
  return `Ready in ${h} hour${h === 1 ? '' : 's'}.`;
}

/**
 * Per power, for the palette and the wheel: its price now, whether it is locked, affordable, and the plain reason.
 * `args` (query 'powers' / 'reach.price'): `planet` (the world aimed at, for free clay), `radius` / `power` / `scale`
 * (the size to price), `pos` / `settlement` (the target, for the free first deed). Changes nothing.
 */
export function reachPowerView(u: Universe, pw: PowerDef, args: Record<string, unknown> = {}): Record<string, unknown> {
  const R = u.god.reach;
  if (!u.god.bound || !R) return {};
  const tier = pw.tier ?? 0;
  const p = typeof args.planet === 'number' ? u.planets.find((q) => q.id === args.planet) : undefined;
  const cmd: Record<string, unknown> = { ...(pw.params ?? {}) };
  for (const k of ['radius', 'power', 'scale', 'pos', 'settlement', 'count', 'qty', 'people', 'items', 'duration', 'intensity', 'wrath', 'everywhere']) if (args[k] !== undefined) cmd[k] = args[k];
  const size = sizeOf(pw, cmd, wrathLaw(u));
  const ready = u.god.cooldowns[`0:${pw.id}`] ?? -1;
  const freeCd = pw.free ? REACH.freeCooldown[pw.id] ?? 0 : 0;
  const base = { size, basePrice: pw.free ? 0 : r2(priceOf(u, pw)), strict: isStrict(u) };
  // free clay: with a world named, that world; with none, only when no world at all is peopled
  if (clayNow(u, R, p, p ? tier : 4)) return { ...base, priceNow: 0, locked: false, beyond: false, affordable: true, reason: null, clay: true, cooldown: 0, readyIn: 0, cooldownText: null };
  const deed = !pw.free && tier <= REACH.deedTier && !!deedFor(u, R, cmd, p);
  const locked = deed ? null : lockedWhy(R, pw);
  const beyond = !deed && !pw.free && tier === R.tier + 1 && !locked;
  const priceNow = deed ? 0 : r2(priceOf(u, pw, cmd) * (beyond ? REACH.beyond : 1));
  const have = pool(u);
  const waiting = !deed && ready > u.tick && (!pw.free || freeCd > 0);
  const affordable = !locked && have + 1e-9 >= priceNow;
  const reason = locked ?? (affordable ? null : `${pw.name} needs ${priceNow} worship; ${have} is gathered. ${waitText(R, priceNow - have)}`);
  return {
    ...base, priceNow, locked: !!locked, beyond, affordable, reason, clay: false, ...(deed ? { freeDeed: true } : {}),
    /** ticks of cooldown a cast now would start; readyIn: ticks until it may be cast again (0: ready) */
    cooldown: deed ? 0 : pw.free ? freeCd : (pw.cooldown ?? 0) * (beyond ? 2 : 1),
    readyIn: waiting ? Math.ceil(ready - u.tick) : 0, cooldownText: waiting ? readyText(u, ready) : null,
    ...(ready > u.tick ? { readyAt: ready } : {}),
  };
}

/** query 'reach.price' { id, planet?, radius?, power?, scale?, pos?, settlement? }: one power priced at a size and a target */
export function reachPrice(u: Universe, args: Record<string, unknown>): Record<string, unknown> | null {
  const pw = u.content.powers.list.find((q) => q.id === args.id);
  if (!pw) return null;
  return { id: pw.id, name: pw.name, tier: pw.tier ?? 0, free: !!pw.free, price: pw.price ?? 0, bound: u.god.bound, ...reachPowerView(u, pw, args) };
}
