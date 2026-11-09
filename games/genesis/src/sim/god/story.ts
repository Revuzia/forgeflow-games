// GENESIS — ARC §5 the Book of Ages (stage C2): the spine (annals, godActs, the ArcEvent register), the ages recognised
// from what the sim produced (never scripted, §0.2), the story read back on demand (`query('story')`, pure, never
// stored), the god's epithet, the Generations, and the views (PlanetSnap.age / epithet).
//
// Daily per planet (relationshipDaily, after the towns): one pass over the towns for the means, the first wrong, the
// annals row on a new year, the condition clocks, and the ArcEvents pushed since yesterday. Ages open at once from a
// defining event; a condition age needs its condition held for its span and an open age at least 3 years old. Names
// from data/scripture.json, variant `hash32(planet, tick, hashStr(kind) ^ 0xa9e1) % n`. No Math.random, no Date, no
// Map-iteration order. Old worlds (no `arcSince` at all when first seen): one `making` age and an open age from the
// condition rules, both from the load tick, and the Book's note; their past is not invented.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { PlanetSnap } from '../types.ts';
import type { AgeRecord, ArcEvent, RelState } from './state.ts';
import type { CommandRegistry } from './commands.ts';
import type { ActInfo } from './prayers.ts';
import { hash32, hashStr } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { GODS } from '../people/defs.ts';
import { vars } from '../people/util.ts';
import { langDistance } from '../people/culture.ts';
import { relOf } from './regard.ts';
import { joinNames, VOW_SAYS } from './covenant.ts';
import { rememberWords } from './arc.ts';
import { fail, ok } from './util.ts';
import scripture from '../../data/scripture.json' with { type: 'json' };

type Sc = {
  title: Record<string, string>; opening: Record<string, string>; ages: Record<string, string[]>; ordinal: string[];
  open: Record<string, string>; again: string; nextCall: string; firstwrong: Record<string, string>; plentyEnd: string; next: string; now: string;
  godPart: Record<string, string>; character: { people: Record<string, string>; god: Record<string, string> };
  closing: Record<string, string>; note: string; epithet: Record<string, { name: string; clause: string } | string>;
  generations: Record<string, string>; promise: Record<string, string>;
};
const S = scripture as unknown as Sc;

/** ARC §5 tunables */
export const BOOK = {
  /** a condition age needs the open age at least this old (years); the same kind within this extends the open one */
  minAge: 3,
  annalsMax: 400,
  /** condition spans (years) and thresholds */
  proud: 0.55, proudYears: 2, defiantShare: 0.4, defiantYears: 1, dread: -0.33, dreadYears: 3, trust: 0.33, trustYears: 5,
  silenceYears: 10, wanderShare: 0.25, wanderYears: 3, rivalShare: 0.5, plentyHard: 0.3,
  /** at most this many sentences per age, generations sentences */
  ageSentences: 8, generations: 12,
};

const EVENT_PRI: Record<string, number> = { flood: 0, fire: 0, ruin: 0, scattering: 0, fall: 0, covenant: 0, brokenvow: 0, tower: 1, builders: 1, warning: 2 };
const DARK = new Set(['flood', 'fire', 'ruin', 'fall', 'brokenvow', 'dread', 'defiance', 'silence', 'dark']);

function yearTicks(p: Planet): number {
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  return Math.max(day, Math.round(p.st.orbit.period));
}
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] !== undefined ? String(v[k]) : m));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const r2 = (v: number) => Math.round(v * 100) / 100;

function state(R: RelState, planet: number): Record<string, number> { return ((R.arcSince ??= {})[String(planet)] ??= {}); }
export function godActsOf(u: Universe, planet: number): Record<string, number> { return ((relOf(u).godActs ??= {})[String(planet)] ??= {}); }
export function agesOf(u: Universe, planet: number): AgeRecord[] { return (u.god.rel?.ages ?? []).filter((a) => a.planet === planet); }
function openAgeOf(u: Universe, planet: number): AgeRecord | undefined { return agesOf(u, planet).find((a) => a.ended < 0); }

// ───────────────────────────── godActs ─────────────────────────────

