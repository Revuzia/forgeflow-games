// GENESIS — names from phonologies (CONTRACT.md §8.5, names.json): personal names, settlement names with a site feature
// ("Aru by the Falls"), and language drift. A language is (phonology, seed): the seed reweights the phonology's sounds
// (some favoured, some dropped), so every settlement speaks its own variant; a split-off settlement gets a seed derived
// from its parent's, so its names keep a family resemblance but drift. Everything is a stateless hash of seeds: the same
// agent always has the same name, and nothing here consumes a random stream.

import type { Content, PhonologyDef } from '../content.ts';
import { hash32, hashFloat, hashStr } from '../core/rng.ts';

/** pick from a list with language-seeded weights (index 0 favoured; a few sounds dropped per language) */
function pick(list: string[], lang: number, salt: number, roll: number): string {
  if (list.length === 1) return list[0];
  let total = 0;
  const w = WEIGHTS;
  w.length = list.length;
  for (let k = 0; k < list.length; k++) {
    let x = 1 / (1 + k * 0.12);
    const h = hashFloat(lang, salt, k, 0x1a96);
    if (k > 0 && h < 0.14) x = 0; // this language does not use the sound
    else x *= 0.45 + 1.1 * h;
    w[k] = x;
    total += x;
  }
  let r = roll * total;
  for (let k = 0; k < list.length; k++) {
    r -= w[k];
    if (r <= 0 && w[k] > 0) return list[k];
  }
  return list[0];
}
const WEIGHTS: number[] = [];

function capitalise(s: string, sep: string): string {
  const up = (x: string) => (x.length ? x[0].toUpperCase() + x.slice(1) : x);
  if (sep === '-') return s.split('-').map(up).join('-');
  return up(s);
}

/** a word of n syllables in a language */
export function word(ph: PhonologyDef, lang: number, seed: number, nMin: number, nMax: number): string {
  const n = nMin + (hash32(seed, lang, 0x5111) % Math.max(1, nMax - nMin + 1));
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const on = pick(ph.onsets, lang, 1, hashFloat(seed, i, 1, lang));
    const vo = pick(ph.vowels, lang, 2, hashFloat(seed, i, 2, lang));
    // codas mostly close the last syllable
    const codaRoll = hashFloat(seed, i, 3, lang);
    const co = i === n - 1 || codaRoll < 0.25 ? pick(ph.codas, lang, 3, hashFloat(seed, i, 4, lang)) : '';
    let syl = on + vo + co;
    // avoid a doubled vowel across the join ("aa" + "a")
    if (parts.length && ph.sep === '' && /[aeiouy]$/.test(parts[parts.length - 1]) && /^[aeiouy]/.test(syl)) syl = (ph.onsets.find((x) => x) ?? 'n') + syl;
    parts.push(syl);
  }
  let s = parts.join(ph.sep);
  if (s.length < 2) s += pick(ph.vowels, lang, 5, hashFloat(seed, 9, lang));
  return capitalise(s, ph.sep);
}

export function phonologyOf(c: Content, species: number): PhonologyDef {
  const sp = c.species.list[species];
  return c.phonologies.find(sp?.phonology ?? '') ?? c.phonologies.list[0];
}

/** a person's given name */
export function personalName(c: Content, species: number, lang: number, seed: number): string {
  const ph = phonologyOf(c, species);
  return word(ph, lang, seed, ph.personal[0], ph.personal[1]);
}

/** the root word of a settlement name */
export function placeRoot(c: Content, species: number, lang: number, seed: number): string {
  const ph = phonologyOf(c, species);
  return word(ph, lang, seed ^ 0x51ab, ph.syllables[0], ph.syllables[1]);
}

/** "Aru by the Falls" (or "Kix'tu Wet-Chamber" for a phonology whose features are compound nouns) */
export function settlementName(c: Content, species: number, lang: number, seed: number, feature: string): string {
  const ph = phonologyOf(c, species);
  const root = placeRoot(c, species, lang, seed);
  const phrase = ph.features[feature] ?? ph.features.plain ?? '';
  if (!phrase) return root;
  return `${root} ${phrase}`;
}

/** a drifted language seed for a settlement split off from `parentLang` */
export function driftLanguage(parentLang: number, childId: number): number {
  return hash32(parentLang, childId, 0xd21f7) >>> 0;
}

/** a fresh language seed for a species' first settlement on a planet */
export function rootLanguage(species: string, planetSeed: number): number {
  return hash32(hashStr(species), planetSeed, 0x1a9) >>> 0;
}
