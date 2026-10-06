// Separation of effects over the music, my own placements through the REAL engine (its own room rule), plus dense play.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SR, rd, rj, pct, kWeight, separation, msFrames, HERE } from './lib.mjs';
import { spectrogramPng } from './wb/_harness/audioview/analysis.mjs';

const OUT = resolve(HERE, process.env.OUTDIR || 'out');
const runs = process.argv.slice(2).length ? process.argv.slice(2) : ['place22', 'place33', 'place44'];
const rows = [];
for (const nm of runs) {
  const mu = rd(`${nm}.music.f32`), fx = rd(`${nm}.fx.f32`);
  const muK = kWeight(mu), fxK = kWeight(fx);
  const ev = rj(`${nm}.events.json`);
  const Q = 128 / SR;
  for (const s of ev.spans) {
    const at = Math.ceil(s.at / Q - 1e-9) * Q + 0.004;
    const end = Math.min(at + s.len + 0.02, mu.length / SR - 0.1);
    const r = separation(fx, mu, fxK, muK, at, end);
    const pitch = null;
    // exposed dip: how long the music has already fallen by >= 8 dB (vs its 300 ms before the call) before the effect
    // itself is within 10 dB of its own peak (5 ms frames, K-weighted)
    const call = at - 0.004;
    const pre = msFrames(muK, 0.3, 0.3, call - 0.31, call - 0.01)[0];
    const mf = msFrames(muK, 0.005, 0.0025, call, call + 0.3), ff = msFrames(fxK, 0.005, 0.0025, call, Math.min(end, call + 0.6));
    const fpk = Math.max(...ff.map((q) => q.p));
    const tf = ff.find((q) => q.p >= fpk * 0.1);
    const td = pre && pre.p > 1e-9 ? mf.find((q) => q.p <= pre.p * 0.158) : null;
    const exposedMs = tf && td ? Math.max(0, (tf.t - td.t) * 1000) : null;
    rows.push({ run: nm, kind: s.kind, at: +at.toFixed(3), len: +s.len.toFixed(3), ...r, exposedMs, fxRiseMs: tf ? +((tf.t - call) * 1000).toFixed(1) : null, dipMs: td ? +((td.t - call) * 1000).toFixed(1) : null });
  }
}
const by = {};
for (const q of rows) (by[q.kind] ??= []).push(q);
const worst = (k) => rows.reduce((a, b) => (b[k] < a[k] ? b : a));
const out = {
  n: rows.length,
  worstInband: worst('inband'), worstK: worst('K'), worstA: worst('A'), worstK100: worst('K100'),
  under8inband: rows.filter((q) => q.inband < 8).length, under10K: rows.filter((q) => q.K < 10).length, under10A: rows.filter((q) => q.A < 10).length,
  under10K100: rows.filter((q) => q.K100 < 10).length,
  medians: { inband: pct(rows.map((q) => q.inband), 0.5), K: pct(rows.map((q) => q.K), 0.5), A: pct(rows.map((q) => q.A), 0.5) },
  perKind: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.length, minInband: +Math.min(...v.map((q) => q.inband)).toFixed(1), minK: +Math.min(...v.map((q) => q.K)).toFixed(1), minA: +Math.min(...v.map((q) => q.A)).toFixed(1), minK100: +Math.min(...v.map((q) => q.K100)).toFixed(1), exposedMsMax: Math.max(...v.map((q) => q.exposedMs ?? 0)), exposedMsMed: pct(v.map((q) => q.exposedMs ?? 0), 0.5) }])),
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(resolve(OUT, `place_${runs.join('_')}.json`), JSON.stringify({ out, rows }, null, 1));
