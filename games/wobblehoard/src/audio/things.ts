// SQUISH KEEPER (wobblehoard) PLAYGROUND thing voices of the places (PG_AUDIO round 2; PLACES 3.3, 4.3..4.10; PLAYGROUND_BUILD 10 S2/S3).
// Part of the AWAY chunk (ambience.ts imports and re-exports it), so Home's first load never carries them. Plain functions of
// (ctx, out, t0, params) like every other voice; every draw from the caller's rng (the engine's PLAYGROUND stream, never engRng).
//   chime    a struck shell, tube or crystal: the free-bar partials (1, 2.76, 5.40), tuned to D major pentatonic, rings ~1.5 s
//   bell     a small bell or an icicle: near-harmonic partials (1, 2, 3, 4.2 stretched), a longer ring ~2.5 s
//   splash   a noise burst swept down through a band, and a handful of Minnaert bubbles (dsp.ts) after it
//   crunch   snow: a short granular crackle (one noise source, 6..14 grains in one envelope curve, band-passed)
//   rustle   a branch, a leaf or paper: band-passed noise with an irregular flutter (a strike, or held while it shakes)
//   boing    a pad's spring: a soft low tone that dips and wobbles (frequency automation only, no LFO node), and a little air puff
//   tick     a clock tick (tick and tock a fourth apart): a 3 ms grain through a resonance; on the music's eighth grid when it plays
//   whoosh   a slide, a ride, an updraft: band-passed noise swelling up and down (a strike), or held, following the speed
// No sample, no animal or traffic sound (PLACES P10). At most 8 nodes a strike. The designs are our own.
import { clamp } from '../core/rng.ts';
import { Bag, bubble, dbToGain, fin, harmonicWave, rr, type Rng, type VoiceGroup } from './dsp.ts';

type Ctx = BaseAudioContext;
export interface ThingP { rng: Rng; intensity: number; note?: number; pan?: number; soft?: number; size?: number }

const PENTA = [2, 4, 6, 9, 11];
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** The nearest D major pentatonic note to MIDI m (ties go down). */
export function snapPenta(m: number): number {
  const r = Math.round(fin(m, 74));
  for (let d = 0; d < 3; d++) { if (PENTA.includes((((r - d) % 12) + 12) % 12)) return r - d; if (PENTA.includes((((r + d) % 12) + 12) % 12)) return r + d; }
  return r;
}
const lvl = (p: ThingP, db: number): number => dbToGain(db) * (0.25 + 0.75 * Math.sqrt(clamp(fin(p.intensity, 0.5), 0, 1))) * clamp(fin(p.soft, 1), 0, 1);

/** A tuned struck thing: partials [ratio, level, decay s], each one oscillator into one gain. */
function struck(ctx: Ctx, out: AudioNode, t0: number, p: ThingP, kind: string, defNote: number, parts: readonly (readonly [number, number, number])[], db: number): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1);
  const bag = new Bag(ctx, out, kind, fin(p.pan, 0));
  const f = midiHz(snapPenta(fin(p.note, defNote))), A = lvl(p, db);
  let end = t;
  for (let k = 0; k < parts.length; k++) {
    const [ratio, l, dec] = parts[k];
    const fk = f * ratio;
    if (fk > ctx.sampleRate * 0.4) continue;
    // a soft strike barely wakes the upper partials (a harder one is brighter)
    const a = A * l * (k ? 0.35 + 0.65 * I : 1), e = t + dec * 5;
    const o = bag.osc('sine', fk * (1 + 0.0015 * (p.rng() - 0.5)), t, e + 0.03);
    const g = bag.gain(0);
    o.connect(g); g.connect(bag.head);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.002);
    g.gain.exponentialRampToValueAtTime(a * 0.0067, e);
    g.gain.linearRampToValueAtTime(0, e + 0.02);
    end = Math.max(end, e + 0.03);
  }
  bag.endTime = end + 0.01;
  return bag;
}

