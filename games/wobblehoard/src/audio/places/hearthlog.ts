// SQUISH KEEPER (wobblehoard) Hearthlog Cabin ambience (PLACES 4.2 "Sound"; PG_AUDIO step 8). Lives in the cabin's own lazy chunk. A
// fire and a quiet wooden room on an evening in the woods, and nothing alive: no birds, no insects, no animals (PLACES P10).
//   rumble   the fireplace's low roar: the bed's noise mix band-passed 120..300 Hz, breathing at 0.1 Hz (+-3 dB, a little wandering)
//   hush     the window: a soft, high, very quiet air band (snow falling past the pane is silent; this is the room's air)
//   crackle  Poisson clicks, 4..9 a second (the rate itself drifts), each a 2..5 ms grain of the fire at 2..5 kHz from 8 baked grains
//   creak    a log creak every 25..50 s: a slow stick-slip on a low wooden mode, 0.5..1 s
//   puff     the fire puffs up (a tap on the fireplace, PROP_SOUND crackle): 5 s of a denser, louder crackle and a +4 dB swell of the roar
// Levels are set so the bed sits at least 6 dB under the music long term at the default sliders (AU-06). Our own design.
import { clamp } from '../../core/rng.ts';
import { dbToGain, harmonicWave, nodeCounters, rexp, rr, type Rng } from '../dsp.ts';
import type { AmbRecipe, AmbLayers } from '../ambience.ts';

type Ctx = BaseAudioContext;

/** 8 baked crackle grains (seeded), graded in level: a few ms of noise rung through a 3.5 kHz two-pole resonator. */
const grains = new WeakMap<BaseAudioContext, AudioBuffer[]>();
function grainSet(ctx: Ctx): AudioBuffer[] {
  let g = grains.get(ctx);
  if (g) return g;
  g = [];
  let s = 0x68ea7410;
  const rnd = (): number => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sr = ctx.sampleRate, w = (2 * Math.PI * 3500) / sr, r = 0.86, a1 = 2 * r * Math.cos(w), a2 = -r * r;
  for (let k = 0; k < 8; k++) {
    const n = Math.round(sr * (0.002 + 0.0005 * k)), b = ctx.createBuffer(1, n + 64, sr), d = b.getChannelData(0);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n + 64; i++) {
      const e = i < n ? Math.exp(-i / (n * 0.3)) : 0;
      const y = (rnd() - 0.5) * e + a1 * y1 + a2 * y2;
      y2 = y1; y1 = y; d[i] = y;
    }
    let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    const lv = 0.35 + (0.65 * k) / 7;
    for (let i = 0; i < d.length; i++) d[i] *= lv / Math.max(pk, 1e-9);
    // the last 64 samples ring down to exact zero (no click at the grain's end)
    for (let i = 0; i < 64; i++) d[n + i] *= 1 - i / 64;
    g.push(b);
  }
  grains.set(ctx, g);
  return g;
}

const RUMBLE = dbToGain(-21), HUSH = dbToGain(-40), CRACKLE = dbToGain(-35), CREAK = dbToGain(-37);

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 190; bp.Q.value = 0.9; add(bp);
  const rg = ctx.createGain(); rg.gain.value = RUMBLE; add(rg);
  mix.connect(bp); bp.connect(rg); rg.connect(out);
  const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.55; add(hp);
  const hg = ctx.createGain(); hg.gain.value = HUSH; add(hg);
  mix.connect(hp); hp.connect(hg); hg.connect(out);
  const set = grainSet(ctx);
  let nextCrack = t + rexp(rng, 6), rate = 6, nextCreak = t + rr(rng, 8, 20), puffUntil = -1, lastBreath = t;
  rg.gain.setValueAtTime(RUMBLE, t);
  const phase = rng() * 10;
  return {
    tick(from, until, r) {
      // the roar breathes: a point every 0.5 s on a 0.1 Hz swell (+-3 dB) with a little wander, +4 dB while the fire puffs
      while (lastBreath + 0.5 <= until) {
        lastBreath += 0.5;
        const sw = 3 * Math.sin(2 * Math.PI * 0.1 * (lastBreath + phase)) + rr(r, -0.6, 0.6) + (lastBreath < puffUntil ? 4 : 0);
        rg.gain.linearRampToValueAtTime(RUMBLE * dbToGain(sw), lastBreath);
      }
      // crackle: a Poisson stream whose rate drifts inside 4..9 a second (18 while puffing)
      while (nextCrack < until) {
        if (nextCrack >= from) {
          const s = ctx.createBufferSource();
          const k = Math.floor(r() * r() * 8);
          s.buffer = set[clamp(k + (nextCrack < puffUntil ? 2 : 0), 0, 7)];
          s.playbackRate.value = rr(r, 0.65, 1.35);                 // 2.3..4.7 kHz
          const g = ctx.createGain(); g.gain.value = CRACKLE * rr(r, 0.4, 1) * (nextCrack < puffUntil ? 1.6 : 1);
          s.connect(g); g.connect(out);
          nodeCounters.created += 2;
          s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { /* gone */ } s.onended = null; nodeCounters.freed += 2; };
          s.start(nextCrack);
        }
        rate = clamp(rate + rr(r, -0.6, 0.6), 4, 9);
        nextCrack += rexp(r, nextCrack < puffUntil ? 18 : rate);
      }
      // a log creaks now and then
      if (nextCreak < until) {
        if (nextCreak >= from) logCreak(ctx, out, nextCreak, r);
        nextCreak += rr(r, 25, 50);
      }
    },
    puff(at) { puffUntil = Math.max(puffUntil, at + 5); },
  };
}

/** A log creak: a low wooden mode struck by a slow, irregular train of slips (12..20 a second), swelling and dying over 0.5..1 s. */
function logCreak(ctx: Ctx, out: AudioNode, t: number, r: Rng): void {
  const d = rr(r, 0.5, 1), f = rr(r, 210, 330);
  const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  nodeCounters.created += 3;
  o.setPeriodicWave(harmonicWave(ctx, 'logcreak', [1, 0.6, 0.45, 0.3, 0.2, 0.12]));
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * rr(r, 0.92, 1.06), t + d);
  lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 1.2;
  const n = Math.ceil(d / 0.002), c = new Float32Array(n);
  let slip = 0, nx = 0;
  for (let i = 0; i < n; i++) {
    const u = (i * d) / (n - 1);
    if (u >= nx) { slip = 1; nx = u + 1 / rr(r, 12, 20); }
    const env = Math.sin((Math.PI * u) / d);
    c[i] = i === 0 || i === n - 1 ? 0 : CREAK * env * (0.25 + 0.75 * slip);
    slip *= 0.82;
  }
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(c, t, d);
  o.connect(lp); lp.connect(g); g.connect(out);
  o.onended = () => { try { o.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* gone */ } o.onended = null; nodeCounters.freed += 3; };
  o.start(t); o.stop(t + d + 0.02);
}

export const recipe: AmbRecipe = { build };
