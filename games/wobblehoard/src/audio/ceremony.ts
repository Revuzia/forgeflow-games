// WOBBLEHOARD ceremony voices (DESIGN.md section 6): meter-full cue, capsule beats, tier reveals, merge charge + burst.
// Same rules as voices.ts: synthesised only (oscillators, filters, seeded noise), functions of (ctx, out, t0, params) so
// the live engine and the OfflineAudioContext probe run identical code, all variation from the seeded `rng`.
//
// Time map the shell should follow (the numbers are DESIGN 6.1/6.3):
//   capsule open:  grab 0 .. 0.35, crack at 0.35, then  Common/Uncommon: burst at 0.65, reveal() at 1.0 (B3)
//                                                       Rare+: reveal() at 0.65 (its first PRE_ROLL_S is the swell),
//                                                              burst at 0.65 + PRE_ROLL_S, motif lands 0.35 s after that.
//   merge:         mergeStart({chargeS}) at 0, burst() at chargeS (T3); its motif is the T4 reveal sound.
import type { TierName } from '../contracts.ts';
import { clamp } from '../core/rng.ts';
import { Bag, c01, dbToGain, fin, lerp, makeRng, rexp, rr, type Rng, type VoiceGroup } from './dsp.ts';
import { pitchOf, pop, squish, startTime, type SquishVoice, type VoiceBase } from './voices.ts';

type Ctx = BaseAudioContext;

export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const satisfies readonly TierName[];
/** Unknown / hostile tier values fall back to common (index 0). */
export const tierIdx = (t: unknown): number => { const i = (TIERS as readonly unknown[]).indexOf(t); return i < 0 ? 0 : i; };

/** DESIGN 6.1: capsule-open and merge-ceremony budgets (seconds). Nothing here ever plays longer. */
export const CAPSULE_BUDGET_S = [1.6, 2.0, 2.6, 3.2, 3.9, 4.5] as const;
export const MERGE_BUDGET_S = [2.2, 2.6, 3.2, 3.8, 4.5, 5.2] as const;
/** DESIGN 6.3 pre-roll swell before the burst (Rare+). The Mythic one starts with a 250 ms hush (the engine ducks the master there). */
export const PRE_ROLL_S = [0, 0, 0.3, 0.5, 0.8, 1.0] as const;
/** Gap between the burst and the motif for tiers with a pre-roll (B2 = 0.35 s). */
export const BURST_GAP_S = 0.35;
/** Default reveal length = what is left of the capsule budget after grab + crack (0.65 s) for Rare+; B3 itself for Common/Uncommon. */
export const REVEAL_DEFAULT_S = [0.6, 1.0, 1.95, 2.55, 3.25, 3.85] as const;
/** Default merge charge (T0..T2) and burst/reveal lengths; they add up to MERGE_BUDGET_S. */
export const MERGE_CHARGE_S = [1.3, 1.5, 1.8, 2.1, 2.4, 2.8] as const;
export const MERGE_BURST_S = [0.9, 1.1, 1.4, 1.7, 2.1, 2.4] as const;
export const CALM_SCALE = 0.65;

const ROOT = 523.25;                           // C5
const SEMI = (n: number): number => Math.pow(2, n / 12);
const MYTHIC_ROOT = 440;                       // A4
/** Mythic motifs, semitones above A4: rising, arch, dip-then-up. Unique contour AND pitches per variant. */
export const MYTHIC_MOTIFS: readonly (readonly number[])[] = [[0, 7, 14], [12, 5, 8], [5, 12, 3]];

/* Per-tier output trim (dB) chosen with the probe so the six signatures sit within ~2 dB of each other in active RMS. */
const TIER_TRIM_DB = [1.4, -0.4, 0.6, -2.2, -0.6, -3.5];
/** Same idea for the short capsule-burst stingers (they start from untrimmed levels). */
const STING_TRIM_DB = [0.4, 0.6, 0.6, 2.1, -0.6, -2.5];
const L = (db: number): number => dbToGain(db);
/** Dry level (peak) at which every sustained element dies: its RMS is then ~ the probe's -45 dBFS activity threshold. */
const END_AMP = L(-39);
/** Sustained elements end this long before D: the chain's look-ahead and the 20 ms release ramp add it back. */
const TAIL = 0.02;

/* ═══════════════════════════════════ shared timeline + building blocks ═══════════════════════════════════ */

export interface Layout { D: number; P: number; M: number; W: number }

/** Where things happen inside a reveal of `durationS`. P = pre-roll swell, M = start of the motif, W = motif span. */
export function layout(ti: number, durationS: unknown, calm: boolean, burst: boolean): Layout {
  const k = calm ? CALM_SCALE : 1;
  const dflt = burst ? MERGE_BURST_S[ti] : REVEAL_DEFAULT_S[ti];
  const D = clamp(fin(durationS, dflt), 0.3, 14) * k;
  let P = burst || ti < 2 ? 0 : PRE_ROLL_S[ti] * k;
  let G = P > 0 ? BURST_GAP_S * k : 0;
  let M = P + G;
  const minW = 0.25;
  if (D - M < minW) { const s = M > 0 ? Math.max(0, D - minW) / M : 0; P *= s; G *= s; M = P + G; }
  return { D, P, M, W: Math.max(minW, D - M) };
}

/** Note onsets (seconds from the start of the voice) for the tier's motif; used by the builders and by the probe's timing. */
export function noteOnsets(ti: number, lay: Layout): number[] {
  const { M, W } = lay;
  switch (ti) {
    case 0: return [0];
    case 1: return [0.2 * W, 0.4 * W].map((x) => x + M);
    case 2: return [M, M + clamp(0.11 * W, 0.08, 0.25)];
    case 3: { const s = clamp(0.09 * W, 0.08, 0.2); return [0, 1, 2, 3].map((k) => M + k * s); }
    case 4: return [M, M + 0.05, M + 0.1, M + 0.15];
    default: { const s = clamp(0.2 * W, 0.25, 0.5); return [0, 1, 2].map((k) => M + k * s); }
  }
}