/** A shell, a tube or a crystal (PROP_SOUND chime): the free-bar partials. note = MIDI (D5 by default), snapped to D pentatonic. */
export const chime = (ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup =>
  struck(ctx, out, t0, p, 'chime', 74, [[1, 1, 0.3], [2.76, 0.32, 0.09], [5.4, 0.12, 0.035]], -17);
/** A small bell or an icicle (PROP_SOUND bell): near-harmonic, stretched a little, a longer ring. */
export const bell = (ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup =>
  struck(ctx, out, t0, p, 'bell', 74, [[1, 1, 0.5], [2.005, 0.4, 0.22], [3.012, 0.2, 0.1], [4.21, 0.1, 0.05]], -18);

/** Something landing in water (PROP_SOUND splash): a short wash swept down from about 3 kHz, then 3..8 bubbles. size = how big the
 *  splash is (m, default 0.2: a squishy). */
export function splash(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1), r = p.rng;
  const bag = new Bag(ctx, out, 'splash', fin(p.pan, 0));
  const A = lvl(p, -17), d = 0.12 + 0.18 * I;
  const nb = 3 + Math.floor(5 * I * r() + 0.5);
  let end = t + d + 0.05;
  for (let k = 0; k < nb; k++) {
    const at = t + 0.02 + rr(r, 0, 0.25 + 0.2 * I);
    end = Math.max(end, bubble(ctx, bag.head, at, rr(r, 0.0015, 0.004), A * rr(r, 0.25, 0.6), rr(r, 0.1, 0.4)));
  }
  const n = bag.noise(r, t, end + 0.02), bp = bag.biquad('bandpass', 2800, 0.9), g = bag.gain(0);
  n.connect(bp); bp.connect(g); g.connect(bag.head);
  bp.frequency.setValueAtTime(2800 + 1200 * I, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + d);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(A, t + 0.006);
  g.gain.setTargetAtTime(0, t + 0.006, d / 3);
  bag.endTime = end + 0.04;
  return bag;
}

/** One noise source through one band and an envelope curve [Hz, Q, curve, duration]: crunch, rustle and puff shapes. */
function noiseShape(ctx: Ctx, out: AudioNode, t: number, p: ThingP, kind: string, type: BiquadFilterType, f: number, q: number, c: Float32Array, d: number, sweep = 0): Bag {
  const bag = new Bag(ctx, out, kind, fin(p.pan, 0));
  const n = bag.noise(p.rng, t, t + d + 0.02), bp = bag.biquad(type, f, q), g = bag.gain(0);
  n.connect(bp); bp.connect(g); g.connect(bag.head);
  c[0] = 0; c[c.length - 1] = 0;
  g.gain.setValueCurveAtTime(c, t, d);
  // a whoosh's band follows its swell up and back (sweep = the top, Hz)
  if (sweep > f) { bp.frequency.setValueAtTime(f, t); bp.frequency.exponentialRampToValueAtTime(sweep, t + d * 0.45); bp.frequency.exponentialRampToValueAtTime(f, t + d); }
  bag.endTime = t + d + 0.03;
  return bag;
}

/** Snow underfoot or a snowball (PROP_SOUND crunch): 6..14 tiny grains over 80..220 ms, 1.8 kHz band. */
export function crunch(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1), r = p.rng, A = lvl(p, -16);
  const d = 0.08 + 0.14 * I, n = Math.ceil(d / 0.001), c = new Float32Array(n), g = 6 + Math.floor(8 * I);
  for (let k = 0; k < g; k++) {
    const i0 = Math.floor(r() * (n - 6)), a = A * rr(r, 0.3, 1) * (1 - (0.5 * i0) / n);
    for (let i = 0; i < 5; i++) c[i0 + i] = Math.max(c[i0 + i], a * (1 - i / 5));
  }
  for (let i = 0; i < n; i++) c[i] = Math.max(c[i], A * 0.08 * Math.sin((Math.PI * i) / n));
  return noiseShape(ctx, out, t, p, 'crunch', 'bandpass', 1800 + 900 * r(), 0.8, c, d);
}

/** A branch, a leaf or paper shaken once (PROP_SOUND rustle): 0.3..0.8 s of an irregular high flutter. size = the leaf's size (m):
 *  bigger is lower (default 0.3). */
export function rustle(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1), r = p.rng, A = lvl(p, -22);
  const d = 0.3 + 0.5 * I, n = Math.ceil(d / 0.004), c = new Float32Array(n);
  let fl = 0.5;
  for (let i = 0; i < n; i++) { fl = clamp(fl + rr(r, -0.35, 0.35), 0.15, 1); c[i] = A * fl * Math.sin((Math.PI * i) / n) ** 0.7; }
  return noiseShape(ctx, out, t, p, 'rustle', 'bandpass', 4200 * Math.pow(0.3 / clamp(fin(p.size, 0.3), 0.05, 2), 0.3), 1.1, c, d);
}

/** A pad's spring (PROP_SOUND boing): a soft round tone at 150..260 Hz that dips and wobbles back (14 Hz, dying), plus a breath of air
 *  (the Cloudloft puff pads' "puff"). Higher and longer for a bigger bounce. */
export function boing(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1), r = p.rng, A = lvl(p, -17);
  const bag = new Bag(ctx, out, 'boing', fin(p.pan, 0));
  const f = midiHz(snapPenta(50 + 8 * I + 2 * r())), d = 0.35 + 0.35 * I;
  const o = bag.osc('sine', f, t, t + d + 0.03);
  o.setPeriodicWave(harmonicWave(ctx, 'boing', [1, 0.3, 0.08]));
  const n = Math.ceil(d / 0.004), fc = new Float32Array(n);
  for (let i = 0; i < n; i++) { const u = (i * d) / (n - 1); fc[i] = f * (1 - 0.18 * Math.exp(-u / 0.03) + 0.06 * Math.exp(-u / (d / 3)) * Math.sin(2 * Math.PI * 14 * u)); }
  o.frequency.setValueCurveAtTime(fc, t, d);
  const g = bag.gain(0);
  o.connect(g); g.connect(bag.head);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(A, t + 0.008);
  g.gain.setTargetAtTime(0, t + 0.008, d / 4);
  const nz = bag.noise(r, t, t + 0.12), lp = bag.biquad('lowpass', 900, 0.5), ng = bag.gain(0);
  nz.connect(lp); lp.connect(ng); ng.connect(bag.head);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(A * 0.5, t + 0.01);
  ng.gain.setTargetAtTime(0, t + 0.01, 0.025);
  bag.endTime = t + d + 0.05;
  return bag;
}

