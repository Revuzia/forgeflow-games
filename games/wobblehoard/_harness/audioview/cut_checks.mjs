// CUT & RECONNECT audio gates (_spec/CUT.md, SOUND.md "Cut and reconnect"): the slice (cut phase 'start'), the separation pop
// (phase 'separate'), the rejoin blorp and the whole-again flourish. Called by probe_audio.mjs with the page and check().
// Offline renders of the shipping voice code (view.js renderVoice) and the REAL engine run offline (engine_offline.js) for
// the rate limit, the music's room and the separation from the music. Nobody has listened to any of it: every number here
// is a measurement.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metrics, dominant, frameSpectrum, spectrogramPng, wavBuffer } from './analysis.mjs';
import { mul32 } from './play_scenarios.mjs';
import { kWeight, separation, exposure, pct } from './room_checks.mjs';

const SR = 48000;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const decCh = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };
const cut = (x, from, to) => x.slice(Math.max(0, Math.round(from * SR)), Math.min(x.length, Math.round(to * SR)));
const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
const peakOf = (a) => { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
const U = (r, a, b) => a + (b - a) * r();
const FAM = { gel: 'jellygel', sticky: 'slimegoo', foam: 'marshmallow', beads: 'beadsqueeze', dough: 'putty', firm: 'popdome' };

/** Energy in 1/3-octave bands (dB, normalised to the total), 100 Hz - 8 kHz, from one FFT of the whole signal. */
function bandProfile(x) {
  let nf = 1; while (nf < x.length) nf <<= 1;
  const p = frameSpectrum(x, 0, x.length, nf);
  const df = SR / nf, out = [];
  let tot = 0;
  for (let i = -10; i <= 9; i++) {
    const fc = 1000 * Math.pow(2, i / 3), lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
    let e = 0; for (let k = Math.ceil(lo / df); k < Math.min(p.length, Math.ceil(hi / df)); k++) e += p[k];
    out.push(e); tot += e;
  }
  return out.map((e) => 10 * Math.log10(Math.max(e / tot, 1e-12)));
}
/** RMS difference (dB) of two band profiles over the bands within 40 dB of either one's loudest. */
function profileDist(a, b) {
  const ma = Math.max(...a), mb = Math.max(...b);
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] < ma - 40 && b[i] < mb - 40) continue; const d = Math.max(a[i], ma - 40) - Math.max(b[i], mb - 40); s += d * d; n++; }
  return Math.sqrt(s / Math.max(1, n));
}
/** Span (s) of 10 ms RMS windows within `rel` dB of the loudest one. */
function span(x, rel = 30) {
  const n = Math.round(0.01 * SR), e = [];
  for (let s = 0; s + n <= x.length; s += n) e.push(dbOf(rmsOf(x.subarray(s, s + n))));
  const mx = Math.max(...e);
  const on = e.map((v, i) => (v >= mx - rel ? i : -1)).filter((i) => i >= 0);
  return on.length ? (on[on.length - 1] - on[0] + 1) * 0.01 : 0;
}
/** Short transients in a band: frames (256, hop 64) whose band energy rises >= 9 dB over the previous frame and stands >= 25 dB
 *  above the band's quietest decile (the bead "crunch" ticks). */
function bandOnsets(x, fLo, fHi) {
  const W = 256, H = 64, df = SR / W, tr = [];
  for (let s = 0; s + W <= x.length; s += H) { const p = frameSpectrum(x, s, W, W); let e = 0; for (let k = Math.ceil(fLo / df); k <= Math.floor(fHi / df); k++) e += p[k]; tr.push(10 * Math.log10(e + 1e-20)); }
  const floor = pct(tr.filter((v) => v > -150), 0.1);
  let n = 0;
  for (let i = 2; i < tr.length; i++) if (tr[i] - tr[i - 2] >= 9 && tr[i] >= floor + 25 && !(tr[i - 1] - tr[i - 3] >= 9)) n++;
  return n;
}
/** Strongest spectral peak (Hz) of x[a..b] s inside [fLo, fHi] (Hann, zero-padded to 65536, parabolic). */
function peakHzIn(x, a, b, fLo, fHi) {
  const s0 = Math.round(a * SR), n = Math.round((b - a) * SR), nf = 65536, df = SR / nf;
  const p = frameSpectrum(x, s0, n, nf);
  let best = Math.ceil(fLo / df);
  for (let k = Math.ceil(fLo / df); k <= Math.floor(fHi / df); k++) if (p[k] > p[best]) best = k;
  const l = Math.log(p[best - 1] + 1e-30), c = Math.log(p[best] + 1e-30), h = Math.log(p[best + 1] + 1e-30);
  const d = 0.5 * (l - h) / (l - 2 * c + h);
  return (best + (Number.isFinite(d) ? d : 0)) * df;
}
/** Energy (dB) of x in [fLo, fHi] (one FFT over the whole signal). */
function bandDb(x, fLo, fHi) {
  let nf = 1; while (nf < x.length) nf <<= 1;
  const p = frameSpectrum(x, 0, x.length, nf), df = SR / nf;
  let e = 0; for (let k = Math.ceil(fLo / df); k <= Math.floor(fHi / df); k++) e += p[k];
  return 10 * Math.log10(e + 1e-20);
}

