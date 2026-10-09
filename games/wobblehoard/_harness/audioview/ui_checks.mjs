// UI v3 sound gates (_spec/UI.md 7 "UI sound", K09; batch B1): twelve interface sounds (tick press select on off open close back
// error toast trophy sticker), the engine hook SquishAudio.ui(), the uiTap haptic and the uiSounds setting. Called by
// probe_audio.mjs with the page and check(). Offline renders of the shipping voice code (view.js renderVoice), the REAL engine
// run offline (engine_offline.js: deterministic, fake clock) for the rate limit, the ceremony and priority gates and the
// overlap peak, and the REAL engine on a real AudioContext (engine_tests_ui.js) for "nothing before unlock", mute, uiSounds,
// the call storm and the leak check. Nobody can listen on the build machine: every number here is a measurement (level, length,
// click-free edges, pitch set), and the WAVs and spectrograms in _harness/_renders/ui_* are for the owner's ears.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metrics, avgSpectrum, spectralPeaks, spectrogramPng, wavBuffer } from './analysis.mjs';
import { createHaptics, UI_TAP_HAPTIC } from '../../src/input/haptics.ts';
import { optionalDefaults, sanitizeSettings, resolveSettings, SETTING_KEYS } from '../../src/core/settings.ts';

const SR = 48000;
const PEAK_MAX = 0.126;                       // -18 dBFS (UI.md 7)
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : String(v));
const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const decCh = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };
const cut = (x, from, to) => x.slice(Math.max(0, Math.round(from * SR)), Math.min(x.length, Math.round(to * SR)));
const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
const peakOf = (a) => { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; };
const hzOfM = (m) => 440 * Math.pow(2, (m - 69) / 12);
const median = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1] : NaN; };

