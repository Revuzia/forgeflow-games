// PLAYGROUND audio gates (PG_AUDIO; PLAYGROUND_BUILD.md 18, AU-01..AU-14): the creature voices, the chatter and ambience buses, the
// ChatterLimiter through the engine, musicClock, the Music Box and the kettle, the prop voices and the ambience bed. OfflineAudioContext
// renders in headless Chromium (a heavy job: one at a time, on port 5367). Nobody has listened to any of it: every number is a
// measurement.
//
//   node _harness/audioview/life_checks.mjs [--port=5367] [--only=AU-07,AU-01] [--baseline]
//   --baseline   writes au07_baseline.json (the hashes of the existing seeded renders); run it ONLY on a tree whose existing audio
//                (engine, chain, music, voices, ceremony, interact, cut, dsp) is what shipped before PLAYGROUND
//
// Exported for probe_audio.mjs too: lifeChecks({ page, check, OUT }).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics, pitchTrack, trackAt, frameSpectrum } from './analysis.mjs';
import { kWeight, separation, pct } from './room_checks.mjs';
import { placements, sparseScenario } from './play_scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, 'au07_baseline.json');

/* ═══════════════════════════════ AU-07: the existing seeded renders, hashed ═══════════════════════════════ */

/** The effect script of the AU-07 engine renders: every existing one-shot, the held squish and strand, the cut and the ceremonies. */
function au07Events() {
  const ev = [
    { t: 2.0, op: 'poke', a: { intensity: 0.6, pitch: 1.1 } },
    { t: 3.0, op: 'pop', a: { size: 0.4 } },
    { t: 4.0, op: 'land', a: { intensity: 0.7 } },
    { t: 5.0, op: 'bump', a: { intensity: 0.5, pan: -0.3 } },
    { t: 6.0, op: 'lift', a: { pitch: 0.9 } },
    { t: 7.0, op: 'toss', a: { speed: 0.6 } },
    { t: 8.0, op: 'release', a: { compression: 0.7 } },
    { t: 9.0, op: 'squishStart', id: 1, a: { pitch: 1 } },
  ];
  for (let t = 9.02; t < 10.6; t += 1 / 60) ev.push({ t, op: 'squishUpdate', id: 1, a: { compression: 0.5 + 0.3 * Math.sin(t * 3), rate: 0.8 * Math.cos(t * 3) } });
  ev.push({ t: 10.6, op: 'squishEnd', id: 1, a: { fade: 0.1 } });
  for (let t = 11.0; t < 12.2; t += 1 / 60) ev.push({ t, op: 'strand', a: { tension: Math.min(0.9, (t - 11) * 0.8) } });
  ev.push({ t: 12.2, op: 'strand', a: { tension: 0.9, snap: true } });
  ev.push({ t: 13.0, op: 'blend', a: { count: 3, durationS: 1.5 } });
  ev.push({ t: 16.0, op: 'meterFull', a: {} });
  ev.push({ t: 16.6, op: 'capsuleBeat', a: { beat: 'crack' } });
  ev.push({ t: 17.4, op: 'cut', a: { phase: 'start', frac: 0.35, family: 'slimegoo' } });
  ev.push({ t: 17.7, op: 'cut', a: { phase: 'separate', frac: 0.35, family: 'slimegoo' } });
  ev.push({ t: 18.6, op: 'rejoin', a: { frac: 0.35 } });
  ev.push({ t: 19.6, op: 'rejoin', a: { frac: 1, all: true } });
  ev.push({ t: 21.0, op: 'reveal', a: { tier: 'rare', isNew: true } });
  return ev;
}

const dec = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };

/** Render the AU-07 set on `page` (audioview/index.html loaded): { name: { x: Float32Array, dry: boolean } }. `dry` = no master-chain
 *  limiter in the path (the engine's music and fx taps, the dry voices). Measured 2026-11-16, same code twice: chain renders differ by up
 *  to 4.35e-5, dry ones by up to 1.16e-5 (most under 3e-8). */
export async function au07Renders(page) {
  const out = {};
  const events = au07Events();
  const e1 = await page.evaluate((s) => window.AV.runEngineOffline(s), { secs: 26, seed: 11, events, want: ['mix', 'music', 'fx'] });
  for (const k of ['mix', 'music', 'fx']) out[`engine_music_${k}`] = { x: dec(e1.stems[k]), dry: k !== 'mix' };
  const e2 = await page.evaluate((s) => window.AV.runEngineOffline(s), { secs: 24, seed: 7, musicOn: false, events, want: ['mix', 'fx'] });
  for (const k of ['mix', 'fx']) out[`engine_nomusic_${k}`] = { x: dec(e2.stems[k]), dry: k !== 'mix' };
  const e3 = await page.evaluate((s) => window.AV.runEngineOffline(s), { secs: 40, seed: 0x57a15b00, events: [], want: ['mix', 'music'] });
  out.engine_default_mix_40s = { x: dec(e3.stems.mix), dry: false };
  out.engine_default_music_40s = { x: dec(e3.stems.music), dry: true };
  for (const [v, params, seed, secs] of [['poke', { intensity: 0.6 }, 11, 0.8], ['land', { intensity: 0.6 }, 14, 0.6], ['pop', { size: 0.5 }, 15, 0.5], ['release', { compression: 0.7 }, 13, 1.0], ['blend', { count: 3, durationS: 2.2 }, 16, 6]]) {
    const r = await page.evaluate((s) => window.AV.renderVoice(s), { voice: v, params, seed, secs });
    out[`voice_${v}`] = { x: dec(r.channels[0]), dry: false };
    const d = await page.evaluate((s) => window.AV.renderVoice(s), { voice: v, params, seed, secs, chain: false });
    out[`voice_${v}_dry`] = { x: dec(d.channels[0]), dry: true };
  }
  const m = await page.evaluate((s) => window.AV.renderMusic(s), { secs: 40, seed: 3 });
  out.music_bed_seed3 = { x: dec(m.channels[0]), dry: false };
  const c = await page.evaluate((s) => window.AV.renderCeremony(s), { kind: 'capsule', tier: 'rare', seed: 5, secs: 6 });
  out.ceremony_capsule_rare = { x: dec(c.channels[0]), dry: false };
  return out;
}

/** A durable fingerprint of a render: the energy of every 0.1 s block (7 significant digits) and the length. */
const fingerprint = (x) => { const B = 4800, e = []; for (let i = 0; i < x.length; i += B) { let s = 0; for (let j = i; j < Math.min(x.length, i + B); j++) s += x[j] * x[j]; e.push(Number(s.toPrecision(7))); } return { n: x.length, e }; };
const diff = (a, b) => { const n = Math.max(a.length, b.length); let mx = 0, s = 0, en = 0; for (let i = 0; i < n; i++) { const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0)); if (d > mx) mx = d; s += d * d; en += (a[i] ?? 0) ** 2; } return { maxAbs: mx, relRms: Math.sqrt(s / Math.max(en, 1e-30)) }; };
/** AU-07's bars (re-specified, written reason in _handoff/reports/PG_AUDIO.md: this Chromium's offline renders are not bit-exact run to
 *  run, even for unchanged code): a render through the master chain within 1e-4 of the pre-PLAYGROUND render (2.3x the largest same-code
 *  run-to-run difference measured at the baseline, 4.35e-5, the rare capsule), a render with no limiter in its path within 5e-5 (largest
 *  same-code difference 1.16e-5, the engine's fx stem; most are under 3e-8). An rng shift, a moved note or a changed gain moves a render by
 *  1e-3 or more. Without the local baseline renders (a fresh container), the fingerprint: every 0.1 s block's energy within 1e-3 relative
 *  (blocks above 1e-9). */
const AU07_TOL = { chain: 1e-4, dry: 5e-5, fpRel: 1e-3 };
const BASE_DIR = (OUT) => resolve(OUT, 'au07_base');