const HELP = new Set(['food', 'rain', 'healing', 'warmth', 'protection', 'rebuilding']);
/** relationship.ts afterAct: the god's command as the Book counts it (help, harm, wrath, mercy, sign, rain), once per act */
export function noteGodAct(u: Universe, p: Planet, list: ActInfo[], killed: boolean): void {
  if (!list.length) return;
  const ga = godActsOf(u, p.id);
  ga.lastAct = u.tick;
  if (list.some((a) => a.kind === 'harm')) {
    ga.harm = (ga.harm ?? 0) + 1;
    if (killed) ga.wrath = (ga.wrath ?? 0) + 1;
    return;
  }
  const help = list.filter((a) => HELP.has(a.kind));
  if (help.length) {
    ga.help = (ga.help ?? 0) + 1;
    if (help.some((a) => a.kind === 'rain')) ga.rain = (ga.rain ?? 0) + 1;
    // struck, then healed: a help to a town the god harmed within two years
    const yr = yearTicks(p);
    const mercy = help.some((a) => { const r = a.settlement !== undefined ? u.god.rel?.st[`${p.id}:${a.settlement}`] : undefined; return r?.lastHarm !== undefined && r.lastHarm >= 0 && u.tick - r.lastHarm <= 2 * yr; });
    if (mercy) ga.mercy = (ga.mercy ?? 0) + 1;
    return;
  }
  if (list.some((a) => a.kind === 'sign')) ga.sign = (ga.sign ?? 0) + 1;
}

// ───────────────────────────── the daily pass ─────────────────────────────

interface Means { pop: number; faith: number; fear: number; trust: number; loyalty: number; pride: number; defiance: number; regard: number;
  defiantPop: number; rivalPop: number; rival: number; hard: number; biggest: Settlement | null }

function means(x: PCtx): Means {
  const m: Means = { pop: 0, faith: 0, fear: 0, trust: 0, loyalty: 0, pride: 0, defiance: 0, regard: 0, defiantPop: 0, rivalPop: 0, rival: -1, hard: 0, biggest: null };
  const A = x.A, R = x.u.god.rel;
  let rn = 0, rs = 0, big = -1;
  const rivals: number[] = new Array(GODS).fill(0);
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const mem = x.ps.members.get(st.id) ?? [];
    const n = mem.length;
    if (!n) continue;
    for (const s of mem) {
      const i = s * GODS;
      m.faith += A.faith[i]; m.fear += A.fear[i]; m.trust += A.love[i]; m.loyalty += A.loyalty[i];
      if (A.faith[i] > 0.2) { rs += A.love[i] - A.fear[i]; rn++; }
    }
    const r = R?.st[`${x.p.id}:${st.id}`];
    m.pride += (r?.pride ?? 0) * n; m.defiance += (r?.defiance ?? 0) * n; m.hard += (r?.since.hard ?? 0) * n;
    if (r?.hearts?.kind === 'defiant') m.defiantPop += n;
    if (st.god > 0) { m.rivalPop += n; rivals[st.god] += n; }
    m.pop += n;
    if (n > big) { big = n; m.biggest = st; }
  }
  if (m.pop) for (const k of ['faith', 'fear', 'trust', 'loyalty', 'pride', 'defiance', 'hard'] as const) m[k] /= m.pop;
  m.regard = rn ? rs / rn : 0;
  let bg = 0;
  for (let g = 1; g < GODS; g++) if (rivals[g] > bg) { bg = rivals[g]; m.rival = g; }
  return m;
}

/** relationshipDaily (every planet, after the towns): annals, silence years, the first wrong, wandering, ages */
export function storyDaily(u: Universe, p: Planet): void {
  const R = relOf(u);
  const x = makeCtx(u, p);
  const yr = x.year;
  // the first time any planet is seen: an old world (no arc state at all, well past its first days) is marked (§7)
  const G = ((R.arcSince ??= {}).g ??= { at: u.tick, old: u.tick > 30 * 1440 ? 1 : 0 });
  const S = state(R, p.id);
  if (S.init === undefined) {
    S.init = u.tick;
    S.chr = u.chronicle.length;
    // its past is not invented: the planets of an old world, first seen at its load, start from now
    const old = G.old === 1 && u.tick - G.at <= 2 * x.day;
    S.ev = old ? R.next : 0;
    if (old) S.mig = u.tick;
    let starved = 0;
    for (const st of p.people?.settlements ?? []) starved += st.stats.starved;
    S.starved0 = starved;
  }
  if (!p.people) { making(u, p, S); return; }
  const m = means(x);
  const cal = p.calendar(u.tick);
  const ga = godActsOf(u, p.id);
  // §5.1 annals: one row a year
  if (S.annY === undefined) S.annY = cal.year - 1;
  if (cal.year > S.annY && m.pop) {
    S.annY = cal.year;
    const row = [cal.year, r2(m.regard), r2(m.faith), r2(m.fear), r2(m.trust), r2(m.loyalty), r2(m.pride), r2(m.defiance), m.pop];
    const A = ((R.annals ??= {})[String(p.id)] ??= []);
    A.push(row);
    if (A.length > BOOK.annalsMax) A.splice(0, A.length - BOOK.annalsMax);
    // silence years: a year with no god-0 act on the planet
    if (ga.lastAct === undefined || u.tick - ga.lastAct >= yr) ga.silenceYears = (ga.silenceYears ?? 0) + 1;
    ga.years = (ga.years ?? 0) + 1;
  }
  // wandering: households that moved home, a rolling 3-year count
  if (S.wN) S.wN = Math.round(S.wN * Math.pow(0.5, x.day / (BOOK.wanderYears * yr / 2)) * 1000) / 1000;
  firstWrong(u, p, x, S);
  making(u, p, S);
  if (S.mig !== undefined && !S.migDone) { migrated(u, p, x, S, m); return; }
  // the ArcEvents pushed since yesterday: the defining event of the day by precedence
  let best: { kind: string; ev: ArcEvent; place?: Settlement } | null = null;
  const evs = R.arcEvents ?? [];
  for (let i = evs.length - 1; i >= 0 && evs[i].id >= (S.ev ?? 0); i--) {
    const e = evs[i];
    if (e.planet !== p.id) continue;
    const k = ageKindOf(u, e);
    if (!k) continue;
    if (!best || EVENT_PRI[k] < EVENT_PRI[best.kind] || (EVENT_PRI[k] === EVENT_PRI[best.kind] && e.id > best.ev.id)) best = { kind: k, ev: e, place: placeOf(u, p, e) };
  }
  S.ev = R.next;
  if (best) { openAge(u, p, best.kind, { place: best.place, event: best.ev.id }); return; }
  conditionAges(u, p, x, S, m);
}