export async function cutChecks(env) {
  const { page, check, OUT } = env;
  const info = {};
  const ev = (fn, arg) => page.evaluate(([f, a]) => window.AV[f](a), [fn, arg]);
  const render = async (spec) => { const r = await ev('renderVoice', spec); const chans = r.channels.map(decCh); return { ...r, x: chans[0], chans }; };
  const judged = (r) => cut(r.x, r.t0, Math.min(r.n / SR, r.endTime + 0.05));
  const CC = await page.evaluate(() => window.AV.cutConsts);
  const FL = CC.FLAVOURS;

  /* ═════════════════════════ A. each voice: levels, clicks, tails, the whole parameter space ═════════════════════════ */
  const V = {
    'cut slice': { spec: { voice: 'cutSlice', params: { frac: 0.5, family: 'jellygel', neckS: 0.25 }, seed: 51, secs: 1.2 }, dur: [0.15, 0.45], win: 512 },
    'cut pop': { spec: { voice: 'cutPop', params: { frac: 0.5, family: 'jellygel' }, seed: 52, secs: 0.8 }, dur: [0.03, 0.2], win: 256 },
    rejoin: { spec: { voice: 'rejoin', params: { frac: 0.5 }, seed: 53, secs: 1.2 }, dur: [0.18, 0.6], win: 512 },
    'rejoin all': { spec: { voice: 'rejoin', params: { frac: 1, all: true }, seed: 54, secs: 2 }, dur: [0.6, 1.4], win: 1024 },
  };
  const space = {
    'cut slice': () => { const o = []; for (const f of FL) for (const frac of [0.125, 0.5, 1]) for (const calm of [false, true]) for (const neckS of [0.12, 0.25, 0.6]) o.push({ frac, family: f, calm, neckS }); return o; },
    'cut pop': () => { const o = []; for (const f of FL) for (const frac of [0.125, 0.3, 0.5, 1]) for (const calm of [false, true]) o.push({ frac, family: f, calm }); return o; },
    rejoin: () => { const o = []; for (const frac of [0.125, 0.25, 0.5, 0.75, 1]) for (const calm of [false, true]) o.push({ frac, calm }); return o; },
    'rejoin all': () => [{ frac: 1, all: true }, { frac: 1, all: true, calm: true }, { frac: 0.2, all: true }],
  };
  const demo = [];
  for (const [name, S] of Object.entries(V)) {
    const g = `cut voice ${name}`;
    const r = await render(S.spec);
    const x = judged(r);
    const m = metrics(x, SR);
    const dry = await render({ ...S.spec, chain: false, t0: 0 });
    const md = metrics(cut(dry.x, 0, Math.min(dry.n / SR, dry.endTime + 0.05)), SR);
    const jump = Math.max(m.startSample, m.endSample, m.jumpStart, m.jumpEnd, md.startSample, md.endSample, md.jumpStart, md.jumpEnd);
    check(g, 'peak -20..-1 dBFS', m.peakDb >= -20 && m.peakDb <= -1, `${f1(m.peakDb)} dBFS`, '-20..-1');
    check(g, '|DC| < 0.01', Math.abs(m.dc) < 0.01, m.dc.toExponential(2), '< 0.01');
    check(g, 'no click at start or end: start/end sample and the largest step within 2 ms of either end <= 0.25 (wet and dry), max step anywhere < 0.25', jump <= 0.25 && m.maxJump < 0.25, `edges ${f3(jump)}, max step ${f3(m.maxJump)}`, '<= 0.25');
    check(g, 'tail < -60 dBFS at its declared end', m.tailDb < -60, `${f1(m.tailDb)} dBFS`, '< -60');
    check(g, `duration ${S.dur[0] * 1000}..${S.dur[1] * 1000} ms (active, -45 dBFS)`, m.activeDurS >= S.dur[0] && m.activeDurS <= S.dur[1], `${(m.activeDurS * 1000).toFixed(0)} ms`, `${S.dur[0] * 1000}..${S.dur[1] * 1000}`);
    check(g, 'not harsh (> 6 kHz < 15%), active RMS -34..-14 dBFS, finite', m.hfFrac < 0.15 && m.activeRmsDb >= -34 && m.activeRmsDb <= -14 && m.badSamples === 0, `${f2(m.hfFrac * 100)}%, ${f1(m.activeRmsDb)} dBFS, ${m.badSamples} bad`, 'ok');
    // the whole parameter space (every flavour, piece sizes, neck lengths, calm) x 2 seeds, and 12 seeds at the canonical call
    let lo = Infinity, hi = -Infinity, mj = 0, ej = 0, hf = 0, n = 0, tail = -Infinity;
    for (const params of space[name]()) for (const sd of [1, 2]) {
      const q = await render({ ...S.spec, params, seed: 700 + 31 * n + sd, secs: S.spec.secs + (params.neckS ?? 0) });
      const mm = metrics(judged(q), SR);
      lo = Math.min(lo, mm.peakDb); hi = Math.max(hi, mm.peakDb); mj = Math.max(mj, mm.maxJump); hf = Math.max(hf, mm.hfFrac); tail = Math.max(tail, mm.tailDb);
      ej = Math.max(ej, mm.startSample, mm.endSample, mm.jumpStart, mm.jumpEnd);
      n++;
    }
    for (let sd = 1; sd <= 12; sd++) {
      const mm = metrics(judged(await render({ ...S.spec, seed: 900 + sd })), SR);
      lo = Math.min(lo, mm.peakDb); hi = Math.max(hi, mm.peakDb); mj = Math.max(mj, mm.maxJump); n++;
    }
    check(g, `every flavour / piece size / neck / calm x 2 seeds + 12 seeds (${n} renders): peak in -20..-1 dBFS, no click (max step < 0.25, edges <= 0.25), tail < -60 dBFS, > 6 kHz < 15%`, lo >= -20 && hi <= -1 && mj < 0.25 && ej <= 0.25 && tail < -60 && hf < 0.15, `peak ${f1(lo)}..${f1(hi)} dBFS, step ${f3(mj)}, edges ${f3(ej)}, worst tail ${f1(tail)} dBFS, > 6 kHz ${f2(hf * 100)}%`, 'in window');
    const hostile = { 'cut slice': { frac: 'NaN', neckS: 'Infinity', family: 42, calm: 'yes' }, 'cut pop': { frac: '-Infinity', family: null }, rejoin: { frac: 'NaN', all: 'no' }, 'rejoin all': { frac: 'Infinity', all: true, calm: 'NaN' } }[name];
    const hm = metrics((await render({ ...S.spec, params: hostile, pan: 'NaN', jitter: 'NaN' })).x, SR);
    check(g, 'hostile params (NaN/Infinity frac, neckS, family, NaN pan): finite, peak <= -1 dBFS', hm.badSamples === 0 && hm.peakDb <= -1, `${hm.badSamples} bad, ${f1(hm.peakDb)} dBFS`, 'ok');
    const pn = await render({ ...S.spec, channels: 2, pan: -1 });
    const eL = pn.chans[0].reduce((a, v) => a + v * v, 0), eR = pn.chans[1].reduce((a, v) => a + v * v, 0);
    check(g, 'pan -1: left >= 12 dB louder than right', 10 * Math.log10((eL + 1e-20) / (eR + 1e-20)) >= 12, `${f1(10 * Math.log10((eL + 1e-20) / (eR + 1e-20)))} dB`, '>= 12');
    const a1 = await render({ ...S.spec, seed: 77 }), a2 = await render({ ...S.spec, seed: 77 }), a3 = await render({ ...S.spec, seed: 78 });
    let dd = 0; for (let i = 0; i < a1.x.length; i++) dd = Math.max(dd, Math.abs(a1.x[i] - a2.x[i]));
    let s3 = 0, e3 = 0; for (let i = 0; i < a1.x.length; i++) { s3 += (a1.x[i] - a3.x[i]) ** 2; e3 += a1.x[i] ** 2; }
    check(g, 'same seed renders agree (<= 1e-4); another seed differs (norm. diff >= 0.25)', dd <= 1e-4 && Math.sqrt(s3 / e3) >= 0.25, `${dd.toExponential(1)}, ${f2(Math.sqrt(s3 / e3))}`, 'ok');
    info[name] = { peakDb: m.peakDb, rmsDb: m.activeRmsDb, durMs: m.activeDurS * 1000, hf: m.hfFrac, lo, hi, centroid: dominant(x, SR, { fLo: 60, fHi: 9000 }).centroidHz };
    const tag = name.replace(/ /g, '_');
    writeFileSync(resolve(OUT, `${tag}.wav`), wavBuffer(x, SR));
    writeFileSync(resolve(OUT, `${tag}.png`), spectrogramPng(x, SR, { title: name.toUpperCase(), win: S.win, width: 900, fMin: 40, fMax: 14000 }));
    demo.push(x);
  }

  /* ═════════════════════════ B. what the parameters do ═════════════════════════ */
  {
    const g = 'cut behaviour';
    // the slice's pitch rises as the waist thins: spectral centroid (250-5000 Hz) over the last third of the neck vs the first
    const rises = [];
    for (const f of FL) {
      const r = await render({ voice: 'cutSlice', params: { frac: 0.5, family: FAM[f], neckS: 0.3 }, seed: 61, secs: 1.2 });
      const N = 0.3, s0 = Math.round(r.t0 * SR);
      const c = (a, b) => dominant(r.x, SR, { fLo: 250, fHi: 5000, win: 1024, from: s0 + Math.round(a * N * SR), to: s0 + Math.round(b * N * SR) }).centroidHz;
      rises.push({ f, early: c(0.08, 0.38), late: c(0.62, 0.95) });
    }
    check(g, 'slice: its pitch rises as the waist thins, every flavour (centroid 250-5000 Hz over the last third of the neck / the first third >= x1.2)', rises.every((q) => q.late / q.early >= 1.2), rises.map((q) => `${q.f} ${f1(q.early)} -> ${f1(q.late)} Hz (x${f2(q.late / q.early)})`).join(', '), '>= 1.2');
    // the slice lasts the neck
    const spans = [];
    for (const N of [0.15, 0.25, 0.5, 1.0]) { const r = await render({ voice: 'cutSlice', params: { frac: 0.5, family: 'jellygel', neckS: N }, seed: 62, secs: N + 1 }); spans.push({ N, s: span(judged(r), 30) }); }
    check(g, 'slice: lasts its neckS (span within 30 dB of its loudest 10 ms: 0.7..1.0 x neckS + 0.12 s; neck 0.15 / 0.25 / 0.5 / 1.0 s)', spans.every((q) => q.s >= 0.7 * q.N && q.s <= q.N + 0.12), spans.map((q) => `${q.N}: ${f2(q.s)} s`).join(', '), '0.7 N .. N + 0.12');
    // smaller piece = higher: the pop's plup (600-3000 Hz) and the slice's band
    const pp = [];
    for (const frac of [0.125, 0.25, 0.5, 1]) {
      const r = await render({ voice: 'cutPop', params: { frac, family: 'jellygel' }, seed: 63, secs: 0.8, jitter: 1 });
      const s = await render({ voice: 'cutSlice', params: { frac, family: 'jellygel', neckS: 0.25 }, seed: 64, secs: 1.2, jitter: 1 });
      pp.push({ frac, pop: dominant(judged(r), SR, { fLo: 600, fHi: 3000 }).hz, slice: dominant(judged(s), SR, { fLo: 250, fHi: 6000 }).centroidHz });
    }
    const mono = pp.every((q, i) => i === 0 || q.pop < pp[i - 1].pop);
    check(g, 'separate: small pieces sound higher (pop plup falls monotonically from frac 1/8 to 1; 1/8 vs 1/2 >= x1.4); the slice too (centroid 1/8 vs 1/2 >= x1.15)', mono && pp[0].pop / pp[2].pop >= 1.4 && pp[0].slice / pp[2].slice >= 1.15, pp.map((q) => `${q.frac}: pop ${f1(q.pop)} Hz, slice ${f1(q.slice)} Hz`).join('; '), 'monotonic, x1.4, x1.15');
    // 1-3 tiny bubbles (1-2 when calm), every flavour, 20 seeds
    let bLo = 9, bHi = 0, cLo = 9, cHi = 0;
    for (const f of FL) for (let sd = 0; sd < 20; sd++) {
      const a = await ev('renderVoice', { voice: 'cutPop', params: { frac: 0.3, family: FAM[f] }, seed: 1100 + sd, secs: 0.05 });
      const c = await ev('renderVoice', { voice: 'cutPop', params: { frac: 0.3, family: FAM[f], calm: true }, seed: 1100 + sd, secs: 0.05 });
      bLo = Math.min(bLo, a.bubbles); bHi = Math.max(bHi, a.bubbles); cLo = Math.min(cLo, c.bubbles); cHi = Math.max(cHi, c.bubbles);
    }
    check(g, 'separate: 1-3 tiny bubbles after the pop (1-2 when calm), every flavour x 20 seeds', bLo >= 1 && bHi <= 3 && cLo >= 1 && cHi <= 2, `${bLo}..${bHi} (calm ${cLo}..${cHi})`, '1..3, calm 1..2');
    // rejoin: a bigger merged piece is lower and longer
    const rj = [];
    for (const frac of [0.125, 0.25, 0.5, 1]) { const r = await render({ voice: 'rejoin', params: { frac }, seed: 65, secs: 1.2, jitter: 1 }); const x = judged(r); rj.push({ frac, hz: dominant(x, SR, { fLo: 150, fHi: 900 }).hz, s: span(x, 30), pk: metrics(x, SR).peakDb }); }
    check(g, 'rejoin: sized by the merged fraction (frac 1/8 -> 1: the blorp\'s tone falls, x <= 0.75, monotonically; it lasts longer)', rj.every((q, i) => i === 0 || q.hz <= rj[i - 1].hz) && rj[3].hz / rj[0].hz <= 0.75 && rj[3].s > rj[0].s, rj.map((q) => `${q.frac}: ${f1(q.hz)} Hz, ${f2(q.s)} s, ${f1(q.pk)} dBFS`).join('; '), 'falls, <= 0.75, longer');
    // rejoin all: a gentle RISING flourish; not the merge ceremony burst
    const ra = await render({ voice: 'rejoin', params: { frac: 1, all: true }, seed: 66, secs: 2, jitter: 1 });
    const xa = judged(ra);
    const run = CC.REJOIN_RUN.map((mm) => 440 * Math.pow(2, (mm - 69) / 12));
    // the run's notes, each in the 60 ms after it starts (0.16 s + 65 ms per note), against its scored pitch
    const notes = run.map((f, i) => { const a = 0.16 + 0.065 * i; return { f, got: peakHzIn(xa, a + 0.008, a + 0.06, f * 0.9, f * 1.1) }; });
    const cents = notes.map((q) => 1200 * Math.log2(q.got / q.f));
    const plain = judged(await render({ voice: 'rejoin', params: { frac: 1 }, seed: 66, secs: 2, jitter: 1 }));
    check(g, 'rejoin all: whole again adds a rising flourish (its six bubbles climb D5 E5 F#5 A5 B5 D6, each within 30 cents of its note, in order) and lasts >= 0.4 s longer than a plain rejoin', cents.every((c) => Math.abs(c) <= 30) && notes.every((q, i) => i === 0 || q.got > notes[i - 1].got) && span(xa, 40) >= span(plain, 40) + 0.4, `${notes.map((q, i) => `${f1(q.got)} (${cents[i] >= 0 ? '+' : ''}${cents[i].toFixed(0)} c)`).join(', ')} Hz; span ${f2(span(xa, 40))} vs ${f2(span(plain, 40))} s`, '+/- 30 cents, rising, +0.4 s');
    // not the merge ceremony burst: no noise crack (its high-passed crack sits at 2.5-5.5 kHz in its first 30 ms), a different spectrum
    const mb = judged(await render({ voice: 'mergeBurst', params: { tier: 'common' }, seed: 67, secs: 2 }));
    const hfA = bandDb(cut(xa, 0, 0.03), 2500, 8000), hfP = bandDb(cut(plain, 0, 0.03), 2500, 8000), hfB = bandDb(cut(mb, 0, 0.03), 2500, 8000);
    const dMB = profileDist(bandProfile(xa), bandProfile(mb)), dMB2 = profileDist(bandProfile(plain), bandProfile(mb));
    check(g, 'rejoin (and whole again) does not resemble the merge ceremony burst: no crack (2.5-8 kHz energy in the first 30 ms >= 10 dB under the burst\'s, at their own levels) and a different spectrum (1/3-octave profile >= 4 dB RMS apart)', hfB - hfA >= 10 && hfB - hfP >= 10 && dMB >= 4 && dMB2 >= 4, `2.5-8 kHz in the first 30 ms: whole again ${f1(hfA - hfB)} dB, rejoin ${f1(hfP - hfB)} dB vs the burst; profile distance ${f1(dMB)} / ${f1(dMB2)} dB`, '<= -10 dB, >= 4 dB');
    info.behaviour = { rises, spans, pp, rj, notes, hfA, hfP, hfB, dMB, dMB2 };
  }

  /* ═════════════════════════ C. each family variant is distinct (CUT.md section 3) ═════════════════════════ */
  {
    const g = 'cut families';
    const avgProfile = async (voice, f, extra = {}) => {
      const ps = []; const xs = [];
      for (const sd of [71, 72, 73]) { const x = judged(await render({ voice, params: { frac: 0.4, family: FAM[f], neckS: 0.25, ...extra }, seed: sd, secs: 1.4, jitter: 1 })); ps.push(bandProfile(x)); xs.push(x); }
      return { p: ps[0].map((_, i) => ps.reduce((a, q) => a + q[i], 0) / ps.length), xs };
    };
    const sl = {}, po = {};
    for (const f of FL) { sl[f] = await avgProfile('cutSlice', f); po[f] = await avgProfile('cutPop', f); }
    const pairs = (P) => { const o = []; for (let i = 0; i < FL.length; i++) for (let j = i + 1; j < FL.length; j++) o.push({ a: FL[i], b: FL[j], d: profileDist(P[FL[i]].p, P[FL[j]].p) }); return o; };
    const ps = pairs(sl), pp = pairs(po);
    const wS = ps.reduce((a, b) => (b.d < a.d ? b : a)), wP = pp.reduce((a, b) => (b.d < a.d ? b : a));
    check(g, 'the six slice flavours are pairwise distinct (1/3-octave spectrum, 3 seeds averaged: >= 3 dB RMS apart, all 15 pairs)', wS.d >= 3, `closest ${wS.a}/${wS.b} ${f1(wS.d)} dB; all: ${ps.map((q) => `${q.a[0]}${q.b[0]} ${f1(q.d)}`).join(' ')}`, '>= 3 dB');
    check(g, 'the six separation-pop flavours are pairwise distinct (>= 2 dB RMS apart, all 15 pairs)', wP.d >= 2, `closest ${wP.a}/${wP.b} ${f1(wP.d)} dB; all: ${pp.map((q) => `${q.a[0]}${q.b[0]} ${f1(q.d)}`).join(' ')}`, '>= 2 dB');
    // the four flavours the brief names
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const spanOf = (f) => mean(sl[f].xs.map((x) => span(x, 30)));
    const cen = (f, which = sl) => mean(which[f].xs.map((x) => dominant(x, SR, { fLo: 60, fHi: 9000 }).centroidHz));
    const hiDb = (f, which = sl) => mean(which[f].xs.map((x) => bandDb(x, 2000, 9000) - bandDb(x, 60, 9000)));
    const crunch = (f) => mean(sl[f].xs.map((x) => bandOnsets(x, 2000, 4200)));
    check(g, 'sticky / slime: longer and stringier (the slice\'s span >= 1.4 x gel\'s)', spanOf('sticky') >= 1.4 * spanOf('gel'), `sticky ${f2(spanOf('sticky'))} s vs gel ${f2(spanOf('gel'))} s`, '>= 1.4x');
    check(g, 'gel: crisp (the brightest wet slice: centroid >= 1.5 x foam\'s and above sticky\'s; shorter than sticky)', cen('gel') >= 1.5 * cen('foam') && cen('gel') > cen('sticky') && spanOf('gel') < spanOf('sticky'), `centroid gel ${f1(cen('gel'))}, foam ${f1(cen('foam'))}, sticky ${f1(cen('sticky'))} Hz`, 'ok');
    check(g, 'foam: muffled (energy above 2 kHz >= 12 dB under gel\'s share, slice and pop)', hiDb('gel') - hiDb('foam') >= 12 && hiDb('gel', po) - hiDb('foam', po) >= 12, `slice ${f1(hiDb('foam'))} vs ${f1(hiDb('gel'))} dB, pop ${f1(hiDb('foam', po))} vs ${f1(hiDb('gel', po))} dB`, '>= 12 dB');
    check(g, 'beads: a slight crunch (short 2-4.2 kHz transients in the slice: >= 3 more than gel\'s)', crunch('beads') >= crunch('gel') + 3, `beads ${f1(crunch('beads'))} vs gel ${f1(crunch('gel'))}`, '>= +3');
    info.families = { slicePairs: ps, popPairs: pp, span: Object.fromEntries(FL.map((f) => [f, spanOf(f)])), centroid: Object.fromEntries(FL.map((f) => [f, cen(f)])), crunch: Object.fromEntries(FL.map((f) => [f, crunch(f)])) };
    for (const f of FL) {
      const x = judged(await render({ voice: 'cutSeq', params: { frac: 0.3, family: FAM[f], neckS: f === 'firm' ? 0.4 : 0.25 }, seed: 74, secs: 1.6 }));
      writeFileSync(resolve(OUT, `cut_${f}.png`), spectrogramPng(x, SR, { title: `CUT ${f.toUpperCase()} (${FAM[f]}): SLICE ${f === 'firm' ? 0.4 : 0.25} S, THEN THE SEPARATION POP (FRAC 0.3)`, win: 512, width: 900, fMin: 40, fMax: 14000, marks: [{ t: 0, label: 'START' }, { t: f === 'firm' ? 0.4 : 0.25, label: 'SEPARATE' }] }));
      writeFileSync(resolve(OUT, `cut_${f}.wav`), wavBuffer(x, SR));
      demo.push(x);
    }
  }

  /* ═════════════════════════ D. calm is softer ═════════════════════════ */
  {
    const g = 'cut calm';
    const rows = [];
    const cmp = async (label, spec) => {
      let ok = true; const det = [];
      for (const sd of [81, 82, 83]) {
        const a = judged(await render({ ...spec, seed: sd })), b = judged(await render({ ...spec, params: { ...spec.params, calm: true }, seed: sd }));
        const ma = metrics(a, SR), mb = metrics(b, SR);
        const ca = dominant(a, SR, { fLo: 60, fHi: 9000 }).centroidHz, cb = dominant(b, SR, { fLo: 60, fHi: 9000 }).centroidHz;
        const pass = mb.peakDb <= ma.peakDb - 2.5 && mb.activeRmsDb <= ma.activeRmsDb - 2.5 && mb.maxJump <= ma.maxJump + 1e-4 && cb <= ca * 1.05;
        ok = ok && pass; det.push({ dPk: mb.peakDb - ma.peakDb, dRms: mb.activeRmsDb - ma.activeRmsDb, step: [ma.maxJump, mb.maxJump], cen: [ca, cb] });
      }
      rows.push({ label, ok, det });
    };
    for (const f of FL) { await cmp(`slice ${f}`, { voice: 'cutSlice', params: { frac: 0.4, family: FAM[f], neckS: 0.25 }, secs: 1.2 }); await cmp(`pop ${f}`, { voice: 'cutPop', params: { frac: 0.4, family: FAM[f] }, secs: 0.8 }); }
    await cmp('rejoin', { voice: 'rejoin', params: { frac: 0.5 }, secs: 1.2 });
    await cmp('rejoin all', { voice: 'rejoin', params: { frac: 1, all: true }, secs: 2 });
    const worstPk = Math.max(...rows.flatMap((q) => q.det.map((d) => d.dPk))), worstRms = Math.max(...rows.flatMap((q) => q.det.map((d) => d.dRms)));
    check(g, 'calm is softer for every voice and flavour (3 seeds each): peak and active RMS >= 2.5 dB lower, no sharper edge (max step <= normal), no brighter (centroid <= 1.05 x)', rows.every((q) => q.ok), `worst: peak ${f1(worstPk)} dB, RMS ${f1(worstRms)} dB; ${rows.filter((q) => !q.ok).map((q) => q.label).join(', ') || 'all pass'}`, '<= -2.5 dB');
    info.calm = rows;
  }

  /* ═════════════════════════ E. rate limiting: 10 cuts in 2 s do not pile up ═════════════════════════ */
  {
    const g = 'cut rate limit';
    const calls = []; for (let k = 0; k < 10; k++) { calls.push({ t: 10 + 0.2 * k, kind: 'slice' }); calls.push({ t: 10.25 + 0.2 * k, kind: 'pop' }); }
    const L = await ev('cutLimiterRun', calls);
    const sl = L.out.filter((q) => q.kind === 'slice' && q.out !== null), po = L.out.filter((q) => q.kind === 'pop' && q.out !== null);
    check(g, 'pure limiter: 10 cuts in 2 s (start + separate each) -> at most 5 slices and 5 pops play, each later one softer than the first', sl.length <= 5 && po.length <= 5 && sl.length >= 3 && sl.slice(1).every((q) => q.out < 1) && po.slice(1).every((q) => q.out < 1), `slices ${sl.map((q) => f2(q.out)).join(' ')}; pops ${po.map((q) => f2(q.out)).join(' ')}`, '<= 5 each, softening');
    const L2 = await ev('cutLimiterRun', [...[0, 0.05, 0.1, 0.15, 0.2, 0.25].map((d) => ({ t: 20 + d, kind: 'rejoin' })), { t: 20.3, kind: 'all' }, { t: 20.5, kind: 'all' }, { t: 23, kind: 'rejoin' }, { t: 23, kind: 'slice' }]);
    const o2 = L2.out.map((q) => (q.out === null ? 'skip' : f2(q.out)));
    check(g, 'pure limiter: 6 rejoins in 0.25 s (Reconnect all of 6 pieces) -> at most 3 play; the whole-again flourish always plays, but not twice within 0.6 s; after 3 s of quiet everything is back at full level', L2.out.slice(0, 6).filter((q) => q.out !== null).length <= 3 && L2.out[6].out === 1 && L2.out[7].out === null && L2.out[8].out === 1 && L2.out[9].out === 1, o2.join(' '), '<= 3, all, skip, 1, 1');
    // the real engine (offline, no music): 10 cuts within 2 s against one cut alone
    const run = async (events) => { const r = await ev('runEngineOffline', { secs: 3.5, seed: 91, musicOn: false, events, want: ['mix'] }); return { ...r, mix: decCh(r.stems.mix) }; };
    const one = [{ t: 0.3, op: 'cut', a: { phase: 'start', frac: 0.4, neckS: 0.25, family: 'jellygel' } }, { t: 0.55, op: 'cut', a: { phase: 'separate', frac: 0.4, family: 'jellygel' } }];
    const ten = []; for (let k = 0; k < 10; k++) { ten.push({ t: 0.3 + 0.2 * k, op: 'cut', a: { phase: 'start', frac: 0.4, neckS: 0.25, family: k % 2 ? 'slimegoo' : 'jellygel' } }); ten.push({ t: 0.55 + 0.2 * k, op: 'cut', a: { phase: 'separate', frac: 0.4, family: k % 2 ? 'slimegoo' : 'jellygel' } }); }
    const r1 = await run(one), r10 = await run(ten);
    const loud = (x) => { let b = 0; for (let s = 0; s + 0.5 * SR <= x.length; s += 0.05 * SR) b = Math.max(b, rmsOf(x.subarray(s, s + 0.5 * SR))); return dbOf(b); };
    const p1 = dbOf(peakOf(r1.mix)), p10 = dbOf(peakOf(r10.mix)), l1 = loud(r1.mix), l10 = loud(r10.mix);
    const maxLive = Math.max(...r10.statLog.map((q) => q[4]));
    const st = r10.final.stats.started;
    check(g, 'real engine, 10 cuts in 2 s: no pile-up (peak <= one cut\'s + 3 dB and <= -1 dBFS; loudest 0.5 s RMS <= one cut\'s + 4 dB; <= 4 voice groups alive at once; at most 5 slices and 5 pops played)', p10 <= p1 + 3 && p10 <= -1 && l10 <= l1 + 4 && maxLive <= 4 && st.cut <= 5 && st.cutPop <= 5 && r10.errors === 0, `peak ${f1(p10)} vs ${f1(p1)} dBFS, 0.5 s RMS ${f1(l10)} vs ${f1(l1)} dBFS, max live ${maxLive}, played ${st.cut} slices / ${st.cutPop} pops, throttled ${r10.final.throttled.cut}`, 'ok');
    writeFileSync(resolve(OUT, 'cut_storm.png'), spectrogramPng(cut(r10.mix, 0.2, 3.3), SR, { title: '10 CUTS IN 2 S (START + SEPARATE EACH, GEL / SLIME), REAL ENGINE: THE LIMITER THINS AND SOFTENS THEM', win: 1024, width: 1100, fMin: 40, fMax: 14000, marks: ten.filter((q) => q.a.phase === 'start').map((q) => ({ t: q.t - 0.2, label: 'CUT' })) }));
    writeFileSync(resolve(OUT, 'cut_storm.wav'), wavBuffer(cut(r10.mix, 0.2, 3.3), SR));
    info.rate = { p1, p10, l1, l10, maxLive, started: { cut: st.cut, cutPop: st.cutPop }, throttled: r10.final.throttled };
  }

  /* ═════════════════════════ F. room in the music and separation from it (real engine, isolated placements) ═════════════════════════ */
  const placements = (seed, t0, t1, gap) => {
    const r = mul32(seed);
    const ev2 = [], spans = [];
    let t = t0;
    const kinds = ['cutSeq', 'cutSeq', 'cutSeq', 'cutPop', 'rejoin', 'rejoin', 'rejoinAll'];
    while (t < t1 - 3) {
      const k = kinds[Math.floor(r() * kinds.length)];
      const fam = Object.values(FAM)[Math.floor(r() * 6)], frac = U(r, 0.125, 0.5), pan = U(r, -0.6, 0.6), calm = r() < 0.25;
      let end;
      if (k === 'cutSeq') {
        const N = fam === 'popdome' ? U(r, 0.35, 0.45) : U(r, 0.18, 0.35);
        ev2.push({ t, op: 'cut', a: { phase: 'start', frac, neckS: N, family: fam, pan, calm } }, { t: t + N, op: 'cut', a: { phase: 'separate', frac, family: fam, pan, calm } });
        spans.push({ kind: 'cut', at: t, len: N, fam, calm }, { kind: 'cutPop', at: t + N, len: 0.2, fam, calm });
        end = t + N + 0.6;
      } else if (k === 'cutPop') {
        ev2.push({ t, op: 'cut', a: { phase: 'separate', frac, family: fam, pan, calm } }); spans.push({ kind: 'cutPop', at: t, len: 0.2, fam, calm }); end = t + 0.3;
      } else if (k === 'rejoin') {
        const m = U(r, 0.25, 1);
        ev2.push({ t, op: 'rejoin', a: { frac: m, pan, calm } }); spans.push({ kind: 'rejoin', at: t, len: 0.25 + 0.3 * m, fam: `frac ${f2(m)}`, calm }); end = t + 0.9;
      } else {
        ev2.push({ t, op: 'rejoin', a: { frac: 1, all: true, pan, calm } }); spans.push({ kind: 'rejoinAll', at: t, len: 1.25, fam: 'all', calm }); end = t + 1.4;
      }
      t = end + U(r, gap[0], gap[1]);
    }
    return { ev: ev2, spans };
  };
  const isoRun = async (seed, ps, secs, music) => {
    const s = placements(ps, 6, secs - 4, [8, 9.5]);
    const r = await ev('runEngineOffline', { secs, seed, music, events: s.ev, want: ['music', 'fx'] });
    const ref = await ev('runEngineOffline', { secs, seed, music, events: [], want: ['music'] });
    const mu = decCh(r.stems.music), fx = decCh(r.stems.fx), rm = decCh(ref.stems.music);
    const muK = kWeight(mu), fxK = kWeight(fx), refK = kWeight(rm);
    const Q = 128 / SR, rows = [];
    for (const sp of s.spans) {
      const call = Math.ceil(sp.at / Q - 1e-9) * Q;
      const at = call + 0.004;
      const end = Math.min(at + sp.len + 0.02, secs - 0.1);
      const sep = separation(fx, mu, fxK, muK, at, end);
      const ex = exposure(fxK, muK, refK, call, end);
      rows.push({ seed, kind: sp.kind, fam: sp.fam, calm: sp.calm, at, ...sep, exposedMs: ex.ms });
    }
    return { rows, errors: r.errors, mu, fx };
  };
  const where = (q) => `${q.kind} ${q.fam}${q.calm ? ' calm' : ''} @${f2(q.at)} s, engine seed ${q.seed}`;
  {
    const g = 'cut: separation from the music (real engine, music 0.45)';
    const rows = [];
    let errors = 0;
    for (const [seed, ps] of [[22, 801], [33, 802], [44, 803]]) { const o = await isoRun(seed, ps, 200, 0.45); rows.push(...o.rows); errors += o.errors; }
    const worst = (k) => rows.reduce((a, b) => (b[k] < a[k] ? b : a));
    const ws = worst('inband'), wk = worst('K'), wa = worst('A');
    const by = {}; for (const q of rows) (by[q.kind] ??= []).push(q);
    const per = Object.entries(by).map(([k, v]) => `${k} (${v.length}) ${f1(Math.min(...v.map((q) => q.inband)))}/${f1(Math.min(...v.map((q) => q.K)))}/${f1(Math.min(...v.map((q) => q.A)))}`).join(', ');
    check(g, `in-band: every slice, separation pop and rejoin >= 8 dB above the music in its own band (${rows.length} placements, 3 engine seeds x 200 s, each onto music at full level, every family, calm included)`, ws.inband >= 8 && errors === 0, `worst ${f1(ws.inband)} dB (${where(ws)}, bands ${ws.bands.join('/')} Hz); median ${f1(pct(rows.map((q) => q.inband), 0.5))} dB`, '>= 8 dB');
    check(g, 'loudness: K-weighted effect over music over its own loudest 20 ms frames >= 10 LU, every placement', wk.K >= 10, `worst ${f1(wk.K)} LU (${where(wk)}); median ${f1(pct(rows.map((q) => q.K), 0.5))} LU; per kind (worst in-band dB / LU / A dB): ${per}`, '>= 10 LU');
    check(g, '(info, not gated) A-weighted effect over music over the same frames', true, `worst ${f1(wa.A)} dB (${where(wa)}); ${rows.filter((q) => q.A < 10).length}/${rows.length} under 10 dB`, 'reported');
    const ex = Object.entries(by).map(([k, v]) => ({ k, max: Math.max(...v.map((q) => q.exposedMs)), p50: pct(v.map((q) => q.exposedMs), 0.5), n: v.length }));
    const exDesc = (list) => list.map((q) => `${q.k} ${q.max.toFixed(0)} (median ${q.p50.toFixed(0)}, n ${q.n})`).join(', ');
    const fast = ex.filter((q) => q.k !== 'cut'), slow = ex.filter((q) => q.k === 'cut');
    check(g, 'exposed gate: the music is never >= 8 dB down more than 40 ms before the effect is within 10 dB of its own peak (separation pop, rejoin, whole again; max over every placement, ms)', fast.length === 3 && fast.every((q) => q.max <= 40), exDesc(fast), '<= 40 ms');
    // the slice builds over its neck like the toss: the music makes way as it is first heard (its onset, ~-20 dB); a dip that
    // waited until it is within 10 dB (0.3 of the neck) cost the in-band gate (9.0 dB at music 0.45, 1.3 dB at music 1)
    check(g, '(info, not gated) exposed gate of the slice (it builds over the neck; its dip starts at its onset)', true, exDesc(slow), 'reported');
    info.sep = rows.map((q) => ({ ...q, bands: undefined }));
    info.exposure = ex;
  }
  {
    const g = 'cut: separation from the music (real engine, music 1 = +6 dB)';
    const o = await isoRun(55, 805, 160, 1);
    const rows = o.rows;
    const ws = rows.reduce((a, b) => (b.inband < a.inband ? b : a)), wk = rows.reduce((a, b) => (b.K < a.K ? b : a)), wa = rows.reduce((a, b) => (b.A < a.A ? b : a));
    check(g, `music volume 1: in-band still >= 8 dB for every placement (${rows.length}, engine seed 55 x 160 s; K- and A-weighted reported)`, ws.inband >= 8 && o.errors === 0, `worst in-band ${f1(ws.inband)} dB (${where(ws)}); worst K ${f1(wk.K)} LU (${where(wk)}), ${rows.filter((q) => q.K < 10).length}/${rows.length} under 10 LU; worst A ${f1(wa.A)} dB`, '>= 8 dB');
    info.sepHi = rows.map((q) => ({ ...q, bands: undefined }));
  }

  /* ═════════════════════════ G. for the first listener: a cut-and-reconnect story over the music ═════════════════════════ */
  {
    const evs = [];
    let t = 4;
    for (const [fam, N, frac] of [['jellygel', 0.25, 0.5], ['slimegoo', 0.3, 0.3], ['beadsqueeze', 0.25, 0.2], ['marshmallow', 0.25, 0.4], ['popdome', 0.4, 0.25], ['putty', 0.3, 0.15]]) {
      evs.push({ t, op: 'cut', a: { phase: 'start', frac, neckS: N, family: fam } }, { t: t + N, op: 'cut', a: { phase: 'separate', frac, family: fam } });
      t += 1.6;
    }
    t += 1;
    for (const m of [0.3, 0.55, 0.8]) { evs.push({ t, op: 'rejoin', a: { frac: m } }); t += 1.1; }
    evs.push({ t, op: 'rejoin', a: { frac: 1, all: true } });
    const r = await ev('runEngineOffline', { secs: t + 7, seed: 11, events: evs, want: ['mix'] });
    const mix = decCh(r.stems.mix);
    const marks = evs.map((q) => ({ t: q.t - 3, label: q.op === 'cut' ? (q.a.phase === 'start' ? 'CUT' : 'SEP') : q.a.all ? 'ALL' : 'REJOIN' }));
    writeFileSync(resolve(OUT, 'cut_story_mix.wav'), wavBuffer(mix, SR));
    writeFileSync(resolve(OUT, 'cut_story_mix.png'), spectrogramPng(cut(mix, 3, t + 3), SR, { title: 'CUT & RECONNECT OVER THE MUSIC (REAL ENGINE): GEL, SLIME, BEADS, MARSHMALLOW, POP DOME, PUTTY, THEN 3 REJOINS AND WHOLE AGAIN', win: 2048, width: 1400, fMin: 40, fMax: 14000, marks }));
    const gap = new Float32Array(SR / 2);
    const parts = []; for (const d of demo) parts.push(d, gap);
    const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    writeFileSync(resolve(OUT, 'cut_voices.wav'), wavBuffer(all, SR));
  }
  return info;
}
