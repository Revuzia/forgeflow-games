// WOBBLEHOARD music bed (round 3): an original, generative, gentle ambient score. Nothing here is sampled, copied or
// modelled on any existing piece; the composition rules below are our own. Two halves:
//
//  * Composer: a pure, seeded state machine. It walks four related harmonic fields of one diatonic collection (D major /
//    G lydian), each held 8, 12 or 16 bars, and writes sparse 2-bar call/answer phrases for a felt mallet on an eighth grid
//    (66 BPM, light swing), plus rare bubble grace notes and bubble trails that echo the game's own bubble voice. Same seed
//    => same piece; the RNG never repeats, so the piece never loops.
//  * MusicBed: one playing "session" of that score. A lookahead scheduler turns the composer's bars into WebAudio notes:
//    the engine calls advance(now + LOOKAHEAD_S) from a 100 ms timer, offline renders call it once for the whole span.
//    Each session owns a small bus (a smooth duck, a fast "room" dip for the effects, a one-shot fade-in, a one-shot fade-out
//    and a one-shot pause fade) and caps itself at MAX_LIVE_NOTES sounding note groups.
//
// The same code runs live and in an OfflineAudioContext (the probe renders it), like every other voice.
import { clamp } from '../core/rng.ts';
import { Bag, bubble, dbToGain, fin, harmonicWave, makeRng, rr, type Rng } from './dsp.ts';

type Ctx = BaseAudioContext;

/* ───────────────────────────── constants (the probe and SOUND.md quote these) ───────────────────────────── */

export const MUSIC_BPM = 66;
export const BEAT_S = 60 / MUSIC_BPM;
export const BAR_S = 4 * BEAT_S;
/** An eighth note: the rhythmic grid of the mallet. */
export const SLOT_S = BEAT_S / 2;
/** Off-beat eighths are late by this fraction of a beat (a light, lazy swing). */
export const SWING = 0.045;
/** Sounding note groups per session (pads + mallets + bubbles, by their node lifetime). Two slots are kept for the pads
 *  (at most two overlap, during a field crossfade), so mallets + bubbles get the other four. */
export const MAX_LIVE_NOTES = 6;
const PAD_SLOTS = 2;
/** Live: the engine schedules this far ahead of the audio clock, from a TICK_MS timer. */
export const LOOKAHEAD_S = 0.4;
export const TICK_MS = 100;
export const FADE_IN_S = 2.5;
export const FADE_OUT_S = 1.4;
/** Fade used when the tab is hidden (setPaused): short, because the context is suspended right after it. */
export const PAUSE_FADE_S = 0.15;
/** No mallet note in the first moments of a session: the pad blooms first. */
export const FIRST_NOTE_S = 1.2;
export const DUCK_DB = -9;
export const DUCK_ATTACK_TC = 0.12;
export const DUCK_RELEASE_TC = 0.5;
/**
 * Room for the effects: a sidechain-style dip keyed by EVERY effect voice (round-3 fix). Each one-shot dips the music by
 * its ROOM_KINDS depth from the moment it is called until its own end time, then the music comes back (ROOM_RELEASE_TC:
 * within 1 dB about 1 s after the effect); the held squish and strand dip by a depth that follows their own level, frame
 * by frame (makeRoom holds). Why: with only the slow ceremony/squish duck, 25 of 330 effect placements over 6 minutes of
 * music stood less than 8 dB above the music in their own bands (a soft toss 5 dB UNDER the pads, a poke 3.4 dB and a
 * pop 0.6 dB over a coinciding mallet), and over each effect's loudest 20 ms frames most soft and medium effects were
 * within 0-7 LU (K-weighted) of the music. The dip is fast (attack tc 3 ms, starting ROOM_LEAD_S before the effect, which
 * the engine schedules that far ahead of the call) so even a 45 ms pop gets it; it runs on its own gain node and never
 * fights the slow duck (the two multiply).
 */
export const ROOM_DB = -24;
/** The dip is split: the melody (mallets, their echoes, the bubbles: tonal transients in the effects' own 0.4-2.4 kHz band,
 *  the part that actually covers a soft effect) takes the full ROOM_DB; the dark breathing pad only this share of it in
 *  dB (-12 dB), so a soft carpet stays under the play instead of the music vanishing and pumping back. */
export const ROOM_PAD_SHARE = 0.6;
export const ROOM_ATTACK_TC = 0.0015;
/** Slow enough that a tap every second keeps the music down instead of pumping it up and down (within 1 dB about 1.4 s
 *  after the last effect ends). */
export const ROOM_RELEASE_TC = 0.6;
/** = the engine's effect LOOKAHEAD: an effect called at t starts at t + ROOM_LEAD_S, the dip starts at t. */
export const ROOM_LEAD_S = 0.004;
/** Each dip holds this long after its effect ends before recovering, so a player tapping every second keeps the music
 *  steadily under (no pumping at the tap rate); it comes back ~2 s after the last effect. */
export const ROOM_TAIL_S = 0.8;
export const ROOM_MAX_HOLD_S = 5;
/** Which one-shots make room, and how deep (dB). The engine and the offline mix renders both read this table (and
 *  roomDb() below). The ceremony voices (reveal, merge) keep the slow duck; capsule beats get both. */
