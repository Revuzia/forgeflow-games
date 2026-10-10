// GENESIS — the SFX catalog (CONTRACT §17): every one-shot sound, synthesized from layers at play time.
//
// A recipe receives an `Sfx` — a builder bound to one voice (its output, start time, randomness, the event's size and
// how many events it stands for) — and lays down layers: filtered noise with sweeps, oscillators with glides, FM,
// buffers from the bank (bells, plucks, crackle, thunder), a brass voice, a reverb send. Recipes are small and
// parameterised, so one recipe covers a family (an impact by its radius, a toll by how many died, a launch by the
// ship), and the catalog has an entry for every cue eventmap.ts can produce (tests/audio.test.ts checks it), every
// miracle and every disaster family. Unknown cues fall back to a soft generic tone, never silence and never an error.

import type { BufferBank } from './bank.ts';
import { BELL_BASE, PLUCKS, pluckRoot } from './bank.ts';
import { DISASTER_FAMILIES } from './eventmap.ts';
import { bq, bufSrc, envelope, glide, midiHz, osc, reedWave } from './synth.ts';
import type { Voice, VoicePool } from './voices.ts';

/** [type, frequency, Q, sweep-to frequency, sweep seconds] */
export type Filt = [BiquadFilterType, number, number?, number?, number?];

export interface SfxOptions {
  t: number;
  size: number;
  count: number;
  variant: string;
  rng: () => number;
}

/** the builder a recipe draws with; times are seconds after the voice's start */
export class Sfx {
  readonly ctx: BaseAudioContext;
  readonly bank: BufferBank;
  readonly t: number;
  readonly r: () => number;
  readonly size: number;
  readonly count: number;
  readonly variant: string;
  private readonly voice: Voice;
  private readonly pool: VoicePool;
  private readonly wetIn: AudioNode | null;
  private wetGain: GainNode | null = null;
  end: number;

  constructor(ctx: BaseAudioContext, bank: BufferBank, pool: VoicePool, voice: Voice, wetIn: AudioNode | null, o: SfxOptions) {
    this.ctx = ctx; this.bank = bank; this.pool = pool; this.voice = voice; this.wetIn = wetIn;
    this.t = o.t; this.r = o.rng; this.size = o.size; this.count = o.count; this.variant = o.variant;
    this.end = o.t;
  }

  /** random in [a, b) */
  rr(a: number, b: number): number { return a + (b - a) * this.r(); }

  /** send this voice to the reverb (0..1) */
  wet(x: number): void {
    if (!this.wetIn || x <= 0) return;
    if (!this.wetGain) {
      this.wetGain = this.ctx.createGain();
      this.voice.out.connect(this.wetGain);
      this.wetGain.connect(this.wetIn);
      this.voice.extra.push(this.wetGain);
    }
    this.wetGain.gain.value = x;
  }

  private filt(src: AudioNode, at: number, f?: Filt): AudioNode {
    if (!f) return src;
    const b = bq(this.ctx, f[0], f[1], f[2] ?? 0.707);
    if (f[3] != null) glide(b.frequency, at, f[1], f[3], f[4] ?? 0.5);
    src.connect(b);
    return b;
  }

  private finish(src: AudioScheduledSourceNode, node: AudioNode, g: GainNode, end: number): number {
    node.connect(g);
    g.connect(this.voice.out);
    this.pool.add(this.voice, src, end);
    if (end > this.end) this.end = end;
    return end;
  }

  /** filtered noise: attack, hold, release, peak; `rate` resamples the loop (lower = darker) */
  nz(color: 'white' | 'pink' | 'brown', at: number, a: number, hold: number, rel: number, peak: number, f?: Filt, rate = 1): number {
    const buf = this.bank.need(color);
    if (!buf) return this.t + at;
    const t0 = this.t + at;
    const end = t0 + a + hold + rel;
    const s = bufSrc(this.ctx, buf, t0, end, rate, true, this.r() * buf.duration);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, a, hold, rel, peak);
    return this.finish(s, this.filt(s, t0, f), g, end);
  }

  /** an oscillator gliding f0 → f1 over `gl` seconds */
  tn(wave: OscillatorType | PeriodicWave, at: number, f0: number, f1: number, gl: number, a: number, hold: number, rel: number, peak: number, f?: Filt, detune = 0): number {
    const t0 = this.t + at;
    const end = t0 + a + hold + rel;
    const o = osc(this.ctx, wave, f0, t0, end, detune);
    if (f1 !== f0) glide(o.frequency, t0, f0, f1, gl);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, a, hold, rel, peak);
    return this.finish(o, this.filt(o, t0, f), g, end);
  }

  /** vibrato on a tone (rate Hz, depth in cents) */
  vib(at: number, f0: number, rate: number, cents: number, a: number, hold: number, rel: number, peak: number, wave: OscillatorType = 'sine', f?: Filt): number {
    const t0 = this.t + at;
    const end = t0 + a + hold + rel;
    const o = osc(this.ctx, wave, f0, t0, end);
    const lfo = osc(this.ctx, 'sine', rate, t0, end);
    const depth = this.ctx.createGain();
    depth.gain.value = cents;
    lfo.connect(depth);
    depth.connect(o.detune);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, a, hold, rel, peak);
    this.pool.add(this.voice, lfo, end);
    return this.finish(o, this.filt(o, t0, f), g, end);
  }

  /** two-operator FM: carrier f, modulator f·ratio, index (deviation / modulator frequency) falling from i0 to i1 */
  fm(at: number, f: number, ratio: number, i0: number, i1: number, a: number, hold: number, rel: number, peak: number, f1 = f): number {
    const t0 = this.t + at;
    const end = t0 + a + hold + rel;
    const car = osc(this.ctx, 'sine', f, t0, end);
    const mod = osc(this.ctx, 'sine', f * ratio, t0, end);
    if (f1 !== f) { glide(car.frequency, t0, f, f1, a + hold + rel); glide(mod.frequency, t0, f * ratio, f1 * ratio, a + hold + rel); }
    const dev = this.ctx.createGain();
    dev.gain.setValueAtTime(i0 * f * ratio, t0);
    dev.gain.linearRampToValueAtTime(i1 * f1 * ratio, end);
    mod.connect(dev);
    dev.connect(car.frequency);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, a, hold, rel, peak);
    this.pool.add(this.voice, mod, end);
    return this.finish(car, car, g, end);
  }

  /**
   * a bank buffer at a playback rate: played once through (bells, plucks, thunder), or — given `dur` — looped from a
   * random point for that long with a fade at the end (textures: crackle, babble, hail, cicadas are seamless loops)
   */
  buf(name: string, at: number, rate: number, peak: number, f?: Filt, dur?: number, a = 0.002): number {
    const b = this.bank.need(name);
    if (!b) return this.t + at;
    const t0 = this.t + at;
    const len = dur ?? b.duration / rate;
    const end = t0 + len;
    const s = bufSrc(this.ctx, b, t0, end, rate, dur != null, dur != null ? this.r() * b.duration : 0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    if (dur != null) { g.gain.setValueAtTime(peak, Math.max(t0 + a, end - 0.25)); g.gain.linearRampToValueAtTime(0, end); }
    return this.finish(s, this.filt(s, t0, f), g, end);
  }

  /** a bell / bar from the bank at `hz` */
  bell(kind: 'toll' | 'chime' | 'glass' | 'anvil' | 'wood', at: number, hz: number, peak: number, f?: Filt, dur?: number): number {
    return this.buf(kind, at, hz / BELL_BASE[kind], peak, f, dur);
  }

  /** a plucked string (lyre / harp / pizz) at a MIDI note */
  pluck(inst: 'lyre' | 'harp' | 'pizz', at: number, midi: number, peak: number, f?: Filt): number {
    if (!PLUCKS[inst]) return this.t + at;
    const root = pluckRoot(midi);
    return this.buf(`pluck:${inst}:${root}`, at, Math.pow(2, (midi - root) / 12), peak, f);
  }

  /** a horn call: sawtooth with a brassy filter swell, a scoop up into the note and a little vibrato */
  horn(at: number, hz: number, dur: number, peak: number, bright = 1): number {
    const t0 = this.t + at;
    const end = t0 + dur + 0.25;
    const o1 = osc(this.ctx, 'sawtooth', hz, t0, end);
    const o2 = osc(this.ctx, 'sawtooth', hz, t0, end, 7);
    o1.detune.setValueAtTime(-45, t0);
    o1.detune.linearRampToValueAtTime(0, t0 + 0.07);
    const lp = bq(this.ctx, 'lowpass', hz * 1.2, 1.2);
    lp.frequency.setValueAtTime(hz * 1.2, t0);
    lp.frequency.linearRampToValueAtTime(hz * (3 + 3 * bright), t0 + 0.09);
    lp.frequency.setTargetAtTime(hz * (2 + 2 * bright), t0 + 0.12, 0.2);
    lp.frequency.setTargetAtTime(hz * 1.1, t0 + dur, 0.06);
    o1.connect(lp); o2.connect(lp);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, 0.05, Math.max(0, dur - 0.05), 0.22, peak);
    this.pool.add(this.voice, o2, end);
    return this.finish(o1, lp, g, end);
  }

  /** a vowel-like voice (choir 'ah' / chant): sawtooth through two formant bands */
  choir(at: number, hz: number, dur: number, peak: number, vowel: [number, number] = [700, 1150]): number {
    const t0 = this.t + at;
    const end = t0 + dur;
    const o1 = osc(this.ctx, 'sawtooth', hz, t0, end, -6);
    const o2 = osc(this.ctx, 'sawtooth', hz, t0, end, 7);
    const f1 = bq(this.ctx, 'bandpass', vowel[0], 5);
    const f2 = bq(this.ctx, 'bandpass', vowel[1], 7);
    const mix = this.ctx.createGain();
    o1.connect(f1); o2.connect(f1); o1.connect(f2); o2.connect(f2);
    f1.connect(mix); f2.connect(mix);
    const g = this.ctx.createGain();
    envelope(g.gain, t0, Math.min(0.6, dur * 0.35), dur * 0.3, dur * 0.35, peak * 3);
    this.pool.add(this.voice, o2, end);
    return this.finish(o1, mix, g, end);
  }

  /** an arpeggio of chimes / glass at MIDI notes */
  arp(kind: 'chime' | 'glass' | 'toll', at: number, midis: number[], step: number, peak: number, f?: Filt): number {
    let e = this.t;
    midis.forEach((m, i) => { e = Math.max(e, this.bell(kind, at + i * step, midiHz(m), peak * (1 - i * 0.06), f)); });
    return e;
  }

  /** a soft pad chord (sine + triangle per note) swelling in and out */
  pad(at: number, midis: number[], a: number, hold: number, rel: number, peak: number, f?: Filt): number {
    let e = this.t;
    for (const m of midis) {
      const hz = midiHz(m);
      e = Math.max(e, this.tn('sine', at, hz, hz, 0, a, hold, rel, peak / midis.length * 1.6, f, this.rr(-4, 4)));
      e = Math.max(e, this.tn('triangle', at, hz, hz, 0, a, hold, rel, peak / midis.length * 0.5, f, this.rr(-6, 6)));
    }
    return e;
  }

  /** a bird / creature syrinx tone */
  reed(at: number, f0: number, f1: number, gl: number, a: number, hold: number, rel: number, peak: number, f?: Filt): number {
    return this.tn(reedWave(this.ctx), at, f0, f1, gl, a, hold, rel, peak, f);
  }
}

