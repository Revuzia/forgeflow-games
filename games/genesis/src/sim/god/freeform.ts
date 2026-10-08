// GENESIS — freeform "do this" (CONTRACT.md §11.6), phase-1 subset: a deterministic rule-based interpreter that turns
// a sentence into Commands WITHOUT applying them (the UI previews, then executes). It understands `set <path> <value>`
// for every registered parameter and the phase-1 power words (air, rain and every weather kind, seas and floods,
// terrain brushes, plants and biomes, fire, the sun, the star). The full parser (lexicon.json, powers.json, live names,
// runtime content creation) replaces this in phase 3; the contract it already honours: never throw, always return
// something actionable or a clear "here is what I can do" with nearest matches.

import type { Command, CommandResult, UnitVec } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { CommandRegistry } from './commands.ts';
import { findParam, PARAMS } from './params.ts';
import { suggest } from '../content.ts';

const NUM = /(-?\d+(?:\.\d+)?)/;

function firstNumber(s: string): number | undefined {
  const m = s.match(NUM);
  return m ? parseFloat(m[1]) : undefined;
}

function coerceValue(s: string): unknown {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (/^(true|on|yes)$/i.test(t)) return true;
  if (/^(false|off|no)$/i.test(t)) return false;
  if (/^(none|null|nothing)$/i.test(t)) return 'none';
  return t;
}

/** size words -> radius multiplier */
function sizeOf(s: string): number {
  if (/\b(huge|enormous|vast|giant|massive)\b/.test(s)) return 3;
  if (/\b(big|large|wide)\b/.test(s)) return 1.8;
  if (/\b(small|little|tiny)\b/.test(s)) return 0.45;
  return 1;
}

export interface ParseOut extends CommandResult {
  resolved?: Command[];
}

export function parseFreeform(u: Universe, reg: CommandRegistry, text: string): ParseOut {
  try {
    return parseInner(u, reg, text);
  } catch (e) {
    return { ok: false, msg: `I could not read that (${e instanceof Error ? e.message : String(e)}).` };
  }
}

