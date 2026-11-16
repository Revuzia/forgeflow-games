// SQUISH KEEPER (wobblehoard) PLAYGROUND creature voices (LIFE.md 8; PLAYGROUND_BUILD.md 10; PG_AUDIO). LIFE plans every phrase
// (lifePhrase: which syllables, which pentatonic steps, when); this module only synthesises it: the eight syllable shapes, the six
// flavours, the pitch snap to D major pentatonic, the re-voicing of a sung note onto the sounding field's rest tones, the echo and the
// group voice. No samples, no words, no animal sounds, no DelayNode, no LFO node. A phrase is ONE voice group of at most 4 nodes:
//   whole:  oscillator (the flavour's cached PeriodicWave) -> formant biquad -> envelope (the group's head gain) [-> panner]
//   foam:   oscillator + a breath (a cached band-limited noise, its band moved to 2f by playbackRate) -> envelope [-> panner]
//   piece:  1 or 2 oscillators (the group voice: +-10 cents) -> envelope [-> panner]
//   echo:   a second group, +220 ms, -12 dB, oscillator -> low-pass -> envelope [-> panner]
// so every syllable costs at most 4 nodes (AU-11). Contours are frequency / detune automation; the envelope of each syllable is one
// precomputed curve on the head gain (the purr's 28 Hz flutter and the beads' onset ticks live in it). Every draw comes from the
// chatter stream (CHATTER_SALT), never the engine's (AU-07). The designs are our own.
import { clamp } from '../core/rng.ts';
import { Bag, dbToGain, fin, harmonicWave, nodeCounters, type Rng } from './dsp.ts';

type Ctx = BaseAudioContext;

/** Syllable ids: the values of src/data/life.ts SYL (mirrored, not imported: that module lives in the life chunk; probe_chatter
 *  checks they match). */
export const SYL = { chirp: 0, coo: 1, purr: 2, hum: 3, trill: 4, yawn: 5, chitter: 6, peep: 7 } as const;
/** Syllable lengths (s) at length scale 1 (LIFE 8.2). */
export const SYL_S: readonly number[] = [0.09, 0.16, 0.18, 0.22, 0.165, 0.5, 0.16, 0.045];
/** src/data/life.ts SALTS.chatter: the creature voices' own rng stream (never a draw from the engine's). */
export const CHATTER_SALT = 0x1b873593;
/** D major pentatonic (D E F# A B). */
const PENTA = [2, 4, 6, 9, 11];
/** The rest tones (root, fifth, ninth) of the four music fields (music.ts FIELDS: home D, lift G, dusk B, glow A). */
export const FIELD_REST: readonly (readonly number[])[] = [[2, 9, 4], [7, 2, 9], [11, 6, 1], [9, 4, 11]];
/** Registers (MIDI): a whole squishy's base snaps inside A4..D6, a piece's inside D6..D7 (LIFE 8.2). */
export const WHOLE_LO = 69, WHOLE_HI = 86, PIECE_LO = 86, PIECE_HI = 98;
/** A whole squishy's syllable envelope peak (linear, pre-chain, at level 1). Measured through the chain at Voices 100% (AU-01): every
 *  shape and flavour peaks at about -22 dBFS with the trims below (LIFE 8.4 caps it at -20). Pieces 7 dB lower (about -29.5); a group
 *  voice one piece + 2 dB. */
export const WHOLE_PEAK = dbToGain(-24.5);
export const PIECE_DB = -7, GROUP_DB = 2;
/** The echo (Echo Hollow, LIFE 8.3): one scheduled repeat. */
export const ECHO_S = 0.22, ECHO_DB = -12;

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** The pentatonic step number of a pentatonic MIDI note (5 a octave), and back. */
const stepOf = (m: number): number => Math.floor(m / 12) * 5 + PENTA.indexOf(((m % 12) + 12) % 12);
const midiOf = (s: number): number => Math.floor(s / 5) * 12 + PENTA[((s % 5) + 5) % 5];

/** The nearest MIDI note whose pitch class is in `pcs`, inside [lo, hi] (ties go down). */
export function snapTo(m: number, pcs: readonly number[], lo: number, hi: number): number {
  let best = lo, bd = Infinity;
  for (let k = Math.ceil(lo); k <= hi; k++) {
    if (!pcs.includes(((k % 12) + 12) % 12)) continue;
    const d = Math.abs(k - m);
    if (d < bd - 1e-9) { bd = d; best = k; }
  }
  return best;
}

