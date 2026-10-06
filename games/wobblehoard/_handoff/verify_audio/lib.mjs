// Verifier's own analysis helpers (Node). Independent of the probe's music_checks.mjs (time-domain K filter, own banding).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fft, hann } from './wb/_harness/audioview/analysis.mjs';

export const HERE = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/verify_audio3';
export const DATA = resolve(HERE, process.env.DATADIR || 'data');
export const SR = 48000;
export const rd = (name) => { const b = readFileSync(resolve(DATA, name)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };
export const rj = (name) => JSON.parse(readFileSync(resolve(DATA, name), 'utf8'));
export const db = (p) => 10 * Math.log10(Math.max(p, 1e-30));
export const dbA = (a) => 20 * Math.log10(Math.max(a, 1e-15));
export const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

/** BS.1770 K-weighting (48 kHz): stage 1 shelf + stage 2 RLB high-pass, direct form I. */
export function kWeight(x) {
  const st = [
    [[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]],
    [[1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621]],
  ];
  let y = Float64Array.from(x);
  for (const [b, a] of st) {
    const o = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v;
    }
    y = o;
  }
  return y;
}

/** Mean square over windows of `win` s every `hop` s: returns { t (centre), p }. */
export function msFrames(x, win, hop, from = 0, to = x.length / SR) {
  const W = Math.round(win * SR), H = Math.round(hop * SR);
  const c = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) c[i + 1] = c[i] + x[i] * x[i];
  const out = [];
  for (let s = Math.max(0, Math.round(from * SR)); s + W <= Math.min(x.length, Math.round(to * SR)); s += H) out.push({ t: (s + W / 2) / SR, p: (c[s + W] - c[s]) / W });
  return out;
}

/** A-weighting gain^2 at f (IEC 61672, normalised to 0 dB at 1 kHz). */
export function aW2(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return (ra * 1.2589254) ** 2;
}

/** Power spectrum of a Hann frame starting at sample s (length win, nfft). */
export function spec(x, s, win, nfft = win) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const w = hann(win);
  for (let i = 0; i < win; i++) { const v = x[s + i]; re[i] = (v === undefined ? 0 : v) * w[i]; }
  fft(re, im);
  const p = new Float64Array(nfft / 2 + 1);
  for (let k = 0; k <= nfft / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

/** 1/3-octave band edges (base 2) from 25 Hz to 16 kHz. */
export const BANDS = (() => { const b = []; for (let k = -16; k <= 13; k++) { const fc = 1000 * Math.pow(2, k / 3); b.push({ fc, lo: fc * Math.pow(2, -1 / 6), hi: fc * Math.pow(2, 1 / 6) }); } return b; })();
export function bandsOf(p, nfft) {
  const e = new Float64Array(BANDS.length);
  for (let k = 1; k < p.length; k++) {
    const f = (k * SR) / nfft;
    for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b].lo && f < BANDS[b].hi) { e[b] += p[k]; break; }
  }
  return e;
}

/**
 * Separation of an effect (fx stem) over the music stem in [t0, t1]:
 *  inband: 1/3-octave bands holding 70% of the effect's energy over frames within 20 dB of its loudest frame (2048 Hann, hop 256)
 *  K: K-weighted energy ratio over 20 ms frames (hop 5 ms) within 10 dB of the effect's loudest K frame
 *  A: the same frames, A-weighted (frequency domain)
 *  K100: K-weighted ratio over the first 100 ms after the onset (includes whatever the music did at the onset)
 */
export function separation(fx, mu, fxK, muK, t0, t1) {
  const N = 2048, H = 256;
  const s0 = Math.max(0, Math.round(t0 * SR) - N / 2), s1 = Math.min(fx.length - N, Math.round(t1 * SR));
  const F = [], Mm = [];
  for (let s = s0; s <= s1; s += H) { F.push(bandsOf(spec(fx, s, N), N)); Mm.push(bandsOf(spec(mu, s, N), N)); }
  const tot = F.map((e) => e.reduce((a, b) => a + b, 0));
  const mx = Math.max(...tot);
  const eF = new Float64Array(BANDS.length), eM = new Float64Array(BANDS.length);
  F.forEach((e, i) => { if (tot[i] >= mx * 0.01) for (let b = 0; b < BANDS.length; b++) { eF[b] += e[b]; eM[b] += Mm[i][b]; } });
  const order = [...BANDS.keys()].sort((a, b) => eF[b] - eF[a]);
  const all = eF.reduce((a, b) => a + b, 0);
  let acc = 0, sF = 0, sM = 0; const used = [];
  for (const b of order) { if (acc >= 0.7 * all) break; acc += eF[b]; sF += eF[b]; sM += eM[b]; used.push(Math.round(BANDS[b].fc)); }
  const inband = db(sF / Math.max(sM, 1e-30));
  // K-weighted 20 ms frames
  const kf = msFrames(fxK, 0.02, 0.005, t0 - 0.01, t1 + 0.01), km = msFrames(muK, 0.02, 0.005, t0 - 0.01, t1 + 0.01);
  const kmx = Math.max(...kf.map((q) => q.p));
  let a1 = 0, a2 = 0; const sel = [];
  kf.forEach((q, i) => { if (q.p >= kmx * 0.1) { a1 += q.p; a2 += km[i].p; sel.push(q.t); } });
  const K = db(a1 / Math.max(a2, 1e-30));
  // A-weighted on the same frames (960 samples, zero-padded 1024)
  let b1 = 0, b2 = 0;
  for (const tc of sel) {
    const s = Math.round(tc * SR) - 480;
    const pf = spec(fx, s, 960, 1024), pm = spec(mu, s, 960, 1024);
    for (let k = 1; k < pf.length; k++) { const w = aW2((k * SR) / 1024); b1 += pf[k] * w; b2 += pm[k] * w; }
  }
  const A = db(b1 / Math.max(b2, 1e-30));
  const k100f = msFrames(fxK, 0.1, 0.1, t0, t0 + 0.1)[0], k100m = msFrames(muK, 0.1, 0.1, t0, t0 + 0.1)[0];
  const K100 = k100f ? db(k100f.p / Math.max(k100m.p, 1e-30)) : NaN;
  return { inband, bands: used, K, A, K100 };
}

export function readRun(name, parts = ['mix', 'music', 'fx']) {
  const o = { meta: rj(`${name}.json`) };
  for (const p of parts) { try { o[p] = rd(`${name}.${p}.f32`); } catch { /* absent */ } }
  return o;
}
