// SQUISH KEEPER (wobblehoard) CUT & RECONNECT voices (_spec/CUT.md; SOUND.md "Cut and reconnect"). Same rules as voices.ts
// and interact.ts: synthesised only (oscillators, filters, seeded noise, the Minnaert bubble), plain functions of
// (ctx, out, t0, params) so the live engine and the offline probe run identical code, every variation from the seeded `rng`.
// The recipes are our own; nothing is modelled on any reference clip's sound.
//
//   cutSlice  phase 'start': the waist forms. A wet tear that lasts the neck (neckS, default 0.25 s): an accelerating crackle
//             of torn-fibre micro-grains in a noise band that climbs as the waist thins, two squelch formants climbing under
//             it, a stream of wet bubbles that get smaller (higher) as it thins; sticky/slime add a stick-slip string, firm a
//             rubbery squeak, beads a light crunch, foam is muffled. Size: a smaller piece sits a little higher.
//   cutPop    phase 'separate': the pieces part. A soft round "plup" (a rounded blip gliding up as the cavity opens) on a low
//             body thump (the pieces springing apart), a breath of air, then 1-3 tiny bubbles. Pitch follows the smaller
//             piece's fraction: small pieces sound higher. Sticky/slime trail a short stringy creak, firm a quick recoil
//             flick, beads a few bead ticks, foam is muffled.
//   rejoin    two pieces flow back together: a gloopy "blorp" (a flurry of small merge bubbles and a squelch as the necks
//             touch, then a round wobbling tone that glides down and darkens like a big blob settling, closed by one bubble),
//             bigger and lower for a bigger merged piece. `all`: whole again, a gentle rising run of tuned bubbles (D major
//             pentatonic, the music's own collection) over a soft swelling two-sine glow. Nothing of the merge ceremony burst
//             (no noise crack, no bells, no motif).
//
// Families (CUT.md section 3) map onto six flavours; an unknown family is jelly gel.
import { clamp } from '../core/rng.ts';
import { Bag, bubble, dbToGain, fin, harmonicWave, lerp, pulseWave, rexp, rlog, rr, type Rng, type VoiceGroup } from './dsp.ts';
import { pluck, startTime } from './voices.ts';
import { SLIP_PULSE, strandAm } from './interact.ts';
import { midiHz, musicBubble } from './music.ts';

type Ctx = BaseAudioContext;

/* ═══════════════════════════════════ flavours ═══════════════════════════════════ */

export type CutFlavour = 'gel' | 'sticky' | 'foam' | 'beads' | 'dough' | 'firm';
export const CUT_FLAVOURS: readonly CutFlavour[] = ['gel', 'sticky', 'foam', 'beads', 'dough', 'firm'];

/** Material family id (src/data/materials.ts) -> cut flavour (CUT.md section 3). */
export const FAMILY_FLAVOUR: Readonly<Record<string, CutFlavour>> = {
  jellygel: 'gel', gummy: 'gel', waterfill: 'gel',
  stickystretch: 'sticky', slimegoo: 'sticky',
  slowrise: 'foam', marshmallow: 'foam',
  beadsqueeze: 'beads',
  putty: 'dough', mochidough: 'dough',
  firmsilicone: 'firm', popdome: 'firm',
};

/** The flavour of a family id (or a flavour name itself); anything else is jelly gel, the default family. */
export function cutFlavour(family: unknown): CutFlavour {
  if (typeof family !== 'string') return 'gel';
  const f = FAMILY_FLAVOUR[family];
  if (f) return f;
  return (CUT_FLAVOURS as readonly string[]).includes(family) ? (family as CutFlavour) : 'gel';
}

interface Flav {
  /** slice: tear band centre at the start / end of the neck (Hz, x size) and its Q */
  band: readonly [number, number]; q: number;
  /** slice: tear grain rate at the start / end of the neck (/s), grain length (s) */
  grains: readonly [number, number]; grainS: number;
  /** slice: wet bubble rate at the end of the neck (/s) and their size (x radius: bigger = lower, gooier) */
  bubbles: number; bubR: number;
  /** slice: squelch formant level (0..1) */
  squelch: number;
  /** stick-slip string level (0 = none), its carrier start / end (Hz, x size) and slip rate start / end (Hz) */
  string: number; strHz: readonly [number, number]; slipHz: readonly [number, number];
  /** slice: how far it rings past the neck (x neckS): stringy for sticky, short for the crisp and dense ones */
  tail: number;
  /** bead crunch ticks in a slice (0 = none) */
  crunch: number;
  /** final low-pass (Hz): muffled for foam */
  lp: number;
  /** separate: plup frequency multiplier, its decay (s) and attack (s), air level */
  popF: number; popTau: number; popAtt: number; air: number;
  /** level trims (dB) of the slice and the pop */
  trim: number; popTrim: number;
}