/** A voice's base note: D5 (whole) or D6 (piece) x pitch, snapped to D major pentatonic in its register (LIFE 8.2). `pitch` =
 *  pitchRatio(genome) (x popSize(frac) for a piece; x 2^(-1/12) in a cold place: the caller folds both in). */
export function baseNote(pitch: number, register: number): number {
  const piece = register === 1;
  const m = (piece ? 86 : 74) + 12 * Math.log2(clamp(fin(pitch, 1), 0.25, 4));
  return snapTo(m, PENTA, piece ? PIECE_LO : WHOLE_LO, piece ? PIECE_HI : WHOLE_HI);
}

/** The note of a syllable `deg` pentatonic steps from the base (a spoken phrase). */
export const degNote = (base: number, deg: number): number => midiOf(stepOf(base) + Math.round(clamp(fin(deg, 0), -4, 4)));

/** A sung note (sing): LIFE plans it in pentatonic steps from D (its rest tones are D 0, A 3, E 1); audio places it in the voice's
 *  octave (the D nearest its base) and re-voices it onto the SOUNDING field's rest tones (root, fifth, ninth; D-66), which changes no
 *  LIFE decision. */
export function sungNote(base: number, deg: number, field: number): number {
  const d = Math.round((base - 2) / 12) * 12 + 2;
  return snapTo(midiOf(stepOf(d) + Math.round(clamp(fin(deg, 0), -4, 4))), FIELD_REST[field] ?? FIELD_REST[0], d - 8, d + 12);
}

/* ═══════════════════════════════ flavours (LIFE 8.2; audio/cut.ts FAMILY_FLAVOUR order) ═══════════════════════════════ */

/** [harmonics, formant type ('' none), formant Hz, Q, formant gain dB, level trim dB] for gel, sticky, foam, beads, dough, firm. The trims
 *  level the six flavours' peaks through the chain (AU-01, measured); a piece has no formant or breath, so it takes no trim. */
const FLAV: readonly (readonly [readonly number[], BiquadFilterType | '', number, number, number, number])[] = [
  [[1, 0.3, 0.1], 'lowpass', 3200, 0.7, 0, -0.7],             // gel: clear
  [[1, 0.6, 0.5, 0.3], 'peaking', 1600, 3, 9, -4.8],           // sticky: nasal (a resonance at 1.6 kHz)
  [[1, 0.15], '', 0, 0, 0, -3.1],                              // foam: breathy (20% breath at 2f)
  [[1, 0.45, 0.3, 0.15], 'lowpass', 2600, 1.2, 0, -1.6],       // beads: grainy (onset ticks, a 12 per s flutter)
  [[1, 0.5, 0.2], 'lowpass', 1200, 0.7, 0, -1.4],              // dough: dark
  [[1, 0.7, 0.5, 0.4, 0.3], 'lowpass', 5200, 0.7, 0, -1],      // firm: bright (a small upward onset chirp)
];
const FOAM = 2, BEADS = 3, FIRM = 5;

/** The breath: 1 s of seeded noise band-passed around 1600 Hz (a two-pole resonator, baked once per context), at 20% of a unit
 *  sine's RMS. A source plays it looped at playbackRate 2f / 1600, so its band sits at 2f (foam, LIFE 8.2; the yawn's breath). */
const breaths = new WeakMap<BaseAudioContext, AudioBuffer>();
function breath(ctx: Ctx): AudioBuffer {
  let b = breaths.get(ctx);
  if (b) return b;
  const n = Math.floor(ctx.sampleRate), d = new Float32Array(n);
  let s = CHATTER_SALT >>> 0;
  const w = (2 * Math.PI * 1600) / ctx.sampleRate, rr = 0.93, a1 = 2 * rr * Math.cos(w), a2 = -rr * rr;
  let y1 = 0, y2 = 0, e = 0;
  for (let i = 0; i < 2 * n; i++) {
    s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const y = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5 + a1 * y1 + a2 * y2;
    y2 = y1; y1 = y;
    if (i >= n) { d[i - n] = y; e += y * y; }       // the second pass: the resonator has settled, and the loop joins smoothly enough
  }
  const k = (0.2 * Math.SQRT1_2) / Math.sqrt(e / n);
  for (let i = 0; i < n; i++) d[i] *= k;
  b = ctx.createBuffer(1, n, ctx.sampleRate);
  b.getChannelData(0).set(d);
  breaths.set(ctx, b);
  return b;
}

