// GENESIS — free text for the people and their god (LIVING.md §5.3, the RELATIONSHIP phrases; god/freeform.ts calls
// intentSigns before its own intents and signsWrath on what every clause resolved to):
//
//   "make Hesh my prophet", "make a prophet in Aru"                         prophet.call
//   "tell Aru through Hesh that rain will come in two days"                 prophet.foretell { what: rain, days: 2 }
//   "abandon the prophet Hesh"                                              prophet.abandon
//   "make Hesh one of the Called", "call Hesh to me"                        agent.make-disciple (the Called)
//   "warn Aru of the coming fire", "an eclipse over Aru"                    god.omen
//   "make deer sacred in Aru"                                               settlement.sacred { animal: deer }
//   "make the spring near Aru a holy place", "hallow the grove by Lune"     place.sacred
//   "what does Lune pray for?"                                              answered from the world (prayers)
//   "be gentle with them" / "be terrible"                                   set god.wrath 0.1 / 0.8
//   size words on a cast (god/wrath.ts wrathWords): "an apocalyptic earthquake" wrath 1 and no warning, "a small
//   tornado" a smaller disaster (scale) at wrath 0.1, "a huge meteor" 0.85
//
// The parser's own types are module-private: these functions see a clause through the structural `SignClause`.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { V3 } from './state.ts';
import { makeCtx } from '../people/ctx.ts';
import { AgentFlag } from '../types.ts';
import { NT, TRAIT } from '../people/defs.ts';
import { distM } from '../people/world.ts';
import { prayersOf, PRAYER_WORDS } from './prayers.ts';
import { prophetOf } from './prophets.ts';
import { wrathWords, WRATHFUL } from './wrath.ts';
import { bearingDir, moveBy } from './util.ts';
import { DISCIPLE_MODES } from './disciples.ts';

interface LiveName { name: string; kind: string; id: number; planet: number; pos?: V3 }

/** the parts of a parser clause these intents read (god/freeform.ts Clause, structurally) */
export interface SignClause {
  cx: { u: Universe; p: Planet | undefined; live: LiveName[]; raw: string; answered?: boolean; asked: Command[]; L: { numbers: Record<string, number> } };
  s: string;
  full: string;
  mods: { place: { pos?: V3; planet?: number; settlement?: number; label: string } | null; size?: number; intensity?: number; duration?: number; nums: number[] };
  out: Command[];
  add(cmd: Command, label?: string): void;
  ask(msg: string, about?: string): boolean;
}

function wordAt(s: string, phrase: string): number {
  let i = s.indexOf(phrase);
  while (i >= 0) {
    const before = i === 0 || !/[a-z0-9]/.test(s[i - 1]);
    const after = i + phrase.length >= s.length || !/[a-z0-9]/.test(s[i + phrase.length]);
    if (before && after) return i;
    i = s.indexOf(phrase, i + 1);
  }
  return -1;
}

const has = (s: string, ...w: string[]): boolean => w.some((x) => wordAt(s, x) >= 0);

/** the first live name of these kinds written in s */
function live(c: SignClause, s: string, kinds: string[]): LiveName | null {
  let best: LiveName | null = null, at = Infinity;
  for (const l of c.cx.live) {
    if (!kinds.includes(l.kind)) continue;
    const i = wordAt(s, l.name);
    if (i >= 0 && (i < at || (i === at && best && l.name.length > best.name.length))) { at = i; best = l; }
  }
  return best;
}

/** a grown, pious person of a settlement to speak for the god (the most pious, the eldest on ties) */
function pickProphet(u: Universe, p: Planet, sid: number): number {
  if (!p.people) return -1;
  const x = makeCtx(u, p);
  const A = x.A;
  let best = -1, bv = -1;
  for (const s of x.ps.members.get(sid) ?? []) {
    if (A.flags[s] & AgentFlag.child || (x.tick - A.birth[s]) / x.year < 16) continue;
    const v = A.traits[s * NT + TRAIT.piety];
    if (v > bv || (v === bv && A.id[s] < A.id[best])) { bv = v; best = s; }
  }
  return best >= 0 ? A.id[best] : -1;
}