const FLAV: Readonly<Record<CutFlavour, Flav>> = {
  // jelly gel, gummy, water fill: crisp. A bright, quick tear with short clean grains, a clean pop.
  gel: { band: [750, 2100], q: 4.5, grains: [70, 420], grainS: 0.0016, bubbles: 38, bubR: 1, squelch: 0.7, string: 0, strHz: [0, 0], slipHz: [0, 0], tail: 0.14, crunch: 0, lp: 6500, popF: 1.08, popTau: 0.016, popAtt: 0.0011, air: 0.42, trim: 0, popTrim: 0 },
  // sticky stretch, slime goo: longer and stringier. A lower, wetter tear with many bubbles and a stick-slip string that
  // keeps stretching past the neck.
  sticky: { band: [430, 1350], q: 3, grains: [28, 210], grainS: 0.0028, bubbles: 72, bubR: 1.4, squelch: 1, string: 0.85, strHz: [560, 1500], slipHz: [22, 95], tail: 1.0, crunch: 0, lp: 5200, popF: 0.9, popTau: 0.026, popAtt: 0.002, air: 0.22, trim: -2, popTrim: -0.5 },
  // slow-rise foam, marshmallow: muffled. Everything under a 1.1 kHz low-pass, soft slow grains, few bubbles, a puffy pop.
  foam: { band: [380, 1050], q: 2, grains: [22, 130], grainS: 0.004, bubbles: 14, bubR: 1.15, squelch: 0.75, string: 0, strHz: [0, 0], slipHz: [0, 0], tail: 0.3, crunch: 0, lp: 1100, popF: 0.88, popTau: 0.024, popAtt: 0.0035, air: 0.5, trim: 5.8, popTrim: -0.5 },
  // bead squeeze: a slight crunch. A darker, grittier (wider) tear with bead ticks scattered through it, ticks at the pop.
  beads: { band: [450, 1250], q: 2.5, grains: [80, 380], grainS: 0.0015, bubbles: 8, bubR: 1, squelch: 0.4, string: 0, strHz: [0, 0], slipHz: [0, 0], tail: 0.14, crunch: 16, lp: 4500, popF: 1.04, popTau: 0.014, popAtt: 0.001, air: 0.35, trim: 2, popTrim: 0 },
  // putty, mochi dough: slow and sharp. A dense, dry, darker tear (short grains, little water), a dull pop.
  dough: { band: [520, 1500], q: 5, grains: [100, 560], grainS: 0.0011, bubbles: 7, bubR: 1, squelch: 0.45, string: 0, strHz: [0, 0], slipHz: [0, 0], tail: 0.1, crunch: 0, lp: 3200, popF: 0.94, popTau: 0.02, popAtt: 0.0015, air: 0.12, trim: 3, popTrim: -0.5 },
  // firm silicone, pop dome: it resists. A tight, higher tear with a short rubbery squeak, a snappy pop with a recoil.
  firm: { band: [950, 2600], q: 6, grains: [45, 280], grainS: 0.0014, bubbles: 12, bubR: 1, squelch: 0.5, string: 0.42, strHz: [1250, 2500], slipHz: [60, 170], tail: 0.08, crunch: 0, lp: 5800, popF: 1.18, popTau: 0.011, popAtt: 0.0008, air: 0.3, trim: 0.5, popTrim: 0 },
};

/** Dry levels (dB, loudest layer), calibrated with the probe like voices.ts LV. */
const LVC = { slice: -12.5, pop: -13.5, rejoin: [-17, -13.5] as const, glow: -24, flourish: -17 };

/** Calm (DESIGN 6.6): this much softer, slower edges, darker. */
export const CUT_CALM_DB = -4;

/* ═══════════════════════════════════ shared params ═══════════════════════════════════ */

export interface CutBase {
  rng: Rng;
  /** Optional pre-chosen +/-3% multiplier (the engine's round-robin supplies it); default: drawn from rng. */
  jitter?: number;
  pan?: number;
  calm?: boolean;
  /** Level multiplier (0..1) from the rate limiter (a busy run of cuts gets softer). Default 1. */
  level?: number;
  /** The squishy's own pitch ratio (genome size; 1 = base, as for every other voice): scales the frequencies and the bubble
   *  sizes, never the level. Default 1. */
  pitch?: number;
}

/** The squishy's pitch ratio (clamped 0.5..2, like voices.ts pitchOf) times the +/-3% per-call variation; always consumes
 *  exactly one rng draw, as before the pitch existed, so every later random draw of a voice is unchanged. */
