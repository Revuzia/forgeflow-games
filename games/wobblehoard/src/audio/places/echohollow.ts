// SQUISH KEEPER (wobblehoard) Echo Hollow ambience (PLACES 4.9 "Sound"; PG_AUDIO round 2). Lives in the hollow's own lazy chunk. A cave
// under the hill lit by crystals, and nothing alive: no bats, no drips that sound like steps (PLACES P10).
//   drips    a drop into the glow pool every 1.5..4 s: a Minnaert bubble (r 2..4 mm) and its echo, twice, as scheduled copies (+0.22 s at
//            -9 dB and +0.44 s at -18 dB, darker: a slightly larger bubble). No DelayNode (AUDIO map 5).
//   air      a very quiet air tone: the noise mix in a narrow band on D3 (147 Hz), the cave's own note
// The echo on every creature voice is the shell's creature({ echo: true }) (and echoes: 2 while the Echo Stone is on).
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { BubbleChannel, layer, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const AIR = dbToGain(-16), DRIP = 0.03, ECHO = [[0.22, dbToGain(-9), 1.06], [0.44, dbToGain(-18), 1.12]] as const;

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const air = layer(ctx, mix, out, add, 'bandpass', 146.8, 6, AIR);
  const bub = new BubbleChannel(ctx, out, t, add);
  const later: number[] = [];       // [t, r, amp] of echo copies, made when their time comes into the window
  let next = t + rr(rng, 0.5, 2), pt = t;
  return {
    tick(from, until, r) {
      while (next < until) {
        if (next >= from) {
          const rad = rr(r, 0.002, 0.004), a = DRIP * rr(r, 0.5, 1);
          bub.play(next, rad, a, 0.25, 1.4);
          for (const [dt, g, grow] of ECHO) later.push(next + dt, rad * grow, a * g);
        }
        next += rr(r, 1.5, 4);
      }
      for (let i = 0; i < later.length;) {
        if (later[i] < until) { if (later[i] >= from) bub.play(later[i], later[i + 1], later[i + 2], 0.25, 1.8); later.splice(i, 3); } else i += 3;
      }
      while (pt + 1 <= until) { pt += 1; air.g.gain.linearRampToValueAtTime(AIR * rr(r, 0.7, 1.1), pt); }
    },
  };
}

export const recipe: AmbRecipe = { build };