export const ROOM_KINDS: Readonly<Record<string, number>> = {
  poke: ROOM_DB, pop: ROOM_DB, blend: ROOM_DB, meterFull: ROOM_DB, capsule: ROOM_DB, strandSnap: ROOM_DB,
  release: ROOM_DB, land: ROOM_DB, bump: ROOM_DB, lift: ROOM_DB, toss: ROOM_DB,
};
/** Held voices: each update holds its dip this long (so a rubbing squish that dips and swells frame by frame keeps the
 *  deepest dip of the last HELD_ROOM_HOLD_S instead of tremoloing the music). */
export const HELD_ROOM_HOLD_S = 0.25;
/** The held squish dips fully from this |rate| (1/s) on (its squelch is then within ~10 dB of its max), proportionally below. */
export const SQUISH_ROOM_RATE = 0.7;
/** The held strand dips fully from this tension on, proportionally below. */
export const STRAND_ROOM_T = 0.35;
/**
 * The dip (dB) an effect asks for. `musicGainDb` is the music volume's gain above its default (chain.ts musicGain at the
 * player's setting; 0 at the default, +6 dB at 1): the dip deepens by it, so with the slider up the music under an effect
 * is never louder than at the default level (the effects stay in front whatever the slider says).
 */
export function roomDb(kind: string, musicGainDb = 0): number | null {
  const d = ROOM_KINDS[kind];
  return d === undefined ? null : d - Math.max(0, fin(musicGainDb, 0));
}
export function squishRoomDb(rate: number, musicGainDb = 0): number {
  const a = clamp((Math.abs(fin(rate, 0)) - 0.04) / (SQUISH_ROOM_RATE - 0.04), 0, 1);
  return a * (ROOM_DB - Math.max(0, fin(musicGainDb, 0)));
}
export function strandRoomDb(tension: number, musicGainDb = 0): number {
  const a = clamp(fin(tension, 0) / STRAND_ROOM_T, 0, 1);
  return a * (ROOM_DB - Math.max(0, fin(musicGainDb, 0)));
}
/** At most this many bars in a row without a mallet note (a long rest reads as the music having stopped). */
export const MAX_REST_BARS = 2;
/** Music volume 0..1 relative to master; 0.45 is the designed level (see chain.ts musicGain). */
export const MUSIC_DEFAULT = 0.45;
/** Mallet register (MIDI): A4 .. D6, 440 .. 1175 Hz. Nothing in the score goes below D4 (294 Hz): the 60-290 Hz region
 *  belongs to the squishies' bodies (poke, land, bump, lift, release), which must stand >= 8 dB above the music. */
export const MEL_LO = 69;
export const MEL_HI = 86;
/** Where the melody likes to sit (F5); it is pulled back toward here near the edges of the register. */
const MEL_HOME = 77;

/* Session levels (linear, before the chain's music gain), calibrated with the probe for a long-term RMS of about -29 dBFS
 * at music 0.45 / master 1 (the -30..-24 band, near its quiet end). Round-3 fix: the pad was the strongest and the only
 * continuous component, sitting where the ear is most sensitive (the first version: pad RMS 3-5 dB above the mallets, a
 * steady three-line chord in every spectrogram). Now the pad is darker (sines, no triangles), each of its tones breathes
 * on its own (so the full chord is rare) and it sits about 6 dB under the sparse mallet, which carries the level. */
const PAD_LEVEL = dbToGain(-28.8);
const MALLET_LEVEL = dbToGain(-11.5);
const BUBBLE_LEVEL = dbToGain(-20.5);
/** The music's bubbles settle upward by only 1% (17 cents; the game's bubbles chirp ~30%: a tuned note cannot) ... */
const BUBBLE_RISE = 0.01;
/** ... and start this fraction of the rise below the note, so the pitch lands on the scored note. Measured (A5..D7,
 *  probe check): energy-weighted pitch -4 cents, spectral peak +4 cents. The first version glided +5% from the note and
 *  sounded +33..+38 cents sharp (energy-weighted) / +59..+80 cents at the spectral peak. */
const BUBBLE_AIM = 0.6;
const BUBBLE_SOFT = 2.2;
/** Each mallet note repeats once, 3/4 beat later, this loud (-11 dB), darker (no x3.98 partial) and on the other side. */
const ECHO_LEVEL = 0.28;
/** 3/4 of a beat: the echo lands on a dotted-eighth, off the grid, so it reads as space rather than as extra notes. */
export const ECHO_S = 0.75 * BEAT_S;

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const pcOf = (m: number): number => ((Math.round(m) % 12) + 12) % 12;

/* ───────────────────────────── harmonic fields ───────────────────────────── */

export interface Field {
  readonly name: string;
  /** Pad chord, MIDI notes (low, mid, high). */
  readonly pad: readonly number[];
  /** Pitch classes the mallet and the bubbles may use (0 = C). */
  readonly mel: readonly number[];
  /** Resting tones: phrase endings land on one of these pitch classes. */
  readonly rest: readonly number[];
}

/**
 * Four fields of ONE diatonic collection (D E F# G A B C#), so no transition can clash. Our own voicings, all between D4
 * and F#5 (294-740 Hz) so the squishies' bodies keep 60-290 Hz to themselves:
 *   home  D add9, open (D4 A4 E5)           melody D major pentatonic        D E F# A B
 *   lift  G maj7 shell, lydian (G4 B4 F#5)  melody G lydian, no 4th          G A B C# D F#   (C# is the lydian colour)
 *   dusk  B minor over F# (F#4 B4 D5)       melody B minor pentatonic        B D E F# A
 *   glow  A sus2 over E (E4 A4 B4)          melody A major pentatonic        A B C# E F#
 */