function pitchJit(p: CutBase): number { return clamp(fin(p.pitch, 1), 0.5, 2) * jit(p); }

/** The +/-3% per-call variation; always consumes exactly one rng draw. */
function jit(p: CutBase): number {
  const u = p.rng();
  return p.jitter !== undefined ? clamp(fin(p.jitter, 1), 0.95, 1.05) : 1 + 0.03 * (2 * u - 1);
}

/** The smaller piece's fraction (0.05..1; a cut leaves pieces of 1/8 and up, CUT.md rule 4). */
export const cutFrac = (f: unknown): number => clamp(fin(f, 0.5), 0.05, 1);
/** Neck length (s): 0.08..1.5, default 0.25 (CUT.md: about 0.25 s, 0.4 s for the firm families). */
export const neckLen = (s: unknown): number => clamp(fin(s, 0.25), 0.08, 1.5);
/** Size factor of a cut piece: x1 for a half, higher for a smaller piece (volume -> size is a cube root; a little more than
 *  that, so the step between 1/2 and 1/8 is clearly heard): slice band x (0.5/frac)^0.25, the pop x (0.5/frac)^0.4. */
export const sliceSize = (frac: number): number => Math.pow(0.5 / cutFrac(frac), 0.25);
export const popSize = (frac: number): number => Math.pow(0.5 / cutFrac(frac), 0.4);

/** A stick-slip string (the strand voice's idea, struck directly): a sine carrier gliding fA -> fB, amplitude-pulsed at a slip
 *  rate gliding sA -> sB, from t to t + d, level `amp` rising over the first `rise` of it; returns its end. */
function slipString(ctx: Ctx, bag: Bag, dest: AudioNode, r: Rng, t: number, d: number, fA: number, fB: number, sA: number, sB: number, amp: number, rise: number): number {
  const end = t + d;
  const car = bag.osc('sine', fA, t, end + 0.03);
  car.setPeriodicWave(harmonicWave(ctx, 'cutString', [1, 0.12, 0.03]));
  car.frequency.setValueAtTime(fA, t);
  car.frequency.exponentialRampToValueAtTime(fB, end);
  const pw = pulseWave(ctx, 'slip', SLIP_PULSE);
  const slip = bag.osc('sine', sA, t, end + 0.03);
  slip.setPeriodicWave(pw.wave);
  slip.frequency.setValueAtTime(sA, t);
  slip.frequency.exponentialRampToValueAtTime(sB, end);
  const jw = bag.osc('sine', rr(r, 3.7, 5.2), t, end + 0.03), jwd = bag.gain(60);
  jw.connect(jwd); jwd.connect(slip.detune);
  const am = bag.gain(0), mod = bag.gain(0);
  slip.connect(mod); mod.connect(am.gain);
  // deep, separate slips at first, shallower (a continuous squeak) as it tightens: strandAm maps the pulse onto (1 - d) .. 1
  const g0 = strandAm(0.92, pw.min), g1 = strandAm(0.6, pw.min);
  am.gain.setValueAtTime(g0.base, t); am.gain.linearRampToValueAtTime(g1.base, end);
  mod.gain.setValueAtTime(g0.mod, t); mod.gain.linearRampToValueAtTime(g1.mod, end);
  const bp = bag.biquad('bandpass', fA, 2.4);
  bp.frequency.setValueAtTime(fA, t);
  bp.frequency.exponentialRampToValueAtTime(fB, end);
  const env = bag.gain(0);
  car.connect(am); am.connect(bp); bp.connect(env); env.connect(dest);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + rise * d);
  env.gain.setValueAtTime(amp, Math.max(t + rise * d, end - 0.35 * d));
  env.gain.linearRampToValueAtTime(0, end);
  return end + 0.03;
}

/** One bead tick: a short decaying sine (a hard bead knocking another) at `f`, `amp`, tau 3-6 ms. Returns its end. */
function beadTick(bag: Bag, dest: AudioNode, r: Rng, u: number, f: number, amp: number): number {
  const tau = rr(r, 0.003, 0.006);
  const o = bag.osc('sine', f, u, u + 0.0006 + 7.5 * tau + 0.005);
  const g = bag.gain(0);
  o.connect(g); g.connect(dest);
  return pluck(g.gain, u, amp, 0.0006, tau);
}

/* ═══════════════════════════════════ the slice (phase 'start') ═══════════════════════════════════ */

export interface CutSliceParams extends CutBase {
  frac: number; neckS?: number; family?: string;
  /** Diagnostics only (stem renders): level multipliers of the layers (default 1). */
  layers?: { tear?: number; hiss?: number; squelch?: number; bubbles?: number; string?: number; crunch?: number };
}

