// SQUISH KEEPER (wobblehoard) Cogwhistle Bench ambience (PLACES 4.7 "Sound"; PG_AUDIO round 2). Lives in the bench's own lazy chunk. A
// tinker's workbench at night under one lamp, and nothing alive (PLACES P10).
//   tick     a soft clock ticking on the music's beat (tick, tock: a fourth apart), from the bar the music is SOUNDING (musicClock's
//            source); with the music off it keeps 66 BPM by itself. One band of the noise mix whose gain is spiked per beat (no node a tick).
//   hum      the desk lamp's hum: a very quiet low D (73.4 Hz) with a little 2nd and 3rd harmonic (in key)
//   spring   rarely (every 30..70 s), a spring somewhere on the bench settles: a very soft low wobble (2 nodes, self-freeing)
// At least 6 dB under the music long term (AU-06). Our own design.
import { dbToGain, harmonicWave, nodeCounters, rr, type Rng } from '../dsp.ts';
import { layer, type AmbEnv, type AmbLayers, type AmbRecipe } from '../ambience.ts';

type Ctx = BaseAudioContext;
const TICK = dbToGain(-17), HUM = dbToGain(-50), BEAT_S = 60 / 66;

function build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void, env: AmbEnv): AmbLayers {
  const tk = layer(ctx, mix, out, add, 'bandpass', 2200, 9, 0);
  const o = ctx.createOscillator(), hg = ctx.createGain();
  add(o); add(hg);
  o.setPeriodicWave(harmonicWave(ctx, 'lamphum', [1, 0.5, 0.25]));
  o.frequency.value = 73.42; hg.gain.value = HUM;
  o.connect(hg); hg.connect(out);
  o.start(t);
  let last = t, k = 0, nextBoing = t + rr(rng, 20, 50);
  return {
    tick(from, until, r) {
      // the next beat after the last one: on the sounding bar's grid when the music plays, else 66 BPM from the last tick
      for (;;) {
        const b = env.barAt(last + 0.02);
        let nb = last + BEAT_S;
        if (b) { const q = Math.ceil((last + 0.05 - b.barT) / BEAT_S - 1e-9); nb = b.barT + q * BEAT_S; if (nb <= last + 0.05) nb += BEAT_S; }
        if (nb >= until) break;
        last = nb; k++;
        if (nb < from) continue;
        const g = tk.g.gain, a = TICK * rr(r, 0.8, 1);
        tk.f.frequency.setValueAtTime(k & 1 ? 1650 : 2200, nb);
        g.setValueAtTime(0, nb); g.linearRampToValueAtTime(a, nb + 0.0008); g.linearRampToValueAtTime(a * 0.15, nb + 0.004); g.linearRampToValueAtTime(0, nb + 0.012);
      }
      if (nextBoing < until) { if (nextBoing >= from) spring(ctx, out, nextBoing, r); nextBoing += rr(r, 30, 70); }
    },
  };
}

/** A spring settling far off on the bench: a soft low tone (A3 or D4) wobbling at 11 Hz and dying over 0.6 s. */
function spring(ctx: Ctx, out: AudioNode, t: number, r: Rng): void {
  const f = r() < 0.5 ? 220 : 293.66, d = 0.6, n = 120, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const u = (i * d) / (n - 1); c[i] = f * (1 + 0.05 * Math.exp(-u / 0.2) * Math.sin(2 * Math.PI * 11 * u)); }
  const o = ctx.createOscillator(), g = ctx.createGain();
  nodeCounters.created += 2;
  o.frequency.setValueCurveAtTime(c, t, d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dbToGain(-46), t + 0.01); g.gain.setTargetAtTime(0, t + 0.01, 0.12);
  o.connect(g); g.connect(out);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } o.onended = null; nodeCounters.freed += 2; };
  o.start(t); o.stop(t + d + 0.02);
}

export const recipe: AmbRecipe = { build };
