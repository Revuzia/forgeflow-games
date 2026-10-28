// VALE UI — player-copy lint (client F11, originality F6 / F8). VALE keeps one vocabulary of its own words across the
// client, the HUD, tooltips and the shop, so prose a player reads never says the genre's words where VALE has its own
// (Gleam, Dialwood, Wicks, Needle, Lantern, Hourbell, Hour spells) and never shows a raw stat id where the stat has a
// display name (Kemdo's ult said 'omnivamp' while the stat reads 'Drain').
//
// Pure data + functions, no DOM: the content build (tools/build_content.ts) runs lintPlayerCopy over every content file
// and strings.en.json and reports each hit as an error; harnesses can import it the same way.
//
//   GENRE_WORDS   whole-word, case-insensitive; the value is VALE's word to use instead
//   raw stat ids  a stat whose display name (strings `stat.<id>.name`) differs from its id: the id may not appear as a
//                 whole word in prose ('cs', 'omnivamp', 'lifesteal' …). Ids that are ordinary English words a sentence
//                 needs ('kills', 'deaths', 'level', 'damage', 'range' …) are skipped (STAT_ID_PLAIN_WORDS)
//   what is prose any string VALUE (never a key) with a space in it, outside the SKIP_KEYS fields ($comment, ids,
//                 asset refs, tags); in strings.en.json every value. {placeholders} are not words

export const GENRE_WORDS: Readonly<Record<string, string>> = {
  gold: 'Gleam',
  jungle: 'Dialwood',
  jungler: 'Grovehunter',
  jungling: 'the Dialwood',
  minion: 'Wick',
  minions: 'Wicks',
  creeps: 'Wicks',
  turret: 'Needle',
  turrets: 'Needles',
  inhibitor: 'Lantern',
  inhibitors: 'Lanterns',
  nexus: 'Hourbell',
  summoner: 'fighter',
  'battle spell': 'Hour spell',
  'battle spells': 'Hour spells',
  'summoner spell': 'Hour spell',
  'summoner spells': 'Hour spells',
};

/** stat ids that are plain English a sentence needs, so they are not linted as raw ids */
export const STAT_ID_PLAIN_WORDS: readonly string[] = ['kills', 'deaths', 'assists', 'level', 'damage', 'healing', 'range', 'streak', 'bounty', 'difficulty', 'res', 'armor', 'resist', 'haste', 'tenacity', 'xp', 'crit'];

/** fields whose string values are never player prose */
export const SKIP_KEYS: readonly string[] = ['$comment', '$schema', 'id', 'icon', 'file', 'files', 'model', 'portrait', 'splash', 'art', 'vfx', 'sfx', 'hitVfx', 'cue', 'tags', 'mask', 'ref', 'color', 'palette'];

export interface CopyHit { path: string; word: string; use: string; text: string }

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${esc(w).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');

/** the raw-stat-id rules from the strings table: id → display name, for ids whose name differs and is not plain English */
export function rawStatIds(strings: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strings)) {
    const m = /^stat\.([A-Za-z]+)\.name$/.exec(k);
    if (!m) continue;
    const id = m[1];
    if (STAT_ID_PLAIN_WORDS.includes(id.toLowerCase()) || id.toLowerCase() === v.trim().toLowerCase()) continue;
    out[id] = v;
  }
  return out;
}

/** every player-prose string in a parsed JSON value, with its path */
export function proseOf(value: unknown, path = '', out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof value === 'string') { if (/\s/.test(value.trim())) out.push({ path, text: value }); }
  else if (Array.isArray(value)) value.forEach((v, i) => proseOf(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SKIP_KEYS.includes(k)) proseOf(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/**
 * Lints player copy. `files` maps a label (a content path, e.g. 'content/queues.json') to its parsed JSON; `strings`
 * is strings.en.json (all of its values are checked). Returns one hit per (string, word).
 */
export function lintPlayerCopy(files: Readonly<Record<string, unknown>>, strings: Readonly<Record<string, string>>): CopyHit[] {
  const rules: [string, string][] = Object.entries(GENRE_WORDS);
  for (const [id, name] of Object.entries(rawStatIds(strings))) rules.push([id, name]);
  // longest phrases first, so 'battle spells' reports once (not also as 'battle spell')
  rules.sort((a, b) => b[0].length - a[0].length);
  const compiled = rules.map(([w, use]) => ({ w, use, re: wordRe(w) }));
  const hits: CopyHit[] = [];
  const check = (path: string, text: string): void => {
    // placeholders ({gold}, {effects.1.stats.omnivamp}) are filled with numbers and names, never read as words
    let rest = text.replace(/\{[^{}]*\}/g, ' ');
    for (const r of compiled) {
      if (!r.re.test(rest)) continue;
      hits.push({ path, word: r.w, use: r.use, text });
      rest = rest.replace(new RegExp(r.re.source, 'giu'), ' ');
    }
  };
  for (const [k, v] of Object.entries(strings)) if (typeof v === 'string') check(`strings.${k}`, v);
  for (const [label, json] of Object.entries(files)) for (const p of proseOf(json)) check(`${label}:${p.path}`, p.text);
  return hits;
}

/** one line per hit, for build logs */
export const formatCopyHit = (h: CopyHit): string => `${h.path}: '${h.word}' in player copy; VALE says '${h.use}' (${h.text.length > 90 ? `${h.text.slice(0, 87)}…` : h.text})`;
