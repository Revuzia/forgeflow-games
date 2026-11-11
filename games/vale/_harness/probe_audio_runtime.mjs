// VALE harness — audio runtime truth in a REAL Chrome (closing critic gap 'audio-runtime', CW2 minors): what the
// player hears, measured at the engine's final output, on Chrome's fake output device (--disable-audio-output: the
// clamshell Mac's default device does not render, so pw.mjs probes meter silence; the closing review's
// closing_audio_tool_open.mjs method). Two modes, one per run (each holds a heavy slot):
//
//   node _harness/probe_audio_runtime.mjs sync  [--hits 50] [--out <json>]
//     A/V sync: a live match (render on), your fighter's own auto hit injected 50 times at jittered intervals INTO THE
//     FRAME LOOP (the match's pump is wrapped: the event batch reaches the renderer and the audio engine exactly as a
//     sim batch does, in the frame whose rAF timestamp is recorded). The final output (after limiter + soft clip) is
//     recorded sample-exactly by an AudioWorklet (context frame indexes); music and ambience buses are muted for the
//     run so the hit is the only sound. Per hit: the onset (first sample within 30 dB of the hit's peak) → context
//     time → performance time at the OUTPUT via AudioContext.getOutputTimestamp() (which places a context time on the
//     device clock), cross-checked by the inject-time clock + baseLatency + outputLatency. Offset = heard − the impact
//     frame's rAF timestamp. Then REFERENCE CLICKS (CW2 refix): --refs (30) bare 1 kHz clicks, a raw AudioBufferSource
//     started at 0 from the same frame-loop point, a third each joining at the output itself ('out': the platform,
//     no engine), the master's input ('master': + the mastering chain) and the sfx bus ('sfx': + the bus path),
//     measured the same way. The engine schedules nothing ahead (a cue starts at 0 the moment its event arrives); the
//     mastering chain has a FIXED latency of its own: the limiter's (WebAudio DynamicsCompressor) built-in 6 ms
//     look-ahead and the soft clip's 4x oversampler (4 ms; an OfflineAudioContext render of the same nodes reads
//     comp 6.0 / clip4 4.0 / both 10.0 ms). Gates (closing r2): every hit starts inside its event's call (the match
//     prewarms its combat cues); p95 <= one frame (the median rAF interval) + outputLatency + the sfx-bus click's
//     start-to-onset p50 (the chain's latency, documented here instead of dropping the limiter), and the cue path adds
//     <= ENGINE_OVER_MS over a sound on the sfx bus (p50 vs p50, p95 vs p95), both measured FROM THE PUMP (the frame's
//     own work point, where its picture is made too) and, when the main thread is idle (the pump within LATE_IDLE_MS of
//     the rAF timestamp at p95), from the rAF timestamp as well (else reported, 'notMeasured': needs an idle machine).
//     --runs (3) separate browsers: PASS only when every run passes. --refs (60: 20 per join point).
//   node _harness/probe_audio_runtime.mjs match [--queue rift_coop] [--seconds 420] [--fighter id] [--seed N] [--out <json>]
//     (--fighter pins your seat, the autopilot from the match on; --seed fixes the session's rng, so a capture repeats)
//     A real match at speed 1, default settings, the autopilot playing your seat. Per 4096-sample block: K-weighted
//     mean square of the output and of each bus (the sfx bus plus the threat path = what sfx the player hears) →
//     integrated loudness (gated as BS.1770), short-term (3 s) percentiles, momentary (~0.4 s) maxima; the cue log
//     with match time. Gates (closing CW2 done, minors): heal chimes <= 6 per minute; enemyDown fires; announcer
//     line peak (voice momentary max) >= 3 dB over the sfx short-term p99 (the sfx bus + threat path, measured
//     before the voice duck); the master integrated within tokens.audio.loudness (-18 ± 1.5 LUFS; CW2 refix). Reported: the lines against the teamfight windows (sfx short-term above its p90),
//     master integrated (tokens: -18 ± 1.5 LUFS; the closing review measured -19.0), ambience (about -28), music.
//     enemyDownFires is gated only when an enemy fighter died in your team's sight (fog silences the rest): the probe
//     counts the sim's own enemy fighter deaths, and when none has happened by --seconds minus 30 it forces one beside
//     your fighter (killEntity on an enemy fighter, no killer: a kill of yours would sound as takedown instead; reported as forced), so the gate is always measured (closing r2 probe:runtime-gates).
//     Lamp cues: lampSetFires / lampOutFires answer the sim's own lamps set or put out in sight AND inside the hearing range
//     (a lamp farther away is rightly culled; null = this capture had none). (max SFX-1) fighterKitShareGe50: the fighters' own kit
//     cues (f_*) are >= 50 % of the sfx-bus energy heard (rep.kitShare: f_ / c_ / w_ / u_ / m_ shares, the top cues). No near lamp out by --seconds minus 25: one of
//     your team's lit lamps is put out beside your fighter (killEntity), reported as forcedLampOut.
//   node _harness/probe_audio_runtime.mjs dead [--out <json>]
//     The music's dead state live (closing AUD-C4): a real match (render off), every bus but the music muted, the final
//     output split by two filters (< 500 Hz, > 2 kHz) and metered per block. 8 s alive, then your fighter is killed
//     (killEntity) and stays down for the mode's own respawn timer, then 8 s alive again. Then a second death on two steady
//     tones in place of the bed (200 Hz, 4 kHz, on the music bus). Gates: the engine reports the dead state while down
//     and not after; the bed's > 2 kHz band falls >= 10 dB while down; the 200 Hz tone falls DEAD_DB (2.5-3.5 dB) and the
//     4 kHz tone >= 20 dB (the 900 Hz low-pass); the bed's whole and high band come back within 3 dB after the respawn (the bed itself moves a dB or two between 8 s windows).
// Exit 0 = gates hold, 1 = a gate fails, 2 = the run itself failed. Reports → _harness/_reports/fw_CW2_runtime_<mode>.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const mode = args[0] === 'match' ? 'match' : args[0] === 'dead' ? 'dead' : 'sync';
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = opt('--out', join(HERE, '_reports', `fw_CW2_runtime_${mode}.json`));
const HITS = Number(opt('--hits', 50));
const REFS = Number(opt('--refs', 60));
const RUNS = Math.max(1, Number(opt('--runs', 3)));
const LATE_IDLE_MS = 3;   // the frame loop reaching its pump within this of the rAF timestamp (p95): an idle main thread
const REF_AT = ['out', 'master', 'sfx'];   // where a reference click joins: the output itself, the master's input, the sfx bus
const ENGINE_OVER_MS = 4;   // the engine's own share of the offset (a quarter frame): decode-cache promise, fade-in, onset
const QUEUE = opt('--queue', 'rift_coop');
const SECONDS = Number(opt('--seconds', 420));
const FIGHTER = opt('--fighter', null);
const SEED = opt('--seed', null);
const TOK = JSON.parse(readFileSync(join(HERE, '..', '_design', 'tokens.json'), 'utf8')).audio.loudness;   // -18 ± 1.5 LUFS
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