/* ═══════════════════════════════ one phrase ═══════════════════════════════ */

export interface PhraseParams {
  /** The syllables, copied from the caller's array during the call: 4 floats each [syllable id, degree, start s, length scale]. */
  syl: Float32Array; n: number;
  flavour: number; register: number; pitch: number; pan: number;
  /** Linear amplitude of the loudest syllable (WHOLE_PEAK x level x register factor, already computed). */
  amp: number;
  /** 1 voice; 2 or 3: the group voice (two detuned oscillators). */
  group: number;
  /** A sung phrase: its degrees are steps from D, re-voiced onto fieldAt(t)'s rest tones. */
  sing: boolean;
  /** The field sounding at context time t (0 home when the music is off). */
  fieldAt(t: number): number;
  rng: Rng;
  /** The echo copy: one oscillator through a low-pass (no breath, no group). */
  echo?: boolean;
}

/** Scratch for the envelope curves (setValueCurveAtTime copies it). */
const CURVE = new Float32Array(4096);
const DT = 0.0005;

/** The phrase's length (s): the end of its last syllable. */
export function phraseLen(syl: Float32Array, n: number): number {
  let e = 0;
  for (let k = 0; k < n; k++) { const id = syl[k * 4] | 0; e = Math.max(e, fin(syl[k * 4 + 2], 0) + (SYL_S[id] ?? 0.1) * clamp(fin(syl[k * 4 + 3], 1), 0.5, 2)); }
  return e;
}

/** Build one phrase starting at t0 on `out`. Returns the group (kind 'creature', priority -1: stolen before any player sound). */
export function creaturePhrase(ctx: Ctx, out: AudioNode, t0: number, p: PhraseParams): Bag {
  const bag = new Bag(ctx, out, 'creature', p.pan);
  bag.priority = -1;
  bag.head.gain.value = 0;
  const fl = clamp(p.flavour | 0, 0, 5);
  const F = FLAV[fl];
  const piece = p.register === 1;
  const n = clamp(p.n | 0, 0, 4);
  const base = baseNote(p.pitch, p.register);
  // the sources: one oscillator (two for a group voice), the flavour's formant (a low-pass for the echo), the foam's breath
  const two = piece && p.group >= 2 && !p.echo;
  const wave = harmonicWave(ctx, 'cr' + fl, F[0] as number[]);
  let into: AudioNode = bag.head;
  if (p.echo) { const lp = bag.biquad('lowpass', 1400, 0.7); lp.connect(bag.head); into = lp; }
  else if (F[1] && !piece) { const b = bag.biquad(F[1], F[2], F[3]); b.gain.value = F[4]; b.connect(bag.head); into = b; }
  const end = t0 + phraseLen(p.syl, n) + 0.02;
  const oscs: OscillatorNode[] = [];
  for (let k = 0; k < (two ? 2 : 1); k++) {
    const o = bag.osc('sine', midiHz(base), t0, end);
    o.setPeriodicWave(wave);
    if (two) o.detune.value = k ? 10 : -10;
    o.connect(into);
    oscs.push(o);
  }
  let br: AudioBufferSourceNode | null = null;
  if (!p.echo && !piece && fl === FOAM) {
    br = bag.src(ctx.createBufferSource());
    br.buffer = breath(ctx); br.loop = true;
    br.start(t0, p.rng() * 0.9); br.stop(end);
    br.connect(bag.head);
  }
  const A = p.amp * (piece ? 1 : dbToGain(F[5])) * (two ? 0.5 : 1);
  const g = bag.head.gain;
  let last = -Infinity;
  for (let k = 0; k < n; k++) {
    const id = clamp(p.syl[k * 4] | 0, 0, 7);
    const s = t0 + Math.max(0, fin(p.syl[k * 4 + 2], 0));
    let d = (SYL_S[id] ?? 0.1) * clamp(fin(p.syl[k * 4 + 3], 1), 0.5, 2);
    if (k + 1 < n) d = Math.min(d, t0 + fin(p.syl[k * 4 + 6], 0) - s - 0.003);
    if (!(d > 0.012) || s < last + 0.002) continue;     // out of order or overlapping: skipped (automation curves must not overlap)
    last = s + d;
    const deg = p.syl[k * 4 + 1];
    const m = p.sing ? sungNote(base, deg, p.fieldAt(s)) : degNote(base, deg);
    for (const o of oscs) contour(o, id, m, s, d, fl === FIRM && !p.echo);
    if (br) br.playbackRate.setValueAtTime(clamp((2 * midiHz(m)) / 1600, 0.25, 4), s);
    const c = envelope(id, d, fl === BEADS && !p.echo, A);
    g.setValueCurveAtTime(c, s, d);
  }
  bag.endTime = end + 0.01;
  return bag;
}