export const FIELDS: readonly Field[] = [
  { name: 'home', pad: [62, 69, 76], mel: [2, 4, 6, 9, 11], rest: [2, 6, 9] },
  { name: 'lift', pad: [67, 71, 78], mel: [7, 9, 11, 1, 2, 6], rest: [7, 11, 2] },
  { name: 'dusk', pad: [66, 71, 74], mel: [11, 2, 4, 6, 9], rest: [11, 2, 6] },
  { name: 'glow', pad: [64, 69, 71], mel: [9, 11, 1, 4, 6], rest: [9, 1, 4] },
];
/** Allowed drifts and their weights. Glow mostly resolves home; nothing returns to the field it just left. */
export const FIELD_NEXT: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 0.4], [2, 0.35], [3, 0.25]],
  [[0, 0.5], [2, 0.3], [3, 0.2]],
  [[1, 0.35], [3, 0.35], [0, 0.3]],
  [[0, 0.6], [2, 0.4]],
];
/** How many bars a field lasts (8 bars = 29 s at 66 BPM). */
export const FIELD_BARS: readonly (readonly [number, number])[] = [[8, 0.35], [12, 0.4], [16, 0.25]];

/** Rhythm cells: eighth-note slots (0..7) inside a bar. About two thirds start on the downbeat; the rest are lazy
 *  off-beat figures and pickups, so the line does not lock to the bar line. */
const CELLS: readonly (readonly [readonly number[], number])[] = [
  [[0], 0.1], [[0, 3], 0.13], [[0, 3, 6], 0.1], [[0, 4], 0.11], [[0, 2, 4], 0.07], [[2, 4, 7], 0.08],
  [[0, 6, 7], 0.06], [[0, 1, 4], 0.05], [[3, 6], 0.08], [[0, 2, 3, 6], 0.05], [[1, 4], 0.06], [[2, 5], 0.06], [[4, 6, 7], 0.05],
];
/** Melodic steps in scale degrees: mostly neighbours, some skips, a rare playful leap. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0.26], [1, 0.26], [-2, 0.12], [2, 0.13], [0, 0.05], [-3, 0.06], [3, 0.07], [4, 0.03], [-4, 0.02],
];
type Role = 'call' | 'answer' | 'rest';
/** Two-bar phrases. About 1.4 sounding bars per two: sparse. */
const PHRASES: readonly (readonly [readonly Role[], number])[] = [
  [['call', 'answer'], 0.5], [['call', 'rest'], 0.27], [['rest', 'call'], 0.14], [['rest', 'rest'], 0.09],
];

export function pick<T>(r: Rng, items: readonly (readonly [T, number])[]): T {
  let tot = 0;
  for (const [, w] of items) tot += w;
  let u = r() * tot;
  for (const [v, w] of items) { u -= w; if (u < 0) return v; }
  return items[items.length - 1][0];
}

/* ───────────────────────────── composer (pure, seeded) ───────────────────────────── */

export interface PlannedNote {
  kind: 'mallet' | 'bubble';
  /** Seconds from the start of the bar (a grace bubble may be slightly negative). */
  at: number;
  midi: number;
  /** 0..1 */
  vel: number;
  pan: number;
  /** Seed of the note's own synthesis stream (noise offsets etc.), drawn at planning time: chunked and one-go scheduling sound identical. */
  seed: number;
}

export interface PlannedBar {
  bar: number;
  field: number;
  /** The first bar of a field (a new pad starts here). */
  fieldStart: boolean;
  /** Bars left in this field, this one included. */
  barsLeft: number;
  /** Seed for a pad that starts on this bar. */
  seed: number;
  notes: PlannedNote[];
}

export class Composer {
  private readonly r: Rng;
  field = 0;
  bar = 0;
  private barsLeft: number;
  private cur = MEL_HOME;
  private queue: Role[] = [];
  private lastCall: { cell: readonly number[]; steps: number[] } | null = null;
  private restRun = 0;
  /** History of field changes (bar index, field, length in bars): the probe checks the drift rules from it. */
  readonly fieldLog: { bar: number; field: number; bars: number }[] = [];

  constructor(seed: number) {
    this.r = makeRng((fin(seed, 1) ^ 0x6d757369) >>> 0);
    this.barsLeft = pick(this.r, FIELD_BARS);
    this.fieldLog.push({ bar: 0, field: 0, bars: this.barsLeft });
    // the piece always opens with a resting bar: the pad blooms before the first note
    this.queue = ['rest', this.r() < 0.5 ? 'call' : 'rest'];
  }

  private scale(): number[] {
    const f = FIELDS[this.field];
    const out: number[] = [];
    for (let m = MEL_LO; m <= MEL_HI; m++) if (f.mel.includes(pcOf(m))) out.push(m);
    return out;
  }

  private nearest(sc: number[], m: number): number {
    let best = 0;
    for (let i = 1; i < sc.length; i++) if (Math.abs(sc[i] - m) < Math.abs(sc[best] - m)) best = i;
    return best;
  }

  private stepFrom(sc: number[], d: number): number {
    let i = this.nearest(sc, this.cur);
    let step = d;
    // gravity toward the middle of the register: the line breathes around F5 instead of wandering off an edge
    if (sc[i] >= MEL_HOME + 5 && step > 0 && this.r() < 0.6) step = -step;
    if (sc[i] <= MEL_HOME - 5 && step < 0 && this.r() < 0.6) step = -step;
    i = clamp(i + step, 0, sc.length - 1);
    this.cur = sc[i];
    return this.cur;
  }