interface TierCtx {
  bag: Bag; r: Rng; t: number; pr: number; ti: number; lay: Layout;
  calm: boolean; tierUp: boolean; isNew: boolean; variant: number; burst: boolean;
  /** attack time of a struck note (calm: slower, no sudden jumps) */
  att: number;
  /** overall trim */
  trim: number;
}

type Parts = ReadonlyArray<readonly [number, number]>;

/**
 * 0 -> peak, a quick drop to ~40% (the strike) and then a constant-dB glide down to `endAmp` at `endT`, then a 20 ms ramp to 0.
 * With `knee` false the glide is a single exponential (pads, glows).
 */
function ring(g: AudioParam, t: number, endT: number, peak: number, att: number, endAmp: number, knee = true): void {
  const a = Math.max(att, 0.002);
  const e = Math.max(endT, t + a + 0.03);
  const end = clamp(endAmp, 1e-5, peak * 0.5);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  if (knee) {
    const tk = Math.min(t + a + 0.12 * (e - t - a), t + a + 0.18);
    g.exponentialRampToValueAtTime(Math.max(peak * 0.42, end * 1.2), tk);
  }
  g.exponentialRampToValueAtTime(end, e);
  g.linearRampToValueAtTime(0, e + 0.02);
}

/** A struck tone built from sine partials [ratio, level]; higher partials die sooner. Returns the partial count. */
function note(c: TierCtx, t: number, endT: number, f: number, parts: Parts, peak: number, knee = true, att = c.att): number {
  const { bag } = c;
  for (let i = 0; i < parts.length; i++) {
    const [ratio, lvl] = parts[i];
    const fq = f * ratio;
    if (fq > 9000) continue;
    const e = t + (endT - t) / (1 + 0.38 * i);
    const o = bag.osc('sine', fq, t, e + 0.05);
    const g = bag.gain(0);
    o.connect(g); g.connect(bag.head);
    ring(g.gain, t, e, peak * lvl * c.trim, att, END_AMP * Math.sqrt(lvl), knee);
  }
  return parts.length;
}

/** Soft rising ladder: 9 plucked notes (C D E G A C E G C, two octaves from C4) over ~0.4 s, for tier-up. */
function ladder(c: TierCtx, t: number, maxEnd: number): number {
  const steps = [0, 2, 4, 7, 9, 12, 16, 19, 24];
  const sp = Math.min(c.calm ? 0.07 : 0.048, Math.max(0.02, (maxEnd - t - 0.25) / steps.length));
  let end = t;
  for (let i = 0; i < steps.length; i++) {
    const u = t + i * sp;
    const f = ROOT * 0.5 * SEMI(steps[i]) * c.pr * (1 + 0.004 * (c.r() - 0.5));
    const peak = L(-22 + 0.4 * i) * (c.calm ? 0.7 : 1);
    const e = u + 0.2;
    const o = c.bag.osc('sine', f, u, e + 0.05);
    const o2 = c.bag.osc('sine', f * 2, u, e + 0.05);
    const g = c.bag.gain(0), g2 = c.bag.gain(0);
    o.connect(g); o2.connect(g2); g.connect(c.bag.head); g2.connect(c.bag.head);
    g.gain.setValueAtTime(0, u); g.gain.linearRampToValueAtTime(peak * c.trim, u + c.att); g.gain.setTargetAtTime(0, u + c.att, 0.05);
    g2.gain.setValueAtTime(0, u); g2.gain.linearRampToValueAtTime(peak * 0.25 * c.trim, u + c.att); g2.gain.setTargetAtTime(0, u + c.att, 0.035);
    end = e;
  }
  return end;
}

/** A tiny sparkle for "NEW": three high sines, one short pluck each. */
function sparkle(c: TierCtx, t: number): void {
  const base = [2480, 3120, 3860];
  for (let i = 0; i < 3; i++) {
    const u = t + i * 0.03;
    const f = base[i] * c.pr * (1 + 0.02 * (c.r() - 0.5));
    const e = u + 0.28;
    const o = c.bag.osc('sine', f, u, e + 0.03);
    const g = c.bag.gain(0);
    o.connect(g); g.connect(c.bag.head);
    g.gain.setValueAtTime(0, u); g.gain.linearRampToValueAtTime(L(-30) * c.trim * (c.calm ? 0.6 : 1), u + c.att); g.gain.setTargetAtTime(0, u + c.att, 0.05);
  }
}

/** The "bloop": a sine pair gliding 180 -> 260 Hz (x pitch), 180 ms. */
function bloop(c: TierCtx, t: number, peakDb: number, f0 = 180, f1 = 262): void {
  const { bag, pr } = c;
  const amp = bag.gain(0);
  amp.connect(bag.head);
  const tau = 0.042;
  const end = t + 0.006 + 7.5 * tau;
  for (let k = 0; k < 2; k++) {
    const o = bag.osc('sine', f0 * pr * (k ? 2.01 : 1), t, end);
    o.frequency.setValueAtTime(f0 * pr * (k ? 2.01 : 1), t);
    o.frequency.setTargetAtTime(f1 * pr * (k ? 2.01 : 1), t, 0.04);
    const g = bag.gain(k ? 0.3 : 1);
    o.connect(g); g.connect(amp);
  }
  const a = Math.max(c.att * 1.5, 0.006);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(L(peakDb) * c.trim, t + a);
  amp.gain.setTargetAtTime(0, t + a, tau);
}