function making(u: Universe, p: Planet, S: Record<string, number>): void {
  if (S.made || !Object.keys(p.firsts).length) return;
  S.made = 1;
  const R = relOf(u);
  const a: AgeRecord = { id: R.next++, planet: p.id, kind: 'making', name: ageName(u, p, 'making', 0, {}), begun: 0, ended: -1, n: 1 };
  (R.ages ??= []).push(a);
}

/** the ArcEvent's age kind (or none) */
function ageKindOf(u: Universe, e: ArcEvent): string | null {
  switch (e.kind) {
    case 'great': return /^The Flood\b/.test(e.name) ? 'flood' : /^The Burning\b/.test(e.name) ? 'fire' : 'ruin';
    case 'tower': return 'tower';
    case 'confuse': return 'scattering';
    case 'strike': return 'fall';
    case 'warn': return 'warning';
    case 'covenant': return 'covenant';
    case 'broken': return 'brokenvow';
    case 'let': case 'silence': return (u.god.rel?.towers ?? []).some((t) => t.id === e.ref && (t.status === 'finished')) || e.kind === 'let' ? 'builders' : null;
    default: return null;
  }
}
function placeOf(u: Universe, p: Planet, e: ArcEvent): Settlement | undefined {
  const ps = p.people;
  if (!ps) return undefined;
  if (e.kind === 'great') return ps.settlement(e.ref ?? e.towns[0]);
  const tw = (u.god.rel?.towers ?? []).find((t) => t.id === e.ref);
  if (tw) return ps.settlement(tw.host);
  return ps.settlement(e.towns[0]);
}

/** §5.2 the first wrong: a god-0 harm on the planet, a war, a death by famine. Closes `plenty` with its line. */
function firstWrong(u: Universe, p: Planet, x: PCtx, S: Record<string, number>): void {
  if (S.fw !== undefined) { S.chr = u.chronicle.length; return; }
  let cause: string | null = null, town: Settlement | undefined;
  for (const st of x.ps.settlements) {
    const r = u.god.rel?.st[`${p.id}:${st.id}`];
    if (r?.acts.some((a) => a.kind === 'harm' && a.god === 0 && !a.natural)) { cause = 'harm'; town = st; break; }
  }
  if (!cause) {
    for (let i = S.chr ?? 0; i < u.chronicle.length; i++) if (u.chronicle[i].planet === p.id && u.chronicle[i].kind === 'war') { cause = 'war'; break; }
  }
  S.chr = u.chronicle.length;
  if (!cause) {
    let starved = 0;
    for (const st of x.ps.settlements) { starved += st.stats.starved; if (!town && st.stats.starved > 0) town = st; }
    if (starved > (S.starved0 ?? 0)) cause = 'famine';
  }
  if (!cause) return;
  S.fw = u.tick;
  const R = relOf(u);
  const name = town?.name ?? x.ps.settlements.find((s) => s.fallen < 0)?.name ?? '';
  const ev: ArcEvent = { id: R.next++, planet: p.id, tick: u.tick, kind: 'firstwrong', name: 'The First Wrong', towns: town ? [town.id] : [], god: cause === 'harm' ? 'wrath' : 'none', dead: 0 };
  (R.arcEvents ??= []).push(ev);
  const open = openAgeOf(u, p.id);
  if (open?.kind === 'plenty') {
    open.ended = u.tick;
    open.closing = fill(sc().plentyEnd, { cause: fill(sc().firstwrong[cause], { town: name }) });
  }
}
const sc = () => S;

