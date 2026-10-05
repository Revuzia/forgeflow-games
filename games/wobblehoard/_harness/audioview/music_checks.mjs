// Round-3 gates: the generative music bed, the music + effects mix, and the interaction voices (bump, lift, toss, strand,
// strand snap). Called by probe_audio.mjs with the page and the check() collector. Everything is measured from rendered
// samples (OfflineAudioContext, the shipping code imported by view.js). Nobody has listened to any of it.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  metrics, dominant, frameSpectrum, avgSpectrum, spectralPeaks, spectrogramPng, wavBuffer, median,
} from './analysis.mjs';

const SR = 48000;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const FIELD_NAMES = ['HOME', 'LIFT', 'DUSK', 'GLOW'];

function decAll(r) {
  return r.channels.map((c) => { const b = Buffer.from(c, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); });
}
function dec(r) { const ch = decAll(r); return { ...r, x: ch[0], chans: ch }; }
const cut = (x, from, to) => x.slice(Math.max(0, Math.round(from * SR)), Math.min(x.length, Math.round(to * SR)));
const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
const peakOf = (a) => { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hzMidi = (f) => 69 + 12 * Math.log2(f / 440);
const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;

/** Cheap whole-signal stats for long renders (metrics() does one huge FFT; not needed here). */
function longStats(x) {
  let pk = 0, ss = 0, sum = 0, bad = 0, step = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v); if (a > pk) pk = a;
    ss += v * v; sum += v;
    if (i) { const d = Math.abs(v - x[i - 1]); if (d > step) step = d; }
  }
  const rms = Math.sqrt(ss / x.length);
  return { peak: pk, peakDb: dbOf(pk), rms, rmsDb: dbOf(rms), crestDb: dbOf(pk) - dbOf(rms), dc: sum / x.length, bad, maxStep: step };
}

/** Max sample step and max |second difference| inside [a, b] seconds. */
function stepIn(x, a, b) {
  const i0 = Math.max(2, Math.round(a * SR)), i1 = Math.min(x.length, Math.round(b * SR));
  let s1 = 0, s2 = 0;
  for (let i = i0; i < i1; i++) { s1 = Math.max(s1, Math.abs(x[i] - x[i - 1])); s2 = Math.max(s2, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2])); }
  return { step: s1, d2: s2 };
}

/** RMS envelope in windows of `w` seconds: [{ t (window centre), db }]. */
function envelope(x, w = 0.02) {
  const n = Math.round(w * SR), out = [];
  for (let s = 0; s + n <= x.length; s += n) { let q = 0; for (let i = s; i < s + n; i++) q += x[i] * x[i]; out.push({ t: (s + n / 2) / SR, db: dbOf(Math.sqrt(q / n)) }); }
  return out;
}

/* ───────── onsets and repetition ───────── */

/** A Gaussian-smoothed onset train (10 ms bins, sigma 20 ms) from onset times. */
function onsetTrain(times, secs, binS = 0.01, sigmaS = 0.02) {
  const n = Math.ceil(secs / binS), x = new Float64Array(n);
  const k = Math.ceil((3 * sigmaS) / binS);
  for (const t of times) {
    const c = t / binS;
    for (let j = Math.floor(c) - k; j <= Math.floor(c) + k; j++) if (j >= 0 && j < n) x[j] += Math.exp(-0.5 * ((j - c) * binS / sigmaS) ** 2);
  }
  return x;
}

/** Pearson correlation of the train with itself shifted by one lag (bins). */
function corrAt(x, L) {
  const n = x.length, m = n - L;
  let sa = 0, sb = 0;
  for (let i = 0; i < m; i++) { sa += x[i]; sb += x[i + L]; }
  sa /= m; sb /= m;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < m; i++) { const a = x[i] - sa, b = x[i + L] - sb; num += a * b; da += a * a; db += b * b; }
  return num / Math.sqrt(da * db + 1e-30);
}

/** Same as maxAutocorr over several trains at once (one per pitch class): a lag only correlates if the same pitch classes
 *  recur at the same times, i.e. exact repetition of the score, not just of the meter. */
function maxAutocorrMulti(trains, binS, lo, hi) {
  let best = -1, bestL = 0;
  const n = trains[0].length;
  const stats = trains.map(() => null);
  for (let L = Math.round(lo / binS); L <= Math.round(hi / binS) && L < n - 10; L++) {
    const m = n - L;
    let num = 0, da = 0, db = 0;
    for (const x of trains) {
      let sa = 0, sb = 0;
      for (let i = 0; i < m; i++) { sa += x[i]; sb += x[i + L]; }
      sa /= m; sb /= m;
      for (let i = 0; i < m; i++) { const a = x[i] - sa, b = x[i + L] - sb; num += a * b; da += a * a; db += b * b; }
    }
    const r = num / Math.sqrt(da * db + 1e-30);
    if (r > best) { best = r; bestL = L * binS; }
  }
  void stats;
  return { r: best, lagS: bestL };
}
const pcTrains = (events, secs) => { const out = []; for (let pc = 0; pc < 12; pc++) { const ts = events.filter((e) => pcOf(e.midi) === pc).map((e) => e.t); if (ts.length) out.push(onsetTrain(ts, secs)); } return out; };

/** Pearson correlation of the train with itself shifted by every lag in [lo, hi] seconds (minus `skip` [centre, halfwidth]
 *  lag bands); returns the worst lag. */
function maxAutocorr(x, binS, lo, hi, skip = []) {
  let best = -1, bestL = 0;
  const n = x.length;
  for (let L = Math.round(lo / binS); L <= Math.round(hi / binS) && L < n - 10; L++) {
    if (skip.some(([c, w]) => Math.abs(L * binS - c) <= w)) continue;
    let sa = 0, sb = 0; const m = n - L;
    for (let i = 0; i < m; i++) { sa += x[i]; sb += x[i + L]; }
    sa /= m; sb /= m;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < m; i++) { const a = x[i] - sa, b = x[i + L] - sb; num += a * b; da += a * a; db += b * b; }
    const r = num / Math.sqrt(da * db + 1e-30);
    if (r > best) { best = r; bestL = L * binS; }
  }
  return { r: best, lagS: bestL };
}

/** Onsets detected from the audio: positive spectral flux (400-4000 Hz, 1024-pt frames, 5.3 ms hop), adaptive threshold. */
function detectOnsets(x, { fLo = 400, fHi = 4000 } = {}) {
  const win = 1024, hop = 256, df = SR / win;
  const kLo = Math.floor(fLo / df), kHi = Math.ceil(fHi / df);
  const flux = [];
  let prev = null;
  for (let s = 0; s + win <= x.length; s += hop) {
    const p = frameSpectrum(x, s, win, win);
    const mag = new Float64Array(kHi - kLo);
    for (let k = kLo; k < kHi; k++) mag[k - kLo] = Math.log1p(1e4 * Math.sqrt(p[k]));
    let f = 0;
    if (prev) for (let k = 0; k < mag.length; k++) { const d = mag[k] - prev[k]; if (d > 0) f += d; }
    flux.push(f); prev = mag;
  }
  const out = [];
  const W = Math.round(1.0 * SR / hop);
  for (let i = 1; i < flux.length - 1; i++) {
    if (!(flux[i] >= flux[i - 1] && flux[i] > flux[i + 1])) continue;
    const seg = flux.slice(Math.max(0, i - W), Math.min(flux.length, i + W)).sort((a, b) => a - b);
    const med = seg[seg.length >> 1];
    const mad = seg.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[seg.length >> 1];
    if (flux[i] < med + 6 * mad + 2) continue;
    const t = (i * hop + win / 2) / SR;
    if (out.length && t - out[out.length - 1] < 0.06) continue;
    out.push(t);
  }
  return out;
}

/** Strongest spectral peak of x[t0..t1) inside [fLo, fHi] (Hann, zero padded to 32768, parabolic). */
function peakHz(x, t0, t1, fLo, fHi) {
  const n = Math.round((t1 - t0) * SR), nfft = 32768, df = SR / nfft;
  const p = frameSpectrum(x, Math.round(t0 * SR), n, nfft);
  let best = Math.floor(fLo / df);
  for (let k = Math.floor(fLo / df); k <= Math.floor(fHi / df); k++) if (p[k] > p[best]) best = k;
  const a = Math.log(p[best - 1] + 1e-30), b = Math.log(p[best] + 1e-30), c = Math.log(p[best + 1] + 1e-30);
  const d = 0.5 * (a - c) / (a - 2 * b + c);
  return (best + (Number.isFinite(d) ? d : 0)) * df;
}

/* ───────── 1/3-octave band energies ───────── */
const BANDS = (() => { const b = []; for (let i = -17; i <= 13; i++) { const fc = 1000 * Math.pow(2, i / 3); b.push({ fc, lo: fc / Math.pow(2, 1 / 6), hi: fc * Math.pow(2, 1 / 6) }); } return b; })();
function bandFrames(x, from, to, win = 2048) {
  const out = [];
  const df = SR / win;
  for (let s = Math.round(from * SR); s + win <= Math.min(x.length, Math.round(to * SR)); s += win / 2) {
    const p = frameSpectrum(x, s, win, win);
    const e = new Float64Array(BANDS.length);
    let tot = 0;
    BANDS.forEach((b, i) => { for (let k = Math.ceil(b.lo / df); k < Math.min(p.length, Math.ceil(b.hi / df)); k++) e[i] += p[k]; tot += e[i]; });
    out.push({ t: (s + win / 2) / SR, e, tot });
  }
  return out;
}


/* ───────── loudness weighting (round-3 fix): K-weighting (ITU-R BS.1770, 48 kHz biquads) and A-weighting (IEC 61672) ───────── */
const KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], KA1 = [1, -1.69065929318241, 0.73248077421585];
const KB2 = [1.0, -2.0, 1.0], KA2 = [1, -1.99004745483398, 0.99007225036621];
function biq2(b, a, f) {
  const w = 2 * Math.PI * f / SR, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b[0] + b[1] * c1 + b[2] * c2, ni = -(b[1] * s1 + b[2] * s2), dr = a[0] + a[1] * c1 + a[2] * c2, di = -(a[1] * s1 + a[2] * s2);
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}
const kW2 = (f) => biq2(KB1, KA1, f) * biq2(KB2, KA2, f);
const aW2 = (f) => { const f2 = f * f; const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)); return ra * ra * 1.2589; };
const LW = 960, LN = 1024, LH = 480;   // 20 ms Hann frames, 10 ms hop
const KT = new Float64Array(LN / 2 + 1), AT = new Float64Array(LN / 2 + 1);
for (let k = 1; k <= LN / 2; k++) { KT[k] = kW2(k * SR / LN); AT[k] = aW2(k * SR / LN); }
function weightedHops(x, from, to) {
  const out = [];
  for (let s = Math.max(0, Math.round(from * SR) - LW / 2); s + LW <= Math.min(x.length, Math.round(to * SR) + LW / 2); s += LH) {
    const p = frameSpectrum(x, s, LW, LN);
    let k = 0, a = 0; for (let q = 1; q < p.length; q++) { k += p[q] * KT[q]; a += p[q] * AT[q]; }
    out.push({ t: (s + LW / 2) / SR, k, a });
  }
  return out;
}
/** Loudness of an effect over the music, over the effect's own loudest 20 ms frames (within 10 dB of its loudest), K- and
 *  A-weighted: 10 log10(sum effect / sum music) over exactly those frames, in LU (K) / dB (A). */