export function cutSlice(ctx: Ctx, out: AudioNode, t0: number, p: CutSliceParams): VoiceGroup {
  const t = startTime(t0);
  const F = FLAV[cutFlavour(p.family)];
  const calm = p.calm === true;
  const N = neckLen(p.neckS);
  const k = sliceSize(p.frac) * pitchJit(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'cut', p.pan ?? 0);
  // a quick neck is a little snappier, a slow one a little softer (+1 dB at 0.12 s, -1 dB at 0.6 s): otherwise the loudest
  // moment of a long slice (more grains, more bubbles) stands well above a short one's
  // A smaller piece is a lighter slice too (-1.4 dB at 1/8, +0.7 dB at the whole): its band sits higher and would otherwise be
  // the brightest, loudest thing in the lane.
  const A = dbToGain(LVC.slice + F.trim + (calm ? CUT_CALM_DB : 0)) * clamp(fin(p.level, 1), 0, 1) * clamp(Math.pow(0.25 / N, 0.15), 0.8, 1.25)
    * clamp(Math.pow(cutFrac(p.frac) / 0.5, 0.12), 0.8, 1.1);
  const tN = t + N;
  const ly = (k2: 'tear' | 'hiss' | 'squelch' | 'bubbles' | 'string' | 'crunch'): number => clamp(fin(p.layers?.[k2], 1), 0, 4);
  // progress shape: the voice builds as the waist thins (soft at first: about -20 dB of its peak a tenth of the way in)
  const amp = (u: number): number => 0.07 + 0.93 * Math.pow(clamp(u, 0, 1), 1.3);
  const tailS = 0.035 + F.tail * N;
  let endT = tN + tailS;

  const mix = bag.gain(1);
  const lp = bag.biquad('lowpass', Math.min(F.lp, calm ? 3000 : 20000), 0.6);
  const hp = bag.biquad('highpass', 160, 0.7);           // no rumble from the noise layers
  mix.connect(hp); hp.connect(lp); lp.connect(bag.head);

  // 1. the tear: a noise band whose centre climbs as the waist thins: a soft continuous hiss of it, and on top an
  //    accelerating crackle of torn-fibre micro-grains. The grains gate the noise BEFORE the band-pass, so each grain stays
  //    inside the band (gating after it smeared every grain down to the low end).
  const n1 = bag.noise(r, t, endT + 0.02);
  const bpA = bag.biquad('bandpass', Math.min(F.band[0] * k, 1600), F.q);
  bpA.frequency.setValueAtTime(Math.min(F.band[0] * k, 1600), t);
  // (the top is capped at 3 kHz: a small, firm piece would otherwise climb into a hiss)
  bpA.frequency.exponentialRampToValueAtTime(Math.min(F.band[1] * k, 3000), tN);
  const gA = bag.gain(0), gC = bag.gain(0);
  n1.connect(gA); n1.connect(gC); gA.connect(bpA); gC.connect(bpA); bpA.connect(mix);
  const C = A * 0.75 * Math.sqrt(F.q) * ly('hiss');    // a narrower band passes less noise: the hiss keeps its level
  gC.gain.setValueAtTime(0, t);
  gC.gain.linearRampToValueAtTime(C * 0.3, t + 0.3 * N);
  gC.gain.linearRampToValueAtTime(C, t + 0.9 * N);
  gC.gain.setValueAtTime(C, tN);
  gC.gain.exponentialRampToValueAtTime(Math.max(C * 0.004, 1e-7), tN + Math.min(tailS, 0.05));
  gC.gain.linearRampToValueAtTime(0, tN + Math.min(tailS, 0.05) + 0.008);
  gA.gain.setValueAtTime(0, t);
  {
    // calm: the same grains with slower edges, a little softer still (longer grains would ring the narrow band up louder)
    const gs = F.grainS;
    const att = calm ? 0.5 : 0.3;
    let u = t + 0.002;
    for (let guard = 0; guard < 220 && u < tN - gs; guard++) {
      const prog = (u - t) / N;
      const lvl = A * 1.9 * Math.sqrt(F.q) * rr(r, 0.6, 1) * amp(prog) * (calm ? 0.85 : 1) * ly('tear');
      gA.gain.setValueAtTime(0, u);
      gA.gain.linearRampToValueAtTime(lvl, u + att * gs);
      gA.gain.linearRampToValueAtTime(0, u + gs);
      u += gs + 0.0004 + rexp(r, lerp(F.grains[0], F.grains[1], Math.pow(prog, 1.4)));
    }
  }

  // 2. the squelch: the same noise, fluttering, through two formants climbing with the tear (the wet channel narrowing)
  const flutter = bag.gain(0.75);
  // (l1 is stopped at the very end: it keeps the bag alive until the last bubble has rung out)
  const l1 = bag.osc('sine', rr(r, 13, 19), t), l1d = bag.gain(0.3);
  const l2 = bag.osc('sine', rr(r, 23, 31), t, endT + 0.02), l2d = bag.gain(0.2);
  l1.connect(l1d); l1d.connect(flutter.gain); l2.connect(l2d); l2d.connect(flutter.gain);
  n1.connect(flutter);
  const gB = bag.gain(0);
  for (const [mul, q, lv] of [[0.5, 6, 1], [1.15, 5, 0.6]] as const) {
    const bp = bag.biquad('bandpass', F.band[0] * mul * k, q);
    bp.frequency.setValueAtTime(F.band[0] * mul * k, t);
    bp.frequency.exponentialRampToValueAtTime(Math.min(F.band[1] * mul * k, 3000), tN);
    const g = bag.gain(lv * 1.6);
    flutter.connect(bp); bp.connect(g); g.connect(gB);
  }
  gB.connect(mix);
  const S = A * 1.8 * F.squelch * ly('squelch');
  gB.gain.setValueAtTime(0, t);
  gB.gain.linearRampToValueAtTime(S * 0.25, t + 0.3 * N);
  gB.gain.linearRampToValueAtTime(S, t + 0.88 * N);
  gB.gain.setValueAtTime(S, tN);
  gB.gain.exponentialRampToValueAtTime(Math.max(S * 0.004, 1e-7), endT);
  gB.gain.linearRampToValueAtTime(0, endT + 0.01);

  // 3. wet bubbles: a Poisson stream that thickens and rises (the radii shrink) as the waist thins; at least two (a short neck
  //    with a dry family would otherwise often have none: the wetness, and the level, would come and go from cut to cut)
  {
    const times: number[] = [];
    let u = t + 0.04 * N;
    for (let guard = 0; guard < 80; guard++) {
      const prog = (u - t) / N;
      u += rexp(r, Math.max(1, F.bubbles * (0.3 + 0.7 * clamp(prog, 0, 1)) * (calm ? 0.75 : 1)));
      if (u >= tN) break;
      times.push(u);
    }
    if (times.length < 2) { times.length = 0; times.push(t + N * rr(r, 0.45, 0.6), t + N * rr(r, 0.75, 0.92)); }
    for (const v of times) {
      const pr = (v - t) / N;
      const rad = rlog(r, 0.0012, 0.004) * lerp(1.25, 0.7, pr) * F.bubR / k;
      endT = Math.max(endT, bubble(ctx, mix, v, Math.max(rad, 0.001), A * 0.42 * amp(pr) * rr(r, 0.7, 1) * ly('bubbles'), 0.35));
    }
  }

  // 4. the string (sticky, slime: a stick-slip string stretching on past the neck; firm: a short rubbery squeak)
  if (F.string > 0) {
    const d = F === FLAV.sticky ? N * (1 + 0.85 * F.tail) : N * 0.9;
    const t1 = t + (F === FLAV.sticky ? 0.3 * N : 0.45 * N);
    const e = slipString(ctx, bag, mix, r, t1, d - (t1 - t), F.strHz[0] * k, F.strHz[1] * k, F.slipHz[0], F.slipHz[1], A * F.string * (calm ? 0.85 : 1) * ly('string'), 0.5);
    endT = Math.max(endT, e);
  }

  // 5. the crunch (beads): a few bead ticks scattered through the second half of the neck
  if (F.crunch > 0) {
    const n = Math.max(1, Math.round(F.crunch * (calm ? 0.6 : 1) * rr(r, 0.8, 1.2)));
    for (let i = 0; i < n; i++) {
      const u = t + N * rr(r, 0.3, 1.0);
      const f = Math.min(rr(r, 2100, 3400) * Math.min(k, 1.25), 3600);
      endT = Math.max(endT, beadTick(bag, mix, r, u, f, A * rr(r, 0.22, 0.38) * amp((u - t) / N) * (calm ? 0.75 : 1) * ly('crunch')));
    }
  }

  l1.stop(endT + 0.02);
  bag.endTime = endT + 0.03;
  // the tear builds over the neck: about -20 dB of its peak a tenth of the way in; the music's dip waits for that. (Waiting
  // longer, until it is within ~10 dB at 0.3 of the neck, left a muffled slice's early part over the full music: in-band
  // 9.0 dB at music 0.45 and 1.3 dB at music 1, measured on isolated cuts; so the music makes way as the slice is first heard.)
  bag.onset = 0.1 * N;
  return bag;
}