function hold(S: Record<string, number>, key: string, cond: boolean, tick: number, span: number): boolean {
  if (!cond) { delete S[key]; return false; }
  S[key] ??= tick;
  return tick - S[key] >= span;
}

/** §5.2 condition ages, checked daily; the first that holds (and may open) opens */
function conditionAges(u: Universe, p: Planet, x: PCtx, S: Record<string, number>, m: Means): void {
  const yr = x.year, t = u.tick;
  const ga = godActsOf(u, p.id);
  const open = openAgeOf(u, p.id);
  const all = agesOf(u, p.id);
  // the clocks run every day, whether or not an age may open
  const c = {
    plenty: S.fw === undefined && !all.some((a) => a.kind !== 'making') && m.pop > 0 && m.hard < BOOK.plentyHard,
    defiance: hold(S, 'cDef', m.pop > 0 && m.defiantPop >= BOOK.defiantShare * m.pop, t, BOOK.defiantYears * yr),
    dread: hold(S, 'cDread', m.pop > 0 && m.regard < BOOK.dread, t, BOOK.dreadYears * yr),
    proud: hold(S, 'cProud', m.pop > 0 && m.pride >= BOOK.proud, t, BOOK.proudYears * yr),
    trust: hold(S, 'cTrust', m.pop > 0 && m.regard > BOOK.trust, t, BOOK.trustYears * yr),
    othergods: m.pop > 0 && m.rivalPop >= BOOK.rivalShare * m.pop,
    wandering: m.pop > 0 && (S.wN ?? 0) >= BOOK.wanderShare * m.pop,
    silence: t - (ga.lastAct ?? S.init ?? 0) >= BOOK.silenceYears * yr && m.pop > 0,
    golden: m.biggest?.age?.kind === 'golden',
    dark: m.biggest?.age?.kind === 'dark',
  };
  if (c.plenty && !open?.kind.match(/^(plenty)$/) && (!open || open.kind === 'making')) { openAge(u, p, 'plenty', { place: x.ps.settlements.find((s) => s.fallen < 0 && !s.band) }); return; }
  if (open && open.kind !== 'making' && t - open.begun < BOOK.minAge * yr) return;
  // a condition age stays while its condition holds, unless a stronger one comes (this order, strongest first)
  const order: (keyof typeof c)[] = ['defiance', 'dread', 'othergods', 'wandering', 'proud', 'golden', 'dark', 'trust', 'silence', 'plenty'];
  const rank = open ? order.indexOf(open.kind as keyof typeof c) : -1;
  const openHolds = rank >= 0 && c[open!.kind as keyof typeof c];
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (k === 'plenty') break;
    if (!c[k] || open?.kind === k) continue;
    if (openHolds && i >= rank) break;
    // the same kind cannot reopen within 3 years of its last ending
    const last = all.filter((a) => a.kind === k).pop();
    if (last && last.ended >= 0 && t - last.ended < BOOK.minAge * yr) continue;
    const place = k === 'golden' || k === 'dark' ? m.biggest ?? undefined : undefined;
    if (k === 'wandering' || k === 'othergods') {
      const R = relOf(u);
      (R.arcEvents ??= []).push({ id: R.next++, planet: p.id, tick: t, kind: k, name: k === 'wandering' ? 'The Wandering' : 'The Other Gods', towns: [], god: 'none', dead: 0 });
      S.ev = R.next;
    }
    openAge(u, p, k, { place, rival: m.rival });
    return;
  }
}

/** an old world's first look: one `making` age is there; the open age is the first condition that holds, from now */
function migrated(u: Universe, p: Planet, x: PCtx, S: Record<string, number>, m: Means): void {
  S.migDone = 1;
  if (!m.pop) return;
  const harmed = x.ps.settlements.some((st) => u.god.rel?.st[`${p.id}:${st.id}`]?.acts.some((a) => a.kind === 'harm' && a.god === 0));
  const ga = godActsOf(u, p.id);
  const k = m.regard < BOOK.dread ? 'dread' : m.regard > BOOK.trust ? 'trust'
    : ga.lastAct === undefined && !harmed && u.tick > BOOK.silenceYears * x.year ? 'silence'
    : !harmed ? 'plenty' : m.biggest?.age?.kind === 'dark' ? 'dark' : 'golden';
  if (harmed) S.fw = u.tick;
  const mk = agesOf(u, p.id).find((a) => a.kind === 'making');
  if (mk && mk.ended < 0) mk.ended = u.tick;
  openAge(u, p, k, { place: m.biggest ?? undefined, quiet: true });
}