  /** Land on the closest resting tone of the field (ties go down: endings settle). */
  private resolve(sc: number[]): number {
    const rest = FIELDS[this.field].rest;
    let best = -1;
    for (let i = 0; i < sc.length; i++) {
      if (!rest.includes(pcOf(sc[i]))) continue;
      if (best < 0 || Math.abs(sc[i] - this.cur) < Math.abs(sc[best] - this.cur) || (Math.abs(sc[i] - this.cur) === Math.abs(sc[best] - this.cur) && sc[i] < sc[best])) best = i;
    }
    if (best >= 0) this.cur = sc[best];
    return this.cur;
  }

  private slotTime(s: number): number {
    // +/-8 ms of human looseness, but never ahead of the bar line (a new field's pad starts exactly there)
    return Math.max(0, s * SLOT_S + (s % 2 ? SWING * BEAT_S : 0) + rr(this.r, -0.008, 0.008));
  }

  private seed(): number { return (this.r() * 4294967296) >>> 0; }

  private melodyBar(role: Role, ends: boolean): PlannedNote[] {
    const sc = this.scale();
    const out: PlannedNote[] = [];
    let cell: readonly number[];
    let steps: number[];
    const shifted = this.lastCall ? [1, -1].map((d) => this.lastCall!.cell.map((x) => x + d)).filter((c) => c.every((x) => x >= 0 && x <= 7)) : [];
    if (role === 'answer' && this.lastCall && shifted.length && this.r() < 0.3) {
      // answer in kind: the call's rhythm nudged by an eighth (a playful displacement) with its contour mirrored, so the two
      // bars rhyme without either repeating the other
      cell = shifted[Math.floor(this.r() * shifted.length)];
      steps = this.lastCall.steps.map((d) => -d);
    } else {
      cell = pick(this.r, CELLS);
      steps = cell.map(() => pick(this.r, STEPS));
    }
    if (role === 'call') this.lastCall = { cell, steps: steps.slice() };
    for (let k = 0; k < cell.length; k++) {
      const s = cell[k];
      const last = k === cell.length - 1;
      const midi = last && ends ? (this.stepFrom(sc, steps[k]), this.resolve(sc)) : this.stepFrom(sc, steps[k]);
      let vel = 0.62 + (s === 0 ? 0.1 : 0) + rr(this.r, -0.06, 0.06);
      if (last && ends) vel *= 0.86;
      const at = this.slotTime(s);
      const pan = clamp((midi - MEL_HOME) / 30 + rr(this.r, -0.12, 0.12), -0.35, 0.35);
      out.push({ kind: 'mallet', at, midi, vel: clamp(vel, 0.3, 1), pan, seed: this.seed() });
      // grace: a tiny bubble an octave above, just ahead of the note (the game's bubble, tuned); never across the bar line
      if (this.r() < 0.16 && at > 0.08) out.push({ kind: 'bubble', at: at - rr(this.r, 0.05, 0.075), midi: midi + 12, vel: 0.6, pan, seed: this.seed() });
    }
    // trail: after a phrase ends, sometimes 2-3 bubbles rise through the field's scale, an octave up
    const lastN = out.filter((n) => n.kind === 'mallet').pop();
    if (ends && lastN && this.r() < 0.3 && lastN.at + 0.62 < BAR_S) {
      // (the whole trail stays inside this bar, so it always sounds over its own field's pad)
      let i = this.nearest(sc, lastN.midi);
      const n = this.r() < 0.5 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        i = Math.min(i + 1, sc.length - 1);
        out.push({ kind: 'bubble', at: lastN.at + 0.3 + k * rr(this.r, 0.075, 0.1), midi: sc[i] + 12, vel: 0.5 - 0.08 * k, pan: lastN.pan, seed: this.seed() });
      }
    }
    return out;
  }

  nextBar(): PlannedBar {
    let fieldStart = this.bar === 0;
    if (this.barsLeft <= 0) {
      this.field = pick(this.r, FIELD_NEXT[this.field]);
      this.barsLeft = pick(this.r, FIELD_BARS);
      this.fieldLog.push({ bar: this.bar, field: this.field, bars: this.barsLeft });
      fieldStart = true;
      // half the time the new field opens with a resting bar (its pad blooms alone)
      if (this.queue.length === 0 && this.r() < 0.5) this.queue = ['rest', 'call'];
    }
    if (this.queue.length === 0) this.queue = pick(this.r, PHRASES).slice();
    let role = this.queue.shift() as Role;
    // never more than MAX_REST_BARS empty bars in a row (a phrase rest, a field's opening rest and a rest+rest phrase could
    // add up to 5 bars = 18 s of pad alone)
    if (role === 'rest' && this.restRun >= MAX_REST_BARS) role = 'call';
    this.restRun = role === 'rest' ? this.restRun + 1 : 0;
    const ends = role === 'answer' || (role === 'call' && (this.queue.length === 0 || this.queue[0] === 'rest'));
    const notes = role === 'rest' ? [] : this.melodyBar(role, ends);
    const out: PlannedBar = { bar: this.bar, field: this.field, fieldStart, barsLeft: this.barsLeft, seed: this.seed(), notes };
    this.bar++;
    this.barsLeft--;
    return out;
  }
}

/* ───────────────────────────── instruments ───────────────────────────── */