export type Recipe = (s: Sfx) => void;

// ───────────────────────────── shared gestures ─────────────────────────────

const thud = (s: Sfx, at: number, peak: number, low = 1): void => {
  s.tn('sine', at, 110 * low, 48 * low, 0.12, 0.002, 0, 0.22, peak);
  s.nz('pink', at, 0.002, 0, 0.12, peak * 0.5, ['lowpass', 600 * low]);
};
const whoosh = (s: Sfx, at: number, dur: number, peak: number, lo = 300, hi = 1800): void => {
  s.nz('pink', at, dur * 0.45, 0, dur * 0.55, peak, ['bandpass', lo, 1.4, hi, dur * 0.5]);
  s.nz('white', at + dur * 0.15, dur * 0.35, 0, dur * 0.5, peak * 0.25, ['highpass', 3000]);
};
const rumble = (s: Sfx, at: number, dur: number, peak: number, f = 90): void => {
  s.nz('brown', at, Math.min(0.4, dur * 0.2), dur * 0.3, dur * 0.5, peak, ['lowpass', f, 0.9]);
};
const boom = (s: Sfx, at: number, peak: number, depth = 1): void => {
  s.nz('white', at, 0.001, 0, 0.06 + 0.04 * depth, peak * 0.7, ['highpass', 900]);
  s.tn('sine', at, 75 / Math.sqrt(depth), 28, 0.6 * depth, 0.003, 0.05, 1.2 * depth, peak);
  s.nz('brown', at, 0.01, 0.1, 2.2 * depth, peak * 0.9, ['lowpass', 220 / Math.sqrt(depth), 0.8]);
};
const crackleBurst = (s: Sfx, at: number, dur: number, peak: number, f?: Filt): void => {
  s.buf('crackle', at, s.rr(0.85, 1.2), peak, f, dur);
};
const shimmer = (s: Sfx, at: number, dur: number, peak: number): void => {
  s.nz('white', at, dur * 0.4, dur * 0.2, dur * 0.4, peak, ['bandpass', 7000, 2, 10000, dur]);
};
const chord = (root: number, iv: number[]): number[] => iv.map((x) => root + x);
const MAJ = [0, 4, 7], MIN = [0, 3, 7], ADD9 = [0, 4, 7, 14];

// ───────────────────────────── the catalog ─────────────────────────────

