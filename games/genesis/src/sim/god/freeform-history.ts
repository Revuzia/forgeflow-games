// GENESIS — free text for history, eras and the world's great acts (LIVING.md §5.3, the HISTORY phrases). god/freeform.ts
// calls intentHistory right after the RELATIONSHIP and CONTENT intents, before its own:
//
//   "advance Aru to the next era", "lift Aru into the iron age"     settlement.teach { era: 'next' | <era>, force }
//   "terraform this world"                                           world.terraform (a living world: said so, nothing done)
//   "make a new ocean world", "a new desert planet"                  world.birth { kind }
//   "turn the desert into a jungle"                                  life.paint-biome B over the nearest A
//   "make a swamp near Aru", "a marsh", "a bog"                      life.paint-biome wetland (+ shallow water)
//   "create a new kingdom", "found a new nation"                     settlement.found (a people of its own)
//   "armageddon", "the end of the world"                             every people at war with its nearest neighbour and
//                                                                    a volley of disasters at full wrath — confirmed first
//   "send every disaster at once"                                    a volley of six disasters — confirmed first
//
// The parser's own types are module-private: these functions see a clause through the structural `HistoryClause`.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { V3 } from './state.ts';
import { ERAS } from '../content.ts';
import { distM } from '../people/world.ts';
import { habitability } from '../space/ships.ts';
import { bearingDir, cellPos3, moveBy } from './util.ts';

interface LiveName { name: string; kind: string; id: number; planet: number; pos?: V3 }
interface PlaceLike { pos?: V3; planet?: number; settlement?: number; label: string; here?: boolean; everywhere?: boolean }