/**
 * Pad: the field's three tones, each a soft sine (a whisper of 2nd and 3rd harmonic for warmth) with a quieter sine partner
 * (0.4) detuned so the pair beats SLOWLY (0.12-0.3 Hz, a different rate per tone), all drifting a few cents on a slow LFO,
 * through one gentle low-pass (900 Hz). Each tone BREATHES on its own seeded schedule: it swells to its peak (rise 1.8-3.5
 * s, hold 1-4.5 s), sinks back to a floor (fall 2.5-4.5 s; the root keeps -9 dB, the middle -13, the top -16) and rests
 * there 0.5-5 s, so at any moment one, two or three tones are up and the chord's colour keeps moving. The whole chord fades
 * in with a time constant of 1.2 s from `t`, starts fading out (tc 1.3 s) 0.6 s before `endT`, and its sources stop 8 s
 * later.
 */
const PAD_FLOOR = [dbToGain(-9), dbToGain(-13), dbToGain(-16)];
function padChord(ctx: Ctx, dest: AudioNode, t: number, endT: number, field: Field, seed: number, pr: number): { bag: Bag; end: number } {
  const r = makeRng(seed);
  const bag = new Bag(ctx, dest, 'pad', 0);
  const relT = Math.max(t + 1, endT - 0.6);
  const stopT = relT + 8;
  const lp = bag.biquad('lowpass', 900, 0.5);
  const amp = bag.gain(0);
  lp.connect(amp); amp.connect(bag.head);
  const drift = bag.osc('sine', rr(r, 0.08, 0.14), t, stopT);
  const driftD = bag.gain(3.5);           // cents
  drift.connect(driftD);
  const wave = harmonicWave(ctx, 'pad', [1, 0.06, 0.02]);
  // the top tone carries the pad; the lower ones (which reach down toward the squishies' 2nd harmonics) are softer
  const lv = [0.5, 0.7, 1];
  for (let k = 0; k < field.pad.length; k++) {
    const f = midiHz(field.pad[k]) * pr;
    const g = bag.gain(0.62 * lv[k]);
    const beatHz = rr(r, 0.12, 0.3);
    const cents = 1200 * Math.log2(1 + beatHz / f);
    for (const [det, lvl] of [[0, 1], [cents, 0.4]] as const) {
      const o = bag.osc('sine', f, t, stopT);
      o.setPeriodicWave(wave);
      o.detune.value = det;
      driftD.connect(o.detune);
      const og = bag.gain(lvl);
      o.connect(og); og.connect(g);
    }
    // this tone's breaths
    const fl = PAD_FLOOR[k] ?? PAD_FLOOR[2];
    g.gain.setValueAtTime(0.62 * lv[k] * fl, t);
    let u = t + rr(r, 0, 1.2) + 0.9 * k;
    for (let guard = 0; guard < 40 && u < relT; guard++) {
      const rise = rr(r, 1.8, 3.5), hold = rr(r, 1, 4.5), fall = rr(r, 2.5, 4.5), gap = rr(r, 0.5, 5);
      g.gain.setTargetAtTime(0.62 * lv[k] * rr(r, 0.75, 1), u, rise / 3);
      g.gain.setTargetAtTime(0.62 * lv[k] * fl, u + rise + hold, fall / 3);
      u += rise + hold + fall + gap;
    }
    g.connect(lp);
  }
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(PAD_LEVEL, t, 1.2);
  amp.gain.setTargetAtTime(0, relT, 1.3);
  bag.endTime = stopT + 0.02;
  return { bag, end: stopT };
}

/**
 * Felt mallet: a sine fundamental with a soft octave and a marimba-like x3.98 partial that die faster, plus a 6 ms
 * low-passed noise "felt" contact. Decay tc 0.3 s at 600 Hz (lower notes ring a little longer); every partial ends with an
 * exponential glide to -44 dB at 5 time constants and a 20 ms ramp to zero. Its echo is part of the note: the fundamental
 * and the octave again ECHO_S later at ECHO_LEVEL, panned to the other side (scheduled, not a DelayNode: see MusicBed).
 * Node lifetime ~2.2 s at 600 Hz.
 */
function mallet(ctx: Ctx, dest: AudioNode, t: number, f: number, vel: number, pan: number, seed: number): { bag: Bag; end: number } {
  const r = makeRng(seed);
  const bag = new Bag(ctx, dest, 'mallet', pan);
  const A = MALLET_LEVEL * Math.pow(clamp(vel, 0, 1), 1.3);
  const tau = 0.39 * Math.pow(600 / f, 0.35);
  let end = t;
  const canPan = typeof ctx.createStereoPanner === 'function';
  const ep = canPan ? bag.add(ctx.createStereoPanner()) : bag.gain(1);
  const side = Math.abs(pan) > 0.05 ? -Math.sign(pan) * 0.5 : (r() < 0.5 ? -0.5 : 0.5);
  if (canPan) (ep as StereoPannerNode).pan.value = side;
  ep.connect(dest);
  const te = t + ECHO_S;
  const parts: readonly (readonly [number, number, number, number])[] = [[1, 1, 1, 1], [2, 0.16, 0.45, 1], [3.98, 0.07, 0.18, 0]];
  for (const [ratio, lvl, tm, echoes] of parts) {
    const fq = f * ratio * (1 + 0.002 * (r() - 0.5));
    const T = tau * tm;
    for (let k = 0; k <= echoes; k++) {
      const u = k ? te : t;
      const a = A * lvl * (k ? ECHO_LEVEL : 1);
      const e = u + 0.004 + 5 * T;
      const o = bag.osc('sine', fq, u, e + 0.03);
      const g = bag.gain(0);
      o.connect(g); g.connect(k ? ep : bag.head);
      g.gain.setValueAtTime(0, u);
      g.gain.linearRampToValueAtTime(a, u + (k ? 0.008 : 0.004));
      g.gain.exponentialRampToValueAtTime(a * 0.0067, e);
      g.gain.linearRampToValueAtTime(0, e + 0.02);
      end = Math.max(end, e + 0.03);
    }
  }
  const n = bag.noise(r, t, t + 0.03);
  const lp = bag.biquad('lowpass', 1300, 0.7);
  const ng = bag.gain(0);
  n.connect(lp); lp.connect(ng); ng.connect(bag.head);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(A * 0.35, t + 0.0015);
  ng.gain.linearRampToValueAtTime(0, t + 0.007);
  bag.endTime = end + 0.02;
  return { bag, end };
}

