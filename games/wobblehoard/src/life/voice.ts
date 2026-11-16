// Voice planning (LIFE.md 8; D-59): LIFE plans every phrase (which syllables, which pentatonic steps, when, the answer's mirror, the pair
// duet, the sung notes on the sim-time grid); src/audio/creature.ts only synthesises it. A VOICE intent carries the phrase id in `icon` and
// its handle in `a`; the host copies the syllables with lifePhrase(w, handle, out) into SquishAudio.creature's `phrase`. Sim time only: the
// bar lines come from `t` on the 66 BPM grid, never from musicClock (D-66, LF-26). Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents } from '../contracts.ts';
import { SPECIES } from '../data/species.ts';
import { speciesDef } from '../data/catalog.ts';
import { SYL, SALTS, FAMILY_REACT, FLAVOUR, EMOTE, INTENT, LIFE_FLAG } from '../data/life.ts';
import { hashString } from '../core/rng.ts';
import type { LifeWorld } from './world.ts';
import { PHRASE_CAP, pushIntent, F } from './world.ts';

/** Phrase ids (a VOICE intent's `icon`; LIFE 8.3). */
export const PHRASE = { GREET: 1, ANSWER: 2, CHAT: 3, JOY: 4, LOVED: 5, SLEEPY: 6, WISH: 7, GRANTED: 8, SING: 9, HUFF: 10, COMFORT: 11,
  PEEP: 12, THING: 13, DUET: 14, GIGGLE: 15, NOTICE: 16, HUM: 17, PURR: 18 } as const;
/** Sound off (muted, or Voices at 0): the bubble each phrase maps to (LIFE 8.3's table; UI-03 checks it is total). CHAT: one hello bubble on
 *  its first speaker only (the shell shows it for the first CHAT of a moment). Index = phrase id. */
export const PHRASE_BUBBLE: readonly number[] = [0, EMOTE.hello, EMOTE.hello, EMOTE.hello, EMOTE.sparkle, EMOTE.sparkle, EMOTE.zzz, EMOTE.star,
  EMOTE.sparkle, EMOTE.note, EMOTE.puff, EMOTE.snug, EMOTE.sparkle, EMOTE.note, EMOTE.note, EMOTE.giggle, EMOTE.question, EMOTE.snug, EMOTE.snug];
/** Syllable lengths (s; LIFE 8.2). */
export const SYL_LEN: readonly number[] = [0.09, 0.16, 0.18, 0.22, 0.165, 0.5, 0.16, 0.045];
/** 66 BPM on sim time: a beat, an eighth and a bar (s). */
export const BEAT_S = 60 / 66;
export const EIGHTH_S = BEAT_S / 2;
export const BAR_S = BEAT_S * 4;
/** The rest tones a singer takes (root, fifth, ninth folded into the octave: pentatonic steps D 0, A 3, E 1). */
export const REST_TONES: readonly number[] = [0, 3, 1];

const FLAVOUR_SYL: readonly (readonly number[])[] = [
  [SYL.chirp, SYL.coo, SYL.hum], [SYL.chirp, SYL.coo], [SYL.coo, SYL.purr], [SYL.trill, SYL.chitter], [SYL.hum, SYL.coo], [SYL.chirp, SYL.trill],
];
const NS = SPECIES.length;
/** Per species: the motif's 3 syllables and 2 intervals (-2..+2 pentatonic steps), from mulberry32(hashString(id) ^ MOTIF_SALT); the voice
 *  flavour; the species hash (for the pair duet). Built once at module load. */
