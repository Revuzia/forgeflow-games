// WOBBLEHOARD voices. Every sound here is synthesised from oscillators, filters and seeded noise: no samples, no copied
// waveforms. Each voice is a plain function of (ctx, out, t0, params), so the SAME code drives the live engine and the
// OfflineAudioContext renders of the audio probe. Variation comes only from the seeded `rng` in the params.
//
// Wet sounds follow the "stream of tiny bubbles" idea: a Minnaert bubble is a damped sine at f0 ~ 3.26 / r Hz that chirps
// up a little as it settles (see dsp.ts `bubble`). Bubble radii are log-uniform ~0.4-6 mm and are divided by the pitch
// ratio, so a bigger (lower-pitch) squishy has bigger bubbles. Designs below are our own.
import { clamp } from '../core/rng.ts';
import {
  Bag, bubble, c01, dbToGain, fin, harmonicWave, lerp, rexp, rlog, rr,
  type Rng, type VoiceGroup,
} from './dsp.ts';

type Ctx = BaseAudioContext;

export interface VoiceBase {
  /** Seeded stream: all per-call variation (bubble sizes, timings, jitter) comes from here. */
  rng: Rng;
  /** Pitch ratio (1 = base). */
  pitch?: number;
  /** -1..1 */
  pan?: number;
  /** Optional pre-chosen +/-3% multiplier (the engine's round-robin supplies it); default: drawn from rng. */
  jitter?: number;
}

/** Pitch ratio including the +/-3% per-call variation. Always consumes exactly one rng draw. */
export function pitchOf(p: VoiceBase): number {
  const u = p.rng();
  const j = p.jitter !== undefined ? clamp(fin(p.jitter, 1), 0.95, 1.05) : 1 + 0.03 * (2 * u - 1);
  return clamp(fin(p.pitch, 1), 0.5, 2) * j;
}

export function startTime(t0: number): number { return Math.max(0, fin(t0, 0)); }

/** 0 -> peak over `att`, then exponential decay with time constant `tau`. Returns the time it is ~ -65 dB down. */
export function pluck(g: AudioParam, t: number, peak: number, att: number, tau: number): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + att);
  g.setTargetAtTime(0, t + att, tau);
  return t + att + 7.5 * tau;
}

/*
 * Voice levels in dB (the gain of the loudest layer, pre-chain). Calibrated with the probe so the DRY peak of each voice
 * (before the master chain) sits around -17 dBFS at its softest and -4..-5 dBFS at its hardest, i.e. the limiter is a
 * safety net and not part of the sound. The master chain adds about +2.9 dB to sustained tones and -1 dB to short hits.
 */
const LV = {
  poke: [-19.5, -9.5],
  release: [-20.5, -8],
  land: [-19.5, -8.5],
  pop: -15.5,
  squish: -8.5,
  blendMotor: -19,
  blendBell: -17,
};

/* ═══════════════════════════════════════════════ poke ═══════════════════════════════════════════════ */

export interface PokeParams extends VoiceBase { intensity: number }

/**
 * A soft wet "thup": a 120-260 Hz harmonic-rich body with a fast downward glide (rounded by a closing low-pass), a short
 * band-passed noise skin transient, and sometimes one small wet bubble. 80-180 ms. Intensity -> level, start pitch, brightness.
 */