/** The frequency contour of one syllable on note m (every shape lands on its note; LIFE 8.2). */
function contour(o: OscillatorNode, id: number, m: number, s: number, d: number, firm: boolean): void {
  const f = o.frequency, hz = midiHz(m), st = (n: number): number => midiHz(midiOf(stepOf(m) + n));
  let a = s;
  const start = (v: number): void => {
    if (firm) { f.setValueAtTime(v * 0.917, s); f.exponentialRampToValueAtTime(v, s + 0.012); a = s + 0.012; }   // firm: a small upward scoop
    else f.setValueAtTime(v, s);
  };
  // the glide keeps its own speed (90 ms rise, 136 ms fall) when LIFE stretches a syllable (a sung note): it then holds its note
  const glide = (k: number): number => s + Math.min(SYL_S[id] * k, d * k);
  switch (id) {
    case SYL.chirp: start(hz * 0.749); f.exponentialRampToValueAtTime(hz, glide(0.8)); break;            // up 5 semitones into the note
    case SYL.coo: start(hz * 1.26); f.exponentialRampToValueAtTime(hz, glide(0.85)); break;              // a fall of 4
    case SYL.trill: case SYL.yawn: case SYL.chitter: {                                                     // steps of the pentatonic
      const k = id === SYL.trill ? 3 : id === SYL.yawn ? 3 : 4;
      for (let j = 0; j < k; j++) {
        const v = id === SYL.trill ? st(j) : st(k - 1 - j);
        const u = s + (d * j) / k;
        if (j === 0) start(v); else f.setTargetAtTime(v, Math.max(a, u), id === SYL.yawn ? 0.03 : 0.0015);
      }
      break;
    }
    case SYL.hum: {                                                                                         // +-15 cents at 5.5 Hz
      start(hz);
      const n = Math.max(2, Math.ceil(d / 0.01));
      const c = new Float32Array(n);
      // faded in and out, so the curve ends at exactly 0: a curve holds its last value, and a residue detuned the rest of the phrase
      // (measured -14 cents on every syllable after a hum, AU-08)
      for (let i = 0; i < n; i++) { const u = (i * d) / (n - 1); c[i] = 15 * Math.sin(2 * Math.PI * 5.5 * u) * Math.min(1, u / 0.06, (d - u) / 0.04); }
      c[n - 1] = 0;
      o.detune.setValueCurveAtTime(c, s, d);
      break;
    }
    default: start(hz);                                                                                     // purr, peep: flat
  }
}

/** One syllable's amplitude envelope as a curve (0 at both ends): a raised-cosine attack and release around its body shape. */
function envelope(id: number, d: number, beads: boolean, A: number): Float32Array {
  const n = clamp(Math.ceil(d / DT) + 1, 3, CURVE.length);
  const att = Math.min(id === SYL.peep ? 0.005 : 0.012, d * 0.3), rel = Math.min(0.045, d * 0.4);
  for (let i = 0; i < n; i++) {
    const u = (i * d) / (n - 1);
    let v = u < att ? 0.5 - 0.5 * Math.cos((Math.PI * u) / att) : 1;
    if (u > d - rel) v *= 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, d - u)) / rel);
    switch (id) {
      case SYL.coo: v *= 1 - 0.25 * (u / d); break;
      case SYL.purr: v *= 0.62 + 0.38 * Math.cos(2 * Math.PI * 28 * u); break;                             // the 28 Hz flutter
      case SYL.trill: v *= 0.8 + 0.2 * Math.cos((2 * Math.PI * 3 * u) / d); break;
      case SYL.yawn: v *= Math.pow(Math.sin((Math.PI * u) / d), 0.6); break;
      case SYL.chitter: { const w = (u * 4) / d - Math.floor((u * 4) / d); v *= w < 0.12 ? w / 0.12 : w > 0.7 ? Math.max(0, (1 - w) / 0.3) : 1; break; }
      case SYL.peep: v *= Math.exp(-Math.max(0, u - att) / 0.02); break;
      default: break;
    }
    if (beads) {                                                                                             // 3 ms ticks, a 12 per s flutter
      v *= 0.78 + 0.22 * Math.cos(2 * Math.PI * 12 * u);
      if (u < 0.024) { const w = (u % 0.008) / 0.003; v = w < 1 ? Math.max(v, Math.sin(Math.PI * w)) : v * 0.35; }
    }
    CURVE[i] = A * (i === 0 || i === n - 1 ? 0 : v);
  }
  return CURVE.subarray(0, n);
}