function loudSep(fx, mu, at, end) {
  const F = weightedHops(fx, at - 0.02, end + 0.02), M = weightedHops(mu, at - 0.02, end + 0.02);
  const res = {};
  for (const w of ['k', 'a']) {
    const mx = Math.max(...F.map((q) => q[w]));
    let sf = 0, sm = 0;
    F.forEach((q, i) => { if (q[w] >= mx * 0.1) { sf += q[w]; sm += M[i][w]; } });
    res[w.toUpperCase()] = 10 * Math.log10(sf / Math.max(sm, 1e-30));
  }
  return res;
}
/** In-band separation exactly as section D defines it (1/3-octave bands holding 70% of the effect, frames within 20 dB). */
function sep70(fx, mu, at, end) {
  const F = bandFrames(fx, at, end), Mu = bandFrames(mu, at, end);
  const mx = Math.max(...F.map((q) => q.tot));
  const keep = F.map((q, i) => (q.tot >= mx * 0.01 ? i : -1)).filter((i) => i >= 0);
  const eF = new Float64Array(BANDS.length), eM = new Float64Array(BANDS.length);
  for (const i of keep) for (let b = 0; b < BANDS.length; b++) { eF[b] += F[i].e[b]; eM[b] += Mu[i].e[b]; }
  const order = [...BANDS.keys()].sort((a, b) => eF[b] - eF[a]);
  const tot = eF.reduce((a, b) => a + b, 0);
  let acc = 0, sF = 0, sM = 0; const used = [];
  for (const b of order) { if (acc >= 0.7 * tot) break; acc += eF[b]; sF += eF[b]; sM += eM[b]; used.push(Math.round(BANDS[b].fc)); }
  return { snr: 10 * Math.log10(sF / Math.max(sM, 1e-30)), bands: used };
}
/** mulberry32 (Node side, for the seeded event layouts). */
const mul32 = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Pitch of a short tone: spectral peak (Hann from the onset, zero-padded to 65536, parabolic) and the energy-weighted
 *  instantaneous frequency (positive zero crossings, each period weighted by its energy), both in cents from `tgt`. */
function tonePitch(x, tgt) {
  const p = frameSpectrum(x, Math.round(0.01 * SR), 8192, 65536);
  let bk = 2; for (let k = 2; k < p.length - 1; k++) if (p[k] > p[bk]) bk = k;
  const a = Math.log(p[bk - 1]), b = Math.log(p[bk]), c = Math.log(p[bk + 1]); const d = 0.5 * (a - c) / (a - 2 * b + c);
  const f = (bk + d) * SR / 65536;
  const zc = []; let prev = -1;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) { const fr = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]); if (prev >= 0) { let e = 0; for (let q = Math.floor(prev); q < Math.floor(fr); q++) e += x[q] * x[q]; zc.push([SR / (fr - prev), e]); } prev = fr; }
  const ew = zc.reduce((s2, [ff, e]) => s2 + Math.log2(ff) * e, 0) / zc.reduce((s2, [, e]) => s2 + e, 0);
  return { peakC: 1200 * Math.log2(f / tgt), ewC: 1200 * (ew - Math.log2(tgt)) };
}