export function poke(ctx: Ctx, out: AudioNode, t0: number, p: PokeParams): VoiceGroup {
  const t = startTime(t0);
  const i = c01(p.intensity, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'poke', p.pan ?? 0);
  const A = dbToGain(lerp(LV.poke[0], LV.poke[1], Math.pow(i, 0.9)));

  // body
  const f1 = (168 + 92 * i) * pr, f2 = (112 + 30 * i) * pr;
  const body = bag.osc('sine', f1, t);
  body.setPeriodicWave(harmonicWave(ctx, 'poke', [1, 0.55, 0.2, 0.07]));
  body.frequency.setValueAtTime(f1, t);
  body.frequency.setTargetAtTime(f2, t, 0.022);
  const lp = bag.biquad('lowpass', (1500 + 1900 * i) * pr, 0.6);
  lp.frequency.setValueAtTime((1500 + 1900 * i) * pr, t);
  lp.frequency.setTargetAtTime(520 * pr, t, 0.03);
  const amp = bag.gain(0);
  body.connect(lp); lp.connect(amp); amp.connect(bag.head);
  const tauB = lerp(0.034, 0.024, i);
  let endT = pluck(amp.gain, t, A, 0.0035, tauB);

  // skin transient
  const n = bag.noise(r, t, t + 0.12);
  const bp = bag.biquad('bandpass', (950 + 1250 * i) * pr, 1.0);
  const ng = bag.gain(0);
  n.connect(bp); bp.connect(ng); ng.connect(bag.head);
  pluck(ng.gain, t, A * (1.2 + 0.9 * i), 0.002, 0.0095);

  // one small wet bubble on most pokes
  if (r() < 0.45 + 0.4 * i) {
    const rad = rr(r, 0.0022, 0.0046) / pr;
    endT = Math.max(endT, bubble(ctx, bag.head, t + rr(r, 0.007, 0.028), rad, A * rr(r, 0.35, 0.7), 0.35));
  }
  body.stop(endT);
  bag.endTime = endT + 0.02;
  return bag;
}

/* ═══════════════════════════════════════════════ release ═══════════════════════════════════════════════ */

export interface ReleaseParams extends VoiceBase { compression: number }

/**
 * The "bloop" back: a sine pair glides UP while a damped 12-30 Hz amplitude wobble rings out. Deeper compression =>
 * lower start pitch, a bigger upward glide, deeper wobble and a longer tone (200-450 ms), plus a few escaping bubbles.
 */
export function release(ctx: Ctx, out: AudioNode, t0: number, p: ReleaseParams): VoiceGroup {
  const t = startTime(t0);
  const c = c01(p.compression, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'release', p.pan ?? 0);
  const A = dbToGain(lerp(LV.release[0], LV.release[1], Math.pow(c, 1.35)));
  const dur = 0.2 + 0.25 * c;
  const fa = (178 - 66 * c) * pr;
  const fb = fa * (1.75 + 1.05 * c);
  const glideT = dur * 0.5;

  const wob = bag.gain(1);               // 1 +/- depth * lfo: the damped wobble
  const amp = bag.gain(0);
  wob.connect(amp); amp.connect(bag.head);
  const lfoHz = (30 - 16 * c) * (1 + 0.1 * (r() - 0.5));
  const lfo = bag.osc('sine', lfoHz, t);
  const depth = bag.gain(0);
  const m0 = 0.22 + 0.42 * c;
  depth.gain.setValueAtTime(m0, t);
  depth.gain.setTargetAtTime(0, t + 0.04, 0.09);
  lfo.connect(depth); depth.connect(wob.gain);

  let endT = pluck(amp.gain, t, A / (1 + m0), 0.006, dur / 4.6);
  const pair: OscillatorNode[] = [];
  for (let k = 0; k < 2; k++) {
    const o = bag.osc('sine', fa * (k ? 2 : 1), t);
    const f0 = fa * (k ? 2.012 : 1), f1 = fb * (k ? 2.012 : 1);
    o.frequency.setValueAtTime(f0, t);
    // asymptotic glide (no corner where it arrives), then a slow droop as the surface settles
    o.frequency.setTargetAtTime(f1 * 1.04, t, glideT / 2.4);
    o.frequency.setTargetAtTime(f1 * 0.96, t + glideT * 1.5, 0.12);
    const g = bag.gain(k ? 0.34 : 1);
    o.connect(g); g.connect(wob);
    pair.push(o);
  }

  // a puff of air as the surface lets go
  const n = bag.noise(r, t, t + 0.1);
  const bp = bag.biquad('bandpass', lerp(1400, 2200, c) * pr, 0.8);
  const ng = bag.gain(0);
  n.connect(bp); bp.connect(ng); ng.connect(bag.head);
  pluck(ng.gain, t, A * 0.45, 0.002, 0.018);

  // a few escaping bubbles, more of them the harder it was squeezed
  const nb = Math.round(1 + 4 * c + r());
  for (let k = 0; k < nb; k++) {
    const rad = rlog(r, 0.0012, 0.0055) / pr;
    endT = Math.max(endT, bubble(ctx, bag.head, t + rr(r, 0.004, 0.02 + 0.2 * dur) , rad, A * rr(r, 0.18, 0.4), 0.4));
  }
  const stopT = endT;
  lfo.stop(stopT);
  for (const o of pair) o.stop(stopT);
  bag.endTime = stopT + 0.02;
  return bag;
}

