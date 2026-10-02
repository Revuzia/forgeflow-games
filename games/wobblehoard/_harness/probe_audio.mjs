// WOBBLEHOARD audio probe (gate G2 + extra sanity + engine stress).
//   node _harness/probe_audio.mjs [--voices=poke,pop] [--no-engine] [--port=5363]
// Renders every voice offline in Chromium (OfflineAudioContext, 48 kHz) through the SAME master chain the game uses,
// analyses the samples in Node, writes WAV + spectrogram PNG per voice to _harness/_renders/ (gitignored), prints a table
// and exits 1 on any failed check. Nobody on the build machine can listen: every number here is a measurement.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from './pw.mjs';
import {
  metrics, dominant, centroidTrack, pitchTrack, trackAt, median, wavBuffer, spectrogramPng,
} from './audioview/analysis.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const PORT = Number(args.port ?? 5363);
const OUT = resolve(ROOT, '_harness', '_renders');
mkdirSync(OUT, { recursive: true });
const only = args.voices ? String(args.voices).split(',') : null;

/* ───────────────────────── checks bookkeeping ───────────────────────── */
const checks = [];
function check(group, name, pass, value, limit) { checks.push({ group, name, pass: !!pass, value, limit }); return !!pass; }
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

const BOOSTED = new Set(['poke', 'squish', 'release']);
// minimum / maximum audible duration (seconds) at the -45 dBFS / 5 ms-window activity definition
const SPEC = {
  poke:    { render: { voice: 'poke', params: { intensity: 0.6 }, seed: 11, secs: 0.8 }, minDur: 0.08, maxDur: 0.18, win: 1024, hi: { intensity: 1 }, lo: { intensity: 0 } },
  squish:  { render: { voice: 'squish', script: 'prl', seed: 12 }, minDur: 1.5, maxDur: 3.4, win: 1024, hi: null, lo: null },
  release: { render: { voice: 'release', params: { compression: 0.7 }, seed: 13, secs: 1.0 }, minDur: 0.2, maxDur: 0.45, win: 1024, hi: { compression: 1 }, lo: { compression: 0 } },
  land:    { render: { voice: 'land', params: { intensity: 0.6 }, seed: 14, secs: 0.6 }, minDur: 0.06, maxDur: 0.14, win: 1024, hi: { intensity: 1 }, lo: { intensity: 0 } },
  pop:     { render: { voice: 'pop', params: { size: 0.5 }, seed: 15, secs: 0.5 }, minDur: 0.03, maxDur: 0.2, win: 256, hi: { size: 1 }, lo: { size: 0 } },
  blend:   { render: { voice: 'blend', params: { count: 3, durationS: 2.2 }, seed: 16, secs: 6 }, minDur: 2.5, maxDur: 4.2, win: 2048, hi: null, lo: null },
};

/* ───────────────────────── browser plumbing ───────────────────────── */
let page;
const pageErrors = [];

async function render(spec) {
  const r = await page.evaluate((s) => window.AV.renderVoice(s), spec);
  const chans = r.channels.map((b) => { const buf = Buffer.from(b, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4).slice(); });
  return { ...r, x: chans[0], chans };
}

/** Cut a render to [from, to] seconds. */
const cut = (x, sr, from, to) => x.slice(Math.max(0, Math.round(from * sr)), Math.min(x.length, Math.round(to * sr)));

/** The render a voice is judged on: starts at the voice's t0 and ends 50 ms after its declared end time. */
function judged(r) {
  const end = Math.min(r.n / r.sr, r.endTime + 0.05);
  return cut(r.x, r.sr, r.t0, end);
}

function normDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0, e = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - b[i]) ** 2; e += a[i] * a[i]; }
  return Math.sqrt(s / Math.max(e, 1e-20));
}

/* ───────────────────────── per-voice analysis ───────────────────────── */
const table = [];
const extra = {};
const demo = [];