export const SFX: Record<string, Recipe> = {
  // ── the hand ──
  'hand.grab': (s) => {
    s.nz('pink', 0, 0.004, 0, 0.1, 0.55, ['bandpass', 900, 1.3]);
    s.tn('sine', 0, 95, 58, 0.09, 0.002, 0, 0.14, 0.45);
    s.nz('white', 0.01, 0.01, 0.02, 0.16, 0.12, ['highpass', 3200]);
  },
  'hand.whoosh': (s) => {
    const sp = Math.max(5, s.size);
    const k = Math.min(1, sp / 90);
    whoosh(s, 0, 0.35 + 0.5 * k, 0.35 + 0.55 * k, 250 + 200 * k, 900 + 1800 * k);
  },
  'hand.slap': (s) => {
    s.nz('white', 0, 0.001, 0, 0.05, 0.95, ['highpass', 1200]);
    s.tn('sine', 0, 150, 78, 0.06, 0.001, 0, 0.1, 0.65);
    s.nz('pink', 0.005, 0.004, 0, 0.18, 0.3, ['lowpass', 420]);
    s.wet(0.12);
  },
  'hand.stroke': (s) => {
    s.nz('pink', 0, 0.18, 0.12, 0.5, 0.28, ['bandpass', 520, 0.9, 950, 0.7]);
    s.pad(0.05, chord(64, MAJ), 0.25, 0.2, 0.8, 0.09);
    s.wet(0.3);
  },
  'hand.place': (s) => { thud(s, 0, 0.42); s.nz('white', 0, 0.003, 0, 0.08, 0.06, ['highpass', 2500]); },
  'hand.drop': (s) => { whoosh(s, 0, 0.3, 0.25, 700, 300); thud(s, 0.26, 0.4); },
  lost: (s) => {
    s.tn('sine', 0, 900, 2600, 1.4, 0.05, 0.3, 1.1, 0.22);
    whoosh(s, 0, 1.4, 0.3, 300, 2400);
    s.wet(0.3);
  },

  // ── miracles ──
  'miracle.cast': (s) => {
    s.arp('chime', 0, [72, 79, 84], 0.08, 0.32);
    whoosh(s, 0, 0.7, 0.25, 500, 2600);
    shimmer(s, 0.05, 1.2, 0.06);
    s.wet(0.45);
  },
  'miracle.water': (s) => {
    for (let i = 0; i < 9; i++) { const f = 380 + i * 140 + s.rr(-40, 40); s.tn('sine', i * 0.07, f, f * 1.6, 0.06, 0.003, 0, 0.09, 0.22); }
    s.nz('pink', 0.1, 0.4, 0.4, 0.9, 0.3, ['bandpass', 1200, 0.8]);
    s.buf('babble', 0.15, 1, 0.35, undefined, 1.6);
    s.arp('chime', 0.35, [76, 79, 83, 88], 0.11, 0.24);
    s.wet(0.45);
  },
  'miracle.food': (s) => {
    s.pad(0, chord(55, [0, 4, 7, 12]), 0.35, 0.5, 1.4, 0.32);
    [67, 71, 74, 79].forEach((m, i) => s.pluck('lyre', 0.15 + i * 0.12, m, 0.3));
    s.wet(0.4);
  },
  'miracle.heal': (s) => {
    s.arp('chime', 0, [72, 76, 79, 83, 86], 0.09, 0.28);
    s.pad(0.05, chord(60, [0, 7, 16]), 0.4, 0.6, 1.5, 0.22);
    shimmer(s, 0, 1.8, 0.05);
    s.wet(0.55);
  },
  'miracle.forest': (s) => {
    [55, 57, 60, 62, 64, 67, 69, 72].forEach((m, i) => s.bell('wood', i * 0.09, midiHz(m + 12), 0.32));
    s.nz('pink', 0.1, 0.6, 0.3, 1.0, 0.22, ['highpass', 1800]);
    s.fm(0.3, 70, 1.41, 3, 1, 0.3, 0.2, 0.6, 0.08);
    s.wet(0.3);
  },
  'miracle.storm': (s) => {
    s.buf(`thunder${Math.floor(s.r() * 3)}`, 0.25, 0.85, 0.8, ['lowpass', 1600]);
    s.nz('pink', 0, 0.8, 0.4, 1.4, 0.35, ['bandpass', 300, 3, 900, 1.2]);
    s.pad(0, chord(43, [0, 7, 15]), 0.6, 0.4, 1.4, 0.18, ['lowpass', 900]);
    s.wet(0.35);
  },
  'miracle.fire': (s) => {
    s.nz('white', 0, 0.25, 0, 0.5, 0.35, ['highpass', 400, 0.7, 4000, 0.3]);
    s.nz('brown', 0.05, 0.15, 0.4, 1.0, 0.7, ['lowpass', 380]);
    crackleBurst(s, 0.1, 1.6, 0.5);
    s.wet(0.2);
  },
  'miracle.fireball': (s) => {
    whoosh(s, 0, 0.6, 0.45, 300, 2200);
    s.nz('brown', 0, 0.2, 0.2, 0.6, 0.45, ['lowpass', 500]);
    s.tn('sawtooth', 0, 220, 90, 0.5, 0.01, 0.1, 0.4, 0.06, ['lowpass', 800]);
    s.wet(0.25);
  },
  'miracle.shield': (s) => {
    for (const [f, p] of [[220, 0.2], [330, 0.16], [440.6, 0.12], [661, 0.06]] as [number, number][]) s.tn('sine', 0, f, f, 0, 0.4, 0.6, 2, p, undefined, s.rr(-5, 5));
    s.fm(0, 880, 1.5, 2.5, 0.3, 0.3, 0.4, 1.6, 0.06);
    shimmer(s, 0.1, 2, 0.04);
    s.wet(0.55);
  },
  'miracle.lightning': (s) => {
    for (let i = 0; i < 6; i++) s.nz('white', i * 0.045 + s.rr(0, 0.02), 0.001, 0.012, 0.04, 0.4, ['highpass', 2000]);
    s.fm(0, 1800, 0.5, 6, 0.5, 0.005, 0.05, 0.45, 0.12, 300);
    s.wet(0.25);
  },
  'miracle.wood': (s) => {
    for (let i = 0; i < 5; i++) s.bell('wood', i * 0.16 + s.rr(0, 0.03), s.rr(300, 520), 0.5);
    s.fm(0.2, 85, 1.37, 4, 1, 0.2, 0.3, 0.5, 0.07);
    s.wet(0.2);
  },
  'miracle.fertility': (s) => {
    s.pad(0, chord(60, [0, 4, 7, 11, 14]), 0.6, 0.6, 1.8, 0.26);
    s.nz('pink', 0, 0.8, 0.3, 1.4, 0.08, ['bandpass', 1400, 0.8]);
    s.arp('glass', 0.4, [79, 83, 86], 0.25, 0.18);
    s.wet(0.55);
  },
  'miracle.calm': (s) => {
    s.pad(0, chord(67, [0, 7, 12]), 0.5, 0.3, 2.2, 0.22);
    s.pad(0.6, chord(60, [0, 7, 12]), 0.6, 0.2, 2.2, 0.2);
    s.nz('pink', 0, 0.3, 0.2, 2, 0.18, ['lowpass', 2500, 0.7, 300, 2.2]);
    s.wet(0.6);
  },
  'miracle.teach': (s) => {
    s.arp('chime', 0, [72, 77, 84], 0.14, 0.32);
    s.arp('glass', 0.3, [88], 0.1, 0.16);
    shimmer(s, 0.05, 1.2, 0.04);
    s.wet(0.5);
  },
  'miracle.meteor': (s) => {
    s.tn('sine', 0, 3200, 700, 1.5, 0.08, 0.4, 1.1, 0.16);
    s.nz('pink', 0, 0.9, 0.3, 0.8, 0.3, ['bandpass', 2500, 2, 600, 1.4]);
    s.wet(0.3);
  },

  // ── disaster stingers (by family) ──
  'disaster.incoming': (s) => {
    s.tn('sine', 0, 2600, 260, 2.6, 0.2, 1.6, 1.2, 0.18);
    s.nz('pink', 0, 1.6, 0.6, 1.2, 0.35, ['bandpass', 1800, 2.5, 300, 2.6]);
    rumble(s, 0.6, 3, 0.5, 120);
    s.wet(0.3);
  },
  'disaster.shower': (s) => {
    for (let i = 0; i < 5; i++) { const at = i * s.rr(0.25, 0.6); const f = s.rr(1800, 3200); s.tn('sine', at, f, f * 0.3, 1.2, 0.05, 0.3, 0.6, 0.1); s.nz('pink', at, 0.5, 0.2, 0.6, 0.12, ['bandpass', f * 0.7, 3, f * 0.2, 1]); }
    s.wet(0.35);
  },
  'disaster.comet': (s) => {
    s.nz('pink', 0, 1.8, 1, 1.8, 0.35, ['bandpass', 700, 1.5, 2400, 3.5]);
    s.arp('glass', 0.4, [84, 91, 96, 103], 0.35, 0.14);
    rumble(s, 1, 3, 0.3, 80);
    s.wet(0.5);
  },
  'disaster.swarm': (s) => {
    for (let i = 0; i < 6; i++) { const f = s.rr(170, 260); s.tn('sawtooth', 0, f, f * s.rr(0.97, 1.03), 3, 1.2, 0.8, 1.6, 0.06, ['lowpass', 1400]); }
    s.wet(0.15);
  },
  'disaster.eruption': (s) => { boom(s, 0, 0.95, 1.8); rumble(s, 0.2, 5, 0.6, 70); crackleBurst(s, 0.3, 2.5, 0.35, ['lowpass', 1800]); s.wet(0.3); },
  'disaster.quake': (s) => {
    rumble(s, 0, 4, 0.85, 75);
    s.nz('brown', 0.2, 0.3, 1.5, 1.5, 0.35, ['lowpass', 160]);
    crackleBurst(s, 0.4, 2.5, 0.22, ['lowpass', 900]);
    s.fm(0.6, 55, 1.33, 5, 1, 0.4, 0.8, 1, 0.08);
  },
  'disaster.collapse': (s) => { rumble(s, 0, 2.5, 0.7, 90); s.buf('hail', 0.15, 0.55, 0.45, ['lowpass', 1400], 1.8); thud(s, 0.9, 0.6, 0.7); },
  'disaster.rift': (s) => {
    for (let i = 0; i < 5; i++) s.nz('white', i * 0.12 + s.rr(0, 0.05), 0.001, 0.02, 0.15, 0.4, ['highpass', 1500]);
    s.nz('white', 0.3, 0.8, 1, 1.5, 0.15, ['bandpass', 3200, 1.5]);
    rumble(s, 0, 3.5, 0.65, 70);
  },
  'disaster.wave': (s) => {
    s.nz('pink', 0, 1.8, 0.2, 0.6, 0.5, ['lowpass', 400, 0.7, 1600, 2]);
    s.nz('brown', 0, 1.6, 0.6, 2, 0.6, ['lowpass', 260]);
    s.nz('white', 1.9, 0.02, 0.2, 2.2, 0.4, ['bandpass', 1600, 0.6]);
    s.buf('babble', 2, 0.8, 0.4, undefined, 2.4);
    s.wet(0.2);
  },
  'disaster.dry': (s) => { s.nz('pink', 0, 1.2, 0.8, 1.5, 0.3, ['bandpass', 1800, 1.4, 1200, 3]); s.buf('cicadas', 0.3, 1.1, 0.25, undefined, 3); },
  'disaster.wind': (s) => {
    s.nz('pink', 0, 1.4, 0.8, 1.8, 0.55, ['bandpass', 280, 7, 900, 1.8]);
    s.nz('brown', 0, 1, 1, 1.8, 0.5, ['lowpass', 220]);
    s.nz('pink', 0.4, 1, 0.5, 1.6, 0.25, ['bandpass', 1200, 9, 600, 2]);
  },
  'disaster.fire': (s) => {
    s.nz('white', 0, 0.4, 0, 0.6, 0.35, ['highpass', 300, 0.7, 3500, 0.5]);
    s.nz('brown', 0.1, 0.4, 1.4, 1.4, 0.75, ['lowpass', 420]);
    crackleBurst(s, 0.2, 3, 0.55);
  },
  'disaster.plague': (s) => {
    s.tn('sine', 0, 98, 98, 0, 1, 1.2, 1.6, 0.22); s.tn('sine', 0, 103.8, 103.8, 0, 1, 1.2, 1.6, 0.22);
    s.choir(0.3, 146.8, 3, 0.07, [450, 900]);
    s.nz('pink', 0.4, 0.8, 0.6, 1.2, 0.1, ['bandpass', 480, 2]);
    s.wet(0.45);
  },
  'disaster.blight': (s) => {
    crackleBurst(s, 0, 2.4, 0.3, ['highpass', 2500]);
    s.nz('pink', 0, 0.5, 0.8, 1.2, 0.18, ['highpass', 3000, 0.7, 1200, 2.4]);
    s.tn('sine', 0, 130.8, 116.5, 2.5, 0.6, 0.6, 1.4, 0.1);
  },
  'disaster.cosmic': (s) => {
    for (let i = 0; i < 3; i++) s.tn('sine', i * 0.55, s.rr(5000, 7000), s.rr(700, 1200), 1.1, 0.02, 0.2, 0.9, 0.09);
    for (let i = 0; i < 14; i++) s.nz('white', s.rr(0, 2), 0.001, 0.01, 0.03, 0.12, ['highpass', 3000]);
    s.pad(0, chord(50, [0, 7, 14]), 1, 0.6, 1.6, 0.12, ['lowpass', 1500]);
    s.wet(0.5);
  },
  'disaster.cold': (s) => {
    s.nz('white', 0, 1, 0.8, 1.6, 0.18, ['bandpass', 3200, 3, 2400, 3]);
    s.nz('white', 0.6, 0.001, 0, 0.04, 0.5, ['highpass', 2500]);
    s.fm(0.6, 2400, 2.71, 3, 0.2, 0.002, 0, 0.8, 0.1);
    s.fm(1.3, 1900, 2.71, 3, 0.2, 0.002, 0, 0.6, 0.07);
    s.wet(0.4);
  },
  'disaster.heat': (s) => {
    s.buf('cicadas', 0, 1.2, 0.3, undefined, 3);
    for (const f of [3500, 3530, 4210]) s.vib(0, f, 0.4, 15, 1, 1, 1.4, 0.03);
  },
  'disaster.gravity': (s) => {
    for (const f of [100, 150.5, 201]) s.tn('sine', 0, f, f * 4, 3, 0.8, 1.6, 1, 0.1);
    whoosh(s, 0, 2.6, 0.25, 200, 1500);
    s.wet(0.5);
  },
  'disaster.eclipse': (s) => {
    for (const f of [55, 82.6, 110.3]) s.tn('sawtooth', 0, f, f, 0, 2, 1, 2.5, 0.07, ['lowpass', 260]);
    s.bell('toll', 0.8, 98, 0.35, ['lowpass', 900]);
    s.wet(0.55);
  },
  'disaster.celestial': (s) => {
    s.nz('brown', 0, 3, 1, 2.5, 0.8, ['lowpass', 60, 0.8, 320, 4]);
    s.tn('sine', 0, 30, 45, 4, 2.5, 1, 2.5, 0.4);
    s.wet(0.3);
  },
  'disaster.acid': (s) => {
    s.nz('white', 0, 0.3, 1.5, 1, 0.22, ['highpass', 4500]);
    crackleBurst(s, 0, 2.6, 0.2, ['highpass', 3500]);
  },
  'disaster.glass': (s) => {
    for (let i = 0; i < 12; i++) s.bell('chime', s.rr(0, 2.2), s.rr(2000, 5200), s.rr(0.08, 0.2));
    s.nz('white', 0, 0.002, 0, 0.1, 0.35, ['highpass', 2000]);
    s.wet(0.45);
  },
  'disaster.growth': (s) => {
    for (let i = 0; i < 4; i++) s.fm(i * 0.5 + s.rr(0, 0.2), s.rr(60, 110), 1.41, 6, 1, 0.3, 0.4, 0.5, 0.07);
    s.nz('pink', 0, 1, 0.8, 1.4, 0.2, ['highpass', 1800]);
    for (let i = 0; i < 4; i++) s.bell('wood', 0.3 + i * 0.4, s.rr(250, 450), 0.3);
  },
  'disaster.leviathan': (s) => {
    s.reed(0, 80, 140, 1.6, 0.6, 1.2, 1.4, 0.18, ['lowpass', 700]);
    s.reed(2.2, 130, 62, 1.8, 0.5, 0.8, 1.6, 0.15, ['lowpass', 600]);
    s.nz('pink', 0, 1.4, 1.2, 1.8, 0.25, ['lowpass', 600]);
    s.wet(0.5);
  },
  'disaster.fog': (s) => {
    for (let i = 0; i < 6; i++) {
      const at = s.rr(0, 2.4);
      s.nz('pink', at, 0.3, 0.1, 0.5, 0.12, ['bandpass', s.rr(700, 1400), 6]);
      s.nz('white', at, 0.15, 0.05, 0.3, 0.05, ['bandpass', s.rr(2500, 4000), 4]);
    }
    s.pad(0, chord(47, [0, 3, 7]), 1.2, 0.8, 2, 0.08, ['lowpass', 900]);
    s.wet(0.6);
  },
  'disaster.stampede': (s) => {
    for (let i = 0; i < 28; i++) thud(s, s.rr(0, 2.6), s.rr(0.15, 0.35), s.rr(0.8, 1.3));
    rumble(s, 0, 3, 0.5, 120);
    s.nz('pink', 0.2, 1, 1, 1, 0.12, ['highpass', 1500]);
  },
  'disaster.end': (s) => {
    s.nz('pink', 0, 0.3, 0.3, 1.6, 0.2, ['lowpass', 2500, 0.7, 250, 2]);
    s.tn('sine', 0, 110, 82.4, 2, 0.4, 0.3, 1.6, 0.12);
    s.wet(0.4);
  },

  // ── the physical world ──
  impact: (s) => {
    const R = Math.max(5, s.size);
    const depth = Math.min(3, 0.6 + R / 80);
    boom(s, 0, 1, depth);
    s.buf('hail', 0.25 + 0.1 * depth, 0.5, 0.35, ['lowpass', 1600], 1.2 + depth);
    rumble(s, 0.1, 2 + depth * 2, 0.55, 90);
    s.wet(0.3);
  },
  'shield.hit': (s) => {
    s.nz('white', 0, 0.001, 0, 0.08, 0.5, ['highpass', 1500]);
    s.tn('sine', 0, 70, 40, 0.4, 0.003, 0, 0.8, 0.5);
    for (const f of [440, 660, 880.7]) s.tn('sine', 0, f, f, 0, 0.005, 0.1, 2.2, 0.12);
    s.wet(0.5);
  },
  thunder: (s) => {
    const k = Math.min(1.4, 0.6 + s.size * 0.3);
    s.buf(`thunder${Math.floor(s.r() * 3)}`, 0, s.rr(0.85, 1.12), 0.9 * k);
    s.wet(0.25);
  },
  quake: (s) => {
    const m = Math.max(3, s.size);
    const dur = 1.5 + (m - 3) * 0.9;
    rumble(s, 0, dur, Math.min(1, 0.3 + (m - 3) * 0.15), 70);
    crackleBurst(s, 0.2, dur * 0.7, 0.2, ['lowpass', 800]);
    s.tn('sine', 0, 38, 30, dur, 0.4, dur * 0.4, dur * 0.5, 0.3);
  },
  eruption: (s) => { boom(s, 0, 1, 2.2); rumble(s, 0.1, 4, 0.6, 80); crackleBurst(s, 0.25, 2, 0.3, ['lowpass', 2000]); s.wet(0.25); },
  landslide: (s) => { rumble(s, 0, 2.2, 0.6, 140); s.buf('hail', 0, 0.6, 0.5, ['lowpass', 2200], 2); },
  steam: (s) => { s.nz('white', 0, 0.06, 0.3, 1.1, 0.32, ['bandpass', 4200, 0.8]); s.nz('pink', 0, 0.1, 0.2, 0.8, 0.15, ['highpass', 1500]); },
  splash: (s) => {
    const k = Math.min(1, Math.max(0.2, s.size / 40));
    s.nz('white', 0, 0.003, 0.02, 0.35 + 0.3 * k, 0.6 * k + 0.2, ['bandpass', 1400, 0.7, 3000, 0.2]);
    s.tn('sine', 0, 160, 55, 0.15, 0.002, 0, 0.25, 0.4 * k);
    for (let i = 0; i < 6; i++) { const f = s.rr(500, 1400); s.tn('sine', 0.08 + i * s.rr(0.03, 0.08), f, f * 1.7, 0.04, 0.002, 0, 0.06, 0.12); }
    s.buf('babble', 0.1, 1.1, 0.25 * k, undefined, 0.8);
  },
  landed: (s) => {
    const k = Math.min(1.2, Math.max(0.25, s.size / 30));
    switch (s.variant) {
      case 'rock': thud(s, 0, 0.8 * k, 0.6); s.buf('hail', 0.02, 0.7, 0.3 * k, ['lowpass', 2500], 0.6); break;
      case 'tree': s.bell('wood', 0, 160, 0.7 * k); s.nz('pink', 0, 0.01, 0.1, 0.8, 0.35 * k, ['highpass', 1500]); thud(s, 0.05, 0.5 * k, 0.8); break;
      case 'building': thud(s, 0, 0.8 * k, 0.6); crackleBurst(s, 0.02, 1.2, 0.5 * k, ['lowpass', 2500]); s.buf('hail', 0.05, 0.5, 0.4 * k, ['lowpass', 1800], 1.2); break;
      case 'agent': thud(s, 0, 0.5 * k, 1.3); s.choir(0.02, 180, 0.25, 0.04, [600, 1000]); break;
      case 'creature': thud(s, 0, 0.9 * k, 0.5); rumble(s, 0.05, 1, 0.3 * k, 120); break;
      default: thud(s, 0, 0.45 * k, 1.1);
    }
  },
  'fire.ignite': (s) => { s.nz('white', 0, 0.2, 0, 0.4, 0.28, ['highpass', 500, 0.7, 3200, 0.25]); s.nz('brown', 0.05, 0.2, 0.3, 0.8, 0.45, ['lowpass', 380]); crackleBurst(s, 0.1, 1.4, 0.4); },
  'fire.kindle': (s) => { crackleBurst(s, 0, 0.9, 0.35); s.nz('brown', 0, 0.2, 0.2, 0.5, 0.2, ['lowpass', 300]); },
  healed: (s) => { s.bell('chime', 0, midiHz(88), 0.18); s.bell('chime', 0.08, midiHz(93), 0.12); s.wet(0.4); },
  built: (s) => {
    const n = s.variant === 'ship' ? 2 : 3;
    for (let i = 0; i < n; i++) s.bell(s.variant === 'ship' ? 'anvil' : 'wood', i * 0.18, s.variant === 'ship' ? 1150 : s.rr(380, 460), 0.45);
    s.pluck('lyre', n * 0.18 + 0.05, 67, 0.32);
    s.pluck('lyre', n * 0.18 + 0.2, 74, 0.32);
    s.wet(0.3);
  },
  trade: (s) => { for (let i = 0; i < 3; i++) s.bell('chime', i * 0.07 + s.rr(0, 0.02), s.rr(2600, 3400), 0.15); },
  theft: (s) => { for (let i = 0; i < 5; i++) s.nz('pink', i * 0.06, 0.003, 0, 0.04, 0.12, ['highpass', 1800]); s.tn('triangle', 0.1, 220, 207.7, 0.3, 0.02, 0.1, 0.3, 0.08); },
  attack: (s) => {
    s.tn('sawtooth', 0, 95, 120, 0.3, 0.05, 0.3, 0.3, 0.2, ['bandpass', 500, 2]);
    s.tn('sawtooth', 0.55, 620, 300, 0.25, 0.01, 0.05, 0.2, 0.1, ['bandpass', 1200, 2]);
  },
  launch: (s) => {
    // ignition crackle, the roar building as the engines throttle up, the sky-filling rumble as it climbs away
    s.nz('white', 0, 0.3, 0.3, 0.5, 0.3, ['highpass', 1800]);
    s.nz('brown', 0.2, 2.5, 3, 4, 0.95, ['lowpass', 120, 0.8, 420, 4]);
    s.nz('white', 0.4, 2, 3, 4, 0.3, ['bandpass', 2400, 0.6, 900, 7]);
    s.tn('sine', 0.3, 32, 44, 4, 2, 2.5, 3.5, 0.45);
    for (let i = 0; i < 20; i++) s.nz('white', 0.5 + s.rr(0, 5), 0.001, 0.02, 0.06, 0.18, ['bandpass', s.rr(800, 3000), 2]);
    s.wet(0.3);
  },
  countdown: (s) => {
    for (let i = 0; i < 3; i++) s.tn('sine', i * 0.8, 880, 880, 0, 0.005, 0.1, 0.06, 0.16);
    s.tn('sine', 2.4, 1320, 1320, 0, 0.005, 0.35, 0.1, 0.2);
  },
  battle: (s) => {
    for (let i = 0; i < 8; i++) s.bell('anvil', s.rr(0, 1.6), s.rr(900, 1700), s.rr(0.12, 0.28));
    s.buf('murmur2', 0, 1.3, 0.35, ['bandpass', 900, 0.8], 1.8);
    s.horn(0.2, 110, 0.9, 0.18, 0.6);
    rumble(s, 0, 1.8, 0.25, 160);
    s.wet(0.3);
  },
  'weather.gust': (s) => { s.nz('pink', 0, 0.9, 0.3, 1.4, 0.4, ['bandpass', 350, 5, 800, 1.2]); s.nz('brown', 0, 0.8, 0.4, 1.2, 0.35, ['lowpass', 200]); },

  // ── news of the peoples ──
  discovery: (s) => {
    const base = 72 + [0, 2, 5, 7][Math.floor(s.r() * 4)];
    const notes = s.variant === 'taught' ? [base, base + 7] : [base, base + 4, base + 7, base + 12].slice(0, 3 + (s.count > 2 ? 1 : 0));
    s.arp('chime', 0, notes, 0.11, 0.3);
    shimmer(s, 0.05, 1, 0.03);
    s.wet(0.45);
  },
  loss: (s) => {
    s.bell('chime', 0, midiHz(81), 0.25);
    s.bell('chime', 0.22, midiHz(77), 0.2);
    s.bell('chime', 0.5, midiHz(73.6), 0.16, ['lowpass', 1800]);
    s.wet(0.55);
  },
  refusal: (s) => { s.pluck('pizz', 0, 52, 0.4, ['lowpass', 900]); s.pluck('pizz', 0.03, 58, 0.35, ['lowpass', 900]); thud(s, 0, 0.2, 1.4); },
  birth: (s) => {
    s.pluck('lyre', 0, 72, 0.3);
    s.pluck('lyre', 0.14, 76, 0.3);
    if (s.count > 2) s.pluck('lyre', 0.28, 79, 0.26);
    s.bell('chime', 0.2, midiHz(91), 0.07);
    s.wet(0.35);
  },
  death: (s) => {
    const tolls = s.count > 6 ? 3 : s.count > 2 ? 2 : 1;
    for (let i = 0; i < tolls; i++) s.bell('toll', i * 2.2, s.variant === 'war' ? 174.6 : 196, 0.4 - i * 0.05, ['lowpass', 1300]);
    s.wet(0.6);
  },
  founded: (s) => { s.horn(0, 196, 0.45, 0.17); s.horn(0.5, 293.7, 0.8, 0.17); thud(s, 0, 0.25, 1.2); s.wet(0.45); },
  fallen: (s) => {
    s.bell('toll', 0, 146.8, 0.45, ['lowpass', 1000]);
    for (const f of [73.4, 87.3, 110]) s.tn('sawtooth', 0.2, f, f * 0.94, 3, 1, 1, 2, 0.05, ['lowpass', 400]);
    s.wet(0.6);
  },
  split: (s) => { s.pluck('lyre', 0, 67, 0.3); s.pluck('lyre', 0.2, 74, 0.28); s.pluck('lyre', 0.2, 60, 0.28); s.wet(0.3); },
  war: (s) => {
    s.horn(0, 110, 1.0, 0.22, 0.7);
    s.horn(1.15, 164.8, 1.3, 0.22, 0.7);
    for (let i = 0; i < 4; i++) thud(s, i * 0.55, 0.45, 0.65);
    s.wet(0.4);
  },
  siege: (s) => { for (let i = 0; i < 6; i++) thud(s, i * 0.42 + (i % 2) * 0.1, 0.5 - i * 0.03, 0.6); s.horn(0.9, 98, 1.2, 0.15, 0.5); s.wet(0.35); },
  conquest: (s) => {
    s.horn(0, 146.8, 0.5, 0.18); s.horn(0.55, 174.6, 0.5, 0.18); s.horn(1.1, 220, 1.2, 0.2);
    s.bell('toll', 1.4, 146.8, 0.3, ['lowpass', 1200]);
    s.wet(0.5);
  },
  treaty: (s) => { s.horn(0, 196, 1.2, 0.13, 0.5); s.horn(0.05, 246.9, 1.2, 0.11, 0.5); s.bell('chime', 0.6, midiHz(79), 0.18); s.wet(0.5); },
  plague: (s) => SFX['disaster.plague'](s),
  blight: (s) => SFX['disaster.blight'](s),
  extinction: (s) => { s.bell('toll', 0, 130.8, 0.38, ['lowpass', 900]); s.nz('pink', 0.5, 1.5, 0, 0.3, 0.12, ['lowpass', 600, 0.7, 2000, 1.5]); s.wet(0.65); },
  speciation: (s) => { s.arp('glass', 0, [76, 79, 83, 88], 0.16, 0.22); s.wet(0.5); },
  'age.golden': (s) => {
    for (const [m, i] of [[60, 0], [64, 1], [67, 2]] as [number, number][]) s.horn(i * 0.04, midiHz(m), 1.8, 0.11, 1);
    s.arp('chime', 0.5, [84, 88, 91, 96], 0.12, 0.2);
    s.wet(0.55);
  },
  'age.dark': (s) => {
    for (const m of [45, 48, 52]) s.tn('sawtooth', 0, midiHz(m), midiHz(m), 0, 1.2, 1, 2, 0.05, ['lowpass', 500]);
    s.bell('toll', 0.6, 110, 0.32, ['lowpass', 900]);
    s.wet(0.6);
  },
  milestone: (s) => { s.arp('chime', 0, [72, 76, 79, 84, 88], 0.1, 0.28); s.pad(0.1, chord(60, ADD9), 0.4, 0.6, 1.4, 0.2); s.wet(0.55); },
  'orbit.first': (s) => {
    s.pad(0, chord(50, [0, 7, 12, 16, 19, 26]), 1.2, 1.5, 2.5, 0.35);
    s.arp('glass', 0.8, [86, 90, 93, 98, 102], 0.2, 0.2);
    whoosh(s, 0, 2.5, 0.2, 200, 3000);
    s.wet(0.65);
  },
  contact: (s) => { s.fm(0, 392, 2.01, 2, 0.5, 0.05, 0.4, 1, 0.14); s.tn('triangle', 0.3, 587.3, 587.3, 0, 0.1, 0.5, 1, 0.12); s.tn('triangle', 0.9, 523.3, 523.3, 0, 0.1, 0.4, 1.2, 0.12); s.wet(0.5); },
  conversion: (s) => { s.choir(0, 220, 1.6, 0.06); s.choir(0, 277.2, 1.6, 0.05); s.choir(0, 329.6, 1.6, 0.05); s.wet(0.6); },
  worship: (s) => { s.choir(0, 196, 2.4, 0.05, [500, 900]); s.choir(0.1, 293.7, 2.3, 0.04, [500, 900]); s.wet(0.65); },
  rival: (s) => { s.horn(0, 73.4, 0.8, 0.18, 0.4); s.horn(0.02, 77.8, 0.8, 0.14, 0.4); s.wet(0.45); },
  'ship.orbit': (s) => { s.arp('glass', 0, [79, 86, 91], 0.25, 0.22); s.wet(0.6); },
  'ship.transfer': (s) => { whoosh(s, 0, 1.4, 0.16, 300, 1600); s.arp('glass', 0.3, [86, 83], 0.3, 0.14); s.wet(0.55); },
  arrival: (s) => { s.arp('glass', 0, [91, 86, 83, 79], 0.16, 0.2); s.pad(0.5, chord(55, MAJ), 0.4, 0.5, 1.4, 0.16); s.wet(0.55); },
  colony: (s) => { s.horn(0, 220, 0.5, 0.14); s.horn(0.55, 329.6, 0.9, 0.14); s.arp('glass', 0.9, [88, 93], 0.2, 0.15); s.wet(0.5); },
  'ship.lost': (s) => { s.arp('glass', 0, [81, 77, 74], 0.3, 0.18, ['lowpass', 2500]); s.nz('pink', 0, 0.6, 0.3, 1.5, 0.12, ['lowpass', 900]); s.wet(0.6); },
  'ship.home': (s) => { s.pad(0, chord(55, [0, 4, 7, 12]), 0.4, 0.6, 1.4, 0.24); s.arp('chime', 0.2, [79, 83, 86], 0.14, 0.18); s.wet(0.5); },
  'ship.program': (s) => { s.tn('square', 0, 660, 660, 0, 0.005, 0.08, 0.05, 0.05, ['lowpass', 2500]); s.tn('square', 0.18, 990, 990, 0, 0.005, 0.12, 0.08, 0.05, ['lowpass', 2500]); },
  'ship.fail': (s) => { s.tn('triangle', 0, 220, 220, 0, 0.02, 0.25, 0.3, 0.12); s.tn('triangle', 0.35, 196, 185, 0.4, 0.02, 0.3, 0.5, 0.12); },
  'world.cracked': (s) => {
    for (let i = 0; i < 6; i++) s.nz('white', i * 0.09, 0.001, 0.03, 0.2, 0.6, ['highpass', 1200]);
    boom(s, 0.1, 1, 3);
    s.nz('brown', 0.2, 1, 2, 4, 0.8, ['lowpass', 90]);
    s.arp('glass', 0.3, [96, 89, 102, 94, 87], 0.07, 0.18);
    s.wet(0.45);
  },
  'world.erased': (s) => {
    s.nz('pink', 0, 2.2, 0, 0.05, 0.6, ['lowpass', 200, 0.7, 6000, 2.2]);
    s.tn('sine', 2.25, 60, 22, 2, 0.005, 0.2, 2.5, 0.8);
    s.pad(2.4, chord(38, [0, 1, 7]), 1, 1, 3, 0.15, ['lowpass', 600]);
    s.wet(0.6);
  },
  'world.abandoned': (s) => { s.nz('pink', 0, 1, 0.5, 2, 0.25, ['bandpass', 400, 6, 250, 2.5]); s.arp('glass', 0.6, [76, 72], 0.5, 0.14); s.wet(0.6); },
  'chronicle.great': (s) => { s.bell('toll', 0, 98, 0.32, ['lowpass', 1400]); s.wet(0.6); },

  // ── the god's other acts ──
  shape: (s) => {
    const up = !/lower|dig|crater|sea/.test(s.variant);
    s.nz('brown', 0, 0.15, 0.2, 0.6, 0.6, ['lowpass', up ? 90 : 220, 1, up ? 260 : 80, 0.7]);
    s.buf('hail', 0.05, 0.6, 0.18, ['lowpass', 1600], 0.6);
  },
  'water.pour': (s) => { s.nz('pink', 0, 0.15, 0.4, 0.6, 0.35, ['bandpass', 950, 0.9]); s.buf('babble', 0.05, 1.05, 0.4, undefined, 1.1); },
  sky: (s) => { s.nz('pink', 0, 0.5, 0.2, 0.9, 0.3, ['bandpass', 900, 1.2, 2600, 1.2]); s.arp('glass', 0.15, [84, 91], 0.2, 0.1); s.wet(0.45); },
  cosmos: (s) => { s.tn('sine', 0, 40, 52, 2, 0.5, 0.6, 1.4, 0.4); s.pad(0, chord(62, [0, 7, 14, 21]), 0.6, 0.6, 1.6, 0.16); s.wet(0.55); },
  'air.breathe': (s) => {
    // an inhale (rising, opening) and a long exhale across the world
    s.nz('pink', 0, 1.2, 0.1, 0.2, 0.4, ['bandpass', 250, 0.8, 2600, 1.3]);
    s.nz('pink', 1.3, 0.3, 0.8, 2.2, 0.5, ['bandpass', 1800, 0.6, 400, 3]);
    s.choir(1.2, 110, 3.2, 0.05, [600, 1000]);
    s.wet(0.6);
  },
  'air.drain': (s) => { s.nz('pink', 0, 0.2, 1.4, 1.4, 0.45, ['bandpass', 1800, 0.8, 120, 2.8]); s.tn('sine', 0, 220, 55, 2.5, 0.2, 1, 1.5, 0.08); s.wet(0.4); },
  'life.bloom': (s) => { [67, 71, 74].forEach((m, i) => s.pluck('lyre', i * 0.1, m, 0.25)); s.nz('pink', 0, 0.3, 0.2, 0.6, 0.12, ['highpass', 2000]); s.wet(0.35); },
  'life.wither': (s) => { crackleBurst(s, 0, 1, 0.2, ['highpass', 2500]); s.tn('triangle', 0, 220, 196, 0.8, 0.05, 0.3, 0.6, 0.08); },
  touch: (s) => { s.tn('sine', 0, 520, 520, 0, 0.005, 0.03, 0.25, 0.12); s.bell('chime', 0.02, midiHz(91), 0.06); s.wet(0.3); },
  decree: (s) => { s.bell('toll', 0, 293.7, 0.2, ['lowpass', 2200]); s.wet(0.4); },
  idea: (s) => { s.arp('glass', 0, [84, 89], 0.12, 0.2); s.wet(0.45); },
  'creature.adopt': (s) => { s.reed(0, 140, 200, 0.5, 0.1, 0.3, 0.5, 0.15, ['lowpass', 1500]); s.arp('chime', 0.5, [79, 84], 0.15, 0.18); s.wet(0.35); },
  'creature.call': (s) => s.reed(0, 160, 120, 0.4, 0.05, 0.15, 0.3, 0.12, ['lowpass', 1400]),
  'creature.happy': (s) => {
    // a purr (low tone, fast amplitude flutter) and a rising coo
    s.vib(0, 70, 24, 40, 0.1, 0.6, 0.3, 0.2, 'sawtooth', ['lowpass', 400]);
    s.reed(0.3, 300, 520, 0.4, 0.05, 0.2, 0.3, 0.1, ['lowpass', 2500]);
  },
  'creature.hurt': (s) => { s.reed(0, 700, 300, 0.25, 0.01, 0.05, 0.25, 0.18, ['lowpass', 3000]); s.nz('white', 0, 0.002, 0, 0.08, 0.15, ['bandpass', 1500]); },
  'creature.learned': (s) => { s.reed(0, 300, 600, 0.3, 0.03, 0.1, 0.25, 0.1, ['lowpass', 2500]); s.bell('chime', 0.25, midiHz(88), 0.15); s.wet(0.4); },
  rewind: (s) => {
    s.nz('pink', 0, 0.9, 0, 0.05, 0.45, ['bandpass', 300, 1.6, 4000, 0.9]);
    for (let i = 0; i < 10; i++) s.nz('white', i * 0.08, 0.001, 0.005, 0.02, 0.12, ['highpass', 2500]);
    s.tn('sine', 0, 2000, 300, 0.9, 0.02, 0.6, 0.3, 0.05);
  },
  'world.birth': (s) => { s.tn('sine', 0, 30, 50, 2, 1, 0.5, 1.6, 0.45); s.pad(0.3, chord(57, [0, 7, 12, 14, 19]), 0.8, 0.6, 2, 0.24); shimmer(s, 0.5, 2, 0.05); s.wet(0.6); },
  gift: (s) => { s.bell('chime', 0, midiHz(76), 0.22); s.bell('chime', 0.1, midiHz(80), 0.18); thud(s, 0, 0.2, 1.2); s.wet(0.35); },
  'gift.refused': (s) => { thud(s, 0, 0.35, 0.9); s.tn('triangle', 0.05, 196, 196, 0, 0.01, 0.2, 0.4, 0.08); s.tn('triangle', 0.05, 207.7, 207.7, 0, 0.01, 0.2, 0.4, 0.07); },
  fireball: (s) => {
    const k = Math.min(2, 0.7 + s.size / 60);
    boom(s, 0, 0.9, k);
    s.nz('white', 0, 0.05, 0.2, 1.2, 0.3, ['bandpass', 1800, 0.6, 500, 1.2]);
    crackleBurst(s, 0.1, 2, 0.45);
    s.wet(0.3);
  },
  shield: (s) => SFX['miracle.shield'](s),

  // ── interface ──
  'ui.click': (s) => { s.tn('sine', 0, 1400, 1400, 0, 0.001, 0.005, 0.04, 0.08); },
  'ui.hover': (s) => { s.tn('sine', 0, 2200, 2200, 0, 0.002, 0, 0.03, 0.025); },
  'ui.open': (s) => { s.arp('glass', 0, [84, 91], 0.05, 0.1); },
  'ui.close': (s) => { s.arp('glass', 0, [91, 84], 0.05, 0.08); },
  'ui.arm': (s) => { s.bell('chime', 0, midiHz(86), 0.12); s.tn('sine', 0, 300, 600, 0.12, 0.005, 0.02, 0.12, 0.05); },
  // the arm turned over: a falling sweep under a lower, softer glass
  'ui.disarm': (s) => { s.tn('sine', 0, 620, 300, 0.14, 0.005, 0.02, 0.14, 0.05); s.bell('glass', 0.015, midiHz(79), 0.06, ['lowpass', 5000]); },
  // a selection stepping (the radial's hot slot, a highlighted row): a dry wooden tick, barely there
  'ui.tick': (s) => { s.bell('wood', 0, midiHz(91), 0.07, ['highpass', 700]); s.tn('sine', 0, 2600, 2600, 0, 0.001, 0, 0.012, 0.012); },
  // a switch: a wooden knock and a short bright click after it
  'ui.toggle': (s) => { s.bell('wood', 0, midiHz(84), 0.09); s.tn('sine', 0.028, 1320, 1320, 0, 0.001, 0.004, 0.03, 0.05); },
  // the radial blooming open: a breath of air and three quick glass notes
  'ui.radial': (s) => { s.nz('pink', 0, 0.06, 0, 0.14, 0.05, ['bandpass', 900, 1.2, 2400, 0.15]); s.arp('glass', 0.02, [79, 86, 91], 0.035, 0.07); s.wet(0.15); },
  'ui.confirm': (s) => { s.arp('chime', 0, [79, 86], 0.07, 0.16); s.wet(0.3); },
  'ui.error': (s) => { s.tn('triangle', 0, 233, 233, 0, 0.005, 0.08, 0.15, 0.12); s.tn('triangle', 0.12, 220, 220, 0, 0.005, 0.1, 0.2, 0.12); },
  'gesture.start': (s) => { shimmer(s, 0, 0.5, 0.04); s.tn('sine', 0, 600, 900, 0.4, 0.05, 0.1, 0.3, 0.05); },
  'gesture.ok': (s) => { s.arp('chime', 0, [74, 81, 86], 0.06, 0.2); s.wet(0.4); },
  'gesture.fail': (s) => { s.tn('sine', 0, 500, 300, 0.3, 0.01, 0.05, 0.3, 0.07); },
  whisper: (s) => {
    // a breath that almost says something: two formants drifting from 'h' toward 'a'
    s.nz('pink', 0, 0.5, 0.6, 1.4, 0.16, ['bandpass', 420, 4, 760, 1.6]);
    s.nz('pink', 0, 0.5, 0.6, 1.4, 0.1, ['bandpass', 1300, 6, 1150, 1.6]);
    s.nz('white', 0, 0.3, 0.5, 1.2, 0.04, ['bandpass', 3200, 2]);
    s.wet(0.7);
  },
  ignition: (s) => {
    // the opening: a black universe, then a star ignites — low roar building under a rising cluster, a bright
    // crack at the moment of ignition, and a lydian chord that blooms and settles into the hum of space
    s.tn('sine', 0, 22, 48, 3, 2.6, 2.5, 6, 0.38);
    s.nz('brown', 0.2, 2.2, 0.6, 5, 0.45, ['lowpass', 70, 0.9, 1400, 2.6]);
    s.nz('pink', 0.8, 1.6, 0.4, 4, 0.35, ['lowpass', 200, 0.8, 5200, 2]);
    s.nz('white', 2.5, 0.002, 0.05, 0.6, 0.5, ['highpass', 1200]);
    s.tn('sine', 2.5, 90, 30, 0.8, 0.003, 0.1, 2.5, 0.6);
    const cluster = [38, 45, 50, 52, 54, 57, 62, 64, 68, 73];
    cluster.forEach((m, i) => s.tn(i % 2 ? 'triangle' : 'sine', 1.2 + i * 0.12, midiHz(m - 0.4), midiHz(m), 1.6, 1.8, 3.5, 5, 0.06, ['lowpass', 3200]));
    s.pad(6.5, chord(50, [0, 7, 12, 16, 21, 26]), 2, 2.5, 5, 0.28);
    s.arp('glass', 2.6, [86, 93, 98, 102, 105], 0.18, 0.14);
    shimmer(s, 2.5, 4, 0.05);
    s.wet(0.7);
  },
};