/* ═══════════════════════════════ helpers ═══════════════════════════════ */
const SR = 48000;
const E = 60 / 66 / 2;                                   // the eighth (s)
const SYL_LEN = [0.09, 0.16, 0.18, 0.22, 0.165, 0.5, 0.16, 0.045];
const SYL_NAME = ['chirp', 'coo', 'purr', 'hum', 'trill', 'yawn', 'chitter', 'peep'];
const FLAV = ['gel', 'sticky', 'foam', 'beads', 'dough', 'firm'];
const PENTA = [2, 4, 6, 9, 11];
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const peakOf = (a, i0 = 0, i1 = a.length) => { let p = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
const rmsOf = (a, i0 = 0, i1 = a.length) => { let s = 0, n = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i] * a[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
const midiOfHz = (f) => 69 + 12 * Math.log2(f / 440);
const stepOf = (m) => Math.floor(m / 12) * 5 + PENTA.indexOf(((m % 12) + 12) % 12);
const midiOfStep = (s) => Math.floor(s / 5) * 12 + PENTA[((s % 5) + 5) % 5];
/** The syllable's landing note and the window (fractions of its length) where it is measured. */
function landing(id, note) {
  if (id === 4) return { m: midiOfStep(stepOf(note) + 2), w: [0.72, 0.95] };     // trill: three notes up, the last one
  if (id === 2 || id === 3 || id === 7) return { m: note, w: [0.2, 0.8] };       // purr, hum (vibrato averages out), peep: flat
  if (id === 6) return { m: note, w: [0.78, 0.95] };                              // chitter: the last of four falling notes
  return { m: note, w: [0.85, 0.97] };                                            // chirp, coo, yawn land on their note
}
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
const run = (page, spec) => page.evaluate((s) => window.AV.runEngineOffline(s), spec);
const phrase = (syl, o = {}) => ({ phrase: syl.flat(), n: syl.length, flavour: 0, register: 0, pitch: 1, pan: 0, level: 1, ...o });

async function auChecks(page, check, want, extra) {
  /* ── AU-01: every syllable x flavour (wholes) and the peep (pieces): level band, no click, tail, on D pentatonic within 10 cents ── */
  if (want('AU-01')) {
    const rows = [];
    for (let fl = 0; fl < 6; fl++) for (let id = 0; id < 8; id++) {
      const reg = id === 7 ? 1 : 0;
      const len = SYL_LEN[id];
      const r = await page.evaluate((s) => window.AV.renderPhrases(s), { secs: 0.05 + len + 0.35, phrases: [{ at: 0.05, syl: [[id, 0, 0, 1]], flavour: fl, register: reg, pitch: 1 }] });
      const x = dec(r.channels[0]);
      const m = metrics(x, SR);
      const pk = dbOf(peakOf(x));
      const endI = Math.round((0.05 + len + 0.06) * SR);
      const tail = dbOf(rmsOf(x, endI, x.length));
      const note = r.meta[0].notes[0], L = landing(id, note);
      const tr = pitchTrack(x, SR, { win: id === 7 ? 512 : 768, hop: 60, fLo: 300, fHi: 2600, relDb: 12, floorDb: -70 });
      const f = trackAt(tr, 0.05 + L.w[0] * len, 0.05 + L.w[1] * len);
      const cents = 100 * (midiOfHz(f) - L.m);
      rows.push({ fl: FLAV[fl], syl: SYL_NAME[id], reg, pk, jump: m.maxJump, tail, cents, m: L.m });
    }
    const wh = rows.filter((q) => !q.reg), pc = rows.filter((q) => q.reg);
    const pkW = wh.map((q) => q.pk), pkP = pc.map((q) => q.pk);
    check('AU-01', 'whole syllables peak inside -28..-20 dBFS at Voices 100% (LIFE 8.4: at most -20), 42 = 7 shapes x 6 flavours', pkW.every((v) => v <= -20 && v >= -28), `${f1(Math.min(...pkW))}..${f1(Math.max(...pkW))} dBFS`, '-28..-20');
    check('AU-01', 'piece peeps 7 dB lower (inside -35..-27 dBFS), 6 flavours', pkP.every((v) => v <= -27 && v >= -35), `${f1(Math.min(...pkP))}..${f1(Math.max(...pkP))} dBFS`, '-35..-27');
    const jw = Math.max(...rows.map((q) => q.jump));
    check('AU-01', 'no click: the largest sample step < 0.25 (48 renders)', jw < 0.25, jw.toExponential(2), '< 0.25');
    const tw = Math.max(...rows.map((q) => q.tail));
    check('AU-01', 'tail under -60 dB from 60 ms after the syllable', tw < -60, `${f1(tw)} dBFS`, '< -60');
    const bad = rows.filter((q) => !(Math.abs(q.cents) <= 10));
    check('AU-01', 'on D pentatonic: each syllable lands on its snapped note within +-10 cents', bad.length === 0, bad.length ? bad.slice(0, 6).map((q) => `${q.fl}/${q.syl} ${f1(q.cents)}c`).join(', ') : `worst ${f1(Math.max(...rows.map((q) => Math.abs(q.cents))))} cents`, '<= 10 cents');
    extra.au01 = rows;
    // a syllable after a hum (whose vibrato is a detune curve) and after a firm scoop still lands on its note (the hum's curve once left
    // its last value, -14 cents, on the rest of the phrase)
    const after = [];
    for (const fl of [0, 5]) {
      const r = await page.evaluate((s2) => window.AV.renderPhrases(s2), { secs: 1.2, chain: false, phrases: [{ at: 0.05, syl: [[3, 0, 0, 1], [3, 1, 0.3, 1], [0, 2, 0.6, 1]], flavour: fl }] });
      const x = dec(r.channels[0]);
      for (const [k, st, id] of [[1, 0.3, 3], [2, 0.6, 0]]) {
        const d = SYL_LEN[id], L = landing(id, r.meta[0].notes[k]);
        const tr = pitchTrack(x, SR, { win: 768, hop: 60, fLo: 300, fHi: 2600, relDb: 12, floorDb: -70 });
        after.push(100 * (midiOfHz(trackAt(tr, 0.05 + st + L.w[0] * d, 0.05 + st + L.w[1] * d)) - L.m));
      }
    }
    check('AU-01', 'a syllable after a hum lands on its note too (gel and firm, within 10 cents)', after.every((c) => Math.abs(c) <= 10), after.map((c) => f1(c)).join(', '), '<= 10 cents');
  }
  /* ── AU-02: the six flavours pairwise at least 3 dB apart in at least one third-octave band ── */
  if (want('AU-02')) {
    const prof = [];
    for (let fl = 0; fl < 6; fl++) {
      const r = await page.evaluate((s) => window.AV.renderPhrases(s), { secs: 1.2, chain: false, phrases: [{ at: 0.05, syl: [[0, 0, 0, 1], [1, 1, 0.15, 1], [3, 2, 0.36, 1]], flavour: fl }] });
      prof.push(bandProfile(dec(r.channels[0])));
    }
    let worst = { d: Infinity };
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
      const ma = Math.max(...prof[a]), mb = Math.max(...prof[b]);
      let d = 0;
      for (let i = 0; i < prof[a].length; i++) if (prof[a][i] > ma - 40 || prof[b][i] > mb - 40) d = Math.max(d, Math.abs(Math.max(prof[a][i], ma - 40) - Math.max(prof[b][i], mb - 40)));
      if (d < worst.d) worst = { d, a: FLAV[a], b: FLAV[b] };
    }
    check('AU-02', 'the 6 flavours pairwise >= 3 dB apart in at least one third-octave band (15 pairs, the same 3-syllable phrase)', worst.d >= 3, `closest ${worst.a}/${worst.b}: ${f1(worst.d)} dB`, '>= 3 dB');
  }
  /* ── AU-11: nodes per syllable, the leak test, the caller's reused object ── */
  if (want('AU-11')) {
    let worst = 0, worstE = 0, where = '';
    for (let fl = 0; fl < 6; fl++) for (const reg of [0, 1]) for (const group of [1, 2, 3]) for (const pan of [0, 0.6]) {
      const r = await page.evaluate((s) => window.AV.renderPhrases(s), { secs: 0.3, chain: false, phrases: [{ at: 0.02, syl: [[reg ? 7 : 0, 0, 0, 1]], flavour: fl, register: reg, group, pan, echo: true }] });
      const q = r.meta[0];
      if (q.nodes > worst) { worst = q.nodes; where = `${FLAV[fl]} reg ${reg} group ${group} pan ${pan}`; }
      worstE = Math.max(worstE, q.echoNodes);
    }
    check('AU-11', 'at most 4 nodes per syllable: a ONE-syllable phrase of every flavour x register x group x pan, and its echo', worst <= 4 && worstE <= 4, `worst ${worst} (${where}), echo ${worstE}`, '<= 4');
    const lk = await page.evaluate((s) => window.AV.phraseLeak(s), { count: 2100, secs: 60 });
    check('AU-11', `${lk.syllables} syllables (2100 phrases) return to the baseline node count`, lk.syllables >= 5000 && lk.after === lk.base && lk.built > lk.base, `base ${lk.base}, built ${lk.built}, after ${lk.after}`, '>= 5000 syllables, after == base');
    // the caller reuses one p object and one phrase array: scrambling them right after the call changes nothing scheduled
    const evs = (op) => [0.6, 1.4, 2.2, 3.0].map((t, i) => ({ t, op, a: phrase([[0, 0, 0, 1], [1, i - 1, 0.15, 1], [3, 1, 0.36, 1]], { flavour: i % 6, at: 0, echo: i === 2, pan: 0.3 * (i - 1.5) }) }));
    const A = await run(page, { secs: 4.5, seed: 21, musicOn: false, taps: true, preload: true, want: ['chatter'], events: evs('creature'), recordReturns: true });
    const B = await run(page, { secs: 4.5, seed: 21, musicOn: false, taps: true, preload: true, want: ['chatter'], events: evs('creatureMut'), recordReturns: true });
    const a = dec(A.stems.chatter), b = dec(B.stems.chatter);
    let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i]));
    const okA = A.rets.filter((q) => q[2] === true).length, okB = B.rets.filter((q) => q[2] === true).length;
    check('AU-11', 'scrambling the reused p object and phrase array right after creature() changes nothing already scheduled', okA === 4 && okB === 4 && peakOf(a) > 1e-3 && mx <= 5e-5, `4 phrases played (${okA}/${okB}); max |diff| ${mx.toExponential(2)}`, '<= 5e-5');
  }
  /* ── AU-12: the echo ── */
  if (want('AU-12')) {
    const ph = { at: 0.05, syl: [[3, 0, 0, 1]], flavour: 0 };
    const r1 = await page.evaluate((s) => window.AV.renderPhrases(s), { secs: 1, chain: false, phrases: [{ ...ph, echo: true }] });
    const r0 = await page.evaluate((s) => window.AV.renderPhrases(s), { secs: 1, chain: false, phrases: [ph] });
    const x1 = dec(r1.channels[0]), x0 = dec(r0.channels[0]);
    const ec = x1.map((v, i) => v - x0[i]);
    const on = (x, thr) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr) return i / SR; return NaN; };
    const pm = peakOf(x0), pe = peakOf(ec);
    const lag = on(ec, pm * 0.02) - on(x0, pm * 0.02);
    const lv = dbOf(rmsOf(ec, Math.round((0.05 + 0.22 + 0.03) * SR), Math.round((0.05 + 0.22 + 0.19) * SR))) - dbOf(rmsOf(x0, Math.round(0.08 * SR), Math.round(0.24 * SR)));
    const after = dbOf(peakOf(x1, Math.round((0.05 + 0.22 + 0.22 + 0.08) * SR)));
    check('AU-12', 'one repeat at +220 ms (onset lag within 1 ms)', Math.abs(lag - 0.22) <= 0.001, `${(lag * 1000).toFixed(2)} ms`, '220 +- 1 ms');
    check('AU-12', 'the repeat is -12 dB (RMS of the held hum, through its low-pass; within 1 dB)', Math.abs(lv + 12) <= 1, `${f1(lv)} dB`, '-12 +- 1');
    check('AU-12', 'one repeat only (silent after it) and no DelayNode created', after < -90 && r1.delays === 0, `after ${f1(after)} dBFS, createDelay calls ${r1.delays}`, '< -90, 0');
    extra.au12 = { pe: dbOf(pe), pm: dbOf(pm) };
  }
  /* ── AU-09: silent during ceremonies and for 1 s after ── */
  if (want('AU-09')) {
    const evs = [];
    for (let t = 0.6; t < 11; t += 0.3) evs.push({ t, op: 'creature', a: phrase([[0, 0, 0, 1], [1, 1, 0.14, 1]], { flavour: Math.round(t * 10) % 6, at: 0 }) });
    evs.push({ t: 3.0, op: 'reveal', a: { tier: 'rare' } });
    const R = await run(page, { secs: 11.5, seed: 31, musicOn: true, taps: true, preload: true, want: ['chatter'], events: evs, recordReturns: true });
    const x = dec(R.stems.chatter);
    const ducked = R.statLog.filter((q) => q[0] > 3 && q[1] === 1).map((q) => q[0]);
    const cEnd = ducked.length ? Math.max(...ducked) : NaN;
    const quiet = dbOf(peakOf(x, Math.round(3.06 * SR), Math.round((cEnd + 0.95) * SR)));
    const back = dbOf(peakOf(x, Math.round((cEnd + 1.3) * SR), x.length));
    check('AU-09', 'chatter silent from the ceremony start (+60 ms fade) until 1 s after its duck ends', quiet < -90 && back > -40, `ceremony duck to ${f1(cEnd)} s; quiet ${f1(quiet)} dBFS; after ${f1(back)} dBFS`, '< -90 then back');
  }
  /* ── AU-13: the touch duck ── */
  if (want('AU-13')) {
    const base = [];
    for (let t = 0.5; t < 10; t += 1) base.push({ t, op: 'creature', a: phrase([[3, 0, 0, 1]], { at: 0 }) });
    const touchE = [{ t: 3.2, op: 'touch', a: { on: true } }, { t: 6.2, op: 'touch', a: { on: false } }];
    const R0 = await run(page, { secs: 10.5, seed: 41, musicOn: false, taps: true, preload: true, want: ['chatter'], events: base });
    const R1 = await run(page, { secs: 10.5, seed: 41, musicOn: false, taps: true, preload: true, want: ['chatter'], events: [...base, ...touchE] });
    const x0 = dec(R0.stems.chatter), x1 = dec(R1.stems.chatter);
    const rel = [];
    for (let t = 0.5; t < 10; t += 1) { const i0 = Math.round((t + 0.03) * SR), i1 = Math.round((t + 0.25) * SR); rel.push([t, dbOf(rmsOf(x1, i0, i1)) - dbOf(rmsOf(x0, i0, i1))]); }
    const inT = rel.filter(([t]) => t > 3.3 && t < 6.7), outT = rel.filter(([t]) => t < 3.1 || t > 7.0);
    check('AU-13', 'while touching (and 0.6 s after) chatter is 6 dB down; before and after, unchanged', inT.every(([, d]) => Math.abs(d + 6) <= 0.5) && outT.every(([, d]) => Math.abs(d) <= 0.2), rel.map(([t, d]) => `${t}s ${f1(d)}`).join(', '), '-6 +- 0.5 / 0 +- 0.2');
    const dense = [];
    for (let t = 3.3; t < 6.2; t += 0.25) dense.push({ t, op: 'creature', a: phrase([[0, 0, 0, 1]], { at: 0 }) });
    const R2 = await run(page, { secs: 7, seed: 42, musicOn: false, taps: true, preload: true, want: ['chatter'], events: [{ t: 3.2, op: 'touch', a: { on: true } }, ...dense], recordReturns: true });
    const ok = R2.rets.filter((q) => q[1] === 'creature' && q[2] === true).length;
    check('AU-13', 'while touching, at most 1 syllable a second (12 one-syllable requests in 2.9 s)', ok <= 3, `${ok} admitted`, '<= 3');
    check('AU-13', 'a lock with no finger down ducks nothing (the shell never calls setTouching for a lock: the run without it is undimmed)', outT.length > 0 && rel.filter(([t]) => t < 3.1).every(([, d]) => Math.abs(d) <= 0.2), 'audio has no lock input; see PG_AUDIO.md', 'shell row');
  }
  /* ── AU-05: a storm of 50 requests a second ── */
  if (want('AU-05')) {
    // one voice: the loudest single phrase of all (every syllable shape x flavour, degrees -2..2, wholes at level 1), alone
    const one = [];
    let u = 0.5;
    for (let fl = 0; fl < 6; fl++) for (let id = 0; id < 7; id++) for (const dg of [-2, 0, 2]) { one.push({ t: u, op: 'creature', a: phrase([[id, dg, 0, 1]], { flavour: fl, at: 0 }) }); u += 0.75; }
    const R1 = await run(page, { secs: u + 1, seed: 51, musicOn: false, taps: true, preload: true, want: ['chatter'], events: one });
    const p1 = peakOf(dec(R1.stems.chatter));
    const storm = [];
    let k = 0;
    for (let t = 0.5; t < 10.5; t += 0.02, k++) storm.push({ t, op: 'creature', a: phrase([[k % 7, (k % 5) - 2, 0, 1], [(k + 3) % 7, (k % 3) - 1, 0.2, 1]], { flavour: k % 6, register: k % 4 === 3 ? 1 : 0, group: 1 + (k % 3), pan: ((k % 9) - 4) / 5, at: 0 }) });
    const R2 = await run(page, { secs: 11.5, seed: 52, musicOn: false, taps: true, preload: true, want: ['chatter'], events: storm, recordReturns: true });
    const x = dec(R2.stems.chatter);
    const maxLive = Math.max(...R2.statLog.map((q) => q[6]));
    const admitted = R2.rets.filter((q) => q[2] === true).length;
    check('AU-05', 'storm (50 requests a second for 10 s): live chatter groups <= 3 (the engine backstop at the desktop caps; phone caps: probe_chatter AU-10)', maxLive <= 3, `max ${maxLive} live; ${admitted} of ${storm.length} admitted`, '<= 3');
    check('AU-05', 'storm peak at most one voice + 3 dB', dbOf(peakOf(x)) <= dbOf(p1) + 3, `storm ${f1(dbOf(peakOf(x)))} dBFS, one voice ${f1(dbOf(p1))} dBFS`, '<= +3 dB');
  }
  /* ── AU-08: sung notes on the sounding field's rest tones, on the eighth grid. The phrases come from LIFE's own planner (src/life/voice.ts
   *   planPhrase SING, six species, singers 0..2), sent with sing: true at the next bar line of musicClock, as the shell will ── */
  if (want('AU-08')) {
    let src = 'LIFE voice.ts planPhrase(SING)';
    let sungs;
    try {
      const V = await import('../../src/life/voice.ts'), St = await import('../../src/life/step.ts');
      const w = St.createLifeWorld(7, 8), out = new Float32Array(16);
      sungs = [0, 1, 2, 3, 4, 5].map((i) => { const sp = (i * 9 + 4) % V.SPECIES_FLAVOUR.length; w.species[0] = sp; const h = V.planPhrase(w, 0, V.PHRASE.SING, -1, i % 3); const n = V.lifePhrase(w, h, out); const q = []; for (let k = 0; k < n; k++) q.push([out[k * 4], out[k * 4 + 1], out[k * 4 + 2], out[k * 4 + 3]]); return { syl: q, flavour: V.SPECIES_FLAVOUR[sp] }; });
    } catch (e) {
      src = `FIXTURE (LIFE's planner did not load: ${String(e).slice(0, 80)})`;
      const S = [[0, 0, 0, 1.4], [1, 1, 2 * E, 1.4], [0, 0, 4 * E, 1.4], [3, 1, 6 * E, 2]];
      sungs = [0, 1, 2, 3, 4, 5].map((i) => ({ syl: S.map((q) => [q[0], q[1] + [0, 3, 1][i % 3], q[2], q[3]]), flavour: i % 6 }));
    }
    const evs = [];
    const times = [4, 13, 22, 31, 40, 49];
    for (const [i, t] of times.entries()) evs.push({ t, op: 'singNextBar', a: phrase(sungs[i].syl, { flavour: sungs[i].flavour }) });
    for (let t = 0.5; t < 56; t += 0.25) evs.push({ t, op: 'clock' });
    const R = await run(page, { secs: 56, seed: 61, musicOn: true, taps: true, preload: true, want: ['chatter'], events: evs, recordReturns: true });
    const x = dec(R.stems.chatter);
    const clocks = R.rets.filter((q) => q[1] === 'clock' && q[2]);
    const res = [];
    for (const [j, q] of R.rets.filter((r) => r[1] === 'sing').entries()) {
      const [, , ok, , at] = q;
      if (!ok) { res.push({ bad: 'refused' }); continue; }
      const c = clocks.find((cq) => cq[5] >= at + 0.05);
      const field = c ? c[3] : -1;
      const S = sungs[j].syl;
      for (let k = 0; k < S.length; k++) {
        const s0 = at + S[k][2], d = SYL_LEN[S[k][0]] * S[k][3];
        const i0 = Math.round((s0 - 0.03) * SR), i1 = Math.round((s0 + d) * SR), pk = peakOf(x, i0, i1);
        let on = NaN; for (let i = i0; i < i1; i++) if (Math.abs(x[i]) > 0.1 * pk) { on = i / SR - 0.0025; break; }
        const tr = pitchTrack(x.subarray(Math.round(s0 * SR), i1), SR, { win: 768, hop: 60, fLo: 300, fHi: 2600, relDb: 12, floorDb: -80 });
        const L = landing(S[k][0], 0);
        const f = trackAt(tr, L.w[0] * d, L.w[1] * d);
        const m = midiOfHz(f), rest = [[2, 9, 4], [7, 2, 9], [11, 6, 1], [9, 4, 11]][field] ?? [];
        const near = Math.round(m);
        // the grid: the phrase's own start is a bar line and LIFE puts each note on an eighth of it
        const slot = (s0 - at) / E;
        res.push({ syl: S[k][0], len: S[k][3], field, grid: (on - s0) * 1000, slotOff: Math.abs(slot - Math.round(slot)) * E * 1000, cents: 100 * (m - near), onRest: rest.includes(((near % 12) + 12) % 12) });
      }
    }
    const bad = res.filter((q) => q.bad || !q.onRest || Math.abs(q.cents) > 10 || Math.abs(q.grid) > 15 || q.slotOff > 15);
    check('AU-08', `sung notes (${src}) on the sounding field's rest tones within 10 cents, on the eighth grid within 15 ms (${res.length} notes)`, bad.length === 0 && res.length === 24, bad.length ? JSON.stringify(bad.slice(0, 3)) : `fields ${[...new Set(res.map((q) => q.field))].join(',')}; worst onset ${f1(Math.max(...res.map((q) => Math.abs(q.grid))))} ms, worst ${f1(Math.max(...res.map((q) => Math.abs(q.cents))))} cents`, 'all');
    extra.au08 = res;
  }
}