function parseInner(u: Universe, reg: CommandRegistry, text: string): ParseOut {
  const raw = String(text ?? '').trim();
  const s = raw.toLowerCase().replace(/[!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, msg: 'Say what should happen — for example "add air", "rain here", "set planet.gravity 5".' };
  const planet = u.planetFor(undefined);
  const pos: UnitVec | undefined = u.focus ? undefined : [0, 0, 1];
  const at = (c: Command): Command => (pos && c.pos === undefined ? { ...c, pos } : c);
  const out = (cmds: Command[], why: string): ParseOut => {
    // validate each so the preview shows only what would really work
    for (const c of cmds) {
      const v = reg.validate(u, c);
      if (!v.ok) return { ok: false, msg: v.msg, resolved: cmds };
    }
    return { ok: true, msg: why, resolved: cmds };
  };
  const big = sizeOf(s);
  const everywhere = /\b(everywhere|whole (world|planet)|all over|planet-wide|worldwide)\b/.test(s);

  // 1. explicit command kind: "terrain.raise radius=300 strength=20"
  const head = s.split(' ')[0];
  if (head.includes('.') && reg.has(head)) {
    const c: Command = { k: head };
    for (const kv of raw.split(/\s+/).slice(1)) {
      const m = kv.match(/^([\w-]+)=(.+)$/);
      if (m) c[m[1]] = coerceValue(m[2]);
    }
    return out([at(c)], `→ ${head}`);
  }

  // 2. set <path> [to|=] <value>
  if (/^(set|make|change)\b/.test(s)) {
    const toks = s.replace(/^(set|make|change)\s+(the\s+)?/, '').split(' ');
    for (let i = toks.length - 1; i >= 1; i--) {
      const path = toks.slice(0, i).join(' ').replace(/\s+(to|=|at)$/, '');
      const d = findParam(path) ?? findParam(path.replace(/ /g, '.'));
      if (!d) continue;
      const rest = toks.slice(i).filter((t) => t !== 'to' && t !== '=' && t !== 'at').join(' ');
      if (!rest) continue;
      return out([{ k: 'set', path: d.path, value: coerceValue(rest) }], `→ set ${d.label} (${d.path}) to ${rest}${d.unit ? ' ' + d.unit : ''}`);
    }
  }

  // 3. phrases
  const n = firstNumber(s);
  // air
  if (/\b(remove|strip|take|suck)\b.*\b(air|atmosphere)\b/.test(s)) return out([{ k: 'planet.remove-air', amount: n }], '→ strip the air away');
  if (/\b(air|atmosphere|breathe|breath)\b/.test(s)) return out([{ k: 'planet.add-air', amount: n ?? 1 }], `→ breathe ${n ?? 1} atm of air onto ${planet?.name ?? 'the world'}`);
  // star
  for (const st of u.content.stars.list) {
    if (s.includes(st.name.toLowerCase()) || new RegExp(`\\b${st.id.toLowerCase()}\\b star`).test(s)) return out([{ k: 'star.set', kind: st.id }], `→ the star becomes a ${st.name.toLowerCase()}`);
  }
  if (/\b(brighter|brighten|hotter sun|more light)\b/.test(s)) return out([{ k: 'star.set', luminosity: Math.min(10000, u.star.luminosity * (n ?? 1.5)) }], '→ brighten the star');
  if (/\b(dimmer|dim|darker sun|less light)\b/.test(s)) return out([{ k: 'star.set', luminosity: u.star.luminosity / (n ?? 1.5) }], '→ dim the star');
  // sun / time
  if (/\b(release|unfreeze|let)\b.*\bsun\b|\bsun\b.*\bmove again\b/.test(s)) return out([{ k: 'time.freeze-sun', on: false }], '→ let the sun move again');
  if (/\b(freeze|stop|hold)\b.*\bsun\b|\bsun\b.*\bstand(s)? still\b/.test(s)) return out([{ k: 'time.freeze-sun', on: true }], '→ the sun stands still');
  const hours: [RegExp, number][] = [[/\b(noon|midday)\b/, 12], [/\bmidnight\b/, 0], [/\b(dawn|sunrise)\b/, 6], [/\b(dusk|sunset|evening)\b/, 18], [/\bmorning\b/, 9], [/\bnight\b/, 23]];
  for (const [re, h] of hours) if (re.test(s)) return out([{ k: 'time.set-hour', hour: (h / 24) * (planet?.st.dayHours ?? 24) }], `→ move the sun to ${h}:00`);
  if (/\bhour\b/.test(s) && n !== undefined) return out([{ k: 'time.set-hour', hour: n }], `→ move the sun to hour ${n}`);
  if (/\b(day|days)\b.*\blong|\bday length\b/.test(s) && n !== undefined) return out([{ k: 'time.day-length', hours: n }], `→ a day lasts ${n} hours`);
  if (/\btilt\b/.test(s) && n !== undefined) return out([{ k: 'time.axial-tilt', degrees: n }], `→ tilt the axis ${n}°`);
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  for (const se of seasons) {
    if (new RegExp(`\\b${se}\\b`).test(s) && /\b(always|forever|pin|eternal|endless|keep|make it|hold)\b/.test(s)) return out([{ k: 'weather.pin-season', season: se }], `→ hold ${se}`);
  }
  if (/\b(seasons? (turn|move|change) again|release the season|unpin)\b/.test(s)) return out([{ k: 'weather.pin-season', season: 'none' }], '→ let the seasons turn');
  // seas and water
  if (/\bsea level\b|\bsea\b.*\b(rise|fall|level)\b|\b(raise|lower)\b.*\bsea\b/.test(s)) {
    if (n !== undefined && !/\b(by)\b/.test(s)) return out([{ k: 'water.sea-level', value: n }], `→ the seas move to ${n} m`);
    const up = /\b(rise|raise|higher|up|flood)\b/.test(s);
    return out([{ k: 'water.sea-level', delta: (up ? 1 : -1) * (n ?? 10) }], `→ the seas ${up ? 'rise' : 'fall'} ${n ?? 10} m`);
  }
  if (/\btsunami|tidal wave\b/.test(s)) return out([at({ k: 'water.tsunami', radius: 350 * big, height: n ?? 12 })], '→ a tsunami, here');
  if (/\bflood\b/.test(s)) return out([at({ k: 'water.flood', radius: 300 * big, height: n ?? 4 })], '→ flood this place');
  if (/\b(drain|dry up|dry out)\b/.test(s)) return out([at({ k: 'water.drain', radius: 300 * big })], '→ drain the water here');
  if (/\bspring\b/.test(s) && !/\bseason\b/.test(s)) return out([at({ k: 'water.spring', rate: n ?? 40 })], '→ open a spring here');
  if (/\b(dig|carve|make|new)\b.*\bsea\b/.test(s)) return out([at({ k: 'terrain.dig-sea', radius: 500 * big, depth: n ?? 40 })], '→ dig a sea here');
  if (/\briver\b/.test(s)) return out([at({ k: 'terrain.river', depth: n ?? 2.5 })], '→ carve a river from here, downhill');
  // weather kinds (longest names first: "acid rain" before "rain")
  const wk = [...u.content.weather.list].sort((a, b) => b.id.length - a.id.length);
  if (/\bclear\b.*\b(sky|skies|weather|clouds)\b|\bstop the (rain|storm|weather)\b/.test(s)) {
    return everywhere
      ? out([{ k: 'weather.clear', everywhere: true }], '→ clear the skies over the whole world')
      : out([at({ k: 'weather.clear', radius: 1500 * big })], '→ clear the skies here');
  }
  for (const w of wk) {
    const name = w.id.replace(/-/g, ' ');
    if (s.includes(name) || s.includes(w.name.toLowerCase())) {
      if (everywhere) return out([{ k: 'weather.global', kind: w.id }], `→ ${w.name.toLowerCase()} over the whole world`);
      if (w.id === 'rain') return out([at({ k: 'water.rain', radius: 600 * big })], '→ rain here');
      return out([at({ k: 'weather.paint', kind: w.id, radius: 700 * big, pinned: /\b(stay|forever|pin|keep)\b/.test(s) })], `→ ${w.name.toLowerCase()} here`);
    }
  }
  if (/\b(storm|thunder)\b/.test(s)) return out([at({ k: 'weather.paint', kind: 'thunderstorm', radius: 500 * big })], '→ a thunderstorm here');
  if (/\b(pour|add)\b.*\bwater\b|\bwater\b/.test(s)) return out([at({ k: 'water.add', radius: 250 * big, depth: n ?? 2 })], '→ pour water here');
  // terrain
  if (/\bmountains?\b/.test(s)) {
    const f = u.focus?.pos ?? pos ?? [0, 0, 1];
    // a range running ~25° eastward from here
    const lon = Math.atan2(f[0], f[2]) + 0.45;
    const lat = Math.asin(Math.max(-1, Math.min(1, f[1])));
    const to: UnitVec = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    return out([at({ k: 'terrain.mountain-range', to, height: n ?? 260 * Math.min(2, big) })], '→ raise a mountain range from here eastward');
  }
  if (/\bcrater\b/.test(s)) return out([at({ k: 'terrain.crater', radius: 200 * big })], '→ blast a crater here');
  if (/\b(raise|lift|uplift)\b/.test(s)) return out([at({ k: 'terrain.raise', radius: 250 * big, strength: Math.abs(n ?? 20) })], '→ raise the land here');
  if (/\b(lower|sink)\b/.test(s)) return out([at({ k: 'terrain.lower', radius: 250 * big, strength: Math.abs(n ?? 20) })], '→ lower the land here');
  if (/\bflatten\b/.test(s)) return out([at({ k: 'terrain.flatten', radius: 250 * big })], '→ flatten the land here');
  if (/\bsmooth\b/.test(s)) return out([at({ k: 'terrain.smooth', radius: 250 * big })], '→ smooth the land here');
  if (/\blava\b/.test(s)) return out([at({ k: 'terrain.paint-material', material: 'lava', radius: 120 * big, depth: n ?? 3 })], '→ pour lava here');
  for (const mat of ['sand', 'snow', 'ash', 'ice', 'soil'] as const) {
    if (new RegExp(`\\b${mat}\\b`).test(s)) return out([at({ k: 'terrain.paint-material', material: mat, radius: 250 * big, depth: n ?? 0.5 })], `→ lay ${mat} here`);
  }
  // fire
  if (/\b(extinguish|put out|douse|quench)\b/.test(s)) return out([at({ k: 'fire.extinguish', radius: 300 * big })], '→ put out the fires here');
  if (/\b(fire|burn|ignite|blaze|flame)\b/.test(s)) return out([at({ k: 'fire.ignite', radius: 60 * big })], '→ set fire here');
  // life
  if (/\b(forest|woods|trees)\b/.test(s)) return out([at({ k: 'life.forest', radius: 300 * big })], '→ grow a forest here');
  for (const pl of u.content.plants.list) {
    if (s.includes(pl.id.replace(/-/g, ' ')) || s.includes(pl.name.toLowerCase())) return out([at({ k: 'life.plant', species: pl.id, radius: 150 * big })], `→ plant ${pl.name.toLowerCase()} here`);
  }
  for (const b of u.content.biomes.list) {
    if (new RegExp(`\\b${b.id}\\b`).test(s) || s.includes(b.name.toLowerCase())) return out([at({ k: 'life.paint-biome', biome: b.id, radius: 400 * big, pinned: /\b(stay|forever|pin|keep)\b/.test(s) })], `→ make this ${b.name.toLowerCase()}`);
  }
  if (/\b(plant|seed|grass|green|life)\b/.test(s)) return out([at({ k: 'life.plant', species: 'meadow-grass', radius: 250 * big })], '→ sow grass here');
  // a bare law name with a number: "gravity 3"
  if (n !== undefined) {
    const words = s.replace(NUM, ' ').replace(/\b(to|the|of|at|make|set)\b/g, ' ').trim().replace(/\s+/g, ' ');
    const d = findParam(words);
    if (d) return out([{ k: 'set', path: d.path, value: n }], `→ set ${d.label} to ${n}${d.unit ? ' ' + d.unit : ''}`);
  }
  // nothing matched: say what can be done, with the nearest words
  const vocab = [...reg.kinds(), ...PARAMS.map((p) => p.path), ...u.content.weather.ids(), ...u.content.plants.ids(), ...u.content.biomes.ids()];
  const near = s.split(' ').map((w) => suggest(w, vocab)).filter((x) => x);
  return {
    ok: false,
    msg: `I don't know how to do that yet. I can: add or remove air, make rain or any weather (${u.content.weather.ids().slice(0, 6).join(', ')}, …), raise or lower land, dig a sea, carve a river, flood, plant species, grow forests, paint biomes, start or put out fires, move or stop the sun, change the star, and "set <law> <value>".${near.length ? ` Closest words: ${[...new Set(near)].slice(0, 5).join(', ')}.` : ''}`,
  };
}