/**
 * The music's bubble grace/trail note: the game's Minnaert bubble (dsp.ts) tuned to `f`. Its radius is chosen so that the
 * small upward settle (BUBBLE_RISE) is centred on the note instead of starting there. Returns the time it is silent.
 */
export function musicBubble(ctx: Ctx, dest: AudioNode, t: number, f: number, amp: number): number {
  return bubble(ctx, dest, t, 3.26 / (f / (1 + BUBBLE_AIM * BUBBLE_RISE)), amp, BUBBLE_RISE, BUBBLE_SOFT);
}

/* ───────────────────────────── the scheduler / one playing session ───────────────────────────── */

export interface MusicLogEntry {
  t: number;
  end: number;
  kind: 'pad' | 'mallet' | 'bubble';
  midi: readonly number[];
  field: number;
  vel: number;
  /** Not played: the live-note cap was full, or the note was already late. */
  dropped?: 'cap' | 'late';
}

interface Pending { t: number; kind: 'pad' | 'mallet' | 'bubble'; midi: number; field: number; vel: number; pan: number; seed: number; end: number }

const curve = (from: number, to: number, n = 33): Float32Array<ArrayBuffer> => {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) c[i] = from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  return c;
};

export interface MusicBedOptions {
  /** Keep a log of every note (the probe's pitch-set, onset and cap checks). */
  log?: boolean;
  /** Pitch ratio of the whole score (default 1). */
  pitch?: number;
  fadeInS?: number;
  /** Diagnostics only (stem renders): level multipliers for the pad and for the mallets + bubbles (default 1). */
  layers?: { pad?: number; mallet?: number };
}

export class MusicBed {
  readonly ctx: Ctx;
  readonly t0: number;
  readonly log: MusicLogEntry[] | null;
  readonly stats = { notes: 0, bubbles: 0, pads: 0, dropped: 0, late: 0, maxLive: 0 };
  private readonly composer: Composer;
  private readonly bus: Bag;
  private readonly melBus: GainNode;
  private readonly duckG: GainNode;
  private readonly roomMel: GainNode;
  private readonly roomPad: GainNode;
  private readonly fadeOut: GainNode;
  private readonly pauseG: GainNode;
  private readonly padIn: GainNode;
  private readonly pr: number;
  private nextBarT: number;
  private pending: Pending[] = [];
  /** Start/end of every scheduled note (pads included) for the live-note cap; trimmed as time passes. */
  private spans: { t: number; end: number; pad: boolean }[] = [];
  private groups: Bag[] = [];
  private first = true;
  private ducked = false;
  private duckUntil = -Infinity;
  private roomUntil = -Infinity;
  private roomFrom = 0;
  private holds: { until: number; g: number }[] = [];
  private roomPlan: { t: number; g: number; tc: number }[] = [];
  private fastUsed = false;
  private stoppedAt = Infinity;
  private endT = Infinity;
  private freed = false;

  constructor(ctx: Ctx, out: AudioNode, composer: Composer, t0: number, opts: MusicBedOptions = {}) {
    this.ctx = ctx;
    this.composer = composer;
    this.t0 = Math.max(0, fin(t0, 0));
    this.nextBarT = this.t0;
    this.log = opts.log ? [] : null;
    this.pr = clamp(fin(opts.pitch, 1), 0.5, 2);
    // session bus: ([pads] -> pad room dip) + ([mallets, each with its own scheduled echo, + bubbles] -> melody room dip)
    //   -> duck -> fadeIn -> fadeOut -> pause -> head -> out
    // There is deliberately no DelayNode here: with one, an offline render scheduled in live-like slices differed from the
    // same score scheduled in one go (Chromium delayed the echo copy by a render-quantum-sized amount depending on when the
    // notes were connected). Each note now schedules its own echo, so live and offline renders are identical.
    const bag = new Bag(ctx, out, 'musicBus', 0);
    this.bus = bag;
    this.fadeOut = bag.gain(1);
    this.pauseG = bag.gain(1);
    const fadeIn = bag.gain(0);
    this.duckG = bag.gain(1);
    this.roomMel = bag.gain(1);
    this.roomPad = bag.gain(1);
    const lay = opts.layers ?? {};
    this.melBus = bag.gain(clamp(fin(lay.mallet, 1), 0, 4));
    this.padIn = bag.gain(clamp(fin(lay.pad, 1), 0, 4));
    this.duckG.connect(fadeIn); fadeIn.connect(this.fadeOut); this.fadeOut.connect(this.pauseG); this.pauseG.connect(bag.head);
    this.melBus.connect(this.roomMel); this.roomMel.connect(this.duckG);
    this.padIn.connect(this.roomPad); this.roomPad.connect(this.duckG);
    // The session bus is stereo for its whole life. Otherwise the first panned note connected mid-session switches the bus
    // and the master chain from mono to stereo processing, and the new channel's filter/limiter state starts from zero (a
    // small transient; measured as a live-vs-offline difference before this was fixed).
    for (const n of [this.melBus, this.padIn, this.roomMel, this.roomPad, this.duckG, fadeIn, this.fadeOut, this.pauseG, bag.head]) {
      n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers';
    }
    const fi = clamp(fin(opts.fadeInS, FADE_IN_S), 0.05, 10);
    fadeIn.gain.setValueCurveAtTime(curve(0, 1), this.t0, fi);
  }