/* ═══════════════════════════════ the backstop limiter (LIFE 10.1; AU-05, AU-10) ═══════════════════════════════ */

/** The syllable starts a phrase spends from the bucket: the most that start inside any 1 s of it. A spoken phrase (all within 0.7 s)
 *  spends one a syllable; a sung one (four notes over a bar) spends 2, so three singers fit the burst (LIFE 8.4: Sing together). */
export function sylStarts(syl: Float32Array, n: number): number {
  let best = 0;
  for (let i = 0; i < n; i++) { let c = 0; for (let j = 0; j < n; j++) { const d = fin(syl[j * 4 + 2], 0) - fin(syl[i * 4 + 2], 0); if (d >= 0 && d < 1) c++; } best = Math.max(best, c); }
  return Math.max(1, best);
}

export interface ChatterCaps { voices: number; refill: number; burst: number }

/** Pure, shaped like interact.ts BumpLimiter, driven by a clock in seconds (synthetic in the probe). At the desktop caps of LIFE 10.1
 *  (3 voices at once, a group voice counts 1 and an echo half; 4 syllable starts a second, burst 6), so a shell bug can never flood
 *  the engine; LIFE's attention budget is the real limiter. While the player is touching (setTouching), at most 1 syllable a second. */
export class ChatterLimiter {
  static readonly DESKTOP: ChatterCaps = { voices: 3, refill: 4, burst: 6 };
  static readonly PHONE: ChatterCaps = { voices: 2, refill: 3, burst: 4 };
  readonly caps: ChatterCaps;
  private tokens: number;
  private refillT = NaN;
  private nextSylT = -1e9;
  private ends: number[] = [];
  private ws: number[] = [];
  throttled = 0;
  constructor(caps: ChatterCaps = ChatterLimiter.DESKTOP) { this.caps = caps; this.tokens = caps.burst; }

  /** The voices sounding at t (their weights). */
  live(t: number): number {
    let w = 0;
    for (let i = this.ends.length - 1; i >= 0; i--) { if (this.ends[i] <= t) { this.ends.splice(i, 1); this.ws.splice(i, 1); } else w += this.ws[i]; }
    return w;
  }

  /** A phrase of nSyl syllables starting at t and lasting durS (weight 1, 1.5 with its echo): true when it may play. */
  admit(t: number, nSyl: number, durS: number, weight = 1, touching = false): boolean {
    const n = Math.max(1, nSyl | 0);
    if (!Number.isFinite(t) || !(durS >= 0)) { this.throttled++; return false; }
    this.tokens = Number.isNaN(this.refillT) ? this.tokens : Math.min(this.caps.burst, this.tokens + Math.max(0, t - this.refillT) * this.caps.refill);
    this.refillT = Number.isNaN(this.refillT) ? t : Math.max(this.refillT, t);
    if (this.live(t) + weight > this.caps.voices + 1e-9 || this.tokens < n - 1e-9 || (touching && t < this.nextSylT - 1e-3)) { this.throttled++; return false; }
    this.tokens -= n;
    this.nextSylT = t + n;
    this.ends.push(t + durS);
    this.ws.push(weight);
    return true;
  }
}

/** The persistent chatter bus (created at the first phrase): every phrase -> norm (the headroom plan: the sum of the voices sounding
 *  together never peaks more than 3 dB over one voice, AU-05) -> duck (the touch duck, -6 dB, AU-13) -> the chain's chatter input. A
 *  silent constant source keeps the two gains connected between phrases: measured in Chromium, a gain node with nothing connected to it
 *  does not advance its automation, so the duck's return (planned while no voice sounded) never happened. 3 persistent nodes. */
export interface ChatterBus { norm: GainNode; duck: GainNode }
export function chatterBus(ctx: Ctx, out: AudioNode): ChatterBus {
  const norm = ctx.createGain(), duck = ctx.createGain(), keep = ctx.createConstantSource();
  nodeCounters.created += 3;
  keep.offset.value = 0;
  keep.connect(norm); norm.connect(duck); duck.connect(out);
  keep.start();
  return { norm, duck };
}
