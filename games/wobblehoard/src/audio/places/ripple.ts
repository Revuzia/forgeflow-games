// SQUISH KEEPER (wobblehoard) Ripple Shore ambience (PLACES 4.3 "Sound"; PG_AUDIO round 2). Lives in the shore's own lazy chunk. A calm
// beach in late sun, and nothing alive: no gulls, no birds, no people (PLACES P10).
//   surf     the bed's noise mix low-passed 300..900 Hz, a wave swelling every 7..10 s (the Surf Edge's wave, physics everyS) and
//            drawing back; a wave's height opens the filter and the level. setAmbience({ weather }) = a wave now (the shell's timing).
//   fizz     on each pull-back, 1.5 s of tiny bubbles (r 0.6..1.6 mm, 2..5 kHz) as the water runs back through the sand
//   breeze   a wandering sea-breeze band (500..1500 Hz), very quiet
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { BubbleChannel, WeatherClock, layer, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const FLOOR = dbToGain(-34), PEAK = dbToGain(-19), BREEZE = dbToGain(-33), FIZZ = 0.006;

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const surf = layer(ctx, mix, out, add, 'lowpass', 300, 0.7, FLOOR);
  const br = layer(ctx, mix, out, add, 'bandpass', 900, 0.7, BREEZE);
  const waves = new WeatherClock(t, 7, 10, rng), bub = new BubbleChannel(ctx, out, t, add);
  const fizz: number[] = [];          // pending bubbles [t, r, amp, ...], made only when their time comes into the window
  let pt = t;
  const wave = (tw: number, v: number, r: Rng): void => {
    const g = surf.g.gain, f = surf.f.frequency, h = 0.4 + 0.6 * v;
    g.cancelScheduledValues(tw); f.cancelScheduledValues(tw);
    g.setTargetAtTime(FLOOR + (PEAK - FLOOR) * h, tw, 0.6);
    g.setTargetAtTime(FLOOR, tw + 1.9, 1.1);
    f.setTargetAtTime(300 + 600 * h, tw, 0.6);
    f.setTargetAtTime(300, tw + 1.9, 1.2);
    // the pull-back's fizz
    for (let u = tw + 2.1 + rr(r, 0, 0.3); u < tw + 3.8; u += -Math.log(1 - r()) / (8 + 10 * h)) fizz.push(u, rr(r, 0.0006, 0.0016), FIZZ * h * rr(r, 0.3, 1));
  };
  return {
    tick(from, until, r) {
      waves.run(from, until, r, (tw) => wave(tw, rr(r, 0.4, 1), r));
      for (let i = 0; i < fizz.length;) {
        if (fizz[i] < until) { if (fizz[i] >= from) bub.play(fizz[i], fizz[i + 1], fizz[i + 2], rr(r, 0.1, 0.3)); fizz.splice(i, 3); } else i += 3;
      }
      // the breeze wanders (a point every 0.5 s)
      while (pt + 0.5 <= until) {
        pt += 0.5;
        br.f.frequency.linearRampToValueAtTime(rr(r, 500, 1500), pt);
        br.g.gain.linearRampToValueAtTime(BREEZE * rr(r, 0.5, 1.2), pt);
      }
    },
    weather(at, v) { waves.heard(at); wave(at, Math.max(0.2, v), rng); },
  };
}

export const recipe: AmbRecipe = { build };
