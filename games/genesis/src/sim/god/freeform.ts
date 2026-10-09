// GENESIS — freeform "do this" (CONTRACT.md §11.6): a deterministic, rule-based interpreter (no network) that turns a
// sentence into Commands WITHOUT applying them — the UI previews the parse ("→ rain · blood · over Aru · 3 days"), then
// the 'freeform' command executes it. Pillar 1: whatever the player asks, it ALWAYS returns something actionable, or a
// clear "here is what I can do with that" with the nearest matches. It never throws, and parsing changes nothing.
//
//   1. split into clauses (", and", "then", ";") — "make it rain blood over Aru for three days and send wolves". Places
//      are shared: when a sentence names one place, every clause acts there ("an earthquake and a wildfire on Aru");
//      otherwise a clause with no place takes the one before it (or, across "and" / ",", the one after it)
//   2. "<n> days ago, <act>" / "yesterday ..." edits the past (time.edit-past around the act)
//   3. per clause, MODIFIERS are lifted out: places ("here" = the cursor point the client last sent, "over Aru",
//      "near Aru", "on the north coast of Aru", "north of Aru", "in the desert", "at the north pole", "on Rust",
//      "everywhere", "all over the world", "lat 10 lon 20"), durations ("for three days", "forever", "that never
//      ends"), quantities ("twenty", "a dozen", "a" = one), intensities ("heavy", "gentle"), sizes ("huge")
//   4. the rest resolves by INTENT, most specific first, so a word never acts against what the sentence asks:
//      a plain question is answered from the world ("how many people live in Aru?", "where is Hesh?", "what time is
//      it?": an ok reply with no commands); save / load / resume; letting go of what the hand holds ("drop him on
//      Lune"); `set <law> to <value>` (with %, named hours, relative words); prohibitions ("forbid war"
//      gives the law of peace, never a war); withdrawals ("remove the horses" takes them away, never makes more);
//      putting out fires; time (hours, days, years, tilt, steps, the sun and the seasons); the live disasters (any verb
//      but an explicit "another" addresses the one already raging); laws of the planet in words ("double the
//      gravity", "spin faster", "no magnetic field"); the air and the colour of the sky; the seas; rivers, roads,
//      mountains, the land; peace and war; named people (every verb: move, silence, possess, throw, teach, make
//      chief, turn into a frog ...); settlements (move, build, ally, trade, love, fear, convert, grow, sicken, starve);
//      the creature; the hand; rival gods; laws; worlds (a world is born only when one is asked for); weather (local,
//      planet-wide, the wind); ideas, inventions and gifts; miracles; death and healing (death always needs a target:
//      with none it asks); species laws; then every power's synonyms (powers.json)
//   5. unknown nouns become NEW CONTENT (god/inventions.ts) only when they are plausibly new things: "introduce
//      chocolate" (an item with guessed tags, and its craft), "invent telepathy" (an idea with an effect from the effect
//      vocabulary), "rain frogs" (a weather that rains a new animal), "release unicorns" (a new animal). Words that are
//      names, verbs, adjectives or powers never become things; then it says what it CAN do, with the nearest powers.
//   6. a clause that is exactly a power's name or synonym (powers.json) means that power, whatever came first
//
// Live names (settlements, people, planets, disasters, creatures, gods) are matched case-insensitively as words — a
// person or town whose name is also an ordinary word ("Rain", "Sun") only when written with a capital mid-sentence.

import type { Command, CommandResult } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { CommandRegistry, CommandSchema } from './commands.ts';
import type { Content, PowerDef } from '../content.ts';
import type { V3 } from './state.ts';
import { allParams, coerceParam, findParam, PARAMS, type ParamDef } from './params.ts';
import { suggest } from '../content.ts';
import { makeCtx } from '../people/ctx.ts';
import { agentName } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { MIRACLES } from './miracles.ts';
import { LAWS } from './acts.ts';
import { LEASH_MODES } from './creature.ts';
import { TEMPERAMENTS } from './rivals.ts';
import { ACTS } from './possess.ts';
import { DISCIPLE_MODES } from './disciples.ts';
import { GOD_ROLES } from './civic.ts';
import { BEARINGS } from './shaping.ts';
import { ROLE } from '../people/defs.ts';
import { relationOf } from '../people/war.ts';
import { meanAnomaly, AU } from '../world/orbits.ts';
import { slug } from './runtime.ts';
import { bearingDir, cellPos3, dot, moveBy, nearestSettlement, norm, placeName } from './util.ts';
import { peopleQuery } from '../people/query.ts';

export interface ParseOut extends CommandResult {
  resolved?: Command[];
}

// ───────────────────────────── lexicon access ─────────────────────────────

interface Lex {
  stop: Set<string>;
  numbers: Record<string, number>;
  durations: Record<string, number | string>;
  intensities: Record<string, number>;
  sizes: Record<string, number>;
  everywhere: string[];
  here: string[];
  directions: Record<string, number>;
  places: Record<string, string>;
  verbs: Record<string, string[]>;
  tags: Record<string, string[]>;
  effects: Record<string, string[]>;
  laws: Record<string, string[]>;
  rains: Record<string, [number, number, number]>;
  animalish: Set<string>;
  abstract: Set<string>;
  /** everyday names of sicknesses -> the disease they are ("influenza" -> wasting-cough) */
  diseases: Record<string, string>;
  /** colour words -> sky tint */
  colours: Record<string, [number, number, number]>;
  /** weather adjectives and plurals -> weather kind ("foggy" -> fog) */
  weatherWords: Record<string, string>;
  /** words for the god's creature: never an invented animal */
  creatureWords: string[];
  /** everyday animal words -> content animals ("fish" -> fish-shoal) */
  animalAliases: Record<string, string>;
  /** words never taken as a name unless capitalised mid-sentence */
  reserved: Set<string>;
}

const lexCache = new WeakMap<Content, Lex>();

function lexOf(c: Content): Lex {
  let l = lexCache.get(c);
  if (l) return l;
  const L = c.lexicon as Record<string, unknown>;
  const obj = <T>(k: string): T => ((L[k] && typeof L[k] === 'object' && !Array.isArray(L[k]) ? L[k] : {}) as T);
  const arr = (k: string): string[] => (Array.isArray(L[k]) ? (L[k] as unknown[]).map(String) : []);
  l = {
    stop: new Set(arr('stopwords')), numbers: obj('numbers'), durations: obj('durations'), intensities: obj('intensities'), sizes: obj('sizes'),
    everywhere: arr('everywhere').sort((a, b) => b.length - a.length), here: arr('here').sort((a, b) => b.length - a.length), directions: obj('directions'),
    places: obj('places'), verbs: obj('verbs'), tags: obj('tags'), effects: obj('effects'), laws: obj('laws'), rains: obj('rains'),
    animalish: new Set(arr('animalish')), abstract: new Set(arr('abstract')), diseases: obj('diseases'), colours: obj('colours'),
    weatherWords: obj('weatherWords'), creatureWords: arr('creatureWords'), animalAliases: obj('animalAliases'), reserved: new Set(arr('reserved')),
  };
  lexCache.set(c, l);
  return l;
}

// ───────────────────────────── nouns ─────────────────────────────

type NounType = 'disaster' | 'weather' | 'animal' | 'species' | 'plant' | 'item' | 'recipe' | 'creature' | 'biome' | 'disease' | 'star' | 'planetkind' | 'miracle' | 'law' | 'material' | 'building';

interface Phrase { text: string; type: NounType; id: string }

const vocabCache = new WeakMap<Content, Phrase[]>();

/** English plural of a word or phrase (last word) */
export function plural(s: string): string {
  const m = s.match(/^(.*?)(\w+)$/);
  if (!m) return s;
  const w = m[2];
  const irregular: Record<string, string> = { mouse: 'mice', goose: 'geese', ox: 'oxen', person: 'people', child: 'children', fish: 'fish', deer: 'deer', sheep: 'sheep', bison: 'bison', aurochs: 'aurochs', cattle: 'cattle', folk: 'folk', wolf: 'wolves', knife: 'knives', leaf: 'leaves', life: 'lives', thief: 'thieves' };
  if (irregular[w]) return m[1] + irregular[w];
  if (/(s|x|z|ch|sh)$/.test(w)) return m[1] + w + 'es';
  if (/[^aeiou]y$/.test(w)) return m[1] + w.slice(0, -1) + 'ies';
  if (/fe?$/.test(w) && !/(ff|eef|oof|ief)$/.test(w)) return m[1] + w.replace(/fe?$/, 'ves');
  return m[1] + w + 's';
}

