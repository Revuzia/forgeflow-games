// GENESIS — ARC §0.3, §8.0: the voice of the arc's new text. Every chronicle line whose id starts with heart., tower.,
// defy., covenant., age., legend. or remember., and every string of data/scripture.json: no banned word or phrase (whole
// word, case-insensitive), no "God" used as a name mid-sentence, every line at most 140 characters, every sentence
// starting with a capital letter (a {placeholder} counts: it is filled with a name). Stage C adds query('story') output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BANNED_WORDS = ['babel', 'babylon', 'shinar', 'eden', 'adam', 'eve', 'noah', 'ararat', 'nimrod', 'abraham', 'abram', 'isaac',
  'jacob', 'israel', 'moses', 'sinai', 'canaan', 'egypt', 'jerusalem', 'yahweh', 'jehovah', 'elohim', 'adonai', 'allah', 'jesus',
  'christ', 'satan', 'lucifer', 'genesis', 'thee', 'thou', 'thy', 'thine', 'unto', 'begat', 'behold', 'smite', 'verily', 'hath',
  'doth', 'garden'];
const BANNED_PHRASES = [/a tower whose top touches the sky/i, /["“]let us build a tower to the heavens/i, /set (my|your) bow in the clouds?/i,
  /set a bow of colou?rs/i, /\blet there be\b/i, /\bin the beginning\b/i, /\bbe fruitful\b/i];
const PREFIXES = ['heart.', 'tower.', 'defy.', 'covenant.', 'age.', 'legend.', 'remember.'];

/** every problem of one line of new text ('' when it is clean) */
export function lintLine(s: string): string[] {
  const out: string[] = [];
  if (s.length > 140) out.push(`over 140 characters (${s.length})`);
  const words = s.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const w of words) if (BANNED_WORDS.includes(w)) out.push(`banned word "${w}"`);
  for (const re of BANNED_PHRASES) if (re.test(s)) out.push(`banned phrase ${re}`);
  if (/[a-z,;:]\s+God\b/.test(s)) out.push('"God" used as a name');
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    const c = sentence.trim().replace(/^["“'(]/, '')[0];
    if (c && c !== '{' && c !== c.toUpperCase()) out.push(`sentence starts lower case: "${sentence.slice(0, 30)}"`);
  }
  return out;
}

function strings(v: unknown, path: string, out: [string, string][]): void {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((e, i) => strings(e, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) if (!k.startsWith('_')) strings(e, `${path}.${k}`, out);
}

test('the lint catches what it must', () => {
  assert.ok(lintLine('They built a tower in Babel.').length);
  assert.ok(lintLine('Let there be light.').length);
  assert.ok(lintLine('and then God spoke.').length);
  assert.ok(lintLine('x'.repeat(141)).length);
  assert.ok(lintLine('they wept.').length);
  assert.deepEqual(lintLine('The god sent rain. {settlement} gave thanks.'), []);
});

test('ARC chronicle lines (events.json) keep the voice', () => {
  const ev = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8')) as { templates: { id: string; text: string[] }[] };
  const bad: string[] = [];
  let n = 0;
  for (const t of ev.templates) {
    if (!PREFIXES.some((p) => t.id.startsWith(p))) continue;
    for (const line of t.text) { n++; for (const e of lintLine(line)) bad.push(`${t.id}: ${e}`); }
  }
  assert.ok(n >= 8, `ARC lines found: ${n}`);
  assert.deepEqual(bad, []);
});

test('data/scripture.json keeps the voice', () => {
  const sc = JSON.parse(readFileSync(new URL('../src/data/scripture.json', import.meta.url), 'utf8')) as unknown;
  const all: [string, string][] = [];
  strings(sc, 'scripture', all);
  const bad: string[] = [];
  for (const [path, s] of all) for (const e of lintLine(s)) {
    // captions, share words and reason words are fragments, not sentences: only the word lists apply to them
    if (/^sentence starts lower case/.test(e) && /\.(share|prideWhy|remember)\b/.test(path)) continue;
    bad.push(`${path}: ${e}`);
  }
  assert.deepEqual(bad, []);
});