/* ═══════════════════════════════════ the separation pop (phase 'separate') ═══════════════════════════════════ */

export interface CutPopParams extends CutBase { frac: number; family?: string }

export function cutPop(ctx: Ctx, out: AudioNode, t0: number, p: CutPopParams): VoiceGroup {
  const t = startTime(t0);
  const fl = cutFlavour(p.family);
  const F = FLAV[fl];
  const calm = p.calm === true;
  const size = popSize(p.frac);
  const pj = pitchJit(p);
  const k = size * pj;
  const r = p.rng;
  const bag = new Bag(ctx, out, 'cutPop', p.pan ?? 0);
  const A = dbToGain(LVC.pop + F.popTrim + (calm ? CUT_CALM_DB - 2 : 0)) * clamp(fin(p.level, 1), 0, 1);
  const att = F.popAtt * (calm ? 2.5 : 1);

  const mix = bag.gain(1);
  const lp = bag.biquad('lowpass', Math.min(F.lp, calm ? 1400 : 20000), 0.6);
  mix.connect(lp); lp.connect(bag.head);

  // the plup: a rounded blip that glides UP as the cavity between the pieces opens (no hard click: a soft pop)
  const f0 = Math.min(880 * k * F.popF, 2600);
  const o = bag.osc('sine', f0 * 0.8, t);
  o.setPeriodicWave(harmonicWave(ctx, 'cutPop', [1, 0.28, 0.08]));
  o.frequency.setValueAtTime(f0 * 0.8, t);
  o.frequency.setTargetAtTime(f0 * 1.12, t, 0.012);
  const og = bag.gain(0);
  o.connect(og); og.connect(mix);
  let endT = pluck(og.gain, t, A, att, F.popTau);

  // the body: the pieces spring apart, a low round thump below the music's register (its partials carry it on phone speakers)
  const fT = 175 * Math.sqrt(size * F.popF) * pj;
  const th = bag.osc('sine', fT, t);
  th.setPeriodicWave(harmonicWave(ctx, 'cutThump', [1, 0.45, 0.15]));
  th.frequency.setValueAtTime(fT, t);
  th.frequency.setTargetAtTime(fT * 0.72, t, 0.02);
  const tg = bag.gain(0);
  th.connect(tg); tg.connect(mix);
  endT = Math.max(endT, pluck(tg.gain, t, A * 0.55, Math.max(0.003, att), 0.018));

  // a breath of air as the seal lets go
  if (!calm && F.air > 0) {
    const n = bag.noise(r, t, t + 0.08);
    const bp = bag.biquad('bandpass', Math.min(1500 * k, 3500), 0.9);
    const ng = bag.gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(mix);
    pluck(ng.gain, t, A * F.air, 0.0008, 0.008);
  }

  // flavour
  if (fl === 'sticky') {
    // the goo strings out a little as they part: a short stick-slip creak climbing behind the pop
    endT = Math.max(endT, slipString(ctx, bag, mix, r, t + 0.012, 0.13 * (calm ? 0.8 : 1), 620 * k, 1350 * k, 30, 75, A * 0.42 * (calm ? 0.7 : 1), 0.35));
  } else if (fl === 'firm') {
    // a quick recoil flick as the halves snap back round
    const fr = Math.min(1150 * k, 2800);
    const ro = bag.osc('sine', fr, t + 0.007);
    ro.frequency.setValueAtTime(fr, t + 0.007);
    ro.frequency.setTargetAtTime(fr * 0.55, t + 0.007, 0.012);
    const rg = bag.gain(0);
    ro.connect(rg); rg.connect(mix);
    const e = pluck(rg.gain, t + 0.007, A * 0.4 * (calm ? 0.6 : 1), 0.0015, 0.01);
    ro.stop(e);
    endT = Math.max(endT, e);
  } else if (fl === 'beads') {
    const n = calm ? 2 : 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) endT = Math.max(endT, beadTick(bag, mix, r, t + rr(r, 0.004, 0.06), Math.min(rr(r, 2100, 3300) * Math.min(k, 1.25), 3600), A * rr(r, 0.3, 0.55) * (calm ? 0.5 : 1)));
  }

  // 1-3 tiny bubbles (pitched by the piece; never above 4.2 kHz, so a small, crisp piece is not shrill)
  const nb = calm ? 1 + Math.floor(r() * 2) : 1 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const rad = Math.max(rlog(r, 0.0009, 0.002) / (Math.pow(size, 0.6) * pj), 3.26 / 4200);
    endT = Math.max(endT, bubble(ctx, mix, t + rr(r, 0.018, 0.08) + 0.022 * i, rad, A * rr(r, 0.3, 0.55), 0.35));
  }
  // the first oscillator lives until the last bubble has rung out (the bag must not free itself under a ringing bubble)
  o.stop(endT);
  th.stop(endT);
  bag.endTime = endT + 0.02;
  // (the bubble count is readable for the probe: 1-3, 1-2 when calm)
  return Object.assign(bag, { bubbles: nb });
}

