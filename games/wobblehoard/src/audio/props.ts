// SQUISH KEEPER (wobblehoard) PLAYGROUND thing voices that ship with the first load (PG_AUDIO; PLAYGROUND_BUILD.md 10): the ball (a
// felt or yarn ball's soft bump and its held roll), the held-voice helper with a dead-man switch (the ball's roll here; the cabin's
// creak in the away chunk), the Music Box tune (8 bars on the sounding field) and the kettle's 1-bar whistle, and TuneGate (the tune
// spacing rules, D-81). Plain functions of (ctx, out, t0, params) like every other voice; every draw from the caller's rng (the
// engine passes its PLAYGROUND stream, never engRng). The designs are our own.
import { clamp } from '../core/rng.ts';
import { Bag, dbToGain, fin, harmonicWave, type Rng, type VoiceGroup } from './dsp.ts';
import { BAR_S, FIELDS, SLOT_S, midiHz, pcOf } from './music.ts';
import { FIELD_REST, snapTo } from './creature.ts';

type Ctx = BaseAudioContext;

/** src/data/places.ts PROP_SOUND (mirrored, not imported: that module lives in the life chunk; probe_chatter checks they match). */
export const PROP = { ball: 1, creak: 2, chime: 3, splash: 4, crunch: 5, crackle: 6, boing: 7, bell: 8, tick: 9, kettle: 10, rustle: 11, whoosh: 12 } as const;
/** musicBox tune ids: 0 the Music Box (8 bars), 1 the kettle's whistle (1 bar). */
export const TUNE = { box: 0, kettle: 1 } as const;
export const TUNE_BARS = [8, 1];

/* ═══════════════════════════════ the ball ═══════════════════════════════ */

/** A felt (or yarn) ball's soft bump: a muffled round thump (a low sine body that drops a little) and a breath of felt. intensity
 *  0..1 -> level and brightness; `size` = the ball's radius (m). Dry peak about -14 dBFS at intensity 1, -30 at 0.1. */
export function ballBump(ctx: Ctx, out: AudioNode, t0: number, p: { rng: Rng; intensity: number; size?: number; pan?: number; soft?: number }): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), i = clamp(fin(p.intensity, 0.5), 0, 1), r = p.rng;
  const bag = new Bag(ctx, out, 'prop', fin(p.pan, 0));
  // round 2: size sets the ball apart (prop size): pitch goes as (0.22 / r)^2 and the thump lasts longer for a bigger ball, so the felt
  // ball (0.22, 230 Hz) and the yarn ball (0.24, 193 Hz, a fuller, slower thud) are 3 semitones and a few ms of body apart
  const sz = clamp(fin(p.size, 0.22), 0.1, 0.4) / 0.22;
  const f = (230 / (sz * sz)) * (1 + 0.04 * (r() - 0.5));
  const A = dbToGain(-30 + 16 * Math.sqrt(i)) * clamp(fin(p.soft, 1), 0, 1);
  const o = bag.osc('sine', f, t, t + 0.25);
  o.setPeriodicWave(harmonicWave(ctx, 'ball', [1, 0.25, 0.06]));
  o.frequency.setValueAtTime(f * 1.12, t);
  o.frequency.setTargetAtTime(f, t, 0.012);
  const g = bag.gain(0);
  o.connect(g); g.connect(bag.head);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(A, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, (0.03 + 0.02 * i) * sz * sz);
  const n = bag.noise(r, t, t + 0.06), lp = bag.biquad('lowpass', 700 + 1500 * i, 0.6), ng = bag.gain(0);
  n.connect(lp); lp.connect(ng); ng.connect(bag.head);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(A * 0.4, t + 0.002);
  ng.gain.setTargetAtTime(0, t + 0.002, 0.008);
  bag.endTime = t + 0.27;
  if (sz > 1) { o.stop(t + 0.25 * sz * sz); bag.endTime = t + 0.25 * sz * sz + 0.02; }
  return bag;
}

/* ═══════════════════════════════ held voices (a dead-man switch at the graph level) ═══════════════════════════════ */

export interface HeldProp extends VoiceGroup { lastUpdateT: number; update(level: number, at: number, pan?: number): void }

/** A held thing voice: `build` wires its sources into `into` (the level gain) and returns them; update(level 0..1) moves the level and
 *  re-arms the dead-man: fading 0.15 s after the last update (silent by 0.3 s), sources stopped 0.6 s after it, so a caller that stops calling leaves
 *  nothing behind (the strand's rule, interact.ts). `peak` = the level at 1. */
