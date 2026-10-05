// WOBBLEHOARD round 3: interaction voices for the play mat with several squishies (REFERENCES.md "mix and match",
// pick-up-and-toss, tacky strands). Same rules as voices.ts: synthesised only (oscillators, filters, seeded noise, the
// Minnaert bubble), plain functions of (ctx, out, t0, params) so the live engine and the offline probe run identical code,
// every variation from the seeded `rng`. The designs are our own.
//
//   bump   two squishies colliding: a soft double thud (each body's own flex, the second a little higher and softer) with a
//          wet skin-on-skin slap between them and sometimes a suction bubble as they part. intensity -> level + brightness.
//   lift   pulled past its limit, the squishy unsticks from the mat: a short accelerating crackle of adhesive micro-ticks (the
//          tacky film letting go) ending in a suction "thwop" (a round tone sweeping up, air rushing in, a trapped bubble).
//   toss   a soft whoosh: band-passed noise swept up and back down (a fly-by), with the body's wobble as a light flutter.
//          speed -> level, brightness, shortness.
//   strand a tacky strand stretching (HELD, updated per frame): stick-slip excitation (a pulse wave at the slip rate) ringing
//          one narrow resonance (+ a softer mode at x1.5), fenced in by a high-pass and a low-pass that follow it, i.e. a
//          thin creak (separate slips) that turns into a squeak (a few harmonics in the band) as tension rises. Dead-man switches at the
//          audio-graph level: each update pushes the fade-to-silence 0.15 s and the sources' stop() 0.6 s ahead, so a caller
//          that stops calling leaves nothing behind.
//   strandSnap  the strand breaking: a small wet pop (click + a round blip), a recoil flick, then 1-3 tiny bubble pops.
import { clamp } from '../core/rng.ts';
import { Bag, bubble, c01, dbToGain, fin, harmonicWave, lerp, pulseWave, rexp, rlog, rr, type VoiceGroup } from './dsp.ts';
import { pitchOf, pluck, startTime, type VoiceBase } from './voices.ts';

type Ctx = BaseAudioContext;

/** Dry levels (dB, loudest layer), calibrated with the probe like voices.ts LV. */
const LV3 = {
  bump: [-19.5, -9.5],
  lift: -12,
  toss: [-5.5, -5],
  strand: -8,
  snap: -14,
};

/* ═══════════════════════════════════ bump ═══════════════════════════════════ */

export interface BumpParams extends VoiceBase { intensity: number }

export function bump(ctx: Ctx, out: AudioNode, t0: number, p: BumpParams): VoiceGroup {
  const t = startTime(t0);
  const i = c01(p.intensity, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'bump', p.pan ?? 0);
  const A = dbToGain(lerp(LV3.bump[0], LV3.bump[1], Math.pow(i, 0.85)));
  // the second body answers 14-34 ms later (sooner when the hit is harder)
  const gap = lerp(0.034, 0.014, i) * rr(r, 0.85, 1.15);
  const fA = (122 + 74 * i) * pr * rr(r, 0.96, 1.04);
  let endT = t;
  const thuds: [OscillatorNode, number][] = [];
  for (let k = 0; k < 2; k++) {
    const u = t + k * gap;
    const f1 = fA * (k ? rr(r, 1.2, 1.38) : 1);
    const f2 = f1 * lerp(0.64, 0.56, i);
    const o = bag.osc('sine', f1, u);
    o.setPeriodicWave(harmonicWave(ctx, 'bump', [1, 0.5, 0.18, 0.06]));
    o.frequency.setValueAtTime(f1, u);
    o.frequency.setTargetAtTime(f2, u, 0.02);
    const lp = bag.biquad('lowpass', (700 + 1700 * i) * pr, 0.6);
    lp.frequency.setValueAtTime((700 + 1700 * i) * pr, u);
    lp.frequency.setTargetAtTime(430 * pr, u, 0.028);
    const g = bag.gain(0);
    o.connect(lp); lp.connect(g); g.connect(bag.head);
    const e = pluck(g.gain, u, A * (k ? 0.7 : 1), 0.003, lerp(0.03, 0.022, i));
    thuds.push([o, e]);
    endT = Math.max(endT, e);
  }
  // the wet slap: skin on skin, a noise burst whose band falls quickly (a "smack"), brighter and stronger when harder
  const n = bag.noise(r, t, t + 0.12);
  const bp = bag.biquad('bandpass', lerp(1300, 2600, i) * pr, 1.1);
  const f0 = lerp(1300, 2600, i) * pr;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.setTargetAtTime(f0 * 0.55, t, 0.012);
  const ng = bag.gain(0);
  n.connect(bp); bp.connect(ng); ng.connect(bag.head);
  pluck(ng.gain, t + gap * 0.35, A * lerp(0.55, 1.15, i), 0.0012, lerp(0.007, 0.011, i));
  // suction as they part: sometimes one or two small bubbles
  const nb = r() < 0.35 + 0.5 * i ? (r() < 0.4 * i ? 2 : 1) : 0;
  for (let k = 0; k < nb; k++) {
    endT = Math.max(endT, bubble(ctx, bag.head, t + gap + rr(r, 0.012, 0.045), rr(r, 0.0018, 0.0042) / pr, A * rr(r, 0.22, 0.45), 0.35));
  }
  // the first thud's source lives until the last bubble has rung out: the bag (and its head, which the bubbles feed) must
  // not free itself under a ringing bubble (round-1 voices do the same)
  thuds[0][0].stop(Math.max(thuds[0][1], endT));
  thuds[1][0].stop(thuds[1][1]);
  bag.endTime = Math.max(endT, t + 0.12) + 0.02;
  return bag;
}