  get alive(): boolean { return !this.freed && this.ctx.currentTime < this.endT + 0.05; }
  get stopped(): boolean { return this.stoppedAt < Infinity; }
  /** Context time at which a stopped session is silent (Infinity while playing). */
  get endTime(): number { return this.endT; }
  /** True while the slow (ceremony) duck holds or an effect's room dip is active (the dip's recovery included). */
  get isDucked(): boolean { return this.ducked || this.ctx.currentTime < this.roomUntil; }
  /** True while an effect's room dip holds (until its effect ends; the recovery follows). */
  roomedAt(t: number): boolean { return t < this.roomUntil; }

  /** Sounding note groups at time t (pads, mallets and bubbles whose span covers t). */
  liveAt(t: number): number {
    let n = 0;
    for (const s of this.spans) if (s.t <= t && s.end > t) n++;
    return n;
  }

  /** Same, without the pads. */
  private liveNotesAt(t: number): number {
    let n = 0;
    for (const s of this.spans) if (!s.pad && s.t <= t && s.end > t) n++;
    return n;
  }

  /** Plan bars up to one bar past `until` and build the audio of every note that starts before `until`. */
  advance(until: number): void {
    if (this.freed) return;
    const horizon = Math.min(fin(until, 0), this.stoppedAt);
    while (this.nextBarT < horizon + BAR_S) {
      const b = this.composer.nextBar();
      const bt = this.nextBarT;
      if (b.fieldStart || this.first) {
        this.pending.push({ t: bt, kind: 'pad', midi: 0, field: b.field, vel: 1, pan: 0, seed: b.seed, end: bt + b.barsLeft * BAR_S });
      }
      this.first = false;
      for (const n of b.notes) {
        const t = bt + n.at;
        if (t < this.t0 + FIRST_NOTE_S) continue;
        this.pending.push({ t, kind: n.kind, midi: n.midi, field: b.field, vel: n.vel, pan: n.pan, seed: n.seed, end: 0 });
      }
      this.nextBarT += BAR_S;
    }
    this.pending.sort((a, b) => a.t - b.t);
    while (this.pending.length && this.pending[0].t < horizon) this.play(this.pending.shift() as Pending);
    // trim spans long gone (keeps liveAt() O(live))
    if (this.spans.length > 24) { const now = this.ctx.currentTime; this.spans = this.spans.filter((s) => s.end > now - 1); }
  }

  private play(e: Pending): void {
    const now = this.ctx.currentTime;
    let t = e.t;
    if (t < now) {
      // a stalled main thread: stale notes are dropped instead of piling up late; a pad starts now, however late, as long as
      // its field has more than a second left (a field lasts 29-58 s: dropping its pad would leave the mallets over nothing)
      if (e.kind !== 'pad' || now > e.end - 1) { this.stats.late++; this.logIt(e, t, t, 'late'); return; }
      t = now + 0.005;
    }
    if (e.kind !== 'pad' && this.liveNotesAt(t) >= MAX_LIVE_NOTES - PAD_SLOTS) { this.stats.dropped++; this.logIt(e, t, t, 'cap'); return; }
    let end: number;
    if (e.kind === 'pad') {
      const p = padChord(this.ctx, this.padIn, t, e.end, FIELDS[e.field], e.seed, this.pr);
      this.groups.push(p.bag); end = p.end; this.stats.pads++;
    } else if (e.kind === 'mallet') {
      const m = mallet(this.ctx, this.melBus, t, midiHz(e.midi) * this.pr, e.vel, e.pan, e.seed);
      this.groups.push(m.bag); end = m.end; this.stats.notes++;
    } else {
      // the game's Minnaert bubble, tuned (musicBubble): a small upward settle centred on the note, a slightly longer ring
      end = musicBubble(this.ctx, this.melBus, t, midiHz(e.midi) * this.pr, BUBBLE_LEVEL * e.vel);
      this.stats.bubbles++;
    }
    this.spans.push({ t, end, pad: e.kind === 'pad' });
    this.stats.maxLive = Math.max(this.stats.maxLive, this.liveAt(t));
    this.logIt(e, t, end);
    if (this.groups.length > 16) this.groups = this.groups.filter((g) => g.alive);
  }

  private logIt(e: Pending, t: number, end: number, dropped?: 'cap' | 'late'): void {
    if (!this.log) return;
    const midi = e.kind === 'pad' ? FIELDS[e.field].pad.slice() : [e.midi];
    this.log.push({ t, end, kind: e.kind, midi, field: e.field, vel: e.vel, ...(dropped ? { dropped } : {}) });
  }

  /** Duck the session by DUCK_DB from `from` until at least `until` (repeated calls extend it). Smooth: setTarget only. */
  duckSpan(from: number, until: number): void {
    if (this.freed) return;
    const a = Math.max(0, fin(from, 0)), b = fin(until, a);
    if (!this.ducked) {
      this.duckG.gain.setTargetAtTime(dbToGain(DUCK_DB), a, DUCK_ATTACK_TC);
      this.ducked = true;
      this.duckUntil = b;
    } else this.duckUntil = Math.max(this.duckUntil, b);
  }