async function s1Checks(page, check, want, extra) {
  const msDb = (x, a, b) => { let s = 0, n = 0; for (let i = Math.round(a * SR); i < Math.min(x.length, Math.round(b * SR)); i++) { s += x[i] * x[i]; n++; } return 10 * Math.log10(Math.max(s / Math.max(n, 1), 1e-30)); };
  /* ── AU-06: the cabin's bed under the music; pause and mute free it; no 2.5 s seam ── */
  if (want('AU-06')) {
    const A = await run(page, { secs: 62, seed: 71, musicOn: true, taps: true, preload: true, ambience: 'hearthlog', want: ['music', 'ambience'] });
    const mu = dec(A.stems.music), am = dec(A.stems.ambience);
    const d = msDb(am, 10, 62) - msDb(mu, 10, 62), dk = msDb(kWeight(am), 10, 62) - msDb(kWeight(mu), 10, 62);
    check('AU-06', 'Hearthlog bed at least 6 dB under the music long term (10..62 s; default sliders)', d <= -6 && dk <= -6, `${f1(d)} dB RMS, ${f1(dk)} dB K-weighted (music ${f1(msDb(mu, 10, 62))}, bed ${f1(msDb(am, 10, 62))} dBFS)`, '<= -6 dB');
    extra.au06 = { d, dk };
    for (const [op, a] of [['setPaused', true], ['setSettings', { muted: true }]]) {
      const ev = [{ t: 8, op, a }];
      const W = await run(page, { secs: 9, seed: 72, musicOn: false, taps: true, preload: true, ambience: 'hearthlog', want: ['ambience'], events: ev });
      const B = await run(page, { secs: 9, seed: 72, musicOn: false, taps: true, preload: true, want: ['ambience'], events: ev });
      const at = (R, t) => { const q = R.statLog.find((x) => x[0] >= t); return q ? q[3] : NaN; };
      const x = dec(W.stems.ambience);
      const before = at(W, 7.9) - at(B, 7.9), after = at(W, 8.2) - at(B, 8.2);
      check('AU-06', `${op === 'setPaused' ? 'pause' : 'mute'} frees the bed's nodes within 0.2 s (live nodes against the same run with no bed)`, before > 0 && after <= 0 && dbOf(peakOf(x, Math.round(8.12 * SR))) < -90, `extra nodes ${before} at 7.9 s, ${after} at 8.2 s; after 8.12 s ${f1(dbOf(peakOf(x, Math.round(8.12 * SR))))} dBFS`, '0 by 8.2 s');
    }
    const C = await run(page, { secs: 34.5, seed: 73, musicOn: false, taps: true, preload: true, ambience: 'hearthlog', want: ['ambience'] });
    const y = dec(C.stems.ambience);
    const corr = (L) => { const a0 = Math.round(8 * SR), n = Math.round(18 * SR), l = Math.round(L * SR); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const u = y[a0 + i], v = y[a0 + l + i]; sxy += u * v; sxx += u * u; syy += v * v; } return sxy / Math.sqrt(sxx * syy); };
    const lags = [2.5, 2.5 / 0.7313, 2.5 / 1.0937, 5, 2 * 2.5 / 0.7313];
    const cs = lags.map(corr);
    check('AU-06', 'no 2.5 s seam: the bed against itself one loop later (2.5 s, and the two rates\' loop lengths 3.42 s and 2.29 s, and twice) correlates under 0.2', cs.every((c) => Math.abs(c) < 0.2), lags.map((L, i) => `${L.toFixed(2)} s ${cs[i].toFixed(3)}`).join(', '), '< 0.2');
  }
  /* ── AU-03: player effects over the chatter and the cabin's bed ── */
  if (want('AU-03')) {
    const { ev, spans } = placements(81, 4, 60);
    const talk = [];
    let k = 0;
    for (let t = 1; t < 60; t += 0.7, k++) talk.push({ t, op: 'creature', a: phrase([[k % 7, (k % 5) - 2, 0, 1], [(k + 2) % 7, (k % 3) - 1, 0.2, 1]], { flavour: k % 6, pan: ((k % 7) - 3) / 4, at: 0 }) });
    const R = await run(page, { secs: 62, seed: 82, musicOn: false, taps: true, preload: true, ambience: 'hearthlog', want: ['fx', 'chatter', 'ambience'], events: [...ev, ...talk] });
    const fx = dec(R.stems.fx), ch = dec(R.stems.chatter), am = dec(R.stems.ambience);
    const bg = ch.map((v, i) => v + am[i]);
    const fxK = kWeight(fx), bgK = kWeight(bg);
    const rows = [];
    for (const sp of spans) { const q = separation(fx, bg, fxK, bgK, sp.at, sp.at + sp.len); rows.push({ kind: sp.kind, at: sp.at, ...q }); }
    const wi = rows.reduce((a, b) => (b.inband < a.inband ? b : a)), wk = rows.reduce((a, b) => (b.K < a.K ? b : a));
    check('AU-03', `player effects over chatter + the cabin bed (no touch duck, chatter every 0.7 s at level 1): in-band >= 8 dB (${rows.length} placements)`, wi.inband >= 8, `worst ${f1(wi.inband)} dB (${wi.kind} at ${f1(wi.at)} s); median ${f1(pct(rows.map((q) => q.inband), 0.5))}`, '>= 8 dB');
    check('AU-03', 'K-weighted over their loudest 20 ms frames >= 10 LU', wk.K >= 10, `worst ${f1(wk.K)} LU (${wk.kind} at ${f1(wk.at)} s); median ${f1(pct(rows.map((q) => q.K), 0.5))}`, '>= 10 LU');
    extra.au03 = rows.map((q) => ({ ...q, bands: undefined }));
  }
  /* ── AU-04: the music stem is unchanged by chatter and the bed (they never ask for room) ── */
  if (want('AU-04')) {
    const play = sparseScenario(91, 4, 40).ev ?? sparseScenario(91, 4, 40);
    const talk = [];
    for (let t = 1.3, k = 0; t < 44; t += 0.9, k++) talk.push({ t, op: 'creature', a: phrase([[k % 7, 0, 0, 1], [(k + 1) % 7, 1, 0.2, 1]], { flavour: k % 6, at: 0 }) });
    const X = await run(page, { secs: 46, seed: 92, musicOn: true, taps: true, preload: true, want: ['music'], events: play });
    const Y = await run(page, { secs: 46, seed: 92, musicOn: true, taps: true, preload: true, ambience: 'hearthlog', want: ['music'], events: [...play, ...talk] });
    const a = dec(X.stems.music), b = dec(Y.stems.music);
    let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i]));
    check('AU-04', 'the music stem under sparse play is the same with chatter and the cabin bed running (so its pumping metrics are unchanged)', mx <= 5e-5 && peakOf(a) > 1e-3, `max |diff| ${mx.toExponential(2)} (music peak ${f1(dbOf(peakOf(a)))} dBFS)`, '<= 5e-5');
  }
  /* ── AU-14 offline: the Music Box, a second tap, the kettle's whistle and its 60 s rule, the bed's melody resting ── */
  if (want('AU-14')) {
    const ev = [{ t: 4, op: 'musicBox', a: { on: true } }, { t: 12, op: 'musicBox', a: { on: false } }, { t: 14, op: 'musicBox', a: { on: true } },
      { t: 40, op: 'musicBox', a: { on: true, tune: 1 } }, { t: 73, op: 'musicBox', a: { on: true, tune: 1 } }];
    const R = await run(page, { secs: 79, seed: 101, musicOn: true, taps: true, preload: true, want: ['music', 'fx'], events: ev, recordReturns: true });
    const N = await run(page, { secs: 79, seed: 101, musicOn: true, taps: true, preload: true, want: ['music'], events: [] });
    const fx = dec(R.stems.fx), m1 = dec(R.stems.music), m0 = dec(N.stems.music);
    const on = (a, b) => dbOf(peakOf(fx, Math.round(a * SR), Math.round(b * SR)));
    check('AU-14', 'the Music Box plays from a tap, a second tap stops it (silent 0.6 s after), a third tap 10 s later is refused (40 s rule)', on(4, 11.9) > -40 && on(12.6, 39.9) < -90, `tune ${f1(on(4, 11.9))} dBFS; 12.6..39.9 s ${f1(on(12.6, 39.9))} dBFS`, 'plays, then silent');
    check('AU-14', 'the kettle is refused within 60 s of the tune (40 s) and whistles one bar after (73 s)', on(40, 72.9) < -90 && on(73, 76.8) > -45 && on(77.0, 79) < -80, `40..72.9 s ${f1(on(40, 72.9))}; 73..76.8 s ${f1(on(73, 76.8))}; after ${f1(on(77.0, 79))} dBFS`, 'refused, then one bar');
    // the bed's mallets rest while the tune plays: the music stem's 1.5..4 kHz band (mallet partials; the pad is low-passed at 900 Hz)
    const hb = (x, a, b) => { let nf = 1; const n = Math.round((b - a) * SR); while (nf < n) nf <<= 1; const p = frameSpectrum(x, Math.round(a * SR), n, nf); const df = SR / nf; let e = 0; for (let k = Math.ceil(1500 / df); k < 4000 / df; k++) e += p[k]; return 10 * Math.log10(e + 1e-30); };
    const drop = hb(m1, 5, 11.8) - hb(m0, 5, 11.8);
    check('AU-14', "the bed's own melody rests while the Music Box plays (music stem 1.5..4 kHz, 5..11.8 s, against the same music without the tune)", drop <= -12, `${f1(drop)} dB`, '<= -12 dB');
  }
}