/* ═══════════════════════════════════════════════ land ═══════════════════════════════════════════════ */

export interface LandParams extends VoiceBase { intensity: number }

/** A low soft plop/thud on the table, 60-140 ms: falling sine body, low-passed noise thump and one big bubble plop. */
export function land(ctx: Ctx, out: AudioNode, t0: number, p: LandParams): VoiceGroup {
  const t = startTime(t0);
  const i = c01(p.intensity, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'land', p.pan ?? 0);
  const A = dbToGain(lerp(LV.land[0], LV.land[1], Math.pow(i, 0.85)));

  const f1 = (150 + 50 * i) * pr, f2 = (60 + 12 * i) * pr;
  const body = bag.osc('sine', f1, t);
  body.setPeriodicWave(harmonicWave(ctx, 'land', [1, 0.42, 0.12]));
  body.frequency.setValueAtTime(f1, t);
  body.frequency.setTargetAtTime(f2, t, 0.026);
  const amp = bag.gain(0);
  body.connect(amp); amp.connect(bag.head);
  let endT = pluck(amp.gain, t, A, 0.004, lerp(0.026, 0.02, i));

  const n = bag.noise(r, t, t + 0.1);
  const lp = bag.biquad('lowpass', (330 + 150 * i) * pr, 0.8);
  const ng = bag.gain(0);
  n.connect(lp); lp.connect(ng); ng.connect(bag.head);
  pluck(ng.gain, t, A * (1.4 + 0.8 * i), 0.002, 0.013);

  endT = Math.max(endT, bubble(ctx, bag.head, t + rr(r, 0.003, 0.012), rr(r, 0.0062, 0.0088) / pr, A * 0.3, 0.55, 0.6));
  body.stop(endT);
  bag.endTime = endT + 0.02;
  return bag;
}

/* ═══════════════════════════════════════════════ pop ═══════════════════════════════════════════════ */

export interface PopParams extends VoiceBase { size?: number }

/** A bubble pop: a 2-5 ms band-passed click, a quick upward-chirped sine blip (size lowers the pitch) and a little air. */
export function pop(ctx: Ctx, out: AudioNode, t0: number, p: PopParams): VoiceGroup {
  const t = startTime(t0);
  const s = c01(p.size, 0.5);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'pop', p.pan ?? 0);
  const A = dbToGain(LV.pop);

  // click
  const clickDur = rr(r, 0.002, 0.005);
  const cn = bag.noise(r, t, t + clickDur + 0.01);
  const cbp = bag.biquad('bandpass', lerp(2700, 1900, s) * pr, 0.9);
  const cg = bag.gain(0);
  cn.connect(cbp); cbp.connect(cg); cg.connect(bag.head);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(A * 2.2, t + 0.0004);
  cg.gain.linearRampToValueAtTime(A * 1.1, t + clickDur * 0.5);
  cg.gain.linearRampToValueAtTime(0, t + clickDur);

  // chirped blip
  const fb0 = lerp(1500, 620, s) * pr;
  const blip = bag.osc('sine', fb0, t);
  blip.frequency.setValueAtTime(fb0, t);
  blip.frequency.exponentialRampToValueAtTime(fb0 * 1.95, t + 0.017);
  blip.frequency.setTargetAtTime(fb0 * 2.1, t + 0.017, 0.02);
  const bg = bag.gain(0);
  blip.connect(bg); bg.connect(bag.head);
  const endT = pluck(bg.gain, t + 0.0006, A * 1.5, 0.0009, lerp(0.0075, 0.013, s));
  blip.stop(endT);

  // air
  const an = bag.noise(r, t, t + 0.14);
  const abp = bag.biquad('bandpass', 2800 * pr, 0.7);
  const ag = bag.gain(0);
  an.connect(abp); abp.connect(ag); ag.connect(bag.head);
  pluck(ag.gain, t + 0.001, A * 0.55, 0.003, 0.016);

  bag.endTime = Math.max(endT, t + 0.14) + 0.02;
  return bag;
}

