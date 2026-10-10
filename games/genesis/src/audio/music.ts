// GENESIS — emergent culture music: the composer (CONTRACT §17). Pure and deterministic: no WebAudio, no clocks.
//
// Each culture gets a STYLE from what the sim says about it (SettlementView.music: mode, tempo and instrument set; plus
// its alignment, era, war, golden / dark age, size and tongue): a tonic, a mode, a metre, a swing, a form (AABA …),
// chord progressions drawn from the mode's own palette (dorian's major IV, phrygian's flat II, mixolydian's flat VII),
// motifs (a rhythm cell from a Euclidean pattern and a stepwise contour) and an ensemble by era — drums and flutes →
// lyres and strings → brass and organ → synth. `composeBar(style, bar)` then realises any bar of the culture's endless
// piece as note events: the same culture always plays the same tune (the seed is its language, so towns that split
// from one people keep a family resemblance while their tongues drift apart), every pitched note lies in the mode, and
// nothing depends on when or how often it is asked. `musicplayer.ts` schedules the events onto `instruments.ts`.
//
// The orbital score (set 4) is the same machinery with a slow lydian progression of glassy pads and sparse bells.

import { hash32, hashUnit, rng } from './dsp.ts';

// ───────────────────────────── theory ─────────────────────────────

export const MODE_NAMES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] as const;
const IONIAN_STEPS = [2, 2, 1, 2, 2, 2, 1];

function wrap7(m: number): number { return ((Math.round(m) % 7) + 7) % 7; }

/** the mode's whole/half steps: the church modes are rotations of the major scale */
export function modeSteps(mode: number): number[] {
  const m = wrap7(mode);
  return [...IONIAN_STEPS.slice(m), ...IONIAN_STEPS.slice(0, m)];
}

/** semitones above the tonic of the seven degrees */
export function modeIntervals(mode: number): number[] {
  const s = modeSteps(mode);
  const out = [0];
  for (let i = 0; i < 6; i++) out.push(out[i] + s[i]);
  return out;
}

/** MIDI note of a scale degree (0 = tonic; negative and ≥ 7 wrap into lower / higher octaves) */
export function degreeToMidi(tonic: number, mode: number, degree: number): number {
  const iv = modeIntervals(mode);
  const d = Math.round(degree);
  const o = Math.floor(d / 7);
  return tonic + 12 * o + iv[d - o * 7];
}

/** pitch classes (0..11) of the scale */
export function pitchClasses(tonic: number, mode: number): number[] {
  return modeIntervals(mode).map((i) => (((tonic + i) % 12) + 12) % 12).sort((a, b) => a - b);
}