async function propChecks(page, check, want, extra) {
  if (!want('PROPS')) return;
  const msPeak = (x, a, b) => dbOf(peakOf(x, Math.round(a * SR), Math.round(b * SR)));
  /* autonomous sounds never ask the music for room; a ball the player struck does */
  const auto = [];
  for (let t = 4, k = 0; t < 20; t += 0.02, k++) auto.push({ t, op: k % 3 === 2 ? 'prop' : 'autoThud', a: k % 3 === 2 ? { kind: 1, intensity: 0.6, auto: true, pan: 0.2 } : { kind: k % 2, intensity: 0.7 } });
  const X = await run(page, { secs: 24, seed: 111, musicOn: true, taps: true, preload: true, want: ['music', 'fx'], events: [], recordReturns: true });
  const Y = await run(page, { secs: 24, seed: 111, musicOn: true, taps: true, preload: true, want: ['music', 'fx'], events: auto, recordReturns: true });
  const a = dec(X.stems.music), b = dec(Y.stems.music), fy = dec(Y.stems.fx);
  let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i]));
  // count the autonomous sounds that played: onsets in the fx stem (10 ms frames rising 20 dB over the frame before)
  let ons = 0; { const W = 480; let prev = 1e-12; for (let i = 0; i + W <= fy.length; i += W) { const r = rmsOf(fy, i, i + W); if (r > 1e-4 && r > prev * 10) ons++; prev = Math.max(r, 1e-12); } }
  check('PROPS', 'autonomous lands, bumps and ball bumps (150 requests a second for 16 s) never move the music (no registerFx)', mx <= 5e-5 && peakOf(fy) > 1e-3, `music max |diff| ${mx.toExponential(2)}; fx peak ${f1(dbOf(peakOf(fy)))} dBFS`, '<= 5e-5');
  check('PROPS', 'autonomous sounds at most 3 a second (LIFE 10.1 desktop): onsets in 16 s', ons <= 3 * 16 + 3 && ons >= 30, `${ons} onsets`, '<= 51');
  const P = await run(page, { secs: 12, seed: 112, musicOn: true, taps: true, preload: true, want: ['music', 'fx'], events: [{ t: 6, op: 'prop', a: { kind: 1, intensity: 0.8, auto: false } }] });
  const N = await run(page, { secs: 12, seed: 112, musicOn: true, taps: true, preload: true, want: ['music'], events: [] });
  const pm = dec(P.stems.music), nm = dec(N.stems.music), pf = dec(P.stems.fx);
  const dip = 10 * Math.log10((rmsOf(pm, 6.2 * SR, 9 * SR) ** 2 + 1e-30) / (rmsOf(nm, 6.2 * SR, 9 * SR) ** 2 + 1e-30));
  check('PROPS', 'a ball the player struck makes room in the music (the music 6.2..9 s against the same music untouched)', dip <= -10, `${f1(dip)} dB`, '<= -10 dB');
  check('PROPS', 'the felt ball bump: a soft thud, peak -30..-10 dBFS at intensity 0.8, short (silent 0.4 s later)', msPeak(pf, 6, 6.4) <= -10 && msPeak(pf, 6, 6.4) >= -30 && msPeak(pf, 6.45, 7) < -70, `peak ${f1(msPeak(pf, 6, 6.4))}; after ${f1(msPeak(pf, 6.45, 7))} dBFS`, 'soft, short');
  /* held voices: the ball's roll and the hinge creak follow their updates and stop by themselves (dead-man) */
  const held = [];
  for (let t = 2; t < 4; t += 1 / 60) held.push({ t, op: 'prop', a: { kind: 1, key: 3, held: 0.8, intensity: 0, auto: true } });
  for (let t = 6; t < 8; t += 1 / 60) held.push({ t, op: 'prop', a: { kind: 2, key: 5, held: 0.7, intensity: 0, auto: true } });
  const H = await run(page, { secs: 10, seed: 113, musicOn: false, taps: true, preload: true, ambience: 'hearthlog', want: ['fx'], events: held });
  const hf = dec(H.stems.fx);
  check('PROPS', 'the ball roll sounds while updated and is silent 0.3 s after the last update (dead-man)', msPeak(hf, 2.5, 3.9) > -60 && msPeak(hf, 4.3, 5.9) < -80, `while ${f1(msPeak(hf, 2.5, 3.9))}; after ${f1(msPeak(hf, 4.3, 5.9))} dBFS`, 'on, then silent');
  check('PROPS', 'the hinge creak (cabin) sounds while updated and is silent 0.3 s after the last update', msPeak(hf, 6.5, 7.9) > -60 && msPeak(hf, 8.3, 10) < -80, `while ${f1(msPeak(hf, 6.5, 7.9))}; after ${f1(msPeak(hf, 8.3, 10))} dBFS`, 'on, then silent');
  /* the kettle's whistle is on the field's rest tones (fifth, ninth, root) */
  const K = await run(page, { secs: 12, seed: 114, musicOn: false, taps: true, preload: true, want: ['fx'], events: [{ t: 3, op: 'musicBox', a: { on: true, tune: 1 } }] });
  const kf = dec(K.stems.fx);
  const tr = pitchTrack(kf, SR, { win: 2048, hop: 480, fLo: 500, fHi: 2000, relDb: 12, floorDb: -70 });
  const seg = (a2, b2) => trackAt(tr, a2, b2);
  const notes = [seg(3.6, 4.2), seg(4.5, 5.1), seg(5.4, 6.4)].map((f) => midiOfHz(f));
  const okN = notes.every((m) => Number.isFinite(m) && Math.abs(m - Math.round(m)) <= 0.1 && [2, 9, 4].includes(((Math.round(m) % 12) + 12) % 12));
  check('PROPS', "the kettle's whistle (music off: the home field) sits on D, A and E within 10 cents", okN, notes.map((m) => m.toFixed(2)).join(', '), 'rest tones');
}

