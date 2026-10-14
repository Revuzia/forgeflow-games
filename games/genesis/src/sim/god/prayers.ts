// GENESIS — prayers are requests (LIVING.md §3.3).
//
// A settlement raises a prayer from its real state (at most 2 open at once), with an answer window; any matching act
// of the god inside its territory (+ 200 m) within the window answers it:
//
//   food        food < 1.5 days a head, or famine deaths       plenty, a gift of food, fertile fields, game sent near  3 days
//   rain        a drought on the land, or the fields' soil      rain or a storm over the land, the rain sigil           3 days
//               below 0.15 moisture for 2 days of the growing season
//   healing     ≥ 10 % sick, or a plague                        mending, a cure, the plague ended                       2 days
//   warmth      warmth < 0.3 at night, a blizzard, a cold snap  kindling, clear calm weather, warmth                     1 day
//               or an ice age
//   protection  a war band within 1 km, predators killing, a    a ward, stillness, the danger stopped or moved, the     1 day
//               volcano's warnings, a severe storm              attackers struck
//   rebuilding  ≥ 25 % of the buildings ruined                  timber, a gift of wood or stone, buildings raised       4 days
//
// Answered: faith +0.10, trust +0.15, loyalty +0.05 and "The god heard Aru". Lapsed: faith −0.03, trust −0.05, loyalty
// −0.02; three lapses in a row and "they say the god is deaf" (the prophet's credibility −0.1). `prayer.answer
// { settlement, prayer? }` performs the canonical answer (one-click answering in the UI; free text "answer the prayers
// of Aru"); query 'prayers'.
//
// Hardship (the worst of: a disaster on the town within 2 days, famine, the sick share, a storm, a drought), worked out
// hourly and kept on the record (`since.hard`, 0..1), is what moves people to pray (god/relationship.ts).

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Command } from '../types.ts';
import type { Prayer } from './state.ts';
import { AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { NEED } from '../people/defs.ts';
import { NEED_N } from '../people/needs.ts';
import { foodDays } from '../people/store.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { stormSeverity } from '../people/shelter.ts';
import { moveSettlement, relOf, relStat, srel } from './regard.ts';
import { effR } from './disasters.ts';

export const PRAYER_KINDS = ['food', 'rain', 'healing', 'warmth', 'protection', 'rebuilding'] as const;
export type PrayerKind = (typeof PRAYER_KINDS)[number];

/** the answer window of each prayer, in days */
export const WINDOW: Record<PrayerKind, number> = { food: 3, rain: 3, healing: 2, warmth: 1, protection: 1, rebuilding: 4 };

/** what a prayer is for, in words ("they pray for rain") */
export const PRAYER_WORDS: Record<string, string> = { food: 'food', rain: 'rain', healing: 'healing', warmth: 'warmth', protection: 'protection', rebuilding: 'help to rebuild' };

// ───────────────────────────── the state of a settlement ─────────────────────────────

function people(x: PCtx, st: Settlement): number {
  return (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
}

/** the share of members sick */
function sickShare(x: PCtx, st: Settlement): number {
  const m = x.ps.members.get(st.id) ?? [];
  if (!m.length) return 0;
  let n = 0;
  for (const s of m) if (x.A.disease[s] >= 0 || x.A.flags[s] & AgentFlag.sick) n++;
  return n / m.length;
}

/** a live disaster of these kinds covering the settlement */
function disasterOn(u: Universe, p: Planet, st: Settlement, kinds: string[]): boolean {
  for (const d of u.god.disasters) if (d.planet === p.id && kinds.includes(d.kind) && distM(p, d.pos, st.pos) <= effR(d) + st.territory) return true;
  return false;
}

/** a war band or raiders on their way (or at the gates) within 1 km */
function threatened(x: PCtx, st: Settlement): boolean {
  for (const m of x.ps.missions) {
    if ((m.kind !== 'war' && m.kind !== 'raid') || m.to !== st.id || m.phase < 1 || m.phase > 2) continue;
    for (const id of m.members) {
      const s = x.A.slotOf(id);
      if (s < 0) continue;
      const pt = [0, 0, 0];
      x.A.posAt(s, x.tick, pt);
      if (distM(x.p, pt, st.pos) < 1000 + st.territory) return true;
    }
  }
  return false;
}

/** mean warmth need of the members (1 warm .. 0 freezing) */
function warmth(x: PCtx, st: Settlement): number {
  const m = x.ps.members.get(st.id) ?? [];
  if (!m.length) return 1;
  let w = 0;
  for (const s of m) w += x.A.needs[s * NEED_N + NEED.warmth];
  return w / m.length;
}

/** the fields' soil moisture (mean over the farmed cells; 1 with no fields) */
function fieldMoisture(x: PCtx, st: Settlement): number {
  if (!st.fields.length) return 1;
  let m = 0;
  for (const c of st.fields) m += x.p.f.moisture[c];
  return m / st.fields.length;
}

/** is it the growing season here (the warm half of the year: the sun high at noon) */
function growing(x: PCtx, st: Settlement): boolean {
  return x.p.f.temperature[st.cell] > 8;
}

/**
 * Hourly per settlement: hardship 0..1 (kept on the record) and the prayers it raises from its real state; lapsed
 * prayers fall due. Returns the hardship.
 */
export function prayersHourly(x: PCtx, st: Settlement, night: boolean): number {
  const u = x.u, p = x.p;
  const r = srel(u, p.id, st.id);
  const P = Math.max(1, people(x, st));
  const days = foodDays(x, st) / P;
  const sick = sickShare(x, st);
  const storm = stormSeverity(x, st.pos, st.cell);
  const drought = disasterOn(u, p, st, ['drought', 'dust-bowl', 'heat-wave']);
  const dry = growing(x, st) && fieldMoisture(x, st) < 0.15;
  if (dry) r.since.dry ??= x.tick; else delete r.since.dry;
  const plague = !!st.cohort.sick || disasterOn(u, p, st, ['plague']);
  const famine = st.recent.famineAt !== undefined && x.tick - st.recent.famineAt < 3 * x.day;
  // a disaster on the town within 2 days: the god's harm on its record, or one raging over it now
  let struck = disasterOn(u, p, st, ['meteor', 'volcano', 'quake', 'tornado', 'hurricane', 'flood', 'tsunami', 'wildfire', 'firestorm', 'plague', 'drought', 'blight', 'swarm', 'infestation']);
  for (const a of r.acts) if (a.kind === 'harm' && x.tick - a.tick <= 2 * x.day) struck = true;
  if (r.evacuate && r.evacuate.until > x.tick) struck = true;
  const h = Math.max(struck ? 1 : 0, famine || days < 1 ? 1 : days < 2 ? 0.4 : 0, Math.min(1, sick * 3), storm, drought ? 0.8 : 0, dry && x.tick - (r.since.dry ?? x.tick) >= x.day ? 0.5 : 0);
  r.since.hard = Math.round(h * 1000) / 1000;
  // lapsed prayers
  for (const pr of r.prayers.slice()) if (pr.until <= x.tick) lapse(x, st, pr);
  // new prayers (at most 2 open; the same kind is not raised again within a day of its last)
  if (st.band || r.prayers.length >= 2) return h;
  const want: [PrayerKind, number][] = [];
  if (days < 1.5 || famine) want.push(['food', Math.min(1, (1.5 - Math.min(1.5, days)) / 1.5 + (famine ? 0.5 : 0))]);
  if (drought || (dry && x.tick - (r.since.dry ?? x.tick) >= 2 * x.day)) want.push(['rain', drought ? 0.8 : 0.5]);
  if (sick >= 0.1 || plague) want.push(['healing', Math.min(1, sick * 3 + (plague ? 0.3 : 0))]);
  const cold = disasterOn(u, p, st, ['ice-age', 'impact-winter']) || coldWeather(x, st);
  if ((night && warmth(x, st) < 0.3) || cold) want.push(['warmth', 0.7]);
  const danger = threatened(x, st) || (r.evacuate !== null && r.evacuate.until > x.tick) || storm > 0.6 || (st.res?.danger ?? -1) >= 0 && st.recent.predator !== undefined && x.tick - st.recent.predator < x.day;
  if (danger) want.push(['protection', 0.9]);
  const bs = x.ps.of(st.id).filter((b) => b.progress >= 1);
  const ruined = bs.length ? bs.filter((b) => b.flags & 2).length / bs.length : 0;
  if (ruined >= 0.25) want.push(['rebuilding', Math.min(1, ruined * 2)]);
  want.sort((a, b) => b[1] - a[1] || PRAYER_KINDS.indexOf(a[0]) - PRAYER_KINDS.indexOf(b[0]));
  for (const [kind, urgency] of want) {
    if (r.prayers.length >= 2) break;
    if (r.prayers.some((q) => q.kind === kind)) continue;
    const last = r.since[`p:${kind}`];
    if (last !== undefined && x.tick - last < x.day) continue;
    raise(x, st, kind, urgency);
  }
  return h;
}

/** a blizzard, a cold snap or snow over the settlement */
function coldWeather(x: PCtx, st: Settlement): boolean {
  for (const w of x.p.weather) {
    const id = x.c.weather.list[w.kind]?.id;
    if ((id === 'blizzard' || id === 'cold-snap') && distM(x.p, w.pos, st.pos) <= w.radius + st.territory) return true;
  }
  return x.p.f.temperature[st.cell] < -12;
}

function raise(x: PCtx, st: Settlement, kind: PrayerKind, urgency: number): void {
  const u = x.u;
  const R = relOf(u);
  const r = srel(u, x.p.id, st.id);
  const pr: Prayer = { id: R.next++, kind, since: x.tick, until: x.tick + WINDOW[kind] * x.day, urgency: Math.round(urgency * 1000) / 1000, god: 0 };
  r.prayers.push(pr);
  r.since[`p:${kind}`] = x.tick;
  relStat(u, 'prayers.raised');
  if (urgency >= 0.5) tell(u, x.p, 'prayer.raised', vars(x, st, -1, { prayer: PRAYER_WORDS[kind] }), st, [settlementRef(x, st)], 1);
  u.emit({ t: 'prayer.raised', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, prayer: pr.id, kind, until: pr.until, urgency: pr.urgency } });
}

function lapse(x: PCtx, st: Settlement, pr: Prayer): void {
  const u = x.u;
  const r = srel(u, x.p.id, st.id);
  r.prayers = r.prayers.filter((q) => q !== pr);
  r.lapses++;
  relStat(u, 'prayers.lapsed');
  moveSettlement(x, st, { faith: -0.03, trust: -0.05, loyalty: -0.02 });
  tell(u, x.p, 'prayer.lapsed', vars(x, st, -1, { prayer: PRAYER_WORDS[pr.kind] }), st, [settlementRef(x, st)], 1);
  u.emit({ t: 'prayer.lapsed', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, prayer: pr.id, kind: pr.kind } });
  if (r.lapses % 3 === 0) {
    tell(u, x.p, 'prayer.deaf', vars(x, st), st, [settlementRef(x, st)], 2);
    for (const ph of relOf(u).prophets) if (ph.planet === x.p.id && ph.settlement === st.id) ph.credibility = Math.max(0, Math.round((ph.credibility - 0.1) * 1000) / 1000);
  }
}