  /** Release the duck once `now` has passed the last hold (the engine calls this every tick; offline renders script it). */
  pollDuck(now: number): void {
    if (this.freed || !this.ducked || !(now >= this.duckUntil)) return;
    this.duckG.gain.setTargetAtTime(1, Math.max(this.duckUntil, this.ctx.currentTime), DUCK_RELEASE_TC);
    this.ducked = false;
  }

  /**
   * Make room for an effect (a sidechain-style dip keyed by the effect voices): dip by `db` (<= 0) from `from` until
   * `until`, then recover. Every call is a "hold" {until, gain}; the session keeps the active holds and plans the gain as a
   * staircase: the deepest active hold, then, when it ends, the deepest of the rest, ..., then 1. Going down uses the
   * fast ROOM_ATTACK_TC, coming back ROOM_RELEASE_TC. So a held voice that calls this every frame with a depth that
   * follows its own level (squish, strand) gets a dip that follows it, and a soft call never cuts a deeper one short.
   * Calls must come in time order (live: currentTime; offline: scripted); the only cancellation is of this node's own
   * future plan at `from`, and setTargetAtTime always starts from the current value, so the gain never jumps.
   */
  makeRoom(from: number, until: number, db: number = ROOM_DB): void {
    if (this.freed) return;
    const a = Math.max(0, fin(from, 0), this.roomFrom);
    const g = dbToGain(clamp(fin(db, ROOM_DB), -30, 0));
    if (!(g < 0.995)) return;
    const b = Math.min(Math.max(a + 0.02, fin(until, a)), a + ROOM_MAX_HOLD_S);
    // drop expired holds and holds the new one covers; a call an existing hold already covers changes nothing
    this.holds = this.holds.filter((h) => h.until > a && !(h.g >= g && h.until <= b));
    if (this.holds.some((h) => h.g <= g && h.until >= b)) return;
    this.holds.push({ until: b, g });
    // the staircase from `a`
    const plan: { t: number; g: number; tc: number }[] = [];
    let cur = { t: 0, g: 1, tc: ROOM_RELEASE_TC };
    for (const s of this.roomPlan) if (s.t <= a) cur = s;
    let t = a, act = this.holds, prevG = cur.g;
    while (act.length) {
      let m = Infinity;
      for (const h of act) m = Math.min(m, h.g);
      let tn = t;
      for (const h of act) if (h.g === m) tn = Math.max(tn, h.until);
      const tc = plan.length === 0 && m === cur.g ? cur.tc : m < prevG ? ROOM_ATTACK_TC : ROOM_RELEASE_TC;
      plan.push({ t, g: m, tc });
      prevG = m; t = tn;
      act = act.filter((h) => h.until > tn);
    }
    plan.push({ t, g: 1, tc: ROOM_RELEASE_TC });
    try {
      const pm = this.roomMel.gain, pp = this.roomPad.gain;
      pm.cancelScheduledValues(a); pp.cancelScheduledValues(a);
      for (const s of plan) { pm.setTargetAtTime(s.g, s.t, s.tc); pp.setTargetAtTime(Math.pow(s.g, ROOM_PAD_SHARE), s.t, s.tc); }
    } catch { /* closed context */ }
    this.roomPlan = plan; this.roomFrom = a; this.roomUntil = t;
  }

  /** Raised-cosine fade to exact silence over `fadeS` from `at`, then nothing more is scheduled. Returns the silent time. */
  stop(at: number, fadeS = FADE_OUT_S): number {
    if (this.stoppedAt < Infinity || this.freed) return this.endT;
    const t = Math.max(this.ctx.currentTime, fin(at, this.ctx.currentTime));
    const f = clamp(fin(fadeS, FADE_OUT_S), 0.02, 6);
    this.stoppedAt = t;
    this.fadeOut.gain.setValueCurveAtTime(curve(1, 0), t, f);
    this.pending.length = 0;
    this.endT = t + f + 0.01;
    return this.endT;
  }

  /**
   * Silent within `fadeS` from `at`, even if a slower fade-out is already running (setPaused(true) during the 1.4 s fade of
   * a music-off or a mute): a second, one-shot raised-cosine on its own gain node. Returns the silent time.
   */
  fastStop(at: number, fadeS = PAUSE_FADE_S): number {
    if (this.freed) return this.endT;
    if (!this.stopped) return this.stop(at, fadeS);
    const t = Math.max(this.ctx.currentTime, fin(at, this.ctx.currentTime));
    const f = clamp(fin(fadeS, PAUSE_FADE_S), 0.02, 6);
    if (this.fastUsed || t + f + 0.01 >= this.endT) return this.endT;
    this.fastUsed = true;
    try { this.pauseG.gain.setValueCurveAtTime(curve(1, 0), t, f); } catch { return this.endT; }
    this.endT = t + f + 0.01;
    return this.endT;
  }

  /** Disconnect every node now (after the fade, on pause-suspend, on dispose). Sources are stopped first: a disconnected
   *  oscillator still runs until its stop time, and a pad's stop time can be up to a minute away. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.pending.length = 0;
    const now = this.ctx.currentTime;
    for (const g of this.groups) { g.stopAll(now); g.free(); }
    this.groups.length = 0;
    this.bus.free();
  }
}