/* ═══════════════════════════════ round 2 (S2, S3): place things, the eight beds, the styles, the Music Box's key, the double echo ═══════════════════════════════ */

const KIND = { chime: 3, splash: 4, crunch: 5, boing: 7, bell: 8, tick: 9, rustle: 11, whoosh: 12 };
const BEDS = ['ripple', 'frostbell', 'rainleaf', 'fizzwell', 'cogwhistle', 'lanternroof', 'echohollow', 'cloudloft'];
const STYLES2 = ['shore', 'ridge', 'garden', 'bath', 'bench', 'roof', 'hollow', 'cloud'];
const D_MAJOR = [2, 4, 6, 7, 9, 11, 1];

async function r2Checks(page, check, want, extra) {
  const msPeak = (x, a, b) => dbOf(peakOf(x, Math.round(a * SR), Math.round(b * SR)));
  const msDb = (x, a, b) => { let s2 = 0, n = 0; for (let i = Math.round(a * SR); i < Math.min(x.length, Math.round(b * SR)); i++) { s2 += x[i] * x[i]; n++; } return 10 * Math.log10(Math.max(s2 / Math.max(n, 1), 1e-30)); };
  const finite = (x) => { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false; return true; };
  const onsetAfter = (x, t, thr) => { for (let i = Math.round(t * SR); i < x.length; i++) if (Math.abs(x[i]) > thr) return i / SR; return NaN; };
  /* ── THINGS: every strike voice, its level, its length and its end ── */
  if (want('THINGS')) {
    const names = Object.keys(KIND), ev = [];
    names.forEach((k, i) => ev.push({ t: 1 + 3 * i, op: 'prop', a: { kind: KIND[k], intensity: 0.8, auto: false, note: k === 'bell' ? 69 : 81, pan: 0.2 } }));
    const R = await run(page, { secs: 1 + 3 * names.length + 0.5, seed: 121, musicOn: false, taps: true, preload: true, ambience: 'ripple', want: ['fx'], events: ev, recordReturns: true });
    const fx = dec(R.stems.fx);
    const rows = names.map((k, i) => ({ k, pk: msPeak(fx, 1 + 3 * i, 1 + 3 * i + 2.7), tail: msPeak(fx, 1 + 3 * i + 2.75, 1 + 3 * i + 3) }));
    extra.r2things = rows;
    check('THINGS', 'the 8 place thing strikes (chime, splash, crunch, boing, bell, tick, rustle, whoosh) at intensity 0.8 through the engine: peak -40..-8 dBFS, silent (< -70) 2.75 s after', rows.every((q) => q.pk >= -40 && q.pk <= -8 && q.tail < -70) && finite(fx) && R.errors === 0, rows.map((q) => `${q.k} ${f1(q.pk)}/${f1(q.tail)}`).join(', '), '-40..-8, < -70');
    // tuned: chime and bell land on their D pentatonic note (the fundamental, 50..400 ms after the strike)
    const ev2 = [[3, 74], [3, 81], [8, 69], [8, 76], [3, 70]].map(([kind, note], i) => ({ t: 1 + 3 * i, op: 'prop', a: { kind, note, intensity: 0.7, auto: false } }));
    const T = await run(page, { secs: 16.5, seed: 122, musicOn: false, taps: true, preload: true, ambience: 'ripple', want: ['fx'], events: ev2 });
    const tx = dec(T.stems.fx);
    const tr = pitchTrack(tx, SR, { win: 4096, hop: 480, fLo: 300, fHi: 1200, relDb: 9, floorDb: -80 });
    const got = ev2.map((e, i) => midiOfHz(trackAt(tr, 1 + 3 * i + 0.06, 1 + 3 * i + 0.4)));
    const wantN = [74, 81, 69, 76, 69];   // 70 (A#4) snaps down to A4 (69)
    check('THINGS', 'chime and bell ring on their note within 10 cents (D5, A5 chimes; A4, E5 bells; an off-key 70 snaps to A4)', got.every((m, i) => Math.abs(m - wantN[i]) <= 0.1), got.map((m) => m.toFixed(2)).join(', '), wantN.join(', '));
  }
  if (want('THINGS')) {
    // autonomous strikes (a body or the weather) never move the music; the player's chime makes room
    const auto = [];
    const ks = Object.values(KIND);
    for (let t = 4, k = 0; t < 20; t += 0.05, k++) auto.push({ t, op: 'prop', a: { kind: ks[k % ks.length], intensity: 0.6, auto: true, note: 74 } });
    const X = await run(page, { secs: 24, seed: 123, musicOn: true, taps: true, preload: true, ambience: 'ripple', want: ['music'], events: [] });
    const Y = await run(page, { secs: 24, seed: 123, musicOn: true, taps: true, preload: true, ambience: 'ripple', want: ['music', 'fx'], events: auto });
    const a = dec(X.stems.music), b = dec(Y.stems.music), fy = dec(Y.stems.fx);
    let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i]));
    // admitted = requests - the engine's own 'auto' throttle count (onsets cannot be counted under 2.5 s bell rings)
    const adm = auto.length - (Y.final?.throttled?.auto ?? 0);
    check('THINGS', 'autonomous thing strikes (20 a second for 16 s, every kind) never move the music; at most 3 a second admitted (the auto budget)', mx <= 5e-5 && peakOf(fy) > 1e-3 && adm <= 3 * 16 + 3 && adm >= 30, `music max |diff| ${mx.toExponential(2)}; ${adm} of ${auto.length} admitted; fx peak ${f1(dbOf(peakOf(fy)))} dBFS`, '<= 5e-5, 30..51');
    const P = await run(page, { secs: 12, seed: 124, musicOn: true, taps: true, preload: true, ambience: 'ripple', want: ['music'], events: [{ t: 6, op: 'prop', a: { kind: 3, note: 78, intensity: 0.8, auto: false } }] });
    const pm = dec(P.stems.music);
    const dip = 10 * Math.log10((rmsOf(pm, 6.2 * SR, 9 * SR) ** 2 + 1e-30) / (rmsOf(a, 6.2 * SR, 9 * SR) ** 2 + 1e-30));
    check('THINGS', "a chime the player struck makes room in the music (ROOM_KINDS 'thing'; 6.2..9 s against the same music untouched)", dip <= -10, `${f1(dip)} dB`, '<= -10 dB');
  }
  if (want('THINGS')) {
    // the tick lands on the music's eighth grid (musicClock's bar), struck at odd times
    const ev = [];
    for (let i = 0; i < 6; i++) { const t = 3.137 + 1.71 * i; ev.push({ t, op: 'clock', a: {} }); ev.push({ t, op: 'prop', a: { kind: 9, intensity: 0.9, auto: false } }); }
    const R = await run(page, { secs: 14, seed: 125, musicOn: true, taps: true, preload: true, ambience: 'cogwhistle', want: ['fx'], events: ev, recordReturns: true });
    const fx = dec(R.stems.fx), clocks = (R.rets ?? []).filter((q) => q[1] === 'clock');
    const offs = clocks.map((q) => { const on = onsetAfter(fx, q[5], 1e-3); const k = (on - q[4]) / E; return Math.abs(k - Math.round(k)) * E * 1000; });
    check('THINGS', 'a tick lands on the music\'s eighth grid (onset against musicClock\'s bar start, 6 strikes at odd times)', clocks.length === 6 && clocks.every((q) => q[2]) && offs.every((o) => o <= 2), offs.map((o) => o.toFixed(2)).join(', ') + ' ms', '<= 2 ms');
    // held rustle and whoosh follow their updates and stop by themselves
    const held = [];
    for (let t = 2; t < 4; t += 1 / 60) held.push({ t, op: 'prop', a: { kind: 11, key: 4, held: 0.8, intensity: 0, auto: true } });
    for (let t = 6; t < 8; t += 1 / 60) held.push({ t, op: 'prop', a: { kind: 12, key: 6, held: 0.7, intensity: 0, auto: false } });
    const H = await run(page, { secs: 10, seed: 126, musicOn: false, taps: true, preload: true, ambience: 'frostbell', want: ['fx'], events: held });
    const hf = dec(H.stems.fx);
    check('THINGS', 'held rustle (the Shake Pine) and whoosh (a slide) sound while updated and are silent 0.3 s after the last update', msPeak(hf, 2.5, 3.9) > -60 && msPeak(hf, 4.3, 5.9) < -80 && msPeak(hf, 6.5, 7.9) > -60 && msPeak(hf, 8.3, 10) < -80, `rustle ${f1(msPeak(hf, 2.5, 3.9))} then ${f1(msPeak(hf, 4.3, 5.9))}; whoosh ${f1(msPeak(hf, 6.5, 7.9))} then ${f1(msPeak(hf, 8.3, 10))} dBFS`, 'on, then silent');
    // the felt ball and the yarn ball sound apart (prop size)
    const B = await run(page, { secs: 4, seed: 127, musicOn: false, taps: true, preload: true, want: ['fx'], events: [{ t: 1, op: 'prop', a: { kind: 1, intensity: 0.8, auto: false, size: 0.22 } }, { t: 2.5, op: 'prop', a: { kind: 1, intensity: 0.8, auto: false, size: 0.24 } }] });
    const bf = dec(B.stems.fx);
    const pk = (t) => { const nf = 16384, sp = frameSpectrum(bf, Math.round(t * SR), 4800, nf), df = SR / nf; let bk = 0, bv = -1; for (let k = Math.floor(120 / df); k < 400 / df; k++) if (sp[k] > bv) { bv = sp[k]; bk = k; } return bk * df; };
    const fF = pk(1.0), fY = pk(2.5), st = 12 * Math.log2(fF / fY);
    check('THINGS', 'the felt ball (r 0.22) and the yarn ball (r 0.24) are at least 2 semitones apart, the yarn ball lower', st >= 2 && st <= 4.5, `felt ${f1(fF)} Hz, yarn ${f1(fY)} Hz: ${st.toFixed(2)} semitones`, '2..4.5');
  }
  /* ── AMB2: the eight new beds: under the music, audible, few nodes, the shell's weather ── */
  if (want('AMB2')) {
    // the node counters are module-wide in the page: a render that ends with sources still scheduled leaves its count behind (their
    // 'ended' never fires), so each bed is measured against a no-bed run made right before it (same leftovers), not one shared baseline
    const rows = [];
    for (const pl of BEDS) {
      const A = await run(page, { secs: 52, seed: 131, musicOn: true, taps: true, preload: true, ambience: pl, want: ['music', 'ambience'] });
      const mu = dec(A.stems.music), am = dec(A.stems.ambience);
      const d = msDb(am, 10, 52) - msDb(mu, 10, 52), dk = msDb(kWeight(am), 10, 52) - msDb(kWeight(mu), 10, 52);
      const N0 = await run(page, { secs: 30, seed: 130, musicOn: false, taps: true, preload: true, want: ['ambience'], events: [] });
      const B = await run(page, { secs: 30, seed: 132, musicOn: false, taps: true, preload: true, ambience: pl, want: ['ambience'] });
      let extraN = 0;
      for (const q of B.statLog) if (q[0] >= 5) { const z = N0.statLog.find((y) => y[0] >= q[0]); if (z) extraN = Math.max(extraN, q[3] - z[3]); }
      const bx = dec(B.stems.ambience);
      rows.push({ pl, d, dk, lvl: msDb(am, 10, 52), extraN, ok: finite(am) && finite(bx) && A.errors === 0 && B.errors === 0, peak: dbOf(peakOf(bx)) });
    }
    extra.r2beds = rows;
    for (const q of rows) check('AMB2', `${q.pl} bed at least 6 dB under the music long term (10..52 s, default sliders), audible, at most 14 nodes over the no-bed run`, q.ok && q.d <= -6 && q.dk <= -6 && q.lvl > -75 && q.extraN <= 14 && q.peak < -12, `${f1(q.d)} dB RMS, ${f1(q.dk)} dB K; bed ${f1(q.lvl)} dBFS RMS, peak ${f1(q.peak)}; nodes +${q.extraN}`, '<= -6, > -75 dBFS, <= 14');
    // the shell's weather: a Frostbell gust at 15 s, then nothing of the bed's own for 30 s
    const W = await run(page, { secs: 30, seed: 133, musicOn: false, taps: true, preload: true, ambience: 'frostbell', want: ['ambience'], events: [{ t: 15, op: 'setAmbience', a: { weather: 1 } }] });
    const wx = dec(W.stems.ambience);
    const g = msDb(wx, 15.4, 17) - msDb(wx, 20, 29);
    check('AMB2', 'Frostbell follows the shell: setAmbience({ weather: 1 }) at 15 s is a gust (15.4..17 s against 20..29 s, when the bed\'s own gusts wait)', g >= 12, `${f1(g)} dB`, '>= 12 dB');
    // Rainleaf: the shower off (weather 0) at 5 s quiets the patter
    const S = await run(page, { secs: 16, seed: 134, musicOn: false, taps: true, preload: true, ambience: 'rainleaf', want: ['ambience'], events: [{ t: 0.5, op: 'setAmbience', a: { weather: 1 } }, { t: 5, op: 'setAmbience', a: { weather: 0 } }] });
    const sx = dec(S.stems.ambience);
    const sd = msDb(sx, 9, 15.5) - msDb(sx, 3.5, 4.9);
    check('AMB2', 'Rainleaf: the shower turned off (weather 0 at 5 s) leaves the patter at least 6 dB quieter by 9 s', sd <= -6, `${f1(sd)} dB`, '<= -6 dB');
  }
  /* ── AU-03 over the S2 beds (the loudest new beds in the effects' band) ── */
  if (want('AMB2')) {
    for (const pl of ['ripple', 'rainleaf', 'frostbell']) {
      const { ev, spans } = placements(141, 4, 34);
      const R = await run(page, { secs: 36, seed: 142, musicOn: false, taps: true, preload: true, ambience: pl, want: ['fx', 'ambience'], events: [...ev, { t: 6, op: 'setAmbience', a: { weather: 1 } }, { t: 20, op: 'setAmbience', a: { weather: 1 } }] });
      const fx = dec(R.stems.fx), am = dec(R.stems.ambience);
      const fxK = kWeight(fx), bgK = kWeight(am);
      const rows = spans.map((sp) => ({ kind: sp.kind, at: sp.at, ...separation(fx, am, fxK, bgK, sp.at, sp.at + sp.len) }));
      const wi = rows.reduce((p2, q) => (q.inband < p2.inband ? q : p2)), wk = rows.reduce((p2, q) => (q.K < p2.K ? q : p2));
      check('AU-03', `player effects over the ${pl} bed (its weather on at 6 s and 20 s): in-band >= 8 dB and K-weighted >= 10 LU (${rows.length} placements)`, wi.inband >= 8 && wk.K >= 10, `worst in-band ${f1(wi.inband)} dB (${wi.kind}); worst K ${f1(wk.K)} LU (${wk.kind})`, '>= 8 dB, >= 10 LU');
    }
  }
  /* ── STYLE2: the eight place styles play in key and level; 'home' set explicitly is today's music ── */
  if (want('STYLE2')) {
    const H = await run(page, { secs: 30, seed: 151, musicOn: true, taps: true, preload: true, want: ['music'], events: [] });
    const H2 = await run(page, { secs: 30, seed: 151, musicOn: true, taps: true, preload: true, want: ['music'], events: [{ t: 0.02, op: 'setMusicStyle', a: 'home' }] });
    const h = dec(H.stems.music), h2 = dec(H2.stems.music);
    let mx = 0; for (let i = 0; i < h.length; i++) mx = Math.max(mx, Math.abs(h[i] - h2[i]));
    check('STYLE2', "setMusicStyle('home') is today's music (the same render, within AU-07's chain-free tolerance)", mx <= 5e-5, `max |diff| ${mx.toExponential(2)}`, '<= 5e-5');
    const hl = msDb(h, 4, 30), rows = [];
    for (const st of STYLES2) {
      const R = await run(page, { secs: 30, seed: 151, musicOn: true, taps: true, preload: true, want: ['music'], events: [{ t: 0.02, op: 'setMusicStyle', a: st }] });
      const x = dec(R.stems.music);
      rows.push({ st, d: msDb(x, 4, 30) - hl, pk: dbOf(peakOf(x)), ok: finite(x) && R.errors === 0, quiet: R.final?.music?.stats?.quiet ?? null });
    }
    extra.r2styles = rows;
    check('STYLE2', 'each place style plays (finite, no error) within -9..+2 dB of the home style\'s level and peaks under -3 dBFS', rows.every((q) => q.ok && q.d >= -9 && q.d <= 2 && q.pk < -3), rows.map((q) => `${q.st} ${f1(q.d)}/${f1(q.pk)}`).join(', '), '-9..+2 dB, < -3 dBFS');
  }
  /* ── BOX: the Music Box's tune is on key ── */
  if (want('BOX')) {
    const R = await run(page, { secs: 33, seed: 161, musicOn: false, taps: true, preload: true, want: ['fx'], events: [{ t: 2, op: 'musicBox', a: { on: true } }] });
    const fx = dec(R.stems.fx);
    const t0 = onsetAfter(fx, 1.9, 1e-3);
    const tr = pitchTrack(fx, SR, { win: 2048, hop: 240, fLo: 600, fHi: 2600, relDb: 12, floorDb: -80 });
    // the tune's onsets: every eighth slot where the fx stem jumps (25 notes); the pitch 30..200 ms after each
    const ons = [];
    for (let k = 0; k < 64; k++) { const t = t0 + k * E; const a = rmsOf(fx, Math.round((t + 0.005) * SR), Math.round((t + 0.03) * SR)), b = rmsOf(fx, Math.round((t - 0.03) * SR), Math.round((t - 0.005) * SR)); if (a > 1e-4 && a > b * 1.6) ons.push(t); }
    const ms = ons.map((t) => midiOfHz(trackAt(tr, t + 0.03, t + 0.2)));
    const okP = ms.every((m) => Number.isFinite(m) && Math.abs(m - Math.round(m)) <= 0.1 && PENTA.includes(((Math.round(m) % 12) + 12) % 12));
    check('BOX', 'the Music Box tune with the music off (the home field): every note on D major pentatonic within 10 cents, on the eighth grid', ons.length >= 20 && okP, `${ons.length} notes: ${ms.map((m) => m.toFixed(2)).join(' ')}`, '>= 20 notes, D E F# A B');
    // no clamping at the top of the range: the tune keeps its shape (adjacent notes with different steps stay different notes)
    const STEPS = [0, 2, 1, 0, -1, 0, -2, 0, 2, 3, 2, 1, 2, 3, 2, 1, 0, 1, 0, -1, -2, 0, 1, -1, 0];
    let shape = ms.length === STEPS.length;
    if (shape) for (let i = 1; i < ms.length; i++) if (Math.sign(Math.round(ms[i]) - Math.round(ms[i - 1])) !== Math.sign(STEPS[i] - STEPS[i - 1])) shape = false;
    check('BOX', 'the tune keeps its contour (every step up, down or same as written; nothing clamped at the top of its range)', shape, `${ms.length} notes`, 'the written contour');
    // with the music on, from 30 s (the first field lasts 29..58 s, so the tune most likely crosses a field change): each note in the
    // scale of the field musicClock says is sounding
    const clk = []; for (let t = 29; t < 62; t += 0.25) clk.push({ t, op: 'clock', a: {} });
    const M = await run(page, { secs: 62, seed: 162, musicOn: true, taps: true, preload: true, want: ['fx'], events: [{ t: 30, op: 'musicBox', a: { on: true } }, ...clk], recordReturns: true });
    const mf = dec(M.stems.fx);
    const m0 = onsetAfter(mf, 29.9, 1e-3), tm = pitchTrack(mf, SR, { win: 2048, hop: 240, fLo: 600, fHi: 2600, relDb: 12, floorDb: -80 });
    const ons2 = [];
    for (let k = 0; k < 64; k++) { const t = m0 + k * E; const a = rmsOf(mf, Math.round((t + 0.005) * SR), Math.round((t + 0.03) * SR)), b = rmsOf(mf, Math.round((t - 0.03) * SR), Math.round((t - 0.005) * SR)); if (a > 1e-4 && a > b * 1.6) ons2.push(t); }
    const ms2 = ons2.map((t) => midiOfHz(trackAt(tm, t + 0.03, t + 0.2)));
    const MEL = [[2, 4, 6, 9, 11], [7, 9, 11, 1, 2, 6], [11, 2, 4, 6, 9], [9, 11, 1, 4, 6]];
    const cl = (M.rets ?? []).filter((q) => q[1] === 'clock' && q[2]);
    const fieldAt = (t) => { let f = -1; for (const q of cl) if (q[5] <= t + 1e-6) f = q[3]; return f; };
    const fs = ons2.map((t) => fieldAt(t));
    const okF = ms2.every((m, i) => Number.isFinite(m) && Math.abs(m - Math.round(m)) <= 0.1 && fs[i] >= 0 && MEL[fs[i]].includes(((Math.round(m) % 12) + 12) % 12) && D_MAJOR.includes(((Math.round(m) % 12) + 12) % 12));
    check('BOX', 'with the music on (from 30 s): every note within 10 cents in the scale of the field sounding (musicClock), all in D major', ons2.length >= 20 && okF, `${ons2.length} notes over fields ${[...new Set(fs)].join(',')}: ${ms2.map((m, i) => `${m.toFixed(2)}@${fs[i]}`).join(' ')}`, 'field scale');
  }
  /* ── ECHO: the Echo Stone's double echo (creature echoes: 2) ── */
  if (want('ECHO')) {
    const ph = (o) => ({ t: 1, op: 'creature', a: phrase([[3, 0, 0, 1]], { at: 0, ...o }) });
    const r0 = await run(page, { secs: 3, seed: 171, musicOn: false, taps: true, preload: true, want: ['chatter'], events: [ph({})] });
    const r1 = await run(page, { secs: 3, seed: 171, musicOn: false, taps: true, preload: true, want: ['chatter'], events: [ph({ echo: true })] });
    const r2 = await run(page, { secs: 3, seed: 171, musicOn: false, taps: true, preload: true, want: ['chatter'], events: [ph({ echo: true, echoes: 2 })] });
    const x0 = dec(r0.stems.chatter), x1 = dec(r1.stems.chatter), x2 = dec(r2.stems.chatter);
    const e1 = x1.map((v, i) => v - x0[i]), e2 = x2.map((v, i) => v - x1[i]);
    const pm = peakOf(x0), on0 = onsetAfter(x0, 0.5, pm * 0.02), on2 = onsetAfter(e2, 0.5, pm * 0.002);
    const lv = dbOf(rmsOf(e2, Math.round((on2 + 0.03) * SR), Math.round((on2 + 0.19) * SR))) - dbOf(rmsOf(e1, Math.round((on0 + 0.22 + 0.03) * SR), Math.round((on0 + 0.22 + 0.19) * SR)));
    const after = dbOf(peakOf(x2, Math.round((on0 + 0.44 + 0.3) * SR)));
    check('ECHO', 'the Echo Stone (echoes: 2): a second repeat at +440 ms, 12 dB under the first (within 1.5 dB), then silence', Math.abs(on2 - on0 - 0.44) <= 0.003 && Math.abs(lv + 12) <= 1.5 && after < -90, `lag ${((on2 - on0) * 1000).toFixed(1)} ms, ${f1(lv)} dB, after ${f1(after)} dBFS`, '440 ms, -12 dB');
  }
}