/* ═══════════════════════════════════ rejoin ═══════════════════════════════════ */

export interface RejoinParams extends CutBase { frac: number; all?: boolean }

/** D major pentatonic run for the whole-again flourish (MIDI): D5 E5 F#5 A5 B5 D6. The music's own collection, so it sits in
 *  every field of the bed. */
export const REJOIN_RUN: readonly number[] = [74, 76, 78, 81, 83, 86];

export function rejoin(ctx: Ctx, out: AudioNode, t0: number, p: RejoinParams): VoiceGroup {
  const t = startTime(t0);
  const calm = p.calm === true;
  const all = p.all === true;
  const m = all ? 1 : cutFrac(p.frac);
  // (the squishy's pitch moves the blorp; the whole-again run stays in the music's key)
  const j = pitchJit(p);
  const r = p.rng;
  const bag = new Bag(ctx, out, 'rejoin', p.pan ?? 0);
  const lvl = clamp(fin(p.level, 1), 0, 1);
  const A = dbToGain(lerp(LVC.rejoin[0], LVC.rejoin[1], Math.sqrt(m)) + (calm ? CUT_CALM_DB : 0)) * lvl;
  // bigger merged piece: lower and longer
  const z = Math.pow(m / 0.5, 0.35);
  const f0 = (290 / z) * j;
  const D = (0.22 + 0.22 * m) * (calm ? 1.15 : 1);

  const mix = bag.gain(1);
  const hp = bag.biquad('highpass', 70, 0.7);
  mix.connect(hp); hp.connect(bag.head);

  // "bl": the necks touch: a flurry of small merge bubbles and a short squelch falling as the gap closes (the "orp" follows
  // 12 ms later, so the voice is near its peak within ~20 ms and the music's dip never leaves a gap before it)
  const nb = calm ? 2 : 3 + Math.round(3 * m);
  let endT = t;
  for (let i = 0; i < nb; i++) {
    // (radii from 1.8 mm: these merge bubbles stay under ~2.3 kHz even as they chirp, gloopy rather than bright)
    endT = Math.max(endT, bubble(ctx, mix, t + rr(r, 0, 0.05), rlog(r, 0.0018, 0.0036) * Math.sqrt(z) / j, A * rr(r, 0.25, 0.45), 0.3));
  }
  // (the squelch is the blorp's onset: loud enough that the voice is near its peak from the first moments, soft-edged and
  // below 1.2 kHz so it never reads as a crack)
  const sq = bag.noise(r, t, t + 0.14);
  const sbp = bag.biquad('bandpass', (1000 / z) * j, 2.5);
  sbp.frequency.setValueAtTime((1000 / z) * j, t);
  sbp.frequency.exponentialRampToValueAtTime((480 / z) * j, t + 0.07);
  const slp = bag.biquad('lowpass', 1600, 0.6);
  const sg = bag.gain(0);
  sq.connect(sbp); sbp.connect(slp); slp.connect(sg); sg.connect(mix);
  pluck(sg.gain, t, A * 0.9, calm ? 0.012 : 0.005, 0.025);

  // "orp": the merged blob settles: a round tone gliding down and darkening, wobbling as the jelly settles
  const t1 = t + 0.012;
  const o = bag.osc('sine', f0 * 1.32, t1);
  o.setPeriodicWave(harmonicWave(ctx, 'rejoin', [1, 0.5, 0.22, 0.09]));
  o.frequency.setValueAtTime(f0 * 1.32, t1);
  o.frequency.setTargetAtTime(f0, t1, 0.03);
  o.frequency.setTargetAtTime(f0 * 1.05, t1 + 0.12, 0.08);
  const lp = bag.biquad('lowpass', (2400 / z) * j, 1.2);
  lp.frequency.setValueAtTime((2400 / z) * j, t1);
  lp.frequency.setTargetAtTime((700 / z) * j, t1, 0.06);
  const wob = bag.gain(1);
  const lfo = bag.osc('sine', (13 - 4 * m) * rr(r, 0.93, 1.07), t1);
  const wd = bag.gain(0);
  wd.gain.setValueAtTime(0.32, t1);
  wd.gain.setTargetAtTime(0, t1 + 0.04, 0.12);
  lfo.connect(wd); wd.connect(wob.gain);
  const og = bag.gain(0);
  o.connect(lp); lp.connect(wob); wob.connect(og); og.connect(mix);
  endT = Math.max(endT, pluck(og.gain, t1, A / 1.32, calm ? 0.02 : 0.008, D / 4.2));
  // "p": one bubble closes it
  endT = Math.max(endT, bubble(ctx, mix, t1 + D * rr(r, 0.7, 0.85), rlog(r, 0.0025, 0.0035) * Math.sqrt(z) / j, A * 0.32, 0.25));

  if (all) {
    // whole again: a gentle rising run of tuned bubbles (the music's own bubble voice, D major pentatonic) over a soft glow
    const tF = t + 0.16;
    const step = calm ? 0.085 : 0.065;
    const run = calm ? REJOIN_RUN.slice(0, 4) : REJOIN_RUN;
    const Af = dbToGain(LVC.flourish + (calm ? CUT_CALM_DB - 2 : 0)) * lvl;
    for (let i = 0; i < run.length; i++) {
      endT = Math.max(endT, musicBubble(ctx, mix, tF + i * step + rr(r, -0.006, 0.006), midiHz(run[i]), Af * (0.6 + 0.08 * i)));
    }
    // the glow: D5 + A5, a slow swell and fade with a little vibrato
    const tG = tF + 0.12;
    const G = dbToGain(LVC.glow + (calm ? CUT_CALM_DB - 2 : 0)) * lvl;
    const gl = bag.gain(0);
    gl.connect(mix);
    const vib = bag.osc('sine', 4.8, tG), vd = bag.gain(6);
    vib.connect(vd);
    const glowEnd = tG + (calm ? 0.75 : 0.95);
    for (const [mi, lv] of [[74, 1], [81, 0.55]] as const) {
      const go = bag.osc('sine', midiHz(mi), tG, glowEnd + 0.03);
      vd.connect(go.detune);
      const gg = bag.gain(lv);
      go.connect(gg); gg.connect(gl);
    }
    gl.gain.setValueAtTime(0, tG);
    gl.gain.linearRampToValueAtTime(G, tG + (calm ? 0.3 : 0.25));
    gl.gain.exponentialRampToValueAtTime(Math.max(G * 0.004, 1e-7), glowEnd);
    gl.gain.linearRampToValueAtTime(0, glowEnd + 0.02);
    vib.stop(glowEnd + 0.03);
    endT = Math.max(endT, glowEnd + 0.03);
  }
  o.stop(endT); lfo.stop(endT);
  bag.endTime = endT + 0.02;
  return bag;
}

