// SQUISH KEEPER (wobblehoard) Rainleaf Garden ambience (PLACES 4.5 "Sound"; PG_AUDIO round 2). Lives in the garden's own lazy chunk. Soft
// rain at dusk under giant leaves, and nothing alive: no frogs, no birds, no insects (PLACES P10).
//   patter   dense micro-ticks, 30..80 a second at 3..8 kHz (one band of the noise mix, its gain written as a curve of ticks: no node
//            per drop), following the shower envelope (on 40 s, off 30 s, 3 s ramps: the Rain zone's shower; setAmbience weather 1 / 0
//            = the shower turning on / off now)
//   drips    drops off the leaves as small bubbles (r 1.5..3 mm, 1.1..2.2 kHz), a few a second, fewer when the shower is off
//   rustle   a soft leaf rustle: a high band whose level wanders
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { BubbleChannel, layer, patterCurve, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const PATTER = 0.085, RUSTLE = dbToGain(-40), DRIP = 0.016, RAMP_S = 3, ON_S = 40, OFF_S = 30;

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const pat = layer(ctx, mix, out, add, 'bandpass', 5000, 0.8, 0);
  const rus = layer(ctx, mix, out, add, 'bandpass', 3500, 1.5, RUSTLE * 0.5);
  const bub = new BubbleChannel(ctx, out, t, add);
  // the shower: a target (1 on, 0 off) reached by a 3 s ramp; the own timer flips it unless the shell led in the last 30 s
  let on = 1, from0 = 0, fromT = t, nextFlip = t + rr(rng, 10, ON_S), lastHeard = -1e9, pt = t;
  const env = (u: number): number => from0 + (on - from0) * Math.min(1, Math.max(0, (u - fromT) / RAMP_S));
  const flip = (u: number, v: number): void => { from0 = env(u); on = v; fromT = u; };
  return {
    tick(from, until, r) {
      while (nextFlip < until) { if (nextFlip > lastHeard + 30) flip(nextFlip, on ? 0 : 1); nextFlip += on ? ON_S : OFF_S; }
      const e = env((from + until) / 2);
      patterCurve(pat.g.gain, from, until, 2 + e * rr(r, 30, 78), PATTER * (0.35 + 0.65 * e), 0.6, r);
      // drips off the leaves (more right after the rain)
      for (let u = from + -Math.log(1 - r()) / (0.7 + 1.6 * e); u < until; u += -Math.log(1 - r()) / (0.7 + 1.6 * e)) {
        const rad = rr(r, 0.0015, 0.003);
        bub.play(u, rad, DRIP * rr(r, 0.35, 1), rr(r, 0.15, 0.35));
      }
      while (pt + 0.25 <= until) {
        pt += 0.25;
        rus.g.gain.linearRampToValueAtTime(RUSTLE * rr(r, 0.2, 0.6 + 0.4 * e), pt);
      }
    },
    weather(at, v) { lastHeard = at; flip(at, v >= 0.5 ? 1 : 0); nextFlip = Math.max(nextFlip, at + (v >= 0.5 ? ON_S : OFF_S)); },
  };
}

export const recipe: AmbRecipe = { build };