/* ═══════════════════════════════ the checks ═══════════════════════════════ */

export async function lifeChecks({ page, check, OUT, only = null }) {
  const want = (id) => !only || only.includes(id);
  const extra = {};
  if (want('AU-07')) {
    if (!existsSync(BASELINE)) check('AU-07', 'baseline exists', false, 'no au07_baseline.json', 'present');
    else {
      const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
      const now = await au07Renders(page);
      const res = {};
      for (const k of Object.keys(base.fingerprints)) {
        const r = now[k];
        if (!r) { check('AU-07', `${k} rendered`, false, 'missing', 'present'); continue; }
        const f = resolve(BASE_DIR(OUT), `${k}.f32`);
        if (existsSync(f)) {
          const b = new Float32Array(readFileSync(f).buffer.slice(0));
          const d = diff(r.x, b);
          const tol = r.dry ? AU07_TOL.dry : AU07_TOL.chain;
          res[k] = d;
          check('AU-07', `${k} equals the pre-PLAYGROUND render (${r.dry ? 'no limiter in the path' : 'through the chain'})`, r.x.length === b.length && d.maxAbs <= tol, `max|diff| ${d.maxAbs.toExponential(2)}, rel RMS ${d.relRms.toExponential(2)}`, `<= ${tol}`);
        } else {
          const fp = fingerprint(r.x), bf = base.fingerprints[k];
          let worst = 0;
          for (let i = 0; i < Math.max(fp.e.length, bf.e.length); i++) { const a = fp.e[i] ?? 0, b = bf.e[i] ?? 0; if (Math.max(a, b) > 1e-9) worst = Math.max(worst, Math.abs(a - b) / Math.max(a, b)); }
          res[k] = { fpWorst: worst };
          check('AU-07', `${k} matches the pre-PLAYGROUND fingerprint (no local baseline render)`, fp.n === bf.n && worst <= AU07_TOL.fpRel, `worst block ${worst.toExponential(2)}`, `<= ${AU07_TOL.fpRel}`);
        }
      }
      extra.au07 = res;
    }
  }
  try { await auChecks(page, check, want, extra); } catch (e) { check('run', 'the AU checks ran to the end', false, String(e && e.stack || e).slice(0, 400), 'no exception'); }
  try { await s1Checks(page, check, want, extra); } catch (e) { check('run', 'the S1 checks ran to the end', false, String(e && e.stack || e).slice(0, 400), 'no exception'); }
  try { await propChecks(page, check, want, extra); } catch (e) { check('run', 'the thing-voice checks ran to the end', false, String(e && e.stack || e).slice(0, 400), 'no exception'); }
  try { await r2Checks(page, check, want, extra); } catch (e) { check('run', 'the round-2 checks (S2, S3) ran to the end', false, String(e && e.stack || e).slice(0, 400), 'no exception'); }
  return extra;
}