export async function uiChecks(env) {
  const { page, check, OUT } = env;
  const info = {};
  // (a dev-server reload because another lane saved a file the page imports destroys the page context: wait for the page and retry)
  const ev = async (fn, arg) => {
    for (let i = 0; ; i++) {
      try { return await page.evaluate(([f, a]) => window.AV[f](a), [fn, arg]); } catch (e) {
        if (i >= 3 || !/Execution context was destroyed|navigation/i.test(String(e))) throw e;
        await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 60000 });
      }
    }
  };
  const render = async (spec) => { const r = await ev('renderVoice', spec); const chans = r.channels.map(decCh); return { ...r, x: chans[0], chans }; };
  const judged = (r) => cut(r.x, r.t0, Math.min(r.n / SR, r.endTime + 0.05));
  const C = await page.evaluate(() => window.AV.uiConsts);
  const KINDS = C.KINDS;

  /* the scale: D major pentatonic, every octave; a heard peak counts if it is a scale tone, its octave (the 2nd partial) or, for the triangle of 'error', an odd harmonic of one */
  const scaleHz = [];
  for (let m = 24; m <= 120; m++) if (C.SCALE_PCS.includes(m % 12)) scaleHz.push(hzOfM(m));
  const cents = (f, g) => Math.abs(1200 * Math.log2(f / g));
  const nearest = (f) => scaleHz.reduce((b, g) => (cents(f, g) < cents(f, b) ? g : b), scaleHz[0]);
  const harmonicOf = (f, hs) => { let best = { c: Infinity, h: 0 }; for (const h of hs) { const c = cents(f / h, nearest(f / h)); if (c < best.c) best = { c, h }; } return best; };
  const pcName = (f) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12];

  /* ═════════════════════════ A. the spec table itself ═════════════════════════ */
  {
    const g = 'ui spec';
    const notes = KINDS.flatMap((k) => C.SPEC[k].notes.flatMap((n) => [n.m, ...(n.from ? [n.m + n.from] : [])]));
    const bad = notes.filter((m) => !C.SCALE_PCS.includes(((m % 12) + 12) % 12));
    check(g, 'exactly 12 kinds: tick press select on off open close back error toast trophy sticker', KINDS.length === 12 && ['tick', 'press', 'select', 'on', 'off', 'open', 'close', 'back', 'error', 'toast', 'trophy', 'sticker'].every((k) => KINDS.includes(k)), KINDS.join(' '), '12');
    check(g, 'one scale: every note (and every glide start) is D, E, F#, A or B in some octave (D major pentatonic = the music\'s home collection)', notes.length >= 20 && bad.length === 0, `${notes.length} notes, ${bad.length} off-scale ${bad.join(',')}`, '0 off-scale');
    const gaps = KINDS.map((k) => C.GAP[k]);
    check(g, 'per-kind gap is between 40 and 400 ms for every kind', gaps.every((v) => v >= 0.04 - 1e-9 && v <= 0.4 + 1e-9) && Math.min(...gaps) <= 0.04 + 1e-9 && Math.max(...gaps) >= 0.4 - 1e-9, KINDS.map((k) => `${k} ${Math.round(C.GAP[k] * 1000)}`).join(', '), '40..400 ms');
    check(g, 'a note rises over >= 5 ms (>= 9 ms in Calm) and the steal fade (5 ms) is never longer than that rise (the crossfade peak bound)', C.ATT_S >= 0.005 - 1e-9 && C.CALM_ATT_S >= 0.009 - 1e-9 && C.STEAL_FADE_S <= C.ATT_S + 1e-9, `rise ${C.ATT_S * 1000} / ${C.CALM_ATT_S * 1000} ms, steal fade ${C.STEAL_FADE_S * 1000} ms`, 'fade <= rise');
    info.spec = { notes: notes.length };
  }

  /* ═════════════════════════ B. each voice: level, edges, length, pitch set ═════════════════════════ */
  const LEN = { // declared end (-65 dB tail), seconds after the call: UI sounds are short, the trophy is the one long one
    tick: [0.04, 0.2], press: [0.1, 0.4], select: [0.15, 0.5], on: [0.2, 0.6], off: [0.2, 0.6], open: [0.25, 0.7], close: [0.25, 0.7], back: [0.15, 0.5], error: [0.3, 0.8], toast: [0.3, 0.8], trophy: [0.7, 1.5], sticker: [0.2, 0.6],
  };
  const rows = {};
  const demo = [], demoCalm = [];
  const pitchInfo = {};
  for (const calm of [false, true]) {
    for (const kind of KINDS) {
      const g = `ui voice ${kind}${calm ? ' (calm)' : ''}`;
      // t0 = 0.3 s: the master chain's compressor is cold 10 ms into a fresh context and under-reports a front-loaded sound by up to
      // 1.3 dB (measured); 0.3 s in it matches the running engine to 4 digits
      const spec = { voice: 'ui', params: { kind, calm }, seed: 1, secs: 2, t0: 0.3 };
      const r = await render(spec);
      const x = judged(r);
      const m = metrics(x, SR);
      const dry = await render({ ...spec, chain: false, t0: 0 });
      const xd = cut(dry.x, 0, Math.min(dry.n / SR, dry.endTime + 0.05));
      const md = metrics(xd, SR);
      const first = peakOf(x.slice(0, Math.round(0.001 * SR))), firstD = peakOf(xd.slice(0, Math.round(0.001 * SR)));
      const endStep = (a) => { let s = 0; for (let i = Math.max(1, a.length - Math.round(0.002 * SR)); i < a.length; i++) s = Math.max(s, Math.abs(a[i] - a[i - 1])); return s; };
      const declared = r.endTime - r.t0;
      // worst case: 44.1 and 48 kHz, four sub-sample start phases (a sampled sine crest moves by up to 4%)
      let worstPk = 0, worstAt = '';
      for (const sr of [44100, 48000]) for (const ph of [0, 0.25, 0.5, 0.75]) {
        const q = await render({ ...spec, sr, t0: spec.t0 + ph / sr });
        const pq = peakOf(q.x.slice(Math.round(q.t0 * sr), Math.round(Math.min(q.n / sr, q.endTime + 0.05) * sr)));
        if (pq > worstPk) { worstPk = pq; worstAt = `${sr} Hz, phase ${ph}`; }
      }
      rows[`${kind}${calm ? '*' : ''}`] = { peak: m.peak, worst: worstPk, rms: m.activeRmsDb, dur: m.activeDurS, declared, first: first / m.peak, hf: m.hfFrac };
      check(g, `peak <= 0.126 (-18 dBFS) through the master chain at master 1 (worst case over 44.1 / 48 kHz and four start phases), and audible (> 0.02)`, worstPk <= PEAK_MAX && m.peak > 0.02, `${f4(m.peak)} at 48 kHz (${f1(m.peakDb)} dBFS); worst ${f4(worstPk)} (${f1(dbOf(worstPk))} dBFS) at ${worstAt}`, '0.02 < peak <= 0.126');
      check(g, 'click-free edges: first and last sample ~0 (< 0.002, wet and dry); the first millisecond holds <= 25% of the peak (a >= 5 ms ramp); the last 2 ms step <= 0.002; no step anywhere >= 0.04', m.startSample < 0.002 && md.startSample < 0.002 && m.endSample < 0.002 && md.endSample < 0.002 && first <= 0.25 * m.peak && firstD <= 0.25 * md.peak && endStep(x) <= 0.002 && endStep(xd) <= 0.002 && m.maxJump < 0.04 && md.maxJump < 0.04, `start ${m.startSample.toExponential(1)}/${md.startSample.toExponential(1)}, first ms ${f1(100 * first / m.peak)}% of peak, end step ${endStep(x).toExponential(1)}, max step ${f4(Math.max(m.maxJump, md.maxJump))}`, 'ok');
      check(g, `ends silent and soon: tail < -60 dBFS at its declared end, declared end ${LEN[kind][0] * 1000}..${LEN[kind][1] * 1000} ms, finite, |DC| < 0.001`, m.tailDb < -60 && declared >= LEN[kind][0] && declared <= LEN[kind][1] && m.badSamples === 0 && Math.abs(m.dc) < 0.001, `tail ${f1(m.tailDb)} dBFS, ends ${(declared * 1000).toFixed(0)} ms, audible ${(m.activeDurS * 1000).toFixed(0)} ms (-45 dBFS), DC ${m.dc.toExponential(1)}`, 'ok');
      // pitch set: the strongest spectral peaks sit on the scale (fundamentals, octaves and a triangle's 3rd harmonic), the strongest one is a declared note
      const S = C.SPEC[kind];
      const glideEnd = Math.max(0, ...S.notes.filter((n) => n.from).map((n) => n.at + n.gl)) + 0.012;
      const settled = cut(r.x, r.t0 + glideEnd, r.t0 + declared + 0.05);
      const { P, df } = avgSpectrum(settled, SR, { win: 16384 });
      const peaks = spectralPeaks(P, df, { fLo: 150, fHi: 9000, relDb: -30, promDb: 10 });
      const hs = S.notes.some((n) => n.tri) && !calm ? [1, 3, 5] : [1, 2];
      const off = peaks.filter((p) => harmonicOf(p.f, hs).c > 25);
      const top = peaks.reduce((b, p) => (p.db > b.db ? p : b), peaks[0] ?? { f: 0, db: -99 });
      const declaredHz = S.notes.map((n) => hzOfM(n.m));
      const topErr = declaredHz.reduce((b, h) => Math.min(b, cents(top.f, h)), Infinity);
      const heard = [...new Set(peaks.filter((p) => p.db > -12).map((p) => pcName(p.f)))];
      pitchInfo[`${kind}${calm ? '*' : ''}`] = { peaks: peaks.map((p) => `${p.f.toFixed(1)}Hz ${f1(p.db)}dB ${pcName(p.f)}`), heard };
      check(g, 'pitch set: every spectral peak within 30 dB of the strongest is on the scale (<= 25 cents from a scale tone or its octave; the odd harmonics 3 and 5 of a triangle too) and the strongest peak is one of the declared notes (<= 20 cents)', peaks.length >= 1 && off.length === 0 && topErr <= 20, `${peaks.length} peaks, ${off.length} off-scale; strongest ${top.f.toFixed(1)} Hz is ${f1(topErr)} cents from a declared note; heard ${heard.join(' ')}`, '0 off-scale, <= 20 cents');
      check(g, 'soft timbre: sine / triangle only, so almost nothing above 6 kHz (< 0.5% of the energy)', m.hfFrac < 0.005, `${(m.hfFrac * 100).toFixed(3)}%`, '< 0.5%');
      writeFileSync(resolve(OUT, `ui_${kind}${calm ? '_calm' : ''}.wav`), wavBuffer(x, SR));
      (calm ? demoCalm : demo).push(x);
    }
  }
  {
    const g = 'ui voices together';
    const worstCalm = Math.min(...KINDS.map((k) => dbOf(rows[k].worst) - dbOf(rows[k + '*'].worst)));
    const slower = KINDS.every((k) => rows[k + '*'].first <= rows[k].first + 1e-9);
    check(g, 'Calm is softer for every kind (peak >= 2 dB lower) and no sharper at the edge (first-millisecond share not larger)', worstCalm >= 2 && slower, `smallest drop ${f1(worstCalm)} dB; ${KINDS.map((k) => `${k} ${f1(dbOf(rows[k].worst) - dbOf(rows[k + '*'].worst))}`).join(', ')}`, '>= 2 dB');
    // determinism: no random draw anywhere (an interface sound is the same every time)
    let worstDiff = 0;
    for (const kind of KINDS) {
      const a = await render({ voice: 'ui', params: { kind }, seed: 11, secs: 2, chain: false, t0: 0 });
      const b = await render({ voice: 'ui', params: { kind }, seed: 99999, secs: 2, chain: false, t0: 0 });
      let d = 0; for (let i = 0; i < a.x.length; i++) d = Math.max(d, Math.abs(a.x[i] - b.x[i]));
      worstDiff = Math.max(worstDiff, d);
    }
    check(g, 'deterministic: two different seeds render the same samples for every kind (max difference <= 1e-5)', worstDiff <= 1e-5, worstDiff.toExponential(2), '<= 1e-5');
    // hostile parameters
    const h = await render({ voice: 'ui', params: { kind: 'bogus', calm: 'yes', level: 'NaN' }, seed: 1, secs: 1 });
    const hm = metrics(judged(h), SR);
    check(g, 'hostile parameters (unknown kind, calm "yes", level NaN): finite audio, peak <= 0.126', hm.badSamples === 0 && hm.peak <= PEAK_MAX, `${hm.badSamples} bad, peak ${f4(hm.peak)}`, '0 bad');
    // quieter than the toy: the canonical poke / release / land / pop
    const toy = {};
    for (const [name, spec] of Object.entries({ poke: { voice: 'poke', params: { intensity: 0.6 }, seed: 11, secs: 0.8 }, release: { voice: 'release', params: { compression: 0.7 }, seed: 13, secs: 1 }, land: { voice: 'land', params: { intensity: 0.6 }, seed: 14, secs: 0.6 }, pop: { voice: 'pop', params: { size: 0.5 }, seed: 15, secs: 0.5 } })) {
      const m = metrics(judged(await render(spec)), SR); toy[name] = { peak: m.peak, rms: m.activeRmsDb };
    }
    const uiMax = Math.max(...KINDS.map((k) => rows[k].worst)), toyMin = Math.min(...Object.values(toy).map((v) => v.peak));
    const uiRms = median(KINDS.map((k) => rows[k].rms)), toyRms = median(Object.values(toy).map((v) => v.rms));
    check(g, 'quieter than the toy: the loudest interface peak is below the quietest canonical poke / release / land / pop peak, and the median active RMS is lower too', uiMax < toyMin && uiRms < toyRms, `UI peak <= ${f4(uiMax)}, toy peaks ${Object.entries(toy).map(([k, v]) => `${k} ${f3(v.peak)}`).join(' ')}; median RMS UI ${f1(uiRms)} vs toy ${f1(toyRms)} dBFS`, 'UI below');
    info.reference = toy; info.rows = rows; info.pitch = pitchInfo;
    // artefacts for the owner's ears
    const gap = new Float32Array(Math.round(0.35 * SR));
    const strip = (list) => { const parts = []; for (const x of list) parts.push(x, gap); const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return all; };
    const all = strip(demo);
    writeFileSync(resolve(OUT, 'ui_all.wav'), wavBuffer(all, SR));
    writeFileSync(resolve(OUT, 'ui_all_calm.wav'), wavBuffer(strip(demoCalm), SR));
    writeFileSync(resolve(OUT, 'ui_all.png'), spectrogramPng(all, SR, { title: 'UI SOUNDS: TICK PRESS SELECT ON OFF OPEN CLOSE BACK ERROR TOAST TROPHY STICKER (0.35 S APART)', win: 2048, width: 1100, fMin: 150, fMax: 4000 }));
  }

  /* ═════════════════════════ C. the pure limiter ═════════════════════════ */
  {
    const g = 'ui rate limit (pure)';
    const out = [];
    for (const kind of KINDS) {
      const calls = []; for (let t = 5; t < 7; t += 0.005) calls.push({ t: +t.toFixed(3), kind });
      const r = await ev('uiLimiterRun', calls);
      const ok = r.out.filter((q) => q.ok).map((q) => q.t);
      const sp = ok.slice(1).map((t, i) => t - ok[i]);
      const gap = C.GAP[kind];
      out.push({ kind, n: ok.length, minSp: Math.min(...sp), maxSp: Math.max(...sp), gap, throttled: r.throttled, calls: calls.length });
    }
    const bad = out.filter((o) => !(o.minSp >= o.gap - 1e-9 && o.maxSp <= o.gap + 0.0051 && o.n + o.throttled === o.calls && o.n >= Math.floor(2 / (o.gap + 0.005))));
    check(g, 'each kind called every 5 ms for 2 s: accepted calls are spaced >= its gap (and < gap + 5 ms), every other call is counted as throttled', bad.length === 0, out.map((o) => `${o.kind} ${o.n}x/${Math.round(o.minSp * 1000)}ms`).join(', '), 'spacing >= gap');
    const mixed = await ev('uiLimiterRun', [{ t: 1, kind: 'tick' }, { t: 1.01, kind: 'press' }, { t: 1.02, kind: 'tick' }, { t: 1.05, kind: 'tick' }, { t: NaN, kind: 'tick' }, { t: Infinity, kind: 'select' }, { t: 1.2, kind: 'tick' }]);
    check(g, 'kinds are limited separately (a tick does not block a press), NaN / Infinity times are refused without throwing', mixed.out.map((q) => (q.ok ? 1 : 0)).join('') === '1101001' && mixed.throttled === 3, mixed.out.map((q) => (q.ok ? 'Y' : 'n')).join(''), 'YYnYnnY');
    info.limiter = out;
  }

  /* ═════════════════════════ D. the real engine, offline (deterministic fake clock) ═════════════════════════ */
  const run = async (events, o = {}) => {
    const r = await ev('runEngineOffline', { secs: o.secs, seed: o.seed ?? 41, musicOn: !!o.music, master: o.master ?? 1, events, want: o.want ?? ['mix'] });
    const out = { ...r };
    for (const k of Object.keys(r.stems)) out[k] = decCh(r.stems[k]);
    return out;
  };
  const st = (r) => r.final.stats.started;

  /* D1. all twelve through ensure(): counted, under the ceiling, the same level as the bare voice */
  {
    const g = 'ui engine (offline): all 12 kinds';
    const T = (i) => 0.3 + 1.5 * i;
    const r = await run(KINDS.map((kind, i) => ({ t: T(i), op: 'ui', a: { kind } })), { secs: T(12) + 0.5 });
    const peaks = KINDS.map((kind, i) => peakOf(cut(r.mix, T(i) - 0.01, T(i) + 1.45)));
    const s = st(r);
    check(g, 'every kind is counted once in stats() (ui:<kind> = 1 for all 12, ui = 12), no error', KINDS.every((k) => s['ui:' + k] === 1) && s.ui === 12 && r.errors === 0, KINDS.map((k) => `${k} ${s['ui:' + k]}`).join(', ') + `, ui ${s.ui}`, 'all 1, ui 12');
    check(g, 'engine output peak of each kind at master 1 is <= 0.126 and within 0.6 dB of the bare voice rendered 0.3 s into a context (the engine adds no gain of its own)', peaks.every((p, i) => p <= PEAK_MAX && Math.abs(dbOf(p) - dbOf(rows[KINDS[i]].peak)) <= 0.6), KINDS.map((k, i) => `${k} ${f4(peaks[i])}/${f4(rows[k].peak)}`).join(', '), '<= 0.126, +/-0.6 dB');
    info.engine12 = { peaks: Object.fromEntries(KINDS.map((k, i) => [k, peaks[i]])) };
  }

  /* D2. the per-kind gap through the engine: a call every 10 ms for 2 s */
  {
    const g = 'ui engine (offline): rate limit';
    const W = 3.0;          // longer than the trophy's protected window, so a window never starts inside the one before
    const events = [];
    KINDS.forEach((kind, i) => { for (let k = 0; k < 200; k++) events.push({ t: 0.2 + W * i + 0.01 * k, op: 'ui', a: { kind } }); });
    const r = await run(events, { secs: 0.2 + W * 12 + 0.3 });
    const s = st(r);
    const exp = {};
    let expThr = 0;
    for (const [i, kind] of KINDS.entries()) {
      const calls = []; for (let k = 0; k < 200; k++) calls.push({ t: (1000 + (0.2 + W * i + 0.01 * k) * 1000) / 1000, kind });
      const lr = await ev('uiLimiterRun', calls);
      exp[kind] = lr.out.filter((q) => q.ok).length; expThr += lr.throttled;
    }
    const th = r.final.throttled;
    check(g, 'a call every 10 ms for 2 s per kind: each kind plays exactly as often as its gap allows (same count as the pure limiter), the rest is counted in throttled.ui, and every call is accounted for (played + throttled.ui + uiBusy + uiCeremony = 2400)', KINDS.every((k) => s['ui:' + k] === exp[k]) && th.ui === expThr && s.ui + th.ui + th.uiBusy + th.uiCeremony === 2400 && th.uiBusy === 0 && r.errors === 0, KINDS.map((k) => `${k} ${s['ui:' + k]}/${exp[k]}`).join(', ') + `; throttled ${th.ui}/${expThr}, busy ${th.uiBusy}, ceremony ${th.uiCeremony}, played ${s.ui}`, 'equal, 2400 accounted');
    check(g, 'the 200 calls per kind never pile up: at most 3 voice groups alive at any time', Math.max(...r.statLog.map((q) => q[4])) <= 3, `max live ${Math.max(...r.statLog.map((q) => q[4]))}`, '<= 3');
    info.rate = { exp, played: Object.fromEntries(KINDS.map((k) => [k, s['ui:' + k]])) };
  }

  /* D3. overlap: a new sound while another is sounding crossfades it; the sum never exceeds the louder of the two */
  {
    const g = 'ui engine (offline): overlap peak';
    const PR = C.PRIORITY;
    const pairs = [];
    for (const a of KINDS) for (const b of KINDS) if (a !== b && PR[b] >= PR[a]) for (const d of [0.008, 0.08]) pairs.push({ a, b, d });
    const WIN = 1.45;
    const per = 36;
    let worst = { pk: 0 }, n = 0, played = 0, errors = 0;
    for (let c = 0; c < pairs.length; c += per) {
      const chunk = pairs.slice(c, c + per);
      const events = [];
      chunk.forEach((p, i) => { events.push({ t: 0.2 + WIN * i, op: 'ui', a: { kind: p.a } }, { t: 0.2 + WIN * i + p.d, op: 'ui', a: { kind: p.b } }); });
      const r = await run(events, { secs: 0.2 + WIN * chunk.length + 0.2 });
      errors += r.errors; played += st(r).ui;
      chunk.forEach((p, i) => {
        const pk = peakOf(cut(r.mix, 0.2 + WIN * i - 0.005, 0.2 + WIN * i + WIN - 0.01));
        n++;
        if (pk > worst.pk) worst = { pk, a: p.a, b: p.b, d: p.d };
      });
    }
    check(g, `${pairs.length} overlapping pairs (every kind followed by every other kind of equal or higher priority, 8 ms and 80 ms later; the 5 ms crossfade): output peak <= 0.126 in all`, worst.pk <= PEAK_MAX && errors === 0 && played === 2 * pairs.length, `worst ${f4(worst.pk)} (${worst.a} then ${worst.b} +${worst.d * 1000} ms); ${played} of ${2 * pairs.length} sounds started`, '<= 0.126, all started');
    info.overlap = { pairs: pairs.length, worst };
  }

  /* D4. ceremonies */
  {
    const g = 'ui engine (offline): ceremonies';
    const ev1 = [
      { t: 0.2, op: 'reveal', a: { tier: 'rare', isNew: true } },
      { t: 0.5, op: 'ui', a: { kind: 'tick' } }, { t: 0.52, op: 'ui', a: { kind: 'press' } }, { t: 0.54, op: 'ui', a: { kind: 'select' } },
      { t: 0.56, op: 'ui', a: { kind: 'error' } }, { t: 0.58, op: 'ui', a: { kind: 'open' } },
      { t: 0.7, op: 'ui', a: { kind: 'toast' } }, { t: 1.3, op: 'ui', a: { kind: 'trophy' } },
      { t: 12, op: 'ui', a: { kind: 'press' } },
      { t: 14, op: 'capsuleBeat', a: { beat: 'crack' } }, { t: 14.1, op: 'ui', a: { kind: 'tick' } }, { t: 15, op: 'ui', a: { kind: 'tick' } },
      { t: 16, op: 'mergeStart', a: { tier: 'rare', chargeS: 1.0 } }, { t: 16.3, op: 'ui', a: { kind: 'select' } }, { t: 22, op: 'ui', a: { kind: 'select' } },
    ];
    const r = await run(ev1, { secs: 23.5 });
    const s = st(r);
    check(g, 'a reveal: tick press select error open (5 calls) are dropped and counted in throttled.uiCeremony; toast and trophy play; press plays again at 12 s', s['ui:tick'] === 1 && s['ui:press'] === 1 && s['ui:select'] === 1 && s['ui:error'] === 0 && s['ui:open'] === 0 && s['ui:toast'] === 1 && s['ui:trophy'] === 1, `started ${['tick', 'press', 'select', 'error', 'open', 'toast', 'trophy'].map((k) => `${k} ${s['ui:' + k]}`).join(' ')}; throttled.uiCeremony ${r.final.throttled.uiCeremony}`, 'tick 1, press 1, select 1, error/open 0, toast 1, trophy 1 (the later tick, press and select come after the ceremony)');
    check(g, 'dropped by ceremony: 5 (reveal) + 1 (capsule crack) + 1 (merge charge) = 7; no error', r.final.throttled.uiCeremony === 7 && r.errors === 0, `${r.final.throttled.uiCeremony}`, '7');
    info.ceremony = { started: s, throttled: r.final.throttled };
  }

  /* D5. priority */
  {
    const g = 'ui engine (offline): priority';
    const r = await run([
      { t: 0.2, op: 'ui', a: { kind: 'trophy' } }, { t: 0.3, op: 'ui', a: { kind: 'press' } }, { t: 0.4, op: 'ui', a: { kind: 'toast' } }, { t: 0.45, op: 'ui', a: { kind: 'error' } },
      { t: 0.7, op: 'ui', a: { kind: 'trophy' } }, { t: 1.5, op: 'ui', a: { kind: 'press' } },
      { t: 3, op: 'ui', a: { kind: 'toast' } }, { t: 3.1, op: 'ui', a: { kind: 'select' } }, { t: 3.4, op: 'ui', a: { kind: 'select' } },
    ], { secs: 5 });
    const s = st(r);
    check(g, 'a trophy (protected 0.7 s) is not cut by press / toast / error (3 uiBusy); a second trophy 0.5 s later takes over; a press after 0.8 s plays; a toast (protected 0.3 s) blocks a select at +0.1 s (4th uiBusy) but not at +0.4 s', s['ui:trophy'] === 2 && s['ui:press'] === 1 && s['ui:toast'] === 1 && s['ui:error'] === 0 && s['ui:select'] === 1 && r.final.throttled.uiBusy === 4, `trophy ${s['ui:trophy']} press ${s['ui:press']} toast ${s['ui:toast']} error ${s['ui:error']} select ${s['ui:select']}, uiBusy ${r.final.throttled.uiBusy}`, 'trophy 2, press 1, toast 1, error 0, select 1, uiBusy 4');
  }

  /* D6. the other voices' seeded variation is untouched by interface sounds */
  {
    const g = 'ui engine (offline): isolation';
    // The same seeded session with and without interface sounds earlier on: the poke / pop / release from 4 s on must be identical
    // to float noise. 'land' is left out of the comparison on purpose: two IDENTICAL sessions already differ by ~4e-3 in the land
    // window (measured 2026-10-08, no ui call involved; a pre-existing run-to-run difference of the land voice, not ours).
    const core = [{ t: 4, op: 'poke', a: { intensity: 0.7 } }, { t: 4.6, op: 'pop', a: { size: 0.4 } }, { t: 5.2, op: 'release', a: { compression: 0.6 } }];
    const uiEv = KINDS.slice(0, 9).map((kind, i) => ({ t: 0.2 + 0.3 * i, op: 'ui', a: { kind } }));
    const a = await run(core, { secs: 6.5, seed: 77 });
    const a2 = await run(core, { secs: 6.5, seed: 77 });
    const b = await run([...uiEv, ...core], { secs: 6.5, seed: 77 });
    const c = await run([{ t: 0.2, op: 'pop', a: { size: 0.5 } }, { t: 0.5, op: 'land', a: { intensity: 0.4 } }, ...core], { secs: 6.5, seed: 77 });
    const maxDiff = (x, y) => { const wx = cut(x.mix, 3.9, 6.5), wy = cut(y.mix, 3.9, 6.5); let d = 0; for (let i = 0; i < wx.length; i++) d = Math.max(d, Math.abs(wx[i] - wy[i])); return d; };
    const dSelf = maxDiff(a, a2), dUi = maxDiff(a, b), dCtl = maxDiff(a, c);
    check(g, 'adding 9 interface sounds earlier in a seeded session leaves the poke, pop and release from 4 s on identical to float noise (max difference <= 1e-4; ui draws nothing from the random streams of the engine)', dUi <= 1e-4 && st(b).ui === 9, `ui ${dUi.toExponential(2)} (two identical sessions: ${dSelf.toExponential(2)}), ui started ${st(b).ui}`, '<= 1e-4');
    check(g, 'the comparison can see a shift: the same session with an earlier pop and land instead differs by >= 0.01 (control)', dCtl >= 0.01, dCtl.toExponential(2), '>= 0.01');
    info.isolation = { dSelf, dUi, dCtl };
  }

  /* D7. under the music (informational: the music bed is not touched; the ui sounds do not make room) */
  {
    const g = 'ui engine (offline): with the music bed';
    const T = (i) => 8 + 1.6 * i;
    const r = await run(KINDS.map((kind, i) => ({ t: T(i), op: 'ui', a: { kind } })), { secs: T(12) + 0.5, music: true, want: ['mix', 'fx', 'music'] });
    const margins = KINDS.map((kind, i) => {
      const a = T(i), b = T(i) + Math.min(C.SPEC[kind].notes.reduce((q, n) => Math.max(q, n.at + 0.35), 0.15), 1.2);
      return { kind, fxPk: peakOf(cut(r.fx, a, b)), musPk: peakOf(cut(r.music, a, b)), fxRms: dbOf(rmsOf(cut(r.fx, a, b))), musRms: dbOf(rmsOf(cut(r.music, a, b))) };
    });
    const mixPk = peakOf(r.mix);
    check(g, 'with the music bed on (volume 0.45) at master 1: the output stays under the limiter ceiling (<= 0.89) and no ui voice errors', mixPk <= 0.89 && r.errors === 0 && st(r).ui === 12, `mix peak ${f4(mixPk)}, ui ${st(r).ui}`, '<= 0.89');
    info.underMusic = margins.map((m) => ({ kind: m.kind, 'ui peak': +m.fxPk.toFixed(3), 'music peak same span': +m.musPk.toFixed(3), 'ui-music RMS dB': +(m.fxRms - m.musRms).toFixed(1) }));
    writeFileSync(resolve(OUT, 'ui_under_music.wav'), wavBuffer(cut(r.mix, 7.5, T(12) + 0.5), SR));
  }

  /* ═════════════════════════ E. the real engine on a real AudioContext ═════════════════════════ */
  {
    await page.goto(page.url());
    await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 60000 });
    const res = await page.evaluate(() => window.AV.runEngineTestsUi());
    for (const c of res.checks) check('ui engine (live)', c.name, c.pass, c.value, c.limit);
    info.live = res.info;
  }

  /* ═════════════════════════ F. haptics and the setting (pure, in Node) ═════════════════════════ */
  {
    const g = 'ui haptics';
    const calls = [];
    let coarse = true;
    const h = createHaptics({ vibrate: (p) => { calls.push(Array.isArray(p) ? [...p] : p); return true; }, coarse: () => coarse, enabled: true });
    h.uiTap(); h.uiTap('tap'); h.uiTap('error'); h.uiTap('trophy'); h.uiTap('ready');
    const pulses = (p) => (Array.isArray(p) ? p.filter((_, i) => i % 2 === 0) : [p]);
    const all = calls.flatMap(pulses);
    check(g, 'uiTap: a tap is one 8-12 ms pulse; error, trophy and ready are double pulses (two pulses of 8-14 ms, a 40-70 ms gap)', calls.length === 5 && calls[0] === 10 && calls[1] === 10 && [2, 3, 4].every((i) => Array.isArray(calls[i]) && calls[i].length === 3 && calls[i][0] >= 8 && calls[i][0] <= 14 && calls[i][2] >= 8 && calls[i][2] <= 14 && calls[i][1] >= 40 && calls[i][1] <= 70) && all.every((v) => v >= 8 && v <= 14), JSON.stringify(calls), 'tap 10, doubles [10,50,10] [10,50,14] [10,60,10]');
    check(g, 'the table UI_TAP_HAPTIC is what is sent', JSON.stringify(calls.slice(2)) === JSON.stringify([UI_TAP_HAPTIC.error, UI_TAP_HAPTIC.trophy, UI_TAP_HAPTIC.ready]) && UI_TAP_HAPTIC.tap === 10, JSON.stringify(UI_TAP_HAPTIC), 'equal');
    calls.length = 0; coarse = false;
    h.uiTap('tap'); h.uiTap('error');
    const fine = calls.length;
    coarse = true; h.setEnabled(false);
    const b0 = calls.length;
    h.uiTap('tap'); h.uiTap('trophy');
    const off = calls.length - b0;
    h.setEnabled(true);
    const b1 = calls.length;
    h.uiTap('bogus');
    const bogus = calls.slice(b1);
    const none = createHaptics({ vibrate: null, coarse: () => true }); none.uiTap('tap');
    let threw = false;
    try { const t = createHaptics({ vibrate: () => { throw new Error('NotAllowedError'); }, coarse: () => true }); t.uiTap('tap'); t.uiTap('error'); } catch { threw = true; }
    check(g, 'uiTap does nothing on a fine pointer (mouse / pen), with Settings haptics off, or without navigator.vibrate; an unknown kind is a tap; a throwing vibrate() never escapes', fine === 0 && off === 0 && bogus.length === 1 && bogus[0] === 10 && !threw, `fine pointer ${fine} calls, haptics off ${off} calls, unknown kind -> ${JSON.stringify(bogus)}, threw ${threw}`, '0, 0, [10], false');
    const gs = 'ui setting';
    const env = { reducedMotion: false, vibrate: false, touch: false };
    const base = { volume: 0.8, squishBoost: 0.4, haptics: false, shake: 0.35, gravity: true, quality: 'auto' };
    const d = optionalDefaults(env);
    const sOn = sanitizeSettings({ uiSounds: false }, base), sBad = sanitizeSettings({ uiSounds: 'no' }, { ...base, uiSounds: true }), sNone = sanitizeSettings({}, base);
    check(gs, 'uiSounds: default on, accepted as a boolean, a non-boolean falls back to the base, absent stays absent, and the key is a saved setting', d.uiSounds === true && sOn.uiSounds === false && sBad.uiSounds === true && sNone.uiSounds === undefined && resolveSettings(base, env).uiSounds === true && SETTING_KEYS.includes('uiSounds'), `default ${d.uiSounds}, false -> ${sOn.uiSounds}, "no" -> ${sBad.uiSounds}, absent -> ${sNone.uiSounds}, resolved ${resolveSettings(base, env).uiSounds}`, 'on, false, true (base), undefined, true');
  }
  return info;
}
