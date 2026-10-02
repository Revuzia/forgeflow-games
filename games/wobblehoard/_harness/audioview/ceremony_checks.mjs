// Round-2 gates: meter-full, capsule beats, tier reveals, merge ceremony, duck, full ceremonies (DESIGN.md section 6).
// Called by probe_audio.mjs with the page and the check() collector. Everything here is measured from rendered samples.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  metrics, dominant, pitchTrack, frameSpectrum, avgSpectrum, spectralPeaks, spectralSpread, spectrogramPng, wavBuffer,
  centroidTrack, median, trackAt,
} from './analysis.mjs';

const SR = 48000;

function dec(r) {
  const buf = Buffer.from(r.channels[0], 'base64');
  return { ...r, x: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4).slice() };
}
const cut = (x, from, to) => x.slice(Math.max(0, Math.round(from * SR)), Math.min(x.length, Math.round(to * SR)));
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const maxOf = (a) => a.reduce((p, q) => Math.max(p, q), -Infinity);
const minOf = (a) => a.reduce((p, q) => Math.min(p, q), Infinity);

/** Dominant spectral peak of x[t0..t1) inside [fLo, fHi] (Hann, zero padded to 32768, parabolic interpolation). */
function peakHz(x, t0, t1, fLo, fHi) {
  const n = Math.round((t1 - t0) * SR), nfft = 32768, df = SR / nfft;
  const p = frameSpectrum(x, Math.round(t0 * SR), n, nfft);
  let best = Math.floor(fLo / df);
  for (let k = Math.floor(fLo / df); k <= Math.floor(fHi / df); k++) if (p[k] > p[best]) best = k;
  const a = Math.log(p[best - 1] + 1e-30), b = Math.log(p[best] + 1e-30), c = Math.log(p[best + 1] + 1e-30);
  const d = 0.5 * (a - c) / (a - 2 * b + c);
  return (best + (Number.isFinite(d) ? d : 0)) * df;
}

/** The `n` strongest spectral peaks inside [fLo, fHi] of the averaged spectrum of x[t0..t1). */
function strongestPeaks(x, t0, t1, fLo, fHi, n = 2) {
  const seg = cut(x, t0, t1);
  const sp = avgSpectrum(seg, SR, { win: 16384 });
  return spectralPeaks(sp.P, sp.df, { fLo, fHi, relDb: -60, promDb: 6 }).sort((a, b) => b.p - a.p).slice(0, n);
}

