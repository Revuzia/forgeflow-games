// GENESIS — ARC §5.6 legends and the words of each tongue (stage C3): `wordFor` (a town's own word for the god, the
// tower, the flood, the bow: a pure hash of its tongue), and the legends a town makes of its heaviest remembered arc
// event, 12 years after it and then once a generation, drifting as they are retold (numbers grow into story numbers,
// the place moves home, the god's name becomes their word, a cause is added from the town's memory, the town's heart
// colours the telling). The first retelling of an event in a town restores the memory tally it raised to
// max(current, 0.6 × peak), once per event per town (§0.4). Composition keeps every legend within 140 characters.
//
// Deterministic: towns in `ps.settlements` order, once a year per town on its hashed year-day, hashFloat with the salts
// 0x1e9e (drift) and 0x1e9f (variant). No Math.random, no Date, no Map-iteration order.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { Content } from '../content.ts';
import type { AgeRecord, ArcEvent, Legend, Memory, SettlementRel } from './state.ts';
import { hash32, hashFloat, hashStr } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { phonologyOf, word } from '../people/names.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { peekRel, relOf, relStat } from './regard.ts';
import { emptyMemory } from './arc.ts';
import { numWords } from './covenant.ts';
import scripture from '../../data/scripture.json' with { type: 'json' };

type Sc = { legend: Record<string, string[]>; legendCause: Record<string, string>; legendHeart: Record<string, string>; storyNumbers: string[] };
const S = scripture as unknown as Sc;

export const LEGENDS = { firstYears: 12, genYears: 25, max: 6, refresh: 0.6, cap: 140 };

export type Concept = 'god' | 'tower' | 'flood' | 'bow';
/** §5.6 a town's own word for a concept: `word(phonologyOf(c, species), language, hashStr(concept) ^ 0x60d, 2, 3)` */
export function wordFor(c: Content, st: Settlement, concept: Concept): string {
  return word(phonologyOf(c, st.species), st.language, hashStr(concept) ^ 0x60d, 2, 3);
}

/** how heavy an event is to remember (the heaviest is retold) */
const WEIGHT: Partial<Record<ArcEvent['kind'], number>> = { great: 3, strike: 3, confuse: 3, covenant: 3, broken: 3, tower: 2, warn: 2, let: 2, silence: 2,
  firstwrong: 2, kept: 2, wandering: 2, othergods: 2, answer: 1, defiance: 1 };
/** the memory tally an event raised in a town */
function tallyOf(e: ArcEvent): keyof Omit<Memory, 'peak' | 'refreshed'> {
  if (e.kind === 'confuse') return 'humbled';
  if (e.kind === 'broken') return 'betrayed';
  if (e.kind === 'covenant' || e.kind === 'kept') return 'kept';
  if (e.kind === 'tower' || e.kind === 'let' || e.kind === 'silence') return 'proud';
  if (e.god === 'mercy' || e.god === 'patience' || e.god === 'sign' || e.god === 'wrath') return e.god;
  return 'wrath';
}

function yearTicks(p: Planet): number {
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  return Math.max(day, Math.round(p.st.orbit.period));
}
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] !== undefined ? String(v[k]) : m));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** relationshipDaily: each town once a year (its hashed year-day) — peaks noted, a legend retold when one is due */
export function legendsDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  const R = u.god.rel;
  if (!ps || !R?.arcEvents?.length) return;
  curU = u;
  const x = makeCtx(u, p);
  const yd = Math.max(1, Math.round(x.year / x.day));
  const dayIdx = Math.floor(x.tick / x.day);
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const r = peekRel(u, p.id, st.id);
    if (!r?.memEvents?.length) continue;
    notePeaks(r);
    if (dayIdx % yd !== hash32(st.id, p.id, 0x1e9f) % yd) continue;
    retell(u, p, st, r, x.year);
  }
}

/** the peak of each linked event's tally (its value when the town first held the event) */
function notePeaks(r: SettlementRel): void {
  const mem = (r.memory ??= emptyMemory());
  const R = r.memEvents!;
  if ((r.since.lgN ?? 0) === R.length) return;
  r.since.lgN = R.length;
  const peak = (mem.peak ??= {});
  for (const id of R) if (peak[String(id)] === undefined) peak[String(id)] = Math.max(1, Math.round(1000 * (mem[tallyOfId(id)] ?? 0)) / 1000);
}
let tallyCache: Map<number, ArcEvent> | null = null;
let tallyCacheLen = -1;
let tallyCacheU: Universe | null = null;
function eventById(u: Universe, id: number): ArcEvent | undefined {
  const l = u.god.rel?.arcEvents ?? [];
  if (tallyCacheU !== u || tallyCacheLen !== l.length || !tallyCache) { tallyCache = new Map(l.map((e) => [e.id, e] as const)); tallyCacheLen = l.length; tallyCacheU = u; }
  return tallyCache.get(id);
}
let curU: Universe | null = null;
function tallyOfId(id: number): keyof Omit<Memory, 'peak' | 'refreshed'> {
  const e = curU ? eventById(curU, id) : undefined;
  return e ? tallyOf(e) : 'wrath';
}