/* ═══════════════════════════════ standalone runner ═══════════════════════════════ */

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
  const port = Number(args.port ?? 5367);
  const { launch, startVite, ROOT } = await import('../pw.mjs');
  const OUT = resolve(ROOT, '_harness', '_renders', 'life');
  mkdirSync(OUT, { recursive: true });
  const vite = await startVite(port);
  const browser = await launch();
  const checks = [];
  const pageErrors = [];
  const check = (group, name, pass, value, limit) => { checks.push({ group, name, pass: !!pass, value, limit }); return !!pass; };
  let code = 0;
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto(`${vite.url}_harness/audioview/index.html`);
    await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 60000 });
    if (args.baseline) {
      const a = await au07Renders(page);
      const b = await au07Renders(page);
      mkdirSync(BASE_DIR(OUT), { recursive: true });
      const fingerprints = {}, noise = {};
      let ok = true;
      for (const k of Object.keys(a)) {
        const d = diff(a[k].x, b[k].x);
        noise[k] = d.maxAbs;
        const tol = a[k].dry ? AU07_TOL.dry : AU07_TOL.chain;
        if (d.maxAbs > tol / 2) ok = false;
        console.log(`  ${k.padEnd(26)} n ${a[k].x.length}  run-to-run max|diff| ${d.maxAbs.toExponential(2)} (${a[k].dry ? 'dry' : 'chain'})`);
        fingerprints[k] = fingerprint(a[k].x);
        writeFileSync(resolve(BASE_DIR(OUT), `${k}.f32`), Buffer.from(a[k].x.buffer));
      }
      if (!ok) { console.error('a render moved by more than half its AU-07 tolerance run to run: baseline NOT written'); code = 1; }
      else writeFileSync(BASELINE, JSON.stringify({ note: 'AU-07: the existing seeded renders before any PLAYGROUND audio edit (au07Renders); full renders in _harness/_renders/life/au07_base (gitignored)', taken: new Date().toISOString(), runToRunMaxAbs: noise, fingerprints }));
    } else {
      const only = args.only ? String(args.only).split(',') : null;
      const extra = await lifeChecks({ page, check, OUT, only });
      writeFileSync(resolve(OUT, 'life_report.json'), JSON.stringify({ checks, extra, pageErrors }, null, 2));
      check('page', 'no console errors/warnings/page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0', '0');
      let g = '';
      for (const c of checks) { if (c.group !== g) { console.log(`  [${c.group}]`); g = c.group; } console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  =>  ${c.value}   (limit ${c.limit})`); }
      const bad = checks.filter((c) => !c.pass).length;
      console.log(`\n${checks.length - bad}/${checks.length} checks passed${bad ? `, ${bad} FAILED` : ''}`);
      code = bad ? 1 : 0;
    }
  } finally {
    await browser.close().catch(() => {});
    vite.stop();
  }
  process.exit(code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(2); });
