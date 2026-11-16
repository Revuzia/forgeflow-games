// SQUISH KEEPER (wobblehoard) Cloudloft ambience (PLACES 4.10 "Sound"; PG_AUDIO round 2). Lives in Cloudloft's own lazy chunk. A soft
// place above the clouds at dawn, and nothing alive: no birds (PLACES P10).
//   wind     a high, soft wind: the noise mix in a broad band around 2.5 kHz, its level and centre wandering
//   whoosh   a slow whoosh every 8..16 s (Cloudloft's gusts, physics everyS) or when the shell says: a band sweeping 400 -> 1200 Hz and back
// The puff on each pad bounce is the shell's prop(boing) (the boing carries its own air puff). At least 6 dB under the music (AU-06).
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { WeatherClock, layer, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const WIND = dbToGain(-37), CALM = dbToGain(-60), WHOOSH = dbToGain(-22);

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const w = layer(ctx, mix, out, add, 'bandpass', 2500, 0.6, WIND);
  const s = layer(ctx, mix, out, add, 'bandpass', 400, 1.2, CALM);
  const gusts = new WeatherClock(t, 8, 16, rng);
  let pt = t;
  const whoosh = (tg: number, v: number): void => {
    const a = s.g.gain, f = s.f.frequency;
    a.cancelScheduledValues(tg); f.cancelScheduledValues(tg);
    a.setTargetAtTime(WHOOSH * (0.4 + 0.6 * v), tg, 0.6); a.setTargetAtTime(CALM, tg + 2, 0.9);
    f.setTargetAtTime(700 + 500 * v, tg, 0.7); f.setTargetAtTime(400, tg + 1.8, 0.9);
  };
  return {
    tick(from, until, r) {
      gusts.run(from, until, r, (tg) => whoosh(tg, rr(r, 0.3, 1)));
      while (pt + 0.5 <= until) { pt += 0.5; w.g.gain.linearRampToValueAtTime(WIND * rr(r, 0.6, 1.25), pt); w.f.frequency.linearRampToValueAtTime(rr(r, 2000, 3200), pt); }
    },
    weather(at, v) { gusts.heard(at); whoosh(at, Math.max(0.2, v)); },
  };
}

export const recipe: AmbRecipe = { build };