/** singular of a word ("wolves" -> "wolf", "frogs" -> "frog", "berries" -> "berry") */
export function singular(w: string): string {
  const irregular: Record<string, string> = { mice: 'mouse', geese: 'goose', oxen: 'ox', people: 'person', children: 'child', wolves: 'wolf', knives: 'knife', leaves: 'leaf', lives: 'life', thieves: 'thief', dice: 'die', teeth: 'tooth', feet: 'foot' };
  if (irregular[w]) return irregular[w];
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (/ves$/.test(w) && w.length > 4) return w.slice(0, -3) + 'f';
  if (/[^s]s$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

function vocab(c: Content): Phrase[] {
  let v = vocabCache.get(c);
  if (v) return v;
  const out: Phrase[] = [];
  const add = (text: string, type: NounType, id: string) => {
    const t = text.toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length >= 3 || (t.length >= 2 && type !== 'star')) out.push({ text: t, type, id });
  };
  const named = (list: { id: string; name: string }[], type: NounType, plurals = true) => {
    for (const x of list) {
      add(x.id.replace(/-/g, ' '), type, x.id);
      add(x.name, type, x.id);
      if (plurals) { add(plural(x.name.toLowerCase()), type, x.id); add(plural(x.id.replace(/-/g, ' ')), type, x.id); }
    }
  };
  const L = lexOf(c);
  for (const d of c.disasters.list) { named([d], 'disaster'); for (const s of d.synonyms ?? []) add(s, 'disaster', d.id); }
  named(c.weather.list, 'weather');
  for (const [w, id] of Object.entries(L.weatherWords)) if (c.weather.find(id)) add(w, 'weather', id);
  named(c.animals.list, 'animal');
  for (const [w, id] of Object.entries(L.animalAliases)) if (c.animals.find(id)) add(w, 'animal', id);
  for (const s of c.species.list) { add(s.id.replace(/-/g, ' '), 'species', s.id); add(s.name, 'species', s.id); add(s.plural.replace(/^the /, ''), 'species', s.id); add(s.adjective + ' people', 'species', s.id); }
  named(c.plants.list, 'plant');
  named(c.items.list, 'item');
  for (const r of c.recipes.list) { add(r.id.replace(/-/g, ' '), 'recipe', r.id); add(r.name, 'recipe', r.id); }
  named(c.creatures.list, 'creature');
  named(c.biomes.list, 'biome', false);
  named(c.diseases.list, 'disease', false);
  for (const [w, id] of Object.entries(L.diseases)) if (c.diseases.find(id)) add(w, 'disease', id);
  for (const s of c.stars.list) { add(s.name, 'star', s.id); add(`${s.id} star`, 'star', s.id); }
  for (const k of c.planetkinds.list) { add(`${k.id} world`, 'planetkind', k.id); add(`${k.id} planet`, 'planetkind', k.id); add(k.name, 'planetkind', k.id); }
  for (const m of MIRACLES) { add(m, 'miracle', m); add(plural(m), 'miracle', m); }
  for (const [id, words] of Object.entries(L.laws)) for (const w of words) add(w, 'law', id);
  for (const m of ['sand', 'snow', 'soil', 'ash', 'ice', 'rock', 'lava']) add(m, 'material', m);
  named(c.buildings.list, 'building');
  out.sort((a, b) => b.text.length - a.text.length || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  vocabCache.set(c, out);
  return out;
}

function wordAt(s: string, phrase: string): number {
  if (!phrase) return -1;
  let i = s.indexOf(phrase);
  while (i >= 0) {
    const before = i === 0 || !/[a-z0-9]/.test(s[i - 1]);
    const after = i + phrase.length >= s.length || !/[a-z0-9]/.test(s[i + phrase.length]);
    if (before && after) return i;
    i = s.indexOf(phrase, i + 1);
  }
  return -1;
}

interface Found { type: NounType; id: string; text: string; at: number }

/** the longest known noun of the given types in s (derived animals of the planet included) */
function findNoun(c: Content, p: Planet | undefined, s: string, types: NounType[]): Found | null {
  let best: Found | null = null;
  for (const ph of vocab(c)) {
    if (!types.includes(ph.type)) continue;
    if (best && ph.text.length < best.text.length) break;
    const at = wordAt(s, ph.text);
    if (at < 0) continue;
    if (!best || ph.text.length > best.text.length || at < best.at) best = { type: ph.type, id: ph.id, text: ph.text, at };
  }
  if (types.includes('animal') && p?.people?.species.length) {
    for (const d of p.people.species) {
      for (const t of [d.def.name.toLowerCase(), plural(d.def.name.toLowerCase()), d.def.id.replace(/-/g, ' ')]) {
        const at = wordAt(s, t);
        if (at >= 0 && (!best || t.length > best.text.length)) best = { type: 'animal', id: d.def.id, text: t, at };
      }
    }
  }
  return best;
}

/** every known noun of the given types in s, earliest first (overlaps resolved toward the longer phrase) */
function allNouns(c: Content, s: string, types: NounType[]): Found[] {
  const hits: Found[] = [];
  for (const ph of vocab(c)) {
    if (!types.includes(ph.type)) continue;
    let i = wordAt(s, ph.text);
    while (i >= 0) {
      if (!hits.some((h) => i < h.at + h.text.length && h.at < i + ph.text.length)) hits.push({ type: ph.type, id: ph.id, text: ph.text, at: i });
      const nx = s.indexOf(ph.text, i + 1);
      i = nx < 0 ? -1 : wordAt(s.slice(nx), ph.text) === 0 ? nx : -1;
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** words that are never names (unless written with a capital mid-sentence): the lexicon, the vocabulary, the powers */
const reservedCache = new WeakMap<Content, Set<string>>();
function reservedWords(c: Content): Set<string> {
  let r = reservedCache.get(c);
  if (r) return r;
  const L = lexOf(c);
  r = new Set<string>(L.reserved);
  const words = (t: string) => { for (const w of t.toLowerCase().split(/[^a-z0-9']+/)) if (w.length >= 2) r!.add(w); };
  for (const w of L.stop) r.add(w);
  for (const k of Object.keys(L.numbers)) r.add(k);
  for (const k of [...Object.keys(L.durations), ...Object.keys(L.intensities), ...Object.keys(L.sizes), ...Object.keys(L.directions), ...Object.keys(L.places), ...Object.keys(L.colours), ...Object.keys(L.weatherWords)]) words(k);
  for (const l of Object.values(L.verbs)) for (const w of l) words(w);
  for (const ph of vocab(c)) words(ph.text);
  for (const pw of c.powers.list) { words(pw.name); for (const s of pw.synonyms) words(s); }
  for (const w of [...L.animalish, ...L.abstract]) r.add(w);
  reservedCache.set(c, r);
  return r;
}

// ───────────────────────────── places and other modifiers ─────────────────────────────

interface Place {
  pos?: V3;
  planet?: number;
  settlement?: number;
  everywhere?: boolean;
  here?: boolean;
  label: string;
}

interface Mods {
  place: Place | null;
  /** ticks; -1 = forever */
  duration?: number;
  qty?: number;
  /** the object was asked for in the singular ("a telescope", "one wolf") */
  one?: boolean;
  intensity?: number;
  size?: number;
  /** a second place ("between A and B", "A and B", "toward B") */
  other?: Place | null;
  toward?: Place | null;
  /** numbers left in the clause (a "%" number is a share: 30% = 0.3, flagged in pct) */
  nums: number[];
  pct?: boolean;
  /** "by N" (a change, not a level) */
  by?: number;
}

interface Live { name: string; kind: 'settlement' | 'planet' | 'creature' | 'god' | 'agent' | 'ship'; id: number; planet: number; pos?: V3 }

/** may a name stand for a live thing in this sentence? (an ordinary word only when capitalised mid-sentence) */
function nameUsable(name: string, raw: string, reserved: Set<string>): boolean {
  if (!name.split(' ').every((w) => reserved.has(w))) return true;
  const cap = name.replace(/\b\w/g, (m) => m.toUpperCase());
  const re = new RegExp(`(?:^|[^.!?;:\\s]\\s+)${cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const at = raw.search(re);
  return at >= 0 && raw.trimStart().indexOf(cap) !== 0;
}

function liveNames(u: Universe, raw: string): Live[] {
  const out: Live[] = [];
  const reserved = reservedWords(u.content);
  const push = (l: Live) => { if (nameUsable(l.name, raw, reserved)) out.push(l); };
  for (const p of u.planets) {
    if (!p.alive) continue;
    push({ name: p.name.toLowerCase(), kind: 'planet', id: p.id, planet: p.id });
    for (const st of p.people?.settlements ?? []) {
      if (st.fallen >= 0) continue;
      const n = st.name.toLowerCase();
      push({ name: n, kind: 'settlement', id: st.id, planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]] });
      const first = n.split(' ')[0];
      if (first.length >= 3 && first !== n) push({ name: first, kind: 'settlement', id: st.id, planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]] });
    }
  }
  for (const c of u.god.creatures) if (c.alive) push({ name: c.name.toLowerCase(), kind: 'creature', id: c.id, planet: c.planet, pos: [...c.pos] as V3 });
  for (const g of u.god.gods) if (g.alive && g.kind === 'rival') push({ name: g.name.toLowerCase(), kind: 'god', id: g.id, planet: g.home.planet });
  // ships by name (every ship not yet finished: building, flying, landed)
  for (const sh of u.space.ships) if (sh.phase !== 'done' && sh.name) push({ name: sh.name.toLowerCase(), kind: 'ship', id: sh.id, planet: sh.home });
  // the people, by name (a cheap index: every living person's name and first name)
  for (const p of u.planets) {
    if (!p.alive || !p.people || !p.people.agents.count) continue;
    const x = makeCtx(u, p);
    const A = x.A;
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s]) continue;
      const n = agentName(x, s).toLowerCase();
      if (!raw.toLowerCase().includes(n.split(' ')[0])) continue;
      const pt = [0, 0, 0];
      A.posAt(s, u.tick, pt);
      push({ name: n, kind: 'agent', id: A.id[s], planet: p.id, pos: [pt[0], pt[1], pt[2]] });
      const first = n.split(' ')[0];
      if (first !== n && first.length >= 3) push({ name: first, kind: 'agent', id: A.id[s], planet: p.id, pos: [pt[0], pt[1], pt[2]] });
    }
  }
  out.sort((a, b) => b.name.length - a.name.length || a.id - b.id);
  return out;
}

function findLive(s: string, live: Live[], kinds: Live['kind'][], skip: Set<string> = new Set()): (Live & { at: number }) | null {
  let best: (Live & { at: number }) | null = null;
  for (const l of live) {
    if (!kinds.includes(l.kind) || skip.has(`${l.kind}:${l.id}`)) continue;
    if (best && l.name.length < best.name.length) break;
    const at = wordAt(s, l.name);
    if (at >= 0 && (!best || at < best.at)) best = { ...l, at };
  }
  return best;
}

/** every live name of these kinds in s, in the order they are written (each thing once) */
function allLive(s: string, live: Live[], kinds: Live['kind'][]): (Live & { at: number })[] {
  const out: (Live & { at: number })[] = [];
  for (const l of live) {
    if (!kinds.includes(l.kind)) continue;
    const at = wordAt(s, l.name);
    if (at < 0) continue;
    if (out.some((o) => (o.kind === l.kind && o.id === l.id) || (at < o.at + o.name.length && o.at < at + l.name.length))) continue;
    out.push({ ...l, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

function remove(s: string, phrase: string): string {
  const at = wordAt(s, phrase);
  if (at < 0) return s;
  return (s.slice(0, at) + ' ' + s.slice(at + phrase.length)).replace(/\s+/g, ' ').trim();
}

/** a number from digits or number words ("3", "2.5", "three", "a dozen") */
function numberWord(L: Lex, w: string): number | undefined {
  if (/^-?\d+(\.\d+)?$/.test(w)) return parseFloat(w);
  const v = L.numbers[w];
  return typeof v === 'number' ? v : undefined;
}

function dayTicks(p: Planet | undefined): number {
  return Math.max(60, Math.round((p?.st.dayHours ?? 24) * 60));
}

function durationTicks(L: Lex, p: Planet | undefined, n: number, unit: string): number | undefined {
  const v = L.durations[unit] ?? L.durations[singular(unit)];
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v < 0 ? -1 : Math.round(n * v);
  const day = dayTicks(p);
  const year = Math.round(p?.st.orbit.period ?? day * 12);
  const per = v === 'day' ? day : v === 'week' ? day * 7 : v === 'month' ? Math.round(year / 12) : v === 'season' ? Math.round(year / 4) : v === 'year' ? year : day;
  return Math.round(n * per);
}

/** a point in a direction from a place: "north of Aru" (900 m that way) */
function directional(p: Planet, from: V3, bearingDeg: number, metres: number): V3 {
  return moveBy(from, bearingDir(from, (bearingDeg * Math.PI) / 180), metres, p.st.radius);
}

/**
 * "the north coast (of Aru)": the coast in that direction — land cells bordering the sea within a few kilometres whose
 * bearing from the base lies within 60° of it, the one reaching farthest that way (off-axis ones weigh less). With no
 * such shore, the first coast met walking that way; failing that, 900 m in that direction.
 */
function coastToward(p: Planet, from: V3, bearingDeg: number): V3 {
  const dir = bearingDir(from, (bearingDeg * Math.PI) / 180);
  let best = -1, bs = -Infinity;
  const R = Math.min(6000, p.st.radius * 1.2);
  for (const c of p.cellsNear(from, R)) {
    if (!p.s.coast[c] || p.s.ocean[c]) continue;
    const q = cellPos3(p, c);
    const v: V3 = [q[0] - from[0], q[1] - from[1], q[2] - from[2]];
    const t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len < 1e-9 || t / len < 0.5) continue;
    const perp = Math.sqrt(Math.max(0, len * len - t * t));
    const score = t - 0.6 * perp - (distM(p, q, from) > 3000 ? 1e-4 : 0);
    if (score > bs) { bs = score; best = c; }
  }
  if (best >= 0) return cellPos3(p, best);
  let at = from;
  for (let k = 0; k < 120; k++) {
    const next = moveBy(at, dir, p.edgeM * 0.7, p.st.radius);
    if (p.s.ocean[p.cellAt(next)]) return at;
    at = next;
  }
  return directional(p, from, bearingDeg, 900);
}

/** the nearest cell of a place kind (desert, coast, mountain, sea ...) to a point */
function nearestPlaceKind(u: Universe, p: Planet, from: V3, kind: string): V3 | null {
  const f = p.f;
  const bi = (id: string) => u.content.biomes.idx(id);
  if (kind === 'north-pole') return [0, 1, 0];
  if (kind === 'south-pole') return [0, -1, 0];
  if (kind === 'pole') return from[1] >= 0 ? [0, 1, 0] : [0, -1, 0];
  if (kind === 'equator') return norm([from[0], 0, from[2]]);
  const test = (c: number): boolean => {
    switch (kind) {
      case 'coast': return !!p.s.coast[c] && !p.s.ocean[c];
      case 'sea': return !!p.s.ocean[c];
      case 'lake': return !p.s.ocean[c] && f.water[c] > 1;
      case 'river': return !p.s.ocean[c] && f.water[c] > 0.2 && f.water[c] < 3 && Math.hypot(f.flowX[c], f.flowY[c], f.flowZ[c]) > 0.01;
      case 'mountain': return f.surface[c] - p.st.seaLevel > 180;
      case 'hills': return f.surface[c] - p.st.seaLevel > 60 && f.surface[c] - p.st.seaLevel < 200;
      case 'valley': return !p.s.ocean[c] && f.water[c] < 0.5 && f.moisture[c] > 0.5;
      case 'ice': return f.ice[c] > 0.5 || f.biome[c] === bi('ice');
      case 'land': return !p.s.ocean[c] && f.water[c] < 0.3;
      default: { const b = bi(kind); return b >= 0 && f.biome[c] === b; }
    }
  };
  let best = -1, bd = Infinity;
  for (let c = 0; c < p.count; c += kind === 'river' || kind === 'lake' ? 1 : 2) {
    if (!test(c)) continue;
    const d = distM(p, cellPos3(p, c), from);
    if (d < bd) { bd = d; best = c; }
  }
  return best >= 0 ? cellPos3(p, best) : null;
}

/** the highest ground within reach of a point (for "make the mountains taller") */
function highGround(p: Planet, from: V3, within: number): V3 | null {
  let best = -1, bh = -Infinity;
  for (const c of p.cellsNear(from, within)) {
    if (p.s.ocean[c]) continue;
    if (p.f.surface[c] > bh) { bh = p.f.surface[c]; best = c; }
  }
  return best >= 0 ? cellPos3(p, best) : null;
}

/** lift the modifiers out of a clause; returns the core left and the modifiers */
function lift(u: Universe, p: Planet | undefined, L: Lex, live: Live[], clause: string): { core: string; mods: Mods } {
  let s = ` ${clause} `.replace(/\s+/g, ' ').trim();
  const mods: Mods = { place: null, nums: [] };
  const focus = (): V3 | undefined => (u.focus && p && u.focus.planet === p.id ? [...u.focus.pos] as V3 : undefined);
  // everywhere / here
  for (const w of L.everywhere) if (wordAt(s, w) >= 0) { mods.place = { everywhere: true, label: 'everywhere' }; s = remove(s, w); break; }
  if (!mods.place) for (const w of L.here) if (wordAt(s, w) >= 0) { mods.place = { here: true, pos: focus(), label: 'here' }; s = remove(s, w); break; }
  // lat / lon
  const ll = s.match(/\blat(?:itude)?\s*(-?\d+(?:\.\d+)?)\s*,?\s*lon(?:gitude)?\s*(-?\d+(?:\.\d+)?)/);
  if (ll) {
    const la = (parseFloat(ll[1]) * Math.PI) / 180, lo = (parseFloat(ll[2]) * Math.PI) / 180;
    mods.place = { pos: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)], label: `${ll[1]}° ${ll[2]}°` };
    s = s.replace(ll[0], ' ').replace(/\s+/g, ' ').trim();
  }
  // a second place: "between A and B" / "A & B" (two settlements named together)
  const pair = s.match(/\bbetween (.+?) (?:and|&) (.+?)$/) ?? s.match(/\b([a-z0-9' -]+?) & ([a-z0-9' -]+?)(?=\s|$)/);
  if (pair) {
    const a = findLive(pair[1], live, ['settlement']);
    const b = findLive(pair[2], live, ['settlement'], a ? new Set([`settlement:${a.id}`]) : undefined);
    if (a && b) {
      mods.place = { pos: a.pos, settlement: a.id, planet: a.planet, label: a.name };
      mods.other = { pos: b.pos, settlement: b.id, planet: b.planet, label: b.name };
      const end = pair[0].indexOf(pair[2]) + pair[2].indexOf(b.name) + b.name.length;
      const start = pair[0].startsWith('between') ? 0 : pair[1].indexOf(a.name);
      s = s.replace(pair[0].slice(start, end), pair[0].startsWith('between') ? ' ' : ' them ').replace(/\s+/g, ' ').trim();
    }
  }
  const tw = s.match(/\b(toward|towards|at|into|(?:heading|headed|bound|making|coming|going) (?:for|to|toward|towards|at)) (.+)$/);
  // directions: "the north coast of aru", "north of aru", "on the east coast"
  const dir = s.match(/\b(?:on |at |along |to |off )?(?:the )?(north|south|east|west|northeast|north-east|northwest|north-west|southeast|south-east|southwest|south-west)(?!(?:ern)?\s+(?:lights?|star)\b)(?:ern)?( coast| shore| side| edge| shores| coasts)?(?: of ([a-z0-9' -]+))?/);
  if (dir && p && !(dir[2] === undefined && !dir[3] && /\b(wind|winds|gale|breeze|blow|blows|blowing)\b/.test(s))) {
    const ofLive = dir[3] ? findLive(dir[3], live, ['settlement', 'creature']) : null;
    const base: V3 | undefined = ofLive?.pos ?? (mods.place?.pos) ?? focus();
    if (base) {
      const coast = !!dir[2] && /coast|shore/.test(dir[2]);
      const b = L.directions[dir[1]] ?? 0;
      const pos = coast ? coastToward(p, base, b) : directional(p, base, b, 900);
      mods.place = { pos, planet: p.id, settlement: ofLive?.kind === 'settlement' ? ofLive.id : undefined, label: `the ${dir[1]}${dir[2] ?? ''}${ofLive ? ` of ${ofLive.name}` : ''}` };
      // remove the phrase only up to the end of the place it names ("the north coast of aru" + " a desert" stays)
      let phrase = dir[0];
      if (ofLive && dir[3]) { const end = dir[0].indexOf(dir[3]) + dir[3].indexOf(ofLive.name) + ofLive.name.length; phrase = dir[0].slice(0, end); }
      else if (dir[3] && !ofLive) phrase = dir[0].slice(0, dir[0].indexOf(' of ' + dir[3]) >= 0 ? dir[0].indexOf(' of ' + dir[3]) : dir[0].length);
      s = s.replace(phrase, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  // a named place: settlement / creature / planet (after a preposition, or anywhere)
  if (!mods.place || mods.place.here) {
    const l = findLive(s, live, ['settlement', 'creature']);
    if (l) {
      mods.place = { pos: l.pos, planet: l.planet, settlement: l.kind === 'settlement' ? l.id : undefined, label: l.name };
      s = remove(s, l.name).replace(/\b(over|on|at|near|around|in|to|upon|onto|into|above|by|beside|outside|inside|under|beneath)\s*$/, '').replace(/\b(over|on|at|near|around|upon|above|by|beside|outside|inside|under|beneath) (?=(and|for|with|then|by)\b|$)/g, '').trim();
    }
  }
  const pl = findLive(s, live, ['planet']);
  if (pl && /\b(on|to|at|of|onto|over)\b/.test(s)) {
    if (!mods.place) mods.place = { planet: pl.id, label: pl.name };
    else mods.place.planet ??= pl.id;
    s = remove(s, pl.name);
  }
  // place kinds: "in the desert", "by the sea", "at the north pole" (not "to the sea" of a river: the river handler reads it)
  if (p && (!mods.place || mods.place.here) && !/\briver\b/.test(s)) {
    for (const [w, kind] of Object.entries(L.places).sort((a, b) => b[0].length - a[0].length)) {
      const m = s.match(new RegExp(`\\b(in|at|on|by|near|over|along|to|into|onto|off|across) (the )?${w.replace(/[-]/g, '\\-')}\\b`));
      if (!m) continue;
      const from = mods.place?.pos ?? focus() ?? [0, 0, 1];
      const at = nearestPlaceKind(u, p, from as V3, kind);
      if (at) { mods.place = { pos: at, planet: p.id, label: `the ${w}` }; s = s.replace(m[0], ' ').replace(/\s+/g, ' ').trim(); }
      break;
    }
  }
  // toward a place (fronts, throws)
  if (tw && p) {
    const t = findLive(tw[tw.length - 1], live, ['settlement', 'creature']);
    if (t) mods.toward = { pos: t.pos, settlement: t.kind === 'settlement' ? t.id : undefined, planet: t.planet, label: t.name };
  }
  // durations ("for three days", "for a year"); forever in its many words
  const dm = s.match(/\b(?:for|during|lasting|over)\s+(?:(\d+(?:\.\d+)?|[a-z]+)\s+)?(minutes?|hours?|days?|weeks?|months?|seasons?|years?|nights?|moment)\b/);
  if (dm) {
    const n = dm[1] ? numberWord(L, dm[1]) ?? 1 : 1;
    const t = durationTicks(L, p, n, dm[2]);
    if (t !== undefined) { mods.duration = t; s = s.replace(dm[0], ' ').replace(/\s+/g, ' ').trim(); }
  }
  for (const w of ['that never ends', 'which never ends', 'that will never end', 'never ending', 'never-ending', 'neverending', 'never ends', 'until i say so', 'until i say', 'until you stop it', 'until stopped', 'for good', 'for all time', 'for ever', 'forever', 'permanently', 'permanent', 'eternally', 'endless', 'unending', 'ongoing', 'everlasting', 'perpetual']) {
    if (wordAt(s, w) >= 0) { mods.duration = -1; s = remove(s, w); }
  }
  // intensity / size (a word that is part of a known name stays: "great cat", "giant kelp")
  const keep = (w: string) => vocab(u.content).some((ph) => ph.text.includes(' ') && wordAt(ph.text, w) >= 0 && wordAt(s, ph.text) >= 0);
  let inten = 0;
  for (const [w, v] of Object.entries(L.intensities)) if (wordAt(s, w) >= 0 && !keep(w)) { inten = Math.max(inten, v); s = remove(s, w); }
  if (inten) mods.intensity = inten * (wordAt(s, 'very') >= 0 ? 1.3 : 1);
  let size = 0;
  for (const [w, v] of Object.entries(L.sizes)) if (wordAt(s, w) >= 0 && !keep(w)) { size = Math.max(size, v); s = remove(s, w); }
  if (size) mods.size = size;
  // numbers left (quantities, values); "30%" is a share; "by 20" a change
  const pct = s.match(/(-?\d+(?:\.\d+)?)\s*(%|percent|per cent)/);
  if (pct) { mods.pct = true; s = s.replace(pct[0], `${parseFloat(pct[1]) / 100}`); }
  for (const w of s.split(' ')) if (/^-?\d+(\.\d+)?$/.test(w)) mods.nums.push(parseFloat(w));
  const by = s.match(/\bby (-?\d+(?:\.\d+)?|[a-z]+)\b/);
  if (by) { const v = numberWord(L, by[1]); if (v !== undefined && !/^(a|an)$/.test(by[1])) mods.by = v; }
  const q = s.match(/\b(a few|a dozen|a hundred|a thousand|a pair of|a couple of|dozens of|hundreds of|thousands of|lots of|many|several|some|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|\d+)\b/);
  if (q) {
    const w = q[1].replace(/^(a |dozens of|hundreds of|thousands of|lots of)\s*/, (m) => (m.startsWith('dozens') ? 'dozen ' : m.startsWith('hundreds') ? 'hundreds ' : m.startsWith('thousands') ? 'thousands ' : m.startsWith('lots') ? 'lots ' : '')).replace(/ of$/, '').trim();
    const first = w.split(' ')[0];
    const v = numberWord(L, first) ?? numberWord(L, w);
    if (v !== undefined) mods.qty = v;
  }
  // "a telescope", "an ox", "one boat": one
  if (mods.qty === undefined && /\b(a|an|one|single)\s+(?!few\b|dozen\b|hundred\b|thousand\b|pair\b|couple\b|lot\b|herd\b|flock\b|pack\b|swarm\b|horde\b)[a-z]/.test(s)) mods.one = true;
  return { core: s, mods };
}

// ───────────────────────────── building commands ─────────────────────────────

interface PCtx2 {
  u: Universe;
  reg: CommandRegistry;
  p: Planet | undefined;
  L: Lex;
  live: Live[];
  raw: string;
  /** content ids made earlier in this parse (later commands may name them before they exist) */
  made: Set<string>;
  why: string[];
  /** said instead of "I don't know how" when a clause was understood but cannot be done ("a war needs two peoples") */
  note?: string;
  /** the commands such an answer is about (the preview shows which power it would be: "Possess — whom?") */
  asked: Command[];
  /** the command kind a keyword's question was about (see Clause.ask) */
  noteAbout?: string;
  /** this clause is one of several (a clause that only names the creature is then spoken to it) */
  multi: boolean;
  /** a question was answered from the world (the reply is the answer: nothing to do, nothing refused) */
  answered?: boolean;
}

function put(c: Command, mods: Mods, schema: CommandSchema | undefined, o: { place?: boolean; radiusDefault?: number } = {}): Command {
  const sp = schema?.params ?? {};
  const pl = mods.place;
  if (pl && o.place !== false) {
    if (pl.planet !== undefined && c.planet === undefined) c.planet = pl.planet;
    if ('pos' in sp && pl.pos && c.pos === undefined) c.pos = pl.pos;
    if ('settlement' in sp && pl.settlement !== undefined && c.settlement === undefined) c.settlement = pl.settlement;
  }
  if ('radius' in sp && mods.size && c.radius === undefined) {
    const d = (sp.radius.default as number | undefined) ?? o.radiusDefault ?? 300;
    c.radius = Math.round(Math.min(sp.radius.max ?? 20000, d * mods.size));
  }
  if (mods.intensity !== undefined && c.intensity === undefined && c.power === undefined) {
    if ('intensity' in sp) c.intensity = clampTo(mods.intensity, sp.intensity);
    else if ('power' in sp) c.power = clampTo(mods.intensity, sp.power);
  }
  if (mods.duration !== undefined && 'duration' in sp && c.duration === undefined) {
    // forever: -1 where the command takes it, else the longest it allows
    c.duration = mods.duration < 0 ? ((sp.duration.min ?? 0) <= -1 ? -1 : sp.duration.max ?? 1e6) : clampTo(mods.duration, sp.duration);
  }
  const qty = mods.qty ?? (mods.one ? 1 : undefined);
  if (qty !== undefined) {
    if ('count' in sp && c.count === undefined) c.count = Math.max(sp.count.min ?? 1, Math.round(clampTo(qty, sp.count)));
    else if ('qty' in sp && c.qty === undefined) c.qty = Math.max(1, Math.round(clampTo(qty, sp.qty)));
  }
  if (mods.toward?.pos && 'toward' in sp && c.toward === undefined) c.toward = mods.toward.pos;
  return c;
}

function clampTo(v: number, s: { min?: number; max?: number } | undefined): number {
  let x = v;
  if (s?.min !== undefined && x < s.min) x = s.min;
  if (s?.max !== undefined && x > s.max) x = s.max;
  return x;
}

function describe(cx: PCtx2, c: Command, label?: string): string {
  const bits: string[] = [label ?? c.k];
  for (const k of ['kind', 'species', 'template', 'knowledge', 'item', 'idea', 'animal', 'law', 'name', 'path', 'value', 'mode', 'act', 'miracle', 'role', 'feeling', 'type', 'into', 'gas']) if (c[k] !== undefined && typeof c[k] !== 'object') bits.push(`${k === 'value' ? '=' : ''}${String(c[k])}`);
  if (typeof c.intensity === 'number') bits.push(`intensity ${c.intensity}`);
  if (typeof c.power === 'number') bits.push(`power ${c.power}`);
  if (typeof c.radius === 'number') bits.push(`${c.radius} m`);
  if (typeof c.count === 'number') bits.push(`×${c.count}`);
  if (typeof c.duration === 'number') bits.push(c.duration < 0 ? 'forever' : c.duration >= 1440 ? `${Math.round((c.duration / dayTicks(cx.p)) * 10) / 10} days` : `${Math.round(c.duration / 6) / 10} h`);
  return bits.join(' · ');
}

function placeLabel(m: Mods): string {
  return m.place ? ` · ${m.place.label}` : '';
}

/** the power of a command kind with these defaults (for labels) */
function powerName(c: Content, cmd: Command): string | undefined {
  for (const pw of c.powers.list) {
    if (pw.command !== cmd.k) continue;
    if (Object.entries(pw.params ?? {}).every(([k, v]) => cmd[k] === undefined || cmd[k] === v)) return pw.name;
  }
  return undefined;
}

// ───────────────────────────── the parser ─────────────────────────────

export function parseFreeform(u: Universe, reg: CommandRegistry, text: string): ParseOut {
  try {
    return parseText(u, reg, String(text ?? ''));
  } catch (e) {
    return { ok: false, msg: `I could not read that (${e instanceof Error ? e.message : String(e)}). ${canDo(u)}` };
  }
}

function canDo(u: Universe): string {
  const cats = new Map<string, string[]>();
  for (const pw of u.content.powers.list) { const l = cats.get(pw.category) ?? []; if (l.length < 4) l.push(pw.name.toLowerCase()); cats.set(pw.category, l); }
  return `I can: ${[...cats.entries()].map(([c, l]) => `${c.toLowerCase()} (${l.join(', ')}…)`).join('; ')} — and "set <law> to <value>" for any law of the world.`;
}

function normalize(t: string): string {
  return t.toLowerCase().replace(/[“”"]/g, ' ').replace(/[‘’`]/g, "'").replace(/[!?]+/g, ' ').replace(/(\d)\s*%/g, '$1%').replace(/[^a-z0-9 .,;:='&°%-]/g, ' ')
    .replace(/\blet there be\b/g, 'conjure').replace(/\b(\d+)\s*x\b/g, '$1x').replace(/\s+/g, ' ').trim();
}

function parseText(u: Universe, reg: CommandRegistry, raw: string, depth = 0): ParseOut {
  const text0 = normalize(raw);
  if (!text0) return { ok: false, msg: `Say what should happen — "add air", "make it rain blood over Aru for three days and send wolves", "introduce chocolate", "set gravity to 3". ${canDo(u)}` };
  const p = u.planetFor(undefined);
  const L = lexOf(u.content);
  const cx: PCtx2 = { u, reg, p, L, live: liveNames(u, raw), raw, made: new Set(), why: [], asked: [], multi: false };
  // 1. an explicit command: "terrain.raise radius=300 strength=20"
  const head = text0.split(' ')[0];
  if (head.includes('.') && reg.has(head)) {
    const c: Command = { k: head };
    for (const kv of raw.trim().split(/\s+/).slice(1)) {
      const m = kv.match(/^([\w-]+)=(.+)$/);
      if (m) c[m[1]] = coerceValue(m[2]);
    }
    if (u.focus === null && reg.schema(head)?.params.pos?.required && c.pos === undefined && c.lat === undefined) c.pos = [0, 0, 1];
    return finish(cx, [c], [`→ ${head}`]);
  }
  // 2. the past: "<n> days ago, <act>" / "yesterday <act>"
  const ago = text0.match(/^(?:in the past,?\s*)?(?:(\d+(?:\.\d+)?|[a-z]+) (minutes?|hours?|days?|weeks?|years?) ago|yesterday|last night)[,:]?\s+(.+)$/) ?? text0.match(/^(.+?),?\s+(?:(\d+(?:\.\d+)?|[a-z]+) (minutes?|hours?|days?|weeks?|years?) ago|yesterday)$/);
  if (ago && depth === 0) {
    const front = /^(?:in the past,?\s*)?(?:\d|[a-z]+ (?:minutes?|hours?|days?|weeks?|years?) ago|yesterday|last night)/.test(text0);
    const nW = front ? ago[1] : ago[2];
    const unit = front ? ago[2] : ago[3];
    const rest = front ? ago[3] : ago[1];
    const n = nW ? numberWord(L, nW) ?? 1 : 1;
    const ticks = unit ? durationTicks(L, p, n, unit) ?? dayTicks(p) : dayTicks(p);
    const inner = parseText(u, reg, rest, depth + 1);
    if (inner.resolved?.length) {
      const cmds = inner.resolved.filter((c) => !c.k.startsWith('time.') && !c.k.startsWith('meta.')).map((c) => ({ k: 'time.edit-past', ticksAgo: ticks, cmd: c } as Command));
      if (cmds.length) return finish(cx, cmds, [`→ in the past (${Math.round(ticks / 60)} h ago): ${inner.msg ?? ''}`]);
    }
  }
  // 3. clauses ("A and B" for two settlements named together stays one place pair, like "between A and B")
  let text = text0.replace(/\bbetween (\S+(?: \S+)?) and /g, 'between $1 & ');
  const sts = cx.live.filter((l) => l.kind === 'settlement');
  for (const a of sts) for (const b of sts) {
    if (a.id === b.id) continue;
    text = text.replace(new RegExp(`\\b${esc(a.name)} and ${esc(b.name)}\\b`, 'g'), `${a.name} & ${b.name}`);
  }
  const VERB_AFTER = 'send|make|give|teach|introduce|rain|let|throw|grab|drop|start|add|raise|plant|grow|kill|heal|bless|curse|stop|set|call|summon|release|bring|invent|create|freeze|move|turn|put|cast|strike|burn|flood|then|pave|carve|build|remove|take|forbid|ban|cure|save|load|tell|order';
  const parts = text.split(new RegExp(`\\s*(;|,\\s*and then|,\\s*then|\\band then\\b|\\bthen\\b|,\\s*and\\b|,|\\band also\\b|\\band\\b(?= (?:${VERB_AFTER}))|\\band\\b)\\s*`));
  const clauses: { text: string; join: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = (parts[i] ?? '').trim();
    if (t) clauses.push({ text: t, join: i > 0 ? (parts[i - 1] ?? '').trim() : '' });
  }
  const lifted = clauses.map((c) => ({ ...c, ...lift(u, p, L, cx.live, c.text) }));
  // places shared: one place named in the whole sentence is everyone's; else forward, then backward across and / ","
  const named = lifted.filter((c) => c.mods.place && !c.mods.place.here);
  const distinct = new Set(named.map((c) => `${c.mods.place!.label}`));
  if (distinct.size === 1) for (const c of lifted) if (!c.mods.place) c.mods.place = named[0].mods.place;
  let lastPlace: Place | null = null;
  for (const c of lifted) { if (!c.mods.place && lastPlace) c.mods.place = lastPlace; if (c.mods.place) lastPlace = c.mods.place; }
  for (let i = lifted.length - 2; i >= 0; i--) {
    const nx = lifted[i + 1];
    if (!lifted[i].mods.place && nx.mods.place && !/then/.test(nx.join)) lifted[i].mods.place = nx.mods.place;
  }
  const cmds: Command[] = [];
  const notes: string[] = [];
  cx.multi = lifted.length > 1;
  for (const c of lifted) {
    cx.note = undefined;
    cx.noteAbout = undefined;
    const got = resolveClause(cx, c.core, c.mods, c.text);
    if (got.length) cmds.push(...got);
    else if (cx.note) notes.push(cx.note);
  }
  if (!cmds.length && cx.answered && notes.length) return { ok: true, msg: notes.join(' '), resolved: [] };
  if (!cmds.length) return notes.length ? { ok: false, msg: notes.join(' '), ...(cx.asked.length ? { resolved: cx.asked } : {}) } : nothing(cx, text0);
  const out = finish(cx, cmds, cx.why);
  if (notes.length) out.msg = `${out.msg} (${notes.join(' ')})`;
  return out;
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function coerceValue(s: string): unknown {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (/^(true|on|yes)$/i.test(t)) return true;
  if (/^(false|off|no)$/i.test(t)) return false;
  if (/^(none|null|nothing)$/i.test(t)) return 'none';
  return t;
}

/** a plain question for a power whose target the words did not give (instead of a schema error) */
function question(c: Command, param: string, label: string): string {
  const k = c.k;
  const Q: Record<string, string> = {
    id: k.startsWith('agent.') || k.startsWith('possess.') ? `${label} — whom? Name a person (${({ 'agent.make-disciple': '"make Hesh a disciple"', 'agent.kill': '"smite Hesh"', 'agent.possess': '"possess Hesh"', 'agent.move': '"move Hesh to Lune"', 'agent.silence': '"silence Hesh"', 'agent.teach': '"teach Hesh bronze"', 'agent.rename': '"rename Hesh to Asha"', 'agent.role': '"make Hesh the chief"', 'agent.transform': '"turn Hesh into a frog"', 'agent.age': '"make Hesh younger"' } as Record<string, string>)[k] ?? `"${label.toLowerCase().split(' ')[0]} Hesh"`}) or click one.` : k.startsWith('creature.') ? 'Which creature? Adopt one first ("adopt an ape").' : `${label} — which one? Name it.`,
    items: 'Give what? ("give Aru 20 bread", "give Lune a telescope")',
    settlement: 'Which settlements? Name them ("make Aru and Lune allies", "merge Aru into Lune").',
    other: 'With whom? Name the other settlement ("make peace between Aru and Lune").',
    hour: 'Move the sun to what hour? ("make it noon", "set the hour to 15:30", "dusk").',
    hours: 'How long should a day be? ("make the days 30 hours long", "longer days").',
    days: 'How long should a year be? ("make the year 200 days long", "a shorter year").',
    degrees: 'Tilt the world how far? ("tilt the world 30 degrees", "remove the tilt", "tilt it more").',
    speed: 'How fast should time run? ("speed 10", "run at 1000x", "pause", "resume").',
    cmd: 'Change the past how? ("two days ago, send a meteor at Aru").',
    name: k === 'content.animal' ? 'Invent which animal? Name it ("unicorns", "release dragons").' : k === 'content.weather' ? 'Invent which weather? ("rain frogs", "a rain of honey").' : k === 'content.idea' ? 'Invent which idea? ("invent telepathy").' : k === 'settlement.rename' || k === 'agent.rename' ? 'Rename to what? ("rename Aru to Bright Haven").' : 'Invent what? Name it ("invent chocolate").',
    species: k === 'world.seed-species' ? 'Seed which kind of life? ("seed plains folk on Rust").' : 'Which kind? ("plant oak", "send wolves").',
    path: 'Set which law? ("set gravity to 3", "set the day length to 30").',
    value: 'Set it to what? ("set gravity to 3").',
    kind: k === 'disaster.spawn' ? 'Which disaster? ("a meteor on Aru", "a random disaster").' : 'Which kind? Name it.',
    to: 'Move it where? ("move Aru to the coast", "move Aru next to Lune").',
    type: 'Build what? ("build a temple in Aru", "build walls around Lune").',
    role: 'Make them what? ("make Hesh the chief of Aru", "make Hesh a priest").',
    into: 'Turn them into what? ("turn Hesh into a frog").',
    knowledge: 'Teach what? Name an idea ("teach Aru bronze", "show Hesh how to make glass").',
    mode: 'What should they do? (worship, farm, build, teach, preach, or go as a missionary).',
    biome: 'Paint which land? ("turn the land around Aru into desert").',
    law: 'Which law? (peace, worship, learning, labour, hospitality, tradition, war, no fire, no hunting, sharing).',
    template: 'Which creature? (ape, ox, great cat, tortoise, wolf, bear).',
    miracle: 'Which miracle? (water, food, heal, forest, storm, fire, fireball, shield, lightning, wood, fertility, calm, teach, meteor).',
    from: 'Blow from where? ("make the wind blow from the east").',
    act: 'Do what? (gather, wood, fish, hunt, build, pray, preach, teach, eat, drink, sleep, dance, fight, rest, explore).',
  };
  return Q[param] ?? `${label} needs ${param}.`;
}

const ANY_OF_Q: Record<string, string> = {
  'planet.set': 'Change what about the world? ("double the gravity", "spin faster", "no magnetic field", "move the world to 2 au").',
  'star.set': 'Change the star how? ("make the sun a red dwarf", "brighter sun", "a second sun").',
  'water.sea-level': 'Raise or lower the seas by how much? ("raise the sea level by 20 metres", "lower the seas").',
  'planet.atmosphere': 'Change the air how? ("thicken the air", "thin the air", "more oxygen", "make the air toxic", "a red sky").',
};

/** validate what can be validated (a command naming content made earlier in this parse waits for it) */
function finish(cx: PCtx2, cmds: Command[], why: string[]): ParseOut {
  const msg = why.filter((w) => w).join('; ') || `→ ${cmds.map((c) => c.k).join(', ')}`;
  for (const c of cmds) {
    if (dependsOnMade(cx, c)) continue;
    const v = cx.reg.validate(cx.u, c);
    if (!v.ok) {
      const label = powerName(cx.u.content, c) ?? c.k;
      const req = v.msg.match(/'([\w.-]+)' is required/);
      if (req) return { ok: false, msg: question(c, req[1], label), resolved: cmds };
      if (/needs at least one of/.test(v.msg) && ANY_OF_Q[c.k]) return { ok: false, msg: ANY_OF_Q[c.k], resolved: cmds };
      return { ok: false, msg: `${msg} — but ${v.msg}`, resolved: cmds };
    }
    if (c.k === 'set') {
      const d = findParam(String(c.path));
      const cv = d ? coerceParam(cx.u, d, c.value) : null;
      if (!d) return { ok: false, msg: `${msg} — but there is no law called '${c.path}'.`, resolved: cmds };
      if (cv && !cv.ok) return { ok: false, msg: `${msg} — but ${cv.msg}`, resolved: cmds };
    }
  }
  return { ok: true, msg, resolved: cmds };
}

function dependsOnMade(cx: PCtx2, c: Command): boolean {
  if (!cx.made.size) return false;
  for (const v of Object.values(c)) {
    if (typeof v === 'string' && cx.made.has(v)) return true;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v as Record<string, unknown>)) if (cx.made.has(k)) return true;
  }
  return false;
}

/** nothing understood: say what can be done, with the nearest words and powers */
function nothing(cx: PCtx2, text: string): ParseOut {
  const words = text.split(/\s+/).filter((w) => w.length > 2 && !cx.L.stop.has(w));
  const vocabWords = [...new Set([...cx.u.content.powers.list.flatMap((pw) => [pw.name.toLowerCase(), ...pw.synonyms]), ...PARAMS.map((p) => p.path), ...cx.u.content.disasters.ids(), ...cx.u.content.weather.ids(), ...cx.u.content.animals.ids()])];
  const near = [...new Set(words.map((w) => suggest(w, vocabWords)).filter((x) => x))];
  // powers that share a word with the request ("make the river flow backwards" -> carve a river ...)
  const related: string[] = [];
  for (const pw of cx.u.content.powers.list) {
    if (related.length >= 4) break;
    const ws = [pw.name.toLowerCase(), ...pw.synonyms].join(' ').split(/[^a-z]+/);
    if (words.some((w) => w.length > 3 && ws.includes(w))) related.push(pw.name.toLowerCase());
  }
  const hint = [...near.slice(0, 4).map((n) => `"${n}"`), ...related.filter((r) => !near.includes(r)).slice(0, 3).map((r) => `"${r}"`)];
  return {
    ok: false,
    msg: `I don't know how to do that yet${hint.length ? ` — did you mean ${hint.join(', ')}?` : '.'} Here is what I can do with that: ${canDo(cx.u)}`,
  };
}

// ───────────────────────────── one clause ─────────────────────────────

function has(s: string, ...words: string[]): boolean {
  return words.some((w) => wordAt(s, w) >= 0);
}

function verb(cx: PCtx2, s: string, intent: string): string | null {
  const l = (cx.L.verbs[intent] ?? []).slice().sort((a, b) => b.length - a.length);
  for (const w of l) if (wordAt(s, w) >= 0) return w;
  return null;
}

function lastDisaster(cx: PCtx2, kind?: string): number | undefined {
  const l = cx.u.god.disasters.filter((d) => (!cx.p || d.planet === cx.p.id) && (!kind || d.kind === kind));
  return l.length ? l[l.length - 1].id : undefined;
}

interface Clause {
  cx: PCtx2;
  /** the core (modifiers lifted) */
  s: string;
  mods: Mods;
  /** the whole clause as written (normalized) */
  full: string;
  out: Command[];
  add(cmd: Command, label?: string): void;
  /**
   * understood, but it needs a word more (or cannot be done): say so. `about`: the command a keyword's question is about
   * (a whole-phrase match of another power then wins over it: "salt wind" is a disaster, not the wind)
   */
  ask(msg: string, about?: string): boolean;
}

/** the camera focus on the acting world */
function focusPos(cx: PCtx2): V3 | undefined {
  return cx.u.focus && cx.p && cx.u.focus.planet === cx.p.id ? [...cx.u.focus.pos] as V3 : undefined;
}

/** where a clause acts: its place, else the focus */
function placePos(c: Clause): V3 | undefined {
  return c.mods.place?.pos ?? focusPos(c.cx);
}

function resolveClause(cx: PCtx2, core: string, mods: Mods, full: string): Command[] {
  const out: Command[] = [];
  const c: Clause = {
    cx, s: core, mods, full, out,
    add: (cmd, label) => {
      const sc = cx.reg.schema(cmd.k);
      if (mods.place?.everywhere && cmd.pos === undefined && sc?.params.everywhere) cmd.everywhere = true;
      put(cmd, mods, sc);
      if (!mods.place && !cx.u.focus && sc?.params.pos?.required && cmd.pos === undefined) cmd.pos = [0, 0, 1];
      out.push(cmd);
      cx.why.push(`→ ${describe(cx, cmd, label ?? powerName(cx.u.content, cmd))}${placeLabel(mods)}`);
    },
    ask: (msg, about) => { cx.note = msg; cx.noteAbout = about; return true; },
  };
  // a clause that only names the creature ("well done, creature"): spoken to it, nothing to do of its own
  if (cx.multi && isVocative(cx, core)) return out;
  for (const intent of INTENTS) {
    if (intent(c)) break;
  }
  return synonymOverride(c);
}

/** "creature", "my creature", or a live creature's name alone */
function isVocative(cx: PCtx2, s: string): boolean {
  const t = s.replace(/^(o|oh|hey|you|my)\s+/, '').trim();
  if (cx.L.creatureWords.includes(t)) return true;
  return cx.live.some((l) => l.kind === 'creature' && l.name === t);
}

// ───────────────────────────── relative words ─────────────────────────────

const UP = /\b(more|increase|increased|raise|higher|stronger|bigger|greater|heavier|longer|faster|thicker|harder|deeper|boost|amplify|intensify|strengthen|up|grow|larger|brighter|hotter|warmer|wetter)\b/;
const DOWN = /\b(less|decrease|decreased|lower|weaker|weaken|smaller|lighter|shorter|slower|thinner|softer|reduce|reduced|diminish|down|lessen|dimmer|cooler|colder|drier|fewer)\b/;
const ZERO = /\b(remove|removes|no|none|zero|without|switch off|turn off|disable|off|eliminate|abolish|get rid of|take away|strip)\b/;
const ON = /\b(switch on|turn on|enable|restore|bring back|on)\b/;

/**
 * A new value from the current one and the words: "double" ×2, "triple" ×3, "half" ×0.5, "N times" ×N, "by N%",
 * "by N" (± in the units), more / less (×1.5 or ±step for an offset-like law), "remove" / "no" 0, "low" ×0.4,
 * "high" ×2.5. null: no relative word.
 */
function relValue(cur: number, s: string, mods: Mods, o: { step?: number; invert?: boolean } = {}): number | null {
  const times = s.match(/\b(\d+(?:\.\d+)?|two|three|four|five|ten|a hundred)\s+times\b/);
  const tw: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, ten: 10, 'a hundred': 100 };
  let up = UP.test(s), down = DOWN.test(s);
  if (o.invert) { const t = up; up = down; down = t; }
  const dir = down && !up ? -1 : 1;
  if (ZERO.test(s) && !/\bno (longer|shorter|more|less)\b/.test(s)) return 0;
  if (/\b(double|doubled|twice)\b/.test(s)) return o.invert ? cur / 2 : cur * 2;
  if (/\b(triple|tripled|thrice)\b/.test(s)) return o.invert ? cur / 3 : cur * 3;
  if (/\b(quadruple|four times)\b/.test(s)) return o.invert ? cur / 4 : cur * 4;
  if (times) { const k = parseFloat(times[1]) || tw[times[1]] || 2; return dir < 0 || o.invert ? cur / k : cur * k; }
  if (/\b(halve|half|halved)\b/.test(s)) return o.invert ? cur * 2 : cur / 2;
  if (mods.by !== undefined) {
    if (mods.pct) return cur * (1 + dir * Math.abs(mods.by));
    return cur + dir * Math.abs(mods.by);
  }
  if (/\b(low|tiny|little|weak|faint|gentle|mild)\b/.test(s) && !up && !down) return cur * 0.4;
  if (/\b(high|huge|strong|immense|crushing|extreme)\b/.test(s) && !up && !down) return cur * 2.5;
  if (mods.intensity !== undefined && !up && !down) return cur * mods.intensity;
  if (up || down) {
    const much = /\b(much|far|a lot|lots|very|greatly|way)\b/.test(s) ? 2 : 1;
    if (o.step !== undefined) return cur + dir * o.step * much;
    return dir > 0 ? cur * (1.5 * much) : cur / (1.5 * much);
  }
  if (ON.test(s)) return cur > 0 ? cur : 1;
  return null;
}

function setParam(c: Clause, d: ParamDef, v: number, label?: string): boolean {
  const lo = d.min ?? -Infinity, hi = d.max ?? Infinity;
  const val = Math.round(Math.max(lo, Math.min(hi, v)) * 1000) / 1000;
  c.add({ k: 'set', path: d.path, value: d.kind === 'boolean' ? val > 0 : val }, label ?? `set ${d.label}`);
  return true;
}

function paramNow(cx: PCtx2, path: string): number {
  const d = findParam(path);
  if (!d || !cx.p) return 0;
  const v = d.get(cx.u, cx.p);
  return typeof v === 'number' ? v : v === true ? 1 : 0;
}

/** the season the world is in now (0 spring .. 3 winter, the same year fractions pin-season uses) */
function seasonNow(cx: PCtx2): string {
  const p = cx.p;
  if (!p) return 'summer';
  const root = p.st.orbit.parent >= 0 ? cx.u.planet(p.st.orbit.parent) ?? p : p;
  const M = meanAnomaly(root.st.orbit, cx.u.tick);
  const yf = ((M / (2 * Math.PI)) % 1 + 1) % 1;
  return ['spring', 'summer', 'autumn', 'winter'][Math.floor(yf * 4 + 0.5) % 4];
}


// ───────────────────────────── questions ─────────────────────────────

/** what an inspector query returns for a settlement / a person (the parts a reply reads) */
interface StInfo { name: string; speciesName: string; population: number; era: string; library: string[]; buildings: unknown[]; leader: { name: string; title: string } | null; founded: { year: number; day: number } | null; belief: number; fear: number; worship: number; foodDays: number; epidemic: string | null; pos: number[] }
interface AgInfo { name: string; speciesName: string; settlement: { name: string } | null; age: number; role: string; doing: string; knowledge: string[]; health: number; mood: number; sick: string | null; pos: number[]; faith: { love: number; fear: number } }

/** the hour of the day at a place, on the world's own clock */
function localHour(cx: PCtx2, at: ArrayLike<number> | undefined): number {
  const p = cx.p!;
  const D = p.st.dayHours;
  const h0 = p.paramsAt(cx.u.tick, cx.u.sun(p, cx.u.tick)).hourAtLon0;
  const lon = at ? Math.atan2(at[0], at[2]) : 0;
  return (((h0 + (lon / (Math.PI * 2)) * D) % D) + D) % D;
}

/** "12°S 34°E, 1.2 km east of Lune": where a point lies, for a reply */
function whereWords(cx: PCtx2, pos: ArrayLike<number>, not?: number): string {
  const p = cx.p!;
  const lat = (Math.asin(Math.max(-1, Math.min(1, pos[1]))) * 180) / Math.PI;
  const lon = (Math.atan2(pos[0], pos[2]) * 180) / Math.PI;
  const ll = `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
  const o = nearestSettlement(p, pos, Infinity, (t) => t.fallen < 0 && !t.band && t.id !== not);
  if (!o) return ll;
  const d = distM(p, o.pos, pos);
  const la0 = Math.asin(Math.max(-1, Math.min(1, o.pos[1])));
  const dLat = lat - (la0 * 180) / Math.PI;
  let dLon = lon - (Math.atan2(o.pos[0], o.pos[2]) * 180) / Math.PI;
  dLon = ((dLon + 540) % 360) - 180;
  const ang = (Math.atan2(dLon * Math.cos(la0), dLat) * 180) / Math.PI;
  const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((ang + 360) % 360) / 45) % 8];
  return `${ll}, ${d >= 1000 ? `${Math.round(d / 100) / 10} km` : `${Math.round(d)} m`} ${dir} of ${o.name}`;
}

function listWords(xs: string[], max = 8): string {
  const t = xs.slice(0, max);
  const more = xs.length > max ? ` and ${xs.length - max} more` : '';
  return t.length <= 1 ? `${t.join('')}${more}` : `${t.slice(0, -1).join(', ')}${more ? `, ${t[t.length - 1]}${more}` : ` and ${t[t.length - 1]}`}`;
}

/**
 * A plain question about the world, answered from it — nothing changes, nothing is refused: "how many people live in
 * Aru?", "where is Hesh?", "who leads Lune?", "what does Aru know?", "how old is Hesh?", "what time is it?", "what is
 * Aru?", "is it raining in Lune?". A request phrased as a question ("can you make it rain?") is a request, not this.
 */
function intentAsk(c: Clause): boolean {
  const { cx, mods, full } = c;
  const { u, p } = cx;
  const q = /\?\s*$/.test(cx.raw) && /^(how|what|whats|where|wheres|who|whos|whom|which|when|why|is|are|am|was|were|does|do|did|has|have|tell me)\b/.test(full);
  if (!p || !(q || /^(how many|how much|how old|how big|how long|what is|what's|whats|what are|what does|what do|where is|where's|wheres|where are|who is|who's|whos|who are|who leads|who rules|is there|are there|tell me about)\b/.test(full))) return false;
  cx.answered = true;
  const say = (msg: string): boolean => c.ask(msg);
  const person = findLive(full, cx.live, ['agent']);
  const stId = mods.place?.settlement;
  const ag = person ? peopleQuery(u, p, 'agent', { id: person.id }) as AgInfo | null : null;
  const st = stId !== undefined ? peopleQuery(u, p, 'settlement', { id: stId }) as StInfo | null : null;
  const where = mods.place?.pos ?? (ag ? ag.pos : undefined) ?? focusPos(cx);
  const towns = (p.people?.settlements ?? []).filter((t) => t.fallen < 0 && !t.band);
  // the time, the day, the year, the season
  if (/\b(time|hour|o'clock|clock)\b/.test(full) && /\b(what|which)\b/.test(full)) {
    const h = localHour(cx, where);
    const h24 = (h / p.st.dayHours) * 24;
    return say(`It is ${fmtClock(h24)} ${where ? placeName(p, where) : `on ${p.name}`}${Math.abs(p.st.dayHours - 24) > 0.01 ? ` (a day here lasts ${Math.round(p.st.dayHours * 10) / 10} hours)` : ''}${p.st.sunFrozen ? '; the sun stands still' : ''}.`);
  }
  if (/\b(year|day|date|season)\b/.test(full) && /\b(what|which)\b/.test(full) && !st && !ag) {
    const cal = p.calendar(u.tick);
    return say(`It is day ${cal.day} of year ${cal.year} on ${p.name}, in ${seasonNow(cx)}${p.st.seasonPinned ? ' (held there by you)' : ''}.`);
  }
  // the weather
  if (/\b(raining|rain|snowing|snow|weather|stormy|storm|sunny|cloudy|windy)\b/.test(full) && where) {
    const near = p.weather.filter((w) => distM(p, w.pos, where) < w.radius * 1.2).map((w) => u.content.weather.list[w.kind].name.toLowerCase());
    const c0 = p.cellAt(where);
    const wet = p.f.precip[c0] > 0;
    const gw = p.st.globalWeather ? u.content.weather.find(p.st.globalWeather)?.name.toLowerCase() ?? p.st.globalWeather : null;
    const t = Math.round(p.f.temperature[c0]);
    return say(`${placeName(p, where).replace(/^\w/, (m) => m.toUpperCase())}: ${near.length ? listWords([...new Set(near)]) : gw ? `${gw} (over all of ${p.name})` : wet ? 'rain' : 'no weather system — the sky is clear'}${gw && near.length ? `, under a planet-wide ${gw}` : ''}; ${t} °C.`);
  }
  // a person
  if (ag) {
    if (/\bwhere\b/.test(full)) {
      const at = placeName(p, ag.pos);
      const home = ag.settlement && at === `on ${ag.settlement.name}` ? `in ${ag.settlement.name}` : `${at.startsWith('in the wilds') ? `at ${whereWords(cx, ag.pos)}` : at}${ag.settlement ? `, of ${ag.settlement.name}` : ''}`;
      return say(`${ag.name} is ${home} — ${ag.doing}.`);
    }
    if (/\bhow old\b|\bage\b/.test(full)) return say(`${ag.name} is ${Math.floor(ag.age)} years old.`);
    if (/\b(know|knows|knowledge|can (he|she|they) make|skills?)\b/.test(full)) return say(ag.knowledge.length ? `${ag.name} knows ${listWords(ag.knowledge, 12)}.` : `${ag.name} knows nothing yet that has a name.`);
    if (/\b(love|fear|believe|faith|worship)\b/.test(full)) return say(`${ag.name}: love of you ${Math.round(ag.faith.love * 100)}%, fear of you ${Math.round(ag.faith.fear * 100)}%.`);
    return say(`${ag.name}: ${ag.speciesName.toLowerCase()}, ${Math.floor(ag.age)} years old, ${ag.role === 'none' ? 'no particular role' : ag.role}${ag.settlement ? ` of ${ag.settlement.name}` : ', a wanderer'}; ${ag.doing}; health ${Math.round(ag.health * 100)}%${ag.sick ? `, sick with ${ag.sick}` : ''}.`);
  }
  // a settlement
  if (st) {
    if (/\bhow many\b|\bpopulation\b|\bhow (big|large|populous)\b|\bhow many people\b/.test(full)) return say(`${st.name} has ${st.population} ${st.population === 1 ? 'person' : 'people'} (${st.speciesName.toLowerCase()}, ${st.era} era) and ${st.buildings.length} buildings.`);
    if (/\bwhere\b/.test(full)) return say(`${st.name} lies at ${whereWords(cx, st.pos, stId)}.`);
    if (/\b(who|leader|leads|rules|chief|king|queen|elder)\b/.test(full) && /\b(who|leader|leads|rules|chief)\b/.test(full)) return say(st.leader ? `${st.leader.name} leads ${st.name} (${st.leader.title}).` : `${st.name} has no leader.`);
    if (/\b(know|knows|knowledge|learned|learnt|can they make|ideas|technology|tech)\b/.test(full)) return say(st.library.length ? `${st.name} knows ${listWords(st.library, 14)}.` : `${st.name} knows nothing yet that has a name.`);
    if (/\b(how old|founded|when)\b/.test(full)) return say(st.founded ? `${st.name} was founded on day ${st.founded.day} of year ${st.founded.year}.` : `${st.name} has no founding day.`);
    if (/\b(love|fear|believe|faith|worship|think of me)\b/.test(full)) return say(`${st.name}: belief in you ${Math.round(st.belief * 100)}%, fear ${Math.round(st.fear * 100)}%, worship ${Math.round(st.worship * 100)}%.`);
    if (/\b(food|hungry|starving|eat)\b/.test(full)) return say(`${st.name} has food for ${Math.round(st.foodDays * 10) / 10} days.`);
    if (/\b(sick|ill|plague|disease|healthy)\b/.test(full)) return say(st.epidemic ? `${st.name} suffers from ${st.epidemic}.` : `No sickness spreads in ${st.name}.`);
    return say(`${st.name}: ${st.population} ${st.speciesName.toLowerCase()} of the ${st.era} era, ${st.buildings.length} buildings, ${st.library.length} things known${st.leader ? `, led by ${st.leader.name}` : ''}; it lies at ${whereWords(cx, st.pos, stId)}.`);
  }
  // the world
  if (/\bhow many\b/.test(full) && /\b(people|folk|souls|persons|villagers|mortals|humans|settlements|towns|villages|cities)\b/.test(full)) {
    const pop = towns.reduce((n, t) => n + (peopleQuery(u, p, 'settlement', { id: t.id }) as StInfo).population, 0);
    return say(towns.length ? `${p.name} holds ${pop} people in ${towns.length} settlement${towns.length === 1 ? '' : 's'}: ${listWords(towns.map((t) => t.name))}.` : `Nobody lives on ${p.name} yet ("set down a people").`);
  }
  if (/\b(where|what) (is|are) (the )?(settlements|towns|villages|people)\b/.test(full)) return say(towns.length ? towns.map((t) => `${t.name} at ${whereWords(cx, t.pos, t.id)}`).join('; ') + '.' : `Nobody lives on ${p.name} yet.`);
  return say(`I answer questions about places, people and the hour — "how many people live in Aru?", "where is Hesh?", "who leads Aru?", "what does Aru know?", "what time is it?" — and I do what I am told: "${towns[0] ? `bless ${towns[0].name}` : 'add air'}".`);
}

// ───────────────────────────── intents (most specific first) ─────────────────────────────

/** save, load, resume, "run at 1000x" */
function intentControl(c: Clause): boolean {
  const { s, cx } = c;
  if (/^(save|save it|save now)$/.test(s) || /\b(quicksave|quick save|save the game|save my game|save game|save my progress|save progress|save the world state)\b/.test(s)) {
    c.add({ k: 'meta.save', ...(/quick/.test(s) ? { quick: true } : {}) }, /quick/.test(s) ? 'quicksave' : 'save');
    return true;
  }
  if (/^(load|quickload|quick load|load game|load a save|restore the save)$/.test(s) || /\b(quickload|quick load|load (?:the|my)(?: last)? (?:game|save)|load my last save|load the last save)\b/.test(s)) {
    c.add({ k: 'meta.load', ...(/quick/.test(s) ? { quick: true } : {}) }, /quick/.test(s) ? 'quickload' : 'load');
    return true;
  }
  const run = s.match(/\b(?:run|go|play|time|speed|set (?:the )?speed)\s+(?:at\s+|to\s+)?(\d+(?:\.\d+)?)\s*(?:x|times)\b/) ?? s.match(/^(\d+(?:\.\d+)?)x(?: speed)?$/);
  if (run) { c.add({ k: 'time.speed', speed: Math.min(100000, parseFloat(run[1])) }, `time ×${run[1]}`); return true; }
  if (/^(?:resume|unpause|un-pause|play|go on|carry on|continue|normal speed|go to normal speed|back to normal speed|let time run|let time flow|start time|restart time|let it run|time flows again)(?: time| again| the game| the world)?$/.test(s)) {
    const prev = cx.u.god.speedRequest;
    const sp = /normal/.test(s) ? 1 : prev > 0 ? prev : 1;
    c.add({ k: 'time.speed', speed: sp }, sp === 1 ? 'normal speed' : `resume at ×${sp}`);
    return true;
  }
  return false;
}

/** set <law> to <value> (with "30%", named hours, and words: "set gravity to double") */
function intentSet(c: Clause): boolean {
  const { s, cx } = c;
  const setM = s.match(/^(?:set|change|make)\s+(?:the\s+)?(.+?)\s+(?:to|=|at|into)\s+(.+)$/) ?? s.match(/^set\s+(?:the\s+)?(.+?)\s+(-?[\d.]+|true|false|on|off|none|[a-z-]+)$/);
  const doSet = (d: ParamDef, rawV: string): boolean => {
    const t = rawV.trim();
    // the hour of the day is local to where the god is looking (time.set-hour at the focus)
    if (d.path === 'planet.hour') {
      const h = clockHour(t) ?? (typeof coerceValue(t) === 'number' ? Number(coerceValue(t)) : null);
      if (h === null) return c.ask(question({ k: 'time.set-hour' }, 'hour', 'Move the sun'));
      c.add({ k: 'time.set-hour', hour: scaleHour(cx, h), ...(placePos(c) ? { at: placePos(c) } : {}) }, `the sun to ${fmtClock(h)}`);
      return true;
    }
    let v: unknown = coerceValue(t);
    if (d.kind === 'number' && typeof v === 'string') {
      const cur = paramNow(cx, d.path);
      const rel = relValue(cur, t, c.mods, { step: d.unit === '°C' ? 5 : d.unit === '°' ? 10 : undefined });
      if (rel !== null) return setParam(c, d, rel);
      const named = clockHour(t);
      if (named !== null && /hour/.test(d.path)) v = named;
    }
    c.add({ k: 'set', path: d.path, value: v }, `set ${d.label}`);
    return true;
  };
  if (setM) {
    const words = setM[1].trim();
    const d = findParam(words) ?? findParam(words.replace(/ /g, '.')) ?? findParam(words.replace(/ /g, '')) ?? paramByWords(cx, words);
    if (d) return doSet(d, setM[2]);
    if (/^(the )?(time|clock|hour|time of day)$/.test(words)) return doSet(findParam('planet.hour')!, setM[2]);
    for (const pd of allParams(cx.u)) {
      if (pd.path.toLowerCase().replace(/\./g, ' ') === words || pd.label.toLowerCase() === words) return doSet(pd, setM[2]);
    }
  }
  if (/^set\b/.test(s)) {
    const toks = s.replace(/^set\s+(the\s+)?/, '').split(' ');
    for (let i = toks.length - 1; i >= 1; i--) {
      const path = toks.slice(0, i).join(' ').replace(/\s+(to|=|at)$/, '');
      const d = findParam(path) ?? findParam(path.replace(/ /g, '.'));
      if (!d) continue;
      const rest = toks.slice(i).filter((t) => t !== 'to' && t !== '=' && t !== 'at').join(' ');
      if (!rest) continue;
      return doSet(d, rest);
    }
  }
  return false;
}

/** a law of the world named in everyday words ("the strength of rain" -> hydro.rainScale, "natural disasters") */
function paramByWords(cx: PCtx2, words: string): ParamDef | undefined {
  const w = words.replace(/^(the|a|an)\s+/, '').trim();
  const table: [RegExp, string][] = [
    [/^(gravity|the gravity|pull)$/, 'planet.gravity'], [/magnet/, 'planet.magnetism'], [/^(day|days|day length|length of (the )?days?|rotation|spin)$/, 'planet.dayHours'],
    [/^(year|years|year length|length of (the )?years?)$/, 'planet.yearDays'], [/^(tilt|axial tilt|axis|obliquity)$/, 'planet.axialTilt'],
    [/^(oxygen|o2)$/, 'planet.atmosphere.o2'], [/^(carbon dioxide|co2)$/, 'planet.atmosphere.co2'], [/^(nitrogen|n2)$/, 'planet.atmosphere.n2'], [/^methane$/, 'planet.atmosphere.methane'],
    [/^(air pressure|pressure|air)$/, 'planet.atmosphere.pressure'], [/^(toxicity|poison)$/, 'planet.atmosphere.toxicity'], [/^(dust|aerosols)$/, 'planet.atmosphere.dust'],
    [/natural disasters?|disasters/, 'disasters.natural'], [/^(sun|star) ?(brightness|luminosity)?$/, 'star.luminosity'], [/^(temperature|warmth|heat)$/, 'climate.offset'],
    [/^(clouds|cloudiness|cloud cover)$/, 'planet.cloudiness'], [/^(orbit|distance|distance from the (sun|star))$/, 'orbit.distance'],
  ];
  for (const [re, path] of table) if (re.test(w)) return findParam(path);
  return undefined;
}

/**
 * "drop him on Lune", "put her down in Aru", "let go of it": what the hand holds is let fall (over the place named:
 * the hand carries it there first) or set down gently. A pronoun is never a new thing to invent.
 */
function intentLetGo(c: Clause): boolean {
  const { s, cx, mods } = c;
  const m = s.match(/^(?:now |then |gently |just )?(drop|let go of|let go|let fall|release|set down|put down|lay down|set|put|place|lay|lower)(?:\s+(it|him|her|them|that|this|the (?:person|man|woman|thing|rock|boulder|tree|animal|child|body)))?(?:\s+(down|gently|softly|carefully|slowly|fall|go))*$/);
  if (!m) return false;
  const v = m[1], pron = m[2];
  const held = cx.u.god.hand(0)?.held;
  // without a pronoun only the plain words of letting go: "drop", "let go" (a bare "put", "release" mean other things)
  if (!pron && !/^(drop|let go|let fall)$/.test(v)) return false;
  if (!held && !pron) return false;
  if (/^(set|put|place|lay|lower)/.test(v) && !pron) return false;
  const at = mods.place && !mods.place.everywhere ? mods.place.pos : undefined;
  const gentle = /^(set|put|place|lay|lower)/.test(v) || /\b(down|gently|softly|carefully|slowly)\b/.test(s);
  if (gentle) { c.add({ k: 'hand.place', ...(at ? { pos: at } : {}) }, 'set it down'); return true; }
  if (at) c.add({ k: 'hand.move', pos: at }, 'carry it there');
  c.add({ k: 'hand.drop' }, 'let it fall');
  mods.place = null;
  return true;
}

/** "forbid war in Aru", "ban fire", "no more natural disasters", "never again hunt": a law, never the thing itself */
function intentForbid(c: Clause): boolean {
  const { s, cx, mods } = c;
  const fv = verb(cx, s, 'forbid') ?? (/\b(stop|end)\b.*\bnatural disasters?\b/.test(s) || /\bturn off\b.*\bdisasters?\b/.test(s) ? 'stop' : null);
  if (!fv) return false;
  const p = cx.p;
  const st = mods.place?.settlement;
  const towns = (): number[] => {
    if (st !== undefined) return [st];
    return (p?.people?.settlements ?? []).filter((x) => x.fallen < 0 && !x.band).map((x) => x.id);
  };
  const giveLaw = (law: string, label: string, extra: Record<string, unknown> = {}): boolean => {
    const ts = towns();
    if (!ts.length) return c.ask(`There is no settlement on ${p?.name ?? 'this world'} to give the law to.`);
    for (const t of ts) c.add({ k: 'settlement.law', law, settlement: t, ...extra }, label);
    return true;
  };
  if (/\bnatural disasters?\b|\bnature'?s? (violence|wrath)\b|\bdisasters?\b|\bcatastrophes?\b|\bcalamit/.test(s)) {
    c.add({ k: 'set', path: 'disasters.natural', value: 0 }, 'no more natural disasters');
    if (!/\bnatural\b/.test(s) && cx.u.god.disasters.some((d) => !p || d.planet === p.id)) c.add({ k: 'disaster.cancel', all: true }, 'stop every disaster');
    return true;
  }
  if (/\b(war|wars|warfare|fighting|fight|killing|kill|violence|murder|bloodshed|battle|battles|raids?)\b/.test(s)) return giveLaw('peace', 'law: Thou shalt not kill');
  if (/\b(fire|fires|flame|flames|burning)\b/.test(s)) return giveLaw('no-fire', 'law: fire is forbidden');
  if (/\b(hunt|hunting|hunters?)\b/.test(s)) return giveLaw('no-hunting', 'law: spare the beasts');
  if (/\b(rain|rains|storms?|snow|weather)\b/.test(s)) { c.add({ k: 'weather.global', kind: 'clear' }, 'clear skies everywhere'); return true; }
  const k = findNoun(cx.u.content, p, s, ['recipe']);
  if (k) return giveLaw('taboo', `forbid ${k.text}`, { knowledge: k.id });
  if (/\b(air|atmosphere|tilt|seasons?|gravity|magnetic|moon)\b/.test(s)) return false;
  return c.ask(`Forbid what? (war, fire, hunting, an idea such as bronze, natural disasters) — e.g. "forbid war in Aru".`);
}

/** remove / take away / withdraw / wipe out / make extinct / confiscate / cure / repeal: never creates what it names */
function intentWithdraw(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const rv = verb(cx, s, 'repeal');
  const cure = verb(cx, s, 'cure') ?? (/^save\b.+\bfrom\b/.test(full) ? 'save' : null);
  const wv = verb(cx, s, 'withdraw') ?? (/\btake\b.+\baway\b/.test(s) ? 'take away' : null) ?? (/\bmake\b.+\bextinct\b/.test(s) ? 'make extinct' : null) ?? (/\bwipe\b.*\b(off|from)\b/.test(s) ? 'wipe out' : null)
    // "take the wheel from Aru", "steal their bronze" (not "take Hesh from Aru to Lune": a move)
    ?? (/^(take|steal|seize|strip)\b(?!\s+(?:control|over|charge|hold|care|command|possession|the reins|a look)\b)/.test(s) && mods.place?.settlement !== undefined && /\b(from|of)\b/.test(full) && !/\b(to|into|toward|towards|onto)\b/.test(full) && !findLive(full, cx.live, ['agent']) ? 'take from' : null);
  if (!rv && !cure && !wv) return false;
  const st = mods.place?.settlement;
  const all = !!mods.place?.everywhere || /\bfrom the (world|planet|earth|face of)\b|\bfrom (everywhere|all)\b|\bextinct\b|\bwipe out\b|\bexterminate\b|\beradicate\b|\ball the\b|\bevery\b/.test(full);
  const law = findNoun(u.content, p, s, ['law']);
  // repeal a law
  if (rv || (law && /\blaws?\b|\bcommandments?\b|\bdecree\b|\btaboo\b/.test(s) && wv)) {
    const which = law ? law.id : /\b(all|every)\b|\blaws\b/.test(s) ? 'all' : null;
    const k = findNoun(u.content, p, s, ['recipe']);
    if (!which && k && /\btaboo\b/.test(s)) { c.add({ k: 'settlement.law', law: 'taboo', knowledge: k.id, on: false, ...(st !== undefined ? { settlement: st } : {}) }, `lift the taboo on ${k.text}`); return true; }
    if (!which) return c.ask('Repeal which law? (peace, worship, learning, labour, hospitality, tradition, war, no fire, no hunting, sharing — or "all")');
    const holders = st !== undefined ? [st] : Object.keys(u.god.settlementLaws).filter((key) => key.startsWith(`${p?.id ?? 0}:`) && (which === 'all' || u.god.settlementLaws[key].includes(which))).map((key) => Number(key.split(':')[1]));
    if (!holders.length) return c.ask(`No settlement keeps ${which === 'all' ? 'any law of yours' : `the law '${LAWS[which]?.name ?? which}'`}.`);
    for (const h of holders) c.add({ k: 'settlement.law', law: which, on: false, settlement: h }, `repeal ${which === 'all' ? 'every law' : LAWS[which]?.name ?? which}`);
    return true;
  }
  const dis = findNoun(u.content, p, s, ['disease']);
  if (cure || dis) {
    if (!cure && !dis) return false;
    const where: Record<string, unknown> = all && st === undefined ? { everywhere: true } : st !== undefined ? { settlement: st } : {};
    // "the plague", "the sickness": whatever sickness it is (only a named one is cured alone: "the black plague", "the pox")
    const generic = !dis || /^(the )?(plague|plagues|pestilence|sickness|disease|illness|epidemic|fever)$/.test(dis.text);
    c.add({ k: 'life.cure', ...(!generic ? { disease: dis!.id } : {}), ...where }, `cure ${!generic ? dis!.text : 'the sick'}`);
    return true;
  }
  // a person, the creature, a rival god by name
  const person = findLive(full, cx.live, ['agent']);
  if (person) { c.add({ k: 'hand.grab', target: { kind: 'agent', id: person.id }, planet: person.planet }, `take ${person.name} away`); return true; }
  const god = findLive(full, cx.live, ['god']);
  if (god || /\bgods?\b|\bgoddess\b|\bdeity\b/.test(s)) {
    if (!god && !u.god.gods.some((g) => g.alive && g.kind === 'rival')) { cx.asked.push({ k: 'rival.remove' }); return c.ask('There is no other god to banish — you are the only one here.'); }
    c.add({ k: 'rival.remove', ...(god ? { id: god.id } : {}) }, 'banish a god');
    return true;
  }
  if (/\b(world|planet)\b/.test(s) && /\b(erase|unmake|destroy|remove|obliterate|wipe out)\b/.test(s) && !/\bfrom the (world|planet)\b/.test(s)) { c.add({ k: 'world.erase', ...(mods.place?.planet !== undefined ? { world: mods.place.planet } : {}) }, 'erase the world'); return true; }
  if (has(s, ...cx.L.creatureWords) || findLive(full, cx.live, ['creature'])) { const cr = findLive(full, cx.live, ['creature']); c.add({ k: 'creature.release', ...(cr ? { id: cr.id } : {}) }, 'release the creature'); return true; }
  const n = findNoun(u.content, p, s, ['disaster', 'weather', 'animal', 'species', 'plant', 'item', 'recipe', 'building']);
  if (n) {
    switch (n.type) {
      case 'disaster': c.add({ k: 'disaster.cancel', ...(lastDisaster(cx, n.id) !== undefined ? { kind: n.id } : { all: true }) }, `end the ${n.text}`); return true;
      case 'weather': c.add({ k: 'weather.clear', ...(mods.place?.everywhere || all ? { everywhere: true } : {}) }, `clear the ${n.text}`); return true;
      case 'animal':
        if (all && st === undefined) c.add({ k: 'life.extinct', species: n.id }, `no more ${n.text}`);
        else c.add({ k: 'life.cull', species: n.id, ...(st !== undefined ? { settlement: st } : { radius: 1500 }) }, `take the ${n.text} away`);
        return true;
      case 'species': c.add({ k: 'life.extinct', species: n.id, ...(st !== undefined ? { settlement: st } : {}) }, `take the ${n.text} from the world`); return true;
      case 'plant': {
        const def = u.content.plants.find(n.id);
        if (def?.type === 'crop') { c.add({ k: 'settlement.withdraw', crop: n.id, ...(all && st === undefined ? { everywhere: true } : st !== undefined ? { settlement: st } : {}) }, `take the ${n.text} away`); return true; }
        c.add({ k: 'life.kill', what: 'plants', radius: Math.round(400 * (mods.size ?? 1)) }, `clear the ${n.text}`);
        return true;
      }
      case 'item': c.add({ k: 'settlement.withdraw', item: n.id, ...(all && st === undefined ? { everywhere: true } : st !== undefined ? { settlement: st } : {}) }, `take the ${n.text} away`); return true;
      case 'recipe': {
        if (st !== undefined) { c.add({ k: 'settlement.withdraw', idea: n.id, settlement: st }, `make ${mods.place!.label} forget ${n.text}`); return true; }
        for (const t of (p?.people?.settlements ?? []).filter((x) => x.fallen < 0)) c.add({ k: 'settlement.withdraw', idea: n.id, settlement: t.id }, `make them forget ${n.text}`);
        return c.out.length > 0 || c.ask('There is nobody to forget it.');
      }
      case 'building': return false;
      default: break;
    }
  }
  // a kind of thing ("the tools of Aru", "their weapons", "all the food"): every such item they hold
  const kinds: [RegExp, string][] = [[/\btools?\b/, 'tool'], [/\bweapons?\b|\barms\b/, 'weapon'], [/\bfood\b|\bharvest\b|\bstores\b/, 'food'], [/\bdrinks?\b|\bwine\b|\bale\b/, 'drink'], [/\bwealth\b|\btreasure\b|\bgold\b|\bluxur/, 'luxury'], [/\bclothes\b|\bclothing\b|\bcloth\b/, 'cloth'], [/\bfuel\b/, 'fuel']];
  const kindHit = kinds.find(([re]) => re.test(s));
  if (kindHit && p?.people) {
    const tag = kindHit[1];
    const towns = st !== undefined ? [p.people.settlement(st)].filter((x) => x) : p.people.settlements.filter((x) => x.fallen < 0);
    let any = false;
    for (const t of towns) {
      if (!t) continue;
      u.content.items.list.forEach((it, i) => {
        if ((t.store[i] ?? 0) > 0 && (it.tags ?? []).includes(tag)) { c.add({ k: 'settlement.withdraw', item: it.id, settlement: t.id }, `take the ${it.name.toLowerCase()} from ${t.name}`); any = true; }
      });
    }
    return any || c.ask(`${st !== undefined ? mods.place!.label.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Nobody'} has no ${kindHit[1] === 'tool' ? 'tools' : kindHit[1]} to take.`);
  }
  if (/\b(air|atmosphere|sky|skies)\b/.test(s)) { c.add({ k: 'planet.remove-air' }, 'strip the air'); return true; }
  if (/\b(fire|fires|flames|blaze)\b/.test(s)) { c.add({ k: 'fire.extinguish', radius: all ? 20000 : 400 }, 'put out the fires'); return true; }
  if (/\b(water|lake|flood|floodwater)\b/.test(s)) { c.add({ k: 'water.remove', radius: Math.round(400 * (mods.size ?? 1)) }, 'take the water away'); return true; }
  if (/\b(seas?|oceans?)\b/.test(s)) { c.add({ k: 'water.sea-level', delta: -50 }, 'the seas fall 50 m'); return true; }
  if (/\b(people|everyone|everybody|folk|villagers|townsfolk|inhabitants|population)\b/.test(s) && st !== undefined) {
    const sp = p?.people?.settlement(st);
    if (sp) { c.add({ k: 'life.extinct', species: u.content.species.list[sp.species].id, settlement: st }, `take the people of ${mods.place!.label} away`); return true; }
  }
  if (/\b(tilt|gravity|magnetic|magnetism|seasons?)\b/.test(s)) return false;
  // a settlement itself: "wipe out Aru", "remove Aru"
  if (st !== undefined && s.replace(/\b(the|of|from|it|them|town|city|village|settlement|map|world|face|earth|off)\b/g, ' ').trim().split(/\s+/).every((w) => /^(remove|take|away|withdraw|wipe|out|erase|banish|purge|eliminate|eradicate|exterminate|expel|drive|clear|get|rid|do|with)$/.test(w))) {
    c.add({ k: 'settlement.raze', settlement: st }, 'raze');
    c.add({ k: 'life.kill', settlement: st, what: 'people' }, 'death');
    return true;
  }
  return c.ask('Take away what? Name it — "remove the wolves", "take the rice away from Aru", "cure the pox", "repeal the law of peace".');
}

/** put out / quench / douse / extinguish the fire */
function intentExtinguish(c: Clause): boolean {
  const { s, cx, mods } = c;
  if (!verb(cx, s, 'extinguish')) return false;
  if (has(s, 'sun', 'star')) return false;
  c.add({ k: 'fire.extinguish', radius: mods.place?.everywhere ? 20000 : Math.round(300 * (mods.size ?? 1)) }, 'put out the fires');
  return true;
}

// ───────────────────────────── time ─────────────────────────────

const NAMED_HOURS: [RegExp, number][] = [[/\b(noon|midday|high noon)\b/, 12], [/\bmidnight\b/, 0], [/\b(dawn|sunrise|daybreak|first light)\b/, 6], [/\b(dusk|sunset|evening|twilight|nightfall)\b/, 18], [/\bmorning\b/, 9], [/\bafternoon\b/, 15], [/\b(night|nighttime|night time)\b/, 23], [/\b(day|daytime|daylight|day time)\b/, 12]];

/** an hour of a 24-hour clock in words: "noon", "15:00", "3 pm", "3:30pm", "15 o'clock", "15h" (null: none) */
function clockHour(t: string): number | null {
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|o'clock|oclock|h|hours?)?\b/);
  if (m && (m[2] !== undefined || m[3] !== undefined || /^\s*\d{1,2}\s*$/.test(t))) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3] ?? '';
    if (/^p/.test(ap) && h < 12) h += 12;
    if (/^a/.test(ap) && h === 12) h = 0;
    if (h > 24 || min > 59) return null;
    return (h % 24) + min / 60;
  }
  for (const [re, h] of NAMED_HOURS) if (re.test(t)) return h;
  return null;
}

/** an hour of the 24-hour clock as an hour of this world's day */
function scaleHour(cx: PCtx2, h24: number): number {
  return Math.round((h24 / 24) * (cx.p?.st.dayHours ?? 24) * 1000) / 1000;
}

function fmtClock(h: number): string {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
}

/** a span of time named in a clause ("an hour", "three days", "100 years") in ticks (null: none) */
function spanOf(cx: PCtx2, s: string): number | null {
  const tk = s.match(/\b(\d+|a|an|one|two|three|ten)\s+ticks?\b/);
  if (tk) return numberWord(cx.L, tk[1]) ?? 1;
  const m = s.match(/\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|a hundred|hundred|a few|few|several|a couple of)\s+(minutes?|hours?|days?|weeks?|months?|seasons?|years?|nights?)\b/);
  if (!m) return null;
  const w = m[1].replace(/^a hundred$/, 'hundred').replace(/^a few$/, 'few').replace(/^a couple of$/, 'couple');
  const n = numberWord(cx.L, w) ?? 1;
  return durationTicks(cx.L, cx.p, n, m[2]) ?? null;
}

/** the longest step taken at once (≈ a week): beyond it, time is set running fast instead of blocking the world */
const STEP_CAP = 7 * 1440;

function intentTime(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { L, p } = cx;
  if (verb(cx, s, 'rewind')) {
    const m = full.match(/(\d+(?:\.\d+)?|[a-z]+)?\s*(minutes?|hours?|days?|weeks?|years?)/);
    const n = m && m[1] ? numberWord(L, m[1]) ?? 1 : 1;
    const t = m ? durationTicks(L, p, n, m[2]) ?? 60 : 60;
    c.add({ k: 'time.rewind', ticksAgo: t }, `rewind ${Math.round(t / 60)} h`);
    return true;
  }
  const dNoun = findNoun(cx.u.content, p, s, ['disaster']);
  if (verb(cx, s, 'pause') && !dNoun) { c.add({ k: 'time.speed', speed: 0 }, 'pause'); return true; }
  const lawish = /\b(spin|spins|spinning|rotat|turn|faith|belief|grow|grows|walk|run|breed|age|ages|learn|learns|days?|years?|disasters?|plants?|crops?|winds?|hand|creature|miracles?|people|folk)\b/;
  if (verb(cx, s, 'faster') && !lawish.test(s)) { c.add({ k: 'time.speed', speed: c.mods.nums[0] ?? 100 }, 'faster'); return true; }
  if (verb(cx, s, 'slower') && !lawish.test(s)) { c.add({ k: 'time.speed', speed: c.mods.nums[0] ?? 1 }, 'slower'); return true; }
  // wait / skip / let time pass: a step of that length (a long one sets time running fast instead)
  const waitV = verb(cx, s, 'wait') ?? (/\blet\b.+\bpass\b/.test(full) ? 'pass' : null);
  if (waitV && !dNoun && !/\b(sun|creature|rain)\b/.test(s)) {
    const t = (mods.duration !== undefined && mods.duration > 0 ? mods.duration : null) ?? spanOf(cx, full);
    if (t !== null && t > 0) {
      if (t <= STEP_CAP) { c.add({ k: 'time.step', ticks: Math.max(1, Math.round(t)) }, `let ${spanWords(cx, t)} pass`); return true; }
      c.add({ k: 'time.step', ticks: STEP_CAP }, `let a week pass at once`);
      c.add({ k: 'time.speed', speed: 1000 }, `then time runs at 1000× (the rest of the ${spanWords(cx, t)} passes in minutes; "resume" to slow it)`);
      return true;
    }
    if (/^(wait|step|skip|pass)$/.test(s.trim())) { c.add({ k: 'time.step', ticks: 60 }, 'let an hour pass'); return true; }
  }
  const speedM = s.match(/\b(?:speed|time)\s+(?:to\s+)?(\d+)\s*x?\b/);
  if (speedM) { c.add({ k: 'time.speed', speed: parseFloat(speedM[1]) }, 'speed'); return true; }
  // the sun and the seasons held still
  if (/\b(stop|freeze|halt|hold|end)\b.*\b(the )?(day|days|daylight|night)\b/.test(s) && !/\blong|length|hours\b/.test(s)) { c.add({ k: 'time.freeze-sun', on: true }, 'the sun stands still'); return true; }
  if (/\b(stop|freeze|halt|hold|end|no more|pause)\b.*\bseasons?\b/.test(s) || /\bseasons? stand still\b/.test(s)) { c.add({ k: 'weather.pin-season', season: seasonNow(cx) }, `hold ${seasonNow(cx)}`); return true; }
  // the hour of the day (local to where the god looks)
  {
    const weatherNoun = findNoun(cx.u.content, p, s, ['weather']);
    const clocky = /\b(scrub|move the sun|sun to|time to|hour to|clock to|set the (hour|time|clock))\b|\d\s*(am|pm|o'clock)|\b\d{1,2}:\d{2}\b/.test(s);
    const named = NAMED_HOURS.some(([re]) => re.test(s)) && (/^(make it |it is |let it be |bring |turn it to |bring on |bring on the )?(\w+ )?(noon|midday|midnight|dawn|sunrise|daybreak|first light|dusk|sunset|evening|twilight|nightfall|morning|afternoon|night|nighttime|day|daytime|daylight)( now)?$/.test(s.trim()) || /\b(make it|bring on|it is|turn it to|skip to|jump to|go to)\b/.test(s));
    const h = clockHour(s);
    if (h !== null && (clocky || (named && !weatherNoun)) && !/\b(days|long|length|year|years|tilt)\b/.test(s)) {
      const at = placePos(c);
      c.add({ k: 'time.set-hour', hour: scaleHour(cx, h), ...(at ? { at } : {}) }, `the sun to ${fmtClock(h)}${at ? ' (local time)' : ''}`);
      // "make it night forever", "eternal day": the sun is held there
      if (mods.duration === -1 || /\b(always|eternal|endless|perpetual|forever)\b/.test(full)) c.add({ k: 'time.freeze-sun', on: true }, 'and the sun stands still');
      return true;
    }
  }
  if (/\bhour\b/.test(s) && mods.nums.length && !/\b(day|days|long)\b/.test(s)) {
    const at = placePos(c);
    c.add({ k: 'time.set-hour', hour: scaleHour(cx, mods.nums[0]), ...(at ? { at } : {}) }, `the sun to hour ${mods.nums[0]}`);
    return true;
  }
  // the length of the year (before the day: "make the year 30 days long"); not "a year-long eclipse"
  if (dNoun) return false;
  if (/\b(years?|year length|length of the year)\b/.test(s) && /\b(long|longer|shorter|length|last|lasts|days|double|twice|half|halve|triple|more|less)\b/.test(s)) {
    const d = findParam('planet.yearDays')!;
    const cur = paramNow(cx, d.path);
    const n = s.match(/(\d+(?:\.\d+)?)\s*days?\b/);
    const v = n ? parseFloat(n[1]) : relValue(cur, s, mods);
    if (v === null) return c.ask(question({ k: 'time.year-length' }, 'days', 'Length of the year'));
    c.add({ k: 'time.year-length', days: Math.round(Math.max(0.5, Math.min(2000, v)) * 100) / 100 }, `a year of ${Math.round(v * 10) / 10} days`);
    return true;
  }
  // the length of the day
  if (/\b(day|days|day length|length of the day|daylight)\b/.test(s) && /\b(long|longer|shorter|length|last|lasts|hours|double|twice|half|halve|triple|more|less)\b/.test(s) && !/\bago\b/.test(s)) {
    const cur = p?.st.dayHours ?? 24;
    const n = s.match(/(\d+(?:\.\d+)?)\s*(hours?|h)\b/) ?? (mods.nums.length && /\blong\b/.test(s) ? ['', String(mods.nums[0])] : null);
    const v = n ? parseFloat(n[1]) : relValue(cur, s, mods);
    if (v === null || v <= 0) return c.ask(question({ k: 'time.day-length' }, 'hours', 'Length of the day'));
    c.add({ k: 'time.day-length', hours: Math.round(Math.max(1, Math.min(2000, v)) * 100) / 100 }, `a day of ${Math.round(v * 10) / 10} hours`);
    return true;
  }
  // the tilt of the axis (the seasons)
  if (/\b(tilt|tilted|axis|axial|obliquity)\b/.test(s) || /\b(no|remove the|without) seasons\b/.test(s)) {
    const cur = paramNow(cx, 'planet.axialTilt');
    const n = s.match(/(-?\d+(?:\.\d+)?)\s*(degrees?|°|deg)?/);
    const v = /\b(no|remove the|without) seasons\b/.test(s) ? 0 : n && mods.by === undefined ? parseFloat(n[1]) : relValue(cur, s, mods, { step: 10 });
    if (v === null) return c.ask(question({ k: 'time.axial-tilt' }, 'degrees', 'Tilt the axis'));
    c.add({ k: 'time.axial-tilt', degrees: Math.round(Math.max(0, Math.min(180, v)) * 10) / 10 }, `the axis leans ${Math.round(v * 10) / 10}°`);
    return true;
  }
  // the sun stands still / moves again
  if (/\b(release|unfreeze|let)\b.*\bsun\b|\bsun\b.*\bmove again\b/.test(s)) { c.add({ k: 'time.freeze-sun', on: false }, 'let the sun move'); return true; }
  if (/\b(freeze|stop|hold)\b.*\bsun\b|\bsun\b.*\bstand(s)? still\b/.test(s)) { c.add({ k: 'time.freeze-sun', on: true }, 'the sun stands still'); return true; }
  // a season held
  for (const se of ['spring', 'summer', 'autumn', 'winter']) {
    if (new RegExp(`\\b${se}\\b`).test(s) && (/\b(always|forever|pin|eternal|endless|keep|make it|hold|last|lasts)\b/.test(full) || mods.duration === -1)) { c.add({ k: 'weather.pin-season', season: se }, `hold ${se}`); return true; }
  }
  if (/\b(seasons? (turn|move|change|come|go) again|release the seasons?|unpin|let the seasons?)\b/.test(s)) { c.add({ k: 'weather.pin-season', season: 'none' }, 'let the seasons turn'); return true; }
  if (/\bpin the season\b|\bseason to\b/.test(s)) {
    const se = ['spring', 'summer', 'autumn', 'winter'].find((x) => has(s, x)) ?? seasonNow(cx);
    c.add({ k: 'weather.pin-season', season: se }, `hold ${se}`);
    return true;
  }
  return false;
}

function spanWords(cx: PCtx2, t: number): string {
  const day = dayTicks(cx.p);
  const year = Math.round(cx.p?.st.orbit.period ?? day * 12);
  if (t >= year * 0.95) return `${Math.round((t / year) * 10) / 10} year${Math.round(t / year) === 1 ? '' : 's'}`;
  if (t >= day) return `${Math.round((t / day) * 10) / 10} day${Math.round(t / day) === 1 ? '' : 's'}`;
  if (t >= 60) return `${Math.round(t / 6) / 10} hour${Math.round(t / 60) === 1 ? '' : 's'}`;
  return `${t} minute${t === 1 ? '' : 's'}`;
}

// ───────────────────────────── the live disasters ─────────────────────────────

const GENERIC_DISASTER = /\b(disasters?|catastroph(e|es)|calamit(y|ies)|cataclysms?|plagues of the gods)\b/;

function intentDisaster(c: Clause): boolean {
  const { s, cx, mods } = c;
  // a law about disasters ("make disasters harmless", "no more natural disasters") is not a disaster
  if (LAW_WORDS.some(([re]) => re.test(s)) && !findNoun(cx.u.content, cx.p, s, ['disaster'])) return false;
  const dNoun = findNoun(cx.u.content, cx.p, s, ['disaster']);
  const generic = GENERIC_DISASTER.test(s);
  const stopV = verb(cx, s, 'stop') !== null || has(s, 'cancel');
  const anyLive = lastDisaster(cx) !== undefined;
  // a random one: "send a random disaster", "surprise me", "unleash a random catastrophe"
  if (/\b(random|any|surprise me|some|whatever|fate)\b/.test(s) && (generic || /\bsurprise me\b/.test(s)) && !stopV) {
    c.add({ k: 'disaster.spawn', kind: 'random' }, 'a random disaster');
    return true;
  }
  if ((generic || /\beverything\b/.test(s)) && stopV && (/\b(all|every|each|everything)\b/.test(s) || /\b(disasters|catastrophes|calamities)\b/.test(s))) {
    c.add({ k: 'disaster.cancel', all: true }, 'stop every disaster');
    return true;
  }
  const explicitNew = /\b(another|a new|new|second|one more|more)\b/.test(s);
  const pron = has(s, 'it', 'that', 'them', 'this');
  const otherNoun = findNoun(cx.u.content, cx.p, s, ['weather', 'animal', 'species', 'plant', 'item', 'biome', 'material', 'miracle', 'creature', 'building']);
  const target = dNoun ? lastDisaster(cx, dNoun.id) : (generic || (pron && !otherNoun && !/\b(rain|snow|hail)\b/.test(s))) && anyLive ? lastDisaster(cx) : undefined;
  if (dNoun && target === undefined && stopV) { c.add({ k: 'disaster.cancel', kind: dNoun.id }, 'stop'); return true; }
  if (generic && !dNoun && target === undefined && !anyLive && !stopV && /\b(send|unleash|bring|cause|start|make|summon|call down|drop)\b/.test(s)) {
    c.add({ k: 'disaster.spawn', kind: 'random' }, 'a disaster');
    return true;
  }
  // a live disaster spoken to when there is none ("move the tornado to Lune", "make the plague worse"): say so, and
  // offer to send one (never a new one in silence: "the" names one that should already be there)
  if (dNoun && target === undefined && !explicitNew && !new RegExp(`\\b(a|an|some)\\s+(?:\\w+\\s+){0,2}${esc(dNoun.text)}`).test(s)
    && /\b(move|push|steer|redirect|turn|weaken|weaker|worse|stronger|fiercer|bigger|smaller|larger|grow|shrink|freeze|unfreeze|hold|speed up|slow down|calm)\b/.test(s)) {
    cx.asked.push({ k: 'disaster.spawn', kind: dNoun.id, ...(mods.place?.pos ? { pos: mods.place.pos } : {}) });
    return c.ask(`There is no ${dNoun.text} raging now to act on — send one first ("a ${dNoun.text}${mods.place?.label ? ` on ${mods.place.label.replace(/\b\w/g, (m) => m.toUpperCase())}` : ' here'}").`);
  }
  if (target === undefined || (dNoun && explicitNew)) return false;
  if (stopV || /\b(go away|vanish|disappear|be gone|begone|dissolve|die down|die out|end)\b/.test(s)) { c.add({ k: 'disaster.cancel', id: target }, 'stop'); return true; }
  if (verb(cx, s, 'unfreeze') || /\blet\b.*\b(go on|move|continue|carry on|run)\b/.test(s) || /\b(thaw|resume|go on)\b/.test(s)) { c.add({ k: 'disaster.freeze', id: target, on: false }, 'unfreeze'); return true; }
  if (verb(cx, s, 'freeze') || /\b(hold|pause|stop it|keep)\b.*\b(where it is|in place|still|there)\b/.test(s) || /^(hold|pause)\b/.test(s)) { c.add({ k: 'disaster.freeze', id: target, on: true }, 'freeze'); return true; }
  const times = s.match(/\b(\d+(?:\.\d+)?)\s*(?:times|x)\b/);
  const factorUp = /\b(twice|double|doubled)\b/.test(s) ? 2 : /\b(triple|thrice|three times)\b/.test(s) ? 3 : times ? parseFloat(times[1]) : mods.size && mods.size > 1 ? mods.size : mods.nums[0] && mods.nums[0] > 1 ? mods.nums[0] : 2;
  if (verb(cx, s, 'shrink') || /\b(half|halve|by half|weaker|weaken|smaller|tame|gentler|less)\b/.test(s) || (mods.size !== undefined && mods.size < 1)) {
    const f = /\b(half|halve|by half)\b/.test(s) ? 0.5 : times ? 1 / parseFloat(times[1]) : mods.size && mods.size < 1 ? mods.size : 0.5;
    c.add({ k: 'disaster.scale', id: target, factor: Math.max(0.05, f) }, 'smaller');
    return true;
  }
  if (verb(cx, s, 'grow') || /\b(twice|double|triple|bigger|larger|stronger|worse|more)\b/.test(s) || times || (mods.size !== undefined && mods.size > 1 && has(s, 'make'))) {
    c.add({ k: 'disaster.scale', id: target, factor: Math.min(20, factorUp) }, 'bigger');
    return true;
  }
  if (verb(cx, s, 'steer') || has(s, 'move', 'push', 'send it', 'turn it', 'steer', 'blow', 'drive', 'lead', 'aim', 'direct')) {
    const to = mods.toward ?? mods.place;
    const dirW = Object.keys(BEARINGS).find((w) => has(s, w));
    const d = cx.u.god.disaster(target);
    if (!to?.pos && dirW && d && cx.p) {
      const pos = directional(cx.p, d.pos as V3, BEARINGS[dirW], 900);
      c.add({ k: 'disaster.move', id: target, toward: pos }, `move it ${dirW}`);
      return true;
    }
    c.add({ k: 'disaster.move', id: target, ...(to?.pos ? (mods.toward ? { toward: to.pos } : { to: to.pos }) : {}) }, 'move');
    return true;
  }
  // the disaster named with an act we do not know, and no making word: ask (never a second one by accident)
  if (dNoun) {
    const rest = s.replace(dNoun.text, ' ').replace(/\b(the|a|an|that|this|it|on|over|at|near|in)\b/g, ' ').trim();
    if (!rest || verb(cx, rest, 'create')) return false;
    return c.ask(`What should the ${dNoun.text} do? Stop it, make it bigger or smaller, move it toward a place, or freeze it — or ask for "another ${dNoun.text}".`);
  }
  return false;
}

// ───────────────────────────── the laws of the planet in words ─────────────────────────────

/** words naming a law of the world -> its path (relative changes: "double the gravity", "no magnetic field") */
const LAW_WORDS: [RegExp, string, { step?: number; invert?: boolean }?][] = [
  [/\bgravity\b|\bpull of the (world|planet)\b/, 'planet.gravity'],
  [/\bmagnet(ic field|ism|osphere|ic)\b|\bmagnetic\b/, 'planet.magnetism'],
  [/\bnatural disasters?\b|\bnature'?s? (violence|wrath|fury)\b|\bdisasters on (their|its) own\b/, 'disasters.natural'],
  [/\bdisasters?\b.*\b(harmless|deadl|harm|kill|gentle|mild|lethal)/, 'disasters.harm'],
  [/\b(faith|belief|worship)\b.*\b(grow|grows|spread|gain|faster|slower|more|less)\b|\bbelief gain\b/, 'belief.gain'],
  [/\b(hand)\b.*\b(stronger|weaker|strength|stronger)\b|\bhand strength\b/, 'hand.strength'],
  [/\bcreatures?\b.*\b(learn|learning)\b/, 'creature.learning'],
  [/\bcreatures?\b.*\b(grow|growth)\b/, 'creature.growth'],
  [/\bmiracles?\b.*\b(stronger|weaker|potent|power)\b/, 'miracles.potency'],
  [/\brival gods?\b.*\b(active|activity|busier|quieter)\b/, 'rivals.activity'],
  [/\b(clouds|cloudiness|cloud cover|cloudier)\b/, 'planet.cloudiness'],
  [/\b(plants?|vegetation|forests?)\b.*\bgrow/, 'vegetation.growth'],
  [/\b(fires?)\b.*\bspread/, 'fire.spread'],
  [/\berosion\b/, 'hydro.erosion'],
  [/\bevaporation\b/, 'hydro.evaporation'],
  [/\b(weather)\b.*\b(wild|active|calm|often)/, 'weather.spawn'],
  [/\b(rain)\b.*\b(stronger|weaker|heavier|lighter)\b/, 'hydro.rainScale'],
  [/\beccentric/, 'orbit.eccentricity'],
];

function intentPlanetLaws(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  // the star: its kind ("a blue giant", "a second sun"), its light ("brighter", "make the sun hotter")
  if (/\b(second|another|twin|two|extra) suns?\b|\bbinary\b|\btwo stars\b/.test(s)) { c.add({ k: 'star.set', kind: 'binary' }, 'a second sun: a binary pair'); return true; }
  const starN = findNoun(u.content, p, s, ['star']);
  if (starN && (has(s, 'star', 'sun', 'becomes', 'become', 'turn', 'into', 'make') || s.trim() === starN.text)) { c.add({ k: 'star.set', kind: starN.id }, `the star becomes a ${starN.text}`); return true; }
  if (/\b(sun|star)\b/.test(s) && /\b(brighter|brighten|hotter|stronger|more light|blaze|burn brighter)\b/.test(s)) { c.add({ k: 'star.set', luminosity: Math.min(10000, u.star.luminosity * (mods.nums[0] ?? (/\b(much|far|twice|double)\b/.test(s) ? 2 : 1.3))) }, 'brighten the star'); return true; }
  if (/\b(sun|star)\b/.test(s) && /\b(dimmer|dim|darker|weaker|cooler|colder|less light|fade)\b/.test(s)) { c.add({ k: 'star.set', luminosity: u.star.luminosity / (mods.nums[0] ?? (/\b(much|far|twice|half)\b/.test(s) ? 2 : 1.3)) }, 'dim the star'); return true; }
  if (/\b(brighter|brighten|more light)\b/.test(s) && !/\b(sky|fire|lamp)\b/.test(s)) { c.add({ k: 'star.set', luminosity: Math.min(10000, u.star.luminosity * (mods.nums[0] ?? 1.5)) }, 'brighten the star'); return true; }
  if (/\b(dimmer|darker sun|less light)\b/.test(s)) { c.add({ k: 'star.set', luminosity: u.star.luminosity / (mods.nums[0] ?? 1.5) }, 'dim the star'); return true; }
  // the spin of the world: faster = shorter days; stopped = the sun stands still
  if (/\b(spin|spins|spinning|rotate|rotates|rotating|rotation|turning)\b/.test(s) && !/\b(sun to|hour)\b/.test(s)) {
    if (/\b(stop|halt|freeze|end|no|cease|stand still)\b/.test(s)) { c.add({ k: 'time.freeze-sun', on: true }, 'the world stops turning'); return true; }
    if (/\b(start|again|resume)\b/.test(s)) { c.add({ k: 'time.freeze-sun', on: false }, 'the world turns again'); return true; }
    const cur = p?.st.dayHours ?? 24;
    const v = relValue(cur, s, mods, { invert: true });
    if (v !== null) { c.add({ k: 'planet.set', spin: Math.round(Math.max(1, Math.min(2000, v)) * 100) / 100 }, `a day of ${Math.round(v * 10) / 10} hours`); return true; }
  }
  // the world nearer or farther from its star
  const moveW = full.match(/\b(?:move|push|pull|put|set|place)\b.*?(?:to\s+)?(\d+(?:\.\d+)?)\s*au\b/);
  if (moveW) { c.add({ k: 'world.move', distance: parseFloat(moveW[1]) }, 'move the world'); return true; }
  if (/\b(closer|nearer|towards?) (to )?the (sun|star)\b/.test(s) || /\b(farther|further|away) from the (sun|star)\b/.test(s)) {
    const cur = p ? p.st.orbit.a / (p.st.orbit.parent >= 0 ? AU * 0.01 : AU) : 1;
    const near = /\b(closer|nearer|towards?)\b/.test(s);
    c.add({ k: 'world.move', distance: Math.round(Math.max(0.05, Math.min(40, cur * (near ? 0.8 : 1.25))) * 1000) / 1000 }, near ? 'nearer the star' : 'farther from the star');
    return true;
  }
  // the warmth of the whole world ("make the world warmer", "global warming", "an ice age" is a disaster)
  const warm = /\b(hotter|warmer|heat up|warm up|warming|warm|hot|twice as (hot|warm)|much (hotter|warmer))\b/.test(s);
  const cool = /\b(colder|cooler|cool down|chill|chilly|freezing|cold|twice as cold|much (colder|cooler)|cooling)\b/.test(s);
  const worldwide = /\b(world|planet|globe|global|globally|earth|climate|everywhere)\b/.test(full) || !!mods.place?.everywhere || /\btwice as\b|\bdegrees\b/.test(s);
  if ((warm || cool) && worldwide && !/\b(rain|snow|storm|weather|wind|sun|star|air|sea|ocean|water|people|folk)\b/.test(s)) {
    const n = s.match(/(-?\d+(?:\.\d+)?)\s*(degrees?|°c?|c\b)?/);
    const step = n ? Math.abs(parseFloat(n[1])) : /\b(twice|much|far|a lot|very)\b/.test(s) ? 10 : 5;
    const cur = p?.st.climateOffset ?? 0;
    const v = Math.round((cur + (warm && !cool ? step : -step)) * 10) / 10;
    c.add({ k: 'set', path: 'climate.offset', value: Math.max(-150, Math.min(150, v)) }, `${warm && !cool ? 'warmer' : 'colder'} by ${step} °C`);
    return true;
  }
  // any other law named with a relative word ("double the gravity", "low gravity", "no magnetic field")
  for (const [re, path, o] of LAW_WORDS) {
    if (!re.test(s)) continue;
    const d = findParam(path);
    if (!d) continue;
    const cur = paramNow(cx, path);
    const n = mods.nums.length && !/\btimes\b/.test(s) && mods.by === undefined ? mods.nums[0] : null;
    let v = n !== null && /\b(to|at|is|be)\b/.test(s) ? n : relValue(cur, s, mods, o ?? {});
    if (path === 'disasters.harm' && v === null) v = /\bharmless\b/.test(s) ? 0 : /\b(deadl|lethal|terrible)\w*/.test(s) ? Math.max(1, cur) * 2 : null;
    if (path === 'disasters.natural' && v === null && /\b(on|back|return|again|allow|let)\b/.test(s)) v = Math.max(1, cur);
    if (v === null) {
      if (n !== null) v = n;
      else continue;
    }
    return setParam(c, d, v, `${d.label}: ${Math.round(cur * 1000) / 1000} → ${Math.round(Math.max(d.min ?? -Infinity, Math.min(d.max ?? Infinity, v)) * 1000) / 1000}`);
  }
  return false;
}

// ───────────────────────────── the air and the sky ─────────────────────────────

const GASES: [RegExp, string, string][] = [[/\b(oxygen|o2)\b/, 'o2', 'oxygen'], [/\b(carbon dioxide|co2|carbon)\b/, 'co2', 'carbon dioxide'], [/\bmethane\b/, 'methane', 'methane'], [/\b(nitrogen|n2)\b/, 'n2', 'nitrogen']];

function intentAir(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const at = p?.st.atmosphere;
  // the colour of the sky ("make the sky blood red", "a green sky", "normal sky")
  const sky = /\b(sky|skies|heavens|firmament)\b/.test(s);
  const colour = Object.keys(cx.L.colours).sort((a, b) => b.length - a.length).find((w) => wordAt(s, w) >= 0);
  if (sky && (colour || /\b(normal|natural|usual|own colour|own color|back to normal)\b/.test(s)) && !/\b(rain|clear)\b/.test(s.replace(/\bblood-?red\b/, ''))) {
    const tint = colour && !/\b(normal|natural|usual|back to normal)\b/.test(s) ? cx.L.colours[colour] : null;
    c.add({ k: 'planet.atmosphere', tint }, tint ? `a ${colour} sky` : 'the sky its own colour again');
    return true;
  }
  if (/\bmoon\b/.test(s) && colour && /\b(turn|make|paint|colou?r)\b/.test(s)) {
    const moon = u.planets.find((q) => q.alive && q.st.orbit.parent === (p?.id ?? 0));
    if (!moon) return c.ask(`${p?.name ?? 'This world'} has no moon to colour ("add a moon" first).`);
    c.add({ k: 'planet.atmosphere', tint: cx.L.colours[colour], planet: moon.id }, `${moon.name} turns ${colour}`);
    return true;
  }
  const air = /\b(air|atmosphere|breathe|breath|airless|sky|skies)\b/.test(s);
  const gas = GASES.find(([re]) => re.test(s));
  if (!air && !gas && !/\b(toxic|poison|poisonous)\b.*\bair\b/.test(s)) return false;
  if (/\b(rain|weather)\b/.test(s) && !/\bairless\b/.test(s)) return false;
  // a gas raised or lowered ("add more oxygen", "fill the air with carbon dioxide", "less methane")
  if (gas && at) {
    const [, key, name] = gas;
    const cur = (at as unknown as Record<string, number>)[key] ?? 0;
    let v: number | null = null;
    if (mods.pct && mods.nums.length) v = mods.nums[0];
    else if (/\bfill\b/.test(s)) v = 0.6;
    else if (ZERO.test(s) && !/\bno more\b/.test(s)) v = 0;
    else if (DOWN.test(s) || /\b(remove|take|strip|reduce)\b/.test(s)) v = Math.max(0, cur - Math.max(0.05, cur * 0.5));
    else v = Math.min(1, cur + Math.max(0.1, cur * 0.5));
    c.add({ k: 'planet.atmosphere', gas: key, share: Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000 }, `${name} ${Math.round(v * 1000) / 10}% of the air`);
    return true;
  }
  // poison and dust
  if (/\b(toxic|poison|poisonous|deadly|foul|acrid|unbreathable)\b/.test(s)) { c.add({ k: 'planet.atmosphere', toxicity: 0.7 }, 'poison the air'); return true; }
  if (/\b(clean|pure|purify|cleanse|fresh|clear)\b/.test(s) && /\bair\b/.test(s)) { c.add({ k: 'planet.atmosphere', toxicity: 0, dust: 0 }, 'clean the air'); return true; }
  if (/\b(dust|dusty|ash|smoke|smoky)\b/.test(s) && /\b(sky|air)\b/.test(s)) { c.add({ k: 'planet.atmosphere', dust: Math.min(10, (at?.dust ?? 0) + 2) }, 'dust in the sky'); return true; }
  // none at all / thinner / thicker
  if (/\b(no|without|airless|vacuum)\b/.test(s) || /\b(remove|strip|take|suck|steal|destroy)\b.*\b(air|atmosphere|sky|skies)\b/.test(s)) {
    const n = mods.nums[0];
    c.add({ k: 'planet.remove-air', ...(n !== undefined && !/\b(no|airless)\b/.test(s) ? { amount: n } : {}) }, 'strip the air');
    return true;
  }
  if (/\b(thin|thinner|less|reduce|lighter|weaker)\b/.test(s)) {
    const cur = at?.pressure ?? 1;
    c.add({ k: 'planet.remove-air', amount: Math.round((mods.nums[0] ?? cur * 0.5) * 1000) / 1000 }, 'thin the air');
    return true;
  }
  if (/\b(change|alter)\b/.test(s) && !/\b(thick|more|add|give)\b/.test(s)) return c.ask(ANY_OF_Q['planet.atmosphere']);
  if (/\b(air|atmosphere|breathe|breath)\b/.test(s)) {
    const n = mods.nums[0];
    c.add({ k: 'planet.add-air', amount: n ?? 1 }, `breathe ${n ?? 1} atm of air`);
    return true;
  }
  return false;
}

// ───────────────────────────── the seas ─────────────────────────────

function intentSea(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  if (!p) return false;
  // the ice caps melt
  if (/\b(melt|thaw)\b.*\b(ice caps?|polar ice|poles|ice sheets?|glaciers?|the ice)\b/.test(s)) {
    c.add({ k: 'terrain.paint-material', material: 'ice', depth: -100, pos: [0, 1, 0], radius: 20000 }, 'the northern ice melts');
    c.add({ k: 'terrain.paint-material', material: 'ice', depth: -100, pos: [0, -1, 0], radius: 20000 }, 'the southern ice melts');
    c.add({ k: 'water.sea-level', delta: 5 }, 'the seas rise 5 m');
    return true;
  }
  // the seas boil
  if (/\b(boil|boiling|heat)\b.*\b(seas?|oceans?|water|lakes?)\b|\b(seas?|oceans?|water|lakes?)\b.*\b(boil|boils|boiling)\b/.test(s)) {
    const sea = nearestPlaceKind(u, p, placePos(c) ?? [0, 0, 1], /\blake\b/.test(s) ? 'lake' : 'sea');
    c.add({ k: 'disaster.spawn', kind: 'heat-wave', intensity: 3, ...(sea ? { pos: sea } : {}) }, 'the waters boil (a fierce heat)');
    return true;
  }
  const seaWord = /\bsea level\b|\bsea-level\b|\bsealevel\b|\bseas?\b|\boceans?\b|\btides?\b/.test(s);
  if (!seaWord) return false;
  if (/\b(dig|carve|scoop|make|new|create|hollow)\b.*\b(seas?|oceans?)\b/.test(s) && !/\bto the sea\b|\briver\b|\blevel\b|\brise|raise|lower\b/.test(s)) {
    c.add({ k: 'terrain.dig-sea', radius: Math.round(500 * (mods.size ?? 1)), depth: mods.nums[0] ?? 40 }, 'dig a sea');
    return true;
  }
  if (/\briver\b|\bto the sea\b|\btoward the sea\b|\binto the sea\b|\bby the sea\b|\bon the sea\b|\bthe sea of\b/.test(s) && !/\b(level|rise|raise|lower|fall)\b/.test(s)) return false;
  if (/\bdrain\b/.test(s)) { c.add({ k: 'water.sea-level', delta: -(mods.nums[0] ?? 50) }, `the seas fall ${mods.nums[0] ?? 50} m`); return true; }
  const UPW = /\b(rise|rises|raise|higher|up|flood|grow|swell|more|increase|lift|deeper|climb)\b/, DOWNW = /\b(lower|fall|falls|drop|down|sink|recede|shrink|less|decrease|reduce|shallower)\b/;
  if (UPW.test(s) || DOWNW.test(s) || mods.nums.length) {
    const n = mods.by ?? mods.nums[0];
    if (n !== undefined && mods.by === undefined && !UPW.test(s) && !DOWNW.test(s)) { c.add({ k: 'water.sea-level', value: n }, `the seas to ${n} m`); return true; }
    const up = UPW.test(s) && !DOWNW.test(s);
    c.add({ k: 'water.sea-level', delta: (up ? 1 : -1) * Math.abs(n ?? 10) }, `the seas ${up ? 'rise' : 'fall'} ${Math.abs(n ?? 10)} m`);
    return true;
  }
  void full;
  return false;
}

// ───────────────────────────── the land: rivers, roads, mountains, ground, growth ─────────────────────────────

/** where words point: a settlement named, a place kind ("the sea", "the coast"), a direction from a base, else null */
function pointOf(c: Clause, words: string, base: V3 | undefined): V3 | null {
  const { cx } = c;
  const { u, p, L } = cx;
  if (!p) return null;
  const l = findLive(words, cx.live, ['settlement', 'creature']);
  if (l?.pos) return l.pos;
  for (const [w, kind] of Object.entries(L.places).sort((a, b) => b[0].length - a[0].length)) {
    if (wordAt(words, w) < 0) continue;
    const at = nearestPlaceKind(u, p, base ?? focusPos(cx) ?? [0, 0, 1], kind);
    if (at) return at;
  }
  const d = Object.keys(BEARINGS).find((w) => wordAt(words, w) >= 0);
  if (d && base) return directional(p, base, BEARINGS[d], 900);
  if (/\b(here|there|cursor)\b/.test(words)) return focusPos(cx) ?? null;
  return null;
}

function intentLand(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  if (!p) return false;
  const here = placePos(c);
  // ── a lake, a river, a marsh, the floodwater drained (the sea is lowered instead: intentSea) ──
  if (/\b(drain|dry up|dry out|empty)\b/.test(s) && /\b(lakes?|ponds?|pools?|marsh|marshes|swamps?|bogs?|rivers?|streams?|floods?|floodwaters?|water)\b/.test(s) && !/\b(seas?|oceans?)\b/.test(s)) {
    const kind = /\b(rivers?|streams?)\b/.test(s) ? 'river' : /\b(lakes?|ponds?|pools?)\b/.test(s) ? 'lake' : '';
    const at = mods.place?.pos ?? (kind && here ? nearestPlaceKind(u, p, here, kind) : null) ?? here;
    if (kind && !mods.place?.pos && here && !nearestPlaceKind(u, p, here, kind)) return c.ask(`There is no ${kind} on ${p.name} to drain.`);
    c.add({ k: 'water.drain', ...(at ? { pos: at } : {}), radius: Math.round((kind === 'lake' ? 500 : 350) * (mods.size ?? 1)) }, `drain the ${kind || 'water'}`);
    return true;
  }
  // ── rivers: carved from X to Y; moved; turned back ──
  if (/\b(river|rivers|stream|canal|channel)\b/.test(s)) {
    const fromTo = full.match(/\bfrom (.+?) (?:to|into|toward|towards|down to) (.+)$/);
    const toOnly = full.match(/\b(?:to|into|toward|towards|down to) (.+)$/);
    const river = nearestPlaceKind(u, p, here ?? [0, 0, 1], 'river');
    if (/\b(move|divert|redirect|reroute|shift|turn)\b/.test(s) || /\baway from\b/.test(full)) {
      const away = full.match(/\baway from (.+)$/);
      if (!river) {
        // no river there: a new one is carved where the words point (away from the place, or to it)
        const base = here ?? [0, 0, 1] as V3;
        const awayFrom = away ? pointOf(c, away[1], base) ?? base : null;
        const to2 = toOnly && !away ? pointOf(c, toOnly[1], base) : null;
        const from2 = awayFrom ? moveBy(awayFrom, bearingDir(awayFrom, 1.2), 500, p.st.radius) : base;
        const end = to2 ?? (awayFrom ? moveBy(awayFrom, bearingDir(awayFrom, 1.2), 1500, p.st.radius) : nearestPlaceKind(u, p, base, 'sea') ?? directional(p, base, 90, 1200));
        c.add({ k: 'terrain.river', pos: from2, to: end }, 'no river ran there: a new one is carved');
        return true;
      }
      let to = toOnly && !away ? pointOf(c, toOnly[1], river) : null;
      if (!to) {
        // away from a place: out the other side of the river from it
        const from = away ? pointOf(c, away[1], river) ?? here ?? river : here ?? river;
        const v: V3 = [river[0] - from[0], river[1] - from[1], river[2] - from[2]];
        const len = Math.hypot(v[0], v[1], v[2]);
        to = len > 1e-9 ? moveBy(river, v, 900, p.st.radius) : directional(p, river, 90, 900);
      }
      c.add({ k: 'terrain.raise', pos: river, radius: Math.round(p.edgeM * 1.2), strength: 6 }, 'the old bed is filled');
      c.add({ k: 'terrain.river', pos: river, to }, 'a new course is carved');
      return true;
    }
    if (/\b(backwards?|back|reverse|uphill|the other way)\b/.test(s)) {
      if (!river) return c.ask('There is no river near here to turn back.');
      const rc = p.cellAt(river);
      const fl: V3 = [p.f.flowX[rc], p.f.flowY[rc], p.f.flowZ[rc]];
      const dir = Math.hypot(fl[0], fl[1], fl[2]) > 1e-9 ? fl : bearingDir(river, 0);
      const down = moveBy(river, dir, 700, p.st.radius);
      const up: V3 = moveBy(river, [-dir[0], -dir[1], -dir[2]], 700, p.st.radius);
      c.add({ k: 'terrain.raise', pos: river, radius: Math.round(p.edgeM), strength: 4 }, 'the old bed is filled');
      c.add({ k: 'terrain.river', pos: down, to: up }, 'the river is carved to run the other way');
      return true;
    }
    if (fromTo || toOnly || /\b(carve|make|dig|cut|create|new|add|run|build)\b/.test(s)) {
      const from = fromTo ? pointOf(c, fromTo[1], here) ?? here : here;
      const toWords = fromTo ? fromTo[2] : toOnly ? toOnly[1] : '';
      let to = toWords ? pointOf(c, toWords, from) : null;
      if (toWords && /\b(sea|ocean|the deep|coast|shore)\b/.test(toWords) && from) to = nearestPlaceKind(u, p, from, 'sea') ?? to;
      if (!from) return c.ask('Carve the river from where? ("carve a river from Aru to the sea").');
      c.add({ k: 'terrain.river', pos: from, ...(to ? { to } : {}) }, to ? 'carve a river' : 'a river here');
      mods.place = mods.place ?? null;
      return true;
    }
    return false;
  }
  // ── roads and paving ──
  if (/\b(pave|paved|paving|cobble|cobbles|cobbled|road|roads|highway|causeway)\b/.test(s)) {
    const between = mods.place?.settlement !== undefined && mods.other?.settlement !== undefined ? [mods.place.pos!, mods.other.pos!] : null;
    const ft = full.match(/\bfrom (.+?) to (.+)$/);
    const to = full.match(/\b(?:to|toward|towards) (.+)$/);
    if (between) { c.add({ k: 'terrain.pave', pos: between[0], to: between[1] }, `a road from ${mods.place!.label} to ${mods.other!.label}`); return true; }
    if (ft) {
      const a = pointOf(c, ft[1], here), b = pointOf(c, ft[2], a ?? here);
      if (a && b) { c.add({ k: 'terrain.pave', pos: a, to: b }, 'lay a road'); return true; }
    }
    if (to && /\broad\b/.test(s)) {
      const b = pointOf(c, to[1], here);
      const a = mods.place?.pos && b && distM(p, mods.place.pos, b) > 50 ? mods.place.pos : here;
      if (a && b) { c.add({ k: 'terrain.pave', pos: a, to: b }, 'lay a road'); return true; }
    }
    const st = mods.place?.settlement !== undefined ? p.people?.settlement(mods.place.settlement) : null;
    c.add({ k: 'terrain.pave', radius: Math.round(st ? Math.max(120, st.territory) : 150 * (mods.size ?? 1)) }, 'pave the ground');
    return true;
  }
  // ── scorched earth ──
  if (/\b(scorch|scorched|sear|char|blacken|singe)\b/.test(s)) { c.add({ k: 'fire.ignite', radius: Math.round(200 * (mods.size ?? 1)), strength: 1 }, 'scorch the land'); return true; }
  // ── the ground raised, lowered, levelled (before the hand: "lift the ground" is not a grab) ──
  const ground = /\b(land|ground|earth|terrain|hill|hills|soil underfoot|island|plateau)\b/.test(s);
  const amount = mods.by ?? mods.nums[0];
  if (/\bislands?\b/.test(s) && /\b(raise|rise|make|create|build|lift|conjure|new)\b/.test(s)) {
    const sea = here && p.s.ocean[p.cellAt(here)] ? here : nearestPlaceKind(u, p, here ?? [0, 0, 1], 'sea');
    c.add({ k: 'terrain.raise', ...(sea ? { pos: sea } : {}), radius: Math.round(350 * (mods.size ?? 1)), strength: Math.abs(amount ?? 120) }, 'an island rises from the sea');
    return true;
  }
  if (ground && /\b(raise|lift|uplift|heave|push up|thrust up|build up)\b/.test(s)) { c.add({ k: 'terrain.raise', radius: Math.round(250 * (mods.size ?? 1)), strength: Math.abs(amount ?? 20) }, 'raise the land'); return true; }
  // a waterfall: a cliff thrown up and a spring at its top
  if (/\b(waterfalls?|cascades?|falls)\b/.test(s) && /\b(make|create|build|raise|conjure|add|carve|give)\b/.test(s)) {
    c.add({ k: 'terrain.raise', radius: Math.round(160 * (mods.size ?? 1)), strength: 90 }, 'a cliff rises');
    c.add({ k: 'water.spring', rate: 400 }, 'and water spills over it');
    return true;
  }
  if ((ground || (mods.place?.settlement !== undefined && /\b(into the (earth|ground)|beneath|underground|down)\b/.test(s))) && /\b(lower|sink|sinks|drown)\b/.test(s) && !/\b(sea|seas|ocean|level of)\b/.test(s)) { c.add({ k: 'terrain.lower', radius: Math.round(250 * (mods.size ?? 1)), strength: Math.abs(amount ?? 30) }, 'lower the land'); return true; }
  const levelV = /\b(level|flatten|smooth|even out|plane)\b/.test(s);
  const townW = /\b(town|city|village|settlement|houses|buildings|homes)\b/.test(s);
  if (levelV && !townW && !/\bsea level\b/.test(s) && (ground || mods.place?.settlement === undefined)) {
    c.add({ k: /\bsmooth\b/.test(s) ? 'terrain.smooth' : 'terrain.flatten', radius: Math.round(250 * (mods.size ?? 1)) }, 'level the land');
    return true;
  }
  // ── frozen ground and water ("freeze the land around Aru", "freeze the lake near Lune") ──
  if (/\b(freeze|frost over|ice over|frozen|turn to ice)\b/.test(s) && /\b(land|ground|earth|fields|lake|lakes|river|rivers|water|sea|pond|town|village|world)\b/.test(s)) {
    const water = /\b(lake|lakes|river|rivers|water|sea|pond)\b/.test(s);
    const at = water && here ? nearestPlaceKind(u, p, here, /\briver\b/.test(s) ? 'river' : /\bsea\b/.test(s) ? 'sea' : 'lake') ?? here : here;
    c.add({ k: 'terrain.paint-material', material: 'ice', depth: water ? 2 : 1, ...(at ? { pos: at } : {}), radius: Math.round(300 * (mods.size ?? 1)) }, water ? 'the water freezes' : 'the land freezes');
    c.add({ k: 'weather.paint', kind: 'cold-snap', ...(at ? { pos: at } : {}), radius: Math.round(600 * (mods.size ?? 1)) }, 'a bitter cold');
    return true;
  }
  // ── mountains: a range (between two places, or from here eastward), or the mountains made taller ──
  if (/\b(mountains?|range|peaks|cordillera|sierra)\b/.test(s) && !/\b(fire|lava) mountains?\b/.test(s)) {
    if (/\b(taller|higher|bigger|grow|raise them|steeper)\b/.test(s)) {
      const top = highGround(p, here ?? [0, 0, 1], 3000) ?? nearestPlaceKind(u, p, here ?? [0, 0, 1], 'mountain');
      c.add({ k: 'terrain.raise', ...(top ? { pos: top } : {}), radius: Math.round(450 * (mods.size ?? 1)), strength: Math.abs(amount ?? 150) }, 'the mountains rise higher');
      return true;
    }
    if (/\bin the mountains\b|\bon the mountains?\b/.test(full)) return false;
    if (mods.place?.pos && mods.other?.pos) { c.add({ k: 'terrain.mountain-range', pos: mods.place.pos, to: mods.other.pos, height: amount ?? Math.round(260 * Math.min(2, mods.size ?? 1)) }, `a mountain range from ${mods.place.label} to ${mods.other.label}`); return true; }
    const f = here ?? [0, 0, 1];
    const lon = Math.atan2(f[0], f[2]) + 0.45;
    const lat = Math.asin(Math.max(-1, Math.min(1, f[1])));
    const to: V3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    c.add({ k: 'terrain.mountain-range', to, height: amount ?? Math.round(260 * Math.min(2, mods.size ?? 1)) }, 'a mountain range eastward');
    return true;
  }
  // ── water poured ──
  if (/\b(pour|add|spill)\b.*\bwater\b/.test(s)) { c.add({ k: 'water.add', radius: Math.round(250 * (mods.size ?? 1)), depth: amount ?? 2 }, 'pour water'); return true; }
  // ── growth: a desert in bloom, fertile soil, fruit, trees and flowers of the best kind for the place ──
  if (/\b(bloom|blossom|flourish|green|greener|turn green)\b/.test(s) && /\b(desert|dunes|wasteland|barren|sand|land|world)\b/.test(s)) {
    const des = /\b(desert|dunes|sand)\b/.test(s) && here ? nearestPlaceKind(u, p, here, 'desert') ?? here : here;
    c.add({ k: 'water.rain', ...(des ? { pos: des } : {}), radius: 900, duration: 4320 }, 'rain on the dry land');
    c.add({ k: 'life.paint-biome', biome: 'grassland', ...(des ? { pos: des } : {}), radius: Math.round(600 * (mods.size ?? 1)) }, 'and it blooms');
    return true;
  }
  // flowers: "bloom", "make Aru bloom", "let everything blossom"
  if (/\b(bloom|blooms|blooming|blossom|blossoms|blossoming|in flower|flower)\b/.test(s) && !findNoun(u.content, p, s, ['plant', 'animal', 'species', 'disaster'])) {
    const all = !!mods.place?.everywhere || /\b(the world|the planet|everything|everywhere)\b/.test(full);
    c.add({ k: 'life.plant', type: 'grass', radius: Math.round(300 * (mods.size ?? 1)), ...(all ? { everywhere: true } : {}) }, 'flowers bloom');
    if (!all) c.add({ k: 'miracle.fertility' }, 'and the ground is rich');
    return true;
  }
  if (/\b(fertile|fertility|richer soil|rich soil|good soil|fruitful)\b/.test(s)) { c.add({ k: 'miracle.fertility' }, 'fertile ground'); return true; }
  if (/\b(bear|bears|bearing|heavy with|full of) fruit\b|\bfruit\b.*\b(trees?|branches)\b/.test(s)) { c.add({ k: 'miracle.food' }, 'the trees bear fruit'); return true; }
  if (/\b(tame|friendly|gentle|docile|domesticate|befriend|calm)\b/.test(s)) {
    const a = findNoun(u.content, p, s, ['animal']);
    if (a || /\b(beasts|animals|herds|wild things)\b/.test(s)) { c.add({ k: 'life.tame', ...(a ? { species: a.id } : {}), ...(mods.place?.everywhere || (a && (!mods.place || mods.place.here === undefined && mods.place.settlement === undefined && !mods.place.pos)) ? { everywhere: true } : {}) }, `tame the ${a?.text ?? 'beasts'}`); return true; }
  }
  if (/\b(water|rivers?|lakes?|seas?)\b.*\binto\b/.test(s) && /\b(turn|make|change|transform)\b/.test(s)) {
    const into = s.match(/\binto ([a-z' -]+)$/);
    const thing = into ? into[1].replace(/^(a|an|the|some)\s+/, '').trim() : '';
    if (thing && !/\b(ice|steam|vapou?r)\b/.test(thing)) {
      const known = findNoun(u.content, p, thing, ['item']);
      const id = known ? known.id : slug(thing);
      if (!known) { cx.made.add(id); c.add({ k: 'content.item', name: thing, tags: tagsOf(cx.L, thing) }, `invent ${thing}`); }
      const st = here ? nearestSettlement(p, here, 4000) : null;
      if (st) c.add({ k: 'settlement.gift', settlement: st.id, items: { [id]: 60 } }, `${thing} for ${st.name}`);
      else c.add({ k: 'hand.grab', item: id, qty: 60 }, `${thing} in the hand`);
      return true;
    }
    if (/\bice\b/.test(thing)) { c.add({ k: 'terrain.paint-material', material: 'ice', depth: 2, radius: Math.round(400 * (mods.size ?? 1)) }, 'the water freezes'); return true; }
  }
  // trees, flowers, grass (the best kind for the place when none is named), everywhere if asked
  const plantV = /\b(plant|sow|seed|grow|cover|scatter|fill)\b/.test(s);
  if (plantV && !findNoun(u.content, p, s, ['plant', 'species', 'animal'])) {
    const all = !!mods.place?.everywhere || /\b(the world|the planet|everywhere|all the land)\b/.test(full);
    if (/\b(trees?|forests?|woods?|woodland|grove)\b/.test(s)) { c.add({ k: 'life.forest', radius: Math.round(300 * (mods.size ?? 1)), ...(all ? { everywhere: true } : {}) }, all ? 'forests over the world' : 'grow a forest'); return true; }
    if (/\b(flowers?|grass|grasses|meadows?|plants?|greenery|bushes|shrubs?|herbs?)\b/.test(s)) {
      const type = /\b(bushes|shrubs?)\b/.test(s) ? 'shrub' : 'grass';
      c.add({ k: 'life.plant', type, radius: Math.round(250 * (mods.size ?? 1)), ...(all ? { everywhere: true } : {}) }, `plant ${type === 'shrub' ? 'shrubs' : 'grass and flowers'}`);
      return true;
    }
    if (/\b(crops?|fields?|grain|harvest)\b/.test(s) && /^(plant|sow)\b/.test(s)) { c.add({ k: 'life.plant', type: 'crop', radius: 200 }, 'sow a crop'); return true; }
  }
  if (/\b(cover|blanket)\b.*\b(forests?|trees?|woods?)\b/.test(s)) {
    const all = !!mods.place?.everywhere || /\b(the world|the planet)\b/.test(full);
    c.add({ k: 'life.forest', radius: Math.round(400 * (mods.size ?? 1)), ...(all ? { everywhere: true } : {}) }, all ? 'forests over the world' : 'grow a forest');
    return true;
  }
  return false;
}

// ───────────────────────────── peace and war ─────────────────────────────

function intentPeaceWar(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const p = cx.p;
  // two settlements named apart ("ally Aru with Lune", "make Aru an ally of Lune", "Aru trades with Lune"): a pair too
  if (mods.place?.settlement !== undefined && mods.other?.settlement === undefined && /\b(ally|allies|alliance|allied|trade|trades|trading|treaty|pact|peace|war|fight|attack|merge|unite|join)\b/.test(full)) {
    // in the order they are written: the first acts on the second ("merge Aru into Lune", "make Aru attack Lune")
    const two = allLive(full, cx.live, ['settlement']).filter((l) => l.planet === (p?.id ?? 0)).sort((a, b) => a.at - b.at);
    if (two.length >= 2 && two[0].id !== two[1].id) {
      const at = (l: Live): Place => ({ ...mods.place, settlement: l.id, label: l.name, ...(l.pos ? { pos: l.pos } : {}) });
      mods.place = at(two[0]);
      mods.other = at(two[1]);
    }
  }
  // between two places
  if (mods.other?.settlement !== undefined && mods.place?.settlement !== undefined) {
    if (verb(cx, s, 'peace') || has(s, 'peace')) { c.add({ k: 'settlement.make-peace', settlement: mods.place.settlement, other: mods.other.settlement }, 'make peace'); return true; }
    if (verb(cx, s, 'war') || has(s, 'war', 'fight', 'battle', 'enemies', 'attack')) { c.add({ k: 'settlement.start-war', settlement: mods.place.settlement, other: mods.other.settlement }, 'war'); return true; }
    if (verb(cx, s, 'merge') || /\b(one town|one people|one settlement|together)\b/.test(s) && !/\b(trade|ally|allies)\b/.test(s)) { c.add({ k: 'settlement.merge', settlement: mods.place.settlement, other: mods.other.settlement }, 'merge'); return true; }
    if (/\b(allies|ally|alliance|allied|friends|friendship|brothers|stand together)\b/.test(s)) { c.add({ k: 'settlement.treaty', settlement: mods.place.settlement, other: mods.other.settlement, kind: 'alliance' }, 'an alliance'); return true; }
    if (/\b(trade|trading|traders|commerce|market|markets|exchange goods|trade pact)\b/.test(s)) { c.add({ k: 'settlement.treaty', settlement: mods.place.settlement, other: mods.other.settlement, kind: 'trade' }, 'a trade pact'); return true; }
    if (/\b(road|roads|pave|paved)\b/.test(s)) return false;
  }
  // "merge Aru into Lune"
  const into = c.full.match(/\b(?:merge|join|unite|fold)\b (.+?) (?:into|with|and) (.+)$/);
  if (into) {
    const a = findLive(into[1], cx.live, ['settlement']), b = findLive(into[2], cx.live, ['settlement'], a ? new Set([`settlement:${a.id}`]) : undefined);
    if (a && b) { c.add({ k: 'settlement.merge', settlement: a.id, other: b.id }, `merge ${a.name} into ${b.name}`); return true; }
  }
  // peace everywhere; a war with one side (or none) named: the nearest other people
  const endWar = has(s, 'war', 'wars', 'fighting') && (verb(cx, s, 'stop') !== null || has(s, 'end', 'stop'));
  if ((verb(cx, s, 'peace') || has(s, 'peace') || endWar) && (endWar || !verb(cx, s, 'war')) && p?.people && !/\b(law|commandment|of peace|peaceful)\b/.test(s)) {
    if (mods.place?.everywhere || has(s, 'everyone', 'everybody', 'all', 'every', 'the world', 'all wars', 'every war') || mods.place?.settlement === undefined) {
      const pairs = warPairs(cx, mods.place?.settlement);
      if (!pairs.length) return c.ask(`No one on ${p.name} is at war.`);
      for (const [a, b] of pairs) c.add({ k: 'settlement.make-peace', settlement: a, other: b }, 'make peace');
      return true;
    }
  }
  if ((verb(cx, s, 'war') || has(s, 'war')) && !has(s, 'peace', 'stop', 'end', 'law', 'god', 'holy war') && p?.people && mods.other?.settlement === undefined) {
    const ps = p.people;
    const here = mods.place?.settlement !== undefined ? ps.settlement(mods.place.settlement) : largestSettlement(cx);
    const foe = here ? nearestForeign(cx, here.id) : undefined;
    if (!here || !foe) return c.ask(`A war needs two peoples, and ${here ? `${here.name} has no neighbour of another people` : `there are none on ${p.name}`}.`);
    c.add({ k: 'settlement.start-war', settlement: here.id, other: foe.id }, `war: ${here.name} against ${foe.name}`);
    return true;
  }
  return false;
}

// ───────────────────────────── people by name (or by role: "the chief of Aru") ─────────────────────────────

const ROLE_OF_WORD: [RegExp, string][] = [
  [/\b(chief|leader|king|queen|ruler|head|headman|headwoman|lord|lady|monarch|emperor|empress|elder of)\b/, 'leader'], [/\b(priest|priestess|shaman|oracle|high priest)\b/, 'priest'],
  [/\b(healer|doctor|physician|herbalist|medicine man|medicine woman)\b/, 'healer'], [/\b(teacher|sage|tutor|master)\b/, 'teacher'], [/\b(scholar|scribe|librarian)\b/, 'scholar'],
  [/\b(smith|crafter|craftsman|craftswoman|artisan|potter|weaver|maker)\b/, 'crafter'], [/\b(builder|mason|architect)\b/, 'builder'], [/\b(farmer|peasant|planter)\b/, 'farmer'],
  [/\b(hunter|huntress)\b/, 'hunter'], [/\b(fisher|fisherman|fisherwoman)\b/, 'fisher'], [/\b(trader|merchant)\b/, 'trader'], [/\b(soldier|warrior|guard|general|champion)\b/, 'soldier'],
  [/\b(herder|shepherd|herdsman)\b/, 'herder'], [/\b(sailor|captain|navigator)\b/, 'sailor'], [/\b(gatherer|forager)\b/, 'gatherer'],
];

function personOf(c: Clause): { id: number; planet: number; name: string; pos?: V3 } | null {
  const { cx, mods, full } = c;
  const l = findLive(full, cx.live, ['agent']);
  if (l) return { id: l.id, planet: l.planet, name: l.name, pos: l.pos };
  const rm = full.match(/\bthe (chief|leader|king|queen|ruler|headman|elder|priest|priestess|shaman|smith|healer|teacher|sage|scribe|hunter|farmer|fisher|fisherman|builder|trader|merchant|soldier|warrior|herder|sailor|prophet|potter|weaver)\b/);
  if (rm && mods.place?.settlement !== undefined && cx.p?.people) {
    const id = pickPerson(cx, mods.place.settlement, rm[0], 'role');
    if (id >= 0) {
      const x = makeCtx(cx.u, cx.p);
      const s = x.A.slotOf(id);
      const pt = [0, 0, 0];
      if (s >= 0) x.A.posAt(s, cx.u.tick, pt);
      return { id, planet: cx.p.id, name: s >= 0 ? agentName(x, s) : `the ${rm[1]}`, pos: [pt[0], pt[1], pt[2]] };
    }
  }
  return null;
}

/** the recipe a phrase names: an idea, or "how to make <item>" (the craft that makes it) */
function recipeOf(cx: PCtx2, s: string): Found | null {
  const k = findNoun(cx.u.content, cx.p, s, ['recipe']);
  if (k) return k;
  const how = s.match(/\bhow to (?:make|build|forge|cast|brew|bake|grow|craft|weave|work|use)\s+(.+)$/);
  const R = cx.u.content.recipes.list;
  // a thing named for the craft that makes it ("teach Aru iron", "show them how to make glass"): the first craft of it
  const it = findNoun(cx.u.content, cx.p, how ? how[1] : s, ['item']);
  if (it) {
    const r = R.find((q) => (q.outputs ?? []).some((o) => o.item === it.id));
    if (r) return { type: 'recipe', id: r.id, text: r.name.toLowerCase(), at: it.at };
  }
  // a craft word ("ironworking", "iron-smithing", "metalwork"): the most basic craft whose name starts so
  for (const w of s.split(/[\s-]+/)) {
    const stem = w.replace(/(working|work|smithing|smelting|making|crafting|craft)$/, '');
    if (stem.length < 3 || stem === w && !/^(iron|bronze|copper|tin|gold|silver|steel|glass|clay|stone|wood|leather|cloth)$/.test(w)) continue;
    const cand = R.filter((q) => q.id === stem || q.id.startsWith(`${stem}-`)).sort((a, b) => (a.knowledge?.length ?? 0) - (b.knowledge?.length ?? 0) || R.indexOf(a) - R.indexOf(b));
    if (cand.length) return { type: 'recipe', id: cand[0].id, text: cand[0].name.toLowerCase(), at: wordAt(s, w) };
  }
  return null;
}

function intentPerson(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const who = personOf(c);
  if (!who) return false;
  // a person named as where a thing is sent ("send a meteor at Hesh", "rain on Hesh"): the act goes where they stand
  const thing = findNoun(u.content, p, s.replace(new RegExp(`\\b${esc(who.name)}\\b`), ' '), ['disaster', 'weather', 'miracle', 'animal', 'species']);
  if (thing && !/\b(turn|transform|change)\b.*\binto\b/.test(s) && !(thing.type === 'animal' && /\bmake\b.+\b(a|an)\b/.test(s))) {
    if (!mods.place && who.pos) mods.place = { pos: who.pos, planet: who.planet, label: who.name };
    // "smite Hesh with lightning": the miracle, where they stand
    if (thing.type === 'miracle') { c.add({ k: `miracle.${thing.id}`, ...(who.pos ? { pos: who.pos } : {}) }, `${thing.id} on ${who.name}`); return true; }
    return false;
  }
  const id = who.id, pl = who.planet;
  const nm = who.name.replace(/\b\w/g, (m) => m.toUpperCase());
  const isDisciple = u.god.disciples.some((d) => d.agent === id);
  const possessed = u.god.possession.some((q) => q.agent === id);
  const destOf = (): V3 | null => {
    const t = full.match(/\b(?:to|into|toward|towards|onto|over to|next to|near|beside|by) (.+)$/);
    if (t) {
      const words = t[1].replace(new RegExp(`\\b${esc(who.name)}\\b`), '').trim();
      const l = findLive(words, cx.live, ['settlement', 'creature']);
      if (l?.pos && p) return moveBy(l.pos, bearingDir(l.pos, 2.4), 40, p.st.radius);
      const pt = pointOf(c, words, who.pos);
      if (pt) return pt;
    }
    if (mods.place?.pos && mods.place.settlement === undefined) return mods.place.pos;
    return null;
  };
  // a new form: "turn Hesh into a frog", "make Hesh a wolf"
  const intoM = full.match(/\b(?:turn|transform|change|make|shape)\b.+?\b(?:into|to)\b (?:a |an |the )?([a-z' -]+)$/) ?? full.match(/\bmake\b.+?\b(?:a|an) ([a-z' -]+)$/);
  if (intoM) {
    const word = intoM[1].trim();
    const an = findNoun(u.content, p, word, ['animal', 'creature']);
    const sing = singular(word.split(' ').pop() ?? word);
    if (an?.type === 'animal') { c.add({ k: 'agent.transform', id, into: an.id, planet: pl }, `${nm} becomes a ${an.text}`); return true; }
    if (!an && (cx.L.animalish.has(sing) || cx.L.animalish.has(word)) && !cx.L.creatureWords.includes(word)) {
      const name = word.split(' ').length > 1 ? `${word.split(' ').slice(0, -1).join(' ')} ${sing}` : sing;
      const aid = slug(name);
      cx.made.add(aid);
      c.add({ k: 'content.animal', name, count: 1 }, `a new animal: ${name}`);
      c.add({ k: 'agent.transform', id, into: aid, planet: pl }, `${nm} becomes a ${name}`);
      return true;
    }
  }
  if (verb(cx, s, 'possess') || /\bpossessing\b|\bunpossess\b/.test(s) || (/\brelease\b/.test(s) && possessed)) {
    const off = /\b(release|leave|stop|unpossess|let go|free)\b/.test(s);
    c.add({ k: 'agent.possess', id, on: !off, planet: pl }, off ? 'release' : 'possess');
    return true;
  }
  if (/\brelease\b|\blet (him|her|them)? ?go\b|\bput (him|her|them) down\b|\bset (him|her|them) down\b|\bfree\b/.test(s)) {
    if (u.god.isHeld('agent', id)) { c.add({ k: 'hand.place' }, `set ${nm} down`); return true; }
    cx.asked.push({ k: 'agent.possess', id, on: false, planet: pl });
    return c.ask(`${nm} is free already: not in your hand, not possessed.`);
  }
  // orders: "tell Hesh to farm", "order my disciple to preach in Lune", "send Hesh as a missionary to Lune"
  const mode = DISCIPLE_MODES.find((m) => has(s, m) || has(s, m + 's') || has(s, m + 'ing') || (m === 'missionary' && has(s, 'missionaries', 'convert')) || (m === 'farm' && has(s, 'farming')) || (m === 'build' && has(s, 'building')));
  const target = (() => { const t = full.match(/\b(?:to|in|at|toward|towards) ([a-z' -]+)$/); const l = t ? findLive(t[1], cx.live, ['settlement']) : null; return l && l.id !== undefined ? l.id : mods.place?.settlement; })();
  if (verb(cx, s, 'disciple') || (mode === 'missionary') || (verb(cx, s, 'order') && mode)) {
    const ownSt = p?.people ? makeCtx(u, p).A.settlement[makeCtx(u, p).A.slotOf(id)] : -1;
    const tgt = target !== undefined && target !== ownSt ? { target } : {};
    if (isDisciple && mode) c.add({ k: 'disciple.order', id, mode, ...tgt, planet: pl }, `${nm}: ${mode}`);
    else c.add({ k: 'agent.make-disciple', id, mode: mode ?? 'preach', ...tgt, planet: pl }, 'disciple');
    return true;
  }
  // a role: "make Hesh the chief of Aru", "crown Hesh", "make Hesh a priest"
  const roleW = ROLE_OF_WORD.find(([re]) => re.test(s));
  if ((roleW && /\b(make|crown|appoint|name|anoint|choose|elect|raise|promote)\b/.test(s)) || /\bcrown\b/.test(s)) {
    c.add({ k: 'agent.role', id, role: roleW ? roleW[1] : 'leader', planet: pl }, `${nm}: ${roleW ? roleW[1] : 'leader'}`);
    return true;
  }
  if (verb(cx, s, 'inspire')) { c.add({ k: 'agent.inspire', id, planet: pl }, 'inspire'); return true; }
  if (verb(cx, s, 'kill') || /\bstrike\b.*\bdown\b|\bstrike\b.*\bdead\b/.test(s)) { c.add({ k: 'agent.kill', id, planet: pl }, 'strike down'); return true; }
  if (/\b(immortal|never die|live forever|eternal life|deathless|undying)\b/.test(full)) {
    let years = -30;
    if (p?.people) { const x = makeCtx(u, p); const sl = x.A.slotOf(id); if (sl >= 0) years = Math.min(0, Math.round(20 - (u.tick - x.A.birth[sl]) / x.year)); }
    c.add({ k: 'agent.heal', id, planet: pl }, `${nm} made whole`);
    if (years < 0) c.add({ k: 'agent.age', id, years, planet: pl }, `and young again (nothing here lives forever)`);
    return true;
  }
  const ageM = s.match(/\b(older|younger|age|rejuvenate|grow old|grow young)\b/);
  if (ageM) {
    const n = mods.by ?? mods.nums[0] ?? 10;
    const younger = /\b(younger|rejuvenate|grow young)\b/.test(s);
    c.add({ k: 'agent.age', id, years: younger ? -Math.abs(n) : Math.abs(n), planet: pl }, `${nm} ${younger ? 'younger' : 'older'} by ${Math.abs(n)} years`);
    return true;
  }
  if (verb(cx, s, 'heal') || verb(cx, s, 'cure')) { c.add({ k: 'agent.heal', id, planet: pl }, 'heal'); return true; }
  if (verb(cx, s, 'slap')) { c.add({ k: 'hand.slap', target: { kind: 'agent', id }, planet: pl }, 'slap'); return true; }
  if (verb(cx, s, 'stroke') || /\bsoothe\b/.test(s)) { c.add({ k: 'hand.stroke', target: { kind: 'agent', id }, planet: pl }, 'stroke'); return true; }
  if (verb(cx, s, 'throw')) {
    const to = destOf() ?? mods.toward?.pos ?? null;
    const sea = /\b(sea|ocean|water|lake)\b/.test(s) && p ? nearestPlaceKind(u, p, who.pos ?? [0, 0, 1], /\blake\b/.test(s) ? 'lake' : 'sea') : null;
    mods.place = null;
    if (!u.god.isHeld('agent', id)) c.add({ k: 'hand.grab', target: { kind: 'agent', id }, planet: pl }, `pick up ${nm}`);
    c.add({ k: 'hand.throw', ...((sea ?? to) ? { toward: sea ?? to } : {}) }, 'throw');
    return true;
  }
  if (/\b(fly|soar|float|levitate|rise into the air)\b/.test(s)) { c.add({ k: 'hand.grab', target: { kind: 'agent', id }, planet: pl }, `${nm} rises into the air`); return true; }
  if (verb(cx, s, 'grab')) { c.add({ k: 'hand.grab', target: { kind: 'agent', id }, planet: pl }, 'grab'); return true; }
  if (/\b(move|send|teleport|carry|put|set|take|bring|place|transport|relocate|drop)\b/.test(s)) {
    const to = destOf();
    if (!to) return c.ask(`Move ${nm} where? ("move ${nm} to Lune", "teleport ${nm} to the coast").`);
    c.add({ k: 'agent.move', id, pos: to, planet: pl }, `${nm} is set down elsewhere`);
    return true;
  }
  if (/\b(silence|mute|hush|gag|quiet|forget|unlearn)\b/.test(s)) {
    const k = findNoun(u.content, p, s, ['recipe']);
    c.add({ k: 'agent.silence', id, ...(k ? { knowledge: k.id } : {}), planet: pl }, k ? `${nm} forgets ${k.text}` : 'silence');
    return true;
  }
  const force = /\b(make|force|compel|insist)\b.*\b(learn|know|understand|accept)\b|\bforce\b|\binsist\b/.test(s);
  if (verb(cx, s, 'teach') || force || /\b(learn|discover)\b/.test(s)) {
    const k = recipeOf(cx, s);
    if (k) { c.add({ k: 'agent.teach', id, knowledge: k.id, ...(force ? { force: true } : {}), planet: pl }, force ? `make ${nm} learn ${k.text}` : `teach ${nm} ${k.text}`); return true; }
  }
  const rn = full.match(/\b(?:rename|call|name)\s+.+?\s+(?:to|as)\s+([a-z' -]+)$/);
  if (rn) { c.add({ k: 'agent.rename', id, name: rn[1].trim().replace(/\b\w/g, (m) => m.toUpperCase()), planet: pl }, 'rename'); return true; }
  // a person named only as a place ("a meteor on Hesh"): the act goes where they stand
  if (!mods.place && who.pos) mods.place = { pos: who.pos, planet: pl, label: who.name };
  return false;
}

// ───────────────────────────── settlements ─────────────────────────────

const TRAIT_LAWS: [RegExp, string][] = [
  [/\b(peaceful|gentle|gentler|kind|kinder|nonviolent|meek|calm)\b/, 'peace'], [/\b(warlike|fierce|fiercer|aggressive|bloodthirsty|violent)\b/, 'war'],
  [/\b(devout|pious|holy|religious|faithful)\b/, 'worship'], [/\b(curious|wise|wiser|learned|clever|cleverer|smarter|studious)\b/, 'learning'],
  [/\b(hardworking|hard-working|diligent|industrious|busy|busier)\b/, 'labour'], [/\b(hospitable|welcoming|friendly to strangers)\b/, 'hospitality'],
  [/\b(traditional|conservative|old-fashioned)\b/, 'tradition'], [/\b(generous|sharing)\b/, 'sharing'],
];

function intentSettlement(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  if (!p?.people) return false;
  const sid = mods.place?.settlement;
  const named = allLive(full, cx.live, ['settlement']);
  const subj = named[0] ?? (sid !== undefined ? { id: sid, name: mods.place!.label } as Live & { at: number } : null);
  // renamed: "rename Aru to Bright Haven", "call Aru Bright Haven"
  if (sid !== undefined) {
    const rs = full.match(/\b(?:rename|call|name)\s+(?:.+?\s+)?(?:to|as)\s+([a-z0-9' -]+)$/) ?? full.match(/^(?:rename|call)\s+\S+\s+([a-z0-9' -]+)$/);
    if (rs && (/\brename\b/.test(full) || /^call\b/.test(full) || has(s, 'call'))) {
      const name = rs[1].trim().replace(/\b\w/g, (m) => m.toUpperCase());
      if (name) { c.add({ k: 'settlement.rename', name }, `rename to ${name}`); return true; }
    }
  }
  // moved: "move Aru to the coast", "relocate Aru next to Lune", "make the people of Aru migrate north"
  if (subj && /\b(move|relocate|migrate|resettle|transplant|shift|carry|lift|uproot)\b/.test(s) && !/\b(river|mountains?|disaster|tornado|storm)\b/.test(s)) {
    const migrate = /\b(migrate|resettle|walk|wander|journey|set out)\b/.test(s);
    let to: V3 | null = null;
    const other = named.find((n) => n.id !== subj.id);
    const t = full.match(/\b(?:to|toward|towards|into|onto|over to|next to|near|beside|by|north|south|east|west)\b.*$/);
    if (other?.pos) to = moveBy(other.pos, bearingDir(other.pos, 1.2), Math.max(500, p.edgeM * 3), p.st.radius);
    else if (t) {
      const base = subj.pos ?? (sid !== undefined ? p.people.settlement(sid)?.pos as V3 : undefined);
      const dirW = Object.keys(BEARINGS).find((w) => wordAt(t[0], w) >= 0);
      to = dirW && base && !/\bcoast|shore\b/.test(t[0]) ? directional(p, base, BEARINGS[dirW], 1500) : pointOf(c, t[0], base);
      if (to && base && /\b(coast|shore|sea|beach)\b/.test(t[0])) to = coastToward(p, base, dirW ? BEARINGS[dirW] : 0) ?? to;
      if (to && base && /\b(coast|shore|beach)\b/.test(t[0]) && !dirW) to = nearestPlaceKind(u, p, base, 'coast') ?? to;
    } else if (mods.place?.here) to = mods.place.pos ?? null;
    if (!to) return c.ask(`Move ${subj.name.replace(/\b\w/g, (m) => m.toUpperCase())} where? ("move it to the coast", "move it next to Lune", "make them migrate north").`);
    c.add({ k: 'settlement.move', settlement: subj.id, to, mode: migrate ? 'migrate' : 'lift' }, migrate ? 'they set out for a new home' : 'the hand lifts the town');
    return true;
  }
  if (sid === undefined) return false;
  const st = p.people.settlement(sid);
  if (!st) return false;
  // a building: "build a temple in Aru" (the god raises it), "make Aru build walls" (they build it)
  const bn = findNoun(u.content, p, s, ['building']) ?? (/\bwalls?\b/.test(s) ? { type: 'building' as NounType, id: 'wall', text: 'wall', at: 0 } : null);
  if (bn && u.content.buildings.find(bn.id) && /\b(build|raise|erect|make|give|construct|put up|set up|add)\b/.test(s)) {
    const site = /\bmake\b.*\bbuild\b|\blet\b.*\bbuild\b|\bthey build\b/.test(s);
    c.add({ k: 'settlement.build', type: bn.id, ...(mods.qty && mods.qty > 1 ? { count: Math.min(20, Math.round(mods.qty)) } : {}), ...(site ? { site: true } : {}) }, site ? `${st.name} builds a ${bn.text}` : `a ${bn.text} for ${st.name}`);
    return true;
  }
  // hearts: love, fear, worship, belief, conversion
  const believeV = verb(cx, s, 'believe') ?? (/\b(love|fear|worship|believe|adore|revere|trust|obey|convert|faith|devotion|pray)\b/.test(s) && /\b(me|you|my|god|faith|religion)\b/.test(s) ? 'x' : null);
  if (believeV) {
    const feeling = /\bfear\b|\bdread\b|\bterror\b/.test(s) ? 'fear' : /\bconvert\b|\bmy faith\b|\bmy religion\b|\bturn to me\b/.test(s) ? 'convert' : /\bworship\b|\bpray\b|\brevere\b|\bdevotion\b/.test(s) ? 'worship' : 'love';
    c.add({ k: 'belief.sway', feeling, ...(mods.qty ? { amount: Math.min(3, mods.qty / 5) } : {}) }, `${st.name}: ${feeling}`);
    return true;
  }
  // "make Aru worship the sun": a new faith of their own
  const wm = s.match(/\bworship (?:the )?([a-z' -]+)$/);
  if (wm && !/\b(me|you|god)\b/.test(wm[1])) {
    const name = `${wm[1].trim()} worship`;
    const id = slug(name);
    cx.made.add(id);
    c.add({ k: 'content.idea', name, effect: 'faith', mult: 1.4 }, `the idea of ${name}`);
    c.add({ k: 'settlement.teach', knowledge: id }, 'teach it');
    return true;
  }
  // their nature: "make the people of Lune peaceful"
  const tl = TRAIT_LAWS.find(([re]) => re.test(s));
  if (tl && /\b(make|let|turn|become|be)\b/.test(s)) { c.add({ k: 'settlement.law', law: tl[1] }, `law: ${LAWS[tl[1]]?.name ?? tl[1]}`); return true; }
  const pop = p.people.members.get(sid)?.length ?? 0;
  // "the people of Aru" names who, not what: the rest of the words say what
  const rest = s.replace(/\b(the )?(people|folk|townsfolk|villagers|inhabitants|men and women|everyone|citizens) of\b/g, ' ').replace(/\s+/g, ' ').trim();
  // sent to another world: "send the people of Aru to the moon"
  const world = rest.match(/\bto (?:the )?(moon|another world|another planet|a new world|[a-z]+)$/);
  const worldL = world ? cx.live.find((l) => l.kind === 'planet' && l.name === world[1]) : undefined;
  if (world && (world[1] === 'moon' || /another|new world/.test(world[1]) || worldL) && /\b(send|move|take|carry|bring|lift)\b/.test(rest)) {
    const dest = world[1] === 'moon' ? u.planets.find((q) => q.alive && q.st.orbit.parent === p.id) : worldL ? u.planet(worldL.id) : u.planets.find((q) => q.alive && q.id !== p.id);
    if (!dest || dest.id === p.id) return c.ask(world[1] === 'moon' ? `${p.name} has no moon ("add a moon" first).` : 'There is no other world to send them to ("make a new world" first).');
    const sp = u.content.species.list[st.species].id;
    const era = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'][Math.max(0, Math.min(10, st.era))];
    c.add({ k: 'life.spawn-people', species: sp, count: Math.max(1, Math.min(2000, pop || 1)), era, planet: dest.id }, `the people of ${st.name} set down on ${dest.name}`);
    c.add({ k: 'life.extinct', species: sp, settlement: sid }, `and taken from ${p.name}`);
    return true;
  }
  // a plague of beasts: "send a plague of locusts to Lune"
  const plagueOf = rest.match(/\b(?:plague|swarm|horde|cloud) of ([a-z' -]+)$/);
  if (plagueOf) {
    const an = findNoun(u.content, p, plagueOf[1], ['animal']);
    if (/\b(locusts?|grasshoppers?|insects?|flies|beetles?)\b/.test(plagueOf[1]) || an?.id === 'locust-swarm') { c.add({ k: 'disaster.spawn', kind: 'swarm' }, `a plague of ${plagueOf[1]}`); return true; }
    if (an) { c.add({ k: 'life.spawn-animal', species: an.id, count: 40 }, `a plague of ${plagueOf[1]}`); return true; }
  }
  // wings: the people fly
  if (/\b(wings|fly|flight|flying|soar)\b/.test(rest) && /\b(give|grant|let|make|teach)\b/.test(rest)) {
    c.add({ k: 'set', path: `species.${u.content.species.list[st.species].id}.fly`, value: 1 }, `the ${u.content.species.list[st.species].plural.replace(/^the /, '')} take wing`);
    return true;
  }
  // their numbers: "double the population of Aru", "add a person to Aru", "a child is born in Aru"
  if (/\b(child|children|baby|babies|born|birth|infant|newborn)\b/.test(s)) {
    const n = mods.qty ?? (/\btwins\b/.test(s) ? 2 : 1);
    c.add({ k: 'life.spawn-people', settlement: sid, count: Math.max(1, Math.min(2000, Math.round(n))), children: true }, `${n === 1 ? 'a child is' : `${n} children are`} born`);
    return true;
  }
  if (/\b(population|people|folk|numbers)\b/.test(s) && /\b(double|triple|twice|grow|increase|more|bigger|larger)\b/.test(s)) {
    const k = /\btriple\b/.test(s) ? 2 : /\b(double|twice)\b/.test(s) ? 1 : 0.5;
    c.add({ k: 'life.spawn-people', settlement: sid, count: Math.max(1, Math.min(2000, Math.round(Math.max(pop, 4) * k))) }, `${st.name} grows`);
    return true;
  }
  if (/\b(person|villager|villagers|people|settlers|newcomers|man|woman|men|women|colonists|citizens|townsfolk|folk)\b/.test(rest) && /\b(add|give|send|bring|create|new|more|another|spawn|summon|conjure|put|place|settle|populate|grant)\b/.test(rest) && !/\bkill|smite|remove\b/.test(rest) && !findNoun(u.content, p, rest, ['item', 'animal', 'recipe', 'plant', 'disease', 'building'])) {
    const n = mods.qty ?? (mods.one ? 1 : /\b(person|villager|man|woman)\b/.test(s) ? 1 : 5);
    c.add({ k: 'life.spawn-people', settlement: sid, count: Math.max(1, Math.min(2000, Math.round(n))) }, `${n} ${n === 1 ? 'person comes' : 'people come'} to live at ${st.name}`);
    return true;
  }
  if (/\b(city|metropolis|great town|capital)\b/.test(s) && /\b(make|turn|grow|become)\b/.test(s)) {
    c.add({ k: 'life.spawn-people', settlement: sid, count: Math.max(10, Math.min(2000, pop)) }, `${st.name} swells`);
    c.add({ k: 'settlement.build', type: u.content.buildings.find('house') ? 'house' : u.content.buildings.list[0].id, count: 4 }, 'new houses rise');
    return true;
  }
  // an age of plenty
  if (/\bgolden age\b|\bage of (plenty|gold|wonders|glory)\b|\bprosper|\bthrive|\bflourish/.test(s)) {
    c.add({ k: 'life.bless' }, 'a blessing');
    c.add({ k: 'miracle.food' }, 'plenty');
    c.add({ k: 'miracle.teach', settlement: sid }, 'and what comes next');
    return true;
  }
  // sickness: "make everyone in Aru sick", "infect Lune with influenza", "spread the plague in Aru"
  const dz = findNoun(u.content, p, s, ['disease']);
  if (/\b(sick|ill|infect|infected|sicken|disease|diseased|fever|contagion|epidemic)\b/.test(s) || (dz && /\b(spread|give|bring|infect|send)\b/.test(s))) {
    c.add({ k: 'settlement.introduce', disease: dz ? dz.id : 'wasting-cough', ...(mods.qty ? { qty: mods.qty } : { qty: /\b(everyone|everybody|all)\b/.test(full) ? Math.max(2, pop) : 3 }) }, `sickness in ${st.name}`);
    return true;
  }
  // hunger and harvests
  if (/\b(crops?|harvests?|fields)\b/.test(s) && /\b(fail|wither|die|rot|ruin|ruined|blight|spoil)\b/.test(s)) { c.add({ k: 'disaster.spawn', kind: 'blight' }, `the crops of ${st.name} fail`); return true; }
  if (/\b(end|stop|cure|no more|banish)\b.*\b(hunger|famine|starvation)\b|\bfeed\b/.test(s)) { c.add({ k: 'miracle.food' }, `food for ${st.name}`); return true; }
  if (/\b(starve|famine|hunger)\b/.test(s)) { c.add({ k: 'disaster.spawn', kind: 'blight' }, `famine at ${st.name}`); return true; }
  // silence and forgetting
  if (/\b(silence|mute|hush|gag)\b/.test(s) && !findNoun(u.content, p, s, ['recipe']) && !/\b(someone|somebody|a person|the smith|the priest|the teacher|the chief)\b/.test(s)) { c.add({ k: 'settlement.silence' }, `silence ${st.name}`); return true; }
  if (verb(cx, s, 'forget') || /\bforget\b/.test(s)) {
    const k = findNoun(u.content, p, s, ['recipe']);
    if (k) { c.add({ k: 'settlement.withdraw', idea: k.id }, `${st.name} forgets ${k.text}`); return true; }
    if (/\b(everything|all|all they know|all they knew|it all|their past)\b/.test(s)) { c.add({ k: 'settlement.silence', everything: true }, `${st.name} forgets everything`); return true; }
  }
  // the god's comfort for a whole town
  if ((verb(cx, s, 'stroke') || /\bcomfort|console|soothe\b/.test(s)) && /\b(people|everyone|town|village|city|all)\b/.test(s)) { c.add({ k: 'life.bless' }, `comfort ${st.name}`); return true; }
  return false;
}

// ───────────────────────────── someone of a place, unnamed ─────────────────────────────

function intentSomeone(c: Clause): boolean {
  const { s, cx, mods } = c;
  const p = cx.p;
  if (!p?.people) return false;
  const silenceW = /\b(silence|mute|hush|gag)\b/.test(s) && /\b(someone|somebody|a person|the smith|the priest|the teacher|the chief|the elder|one of them)\b/.test(s);
  const forgetW = verb(cx, s, 'forget') !== null && !findNoun(cx.u.content, p, s, ['recipe']) && /\b(someone|somebody|a person|one of them)\b/.test(s);
  const want = verb(cx, s, 'possess') ? 'possess' : verb(cx, s, 'disciple') ? 'disciple' : verb(cx, s, 'inspire') ? 'inspire' : silenceW || forgetW ? 'silence' : '';
  const anyone = /\b(someone|somebody|a person|anyone|a villager|one of them|a man|a woman)\b/.test(s);
  if (!want || (mods.place?.settlement === undefined && !anyone)) return false;
  const st = mods.place?.settlement !== undefined ? p.people.settlement(mods.place.settlement) : largestSettlement(cx);
  const who = st ? pickPerson(cx, st.id, s, want) : -1;
  if (who < 0) return c.ask(`There is no one ${st ? `in ${st.name}` : 'there'} to ${want}.`);
  const o = { planet: p.id };
  if (want === 'possess') c.add({ k: 'agent.possess', id: who, on: true, ...o }, 'possess');
  else if (want === 'disciple') c.add({ k: 'agent.make-disciple', id: who, mode: DISCIPLE_MODES.find((m) => has(s, m) || has(s, m + 's')) ?? 'preach', ...o }, 'disciple');
  else if (want === 'inspire') c.add({ k: 'agent.inspire', id: who, ...o }, 'inspire');
  else c.add({ k: 'agent.silence', id: who, ...o }, 'silence');
  return true;
}

// ───────────────────────────── possession, the creature, the hand, rival gods, laws ─────────────────────────────

function intentPossession(c: Clause): boolean {
  const { s, cx, mods } = c;
  if (!cx.u.god.possession.length) return false;
  if (/\b(stop possessing|release (him|her|them)|leave (him|her|them)|unpossess|let (him|her|them) be)\b/.test(s)) {
    const q = cx.u.god.possession[0];
    c.add({ k: 'agent.possess', id: q.agent, on: false, planet: q.planet }, 'release');
    return true;
  }
  if (verb(cx, s, 'walk') && mods.place?.pos) { c.add({ k: 'possess.move', pos: mods.place.pos }, 'walk'); return true; }
  const act = ACTS.find((a) => has(s, a));
  if (act && (has(s, 'go', 'now', 'possessed') || /^(gather|wood|fish|hunt|build|pray|preach|teach|eat|drink|sleep|dance|fight|rest|explore)\b/.test(s))) { c.add({ k: 'possess.act', act }, act); return true; }
  return false;
}

function intentCreature(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const tpl = findNoun(u.content, p, s, ['creature']);
  const creWord = has(s, ...cx.L.creatureWords) || has(s, 'pet');
  const mine = u.god.creatures.filter((q) => q.alive && q.god === 0);
  const creVerb = /\b(leash|tie|tether|guard|protect|watch over|unleash|set free|roam|good|well done|clever|bad|naughty|stop that|reward|punish|praise|scold|send|release|name|call|come|go|follow|bigger|larger|taller|grow|grown|smaller|shrink|shorter)\b/.test(s) || verb(cx, s, 'stroke') !== null || verb(cx, s, 'slap') !== null
    || (MIRACLES.some((m) => has(s, m) || has(s, plural(m))) && has(s, 'teach', 'show', 'learn', 'watch')) || /^(?:rename|call|name)\b/.test(s);
  const liveCre = findLive(full, cx.live, ['creature']) ?? (creWord && mine.length ? { id: mine[0].id, kind: 'creature' as const } : null);
  // a new creature: "adopt a great cat", "give me a creature", "I want a pet"
  const adoptV = verb(cx, s, 'adopt') || /\b(give me|i want|get me|bring me|find me)\b/.test(full);
  if (tpl && (adoptV || (!creVerb && has(s, 'creature', 'my creature', 'titan', 'pet', 'giant')))) { c.add({ k: 'creature.adopt', template: tpl.id }, 'adopt'); return true; }
  if (!tpl && creWord && adoptV && !/\b(teach|leash|reward|punish)\b/.test(s)) { c.add({ k: 'creature.adopt' }, 'adopt a creature'); return true; }
  // "the creature" with no creature yet: the command still goes (and says "adopt one first" when it runs)
  const cre = liveCre ?? (creWord && creVerb ? { id: -1, kind: 'creature' as const } : null);
  if (!cre) return false;
  const idOf = (): Record<string, number> => (cre.id >= 0 ? { id: cre.id } : {});
  const rnc = full.match(/\b(?:rename|call|name)\s+(?:.+?\s+)?(?:to|as)\s+([a-z0-9' -]+)$/) ?? full.match(/\b(?:name|call)\s+(?:the |my )?creature\s+([a-z0-9' -]+)$/);
  if (rnc && !/\b(here|over|to me|back)\b/.test(rnc[1])) { c.add({ k: 'creature.rename', ...idOf(), to: rnc[1].trim().replace(/\b\w/g, (m) => m.toUpperCase()) }, 'rename'); return true; }
  if (/^name\s+(?:the |my )?creature$/.test(s)) { cx.asked.push({ k: 'creature.rename', ...idOf() }); return c.ask('Name it what? ("name the creature Grom").'); }
  // its size at once: "make the creature bigger", "grow my creature to full size", "shrink it"
  if (/\b(bigger|larger|taller|grow|grows|huge|giant|enormous|full size|full-size|full grown|fully grown|smaller|shrink|shorter|tiny|little)\b/.test(s) && !/\b(teach|leash|crops?|forest|trees?)\b/.test(s)) {
    const down = /\b(smaller|shrink|shorter|tiny|little)\b/.test(s);
    const amount = /\b(full size|full-size|full grown|fully grown|giant|enormous|as big as it can)\b/.test(s) ? 1 : /\b(much|far|twice|double|a lot)\b/.test(s) ? 0.5 : 0.25;
    c.add({ k: 'creature.grow', ...idOf(), amount: down ? -amount : amount }, down ? 'the creature shrinks' : 'the creature grows');
    return true;
  }
  if (/\b(good|well done|good boy|good girl|clever|reward|praise)\b/.test(s) || verb(cx, s, 'stroke')) { c.add({ k: 'creature.reward', ...idOf() }, 'reward'); return true; }
  if (/\b(bad|no|naughty|stop that|bad boy|bad girl|punish|scold)\b/.test(s) || verb(cx, s, 'slap')) { c.add({ k: 'creature.punish', ...idOf() }, 'punish'); return true; }
  const mode = LEASH_MODES.find((m) => has(s, m) || has(s, m + 's'));
  if (has(s, 'leash', 'tie', 'tether', 'guard', 'protect', 'watch over') || mode) {
    c.add({ k: 'creature.leash', ...idOf(), ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : mods.place?.pos ? { pos: mods.place.pos } : {}), mode: mode ?? (has(s, 'guard', 'protect') ? 'defend' : 'tend') }, 'leash');
    return true;
  }
  if (has(s, 'release', 'let it go', 'free it', 'set it free for good', 'abandon')) { c.add({ k: 'creature.release', ...idOf() }, 'release'); return true; }
  if (has(s, 'unleash', 'set free', 'free', 'roam')) { c.add({ k: 'creature.unleash', ...idOf() }, 'unleash'); return true; }
  // teach a miracle by example: the longest miracle named, plurals too, never the verb "teach" itself
  const mir = MIRACLES.slice().sort((a, b) => b.length - a.length).find((m) => m !== 'teach' && (has(s, m) || has(s, plural(m)))) ?? (/\bteach\b.*\b(the )?teach(ing)? miracle\b/.test(s) ? 'teach' : undefined);
  if (mir && has(s, 'teach', 'show', 'learn', 'watch')) { c.add({ k: 'creature.teach-by-example', ...idOf(), miracle: mir }, 'teach by example'); return true; }
  if (has(s, 'teach', 'show') && !mir) return c.ask('Teach it which miracle? (water, food, heal, forest, storm, fire, fireball, shield, lightning, wood, fertility, calm, teach, meteor) — cast it near the creature and it learns by watching.');
  if (has(s, 'go', 'come', 'walk', 'move', 'send', 'call', 'follow', 'here')) {
    const to = mods.place?.pos ?? focusPos(cx);
    if (to) { c.add({ k: 'creature.move', ...idOf(), pos: to }, 'go'); return true; }
  }
  return false;
}

function intentHand(c: Clause): boolean {
  const { s, cx, mods } = c;
  const { u, p } = cx;
  const kinds: [RegExp, string][] = [[/\b(rock|rocks|boulder|boulders|stone|stones)\b/, 'rock'], [/\b(tree|trees)\b/, 'tree'], [/\b(person|man|woman|child|someone|villager|somebody)\b/, 'agent'], [/\b(hut|house|building|shrine)\b/, 'building'], [/\b(animal|sheep|cow|deer|beast)\b/, 'animal'], [/\bcreature\b/, 'creature']];
  const intoHand = /\b(in|into|to|for) (my|the) hand\b|\bthe hand\b.*\b(a|an|some)\b|\bin my palm\b/.test(c.full) || /\bgive the hand\b/.test(c.full);
  // "conjure 20 bread into my hand", "give the hand a rock"
  if (intoHand && /\b(conjure|give|put|place|bring|summon|make|create|fill)\b/.test(s)) {
    const item = findNoun(u.content, p, s, ['item']);
    const k = kinds.find(([re]) => re.test(s));
    if (item && !k) c.add({ k: 'hand.grab', item: item.id, ...(mods.qty ? { qty: mods.qty } : {}) }, `${item.text} into the hand`);
    else c.add({ k: 'hand.grab', kind: k ? k[1] : 'rock' }, `${k ? k[1] : 'a rock'} into the hand`);
    return true;
  }
  if (verb(cx, s, 'throw')) {
    // a thing named first is picked up: "throw a tree at Lune", "throw a rock into the sea"
    const to = mods.toward ?? mods.place;
    const sea = /\b(sea|ocean|water|lake)\b/.test(s) && p ? nearestPlaceKind(u, p, focusPos(cx) ?? [0, 0, 1], /\blake\b/.test(s) ? 'lake' : 'sea') : null;
    const k = kinds.find(([re]) => re.test(s));
    const item = findNoun(u.content, p, s, ['item']);
    const held = u.god.hand(0)?.held;
    mods.place = null;
    if (k && (!held || !/\b(it|that|this)\b/.test(s))) c.add({ k: 'hand.grab', kind: k[1] }, `pick up a ${k[1]}`);
    else if (item && !held) c.add({ k: 'hand.grab', item: item.id, ...(mods.qty ? { qty: mods.qty } : {}) }, `${item.text} into the hand`);
    c.add({ k: 'hand.throw', ...((sea ?? to?.pos) ? { toward: sea ?? to!.pos } : {}), ...(mods.nums[0] && !item ? { speed: mods.nums[0] } : {}) }, 'throw');
    mods.place = null;
    return true;
  }
  if (verb(cx, s, 'grab') && !/\b(land|ground|earth|terrain|season|sun)\b/.test(s)) {
    const item = findNoun(u.content, p, s, ['item']);
    const k = kinds.find(([re]) => re.test(s));
    if (item && !k) c.add({ k: 'hand.grab', item: item.id, ...(mods.qty ? { qty: mods.qty } : {}) }, 'conjure into the hand');
    else c.add({ k: 'hand.grab', ...(k ? { kind: k[1] } : {}) }, 'grab');
    return true;
  }
  if (/^(drop it|let go|let it go|release it|drop|let go of it|drop that)$/.test(s)) { c.add({ k: 'hand.drop' }, 'drop'); return true; }
  if (/^(put it down|set it down|place it|put (him|her|them) down|set (him|her|them) down)/.test(s)) { c.add({ k: 'hand.place' }, 'set down'); return true; }
  if (verb(cx, s, 'slap') && !findNoun(u.content, p, s, ['disaster'])) { c.add({ k: 'hand.slap' }, 'slap'); return true; }
  if (verb(cx, s, 'stroke') && !findNoun(u.content, p, s, ['disaster'])) {
    if (mods.place?.settlement !== undefined && /\b(people|everyone|town|village|all)\b/.test(s)) { c.add({ k: 'life.bless' }, 'comfort them all'); return true; }
    c.add({ k: 'hand.stroke' }, 'stroke');
    return true;
  }
  return false;
}

function intentRival(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const godL = findLive(full, cx.live, ['god']);
  const banish = has(s, 'remove', 'banish', 'kill', 'destroy', 'silence', 'slay', 'smite', 'cast out', 'unmake');
  if (godL && banish) { c.add({ k: 'rival.remove', id: godL.id }, 'banish a god'); return true; }
  const godWord = /\b(god|gods|goddess|deity|deities|divinity)\b/.test(s);
  if (!godWord) return false;
  if (/\b(rival|other|false|enemy|another|second|new|a|an)\b/.test(s) && banish && cx.u.god.gods.some((g) => g.alive && g.kind === 'rival')) { c.add({ k: 'rival.remove' }, 'banish a god'); return true; }
  const tempW: [RegExp, string][] = [[/\b(benevolent|kind|good|gentle|loving|merciful|caring|light|wise)\b/, 'benevolent'], [/\b(wrathful|angry|cruel|evil|vengeful|dark|war|wicked|bloody|terrible|jealous god of war)\b/, 'wrathful'], [/\b(trickster|tricky|mischievous|chaotic|sly|cunning|playful)\b/, 'trickster'], [/\b(jealous|envious|possessive|bitter)\b/, 'jealous']];
  const temp = TEMPERAMENTS.find((t) => has(s, t)) ?? tempW.find(([re]) => re.test(s))?.[1];
  const make = /\b(add|create|make|give|summon|send|bring|invent|birth|raise|conjure|let there be|new|another|second|rival|false|enemy)\b/.test(s) || verb(cx, s, 'rival') !== null;
  if (make && !/\b(my|me|i am|the god)\b/.test(s.replace(/\bgive me\b/, ''))) {
    c.add({ k: 'rival.add', ...(temp ? { temperament: temp } : {}), ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : {}) }, `a${temp ? ` ${temp}` : ''} rival god`);
    return true;
  }
  if (banish && /\b(the god|rival)\b/.test(s)) {
    if (!cx.u.god.gods.some((g) => g.alive && g.kind === 'rival')) return c.ask('There is no other god to banish — you are the only one here.');
    c.add({ k: 'rival.remove' }, 'banish a god');
    return true;
  }
  return false;
}

function intentLaw(c: Clause): boolean {
  const { s, cx } = c;
  if (has(s, 'restraint')) { c.add({ k: 'meta.restraint', on: !has(s, 'off', 'no', 'remove', 'end', 'disable', 'stop') }, 'restraint'); return true; }
  const law = findNoun(cx.u.content, cx.p, s, ['law']);
  if (verb(cx, s, 'law') || (law && has(s, 'law', 'laws', 'commandment', 'decree', 'teach', 'give', 'grant', 'introduce'))) {
    if (law && LAWS[law.id]) { c.add({ k: 'settlement.law', law: law.id }, `law: ${LAWS[law.id].name}`); return true; }
    if (verb(cx, s, 'law') && /^(give|grant)\b/.test(s)) return c.ask('Which law? (peace, worship, learning, labour, hospitality, tradition, war, no fire, no hunting, sharing) — e.g. "give Aru the law of peace".');
  }
  return false;
}

// ───────────────────────────── ships between the worlds ─────────────────────────────

const VESSEL = /\b(ships?|rockets?|airships?|orbiters?|generation ships?|spaceships?|spacecraft|space ships?|vessels?|starships?|gate crossing)\b/;

/** the planets named in a clause in the order written (the raw clause: a name the place-lifting took out counts too) */
function planetsIn(c: Clause): (Live & { at: number })[] {
  return allLive(c.full, c.cx.live, ['planet']);
}

/**
 * Ships by their verbs: "launch a rocket to Rust", "send a ship to Rust", "send the plains folk to the stars" (from the
 * town named or the most advanced people, TO the world named), "call the ship back", "turn Ukugur back", "destroy the
 * rocket", "strike Ukugur from the sky" (a ship by name, else the one flying: the command picks it).
 */
function intentShip(c: Clause): boolean {
  const { cx, full, mods } = c;
  const named = findLive(full, cx.live, ['ship']);
  const vessel = VESSEL.test(full);
  const stars = /\bto the stars\b|\binto space\b|\bspace program\b/.test(full);
  if (!named && !vessel && !stars) return false;
  // (a boat on the sea is a ship too: "send ships to Aru" with no world named and no word of space is the peoples' own)
  const worlds = planetsIn(c);
  const spacey = !!named || stars || worlds.length > 0 || /\b(rockets?|orbiters?|generation ships?|spaceships?|spacecraft|space ships?|starships?|airships?)\b/.test(full);
  const flying = cx.u.space.ships.some((sh) => sh.phase !== 'done');
  if (!spacey && !flying) return false;
  const ref = named ? { ship: named.id } : {};
  const who = named ? named.name.replace(/\b\w/g, (m) => m.toUpperCase()) : 'the ship';
  if (/\b(call|turn|bring|order|summon|send)\b.*\b(back|home|around|about)\b|\b(recall|abort|cancel|forbid|ground)\b|\bstop\b.*\b(launch|ship|rocket|building)\b/.test(full)) {
    c.add({ k: 'ship.cancel', ...ref }, `call ${who} back`);
    return true;
  }
  if (/\b(destroy|strike|smash|shoot|blast|wreck|smite|explode|blow up|bring down|knock down|down the)\b/.test(full)) {
    c.add({ k: 'ship.destroy', ...ref }, `strike ${who} from the sky`);
    return true;
  }
  if (!spacey || (!/\b(launch|send|fly|build|make|go|sail|set out|leave|take)\b/.test(full) && !stars)) return false;
  if (!vessel && !stars) return false;
  // to the world named after to / for / toward (or the only world named that is not where they start)
  const toM = full.match(/\b(?:to|for|toward|towards|onto|at|reach)\s+(?:the\s+)?(?:world\s+|planet\s+|moon\s+)?(.+)$/);
  let to = toM ? worlds.find((w) => wordAt(toM[1], w.name) === 0) : undefined;
  const fromM = full.match(/\bfrom\s+(?:the\s+)?(?:world\s+|planet\s+)?(.+?)(?:\s+(?:to|for|toward|towards)\b|$)/);
  const from = fromM ? worlds.find((w) => wordAt(fromM[1], w.name) === 0) : undefined;
  if (!to && worlds.length === 1 && worlds[0] !== from) to = worlds[0];
  const kind = /\bairships?\b/.test(full) ? 'airship' : /\borbiters?\b/.test(full) ? 'orbiter' : /\bgeneration ships?\b/.test(full) ? 'generation-ship' : /\bgate\b/.test(full) ? 'gate' : /\brockets?\b/.test(full) ? 'rocket' : undefined;
  const cmd: Command = { k: 'ship.launch', ...(kind ? { kind } : {}), ...(to ? { to: to.id } : {}), ...(from ? { planet: from.id } : {}) };
  // the place-lifting read "to Rust" as where to act: the world the ship goes TO is not the world it leaves
  if (mods.place && !mods.place.settlement && to && mods.place.planet === to.id) mods.place = null;
  if (mods.place?.settlement !== undefined) { cmd.settlement = mods.place.settlement; if (mods.place.planet !== undefined) cmd.planet = mods.place.planet; }
  for (const w of ['colony', 'colonise', 'colonize', 'settle', 'trade', 'exodus', 'refuge', 'flee', 'explore', 'look']) if (wordAt(full, w) >= 0) {
    cmd.purpose = w === 'colonise' || w === 'colonize' || w === 'settle' ? 'colony' : w === 'flee' ? 'refuge' : w === 'explore' || w === 'look' ? 'curiosity' : w;
    break;
  }
  const toName = to ? cx.u.planet(to.id)?.name : undefined;
  mods.qty = undefined; mods.one = undefined;
  c.add(cmd, `send them to the stars${kind ? ` · ${kind}` : ''}${toName ? ` · to ${toName}` : ''}`);
  return true;
}

// ───────────────────────────── worlds ─────────────────────────────

/**
 * A world named in the clause and a verb for worlds: "crack Rust", "erase Rust", "unmake Verd", "destroy the world
 * Rust", "move Rust to 2 au", "give Rust a moon", "drop the moon on Gaia", "seed deer across Rust", "populate Rust with
 * plains folk" — and the birth of a world by name ("create a planet called Eden"). The world's name binds the
 * command's `world`, and the preview names it.
 */
function intentWorldNamed(c: Clause): boolean {
  const { cx, full, mods } = c;
  const { u } = cx;
  // a new world by name: "create a planet called Eden", "birth a world named Thule at 2 au"
  const called = cx.raw.match(/\b(?:called|named)\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)*)/);
  if (called && /\b(world|planet)\b/.test(full) && /\b(make|create|birth|form|forge|build|add|spawn|conjure|summon|bring forth|new|another)\b/.test(full)) {
    const k = findNoun(u.content, cx.p, full, ['planetkind']);
    const au = full.match(/(\d+(?:\.\d+)?)\s*au\b/);
    mods.qty = undefined; mods.one = undefined;
    c.add({ k: 'world.birth', name: called[1].trim(), kind: k?.id ?? 'terran', ...(au ? { distance: parseFloat(au[1]) } : {}) }, `birth a world · ${called[1].trim()}`);
    return true;
  }
  const ws = planetsIn(c);
  if (!ws.length) return false;
  const w = ws[0];
  const name = u.planet(w.id)?.name ?? w.name;
  const isMoon = (u.planet(w.id)?.st.orbit.parent ?? -1) >= 0;
  const bind = (cmd: Command, label: string) => {
    // the world named is the one acted on (not the place to act from)
    if (mods.place && !mods.place.settlement && mods.place.planet === w.id) mods.place = null;
    mods.qty = undefined; mods.one = undefined;
    c.add(cmd, `${label} · ${name}`);
    return true;
  };
  // the verb must take the world itself as its object ("destroy the crops on Rust" is not the end of Rust)
  const nm = esc(w.name);
  const of = (verbs: string) => new RegExp(`\\b(?:${verbs})\\s+(?:the\\s+)?(?:(?:whole\\s+)?(?:world|planet|moon)\\s+(?:of\\s+)?)?${nm}\\b|\\b${nm}\\s+(?:must\\s+|shall\\s+|should\\s+)?(?:be\\s+|is\\s+)?(?:${verbs})(?:ed|d|n)?\\b`).test(full);
  if (of('erase|unmake|annihilate|obliterate|delete|destroy|uncreate|wipe out|end')) return bind({ k: 'world.erase', world: w.id }, 'erase the world');
  if (of('crack|shatter|split|break|sunder')) return bind({ k: 'world.crack', world: w.id }, 'crack the world');
  if (/\bmoon\b/.test(full) && /\b(drop|crash|fall|falls|falling|smash|hurl)\b/.test(full)) return bind({ k: 'world.moon-fall', world: w.id }, 'drop the moon');
  if (/\b(moon|moons|satellite)\b/.test(full) && /\b(add|give|new|another|create|make|second)\b/.test(full) && !isMoon) return bind({ k: 'world.moon-add', world: w.id }, 'a new moon');
  if (/\b(seed|populate|colonise|colonize)\b/.test(full)) {
    const sp = findNoun(u.content, cx.p, full, ['species', 'animal', 'plant']);
    if (!sp) { cx.asked.push({ k: 'world.seed-species', world: w.id }); return c.ask(`Seed ${name} with what? ("seed deer across ${name}", "populate ${name} with plains folk").`); }
    const n = mods.qty;
    mods.qty = undefined; mods.one = undefined;
    if (mods.place && !mods.place.settlement && mods.place.planet === w.id) mods.place = null;
    c.add({ k: 'world.seed-species', world: w.id, species: sp.id, ...(n !== undefined ? { count: Math.max(1, Math.min(50, Math.round(n))) } : {}) }, `seed ${sp.id} across ${name}`);
    return true;
  }
  const au = full.match(/(\d+(?:\.\d+)?)\s*au\b/);
  if (/\b(move|push|pull|shift|drag|carry)\b/.test(full) && (au || /\b(closer|nearer|farther|further|away|out|in)\b/.test(full))) {
    const cur = (u.planet(w.id)?.st.orbit.a ?? AU) / AU;
    const d = au ? parseFloat(au[1]) : /\b(closer|nearer|in)\b/.test(full) ? cur * 0.8 : cur * 1.25;
    return bind({ k: 'world.move', world: w.id, distance: Math.round(d * 1000) / 1000 }, 'move the world');
  }
  return false;
}

function intentWorld(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  // a world is born only when one is asked for: "make a new world", "birth a planet", "another world"
  const birth = /\b(make|create|birth|form|forge|build|add|spawn|conjure|summon|bring forth|give me|i want)\b.*\b(a|an|another|new|second|third|one more)\b.*\b(world|planet)s?\b/.test(s) || /^(a |another |one more )?new (world|planet)\b/.test(s) || /^another (world|planet)\b/.test(s) || /\bbirth (a|an|the)? ?(world|planet)\b/.test(s);
  if (birth && !/\b(moon|sun|star)\b/.test(s)) {
    const k = findNoun(u.content, p, s, ['planetkind']);
    const au = full.match(/(\d+(?:\.\d+)?)\s*au\b/);
    // ("a world" is one world, not a people of one)
    c.mods.qty = undefined; c.mods.one = undefined;
    c.add({ k: 'world.birth', kind: k?.id ?? 'terran', ...(au ? { distance: parseFloat(au[1]) } : {}) }, 'birth a world');
    return true;
  }
  if (/\b(crack|shatter|split|break)\b.*\b(world|planet)\b|^crack\b/.test(s) && !mods.place?.settlement && !/\bcontinent\b/.test(s)) { c.add({ k: 'world.crack', ...(mods.place?.planet !== undefined ? { world: mods.place.planet } : {}) }, 'crack the world'); return true; }
  if (/\b(split|break|tear|crack)\b.*\bcontinents?\b/.test(s)) { c.add({ k: 'disaster.spawn', kind: 'rift', scale: 3 }, 'a rift splits the land'); return true; }
  if (/\b(erase|unmake|annihilate|destroy|obliterate)\b.*\b(world|planet)\b/.test(s)) { c.add({ k: 'world.erase', ...(mods.place?.planet !== undefined ? { world: mods.place.planet } : {}) }, 'erase the world'); return true; }
  if (/\b(drop|crash|fall|falls|falling)\b.*\bmoon\b|\bmoon\b.*\b(fall|falls|crash|drop)\b/.test(s)) { c.add({ k: 'world.moon-fall', ...(mods.place?.pos ? { pos: mods.place.pos } : {}) }, 'drop the moon'); return true; }
  // the moon nearer or farther
  const moon = p ? u.planets.find((q) => q.alive && q.st.orbit.parent === p.id) : undefined;
  if (/\bmoon\b/.test(s) && /\b(closer|nearer|near|bigger in the sky|toward us|in)\b/.test(s) && /\b(bring|move|pull|draw|make|push)\b/.test(s)) {
    if (!moon) return c.ask(`${p?.name ?? 'This world'} has no moon ("add a moon" first).`);
    const cur = moon.st.orbit.a / (AU * 0.01);
    c.add({ k: 'world.move', world: moon.id, distance: Math.round(Math.max(0.05, cur * 0.6) * 1000) / 1000 }, `${moon.name} drawn nearer`);
    return true;
  }
  if (/\bmoon\b/.test(s) && /\b(away|farther|further|out)\b/.test(s) && /\b(push|move|send|make)\b/.test(s)) {
    if (!moon) return c.ask(`${p?.name ?? 'This world'} has no moon.`);
    const cur = moon.st.orbit.a / (AU * 0.01);
    c.add({ k: 'world.move', world: moon.id, distance: Math.round(Math.min(40, cur * 1.6) * 1000) / 1000 }, `${moon.name} pushed away`);
    return true;
  }
  // "move the moon" with no word of where: nearer or farther are the ways a moon moves
  if (/\bmoon\b/.test(s) && /\b(move|shift|push|pull|drag|carry)\b/.test(s)) {
    if (!moon) return c.ask(`${p?.name ?? 'This world'} has no moon to move ("add a moon" first).`);
    cx.asked.push({ k: 'world.move', world: moon.id });
    return c.ask(`Move ${moon.name} nearer or farther? ("bring the moon closer", "push the moon away", "drop the moon").`);
  }
  if (/\b(add|new|another|give|create|make|second)\b.*\bmoons?\b|^(a )?moon$/.test(s) && !/\bred\b/.test(s)) { c.add({ k: 'world.moon-add' }, 'a new moon'); return true; }
  // what cannot be done to a world, said plainly with what can
  if (/\b(world|planet)\b/.test(s) && /\b(bigger|larger|smaller|grow|shrink|size)\b/.test(s) && !/\b(people|folk|animals|town|city)\b/.test(s)) return c.ask(`A world cannot be made bigger or smaller once it is born — but its gravity can change ("double the gravity"), or a bigger world can be born ("make a new world").`);
  if (/\bring|rings\b/.test(s) && /\b(world|planet)\b/.test(s)) return c.ask('A world cannot be given rings yet — but it can be given a moon ("add a moon"), or cracked to throw off a ring of debris and moonlets ("crack the world").');
  return false;
}

// ───────────────────────────── the sky: clear, calm, weather, wind ─────────────────────────────

function intentSky(c: Clause): boolean {
  const { s, cx, mods } = c;
  const { u, p, L } = cx;
  // "stop the rain", "end the storm", "no more snow": the weather lifts (here, or everywhere)
  if ((verb(cx, s, 'stop') || /\bno more\b/.test(s)) && (findNoun(u.content, p, s, ['weather']) || /\b(rain|storm|storms|weather|snow|blizzard|wind|winds|hail|fog|clouds)\b/.test(s)) && !findNoun(u.content, p, s, ['disaster'])) {
    c.add({ k: 'weather.clear', ...(mods.place?.everywhere ? { everywhere: true } : {}) }, 'clear the skies');
    return true;
  }
  // "clear the skies (everywhere)": the weather lifts (the 'clear' weather kind is what is left, not a thing to paint)
  if ((/\b(clear|lift|part|clean)\b/.test(s) && /\b(sky|skies|weather|clouds?|storms?|rain|heavens|air)\b/.test(s) && !/\b(rain|snow|hail) (of|down)\b/.test(s)) || /^(clear skies|clear weather|sunny|make it sunny|fair weather)$/.test(s)) {
    c.add({ k: 'weather.clear', ...(mods.place?.everywhere ? { everywhere: true } : {}) }, 'clear the skies');
    return true;
  }
  // "calm the storm", "soothe them": the calm miracle (storms disperse, fires die, fear eases)
  if (/\b(calm|soothe)\b|\bstill the\b/.test(s) && !/\bcalm (nature|disasters)\b/.test(s) && !/^set\b/.test(s) && !/\bwinds?\b/.test(s)) { c.add({ k: 'miracle.calm' }, 'calm'); return true; }
  // the wind: "make the wind blow from the east", "a gale from the north over Aru", "still the wind"
  if (/\b(wind|winds|breeze|gale|gales)\b/.test(s) && !/\b(rain|snow|sand|storm of)\b/.test(s)) {
    if (/\b(stop|still|calm|end|no|halt|cease|drop)\b/.test(s)) { c.add({ k: 'weather.wind', from: 'north', strength: 0 }, 'the wind falls still'); return true; }
    const dirM = s.match(/\bfrom (?:the )?(north|south|east|west|northeast|north-east|northwest|north-west|southeast|south-east|southwest|south-west)\b/) ?? s.match(/\b(north|south|east|west|northeast|northwest|southeast|southwest)(?:erly| wind)\b/);
    const toM = s.match(/\b(?:to|toward|towards) (?:the )?(north|south|east|west|northeast|northwest|southeast|southwest)\b/);
    const from = dirM ? BEARINGS[dirM[1]] : toM ? (BEARINGS[toM[1]] + 180) % 360 : null;
    if (from === null) return c.ask('Blow from where? ("make the wind blow from the east", "a gale from the north").', 'weather.wind');
    const strength = /\bgale|storm|hurricane|fierce|howling|strong\b/.test(s) ? 22 : /\bbreeze|gentle|light|soft\b/.test(s) ? 5 : 12;
    const local = !!mods.place && !mods.place.everywhere && !mods.place.here;
    c.add({ k: 'weather.wind', from, strength: Math.round(strength * (mods.intensity ?? 1)), ...(local ? { everywhere: false, radius: 1500 } : { everywhere: true }), ...(mods.duration !== undefined ? { duration: mods.duration } : {}) }, `wind from the ${Object.keys(BEARINGS).find((k) => BEARINGS[k] === from && !k.includes('-')) ?? `${from}°`}`);
    if (!local) mods.place = null;
    return true;
  }
  // ash falling, acid rain, auroras, fog ... as weather (planet-wide when everywhere)
  const ashFall = /\bash\b/.test(s) && /\b(fall|falls|falling|rain|rains|snow|drift|drifts|cover)\b/.test(s);
  const covering = findNoun(u.content, p, s, ['species', 'animal', 'plant', 'item', 'creature', 'disease', 'recipe', 'building']);
  const ww = Object.keys(L.weatherWords).sort((a, b) => b.length - a.length).find((w) => wordAt(s, w) >= 0 && !(covering && covering.text.length > w.length && wordAt(covering.text, w.split(' ')[0]) >= 0));
  const wn0 = findNoun(u.content, p, s, ['weather']);
  const wn = wn0 && covering && covering.text.length > wn0.text.length && covering.at <= wn0.at && covering.at + covering.text.length >= wn0.at + wn0.text.length ? null : wn0;
  const dn = findNoun(u.content, p, s, ['disaster']);
  const kind = ashFall ? 'ashfall' : wn && (!dn || dn.text.length <= wn.text.length || mods.place?.everywhere) ? wn.id : ww && (!dn || mods.place?.everywhere) ? L.weatherWords[ww] : null;
  if (kind && !verb(cx, s, 'rain') && !/\b(stop|end|no more)\b/.test(s)) {
    if (kind === 'clear') { c.add({ k: 'weather.clear', ...(mods.place?.everywhere ? { everywhere: true } : {}) }, 'clear the skies'); return true; }
    if (mods.place?.everywhere) { c.add({ k: 'weather.global', kind }, `${kind} everywhere`); return true; }
    if (/\b(sky|skies|night sky|heavens)\b/.test(s) && kind === 'aurora-storm') { c.add({ k: 'weather.paint', kind, radius: 6000, duration: mods.duration ?? 1440 }, 'auroras fill the sky'); return true; }
    c.add({ k: 'weather.paint', kind, pinned: has(s, 'stay', 'keep', 'pin', 'always') }, kind);
    return true;
  }
  // rain X
  const rainV0 = verb(cx, s, 'rain');
  const rainD = rainV0 ? findNoun(u.content, p, s, ['disaster']) : null;
  const rainV = rainV0 && !(rainD && wordAt(rainD.text, rainV0) >= 0) ? rainV0 : null;
  if (rainV) {
    const after = s.slice(wordAt(s, rainV) + rainV.length).trim().replace(/^(down|of|the|some|on|over|from)\s+/g, '').trim();
    const w = findNoun(u.content, p, after, ['weather']);
    const known: Record<string, string> = { blood: 'blood-rain', acid: 'acid-rain', ash: 'ashfall', hail: 'hail', snow: 'snow', sand: 'sandstorm', ice: 'hail' };
    const firstW = after.split(' ')[0] ?? '';
    const kind2 = w?.id ?? known[firstW] ?? known[singular(firstW)];
    if (kind2) { c.add({ k: mods.place?.everywhere ? 'weather.global' : 'weather.paint', kind: kind2 }, `rain of ${firstW || kind2}`); return true; }
    const onSomeone = cx.live.some((l) => wordAt(after, l.name) >= 0);
    if (firstW && !onSomeone && !L.stop.has(firstW) && !/^(here|there|hard|heavily|lightly|gently|now|again|today|tonight|everywhere|forever|more|less|down)$/.test(firstW)) {
      // a rain the world never had: of animals (they land alive), or of anything else (tinted)
      const noun = after.split(' ').filter((x) => !L.stop.has(x)).slice(0, 2).join(' ');
      const sing = singular(noun.split(' ').pop() ?? noun);
      const animal = findNoun(u.content, p, noun, ['animal']);
      const animalish = !!animal || L.animalish.has(sing) || L.animalish.has(noun);
      const id = slug(`rain of ${noun}`);
      cx.made.add(id);
      const tint = L.rains[noun] ?? L.rains[sing] ?? null;
      c.add({ k: 'content.weather', name: `rain of ${noun}`, base: 'rain', precip: 'rain', ...(animalish ? { animal: animal ? animal.id : sing } : {}), ...(tint ? { tint } : {}) }, `a rain of ${noun}`);
      return true;
    }
    c.add({ k: mods.place?.everywhere ? 'weather.global' : 'water.rain', ...(mods.place?.everywhere ? { kind: 'rain' } : {}) }, 'rain');
    return true;
  }
  return false;
}

// ───────────────────────────── ideas: teach, invent, introduce, give ─────────────────────────────

function intentIdeas(c: Clause): boolean {
  const { s, cx, mods } = c;
  const { u, p, L } = cx;
  const force = /\b(make|force|compel)\b.*\b(learn|know|understand|accept|discover)\b|\binsist\b/.test(s);
  const teachV = verb(cx, s, 'teach') ?? (force ? 'learn' : null);
  if (teachV && !has(s, ...L.creatureWords)) {
    const k = recipeOf(cx, s);
    if (k) {
      if (mods.place?.settlement !== undefined) c.add({ k: 'settlement.teach', knowledge: k.id, ...(force ? {} : {}) }, 'teach');
      else c.add({ k: 'idea.teach', knowledge: k.id, ...(force ? { force: true } : {}) }, force ? 'make them learn' : 'teach');
      if (force && mods.place?.settlement !== undefined) { c.out.pop(); cx.why.pop(); c.add({ k: 'idea.teach', knowledge: k.id, force: true }, 'make them learn'); }
      return true;
    }
    // "teach everyone to read" -> writing; "teach them to count" -> numbers ...
    const verbIdea: [RegExp, string][] = [[/\b(read|write|reading|writing|letters)\b/, 'writing'], [/\b(count|counting|numbers|arithmetic)\b/, 'counting'], [/\b(farm|farming|plough|sow)\b/, 'agriculture'], [/\b(make fire|light fires|fire)\b/, 'fire-making'], [/\b(fish|fishing)\b/, 'fishing'], [/\b(hunt|hunting)\b/, 'hunting'], [/\b(sail|sailing|boats?)\b/, 'boatbuilding'], [/\b(heal|healing|medicine)\b/, 'herbalism'], [/\b(pray|praying|worship)\b/, 'religion']];
    const vi = verbIdea.find(([re]) => re.test(s));
    if (vi && u.content.recipes.find(vi[1])) {
      if (mods.place?.settlement !== undefined && !force) c.add({ k: 'settlement.teach', knowledge: vi[1] }, 'teach');
      else c.add({ k: 'idea.teach', knowledge: vi[1], ...(force ? { force: true } : {}) }, 'teach');
      return true;
    }
    const noun = objectOf(cx, s, teachV);
    if (noun && plausibleNew(cx, noun)) {
      const id = slug(noun);
      cx.made.add(id);
      c.add({ k: 'content.idea', name: noun, effect: effectOf(L, noun), mult: 1.4 }, `invent the idea of ${noun}`);
      c.add({ k: 'settlement.teach', knowledge: id }, 'teach');
      return true;
    }
    c.add({ k: 'miracle.teach' }, 'teach what comes next');
    return true;
  }
  const inventV = verb(cx, s, 'invent');
  if (inventV) {
    const noun = objectOf(cx, s, inventV);
    if (noun) {
      const k = findNoun(u.content, p, noun, ['recipe']) ?? recipeOf(cx, noun);
      if (k) { c.add({ k: mods.place?.settlement !== undefined ? 'settlement.teach' : 'idea.teach', knowledge: k.id }, 'teach'); return true; }
      if (/^(an? )?(animal|beast|creature)$/.test(noun)) return c.ask('Invent which animal? Name it ("unicorns", "release dragons").');
      if (/^(an? )?(idea|thing|weather|rain|item)$/.test(noun)) return c.ask(`Invent what? Name it ("invent telepathy", "introduce chocolate", "rain frogs").`);
      if (!plausibleNew(cx, noun)) return false;
      const abstract = isAbstract(L, noun);
      const id = slug(noun);
      cx.made.add(id);
      if (abstract) {
        c.add({ k: 'content.idea', name: noun, effect: effectOf(L, noun), mult: 1.4 }, `invent the idea of ${noun}`);
        if (mods.place?.settlement !== undefined) c.add({ k: 'settlement.teach', knowledge: id }, 'teach it');
      } else {
        c.add({ k: 'content.item', name: noun, tags: tagsOf(L, noun) }, `invent ${noun}`);
        if (mods.place?.settlement !== undefined || mods.place?.pos) c.add({ k: 'settlement.introduce', item: id }, 'introduce it');
      }
      return true;
    }
  }
  const introV = verb(cx, s, 'introduce');
  if (introV && !/\bthe hand\b/.test(s)) {
    const noun = findNoun(u.content, p, s, ['law', 'species', 'disease', 'animal', 'plant', 'recipe', 'item']);
    const qty = mods.qty ?? (mods.one ? 1 : undefined);
    if (noun) {
      switch (noun.type) {
        case 'law': c.add({ k: 'settlement.law', law: noun.id }, 'give a law'); return true;
        case 'species': c.add({ k: 'settlement.introduce', people: noun.id, ...(qty ? { qty } : {}) }, 'introduce a people'); return true;
        case 'disease': c.add({ k: 'settlement.introduce', disease: noun.id }, 'introduce a disease'); return true;
        case 'animal': c.add({ k: 'settlement.introduce', animal: noun.id }, 'introduce animals'); return true;
        case 'plant': if (u.content.plants.find(noun.id)?.type === 'crop') { c.add({ k: 'settlement.introduce', crop: noun.id }, 'introduce a crop'); return true; } break;
        case 'recipe': c.add({ k: 'settlement.introduce', idea: noun.id, ...(force ? { force: true } : {}) }, 'introduce an idea'); return true;
        case 'item': {
          if (introV !== 'introduce' && mods.place?.settlement !== undefined) c.add({ k: 'settlement.gift', items: { [noun.id]: qty ?? 10 } }, 'give');
          else c.add({ k: 'settlement.introduce', item: noun.id, ...(qty ? { qty } : {}) }, 'introduce');
          return true;
        }
      }
    }
    const obj = objectOf(cx, s, introV);
    if (!obj) return false;
    const objS = singular(obj.split(' ').pop() ?? obj);
    if ((L.animalish.has(objS) || L.animalish.has(obj)) && !cx.L.creatureWords.includes(obj) && !cx.L.creatureWords.includes(objS)) {
      const name = obj.split(' ').length > 1 ? `${obj.split(' ').slice(0, -1).join(' ')} ${objS}` : objS;
      const id = slug(name);
      cx.made.add(id);
      c.add({ k: 'content.animal', name, ...(mods.qty ? { count: Math.round(mods.qty) } : {}) }, `a new animal: ${name}`);
      c.add({ k: 'settlement.introduce', animal: id }, `introduce ${obj}`);
      return true;
    }
    if (!plausibleNew(cx, obj)) return false;
    if (isAbstract(L, obj)) {
      const id = slug(obj);
      cx.made.add(id);
      c.add({ k: 'content.idea', name: obj, effect: effectOf(L, obj), mult: 1.4 }, `invent the idea of ${obj}`);
      c.add({ k: 'settlement.introduce', idea: id }, 'introduce it');
    } else c.add({ k: 'settlement.introduce', substance: obj, tags: tagsOf(L, obj) }, `introduce ${obj}`);
    return true;
  }
  return false;
}

/** may these words become a new thing? not a name, a verb, an adjective or a power word ("hesh immortal" is not an item) */
function plausibleNew(cx: PCtx2, noun: string): boolean {
  const words = noun.split(' ').filter((w) => w);
  if (!words.length) return false;
  if (cx.live.some((l) => wordAt(noun, l.name) >= 0)) return false;
  if (cx.L.creatureWords.includes(noun)) return false;
  const verbs = new Set(Object.values(cx.L.verbs).flat().filter((v) => !v.includes(' ')));
  const head = words[words.length - 1];
  if (verbs.has(words[0]) || verbs.has(head)) return false;
  // "drop him", "make them": a pronoun points at something, it never names a new one
  if (words.every((w) => /^(him|her|hers|his|them|they|their|it|its|he|she|we|us|me|you|i|this|that|these|those|myself|himself|herself|itself|themselves|someone|somebody|something|anything|everything|nothing|everyone|everybody|anyone|one|ones)$/.test(w))) return false;
  if (/(er|est|ly|ous|ful|less|ive|ible|able|ish|ed)$/.test(head) && !/(paper|silver|copper|leather|feather|butter|amber|thread|bread|weed|seed|reed|bead|sled|bed|shed|sled|olive|knife|nettle|vessel)$/.test(head)) return false;
  if (/^(immortal|bigger|smaller|stronger|weaker|harmless|closer|farther|further|taller|shorter|happy|sad|angry|friendly|peaceful|rich|poor|sick|well|alive|dead|free|safe|wise|clever|fertile|green|red|blue|old|young|new|good|bad|evil|holy|sacred|city|town|village)$/.test(head)) return false;
  for (const pw of cx.u.content.powers.list) if (!pw.command.startsWith('content.') && (pw.name.toLowerCase() === noun || pw.synonyms.includes(noun))) return false;
  return true;
}

// ───────────────────────────── miracles, death and life, the rest ─────────────────────────────

function intentMiracle(c: Clause): boolean {
  const { s } = c;
  if (!has(s, 'miracle', 'miracles', 'cast', 'conjure a', 'perform', 'work a')) return false;
  const mk = MIRACLES.slice().sort((a, b) => b.length - a.length).find((m) => has(s, m) || has(s, plural(m)) || has(s, m + 's'));
  if (mk) { c.add({ k: `miracle.${mk}` }, `${mk} miracle`); return true; }
  return false;
}

function intentDeath(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const st = mods.place?.settlement;
  if (verb(cx, s, 'kill') || /\bstrike\b.*\b(down|dead)\b/.test(s)) {
    const a = findNoun(u.content, p, s, ['animal', 'species']);
    if (a?.type === 'animal') {
      const all = /\b(all|every|everywhere|the world)\b/.test(full) || !!mods.place?.everywhere;
      c.add({ k: 'life.cull', species: a.id, ...(st !== undefined ? { settlement: st } : mods.place?.pos && !all ? { radius: Math.round(600 * (mods.size ?? 1)) } : {}) }, `cull the ${a.text}`);
      return true;
    }
    if (a?.type === 'species') { c.add({ k: 'life.kill', species: a.id, ...(st !== undefined ? { settlement: st } : {}) }, `death to the ${a.text}`); return true; }
    const everyone = /\b(everyone|everybody|every one|all life|them all|all of them|everything|the people|all the people|every person|all)\b/.test(s);
    if (/\b(animals|beasts|herds|wildlife)\b/.test(s)) { c.add({ k: 'life.cull', ...(st !== undefined ? { settlement: st } : { radius: Math.round(600 * (mods.size ?? 1)) }) }, 'cull the beasts'); return true; }
    if (/\b(plants|trees|forests?|grass|crops|green)\b/.test(s)) { c.add({ k: 'life.kill', what: 'plants', radius: Math.round(300 * (mods.size ?? 1)) }, 'wither every green thing'); return true; }
    if (st !== undefined && (everyone || /^(kill|slay|smite|murder|massacre|slaughter|strike down)$/.test(s.trim()))) { c.add({ k: 'life.kill', settlement: st, what: everyone && /\b(everything|all life)\b/.test(s) ? 'all' : 'people' }, `death over ${mods.place!.label}`); return true; }
    if (everyone && (mods.place?.pos && !mods.place.here || mods.place?.everywhere)) {
      if (mods.place?.everywhere) {
        const kinds = new Set((p?.people?.settlements ?? []).filter((x) => x.fallen < 0).map((x) => u.content.species.list[x.species].id));
        for (const k of kinds) c.add({ k: 'life.kill', species: k }, `death to every ${k}`);
        return c.out.length > 0 || c.ask(`There is no one on ${p?.name ?? 'this world'} to kill.`);
      }
      c.add({ k: 'life.kill', what: /\b(everything|all life)\b/.test(s) ? 'all' : 'people', radius: Math.round(150 * (mods.size ?? 1)) }, 'death');
      return true;
    }
    if (everyone && mods.place?.here) { c.add({ k: 'life.kill', what: 'people', radius: Math.round(100 * (mods.size ?? 1)) }, 'death here'); return true; }
    return c.ask('Strike down whom? Name a person ("smite Hesh"), a people ("kill the coastal folk"), animals ("kill the wolves") or a place ("kill everyone in Aru").');
  }
  // raze: a settlement must be its object (named, or "the town" near where the god looks)
  if (verb(cx, s, 'raze') || (/\b(level|flatten|destroy|demolish|wreck)\b/.test(s) && st !== undefined && !/\b(land|ground|hills?|earth|terrain)\b/.test(s))) {
    const target = st ?? (/\b(town|city|village|settlement)\b/.test(s) && p && focusPos(cx) ? nearestSettlement(p, focusPos(cx)!, 1500)?.id : undefined);
    if (target === undefined) return c.ask('Raze which settlement? Name it ("raze Aru") or look at it and say "raze the town".');
    c.add({ k: 'settlement.raze', settlement: target }, 'raze');
    return true;
  }
  if (verb(cx, s, 'burn') && !has(s, 'fireball')) {
    const R = st !== undefined && p?.people ? Math.max(80, (p.people.settlement(st)?.territory ?? 80)) : 80;
    c.add({ k: 'fire.ignite', radius: Math.round(R * (mods.size ?? 1)) }, 'burn');
    return true;
  }
  if (verb(cx, s, 'flood') && !findNoun(u.content, p, s, ['disaster'])) { c.add({ k: 'disaster.spawn', kind: 'flood' }, 'flood'); return true; }
  if (verb(cx, s, 'heal') || verb(cx, s, 'cure')) {
    if (mods.place?.everywhere || /\b(everyone|everybody|all the sick|the whole world|the world)\b/.test(full) && st === undefined) { c.add({ k: 'life.heal', everywhere: true }, 'heal everyone'); return true; }
    c.add({ k: 'miracle.heal' }, 'heal');
    return true;
  }
  if (verb(cx, s, 'bless')) { c.add({ k: 'life.bless' }, 'bless'); return true; }
  if (verb(cx, s, 'curse')) { c.add({ k: 'life.curse' }, 'curse'); return true; }
  if (verb(cx, s, 'split') && st !== undefined) { c.add({ k: 'settlement.split' }, 'split'); return true; }
  return false;
}

/** "gravity 3", "set the tilt 20" without a "to": a law with a number */
function intentLawNumber(c: Clause): boolean {
  const { s, mods } = c;
  if (!mods.nums.length || !/^[a-z .'-]+\s+(to\s+)?-?\d/.test(s)) return false;
  const words = s.replace(/-?\d+(\.\d+)?/g, ' ').replace(/\b(to|the|of|at|make|set|be)\b/g, ' ').trim().replace(/\s+/g, ' ');
  const d = words ? findParam(words) ?? paramByWords(c.cx, words) : undefined;
  if (d) { c.add({ k: 'set', path: d.path, value: mods.nums[0] }, `set ${d.label}`); return true; }
  return false;
}

/** species laws in words: "more children for the plains folk", "let the hive live longer" */
function intentSpeciesLaw(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  let spN = findNoun(u.content, p, s, ['species']);
  if (!spN && mods.place?.settlement !== undefined && p?.people && /\b(people|folk|they|them|everyone|villagers|townsfolk|their)\b/.test(full)) {
    const st = p.people.settlement(mods.place.settlement);
    const sp = st ? u.content.species.list[st.species] : undefined;
    if (sp) spN = { type: 'species', id: sp.id, text: sp.name.toLowerCase(), at: 0 };
  }
  const law = /\b(more|fewer|less) (children|babies|births|offspring)\b|\bfertil/.test(s) ? 'fertility'
    : /\blive\b.*\b(long|longer|shorter)\b|\b(longer|shorter) li(fe|ves)\b|\blifespan\b|\b(die|age) (young|sooner|later)\b/.test(s) ? 'lifespan'
      : /\b(faster|slower)\b/.test(s) && !verb(cx, s, 'faster') ? 'speed' : /\b(taller|bigger|smaller|shorter|giants?|tall|big|tiny|huge)\b/.test(s) ? 'size' : '';
  // "make the people taller", "let everyone live longer": every people living on this world
  if (!spN && law && mods.place?.settlement === undefined && p?.people && /\b(the people|people|everyone|everybody|all peoples|mortals|humans|men|folk|villagers|mankind|humanity)\b/.test(s) && !/\b(creature|animals?|beasts?|trees?|plants?|crops?)\b/.test(s)) {
    const kinds = [...new Set(p.people.settlements.filter((t) => t.fallen < 0).map((t) => t.species))].map((i) => u.content.species.list[i]).filter((d) => d);
    if (!kinds.length) return false;
    for (const d of kinds) lawOn(c, d.id, law);
    return true;
  }
  if (!spN) return false;
  const def = u.content.species.find(spN.id);
  if (!def || !law) return false;
  return lawOn(c, spN.id, law);
}

/** one law of one species changed by the words ("twice as long", "taller", "fewer children") */
function lawOn(c: Clause, spId: string, law: string): boolean {
  const { s, mods } = c;
  const def = c.cx.u.content.species.find(spId);
  if (!def) return false;
  const spN = { id: spId };
  const cur = Number((def as unknown as Record<string, number>)[law]);
  const down = /\b(fewer|less|shorter|slower|smaller|half|die young|die sooner|age sooner|tiny)\b/.test(s);
  const times = /\b(twice|double)\b/.test(s) ? 2 : /\b(thrice|triple|three times)\b/.test(s) ? 3 : /\bhalf\b/.test(s) ? 2 : /\b(ten times|tenfold)\b/.test(s) ? 10 : mods.nums[0] && /\btimes\b/.test(s) ? mods.nums[0] : 1.6;
  const k = down ? 1 / times : times;
  c.add({ k: 'set', path: `species.${spN.id}.${law}`, value: Math.round(cur * k * 1000) / 1000 }, `${def.name}: ${law} ×${Math.round(k * 100) / 100}`);
  return true;
}

/** things by noun: disasters, weathers, animals, peoples, plants, creatures, miracles, items, biomes, materials, buildings */
function intentNoun(c: Clause): boolean {
  const { s, cx, mods } = c;
  const { u, p, L } = cx;
  const createV = verb(cx, s, 'create');
  const noun = findNoun(u.content, p, s, ['disaster', 'weather', 'animal', 'species', 'plant', 'creature', 'miracle', 'biome', 'material', 'star', 'item', 'building']);
  if (noun) {
    const r = byNoun(cx, noun, s, mods, !!createV);
    if (r) { c.add(r[0], r[1]); return true; }
  }
  // an unknown living thing after a making verb is a new animal ("release unicorns")
  if (createV) {
    const obj = objectOf(cx, s, createV);
    const sing = obj ? singular(obj.split(' ').pop() ?? obj) : '';
    if (obj && (L.animalish.has(sing) || L.animalish.has(obj)) && !L.creatureWords.includes(obj) && !L.creatureWords.includes(sing) && plausibleNew(cx, obj)) {
      cx.made.add(slug(singular(obj)));
      c.add({ k: 'content.animal', name: singular(obj), ...(mods.qty ? { count: Math.round(mods.qty) } : {}) }, `a new animal: ${obj}`);
      return true;
    }
  }
  // a bare living thing nobody has seen ("unicorns!"): summoned
  if (!createV && /^[a-z' -]+$/.test(s) && s.split(' ').filter((w) => !L.stop.has(w)).length <= 2) {
    const ws = s.split(' ').filter((w) => !L.stop.has(w));
    const last = singular(ws[ws.length - 1] ?? '');
    if (last && L.animalish.has(last) && !L.creatureWords.includes(last) && !findNoun(u.content, p, s, ['animal', 'creature', 'species'])) {
      const name = ws.length > 1 ? `${ws[0]} ${last}` : last;
      if (plausibleNew(cx, name)) {
        cx.made.add(slug(name));
        c.add({ k: 'content.animal', name, ...(mods.qty ? { count: Math.round(mods.qty) } : {}) }, `a new animal: ${name}`);
        return true;
      }
    }
  }
  return false;
}

/** every power's synonyms (powers.json): a phrase of two words or more anywhere, or the clause itself */
function intentPowers(c: Clause): boolean {
  const pw = matchPower(c.cx, c.s);
  if (!pw || unfilled(c.cx, pw, c.s)) return false;
  const cmd: Command = { k: pw.command, ...JSON.parse(JSON.stringify(pw.params ?? {})) };
  fillFromClause(c.cx, pw, cmd, c.s, c.mods);
  fillTargets(c, cmd);
  c.add(cmd, pw.name);
  return true;
}

/** the last resort: an unknown noun after a making verb is new content — only a plausible new thing */
function intentInvent(c: Clause): boolean {
  const { s, cx, mods } = c;
  const { L } = cx;
  const createV = verb(cx, s, 'create');
  if (!createV || /\b(?:make|let) (?:it|them|everything|everyone|everybody|the world|us)\b/.test(s)) return false;
  const obj = objectOf(cx, s, createV);
  if (!obj || !plausibleNew(cx, obj)) return false;
  const sing = singular(obj.split(' ').pop() ?? obj);
  const id = slug(obj);
  cx.made.add(id);
  if ((L.animalish.has(sing) || L.animalish.has(obj)) && !L.creatureWords.includes(sing)) { c.add({ k: 'content.animal', name: singular(obj), ...(mods.qty ? { count: mods.qty } : {}) }, `a new animal: ${obj}`); return true; }
  if (isAbstract(L, obj)) { c.add({ k: 'content.idea', name: obj, effect: effectOf(L, obj), mult: 1.4 }, `invent the idea of ${obj}`); return true; }
  c.add({ k: 'content.item', name: obj, tags: tagsOf(L, obj) }, `invent ${obj}`);
  c.add({ k: 'settlement.introduce', item: id }, 'set it among them');
  return true;
}

/** "make the world a paradise", "an eden": health, plenty, clear skies everywhere */
function intentParadise(c: Clause): boolean {
  if (!/\b(paradise|eden|heaven on earth|garden of the gods|utopia|golden world)\b/.test(c.full)) return false;
  c.add({ k: 'life.heal', everywhere: true }, 'every sickness healed');
  c.add({ k: 'weather.clear', everywhere: true }, 'clear skies');
  c.add({ k: 'set', path: 'disasters.natural', value: 0 }, 'no more natural disasters');
  c.add({ k: 'miracle.food', radius: 2000 }, 'and plenty');
  return true;
}

/** "light", "let there be light" (said as "conjure light"): the day comes where the god looks */
function intentLight(c: Clause): boolean {
  const { s, cx } = c;
  if (!/^(conjure |make |bring |give us |more )?(light|daylight|the light|dawn)$/.test(c.full.trim())) return false;
  const at = placePos(c);
  c.add({ k: 'time.set-hour', hour: scaleHour(cx, 12), ...(at ? { at } : {}) }, 'and there was light: noon');
  return true;
}

/** gifts of food in plain words ("drop food on Aru", "feed Lune bread"); hearts everywhere; orders to all disciples */
function intentPlain(c: Clause): boolean {
  const { s, cx, mods, full } = c;
  const { u, p } = cx;
  const sid = mods.place?.settlement ?? (mods.place?.pos && p ? nearestSettlement(p, mods.place.pos, 1500)?.id : undefined);
  // food: their staple, or the food named
  if (/\b(drop|give|send|gift|offer|bring|rain|shower|pour|deliver|feed)\b/.test(s) && /\b(food|supplies|provisions|a feast|feast|plenty|something to eat)\b/.test(s) && sid !== undefined && p?.people) {
    const st = p.people.settlement(sid);
    if (st) {
      const staple = ['bread', 'grain', 'dried-meat', 'meat', 'fish', 'berries'].find((id) => u.content.items.find(id)) ?? u.content.items.list[0].id;
      c.add({ k: 'settlement.gift', settlement: sid, items: { [staple]: Math.round(mods.qty ?? 60) } }, `${staple} for ${st.name}`);
      return true;
    }
  }
  // hearts everywhere: "make everyone believe in me", "let the whole world love me"
  const believeV = verb(cx, s, 'believe') ?? (/\b(love|fear|worship|believe|adore|revere|trust|obey|convert|faith|pray)\b/.test(s) && /\b(me|my)\b/.test(s) ? 'x' : null);
  if (believeV && mods.place?.settlement === undefined && (mods.place?.everywhere || /\b(everyone|everybody|all|the world|every people|all peoples|every town|mankind|the people)\b/.test(full))) {
    const feeling = /\bfear\b|\bdread\b/.test(s) ? 'fear' : /\bconvert\b|\bmy faith\b/.test(s) ? 'convert' : /\bworship\b|\bpray\b|\brevere\b/.test(s) ? 'worship' : 'love';
    c.add({ k: 'belief.sway', feeling, everywhere: true }, `everyone: ${feeling}`);
    return true;
  }
  // orders to the god's disciples ("tell my disciples to farm", "send my disciple to preach in Lune")
  if (/\bdisciples?\b/.test(s) && (verb(cx, s, 'order') || /\b(go|should|must)\b/.test(s))) {
    const mode = DISCIPLE_MODES.find((m) => has(s, m) || has(s, m + 's') || has(s, m + 'ing') || (m === 'missionary' && has(s, 'convert', 'missionaries')) || (m === 'farm' && has(s, 'farming')) || (m === 'build' && has(s, 'building')));
    if (!mode) return c.ask('What should your disciples do? (worship, farm, build, teach, preach, or go as missionaries).');
    if (!u.god.disciples.some((d) => d.god === 0)) { cx.asked.push({ k: 'disciple.order', mode }); return c.ask('You have no disciples yet ("make Hesh a disciple").'); }
    c.add({ k: 'disciple.order', mode, ...(mods.place?.settlement !== undefined && mode === 'missionary' ? { target: mods.place.settlement } : {}) }, `your disciples: ${mode}`);
    mods.place = null;
    return true;
  }
  return false;
}

/** "found a city here", "build a village near Lune", "start a new settlement on the coast" */
function intentFound(c: Clause): boolean {
  const { s, cx, mods } = c;
  if (!/\b(found|build|start|establish|create|make|raise|plant|begin|set up)\b.*\b(a |an |new |another )?(city|town|village|settlement|colony|outpost|hamlet)\b/.test(s)) return false;
  if (mods.place?.settlement !== undefined && (!/\b(new|another|a|an)\b/.test(s) || (/^(make|turn|grow)\b/.test(s) && !/\b(new|another)\b/.test(s)))) return false;
  const sp = findNoun(cx.u.content, cx.p, s, ['species']);
  // near a named town: a little way off, not on top of it
  const st = mods.place?.settlement !== undefined && cx.p ? cx.p.people?.settlement(mods.place.settlement) : null;
  const pos = st && cx.p ? moveBy(st.pos, bearingDir(st.pos, 2.5), Math.max(700, st.territory + 400), cx.p.st.radius) : undefined;
  c.add({ k: 'settlement.found', ...(pos ? { pos } : {}), ...(sp ? { species: sp.id } : {}), count: mods.qty && mods.qty > 1 ? Math.min(2000, Math.round(mods.qty)) : 12 }, 'found a settlement');
  return true;
}

const INTENTS: ((c: Clause) => boolean)[] = [
  intentAsk, intentControl, intentShip, intentWorldNamed, intentSet, intentLetGo, intentForbid, intentWithdraw, intentExtinguish, intentLight, intentParadise, intentTime, intentDisaster, intentPlanetLaws, intentAir, intentSea,
  intentLand, intentPeaceWar, intentPerson, intentSpeciesLaw, intentPlain, intentFound, intentSettlement, intentSomeone, intentPossession, intentCreature, intentHand, intentRival, intentLaw,
  intentWorld, intentSky, intentIdeas, intentMiracle, intentDeath, intentLawNumber, intentNoun, intentPowers, intentInvent,
];

// ───────────────────────────── a clause that IS a power's name or synonym ─────────────────────────────

function phraseKey(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/^(please|now|o|oh)\s+/, '').replace(/^(the|a|an|some|my)\s+/, '').replace(/\s+(please|now|again)$/, '').replace(/\s+/g, ' ').trim();
}

const phraseIndex = new WeakMap<Content, Map<string, PowerDef[]>>();
function powersByPhrase(c: Content): Map<string, PowerDef[]> {
  let m = phraseIndex.get(c);
  if (m) return m;
  m = new Map();
  for (const pw of c.powers.list) {
    for (const t of [pw.name, ...pw.synonyms]) {
      const k = phraseKey(t);
      if (!k) continue;
      const l = m.get(k) ?? [];
      if (!l.includes(pw)) l.push(pw);
      m.set(k, l);
    }
  }
  phraseIndex.set(c, m);
  return m;
}

/** commands that carry out the same act by another route (a flood as water or as a disaster ...) */
const SAME_ACT: string[][] = [
  ['water.flood', 'disaster.spawn:flood'], ['water.tsunami', 'disaster.spawn:tsunami'], ['fire.firestorm', 'disaster.spawn:firestorm'],
  ['miracle.meteor', 'disaster.spawn:meteor'], ['miracle.forest', 'life.forest'], ['life.heal', 'miracle.heal', 'life.cure'],
  ['agent.silence', 'settlement.silence'], ['idea.teach', 'settlement.teach'], ['planet.atmosphere', 'planet.add-air', 'planet.remove-air'],
  ['hand.release', 'hand.drop', 'hand.throw'], ['life.plant', 'life.forest'], ['weather.clear', 'weather.global:clear'],
  ['water.rain', 'weather.paint:rain', 'weather.global:rain', 'weather.paint:monsoon', 'weather.paint:storm'],
];

function actKey(k: string, kind: unknown): string[] {
  return typeof kind === 'string' ? [`${k}:${kind}`, k] : [k];
}

/**
 * Does a resolved command carry out this power? Its own command with compatible defaults — or a declared equivalent:
 * the same kind by another command ("blizzard everywhere" is the blizzard power done planet-wide, a hurricane as
 * weather or as a disaster), or another route to the same act (SAME_ACT).
 */
export function powerEquivalent(reg: CommandRegistry, cmd: Command, pw: PowerDef): boolean {
  void reg;
  if (cmd.k === 'time.edit-past') return true;
  const pk = pw.params?.kind;
  if (cmd.k === pw.command) {
    for (const [k, v] of Object.entries(pw.params ?? {})) if (cmd[k] !== undefined && typeof v !== 'object' && cmd[k] !== v && k !== 'kind') return false;
    if (pk !== undefined && cmd.kind !== undefined && cmd.kind !== pk && cmd.kind !== 'random') return false;
    return true;
  }
  if (pk !== undefined && cmd.kind === pk) return true;
  const a = actKey(cmd.k, cmd.kind), b = actKey(pw.command, pk);
  return SAME_ACT.some((g) => a.some((x) => g.includes(x)) && b.some((x) => g.includes(x)));
}

/** the clause's words are exactly a power's name or synonym: that power is meant, whatever else matched first */
function synonymOverride(c: Clause): Command[] {
  const idx = powersByPhrase(c.cx.u.content);
  const byFull = idx.get(phraseKey(c.full));
  const pws = byFull ?? idx.get(phraseKey(c.s));
  if (!pws || !pws.length) return c.out;
  if (c.out.length && c.out.some((cmd) => pws.some((pw) => powerEquivalent(c.cx.reg, cmd, pw)))) return c.out;
  const pw = pws[0];
  const cmd: Command = { k: pw.command, ...JSON.parse(JSON.stringify(pw.params ?? {})) };
  fillFromClause(c.cx, pw, cmd, byFull ? c.full : c.s, c.mods);
  fillTargets(c, cmd);
  // understood, and answered with a reason it cannot be done ("a war needs two peoples"): that answer stands, and the
  // preview names the power it is about — unless the question was a keyword's inside a longer name that IS another
  // power ("salt wind" is a disaster a pack brought, not the wind asking where to blow from)
  const weak = c.cx.noteAbout !== undefined && c.cx.noteAbout !== pw.command;
  if (!c.out.length && c.cx.note && !weak) { c.cx.asked.push(cmd); return c.out; }
  // replace what the clause made with the power's own command (its defaults, the clause's place and modifiers)
  const n = c.out.length;
  c.out.length = 0;
  c.cx.why.splice(c.cx.why.length - n, n);
  c.cx.note = undefined;
  c.add(cmd, pw.name);
  return c.out;
}

/** targets a power's command needs that the clause implies: a person of a named settlement, the god's creature */
function fillTargets(c: Clause, cmd: Command): void {
  const { cx, mods } = c;
  const sc = cx.reg.schema(cmd.k)?.params ?? {};
  if (sc.id?.required && cmd.id === undefined && cmd.k.startsWith('agent.') && mods.place?.settlement !== undefined && cx.p?.people) {
    const who = pickPerson(cx, mods.place.settlement, c.s, cmd.k === 'agent.silence' ? 'silence' : cmd.k === 'agent.possess' ? 'possess' : 'other');
    if (who >= 0) cmd.id = who;
  }
  if ('settlement' in sc && sc.settlement.required && cmd.settlement === undefined && mods.place?.settlement !== undefined) cmd.settlement = mods.place.settlement;
  if ('other' in sc && cmd.other === undefined && mods.other?.settlement !== undefined) cmd.other = mods.other.settlement;
}

// ───────────────────────────── people and places the clause did not name ─────────────────────────────

/** pairs of settlements (one per side) of every war on the planet — or only those of one settlement */
function warPairs(cx: PCtx2, only?: number): [number, number][] {
  const ps = cx.p?.people;
  if (!ps || !cx.p) return [];
  const x = makeCtx(cx.u, cx.p);
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const live = ps.settlements.filter((st) => st.fallen < 0);
  for (const a of live) {
    if (only !== undefined && a.id !== only) continue;
    for (const b of live) {
      if (a.polity === b.polity || (only === undefined && b.id < a.id)) continue;
      const key = a.polity < b.polity ? `${a.polity}:${b.polity}` : `${b.polity}:${a.polity}`;
      if (seen.has(key)) continue;
      const r = relationOf(x, a.polity, b.polity);
      if (!r || r.war < 0) continue;
      seen.add(key);
      out.push([a.id, b.id]);
    }
  }
  return out;
}

/** the most populous standing settlement of the planet (lowest id on a tie) */
function largestSettlement(cx: PCtx2): { id: number; name: string } | null {
  const ps = cx.p?.people;
  if (!ps) return null;
  let best: { id: number; name: string } | null = null, bn = -1;
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const n = ps.members.get(st.id)?.length ?? 0;
    if (n > bn) { bn = n; best = st; }
  }
  return best;
}

/** the nearest standing settlement of another polity */
function nearestForeign(cx: PCtx2, sid: number): { id: number; name: string } | null {
  const ps = cx.p?.people;
  const p = cx.p;
  if (!ps || !p) return null;
  const st = ps.settlement(sid);
  if (!st) return null;
  let best: { id: number; name: string } | null = null, bd = Infinity;
  for (const o of ps.settlements) {
    if (o.fallen >= 0 || o.polity === st.polity) continue;
    const d = distM(p, o.pos, st.pos);
    if (d < bd || (d === bd && best && o.id < best.id)) { bd = d; best = o; }
  }
  return best;
}

/** words naming a kind of person -> the roles they mean */
const ROLE_WORDS: [RegExp, number[]][] = [
  [/\b(smith|crafter|craftsman|craftswoman|artisan|potter|weaver|maker)\b/, [ROLE.crafter]],
  [/\b(priest|priestess|shaman|holy|prophet)\b/, [ROLE.priest]],
  [/\b(teacher|elder|sage|wise|scholar|scribe)\b/, [ROLE.teacher, ROLE.scholar]],
  [/\b(chief|leader|king|queen|ruler|headman|elder)\b/, [ROLE.leader]],
  [/\b(hunter)\b/, [ROLE.hunter]], [/\b(farmer|peasant)\b/, [ROLE.farmer]], [/\b(fisher|fisherman)\b/, [ROLE.fisher]],
  [/\b(healer|doctor|herbalist)\b/, [ROLE.healer]], [/\b(builder|mason)\b/, [ROLE.builder]], [/\b(trader|merchant)\b/, [ROLE.trader]],
  [/\b(soldier|warrior|guard)\b/, [ROLE.soldier]], [/\b(herder|shepherd)\b/, [ROLE.herder]], [/\b(sailor)\b/, [ROLE.sailor]],
];

/**
 * a person of a settlement the clause means but did not name: one of the role it names ("the smith", "the chief" — the
 * leader by office); to silence, the one who spreads the most (priest, teacher, scholar); else the chief; else the
 * eldest grown member. -1 none.
 */
function pickPerson(cx: PCtx2, sid: number, s: string, want: string): number {
  const p = cx.p;
  if (!p?.people) return -1;
  const x = makeCtx(cx.u, p);
  const A = x.A;
  const st = x.ps.settlement(sid);
  const members = (x.ps.members.get(sid) ?? []).filter((m) => A.alive[m] && A.role[m] !== ROLE.child && !cx.u.god.isHeld('agent', A.id[m]));
  if (!st || !members.length) return -1;
  const lead = A.slotOf(st.leader);
  if (/\b(chief|leader|king|queen|ruler|headman)\b/.test(s) && lead >= 0 && members.includes(lead)) return st.leader;
  const byRole = (roles: number[]): number => {
    let best = -1;
    for (const m of members) if (roles.includes(A.role[m]) && (best < 0 || A.birth[m] < A.birth[best] || (A.birth[m] === A.birth[best] && A.id[m] < A.id[best]))) best = m;
    return best;
  };
  for (const [re, roles] of ROLE_WORDS) if (re.test(s)) { const m = byRole(roles); if (m >= 0) return A.id[m]; }
  if (want === 'silence') { const m = byRole([ROLE.priest, ROLE.teacher, ROLE.scholar]); if (m >= 0) return A.id[m]; }
  if (lead >= 0 && members.includes(lead) && want !== 'possess') return st.leader;
  let eldest = members[0];
  for (const m of members) if (A.birth[m] < A.birth[eldest] || (A.birth[m] === A.birth[eldest] && A.id[m] < A.id[eldest])) eldest = m;
  return A.id[eldest];
}

/** the object noun phrase after a verb (stopwords dropped; up to three words) */
function objectOf(cx: PCtx2, s: string, v: string): string | null {
  const at = wordAt(s, v);
  if (at < 0) return null;
  const words = s.slice(at + v.length).trim().split(' ').filter((w) => w && !cx.L.stop.has(w) && !/^-?\d/.test(w) && !/^(to|the|a|an|of|for|them|us|people|me|my|i)$/.test(w));
  if (!words.length) return null;
  return words.slice(0, 3).join(' ');
}

function isAbstract(L: Lex, noun: string): boolean {
  if (L.abstract.has(noun)) return true;
  if (/(ism|ology|ics|ship|hood|ity|ness|ation|ence|ance|craft|lore|pathy|sophy|nomy|graphy)$/.test(noun)) return true;
  for (const words of Object.values(L.effects)) if (words.includes(noun)) return true;
  return false;
}

function effectOf(L: Lex, noun: string): string {
  for (const [k, words] of Object.entries(L.effects)) if (words.some((w) => noun.includes(w))) return k;
  if (/heal|cure|medic/.test(noun)) return 'mortality';
  if (/war|fight|weapon/.test(noun)) return 'war';
  if (/trade|money|market/.test(noun)) return 'trade';
  if (/god|faith|spirit|pray|worship/.test(noun)) return 'faith';
  return 'teach';
}

function tagsOf(L: Lex, noun: string): string[] {
  const out: string[] = [];
  const words = noun.split(' ').map(singular);
  for (const [tag, list] of Object.entries(L.tags)) if (words.some((w) => list.includes(w)) || list.some((w) => noun.includes(w))) out.push(tag);
  return out.length ? out.sort() : ['material'];
}

/** a command for a known noun (with or without a verb of making); null when the noun alone does not say what to do */
function byNoun(cx: PCtx2, n: Found, s: string, mods: Mods, making: boolean): [Command, string] | null {
  const { u, p } = cx;
  switch (n.type) {
    case 'disaster': {
      // a weather named everywhere is the planet-wide weather ("acid rain everywhere")
      const w = mods.place?.everywhere ? findNoun(u.content, p, s, ['weather']) : null;
      if (w && w.text.length >= n.text.length) return [{ k: 'weather.global', kind: w.id }, `${w.id} everywhere`];
      const cmd: Command = { k: 'disaster.spawn', kind: n.id };
      // "a tornado toward Aru": it forms out on the land and comes at them
      if (mods.toward?.pos && cx.p && (u.content.disasters.get(n.id).speed ?? 0) > 0) {
        const t = mods.toward.pos;
        cmd.pos = moveBy(t, bearingDir(t, 2.1), 900, cx.p.st.radius);
        cmd.toward = t;
      }
      return [cmd, u.content.disasters.get(n.id).name];
    }
    case 'weather':
      // "cover Aru in snow", "lay snow here": the ground is laid (the material of the same word)
      if (has(s, 'lay', 'cover', 'covered', 'blanket', 'bury', 'layer', 'pile', 'drifts') && findNoun(u.content, p, s, ['material'])?.text === n.text) {
        const m = findNoun(u.content, p, s, ['material'])!;
        return [{ k: 'terrain.paint-material', material: m.id, depth: m.id === 'ice' ? 1 : 0.5 }, `lay ${m.id}`];
      }
      return mods.place?.everywhere ? [{ k: 'weather.global', kind: n.id }, `${n.id} everywhere`] : [{ k: 'weather.paint', kind: n.id, pinned: has(s, 'stay', 'keep', 'pin', 'forever', 'always') }, n.id];
    case 'animal': {
      // "make every tree bear fruit": a verb that looks like an animal is not one
      if (n.id === 'bear' && /\b(trees?|branches|fruit)\b/.test(s)) return null;
      if (/\b(friendly|tame|gentle|docile)\b/.test(s)) return [{ k: 'life.tame', species: n.id }, `tame the ${n.text}`];
      return [{ k: 'life.spawn-animal', species: n.id, ...(mods.qty ? { count: Math.round(mods.qty) } : {}) }, `animals: ${n.id}`];
    }
    case 'species': return [{ k: 'life.spawn-people', species: n.id, ...(mods.qty ? { count: Math.max(1, Math.round(mods.qty)) } : {}) }, `people: ${n.id}`];
    case 'plant': {
      const pl = u.content.plants.find(n.id);
      if (pl?.type === 'tree' && has(s, 'forest', 'woods', 'grove')) return [{ k: 'life.forest', species: n.id }, `forest of ${n.id}`];
      return [{ k: 'life.plant', species: n.id }, `plant ${n.id}`];
    }
    case 'creature': return making || has(s, 'adopt', 'creature') ? [{ k: 'creature.adopt', template: n.id }, `adopt a ${n.id}`] : null;
    case 'miracle': return [{ k: `miracle.${n.id}` }, `${n.id} miracle`];
    case 'biome': {
      // a biome undone is not a biome painted: "make the desert bloom", "melt the ice", "make the ocean boil"
      if (/\b(bloom|melt|boil|drain|dry up|green|vanish|recede|shrink|retreat)\b/.test(s)) return null;
      return [{ k: 'life.paint-biome', biome: n.id, pinned: has(s, 'stay', 'keep', 'pin', 'forever', 'always') }, `make it ${n.id}`];
    }
    case 'material': {
      if (n.id === 'ash' && /\b(fall|falls|falling|rain)\b/.test(s)) return [{ k: mods.place?.everywhere ? 'weather.global' : 'weather.paint', kind: 'ashfall' }, 'ash falls'];
      if (/\b(melt|thaw)\b/.test(s)) return null;
      if (/\bfertile\b/.test(s)) return [{ k: 'miracle.fertility' }, 'fertile ground'];
      // "snow on Aru", "snow everywhere": the weather falls; "cover Aru in snow", "lay snow": the ground is laid
      if (!has(s, 'lay', 'pour', 'cover', 'covered', 'spread', 'bury', 'blanket', 'layer', 'deep', 'drift', 'drifts', 'pile')) {
        const w = findNoun(u.content, p, s, ['weather']);
        if (w && w.text.length >= n.text.length) return mods.place?.everywhere ? [{ k: 'weather.global', kind: w.id }, `${w.id} everywhere`] : [{ k: 'weather.paint', kind: w.id, pinned: has(s, 'stay', 'keep', 'pin', 'forever', 'always') }, w.id];
      }
      return n.id === 'lava' || making || has(s, 'lay', 'pour', 'cover', 'spread', 'bury', 'freeze') ? [{ k: 'terrain.paint-material', material: n.id, depth: n.id === 'lava' ? 3 : n.id === 'ice' ? 1 : 0.5 }, `lay ${n.id}`] : null;
    }
    case 'star': return has(s, 'star', 'sun', 'becomes', 'become', 'turn') ? [{ k: 'star.set', kind: n.id }, `the star becomes a ${n.text}`] : null;
    case 'building': {
      const st = cx.p && mods.place?.pos ? nearestSettlement(cx.p, mods.place.pos, 1500) : null;
      if ((making || has(s, 'build', 'raise', 'erect')) && (st || mods.place?.settlement !== undefined)) return [{ k: 'settlement.build', type: n.id, ...(st && mods.place?.settlement === undefined ? { settlement: st.id } : {}) }, `a ${n.text}`];
      return null;
    }
    case 'item': {
      if (!making && !has(s, 'give', 'gift', 'drop', 'send', 'offer', 'bring')) return null;
      const st = cx.p && mods.place?.pos ? nearestSettlement(cx.p, mods.place.pos, 1500) : null;
      const qty = Math.round(mods.qty ?? (mods.one ? 1 : 10));
      if (st || mods.place?.settlement !== undefined) return [{ k: 'settlement.gift', items: { [n.id]: qty } }, `give ${n.id}`];
      return [{ k: 'hand.grab', item: n.id, qty }, `${n.id} into the hand`];
    }
    default: return null;
  }
}

/** the power whose longest synonym of two words or more (or name) appears in the clause */
function matchPower(cx: PCtx2, s: string): PowerDef | null {
  let best: PowerDef | null = null, bl = 0;
  for (const pw of cx.u.content.powers.list) {
    for (const syn of [pw.name.toLowerCase(), ...pw.synonyms]) {
      const t = syn.toLowerCase();
      if (t.length <= bl || (!t.includes(' ') && t !== s.trim())) continue;
      if (wordAt(s, t) >= 0) { best = pw; bl = t.length; }
    }
  }
  return best;
}

/** a power whose required choice (a species, a kind ...) the clause does not name: not this power */
function unfilled(cx: PCtx2, pw: PowerDef, s: string): boolean {
  const sch = cx.reg.schema(pw.command)?.params ?? {};
  for (const [k, ps] of Object.entries(sch)) {
    if (!ps.required || ps.default !== undefined || pw.params?.[k] !== undefined) continue;
    if (ps.type !== 'enum' || typeof ps.values !== 'function') continue;
    const probe: Command = { k: pw.command };
    fillFromClause(cx, pw, probe, s, { place: null, nums: [] });
    if (probe[k] === undefined) return true;
  }
  return false;
}

/** fill a power's parameters from the clause: enums by the nouns in it, the first number into its main number */
function fillFromClause(cx: PCtx2, pw: PowerDef, cmd: Command, s: string, mods: Mods): void {
  const c = cx.u.content;
  const sch = cx.reg.schema(pw.command)?.params ?? {};
  for (const [k, ps] of Object.entries(pw.schema ?? {})) {
    if (cmd[k] !== undefined) continue;
    if (ps.type === 'enum') {
      if (typeof ps.values === 'string') {
        const reg = (c as unknown as Record<string, { list: { id: string; name: string }[] }>)[ps.values];
        if (!reg?.list) continue;
        let best: { id: string; len: number } | null = null;
        for (const x of reg.list) for (const t of [x.id.replace(/-/g, ' '), x.name.toLowerCase(), plural(x.name.toLowerCase())]) {
          if (t.length < 2 || (ps.values === 'stars' && t.length < 3)) continue;
          if (wordAt(s, t) >= 0 && (!best || t.length > best.len)) best = { id: x.id, len: t.length };
        }
        if (best) cmd[k] = best.id;
      } else if (Array.isArray(ps.values)) {
        const hit = ps.values.find((v) => wordAt(s, String(v).toLowerCase()) >= 0);
        if (hit) cmd[k] = hit;
      }
    }
  }
  // the first number goes to the power's main numeric parameter (not radius / duration, which modifiers set)
  if (mods.nums.length) {
    const main = Object.entries(pw.schema ?? {}).find(([k, ps]) => (ps.type === 'number' || ps.type === 'int') && !['radius', 'duration', 'intensity', 'power', 'count', 'qty', 'scale', 'speed', 'angle'].includes(k) && cmd[k] === undefined);
    if (main) cmd[main[0]] = clampTo(mods.nums[0], sch[main[0]]);
  }
  // required params with no value: a sensible default from the registry
  for (const [k, ps] of Object.entries(sch)) if (ps.required && cmd[k] === undefined && ps.type === 'enum' && typeof ps.values !== 'function' && ps.values?.length) cmd[k] = ps.values[0];
}

export { singular as singularOf };