/** Sustained soft sine glow under/after a motif (so the cue lasts as long as the shell asked). */
function glow(c: TierCtx, t: number, endT: number, f: number, peakDb: number): void {
  if (endT - t < 0.12) return;
  note(c, t, endT, f, [[1, 1], [1.5, 0.35]], L(peakDb), false, Math.min(0.08, (endT - t) * 0.4));
}

/** Filtered-noise sweep ("whoosh"): band-pass centre f0 -> f1 (exponential) with a rise/fall envelope. */
function whoosh(c: TierCtx, t0: number, rise: number, fall: number, f0: number, f1: number, peakDb: number): void {
  const { bag } = c;
  const t = Math.max(t0, c.t);
  const n = bag.noise(c.r, t, t + rise + fall + 0.05);
  const bp = bag.biquad('bandpass', f0, 1.1);
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + rise + fall);
  const lp = bag.biquad('lowpass', c.calm ? 2200 : 5200, 0.6);
  const g = bag.gain(0);
  n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(bag.head);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(L(peakDb) * c.trim, t + rise);
  g.gain.linearRampToValueAtTime(0, t + rise + fall);
}

/** Formant "choir" pad: detuned saws of a chord through three "ah" formant band-passes, with slow vibrato. */
function choir(c: TierCtx, t: number, swellEnd: number, holdTo: number, endT: number, notes: readonly number[], peakDb: number): void {
  const { bag, pr } = c;
  const tEnd = Math.max(endT, holdTo + 0.05, swellEnd + 0.05);
  const mix = bag.gain(1);
  const env = bag.gain(0);
  const form = [[730, 8, 1], [1090, 10, 0.55], [2440, 12, 0.25]] as const;
  for (const [f, q, gn] of form) {
    const bp = bag.biquad('bandpass', f, q);
    const g = bag.gain(gn);
    mix.connect(bp); bp.connect(g); g.connect(env);
  }
  // chest: the same saws, low-passed, so the pad has a body below the formants
  const bodyLp = bag.biquad('lowpass', 420, 0.7);
  const bodyG = bag.gain(1.1);
  mix.connect(bodyLp); bodyLp.connect(bodyG); bodyG.connect(env);
  env.connect(bag.head);
  const lfo = bag.osc('sine', 5.1 + 0.6 * c.r(), t, tEnd + 0.05);
  const lfoD = bag.gain(c.calm ? 6 : 11);
  lfo.connect(lfoD);
  for (const n of notes) {
    for (const dt of [-7, 7]) {
      const o = bag.osc('sawtooth', n * pr, t, tEnd + 0.05);
      o.detune.value = dt;
      lfoD.connect(o.detune);
      const g = bag.gain(0.22);
      o.connect(g); g.connect(mix);
    }
  }
  const pk = L(peakDb) * c.trim;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(pk, Math.max(swellEnd, t + 0.05));
  env.gain.setValueAtTime(pk, Math.max(holdTo, swellEnd));
  env.gain.exponentialRampToValueAtTime(Math.max(END_AMP * 1.4, 1e-5), tEnd);
  env.gain.linearRampToValueAtTime(0, tEnd + 0.02);
}

/* ═══════════════════════════════════ the six tier signatures ═══════════════════════════════════ */

/** A cluster of high sines with a slow tremble (AM), plucked once: the "shimmer". */
function shimmer(c: TierCtx, t: number, freqs: readonly number[], peakDb: number, tau: number, len: number, lfoHz: number): void {
  const { bag } = c;
  const am = bag.gain(0.72);
  am.connect(bag.head);
  const lfo = bag.osc('sine', lfoHz, t, t + len);
  const depth = bag.gain(0.26);
  lfo.connect(depth); depth.connect(am.gain);
  for (const f0 of freqs) {
    const f = f0 * c.pr * (1 + 0.02 * (c.r() - 0.5));
    const o = bag.osc('sine', f, t, t + len);
    const g = bag.gain(0);
    o.connect(g); g.connect(am);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(L(peakDb) * c.trim, t + 0.008);
    g.gain.setTargetAtTime(0, t + 0.008, tau);
  }
}

const BELL: Parts = [[1, 1], [2.76, 0.34], [5.4, 0.12]];          // inharmonic strike partials (Rare)
const CHIME: Parts = [[1, 1], [2, 0.28], [3, 0.09], [4.2, 0.04]];             // glockenspiel-like (Uncommon)
const ARP: Parts = [[1, 1], [2, 0.35], [3, 0.12], [4.07, 0.1], [6.2, 0.05]]; // Epic arpeggio notes
const CHORD_BELL: Parts = [[1, 1], [2, 0.3], [2.41, 0.18], [3.9, 0.12], [5.2, 0.06]]; // Legendary chord (fundamentals stay clear)
const MYTH_BELL: Parts = [[1, 1], [2, 0.42], [2.76, 0.3], [4.07, 0.16], [5.4, 0.08], [6.7, 0.04]];

function buildCommon(c: TierCtx): void {
  const end = c.t + c.lay.D - TAIL;
  bloop(c, c.t, -11);
  glow(c, c.t + 0.14, end, 262 * c.pr, -24);
}

function buildUncommon(c: TierCtx): void {
  const end = c.t + c.lay.D - TAIL;
  bloop(c, c.t, -15);
  const [a, b] = noteOnsets(1, c.lay);
  note(c, c.t + a, end, ROOT * c.pr, CHIME, L(-13));
  note(c, c.t + b, end, ROOT * SEMI(4) * c.pr, CHIME, L(-13));
}