// ───────────────────────────── answers ─────────────────────────────

/** an act of a god as prayers and prophecies read it: what it gives (or does), where, how far */
export interface ActInfo {
  /** 'food' | 'rain' | 'healing' | 'warmth' | 'protection' | 'rebuilding' | 'harm' | 'sign' */
  kind: string;
  planet: number;
  pos: [number, number, number] | null;
  /** metres around pos it reaches (a world-wide act: Infinity) */
  radius: number;
  god: number;
  /** a settlement it was aimed at (-1 none) */
  settlement: number;
}

/** does an act reach a settlement (its territory + 200 m) */
export function actReaches(p: Planet, st: Settlement, a: ActInfo): boolean {
  if (a.planet !== p.id) return false;
  if (a.settlement === st.id) return true;
  if (!a.pos) return a.radius === Infinity;
  return distM(p, a.pos, st.pos) <= a.radius + st.territory + 200;
}

/** the god's acts answer the open prayers they reach (god/relationship.ts calls this for every act) */
export function answerPrayers(u: Universe, p: Planet, acts: ActInfo[]): number {
  if (!acts.length || !p.people?.settlements.length) return 0;
  const R = u.god.rel;
  if (!R) return 0;
  let n = 0;
  for (const st of p.people.settlements) {
    if (st.fallen >= 0) continue;
    const r = R.st[`${p.id}:${st.id}`];
    if (!r || !r.prayers.length) continue;
    for (const pr of r.prayers.slice()) {
      const a = acts.find((q) => q.kind === pr.kind && q.god === pr.god && actReaches(p, st, q));
      if (!a) continue;
      answered(makeCtx(u, p), st, pr);
      n++;
    }
  }
  return n;
}