/** Rate limiter for bump (pure, so the probe can drive it with synthetic times). A pile settling calls bump() every frame
 *  for every touching pair; this turns that into a few soft, thinning taps instead of a machine gun. */
export class BumpLimiter {
  /** Bumps softer than this are contact noise: ignored. */
  static readonly MIN_INTENSITY = 0.04;
  /** Two accepted bumps are at least this far apart (s), unless the new one is much harder (x1.6). */
  static readonly MIN_GAP_S = 0.06;
  /** Token bucket: bursts of up to CAPACITY, then at most REFILL_PER_S per second. */
  static readonly CAPACITY = 4;
  static readonly REFILL_PER_S = 6;
  /** Each accepted bump in the last RECENT_S makes the next one softer: intensity x 1 / (1 + 0.35 n). */
  static readonly RECENT_S = 0.5;
  private tokens = BumpLimiter.CAPACITY;
  private lastT = -1e9;
  private lastI = 0;
  private refillT = -1e9;
  private recent: number[] = [];
  throttled = 0;

  /** Returns the intensity to play (attenuated for a busy pile), or null to skip this bump. `t` in seconds. */
  admit(intensity: number, t: number): number | null {
    const I = c01(intensity, 0);
    // a non-finite clock would poison the bucket for good (NaN tokens never compare < 1): such a call is dropped
    if (I < BumpLimiter.MIN_INTENSITY || !Number.isFinite(t)) { this.throttled++; return null; }
    if (this.refillT > -1e8) this.tokens = Math.min(BumpLimiter.CAPACITY, this.tokens + Math.max(0, t - this.refillT) * BumpLimiter.REFILL_PER_S);
    this.refillT = t;
    if ((t - this.lastT < BumpLimiter.MIN_GAP_S && I < this.lastI * 1.6) || this.tokens < 1) { this.throttled++; return null; }
    this.tokens -= 1;
    this.lastT = t;
    this.lastI = I;
    this.recent = this.recent.filter((u) => t - u < BumpLimiter.RECENT_S);
    const k = this.recent.length;
    this.recent.push(t);
    return I / (1 + 0.35 * k);
  }
}

/* ═══════════════════════════════════ lift ═══════════════════════════════════ */

export type LiftParams = VoiceBase;