export async function round3Checks(env) {
  const { page, check, OUT } = env;
  const ev = (fn, arg) => page.evaluate(([f, a]) => window.AV[f](a), [fn, arg]);
  const render = async (spec) => dec(await ev('renderVoice', spec));
  const K = await page.evaluate(() => window.AV.musicConsts);
  const LIM = await page.evaluate(() => window.AV.limiterConsts);
  const STR = await page.evaluate(() => window.AV.strandConsts);
  const FIELDS = K.FIELDS;
  const info = { music: {}, voices: {} };

  /* ═════════════════════════ A. the music bed: 90 s, two seeds ═════════════════════════ */
  const seeds = [1, 2];
  const renders = {};
  for (const seed of seeds) {
    const g = `music seed ${seed}`;
    const r = dec(await ev('renderMusic', { seed, secs: 90 }));
    renders[seed] = r;
    const x = r.x;
    const st = longStats(x);
    const live = r.log.filter((e) => !e.dropped);
    const mallets = live.filter((e) => e.kind === 'mallet'), bubbles = live.filter((e) => e.kind === 'bubble'), pads = live.filter((e) => e.kind === 'pad');
    check(g, '90 s render: finite (no NaN/Inf)', st.bad === 0, st.bad, '0');
    check(g, 'no clipping: peak <= -6 dBFS (below the soft-clip knee, the limiter never acts on the music)', st.peakDb <= -6, `${f1(st.peakDb)} dBFS`, '<= -6');
    check(g, 'long-term RMS (whole 90 s, before the master gain) in -30..-24 dBFS', st.rmsDb >= -30 && st.rmsDb <= -24, `${f1(st.rmsDb)} dBFS`, '-30..-24');
    check(g, 'crest factor 8..20 dB (a gentle bed, neither a drone nor spiky)', st.crestDb >= 8 && st.crestDb <= 20, `${f1(st.crestDb)} dB`, '8..20');
    check(g, '|DC| < 0.01 and max sample step < 0.05 (no click anywhere in 90 s)', Math.abs(st.dc) < 0.01 && st.maxStep < 0.05, `DC ${st.dc.toExponential(1)}, step ${f3(st.maxStep)}`, '< 0.01, < 0.05');
    const sp = avgSpectrum(x, SR, { win: 8192 });
    let eT = 0, e25 = 0, e6 = 0;
    for (let k = 1; k < sp.P.length; k++) { const f = k * sp.df; eT += sp.P[k]; if (f < 2500) e25 += sp.P[k]; if (f > 6000) e6 += sp.P[k]; }
    check(g, 'spectral balance: >= 90% of the energy below 2.5 kHz', e25 / eT >= 0.9, `${f2((e25 / eT) * 100)}%`, '>= 90%');
    check(g, 'spectral balance: energy above 6 kHz < 5%', e6 / eT < 0.05, `${f3((e6 / eT) * 100)}%`, '< 5%');
    // 10 s window RMS: steady, no section louder than the rest
    const w10 = []; for (let s = 5; s + 10 <= 90; s += 10) w10.push(dbOf(rmsOf(cut(x, s, s + 10))));
    check(g, 'level is steady: every 10 s window (after the fade-in) within +/-3 dB of the long-term RMS', w10.every((v) => Math.abs(v - st.rmsDb) <= 3), w10.map(f1).join(' '), '+/-3 dB');
    const dens = mallets.length / 90;
    check(g, 'sparse: 0.2..0.8 mallet notes per second (and some bubble grace notes)', dens >= 0.2 && dens <= 0.8 && bubbles.length >= 1, `${f2(dens)} /s (${mallets.length} notes, ${bubbles.length} bubbles, ${pads.length} pads, ${r.log.length - live.length} dropped)`, '0.2..0.8 /s');

    // pitch set (from the score): every note in its field's declared set, mallets in register, pads exact
    const bad = [];
    for (const e of live) {
      const F = FIELDS[e.field];
      if (e.kind === 'pad') { if (JSON.stringify(e.midi) !== JSON.stringify(F.pad)) bad.push(`pad ${e.midi} in ${F.name}`); continue; }
      const m = e.midi[0];
      if (!F.mel.includes(pcOf(m))) bad.push(`${e.kind} ${m} (pc ${pcOf(m)}) not in ${F.name}`);
      if (e.kind === 'mallet' && (m < K.MEL_LO || m > K.MEL_HI)) bad.push(`mallet ${m} out of register`);
    }
    // ... and the sounding field at each note's time is the one it was written for (graces/trails never cross a field change)
    const fieldAt = (t) => { let f = pads[0]?.field ?? 0; for (const p of pads) if (p.t <= t + 1e-6) f = p.field; return f; };
    for (const e of live) if (e.kind !== 'pad' && fieldAt(e.t) !== e.field) bad.push(`${e.kind} at ${f2(e.t)} written for ${FIELD_NAMES[e.field]} sounds over ${FIELD_NAMES[fieldAt(e.t)]}`);
    check(g, 'every note is in the declared pitch set of its harmonic field (score)', bad.length === 0, bad.length ? bad.slice(0, 3).join('; ') : `${live.length} events OK`, '0 outside');

    // pitch set (from the AUDIO): isolated mallet notes, strongest peak in the mallet register 20-220 ms after onset
    const iso = mallets.filter((e) => !mallets.some((o) => o !== e && o.t > e.t - 0.6 && o.t < e.t + 0.3) && e.t + 0.25 < 90);
    let inSet = 0, same = 0, worstC = 0;
    const offs = [];
    for (const e of iso) {
      const f = peakHz(x, e.t + 0.02, e.t + 0.22, midiHz(K.MEL_LO) * 0.94, midiHz(K.MEL_HI) * 1.06);
      const m = hzMidi(f), mr = Math.round(m), cents = Math.abs(m - mr) * 100;
      const ok = cents <= 30 && FIELDS[e.field].mel.includes(pcOf(mr));
      if (ok) inSet++; else offs.push(`${f1(f)} Hz @${f2(e.t)}`);
      if (mr === e.midi[0]) same++;
      worstC = Math.max(worstC, cents);
    }
    check(g, 'AUDIO: every isolated mallet note sounds a pitch of its field (strongest peak within 30 cents of a set note)', iso.length >= 8 && inSet === iso.length, `${inSet}/${iso.length} in set, ${same}/${iso.length} = the scored note, worst ${f1(worstC)} cents${offs.length ? '; off: ' + offs.slice(0, 3).join(', ') : ''}`, 'all, >= 8 notes');
    // the pad: strongest three peaks 250-800 Hz in the middle of each field (and away from mallet notes) are pad pitch classes
    const padBad = [];
    for (let i = 0; i < pads.length; i++) {
      const a0 = pads[i].t + 5, b = Math.min((pads[i + 1]?.t ?? 90) - 2, 90);
      // the quietest 2 s stretch (fewest mallet notes ringing) in the middle of the field
      let a = a0, fewest = Infinity;
      for (let u = a0; u + 2 <= b; u += 0.25) { const n = mallets.filter((m) => m.t > u - 2.4 && m.t < u + 2).length; if (n < fewest) { fewest = n; a = u; } }
      if (b - a0 < 2) continue;
      const seg = cut(x, a, a + 2);
      const s2 = avgSpectrum(seg, SR, { win: 16384 });
      const pk = spectralPeaks(s2.P, s2.df, { fLo: 250, fHi: 800, relDb: -40, promDb: 6 }).sort((p, q) => q.p - p.p).slice(0, 3);
      const pcs = FIELDS[pads[i].field].pad.map(pcOf);
      for (const q of pk) { const m = hzMidi(q.f); if (Math.abs(m - Math.round(m)) > 0.3 || !pcs.includes(pcOf(Math.round(m)))) padBad.push(`${f1(q.f)} Hz in ${FIELD_NAMES[pads[i].field]}`); }
    }
    check(g, 'AUDIO: the three strongest peaks 250-800 Hz mid-field are the pad\'s pitch classes', padBad.length === 0, padBad.length ? padBad.join(', ') : `${pads.length} fields OK`, 'all');

    // no exact repetition: the onset pattern (score) and the detected onsets (audio) have no period shorter than 60 s
    const onT = live.filter((e) => e.kind !== 'pad').map((e) => e.t);
    const train = onsetTrain(onT, 90);
    const ac = maxAutocorr(train, 0.01, 0.5, 60);
    const pcEv = live.filter((e) => e.kind !== 'pad').map((e) => ({ t: e.t, midi: e.midi[0] }));
    const acP = maxAutocorrMulti(pcTrains(pcEv, 90), 0.01, 0.5, 60);
    const det = detectOnsets(x);
    const hit = mallets.filter((e) => det.some((t) => Math.abs(t - e.t) <= 0.035)).length;
    // the echo repeats every note once at ECHO lag and once at 2x (by design, not a loop): those two lag bands (+/-40 ms)
    // are left out of the AUDIO autocorrelation only; the score autocorrelation covers every lag
    const echo = K.ECHO_S;
    const acA = maxAutocorr(onsetTrain(det, 90), 0.01, 0.5, 60, [[echo, 0.04], [2 * echo, 0.04]]);
    const acEcho = corrAt(onsetTrain(det, 90), Math.round(echo / 0.01));
    check(g, 'onset detector agrees with the score (>= 90% of mallet onsets found in the audio within 35 ms)', hit / mallets.length >= 0.9, `${hit}/${mallets.length} found; ${det.length} detected onsets (echoes and bubbles add some)`, '>= 90%');
    // thresholds: onset-only < 0.7 (the bar grid alone gives 0.27-0.56 over 26 measured seeds at long lags, a loop >= 0.9);
    // pitch-aware < 0.5 (0.10-0.21 measured): that one is the "exact repetition" test, the onset-only one guards the rhythm
    check(g, 'no exact repetition: onset autocorrelation (Pearson, every lag 0.5..60 s) stays < 0.7 (score onsets; audio onsets except the echo lag)', ac.r < 0.7 && acA.r < 0.7, `score max r ${f3(ac.r)} at ${f2(ac.lagS)} s; audio max r ${f3(acA.r)} at ${f2(acA.lagS)} s (at the echo lag ${f2(echo)} s: r ${f3(acEcho)})`, '< 0.7');
    check(g, 'no exact repetition of the score: pitch-aware onset autocorrelation (same pitch class at the same time) never reaches 0.5', acP.r < 0.5, `max r ${f3(acP.r)} at ${f2(acP.lagS)} s`, '< 0.5');
    // ... and the same test does catch a loop: the first 15 s of this very score repeated six times
    const loopT = []; for (let k = 0; k < 6; k++) for (const t of onT) if (t < 15) loopT.push(t + 15 * k);
    const loopTrain = onsetTrain(loopT, 90);
    const acL = maxAutocorr(loopTrain, 0.01, 0.5, 60);
    const r15 = corrAt(loopTrain, 1500);
    const loopPc = []; for (let k = 0; k < 6; k++) for (const e of pcEv) if (e.t < 15) loopPc.push({ t: e.t + 15 * k, midi: e.midi });
    const acLP = maxAutocorrMulti(pcTrains(loopPc, 90), 0.01, 14.9, 15.1);
    check(g, 'control: both tests flag a 15 s loop of this score (r >= 0.9 at 15 s, the onset max at a multiple of 15 s)', r15 >= 0.9 && acLP.r >= 0.9 && acL.r >= 0.9 && Math.abs(acL.lagS / 15 - Math.round(acL.lagS / 15)) < 0.01, `onsets r(15 s) ${f3(r15)}, max ${f3(acL.r)} at ${f2(acL.lagS)} s; pitch-aware r(15 s) ${f3(acLP.r)}`, '>= 0.9');
    check(g, `live notes never exceed ${K.MAX_LIVE_NOTES} (pads + mallets + bubbles, by node lifetime)`, r.stats.every((s) => s.maxLive <= K.MAX_LIVE_NOTES), `max ${Math.max(...r.stats.map((s) => s.maxLive))}`, `<= ${K.MAX_LIVE_NOTES}`);
    info.music[`seed${seed}`] = { ...st, below25: e25 / eT, above6k: e6 / eT, notesPerS: dens, mallets: mallets.length, bubbles: bubbles.length, pads: pads.length, dropped: r.log.length - live.length, fieldLog: r.fieldLog, acScore: ac, acPitch: acP, acAudio: acA, acEcho, acLoop: acL, r15, onsetRecall: hit / mallets.length, detected: det.length, isolated: iso.length, isoInSet: inSet, isoSame: same, w10, missed: mallets.filter((e) => !det.some((t) => Math.abs(t - e.t) <= 0.035)).map((e) => ({ t: e.t, midi: e.midi[0], vel: e.vel })) };
    writeFileSync(resolve(OUT, `music_seed${seed}_90s.wav`), wavBuffer(x, SR));
    const marks = r.log.filter((e) => e.kind === 'pad' && e.t < 30).map((e) => ({ t: e.t, label: FIELD_NAMES[e.field] }));
    writeFileSync(resolve(OUT, `music_seed${seed}_30s.png`), spectrogramPng(cut(x, 0, 30), SR, { title: `MUSIC SEED ${seed}, FIRST 30 S`, win: 4096, width: 1400, fMin: 40, fMax: 12000, marks }));
  }
  {
    // round-3 fix: the music's bubble graces/trails are tuned (music.ts musicBubble: a 1% settle, started 0.6 of it below
    // the note). The first version glided +5% from the note: +33..+38 cents sharp energy-weighted, +59..+80 at the peak.
    const g = 'music bubbles in tune';
    const midis = [81, 83, 85, 86, 88, 90, 91, 93, 95, 97, 98];
    const rows = [];
    for (const pitch of [1, 0.9, 1.12]) {
      const rs = await page.evaluate((q) => window.AV.renderMusicBubbles(q), { midis, pitch });
      for (const q of rs) { const x = decAll(q)[0]; rows.push({ pitch, midi: q.midi, ...tonePitch(x, midiHz(q.midi) * pitch) }); }
    }
    const ew = rows.map((q) => q.ewC), pk = rows.map((q) => q.peakC);
    const span = (a) => `${f1(Math.min(...a))}..${f1(Math.max(...a))}`;
    check(g, 'every bubble grace/trail note (A5..D7, score pitch 0.9 / 1 / 1.12) sounds its scored note: energy-weighted pitch within +/-10 cents', ew.every((v) => Math.abs(v) <= 10), `${span(ew)} cents (${rows.length} notes)`, '+/-10 cents');
    check(g, '... and the spectral peak within +/-10 cents too', pk.every((v) => Math.abs(v) <= 10), `${span(pk)} cents`, '+/-10 cents');
    info.music.bubbleCents = { energyWeighted: [Math.min(...ew), Math.max(...ew)], spectralPeak: [Math.min(...pk), Math.max(...pk)] };
  }
  {
    const g = 'music determinism';
    const a = renders[1].x, b = renders[2].x;
    let s = 0, e = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - b[i]) ** 2; e += a[i] * a[i]; }
    const onA = renders[1].log.filter((q) => q.kind === 'mallet' && !q.dropped), onB = renders[2].log.filter((q) => q.kind === 'mallet' && !q.dropped);
    // (both seeds share the bar grid, so onset TIMES coincide often by meter alone; a shared note is the same time AND pitch)
    const shared = onA.filter((a) => onB.some((b) => Math.abs(b.t - a.t) < 0.02 && b.midi[0] === a.midi[0])).length;
    check(g, 'two seeds give different music (norm. difference >= 0.5, < 20% of notes shared in time and pitch)', Math.sqrt(s / e) >= 0.5 && shared / onA.length < 0.2, `diff ${f2(Math.sqrt(s / e))}, shared notes ${shared}/${onA.length}`, '>= 0.5, < 20%');
    const r1 = dec(await ev('renderMusic', { seed: 1, secs: 30 }));
    const rc = dec(await ev('renderMusic', { seed: 1, secs: 30, chunk: 0.1 }));
    let d1 = 0, d2 = 0; for (let i = 0; i < r1.x.length; i++) { d1 = Math.max(d1, Math.abs(r1.x[i] - renders[1].x[i])); d2 = Math.max(d2, Math.abs(r1.x[i] - rc.x[i])); }
    check(g, 'same seed twice: identical (max diff <= 1e-4)', d1 <= 1e-4, d1.toExponential(1), '<= 1e-4');
    check(g, 'live-like scheduling (suspend every 0.1 s, advance(now + 0.4 s)) = the one-go render (max diff <= 1e-4)', d2 <= 1e-4, `${d2.toExponential(1)} (${rc.tickMs.length} ticks, mean ${f3(rc.tickMs.reduce((p, q) => p + q, 0) / rc.tickMs.length)} ms)`, '<= 1e-4');
  }

  /* ═════════════════════════ B. behaviour: fade-in, stop, pause, resume, duck, volume ═════════════════════════ */
  {
    const g = 'music start/stop/pause';
    const S = { start: 0.5, stop: 9, fade: K.FADE_OUT_S }, P = { start: 11, stop: 19, fade: K.PAUSE_FADE_S }, R = { start: 19.6 };
    const r = dec(await ev('renderMusic', { seed: 4, secs: 30, sessions: [S, P, R] }));
    const x = r.x;
    const pre = peakOf(cut(x, 0, 0.5));
    check(g, 'nothing before the session starts (exact silence)', pre === 0, pre.toExponential(1), '0');
    // fade-in: 200 ms RMS envelope reaches within 3 dB of the session's steady level 2..3.5 s after the start
    const steady = dbOf(rmsOf(cut(x, 4.5, 8.5)));
    const envS = envelope(cut(x, S.start, S.start + 5), 0.2);
    const reach = envS.find((p) => p.db >= steady - 3);
    const env1 = envS.reduce((a, p) => (Math.abs(p.t - 1) < Math.abs(a.t - 1) ? p : a));
    check(g, 'fade-in: within 3 dB of the steady level 2.0..3.5 s after start, and still >= 6 dB under it at 1 s', reach && reach.t >= 2.0 && reach.t <= 3.5 && env1 && env1.db <= steady - 6, `reached at ${reach ? f2(reach.t) : 'never'} s; at 1 s ${env1 ? f1(env1.db - steady) : '?'} dB`, '2.0..3.5 s');
    // stop: silent once the fade is over; pause (short fade): silent after it
    const after1 = peakOf(cut(x, S.stop + S.fade + 0.03, P.start));
    const after2 = peakOf(cut(x, P.stop + P.fade + 0.03, R.start));
    check(g, `stop (fade ${K.FADE_OUT_S} s) and pause (fade ${K.PAUSE_FADE_S} s): exact silence after the fade until the next start`, after1 < 1e-5 && after2 < 1e-5, `${dbOf(after1).toFixed(0)} / ${dbOf(after2).toFixed(0)} dBFS`, '< -100 dBFS');
    // clicks. A start cannot click if the signal is still essentially silent 10 ms after it (the fade-in curve starts at 0 with
    // zero slope); a stop cannot click if, over the whole fade, no step and no 2nd difference exceeds the SAME music without the
    // fade (one-session renders of the same seed, stopped and not stopped).
    const startD2 = Math.max(...[S.start, P.start, R.start].map((t0) => stepIn(x, t0 - 0.01, t0 + 0.01).d2));
    const startPk = Math.max(...[S.start, P.start, R.start].map((t0) => peakOf(cut(x, t0, t0 + 0.01)) - peakOf(cut(x, t0 - 0.2, t0 - 0.05))));
    const one = async (o) => dec(await ev('renderMusic', { seed: 9, secs: 12, sessions: [{ start: 0.5, ...o }] })).x;
    const ref = await one({});
    const stops = [];
    for (const fade of [K.FADE_OUT_S, K.PAUSE_FADE_S]) {
      const y = await one({ stop: 8, fade });
      const a = stepIn(y, 7.98, 8 + fade + 0.05), b = stepIn(ref, 7.98, 8 + fade + 0.05);
      stops.push({ fade, step: a.step, d2: a.d2, refStep: b.step, refD2: b.d2, after: peakOf(cut(y, 8 + fade + 0.02, 12)) });
    }
    check(g, 'starts never click: within +/-10 ms of each start the 2nd difference stays < 1e-4 and the level adds < 0.002', startD2 < 1e-4 && startPk < 0.002, `d2 ${startD2.toExponential(1)}, level step ${startPk.toExponential(1)}`, '< 1e-4, < 0.002');
    check(g, 'stop and pause fades never click: max step and 2nd difference during the fade <= the same music without the fade', stops.every((q) => q.step <= q.refStep + 1e-6 && q.d2 <= q.refD2 + 1e-6 && q.after < 1e-5), stops.map((q) => `fade ${q.fade}: step ${f3(q.step)}/${f3(q.refStep)}, d2 ${q.d2.toExponential(1)}/${q.refD2.toExponential(1)}, after ${dbOf(q.after).toFixed(0)} dBFS`).join('; '), '<= unfaded, silent after');
    const fadeEnv = envelope(cut(x, P.stop - 0.05, P.stop + 0.25), 0.01);
    const drops = fadeEnv.map((p, i) => (i && p.db > -60 ? fadeEnv[i - 1].db - p.db : -Infinity)).filter(Number.isFinite);
    check(g, 'the pause fade is smooth (10 ms RMS never drops more than 12 dB per window while above -60 dBFS)', drops.every((d) => d <= 12), `largest drop ${f1(Math.max(...drops))} dB / 10 ms (windows above -60 dBFS)`, '<= 12');
    const resumed = dbOf(rmsOf(cut(x, R.start + 4, R.start + 9)));
    check(g, 'resume: plays again at the normal level (within 3 dB) after its own fade-in', Math.abs(resumed - steady) <= 3, `${f1(resumed)} vs ${f1(steady)} dBFS`, '+/-3 dB');
    info.music.startStop = { steady, reach: reach && reach.t, at1s: env1.db - steady, startD2, startPk, stops };
    writeFileSync(resolve(OUT, 'music_startstop.png'), spectrogramPng(x, SR, { title: 'MUSIC: START 0.5, STOP 9 (1.4 S FADE), START 11, PAUSE 19 (0.15 S), RESUME 19.6', win: 4096, width: 1400, fMin: 40, fMax: 12000, marks: [{ t: S.start, label: 'START' }, { t: S.stop, label: 'STOP' }, { t: P.start, label: 'START' }, { t: P.stop, label: 'PAUSE' }, { t: R.start, label: 'RESUME' }] }));
  }
  {
    const g = 'music duck';
    const plain = dec(await ev('renderMusic', { seed: 3, secs: 34 }));
    const ducked = dec(await ev('renderMusic', { seed: 3, secs: 34, ducks: [{ from: 20, until: 26 }] }));
    const ea = envelope(plain.x, 0.02), eb = envelope(ducked.x, 0.02);
    const gdb = eb.map((p, i) => ({ t: p.t, db: p.db - ea[i].db }));
    const inD = gdb.filter((p) => p.t > 21 && p.t < 25.9).map((p) => p.db);
    const depth = median(inD);
    const att = gdb.find((p) => p.t > 20 && p.db <= K.DUCK_DB + 1);
    const rec = gdb.find((p) => p.t > 26 && p.db >= -1);
    const before = gdb.filter((p) => p.t > 5 && p.t < 19.9).map((p) => Math.abs(p.db));
    const smooth = Math.max(...gdb.slice(1).map((p, i) => Math.abs(p.db - gdb[i].db)).filter((v, i) => gdb[i].t > 19.5 && gdb[i].t < 29));
    check(g, `depth: ${K.DUCK_DB} dB (+/-1) while held`, Math.abs(depth - K.DUCK_DB) <= 1, `${f2(depth)} dB (median 21-25.9 s)`, `${K.DUCK_DB} +/- 1`);
    check(g, 'attack: within 1 dB of full depth <= 0.5 s after the duck starts', att && att.t - 20 <= 0.5, att ? `${f2(att.t - 20)} s` : 'never', '<= 0.5 s');
    check(g, 'recovery: back within 1 dB 0.5..1.5 s after the hold ends (smooth, not instant)', rec && rec.t - 26 >= 0.5 && rec.t - 26 <= 1.5, rec ? `${f2(rec.t - 26)} s` : 'never', '0.5..1.5 s');
    check(g, 'untouched outside the duck (|gain| < 0.05 dB) and smooth inside (<= 1 dB change per 20 ms)', Math.max(...before) < 0.05 && smooth <= 1, `outside ${f3(Math.max(...before))} dB, largest step ${f2(smooth)} dB / 20 ms`, '< 0.05, <= 1');
    const sd = stepIn(ducked.x, 19.9, 28);
    check(g, 'no click at duck or recovery (max step <= the undducked render\'s in the same span)', sd.step <= stepIn(plain.x, 19.9, 28).step * 1.05 + 1e-4, `${f3(sd.step)} vs ${f3(stepIn(plain.x, 19.9, 28).step)}`, '<=');
    info.music.duck = { depth, attackS: att && att.t - 20, recoveryS: rec && rec.t - 26, smooth };
    writeFileSync(resolve(OUT, 'music_duck.png'), spectrogramPng(cut(ducked.x, 16, 30), SR, { title: 'MUSIC DUCK -9 DB, 20-26 S (SHOWN 16-30 S)', win: 4096, width: 1100, fMin: 40, fMax: 12000, marks: [{ t: 4, label: 'DUCK' }, { t: 10, label: 'RELEASE' }] }));
  }
  {
    const g = 'music volume/master/mute';
    const base = dec(await ev('renderMusic', { seed: 5, secs: 12 }));
    const b0 = dbOf(rmsOf(cut(base.x, 4, 12)));
    const lvl = async (o) => dbOf(rmsOf(cut(dec(await ev('renderMusic', { seed: 5, secs: 12, ...o })).x, 4, 12)));
    const m05 = await lvl({ master: 0.5 }), mu = peakOf(dec(await ev('renderMusic', { seed: 5, secs: 12, muted: true })).x);
    const v1 = await lvl({ music: 1 }), v225 = await lvl({ music: 0.225 }), v0 = peakOf(dec(await ev('renderMusic', { seed: 5, secs: 12, music: 0 })).x);
    check(g, 'master 0.5 = -12 dB on the music too; muted = exact silence', Math.abs(m05 - b0 + 12.04) < 0.5 && mu === 0, `${f2(m05 - b0)} dB; muted peak ${mu}`, '-12.04 +/- 0.5, 0');
    check(g, 'music volume taper: 1 = +6 dB, 0.225 = -12 dB, 0 = silence (relative to the default 0.45)', Math.abs(v1 - b0 - 6) < 0.5 && Math.abs(v225 - b0 + 12.04) < 0.5 && v0 === 0, `${f2(v1 - b0)} / ${f2(v225 - b0)} dB, music 0 peak ${v0}`, '+6, -12, 0');
  }

  /* ═════════════════════════ C. composition rules over a long run, and 10 minutes scheduled like the live engine ═════════════════════════ */
  {
    const g = 'music composition rules';
    const c = await page.evaluate(() => window.AV.composeOnly(11, 3000));
    const fl = c.fieldLog;
    const badT = [], badL = [];
    for (let i = 1; i < fl.length; i++) if (!K.FIELD_NEXT[fl[i - 1].field].some(([to]) => to === fl[i].field)) badT.push(`${fl[i - 1].field}->${fl[i].field}`);
    for (const f of fl) if (![8, 12, 16].includes(f.bars)) badL.push(f.bars);
    const visits = [0, 0, 0, 0]; for (const f of fl) visits[f.field]++;
    check(g, '3000 bars: fields drift only along the declared edges, each held 8, 12 or 16 bars; all four visited', badT.length === 0 && badL.length === 0 && visits.every((v) => v > 5), `${fl.length} fields, visits ${visits.join('/')}${badT.length ? ', bad ' + badT.slice(0, 3) : ''}`, 'all OK');
    let badN = 0, outBar = 0, n = 0;
    for (const b of c.bars) for (const q of b.notes) { n++; if (!FIELDS[b.field].mel.includes(pcOf(q.midi))) badN++; if (q.at < 0 || q.at >= K.BAR_S) outBar++; }
    check(g, '3000 bars: every planned note in its field\'s set, and inside its own bar (no grace or trail crosses a bar line)', badN === 0 && outBar === 0, `${n} notes, ${badN} outside the set, ${outBar} outside their bar`, '0, 0');
    // the repetition tests on 24 more seeds (score only: 90 s each), so the guarantee does not rest on two renders
    let worstO = { r: -1 }, worstP = { r: -1 };
    for (let sd = 101; sd <= 124; sd++) {
      const cc = await page.evaluate((q) => window.AV.composeOnly(q, 26), sd);
      const evs = [];
      cc.bars.forEach((b, i) => { for (const q of b.notes) { const t = 0.05 + i * K.BAR_S + q.at; if (t >= 0.05 + K.FIRST_NOTE_S && t < 90) evs.push({ t, midi: q.midi }); } });
      const a1 = maxAutocorr(onsetTrain(evs.map((q) => q.t), 90), 0.01, 0.5, 60), a2 = maxAutocorrMulti(pcTrains(evs, 90), 0.01, 0.5, 60);
      if (a1.r > worstO.r) worstO = { ...a1, seed: sd };
      if (a2.r > worstP.r) worstP = { ...a2, seed: sd };
    }
    check(g, '24 more seeds (90 s scores): onset autocorrelation < 0.7 and pitch-aware < 0.5 at every lag 0.5..60 s', worstO.r < 0.7 && worstP.r < 0.5, `worst onset r ${f3(worstO.r)} (seed ${worstO.seed} at ${f2(worstO.lagS)} s), worst pitch-aware r ${f3(worstP.r)} (seed ${worstP.seed})`, '< 0.7, < 0.5');
    info.music.seedSweep = { worstO, worstP };
  }
  {
    const g = 'music 10 min (live-like)';
    const s = await ev('simulateMusic', { seed: 7, secs: 600, sr: 22050, stepS: 0.1 });
    info.music.sim = s;
    check(g, `600 s scheduled every 0.1 s (advance(now + ${K.LOOKAHEAD_S} s), like the engine's ${K.TICK_MS} ms tick): scheduler cost per tick mean < 0.3 ms, p99 < 1.5 ms`, s.tickMeanMs < 0.3 && s.tickP99Ms < 1.5, `mean ${f3(s.tickMeanMs)} ms, p99 ${f3(s.tickP99Ms)} ms, max ${f2(s.tickMaxMs)} ms over ${s.ticks} ticks`, '< 0.3, < 1.5');
    check(g, `live notes <= ${K.MAX_LIVE_NOTES} for the whole 10 minutes`, s.maxLiveNotes <= K.MAX_LIVE_NOTES && s.statsMaxLive <= K.MAX_LIVE_NOTES, `max ${s.maxLiveNotes} (bed's own count ${s.statsMaxLive}); ${s.stats.notes} notes, ${s.stats.bubbles} bubbles, ${s.stats.pads} pads, ${s.stats.dropped} dropped by the cap`, `<= ${K.MAX_LIVE_NOTES}`);
    check(g, 'live audio nodes bounded (< 160 at any tick) and back to 0 after stop + free', s.maxLiveNodes < 160 && s.endLiveNodes === 0, `max ${s.maxLiveNodes}, mean ${f1(s.meanLiveNodes)}, after ${s.endLiveNodes}`, '< 160, 0');
    check(g, 'finite, unclipped, in level (RMS over 10 min incl. the stop: -31..-24 dBFS)', s.bad === 0 && s.peak < 0.5 && s.rmsDb > -31 && s.rmsDb < -24, `${s.bad} bad, peak ${f1(dbOf(s.peak))} dBFS, RMS ${f1(s.rmsDb)} dBFS, max step ${f3(s.maxStep)}`, 'ok');
    const ok = s.fieldLog.slice(1).every((f, i) => K.FIELD_NEXT[s.fieldLog[i].field].some(([to]) => to === f.field));
    check(g, 'fields drift every 8-16 bars along the declared edges (all four heard in 10 min)', ok && new Set(s.fieldLog.map((f) => f.field)).size === 4, s.fieldLog.map((f) => FIELD_NAMES[f.field][0] + f.bars).join(' '), 'ok');
  }

  /* ═════════════════════════ D. mixed render: music + a typical play sequence ═════════════════════════ */
  {
    const g = 'mix (music + effects)';
    const EV = [
      { at: 4.0, voice: 'poke', params: { intensity: 0.6 } },
      { at: 5.0, voice: 'squish', script: 'prl' },
      { at: 8.0, voice: 'release', params: { compression: 0.7 } },
      { at: 9.0, voice: 'poke', params: { intensity: 0.4 } },
      { at: 9.6, voice: 'pop', params: { size: 0.5 } },
      { at: 10.4, voice: 'land', params: { intensity: 0.6 } },
      { at: 11.5, voice: 'bump', params: { intensity: 0.5 } },
      { at: 12.3, voice: 'lift', params: {} },
      { at: 13.0, voice: 'toss', params: { speed: 0.6 } },
      { at: 14.2, voice: 'land', params: { intensity: 0.5 } },
      { at: 15.0, voice: 'strand', script: 'stretch' },
      { at: 17.0, voice: 'poke', params: { intensity: 0.7 } },
      { at: 17.5, voice: 'release', params: { compression: 0.5 } },
    ];
    const res = [];
    for (const seed of [1, 2, 6]) {
      const mus = dec(await ev('renderMix', { seed, secs: 20, music: true, effects: false, events: EV }));
      const fx = dec(await ev('renderMix', { seed, secs: 20, music: false, effects: true, events: EV }));
      const mix = dec(await ev('renderMix', { seed, secs: 20, music: true, effects: true, events: EV }));
      // linearity: the mix is the sum of the stems (the limiter never acts at these levels)
      let rs = 0, ms = 0; for (let i = 0; i < mix.x.length; i++) { const d = mix.x[i] - mus.x[i] - fx.x[i]; rs += d * d; ms += mix.x[i] * mix.x[i]; }
      const lin = 10 * Math.log10(rs / ms + 1e-30);
      for (const sp of fx.spans) {
        const end = Math.min(sp.end + 0.05, 20);
        const F = bandFrames(fx.x, sp.at, end), Mu = bandFrames(mus.x, sp.at, end);
        const mx = Math.max(...F.map((q) => q.tot));
        const keep = F.map((q, i) => (q.tot >= mx * 0.01 ? i : -1)).filter((i) => i >= 0);     // the frames where the effect sounds (within 20 dB of its loudest)
        const eF = new Float64Array(BANDS.length), eM = new Float64Array(BANDS.length);
        for (const i of keep) for (let b = 0; b < BANDS.length; b++) { eF[b] += F[i].e[b]; eM[b] += Mu[i].e[b]; }
        const order = [...BANDS.keys()].sort((a, b) => eF[b] - eF[a]);
        const tot = eF.reduce((a, b) => a + b, 0);
        let acc = 0, sF = 0, sM = 0; const used = [];
        for (const b of order) { if (acc >= 0.7 * tot) break; acc += eF[b]; sF += eF[b]; sM += eM[b]; used.push(BANDS[b].fc); }
        const snr = 10 * Math.log10(sF / Math.max(sM, 1e-30));
        res.push({ seed, voice: sp.voice, at: sp.at, snr, bands: used.map((f) => Math.round(f)), frames: keep.length });
      }
      if (seed === 1) {
        writeFileSync(resolve(OUT, 'mix.wav'), wavBuffer(mix.x, SR));
        writeFileSync(resolve(OUT, 'mix.png'), spectrogramPng(mix.x, SR, { title: 'MIX: MUSIC SEED 1 + A TYPICAL PLAY SEQUENCE', win: 2048, width: 1400, fMin: 40, fMax: 12000, marks: EV.map((e) => ({ t: e.at, label: e.voice.toUpperCase() })) }));
      }
      info[`mixLinearityDb_seed${seed}`] = lin;
      check(g, `seed ${seed}: the mix equals music stem + effects stem (residual < -40 dB: nothing pumps)`, lin < -40, `${f1(lin)} dB`, '< -40');
    }
    const worst = res.reduce((a, b) => (b.snr < a.snr ? b : a));
    check(g, `every effect stands >= 8 dB above the music in its own band (1/3-octave bands holding 70% of its energy, while it sounds), 3 music seeds x ${EV.length} effects`, worst.snr >= 8, `worst ${f1(worst.snr)} dB (${worst.voice} @${worst.at} s, seed ${worst.seed}, bands ${worst.bands.join('/')} Hz); median ${f1(median(res.map((q) => q.snr)))} dB`, '>= 8 dB');
    info.mix = res;
  }

  /* ═════════════════════════ D2. separation, robustly: seeds x random timings x the genome pitch range ═════════════════════════ */
  {
    // Round-3 fix. Section D tests one fixed 20 s sequence at pitch 1; an independent check found placements where effects
    // fell below 8 dB (a soft toss 5 dB UNDER the pads). Here: 4 music seeds (one is the engine's default composer seed)
    // x 90 s, every effect variant (soft / medium / hard) placed at seeded random times (gaps log-uniform 0.15-4 s, so many
    // effects arrive alone, after a pause, onto music at full level), each at a random pitch ratio in 0.70..1.43 (the
    // genome range); strands called at a random 30-60 Hz with 30% frame jitter on the audio clock's 128-sample grid. The
    // music stem includes the room dips exactly as the engine would ask for them. Gates on the WORST placement.
    const g = 'mix robustness';
    const VARS = [
      ['poke 0.2', 'poke', { intensity: 0.2 }], ['poke 0.6', 'poke', { intensity: 0.6 }], ['poke 1', 'poke', { intensity: 1 }],
      ['release 0.3', 'release', { compression: 0.3 }], ['release 0.7', 'release', { compression: 0.7 }],
      ['land 0.3', 'land', { intensity: 0.3 }], ['land 0.7', 'land', { intensity: 0.7 }],
      ['pop 0.2', 'pop', { size: 0.2 }], ['pop 0.5', 'pop', { size: 0.5 }], ['pop 0.9', 'pop', { size: 0.9 }],
      ['bump 0.15', 'bump', { intensity: 0.15 }], ['bump 0.5', 'bump', { intensity: 0.5 }], ['bump 0.9', 'bump', { intensity: 0.9 }],
      ['lift', 'lift', {}], ['toss 0.15', 'toss', { speed: 0.15 }], ['toss 0.5', 'toss', { speed: 0.5 }], ['toss 1', 'toss', { speed: 1 }],
      ['snap 0.5', 'strandSnap', { tension: 0.5 }], ['strand', 'strand', {}], ['squish', 'squish', {}],
    ];
    const LEN = { strand: 1.7, squish: 3.3 };
    const ENGINE_COMPOSER = (0x57a15b00 ^ 0x2f6b3c1d) >>> 0;     // engine.ts: the default createAudio() composer seed
    const runs = [];
    const plan = (seed, secs) => {
      const r = mul32(seed * 7 + 3), events = [];
      let t = 3, k = Math.floor(r() * VARS.length);
      while (t < secs - 4) {
        const [tag, voice, params] = VARS[k++ % VARS.length];
        const pitch = 0.7 * Math.pow(1.43 / 0.7, r());
        events.push({ at: +t.toFixed(4), tag, voice, params, pitch, pattern: { hz: 30 + 30 * r(), jitter: 0.3, quantum: 128 / SR, seed: k } });
        t += (LEN[voice] ?? 0.5) + 0.15 * Math.pow(4 / 0.15, r());
      }
      return events;
    };
    const measure = async (seed, secs, musicVolume) => {
      const events = plan(seed, secs);
      const fx = dec(await ev('renderMix', { seed, secs, music: false, effects: true, events, musicVolume }));
      const mu = dec(await ev('renderMix', { seed, secs, music: true, effects: false, events, musicVolume }));
      const out = [];
      let prevEnd = -10;
      for (const sp of fx.spans) {
        const iso = sp.at - prevEnd > 2.5; prevEnd = Math.max(prevEnd, sp.end);
        const s70 = sep70(fx.x, mu.x, sp.at, Math.min(sp.end + 0.05, secs));
        const L = loudSep(fx.x, mu.x, sp.at, Math.min(sp.end, secs));
        out.push({ seed, tag: sp.tag, at: sp.at, pitch: sp.pitch, iso, sep: s70.snr, bands: s70.bands, K: L.K, A: L.A });
      }
      return { out, events, fx, mu };
    };
    for (const seed of [ENGINE_COMPOSER, 1, 2, 17]) {
      const m = await measure(seed, 90);
      runs.push(...m.out);
      if (seed === 1) {
        const x = new Float32Array(m.fx.x.length); for (let i = 0; i < x.length; i++) x[i] = m.fx.x[i] + m.mu.x[i];
        const marks = m.events.filter((e) => e.at < 30).map((e) => ({ t: e.at, label: e.tag.toUpperCase() }));
        writeFileSync(resolve(OUT, 'mix_sweep.png'), spectrogramPng(cut(x, 0, 30), SR, { title: 'MIX SWEEP (MUSIC SEED 1, RANDOM PITCH AND TIMING), FIRST 30 S', win: 2048, width: 1400, fMin: 40, fMax: 12000, marks }));
        writeFileSync(resolve(OUT, 'mix_sweep_music.png'), spectrogramPng(cut(m.mu.x, 0, 30), SR, { title: 'MUSIC STEM OF THE SAME 30 S (THE ROOM DIPS)', win: 4096, width: 1400, fMin: 40, fMax: 12000, marks }));
        writeFileSync(resolve(OUT, 'mix_sweep.wav'), wavBuffer(x, SR));
      }
    }
    const worst = (k) => runs.reduce((a, b) => (b[k] < a[k] ? b : a));
    const ws = worst('sep'), wk = worst('K'), wa = worst('A');
    const iso = runs.filter((q) => q.iso);
    const by = {}; for (const q of runs) (by[q.tag] ??= []).push(q);
    const perVoice = Object.entries(by).map(([t, rs]) => `${t} ${f1(Math.min(...rs.map((q) => q.sep)))}/${f1(Math.min(...rs.map((q) => q.K)))}`).join(', ');
    const where = (q) => `${q.tag} @${f2(q.at)} s, seed ${q.seed}, pitch ${f2(q.pitch)}${q.iso ? ', alone after a pause' : ''}`;
    check(g, `in-band: every effect >= 8 dB above the music in its own band, ${runs.length} placements (4 seeds x 90 s, ${VARS.length} variants, pitch 0.70..1.43, random timing; ${iso.length} alone after a pause)`, ws.sep >= 8, `worst ${f1(ws.sep)} dB (${where(ws)}, bands ${ws.bands.join('/')} Hz); median ${f1(median(runs.map((q) => q.sep)))} dB`, '>= 8 dB');
    check(g, 'loudness: over each effect\'s own loudest 20 ms frames (within 10 dB of its loudest), K-weighted (BS.1770) effect over music >= 10 LU, every placement', wk.K >= 10, `worst ${f1(wk.K)} LU (${where(wk)}); median ${f1(median(runs.map((q) => q.K)))} LU; per effect (worst in-band dB / worst LU): ${perVoice}`, '>= 10 LU');
    // A-weighting is reported, not gated: it discounts the squishies' 60-300 Hz bodies by 10-20 dB, and the residual
    // shortfalls are a soft body landing within a few ms of a mallet attack that had already started (causal: no dip can
    // remove a note that began before the effect was called)
    info.mixRobust = { n: runs.length, isolated: iso.length, worstSep: ws, worstK: wk, worstA: wa, aBelow10: runs.filter((q) => q.A < 10).length, medianA: median(runs.map((q) => q.A)), all: runs.map((q) => ({ ...q, bands: undefined })) };
    check(g, '(info, not gated) A-weighted effect over music over the same frames', true, `worst ${f1(wa.A)} dB (${where(wa)}); ${runs.filter((q) => q.A < 10).length}/${runs.length} placements under 10 dB; median ${f1(median(runs.map((q) => q.A)))} dB`, 'reported');
    // the music slider at its top (+6 dB): the dips deepen by the same 6 dB (music.ts roomDb), so in-band separation holds
    const hi = [];
    for (const seed of [1, 4242]) hi.push(...(await measure(seed, 60, 1)).out);
    const wh = hi.reduce((a, b) => (b.sep < a.sep ? b : a)), whk = hi.reduce((a, b) => (b.K < a.K ? b : a));
    check(g, 'music volume 1 (+6 dB, the slider\'s top): in-band still >= 8 dB for every effect (2 seeds x 60 s; K-weighted reported)', wh.sep >= 8, `worst in-band ${f1(wh.sep)} dB (${where(wh)}); worst K ${f1(whk.K)} LU (${where(whk)}), ${hi.filter((q) => q.K < 10).length}/${hi.length} under 10 LU`, '>= 8 dB');
  }

  /* ═════════════════════════ D3. the room dip itself ═════════════════════════ */
  {
    const g = 'music room dip';
    const RD = K.ROOM_DB, PD = K.ROOM_DB * K.ROOM_PAD_SHARE;
    const base = { seed: 3, secs: 30 };
    const padP = dec(await ev('renderMusic', { ...base, layers: { pad: 1, mallet: 0 } }));
    const melP = dec(await ev('renderMusic', { ...base, layers: { pad: 0, mallet: 1 } }));
    const note = melP.log.find((e) => e.kind === 'mallet' && !e.dropped && e.t > 12 && e.t < 20);
    const T = note ? note.t - 0.05 : 15;
    const rooms = [{ from: T, until: T + 0.8, db: RD }];
    const padR = dec(await ev('renderMusic', { ...base, layers: { pad: 1, mallet: 0 }, rooms }));
    const melR = dec(await ev('renderMusic', { ...base, layers: { pad: 0, mallet: 1 }, rooms }));
    const gainDb = (a, b, t0, t1) => dbOf(rmsOf(cut(b, t0, t1)) / Math.max(rmsOf(cut(a, t0, t1)), 1e-12));
    const dPad = gainDb(padP.x, padR.x, T + 0.1, T + 0.8), dMel = gainDb(melP.x, melR.x, T + 0.06, T + 0.8);
    check(g, `depth while held: the melody (mallets, echoes, bubbles) ${RD} dB, the pad ${f1(PD)} dB (+/-1 dB)`, Math.abs(dMel - RD) <= 1 && Math.abs(dPad - PD) <= 1, `melody ${f2(dMel)} dB, pad ${f2(dPad)} dB`, `${RD}, ${f1(PD)} +/- 1`);
    // attack and recovery on the continuous pad stem (2 ms windows for the attack, 20 ms for the recovery)
    const e2a = envelope(cut(padP.x, T - 0.01, T + 0.1), 0.002), e2b = envelope(cut(padR.x, T - 0.01, T + 0.1), 0.002);
    const att = e2b.map((p, i) => ({ t: p.t - 0.01, db: p.db - e2a[i].db })).find((p) => p.t > 0 && p.db <= PD + 1);
    const ea = envelope(padP.x, 0.02), eb = envelope(padR.x, 0.02);
    const gdb = eb.map((p, i) => ({ t: p.t, db: p.db - ea[i].db }));
    const rec = gdb.find((p) => p.t > T + 0.8 && p.db >= -1);
    // ("outside" = before the dip, and from 6 s after the hold: 6.7 of the pad's 0.9 s recovery time constants)
    const outside = Math.max(...gdb.filter((p) => p.t < T - 0.05 || p.t > T + 0.8 + 6).map((p) => Math.abs(p.db)));
    const smooth = Math.max(...gdb.slice(1).map((p, i) => Math.abs(p.db - gdb[i].db)).filter((v, i) => gdb[i].t > T + 0.05 && gdb[i].t < T + 4));
    check(g, 'attack: the pad within 1 dB of its depth <= 40 ms after the call (the melody\'s is faster: 1.5 ms time constant)', att && att.t <= 0.04, att ? `${(att.t * 1000).toFixed(0)} ms` : 'never', '<= 40 ms');
    // (an exponential return from -14 dB with a 0.6 s time constant starts at ~1.2 dB per 20 ms: a swell, no jump)
    check(g, 'recovery after the hold ends: back within 1 dB 0.6..2.5 s later, a swell (<= 1.5 dB per 20 ms), untouched outside (< 0.05 dB)', rec && rec.t - (T + 0.8) >= 0.6 && rec.t - (T + 0.8) <= 2.5 && smooth <= 1.5 && outside < 0.05, `${rec ? f2(rec.t - T - 0.8) : 'never'} s, largest step ${f2(smooth)} dB / 20 ms, outside ${f3(outside)} dB`, '0.6..2.5 s, <= 1.5, < 0.05');
    const full = dec(await ev('renderMusic', { ...base })), fullR = dec(await ev('renderMusic', { ...base, rooms }));
    const sa = stepIn(full.x, T - 0.05, T + 3), sb = stepIn(fullR.x, T - 0.05, T + 3);
    check(g, 'no click: in and around the dip the largest sample step and 2nd difference are <= those of the same music without it', sb.step <= sa.step * 1.02 + 1e-5 && sb.d2 <= sa.d2 * 1.02 + 1e-6, `step ${f3(sb.step)} vs ${f3(sa.step)}, d2 ${sb.d2.toExponential(1)} vs ${sa.d2.toExponential(1)}`, '<=');
    // a staircase: a deep dip for 0.3 s inside a shallow one held to +1.2 s: after the deep hold the gain rises to the
    // shallow depth (not to 0 dB), then recovers when the shallow hold ends
    const T2 = 10;
    const stairs = [{ from: T2, until: T2 + 0.3, db: RD }, { from: T2 + 0.01, until: T2 + 3.5, db: -6 }];
    const padS = dec(await ev('renderMusic', { ...base, layers: { pad: 1, mallet: 0 }, rooms: stairs }));
    const deep = gainDb(padP.x, padS.x, T2 + 0.1, T2 + 0.3), mid = gainDb(padP.x, padS.x, T2 + 2.6, T2 + 3.5), after = gainDb(padP.x, padS.x, T2 + 8, T2 + 9);
    check(g, 'overlapping dips stack as a staircase: the deepest active hold wins, then (once it ends) the next, then none', Math.abs(deep - PD) <= 1.5 && Math.abs(mid - (-6 * K.ROOM_PAD_SHARE)) <= 1 && Math.abs(after) < 0.3, `pad ${f1(deep)} dB (deep), ${f1(mid)} dB (shallow), ${f2(after)} dB after`, `${f1(PD)}, ${f1(-6 * K.ROOM_PAD_SHARE)}, 0`);
    const rule = await page.evaluate(async () => { const M = await import('/src/audio/music.ts'); return { poke: M.roomDb('poke'), poke6: M.roomDb('poke', 6), reveal: M.roomDb('reveal'), sq01: M.squishRoomDb(0.1), sq07: M.squishRoomDb(0.7), sq2: M.squishRoomDb(-2), st0: M.strandRoomDb(0), st035: M.strandRoomDb(0.35), st1: M.strandRoomDb(1, 6), kinds: Object.keys(M.ROOM_KINDS) }; });
    check(g, 'the rule: every effect one-shot makes room (ceremony reveal/merge keep the slow duck); squish by |rate| (none <= 0.15/s, full >= 0.7/s), strand by tension (full >= 0.35); the dip deepens by the music volume above its default', rule.poke === RD && rule.poke6 === RD - 6 && rule.reveal === null && rule.sq01 === 0 && rule.sq07 === RD && rule.sq2 === RD && rule.st0 === 0 && rule.st035 === RD && rule.st1 === RD - 6 && ['poke', 'release', 'land', 'pop', 'bump', 'lift', 'toss', 'strandSnap', 'capsule', 'meterFull', 'blend'].every((k) => rule.kinds.includes(k)), JSON.stringify({ ...rule, kinds: rule.kinds.join(',') }), 'as declared');
    writeFileSync(resolve(OUT, 'music_room.png'), spectrogramPng(cut(fullR.x, T - 3, T + 5), SR, { title: `MUSIC ROOM DIP (MELODY ${RD} DB, PAD ${f1(PD)} DB) AT ${f1(T)} S, SHOWN ${f1(T - 3)}-${f1(T + 5)} S`, win: 4096, width: 1100, fMin: 40, fMax: 12000, marks: [{ t: 3, label: 'DIP' }, { t: 3.8, label: 'HOLD ENDS' }] }));
    info.music.room = { dMel, dPad, attackS: att && att.t, recoveryS: rec && rec.t - T - 0.8, smooth, deep, mid, after };
  }

  /* ═════════════════════════ E. the new interaction voices ═════════════════════════ */
  const V = {
    bump: { spec: { voice: 'bump', params: { intensity: 0.6 }, seed: 31, secs: 0.6 }, lo: { intensity: 0 }, hi: { intensity: 1 }, dur: [0.07, 0.2], win: 512 },
    lift: { spec: { voice: 'lift', params: {}, seed: 32, secs: 0.7 }, lo: null, hi: null, dur: [0.12, 0.32], win: 512 },
    toss: { spec: { voice: 'toss', params: { speed: 0.6 }, seed: 33, secs: 0.9 }, lo: { speed: 0 }, hi: { speed: 1 }, dur: [0.18, 0.5], win: 1024 },
    strandSnap: { spec: { voice: 'strandSnap', params: { tension: 0.8 }, seed: 34, secs: 0.6 }, lo: { tension: 0 }, hi: { tension: 1 }, dur: [0.04, 0.22], win: 256 },
    // the scripted gesture: 1.2 s pull from tension 0 (silent at first), 0.25 s hold, snap; audible from tension ~0.15 on
    strand: { spec: { voice: 'strand', script: 'stretch', seed: 35 }, lo: null, hi: null, dur: [0.7, 1.6], win: 1024 },
  };
  const judged = (r) => cut(r.x, r.t0, Math.min(r.n / SR, r.endTime + 0.05));
  const demo = [];
  for (const [name, S] of Object.entries(V)) {
    const g = `voice ${name}`;
    const r = await render(S.spec);
    const x = judged(r);
    const m = metrics(x, SR);
    const dry = await render({ ...S.spec, chain: false, t0: 0 });
    const md = metrics(cut(dry.x, 0, Math.min(dry.n / SR, dry.endTime + 0.05)), SR);
    const jump = Math.max(m.startSample, m.endSample, m.jumpStart, m.jumpEnd, md.startSample, md.endSample, md.jumpStart, md.jumpEnd);
    check(g, 'peak -20..-1 dBFS', m.peakDb >= -20 && m.peakDb <= -1, `${f1(m.peakDb)} dBFS`, '-20..-1');
    check(g, '|DC| < 0.01', Math.abs(m.dc) < 0.01, m.dc.toExponential(2), '< 0.01');
    check(g, 'no click: start/end jump <= 0.25 (wet and dry) and max step < 0.25', jump <= 0.25 && m.maxJump < 0.25, `edges ${f3(jump)}, max step ${f3(m.maxJump)}`, '<= 0.25');
    check(g, 'tail < -60 dBFS at its declared end', m.tailDb < -60, `${f1(m.tailDb)} dBFS`, '< -60');
    check(g, `duration ${S.dur[0] * 1000}..${S.dur[1] * 1000} ms (active, -45 dBFS)`, m.activeDurS >= S.dur[0] && m.activeDurS <= S.dur[1], `${(m.activeDurS * 1000).toFixed(0)} ms`, `${S.dur[0] * 1000}..${S.dur[1] * 1000}`);
    check(g, 'not harsh (> 6 kHz < 15%), active RMS -34..-14 dBFS, finite', m.hfFrac < 0.15 && m.activeRmsDb >= -34 && m.activeRmsDb <= -14 && m.badSamples === 0, `${f2(m.hfFrac * 100)}%, ${f1(m.activeRmsDb)} dBFS, ${m.badSamples} bad`, 'ok');
    // level window for 12 seeds x parameter extremes
    const sets = [S.spec.params ?? {}, ...(S.lo ? [S.lo, S.hi] : [])];
    let lo = Infinity, hi = -Infinity, mj = 0;
    for (const pp of sets) for (let sd = 1; sd <= 12; sd++) {
      const mm = metrics(judged(await render({ ...S.spec, params: pp, seed: 500 + sd })), SR);
      lo = Math.min(lo, mm.peakDb); hi = Math.max(hi, mm.peakDb); mj = Math.max(mj, mm.maxJump);
    }
    check(g, `12 seeds x ${sets.length} parameter sets: peak in -20..-1 dBFS, max step < 0.25`, lo >= -20 && hi <= -1 && mj < 0.25, `${f1(lo)}..${f1(hi)} dBFS, step ${f3(mj)}`, 'in window');
    // pitch ratio (same seed)
    const pl = judged(await render({ ...S.spec, pitch: 0.8 })), ph = judged(await render({ ...S.spec, pitch: 1.25 }));
    if (name === 'toss') {
      const cl = dominant(pl, SR, { fLo: 100, fHi: 9000 }).centroidHz, chh = dominant(ph, SR, { fLo: 100, fHi: 9000 }).centroidHz;
      check(g, 'pitch 0.8 vs 1.25: the whoosh band moves up (centroid x >= 1.15)', chh / cl >= 1.15, `${f1(cl)} -> ${f1(chh)} Hz (x${f3(chh / cl)})`, '>= 1.15');
    } else {
      const band = name === 'strand' ? [500, 6000] : [60, 8000];
      const dl = dominant(pl, SR, { fLo: band[0], fHi: band[1] }).hz, dh = dominant(ph, SR, { fLo: band[0], fHi: band[1] }).hz;
      check(g, 'pitch 0.8 vs 1.25: dominant frequency x ~1.56 (+/-25%)', dh / dl > 1.17 && dh / dl < 1.95, `${f1(dl)} -> ${f1(dh)} Hz (x${f3(dh / dl)})`, '1.17..1.95');
    }
    // hostile, pan, determinism
    const hostile = { bump: { intensity: 'NaN' }, lift: {}, toss: { speed: 'Infinity' }, strandSnap: { tension: 'NaN' }, strand: {} }[name];
    const hm = metrics((await render({ ...S.spec, params: hostile, pitch: name === 'strand' ? 'NaN' : -3, pan: 'NaN' })).x, SR);
    check(g, 'hostile params (NaN/Infinity, negative pitch, NaN pan): finite, peak <= -1 dBFS', hm.badSamples === 0 && hm.peakDb <= -1, `${hm.badSamples} bad, ${f1(hm.peakDb)} dBFS`, 'ok');
    const pn = await render({ ...S.spec, channels: 2, pan: -1 });
    const eL = pn.chans[0].reduce((a, v) => a + v * v, 0), eR = pn.chans[1].reduce((a, v) => a + v * v, 0);
    check(g, 'pan -1: left >= 12 dB louder than right', 10 * Math.log10((eL + 1e-20) / (eR + 1e-20)) >= 12, `${f1(10 * Math.log10((eL + 1e-20) / (eR + 1e-20)))} dB`, '>= 12');
    const a1 = await render({ ...S.spec, seed: 77 }), a2 = await render({ ...S.spec, seed: 77 }), a3 = await render({ ...S.spec, seed: 78 });
    let dd = 0; for (let i = 0; i < a1.x.length; i++) dd = Math.max(dd, Math.abs(a1.x[i] - a2.x[i]));
    let s3 = 0, e3 = 0; for (let i = 0; i < a1.x.length; i++) { s3 += (a1.x[i] - a3.x[i]) ** 2; e3 += a1.x[i] ** 2; }
    check(g, 'same seed renders agree (<= 1e-4); another seed differs (norm. diff >= 0.25)', dd <= 1e-4 && Math.sqrt(s3 / e3) >= 0.25, `${dd.toExponential(1)}, ${f2(Math.sqrt(s3 / e3))}`, 'ok');
    info.voices[name] = { peakDb: m.peakDb, rmsDb: m.activeRmsDb, durMs: m.activeDurS * 1000, hf: m.hfFrac, lo, hi, centroid: dominant(x, SR, { fLo: 60, fHi: 9000 }).centroidHz };
    writeFileSync(resolve(OUT, `${name}.wav`), wavBuffer(x, SR));
    const marks = name === 'strand' ? r.script.marks : null;
    writeFileSync(resolve(OUT, `${name}.png`), spectrogramPng(x, SR, { title: name.toUpperCase(), win: S.win, width: 900, fMin: 40, fMax: 14000, marks }));
    demo.push(x);
  }
  {
    // the parameters really change the sound
    const g = 'voice parameters';
    const R = async (spec) => judged(await render(spec));
    const b0 = await R({ voice: 'bump', params: { intensity: 0 }, seed: 41, secs: 0.6 }), b1 = await R({ voice: 'bump', params: { intensity: 1 }, seed: 41, secs: 0.6 });
    const mb0 = metrics(b0, SR), mb1 = metrics(b1, SR), cb0 = dominant(b0, SR, { fLo: 60, fHi: 9000 }).centroidHz, cb1 = dominant(b1, SR, { fLo: 60, fHi: 9000 }).centroidHz;
    check(g, 'bump intensity 0 -> 1: >= 8 dB louder and brighter (centroid x >= 1.3)', mb1.peakDb - mb0.peakDb >= 8 && cb1 / cb0 >= 1.3, `${f1(mb0.peakDb)} -> ${f1(mb1.peakDb)} dBFS, centroid ${f1(cb0)} -> ${f1(cb1)} Hz`, '>= 8 dB, x1.3');
    const t0 = await R({ voice: 'toss', params: { speed: 0.1 }, seed: 42, secs: 0.9 }), t1 = await R({ voice: 'toss', params: { speed: 1 }, seed: 42, secs: 0.9 });
    const mt0 = metrics(t0, SR), mt1 = metrics(t1, SR), ct0 = dominant(t0, SR, { fLo: 100, fHi: 9000 }).centroidHz, ct1 = dominant(t1, SR, { fLo: 100, fHi: 9000 }).centroidHz;
    // length independent of loudness: the span of 10 ms RMS windows within 20 dB of the whoosh's own loudest window
    const span20 = (y) => { const e = envelope(y, 0.01); const mx = Math.max(...e.map((p) => p.db)); const on = e.filter((p) => p.db >= mx - 20); return on[on.length - 1].t - on[0].t + 0.01; };
    const d0 = span20(t0), d1 = span20(t1);
    check(g, 'toss speed 0.1 -> 1: >= 8 dB louder, brighter (x >= 1.3) and shorter (its own -20 dB span)', mt1.peakDb - mt0.peakDb >= 8 && ct1 / ct0 >= 1.3 && d1 < d0, `${f1(mt0.peakDb)} -> ${f1(mt1.peakDb)} dBFS, centroid ${f1(ct0)} -> ${f1(ct1)} Hz, ${(d0 * 1000).toFixed(0)} -> ${(d1 * 1000).toFixed(0)} ms`, 'all three');
    const h2 = await render({ voice: 'strand', script: 'hold2', seed: 43 }), h8 = await render({ voice: 'strand', script: 'hold8', seed: 43 });
    const r2 = dbOf(rmsOf(cut(h2.x, 0.3, 0.9))), r8 = dbOf(rmsOf(cut(h8.x, 0.3, 0.9)));
    const p2 = peakHz(h2.x, 0.3, 0.9, 500, 6000), p8 = peakHz(h8.x, 0.3, 0.9, 500, 6000);
    check(g, 'strand tension 0.2 -> 0.8 (held still): >= 6 dB louder and the squeak resonance rises >= x1.5', r8 - r2 >= 6 && p8 / p2 >= 1.5, `${f1(r2)} -> ${f1(r8)} dBFS RMS, resonance ${f1(p2)} -> ${f1(p8)} Hz`, '>= 6 dB, x1.5');
    const sn0 = metrics(await R({ voice: 'strandSnap', params: { tension: 0 }, seed: 44, secs: 0.6 }), SR), sn1 = metrics(await R({ voice: 'strandSnap', params: { tension: 1 }, seed: 44, secs: 0.6 }), SR);
    check(g, 'strand snap: a taut strand (tension 1) snaps louder than a slack one (tension 0)', sn1.peakDb - sn0.peakDb >= 2, `${f1(sn0.peakDb)} -> ${f1(sn1.peakDb)} dBFS`, '>= 2 dB');
    const st = await render({ voice: 'strand', script: 'stretch', seed: 45 });
    const early = peakHz(st.x, st.t0 + 0.3, st.t0 + 0.6, 500, 6000), late = peakHz(st.x, st.t0 + 1.0, st.t0 + 1.3, 500, 6000);
    check(g, 'strand while stretching: the squeak rises with tension within one gesture (x >= 1.3)', late / early >= 1.3, `${f1(early)} -> ${f1(late)} Hz`, '>= 1.3');
  }
  {
    // the held strand never orphans: the caller just stops calling (no end(), no snap)
    const g = 'voice strand cleanup';
    const r = await render({ voice: 'strand', script: 'orphan', seed: 46, waitEnded: true });
    const lastUpd = r.t0 + 0.8;
    const after = dbOf(peakOf(cut(r.x, lastUpd + STR.SILENCE_S + 0.15, r.n / SR)));
    check(g, `silent (< -70 dBFS) from ${(STR.SILENCE_S + 0.15).toFixed(2)} s after the last update, with no end() call`, after < -70, `${f1(after)} dBFS`, '< -70');
    check(g, `its sources stop by themselves ~${STR.STOP_S} s after the last update and the voice frees its nodes`, r.alive === false && r.voiceEnd <= lastUpd + STR.STOP_S + 0.05, `alive=${r.alive}, end ${f2(r.voiceEnd - lastUpd)} s after the last update`, `freed, <= ${STR.STOP_S + 0.05}`);
    const sm = metrics(cut(r.x, r.t0, r.n / SR), SR);
    check(g, 'orphaned strand fades without a click (max step < 0.25)', sm.maxJump < 0.25, f3(sm.maxJump), '< 0.25');
    writeFileSync(resolve(OUT, 'strand_orphan.png'), spectrogramPng(cut(r.x, r.t0, r.n / SR), SR, { title: 'STRAND: CALLER STOPS AT 0.8 S (NO END, NO SNAP)', win: 1024, width: 900, fMin: 40, fMax: 14000, marks: r.script.marks }));
  }
  {
    // Round-3 fix: the held strand ALONE (no snap) at realistic per-frame call patterns. The first version peaked at
    // -28.6 dBFS in a realistic stretch (its gate is -20..-1) and a constant hold sat at -47 dBFS RMS; the old checks only
    // saw the stretch + snap render, whose peak is the snap's.
    const g = 'voice strand (realistic calls)';
    const pats = [
      ['30 Hz, 30% jitter', { hz: 30, jitter: 0.3 }], ['45 Hz, 40% jitter, 10 ms audio callbacks', { hz: 45, jitter: 0.4, quantum: 0.01 }],
      ['60 Hz, 20% jitter, 128-sample grid', { hz: 60, jitter: 0.2, quantum: 128 / SR }], ['120 Hz, 10 ms callbacks (2-3 calls per step)', { hz: 120, quantum: 0.01 }],
      ['60 Hz exact', { hz: 60 }],
    ];
    const rows = [];
    for (const [name, pattern] of pats) {
      const r = await render({ voice: 'strand', script: 'real', pattern, seed: 35 });
      const x = cut(r.x, r.t0, r.t0 + 1.45);
      const w = envelope(x, 0.1);
      rows.push({ name, peak: dbOf(peakOf(x)), rms: Math.max(...w.map((p) => p.db)), step: stepIn(r.x, 0, r.n / SR).step });
    }
    const pk = rows.map((q) => q.peak), rm = rows.map((q) => q.rms);
    check(g, 'a realistic stretch to tension 0.85 (1.2 s pull + 0.25 s hold, no snap): the strand alone peaks in -20..-1 dBFS at every call pattern (30-120 Hz, jittered, on the audio clock\'s grid)', pk.every((v) => v >= -20 && v <= -1) && rows.every((q) => q.step < 0.25), rows.map((q) => `${q.name}: ${f1(q.peak)}`).join('; ') + ` dBFS; max step ${f3(Math.max(...rows.map((q) => q.step)))}`, '-20..-1');
    check(g, 'call-rate independent: peak and loudest 100 ms RMS agree within 1.5 dB across the five call patterns', Math.max(...pk) - Math.min(...pk) <= 1.5 && Math.max(...rm) - Math.min(...rm) <= 1.5, `peak spread ${f2(Math.max(...pk) - Math.min(...pk))} dB, RMS spread ${f2(Math.max(...rm) - Math.min(...rm))} dB`, '<= 1.5 dB');
    let lo = Infinity, hi = -Infinity;
    for (let sd = 1; sd <= 12; sd++) { const r = await render({ voice: 'strand', script: 'real', pattern: { hz: 30 + 2 * sd, jitter: 0.3, quantum: 128 / SR, seed: sd }, seed: 600 + sd }); const v = dbOf(peakOf(cut(r.x, r.t0, r.t0 + 1.45))); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    check(g, '12 seeds x jittered 32-54 Hz calls: the strand alone stays in -20..-1 dBFS', lo >= -20 && hi <= -1, `${f1(lo)}..${f1(hi)} dBFS`, '-20..-1');
    const hold = async (T) => { const r = await render({ voice: 'strand', script: 'realHold', pattern: { hz: 30, jitter: 0.3, quantum: 128 / SR, T }, seed: 36 }); return dbOf(rmsOf(cut(r.x, r.t0 + 0.4, r.t0 + 1.4))); };
    const h2 = await hold(0.2), h8 = await hold(0.8);
    check(g, 'held still (30 Hz jittered calls): audible at tension 0.8 (RMS >= -32 dBFS, was -47) and >= 6 dB quieter at 0.2', h8 >= -32 && h8 - h2 >= 6, `${f1(h2)} -> ${f1(h8)} dBFS RMS`, '>= -32, >= 6 dB');
    const r0 = await render({ voice: 'strand', script: 'real', pattern: { hz: 30, jitter: 0.3, quantum: 128 / SR }, seed: 35 });
    writeFileSync(resolve(OUT, 'strand_real.png'), spectrogramPng(cut(r0.x, r0.t0, r0.n / SR), SR, { title: 'STRAND ALONE, REALISTIC CALLS (30 HZ, 30% JITTER, AUDIO-CLOCK GRID)', win: 1024, width: 900, fMin: 40, fMax: 14000, marks: r0.script.marks }));
    info.voices.strandReal = { rows, seeds: [lo, hi], hold: [h2, h8] };
  }
  {
    const g = 'bump rate limit (pure)';
    const call = (arr) => page.evaluate((a) => window.AV.bumpLimiterRun(a), arr);
    const pile = []; for (let i = 0; i < 120; i++) pile.push({ t: 10 + i / 60, intensity: 0.5 });
    pile.push({ t: 13.2, intensity: 0.5 });
    const r = await call(pile);
    const acc = r.out.slice(0, 120).filter((q) => q.out !== null);
    const maxAcc = LIM.CAPACITY + LIM.REFILL_PER_S * 2;
    check(g, `a pile settling (bump every frame for 2 s): at most ${maxAcc} accepted (burst ${LIM.CAPACITY} + ${LIM.REFILL_PER_S}/s), at least 6`, acc.length <= maxAcc && acc.length >= 6, `${acc.length} of 120 accepted`, `6..${maxAcc}`);
    const gaps = acc.slice(1).map((q, i) => q.t - acc[i].t);
    check(g, `accepted bumps are >= ${LIM.MIN_GAP_S * 1000} ms apart and get softer while the pile keeps hitting`, Math.min(...gaps) >= LIM.MIN_GAP_S - 1e-9 && acc[acc.length - 1].out < acc[0].out * 0.6, `min gap ${f3(Math.min(...gaps))} s, intensity ${f2(acc[0].out)} -> ${f2(acc[acc.length - 1].out)}`, 'ok');
    check(g, 'after 1 s of quiet a new bump plays at full intensity', r.out[120].out !== null && Math.abs(r.out[120].out - 0.5) < 1e-9, String(r.out[120].out), '0.5');
    const r2 = await call([{ t: 1, intensity: 0.02 }, { t: 2, intensity: 0.3 }, { t: 2.03, intensity: 0.6 }, { t: 2.05, intensity: 0.65 }]);
    check(g, 'contact noise (< 0.04) ignored; a much harder hit 30 ms later still plays, a similar one 20 ms after that does not', r2.out[0].out === null && r2.out[1].out !== null && r2.out[2].out !== null && r2.out[3].out === null, r2.out.map((q) => (q.out === null ? 'skip' : f2(q.out))).join(' '), 'skip play play skip');
  }
  {
    // one file with every new voice, 0.5 s apart, for the owner
    const gap = new Float32Array(SR / 2);
    const parts = []; for (const d of demo) parts.push(d, gap);
    const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    writeFileSync(resolve(OUT, 'round3_voices.wav'), wavBuffer(all, SR));
  }
  return info;
}