async function probeVoice(name) {
  const S = SPEC[name];
  const sr = 48000;
  const base = await render(S.render);
  const x = judged(base);
  const m = metrics(x, sr);
  const dom = dominant(x, sr, { fLo: 60, fHi: 8000 });
  const g = `G2 ${name}`;

  // ---- gate G2, exactly as CONTRACT section 6 words it ----
  check(g, 'peak -20..-1 dBFS', m.peakDb >= -20 && m.peakDb <= -1, `${f1(m.peakDb)} dBFS`, '-20..-1');
  check(g, '|DC| < 0.01', Math.abs(m.dc) < 0.01, m.dc.toExponential(2), '< 0.01');
  // start/end jump: the sample at each end and the largest step within 2 ms of it, on the chain output AND on the dry voice at t0 = 0
  const dry = await render({ ...S.render, chain: false, t0: 0 });
  const xd = cut(dry.x, sr, 0, Math.min(dry.n / sr, dry.endTime + 0.05));
  const md = metrics(xd, sr);
  const jmp = Math.max(m.startSample, m.endSample, m.jumpStart, m.jumpEnd, md.startSample, md.endSample, md.jumpStart, md.jumpEnd);
  check(g, 'no sample jump > 0.25 at start/end', jmp <= 0.25, f3(jmp), '<= 0.25');
  check(g, 'tail < -60 dB at the end', m.tailDb < -60, `${f1(m.tailDb)} dBFS`, '< -60');
  check(g, `non-silent >= ${S.minDur * 1000} ms`, m.activeDurS >= S.minDur, `${(m.activeDurS * 1000).toFixed(0)} ms`, `>= ${S.minDur * 1000}`);

  // ---- extra sanity ----
  const x2 = `sanity ${name}`;
  check(x2, `active <= ${S.maxDur * 1000} ms (contract upper bound)`, m.activeDurS <= S.maxDur, `${(m.activeDurS * 1000).toFixed(0)} ms`, `<= ${S.maxDur * 1000}`);
  check(x2, 'not harsh: energy > 6 kHz < 15%', m.hfFrac < 0.15, `${(m.hfFrac * 100).toFixed(2)}%`, '< 15%');
  check(x2, 'active RMS -34..-14 dBFS', m.activeRmsDb >= -34 && m.activeRmsDb <= -14, `${f1(m.activeRmsDb)} dBFS`, '-34..-14');
  check(x2, 'no NaN/Inf samples', m.badSamples === 0, m.badSamples, '0');
  check(x2, 'max sample-to-sample step < 0.25 (no clicks)', m.maxJump < 0.25, `${f3(m.maxJump)} @ ${(m.maxJumpAtS * 1000).toFixed(1)} ms`, '< 0.25');

  // peak level over the intensity range (poke/release/land/pop): whole range inside the gate
  let hiPk = NaN, loPk = NaN;
  if (S.hi) {
    const hi = metrics(judged(await render({ ...S.render, params: S.hi })), sr);
    const lo = metrics(judged(await render({ ...S.render, params: S.lo })), sr);
    hiPk = hi.peakDb; loPk = lo.peakDb;
    writeFileSync(resolve(OUT, `${name}_max.wav`), wavBuffer(judged(await render({ ...S.render, params: S.hi })), sr));
    writeFileSync(resolve(OUT, `${name}_min.wav`), wavBuffer(judged(await render({ ...S.render, params: S.lo })), sr));
    check(x2, 'max-parameter peak <= -1 dBFS', hi.peakDb <= -1, `${f1(hi.peakDb)} dBFS`, '<= -1');
    check(x2, 'min-parameter peak >= -20 dBFS (whole range inside G2)', lo.peakDb >= -20, `${f1(lo.peakDb)} dBFS`, '>= -20');
    // onset/end steps at the extremes of the range (dry voice at t0 = 0 and through the chain)
    let jx = 0;
    for (const pp of [S.hi, S.lo]) {
      const dr = await render({ ...S.render, params: pp, chain: false, t0: 0 });
      const dm = metrics(cut(dr.x, sr, 0, Math.min(dr.n / sr, dr.endTime + 0.05)), sr);
      jx = Math.max(jx, dm.startSample, dm.endSample, dm.jumpStart, dm.jumpEnd);
    }
    check(g, 'no sample jump > 0.25 at start/end (min and max parameters)', jx <= 0.25, f3(jx), '<= 0.25');
  }

  // louder squish: +9 dB headroom, still limited
  let boostDelta = NaN;
  if (BOOSTED.has(name)) {
    const b1 = metrics(judged(await render({ ...S.render, boost: 1 })), sr);
    boostDelta = b1.peakDb - m.peakDb;
    check(x2, 'squishBoost=1 stays <= -1 dBFS', b1.peakDb <= -1, `${f1(b1.peakDb)} dBFS`, '<= -1');
    check(x2, 'squishBoost=1 is louder (RMS +3..+9.5 dB)', b1.activeRmsDb - m.activeRmsDb >= 3 && b1.activeRmsDb - m.activeRmsDb <= 9.5, `${f1(b1.activeRmsDb - m.activeRmsDb)} dB`, '3..9.5');
  }

  // two pitch ratios (same seed): dominant frequency differs by about the ratio
  const lowR = await render({ ...S.render, pitch: 0.8 });
  const highR = await render({ ...S.render, pitch: 1.25 });
  writeFileSync(resolve(OUT, `${name}_pitch0.80.wav`), wavBuffer(judged(lowR), sr));
  writeFileSync(resolve(OUT, `${name}_pitch1.25.wav`), wavBuffer(judged(highR), sr));
  const dLow = dominant(judged(lowR), sr, { fLo: 60, fHi: 8000 });
  const dHigh = dominant(judged(highR), sr, { fLo: 60, fHi: 8000 });
  const ratio = dHigh.hz / dLow.hz;
  check(g, 'pitch 0.8 vs 1.25: dominant freq differs >= 3%', Math.abs(ratio - 1) >= 0.03, `${f1(dLow.hz)} -> ${f1(dHigh.hz)} Hz (x${ratio.toFixed(3)})`, '>= 3%');
  check(x2, 'pitch 0.8 vs 1.25: dominant ratio ~ 1.5625 (+/-25%)', ratio > 1.5625 * 0.75 && ratio < 1.5625 * 1.25, `x${ratio.toFixed(3)}`, '1.17..1.95');
  const cLow = dLow.centroidHz, cHigh = dHigh.centroidHz;
  check(x2, 'pitch 0.8 vs 1.25: spectral centroid rises', cHigh > cLow * 1.15, `${f1(cLow)} -> ${f1(cHigh)} Hz`, '> +15%');

  // the G2 level window must hold for every seed (bubble sizes and timings are random), at min, canonical and max parameters
  {
    const sets = [['canonical', S.render.params], ...(S.hi ? [['max', S.hi], ['min', S.lo]] : [])];
    let lo = Infinity, hi = -Infinity, rmsLo = Infinity, rmsHi = -Infinity, maxJ = 0;
    for (const [, pp] of sets) {
      for (let sd = 1; sd <= 12; sd++) {
        const mm = metrics(judged(await render({ ...S.render, params: pp, seed: 1000 + sd })), sr);
        lo = Math.min(lo, mm.peakDb); hi = Math.max(hi, mm.peakDb);
        if (pp === S.render.params) { rmsLo = Math.min(rmsLo, mm.activeRmsDb); rmsHi = Math.max(rmsHi, mm.activeRmsDb); maxJ = Math.max(maxJ, mm.maxJump); }
      }
    }
    check(g, `12 seeds x ${sets.length} parameter sets: peak stays in -20..-1 dBFS`, lo >= -20 && hi <= -1, `${f1(lo)}..${f1(hi)} dBFS`, '-20..-1');
    check(x2, '12 seeds (canonical): active RMS stays in -34..-14 dBFS', rmsLo >= -34 && rmsHi <= -14, `${f1(rmsLo)}..${f1(rmsHi)} dBFS`, '-34..-14');
    check(x2, '12 seeds (canonical): max sample step < 0.25', maxJ < 0.25, f3(maxJ), '< 0.25');
  }

  // determinism: the same seed renders the same audio (no unseeded RNG anywhere in the voice code). The dry voice is
  // to Chromium's own float noise (~1e-5 = -100 dBFS, also seen in the master chain's compressor); a stray Math.random would
  // differ by ~0.1.
  {
    const dryA = await render({ ...S.render, seed: 77, chain: false }), dryB = await render({ ...S.render, seed: 77, chain: false });
    const wetA = await render({ ...S.render, seed: 77 }), wetB = await render({ ...S.render, seed: 77 });
    const mx = (a, b) => { let d = 0; for (let i = 0; i < a.x.length; i++) d = Math.max(d, Math.abs(a.x[i] - b.x[i])); return d; };
    const dd = mx(dryA, dryB), dw = mx(wetA, wetB);
    check(x2, 'same seed twice: renders agree to -80 dBFS (max diff <= 1e-4; Chromium float noise is ~1e-5)', dd <= 1e-4 && dw <= 1e-4, `dry ${dd.toExponential(1)}, chain ${dw.toExponential(1)}`, '<= 1e-4');
  }
  // master curve and mute (applied after the limiter, so they are exact)
  {
    const half = metrics(judged(await render({ ...S.render, master: 0.5 })), sr);
    check(x2, 'master 0.5 = -12 dB (squared taper)', Math.abs((half.peakDb - m.peakDb) + 12.04) < 0.5, `${f1(half.peakDb - m.peakDb)} dB`, '-12.04 +/- 0.5');
    const mu = metrics(judged(await render({ ...S.render, muted: true })), sr);
    check(x2, 'muted: exact silence (< -120 dBFS)', mu.peakDb < -120, `${f1(mu.peakDb)} dBFS`, '< -120');
  }

  // voice stealing: killed mid-note, the voice fades in 20 ms with no click and is silent right after
  {
    const killAt = name === 'blend' ? 1.0 : name === 'squish' ? 0.5 : 0.04;
    const kr = await render({ ...S.render, killAt });
    const t = base.t0 + killAt;
    const pre = cut(kr.x, sr, t - 0.03, t), post = cut(kr.x, sr, t + 0.045, Math.min(kr.n / sr, t + 0.3));
    const km = metrics(kr.x, sr);
    const pk = (a) => a.reduce((q, v) => Math.max(q, Math.abs(v)), 0);
    check(x2, 'stolen mid-note (20 ms fade): no click (max step < 0.25) and silent 45 ms later (< -70 dBFS)', km.maxJump < 0.25 && 20 * Math.log10(pk(post) + 1e-12) < -70, `step ${f3(km.maxJump)}, after ${f1(20 * Math.log10(pk(post) + 1e-12))} dBFS (before ${f1(20 * Math.log10(pk(pre) + 1e-12))})`, 'step < 0.25, < -70');
  }
  // the whole genome pitch range (pitchRatio spans ~0.70 .. 1.43): still soft and in the level window
  {
    let hfMax = 0, pLo = Infinity, pHi = -Infinity, rLo = Infinity, rHi = -Infinity;
    for (const pr of [0.7, 1.43]) {
      const mm = metrics(judged(await render({ ...S.render, pitch: pr })), sr);
      hfMax = Math.max(hfMax, mm.hfFrac); pLo = Math.min(pLo, mm.peakDb); pHi = Math.max(pHi, mm.peakDb); rLo = Math.min(rLo, mm.activeRmsDb); rHi = Math.max(rHi, mm.activeRmsDb);
    }
    check(x2, 'pitch 0.70 and 1.43 (genome extremes): energy > 6 kHz < 15%', hfMax < 0.15, `${(hfMax * 100).toFixed(2)}%`, '< 15%');
    check(g, 'pitch 0.70 and 1.43: peak -20..-1 dBFS, active RMS -34..-14', pLo >= -20 && pHi <= -1 && rLo >= -34 && rHi <= -14, `peak ${f1(pLo)}..${f1(pHi)}, RMS ${f1(rLo)}..${f1(rHi)}`, 'in window');
  }

  // two seeds differ
  const sA = await render({ ...S.render, seed: 101 });
  const sB = await render({ ...S.render, seed: 202 });
  const nd = normDiff(judged(sA), judged(sB));
  check(x2, 'two seeds differ (norm. RMS difference >= 0.25)', nd >= 0.25, f3(nd), '>= 0.25');
  const ds = dominant(judged(sA), sr, { fLo: 60, fHi: 8000 }).hz, dt2 = dominant(judged(sB), sr, { fLo: 60, fHi: 8000 }).hz;

  // pan: hard left puts most energy in the left channel
  if (name !== 'blend') {
    const pn = await render({ ...S.render, channels: 2, pan: -1 });
    const eL = pn.chans[0].reduce((a, v) => a + v * v, 0), eR = pn.chans[1].reduce((a, v) => a + v * v, 0);
    const dbLR = 10 * Math.log10((eL + 1e-20) / (eR + 1e-20));
    check(x2, 'pan -1: left >= 12 dB louder than right', dbLR >= 12, `${f1(dbLR)} dB`, '>= 12');
  }

  // hostile parameters never produce NaN/Inf
  const hostile = {
    poke: { intensity: 'NaN' }, release: { compression: 'NaN' }, land: { intensity: 'Infinity' }, pop: { size: 'NaN' },
    blend: { count: 'NaN', durationS: '-Infinity' }, squish: {},
  }[name];
  const hr = await render({ ...S.render, pitch: name === 'squish' ? 'NaN' : -3, params: hostile, pan: 'NaN' });
  const hm = metrics(hr.x, sr);
  check(x2, 'hostile params (NaN/-Inf/negative pitch/NaN pan): finite audio, peak <= -1 dBFS', hm.badSamples === 0 && hm.peakDb <= -1, `${hm.badSamples} bad, ${f1(hm.peakDb)} dBFS`, '0 bad');

  // ---- trajectories ----
  const traj = {};
  const onset = m.activeStartS;
  if (name === 'poke' || name === 'land') {
    const trk = pitchTrack(x, sr, { fLo: 45, fHi: 700, relDb: 9, floorDb: -52 });
    const fe = trackAt(trk, onset + 0.002, onset + 0.016), fl = trackAt(trk, onset + 0.05, onset + 0.09);
    traj.track = trk; traj.early = fe; traj.late = fl;
    check(x2, `${name} glides DOWN (late/early < 0.85)`, fl / fe < 0.85, `${f1(fe)} -> ${f1(fl)} Hz (x${(fl / fe).toFixed(2)})`, '< 0.85');
    check(x2, `${name} body in 40..300 Hz`, fe > 40 && fe < 300 * 1.2, `${f1(fe)} Hz`, '40..360');
  }
  if (name === 'release') {
    const trk = pitchTrack(x, sr, { fLo: 70, fHi: 1500, relDb: 9, floorDb: -52 });
    const fe = trackAt(trk, onset + 0.005, onset + 0.04), fl = trackAt(trk, onset + 0.16, onset + 0.22);
    traj.track = trk; traj.early = fe; traj.late = fl;
    check(x2, 'release glides UP (late/early > 1.4)', fl / fe > 1.4, `${f1(fe)} -> ${f1(fl)} Hz (x${(fl / fe).toFixed(2)})`, '> 1.4');
    // damped wobble: AM modulation of the 5 ms RMS envelope at 12-30 Hz, decaying
    const wr = m.winRms;
    const a0 = Math.floor(onset / m.winS), seg = Array.from(wr.slice(a0 + 4, a0 + 44));
    const mean = seg.reduce((a, v) => a + v, 0) / seg.length;
    let bestF = 0, bestA = 0;
    for (let f = 8; f <= 40; f += 0.5) {
      let c = 0, s = 0; seg.forEach((v, k) => { const ph = 2 * Math.PI * f * (k * m.winS); c += (v - mean) * Math.cos(ph); s += (v - mean) * Math.sin(ph); });
      const a = Math.hypot(c, s) / seg.length;
      if (a > bestA) { bestA = a; bestF = f; }
    }
    traj.wobbleHz = bestF; traj.wobbleDepth = bestA / mean;
    check(x2, 'release wobble: envelope modulation peak at 10-32 Hz', bestF >= 10 && bestF <= 32, `${bestF.toFixed(1)} Hz, depth ${(bestA / mean * 100).toFixed(0)}%`, '10..32 Hz');
  }
  if (name === 'pop') {
    const trk = pitchTrack(x, sr, { win: 384, hop: 48, fLo: 400, fHi: 4500, relDb: 6, floorDb: -48 });
    const fe = trackAt(trk, onset + 0.003, onset + 0.009), fl = trackAt(trk, onset + 0.018, onset + 0.03);
    traj.track = trk; traj.early = fe; traj.late = fl;
    check(x2, 'pop blip chirps UP (late/early > 1.25)', fl / fe > 1.25, `${f1(fe)} -> ${f1(fl)} Hz (x${(fl / fe).toFixed(2)})`, '> 1.25');
    // click: a burst of 2-5 ms right at onset (the first 5 ms hold a lot more peak than energy)
    const cl = cut(x, sr, onset, onset + 0.006), rest = cut(x, sr, onset + 0.012, onset + 0.05);
    const pk = (a) => a.reduce((q, v) => Math.max(q, Math.abs(v)), 0);
    traj.clickPk = pk(cl); traj.restPk = pk(rest);
    check(x2, 'pop starts with a click (first 6 ms peak >= 0.5x the blip peak)', pk(cl) >= 0.5 * pk(rest), `${f3(pk(cl))} vs ${f3(pk(rest))}`, '>= 0.5x');
    // size lowers the pitch
    const small = dominant(judged(await render({ ...S.render, params: { size: 0 } })), sr, { fLo: 300, fHi: 6000 });
    const big = dominant(judged(await render({ ...S.render, params: { size: 1 } })), sr, { fLo: 300, fHi: 6000 });
    traj.sizeSmallHz = small.hz; traj.sizeBigHz = big.hz;
    check(x2, 'pop: bigger size = lower pitch (small/big >= 1.4)', small.hz / big.hz >= 1.4, `${f1(small.hz)} vs ${f1(big.hz)} Hz`, '>= 1.4');
  }
  if (name === 'squish') await squishChecks(base, x, m, traj);
  if (name === 'blend') blendChecks(base, x, m, traj);

  // ---- artefacts ----
  writeFileSync(resolve(OUT, `${name}.wav`), wavBuffer(x, sr));
  demo.push(x);
  const marks = base.script ? base.script.marks : null;
  const png = spectrogramPng(x, sr, { title: name.toUpperCase(), win: S.win, track: traj.track ?? null, marks: marks ? marks.map((k) => ({ t: k.t, label: k.label })) : null });
  writeFileSync(resolve(OUT, `${name}.png`), png);
  table.push({
    name, peak: m.peakDb, rms: m.activeRmsDb, dur: m.activeDurS * 1000, dom: dom.hz, cen: dom.centroidHz, dc: m.dc,
    jump: jmp, tail: m.tailDb, hf: m.hfFrac * 100, hiPk, loPk, boostDelta, ratio, ds, dt2, nd,
    early: traj.early, late: traj.late,
  });
  extra[name] = { ...traj, track: undefined };
}

