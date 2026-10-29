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
  cx: { u: Universe; p: Planet | undefined; live: LiveName[]; raw: string; answered?: boolean; asked: Command[]; L: { numbers: Record<string, number> }; addressee?: LiveName };
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

// (fix r3 #8) a named disaster foretold is harm (LIVING §3.4.3: any harmful act fulfils it) — the storm too, unless rain is
// named; "the drought will end", "the plague will pass" are relief, read by WHAT below
const DOOM = /\b(floods?|flooding|(?:the )?waters? (?:will )?rise|earthquakes?|quakes?|the (?:earth|ground) (?:will )?(?:shake|tremble|split|open)|plagues?|sickness|pestilence|locusts?|swarms?|meteors?|stars? (?:will )?fall|falling stars?|droughts?|famine|hunger|fires?(?! for)|wildfires?|storms?|tornado(?:e?s)?|hurricanes?|whirlwinds?|volcano(?:e?s)?|eruptions?|the mountain (?:will )?burn|wolves|tsunami|tidal wave|blight|hail)\b/;
const RAIN_WORD = /\b(rain|rains|showers?|drizzle)\b/;
// (fix r4 #0) a danger ending is its relief ("the flood will end" protection, "the plague will pass" healing), the danger
//    the subject of the ending verb; "break" only at the end ("the drought will break", not "the flood will break the dam")
const RELIEF = /\b(end|ends|pass|passes|lift|lifts|be over|is over|cease|ceases|abate|abates|recede|recedes|subside|subsides|stop|stops)\b|\bbreaks?\s*$/;
const RELIEF_OF: [RegExp, string][] = [
  [/\bdroughts?\b/, 'rain'], [/\b(famine|hunger|locusts?|swarms?|blight)\b/, 'food'], [/\b(plagues?|sickness|pestilence)\b/, 'healing'],
];
// (fix r4 #0) a benefit promised against the danger is that benefit, never harm: "the god will protect them from the flood",
//    "they will be spared from the plague", "the sickness will be healed", "their fires will burn warm" (verbs and
//    constructions only: "the famine will take their harvest", "the plague will kill the sick" stay harm)
const BENEFIT: [RegExp, string][] = [
  [/\b(heal|heals|healed|healing|cure|cures|cured|mend|mends|mended)\b/, 'healing'],
  [/\b(protect|protects|protected|protection|shield|shields|shielded|guard|guards|guarded|spare|spares|spared|save|saves|saved|safe|safety|ward off|wards off)\b/, 'protection'],
  [/\b(rebuild|rebuilds|rebuilt|rebuilding|new houses|houses (?:will |shall )?rise)\b/, 'rebuilding'],
  [/\b(burn warm|burns warm|warmth|keep (?:them |you |the town )?warm|fires? for)\b/, 'warmth'],
];
const NOBODY = /\b(nothing|no one|noone|nobody|none|not|never|cannot|can't|cant|won't|wont)\b/;
function whatOf(tail: string): string | undefined {
  if (DOOM.test(tail) && !RAIN_WORD.test(tail)) {
    if (!NOBODY.test(tail)) {
      const b = BENEFIT.find(([re]) => re.test(tail));
      if (b) return b[1];
      // "food will come against the famine": what comes before the danger it answers
      const before = tail.match(/^(.*?)\b(?:from|against|after|despite|in spite of)\b/)?.[1];
      const w = before ? WHAT.find(([re]) => re.test(before))?.[1] : undefined;
      if (w && w !== 'harm' && w !== 'sign') return w;
      if (RELIEF.test(tail)) return RELIEF_OF.find(([re]) => re.test(tail))?.[1] ?? 'protection';
    }
    return 'harm';
  }
  return WHAT.find(([re]) => re.test(tail))?.[1];
}

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
  // (fix r3 #14) ── "grant Aru's prayer", "answer the prayers of Lune", "hear Aru's plea": prayer.answer (was a law) ──
  // (fix r4 #2) only when no act is named: "answer Aru's prayers with a flood", "send rain to answer Aru's prayer" are that
  //    act (a wrathful answer stays wrathful); "hear Aru's prayers and send a plague" is the plague alone
  const ACT_NAMED = (t: string) => /\bwith\s+(?:an?\s+|the\s+|some\s+|my\s+|your\s+)?(?!mercy\b|kindness\b|love\b|grace\b|joy\b|care\b|pity\b|compassion\b|favou?r\b)[a-z]+/.test(t)
    || /\b(send|sends|sending|strike|smite|cast|unleash|drop|hurl|bring down|rain down)\b/.test(t);
  if (/\b(grant|answer|hear|fulfil|fulfill)\b/.test(f) && /\b(prayers?|pleas?)\b/.test(f) && !/\b(not|never|don't|refuse|ignore|deny)\b/.test(f) && ACT_NAMED(cx.raw.toLowerCase()) && !ACT_NAMED(f)) return true;
  if (/\b(grant|answer|hear|fulfil|fulfill)\b/.test(f) && /\b(prayers?|pleas?)\b/.test(f) && !/\b(not|never|don't|refuse|ignore|deny)\b/.test(f) && !ACT_NAMED(f)) {
    const named = p.people?.settlements.find((s) => s.fallen < 0 && wordAt(f, s.name.toLowerCase()) >= 0);
    const st = mods.place?.settlement !== undefined ? p.people?.settlement(mods.place.settlement) : named;
    if (st) {
      c.add({ k: 'prayer.answer', settlement: st.id }, `answer the prayers of ${st.name}`);
      return true;
    }
  }
  const person = live(c, f, ['agent']);
  // (fix r2 #21) ── the Touch laid on a person or a town: which of its acts ("touch Hesh" was read as "torch") ──
  // (fix r3 #3) only "touch Hesh" / "use the Touch on Aru" with nothing after the name asks: "touch Aru with rain" is the rain
  const touchM = f.trim().match(/^(?:please )?(?:touch|(?:use|lay|put) (?:the|my|your) touch on)\s+(.+)$/);
  const touchRest = touchM ? touchM[1].replace(/\b(please|now|gently)\b/g, ' ').trim() : '';
  if (touchM && (person || mods.place?.settlement !== undefined) && touchRest.split(/\s+/).length <= 4 && !/\b(with|using|by|and|to|into|in|of|for|so|until)\b/.test(touchRest)) {
    const w0 = person ? person.name : mods.place?.label ?? 'them';
    const who = w0 === 'them' ? w0 : w0.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    return c.ask(`Touch ${who} how? Lift, Rebuke or Soothe ("lift ${who}", "rebuke ${who}", "soothe ${who}").`);
  }
  // (fix r2 #21) ── a negation never does the act it negates: "make Hesh stop being a prophet", "Hesh is no longer my
  //    prophet" abandon the prophet; "Hesh is no longer one of the Called" is never a call ──
  // (fix r3 #1) for a prophet the negation must govern the ROLE itself ("stop being a prophet", "is no longer my prophet",
  //    "not my prophet any more", "depose Hesh as prophet"): abandoning cannot be undone, and "free my prophet", "do not let
  //    them harm my prophet", "release the prophet Hesh" are the god's care for the prophet, never its rejection
  const NEG = /\b(stop(?:s|ped)? being|no longer|not|never|un-?make|strip|remove|depose|dismiss|release|free)\b[^,.;]*\b/;
  const UNPROPHET = /\b(?:stop(?:s|ped)? being|(?:is|be|are) no longer|no longer|un-?make|depose|dismiss)\s+(?:(?:a|my|the|your|the god's|his|her|our)\s+)?prophets?\b|\bnot (?:a |my |the |the god's )?prophet any ?more\b|\b(?:un-?make|depose|dismiss|strip)\s+[a-z' -]+?\s+(?:as|of being)\s+(?:(?:a|my|the|your)\s+)?prophets?\b/;
  if (UNPROPHET.test(f)) {
    const agent = person ? person.id : u.god.rel?.prophets.find((q) => q.planet === p.id && (mods.place?.settlement === undefined || q.settlement === mods.place.settlement))?.agent;
    if (agent === undefined) { cx.asked.push({ k: 'prophet.abandon' }); return c.ask('Abandon which prophet? Name them ("abandon the prophet Hesh").'); }
    c.add({ k: 'prophet.abandon', agent, planet: person?.planet ?? p.id }, 'abandon the prophet');
    return true;
  }
  if (new RegExp(`${NEG.source}(?:one of )?the called\\b`).test(f)) return c.ask('The Called serve the god until they die: none is sent back ("charge the Called to farm" sets them other work).');
  // ── speak through a prophet: "tell Aru through Hesh that rain will come in two days" ──
  // (fix r3 #8) the name ends at a colon, a dash or "will" too ("speak through Hesh: a flood will come"); a sentence that
  //    speaks through someone never falls through to the act itself — it asks
  const through = f.match(/\bthrough\s+([a-z' -]+?)(?:\s*[:;\u2014\u2013]|\s+-\s|,|\s+that\b|\s+of\b|\s+the\b|\s+rain\b|\s+will\b|\s+an?\b|$)/);
  const SPEAK = /\b(tell|warn|promise|say|speak|announce|foretell|prophesy|predict)\b/;
  const FORE = /\b(foretell|prophesy|predict|forewarn)\b/;
  const isProphet = (id: number) => !!u.god.rel?.prophets.some((q) => q.agent === id && q.planet === p.id);
  // (fix r3 #14) foretelling with no one named speaks through the god's prophet of the named town (or its only one), else asks
  let speaker: { id: number; planet: number } | null = null;
  if (!through && !person && !cx.addressee && FORE.test(f)) {
    const mine = (u.god.rel?.prophets ?? []).filter((q) => q.planet === p.id && (mods.place?.settlement === undefined || q.settlement === mods.place.settlement));
    if (mine.length !== 1) return c.ask(mine.length ? 'Through whom? Name the prophet ("tell Aru through Hesh that rain will come in two days").' : 'Through whom? You have no prophet here: make one first ("make Hesh my prophet").');
    speaker = { id: mine[0].agent, planet: mine[0].planet };
  }
  if (!through && /\bthrough\b/.test(f) && SPEAK.test(f)) return c.ask('Through whom? Name your prophet ("tell Aru through Hesh that rain will come in two days").');
  // (fix r4 #8) the god's prophet named or spoken to ("Hesh, tell them a flood is coming", "tell Hesh that a flood is
  //    coming", "Hesh, warn them that a storm is coming") with any SPEAK verb and a word of what is coming: a prophecy, never
  //    the act it speaks of (nor an idea "famine come" taught); an order ("tell Hesh to preach") is no prophecy
  const spokenTo = cx.addressee && cx.addressee.kind === 'agent' ? cx.addressee : null;
  const FUTURE = /\bthat\b|\b(will|shall|is coming|are coming|comes|coming|is near|are near|draws? near|approach(?:es)?|is going to|are going to|on its way)\b/;
  const told = !through && SPEAK.test(f) && FUTURE.test(f) && !(/\bto\s+[a-z]+/.test(f) && !/\b(that|will|shall)\b/.test(f));
  const toProphet = spokenTo && isProphet(spokenTo.id) ? spokenTo : person && isProphet(person.id) ? person : null;
  if (told && !toProphet && (spokenTo || (person && /\bthat\b/.test(f)))) {
    const nm = (spokenTo ?? person)!.name.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    return c.ask(`${nm} does not speak for you: make ${nm} your prophet first ("make ${nm} my prophet"), then speak through them.`);
  }
  if ((through && SPEAK.test(f)) || (person && (FORE.test(f) || (/\bwarn\b/.test(f) && isProphet(person.id)))) || speaker || (told && toProphet) || (spokenTo && FORE.test(f))) {
    const who = speaker ?? (through ? live(c, through[1], ['agent']) ?? person : (told && toProphet) ? toProphet : person ?? spokenTo);
    if (!who) return c.ask('Through whom? Name your prophet ("tell Aru through Hesh that rain will come in two days").');
    const tail = (f.match(/\bthat\s+(.+)$/)?.[1] ?? f).replace(/\bthrough\s+[a-z' -]+/, '');
    const what = whatOf(tail);
    if (!what) return c.ask('Foretell what? (rain, food, healing, warmth, protection, rebuilding, a sign, or harm).');
    c.add({ k: 'prophet.foretell', agent: who.id, what, days: daysOf(c), planet: who.planet }, `foretell ${what}`);
    return true;
  }
  // (fix r4 #20) asking a drought to end is never a drought: "break the drought over Aru", "the drought is over", "lift the
  //    drought" end the one raging (disaster.cancel); with none raging it is rain on the town (the answer to its prayer)
  const ENDS_DROUGHT = /\b(break|lift|end|stop|cease|relieve|banish|dispel|undo|halt)\s+(?:(?:the|this|that|their|its|a|our)\s+)?(?:(?:long|great|terrible|dry|endless)\s+)?droughts?\b|\bdroughts?\s+(?:is|be|are|will be|shall be)\s+(?:over|done|ended|broken|lifted)\b|\bdroughts?\s+(?:must\s+|should\s+|shall\s+|will\s+|can\s+)?(?:end|break|pass|cease|lift|stop)s?\b|\bend (?:of|to) (?:the |this |their )?droughts?\b/;
  if (ENDS_DROUGHT.test(f) && !/\b(send|bring|cause|start|unleash|make|another|new)\b/.test(f)) {
    const raging = u.god.disasters.filter((d) => d.planet === p.id && d.kind === 'drought');
    if (raging.length) {
      c.add({ k: 'disaster.cancel', kind: 'drought', ...(mods.place?.pos ? { pos: mods.place.pos } : {}) }, 'end the drought');
      return true;
    }
    const praying = prayersOf(u, p).filter((q) => q.prayers.some((r) => r.kind === 'rain'));
    const sid = mods.place?.settlement ?? (praying.length === 1 ? praying[0].settlement : undefined);
    const st = sid !== undefined ? p.people?.settlement(sid) : undefined;
    if (st) {
      c.add({ k: 'miracle.water', pos: [st.pos[0], st.pos[1], st.pos[2]], radius: Math.round(st.territory + 150), planet: p.id }, `rain on ${st.name}`);
      mods.place = null;
      return true;
    }
    if (mods.place?.pos) { c.add({ k: 'water.rain', pos: mods.place.pos, radius: 900, duration: 4320 }, 'rain on the dry land'); return true; }
    return c.ask('No drought rages now. Send rain where the land is dry ("rain on Aru").');
  }
  // (fix r4 #21) "show Aru a sign", "give Aru an omen", "send them a portent", "give Aru a sign of warning": a sign for that
  //    town (god.omen), never knowledge taught nor a new thing called "sign warning"
  if (/\b(show|give|send|grant|offer)\b/.test(f) && /\b(signs?|omens?|portents?|wonders?)\b/.test(f) && !/\bas an? (sign|omen|portent|warning|wonder)\b/.test(f)
    && !/\b(eclipse|comet|rainbow|lightning|aurora|northern lights|red rain|blood rain|floods?)\b/.test(f)) {
    const sid = mods.place?.settlement;
    if (sid === undefined) return c.ask('A sign for whom? Name the town ("show Aru a sign").');
    const warning = /\b(warning|warn|of doom|of wrath|of anger|dread|ill omen|bad omen|evil omen|dark)\b/.test(f);
    c.add({ k: 'god.omen', settlement: sid, ...(warning ? { warning: true } : {}), planet: p.id }, warning ? 'a sign of warning' : 'a sign');
    return true;
  }
  // (fix r3 #1) care for the prophet ("free my prophet", "never let my prophet die", "the chief who persecutes my prophet")
  //    and a negated abandoning ("do not abandon my prophet") keep the prophet: the god is told how to act for them
  const ABANDON = /\b(abandon|forsake|disown|reject|turn (?:away )?from)\b/;
  const keepsProphet = /\b(?:not|never|don't|dont|won't|wont|shall not|will not)\b[^,.;]*\b(abandon|forsake|disown|reject|turn (?:away )?from)\b/.test(f);
  // (fix r4 #2) an act aimed at those who persecute the prophet is that act: "strike the chief who persecutes my prophet with
  //    lightning", "send a plague on those who persecute my prophet"
  const AT_PERSECUTORS = /^(?:please |now |then )?(strike|smite|send|curse|punish|burn|blast|crush|drown|hurl|throw|drop|unleash|bring|plague|flood)\b/.test(f.trim())
    && /\b(who|that|which|those|for)\b[^,.;]*\b(persecut\w*|harm\w*|hurt\w*|attack\w*|threaten\w*)\b/.test(f);
  if (/\bprophets?\b/.test(f) && !AT_PERSECUTORS && !/\b(make|anoint|choose|appoint|raise|mark)\b/.test(f) && (keepsProphet || (!ABANDON.test(f) && (/\b(free|protect|save|shield|guard|defend|spare|rescue|persecut\w*)\b/.test(f) || /\b(?:not|never|don't|dont)\b[^,.;]*\b(?:let|allow)\b[^,.;]*\b(?:harm|hurt|kill|die|persecute|touch)\b/.test(f))))) {
    const ph = person && u.god.rel?.prophets.some((q) => q.agent === person.id) ? person : null;
    // (fix r4 #2) "shield my prophet Hesh", "protect Hesh my prophet": the shield laid on the prophet where they stand
    if (ph?.pos && /\b(shield|protect|guard|defend)\b/.test(f) && !/\b(not|never|don't|dont)\b/.test(f)) {
      c.add({ k: 'miracle.shield', pos: ph.pos, radius: 120, planet: ph.planet }, `shield ${ph.name}`);
      return true;
    }
    return c.ask(`${ph ? `${ph.name} remains your prophet` : 'Your prophet remains yours'}. To shield ${ph ? ph.name : 'them'}, act for them: lift them out of harm's way with the Touch, or strike at those who persecute them.`);
  }
  // ── abandon a prophet ("abandon Hesh", "forsake Hesh": the command says so when Hesh is not the god's prophet) ──
  if (ABANDON.test(f) && (has(f, 'prophet') || person)) {
    // (a person named: the command says so when they are not the god's prophet)
    const agent = person ? person.id : u.god.rel?.prophets.find((q) => q.planet === p.id && (mods.place?.settlement === undefined || q.settlement === mods.place.settlement))?.agent;
    if (agent === undefined) { cx.asked.push({ k: 'prophet.abandon' }); return c.ask('Abandon which prophet? Name them ("abandon the prophet Hesh").'); }
    c.add({ k: 'prophet.abandon', agent, planet: person?.planet ?? p.id }, 'abandon the prophet');
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
    // (fix r3 #18) "make the fish sacred in Lune": the fish shoal (was a shoal spawned)
    const animal = animalIn(u, c.s) ?? animalIn(u, f) ?? (/\bfish(es)?\b/.test(f) && u.content.animals.list.some((a) => a.id === 'fish-shoal') ? 'fish-shoal' : null);
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
    c.add({ k: 'god.omen', settlement: mods.place.settlement, warning: true, planet: p.id }, 'a sign of warning');
    return true;
  }
  if (/\beclipse\b/.test(f) && !/\b(year|long|year-long|endless|forever)\b/.test(f)) {
    c.add({ k: 'god.omen', kind: 'eclipse', ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : mods.place?.pos ? { pos: mods.place.pos } : {}), planet: p.id }, 'the sun darkens (an omen)');
    return true;
  }
  // (fix r2 #21) a sign by its own name, or any act "as a sign" / "sparing": "send a sparing flood to Aru", "send red rain on
  // Aru", "strike lightning near Aru as a sign" are omens (no deaths), never the disaster or plain rain
  // (fix r3 #3) "that spares no one", "sparing none" mean the opposite: the disaster itself
  const asSign = (/\bas an? (sign|omen|portent|warning|wonder)\b|\b(?:an?|the) sparing\b|\bsparing (?:them|the people|everyone|everybody|all|lives|life|the town)\b|\bharmless(ly)?\b|\bthat (?:spares (?:them|the people|everyone|everybody|all|lives)|(?:harms|hurts|kills) no ?(?:one|body))\b/.test(f))
    && !/\bspar(?:es|ing|e) no(?:ne|body| ?one)\b/.test(f);
  const OMEN_WORD: [RegExp, string][] = [[/\b(red|blood|bloody)[ -]rain\b|\brain of blood\b/, 'red-rain'], [/\bfloods?\b|\bwaters? rise\b/, 'flood'], [/\brainbow\b/, 'rainbow'], [/\blightning\b/, 'lightning'], [/\baurora\b|\bnorthern lights\b/, 'aurora'], [/\bcomet\b/, 'comet']];
  const ow = OMEN_WORD.find(([re]) => re.test(f));
  if (ow && (asSign || (ow[1] === 'red-rain' && mods.place?.settlement !== undefined))) {
    c.add({ k: 'god.omen', kind: ow[1], ...(mods.place?.settlement !== undefined ? { settlement: mods.place.settlement } : mods.place?.pos ? { pos: mods.place.pos } : {}), planet: p.id }, `${ow[1].replace('-', ' ')} (an omen)`);
    return true;
  }
  if (/\bcomet\b/.test(f) && /\b(sky|pass|passing|passes|omen|sign|portent|show|over|above|across)\b/.test(f) && !/\b(strike|hit|crash|fall on|at)\b/.test(f)) {
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