function buildRare(c: TierCtx): void {
  const { lay, bag, pr } = c;
  const end = c.t + lay.D - TAIL;
  const [a, b] = noteOnsets(2, lay);
  if (lay.P > 0) {
    // 0.3 s hum swell: it rises over the pre-roll, sits under the burst gap, then fades under the bells
    const hum = bag.gain(0);
    hum.connect(bag.head);
    for (const [r, g0] of [[1, 1], [2, 0.5]] as const) {
      const o = bag.osc('sine', 185 * pr * r, c.t, c.t + a + Math.min(0.55, lay.W * 0.5) + 0.06);
      const g = bag.gain(g0); o.connect(g); g.connect(hum);
    }
    const pk = L(-26) * c.trim, fadeEnd = c.t + a + Math.min(0.5, lay.W * 0.5);
    hum.gain.setValueAtTime(0, c.t);
    hum.gain.linearRampToValueAtTime(pk, c.t + Math.max(lay.P, 0.1));
    hum.gain.setValueAtTime(pk, c.t + a);
    hum.gain.linearRampToValueAtTime(0, fadeEnd);
  }
  note(c, c.t + a, end, ROOT * pr, BELL, L(-14));
  note(c, c.t + b, end, ROOT * SEMI(7) * pr, BELL, L(-15));
  if (!c.calm) shimmer(c, c.t + a + 0.04, [3100, 3500, 3900, 4300, 4700], -40, 0.085, 0.5, 8);
}

function buildEpic(c: TierCtx): void {
  const { lay, bag, pr } = c;
  const end = c.t + lay.D - TAIL;
  const m = c.t + lay.M;
  // low filtered-saw swell: rises over the pre-roll (or 0.15 s in a merge burst), then decays under the arpeggio
  const sw = lay.P > 0 ? lay.P : 0.15;
  const amp = bag.gain(0);
  const lp = bag.biquad('lowpass', 180, 2.2);
  lp.connect(amp); amp.connect(bag.head);
  lp.frequency.setValueAtTime(180, c.t);
  lp.frequency.exponentialRampToValueAtTime(800, c.t + sw);
  lp.frequency.setTargetAtTime(380, m, 0.35);
  for (const dt of [-3, 3]) {
    const o = bag.osc('sawtooth', 98 * pr, c.t, end + 0.05);
    o.detune.value = dt;
    o.frequency.setValueAtTime(98 * pr, c.t);
    o.frequency.exponentialRampToValueAtTime(131 * pr, c.t + sw);
    const g = bag.gain(0.5); o.connect(g); g.connect(lp);
  }
  const pk = L(-19) * c.trim;
  amp.gain.setValueAtTime(0, c.t);
  amp.gain.linearRampToValueAtTime(pk, c.t + sw);
  amp.gain.setValueAtTime(pk, m);
  amp.gain.exponentialRampToValueAtTime(Math.max(END_AMP * 1.2, 1e-5), end);
  amp.gain.linearRampToValueAtTime(0, end + 0.02);
  // soft whoosh from just before the motif
  whoosh(c, Math.max(c.t, m - 0.15), 0.28, 0.4, 450, 4800, -19);
  // 4-note rising arpeggio spanning an octave
  const on = noteOnsets(3, lay);
  [0, 4, 7, 12].forEach((s, i) => note(c, c.t + on[i], end, ROOT * SEMI(s) * pr, ARP, L(-13.5)));
}

function buildLegendary(c: TierCtx): void {
  const { lay, bag, pr } = c;
  const end = c.t + lay.D - TAIL;
  const m = c.t + lay.M;
  const sw = lay.P > 0 ? lay.P : 0.12;
  // formant choir pad: swells over the pre-roll, holds through the burst gap, then glides away
  choir(c, c.t, c.t + sw, m + 0.35, end, [130.81, 196.0, 329.63], -15);
  // rising sweep through the pre-roll, cut at the burst
  if (lay.P > 0) {
    const e = c.t + lay.P + 0.35 * 0.6;
    const o = bag.osc('sine', 260 * pr, c.t + 0.05, e + 0.1);
    o.frequency.setValueAtTime(260 * pr, c.t + 0.05);
    o.frequency.exponentialRampToValueAtTime(3000 * pr, e);
    const g = bag.gain(0);
    o.connect(g); g.connect(bag.head);
    g.gain.setValueAtTime(0, c.t + 0.05);
    g.gain.linearRampToValueAtTime(L(-23) * c.trim, e);
    g.gain.linearRampToValueAtTime(0, e + 0.08);
  }
  // bell chord spanning a major ninth: C5, G5, D6 (rolled)
  const on = noteOnsets(4, lay);
  [0, 4, 7, 14].forEach((s, i) => note(c, c.t + on[i], end, ROOT * SEMI(s) * pr, CHORD_BELL, L(-17.5)));
  if (!c.calm) whoosh(c, m - 0.05, 0.3, 0.55, 700, 5200, -19);
}