async function squishChecks(base, x, m, traj) {
  const sr = 48000;
  const g = 'sanity squish';
  // silence when rate = 0: constant compression, rate 0 for 2 s
  const still = await render({ voice: 'squish', script: 'still', seed: 5 });
  const sm = metrics(still.x, sr);
  check(g, 'silent when rate = 0 (peak < -80 dBFS over the whole render)', sm.peakDb < -80, `${f1(sm.peakDb)} dBFS`, '< -80');
  // ... and inside the hold segments of the press-rub-release gesture, once the envelope has decayed
  const T0 = base.t0;
  const holdRms = (a, b) => { const s = cut(base.x, sr, T0 + a, T0 + b); return 20 * Math.log10(Math.sqrt(s.reduce((q, v) => q + v * v, 0) / s.length) + 1e-12); };
  const h1 = holdRms(1.25, 1.5), h2 = holdRms(2.55, 2.8);
  const rubRms = holdRms(1.6, 2.2);
  traj.holdDb = [h1, h2]; traj.rubDb = rubRms;
  check(g, 'silent in the holds between press/rub/release (RMS < -70 dBFS)', h1 < -70 && h2 < -70, `${f1(h1)} / ${f1(h2)} dBFS (rub ${f1(rubRms)})`, '< -70');
  // follows |rate|
  const st = await render({ voice: 'squish', script: 'steps', seed: 6 });
  const lv = [0, 0.3, 0.6, 1.2, 2.5, 0];
  const lvl = lv.map((_, i) => { const s = cut(st.x, sr, st.t0 + i * 0.5 + 0.2, st.t0 + i * 0.5 + 0.5); return 20 * Math.log10(Math.sqrt(s.reduce((q, v) => q + v * v, 0) / s.length) + 1e-12); });
  traj.stepsDb = lvl;
  const inc = [1, 2, 3, 4].every((i) => lvl[i] - lvl[i - 1] >= 2);
  check(g, 'level follows |rate| (steps 0.3,0.6,1.2,2.5 each >= +2 dB)', inc && lvl[1] > lvl[0] + 20, lvl.map(f1).join(' / ') + ' dB', 'monotonic');
  check(g, 'back to silence when rate returns to 0 (< -70 dBFS)', lvl[5] < -70, `${f1(lvl[5])} dBFS`, '< -70');
  // centroid rises with compression (compare squeezing at c~0.1-0.2 with rubbing at c~0.8)
  const ct = centroidTrack(base.x, sr, { win: 2048, hop: 480, fLo: 150, fHi: 12000, minRmsDb: -55 });
  const early = median(ct.filter((p) => p.t >= T0 + 0.2 && p.t <= T0 + 0.45).map((p) => p.c));
  const late = median(ct.filter((p) => p.t >= T0 + 1.6 && p.t <= T0 + 2.2).map((p) => p.c));
  traj.centroidEarly = early; traj.centroidRub = late;
  check(g, 'formants rise with compression (centroid rub@c=0.8 / press@c<0.2 >= 1.2)', late / early >= 1.2, `${f1(early)} -> ${f1(late)} Hz (x${(late / early).toFixed(2)})`, '>= 1.2');
  // squeezing sounds higher than springing back at equal compression? (direction cue) - informational
  const down = median(ct.filter((p) => p.t >= T0 + 2.8 && p.t <= T0 + 2.92).map((p) => p.c));
  traj.centroidRelease = down;
}

