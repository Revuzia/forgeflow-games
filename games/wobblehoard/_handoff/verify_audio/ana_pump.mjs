// Pumping / room-dip behaviour under play: gain trace of the music stem vs the same music without play, momentary loudness.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SR, rd, rj, db, pct, kWeight, msFrames, separation, HERE } from './lib.mjs';
import { spectrogramPng, fft } from './wb/_harness/audioview/analysis.mjs';

const OUT = resolve(HERE, process.env.OUTDIR || 'out');
const ref = rd('ref11.music.f32');
const refK = kWeight(ref);
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['dense11', 'sparse11', 'bursts11'];
const res = {};
const lufs = (p) => -0.691 + db(p);

function momentary(xK, from, to) { return msFrames(xK, 0.4, 0.1, from, to).map((q) => ({ t: q.t, L: lufs(q.p) })); }

const mRef = momentary(refK, 4, 64);
res.ref = { L: { p10: pct(mRef.map((q) => q.L), 0.1), p50: pct(mRef.map((q) => q.L), 0.5), p90: pct(mRef.map((q) => q.L), 0.9) } };
// natural slow fluctuation of the music itself: |dL| over 1 s
const dRef = []; for (let i = 10; i < mRef.length; i++) dRef.push(Math.abs(mRef[i].L - mRef[i - 10].L));
res.ref.dL1s = { p50: pct(dRef, 0.5), p90: pct(dRef, 0.9), max: Math.max(...dRef) };