function buildMythic(c: TierCtx): void {
  const { lay, bag, pr } = c;
  const end = c.t + lay.D - TAIL;
  const m = c.t + lay.M;
  const hush = lay.P > 0 ? Math.min(0.25 * (c.calm ? CALM_SCALE : 1), lay.P * 0.4) : 0;
  const swStart = c.t + hush;
  const swEnd = c.t + (lay.P > 0 ? lay.P : 0.12);
  // sub-bass swell (A1) with audible 2nd/3rd partials, rising a little
  const sub = bag.gain(0);
  sub.connect(bag.head);
  for (const [r, g0] of [[1, 1], [2, 0.5], [3, 0.22]] as const) {
    const o = bag.osc('sine', 55 * pr * r, swStart, end + 0.05);
    o.frequency.setValueAtTime(55 * pr * r, swStart);
    o.frequency.exponentialRampToValueAtTime(58.3 * pr * r, swEnd);
    const g = bag.gain(g0); o.connect(g); g.connect(sub);
  }
  const spk = L(-18) * c.trim;
  sub.gain.setValueAtTime(0, swStart);
  sub.gain.linearRampToValueAtTime(spk, swEnd);
  sub.gain.setValueAtTime(spk, m);
  sub.gain.exponentialRampToValueAtTime(Math.max(END_AMP * 1.2, 1e-5), end);
  sub.gain.linearRampToValueAtTime(0, end + 0.02);
  // choir-like pad a fifth above the Legendary one, swelling through the pre-roll
  choir(c, swStart, swEnd, m + 0.3, end, [110, 164.81, 220, 329.63], -19);
  // the unique 3-note motif
  const motif = MYTHIC_MOTIFS[clamp(Math.floor(fin(c.variant, 0)), 0, 2)];
  const on = noteOnsets(5, lay);
  motif.forEach((s, i) => note(c, c.t + on[i], end, MYTHIC_ROOT * SEMI(s) * pr, MYTH_BELL, L(-13)));
  // two drone bells under the motif (A3, E4): the held chord the motif floats over
  note(c, c.t + on[0], end, 220 * pr, BELL, L(-20));
  note(c, c.t + on[0] + 0.03, end, 329.63 * pr, BELL, L(-21));
  // a shimmer on top of the last note
  if (!c.calm) shimmer(c, c.t + on[2] + 0.02, [2300, 2820, 3340, 3860], -31, 0.2, 0.9, 6.5);
}

const BUILDERS = [buildCommon, buildUncommon, buildRare, buildEpic, buildLegendary, buildMythic] as const;

/** Build the tier signature into `bag` starting at `t`. Returns the context time at which everything has stopped. */
function buildTier(bag: Bag, r: Rng, t: number, ti: number, o: {
  pr: number; lay: Layout; calm: boolean; tierUp: boolean; isNew: boolean; variant: number; burst: boolean;
}): number {
  const calm = o.calm;
  const c: TierCtx = {
    bag, r, t, pr: o.pr, ti, lay: o.lay, calm, tierUp: o.tierUp, isNew: o.isNew, variant: o.variant, burst: o.burst,
    att: calm ? 0.018 : 0.004,
    trim: L(TIER_TRIM_DB[ti] + (calm ? -2.5 : 0) + (o.burst ? -2 : 0)),
  };
  BUILDERS[ti](c);
  const on = noteOnsets(ti, o.lay);
  if (o.tierUp) ladder(c, t + (ti === 0 ? 0.0 : Math.max(0, on[0] - 0.05)), t + o.lay.D);
  if (o.isNew) sparkle(c, t + on[on.length - 1] + 0.05);
  return t + o.lay.D + 0.1;
}

/* ═══════════════════════════════════ reveal ═══════════════════════════════════ */

export interface RevealParams extends VoiceBase {
  tier: TierName;
  tierUp?: boolean;
  isNew?: boolean;
  mythicVariant?: number;
  /** Total length of the cue from the call (see the time map at the top of this file). Default per tier. */
  durationS?: number;
  calm?: boolean;
}

export function reveal(ctx: Ctx, out: AudioNode, t0: number, p: RevealParams): VoiceGroup {
  const t = startTime(t0);
  const ti = tierIdx(p.tier);
  const pr = pitchOf(p);
  const calm = p.calm === true;
  const bag = new Bag(ctx, out, 'reveal', 0);
  bag.priority = 2;
  const lay = layout(ti, p.durationS, calm, false);
  const endT = buildTier(bag, p.rng, t, ti, {
    pr, lay, calm, tierUp: p.tierUp === true, isNew: p.isNew === true, variant: fin(p.mythicVariant, 0), burst: false,
  });
  bag.endTime = endT + 0.05;
  return bag;
}

/* ═══════════════════════════════════ meter full ═══════════════════════════════════ */

export interface MeterFullParams extends VoiceBase { quiet?: boolean }

/** Two-note rising "plink-plonk" (D5 then A5, a fifth up), each a sine with a short pluck tick; ~180 ms. Quiet = -6 dB, no tick. */
export function meterFull(ctx: Ctx, out: AudioNode, t0: number, p: MeterFullParams): VoiceGroup {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const quiet = p.quiet === true;
  const bag = new Bag(ctx, out, 'meterFull', p.pan ?? 0);
  const lv = quiet ? L(-20) : L(-14);
  const notes: Array<[number, number, number]> = [[587.33, 0, 0.034], [880.0, 0.072, 0.026]];
  let end = t;
  for (const [f, dt, tau] of notes) {
    const u = t + dt;
    const o = bag.osc('sine', f * pr, u, u + 0.006 + 7.5 * tau + 0.03);
    const o2 = bag.osc('sine', f * pr * 2, u, u + 0.006 + 6 * tau + 0.03);
    const g = bag.gain(0), g2 = bag.gain(0);
    o.connect(g); o2.connect(g2); g.connect(bag.head); g2.connect(bag.head);
    pluckEnv(g.gain, u, lv, quiet ? 0.008 : 0.003, tau);
    pluckEnv(g2.gain, u, lv * 0.22, quiet ? 0.008 : 0.003, tau * 0.7);
    end = Math.max(end, u + 0.006 + 7.5 * tau);
    if (!quiet) {
      const n = bag.noise(r, u, u + 0.02);
      const bp = bag.biquad('bandpass', 3200 * pr, 1.4);
      const gn = bag.gain(0);
      n.connect(bp); bp.connect(gn); gn.connect(bag.head);
      pluckEnv(gn.gain, u, lv * 1.6, 0.0008, 0.0035);
    }
  }
  bag.endTime = end + 0.05;
  return bag;
}

