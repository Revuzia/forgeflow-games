// SQUISH KEEPER (wobblehoard) Fizzwell Tub ambience (PLACES 4.6 "Sound"; PG_AUDIO round 2). Lives in the tub's own lazy chunk. A warm
// bath with a bubbly tap, and nothing alive (PLACES P10).
//   lapping  the noise mix in a 200..600 Hz band, a soft lap against the tub every 1.5..3.5 s
//   stream   the tap's stream (1..3 kHz) while it runs: setAmbience({ weather: 1 }) when the shell turns the Tap on, 0 when off
//            (without the shell's word the tap stays off)
//   pops     bubble pops on the water: small Minnaert bubbles, 0.5..2 a second (more while the tap runs)
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { BubbleChannel, layer, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const LAP = dbToGain(-22), STREAM = dbToGain(-30), POP = 0.012;

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const lap = layer(ctx, mix, out, add, 'bandpass', 350, 1, LAP * 0.4);
  const st = layer(ctx, mix, out, add, 'bandpass', 1800, 0.8, 0);
  const bub = new BubbleChannel(ctx, out, t, add);
  let nextLap = t + rr(rng, 0.5, 2), tap = 0, pt = t;
  return {
    tick(from, until, r) {
      while (nextLap < until) {
        if (nextLap >= from) {
          const g = lap.g.gain, f = lap.f.frequency, h = rr(r, 0.5, 1);
          g.setTargetAtTime(LAP * h, nextLap, 0.25); g.setTargetAtTime(LAP * 0.35, nextLap + 0.6, 0.5);
          f.setTargetAtTime(250 + 350 * h, nextLap, 0.3); f.setTargetAtTime(260, nextLap + 0.6, 0.6);
        }
        nextLap += rr(r, 1.5, 3.5);
      }
      for (let u = from + -Math.log(1 - r()) / (0.6 + 1.6 * tap); u < until; u += -Math.log(1 - r()) / (0.6 + 1.6 * tap)) bub.play(u, rr(r, 0.002, 0.005), POP * rr(r, 0.3, 1), rr(r, 0.1, 0.4));
      // the stream flutters while it runs
      while (pt + 0.2 <= until) { pt += 0.2; st.g.gain.linearRampToValueAtTime(STREAM * tap * rr(r, 0.7, 1), pt); st.f.frequency.linearRampToValueAtTime(rr(r, 1200, 2600), pt); }
    },
    weather(at, v) { tap = v >= 0.5 ? 1 : 0; const g = st.g.gain; g.cancelScheduledValues(at); g.setTargetAtTime(STREAM * tap, at, 0.15); pt = at + 0.6; },
  };
}

export const recipe: AmbRecipe = { build };
