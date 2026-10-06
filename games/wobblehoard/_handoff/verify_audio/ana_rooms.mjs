import { rd, db, msFrames, spec, SR } from './lib.mjs';
const out = {};
for (const L of ['pad', 'mel']) {
  const a = rd(`rooms_${L}_none.f32`), b = rd(`rooms_${L}_dip.f32`);
  const fa = msFrames(a, 0.02, 0.01, 0, 40), fb = msFrames(b, 0.02, 0.01, 0, 40);
  const g = (t0, t1) => { let x = 0, y = 0; fa.forEach((q, i) => { if (q.t >= t0 && q.t < t1) { x += q.p; y += fb[i].p; } }); return +db(y / x).toFixed(2); };
  out[L] = { dip12: g(12.05, 12.85), after12_3s: g(15.5, 16.5), st_deep1: g(20.05, 20.24), st_shallow1: g(20.6, 20.95), st_deep2: g(21.08, 21.28), st_shallow2: g(22.5, 23.9), st_after: g(29, 31), outside: g(2, 11.9) };
  // attack: time to reach within 1 dB of the deep depth after 12.0 (2 ms frames)
  const ga = msFrames(a, 0.002, 0.001, 11.99, 12.2), gb = msFrames(b, 0.002, 0.001, 11.99, 12.2);
  const tgt = L === 'pad' ? -24 * 0.72 : -24;
  const hit = gb.findIndex((q, i) => q.t > 12 && db(q.p / ga[i].p) <= tgt + 1);
  out[L].attackMs = hit >= 0 ? +((gb[hit].t - 12) * 1000).toFixed(1) : null;
  // recovery after 12.9: back within 1 dB
  const ra = msFrames(a, 0.02, 0.01, 12.9, 18), rb = msFrames(b, 0.02, 0.01, 12.9, 18);
  const back = rb.findIndex((q, i) => db(q.p / ra[i].p) >= -1);
  out[L].recoveryS = back >= 0 ? +(rb[back].t - 12.9).toFixed(2) : null;
  // splatter: energy above 1.5 kHz (pad) in 10 ms Hann frames around the dip onset, dip vs none (max over 11.95..12.1)
  if (L === 'pad') {
    let mx = -999, base = -999;
    for (let t = 11.95; t < 12.1; t += 0.0025) {
      const s = Math.round(t * SR);
      const pa = spec(a, s, 480, 2048), pb = spec(b, s, 480, 2048);
      let ea = 0, eb = 0; for (let k = Math.round(1500 / (SR / 2048)); k < pa.length; k++) { ea += pa[k]; eb += pb[k]; }
      mx = Math.max(mx, db(eb)); base = Math.max(base, db(ea));
    }
    out[L].hf1500_maxDb_dip = +mx.toFixed(1); out[L].hf1500_maxDb_nodip = +base.toFixed(1);
    // pad's broadband level reference
    let e = 0; const p = spec(a, Math.round(11.9 * SR), 480, 2048); for (let k = 1; k < p.length; k++) e += p[k]; out[L].padTotalDb = +db(e).toFixed(1);
  }
}
console.log(JSON.stringify(out, null, 1));