// ───────────────────────────── ambient calls (played by ambience.ts and emitters.ts) ─────────────────────────────

const bird = (s: Sfx, at: number, f0: number, f1: number, d: number, peak: number): number =>
  s.tn('sine', at, f0, f1, d * 0.8, 0.004, d * 0.55, d * 0.45, peak);

Object.assign(SFX, {
  // birds by biome (birds of the day; owls by night)
  'bird.song': (s: Sfx) => {
    const n = 3 + Math.floor(s.r() * 6);
    const base = s.rr(2200, 4200);
    const up = s.r() < 0.5;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const f = base * (1 + s.rr(-0.22, 0.3));
      const d = s.rr(0.05, 0.13);
      if (s.r() < 0.35) s.vib(t, f, s.rr(28, 45), s.rr(60, 140), 0.005, d * 0.6, d * 0.4, 0.22);
      else bird(s, t, f, f * (up ? s.rr(1.08, 1.3) : s.rr(0.75, 0.93)), d, 0.24);
      t += d + s.rr(0.02, 0.07);
    }
  },
  'bird.lark': (s: Sfx) => {
    const n = 12 + Math.floor(s.r() * 16);
    const f1 = s.rr(3000, 4600), f2 = f1 * s.rr(1.12, 1.3);
    for (let i = 0; i < n; i++) bird(s, i * 0.034, i % 2 ? f2 : f1, (i % 2 ? f2 : f1) * 1.05, 0.026, 0.16);
  },
  'bird.jungle': (s: Sfx) => {
    const x = s.r();
    if (x < 0.35) for (let i = 0; i < 2; i++) s.reed(i * 0.32, s.rr(1200, 1500), s.rr(750, 900), 0.22, 0.01, 0.12, 0.12, 0.26, ['bandpass', 1800, 2]);
    else if (x < 0.7) for (let i = 0; i < 3; i++) bird(s, i * 0.45, 800 + i * 60, 1150 + i * 80, 0.35, 0.3);
    else bird(s, 0, s.rr(420, 520), s.rr(1000, 1150), 0.42, 0.32);
  },
  'bird.gull': (s: Sfx) => {
    const n = 2 + Math.floor(s.r() * 2);
    for (let i = 0; i < n; i++) s.reed(i * 0.42, s.rr(1400, 1650), s.rr(880, 1000), 0.3, 0.02, 0.14, 0.18, 0.13, ['bandpass', 1700, 1.6]);
  },
  'bird.water': (s: Sfx) => {
    if (s.r() < 0.6) {
      const n = 2 + Math.floor(s.r() * 3);
      for (let i = 0; i < n; i++) s.tn('sawtooth', i * 0.17, 430, 360, 0.1, 0.005, 0.05, 0.08, 0.12, ['bandpass', 1100, 3]);
    } else bird(s, 0, s.rr(2600, 2900), s.rr(3200, 3500), 0.28, 0.18);
  },
  'bird.taiga': (s: Sfx) => {
    if (s.r() < 0.4) { const p = s.rr(0.6, 1); for (let i = 0; i < 14; i++) s.bell('wood', i * 0.058, 1500 * p, 0.3 * (1 - i / 16)); }
    else { const f = s.rr(2700, 3300); bird(s, 0, f, f * 0.88, 0.45, 0.16); bird(s, 0.6, f * 0.92, f * 0.8, 0.5, 0.14); }
  },
  'bird.desert': (s: Sfx) => {
    const f = s.rr(450, 540);
    [0.35, 0.18, 0.5].forEach((d, i) => s.vib(i * 0.45, f * (i === 1 ? 1.06 : 1), 8, 25, 0.05, d * 0.5, d * 0.5, 0.16));
  },
  'bird.raptor': (s: Sfx) => {
    s.reed(0, s.rr(2700, 3000), s.rr(2100, 2400), 0.6, 0.03, 0.3, 0.35, 0.1, ['bandpass', 2600, 2]);
    s.nz('white', 0, 0.03, 0.3, 0.3, 0.03, ['bandpass', 2700, 3]);
  },
  'bird.night': (s: Sfx) => {
    const f = s.rr(340, 400);
    s.tn('sine', 0, f, f * 0.95, 0.35, 0.03, 0.2, 0.25, 0.2);
    s.tn('sine', 0.7, f * 1.02, f * 0.94, 0.5, 0.04, 0.3, 0.3, 0.18);
    s.wet(0.3);
  },
  // herd voices
  'herd.heavy': (s: Sfx) => s.tn('sawtooth', 0, s.rr(108, 125), s.rr(90, 100), 1.1, 0.12, 0.6, 0.4, 0.16, ['lowpass', 650, 2]),
  'herd.grazer': (s: Sfx) => { s.nz('white', 0, 0.005, 0.03, 0.12, 0.3, ['bandpass', 700, 2]); s.tn('sawtooth', 0.02, 300, 250, 0.1, 0.005, 0.03, 0.08, 0.12, ['bandpass', 900, 3]); },
  'herd.woolly': (s: Sfx) => s.vib(0, s.rr(300, 360), 7, 70, 0.04, 0.35, 0.2, 0.3, 'sawtooth', ['bandpass', 1000, 2]),
  'herd.equine': (s: Sfx) => { s.vib(0, s.rr(760, 880), 9, 110, 0.05, 0.5, 0.35, 0.26, 'sawtooth', ['bandpass', 1500, 2]); s.nz('pink', 0.8, 0.01, 0.05, 0.2, 0.22, ['bandpass', 500, 2]); },
  'herd.canine': (s: Sfx) => {
    if (s.variant === 'night') s.tn('triangle', 0, s.rr(380, 430), s.rr(540, 620), 0.8, 0.4, 1.2, 0.8, 0.3, ['lowpass', 1800]);
    else for (let i = 0; i < 2; i++) { s.nz('white', i * 0.22, 0.002, 0.02, 0.08, 0.3, ['bandpass', 900, 2]); s.tn('sawtooth', i * 0.22, 520, 380, 0.08, 0.003, 0.03, 0.06, 0.2, ['bandpass', 1100, 2]); }
    s.wet(0.25);
  },
  'herd.stocky': (s: Sfx) => { for (let i = 0; i < 2; i++) s.tn('sawtooth', i * 0.25, 96, 80, 0.2, 0.01, 0.1, 0.1, 0.3, ['bandpass', 500, 3]); },
  'herd.fowl': (s: Sfx) => { const n = 3 + Math.floor(s.r() * 3); for (let i = 0; i < n; i++) s.tn('triangle', i * 0.14, 650, 520, 0.06, 0.002, 0.03, 0.05, 0.32, ['bandpass', 1200, 2]); },
  'herd.whale': (s: Sfx) => { s.tn('sine', 0, s.rr(160, 200), s.rr(380, 460), 2, 0.5, 1.2, 1, 0.16, ['lowpass', 900]); s.wet(0.5); },
  'herd.ray': (s: Sfx) => s.nz('pink', 0, 0.6, 0.4, 0.8, 0.12, ['bandpass', 380, 2, 520, 1.5]),
  'herd.chitter': (s: Sfx) => { for (let i = 0; i < 6; i++) s.fm(i * 0.045, s.rr(2200, 2700), 1.7, 4, 1, 0.002, 0.01, 0.03, 0.08); },
  'herd.swarm': (s: Sfx) => { for (let i = 0; i < 3; i++) { const f = s.rr(190, 260); s.tn('sawtooth', 0, f, f, 0, 0.3, 0.5, 0.5, 0.04, ['lowpass', 1300]); } },
  // events inside the disaster / creature / ship beds
  'bed.whistle': (s: Sfx) => { const f = s.rr(1800, 3000); s.tn('sine', 0, f, f * 0.22, 1.4, 0.05, 0.4, 0.8, 0.12); s.nz('pink', 0, 0.6, 0.3, 0.6, 0.12, ['bandpass', f * 0.7, 3, f * 0.2, 1.2]); },
  'bed.whistler': (s: Sfx) => s.tn('sine', 0, s.rr(5000, 7500), s.rr(700, 1100), 1.2, 0.02, 0.2, 0.9, 0.07),
  'bed.crack': (s: Sfx) => { s.nz('white', 0, 0.001, 0.01, 0.05, 0.35, ['highpass', 2000]); s.fm(0, s.rr(1800, 2600), 2.71, 3, 0.2, 0.002, 0, 0.6, 0.07); },
  'bed.creak': (s: Sfx) => s.fm(0, s.rr(60, 120), 1.41, 6, 1, 0.25, 0.3, 0.4, 0.08),
  'bed.moan': (s: Sfx) => { s.reed(0, s.rr(75, 95), s.rr(130, 160), 1.4, 0.5, 1, 1.2, 0.14, ['lowpass', 700]); s.wet(0.5); },
  'bed.whisper': (s: Sfx) => { s.nz('pink', 0, 0.25, 0.1, 0.45, 0.22, ['bandpass', s.rr(700, 1400), 6]); s.nz('white', 0, 0.12, 0.05, 0.25, 0.09, ['bandpass', s.rr(2500, 4000), 4]); s.wet(0.6); },
  'bed.hoof': (s: Sfx) => { for (let i = 0; i < 4; i++) thud(s, i * s.rr(0.06, 0.12), s.rr(0.2, 0.4), s.rr(0.9, 1.4)); },
  'bed.tinkle': (s: Sfx) => { s.bell('chime', 0, s.rr(2400, 5200), s.rr(0.08, 0.2)); s.wet(0.4); },
  'bed.zap': (s: Sfx) => { s.nz('white', 0, 0.001, 0.02, 0.06, 0.3, ['highpass', 2500]); s.fm(0, 2200, 0.5, 5, 0.5, 0.002, 0.02, 0.3, 0.08, 400); },
  'bed.cough': (s: Sfx) => { for (let i = 0; i < 2; i++) { s.nz('pink', i * 0.28, 0.003, 0.03, 0.14, 0.18, ['bandpass', 650, 1.5]); s.tn('sawtooth', i * 0.28, 150, 120, 0.1, 0.003, 0.03, 0.1, 0.04, ['bandpass', 600, 2]); } },
  'bed.step': (s: Sfx) => { const k = Math.min(2.5, Math.max(0.5, s.size / 8)); thud(s, 0, Math.min(0.9, 0.25 + 0.2 * k), 1 / Math.sqrt(k)); },
  'bed.growl': (s: Sfx) => s.vib(0, s.rr(75, 105) / Math.max(0.6, Math.min(1.6, s.size / 10)), 14, 60, 0.08, 0.45, 0.3, 0.22, 'sawtooth', ['bandpass', 420, 2.5]),
  'bed.munch': (s: Sfx) => { for (let i = 0; i < 3; i++) s.nz('pink', i * 0.16 + s.rr(0, 0.04), 0.004, 0.02, 0.08, 0.16, ['bandpass', 900, 1.5]); },
  'bed.boom': (s: Sfx) => { boom(s, 0, 0.7, 1.4); crackleBurst(s, 0.2, 1.5, 0.25, ['lowpass', 1600]); },
  'bed.splash': (s: Sfx) => { s.nz('white', 0, 0.01, 0.1, 0.8, 0.35, ['bandpass', 1300, 0.6]); s.buf('babble', 0.05, 0.9, 0.3, undefined, 1); },
});

// every disaster family has a stinger (an assertion, not a TODO: a family added to eventmap must get a recipe)
for (const f of DISASTER_FAMILIES) if (!SFX[`disaster.${f}`]) throw new Error(`sfx: no recipe for disaster family '${f}'`);

/** a cue nobody wrote a recipe for (a mod's event): a soft neutral tone, never an error */
export const FALLBACK: Recipe = (s) => { s.bell('chime', 0, midiHz(79), 0.12); s.wet(0.3); };