/** open an age now (closing the open one), unless the same kind is open and younger than 3 years (it extends) */
export function openAge(u: Universe, p: Planet, kind: string, o: { place?: Settlement; event?: number; rival?: number; quiet?: boolean; force?: boolean } = {}): AgeRecord | null {
  const R = relOf(u);
  const yr = yearTicks(p);
  const open = openAgeOf(u, p.id);
  if (!o.force && open && open.kind === kind && u.tick - open.begun < BOOK.minAge * yr) return null;
  const n = agesOf(u, p.id).filter((a) => a.kind === kind).length + 1;
  const people = o.place && p.people ? String(vars(makeCtx(u, p), o.place).people) : 'people';
  const rival = o.rival !== undefined && o.rival > 0 ? u.god.gods[o.rival]?.name ?? 'another god' : 'another god';
  const name = ageName(u, p, kind, n, { town: o.place?.name ?? p.name, people: cap(people), rival });
  if (open) {
    open.ended = u.tick;
    open.closing ??= nextLine(name);
  }
  const a: AgeRecord = { id: R.next++, planet: p.id, kind, name, begun: u.tick, ended: -1, n };
  if (o.place) a.place = o.place.id;
  if (o.event !== undefined) a.event = o.event;
  (R.ages ??= []).push(a);
  if (!o.quiet) {
    u.chronicleAdd(p, 'age', `So began ${name}.`, 3);
    u.emit({ t: 'chronicle.age', planet: p.id, data: { age: a.id, kind, name, tone: DARK.has(kind) ? 'dark' : 'golden' } });
  }
  return a;
}

/** "And then began the Flood of Aru." / "And then came the time they call When the God Walked Near." */
function nextLine(name: string): string {
  return name.startsWith('The ') ? fill(S.next, { name: name.replace(/^The /, 'the ') }) : fill(S.nextCall, { name });
}

/** "The Flood of Aru"; the second "The Second Flood of Aru" */
function ageName(u: Universe, p: Planet, kind: string, n: number, v: Record<string, string>): string {
  const l = S.ages[kind] ?? [cap(kind)];
  const base = fill(l[hash32(p.id, u.tick, hashStr(kind) ^ 0xa9e1) % l.length], v);
  if (n < 2) return base;
  const ord = S.ordinal[n] ?? String(n);
  return /^The (Flood|Burning|Ruin|Breaking|Fall|Scattering|Warning|Wandering|Golden|Dark)\b/.test(base) ? `The ${ord} ${base.slice(4)}` : `${base}, a ${ord} Time`;
}

/** relationship.ts: households that moved home (fear migration, the scattering) count toward a wandering */
export function noteWandering(u: Universe, planet: number, people: number): void {
  const S = state(relOf(u), planet);
  S.wN = (S.wN ?? 0) + people;
}

// ───────────────────────────── characters, epithet ─────────────────────────────

export type PeopleChar = 'fear' | 'trust' | 'pride' | 'defiance' | 'faith' | 'forgetting' | 'many-minds';
export type GodChar = 'wrath' | 'mercy' | 'patience' | 'wonders' | 'silence' | 'faithfulness';

export function peopleCharacter(u: Universe, planet: number): PeopleChar {
  const rows = (u.god.rel?.annals?.[String(planet)] ?? []).slice(-25);
  if (!rows.length) return 'many-minds';
  const mean = (i: number) => rows.reduce((a, r) => a + (r[i] ?? 0), 0) / rows.length;
  const faith = mean(2), fear = mean(3), trust = mean(4), pride = mean(6), def = mean(7);
  if (def >= 0.35) return 'defiance';
  if (pride >= 0.5) return 'pride';
  if (fear - trust > 0.2) return 'fear';
  if (trust - fear > 0.2) return 'trust';
  if (faith >= 0.6) return 'faith';
  if (faith < 0.25) return 'forgetting';
  return 'many-minds';
}

function arcCount(u: Universe, planet: number, kind: ArcEvent['kind']): number {
  return (u.god.rel?.arcEvents ?? []).filter((e) => e.planet === planet && e.kind === kind).length;
}

export function godCharacter(u: Universe, planet: number): GodChar {
  const ga = u.god.rel?.godActs?.[String(planet)] ?? {};
  const p = u.planets.find((q) => q.id === planet);
  const yr = p ? yearTicks(p) : 1;
  const longKept = (u.god.rel?.covenants ?? []).some((c) => c.planet === planet && c.status === 'kept' && c.signAt < 0 && u.tick - c.made >= 20 * yr);
  if (longKept) return 'faithfulness';
  const years = Math.max(1, ga.years ?? 0);
  const score: [GodChar, number][] = [
    ['wrath', (ga.harm ?? 0) + (ga.wrath ?? 0) + arcCount(u, planet, 'strike')],
    ['mercy', ga.mercy ?? 0],
    ['patience', (ga.patience ?? 0) + arcCount(u, planet, 'warn') + arcCount(u, planet, 'let')],
    ['wonders', (ga.sign ?? 0) + Math.max(0, (ga.help ?? 0) - (ga.mercy ?? 0)) * 0.5],
  ];
  if ((ga.silenceYears ?? 0) >= 0.4 * years && (ga.silenceYears ?? 0) >= 1) return 'silence';
  score.sort((a, b) => b[1] - a[1]);
  return score[0][1] > 0 ? score[0][0] : 'silence';
}