function retell(u: Universe, p: Planet, st: Settlement, r: SettlementRel, year: number): void {
  curU = u;
  const legends = (r.legends ??= []);
  let best: { e: ArcEvent; w: number; gen: number } | null = null;
  for (const id of r.memEvents ?? []) {
    const e = eventById(u, id);
    if (!e || e.planet !== p.id || u.tick - e.tick < LEGENDS.firstYears * year) continue;
    const last = legends.filter((l) => l.event === id).pop();
    if (last && u.tick - last.told < LEGENDS.genYears * year) continue;
    const w = (WEIGHT[e.kind] ?? 1) + Math.min(2, e.dead / 10);
    if (!best || w > best.w || (w === best.w && e.id < best.e.id)) best = { e, w, gen: last ? last.gen + 1 : 1 };
  }
  if (!best) return;
  const x = makeCtx(u, p);
  const text = compose(u, x.c, p, st, r, best.e, best.gen);
  const R = relOf(u);
  const lg: Legend = { id: R.next++, event: best.e.id, town: st.id, gen: best.gen, text, told: u.tick };
  legends.push(lg);
  if (legends.length > LEGENDS.max) {
    // the oldest and lightest goes
    let k = 0;
    const wOf = (l: Legend) => WEIGHT[eventById(u, l.event)?.kind ?? 'answer'] ?? 1;
    for (let i = 1; i < legends.length; i++) if (wOf(legends[i]) < wOf(legends[k]) || (wOf(legends[i]) === wOf(legends[k]) && legends[i].told < legends[k].told)) k = i;
    legends.splice(k, 1);
  }
  // §0.4 legend keeper: the first retelling of an event here restores its tally, once
  const mem = (r.memory ??= emptyMemory());
  const done = (mem.refreshed ??= []);
  if (!done.includes(best.e.id)) {
    done.push(best.e.id); done.sort((a, b) => a - b);
    const key = tallyOf(best.e);
    const peak = mem.peak?.[String(best.e.id)] ?? 1;
    mem[key] = Math.round(1000 * Math.max(mem[key], LEGENDS.refresh * peak)) / 1000;
  }
  relStat(u, 'legend.retold');
  u.emit({ t: 'legend.retold', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], data: { settlement: st.id, legend: lg.id } });
  tell(u, p, 'legend.retold', vars(x, st, -1, { legend: text }), st, [settlementRef(x, st)], 1);
}

/** a story number at or above n, grown `steps` steps */
function storyNumber(n: number, steps: number): string {
  const l = S.storyNumbers; // seven, twelve, forty, a hundred, a thousand
  const vals = [7, 12, 40, 100, 1000];
  let i = vals.findIndex((v) => v >= n);
  if (i < 0) i = vals.length - 1;
  return l[Math.min(vals.length - 1, i + Math.max(0, steps - 1))];
}

/** the legend's text at this generation: the base telling plus 1-2 drifts a generation, cut to 140 characters */
export function compose(u: Universe, c: Content, p: Planet, st: Settlement, r: SettlementRel, e: ArcEvent, gen: number): string {
  const key = e.kind === 'great' ? (/^The Flood\b/.test(e.name) ? 'flood' : /^The Burning\b/.test(e.name) ? 'fire' : 'ruin') : e.kind;
  const variants = S.legend[key] ?? S.legend.answer;
  const base = variants[hash32(e.id, st.id, 0x1e9f) % variants.length];
  const ps = p.people;
  const placeTown = ps?.settlement(e.ref ?? e.towns[0]) ?? ps?.settlement(e.towns[0]);
  let place = placeTown?.name ?? st.name;
  let god = 'the god';
  let count = e.dead > 0 ? numWords(e.dead) : 'many';
  // the drifts accumulate over the generations (each generation 1-2 more)
  let cause = '';
  for (let g = 2; g <= gen; g++) {
    const h = hashFloat(st.id, e.id, g, 0x1e9e);
    // numbers grow into a story number
    count = storyNumber(Math.max(e.dead, 1), g - 1);
    if (h < 0.5) place = st.name; // the place moves home
    if (h >= 0.3) god = wordFor(c, st, 'god'); // the name becomes their word
  }
  if (gen >= 2) {
    const m = r.memory ?? emptyMemory();
    const top = (['wrath', 'mercy', 'patience'] as const).slice().sort((a, b) => m[b] - m[a])[0];
    if (m[top] > 0.05) cause = S.legendCause[top];
  }
  const kind = r.hearts?.kind;
  let colour = gen >= 1 && kind && kind !== 'quiet' && kind !== 'restless' ? S.legendHeart[kind] ?? '' : '';
  if (kind === 'defiant' && colour) r.defiance = Math.min(1, Math.round(1000 * ((r.defiance ?? 0) + 0.02)) / 1000);
  const core = (withCause: boolean) => {
    let t = fill(base, { place, count, god, tower: wordFor(c, st, 'tower') });
    if (withCause && cause) t = t.replace(/\.$/, `${cause}.`);
    return cap(t);
  };
  const tries = [() => (colour ? fill(colour, { tale: core(true) }) : core(true)), () => core(true), () => core(false)];
  for (const f of tries) { const t = f(); if (t.length <= LEGENDS.cap) return t; }
  colour = '';
  const t = core(false);
  return t.length <= LEGENDS.cap ? t : `${t.slice(0, LEGENDS.cap - 1).replace(/\s+\S*$/, '')}.`;
}

/** the Book's "As it is told now in {town}: ..." line of an age: the newest legend about its event */
export function toldLine(u: Universe, p: Planet, a: AgeRecord, sid?: number): string | undefined {
  if (a.event === undefined) return undefined;
  let best: Legend | null = null, town: Settlement | undefined;
  for (const st of p.people?.settlements ?? []) {
    if (sid !== undefined && st.id !== sid) continue;
    for (const l of peekRel(u, p.id, st.id)?.legends ?? []) if (l.event === a.event && (!best || l.told > best.told)) { best = l; town = st; }
  }
  return best && town ? `As it is told now in ${town.name}: ${best.text}` : undefined;
}