export function lift(ctx: Ctx, out: AudioNode, t0: number, p: LiftParams): VoiceGroup {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'lift', p.pan ?? 0);
  const A = dbToGain(LV3.lift);
  // 1. peel: adhesive micro-ticks, Poisson, accelerating 80 -> 450 /s over 50-80 ms, band-passed 2.4 kHz
  const peel = rr(r, 0.05, 0.08);
  const nz = bag.noise(r, t, t + peel + 0.03);
  const bp = bag.biquad('bandpass', 2400 * pr, 1.6);
  const tg = bag.gain(0);
  nz.connect(bp); bp.connect(tg); tg.connect(bag.head);
  tg.gain.setValueAtTime(0, t);
  let u = t + 0.001;
  for (let guard = 0; guard < 60 && u < t + peel - 0.003; guard++) {
    const prog = (u - t) / peel;
    const lvl = A * 0.55 * rr(r, 0.4, 1) * (0.35 + 0.65 * prog);
    tg.gain.setValueAtTime(0, u);
    tg.gain.linearRampToValueAtTime(lvl, u + 0.0004);
    tg.gain.linearRampToValueAtTime(0, u + 0.0022);
    u += 0.0024 + rexp(r, lerp(80, 450, prog));
  }
  // 2. thwop: the suction lets go at the end of the peel: a round tone sweeping UP fast, air rushing in, a trapped bubble
  const tw = t + peel;
  const f0 = 150 * pr, f1 = 360 * pr;
  const o = bag.osc('sine', f0, tw);
  o.setPeriodicWave(harmonicWave(ctx, 'lift', [1, 0.35, 0.12]));
  o.frequency.setValueAtTime(f0, tw);
  o.frequency.setTargetAtTime(f1, tw, 0.018);
  const og = bag.gain(0);
  o.connect(og); og.connect(bag.head);
  let endT = pluck(og.gain, tw, A, 0.004, 0.032);
  const an = bag.noise(r, tw, tw + 0.16);
  const lp = bag.biquad('lowpass', 400 * pr, 0.9);
  lp.frequency.setValueAtTime(400 * pr, tw);
  lp.frequency.setTargetAtTime(1400 * pr, tw, 0.03);
  const ag = bag.gain(0);
  an.connect(lp); lp.connect(ag); ag.connect(bag.head);
  pluck(ag.gain, tw, A * 0.8, 0.006, 0.022);
  endT = Math.max(endT, bubble(ctx, bag.head, tw + rr(r, 0.015, 0.035), rr(r, 0.0025, 0.004) / pr, A * 0.45, 0.5));
  o.stop(Math.max(endT, tw + 0.16));          // outlives the bubble and the air (see bump)
  bag.endTime = Math.max(endT, tw + 0.16) + 0.02;
  return bag;
}

/* ═══════════════════════════════════ toss ═══════════════════════════════════ */

export interface TossParams extends VoiceBase { speed: number }

export function toss(ctx: Ctx, out: AudioNode, t0: number, p: TossParams): VoiceGroup {
  const t = startTime(t0);
  const s = c01(p.speed, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'toss', p.pan ?? 0);
  const A = dbToGain(lerp(LV3.toss[0], LV3.toss[1], Math.pow(s, 1.5)));
  const D = lerp(0.42, 0.26, s) * rr(r, 0.93, 1.07);           // faster = shorter fly-by
  // the fly-by: a band of noise sweeping up to its brightest at 42% of the flight and back down. Narrow when slow (a soft,
  // almost tonal "fff" whose sweep you can follow), wider when fast; a high-pass keeps the band's low skirt out (no
  // rumble under a soft toss) and the top is capped in Hz, so a small, high-pitched squishy thrown hard is not hissy.
  const fLo = 400 * pr, fHi = Math.min((900 + 2000 * s) * pr, 3000);
  const n = bag.noise(r, t, t + D + 0.06);
  const hp = bag.biquad('highpass', 0.6 * fLo, 0.7);
  const bp = bag.biquad('bandpass', fLo, lerp(2.6, 1.2, s));
  bp.frequency.setValueAtTime(fLo, t);
  bp.frequency.exponentialRampToValueAtTime(fHi, t + 0.42 * D);
  bp.frequency.exponentialRampToValueAtTime(fLo * 1.25, t + D);
  const lp = bag.biquad('lowpass', Math.min((1700 + 2800 * s) * pr, 4500), 0.6);
  // the body wobbles in flight: a light 9-13 Hz amplitude flutter
  const flutter = bag.gain(1);
  const lfo = bag.osc('sine', rr(r, 9, 13), t, t + D + 0.06);
  const depth = bag.gain(0.2);
  lfo.connect(depth); depth.connect(flutter.gain);
  const amp = bag.gain(0);
  n.connect(hp); hp.connect(bp); bp.connect(lp); lp.connect(flutter); flutter.connect(amp); amp.connect(bag.head);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(A * 0.35, t + 0.18 * D);
  amp.gain.linearRampToValueAtTime(A, t + 0.42 * D);
  amp.gain.exponentialRampToValueAtTime(A * 0.004, t + D);
  amp.gain.linearRampToValueAtTime(0, t + D + 0.012);
  bag.endTime = t + D + 0.08;
  return bag;
}

/* ═══════════════════════════════════ strand (held) ═══════════════════════════════════ */

export interface StrandVoice extends VoiceGroup {
  update(p: { tension: number; pan?: number }, atTime?: number): void;
  end(fadeS?: number, atTime?: number): void;
  readonly lastUpdateT: number;
}

/** How long a strand keeps sounding after its last update (gain dead-man), and when its sources stop by themselves. */
export const STRAND_SILENCE_S = 0.15;
export const STRAND_STOP_S = 0.6;
/** Stick-slip pulse shape (cosine harmonics of the slip rate): a soft, narrow strike once per slip. */
const SLIP_PULSE = [1, 0.92, 0.78, 0.6, 0.42, 0.27, 0.15, 0.07];