/* ═══════════════════════════════════════════════ squish (held) ═══════════════════════════════════════════════ */

export interface SquishParams extends VoiceBase {}

export interface SquishVoice extends VoiceGroup {
  update(p: { compression: number; rate: number; pan?: number }, atTime?: number): void;
  end(fadeS?: number, atTime?: number): void;
  /** Context time of the last update() (the engine auto-ends a held voice nobody has touched for seconds). */
  readonly lastUpdateT: number;
}

/**
 * Continuous squelch while pressed. Silent when `rate` is 0. Layers:
 *  - the "gurgle": noise through three band-pass resonances (bubbly formants) whose centres rise with compression, rise
 *    further while squeezing and fall while springing back, and are wobbled by slow independent LFOs; an irregular
 *    amplitude flutter (two incommensurate LFOs) makes it granular instead of a steady hiss;
 *  - a narrower "wet skin" band whose centre follows compression;
 *  - a Poisson stream of Minnaert bubbles whose rate follows |rate| (radii shrink as compression grows). This is the
 *    main layer; the noise bed sits underneath it.
 */
export function squish(ctx: Ctx, out: AudioNode, t0: number, p: SquishParams): SquishVoice {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'squish', p.pan ?? 0, true);
  const A = dbToGain(LV.squish);

  const env = bag.gain(0);       // follows |rate|
  const flutter = bag.gain(0.8); // irregular granular amplitude modulation
  const skinEnv = bag.gain(0);
  const mix = bag.gain(1);
  const mixHp = bag.biquad('highpass', 130, 0.7);   // no rumble under the formants
  const tone = bag.biquad('lowpass', 4600, 0.6);
  mix.connect(mixHp); mixHp.connect(tone); tone.connect(bag.head);
  const noise = bag.noise(r, t);
  noise.connect(env);
  noise.connect(skinEnv);
  env.connect(flutter);
  for (const [f, depth] of [[17 + 4 * r(), 0.24], [29 + 6 * r(), 0.16]]) {
    const l = bag.osc('sine', f, t);
    const d = bag.gain(depth);
    l.connect(d); d.connect(flutter.gain);
  }

  const base = [430, 980, 2050];
  const qs = [5.5, 6.5, 5.5];
  const gs = [1, 0.75, 0.45];
  const bands: BiquadFilterNode[] = [];
  for (let k = 0; k < 3; k++) {
    const bp = bag.biquad('bandpass', base[k] * pr, qs[k]);
    const g = bag.gain(gs[k] * 1.5);
    flutter.connect(bp); bp.connect(g); g.connect(mix);
    bands.push(bp);
    // each formant wanders on two slow LFOs of its own: the "bubbly" movement that survives a constant rate
    for (const [f, cents] of [[3.1 + 2.3 * k + r(), 150 + 40 * k], [7.5 + 3 * r() + 2 * k, 90]]) {
      const lfo = bag.osc('sine', f, t);
      const d = bag.gain(cents);
      lfo.connect(d); d.connect(bp.detune);
    }
  }
  const skin = bag.biquad('bandpass', 900 * pr, 2.2);
  const skinG = bag.gain(0.5);
  skinEnv.connect(skin); skin.connect(skinG); skinG.connect(mix);

  const bubBus = bag.gain(1);
  const bubHp = bag.biquad('highpass', 170, 0.7);
  const bubHp2 = bag.biquad('highpass', 170, 0.7);
  const bubLp = bag.biquad('lowpass', 5000, 0.6);
  bubBus.connect(bubHp); bubHp.connect(bubHp2); bubHp2.connect(bubLp); bubLp.connect(bag.head);

  let lastT = t, lastEnv = 0, dirS = 0, ended = false;
  let lastUpdateT = t;

  const voice: SquishVoice = {
    kind: 'squish',
    held: true,
    get endTime() { return bag.endTime; },
    get alive() { return bag.alive; },
    get dying() { return bag.dying; },
    get lastUpdateT() { return lastUpdateT; },
    kill: (f, at) => bag.kill(f, at),
    free: () => bag.free(),
    update(q, atTime) {
      if (ended || !bag.alive || bag.dying) return;   // stolen or ended: later updates are ignored
      const tt = Math.max(t, fin(atTime, ctx.currentTime));
      const c = c01(q.compression, 0);
      const rate = fin(q.rate, 0);
      const a = clamp((Math.abs(rate) - 0.04) / 2.6, 0, 1);
      const dir = rate >= 0 ? 1 : -1;
      const hop = clamp(tt - lastT, 0.008, 0.06);
      lastT = tt;
      lastUpdateT = Math.min(tt, ctx.currentTime + 0.5);
      dirS += (dir - dirS) * 0.35;
      // formant scale: rises with compression, rises while squeezing, falls while springing back
      const scale = (0.62 + 1.25 * c) * (1 + 0.2 * dirS) * pr;
      for (let k = 0; k < 3; k++) bands[k].frequency.setTargetAtTime(base[k] * scale, tt, 0.03);
      skin.frequency.setTargetAtTime(lerp(620, 3000, c) * pr * (1 + 0.12 * dirS), tt, 0.04);
      const target = A * Math.pow(a, 0.85);
      const tc = target > lastEnv ? 0.012 : 0.04;
      // Dead-man's switch: every update replaces the previous one (cancelScheduledValues drops it), so if the caller stops
      // updating (finger lifted, tab hidden, a bug) the squelch falls silent by itself ~0.5 s later instead of droning on.
      env.gain.cancelScheduledValues(tt);
      skinEnv.gain.cancelScheduledValues(tt);
      env.gain.setTargetAtTime(target * 1.25, tt, tc);
      skinEnv.gain.setTargetAtTime(target * 0.5, tt, tc);
      env.gain.setTargetAtTime(0, tt + 0.4, 0.06);
      skinEnv.gain.setTargetAtTime(0, tt + 0.4, 0.06);
      if (target < 1e-4) {
        env.gain.setTargetAtTime(0, tt + 0.15, 0.012);
        skinEnv.gain.setTargetAtTime(0, tt + 0.15, 0.012);
      }
      lastEnv = target;
      if (typeof q.pan === 'number' && Number.isFinite(q.pan)) {
        const pn = bag.panner;
        if (pn) pn.pan.setTargetAtTime(clamp(q.pan, -1, 1), tt, 0.05);
      }
      // bubbles: Poisson, rate follows |rate|; memoryless so each hop restarts the clock
      if (a > 0.015) {
        const lam = 95 * Math.pow(a, 1.05) * lerp(0.7, 1.2, c);
        let u = tt + 0.003;
        const end = tt + 0.003 + hop;
        for (let guard = 0; guard < 8; guard++) {
          u += rexp(r, lam);
          if (u >= end) break;
          const rad = rlog(r, 0.0004, 0.006) * lerp(1.15, 0.62, c) / pr;
          const amp = A * 0.5 * clamp(Math.pow(rad * pr / 0.002, 1.3), 0.05, 1.5) * (0.4 + 0.6 * a) * rr(r, 0.6, 1);
          bubble(ctx, bubBus, u, rad, amp, 0.3 * (0.6 + 0.4 * dirS));
        }
      }
    },
    end(fadeS = 0.08, atTime) {
      if (ended) return;
      ended = true;
      bag.kill(fadeS, atTime);
    },
  };
  return voice;
}