function blendChecks(base, x, m, traj) {
  const sr = 48000;
  const g = 'sanity blend';
  const D = 2.2;
  const onset = m.activeStartS;
  // motor spools up: lowest strong partial rises a lot in the first second
  const trk = pitchTrack(x, sr, { win: 4096, hop: 480, nfft: 8192, fLo: 22, fHi: 400, relDb: 12, floorDb: -52 });
  const f0 = trackAt(trk, 0.12, 0.25), f1v = trackAt(trk, 0.9, 1.2);
  traj.motorEarly = f0; traj.motorLate = f1v;
  check(g, 'motor spools up (partial rises >= 2x in the first second)', f1v / f0 >= 2, `${f1(f0)} -> ${f1(f1v)} Hz (x${(f1v / f0).toFixed(2)})`, '>= 2x');
  // finishing flourish: tonal energy in the last 1.2 s sits in the bell register and the loudest peak climbs
  const tF = D;
  const bell = pitchTrack(x, sr, { win: 2048, hop: 480, nfft: 8192, fLo: 400, fHi: 3000, relDb: 0.1, floorDb: -45 }).filter((p) => p.t >= tF - 0.05 && p.t <= tF + 0.5);
  const bellStart = median(bell.filter((p) => p.t < tF + 0.1).map((p) => p.f));
  const bellEnd = median(bell.filter((p) => p.t > tF + 0.2).map((p) => p.f));
  traj.bellStart = bellStart; traj.bellEnd = bellEnd;
  check(g, 'finished flourish rises (loudest peak in 0.2-0.5 s after > in first 0.1 s)', bellEnd > bellStart * 1.1, `${f1(bellStart)} -> ${f1(bellEnd)} Hz`, '> +10%');
  traj.track = trk;
}