export function heldProp(ctx: Ctx, out: AudioNode, t0: number, kind: string, pan: number, peak: number,
  build: (bag: Bag, into: AudioNode, t: number) => AudioScheduledSourceNode[]): HeldProp {
  const t = Math.max(0, fin(t0, 0));
  const bag = new Bag(ctx, out, kind, pan, true);
  const env = bag.gain(0);
  env.connect(bag.head);
  const srcs = build(bag, env, t);
  let stopAt = t + 0.6;
  for (const s of srcs) s.stop(stopAt);
  bag.endTime = stopAt + 0.02;
  let last = t;
  return {
    kind, held: true,
    get endTime() { return bag.endTime; }, get alive() { return bag.alive; }, get dying() { return bag.dying; },
    get lastUpdateT() { return last; },
    kill: (f, at) => bag.kill(f, at), free: () => bag.free(),
    update(level, at, pn) {
      if (!bag.alive || bag.dying) return;
      const u = Math.max(t, fin(at, ctx.currentTime));
      last = u;
      env.gain.cancelScheduledValues(u);
      env.gain.setTargetAtTime(peak * clamp(fin(level, 0), 0, 1), u, 0.04);
      env.gain.setTargetAtTime(0, u + 0.15, 0.02);
      if (pn !== undefined && bag.panner) bag.panner.pan.setTargetAtTime(clamp(fin(pn, 0), -1, 1), u, 0.05);
      if (stopAt - u < 0.4) { stopAt = u + 0.6; try { for (const s of srcs) s.stop(stopAt); bag.endTime = stopAt + 0.02; } catch { /* the sweep ends it */ } }
    },
  };
}

/** A ball rolling: a soft brushed rumble (low-passed noise), louder with speed. */
export function ballRoll(ctx: Ctx, out: AudioNode, t0: number, rng: Rng, pan: number): HeldProp {
  return heldProp(ctx, out, t0, 'roll', pan, dbToGain(-34), (bag, into, t) => {
    const n = bag.noise(rng, t), lp = bag.biquad('lowpass', 320, 0.8);
    n.connect(lp); lp.connect(into);
    return [n];
  });
}

/* ═══════════════════════════════ tunes: the Music Box and the kettle (D-81) ═══════════════════════════════ */

/** Pure: the tune spacing rules of D-81, a backstop under the shell's own timers. The Music Box starts at most once per 40 s, a second
 *  tap stops it; the kettle never whistles while a Music Box tune plays or within 60 s of one; a Music Box tap stops a whistle. */
export class TuneGate {
  static readonly BOX_GAP_S = 40;
  static readonly KETTLE_CLEAR_S = 60;
  private boxStart = -1e9;
  private boxEnd = -1e9;
  private kettleEnd = -1e9;
  /** May tune `tune` (TUNE) start at t, lasting durS? Records it when yes. */
  admit(tune: number, t: number, durS: number): boolean {
    if (!Number.isFinite(t)) return false;
    if (tune === TUNE.box) {
      if (t - this.boxStart < TuneGate.BOX_GAP_S) return false;
      this.boxStart = t; this.boxEnd = t + durS; this.kettleEnd = Math.min(this.kettleEnd, t);
      return true;
    }
    if (t < this.boxEnd + TuneGate.KETTLE_CLEAR_S || t < this.kettleEnd) return false;
    this.kettleEnd = t + durS;
    return true;
  }
  /** The tune stopped at t (a second tap, or the Music Box cutting a whistle short). */
  stop(tune: number, t: number): void {
    if (tune === TUNE.box) this.boxEnd = Math.min(this.boxEnd, t); else this.kettleEnd = Math.min(this.kettleEnd, t);
  }
  playing(tune: number, t: number): boolean { return tune === TUNE.box ? t < this.boxEnd : t < this.kettleEnd; }
}

/** The Music Box's own tune (ours): 8 bars of [bar, eighth slot, scale step from the anchor, velocity]; the steps are read in the
 *  scale of the field sounding at each note, so it never clashes with the pad. */
const BOX_NOTES: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0.8], [0, 2, 2, 0.6], [0, 4, 1, 0.65], [0, 6, 0, 0.6],
  [1, 0, -1, 0.75], [1, 3, 0, 0.55], [1, 4, -2, 0.6],
  [2, 0, 0, 0.8], [2, 2, 2, 0.6], [2, 4, 3, 0.7], [2, 6, 2, 0.55], [2, 7, 1, 0.5],
  [3, 0, 2, 0.75],
  [4, 0, 3, 0.8], [4, 2, 2, 0.6], [4, 4, 1, 0.65], [4, 6, 0, 0.6],
  [5, 0, 1, 0.75], [5, 3, 0, 0.55], [5, 4, -1, 0.6],
  [6, 0, -2, 0.75], [6, 2, 0, 0.6], [6, 4, 1, 0.65], [6, 6, -1, 0.55],
  [7, 0, 0, 0.8],
];

/** One music-box tine: a bright plucked tone (a whisper of octave and twelfth) with a quick bloom and a ring of about a second. */
function tine(ctx: Ctx, out: AudioNode, t: number, m: number, vel: number): Bag {
  const bag = new Bag(ctx, out, 'tine', 0);
  const g = bag.head.gain, A = dbToGain(-19) * vel, e = t + 1.4;
  const o = bag.osc('sine', midiHz(m), t, e);
  o.setPeriodicWave(harmonicWave(ctx, 'tine', [1, 0.22, 0.09, 0.05]));
  o.connect(bag.head);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(A, t + 0.002);
  g.setTargetAtTime(A * 0.35, t + 0.002, 0.06);
  g.setTargetAtTime(0, t + 0.12, 0.28);
  bag.endTime = e;
  return bag;
}