export const MOTIF_SYL = new Uint8Array(NS * 3);
export const MOTIF_INT = new Int8Array(NS * 2);
export const SPECIES_FLAVOUR = new Uint8Array(NS);
export const SPECIES_HASH = new Uint32Array(NS);
function m32(st: Uint32Array): number {
  const a = (st[0] + 0x6d2b79f5) >>> 0; st[0] = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ST = new Uint32Array(1);
for (let i = 0; i < NS; i++) {
  const id = SPECIES[i], fl = FAMILY_REACT[speciesDef(id).family].flavour;
  SPECIES_FLAVOUR[i] = fl; SPECIES_HASH[i] = hashString(id);
  ST[0] = (SPECIES_HASH[i] ^ SALTS.motif) >>> 0;
  const opts = FLAVOUR_SYL[fl] ?? FLAVOUR_SYL[FLAVOUR.gel];
  for (let k = 0; k < 3; k++) MOTIF_SYL[i * 3 + k] = opts[Math.floor(m32(ST) * opts.length)];
  for (let k = 0; k < 2; k++) MOTIF_INT[i * 2 + k] = Math.floor(m32(ST) * 5) - 2;
}

/** A species' 3-syllable call (the Journal's "Its song") into out (4 floats a syllable: syl, degree, start s, length scale); returns 3. */
export function lifeMotif(speciesIdx: number, out: Float32Array): number {
  const i = speciesIdx < 0 || speciesIdx >= NS ? 0 : speciesIdx;
  let deg = 0, t = 0;
  for (let k = 0; k < 3; k++) {
    if (k > 0) deg += MOTIF_INT[i * 2 + k - 1];
    const syl = MOTIF_SYL[i * 3 + k];
    out[k * 4] = syl; out[k * 4 + 1] = deg; out[k * 4 + 2] = t; out[k * 4 + 3] = 1;
    t += SYL_LEN[syl] + 0.04;
  }
  return 3;
}

/** Copy a planned phrase (a VOICE intent's `a`) into out; returns its syllable count (0 when the handle is unknown). */
export function lifePhrase(w: LifeWorld, intent: number, out: Float32Array): number {
  const h = intent | 0;
  if (h < 0 || h >= PHRASE_CAP) return 0;
  const n = w.phraseN[h];
  for (let j = 0; j < n * 4 && j < out.length; j++) out[j] = w.phrase[h * 16 + j];
  return n;
}

const clampDeg = (d: number): number => (d < -4 ? -4 : d > 4 ? 4 : d);

/** Write syllable k of phrase h. */
function syl(w: LifeWorld, h: number, k: number, s: number, deg: number, at: number, len: number): void {
  const o = h * 16 + k * 4;
  w.phrase[o] = s; w.phrase[o + 1] = clampDeg(deg); w.phrase[o + 2] = at; w.phrase[o + 3] = len;
}

/** Plan a phrase for character `who` into the next handle; w.f[F.T] = its length (s); returns the handle. `partner` is the other voice of a
 *  call and answer or a duet (-1 none); `arg` is the singer index (SING), the bar (SING: 0 or 1) in bits 4+, or the caller's handle (ANSWER). */
export function planPhrase(w: LifeWorld, who: number, phrase: number, partner: number, arg: number): number {
  const h = w.phraseHead; w.phraseHead = (h + 1) % PHRASE_CAP;
  const sp = w.species[who] < NS ? w.species[who] : 0;
  const s0 = MOTIF_SYL[sp * 3], s1 = MOTIF_SYL[sp * 3 + 1], s2 = MOTIF_SYL[sp * 3 + 2];
  const i1 = MOTIF_INT[sp * 2], i2 = MOTIF_INT[sp * 2 + 1];
  let n = 0, t = 0;
  switch (phrase) {
    case PHRASE.GREET: syl(w, h, 0, s0, 0, 0, 1); t = SYL_LEN[s0] + 0.05; syl(w, h, 1, s1, i1, t, 1); t += SYL_LEN[s1]; n = 2; break;
    case PHRASE.ANSWER: { // the caller's rhythm, its contour mirrored, a third or fourth away (LIFE 8.3)
      const cs = partner >= 0 && w.species[partner] < NS ? w.species[partner] : sp;
      const c0 = MOTIF_SYL[cs * 3], c1 = MOTIF_SYL[cs * 3 + 1], ci = MOTIF_INT[cs * 2], off = (arg & 1) === 0 ? 2 : 3;
      syl(w, h, 0, c0, off, 0, 1); t = SYL_LEN[c0] + 0.05; syl(w, h, 1, c1, off - ci, t, 1); t += SYL_LEN[c1]; n = 2; break;
    }
    case PHRASE.CHAT: { const k = 2 + (arg & 1); n = k;
      for (let j = 0; j < k; j++) { const sy = j === 0 ? s0 : j === 1 ? s1 : s2; syl(w, h, j, sy, j === 0 ? 0 : j === 1 ? i1 : i1 + i2, t, 1); t += SYL_LEN[sy] + 0.06; }
      break; }
    case PHRASE.JOY: syl(w, h, 0, s0, 0, 0, 1); t = SYL_LEN[s0] + 0.04; syl(w, h, 1, s1, i1, t, 1); t += SYL_LEN[s1] + 0.04;
      syl(w, h, 2, s2, i1 + i2, t, 1); t += SYL_LEN[s2] + 0.04; syl(w, h, 3, SYL.trill, i1 + i2 + 1, t, 1); t += SYL_LEN[SYL.trill]; n = 4; break;
    case PHRASE.LOVED: syl(w, h, 0, SYL.chirp, 4, 0, 1); t = SYL_LEN[SYL.chirp]; n = 1; break; // an octave up: the audio snap folds +5 steps; 4 is the cap
    case PHRASE.SLEEPY: syl(w, h, 0, SYL.coo, -1, 0, 2); t = SYL_LEN[SYL.coo] * 2; n = 1; break;
    case PHRASE.WISH: syl(w, h, 0, s0, 0, 0, 1); t = SYL_LEN[s0] + 0.05; syl(w, h, 1, s1, i1, t, 1); t += SYL_LEN[s1] + 0.05;
      syl(w, h, 2, SYL.chirp, i1 + 2, t, 1); t += SYL_LEN[SYL.chirp]; n = 3; break;
    case PHRASE.GRANTED: syl(w, h, 0, SYL.trill, 0, 0, 1); t = SYL_LEN[SYL.trill] + 0.05; syl(w, h, 1, SYL.hum, 2, t, 1.2); t += SYL_LEN[SYL.hum] * 1.2; n = 2; break;
    case PHRASE.SING: { // 4 notes on the eighth grid of sim time, on the field's rest tones (8.4)
      const rt = REST_TONES[(arg & 15) % 3];
      syl(w, h, 0, s0, rt, 0, 1.4); syl(w, h, 1, s1, rt + i1, EIGHTH_S * 2, 1.4); syl(w, h, 2, s2, rt, EIGHTH_S * 4, 1.4);
      syl(w, h, 3, s0, rt + i1 + i2, EIGHTH_S * 6, 2); t = EIGHTH_S * 8; n = 4; break;
    }
    case PHRASE.HUFF: syl(w, h, 0, SYL.coo, -2, 0, 1.3); t = SYL_LEN[SYL.coo] * 1.3; n = 1; break; // 5 semitones down before the snap
    case PHRASE.COMFORT: syl(w, h, 0, SYL.coo, 0, 0, 1); t = SYL_LEN[SYL.coo] + 0.1; syl(w, h, 1, SYL.coo, -1, t, 1); t += SYL_LEN[SYL.coo]; n = 2; break;
    case PHRASE.PEEP: syl(w, h, 0, SYL.peep, 0, 0, 1); t = SYL_LEN[SYL.peep]; n = 1; break;
    case PHRASE.THING: syl(w, h, 0, s0, 1, 0, 1); t = SYL_LEN[s0] + 0.05; syl(w, h, 1, s1, 1 + i1, t, 1); t += SYL_LEN[s1] + 0.05;
      syl(w, h, 2, s2, 1 + i1 + i2, t, 1); t += SYL_LEN[s2]; n = 3; break;
    case PHRASE.DUET: { // the pair's own 2-note call (DUET_SALT), in thirds: the second voice two steps up
      const ps = partner >= 0 && w.species[partner] < NS ? w.species[partner] : sp;
      ST[0] = (SPECIES_HASH[sp < ps ? sp : ps] ^ SPECIES_HASH[sp < ps ? ps : sp] ^ SALTS.duet) >>> 0;
      const d0 = Math.floor(m32(ST) * 5) - 2, d1 = Math.floor(m32(ST) * 5) - 2, up = (arg & 1) ? 2 : 0;
      syl(w, h, 0, SYL.hum, d0 + up, 0, 1.5); t = SYL_LEN[SYL.hum] * 1.5 + 0.1; syl(w, h, 1, SYL.hum, d1 + up, t, 2); t += SYL_LEN[SYL.hum] * 2; n = 2; break;
    }
    case PHRASE.GIGGLE: syl(w, h, 0, SYL.trill, 1, 0, 1); t = SYL_LEN[SYL.trill]; n = 1; break;
    case PHRASE.NOTICE: syl(w, h, 0, SYL.chirp, 0, 0, 1); t = SYL_LEN[SYL.chirp]; n = 1; break;
    case PHRASE.HUM: syl(w, h, 0, SYL.hum, (arg & 1) ? 2 : 0, 0, 1.5); t = SYL_LEN[SYL.hum] * 1.5; n = 1; break;
    case PHRASE.PURR: syl(w, h, 0, SYL.purr, (arg & 1) ? 2 : 0, 0, 1.5); t = SYL_LEN[SYL.purr] * 1.5; n = 1; break;
    default: syl(w, h, 0, s0, 0, 0, 1); t = SYL_LEN[s0]; n = 1;
  }
  w.phraseN[h] = n;
  w.f[F.T] = t;
  return h;
}

/** Plan and push a VOICE intent after delayMs (an integer, so nothing is boxed) (class 1 P1, 2 P2, 3 P3 for the budget). Pieces: register 1 and one group voice of `groupN` (<= 3). */
export function emitVoice(w: LifeWorld, s: LifeSnapshot, out: LifeIntents, who: number, phrase: number, delayMs: number, partner: number, arg: number,
  cls: number, groupN: number): boolean {
  if ((s.flags[who] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED)) !== 0) return false;
  const k = pushIntent(w, out, INTENT.VOICE, who);
  if (k < 0) return false;
  const h = planPhrase(w, who, phrase, partner, arg);
  out.icon[k] = phrase; out.a[k] = h; out.b[k] = w.kind[who] === 0 ? 0 : 1; out.c[k] = groupN > 0 ? (groupN > 3 ? 3 : groupN) : 1;
  out.d[k] = w.phraseN[h]; out.e[k] = w.f[F.T]; out.delayS[k] = delayMs * 0.001;
  out.prio[k] = cls === 1 ? 3 : cls === 2 ? 2 : 1;
  const sx = s.sx[who], sy = s.sy[who];
  if (sx === sx) out.prio[k] += 1 - Math.min(1, Math.sqrt((sx - 0.5) * (sx - 0.5) + (sy - 0.5) * (sy - 0.5)) / 0.7071);
  out.groupKey[k] = w.kind[who] === 0 ? -1 : w.group[who];
  return true;
}

/** Seconds from sim time t to the next bar line of the 66 BPM grid (LIFE 8.4: a singer enters on the next sim-time bar line). */
export function toNextBar(t: number): number {
  const b = Math.ceil(t / BAR_S - 1e-9) * BAR_S;
  return b - t;
}