/** §5.4 what they call the god: the strongest one or two traits at or above their thresholds, else "the god" */
export function epithetOf(u: Universe, planet: number): string {
  const ga = u.god.rel?.godActs?.[String(planet)] ?? {};
  const p = u.planets.find((q) => q.id === planet);
  const yr = p ? yearTicks(p) : 1;
  const ages = agesOf(u, planet);
  const covs = (u.god.rel?.covenants ?? []).filter((c) => c.planet === planet);
  const keptYears = Math.max(0, ...covs.filter((c) => c.status === 'kept' && c.signAt < 0).map((c) => (u.tick - c.made) / yr));
  const years = Math.max(1, ga.years ?? 0);
  const traits: [string, number][] = [
    ['drowned', ages.filter((a) => a.kind === 'flood').length],
    ['confounder', arcCount(u, planet, 'confuse')],
    ['breaker', arcCount(u, planet, 'strike')],
    ['oathbreaker', (ga.broken ?? 0) * 1.5],
    ['keeper', keptYears / 10],
    ['terrible', ages.filter((a) => a.kind === 'dread').length],
    ['merciful', (ga.mercy ?? 0) / 3],
    ['patient', ((ga.patience ?? 0) + arcCount(u, planet, 'warn') + arcCount(u, planet, 'let')) / 3],
    ['rain', (ga.help ?? 0) >= 4 && (ga.rain ?? 0) >= 0.5 * (ga.help ?? 0) ? (ga.rain ?? 0) / 4 : 0],
    ['silent', years >= 10 && (ga.silenceYears ?? 0) >= 0.6 * years ? (ga.silenceYears ?? 0) / years : 0],
  ];
  const strong = traits.filter((t) => t[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (!strong.length) return S.epithet.none as string;
  const e0 = S.epithet[strong[0][0]] as { name: string; clause: string };
  if (strong.length < 2 || (strong[0][0] === 'keeper' && strong[1][0] === 'oathbreaker') || (strong[0][0] === 'oathbreaker' && strong[1][0] === 'keeper')) return e0.name;
  const e1 = S.epithet[strong[1][0]] as { name: string; clause: string };
  return `${e0.name}, ${e1.clause}`;
}

// ───────────────────────────── the story (pure) ─────────────────────────────

export interface StoryView {
  planet: number; title: string; opening: string;
  people: { character: PeopleChar; line: string };
  god: { character: GodChar; line: string; epithet: string };
  ages: { id: number; name: string; kind: string; from: number; to: number | null; paragraphs: string[]; told?: string }[];
  generations: string[]; promises: string[]; closing: string; note?: string;
  /** additive (town book): what this town remembers of the god, in words */
  remember?: string[];
}

/** the told-now legend line of an age (stage C3 sets this; legends.ts) */
export const storyHooks: { told: ((u: Universe, p: Planet, a: AgeRecord, sid?: number) => string | undefined) | null } = { told: null };

export function storyQuery(u: Universe, args: Record<string, unknown>): StoryView | null {
  const sid = typeof args.settlement === 'number' ? args.settlement : undefined;
  let p = typeof args.planet === 'number' ? u.planets.find((q) => q.id === args.planet) : undefined;
  if (!p && sid !== undefined) p = u.planets.find((q) => q.people?.settlement(sid));
  p ??= (u.focus ? u.planets.find((q) => q.id === u.focus!.planet) : undefined) ?? u.planets.find((q) => q.people?.settlements.length) ?? u.planets[0];
  if (!p) return null;
  return story(u, p, sid);
}

export function story(u: Universe, p: Planet, sid?: number): StoryView {
  const ps = p.people;
  const x = ps ? makeCtx(u, p) : null;
  const town = sid !== undefined ? ps?.settlement(sid) : undefined;
  const main = town ?? ps?.settlements.filter((s) => s.fallen < 0 && !s.band).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0) || a.id - b.id)[0];
  const people = x && main ? String(vars(x, main).people) : 'people';
  const title = town ? fill(S.title.town, { town: town.name }) : fill(S.title.planet, { people, planet: p.name });
  const firsts = ['air', 'sea', 'rain', 'life', 'forest'].filter((k) => p.firsts[k] !== undefined).slice(0, 3);
  const opening = firsts.length ? firsts.map((k) => S.opening[k]).join(' ') : S.opening.none;
  const pc = peopleCharacter(u, p.id), gc = godCharacter(u, p.id);
  const epithet = epithetOf(u, p.id);
  const R = u.god.rel;
  const SA = R?.arcSince?.[String(p.id)];
  let ages = agesOf(u, p.id);
  if (town) ages = ages.filter((a) => a.begun <= (town.fallen >= 0 ? town.fallen : u.tick) && (a.ended < 0 || a.ended >= town.founded));
  // the planet's weighty chronicle, once
  const entries = u.chronicle.filter((e) => e.planet === p.id && e.weight >= 2 && e.kind !== 'age' && (!town || e.refs?.some((r) => r.kind === 'settlement' && r.id === town.id) || e.text.includes(town.name)));
  const all = agesOf(u, p.id);
  const outAges = ages.map((a) => {
    const placeName = a.place !== undefined ? ps?.settlement(a.place)?.name ?? p.name : main?.name ?? p.name;
    const sentences: { w: number; t: number; s: string }[] = [];
    const end = a.ended < 0 ? u.tick : a.ended;
    const seen: Record<string, number> = {};
    for (const e of entries) {
      if (e.tick < a.begun || e.tick > end) continue;
      const s = e.text.replace(/^Year \d+\.\s*/, '');
      const key = s.split(' ').slice(0, 3).join(' ');
      seen[key] = (seen[key] ?? 0) + 1;
      if (seen[key] > 2) continue;
      sentences.push({ w: e.weight, t: e.tick, s });
    }
    const godEv = (R?.arcEvents ?? []).filter((e) => e.planet === p.id && e.tick >= a.begun && e.tick <= end && e.god !== 'none' && e.kind !== 'great')[0];
    let open = fill(S.open[a.kind] ?? '', { town: placeName });
    // from the second great destruction on, an opening may refer back (a 50 % hash choice)
    if ((a.kind === 'flood' || a.kind === 'fire' || a.kind === 'ruin') && hash32(a.id, p.id, 0xa9e2) % 2 === 0) {
      const earlier = all.find((q) => q.begun < a.begun && (q.kind === 'flood' || q.kind === 'fire' || q.kind === 'ruin'));
      if (earlier) open = `${open} ${fill(S.again, { earlier: earlier.name })}`;
    }
    const room = BOOK.ageSentences - (open ? 1 : 0) - (godEv ? 1 : 0) - 1;
    const body = sentences.sort((q, w) => w.w - q.w || q.t - w.t).slice(0, Math.max(0, room)).sort((q, w) => q.t - w.t).map((q) => q.s);
    const closing = a.ended < 0 ? S.now : a.closing ?? nextLine(all.find((q) => q.begun >= a.ended && q.id !== a.id)?.name ?? 'The Next Age');
    const paragraphs = [open, ...body, ...(godEv ? [S.godPart[godEv.god] ?? ''] : []), closing].filter(Boolean);
    const from = p.calendar(a.begun).year, to = a.ended < 0 ? null : p.calendar(a.ended).year;
    const told = storyHooks.told?.(u, p, a, sid);
    return { id: a.id, name: a.name, kind: a.kind, from, to, paragraphs, ...(told ? { told } : {}) };
  });
  const v: StoryView = {
    planet: p.id, title, opening,
    people: { character: pc, line: S.character.people[pc] },
    god: { character: gc, line: S.character.god[gc], epithet },
    ages: outAges,
    generations: generations(u, p, town),
    promises: promises(u, p, town),
    closing: S.closing[gc] ?? S.closing.silence,
  };
  if (SA?.mig !== undefined) v.note = S.note;
  if (town) v.remember = rememberWords(R?.st[`${p.id}:${town.id}`]?.memory);
  return v;
}