/** A clock's tick (or a tock: `note` odd = tock, a fourth lower): a 3 ms noise grain through a 2.2 kHz resonance, very short. */
export function tick(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), A = lvl(p, -4), tock = (Math.floor(fin(p.note, 0)) & 1) === 1;
  const c = new Float32Array(16);
  for (let i = 1; i < 15; i++) c[i] = A * Math.exp(-i / 4);
  return noiseShape(ctx, out, t, p, 'tick', 'bandpass', tock ? 1650 : 2200, 6, c, 0.004);
}

/** A slide, a ride or an updraft (PROP_SOUND whoosh): band-passed noise rising and falling over 0.5..1.2 s. */
export function whoosh(ctx: Ctx, out: AudioNode, t0: number, p: ThingP): VoiceGroup {
  const t = Math.max(0, fin(t0, 0)), I = clamp(fin(p.intensity, 0.5), 0, 1), A = lvl(p, -22), d = 0.5 + 0.7 * I;
  const n = 64, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = A * Math.sin((Math.PI * i) / (n - 1)) ** 1.6;
  const b = noiseShape(ctx, out, t, p, 'whoosh', 'bandpass', 420, 1.4, c, d, 900 + 1100 * I);
  b.onset = d * 0.25;
  return b;
}

/* ═══════════════════════════════ held voices: rustle and whoosh following a motion (a dead-man switch) ═══════════════════════════════ */

export interface HeldThing extends VoiceGroup { update(level: number, at: number, pan?: number): void }

/** A held noise band (the shaking pine, a ride, a slide): level 0..1 = the speed; louder and brighter with it. Fades 0.15 s after the
 *  last update (silent by 0.3 s), sources stopped 0.6 s after it, so a caller that stops calling leaves nothing behind. */
export function heldNoise(ctx: Ctx, out: AudioNode, t0: number, rng: Rng, pan: number, kind: 'rustle' | 'whoosh'): HeldThing {
  const t = Math.max(0, fin(t0, 0)), rus = kind === 'rustle';
  const bag = new Bag(ctx, out, kind, pan, true);
  const n = bag.noise(rng, t), bp = bag.biquad('bandpass', rus ? 4200 : 500, rus ? 1.1 : 1.4), env = bag.gain(0);
  n.connect(bp); bp.connect(env); env.connect(bag.head);
  let stopAt = t + 0.6;
  n.stop(stopAt);
  bag.endTime = stopAt + 0.02;
  const peak = dbToGain(rus ? -26 : -28);
  return {
    kind, held: true,
    get endTime() { return bag.endTime; }, get alive() { return bag.alive; }, get dying() { return bag.dying; },
    kill: (f, at) => bag.kill(f, at), free: () => bag.free(),
    update(level, at, pn) {
      if (!bag.alive || bag.dying) return;
      const u = Math.max(t, fin(at, ctx.currentTime)), L = clamp(fin(level, 0), 0, 1);
      env.gain.cancelScheduledValues(u);
      // a rustle flutters (a new random level each update), a whoosh is smooth
      env.gain.setTargetAtTime(peak * Math.pow(L, 0.8) * (rus ? rr(rng, 0.45, 1) : 1), u, rus ? 0.015 : 0.06);
      env.gain.setTargetAtTime(0, u + 0.15, 0.02);
      bp.frequency.setTargetAtTime((rus ? 3600 : 380) * (1 + (rus ? 0.4 : 1.6) * L), u, 0.05);
      if (pn !== undefined && bag.panner) bag.panner.pan.setTargetAtTime(clamp(fin(pn, 0), -1, 1), u, 0.05);
      if (stopAt - u < 0.4) { stopAt = u + 0.6; try { n.stop(stopAt); bag.endTime = stopAt + 0.02; } catch { /* the sweep ends it */ } }
    },
  };
}

/** PROP_SOUND kind -> strike voice (ball, creak, crackle and kettle are elsewhere). Ids mirror src/data/places.ts (probe_chatter). */
export const STRIKE: Readonly<Record<number, (ctx: Ctx, out: AudioNode, t0: number, p: ThingP) => VoiceGroup>> = {
  3: chime, 4: splash, 5: crunch, 7: boing, 8: bell, 9: tick, 11: rustle, 12: whoosh,
};