async function openFake(path) {
  const release = await holdHeavy('probe_audio_runtime ' + mode);
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  browser.on('disconnected', release);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  return { browser, page, logs };
}

async function startMatch(page, queue) {
  await page.waitForTimeout(1500);
  await page.keyboard.press('Shift');                       // a gesture: the context resumes
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  await page.evaluate((q) => { const v = window.__vale; (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); }, queue);
  await page.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 600000, polling: 500 });
}

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? x : Math.round(x * 100) / 100);

// ── sync ──────────────────────────────────────────────────────────────────────────────────────────
async function runSync() {
  const runs = [];
  for (let i = 0; i < RUNS; i++) { log(`sync run ${i + 1}/${RUNS}`); runs.push(await runSyncOnce()); if (runs[i].err) break; }
  const brief = (r) => ({ pass: r.pass, err: r.err, offsetFromPumpMs: r.offsetFromPumpMs, offsetMs: r.offsetMs, engineOverSfxBusMs: r.engineOverSfxBusMs,
    budgetMs: r.budgetMs, pumpLateMs: r.pumpLateMs, inCall: r.inCall, preRoll: r.preRoll, gates: r.gates });
  return { probe: 'probe_audio_runtime', mode: 'sync', runs: RUNS, pass: runs.length === RUNS && runs.every((r) => r.pass && !r.err),
    err: runs.find((r) => r.err)?.err ?? null, summary: runs.map(brief),
    notMeasured: [...new Set(runs.flatMap((r) => Object.entries(r.gates ?? {}).filter(([, v]) => v === null).map(([k]) => k)))], detail: runs };
}

