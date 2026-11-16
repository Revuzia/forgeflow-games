// SQUISH KEEPER (wobblehoard) Lanternroof ambience (PLACES 4.8 "Sound"; PG_AUDIO round 2). Lives in the roof's own lazy chunk. A rooftop
// at night under paper lanterns, and nothing alive: no birds, no cats, and no traffic (PLACES P10: the city is only a far, low hum).
//   gusts    night gusts in a 400..1600 Hz band, every 6..10 s (the roof's breeze, physics everyS) or when the shell says
//   paper    each gust stirs the lanterns' paper: a soft rustle (things.ts) on most gusts
//   city     a far city hum: the noise mix low-passed at 110 Hz, very low and steady, breathing a little (no horns, no engines)
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, rr, type Rng } from '../dsp.ts';
import { WeatherClock, layer, rustle, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const CALM = dbToGain(-44), GUST = dbToGain(-23), CITY = dbToGain(-20);

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void): AmbLayers {
  const g = layer(ctx, mix, out, add, 'bandpass', 600, 1, CALM);
  const city = layer(ctx, mix, out, add, 'lowpass', 110, 0.6, CITY);
  const gusts = new WeatherClock(t, 6, 10, rng);
  let pt = t;
  const gust = (tg: number, v: number, r: Rng): void => {
    const a = g.g.gain, f = g.f.frequency;
    a.cancelScheduledValues(tg); f.cancelScheduledValues(tg);
    a.setTargetAtTime(GUST * (0.4 + 0.6 * v), tg, 0.5); a.setTargetAtTime(CALM, tg + 2.5, 0.8);
    f.setTargetAtTime(700 + 900 * v, tg, 0.6); f.setTargetAtTime(500, tg + 2, 0.8);
    if (r() < 0.75) rustle(ctx, out, tg + rr(r, 0.4, 1.5), { rng: r, intensity: 0.3 + 0.4 * v, soft: 0.22, size: 0.4, pan: rr(r, -0.6, 0.6) });
  };
  return {
    tick(from, until, r) {
      gusts.run(from, until, r, (tg) => gust(tg, rr(r, 0.3, 1), r));
      while (pt + 1 <= until) { pt += 1; city.g.gain.linearRampToValueAtTime(CITY * rr(r, 0.8, 1.1), pt); }
    },
    weather(at, v) { gusts.heard(at); gust(at, Math.max(0.2, v), rng); },
  };
}

export const recipe: AmbRecipe = { build };