export async function ceremonyChecks(env) {
  const { page, check, OUT } = env;
  const render = async (spec) => dec(await page.evaluate((s) => window.AV.renderVoice(s), spec));
  const ceremony = async (spec) => dec(await page.evaluate((s) => window.AV.renderCeremony(s), spec));
  const onsetsOf = (tier, durationS, calm, burst) => page.evaluate(([a, b, c, d]) => window.AV.noteOnsets(a, b, c, d), [tier, durationS, calm, burst]);
  const K = await page.evaluate(() => window.AV.consts);
  const TIERS = K.TIERS;
  const judged = (r) => cut(r.x, r.t0, Math.min(r.n / SR, r.endTime + 0.05));
  const info = {};

  /** Render one item wet (and dry at t0 = 0 for voices) and collect its metrics. */
  async function item(label, spec, { ceremonySpec = null } = {}) {
    const r = ceremonySpec ? await ceremony(ceremonySpec) : await render(spec);
    const x = judged(r);
    const m = metrics(x, SR);
    let jump = Math.max(m.startSample, m.endSample, m.jumpStart, m.jumpEnd);
    if (!ceremonySpec) {
      const d = await render({ ...spec, chain: false, t0: 0 });
      const md = metrics(cut(d.x, 0, Math.min(d.n / SR, d.endTime + 0.05)), SR);
      jump = Math.max(jump, md.startSample, md.endSample, md.jumpStart, md.jumpEnd);
    }
    return { label, spec, r, x, m, jump };
  }

  /** G2 + the extra sanity checks over a class of items, reported as worst case. */
  function classGate(group, items, { hfMax = 0.15, rms = [-34, -14], minDur = null, maxDur = null, hfNote = '' } = {}) {
    const worst = (fn, pick) => { const v = items.map((i) => [fn(i), i.label]); return v.reduce((a, b) => (pick(b[0], a[0]) ? b : a)); };
    const [pkMin, pkMinL] = worst((i) => i.m.peakDb, (a, b) => a < b), [pkMax, pkMaxL] = worst((i) => i.m.peakDb, (a, b) => a > b);
    check(group, `${items.length} renders: peak -20..-1 dBFS`, pkMin >= -20 && pkMax <= -1, `${f1(pkMin)} (${pkMinL}) .. ${f1(pkMax)} (${pkMaxL}) dBFS`, '-20..-1');
    const [dc, dcL] = worst((i) => Math.abs(i.m.dc), (a, b) => a > b);
    check(group, '|DC| < 0.01', dc < 0.01, `${dc.toExponential(2)} (${dcL})`, '< 0.01');
    const [jp, jpL] = worst((i) => i.jump, (a, b) => a > b);
    check(group, 'no sample jump > 0.25 at start/end', jp <= 0.25, `${f3(jp)} (${jpL})`, '<= 0.25');
    const [tl, tlL] = worst((i) => i.m.tailDb, (a, b) => a > b);
    check(group, 'tail < -60 dBFS at the end', tl < -60, `${f1(tl)} (${tlL})`, '< -60');
    const [hf, hfL] = worst((i) => i.m.hfFrac, (a, b) => a > b);
    check(group, `energy above 6 kHz < ${hfMax * 100}%${hfNote}`, hf < hfMax, `${(hf * 100).toFixed(2)}% (${hfL})`, `< ${hfMax * 100}%`);
    const [rLo, rLoL] = worst((i) => i.m.activeRmsDb, (a, b) => a < b), [rHi] = worst((i) => i.m.activeRmsDb, (a, b) => a > b);
    check(group, `active RMS ${rms[0]}..${rms[1]} dBFS`, rLo >= rms[0] && rHi <= rms[1], `${f1(rLo)} (${rLoL}) .. ${f1(rHi)}`, `${rms[0]}..${rms[1]}`);
    const [bad] = worst((i) => i.m.badSamples, (a, b) => a > b);
    check(group, 'no NaN/Inf samples', bad === 0, bad, '0');
    const [st, stL] = worst((i) => i.m.maxJump, (a, b) => a > b);
    check(group, 'max sample-to-sample step < 0.25 (no clicks)', st < 0.25, `${f3(st)} (${stL})`, '< 0.25');
    if (minDur !== null) {
      const [dMin, dMinL] = worst((i) => i.m.activeEndS, (a, b) => a < b);
      check(group, `non-silent >= ${minDur * 1000} ms`, dMin >= minDur, `${(dMin * 1000).toFixed(0)} ms (${dMinL})`, `>= ${minDur * 1000}`);
    }
    if (maxDur !== null) {
      const [dMax, dMaxL] = worst((i) => i.m.activeEndS, (a, b) => a > b);
      check(group, `no audio longer than ${maxDur * 1000} ms`, dMax <= maxDur, `${(dMax * 1000).toFixed(0)} ms (${dMaxL})`, `<= ${maxDur * 1000}`);
    }
  }

  /* ───────────────────────── 1. meter full ───────────────────────── */
  {
    const g = 'ceremony meterFull';
    const normal = await item('normal', { voice: 'meterFull', seed: 21, jitter: 1, secs: 0.8 });
    const quiet = await item('quiet', { voice: 'meterFull', seed: 21, jitter: 1, secs: 0.8, params: { quiet: true } });
    classGate(g, [normal, quiet], { minDur: 0.1, maxDur: 0.22 });
    const d = normal.m.activeEndS;
    check(g, 'about 180 ms (active 162..198 ms, +/-10%)', d >= 0.162 && d <= 0.198, `${(d * 1000).toFixed(0)} ms`, '162..198');
    check(g, 'quiet is >= 4 dB lower in peak and RMS', normal.m.peakDb - quiet.m.peakDb >= 4 && normal.m.activeRmsDb - quiet.m.activeRmsDb >= 4, `${f1(normal.m.peakDb - quiet.m.peakDb)} dB peak, ${f1(normal.m.activeRmsDb - quiet.m.activeRmsDb)} dB RMS`, '>= 4');
    const f_a = peakHz(normal.x, 0.006, 0.07, 400, 1100), f_b = peakHz(normal.x, 0.085, 0.14, 600, 1400);
    check(g, 'two notes rise by a fifth (x1.498 +/-3%)', Math.abs(f_b / f_a - 1.498) < 0.045, `${f1(f_a)} -> ${f1(f_b)} Hz (x${f3(f_b / f_a)})`, '1.45..1.54');
    info.meterFull = { activeMs: d * 1000, peak: normal.m.peakDb, quietPeak: quiet.m.peakDb, f_a, f_b };
    writeFileSync(resolve(OUT, 'meterFull.png'), spectrogramPng(normal.x, SR, { title: 'METER FULL', win: 512, width: 700 }));
    writeFileSync(resolve(OUT, 'meterFull.wav'), wavBuffer(normal.x, SR));
  }

  /* ───────────────────────── 2. capsule beats ───────────────────────── */
  {
    const g = 'ceremony capsule beats';
    const g0 = await item('grab p0.1', { voice: 'grab', seed: 22, jitter: 1, secs: 0.6, params: { progress: 0.1 } });
    const g9 = await item('grab p0.9', { voice: 'grab', seed: 22, jitter: 1, secs: 0.6, params: { progress: 0.9 } });
    const cr = await item('crack', { voice: 'crack', seed: 23, jitter: 1, secs: 0.4 });
    const bursts = [];
    for (const tier of TIERS) bursts.push(await item(`burst ${tier}`, { voice: 'capBurst', seed: 24, jitter: 1, secs: 1, params: { tier } }));
    classGate(g, [g0, g9, cr, ...bursts], { rms: [-34, -14], maxDur: 0.5 });
    const fLo = dominant(g0.x, SR, { fLo: 300, fHi: 3000, win: 2048 }).hz, fHi = dominant(g9.x, SR, { fLo: 300, fHi: 3000, win: 2048 }).hz;
    check(g, 'grab: progress 0.9 squeaks higher than 0.1 (x >= 1.4)', fHi / fLo >= 1.4, `${f1(fLo)} -> ${f1(fHi)} Hz (x${f2(fHi / fLo)})`, '>= 1.4');
    const tk = pitchTrack(g0.x, SR, { win: 1024, hop: 120, nfft: 8192, fLo: 300, fHi: 1800, relDb: 6, floorDb: -50 });
    const a = trackAt(tk, 0.01, 0.04), b = trackAt(tk, 0.1, 0.16);
    check(g, 'grab: soft squeak rises within the call (late/early >= 1.15)', b / a >= 1.15, `${f1(a)} -> ${f1(b)} Hz (x${f2(b / a)})`, '>= 1.15');
    check(g, 'grab and crack are short (<= 0.3 s and <= 80 ms)', g0.m.activeEndS <= 0.3 && cr.m.activeEndS <= 0.08, `${(g0.m.activeEndS * 1000).toFixed(0)} ms / ${(cr.m.activeEndS * 1000).toFixed(0)} ms`, '<= 300 / <= 80');
    // the tier is NEVER audible before the burst: grab and crack ignore it (bit-identical renders whatever tier is passed)
    let same = true;
    for (const tier of TIERS) {
      const a1 = await render({ voice: 'grab', seed: 22, jitter: 1, secs: 0.6, chain: false, t0: 0, params: { progress: 0.5, tier } });
      const a0 = await render({ voice: 'grab', seed: 22, jitter: 1, secs: 0.6, chain: false, t0: 0, params: { progress: 0.5 } });
      const c1 = await render({ voice: 'crack', seed: 23, jitter: 1, secs: 0.4, chain: false, t0: 0, params: { tier } });
      const c0 = await render({ voice: 'crack', seed: 23, jitter: 1, secs: 0.4, chain: false, t0: 0 });
      for (const [p, q] of [[a1, a0], [c1, c0]]) for (let i = 0; i < p.x.length; i++) if (Math.abs(p.x[i] - q.x[i]) > 1e-4) { same = false; break; }
    }
    check(g, 'grab and crack render the same whatever tier argument is passed (tier is not audible before the burst)', same, same ? 'identical (<= 1e-4, Chromium float noise) for 6 tiers' : 'DIFFERENT', 'identical');
    // the burst: pop (click) at the start + a tier cue that differs per tier
    let minDiff = Infinity, pair = '';
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const A = bursts[i].x, B = bursts[j].x, n = Math.min(A.length, B.length);
      let s = 0, e = 0; for (let k = 0; k < n; k++) { s += (A[k] - B[k]) ** 2; e += A[k] * A[k]; }
      const d = Math.sqrt(s / Math.max(e, 1e-20));
      if (d < minDiff) { minDiff = d; pair = `${TIERS[i]}/${TIERS[j]}`; }
    }
    check(g, 'burst cues differ pairwise between tiers (norm. RMS difference >= 0.3)', minDiff >= 0.3, `${f2(minDiff)} (${pair})`, '>= 0.3');
    const pk = bursts.map((b) => b.m.peakDb), rm = bursts.map((b) => b.m.activeRmsDb);
    check(g, 'burst cues: tier loudness within 3 dB (peak and RMS)', maxOf(pk) - minOf(pk) <= 3 && maxOf(rm) - minOf(rm) <= 3, `peak ${pk.map(f1).join('/')}, RMS ${rm.map(f1).join('/')}`, '<= 3 dB');
    const click = bursts.map((b) => { const o = b.m.activeStartS; return cut(b.x, o, o + 0.006).reduce((q, v) => Math.max(q, Math.abs(v)), 0); });
    check(g, 'burst: starts with the pop click (first 6 ms peak >= 0.15 for every tier)', minOf(click) >= 0.15, `min ${f3(minOf(click))}`, '>= 0.15');
    info.capsule = { grabHz: [fLo, fHi], burstPeaks: pk, burstRms: rm };
    for (const b of bursts) writeFileSync(resolve(OUT, `capsule_burst_${b.label.split(' ')[1]}.wav`), wavBuffer(b.x, SR));
    writeFileSync(resolve(OUT, 'capsule_crack.png'), spectrogramPng(cr.x, SR, { title: 'CAPSULE CRACK', win: 256, width: 700 }));
  }

  /* ───────────────────────── 3. reveal ───────────────────────── */
  const base = (tier, extra = {}) => ({ voice: 'reveal', seed: 31, jitter: 1, secs: 8, params: { tier, ...(extra.params ?? {}) }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'params')) });
  const rev = [];
  for (const tier of TIERS) rev.push(await item(`reveal ${tier}`, base(tier)));
  {
    const g = 'ceremony reveal';
    // hf: the shimmer is small (< 15% held for every reveal; the 20% allowance was not needed)
    classGate(g, rev, { hfNote: ' (Rare/Mythic shimmer included)' });
    // durations: default = what is left of the DESIGN 6.1 capsule budget
    const endS = rev.map((r) => r.m.activeEndS);
    const dflt = K.REVEAL_DEFAULT_S;
    const err = endS.map((e, i) => e / dflt[i]);
    check(g, 'default durations: audible end within +/-10% of the requested durationS (all six)', err.every((v) => v >= 0.9 && v <= 1.1), endS.map((e, i) => `${TIERS[i][0]}:${e.toFixed(2)}/${dflt[i]}`).join(' '), '0.9..1.1');
    check(g, 'nothing longer than DESIGN 6.1 capsule budgets', endS.every((e, i) => e <= K.CAPSULE_BUDGET_S[i]), endS.map((e, i) => `${e.toFixed(2)}<=${K.CAPSULE_BUDGET_S[i]}`).join(' '), 'each <= budget');
    // requested durations = the six DESIGN 6.1 capsule budgets, and calm/other lengths
    const rq = [];
    for (let i = 0; i < 6; i++) rq.push(await item(`reveal ${TIERS[i]} @${K.CAPSULE_BUDGET_S[i]}s`, base(TIERS[i], { params: { tier: TIERS[i], durationS: K.CAPSULE_BUDGET_S[i] } })));
    const rqErr = rq.map((r, i) => r.m.activeEndS / K.CAPSULE_BUDGET_S[i]);
    check(g, 'durationS = the six DESIGN 6.1 budgets (1.6/2.0/2.6/3.2/3.9/4.5 s): audible end within +/-10%', rqErr.every((v) => v >= 0.9 && v <= 1.1), rq.map((r, i) => `${TIERS[i][0]}:${r.m.activeEndS.toFixed(2)}`).join(' '), '0.9..1.1');
    check(g, '... and never longer than the budget it was given (+25 ms)', rq.every((r, i) => r.m.activeEndS <= K.CAPSULE_BUDGET_S[i] + 0.025), rq.map((r, i) => `${(r.m.activeEndS - K.CAPSULE_BUDGET_S[i]).toFixed(3)}`).join(' '), '<= +0.025');
    const odd = [];
    for (const [i, d] of [[0, 0.4], [1, 0.7], [2, 1.2], [3, 4.0], [4, 5.5], [5, 6.5]]) odd.push(await item(`reveal ${TIERS[i]} @${d}s`, base(TIERS[i], { params: { tier: TIERS[i], durationS: d } })));
    const oddErr = odd.map((r, i) => r.m.activeEndS / [0.4, 0.7, 1.2, 4.0, 5.5, 6.5][i]);
    check(g, 'arbitrary durationS (0.4 .. 6.5 s): audible end within +/-10%', oddErr.every((v) => v >= 0.9 && v <= 1.1), odd.map((r, i) => `${TIERS[i][0]}:${f2(oddErr[i])}`).join(' '), '0.9..1.1');
    classGate('ceremony reveal (requested durations)', [...rq, ...odd], { hfMax: 0.15 });

    // escalation: monotone duration, partial count, spectral spread; loudness within 3 dB
    const parts = [], spread = [];
    for (const r of rev) {
      const sp = avgSpectrum(r.x, SR, { win: 16384 });
      parts.push(spectralPeaks(sp.P, sp.df, { relDb: -38, promDb: 8 }).length);
      spread.push(spectralSpread(sp.P, sp.df).octaves);
    }
    const mono = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
    check(g, 'escalation: audible duration rises tier by tier', mono(endS), endS.map((e) => e.toFixed(2)).join(' < '), 'strictly increasing');
    check(g, 'escalation: active partial count (spectral peaks within 38 dB) rises tier by tier', mono(parts), parts.join(' < '), 'strictly increasing');
    check(g, 'escalation: spectral spread (2%..98% energy, octaves) rises tier by tier', mono(spread), spread.map((v) => v.toFixed(2)).join(' < '), 'strictly increasing');
    const pk = rev.map((r) => r.m.peakDb), rm = rev.map((r) => r.m.activeRmsDb);
    check(g, 'escalation: loudness within 3 dB across tiers (peak and active RMS), Mythic not quieter than Common', maxOf(pk) - minOf(pk) <= 3 && maxOf(rm) - minOf(rm) <= 3 && rm[5] >= rm[0] - 0.5, `peak ${f1(minOf(pk))}..${f1(maxOf(pk))}, RMS ${f1(minOf(rm))}..${f1(maxOf(rm))}`, '<= 3 dB');
    info.reveal = { endS, parts, spread, peaks: pk, rms: rm, hf: rev.map((r) => r.m.hfFrac) };

    // intervals measured from the FFT peaks (jitter 1, pitch 1)
    const lay = async (i) => (await onsetsOf(TIERS[i], undefined, false, false));
    {
      const L1 = await lay(1);
      const p = strongestPeaks(rev[1].x, L1.onsets[0] + 0.01, L1.lay.D, 450, 900, 2).map((q) => q.f).sort((a, b) => a - b);
      const ratio = p[1] / p[0];
      check(g, 'Uncommon chime: major third (x1.260 +/-1%) between its two note peaks', p.length === 2 && Math.abs(ratio - 1.2599) < 0.0126, `${p.map(f1).join(' / ')} Hz (x${f3(ratio)})`, '1.247..1.273');
      info.uncommonThird = ratio;
    }
    {
      const L2 = await lay(2);
      const p = strongestPeaks(rev[2].x, L2.onsets[0] + 0.01, L2.lay.D, 450, 900, 2).map((q) => q.f).sort((a, b) => a - b);
      const ratio = p[1] / p[0];
      check(g, 'Rare bell cluster: perfect fifth (x1.498 +/-1%) between its two bells', p.length === 2 && Math.abs(ratio - 1.4983) < 0.015, `${p.map(f1).join(' / ')} Hz (x${f3(ratio)})`, '1.483..1.513');
      info.rareFifth = ratio;
      // 3 inharmonic partials per bell: the C5 bell's peaks near 2.76x and 5.4x are not harmonic
      const all = strongestPeaks(rev[2].x, L2.onsets[0] + 0.01, L2.lay.D, 1100, 3200, 6).map((q) => q.f);
      const near = (r, f0) => all.some((f) => Math.abs(f / f0 - r) < 0.03);
      check(g, 'Rare bell: inharmonic partials present (x2.76 and x5.4 of C5, neither an integer multiple)', near(2.76, p[0]) && near(5.4, p[0]) && !near(3.0, p[0]), all.map(f1).join(' '), '2.76 and 5.4 present');
    }
    {
      const L4 = await lay(4);
      const lo = strongestPeaks(rev[4].x, L4.onsets[0] + 0.01, L4.lay.D, 480, 570, 1)[0], hi = strongestPeaks(rev[4].x, L4.onsets[0] + 0.01, L4.lay.D, 1080, 1280, 1)[0];
      const ratio = hi.f / lo.f;
      check(g, 'Legendary bell chord: major ninth (x2.245 +/-1%) between its lowest and highest chord notes', Math.abs(ratio - 2.2449) < 0.0225, `${f1(lo.f)} / ${f1(hi.f)} Hz (x${f3(ratio)})`, '2.222..2.267');
      info.legendaryNinth = ratio;
    }
    {
      const L3 = await lay(3);
      const fr = L3.onsets.map((t) => peakHz(rev[3].x, t + 0.005, t + 0.075, 420, 1300));
      const rising = fr.every((f, i) => i === 0 || f > fr[i - 1]);
      check(g, 'Epic arpeggio: 4 notes rise and span an octave (x2.00 +/-1.5%)', rising && Math.abs(fr[3] / fr[0] - 2) < 0.03, `${fr.map(f1).join(' -> ')} Hz (x${f3(fr[3] / fr[0])})`, 'rising, 1.97..2.03');
      info.epicArp = fr;
    }
    // Mythic: three variants, three unique motifs (pitch tracks compared)
    {
      const seqs = [];
      for (let v = 0; v < 3; v++) {
        const r = await item(`reveal mythic v${v}`, base('mythic', { params: { tier: 'mythic', mythicVariant: v } }));
        const L5 = await lay(5);
        const f = L5.onsets.map((t) => peakHz(r.x, t + 0.004, t + 0.07, 300, 1400));
        seqs.push({ v, f, semis: f.map((q) => 12 * Math.log2(q / f[0])), r });
        writeFileSync(resolve(OUT, `reveal_mythic_v${v}.wav`), wavBuffer(r.x, SR));
        const tk = pitchTrack(r.x, SR, { win: 2048, hop: 480, nfft: 16384, fLo: 300, fHi: 1400, relDb: 1, floorDb: -45 });
        writeFileSync(resolve(OUT, `reveal_mythic_v${v}.png`), spectrogramPng(r.x, SR, { title: `REVEAL MYTHIC VARIANT ${v}`, win: 4096, track: tk }));
      }
      const contour = (s) => `${Math.sign(Math.round(s.semis[1]))}${Math.sign(Math.round(s.semis[2] - s.semis[1]))}`;
      let okPair = true, detail = [];
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const d = seqs[i].f.reduce((a, _, k) => a + Math.abs(12 * Math.log2(seqs[i].f[k] / seqs[j].f[k])), 0);
        const ok = contour(seqs[i]) !== contour(seqs[j]) && d >= 6;
        okPair = okPair && ok; detail.push(`v${i}/v${j}: ${d.toFixed(1)} semis`);
      }
      check(g, 'Mythic: variants 0/1/2 play pairwise different 3-note motifs (different contour, >= 6 semitones apart in total)', okPair, `${seqs.map((s) => `v${s.v}: ${s.f.map((q) => q.toFixed(0)).join('-')} Hz`).join('; ')}; ${detail.join(', ')}`, 'distinct');
      const expect = K.MYTHIC_MOTIFS;
      const match = seqs.every((s, v) => s.f.every((q, k) => Math.abs(12 * Math.log2(q / (440 * Math.pow(2, expect[v][k] / 12)))) < 0.5));
      check(g, 'Mythic: measured notes match the documented motifs (A4 + [0,7,14] / [12,5,8] / [5,12,3] semitones, +/-0.5)', match, seqs.map((s) => s.f.map((q) => (12 * Math.log2(q / 440)).toFixed(1)).join(',')).join(' | '), 'within 0.5 semitone');
      info.mythic = seqs.map((s) => ({ v: s.v, hz: s.f }));
      // the three variants share the same duration/loudness class (a unique motif is not a different tier)
      const rmsV = seqs.map((s) => s.r.m.activeRmsDb), endV = seqs.map((s) => s.r.m.activeEndS);
      check(g, 'Mythic variants: same length (+/-3%) and loudness (+/-1 dB)', maxOf(endV) / minOf(endV) < 1.03 && maxOf(rmsV) - minOf(rmsV) < 1, `${endV.map((v) => v.toFixed(2)).join('/')} s, ${rmsV.map(f1).join('/')} dB`, 'same');
      // sub-bass swell under it and the 250 ms hush: nothing but silence in the first 250 ms
      const hush = cut(seqs[0].r.x, 0, 0.24).reduce((q, v) => Math.max(q, Math.abs(v)), 0);
      check(g, 'Mythic: first 250 ms are a hush (peak < -60 dBFS; the engine ducks the master there)', dbOf(hush) < -60, `${f1(dbOf(hush))} dBFS`, '< -60');
      const sub = peakHz(seqs[0].r.x, 0.7, 1.2, 30, 90);
      check(g, 'Mythic: sub-bass swell (fundamental 50..65 Hz) under the motif', sub > 50 && sub < 65, `${f1(sub)} Hz`, '50..65');
    }
    // pre-roll swell: Rare+ have audible energy in the pre-roll window, Common/Uncommon none before the first note
    {
      const pre = [];
      for (let i = 0; i < 6; i++) { const l = await lay(i); pre.push({ P: l.lay.P, M: l.lay.M, x: cut(rev[i].x, 0.02, Math.max(0.03, l.lay.P - 0.02)) }); }
      const rmsDb = (x) => dbOf(Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length)));
      const ok = [2, 3, 4].every((i) => rmsDb(pre[i].x) > -50) && pre[0].P === 0 && pre[1].P === 0;
      check(g, 'pre-roll swell present for Rare/Epic/Legendary (0.3/0.5/0.8 s, RMS > -50 dBFS)', ok, [2, 3, 4].map((i) => `${TIERS[i][0]}:${f1(rmsDb(pre[i].x))}dB/P=${pre[i].P}`).join(' '), '> -50 dBFS');
    }
    // tierUp ladder and isNew sparkle
    {
      const up = [];
      for (const tier of TIERS) up.push(await item(`reveal ${tier} tierUp`, base(tier, { params: { tier, tierUp: true, isNew: true } })));
      classGate('ceremony reveal (tierUp + isNew)', up, { hfMax: 0.15 });
      const pcUp = up.map((r) => { const sp = avgSpectrum(r.x, SR, { win: 16384 }); return spectralPeaks(sp.P, sp.df, { relDb: -38, promDb: 8 }).length; });
      check(g, 'tierUp + isNew add partials on every tier (peak count rises)', pcUp.every((v, i) => v > parts[i]), `${parts.join(',')} -> ${pcUp.join(',')}`, 'each higher');
      // ladder: rising glissando measured on the burst variant of Common (its bloop is only 180 -> 262 Hz)
      const bu = await render({ voice: 'mergeBurst', seed: 32, jitter: 1, secs: 2, params: { tier: 'common', tierUp: true } });
      const bn = await render({ voice: 'mergeBurst', seed: 32, jitter: 1, secs: 2, params: { tier: 'common', tierUp: false } });
      const tu = pitchTrack(bu.x, SR, { win: 1024, hop: 240, nfft: 8192, fLo: 200, fHi: 3000, relDb: 0.1, floorDb: -48 });
      const tn = pitchTrack(bn.x, SR, { win: 1024, hop: 240, nfft: 8192, fLo: 200, fHi: 3000, relDb: 0.1, floorDb: -48 });
      const rat = (t) => trackAt(t, 0.3, 0.5) / trackAt(t, 0.1, 0.16);
      check(g, 'tierUp ladder: rising glissando (pitch at 0.3-0.5 s / at 0.1-0.16 s >= 2, absent without tierUp)', rat(tu) >= 2 && rat(tn) < 1.3, `with ${f2(rat(tu))}, without ${f2(rat(tn))}`, '>= 2 vs < 1.3');
      // isNew sparkle: extra energy at 2.3-4.2 kHz at the end of the motif
      const sparkNew = await render({ voice: 'reveal', seed: 31, jitter: 1, secs: 4, params: { tier: 'uncommon', isNew: true } });
      const sparkOld = await render({ voice: 'reveal', seed: 31, jitter: 1, secs: 4, params: { tier: 'uncommon' } });
      const band = (r) => { const s = avgSpectrum(cut(r.x, 0.3, 1.1), SR, { win: 8192 }); let e = 0; for (let k = Math.floor(2300 / s.df); k < Math.floor(4200 / s.df); k++) e += s.P[k]; return 10 * Math.log10(e + 1e-20); };
      check(g, 'isNew: a small sparkle (2.3-4.2 kHz energy at the last note rises >= 6 dB)', band(sparkNew) - band(sparkOld) >= 6, `+${f1(band(sparkNew) - band(sparkOld))} dB`, '>= 6');
    }
    // calm: x0.65 length, lower peak, no sudden jumps, no shimmer/whoosh
    {
      const cm = [];
      for (const tier of TIERS) cm.push(await item(`reveal ${tier} calm`, base(tier, { params: { tier, calm: true } })));
      classGate('ceremony reveal (calm)', cm, { hfMax: 0.15 });
      const shorter = cm.every((c, i) => c.m.activeEndS <= 0.7 * rev[i].m.activeEndS && c.m.activeEndS >= 0.6 * rev[i].m.activeEndS);
      check(g, 'calm: audible length x0.65 (0.60..0.70 of normal) on every tier', shorter, cm.map((c, i) => f2(c.m.activeEndS / rev[i].m.activeEndS)).join(' '), '0.60..0.70');
      check(g, 'calm: lower peak than normal on every tier', cm.every((c, i) => c.m.peakDb < rev[i].m.peakDb), cm.map((c, i) => f1(c.m.peakDb - rev[i].m.peakDb)).join(' ') + ' dB', 'all < 0');
      check(g, 'calm: softer transients (max sample step <= normal on every tier)', cm.every((c, i) => c.m.maxJump <= rev[i].m.maxJump), cm.map((c, i) => `${f3(c.m.maxJump)}/${f3(rev[i].m.maxJump)}`).join(' '), 'calm <= normal');
      check(g, 'calm: no extra brightness (energy > 6 kHz <= normal)', cm.every((c, i) => c.m.hfFrac <= rev[i].m.hfFrac + 1e-4), cm.map((c) => (c.m.hfFrac * 100).toFixed(2) + '%').join(' '), '<=');
      const cb = [];
      for (const tier of TIERS) cb.push(await item(`burst ${tier} calm`, { voice: 'capBurst', seed: 24, jitter: 1, secs: 1, params: { tier, calm: true } }));
      const nb = await Promise.all(TIERS.map((tier) => render({ voice: 'capBurst', seed: 24, jitter: 1, secs: 1, params: { tier } })));
      const peakN = nb.map((r) => metrics(judged(r), SR));
      check(g, 'calm capsule burst: lower peak and no larger sample step than normal', cb.every((c, i) => c.m.peakDb < peakN[i].peakDb && c.m.maxJump <= peakN[i].maxJump + 1e-6), cb.map((c, i) => `${f1(c.m.peakDb - peakN[i].peakDb)}dB`).join(' '), 'lower');
    }
    // PNG per tier
    for (let i = 0; i < 6; i++) {
      writeFileSync(resolve(OUT, `reveal_${TIERS[i]}.png`), spectrogramPng(rev[i].x, SR, { title: `REVEAL ${TIERS[i].toUpperCase()}`, win: 4096 }));
      writeFileSync(resolve(OUT, `reveal_${TIERS[i]}.wav`), wavBuffer(rev[i].x, SR));
    }
  }

  /* ───────────────────────── 4. merge charge + burst ───────────────────────── */
  {
    const g = 'ceremony merge';
    const ch = [];
    for (let i = 0; i < 6; i++) ch.push(await item(`merge charge ${TIERS[i]}`, { voice: 'merge', seed: 41, jitter: 1, secs: 9, params: { tier: TIERS[i] } }));
    classGate(g, ch, {});
    // dead-man: with no burst() and no stop() the charge ends by itself shortly after chargeS
    const endCh = ch.map((c) => c.m.activeEndS);
    check(g, 'charge without burst() fades by itself (audible end within chargeS .. chargeS + 0.55 s)', endCh.every((e, i) => e >= K.MERGE_CHARGE_S[i] - 0.05 && e <= K.MERGE_CHARGE_S[i] + 0.55), endCh.map((e, i) => `${e.toFixed(2)}/${K.MERGE_CHARGE_S[i]}`).join(' '), 'charge..charge+0.55');
    // hum: 80 Hz sine gliding up a perfect fifth over chargeS
    const hum = await item('merge hum only', { voice: 'merge', seed: 41, jitter: 1, secs: 6, params: { tier: 'common', layers: { squelch: false, ticks: false } } });
    const C = K.MERGE_CHARGE_S[0];
    const trk = pitchTrack(hum.x, SR, { win: 8192, hop: 480, nfft: 16384, fLo: 50, fHi: 250, relDb: 12, floorDb: -55 });
    const h0 = trackAt(trk, 0.15, 0.3), h1 = trackAt(trk, C - 0.25, C - 0.05);
    // measured at t = 0.225 s and C - 0.15 s; extrapolate the (exponential) glide to the full chargeS and back to t = 0
    const slope = Math.log(h1 / h0) / ((C - 0.15) - 0.225), total = Math.exp(slope * C), f0 = h0 / Math.exp(slope * 0.225);
    check(g, 'hum starts at 80 Hz and glides up a perfect fifth (x1.5 +/-6% over chargeS)', Math.abs(f0 - 80) < 4 && Math.abs(total - 1.5) < 0.09, `${f1(h0)} Hz @0.2 s -> ${f1(h1)} Hz @${(C - 0.15).toFixed(2)} s: start ${f1(f0)} Hz, x${f3(total)} over ${C} s`, '80 Hz, x1.41..1.59');
    // 2nd partial fades in: level of the 2nd partial relative to the fundamental rises
    const rel = (t) => { const f = trackAt(trk, t - 0.05, t + 0.05); const p = frameSpectrum(hum.x, Math.round((t - 0.12) * SR), Math.round(0.24 * SR), 32768); const df = SR / 32768; const mx = (c) => { let b = 0; for (let k = Math.floor(c * 0.96 / df); k <= Math.floor(c * 1.04 / df); k++) b = Math.max(b, p[k]); return b; }; return 10 * Math.log10(mx(2 * f) / mx(f)); };
    const r0 = rel(0.3), r1 = rel(C - 0.2);
    check(g, '2nd partial fades in (partial 2 / fundamental rises >= 6 dB from T0 to T2)', r1 - r0 >= 6, `${f1(r0)} -> ${f1(r1)} dB`, '>= +6');
    // squelch: formants rise with compression
    const sq = await item('merge squelch only', { voice: 'merge', seed: 41, jitter: 1, secs: 6, params: { tier: 'common', layers: { hum: false, ticks: false } } });
    const cen = centroidTrack(sq.x, SR, { win: 2048, hop: 480, fLo: 150, fHi: 12000, minRmsDb: -55 });
    const ce = median(cen.filter((p) => p.t >= 0.15 && p.t <= 0.5).map((p) => p.c)), cl = median(cen.filter((p) => p.t >= C - 0.5 && p.t <= C - 0.1).map((p) => p.c));
    check(g, 'squelch pitch rises with compression (centroid late / early >= 1.2)', cl / ce >= 1.2, `${f1(ce)} -> ${f1(cl)} Hz (x${f2(cl / ce)})`, '>= 1.2');
    // ticks: density rises
    const tk = await item('merge ticks only', { voice: 'merge', seed: 41, jitter: 1, secs: 6, params: { tier: 'common', layers: { hum: false, squelch: false } } });
    const win = 48, env = []; // 1 ms RMS
    for (let i = 0; i + win <= tk.x.length; i += win) { let s = 0; for (let k = 0; k < win; k++) s += tk.x[i + k] ** 2; env.push(Math.sqrt(s / win)); }
    const thr = Math.pow(10, -52 / 20);
    const ticksIn = (a, b) => { let n = 0, last = -10; for (let i = Math.floor(a / 0.001); i < Math.min(env.length, Math.floor(b / 0.001)); i++) { if (env[i] > thr && env[i] >= (env[i - 1] ?? 0) && env[i] > (env[i + 1] ?? 0) && i - last > 4) { n++; last = i; } } return n; };
    const q = C / 4, tEarly = ticksIn(0.01, 0.01 + q) / q, tLate = ticksIn(0.01 + 3 * q, 0.01 + C) / q;
    check(g, 'noise-tick density rises (late quarter >= 3x the first quarter, ticks/s)', tLate >= 3 * Math.max(tEarly, 1), `${f1(tEarly)}/s -> ${f1(tLate)}/s`, '>= 3x');
    info.merge = { endCh, hum: [h0, h1], partial2: [r0, r1], centroid: [ce, cl], ticks: [tEarly, tLate] };
    // abort
    const ab = await render({ voice: 'merge', seed: 41, jitter: 1, secs: 4, params: { tier: 'rare' }, stopAt: 0.9 });
    const abM = metrics(ab.x, SR);
    const post = cut(ab.x, ab.t0 + 0.9 + 0.15 + 0.05, ab.t0 + 3).reduce((p, v) => Math.max(p, Math.abs(v)), 0);
    check(g, 'stop() aborts with a 150 ms fade: silent 50 ms after the fade (< -70 dBFS), no click (step < 0.25)', dbOf(post) < -70 && abM.maxJump < 0.25, `${f1(dbOf(post))} dBFS, step ${f3(abM.maxJump)}`, '< -70, < 0.25');
    // burst variants (merge T3): noise transient + tier motif (+ ladder), fitted to the budget
    const bu = [];
    for (let i = 0; i < 6; i++) bu.push(await item(`merge burst ${TIERS[i]}`, { voice: 'mergeBurst', seed: 42, jitter: 1, secs: 6, params: { tier: TIERS[i], tierUp: i % 2 === 1, mythicVariant: i === 5 ? 2 : 0 } }));
    classGate('ceremony merge burst', bu, {});
    const be = bu.map((b) => b.m.activeEndS);
    check('ceremony merge burst', 'burst length within +/-10% of the budget left after the charge (MERGE_BURST_S)', be.every((e, i) => e >= 0.9 * K.MERGE_BURST_S[i] && e <= 1.1 * K.MERGE_BURST_S[i]), be.map((e, i) => `${e.toFixed(2)}/${K.MERGE_BURST_S[i]}`).join(' '), '0.9..1.1');
    {
      // noise transient: with it, the first 30 ms carry clearly more 600-4000 Hz energy than the same burst without it
      const bandDb = (x) => { const s = avgSpectrum(cut(x, 0.012, 0.045), SR, { win: 1024 }); let e = 0; for (let k = Math.floor(2500 / s.df); k < Math.floor(8000 / s.df); k++) e += s.P[k]; return 10 * Math.log10(e + 1e-20); };
      const gain = [];
      for (let i = 0; i < 6; i++) {
        const nn = await render({ voice: 'mergeBurst', seed: 42, jitter: 1, secs: 6, params: { tier: TIERS[i], tierUp: i % 2 === 1, mythicVariant: i === 5 ? 2 : 0, layers: { noise: false } } });
        gain.push(bandDb(bu[i].x) - bandDb(cut(nn.x, nn.t0, nn.endTime + 0.05)));
      }
      check('ceremony merge burst', 'opens with a noise transient (first 30 ms carry >= 6 dB more 2.5-8 kHz energy than without it, every tier)', minOf(gain) >= 6, gain.map(f1).join(' ') + ' dB', '>= 6');
    }
    // the burst reuses the reveal motif: same note frequencies as the reveal of that tier
    {
      const lb = await onsetsOf('rare', undefined, false, true);
      const p = strongestPeaks(bu[2].x, lb.onsets[0] + 0.01, lb.lay.D, 450, 900, 2).map((q) => q.f).sort((a, b) => a - b);
      check('ceremony merge burst', 'burst carries the Rare bell fifth (x1.498 +/-1.5%)', p.length === 2 && Math.abs(p[1] / p[0] - 1.4983) < 0.0225, `${p.map(f1).join(' / ')} Hz`, '1.476..1.521');
    }
    info.mergeBurst = { endS: be };
    // full ceremonies, end to end
    const cap = [], mer = [];
    for (let i = 0; i < 6; i++) {
      const c = await item(`capsule ${TIERS[i]}`, null, { ceremonySpec: { kind: 'capsule', tier: TIERS[i], seed: 51, secs: 8, isNew: i % 2 === 0, tierUp: false, mythicVariant: 1 } });
      cap.push(c);
      const m = await item(`merge ${TIERS[i]}`, null, { ceremonySpec: { kind: 'merge', tier: TIERS[i], seed: 52, secs: 9, tierUp: i >= 2, mythicVariant: 2 } });
      mer.push(m);
      writeFileSync(resolve(OUT, `ceremony_capsule_${TIERS[i]}.png`), spectrogramPng(c.x, SR, { title: `CAPSULE OPEN ${TIERS[i].toUpperCase()}`, win: 4096, marks: c.r.events.map((e) => ({ t: e.at, label: e.name })) }));
      writeFileSync(resolve(OUT, `ceremony_capsule_${TIERS[i]}.wav`), wavBuffer(c.x, SR));
      writeFileSync(resolve(OUT, `ceremony_merge_${TIERS[i]}.png`), spectrogramPng(m.x, SR, { title: `MERGE ${TIERS[i].toUpperCase()}`, win: 4096, marks: m.r.events.map((e) => ({ t: e.at, label: e.name })) }));
      writeFileSync(resolve(OUT, `ceremony_merge_${TIERS[i]}.wav`), wavBuffer(m.x, SR));
    }
    classGate('ceremony end-to-end (capsule: grab, crack, burst, reveal)', cap, { hfMax: 0.15 });
    const capEnd = cap.map((c) => c.m.activeEndS);
    check('ceremony end-to-end (capsule: grab, crack, burst, reveal)', 'audio ends inside the DESIGN 6.1 capsule budget and uses >= 90% of it', capEnd.every((e, i) => e <= K.CAPSULE_BUDGET_S[i] + 0.02 && e >= 0.9 * K.CAPSULE_BUDGET_S[i]), capEnd.map((e, i) => `${e.toFixed(2)}/${K.CAPSULE_BUDGET_S[i]}`).join(' '), '0.9..1.0 x budget');
    classGate('ceremony end-to-end (merge: mergeStart, burst)', mer, { hfMax: 0.15 });
    const merEnd = mer.map((c) => c.m.activeEndS);
    check('ceremony end-to-end (merge: mergeStart, burst)', 'audio ends inside the DESIGN 6.1 merge budget and uses >= 90% of it', merEnd.every((e, i) => e <= K.MERGE_BUDGET_S[i] + 0.02 && e >= 0.9 * K.MERGE_BUDGET_S[i]), merEnd.map((e, i) => `${e.toFixed(2)}/${K.MERGE_BUDGET_S[i]}`).join(' '), '0.9..1.0 x budget');
    // calm ceremonies
    const capC = await item('capsule mythic calm', null, { ceremonySpec: { kind: 'capsule', tier: 'mythic', calm: true, seed: 51, secs: 8 } });
    const merC = await item('merge mythic calm', null, { ceremonySpec: { kind: 'merge', tier: 'mythic', calm: true, seed: 52, secs: 9 } });
    check('ceremony end-to-end (capsule: grab, crack, burst, reveal)', 'calm Mythic capsule and merge: x0.65 of the budgets and lower peak than normal', capC.m.activeEndS <= 0.65 * 4.5 + 0.02 && merC.m.activeEndS <= 0.65 * 5.2 + 0.02 && capC.m.peakDb < cap[5].m.peakDb && merC.m.peakDb < mer[5].m.peakDb, `${capC.m.activeEndS.toFixed(2)} s (budget ${(0.65 * 4.5).toFixed(2)}), ${merC.m.activeEndS.toFixed(2)} s (${(0.65 * 5.2).toFixed(2)}); peaks ${f1(capC.m.peakDb)}/${f1(merC.m.peakDb)} vs ${f1(cap[5].m.peakDb)}/${f1(mer[5].m.peakDb)}`, 'x0.65, lower');
    info.ceremony = { capEnd, merEnd };
    writeFileSync(resolve(OUT, 'merge_charge_common.png'), spectrogramPng(ch[0].x, SR, { title: 'MERGE CHARGE COMMON (NO BURST)', win: 2048 }));
    writeFileSync(resolve(OUT, 'merge_charge_mythic.png'), spectrogramPng(ch[5].x, SR, { title: 'MERGE CHARGE MYTHIC (NO BURST)', win: 4096 }));
  }

  /* ───────────────────────── 5. duck ───────────────────────── */
  {
    const g = 'ceremony duck';
    const dk = dec(await page.evaluate(() => window.AV.renderDuck({ db: -12, ms: 300, at: 0.5, secs: 2 })));
    const win = 218; // ~ one period of the 220 Hz test tone
    const rmsAt = (t) => { const i = Math.round(t * SR); let s = 0; for (let k = 0; k < win; k++) s += dk.x[i + k] ** 2; return dbOf(Math.sqrt(s / win)); };
    const before = rmsAt(0.3), hold = rmsAt(0.5 + 0.2), after = rmsAt(1.7);
    check(g, 'duck(-12 dB, 300 ms): level drops by 12 dB (+/-1.5) while held and recovers to 0 dB (+/-0.5)', Math.abs(hold - before + 12) < 1.5 && Math.abs(after - before) < 0.5, `${f1(hold - before)} dB held, ${f1(after - before)} dB after`, '-12 +/- 1.5, 0 +/- 0.5');
    let worstRate = 0, prev = rmsAt(0.4);
    for (let t = 0.401; t < 1.5; t += 0.001) { const v = rmsAt(t); worstRate = Math.max(worstRate, Math.abs(v - prev)); prev = v; }
    check(g, 'duck is smooth: never more than 1.2 dB of level change per millisecond (no zipper)', worstRate <= 1.2, `${f2(worstRate)} dB/ms`, '<= 1.2');
    const d0 = dec(await page.evaluate(() => window.AV.renderDuck({ db: 0, ms: 300, at: 0.5, secs: 2 })));
    let stepRef = 0, stepDuck = 0;
    for (let i = 1; i < dk.x.length; i++) { stepRef = Math.max(stepRef, Math.abs(d0.x[i] - d0.x[i - 1])); stepDuck = Math.max(stepDuck, Math.abs(dk.x[i] - dk.x[i - 1])); }
    check(g, 'no discontinuity: largest sample step with the duck <= the un-ducked tone', stepDuck <= stepRef * 1.02, `${f3(stepDuck)} vs ${f3(stepRef)}`, '<=');
    const hz = dec(await page.evaluate(() => window.AV.renderDuck({ db: 'NaN', ms: 'Infinity', at: 0.2, secs: 1.5 })));
    const hm = metrics(hz.x, SR);
    check(g, 'duck with NaN db / Infinity ms: finite audio, no exception, recovers', hm.badSamples === 0 && hm.peakDb < 0, `${hm.badSamples} bad`, 'finite');
    info.duck = { hold: hold - before, worstRate };
  }

  /* ───────────────────────── 6. hostile parameters, offline ───────────────────────── */
  {
    const g = 'ceremony hostile';
    const bad = ['NaN', 'Infinity', '-Infinity'];
    const specs = [];
    for (const b of bad) {
      specs.push({ voice: 'reveal', params: { tier: 'bogus', durationS: b, mythicVariant: b }, pitch: b, pan: b });
      specs.push({ voice: 'reveal', params: { tier: 'mythic', durationS: -5, mythicVariant: 7, calm: 'yes', tierUp: 1, isNew: 'x' }, pitch: -3 });
      specs.push({ voice: 'meterFull', params: { quiet: b }, pitch: b });
      specs.push({ voice: 'grab', params: { progress: b }, pitch: b });
      specs.push({ voice: 'crack', params: {}, pitch: b });
      specs.push({ voice: 'capBurst', params: { tier: b }, pitch: b });
      specs.push({ voice: 'mergeBurst', params: { tier: b, durationS: b, mythicVariant: b }, pitch: b });
      specs.push({ voice: 'merge', params: { tier: b, chargeS: b }, pitch: b, burstAt: 0.5, burst: { tier: 'legendary', durationS: b, mythicVariant: b } });
    }
    specs.push({ voice: 'reveal', params: { tier: 'mythic', durationS: 1e9 }, secs: 3 });
    specs.push({ voice: 'merge', params: { tier: 'mythic', chargeS: 1e9 }, secs: 3 });
    let worstPk = -Infinity, bads = 0, n = 0, threw = [];
    for (const s of specs) {
      try {
        const r = await render({ seed: 61, secs: 4, ...s });
        const m = metrics(r.x, SR);
        worstPk = Math.max(worstPk, m.peakDb); bads += m.badSamples; n++;
      } catch (e) { threw.push(`${s.voice}: ${String(e).slice(0, 80)}`); }
    }
    check(g, `${specs.length} hostile renders (bogus tier, NaN/Infinity/negative durations, variants 7, strings): no exception, finite audio, peak <= -1 dBFS`, threw.length === 0 && bads === 0 && worstPk <= -1, `${threw.length} threw, ${bads} bad samples, worst peak ${f1(worstPk)} dBFS${threw.length ? ' ' + threw[0] : ''}`, 'clean');
  }
  return info;
}