/**
 * The held strand (round-3 fix: the first version passed one weak high harmonic of a low saw through a narrow band-pass and
 * peaked at -28.6 dBFS in a realistic stretch; a constant hold sat at -47 dBFS RMS). Now the strand's own mode is struck
 * directly: a squeak carrier at the resonance `(1100 + 2100 T) * pitch` Hz, amplitude-pulsed by a stick-slip pulse train
 * at `(38 + 170 T^1.4) * pitch` Hz (two incommensurate wobbles make the slips irregular). At low tension the pulses are deep
 * and slow (separate creaks); as it tightens they get faster and shallower and merge into a gritty squeak. A band-pass
 * (Q 2.6) and a low-pass follow the carrier, so the grit stays in a band around it (a thin squeak, not a buzz). Level
 * `T^0.75 * (0.5 + 0.5 * motion)`, motion = |dT/dt| one-pole smoothed (60 ms); updates that land on the same audio-clock
 * step (two display frames per audio callback) are merged into the next step, so 30 Hz, 60 Hz, 120 Hz or jittered
 * callers sound the same. Cleanup: each update re-arms a gain dead-man (silent STRAND_SILENCE_S after the last update)
 * and keeps the sources' stop() STRAND_STOP_S ahead; the engine sweep ends any strand not updated for 0.4 s.
 */
export function strand(ctx: Ctx, out: AudioNode, t0: number, p: VoiceBase): StrandVoice {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'strand', p.pan ?? 0, true);
  const A = dbToGain(LV3.strand);
  const f0 = 1100 * pr;
  // the strand's mode: a sine with a whisper of 2nd harmonic, trembling a little (+/-12 cents at 5-7 Hz)
  const car = bag.osc('sine', f0, t);
  car.setPeriodicWave(harmonicWave(ctx, 'strandMode', [1, 0.1, 0.03]));
  const tr = bag.osc('sine', rr(r, 5, 7), t), trd = bag.gain(12);
  tr.connect(trd); trd.connect(car.detune);
  // stick-slip: the pulse train strikes the mode; its rate wobbles (+/-70 and +/-35 cents) so the slips are irregular
  const pw = pulseWave(ctx, 'slip', SLIP_PULSE);
  const slip = bag.osc('sine', 50 * pr, t);
  slip.setPeriodicWave(pw.wave);
  const j1 = bag.osc('sine', rr(r, 3.7, 4.9), t), j1d = bag.gain(70);
  const j2 = bag.osc('sine', rr(r, 10.5, 12.5), t), j2d = bag.gain(35);
  j1.connect(j1d); j1d.connect(slip.detune); j2.connect(j2d); j2d.connect(slip.detune);
  // amplitude a(t) = base + mod * pulse(t), with pulse in [pw.min, 1]: depth d maps the pulse onto (1 - d) .. 1
  const span = 1 - pw.min;
  const am = bag.gain(0), mod = bag.gain(0);
  slip.connect(mod); mod.connect(am.gain);
  const bp = bag.biquad('bandpass', f0, 2.6);
  const lp = bag.biquad('lowpass', 2.2 * f0, 0.7);
  const env = bag.gain(0);
  car.connect(am); am.connect(bp); bp.connect(lp); lp.connect(env); env.connect(bag.head);
  const sources: AudioScheduledSourceNode[] = [car, tr, slip, j1, j2];
  let stopAt = t + STRAND_STOP_S;
  for (const s of sources) s.stop(stopAt);
  bag.endTime = stopAt + 0.02;

  let ended = false;
  let lastT = t, lastTension = 0, lastUpdateT = t, motion = 0;
  const voice: StrandVoice = {
    kind: 'strand',
    held: true,
    get endTime() { return bag.endTime; },
    get alive() { return bag.alive; },
    get dying() { return bag.dying; },
    get lastUpdateT() { return lastUpdateT; },
    kill: (f, at) => bag.kill(f, at),
    free: () => bag.free(),
    update(q, atTime) {
      if (ended || !bag.alive || bag.dying) return;
      const tt = Math.max(t, fin(atTime, ctx.currentTime));
      const T = c01(q?.tension, 0);
      if (tt - lastT >= 0.004) {
        const dt = Math.min(tt - lastT, 0.1);
        const d = Math.abs(T - lastTension) / dt;
        motion += (clamp(d / 1.2, 0, 1) - motion) * (1 - Math.exp(-dt / 0.06));
        lastT = tt; lastTension = T;
      }
      lastUpdateT = Math.min(tt, ctx.currentTime + 0.5);
      const slipHz = (38 + 170 * Math.pow(T, 1.4)) * pr;
      const fres = Math.min((1100 + 2100 * T) * pr, 9000);
      const depth = lerp(0.95, 0.5, T);
      slip.frequency.setTargetAtTime(slipHz, tt, 0.03);
      car.frequency.setTargetAtTime(fres, tt, 0.03);
      bp.frequency.setTargetAtTime(fres, tt, 0.03);
      lp.frequency.setTargetAtTime(Math.min(fres * 2.2, 16000), tt, 0.03);
      am.gain.setTargetAtTime(1 - depth, tt, 0.03);
      mod.gain.setTargetAtTime(depth / span, tt, 0.03);
      const level = T < 0.02 ? 0 : A * Math.pow(T, 0.75) * (0.5 + 0.5 * motion);
      env.gain.cancelScheduledValues(tt);
      env.gain.setTargetAtTime(level, tt, 0.025);
      env.gain.setTargetAtTime(0, tt + STRAND_SILENCE_S, 0.02);      // dead-man: silent unless updated again (-65 dB 0.15 s later)
      if (typeof q?.pan === 'number' && Number.isFinite(q.pan) && bag.panner) bag.panner.pan.setTargetAtTime(clamp(q.pan, -1, 1), tt, 0.05);
      // dead-man at the graph level: the sources stop by themselves unless the caller keeps updating
      if (stopAt - tt < STRAND_STOP_S - 0.2) {
        stopAt = tt + STRAND_STOP_S;
        try { for (const s of sources) s.stop(stopAt); bag.endTime = stopAt + 0.02; } catch { /* a browser without re-stoppable sources: the engine sweep ends it */ }
      }
    },
    end(fadeS = 0.05, atTime) {
      if (ended) return;
      ended = true;
      bag.kill(fadeS, atTime);
    },
  };
  return voice;
}