function pluckEnv(g: AudioParam, t: number, peak: number, att: number, tau: number): void {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + att);
  g.setTargetAtTime(0, t + att, tau);
}

/* ═══════════════════════════════════ capsule beats ═══════════════════════════════════ */

export interface GrabParams extends VoiceBase { progress?: number }

/** B0: soft rising squeak. `progress` (0..1) raises its start pitch (420 -> 820 Hz) so repeated calls climb while squeezing. ~200 ms. */
export function grab(ctx: Ctx, out: AudioNode, t0: number, p: GrabParams): VoiceGroup {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const prog = c01(p.progress, 0);
  const bag = new Bag(ctx, out, 'grab', p.pan ?? 0);
  const f0 = lerp(420, 820, prog) * pr;
  const o = bag.osc('sine', f0, t, t + 0.3);
  o.setPeriodicWave(squeakWave(ctx));
  o.frequency.setValueAtTime(f0, t);
  o.frequency.setTargetAtTime(f0 * 1.4, t, 0.07);
  const lfo = bag.osc('sine', 9 + 3 * r(), t, t + 0.3);
  const lfoD = bag.gain(f0 * 0.012);
  lfo.connect(lfoD); lfoD.connect(o.frequency);
  const amp = bag.gain(0);
  o.connect(amp); amp.connect(bag.head);
  pluckEnv(amp.gain, t, L(-15), 0.014, 0.055);
  // the rub: a narrow band of noise riding the squeak
  const n = bag.noise(r, t, t + 0.25);
  const bp = bag.biquad('bandpass', 2300 * pr * (1 + 0.3 * prog), 6);
  const gn = bag.gain(0);
  n.connect(bp); bp.connect(gn); gn.connect(bag.head);
  pluckEnv(gn.gain, t, L(-17), 0.012, 0.05);
  bag.endTime = t + 0.32;
  return bag;
}

function squeakWave(ctx: Ctx): PeriodicWave {
  const real = new Float32Array(6), imag = new Float32Array(6);
  imag[1] = 1; imag[3] = 0.22; imag[5] = 0.08;
  return ctx.createPeriodicWave(real, imag);
}

export type CrackParams = VoiceBase;

/** B1: a dry shell tick (+ a tiny echo tick 26 ms later = a hairline crack), ~45 ms. Takes no tier: the tier is never audible here. */
export function crack(ctx: Ctx, out: AudioNode, t0: number, p: CrackParams): VoiceGroup {
  const t = startTime(t0);
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'crack', p.pan ?? 0);
  for (const [dt, lv] of [[0, L(-14.5)], [0.026, L(-20.5)]] as const) {
    const u = t + dt;
    const n = bag.noise(r, u, u + 0.02);
    const bp = bag.biquad('bandpass', 3300 * pr * (1 + 0.1 * (r() - 0.5)), 1.3);
    const g = bag.gain(0);
    n.connect(bp); bp.connect(g); g.connect(bag.head);
    g.gain.setValueAtTime(0, u);
    g.gain.linearRampToValueAtTime(lv * 2.6, u + 0.0005);
    g.gain.linearRampToValueAtTime(0, u + 0.0032);
    const o = bag.osc('sine', 1350 * pr, u, u + 0.03);
    const og = bag.gain(0);
    o.connect(og); og.connect(bag.head);
    pluckEnv(og.gain, u, lv * 0.55, 0.0006, 0.0045);
  }
  bag.endTime = t + 0.07;
  return bag;
}

export interface CapsuleBurstParams extends VoiceBase { tier?: TierName; calm?: boolean }

/** A short tier stinger (<= ~0.35 s): a foretaste of the signature, quieter than the reveal that follows. */
function stinger(c: TierCtx, ti: number): void {
  const { bag, pr } = c;
  const e = c.t + 0.34;
  switch (ti) {
    case 0: bloop({ ...c, trim: c.trim * L(-3) }, c.t, -14, 230, 300); break;
    case 1: note(c, c.t, c.t + 0.3, ROOT * pr, CHIME, L(-16)); break;
    case 2: note(c, c.t, e, ROOT * pr, BELL, L(-16)); note(c, c.t + 0.04, e, ROOT * SEMI(7) * pr, BELL, L(-18)); break;
    case 3: {
      const amp = bag.gain(0), lp = bag.biquad('lowpass', 250, 2);
      lp.connect(amp); amp.connect(bag.head);
      lp.frequency.setValueAtTime(250, c.t); lp.frequency.exponentialRampToValueAtTime(1400, c.t + 0.16);
      for (const dt of [-8, 8]) { const o = bag.osc('sawtooth', 130.8 * pr, c.t, e + 0.05); o.detune.value = dt; const g = bag.gain(0.5); o.connect(g); g.connect(lp); }
      pluckEnv(amp.gain, c.t, L(-17) * c.trim, 0.02, 0.09);
      note(c, c.t + 0.05, e, ROOT * pr, ARP, L(-17));
      break;
    }
    case 4: {
      choir(c, c.t, c.t + 0.08, c.t + 0.14, e, [130.81, 196.0, 329.63], -16);
      note(c, c.t + 0.02, e, ROOT * pr, CHORD_BELL, L(-17)); note(c, c.t + 0.06, e, ROOT * SEMI(14) * pr, CHORD_BELL, L(-19));
      break;
    }
    default: {
      const sub = bag.gain(0); sub.connect(bag.head);
      for (const [r, g0] of [[1, 1], [2, 0.5], [3, 0.22]] as const) { const o = bag.osc('sine', 55 * pr * r, c.t, e + 0.05); const g = bag.gain(g0); o.connect(g); g.connect(sub); }
      pluckEnv(sub.gain, c.t, L(-15) * c.trim, 0.012, 0.11);
      note(c, c.t + 0.03, e, MYTHIC_ROOT * pr, MYTH_BELL, L(-17));
    }
  }
}