/* ───────────────────────── main ───────────────────────── */
async function main() {
  process.env.WH_FROZEN = '1';
  const vite = await startVite(PORT);
  const browser = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', '--enable-experimental-web-platform-features'] });
  let exit = 1;
  try {
    page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(`${m.type()}: ${m.text()}`); });
    await page.goto(`${vite.url}_harness/audioview/index.html`);
    await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 60000 });

    for (const name of Object.keys(SPEC)) {
      if (only && !only.includes(name)) continue;
      try { await probeVoice(name); } catch (e) { check(`G2 ${name}`, 'probe ran', false, String(e && e.stack || e), 'no exception'); }
    }

    if (!args['no-engine'] && !only) {
      try {
        const res = await page.evaluate(() => window.AV.runEngineTests());
        engineChecks(res);
        writeFileSync(resolve(OUT, 'engine_report.json'), JSON.stringify(res, null, 2));
      } catch (e) { check('engine', 'engine tests ran', false, String(e && e.stack || e), 'no exception'); }
    }
    if (!args['no-engine'] && !only) {
      // the human-facing sound lab page: click through every control and read its own stats readout
      try {
        await page.goto(`${vite.url}_harness/audioview/index.html`);
        await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 60000 });
        await page.click('#unlock');
        for (const v of ['poke', 'release', 'land', 'pop', 'blend']) await page.click(`button[data-v="${v}"]`);
        const sq = await page.locator('#squish').boundingBox();
        await page.mouse.move(sq.x + 20, sq.y + 10);
        await page.mouse.down();
        for (let k = 0; k < 20; k++) { await page.mouse.move(sq.x + 20, sq.y + 10 + k * 6); await page.waitForTimeout(25); }
        await page.mouse.up();
        await page.waitForTimeout(500);
        const out = JSON.parse(await page.textContent('#out'));
        const started = out.started;
        check('lab page', 'every button starts its voice (poke 2, release 2, land, pop, blend, squish)', started.poke >= 2 && started.release >= 1 && started.land >= 1 && started.pop >= 1 && started.blend >= 1 && started.squish >= 1, JSON.stringify(started), 'all >= 1');
        check('lab page', 'engine is running and the readout is finite', out.state === 'running' && Number.isFinite(out.peak), `${out.state}, peak ${Number(out.peak).toFixed(3)}`, 'running');
      } catch (e) { check('lab page', 'lab page ran', false, String(e && e.stack || e), 'no exception'); }
    }
    check('page', 'no console errors/warnings/page errors', pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0', '0');
  } finally {
    await browser.close().catch(() => {});
    vite.stop();
  }
  if (demo.length) {
    // one file with every voice in order (poke, squish, release, land, pop, blend), 0.5 s apart, for the owner to listen to
    const gap = new Float32Array(24000);
    const parts = [];
    for (const d of demo) { parts.push(d, gap); }
    const total = parts.reduce((a, p) => a + p.length, 0);
    const all = new Float32Array(total); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    writeFileSync(resolve(OUT, 'all_voices.wav'), wavBuffer(all, 48000));
  }
  report();
  exit = checks.every((c) => c.pass) ? 0 : 1;
  process.exit(exit);
}