async function runSyncOnce() {
  const { browser, page, logs } = await openFake('/?dev=1&render=1&autoflow=1');
  const rep = { probe: 'probe_audio_runtime', mode: 'sync', hits: HITS, err: null };
  try {
    await startMatch(page, QUEUE);
    log('match');
    await page.waitForFunction(() => { const m = window.__vale.state.match.value; return m && m.started !== false && m.view.players.length > 0; }, null, { timeout: 120000 });
    await page.waitForTimeout(4000);                         // loading done, first frames drawn
    rep.setup = await page.evaluate(async ([n, nRef]) => {
      const a = window.__valeAudio, g = a.graph, ctx = g.ctx, v = window.__vale, m = v.state.match.value;
      // only the hit: music and ambience off for the run
      for (const b of ['music', 'ambience']) { const p = g.bus[b].gain; p.cancelScheduledValues(0); p.value = 0; }
      // the output recorder: every render quantum of graph.out (mono sum) with its context frame
      const src = `class Rec extends AudioWorkletProcessor { constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.f0 = 0; }
        process(ins) { const i = ins[0]; if (!i || !i.length) return true; const L = i[0], R = i[1] || i[0];
          if (this.n === 0) this.f0 = currentFrame;
          for (let k = 0; k < L.length; k++) this.buf[this.n + k] = 0.5 * (L[k] + R[k]);
          this.n += L.length; if (this.n >= 4096) { this.port.postMessage({ f0: this.f0, d: this.buf.slice(0, this.n) }); this.n = 0; } return true; } }
        registerProcessor('vale-rec', Rec);`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      const rec = new AudioWorkletNode(ctx, 'vale-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      const chunks = [];
      rec.port.onmessage = (e) => chunks.push(e.data);
      g.out.connect(rec);
      const z = ctx.createGain(); z.gain.value = 0; rec.connect(z).connect(ctx.destination);
      // the frame clock
      const frames = [];
      const raf = (ts) => { frames.push(ts); if (frames.length < 100000) requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      // inject into the frame loop: the match's pump, wrapped
      const you = m.view.players.find((p) => p.player === m.you).entity;
      const hits = [];
      let due = Infinity, left = n, refLeft = nRef;
      // the platform reference: a bare 1 kHz click (instant onset), not the engine's
      const click = ctx.createBuffer(1, Math.round(0.05 * ctx.sampleRate), ctx.sampleRate);
      { const d = click.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 1000 * i / ctx.sampleRate) * (1 - i / d.length); }
      const orig = m.pump.bind(m);
      m.pump = (dt) => {
        const r = orig(dt);
        const now = performance.now();
        if (due === Infinity && m.view.time >= 2) due = now + 1500;   // after the countdown and the match-start toll
        if (left === 0 && refLeft > 0 && now >= due) {
          refLeft--;
          due = now + 400 + Math.random() * 300;
          const ts = ctx.getOutputTimestamp();
          const at = ['out', 'master', 'sfx'][refLeft % 3];
          const h = { ref: at, raf: document.timeline.currentTime, perf: now, ct: ctx.currentTime, oc: ts.contextTime, op: ts.performanceTime };
          const s = ctx.createBufferSource(); s.buffer = click; s.connect(at === 'out' ? g.out : at === 'master' ? g.master : g.bus.sfx); s.start();
          hits.push(h);
        }
        if (left > 0 && now >= due) {
          left--;
          due = now + 900 + Math.random() * 400;               // jittered against the audio blocks
          const ts = ctx.getOutputTimestamp();
          const h = { raf: document.timeline.currentTime, perf: now, ct: ctx.currentTime, oc: ts.contextTime, op: ts.performanceTime };
          const ev = [{ e: 'damage', t: m.view.time, src: you, dst: you, amount: 1, dtype: 'physical', crit: false, shielded: 0 }];
          if (a.log.length > 300) a.log.length = 0;            // the engine logs its first 400 cues only
          const k = a.log.length;                              // before the listeners: a decoded cue starts (and logs) in their call
          for (const l of m.listeners) l(ev);
          // diagnostics: did the cue start inside the event's call, and did the context clock tick while the listeners ran
          h.inCall = a.log.length > k; h.ctAfter = ctx.currentTime; h.listenMs = performance.now() - now;
          hits.push(h);
          setTimeout(() => { h.cue = a.log.slice(k).find((c) => /_attack_hit$|^c_hit_phys/.test(c)) ?? a.log[k] ?? null; }, 0);
        }
        return r;
      };
      window.__sync = { chunks, frames, hits, sr: ctx.sampleRate, done: () => left === 0 && refLeft === 0 };
      return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, you };
    }, [HITS, REFS]);
    log('injecting', HITS, 'hits', JSON.stringify(rep.setup));
    await page.waitForFunction(() => window.__sync.done(), null, { timeout: HITS * 2500 + REFS * 1500 + 30000, polling: 500 });
    await page.waitForTimeout(1500);
    const raw = await page.evaluate(() => {
      const s = window.__sync, ctx = window.__valeAudio.graph.ctx;
      const ts = ctx.getOutputTimestamp();
      // per hit: the onset in the recording after its inject time
      const f0 = s.chunks.length ? s.chunks[0].f0 : 0;
      const last = s.chunks[s.chunks.length - 1];
      const total = last ? last.f0 + last.d.length - f0 : 0;
      const x = new Float32Array(total);
      for (const c of s.chunks) x.set(c.d, c.f0 - f0);
      const out = [];
      for (const h of s.hits) {
        const a0 = Math.max(0, Math.round((h.ct - 0.05) * s.sr) - f0), a1 = Math.min(total, a0 + Math.round(0.6 * s.sr));
        let pk = 0, pkAt = -1;
        for (let i = a0; i < a1; i++) { const v = Math.abs(x[i]); if (v > pk) { pk = v; pkAt = i; } }
        const on = (db) => { const th = pk * Math.pow(10, -db / 20); for (let i = a0; i <= pkAt; i++) if (Math.abs(x[i]) >= th) return i; return -1; };
        const i30 = on(30), i20 = on(20);
        out.push({ ...h, peak: pk, on30: i30 < 0 ? null : (i30 + f0) / s.sr, on20: i20 < 0 ? null : (i20 + f0) / s.sr });
      }
      const fr = s.frames; const dts = []; for (let i = 1; i < fr.length; i++) dts.push(fr[i] - fr[i - 1]);
      return { hits: out, frameDts: dts, outputLatency: ctx.outputLatency, baseLatency: ctx.baseLatency, endTs: { oc: ts.contextTime, op: ts.performanceTime }, samples: total };
    });
    const frame = pct(raw.frameDts, 50);
    const outLatMs = (raw.outputLatency || 0) * 1000, baseLatMs = (raw.baseLatency || 0) * 1000;
    const rows = raw.hits.map((h) => {
      const heardTs = h.on30 === null ? null : h.op + (h.on30 - h.oc) * 1000;                         // the device clock
      const heardClk = h.on30 === null ? null : h.perf + (h.on30 - h.ct) * 1000 + baseLatMs + outLatMs;   // inject clock + latencies
      return { ref: h.ref ?? null, cue: h.cue ?? null, peakDb: r2(20 * Math.log10(h.peak + 1e-12)), schedMs: h.on30 === null ? null : r2((h.on30 - h.ct) * 1000), inCall: h.inCall ?? null, tickMs: h.ctAfter === undefined ? null : r2((h.ctAfter - h.ct) * 1000), listenMs: h.listenMs === undefined ? null : r2(h.listenMs),
        offTsMs: heardTs === null ? null : r2(heardTs - h.raf), offClkMs: heardClk === null ? null : r2(heardClk - h.raf), injectAfterRafMs: r2(h.perf - h.raf) };
    });
    // a hit is measured when its window holds the hit alone: its peak within 3 dB of the hits' median (a match toll or
    // a wave horn landing in the window is another sound) and its own cue logged
    // the onset search opens 50 ms before the inject (schedMs -50): a row whose onset lies before its own start call found
    // ANOTHER sound already ringing at the window's opening (a bare reference click reads the same), so nothing starts
    // early: -50 ms + the platform's +20 ms is the -30 ms 'minimum' (integ_idle_verify). Reported, not gated.
    { const pre = rows.filter((r) => r.schedMs !== null && r.schedMs < 0), clean = rows.filter((r) => !r.ref && r.schedMs !== null && r.schedMs >= 0).map((r) => r.offTsMs);
      rep.preRoll = { rows: pre.length, hits: pre.filter((r) => !r.ref).length, refs: pre.filter((r) => r.ref).length, schedMin: r2(Math.min(0, ...pre.map((r) => r.schedMs))), cleanHitOffsetMs: { min: r2(Math.min(...clean)), p50: r2(pct(clean, 50)), max: r2(Math.max(...clean)) } }; }
    const refRows = rows.filter((r) => r.ref === 'out' && r.offTsMs !== null);
    const medPk = pct(rows.filter((r) => !r.ref && r.peakDb !== null).map((r) => r.peakDb), 50);
    const ok = rows.filter((r) => !r.ref && r.offTsMs !== null && Math.abs(r.peakDb - medPk) <= 3 && r.cue && /_attack_hit$|^c_hit_phys/.test(r.cue));
    rep.excluded = rows.filter((r) => !r.ref).length - ok.length;
    const tsValid = ok.every((r) => Number.isFinite(r.offTsMs)) && raw.hits.some((h) => h.op > 0);
    const offs = ok.map((r) => (tsValid ? r.offTsMs : r.offClkMs));
    rep.frameMs = r2(frame);
    rep.outputLatencyMs = r2(outLatMs); rep.baseLatencyMs = r2(baseLatMs);
    rep.detected = ok.length;
    rep.clock = tsValid ? 'getOutputTimestamp' : 'inject clock + baseLatency + outputLatency';
    rep.offsetMs = { p50: r2(pct(offs, 50)), p95: r2(pct(offs, 95)), max: r2(Math.max(...offs)), min: r2(Math.min(...offs)) };
    // the same from the frame loop's own pump (the sim batch's arrival), and with the picture shown one frame after its rAF
    const fromPump = ok.map((r) => (tsValid ? r.offTsMs : r.offClkMs) - r.injectAfterRafMs);
    rep.offsetFromPumpMs = { p50: r2(pct(fromPump, 50)), p95: r2(pct(fromPump, 95)) };
    rep.audioAfterPictureMs = { p50: r2(pct(offs, 50) - frame), p95: r2(pct(offs, 95) - frame), note: 'picture presented at the next vsync after its rAF (headless: not measurable, assumed one frame)' };
    const alt = ok.map((r) => r.offClkMs);
    rep.offsetAltMs = { p50: r2(pct(alt, 50)), p95: r2(pct(alt, 95)) };
    rep.schedMs = { p50: r2(pct(ok.map((r) => r.schedMs), 50)), p95: r2(pct(ok.map((r) => r.schedMs), 95)) };
    // the platform reference: the same offset for a bare source started from the same frame-loop point
    const refOffs = refRows.map((r) => (tsValid ? r.offTsMs : r.offClkMs));
    rep.platform = { detected: refRows.length, offsetMs: { p50: r2(pct(refOffs, 50)), p95: r2(pct(refOffs, 95)) },
      startHopMs: { p50: r2(pct(refRows.map((r) => r.schedMs), 50)), p95: r2(pct(refRows.map((r) => r.schedMs), 95)) },
      note: 'a raw AudioBufferSource.start() into the output from the impact frame: the platform floor (start to onset ~0 ms; the offset is outputLatency plus the frame phase)' };
    rep.engineOverPlatformMs = { p50: r2(rep.offsetMs.p50 - rep.platform.offsetMs.p50), p95: r2(rep.offsetMs.p95 - rep.platform.offsetMs.p50) };
    // the same click joining further up: the mastering chain's own fixed latency (limiter pre-delay, the soft clip's
    // oversampler) and the bus path, so the engine's share is what the cue path adds over a sound on the sfx bus
    rep.chain = Object.fromEntries(REF_AT.map((k) => { const rr = rows.filter((r) => r.ref === k && r.offTsMs !== null);
      return [k, { n: rr.length, startToOnsetMs: { p50: r2(pct(rr.map((r) => r.schedMs), 50)), p95: r2(pct(rr.map((r) => r.schedMs), 95)) },
        offsetMs: { p50: r2(pct(rr.map((r) => (tsValid ? r.offTsMs : r.offClkMs)), 50)), p95: r2(pct(rr.map((r) => (tsValid ? r.offTsMs : r.offClkMs)), 95)) } }]; }));
    const busRef = rep.chain.sfx;
    rep.engineOverSfxBusMs = { p50: r2(rep.offsetMs.p50 - busRef.offsetMs.p50), p95: r2(rep.offsetMs.p95 - busRef.offsetMs.p95) };
    // the same from the pump (the frame's own work point: its sim batch, its sound AND its picture are made there),
    // so the main thread reaching the frame late (another process on the machine) counts for neither side
    const busFromPump = rows.filter((r) => r.ref === 'sfx' && r.offTsMs !== null).map((r) => (tsValid ? r.offTsMs : r.offClkMs) - r.injectAfterRafMs);
    rep.sfxBusFromPumpMs = { p50: r2(pct(busFromPump, 50)), p95: r2(pct(busFromPump, 95)) };
    rep.engineOverSfxBusFromPumpMs = { p50: r2(rep.offsetFromPumpMs.p50 - rep.sfxBusFromPumpMs.p50), p95: r2(rep.offsetFromPumpMs.p95 - rep.sfxBusFromPumpMs.p95) };
    // how late the frame loop reached its pump after the frame's rAF timestamp (the machine's main-thread load)
    const late = rows.filter((r) => r.injectAfterRafMs !== null).map((r) => r.injectAfterRafMs);
    rep.pumpLateMs = { p50: r2(pct(late, 50)), p95: r2(pct(late, 95)), max: r2(Math.max(...late)) };
    const hitRows = rows.filter((r) => !r.ref);
    rep.inCall = { started: hitRows.filter((r) => r.inCall).length, of: hitRows.length, clockTicked: hitRows.filter((r) => (r.tickMs ?? 0) > 0).length };
    rep.budgetNoHopMs = r2(frame + outLatMs);
    rep.budgetMs = r2(frame + outLatMs + (busRef.startToOnsetMs.p50 ?? 0));
    rep.rows = rows;
    const idle = rep.pumpLateMs.p95 <= LATE_IDLE_MS;
    rep.gates = { measured: ok.length >= HITS * 0.9, platformMeasured: refRows.length >= (REFS / 3) * 0.9 && busRef.n >= (REFS / 3) * 0.9,
      // every hit starts inside its event's call (none waits for a decode: the match prewarms its combat set)
      startsInCall: rep.inCall.started === rep.inCall.of,
      // A/V from the frame's work point: p95 <= one frame + outputLatency + the mastering chain (the sfx-bus click's start to onset)
      p95FromPumpWithinFramePlusOutputPlusChain: rep.offsetFromPumpMs.p95 <= rep.budgetMs,
      engineOverSfxBusFromPump: rep.engineOverSfxBusFromPumpMs.p50 <= ENGINE_OVER_MS && rep.engineOverSfxBusFromPumpMs.p95 <= ENGINE_OVER_MS,
      // from the rAF timestamp: gated on an idle main thread only (pump late p95 <= LATE_IDLE_MS), else not measured
      p95WithinFramePlusOutputPlusHop: idle ? rep.offsetMs.p95 <= rep.budgetMs : null,
      engineOverSfxBus: idle ? rep.engineOverSfxBusMs.p50 <= ENGINE_OVER_MS && rep.engineOverSfxBusMs.p95 <= ENGINE_OVER_MS : null };
    rep.pass = Object.values(rep.gates).every((v) => v !== false);
  } catch (e) { rep.err = String(e?.message ?? e); }
  rep.logs = logs.slice(0, 30);
  await browser.close().catch(() => {});
  return rep;
}