/** B2: the existing pop voice plus a short tier cue. This is the first moment the tier is audible. */
export function capsuleBurst(ctx: Ctx, out: AudioNode, t0: number, p: CapsuleBurstParams): VoiceGroup {
  const t = startTime(t0);
  const ti = tierIdx(p.tier);
  const calm = p.calm === true;
  const pr = pitchOf(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'capsuleBurst', p.pan ?? 0);
  const lay: Layout = { D: 0.34, P: 0, M: 0, W: 0.34 };
  const c: TierCtx = {
    bag, r, t, pr, ti, lay, calm, tierUp: false, isNew: false, variant: 0, burst: true,
    att: calm ? 0.016 : 0.004, trim: L(STING_TRIM_DB[ti] + (calm ? -2.5 : 0)),
  };
  // a keep-alive for the nested pop: the stinger always outlives it
  let popOut: AudioNode = bag.head;
  if (calm) { const lp = bag.biquad('lowpass', 1500, 0.7); const pg = bag.gain(0.55); lp.connect(pg); pg.connect(bag.head); popOut = lp; }   // calm: no sharp click, 5 dB softer
  pop(ctx, popOut, t, { rng: makeRng((r() * 4294967296) >>> 0), pitch: pr, size: 0.55, jitter: 1 });
  stinger(c, ti);
  bag.endTime = t + 0.4;
  return bag;
}

/* ═══════════════════════════════════ merge ceremony ═══════════════════════════════════ */

export interface MergeParams extends VoiceBase {
  tier?: TierName;
  chargeS?: number;
  calm?: boolean;
  /** Test hook: mute individual layers. */
  layers?: { hum?: boolean; squelch?: boolean; ticks?: boolean };
  /** Schedule the squelch/tick layers this far ahead and the rest through advance() (the engine pumps it). Default: all at once. */
  lookaheadS?: number;
}

export interface MergeBurstParams { tier: TierName; tierUp?: boolean; mythicVariant?: number; durationS?: number }

export interface MergeVoice extends VoiceGroup {
  /** T3: stop the charge and fire the burst (noise transient + tier motif + ladder). Returns the burst's own voice group. */
  burst(p: MergeBurstParams, atTime?: number): VoiceGroup | null;
  stop(fadeS?: number, atTime?: number): void;
  readonly chargeS: number;
  /** Schedule the squelch/tick layers up to context time `until`. Returns true once the whole charge is scheduled (or the voice ended). */
  advance(until: number): boolean;
}

const smooth = (u: number): number => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };

/** T3 voice on its own: noise transient + tier bell/motif of reveal() (+ ladder). */
export function mergeBurst(ctx: Ctx, out: AudioNode, t0: number, p: VoiceBase & MergeBurstParams & { calm?: boolean; layers?: { noise?: boolean } }): VoiceGroup {
  const t = startTime(t0);
  const ti = tierIdx(p.tier);
  const pr = pitchOf(p);
  const calm = p.calm === true;
  const bag = new Bag(ctx, out, 'mergeBurst', 0);
  bag.priority = 2;
  const lay = layout(ti, p.durationS, calm, true);
  const r = p.rng;
  // noise transient: a quick "foomp" of band-passed noise (calm: slower and darker, no sudden edge)
  const n = bag.noise(r, t, t + 0.4);
  const bp = bag.biquad('bandpass', (calm ? 700 : 1100) * pr, 0.7);
  const g = bag.gain(0);
  n.connect(bp); bp.connect(g); g.connect(bag.head);
  const a = calm ? 0.02 : 0.003;
  g.gain.setValueAtTime(0, t);
  const on = p.layers?.noise !== false;
  g.gain.linearRampToValueAtTime(on ? L(-10.5 + ti * 0.4 - (calm ? 3 : 0)) : 0, t + a);
  g.gain.setTargetAtTime(0, t + a, calm ? 0.08 : 0.045);
  if (!calm) {
    // the crack on top of the foomp: high-passed noise, 20 ms
    const hp = bag.biquad('highpass', 2500, 0.7);
    const lp2 = bag.biquad('lowpass', 5500, 0.7);
    const g2 = bag.gain(0);
    n.connect(hp); hp.connect(lp2); lp2.connect(g2); g2.connect(bag.head);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(on ? L(-14) : 0, t + 0.0035);
    g2.gain.setTargetAtTime(0, t + 0.0035, 0.02);
  }
  const endT = buildTier(bag, r, t, ti, {
    pr, lay, calm, tierUp: p.tierUp === true, isNew: false, variant: fin(p.mythicVariant, 0), burst: true,
  });
  bag.endTime = Math.max(endT, t + 0.45) + 0.05;
  return bag;
}

/**
 * T0..T2: 80 Hz hum (sine + 2nd + faint 3rd partial, the upper ones fading in) gliding up a perfect fifth over `chargeS`,
 * the squish squelch machinery driven by a scripted press (formants rise with compression), and a noise-tick stream whose
 * density rises exponentially. Everything is pre-scheduled; burst() ends the charge with a quick fade, and if nobody calls
 * burst() the hum fades by itself 0.4 s after the charge (no drone).
 */