for (const nm of names) {
  const mu = rd(`${nm}.music.f32`), fx = rd(`${nm}.fx.f32`), mix = rd(`${nm}.mix.f32`);
  const meta = rj(`${nm}.json`);
  const ev = rj(`${nm}.events.json`);
  const muK = kWeight(mu), fxK = kWeight(fx);
  // gain trace on 50 ms frames (K-weighted energies), where the reference music is not near silence
  const a = msFrames(muK, 0.05, 0.05, 0, 72), b = msFrames(refK, 0.05, 0.05, 0, 72);
  const G = a.map((q, i) => ({ t: q.t, g: b[i].p > 1e-9 ? db(q.p / b[i].p) : NaN }));
  const play = G.filter((q) => q.t >= 4 && q.t < 64 && Number.isFinite(q.g));
  const gs = play.map((q) => q.g);
  // pump cycles: the gain recovers by >= 6 dB from a local minimum and is then cut again by >= 6 dB (hysteresis)
  let state = 'down', lo = 0, hi = -99, cycles = 0, recov = [];
  let curMin = 0, curMinT = 0;
  for (const q of play) {
    if (state === 'down') { if (q.g < curMin) { curMin = q.g; curMinT = q.t; } if (q.g > curMin + 6) { state = 'up'; hi = q.g; } }
    else { if (q.g > hi) hi = q.g; if (q.g < hi - 6) { cycles++; recov.push(hi - curMin); state = 'down'; curMin = q.g; } }
  }
  // modulation spectrum of the gain trace (20 Hz sampling) over the play window
  const n = 1024; const re = new Float64Array(n), im = new Float64Array(n);
  const mean = gs.reduce((s, v) => s + v, 0) / gs.length;
  for (let i = 0; i < Math.min(n, gs.length); i++) re[i] = (gs[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.min(n, gs.length)));
  fft(re, im);
  let tot = 0, band = 0, pkF = 0, pkP = 0;
  for (let k = 1; k < n / 2; k++) { const f = (k * 20) / n, p = re[k] * re[k] + im[k] * im[k]; tot += p; if (f >= 0.2 && f <= 4) band += p; if (f >= 0.1 && p > pkP) { pkP = p; pkF = f; } }
  // momentary loudness of what the player hears from the music, and of the effects
  const mM = momentary(muK, 4, 64), mF = momentary(fxK, 4, 64);
  const dM = []; for (let i = 10; i < mM.length; i++) dM.push(Math.abs(mM[i].L - mM[i - 10].L));
  const gapLF = mM.map((q, i) => mF[i].L - q.L);
  // fraction of play time per gain band
  const frac = (f) => gs.filter(f).length / gs.length;
  res[nm] = {
    interactions: meta.n, rate: meta.rate, wallS: meta.wallMs / 1000, errors: meta.errors, final: meta.final,
    gain: { p05: pct(gs, 0.05), p25: pct(gs, 0.25), p50: pct(gs, 0.5), p75: pct(gs, 0.75), p95: pct(gs, 0.95), below10: frac((g) => g < -10), below3: frac((g) => g < -3), above1: frac((g) => g > -1) },
    pumpCyclesPerMin: cycles, recoveryDepths: { p50: recov.length ? pct(recov, 0.5) : 0, max: recov.length ? Math.max(...recov) : 0 },
    modSpectrum: { peakHz: pkF, share02to4Hz: band / tot, stdDb: Math.sqrt(gs.reduce((s, v) => s + (v - mean) ** 2, 0) / gs.length) },
    musicL: { p10: pct(mM.map((q) => q.L), 0.1), p50: pct(mM.map((q) => q.L), 0.5), p90: pct(mM.map((q) => q.L), 0.9) },
    musicDL1s: { p50: pct(dM, 0.5), p90: pct(dM, 0.9), max: Math.max(...dM) },
    fxL: { p50: pct(mF.map((q) => q.L), 0.5) },
    fxOverMusicLU_400ms: { p05: pct(gapLF, 0.05), p50: pct(gapLF, 0.5) },
  };
  // recovery after the last event (64 s onward): time to come within 1 dB
  const after = G.filter((q) => q.t > 64.3 && Number.isFinite(q.g));
  const back = after.find((q) => q.g > -1);
  res[nm].recoveryAfterPlay = back ? +(back.t - 64).toFixed(2) : null;
  // trace CSV + images
  writeFileSync(resolve(OUT, `${nm}_gain.csv`), G.map((q) => `${q.t.toFixed(3)},${Number.isFinite(q.g) ? q.g.toFixed(2) : ''}`).join('\n'));
  const cut = (x, a0, a1) => x.slice(Math.round(a0 * SR), Math.round(a1 * SR));
  const marks = ev.spans.filter((s) => s.at < 34 && ['poke', 'pop', 'land', 'bump', 'lift', 'toss', 'strandSnap', 'release'].includes(s.kind)).map((s) => ({ t: s.at - 4, label: s.kind.slice(0, 4).toUpperCase() }));
  writeFileSync(resolve(OUT, `${nm}_music_4-34.png`), spectrogramPng(cut(mu, 4, 34), SR, { title: `${nm.toUpperCase()}: MUSIC STEM UNDER PLAY 4-34 S`, win: 4096, width: 1400, fMin: 40, fMax: 12000, marks }));
  writeFileSync(resolve(OUT, `${nm}_mix_4-34.png`), spectrogramPng(cut(mix, 4, 34), SR, { title: `${nm.toUpperCase()}: MASTER OUTPUT (MUSIC + PLAY) 4-34 S`, win: 2048, width: 1400, fMin: 40, fMax: 14000, marks }));
  writeFileSync(resolve(OUT, `${nm}_music_0-72.png`), spectrogramPng(mu, SR, { title: `${nm.toUpperCase()}: MUSIC STEM 0-72 S (PLAY 4-64 S)`, win: 4096, width: 1400, fMin: 40, fMax: 12000 }));
}
writeFileSync(resolve(OUT, 'ref11_music_0-60.png'), spectrogramPng(ref.slice(0, 60 * SR), SR, { title: 'MUSIC ALONE (ENGINE SEED 11), 0-60 S', win: 4096, width: 1400, fMin: 40, fMax: 12000 }));
console.log(JSON.stringify(res, null, 1));
writeFileSync(resolve(OUT, 'pump.json'), JSON.stringify(res, null, 1));