// ── match capture ─────────────────────────────────────────────────────────────────────────────────
const TAP = () => {
  const a = window.__valeAudio, g = a.graph, ctx = g.ctx;
  // final out, music, sfx bus, the threat path (sfx aimed at you, past the sfx duck), ui, voice, ambience
  const stems = [g.out, g.bus.music, g.bus.sfx, a.threat, g.bus.ui, g.bus.voice, g.bus.ambience];
  const N = stems.length * 2;
  const merger = ctx.createChannelMerger(N);
  stems.forEach((node, i) => {
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.974; hs.gain.value = 3.9998;
    hs.channelCount = 2; hs.channelCountMode = 'explicit'; hs.channelInterpretation = 'speakers';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.135; hp.Q.value = -6.015;   // WebAudio's high-pass Q is in dB: -6.015 dB = Q 0.5 (BS.1770 RLB)
    const sp = ctx.createChannelSplitter(2);
    node.connect(hs); hs.connect(hp); hp.connect(sp); sp.connect(merger, 0, 2 * i); sp.connect(merger, 1, 2 * i + 1);
  });
  const proc = ctx.createScriptProcessor(4096, N, 1);
  const st = { blocks: [] };
  window.__cap = st;
  proc.onaudioprocess = (ev) => {
    const ib = ev.inputBuffer, n = ib.length, row = [ctx.currentTime];
    for (let s = 0; s < stems.length; s++) {
      let ss = 0;
      for (let c = 0; c < 2; c++) { const d = ib.getChannelData(2 * s + c); for (let i = 0; i < n; i++) ss += d[i] * d[i]; }
      row.push(ss / n);
    }
    st.blocks.push(row);
  };
  const z = ctx.createGain(); z.gain.value = 0;
  merger.connect(proc); proc.connect(z); z.connect(ctx.destination);
  return true;
};

const LU = (ms) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-20));
const movAvg = (xs, n) => { const o = []; let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= n) s -= xs[i - n]; if (i >= n - 1) o.push(s / n); } return o; };
function integrated(ms) {
  const m = movAvg(ms, 5).filter((x) => LU(x) > -70);
  if (!m.length) return null;
  const rel = LU(m.reduce((a, b) => a + b, 0) / m.length) - 10;
  const g = m.filter((x) => LU(x) > rel);
  return LU(g.reduce((a, b) => a + b, 0) / g.length);
}

