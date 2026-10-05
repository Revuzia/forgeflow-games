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
import { Bag, bubble, c01, dbToGain, fin, harmonicWave, lerp, rexp, rlog, rr, type VoiceGroup } from './dsp.ts';
import { pitchOf, pluck, startTime, type VoiceBase } from './voices.ts';

type Ctx = BaseAudioContext;

/** Dry levels (dB, loudest layer), calibrated with the probe like voices.ts LV. */
const LV3 = {
  bump: [-19.5, -9.5],
  lift: -12,
  toss: [-8, -4.5],
  strand: -15,
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
    if (I < BumpLimiter.MIN_INTENSITY) { this.throttled++; return null; }
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
  const fLo = 380 * pr, fHi = (900 + 2000 * s) * pr;
  const n = bag.noise(r, t, t + D + 0.06);
  const bp = bag.biquad('bandpass', fLo, 1.3);
  bp.frequency.setValueAtTime(fLo, t);
  bp.frequency.exponentialRampToValueAtTime(fHi, t + 0.42 * D);
  bp.frequency.exponentialRampToValueAtTime(fLo * 1.25, t + D);
  const lp = bag.biquad('lowpass', (1700 + 2800 * s) * pr, 0.6);
  // the body wobbles in flight: a light 9-13 Hz amplitude flutter
  const flutter = bag.gain(1);
  const lfo = bag.osc('sine', rr(r, 9, 13), t, t + D + 0.06);
  const depth = bag.gain(0.2);
  lfo.connect(depth); depth.connect(flutter.gain);
  const amp = bag.gain(0);
  n.connect(bp); bp.connect(lp); lp.connect(flutter); flutter.connect(amp); amp.connect(bag.head);
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

export function strand(ctx: Ctx, out: AudioNode, t0: number, p: VoiceBase): StrandVoice {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'strand', p.pan ?? 0, true);
  const A = dbToGain(LV3.strand);
  // stick-slip excitation: a band-limited saw at the slip rate, wobbled a little by two incommensurate LFOs (irregular slips)
  const src = bag.osc('sawtooth', 50 * pr, t);
  const j1 = bag.osc('sine', rr(r, 3.7, 4.9), t), j1d = bag.gain(70);
  const j2 = bag.osc('sine', rr(r, 10.5, 12.5), t), j2d = bag.gain(35);
  j1.connect(j1d); j1d.connect(src.detune); j2.connect(j2d); j2d.connect(src.detune);
  // the band: two high-pass stages at 0.6x and a low-pass at 2.2x the resonance keep the saw's comb out of the rest of the
  // spectrum (a thin squeak, not a buzz); all of them follow the resonance in update()
  const f0 = 1100 * pr;
  const hp = bag.biquad('highpass', 0.6 * f0, 0.7), hp2 = bag.biquad('highpass', 0.6 * f0, 0.7);
  const lpS = bag.biquad('lowpass', 2.2 * f0, 0.7);
  src.connect(hp); hp.connect(hp2);
  const res1 = bag.biquad('bandpass', f0, 12);
  const res2 = bag.biquad('bandpass', 1.5 * f0, 9);
  const g1 = bag.gain(1.6), g2 = bag.gain(0.5);
  hp2.connect(res1); res1.connect(g1); hp2.connect(res2); res2.connect(g2);
  const env = bag.gain(0);
  g1.connect(lpS); g2.connect(lpS); lpS.connect(env);
  // tiny level flutter (13-19 Hz): the strand trembles as it thins
  const fl = bag.gain(1);
  const fo = bag.osc('sine', rr(r, 13, 19), t), fod = bag.gain(0.22);
  fo.connect(fod); fod.connect(fl.gain);
  env.connect(fl); fl.connect(bag.head);
  const sources: AudioScheduledSourceNode[] = [src, j1, j2, fo];
  let stopAt = t + STRAND_STOP_S;
  for (const s of sources) s.stop(stopAt);
  bag.endTime = stopAt + 0.02;

  let ended = false;
  let lastT = t, lastTension = 0, lastUpdateT = t;
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
      const dt = clamp(tt - lastT, 0.008, 0.1);
      const motion = clamp(Math.abs(T - lastTension) / dt / 1.2, 0, 1);
      lastT = tt; lastTension = T;
      lastUpdateT = Math.min(tt, ctx.currentTime + 0.5);
      const slip = (38 + 170 * Math.pow(T, 1.4)) * pr;
      const fres = (1100 + 2100 * T) * pr;
      src.frequency.setTargetAtTime(slip, tt, 0.03);
      res1.frequency.setTargetAtTime(fres, tt, 0.03);
      res2.frequency.setTargetAtTime(fres * 1.5, tt, 0.03);
      hp.frequency.setTargetAtTime(fres * 0.6, tt, 0.03);
      hp2.frequency.setTargetAtTime(fres * 0.6, tt, 0.03);
      lpS.frequency.setTargetAtTime(Math.min(fres * 2.2, 16000), tt, 0.03);
      const level = T < 0.02 ? 0 : A * Math.pow(T, 0.8) * (0.45 + 0.55 * motion);
      env.gain.cancelScheduledValues(tt);
      env.gain.setTargetAtTime(level, tt, 0.025);
      env.gain.setTargetAtTime(0, tt + STRAND_SILENCE_S, 0.03);      // dead-man: silent unless updated again
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