const WHAT: [RegExp, string][] = [
  [/\b(rain|rains|storm|storms|water|showers?)\b/, 'rain'],
  [/\b(food|plenty|harvest|bread|feast|full stores?)\b/, 'food'],
  [/\b(heal|healing|mend|mending|cure|cured|the sick|plague (?:will )?end)\b/, 'healing'],
  [/\b(warmth|warm|fire for|the cold will break)\b/, 'warmth'],
  [/\b(protection|protect|safe|safety|ward|shield|spared)\b/, 'protection'],
  [/\b(rebuild|rebuilding|timber|new houses)\b/, 'rebuilding'],
  [/\b(sign|signs|wonder|omen|eclipse|comet|rainbow)\b/, 'sign'],
  [/\b(anger|wrath|punish|punishment|doom|disaster|ruin|fire from the sky|destroy|destruction|death|harm|suffer)\b/, 'harm'],
];

/** "in two days", "within 3 days", "tomorrow" (1 day): 1..5, default 2 */
function daysOf(c: SignClause): number {
  const m = c.full.match(/\b(?:in|within|before)\s+(\w+)\s+days?\b/);
  if (m) {
    const n = /^\d+(\.\d+)?$/.test(m[1]) ? parseFloat(m[1]) : c.cx.L.numbers[m[1]];
    if (typeof n === 'number' && n > 0) return Math.max(1, Math.min(5, n));
  }
  if (/\b(tomorrow|a day|one day)\b/.test(c.full)) return 1;
  if (c.mods.duration && c.cx.p) return Math.max(1, Math.min(5, Math.round(c.mods.duration / Math.max(60, Math.round(c.cx.p.st.dayHours * 60)))));
  return 2;
}

/** the standing order named in s ("preach", "farming", "as missionaries"), as god/freeform.ts reads it for the old words */
function calledMode(s: string): (typeof DISCIPLE_MODES)[number] | undefined {
  return DISCIPLE_MODES.find((m) => has(s, m) || has(s, m + 's') || has(s, m + 'ing') || (m === 'missionary' && has(s, 'convert', 'missionaries')) || (m === 'farm' && has(s, 'farming')) || (m === 'build' && has(s, 'building')));
}

/** a real animal named in s (content animals, by name or id, singular or plural) */
function animalIn(u: Universe, s: string): string | null {
  let best: string | null = null, bl = 0;
  for (const a of u.content.animals.list) {
    for (const t of [a.id.replace(/-/g, ' '), a.name.toLowerCase(), `${a.name.toLowerCase()}s`, `${a.id.replace(/-/g, ' ')}s`]) {
      if (t.length > bl && wordAt(s, t) >= 0) { best = a.id; bl = t.length; }
    }
  }
  return best;
}