function answered(x: PCtx, st: Settlement, pr: Prayer): void {
  const u = x.u;
  const r = srel(u, x.p.id, st.id);
  r.prayers = r.prayers.filter((q) => q !== pr);
  r.lapses = 0;
  relStat(u, 'prayers.answered');
  moveSettlement(x, st, { faith: 0.1, trust: 0.15, loyalty: 0.05 });
  tell(u, x.p, 'prayer.answered', vars(x, st, -1, { prayer: PRAYER_WORDS[pr.kind] }), st, [settlementRef(x, st)], 2);
  u.emit({ t: 'prayer.answered', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, prayer: pr.id, kind: pr.kind } });
}

/** the canonical answer to a prayer: the command the god would give (prayer.answer dispatches it) */
export function canonicalAnswer(p: Planet, st: Settlement, kind: string): Command {
  const pos = [st.pos[0], st.pos[1], st.pos[2]];
  const R = Math.round(st.territory + 150);
  switch (kind) {
    case 'food': return { k: 'miracle.food', pos, radius: R, planet: p.id };
    case 'rain': return { k: 'miracle.water', pos, radius: R, planet: p.id };
    case 'healing': return { k: 'miracle.heal', pos, radius: R, planet: p.id };
    case 'warmth': return { k: 'miracle.fire', pos, radius: R, planet: p.id };
    case 'protection': return { k: 'miracle.shield', pos, radius: R + 100, planet: p.id };
    default: return { k: 'miracle.wood', pos, radius: R, planet: p.id };
  }
}

/** the open prayers of every settlement of a world (query 'prayers', SettlementView.prayers) */
export function prayersOf(u: Universe, p: Planet): { settlement: number; name: string; prayers: Prayer[] }[] {
  const out: { settlement: number; name: string; prayers: Prayer[] }[] = [];
  for (const st of p.people?.settlements ?? []) {
    const r = u.god.rel?.st[`${p.id}:${st.id}`];
    if (!r || !r.prayers.length || st.fallen >= 0) continue;
    out.push({ settlement: st.id, name: st.name, prayers: r.prayers.map((q) => ({ ...q })) });
  }
  return out;
}

export function hardshipOf(u: Universe, planet: number, sid: number): number {
  return u.god.rel?.st[`${planet}:${sid}`]?.since.hard ?? 0;
}