/** the parts of a parser clause these intents read (god/freeform.ts Clause, structurally) */
export interface HistoryClause {
  cx: { u: Universe; p: Planet | undefined; live: LiveName[]; raw: string; asked: Command[]; confirm?: string };
  s: string;
  full: string;
  mods: { place: PlaceLike | null; other?: PlaceLike | null; size?: number; qty?: number; one?: boolean; nums: number[] };
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

/** everyday words for biomes (lexicon `biomeWords`: jungle -> rainforest, swamp / marsh / bog -> wetland ...) and the
 * biomes' own ids and names: the biome a phrase names, or null */
export function biomeOf(u: Universe, lexicon: Record<string, unknown>, phrase: string): string | null {
  const t = phrase.replace(/^(a|an|the|some)\s+/, '').trim();
  const words = (lexicon.biomeWords && typeof lexicon.biomeWords === 'object' ? lexicon.biomeWords : {}) as Record<string, string>;
  let best: string | null = null, bl = 0;
  const consider = (w: string, id: string) => { if (w.length > bl && wordAt(t, w) >= 0 && u.content.biomes.find(id)) { best = id; bl = w.length; } };
  for (const [w, id] of Object.entries(words)) consider(w, id);
  for (const b of u.content.biomes.list) { consider(b.id.replace(/-/g, ' '), b.id); consider(b.name.toLowerCase(), b.id); }
  return best;
}

/** the nearest cell of a biome to a point (a few cells' stride), or null when the world has none */
function nearestBiome(u: Universe, p: Planet, from: V3, biome: string): V3 | null {
  const b = u.content.biomes.idx(biome);
  if (b < 0) return null;
  let best = -1, bd = Infinity;
  for (let c = 0; c < p.count; c += 2) {
    if (p.f.biome[c] !== b) continue;
    const d = distM(p, cellPos3(p, c), from);
    if (d < bd) { bd = d; best = c; }
  }
  return best >= 0 ? cellPos3(p, best) : null;
}

function focus(c: HistoryClause): V3 | undefined {
  const u = c.cx.u;
  return u.focus && c.cx.p && u.focus.planet === c.cx.p.id ? [...u.focus.pos] as V3 : undefined;
}

/** the HISTORY phrases of LIVING.md §5.3 (true: the clause was understood here) */
export function intentHistory(c: HistoryClause): boolean {
  return intentEra(c) || intentTerraform(c) || intentNewWorld(c) || intentTurnInto(c) || intentWetland(c) || intentKingdom(c) || intentArmageddon(c) || intentEveryDisaster(c);
}

/** "advance Aru to the next era", "lift Lune into the iron age", "bring Aru forward an age" */
function intentEra(c: HistoryClause): boolean {
  const { s, full, mods } = c;
  if (!/\b(advance|lift|raise|bring|move|push|carry|hurry|propel|catapult|uplift|elevate|jump|skip)\b/.test(s)) return false;
  const eraW = full.match(/\b(next|following|new) (era|age)\b|\b(an|one|a) (era|age) (forward|ahead|on)\b|\bforward (an|one|a) (era|age)\b/);
  const named = full.match(new RegExp(`\\b(${ERAS.join('|')}) (age|era)\\b`));
  if (!eraW && !named && !/\b(era|age)\b/.test(full)) return false;
  if (!eraW && !named) return false;
  const sid = mods.place?.settlement;
  if (sid === undefined) {
    c.cx.asked.push({ k: 'settlement.teach', era: 'next', force: true });
    return c.ask('Advance whom? Name a settlement ("advance Aru to the next era").', 'settlement.teach');
  }
  const era = named ? named[1] : 'next';
  c.add({ k: 'settlement.teach', settlement: sid, era, force: true }, era === 'next' ? 'the next era' : `the ${era} era`);
  return true;
}

/** "terraform this world", "make Cinder a living world", "terraform Rust" */
function intentTerraform(c: HistoryClause): boolean {
  const { full, mods } = c;
  const { u } = c.cx;
  if (!/\bterraform(ing|ed)?\b|\bmake (it|this world|this planet|[a-z]+) (a )?(living|habitable|green) (world|planet)\b|\bbring (it|this world|this planet|[a-z]+) to life\b/.test(full)) return false;
  const wid = mods.place?.planet ?? c.cx.p?.id;
  const w = wid !== undefined ? u.planet(wid) : undefined;
  if (!w || !w.alive) return c.ask('Which world? ("terraform Cinder").');
  const sp = u.content.species.idx('plains-folk');
  const fit = sp >= 0 ? habitability(u, w, sp) : { score: 0, breathe: false };
  if (w.airy && fit.breathe && fit.score > 0.3) {
    c.cx.asked.push({ k: 'world.terraform', planet: w.id });
    return c.ask(`${w.name} is alive already: it has air, water and green land (habitable ${Math.round(fit.score * 100)}%). To make it kinder, warm it, water it or plant it ("plant forests everywhere").`);
  }
  if (mods.place && !mods.place.settlement) mods.place = null;
  c.add({ k: 'world.terraform', planet: w.id }, `terraform ${w.name}`);
  return true;
}

/** "make a new ocean world", "create a desert planet", "a new jungle world" */
function intentNewWorld(c: HistoryClause): boolean {
  const { s, full } = c;
  const { u } = c.cx;
  if (!/\b(world|planet)s?\b/.test(s) || /\b(moon|sun|star)\b/.test(s)) return false;
  if (!/\b(new|another|second|third|one more)\b/.test(s) && !/\b(make|create|birth|form|forge|build|spawn|conjure|summon|bring forth)\b.*\b(a|an)\b/.test(s)) return false;
  let kind: string | null = null, kl = 0;
  for (const k of u.content.planetkinds.list) {
    for (const w of [`${k.id} world`, `${k.id} planet`, k.name.toLowerCase()]) if (w.length > kl && wordAt(full, w) >= 0) { kind = k.id; kl = w.length; }
  }
  if (!kind) return false;
  const au = full.match(/(\d+(?:\.\d+)?)\s*au\b/);
  c.mods.qty = undefined; c.mods.one = undefined;
  if (c.mods.place && !c.mods.place.settlement) c.mods.place = null;
  c.add({ k: 'world.birth', kind, ...(au ? { distance: parseFloat(au[1]) } : {}) }, `birth a world · ${kind}`);
  return true;
}

/** "turn the desert into a jungle", "change the forest near Lune into grassland": B is painted over the nearest A */
function intentTurnInto(c: HistoryClause): boolean {
  const { full, mods } = c;
  const { u, p } = c.cx;
  const lexicon = u.content.lexicon as Record<string, unknown>;
  if (!p) return false;
  const m = full.match(/\b(?:turn|change|transform|make|convert|remake)\s+(.+?)\s+(?:into|to|in to)\s+(.+)$/);
  if (!m) return false;
  const a = biomeOf(u, lexicon, m[1].replace(/\b(near|by|around|of|at|in|on) .*$/, ''));
  const b = biomeOf(u, lexicon, m[2]);
  if (!a || !b || a === b) return false;
  const from = mods.place?.pos ?? focus(c) ?? [0, 0, 1] as V3;
  const at = nearestBiome(u, p, from, a);
  if (!at) return c.ask(`There is no ${u.content.biomes.get(a).name.toLowerCase()} on ${p.name} to turn into ${u.content.biomes.get(b).name.toLowerCase()}.`);
  mods.place = { pos: at, planet: p.id, label: `the ${u.content.biomes.get(a).name.toLowerCase()}` };
  c.add({ k: 'life.paint-biome', biome: b, pos: at, radius: Math.round(600 * (mods.size ?? 1)) }, `${u.content.biomes.get(a).name.toLowerCase()} into ${u.content.biomes.get(b).name.toLowerCase()}`);
  if (b === 'wetland' || b === 'rainforest') c.add({ k: 'water.add', pos: at, radius: Math.round(450 * (mods.size ?? 1)), depth: 0.3 }, 'and water in it');
  return true;
}

/** "make a swamp near Aru", "a marsh", "a bog by the river": wetland painted, with shallow standing water */
function intentWetland(c: HistoryClause): boolean {
  const { s, mods } = c;
  const { u } = c.cx;
  const lexicon = u.content.lexicon as Record<string, unknown>;
  if (!/\b(make|create|conjure|raise|add|put|place|bring|let there be|form|turn)\b/.test(s) && !/^(a |an )?(swamp|marsh|bog|fen|wetland|mire|morass)s?$/.test(s.trim())) return false;
  if (/\b(drain|dry|empty)\b/.test(s)) return false;
  const m = s.match(/\b(swamps?|marsh(?:es)?|bogs?|fens?|wetlands?|mires?|morass(?:es)?|marshland|swampland|quagmire)\b/);
  if (!m || biomeOf(u, lexicon, m[1]) !== 'wetland') return false;
  const r = Math.round(400 * (mods.size ?? 1));
  // near a named town: beside it, not over its houses
  const st = mods.place?.settlement !== undefined && c.cx.p ? c.cx.p.people?.settlement(mods.place.settlement) : null;
  const pos = st && c.cx.p ? moveBy(st.pos, bearingDir(st.pos, 1.1), Math.max(500, st.territory + r * 0.6 + 100), c.cx.p.st.radius) : undefined;
  c.add({ k: 'life.paint-biome', biome: 'wetland', ...(pos ? { pos } : {}), radius: r }, `a ${m[1].replace(/e?s$/, '')}`);
  c.add({ k: 'water.add', ...(pos ? { pos } : {}), radius: Math.round(r * 0.8), depth: 0.3 }, 'shallow water over it');
  return true;
}

/** "create a new kingdom", "found a nation", "a new realm": a people of its own, set down beside the others */
function intentKingdom(c: HistoryClause): boolean {
  const { s, mods } = c;
  if (!/\b(kingdoms?|realms?|nations?|chiefdoms?|countr(?:y|ies)|empires?|states?|tribes?|princedoms?)\b/.test(s)) return false;
  if (!/\b(new|another|create|found|make|start|establish|raise|begin|set up|build)\b/.test(s)) return false;
  if (/\b(of|state of)\b.*\b(war|peace|mind|grace)\b/.test(s)) return false;
  const p = c.cx.p;
  const st = mods.place?.settlement !== undefined && p ? p.people?.settlement(mods.place.settlement) : null;
  // beside a named town, or the largest one, a good way off (a kingdom of its own, not a quarter of theirs)
  let base = st ?? null;
  if (!base && p?.people) for (const o of p.people.settlements) if (o.fallen < 0 && !o.band && (!base || (p.people.members.get(o.id)?.length ?? 0) > (p.people.members.get(base.id)?.length ?? 0))) base = o;
  const pos = base && p ? moveBy(base.pos, bearingDir(base.pos, 4.2), Math.max(1800, base.territory + 1200), p.st.radius) : (mods.place?.pos ?? focus(c));
  if (mods.place?.settlement !== undefined) mods.place = null;
  c.add({ k: 'settlement.found', ...(pos ? { pos } : {}), count: mods.qty && mods.qty > 1 ? Math.min(2000, Math.round(mods.qty)) : 24 }, 'a new kingdom');
  return true;
}

/** the harmful disasters of a volley (in order) */
const VOLLEY = ['meteor', 'quake', 'volcano', 'tornado', 'flood', 'plague', 'wildfire', 'drought'];

/** "armageddon", "the apocalypse", "end the world" (not "apocalyptic <disaster>": that is a cast's size) */
function intentArmageddon(c: HistoryClause): boolean {
  const { full } = c;
  const { u, p } = c.cx;
  if (!/\b(armageddon|apocalypse|doomsday|ragnarok|the end of (the )?(world|days|times|all things)|end times|the last days)\b/.test(full)) return false;
  if (!p?.people) return c.ask('There is nobody here for an end of days.');
  const sts = p.people.settlements.filter((st) => st.fallen < 0 && !st.band);
  // every people turns on its nearest neighbour of another people
  const done = new Set<string>();
  for (const a of sts) {
    let best: typeof a | null = null, bd = Infinity;
    for (const b of sts) {
      if (b.polity === a.polity) continue;
      const d = distM(p, a.pos, b.pos);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) continue;
    const key = a.polity < best.polity ? `${a.polity}:${best.polity}` : `${best.polity}:${a.polity}`;
    if (done.has(key)) continue;
    done.add(key);
    c.add({ k: 'settlement.start-war', settlement: a.id, other: best.id }, `${a.name} against ${best.name}`);
  }
  // and the sky falls on every town (full wrath: the destruction is meant)
  sts.slice(0, 6).forEach((st, i) => c.add({ k: 'disaster.spawn', kind: VOLLEY[i % VOLLEY.length], pos: [st.pos[0], st.pos[1], st.pos[2]], wrath: 1 }, `${VOLLEY[i % VOLLEY.length]} on ${st.name}`));
  if (!sts.length) for (const k of VOLLEY.slice(0, 4)) c.add({ k: 'disaster.spawn', kind: k, wrath: 1 }, k);
  c.cx.confirm = `Armageddon: ${done.size ? 'every people at war and ' : ''}${Math.max(sts.slice(0, 6).length, sts.length ? 0 : 4)} disasters at full wrath, at once. Are you sure? This cannot be survived by all.`;
  void u;
  return true;
}

/** "send every disaster at once", "unleash all the disasters": a volley of six, confirmed first */
function intentEveryDisaster(c: HistoryClause): boolean {
  const { s, mods } = c;
  if (!/\b(every|all(?: the)?|each|all kinds of|every kind of) (?:kind of |sort of )?(disasters?|catastroph(?:e|es)|calamit(?:y|ies)|cataclysms?|plagues)\b/.test(s)) return false;
  if (/\b(stop|cancel|end|halt|calm|forbid|ban|no)\b/.test(s)) return false;
  const at = mods.place?.pos ?? focus(c);
  const p = c.cx.p;
  VOLLEY.slice(0, 6).forEach((k, i) => {
    const pos = at && p ? (i === 0 ? at : moveBy(at, bearingDir(at, i * 1.05), 250 + 120 * i, p.st.radius)) : undefined;
    c.add({ k: 'disaster.spawn', kind: k, ...(pos ? { pos } : {}) }, k);
  });
  c.cx.confirm = `Every disaster at once: ${VOLLEY.slice(0, 6).join(', ')}${mods.place?.label ? ` on ${mods.place.label}` : ''}. Are you sure?`;
  return true;
}