/* ═══════════════════════════════════ strand snap ═══════════════════════════════════ */

export interface SnapParams extends VoiceBase { tension?: number }

export function strandSnap(ctx: Ctx, out: AudioNode, t0: number, p: SnapParams): VoiceGroup {
  const t = startTime(t0);
  const T = c01(p.tension, 0.7);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'strandSnap', p.pan ?? 0);
  const A = dbToGain(LV3.snap + 3 * (T - 0.7));
  // click: 2-3 ms band-passed noise
  const cd = rr(r, 0.002, 0.003);
  const cn = bag.noise(r, t, t + cd + 0.01);
  const cbp = bag.biquad('bandpass', 1900 * pr, 1);
  const cg = bag.gain(0);
  cn.connect(cbp); cbp.connect(cg); cg.connect(bag.head);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(A * 1.6, t + 0.0004);
  cg.gain.linearRampToValueAtTime(0, t + cd);
  // wet pop: a round blip chirping up (rounder than the bubble pop). It starts above the music's mallet register (<= 1175 Hz)
  // so a mallet note can never hide it
  const fb = rr(r, 1150, 1300) * pr;
  const o = bag.osc('sine', fb, t);
  o.frequency.setValueAtTime(fb, t);
  o.frequency.exponentialRampToValueAtTime(fb * 1.6, t + 0.02);
  const og = bag.gain(0);
  o.connect(og); og.connect(bag.head);
  let endT = pluck(og.gain, t + 0.0005, A * 1.2, 0.0012, 0.014);
  // recoil: the two halves spring back, a quick downward flick
  const fr = rr(r, 1600, 1850) * pr;
  const ro = bag.osc('sine', fr, t + 0.006);
  ro.frequency.setValueAtTime(fr, t + 0.006);
  ro.frequency.setTargetAtTime(fr * 0.5, t + 0.006, 0.014);
  const rg = bag.gain(0);
  ro.connect(rg); rg.connect(bag.head);
  const e2 = pluck(rg.gain, t + 0.006, A * 0.45, 0.002, 0.012);
  ro.stop(e2);
  endT = Math.max(endT, e2);
  const blipEnd = endT;
  // 1-3 tiny bubble pops
  const nb = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nb; k++) {
    endT = Math.max(endT, bubble(ctx, bag.head, t + rr(r, 0.02, 0.1) + 0.02 * k, rlog(r, 0.0007, 0.0016) / pr, A * rr(r, 0.35, 0.6), 0.45));
  }
  o.stop(Math.max(blipEnd, endT));            // outlives the bubbles (see bump)
  bag.endTime = Math.max(endT, t + 0.02) + 0.02;
  return bag;
}