/** §5.3 Generations: one sentence per family of towns, oldest root first, largest families first, at most 12 */
function generations(u: Universe, p: Planet, only?: Settlement): string[] {
  const ps = p.people;
  if (!ps) return [];
  const towns = ps.settlements.filter((s) => !s.band);
  const byId = new Map(towns.map((s) => [s.id, s] as const));
  const scattered = new Map<number, number>(); // town -> scattering host
  for (const tw of u.god.rel?.towers ?? []) if (tw.planet === p.id && tw.scatter) for (const id of tw.scatter.towns) scattered.set(id, tw.host);
  const kids = (id: number) => towns.filter((s) => s.parent === id && !scattered.has(s.id)).sort((a, b) => a.founded - b.founded || a.id - b.id);
  const size = (id: number, depth = 0): number => depth > 12 ? 0 : 1 + kids(id).reduce((t, k) => t + size(k.id, depth + 1), 0);
  const roots = towns.filter((s) => s.parent < 0 || !byId.has(s.parent)).sort((a, b) => a.founded - b.founded || size(b.id) - size(a.id) || a.id - b.id);
  const out: string[] = [];
  const ages = agesOf(u, p.id);
  const lost = (s: Settlement) => {
    if (s.fallen < 0) return;
    const a = ages.filter((q) => (q.kind === 'flood' || q.kind === 'fire' || q.kind === 'ruin') && q.begun <= s.fallen && (q.ended < 0 || q.ended >= s.fallen)).pop();
    out.push(a ? fill(S.generations.lost, { town: s.name, age: a.name.replace(/^The /, 'the ') }) : fill(S.generations.gone, { town: s.name }));
  };
  const childWords = (parent: Settlement, l: Settlement[]) => joinNames(l.map((k) => langDistance(k, parent) >= 0.72 ? `${k.name}${S.generations.apart}` : k.name));
  const walk = (st: Settlement, depth: number) => {
    if (out.length >= BOOK.generations || depth > 12) return;
    const l = kids(st.id);
    if (l.length) out.push(fill(S.generations.from, { parent: st.name, children: childWords(st, l) }));
    lost(st);
    for (const k of l) walk(k, depth + 1);
  };
  for (const r of roots) {
    if (only && r.id !== only.id && !isKin(r, only, byId)) continue;
    walk(r, 0);
  }
  const hosts = [...new Set(scattered.values())].sort((a, b) => a - b);
  for (const h of hosts) {
    const host = byId.get(h);
    const l = [...scattered.entries()].filter(([, hh]) => hh === h).map(([id]) => byId.get(id)).filter((s): s is Settlement => !!s);
    if (host && l.length) out.push(fill(S.generations.scatter, { town: host.name, children: joinNames(l.map((s) => s.name)) }));
  }
  return out.slice(0, BOOK.generations).map(cap);
}
function isKin(root: Settlement, t: Settlement, byId: Map<number, Settlement>): boolean {
  let s: Settlement | undefined = t;
  for (let i = 0; s && i < 16; i++) { if (s.id === root.id) return true; s = byId.get(s.parent); }
  return false;
}

