// SQUISH KEEPER (wobblehoard) Frostbell Ridge ambience (PLACES 4.4 "Sound"; PG_AUDIO round 2). Lives in the ridge's own lazy chunk. A
// still, snowy shoulder of a mountain: crisp near-silence, a gust now and then, and nothing alive (PLACES P10).
//   gust     the noise mix through a band that sweeps 700 -> 1300..2500 -> 800 Hz over a gust's 2 s (+ tails), every 9..14 s (the
//            Wind Gap's gust, physics everyS) or when the shell says (setAmbience weather = a gust now, its strength)
//   air      between gusts, only a faint high air (above 6 kHz), the "crisp near-silence"
//   bell     rarely (every 20..45 s), a distant bell's partials on D, A or E, far away and soft
// The snow crunch on prints is the shell's prop(crunch). At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, harmonicWave, nodeCounters, rr, type Rng } from '../dsp.ts';
import { WeatherClock, layer, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const QUIET = dbToGain(-62), GUST = dbToGain(-25), AIR = dbToGain(-50), BELL = dbToGain(-47);

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const g = layer(ctx, mix, out, add, 'bandpass', 700, 1.2, QUIET);
  layer(ctx, mix, out, add, 'highpass', 6000, 0.5, AIR);
  const gusts = new WeatherClock(t, 9, 14, rng);
  let nextBell = t + rr(rng, 12, 30);
  const gust = (tg: number, v: number): void => {
    const a = g.g.gain, f = g.f.frequency, top = 1300 + 1200 * v;
    a.cancelScheduledValues(tg); f.cancelScheduledValues(tg);
    a.setTargetAtTime(GUST * (0.35 + 0.65 * v), tg, 0.35);
    a.setTargetAtTime(QUIET, tg + 2, 0.6);
    f.setTargetAtTime(top, tg, 0.5);
    f.setTargetAtTime(800, tg + 1.4, 0.7);
  };
  return {
    tick(from, until, r) {
      gusts.run(from, until, r, (tg) => gust(tg, rr(r, 0.35, 1)));
      if (nextBell < until) {
        if (nextBell >= from) farBell(ctx, out, nextBell, r);
        nextBell += rr(r, 20, 45);
      }
    },
    weather(at, v) { gusts.heard(at); gust(at, Math.max(0.2, v)); },
  };
}

/** A distant bell: one far partial pair on D6, A5 or E6 (the octave above, a whisper), a slow 3 s ring. 2 nodes, self-freeing. */
function farBell(ctx: Ctx, out: AudioNode, t: number, r: Rng): void {
  const m = [86, 81, 88][Math.floor(r() * 3)], f = 440 * Math.pow(2, (m - 69) / 12);
  const o = ctx.createOscillator(), g = ctx.createGain();
  nodeCounters.created += 2;
  o.setPeriodicWave(harmonicWave(ctx, 'farbell', [1, 0.3, 0.08]));
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(BELL, t + 0.01);
  g.gain.exponentialRampToValueAtTime(BELL * 0.004, t + 4);
  g.gain.linearRampToValueAtTime(0, t + 4.05);
  o.connect(g); g.connect(out);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } o.onended = null; nodeCounters.freed += 2; };
  o.start(t); o.stop(t + 4.1);
}

export const recipe: AmbRecipe = { build };