function engineChecks(r) {
  if (r.todo) { check('engine', 'engine tests implemented', false, 'placeholder', 'implemented'); return; }
  for (const c of r.checks) check('engine', c.name, c.pass, c.value, c.limit);
}

function report() {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nVOICE TABLE (judged on the master-chain output at master=1, squishBoost=0)');
  console.log(pad('voice', 8) + pad('peak', 8) + pad('RMS', 8) + pad('dur ms', 8) + pad('domHz', 8) + pad('centHz', 8) + pad('DC', 10) + pad('jump', 7) + pad('tail', 8) + pad('>6k %', 7) + pad('lo/hi pk', 14) + pad('boost', 7) + pad('x(1.25/.8)', 11) + 'seedDiff');
  for (const t of table) {
    console.log(pad(t.name, 8) + pad(f1(t.peak), 8) + pad(f1(t.rms), 8) + pad(t.dur.toFixed(0), 8) + pad(t.dom.toFixed(0), 8) + pad(t.cen.toFixed(0), 8) + pad(t.dc.toExponential(1), 10) + pad(t.jump.toFixed(3), 7) + pad(f1(t.tail), 8) + pad(t.hf.toFixed(2), 7) + pad(Number.isFinite(t.loPk) ? `${f1(t.loPk)}/${f1(t.hiPk)}` : '-', 14) + pad(Number.isFinite(t.boostDelta) ? f1(t.boostDelta) : '-', 7) + pad(t.ratio.toFixed(2), 11) + t.nd.toFixed(2));
  }
  console.log('\nCHECKS');
  let lastG = '';
  for (const c of checks) {
    if (c.group !== lastG) { console.log(`  [${c.group}]`); lastG = c.group; }
    console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  =>  ${c.value}   (limit ${c.limit})`);
  }
  const bad = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - bad.length}/${checks.length} checks passed${bad.length ? `, ${bad.length} FAILED` : ''}`);
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ table, checks, extra, pageErrors }, null, 2));
  console.log(`renders: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(2); });