/* ═══════════════════════════════════════════════ blend ═══════════════════════════════════════════════ */

export interface BlendParams extends VoiceBase { count?: number; durationS?: number }
export type BlendVoice = VoiceGroup & { stop(): void };

/**
 * A blender: a motor that spools up (two detuned saws through a resonant low-pass whose cutoff follows the rpm, a
 * thin whine and a little grit), liquid slosh (slowly pulsing filtered noise + a Poisson bubble stream), a few glassy
 * clinks, a spool-down, then a rising soft bell cluster as the "finished" flourish. ~ durationS + 1.3 s in total.
 */
export function blend(ctx: Ctx, out: AudioNode, t0: number, p: BlendParams): BlendVoice {
  const t = startTime(t0);
  const D = clamp(fin(p.durationS, 2.2), 0.8, 8);
  const n = Math.round(clamp(fin(p.count, 3), 1, 8));
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'blend', p.pan ?? 0);
  const M = dbToGain(LV.blendMotor);
  const tEnd = t + D;

  // ---- motor ----
  const fRest = 112 * pr * (1 - 0.025 * (n - 1));
  const motorAmp = bag.gain(0);
  const motorLp = bag.biquad('lowpass', 260, 4.5);
  const motorOut = bag.biquad('lowpass', 4200, 0.6);
  motorLp.connect(motorAmp); motorAmp.connect(motorOut); motorOut.connect(bag.head);
  motorLp.frequency.setValueAtTime(240 * pr, t);
  motorLp.frequency.exponentialRampToValueAtTime(1500 * pr, t + 0.85);
  motorLp.frequency.setTargetAtTime(1250 * pr, t + 0.85, 0.5);
  motorLp.frequency.setTargetAtTime(380 * pr, tEnd - 0.22, 0.12);
  const lfoA = bag.osc('sine', 0.75 + 0.3 * r(), t);
  const lfoAd = bag.gain(55);
  const lfoB = bag.osc('sine', 2.7 + 0.6 * r(), t);
  const lfoBd = bag.gain(22);
  lfoA.connect(lfoAd); lfoB.connect(lfoBd);
  const lfoC = bag.osc('sine', 1.3, t);
  const lfoCd = bag.gain(260);          // filter cutoff wander (cents)
  lfoC.connect(lfoCd); lfoCd.connect(motorLp.detune);
  const saws: OscillatorNode[] = [];
  for (let k = 0; k < 2; k++) {
    const o = bag.osc('sawtooth', fRest, t);
    o.frequency.setValueAtTime(26 * pr, t);
    o.frequency.exponentialRampToValueAtTime(fRest * 1.14, t + 0.8);
    o.frequency.setTargetAtTime(fRest, t + 0.8, 0.35);
    o.frequency.setTargetAtTime(fRest * 0.45, tEnd - 0.22, 0.14);
    o.detune.value = k ? 14 : -9;
    lfoAd.connect(o.detune); lfoBd.connect(o.detune);
    const g = bag.gain(k ? 0.55 : 0.7);
    o.connect(g); g.connect(motorLp);
    saws.push(o);
  }
  const whine = bag.osc('sine', fRest * 6, t);
  whine.frequency.setValueAtTime(26 * pr * 6, t);
  whine.frequency.exponentialRampToValueAtTime(fRest * 6.8, t + 0.8);
  whine.frequency.setTargetAtTime(fRest * 6, t + 0.8, 0.35);
  whine.frequency.setTargetAtTime(fRest * 2.7, tEnd - 0.22, 0.14);
  lfoAd.connect(whine.detune);
  const whineG = bag.gain(0.1);
  whine.connect(whineG); whineG.connect(motorAmp);
  const grit = bag.noise(r, t, tEnd + 0.4);
  const gritHp = bag.biquad('highpass', 900, 0.7);
  const gritLp = bag.biquad('lowpass', 3200, 0.7);
  const gritG = bag.gain(0.1);
  grit.connect(gritHp); gritHp.connect(gritLp); gritLp.connect(gritG); gritG.connect(motorAmp);
  motorAmp.gain.setValueAtTime(0, t);
  motorAmp.gain.linearRampToValueAtTime(M, t + 0.4);
  motorAmp.gain.setValueAtTime(M, tEnd - 0.26);
  motorAmp.gain.linearRampToValueAtTime(0, tEnd + 0.08);

  // ---- slosh ----
  const sn = bag.noise(r, t, tEnd + 0.4);
  const sbp = bag.biquad('bandpass', 520 * pr, 1.7);
  const sAm = bag.gain(0.55);
  const sEnv = bag.gain(0);
  sn.connect(sbp); sbp.connect(sAm); sAm.connect(sEnv); sEnv.connect(bag.head);
  const sl1 = bag.osc('sine', 1.05 + 0.4 * r(), t);
  const sl1d = bag.gain(0.42);
  sl1.connect(sl1d); sl1d.connect(sAm.gain);
  const sl2 = bag.osc('sine', 0.62 + 0.2 * r(), t);
  const sl2d = bag.gain(520);
  sl2.connect(sl2d); sl2d.connect(sbp.detune);
  const sloshPeak = M * (0.9 + 0.08 * n);
  sEnv.gain.setValueAtTime(0, t);
  sEnv.gain.linearRampToValueAtTime(0, t + 0.2);
  sEnv.gain.linearRampToValueAtTime(sloshPeak, t + 0.9);
  sEnv.gain.setValueAtTime(sloshPeak, tEnd - 0.3);
  sEnv.gain.linearRampToValueAtTime(0, tEnd + 0.1);

  // ---- bubble stream (liquid) ----
  let endT = tEnd + 0.4;
  {
    const lam = 9 + 3.5 * n;
    let u = t + 0.35;
    const stop = tEnd - 0.1;
    while (true) {
      u += rexp(r, lam);
      if (u >= stop) break;
      const rad = rlog(r, 0.0016, 0.0062) / pr;
      bubble(ctx, bag.head, u, rad, M * 0.5 * clamp(rad * pr / 0.003, 0.3, 1.6) * rr(r, 0.5, 1), 0.25, 1.2);
    }
  }

  // ---- glassy clinks ----
  const clinks = Math.min(2 + n, 6);
  for (let k = 0; k < clinks; k++) {
    const u = t + rr(r, 0.5, Math.max(0.6, D - 0.35));
    const f0 = rr(r, 1500, 2300) * pr;
    const ratios = [1, 2.32, 3.87];
    const amps = [1, 0.5, 0.2];
    const taus = [0.085, 0.05, 0.03];
    const gain = M * 0.36 * rr(r, 0.6, 1);
    for (let q = 0; q < 3; q++) {
      const o = bag.osc('sine', f0 * ratios[q], u, u + 7.5 * taus[q] + 0.01);
      const g = bag.gain(0);
      o.connect(g); g.connect(bag.head);
      pluck(g.gain, u, gain * amps[q], 0.0006, taus[q]);
    }
    endT = Math.max(endT, u + 0.7);
  }

  // ---- finishing flourish: a rising soft bell cluster ----
  {
    const root = 523.25 * pr;
    const notes = [1, 1.25, 1.5, 2];
    const tF = tEnd - 0.02;
    for (let k = 0; k < notes.length; k++) {
      const u = tF + k * (0.062 + 0.01 * k);
      const f = root * notes[k] * (1 + 0.004 * (r() - 0.5));
      const last = k === notes.length - 1;
      const tau = last ? 0.2 : 0.11 + 0.01 * k;
      const gainB = dbToGain(LV.blendBell) * (0.7 + 0.1 * k);
      const parts = [[1, 1], [2.76, 0.22], [5.4, 0.07]];
      for (const [ratio, amp] of parts) {
        const o = bag.osc('sine', f * ratio, u, u + 7.5 * tau * (ratio > 1 ? 0.6 : 1) + 0.02);
        const g = bag.gain(0);
        o.connect(g); g.connect(bag.head);
        pluck(g.gain, u, gainB * amp, 0.003, tau * (ratio > 1 ? 0.6 : 1));
      }
      endT = Math.max(endT, u + 7.5 * tau + 0.05);
    }
  }

  // stop everything that is open-ended
  const stopAt = tEnd + 0.5;
  lfoA.stop(endT); lfoB.stop(endT); lfoC.stop(endT); sl1.stop(endT); sl2.stop(endT);
  for (const o of saws) o.stop(stopAt);
  whine.stop(stopAt);
  bag.endTime = endT + 0.02;

  const handle: BlendVoice = {
    kind: 'blend',
    held: false,
    get endTime() { return bag.endTime; },
    get alive() { return bag.alive; },
    get dying() { return bag.dying; },
    kill: (f, at) => bag.kill(f, at),
    free: () => bag.free(),
    stop: () => bag.kill(0.15),
  };
  return handle;
}