/* ═══════════════════════════════════ rate limiting ═══════════════════════════════════ */

interface LimSpec { gap: number; cap: number; refill: number; recent: number; soften: number }

/**
 * Rate limiter for the cut and rejoin voices (pure, so the probe can drive it with synthetic times). Ten cuts in two seconds
 * must not pile up: each kind has a token bucket (a short burst, then a slow refill), a minimum gap, and every accepted call
 * of the same kind in the recent window makes the next one softer (level x 1 / (1 + soften n)). The engine also keeps the
 * slice monophonic (a new slice fades the one still sounding). `all` (whole again) always plays unless another one played
 * in the last ALL_GAP_S.
 */
export class CutLimiter {
  static readonly SLICE: LimSpec = { gap: 0.1, cap: 3, refill: 1.5, recent: 1.0, soften: 0.3 };
  static readonly POP: LimSpec = { gap: 0.06, cap: 3, refill: 1.5, recent: 1.0, soften: 0.3 };
  static readonly REJOIN: LimSpec = { gap: 0.08, cap: 3, refill: 3, recent: 0.6, soften: 0.25 };
  static readonly ALL_GAP_S = 0.6;
  private st: Record<string, { tokens: number; refillT: number; lastT: number; recent: number[] }> = {};
  private lastAll = -1e9;
  throttled = 0;

  /** Returns the level (0..1] to play at, or null to skip. `t` in seconds. */
  admit(kind: 'slice' | 'pop' | 'rejoin' | 'all', t: number): number | null {
    if (!Number.isFinite(t)) { this.throttled++; return null; }
    if (kind === 'all') {
      if (t - this.lastAll < CutLimiter.ALL_GAP_S) { this.throttled++; return null; }
      this.lastAll = t;
      return 1;
    }
    const S = kind === 'slice' ? CutLimiter.SLICE : kind === 'pop' ? CutLimiter.POP : CutLimiter.REJOIN;
    const s = (this.st[kind] ??= { tokens: S.cap, refillT: t, lastT: -1e9, recent: [] });
    s.tokens = Math.min(S.cap, s.tokens + Math.max(0, t - s.refillT) * S.refill);
    s.refillT = t;
    if (t - s.lastT < S.gap || s.tokens < 1) { this.throttled++; return null; }
    s.tokens -= 1;
    s.lastT = t;
    s.recent = s.recent.filter((u) => t - u < S.recent);
    const n = s.recent.length;
    s.recent.push(t);
    return 1 / (1 + S.soften * n);
  }
}