export function mergeStart(ctx: Ctx, out: AudioNode, t0: number, p: MergeParams): MergeVoice {
  const t = startTime(t0);
  const ti = tierIdx(p.tier);
  const calm = p.calm === true;
  const r = p.rng;
  const pr = pitchOf(p);
  const C = clamp(fin(p.chargeS, MERGE_CHARGE_S[ti]), 0.3, 12) * (calm ? CALM_SCALE : 1);
  const layers = { hum: true, squelch: true, ticks: true, ...(p.layers ?? {}) };
  const bag = new Bag(ctx, out, 'merge', 0);
  bag.priority = 2;
  const endAll = t + C + 0.45;

  if (layers.hum) {
    const hum = bag.gain(0);
    hum.connect(bag.head);
    const fadeIn = calm ? 0.6 : 0.4;
    const pk = L(-23);
    hum.gain.setValueAtTime(0, t);
    hum.gain.linearRampToValueAtTime(pk * 0.8, t + fadeIn);
    hum.gain.linearRampToValueAtTime(pk * 1.35, t + C);
    hum.gain.setValueAtTime(pk * 1.35, t + C + 0.25);
    hum.gain.linearRampToValueAtTime(0, endAll);
    [[1, 1, 0], [2, 0.55, 1], [3, 0.2, 1]].forEach(([k, g0, fades]) => {
      const f0 = 80 * pr * k;
      const o = bag.osc('sine', f0, t, endAll + 0.05);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + C);      // a perfect fifth
      const g = bag.gain(fades ? 0 : g0);
      if (fades) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(g0, t + C * 0.75); }
      o.connect(g); g.connect(hum);
    });
  }

  // The squelch and tick layers are scheduled in slices (advance(until)): offline renders and tests take everything in one
  // go, the live engine schedules ~0.5 s ahead from a timer so mergeStart() itself never has to build the whole charge.
  let child: SquishVoice | null = null;
  let su = 0, squelchEnded = false;
  let tg: GainNode | null = null;
  let tu = t + 0.05, lastTick = -1, ticksDone = !layers.ticks;
  if (layers.squelch) {
    const sq = bag.gain(calm ? 0.6 : 0.8);
    sq.connect(bag.head);
    child = squish(ctx, sq, t, { rng: makeRng((r() * 4294967296) >>> 0), pitch: pr, jitter: 1 });
  } else squelchEnded = true;
  if (layers.ticks) {
    const nz = bag.noise(r, t, endAll);
    const bp = bag.biquad('bandpass', calm ? 1800 : 2800, 2.2);
    tg = bag.gain(0);
    nz.connect(bp); bp.connect(tg); tg.connect(bag.head);
    tu += rexp(r, 5);
  }
  const lam0 = 5, lam1 = 70;
  let stopped = false;
  const advance = (until: number): boolean => {
    if (stopped || !bag.alive || bag.dying) return true;
    if (child && !squelchEnded) {
      for (; su < C && t + su < until; su += 0.02) {
        const cmp = 0.9 * smooth(su / C);
        const rate = calm ? 0.8 + 0.15 * Math.sin(2 * Math.PI * 1.1 * su) : 1.0 + 0.5 * Math.sin(2 * Math.PI * 1.6 * su) + 0.8 * Math.exp(-su / 0.4);
        child.update({ compression: cmp, rate }, t + su);
      }
      if (su >= C) { child.end(0.06, t + C); squelchEnded = true; }
    }
    if (tg && !ticksDone) {
      while (tu < t + C && tu < until) {
        const prog = (tu - t) / C;
        if (tu - lastTick >= 0.006) {
          const a = calm ? 0.0025 : 0.0006;
          const lvl = L(-12.5) * rr(r, 0.6, 1) * (0.7 + 0.5 * prog);
          tg.gain.setValueAtTime(0, tu);
          tg.gain.linearRampToValueAtTime(lvl, tu + a);
          tg.gain.linearRampToValueAtTime(0, tu + a + 0.0026);
          lastTick = tu;
        }
        tu += rexp(r, lam0 * Math.pow(lam1 / lam0, prog));
      }
      if (tu >= t + C) ticksDone = true;
    }
    return squelchEnded && ticksDone;
  };
  advance(t + clamp(fin(p.lookaheadS, Infinity), 0.05, Infinity));
  // keep-alive so the group's sources outlive any layer that was muted
  const ka = bag.osc('sine', 20, t, endAll + 0.05);
  const kg = bag.gain(0); ka.connect(kg); kg.connect(bag.head);
  bag.endTime = endAll + 0.1;

  const voice: MergeVoice = {
    kind: 'merge',
    held: false,
    priority: 2,
    chargeS: C,
    advance,
    get endTime() { return bag.endTime; },
    get alive() { return bag.alive; },
    get dying() { return bag.dying; },
    kill: (f, at) => { try { child?.kill(f, at); } catch { /* gone */ } bag.kill(f, at); },
    free: () => { try { child?.free(); } catch { /* gone */ } bag.free(); },
    stop(fadeS = 0.15, atTime) {
      stopped = true;
      try { child?.end(fadeS, atTime); } catch { /* gone */ }
      bag.kill(fadeS, atTime);
    },
    burst(q, atTime) {
      const scripted = atTime !== undefined && Number.isFinite(atTime);
      const at = scripted ? Math.max(0, atTime as number) : ctx.currentTime + 0.004;
      stopped = true;
      try { child?.end(0.05, scripted ? at : undefined); } catch { /* gone */ }
      bag.kill(0.05, scripted ? at : undefined);
      return mergeBurst(ctx, out, at, {
        rng: makeRng((r() * 4294967296) >>> 0), pitch: pr, jitter: 1, calm,
        tier: q.tier, tierUp: q.tierUp, mythicVariant: q.mythicVariant, durationS: q.durationS,
      });
    },
  };
  return voice;
}

/** The duck the engine applies at the start of a Mythic reveal (DESIGN 6.3: 250 ms audio duck). */
export function mythicDuck(calm: boolean): { db: number; ms: number } {
  return calm ? { db: -7, ms: 250 * CALM_SCALE } : { db: -14, ms: 250 };
}