async function runMatch() {
  const { browser, page, logs } = await openFake(`/?dev=1&render=0&autopilot=${FIGHTER ? 'match' : '1'}&autoflow=1${SEED ? `&seed=${SEED}` : ''}`);
  const rep = { probe: 'probe_audio_runtime', mode: 'match', queue: QUEUE, seconds: SECONDS, seat: FIGHTER, sessionSeed: SEED, err: null, cues: [] };
  try {
    await page.waitForTimeout(1500);
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
    rep.settings = await page.evaluate(() => window.__vale.session.profile().settings.audio);
    rep.rate = await page.evaluate(() => window.__valeAudio.graph.ctx.sampleRate);
    await page.evaluate(TAP);
    await page.evaluate((q) => { const v = window.__vale; (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); }, QUEUE);
    if (FIGHTER) {
      await page.waitForFunction(() => { const v = window.__vale, s = v.state.draft.value, m = s?.seats.find((x) => x.isYou); return !!v.state.match.value || (s?.phase === 'pick' && s.turn?.action !== 'ban' && s.turn?.players.includes(m?.player)); }, null, { timeout: 120000, polling: 200 });
      await page.evaluate((f) => { const d = window.__vale.session; d.draft({ a: 'hover', fighter: f }); d.draft({ a: 'lock' }); }, FIGHTER);
    }
    await page.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 600000, polling: 500 });
    const ct0 = await page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
    rep.you = await page.evaluate(() => { const m = window.__vale.state.match.value; const p = m?.view.players.find((x) => x.player === m.you); return p ? { fighter: p.fighter ?? null, team: p.team } : null; });
    log('match', JSON.stringify(rep.you));
    // the sim's own enemy fighter deaths that the cue path answers with enemyDown (not yours: 'takedown' carries those)
    await page.evaluate(() => {
      const m = window.__vale.state.match.value;
      const st = window.__deaths = { enemy: 0, enemyNotYours: 0, enemyNotYoursInSight: 0, lampsSetSeen: 0, lampsOutSeen: 0, wardLog: [] };
      // the sim's own wards as your team sees them: what the lamp cues answer. A ward's cast is an item active, so a
      // lamp set is counted from the unit appearing; its end from its death event.
      const cat = window.__vale.session.catalog;
      const wardIds = new Set((cat?.units ?? []).filter((u) => u.kind === 'ward').map((u) => u.id));
      const inSight = (d, me) => !!d && !!me && (d.team === me.team || (((d.visibleMask ?? 0) >>> me.team) & 1) === 1);
      // a spatial cue is culled past the hearing range: a lamp far from you is rightly silent, so the gate counts the near ones
      const audible = (d) => !!d && window.__valeAudio.place({ x: d.x, y: d.y }, false).att > 0;
      m.onEvents((evs) => { const me = m.view.players.find((p) => p.player === m.you);
        for (const e of evs) {
          if (e.e === 'death' && e.kind === 'ward') { const d = m.view.entity(e.dst) ?? m.sim?.world?.entity(e.dst); const seen = inSight(d, me); const near = audible(d); if (seen && near) st.lampsOutSeen++; st.wardLog.push(['out', m.view.time, d?.team ?? null, seen, near]); }
          if (e.e === 'cast' && typeof e.ability === 'string' && window.__wardAbilities?.has(e.ability)) { const d = m.view.entity(e.src); const seen = inSight(d, me); const near = audible(d); if (seen && near) st.lampsSetSeen++; st.wardLog.push(['set', m.view.time, d?.team ?? null, seen, near]); }
        }
      });
      const setsWard = (fx) => JSON.stringify(fx ?? []).match(/"unit":"([^"]+)"/g)?.some((x) => wardIds.has(x.slice(8, -1))) ?? false;
      window.__wardAbilities = new Set((cat?.items ?? []).filter((i) => i.active && setsWard(i.active.effects)).map((i) => i.active.id));
      m.onEvents((evs) => { for (const e of evs) if (e.e === 'death' && e.kind === 'fighter') {
        const me = m.view.players.find((p) => p.player === m.you), d = m.view.entity(e.dst);
        if (d && me && d.team !== me.team) { st.enemy++; if (e.by !== m.you) { st.enemyNotYours++;
          // fog: the engine hears only what your team sees (seen()), so a death out of sight is rightly silent
          if (((d.visibleMask ?? 0) >>> me.team) & 1) st.enemyNotYoursInSight++; } } } });
    });
    const tMatch = Date.now();
    let deadSeen = 0;
    rep.forcedEnemyDeath = null;
    rep.forcedLampOut = null;
    const earshot = [];
    for (;;) {
      const s = await page.evaluate(() => {
        const a = window.__valeAudio, v = window.__vale;
        // how much of the match is in earshot of your seat (reported: what a quiet capture was doing)
        const m = v?.state?.match?.value, W = m?.sim?.world, me = m?.view.players.find((p) => p.player === m.you), mine = me && W?.entity(me.entity);
        let at = null;
        if (mine) { at = { x: mine.x, y: mine.y, alive: mine.alive, wicks: 0, foes: 0 };
          for (const e of W.entities) if (e.alive && (e.kind === 'minion' || (e.kind === 'fighter' && e.team !== mine.team)) && a.place({ x: e.x, y: e.y }, false).att > 0) { if (e.kind === 'minion') at.wicks++; else at.foes++; } }
        return { ct: a.graph.ctx.currentTime, t: m?.view?.time ?? null, cues: a.log.splice(0), dead: a.musicDead === true, at };
      });
      if (s.dead) deadSeen++;
      if (s.at && s.t !== null) earshot.push([r2(s.t), r2(s.at.x), r2(s.at.y), s.at.alive ? 1 : 0, s.at.wicks, s.at.foes]);
      // no enemy fighter has fallen by someone else's hand by the last 30 s: force one, so enemyDown is measured
      if (rep.forcedEnemyDeath === null && (s.t ?? 0) >= SECONDS - 30) {
        rep.forcedEnemyDeath = await page.evaluate(async () => {
          if (window.__deaths.enemyNotYoursInSight > 0) return false;
          const m = window.__vale.state.match.value, W = m.sim.world, me = m.view.players.find((p) => p.player === m.you);
          const { killEntity } = await import('/src/sim/combat.ts');
          const foe = m.view.players.map((p) => W.entity(p.entity)).find((e) => e && e.alive && e.team !== me.team);
          if (!foe) return 'no live enemy fighter';
          // beside your fighter, so your team sees it fall: a tick or two for the vision pass
          const mine = W.entity(me.entity);
          foe.x = mine.x + 2; foe.y = mine.y;
          const until = performance.now() + 3000;
          while (performance.now() < until && !(((m.view.entity(foe.id)?.visibleMask ?? 0) >>> me.team) & 1)) await new Promise((r) => setTimeout(r, 100));
          // outside a tick: the world's event buffer is reset by the next step, so the batch goes to the match's
          // listeners here (as the sync mode injects its hits)
          const n0 = W.events.length;
          killEntity(W, foe, null);
          const evs = W.events.slice(n0);
          for (const l of m.listeners) l(evs);
          return { fighter: foe.def ?? null, t: W.time, events: evs.map((e) => e.e) };
        });
        log('forced enemy death', JSON.stringify(rep.forcedEnemyDeath));
      }
      // no lamp has gone out near you by the last 30 s: put one of your team's lit lamps out beside your fighter, so lampOut
      // is measured through the real death path (forced as the enemy death above, and reported)
      if (rep.forcedLampOut === null && (s.t ?? 0) >= SECONDS - 25) {
        rep.forcedLampOut = await page.evaluate(async () => {
          if (window.__deaths.lampsOutSeen > 0) return false;
          const m = window.__vale.state.match.value, W = m.sim.world, me = m.view.players.find((p) => p.player === m.you), mine = W.entity(me.entity);
          const { killEntity } = await import('/src/sim/combat.ts');
          const ward = W.entities.find?.((e) => e.alive && e.kind === 'ward' && e.team === me.team) ?? null;
          if (!ward) return 'no lit lamp on your team';
          ward.x = mine.x + 2; ward.y = mine.y;
          const n0 = W.events.length;
          killEntity(W, ward, null);
          const evs = W.events.slice(n0);
          for (const l of m.listeners) l(evs);
          return { t: W.time, events: evs.map((e) => e.e), kinds: evs.map((e) => e.kind ?? null) };
        });
        log('forced lamp out', JSON.stringify(rep.forcedLampOut));
      }
      for (const c of s.cues) rep.cues.push([r2(s.ct), s.t === null ? null : r2(s.t), c]);
      if (s.t === null && rep.cues.length > 5) { log('match left'); break; }
      if ((s.t ?? 0) >= SECONDS) break;
      if ((Date.now() - tMatch) / 1000 > SECONDS * 1.6 + 300) { rep.err = 'wall-clock budget'; break; }   // from the match: a heavy-slot wait is not the run's
      await page.waitForTimeout(2000);
    }
    rep.deadPolls = deadSeen;
    rep.enemyDeaths = await page.evaluate(() => window.__deaths);
    const blocks = await page.evaluate((c0) => window.__cap.blocks.filter((r) => r[0] >= c0 - 2), ct0);
    { const n = Math.max(1, earshot.length), frac = (f) => r2(earshot.filter(f).length / n);
      let path = 0; for (let i = 1; i < earshot.length; i++) path += Math.hypot(earshot[i][1] - earshot[i - 1][1], earshot[i][2] - earshot[i - 1][2]);
      rep.earshot = { samples: earshot.length, noneNear: frac((r) => r[4] + r[5] === 0), foeNear: frac((r) => r[5] > 0), dead: frac((r) => !r[3]), pathM: r2(path), track: earshot.filter((_, i) => i % 20 === 0) }; }
    rep.heardG2 = await page.evaluate(() => Object.fromEntries(window.__valeAudio.heard ?? []));
    // (max SFX-9) the map's room send: live, and the response loaded (its length in s)
    rep.room = await page.evaluate(() => ({ on: !!window.__valeAudio.roomOn, irSeconds: window.__valeAudio.room?.buffer?.duration ?? null }));
    // (max SFX-1) whose sounds the player hears in lane: the fighters' own kits (f_*) vs the rest of the sfx bus
    // (the library c_*, the Wicks' w_*, units u_*), as summed heard energy (gain x attenuation squared, per play)
    { const bus = await page.evaluate(() => Object.fromEntries(Object.entries(window.__vale.session.catalog?.audio?.cues ?? {}).map(([k, c]) => [k, c.bus])));
      const sfxIds = Object.keys(rep.heardG2).filter((k) => bus[k] === 'sfx');
      const tot = sfxIds.reduce((a, k) => a + rep.heardG2[k], 0) || 1;
      const by = (re) => r2(100 * sfxIds.filter((k) => re.test(k)).reduce((a, k) => a + rep.heardG2[k], 0) / tot);
      rep.kitShare = { fighterPct: by(/^f_/), libraryPct: by(/^c_/), wickPct: by(/^w_/), unitPct: by(/^u_/), matchPct: by(/^m_/),
        top: sfxIds.sort((a, b) => rep.heardG2[b] - rep.heardG2[a]).slice(0, 12).map((k) => [k, r2(100 * rep.heardG2[k] / tot)]) }; }
    await page.evaluate(() => { try { window.__vale.state.match.value?.leave(); } catch { /* */ } });
    // ── analysis ──
    const col = (i) => blocks.map((r) => r[i]);
    const names = ['out', 'music', 'sfxBus', 'threat', 'ui', 'voice', 'ambience'];
    const ms = Object.fromEntries(names.map((n, i) => [n, col(i + 1)]));
    ms.sfx = ms.sfxBus.map((x, i) => x + ms.threat[i]);       // the sfx the player hears: bus + threat path
    const blk = 4096 / rep.rate;
    const loud = {};
    for (const n of ['out', 'music', 'sfx', 'voice', 'ambience']) {
      const st = movAvg(ms[n], 35).map(LU), mo = movAvg(ms[n], 5).map(LU);
      loud[n] = { I: r2(integrated(ms[n])), p10: r2(pct(st, 10)), p50: r2(pct(st, 50)), p90: r2(pct(st, 90)), p99: r2(pct(st, 99)), Mmax: r2(Math.max(...mo)) };
    }
    rep.seconds = r2(blocks.length * blk);
    rep.loudness = loud;
    // the announcer over the fight: each line's momentary peak vs the sfx short-term p99, whole capture and teamfights
    const voiceMo = movAvg(ms.voice, 5).map(LU), sfxSt = movAvg(ms.sfx, 35).map(LU);
    const sfxP90 = pct(sfxSt, 90);
    const fightIdx = sfxSt.map((v, i) => (v >= sfxP90 ? i : -1)).filter((i) => i >= 0);
    const fightP99 = pct(fightIdx.map((i) => sfxSt[i]), 99);
    const lines = [];
    for (let i = 1; i < voiceMo.length - 1; i++) if (voiceMo[i] > -45 && voiceMo[i] >= voiceMo[i - 1] && voiceMo[i] > voiceMo[i + 1]) {
      if (lines.length && i - lines[lines.length - 1].i < 12) { if (voiceMo[i] > lines[lines.length - 1].db) lines[lines.length - 1] = { i, db: voiceMo[i] }; continue; }
      lines.push({ i, db: voiceMo[i] });
    }
    const lineRows = lines.map((l) => {
      const j = Math.min(sfxSt.length - 1, Math.max(0, l.i - 17));
      return { at: r2(l.i * blk), peak: r2(l.db), sfxShortHere: r2(sfxSt[j]), overHere: r2(l.db - sfxSt[j]) };
    });
    const p99 = loud.sfx.p99;
    const linePeak = lines.length ? Math.max(...lines.map((l) => l.db)) : null;
    const lineMedian = pct(lines.map((l) => l.db), 50);
    const over = (a, b) => (a === null || b === null ? null : r2(a - b));
    rep.announcer = { lines: lines.length, linePeak: r2(linePeak), lineMedianPeak: r2(lineMedian), sfxP99: p99, teamfightSfxP99: r2(fightP99),
      // with no line there is no margin: a null peak must not coerce to 0 and pass the gate (closing r2 probe:runtime-gates)
      peakOverSfxP99: over(linePeak, p99), medianOverSfxP99: over(lineMedian, p99), medianOverTeamfightP99: over(lineMedian, fightP99),
      linesInTeamfight: lineRows.filter((r) => r.sfxShortHere >= sfxP90).map((r) => r), rows: lineRows.slice(0, 40) };
    // the cue log: heal chimes per minute, enemyDown, the lamp cues
    const tMax = Math.max(1, ...rep.cues.map((c) => c[1] ?? 0));
    const count = (id) => rep.cues.filter((c) => c[2] === id).length;
    const cat = await page.evaluate(() => ({ heal: window.__vale.session.catalog?.audio?.events?.heal ?? null })).catch(() => ({}));
    const healId = cat.heal ?? 'c_heal';
    rep.cueLog = { total: rep.cues.length, matchSeconds: r2(tMax), heal: count(healId), healPerMin: r2(count(healId) / tMax * 60),
      enemyDown: count('m_enemy_down'), allyDown: count('m_ally_down'), selfDown: count('m_self_down'), takedown: count('m_takedown'),
      lampSet: count('c_lamp_set'), lampOut: count('c_lamp_out'), summonOut: count('c_summon_out'), summon: count('c_summon') };
    rep.lamps = { sim: { setSeen: rep.enemyDeaths.lampsSetSeen, outSeen: rep.enemyDeaths.lampsOutSeen, log: rep.enemyDeaths.wardLog.map(([k, t, team, seen, near]) => [k, r2(t), team, seen, near]) },
      heard: rep.cues.filter((c) => c[2] === 'c_lamp_set' || c[2] === 'c_lamp_out').map(([, t, id]) => [id, t]) };
    const top = {}; for (const c of rep.cues) top[c[2]] = (top[c[2]] ?? 0) + 1;
    rep.cueTop = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 30);
    rep.gates = {
      healPerMinLe6: rep.cueLog.healPerMin <= 6,
      // gated only when an enemy fighter fell in your team's sight by another hand than yours (forced when the match had none)
      enemyDownFires: rep.enemyDeaths.enemyNotYoursInSight === 0 ? null : rep.cueLog.enemyDown > 0,
      // the lamp cues answer the sim's wards your team sees (null: this capture had none, not measured)
      lampSetFires: rep.lamps.sim.setSeen === 0 ? null : rep.cueLog.lampSet > 0,
      lampOutFires: rep.lamps.sim.outSeen === 0 ? null : rep.cueLog.lampOut > 0,
      announcerPeakOverSfxP99Ge3: rep.announcer.lines > 0 && rep.announcer.peakOverSfxP99 >= 3,
      // a match's loudness needs a match: a short capture (the countdown, no fights) reports it, not gates it
      masterIntegratedInTokens: rep.seconds < 240 ? null : loud.out.I !== null && Math.abs(loud.out.I - TOK.integratedLUFS) <= TOK.toleranceLU,
      // (max SFX-1) in a laning capture the fighters' own kits are at least half of the sfx heard (closing2 / max: 34 %)
      fighterKitShareGe50: rep.seconds < 240 ? null : rep.kitShare.fighterPct >= 50,
    };
    rep.tokens = TOK;
    // reported, not gated: the lines against the teamfight windows' sfx (measured before the 6 dB news-line duck, so
    // the contrast a player hears under a line is about 6 dB more)
    rep.announcer.medianOverTeamfightP99PlusDuck = rep.announcer.medianOverTeamfightP99 === null ? null : r2(rep.announcer.medianOverTeamfightP99 + 6);
    rep.notMeasured = Object.entries(rep.gates).filter(([, v]) => v === null).map(([k]) => k);
    rep.pass = Object.values(rep.gates).every((v) => v !== false) && !rep.err;
    rep.cues = rep.cues.slice(0, 3000);
  } catch (e) { rep.err = String(e?.message ?? e); }
  rep.logs = logs.slice(0, 30);
  await browser.close().catch(() => {});
  return rep;
}