/** the RELATIONSHIP intents (true: the clause is handled) */
export function intentSigns(c: SignClause): boolean {
  const { cx, full, mods } = c;
  const { u, p } = cx;
  const f = full;
  // ── wrath as a disposition: "be gentle with them", "be terrible" ──
  if (/\b(be|go) (gentle|merciful|kind|soft|lenient|mild|easy)\b|\bgo easy on\b|\bspare them\b/.test(f) && !/\b(rain|storm|wind|breeze)\b/.test(f)) {
    c.add({ k: 'set', path: 'god.wrath', value: 0.1 }, 'wrath: gentle');
    return true;
  }
  if (/\bbe (terrible|wrathful|harsh|merciless|cruel|severe|fearsome)\b/.test(f)) {
    c.add({ k: 'set', path: 'god.wrath', value: 0.8 }, 'wrath: severe');
    return true;
  }
  if (/\b(unleash|show|loose) (all )?(my|your|the god's) (full )?wrath\b|\bfull wrath\b/.test(f) && !/\bon\b/.test(f)) {
    c.add({ k: 'set', path: 'god.wrath', value: 1 }, 'wrath: total');
    return true;
  }
  // ── prayers, asked about ──
  if (/\b(pray|prays|praying|prayers?)\b/.test(f) && (/^(what|does|do|is|are|who|why|how)\b/.test(f) || /\?/.test(cx.raw))) {
    const st = mods.place?.settlement !== undefined ? p?.people?.settlement(mods.place.settlement) : undefined;
    const lists = p ? prayersOf(u, p) : [];
    const mine = st ? lists.filter((q) => q.settlement === st.id) : lists;
    const words = mine.map((q) => `${q.name} prays for ${q.prayers.map((r) => PRAYER_WORDS[r.kind] ?? r.kind).join(' and ')}`);
    cx.answered = true;
    return c.ask(words.length ? `${words.join('; ')}. ("answer the prayers of ${mine[0].name}")` : `${st ? st.name : 'Nobody'} prays for nothing now.`);
  }
  if (!p) return false;
  const person = live(c, f, ['agent']);
  // ── abandon a prophet ──
  if (/\b(abandon|forsake|disown|reject|turn (?:away )?from)\b/.test(f) && (has(f, 'prophet') || (person && prophetOf(u, p.id, person.id)))) {
    // (a person named: the command says so when they are not the god's prophet)
    const agent = person ? person.id : u.god.rel?.prophets.find((q) => q.planet === p.id && (mods.place?.settlement === undefined || q.settlement === mods.place.settlement))?.agent;
    if (agent === undefined) { cx.asked.push({ k: 'prophet.abandon' }); return c.ask('Abandon which prophet? Name them ("abandon the prophet Hesh").'); }
    c.add({ k: 'prophet.abandon', agent, planet: person?.planet ?? p.id }, 'abandon the prophet');
    return true;
  }
  // ── speak through a prophet: "tell Aru through Hesh that rain will come in two days" ──
  const through = f.match(/\bthrough\s+([a-z' -]+?)(?:,|\s+that\b|\s+of\b|\s+the\b|\s+rain\b|$)/);
  if ((through && /\b(tell|warn|promise|say|speak|announce|foretell|prophesy)\b/.test(f)) || (person && /\b(foretell|prophesy|predict)\b/.test(f))) {
    const who = through ? live(c, through[1], ['agent']) ?? person : person;
    if (!who) return c.ask('Through whom? Name your prophet ("tell Aru through Hesh that rain will come in two days").');
    const tail = (f.match(/\bthat\s+(.+)$/)?.[1] ?? f).replace(/\bthrough\s+[a-z' -]+/, '');
    const what = WHAT.find(([re]) => re.test(tail))?.[1];
    if (!what) return c.ask('Foretell what? (rain, food, healing, warmth, protection, rebuilding, a sign, or harm).');
    c.add({ k: 'prophet.foretell', agent: who.id, what, days: daysOf(c), planet: who.planet }, `foretell ${what}`);
    return true;
  }
  // ── orders to the Called: "charge the Called to preach", "order my called to farm", "the Called: build" (no person named;
  //    the old words, "tell my disciples to farm", are freeform.ts's) ──
  const mode = calledMode(f);
  if (!person && /\b(the|my|your) called\b/.test(f) && !/\bone of the called\b/.test(f) && (mode || /\b(charge|order|command|tell|bid|send|instruct|have|set)\b/.test(f))) {
    if (!mode) return c.ask('Charge the Called to do what? (worship, farm, build, teach, preach, or go as missionaries).');
    if (!u.god.disciples.some((d) => d.god === 0)) { cx.asked.push({ k: 'disciple.order', mode }); return c.ask('None are Called yet ("make Hesh one of the Called").'); }
    c.add({ k: 'disciple.order', mode, ...(mods.place?.settlement !== undefined && mode === 'missionary' ? { target: mods.place.settlement } : {}) }, `the Called: ${mode}`);
    mods.place = null;
    return true;
  }
  // ── the Called: "make Hesh one of the Called", "call Hesh to me", "call Hesh" (the name alone: "call Aru Lune" renames) ──
  if (/\bone of the called\b|\bthe called\b/.test(f) || (person && (/\bcall\s+[a-z' -]+\s+to\s+(me|my service|the god|serve)\b/.test(f) || f.trim() === `call ${person.name.toLowerCase()}`))) {
    if (!person) { cx.asked.push({ k: 'agent.make-disciple' }); return c.ask('Call whom? Name a person ("make Hesh one of the Called").'); }
    c.add({ k: 'agent.make-disciple', id: person.id, mode: mode ?? 'preach', planet: person.planet }, 'one of the Called');
    return true;
  }
  // ── a prophet: "make Hesh my prophet", "make a prophet in Aru" ──
  if (/\bprophets?\b|\bseer\b|\bspeak through\b/.test(f) && /\b(make|anoint|choose|name|call|raise|mark|appoint|let)\b/.test(f) && !/\bfalse prophet\b/.test(f)) {
    let id = person?.id ?? -1;
    if (id < 0 && mods.place?.settlement !== undefined) id = pickProphet(u, p, mods.place.settlement);
    if (id < 0) { cx.asked.push({ k: 'prophet.call' }); return c.ask('Who should be your prophet? Name a grown person ("make Hesh my prophet") or click one.'); }
    c.add({ k: 'prophet.call', agent: id, planet: person?.planet ?? p.id }, 'a prophet');
    return true;
  }
  // ── sacred animals: "make deer sacred in Aru", "the wolves are holy to Lune" ──
  if (/\b(sacred|holy|revered|taboo)\b/.test(f) && !/\b(place|site|ground|spring|grove|mountain|peak|hill)\b/.test(f)) {
    const animal = animalIn(u, c.s) ?? animalIn(u, f);
    if (animal) {
      if (mods.place?.settlement === undefined) return c.ask(`Sacred to whom? Name a town ("make the ${animal.replace(/-/g, ' ')} sacred in Aru").`);
      c.add({ k: 'settlement.sacred', settlement: mods.place.settlement, animal, planet: p.id }, `sacred ${animal}`);
      return true;
    }
  }
  // ── sacred places: "make the spring near Aru a holy place", "hallow the grove by Lune" ──
  if ((/\b(holy|sacred)\b/.test(f) && /\b(place|site|ground|spring|grove|mountain|peak|hill|shrine)\b/.test(f) && /\b(make|declare|turn|let)\b/.test(f)) || /\b(hallow|consecrate|sanctify)\b/.test(f)) {
    const kind = /\bspring\b/.test(f) ? 'spring' : /\b(grove|wood|trees?)\b/.test(f) ? 'grove' : /\b(mountain|peak|hill)\b/.test(f) ? 'mountain' : undefined;
    let pos = mods.place?.pos;
    if (pos && mods.place?.settlement !== undefined) {
      // "near Aru": a little way out of the town, not on its hearth
      const st = p.people?.settlement(mods.place.settlement);
      if (st && distM(p, pos, st.pos) < 50) pos = moveBy(st.pos, bearingDir(st.pos, 1.3), st.territory + 150, p.st.radius);
    }
    if (!pos) return c.ask('Hallow where? Point at a spring, a grove, a peak ("make the spring near Aru a holy place").');
    c.add({ k: 'place.sacred', pos, ...(kind ? { kind } : {}), planet: p.id }, 'a holy place');
    return true;
  }
  // ── omens: "warn Aru of the coming fire", "an eclipse over Aru" ──
  if (/\bwarn\b/.test(f) && mods.place?.settlement !== undefined && !/\bthrough\b/.test(f)) {
    c.add({ k: 'god.omen', settlement: mods.place.settlement, planet: p.id }, 'a sign of warning');
    return true;
  }
  if (/\beclipse\b/.test(f) && !/\b(year|long|year-long|endless|forever)\b/.test(f)) {
    c.add({ k: 'god.omen', kind: 'eclipse', ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : mods.place?.pos ? { pos: mods.place.pos } : {}), planet: p.id }, 'the sun darkens (an omen)');
    return true;
  }
  if (/\bcomet\b/.test(f) && /\b(sky|pass|passing|passes|omen|sign|portent|show)\b/.test(f) && !/\b(strike|hit|crash|fall on|at)\b/.test(f)) {
    c.add({ k: 'god.omen', kind: 'comet', ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : {}), planet: p.id }, 'a comet passes (an omen)');
    return true;
  }
  return false;
}

/**
 * Size words on a harmful cast set its wrath (LIVING §3.7): gentle / small 0.1, great / big 0.6, huge 0.85, apocalyptic /
 * total / armageddon 1.0 (and no warning); a small disaster is a smaller one (scale) as well as a narrower one.
 */
export function signsWrath(cmds: Command[], full: string, size?: number): void {
  const w = wrathWords(full);
  for (const cmd of cmds) {
    if (!WRATHFUL.includes(cmd.k) || cmd.wrath !== undefined) continue;
    if (w !== undefined) cmd.wrath = w;
    if (cmd.k === 'disaster.spawn') {
      if (w === 1 && cmd.warning === undefined) cmd.warning = 0;
      if (size !== undefined && size < 1 && cmd.scale === undefined) cmd.scale = Math.max(0.1, size);
    }
  }
}
