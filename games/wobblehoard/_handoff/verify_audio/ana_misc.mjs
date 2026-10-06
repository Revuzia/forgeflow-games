// Strand levels at realistic call patterns (through the engine) and the music bubbles' pitch.
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SR, rd, rj, db, dbA, pct, msFrames, HERE } from './lib.mjs';
import { spectrogramPng, frameSpectrum } from './wb/_harness/audioview/analysis.mjs';

const OUT = resolve(HERE, process.env.OUTDIR || 'out');
const what = process.argv[2] ?? 'all';
const res = {};
const peak = (x, a, b) => { let p = 0; for (let i = Math.round(a * SR); i < Math.min(x.length, Math.round(b * SR)); i++) p = Math.max(p, Math.abs(x[i])); return p; };
const step = (x, a, b) => { let p = 0; for (let i = Math.max(1, Math.round(a * SR)); i < Math.min(x.length, Math.round(b * SR)); i++) p = Math.max(p, Math.abs(x[i] - x[i - 1])); return p; };

if (what === 'all' || what === 'strand') {
  res.strand = {};
  for (const nm of ['30Hz_q128', '60Hz_q10ms', '120Hz_q1024', '45Hz_q21ms', '90Hz_q5ms']) {
    const f = `strand_${nm}`;
    if (!existsSync(resolve(HERE, 'data', `${f}.json`))) continue;
    const mix = rd(`${f}.mix.f32`), fx = rd(`${f}.fx.f32`), meta = rj(`${f}.json`);
    const w = msFrames(mix, 0.1, 0.05, 0, 7.5);
    const rmsMax = (a, b) => Math.max(...w.filter((q) => q.t >= a && q.t <= b).map((q) => db(q.p)));
    const lastCall = 2.5;
    res.strand[nm] = {
      stretchPeak: +dbA(peak(mix, 0.5, 1.5)).toFixed(1), holdPeak: +dbA(peak(mix, 1.5, 2.5)).toFixed(1), holdRms100Max: +rmsMax(1.6, 2.4).toFixed(1),
      lowTensionPeak: +dbA(peak(mix, 4, 6)).toFixed(1), lowTensionRms100Max: +rmsMax(5.1, 5.9).toFixed(1),
      after025: +dbA(peak(mix, lastCall + 0.25, lastCall + 0.35)).toFixed(1), after06: +dbA(peak(mix, lastCall + 0.6, lastCall + 0.7)).toFixed(1),
      tailEnd: +dbA(peak(mix, 6.6, 7.4)).toFixed(1), maxStep: +step(mix, 0.4, 7.4).toFixed(4), throttled: meta.final.throttled, liveNodesEnd: meta.final.stats.liveNodes, started: meta.final.stats.started.strand,
    };
    if (nm === '30Hz_q128' || nm === '120Hz_q1024') writeFileSync(resolve(OUT, `strand_engine_${nm}.png`), spectrogramPng(mix, SR, { title: `STRAND THROUGH THE ENGINE (${nm}): 0.5-2.5 S PULL TO 0.8 + HOLD, 4-6 S PULL TO 0.4 AT PITCH 1.3, NO SNAP`, win: 1024, width: 1200, fMin: 40, fMax: 14000 }));
  }
}

if (what === 'all' || what === 'bub') {
  const list = rj('bub.json');
  const rows = [];
  for (const q of list) {
    const x = rd(`bub_${q.midi}_${q.pitch}.f32`);
    const tgt = 440 * Math.pow(2, (q.midi - 69) / 12) * q.pitch;
    // (1) spectral peak: Hann over 8192 from the onset, zero-padded to 131072, parabolic interpolation on log power
    const p = frameSpectrum(x, Math.round(0.01 * SR), 8192, 131072);
    let bk = 2; for (let k = 2; k < p.length - 1; k++) if (p[k] > p[bk]) bk = k;
    const a = Math.log(p[bk - 1]), b = Math.log(p[bk]), c = Math.log(p[bk + 1]); const d = 0.5 * (a - c) / (a - 2 * b + c);
    const fpk = ((bk + d) * SR) / 131072;
    // (2) energy-weighted instantaneous frequency from an analytic signal approximation: period-by-period (zero crossings)
    const zc = []; let prev = -1;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) { const fr = i - 1 + -x[i - 1] / (x[i] - x[i - 1]); if (prev >= 0) { let e = 0; for (let k = Math.floor(prev); k < Math.floor(fr); k++) e += x[k] * x[k]; zc.push({ t: fr / SR, f: SR / (fr - prev), e }); } prev = fr; }
    const E = zc.reduce((s, z) => s + z.e, 0);
    const ew = zc.reduce((s, z) => s + Math.log2(z.f) * z.e, 0) / E;
    // (3) the first 30 ms after the onset (the attack the ear hears first), energy-weighted
    const z30 = zc.filter((z) => z.t < 0.04);
    const ew30 = z30.reduce((s, z) => s + Math.log2(z.f) * z.e, 0) / z30.reduce((s, z) => s + z.e, 0);
    // (4) start and end pitch of the glide
    rows.push({ midi: q.midi, pitch: q.pitch, peakC: 1200 * Math.log2(fpk / tgt), ewC: 1200 * (ew - Math.log2(tgt)), ew30C: 1200 * (ew30 - Math.log2(tgt)), startC: 1200 * Math.log2(zc[1].f / tgt), endC: 1200 * Math.log2(zc[zc.length - 3].f / tgt), durMs: 1000 * zc[zc.length - 1].t });
  }
  const span = (k) => [Math.min(...rows.map((r) => r[k])).toFixed(1), Math.max(...rows.map((r) => r[k])).toFixed(1)];
  res.bubbles = { n: rows.length, peakC: span('peakC'), ewC: span('ewC'), ew30C: span('ew30C'), startC: span('startC'), endC: span('endC'), durMs: span('durMs'), pitch1: rows.filter((r) => r.pitch === 1).map((r) => `${r.midi}:${r.peakC.toFixed(1)}/${r.ewC.toFixed(1)}`).join(' ') };
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(resolve(OUT, `misc_${what}.json`), JSON.stringify(res, null, 1));