// ── the music's dead state, live (closing AUD-C4) ─────────────────────────────────────────────────
async function runDead() {
  const { browser, page, logs } = await openFake('/?dev=1&render=0&autoflow=1');
  const rep = { probe: 'probe_audio_runtime', mode: 'dead', queue: QUEUE, err: null };
  const SEG = 8000;
  try {
    await startMatch(page, QUEUE);
    await page.waitForFunction(() => (window.__vale.state.match.value?.view.time ?? 0) > 12, null, { timeout: 180000, polling: 500 });
    rep.setup = await page.evaluate(() => {
      const a = window.__valeAudio, g = a.graph, ctx = g.ctx;
      for (const b of ['sfx', 'ui', 'voice', 'ambience']) { const p = g.bus[b].gain; p.cancelScheduledValues(0); p.value = 0; }
      a.threat.gain.cancelScheduledValues(0); a.threat.gain.value = 0;
      const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 500;
      // three 12 dB/oct sections: one alone lets the bed's low end through at about the closed state's level (the first
      // run read -53.8 dB there, a floor of the meter, not of the low-pass)
      const hps = [0, 1, 2].map(() => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000; return f; });
      hps[0].connect(hps[1]); hps[1].connect(hps[2]);
      const hi = hps[2];
      const merger = ctx.createChannelMerger(3);
      const mono = (n) => { const sp = ctx.createGain(); sp.channelCount = 1; sp.channelCountMode = 'explicit'; n.connect(sp); return sp; };
      mono(g.out).connect(merger, 0, 0);
      g.out.connect(lo); mono(lo).connect(merger, 0, 1);
      g.out.connect(hps[0]); mono(hi).connect(merger, 0, 2);
      const proc = ctx.createScriptProcessor(4096, 3, 1);
      const st = window.__dead = { blocks: [] };
      proc.onaudioprocess = (ev) => { const ib = ev.inputBuffer, row = [ctx.currentTime, a.musicDead ? 1 : 0];
        for (let c = 0; c < 3; c++) { const d = ib.getChannelData(c); let ss = 0; for (let i = 0; i < d.length; i++) ss += d[i] * d[i]; row.push(ss / d.length); }
        st.blocks.push(row); };
      const z = ctx.createGain(); z.gain.value = 0; merger.connect(proc); proc.connect(z); z.connect(ctx.destination);
      return { bed: a.wantBed ?? null, rate: ctx.sampleRate };
    });
    // each window has its own start and end mark: the close and the open (0.35 s time constant) are outside them
    const mark = async () => page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
    await page.waitForTimeout(1000);
    const w0 = [await mark()]; await page.waitForTimeout(SEG); w0.push(await mark());
    rep.kill = await page.evaluate(async () => {
      const m = window.__vale.state.match.value, W = m.sim.world, me = m.view.players.find((p) => p.player === m.you), e = W.entity(me.entity);
      const { killEntity } = await import('/src/sim/combat.ts');
      const n0 = W.events.length;
      killEntity(W, e, null);
      const evs = W.events.slice(n0);
      for (const l of m.listeners) l(evs);
      return { fighter: e.def ?? null, alive: e.alive, events: evs.map((x) => x.e) };
    });
    await page.waitForTimeout(1200);                        // the close's time constant x 3, and a block
    const w1 = [await mark()];
    // the mode's own respawn timer decides how long the state lasts (the mark comes from a 100 ms poll: blocks are chosen by their own flag too)
    await page.waitForFunction(() => window.__valeAudio.musicDead === false, null, { timeout: 120000, polling: 100 });
    w1.push(await mark());
    await page.waitForTimeout(1200);
    const w2 = [await mark()]; await page.waitForTimeout(SEG); w2.push(await mark());
    // the same state on two steady tones in place of the bed (it moves a dB or more between windows): the transfer itself
    await page.evaluate(() => {
      const a = window.__valeAudio, g = a.graph, ctx = g.ctx;
      const bedGain = a.bed.gain.gain; bedGain.cancelScheduledValues(0); bedGain.value = 0;
      for (const hz of [200, 4000]) { const o = ctx.createOscillator(); o.frequency.value = hz; const v = ctx.createGain(); v.gain.value = 0.05; o.connect(v).connect(g.bus.music); o.start(); }
    });
    await page.waitForTimeout(1000);
    const t0a = [await mark()]; await page.waitForTimeout(3000); t0a.push(await mark());
    await page.evaluate(async () => {
      const m = window.__vale.state.match.value, W = m.sim.world, me = m.view.players.find((p) => p.player === m.you);
      const { killEntity } = await import('/src/sim/combat.ts');
      const n0 = W.events.length;
      killEntity(W, W.entity(me.entity), null);
      const evs = W.events.slice(n0);
      for (const l of m.listeners) l(evs);
    });
    await page.waitForTimeout(3000);                        // past the close and the news line's duck
    const t0d = [await mark()];
    await page.waitForFunction(() => window.__valeAudio.musicDead === false, null, { timeout: 120000, polling: 100 });
    t0d.push(await mark());
    const raw = await page.evaluate(() => window.__dead);
    const db = (rows, k) => r2(10 * Math.log10(rows.reduce((s2, r) => s2 + r[k], 0) / Math.max(1, rows.length) + 1e-20));
    // a window's blocks by the marks AND the row's own flag (r[1], the engine's state as that block closed). The end mark
    // of a dead window comes from a 100 ms poll after the flip, so without the flag the first blocks of the re-opening
    // filter land in it, and they are up to 29 dB louder at 4 kHz: a few of them read a 29 dB drop as about 2 dB (closing
    // r2 done:6). `leaked` counts those; the state itself is judged on what is left, which must be unbroken.
    const pick = ([c0, c1], flag) => raw.blocks.filter((r) => r[0] >= c0 && r[0] < c1 && r[1] === flag);
    const inMarks = ([c0, c1]) => raw.blocks.filter((r) => r[0] >= c0 && r[0] < c1);
    rep.windows = [['alive0', w0, 0], ['dead', w1, 1], ['alive1', w2, 0]].map(([tag, marks, flag]) => { const w = pick(marks, flag), all = inMarks(marks);
      return { tag, seconds: r2(marks[1] - marks[0]), blocks: w.length, leaked: all.length - w.length, engineDead: r2(all.reduce((s2, r) => s2 + r[1], 0) / Math.max(1, all.length)),
        unbroken: all.findIndex((r) => r[1] !== flag) === -1 || all.slice(all.findIndex((r) => r[1] !== flag)).every((r) => r[1] !== flag), allDb: db(w, 2), lowDb: db(w, 3), highDb: db(w, 4) }; });
    rep.tones = [['alive', t0a, 0], ['dead', t0d, 1]].map(([tag, marks, flag]) => { const w = pick(marks, flag);
      return { tag, seconds: r2(marks[1] - marks[0]), blocks: w.length, leaked: inMarks(marks).length - w.length, hz200Db: db(w, 3), hz4000Db: db(w, 4) }; });
    rep.toneDrop = { hz200Db: r2(rep.tones[0].hz200Db - rep.tones[1].hz200Db), hz4000Db: r2(rep.tones[0].hz4000Db - rep.tones[1].hz4000Db) };
    const [a0, d, a1] = rep.windows;
    rep.drop = { allDb: r2(a0.allDb - d.allDb), lowDb: r2(a0.lowDb - d.lowDb), highDb: r2(a0.highDb - d.highDb) };
    rep.back = { allDb: r2(a1.allDb - a0.allDb), highDb: r2(a1.highDb - a0.highDb) };
    rep.gates = {
      musicPlaying: a0.allDb > -60,
      engineDeadWhileDown: d.unbroken && d.blocks >= 12 && d.leaked <= 3 && a0.engineDead === 0 && a1.engineDead === 0,
      highFallsGe10: rep.drop.highDb >= 10,
      // the bed's whole level is reported, not gated (rep.drop.allDb: 2.63 and 1.54 dB in two runs, the bed itself moving
      // about 1 dB between windows); the tones gate DEAD_DB (-3) and the 900 Hz low-pass (12 dB/oct: about -26 dB at 4 kHz)
      tone200FallsDeadDb: rep.toneDrop.hz200Db >= 2.5 && rep.toneDrop.hz200Db <= 3.5,
      tone4000FallsGe20: rep.toneDrop.hz4000Db >= 20,
      tonesMeasured: rep.tones[1].blocks >= 12,
      backWithin3: Math.abs(rep.back.allDb) <= 3 && Math.abs(rep.back.highDb) <= 3,
    };
    rep.pass = Object.values(rep.gates).every(Boolean);
  } catch (e) { rep.err = String(e?.message ?? e); }
  rep.logs = logs.slice(0, 30);
  await browser.close().catch(() => {});
  return rep;
}

const rep = mode === 'sync' ? await runSync() : mode === 'dead' ? await runDead() : await runMatch();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1));
const brief = { ...rep }; delete brief.rows; delete brief.cues; delete brief.logs;
if (brief.announcer) brief.announcer = { ...brief.announcer, rows: undefined };
console.log(JSON.stringify(brief, null, 1).slice(0, 5000));
console.log(rep.err ? `ERROR ${rep.err}` : rep.pass ? 'PASS' : 'FAIL', '→', OUT);
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