/** A playing tune: built bar by bar by the engine's pump (advance), so each note reads the field that is sounding when it plays.
 *  `fieldAt(t)` gives it (0, home, with the music off). stop(at) drops what is not built and fades what rings. */
export class TuneVoice {
  readonly tune: number;
  readonly t0: number;
  readonly end: number;
  private i = 0;
  private stopped = Infinity;
  private bags: Bag[] = [];
  private readonly ctx: Ctx;
  private readonly out: AudioNode;
  private readonly fieldAt: (t: number) => number;
  private readonly reg: (g: VoiceGroup) => void;
  /** `reg` hands each note's group to the engine (polyphony, pause and mute free it like any voice). */
  constructor(ctx: Ctx, out: AudioNode, tune: number, t0: number, fieldAt: (t: number) => number, reg: (g: VoiceGroup) => void) {
    this.ctx = ctx; this.out = out; this.tune = tune; this.t0 = t0; this.fieldAt = fieldAt; this.reg = reg;
    this.end = t0 + TUNE_BARS[tune] * BAR_S;
  }
  get alive(): boolean { return this.ctx.currentTime < Math.min(this.end, this.stopped) + 1.5; }
  /** Build every note that starts before `until`; true when nothing is left. */
  advance(until: number): boolean {
    if (this.tune === TUNE.kettle) {
      if (this.i === 0 && this.t0 < until && this.stopped === Infinity) { this.i = 1; this.push(whistle(this.ctx, this.out, this.t0, this.fieldAt(this.t0))); }
      return this.i > 0;
    }
    while (this.i < BOX_NOTES.length) {
      const [bar, slot, step, vel] = BOX_NOTES[this.i];
      const t = this.t0 + bar * BAR_S + slot * SLOT_S;
      if (t >= until) break;
      this.i++;
      if (t >= this.stopped) continue;
      // the field's scale from F#5 to D7; the anchor is the scale note nearest E6, so the tune's whole span (-2..+3 steps) fits
      // under D7 (round 2 fix: an A6 anchor clamped steps +2 and +3 both onto D7, flattening bars 2 and 4 into repeated top notes)
      const mel = FIELDS[this.fieldAt(t)]?.mel ?? FIELDS[0].mel;
      const sc: number[] = [];
      for (let k = 78; k <= 98; k++) if (mel.includes(pcOf(k))) sc.push(k);
      let a = 0;
      for (let k = 1; k < sc.length; k++) if (Math.abs(sc[k] - 88) < Math.abs(sc[a] - 88)) a = k;
      this.push(tine(this.ctx, this.out, t, sc[clamp(a + step, 0, sc.length - 1)], vel));
    }
    if (this.bags.length > 8) this.bags = this.bags.filter((b) => b.alive);
    return this.i >= BOX_NOTES.length;
  }
  private push(b: Bag): void { this.bags.push(b); this.reg(b); }
  stop(at: number): void {
    this.stopped = Math.min(this.stopped, at);
    for (const b of this.bags) if (b.alive) b.kill(0.25, Math.max(at, this.ctx.currentTime));
  }
}

/** The Singing Kettle's whistle: one bar (3.6 s) of a breathy whistle on the field's rest tones (root, fifth, ninth) high up: it comes
 *  to the boil with a 0.5 s rising glide onto the fifth, steps up to the ninth, settles on the root, and fades. A sine with a soft
 *  octave, its level wobbling a little like steam, one oscillator for the whole bar. */
function whistle(ctx: Ctx, out: AudioNode, t: number, field: number): Bag {
  const bag = new Bag(ctx, out, 'whistle', 0.15);
  const rest = FIELD_REST[field] ?? FIELD_REST[0];
  // around A5..E6 (880..1320 Hz): high and whistly, but not shrill
  const m5 = snapTo(81, [rest[1]], 76, 88), m9 = snapTo(m5 + 7, [rest[2]], m5 + 1, m5 + 12), m1 = snapTo(m9 - 2, [rest[0]], m5 - 3, m9 + 3);
  const e = t + BAR_S, o = bag.osc('sine', midiHz(m5 - 3), t, e + 0.05);
  o.setPeriodicWave(harmonicWave(ctx, 'whistle', [1, 0.12, 0.03]));
  o.connect(bag.head);
  const f = o.frequency;
  f.setValueAtTime(midiHz(m5 - 3), t);
  f.exponentialRampToValueAtTime(midiHz(m5), t + 0.5);
  f.setTargetAtTime(midiHz(m9), t + 3 * SLOT_S, 0.025);
  f.setTargetAtTime(midiHz(m1), t + 5 * SLOT_S, 0.025);
  const g = bag.head.gain, A = dbToGain(-24);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(A * 0.5, t + 0.3);
  g.linearRampToValueAtTime(A, t + 0.6);
  for (let k = 1; k < 12; k++) g.linearRampToValueAtTime(A * (k % 2 ? 0.88 : 1), t + 0.6 + k * 0.2);
  g.linearRampToValueAtTime(A * 0.9, e - 0.6);
  g.linearRampToValueAtTime(0, e);
  bag.endTime = e + 0.06;
  return bag;
}