export function inScale(tonic: number, mode: number, midi: number): boolean {
  return pitchClasses(tonic, mode).includes(((Math.round(midi) % 12) + 12) % 12);
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Euclidean rhythm: k onsets spread as evenly as possible over n steps (Bjorklund's patterns, up to rotation) */
export function euclid(k: number, n: number, rotate = 0): boolean[] {
  const out: boolean[] = [];
  const kk = Math.max(0, Math.min(n, Math.round(k)));
  for (let i = 0; i < n; i++) {
    const j = (((i + rotate) % n) + n) % n;
    out.push(kk > 0 && (j * kk) % n < kk);
  }
  return out;
}

// ───────────────────────────── ensembles ─────────────────────────────

export type InstrumentId =
  | 'flute' | 'voice' | 'drone' | 'lyre' | 'fiddle' | 'strings' | 'harp' | 'horn' | 'brass' | 'organ' | 'pizz'
  | 'lead' | 'arp' | 'synthpad' | 'subbass' | 'bell' | 'glass' | 'glasspad';
export type PercId = 'logdrum' | 'framedrum' | 'shaker' | 'tabor' | 'timpani' | 'snare' | 'kick' | 'hat' | 'wardrum' | 'clap';

export interface Ensemble {
  name: string;
  melody: InstrumentId;
  counter: InstrumentId;
  pad: InstrumentId;
  bass: InstrumentId | null;
  perc: PercId[];
  /** octaves above the style's tonic the melody sits */
  melodyOctave: number;
}

/** instrument sets by era (the sim's `music.instruments`): drums/flutes → lyres/strings → brass/organ → synth; 4 = orbit */
export const ENSEMBLES: readonly Ensemble[] = [
  { name: 'drums and flutes', melody: 'flute', counter: 'voice', pad: 'drone', bass: null, perc: ['logdrum', 'framedrum', 'shaker'], melodyOctave: 1 },
  { name: 'lyres and strings', melody: 'lyre', counter: 'fiddle', pad: 'strings', bass: 'harp', perc: ['tabor', 'framedrum'], melodyOctave: 0 },
  { name: 'brass and organ', melody: 'horn', counter: 'brass', pad: 'organ', bass: 'pizz', perc: ['timpani', 'snare'], melodyOctave: 0 },
  { name: 'synth', melody: 'lead', counter: 'arp', pad: 'synthpad', bass: 'subbass', perc: ['kick', 'snare', 'hat'], melodyOctave: 1 },
  { name: 'orbital score', melody: 'bell', counter: 'glass', pad: 'glasspad', bass: 'subbass', perc: [], melodyOctave: 1 },
];
export const ORBITAL_SET = 4;

const ERAS = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'];

/** era label → instrument set, matching the sim's culture.musicOf (era ≤ clay: 0, ≤ medieval: 1, ≤ steam: 2, else 3) */
export function setOfEra(era: string | undefined): number {
  const i = ERAS.indexOf(era ?? 'stone');
  const e = i < 0 ? 0 : i;
  return e <= 2 ? 0 : e <= 6 ? 1 : e <= 8 ? 2 : 3;
}

export function eraIndex(era: string | undefined): number {
  const i = ERAS.indexOf(era ?? 'stone');
  return i < 0 ? 0 : i;
}

/** without the sim's hint: benevolent → lydian / ionian, fearful → phrygian / locrian, between → dorian / mixolydian / aeolian */
export function modeOfAlignment(alignment: number, seed: number): number {
  if (alignment > 0.35) return seed % 2 === 0 ? 3 : 0;
  if (alignment < -0.35) return seed % 2 === 0 ? 2 : 6;
  return [1, 4, 5][seed % 3];
}

// ───────────────────────────── styles ─────────────────────────────

/** what the composer needs to know about a culture (SettlementView supplies all of it) */
export interface CultureMusic {
  /** settlement id (fallback seed) */
  id: number;
  /** language id: the tune family */
  language?: number;
  species?: number;
  /** the sim's hint (SettlementView.music) */
  mode?: number;
  tempo?: number;
  instruments?: number;
  alignment?: number;
  era?: string;
  war?: boolean;
  /** 'golden' | 'dark' | '' */
  age?: string;
  population?: number;
}

export interface Motif {
  /** onsets in sub-steps of the bar */
  on: number[];
  /** lengths in sub-steps */
  len: number[];
  /** degree offsets from the bar's anchor (a contour) */
  step: number[];
}

export interface MusicStyle {
  /** changes when anything audible about the style changes (players re-read the style at bar lines) */
  key: string;
  seed: number;
  set: number;
  ensemble: Ensemble;
  mode: number;
  /** MIDI note of the tonic (the pad register; the melody sits `ensemble.melodyOctave` octaves higher) */
  tonic: number;
  tempo: number;
  /** beats per bar and sub-steps per beat (2 = straight, 3 = compound / triplet feel) */
  beats: number;
  sub: number;
  /** 0..0.3 of a sub-step: lilt on the off-steps */
  swing: number;
  /** 0..1: how busy the melody is */
  density: number;
  /** 0..1: how busy the drums are */
  perc: number;
  /** 0..1: dark (fearful) .. bright (benevolent) — timbre and register */
  brightness: number;
  war: boolean;
  age: string;
  /** 1..4: how many parts play (a band hums a tune; a city has an ensemble) */
  voices: number;
  /** section order as letter indices (0 = A, 1 = B, 2 = C), 8 bars per section */
  form: number[];
  /** per letter: the chord degree of each of the 8 bars */
  progressions: number[][];
  /** per letter: the motif */
  motifs: Motif[];
}

export interface NoteEvent {
  /** start, in beats from the bar line */
  t: number;
  /** duration in beats */
  d: number;
  /** MIDI note (percussion: a nominal pitch the drum is tuned to) */
  midi: number;
  /** velocity 0..1 */
  v: number;
  part: 'melody' | 'counter' | 'pad' | 'bass' | 'perc';
  inst: InstrumentId | PercId;
}

/** chord palettes per mode (scale degrees of the chord roots, most characteristic first) and the cadence chord */
const PALETTE: { chords: number[]; cadence: number[] }[] = [
  { chords: [0, 3, 4, 5, 1], cadence: [4, 3] },     // ionian: I IV V vi ii
  { chords: [0, 3, 6, 2, 4], cadence: [3, 6] },     // dorian: i IV VII III v
  { chords: [0, 1, 6, 5, 3], cadence: [1, 6] },     // phrygian: i II vii VI iv
  { chords: [0, 1, 4, 5, 2], cadence: [1, 4] },     // lydian: I II V vi iii
  { chords: [0, 6, 3, 4, 1], cadence: [6, 3] },     // mixolydian: I VII IV v ii
  { chords: [0, 5, 6, 3, 4], cadence: [6, 4] },     // aeolian: i VI VII iv v
  { chords: [0, 1, 6, 3, 5], cadence: [1, 6] },     // locrian: i II vii iv VI
];

const FORMS = [[0, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 1], [0, 1, 0, 2], [0, 0, 0, 1], [0, 1, 2, 0]];

function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }

function pickWeighted(r: () => number, items: number[]): number {
  // the palette's first entries are the mode's signature: weight them up
  let tot = 0;
  for (let i = 0; i < items.length; i++) tot += 1 / (1 + i * 0.6);
  let x = r() * tot;
  for (let i = 0; i < items.length; i++) { x -= 1 / (1 + i * 0.6); if (x <= 0) return items[i]; }
  return items[items.length - 1];
}

function makeProgression(r: () => number, mode: number, letter: number, hold2: boolean): number[] {
  const p = PALETTE[wrap7(mode)];
  const out: number[] = [];
  const start = letter === 0 ? 0 : p.chords[1 + Math.floor(r() * Math.min(2, p.chords.length - 1))];
  out.push(start);
  for (let b = 1; b < 7; b++) {
    if (hold2 && b % 2 === 1) { out.push(out[b - 1]); continue; }
    let c = pickWeighted(r, p.chords);
    if (c === out[b - 1] && r() < 0.6) c = pickWeighted(r, p.chords);
    out.push(c);
  }
  out.push(p.cadence[Math.floor(r() * p.cadence.length)]);
  return out;
}

function makeMotif(r: () => number, steps: number, density: number): Motif {
  const k = clamp(Math.round(steps * (0.28 + density * 0.4)), 2, steps);
  const pattern = euclid(k, steps, Math.floor(r() * steps));
  // a phrase starts on the downbeat
  if (!pattern[0]) {
    const first = pattern.indexOf(true);
    if (first > 0) { pattern[first] = false; pattern[0] = true; }
  }
  const on: number[] = [];
  for (let i = 0; i < steps; i++) if (pattern[i]) on.push(i);
  const len = on.map((o, i) => (i + 1 < on.length ? on[i + 1] : steps) - o);
  const step: number[] = [];
  let deg = [0, 2, 4][Math.floor(r() * 3)];
  for (let i = 0; i < on.length; i++) {
    step.push(deg);
    // mostly steps, some leaps, a pull back toward the middle of the range
    const x = r();
    let mv = x < 0.32 ? 1 : x < 0.64 ? -1 : x < 0.76 ? 2 : x < 0.88 ? -2 : x < 0.94 ? 0 : (r() < 0.5 ? 3 : -3);
    if (deg + mv > 7 || deg + mv < -3) mv = -mv;
    deg += mv;
  }
  return { on, len, step };
}

/** the style of a culture (pure; same input → same style) */
export function styleFor(c: CultureMusic): MusicStyle {
  const lang = c.language ?? c.id;
  const seed = hash32(lang, c.species ?? 0, 0x6d75736b);
  const r = rng(seed);
  const set = c.instruments != null ? clamp(Math.round(c.instruments), 0, 3) : setOfEra(c.era);
  const align = clamp(c.alignment ?? 0, -1, 1);
  const mode = c.mode != null ? wrap7(c.mode) : modeOfAlignment(align, seed);
  const war = !!c.war;
  const age = c.age ?? '';
  const tempo = clamp(Math.round(c.tempo ?? 66 + eraIndex(c.era) * 6 + (age === 'golden' ? 10 : age === 'dark' ? -8 : 0) + (war ? 16 : 0)), 40, 184);
  const mr = r();
  const beats = set === 3 ? (mr < 0.85 ? 4 : 3) : mr < 0.5 ? 4 : mr < 0.84 ? 3 : 5;
  const sub = beats !== 3 && set <= 1 && r() < 0.3 ? 3 : 2;
  const swing = sub === 2 && set <= 1 ? r() * 0.2 : 0;
  const brightness = clamp(0.5 + align * 0.5, 0, 1);
  const pop = c.population ?? 20;
  const voices = pop < 12 ? 1 : pop < 60 ? 2 : pop < 250 ? 3 : 4;
  const density = clamp(0.4 + r() * 0.35 + (age === 'golden' ? 0.1 : age === 'dark' ? -0.15 : 0), 0.15, 0.95);
  const perc = clamp(0.3 + r() * 0.25 + (war ? 0.3 : 0) + (align < -0.35 ? 0.1 : 0) - (age === 'dark' ? 0.15 : 0), 0.1, 1);
  // the tonic: a register for the tongue, a little higher for bright cultures, lower for fearful ones
  const tonic = 50 + ((seed >>> 9) % 10) + (brightness > 0.7 ? 2 : 0) - (align < -0.35 ? 2 : 0);
  const form = FORMS[Math.floor(r() * FORMS.length)];
  const letters = Math.max(...form) + 1;
  const hold2 = tempo > 112;
  const progressions: number[][] = [];
  const motifs: Motif[] = [];
  for (let l = 0; l < letters; l++) {
    progressions.push(makeProgression(r, mode, l, hold2));
    motifs.push(makeMotif(r, beats * sub, density));
  }
  const key = `${seed}:${set}:${mode}:${tempo}:${war ? 1 : 0}:${age}:${voices}:${Math.round(brightness * 10)}`;
  return {
    key, seed, set, ensemble: ENSEMBLES[set], mode, tonic, tempo, beats, sub, swing, density, perc, brightness, war, age,
    voices, form, progressions, motifs,
  };
}

/** the orbital score's style: a slow lydian / ionian progression of glass pads and bells (seeded by the star) */
export function orbitalStyle(seed: number): MusicStyle {
  const s = hash32(seed, 0x6f726269);
  const r = rng(s);
  const mode = r() < 0.65 ? 3 : 0;
  const tonic = 48 + (s % 7);
  const tempo = 46 + Math.floor(r() * 10);
  const prog = [0, 0, 1, 1, 4, 4, 5, 5].map((d, i) => (i >= 4 && r() < 0.3 ? [0, 3, 5][Math.floor(r() * 3)] : d));
  const prog2 = [5, 5, 3, 3, 0, 0, 1, 1];
  return {
    key: `orbit:${s}`, seed: s, set: ORBITAL_SET, ensemble: ENSEMBLES[ORBITAL_SET], mode, tonic, tempo, beats: 4, sub: 2,
    swing: 0, density: 0.35, perc: 0, brightness: 0.75, war: false, age: '', voices: 3, form: [0, 0, 1, 0],
    progressions: [prog, prog2], motifs: [makeMotif(r, 8, 0.2), makeMotif(r, 8, 0.2)],
  };
}

export function barSeconds(s: MusicStyle): number {
  return (s.beats * 60) / s.tempo;
}

export function describeStyle(s: MusicStyle): string {
  return `${MODE_NAMES[s.mode]} · ${s.tempo} bpm · ${s.beats}/${s.sub === 3 ? '8 compound' : '4'} · ${s.ensemble.name}`;
}

// ───────────────────────────── composing ─────────────────────────────

/** fold a chord degree into the octave around the tonic so melodies anchor near the middle of their range */
function foldDegree(d: number, lo = -2): number {
  let x = d;
  while (x < lo) x += 7;
  while (x >= lo + 7) x -= 7;
  return x;
}

/** nearest chord tone (root / third / fifth of the chord on `chord`) to degree `d` */
function snapToChord(d: number, chord: number): number {
  let best = d, bd = Infinity;
  for (let o = -2; o <= 2; o++) for (const t of [0, 2, 4]) {
    const c = chord + t + 7 * o;
    const dist = Math.abs(c - d);
    if (dist < bd || (dist === bd && c < best)) { bd = dist; best = c; }
  }
  return best;
}

function letterOf(s: MusicStyle, bar: number): { letter: number; bi: number } {
  const b = Math.max(0, Math.floor(bar));
  const sec = Math.floor(b / 8);
  return { letter: s.form[sec % s.form.length], bi: b % 8 };
}

/** the chord degree under a bar */
export function chordOf(s: MusicStyle, bar: number): number {
  const { letter, bi } = letterOf(s, bar);
  return s.progressions[Math.min(letter, s.progressions.length - 1)][bi];
}

/**
 * Every note of one bar of the culture's piece. Pure: depends only on (style, bar). Bars 0–1 are the intro (the
 * drone / pad and the drums begin, the tune enters on bar 2).
 */
export function composeBar(s: MusicStyle, bar: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (s.set === ORBITAL_SET) { composeOrbital(s, bar, out); return out; }
  const { letter, bi } = letterOf(s, bar);
  const L = Math.min(letter, s.progressions.length - 1);
  const chord = s.progressions[L][bi];
  const ens = s.ensemble;
  const steps = s.beats * s.sub;
  const sb = 1 / s.sub;
  const at = (k: number): number => k * sb + (s.sub === 2 && k % 2 === 1 ? s.swing * sb : 0);
  const mt = s.tonic + 12 * ens.melodyOctave;
  const pitch = (deg: number, base: number): number => degreeToMidi(base, s.mode, deg);
  const u = (slot: number): number => hashUnit(s.seed, bar, slot);
  const intro = bar < 2;

  // ── melody ──
  const rest = intro || (bi !== 0 && bi !== 4 && u(1) < (1 - s.density) * 0.3);
  if (!rest) {
    const anchor = foldDegree(chord);
    if (bi === 3 || bi === 7) {
      // cadence: approach from above, land on a chord tone and hold it
      const land = bi === 7 ? snapToChord(foldDegree(0), chord) : snapToChord(anchor + 2, chord);
      const appr = land + (u(2) < 0.5 ? 1 : 2);
      const landAt = s.beats >= 4 ? 2 : 1;
      out.push({ t: 0, d: landAt * 0.95, midi: pitch(appr, mt), v: 0.78, part: 'melody', inst: ens.melody });
      if (landAt >= 2 && u(3) < s.density) out.push({ t: 1, d: 0.95, midi: pitch(appr - 1, mt), v: 0.7, part: 'melody', inst: ens.melody });
      out.push({ t: landAt, d: (s.beats - landAt) * 0.97, midi: pitch(land, mt), v: 0.85, part: 'melody', inst: ens.melody });
    } else {
      const m = s.motifs[L];
      const varK = bi % 4; // 0 statement, 1 restated over the new chord, 2 inverted
      const shift = varK === 1 && u(4) < 0.5 ? 1 : 0;
      for (let i = 0; i < m.on.length; i++) {
        let deg = anchor + (varK === 2 ? -m.step[i] + 2 * m.step[0] : m.step[i]) + shift;
        const on = m.on[i];
        const strong = on % s.sub === 0 && (on / s.sub) % 2 === 0;
        if (strong) deg = snapToChord(deg, chord);
        deg = clamp(deg, -4, 10);
        // a golden age ornaments: an upper neighbour before some long notes
        if (s.age === 'golden' && m.len[i] >= 2 && u(10 + i) < 0.3) {
          out.push({ t: at(on), d: sb * 0.5, midi: pitch(deg + 1, mt), v: 0.55, part: 'melody', inst: ens.melody });
          out.push({ t: at(on) + sb * 0.5, d: (m.len[i] - 0.5) * sb * 0.9, midi: pitch(deg, mt), v: 0.72, part: 'melody', inst: ens.melody });
          continue;
        }
        const accent = on === 0 ? 0.9 : strong ? 0.8 : on % s.sub === 0 ? 0.72 : 0.62;
        const legato = s.set === 0 || s.set === 1 ? 0.92 : 0.8;
        out.push({ t: at(on), d: m.len[i] * sb * legato, midi: pitch(deg, mt), v: clamp(accent + (u(20 + i) - 0.5) * 0.1, 0.3, 1), part: 'melody', inst: ens.melody });
      }
    }
  }

  // ── pad / drone ──
  const pt = s.tonic - 12;
  if (s.set === 0) {
    // the drone does not follow the chords: tonic and fifth, every bar
    out.push({ t: 0, d: s.beats, midi: pitch(0, pt), v: 0.5, part: 'pad', inst: 'drone' });
    if (s.voices >= 2) out.push({ t: 0, d: s.beats, midi: pitch(4, pt), v: 0.38, part: 'pad', inst: 'drone' });
  } else {
    const root = foldDegree(chord, 0);
    const v = s.set === 1 ? 0.42 : s.set === 2 ? 0.5 : 0.4;
    out.push({ t: 0, d: s.beats, midi: pitch(root, pt), v, part: 'pad', inst: ens.pad });
    out.push({ t: 0, d: s.beats, midi: pitch(root + 2, pt), v: v * 0.9, part: 'pad', inst: ens.pad });
    out.push({ t: 0, d: s.beats, midi: pitch(root + 4, pt), v: v * 0.85, part: 'pad', inst: ens.pad });
    if (s.set === 3 && s.voices >= 3) out.push({ t: 0, d: s.beats, midi: pitch(root + 8, pt), v: v * 0.6, part: 'pad', inst: ens.pad });
    if (s.set === 2) out.push({ t: 0, d: s.beats, midi: pitch(root - 7, pt), v: v * 0.7, part: 'pad', inst: ens.pad });
  }

  // ── counter line ──
  if (!intro && (s.voices >= 2 || s.age === 'golden')) {
    const root = foldDegree(chord, 0);
    const ct = s.tonic;
    if (s.set === 0) {
      // a hummed or chanted line on the chord's third and fifth
      out.push({ t: 0, d: s.beats * 0.5, midi: pitch(root + 2, ct), v: 0.42, part: 'counter', inst: 'voice' });
      out.push({ t: s.beats * 0.5, d: s.beats * 0.48, midi: pitch(root + 4, ct), v: 0.38, part: 'counter', inst: 'voice' });
    } else if (s.set === 1) {
      const half = Math.floor(s.beats / 2) || 1;
      out.push({ t: 0, d: half * 0.95, midi: pitch(root + 4, ct), v: 0.45, part: 'counter', inst: 'fiddle' });
      out.push({ t: half, d: (s.beats - half) * 0.95, midi: pitch(root + (u(30) < 0.5 ? 2 : 5), ct), v: 0.42, part: 'counter', inst: 'fiddle' });
    } else if (s.set === 2) {
      for (let b = 0; b < s.beats; b += 2) {
        out.push({ t: b, d: 0.6, midi: pitch(root + 2, ct), v: 0.5, part: 'counter', inst: 'brass' });
        out.push({ t: b, d: 0.6, midi: pitch(root + 4, ct), v: 0.45, part: 'counter', inst: 'brass' });
      }
    } else {
      // an arpeggio of the chord in sixteenths, up or down by the culture's seed
      const tones = [0, 2, 4, 7, 9].map((x) => root + x);
      const down = (s.seed & 1) === 1;
      for (let k = 0; k < steps * 2; k++) {
        const i = k % tones.length;
        const deg = down ? tones[tones.length - 1 - i] : tones[i];
        out.push({ t: k * sb * 0.5, d: sb * 0.4, midi: pitch(deg, ct), v: k % 4 === 0 ? 0.5 : 0.36, part: 'counter', inst: 'arp' });
      }
    }
  }

  // ── bass ──
  if (ens.bass) {
    const root = foldDegree(chord, 0);
    // plucked and bowed basses sit an octave below the pads (a harp string at 40 Hz is mud); only the synth's sub goes lower
    const bt = s.set === 3 ? s.tonic - 24 : s.tonic - 12;
    out.push({ t: 0, d: s.set === 3 ? s.beats * 0.95 : 1.5, midi: pitch(root, bt), v: 0.7, part: 'bass', inst: ens.bass });
    if (s.set !== 3 && s.beats >= 3) {
      const mid = Math.floor(s.beats / 2);
      out.push({ t: mid, d: 1.2, midi: pitch(root + (u(40) < 0.6 ? 4 : 0), bt), v: 0.58, part: 'bass', inst: ens.bass });
    }
    if (s.set === 3) {
      const hits = euclid(3, steps, (s.seed >>> 3) % steps);
      for (let k = 1; k < steps; k++) if (hits[k]) out.push({ t: at(k), d: sb * 0.8, midi: pitch(root, bt), v: 0.55, part: 'bass', inst: ens.bass });
    }
  }

  // ── percussion ──
  const fearful = s.brightness < 0.3;
  ens.perc.forEach((p, j) => {
    // fearful cultures drop the light shaker and lean on the deep drum
    if (fearful && (p === 'shaker' || p === 'hat') && s.perc < 0.6) return;
    const share = j === 0 ? 0.42 : j === 1 ? 0.3 : 0.65;
    const k = Math.max(1, Math.round(steps * s.perc * share * (intro ? 0.6 : 1)));
    const pat = euclid(k, steps, j === 0 ? 0 : (s.seed >>> (4 + j * 3)) % steps);
    if (j === 0) pat[0] = true;
    for (let i = 0; i < steps; i++) {
      if (!pat[i]) continue;
      const down = i === 0, onBeat = i % s.sub === 0;
      const v = (down ? 1 : onBeat ? 0.78 : 0.52) * (p === 'shaker' || p === 'hat' ? 0.5 : 1) * (fearful && j === 0 ? 1.1 : 1);
      out.push({ t: at(i), d: sb, midi: percPitch(p, s), v: clamp(v * (0.9 + 0.2 * u(50 + i + j * 32)), 0.2, 1), part: 'perc', inst: p });
    }
  });
  if (s.war) {
    // war drums under everything, and a roll into every eighth bar
    out.push({ t: 0, d: 1, midi: 36, v: 1, part: 'perc', inst: 'wardrum' });
    if (s.beats >= 3) out.push({ t: Math.floor(s.beats / 2), d: 1, midi: 36, v: 0.85, part: 'perc', inst: 'wardrum' });
    if (bi === 7) for (let i = 0; i < 4; i++) out.push({ t: s.beats - 1 + i * 0.25, d: 0.25, midi: 38, v: 0.6 + i * 0.1, part: 'perc', inst: 'wardrum' });
  }
  return out;
}

function percPitch(p: PercId, s: MusicStyle): number {
  switch (p) {
    case 'logdrum': return s.tonic + 7;
    case 'timpani': return s.tonic - 24;
    case 'framedrum': return 45;
    case 'tabor': return 52;
    case 'kick': return 33;
    case 'wardrum': return 36;
    default: return 60;
  }
}

function composeOrbital(s: MusicStyle, bar: number, out: NoteEvent[]): void {
  const { letter, bi } = letterOf(s, bar);
  const chord = s.progressions[Math.min(letter, s.progressions.length - 1)][bi];
  const u = (slot: number): number => hashUnit(s.seed, bar, slot);
  const pitch = (deg: number, base: number): number => degreeToMidi(base, s.mode, deg);
  const root = foldDegree(chord, 0);
  // pads change every two bars and ring across both
  if (bi % 2 === 0) {
    const pt = s.tonic - 12;
    for (const [x, v] of [[0, 0.34], [2, 0.3], [4, 0.28], [6, 0.18]] as [number, number][]) {
      out.push({ t: 0, d: s.beats * 2, midi: pitch(root + x, pt), v, part: 'pad', inst: 'glasspad' });
    }
  }
  if (bi % 4 === 0) out.push({ t: 0, d: s.beats * 4, midi: pitch(0, s.tonic - 12), v: 0.3, part: 'bass', inst: 'subbass' });
  // sparse bells on the chord and its ninth, high and far apart
  const n = 1 + Math.floor(u(1) * 2.6);
  for (let i = 0; i < n; i++) {
    const beat = Math.floor(u(2 + i) * s.beats * 2) / 2;
    const deg = root + [0, 2, 4, 8, 7][Math.floor(u(10 + i) * 5)] + (u(20 + i) < 0.4 ? 7 : 0);
    out.push({ t: beat, d: 2.5, midi: pitch(deg, s.tonic + 12), v: 0.55 + u(30 + i) * 0.35, part: 'melody', inst: 'bell' });
  }
  // a slow two-note glass phrase answering the bells at the end of each half-section
  if (bi === 3 || bi === 7) {
    const deg = snapToChord(root + 4, chord);
    out.push({ t: 1, d: 1.5, midi: pitch(deg + 1, s.tonic), v: 0.26, part: 'counter', inst: 'glass' });
    out.push({ t: 2.5, d: 1.5, midi: pitch(deg, s.tonic), v: 0.24, part: 'counter', inst: 'glass' });
  }
}