/** §5.3 promises: one sentence per covenant */
function promises(u: Universe, p: Planet, only?: Settlement): string[] {
  const yr = yearTicks(p);
  return (u.god.rel?.covenants ?? []).filter((c) => c.planet === p.id && (!only || c.settlements.includes(only.id))).map((c) => {
    const names = joinNames(c.settlements.map((id) => p.people?.settlement(id)?.name).filter((n): n is string => !!n));
    const who = c.household ? c.household.name : `the people of ${names}`;
    const says = VOW_SAYS[c.vow];
    const after = c.after;
    if (c.status === 'broken') return cap(fill(S.promise.broken, { after, who, says, year: p.calendar(c.broken).year }));
    if (c.signAt >= 0) return cap(fill(S.promise.fresh, { after, who, says }));
    const y = Math.floor((u.tick - c.made) / yr);
    const years = y === 1 ? S.promise.yearOne : fill(S.promise.years, { n: y <= 12 ? ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][y] : y });
    return cap(fill(S.promise.kept, { after, who, says, years }));
  });
}

// ───────────────────────────── views, commands ─────────────────────────────

export function storySnap(u: Universe, p: Planet, snap: PlanetSnap): void {
  const l = agesOf(u, p.id);
  const a = l.find((q) => q.ended < 0) ?? l[l.length - 1];
  snap.age = a ? { id: a.id, name: a.name, kind: a.kind, since: a.begun } : null;
  snap.epithet = epithetOf(u, p.id);
}

export function agesQuery(u: Universe, args: Record<string, unknown>): AgeRecord[] {
  return (u.god.rel?.ages ?? []).filter((a) => typeof args.planet !== 'number' || a.planet === args.planet);
}

/** "what kind of god am I": the two character lines and the epithet */
export function characterWords(u: Universe, planet: number): string {
  const pc = peopleCharacter(u, planet), gc = godCharacter(u, planet);
  const e = epithetOf(u, planet);
  return `${S.character.people[pc]} ${S.character.god[gc]}${e !== S.epithet.none ? ` They call you ${e}.` : ''}`;
}

export function registerStoryCommands(r: CommandRegistry): void {
  r.register('arc.age', ({ u, p }, a) => {
    const kind = String(a.kind ?? '');
    if (!S.ages[kind]) return fail(`There is no age of that kind (${Object.keys(S.ages).join(', ')}).`);
    const st = p.people?.settlements.find((s) => s.fallen < 0 && !s.band);
    const age = openAge(u, p, kind, { place: st, force: true });
    return age ? ok(`So began ${age.name}.`) : fail('No age opened.');
  }, { desc: 'Open a named age now (title card shots)', category: 'Debug', params: { kind: { type: 'string', required: true } } });
}
