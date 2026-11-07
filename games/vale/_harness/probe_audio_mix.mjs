// VALE harness — the world under the score: ambience in a real match, metered (final parity AUD-8).
//
//   node _harness/probe_audio_mix.mjs [--out <report.json>] [--laning S] [--short S] [--maps rift,bridge,fray] [--fighter id] [--seed N]
//                                     [--stall S] [--device]
//   (--fighter pins your seat, autopilot from the match on; --seed fixes the session's rng, so a capture can be repeated)
//
// Real Chrome (pw.mjs, fresh profile = DEFAULT settings), the real client at speed 1 with the autopilot playing your
// seat (?dev=1&render=0&autopilot=1&autoflow=1; render=0: no renderer, so the engine hears from your fighter), the
// real engine. Its buses are metered in-page per 4096-sample block with BS.1770 K-weighting (a ScriptProcessor tap on
// window.__valeAudio.graph): the master (the limiter's output: what reaches the speakers), the music bus, the
// ambience bus and the sfx bus. Short-term loudness = 3 s windows (35 blocks), as the final parity review measured it.
// For each map a co-op / standard match is queued (session.queue) and recorded from match time 30 s:
//   RIFT    --laning s (default 180): the laning window
//   BRIDGE, FRAY   --short s (default 60)
// Gates:
//   M1  every map: the ambience bus carries signal (short-term p50 above -60 LUFS) and the engine has ambience emitters
//       playing (window.__valeAudio.ambience; their starts are in its cue log)
//   M2  RIFT laning: the master's short-term p10 is above the music stem's p50 (the review's comparison: the quiet floor
//       of the mix is no longer the music alone); the music stem through the master gain is reported too, and the
//       floor's lift attributed to the ambience (master p10 minus the same master with the ambience bus taken out),
//       which must be >= 1 dB (the floor is the world's, not just the fight's SFX)
// Exit 0 = M1, M2 hold; 1 = a gate failed; 2 = a map not measured (its AudioContext clock froze for --stall s,
// default 20, or the window overran span x 1.5 + 60 s of wall time: with --device, a stalled output device),
// which is not a pass. Report → _harness/_reports/fw_W3_mix.json. Needs the dev server and a built catalog
// (npm run content).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';
import { BASE, open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_mix.json'));
const LANING_S = Number(arg('--laning', 180));
const SHORT_S = Number(arg('--short', 60));
const MAPS = arg('--maps', 'rift,bridge,fray').split(',');
const FIGHTER = arg('--fighter', null);
const SEED = arg('--seed', null);
const QUEUE = { rift: 'rift_coop', bridge: 'bridge_standard', fray: 'fray_standard' };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// the tap: K-weighted mean square per block for master (post-limiter), music, ambience, sfx (L+R each)
const TAP = () => {
  const a = window.__valeAudio;
  const g = a.graph;
  const ctx = g.ctx;
  const stems = [g.limiter, g.bus.music, g.bus.ambience, g.bus.sfx];
  const N = stems.length * 2;
  const merger = ctx.createChannelMerger(N);
  stems.forEach((node, i) => {
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.974; hs.gain.value = 3.9998;
    hs.channelCount = 2; hs.channelCountMode = 'explicit'; hs.channelInterpretation = 'speakers';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.135; hp.Q.value = -6.015;   // WebAudio's high-pass Q is in dB: BS.1770's 0.5003
    const sp = ctx.createChannelSplitter(2);
    node.connect(hs); hs.connect(hp); hp.connect(sp); sp.connect(merger, 0, 2 * i); sp.connect(merger, 1, 2 * i + 1);
  });
  const proc = ctx.createScriptProcessor(4096, N, 1);
  const st = { blocks: [] };
  window.__mix = st;
  proc.onaudioprocess = (ev) => {
    const ib = ev.inputBuffer; const n = ib.length; const row = [ctx.currentTime];
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

const L = (ms) => -0.691 + 10 * Math.log10(Math.max(ms, 1e-20));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
function shortTerm(blocks, col) {
  const out = [];
  for (let i = 35; i <= blocks.length; i++) { let s = 0; for (let j = i - 35; j < i; j++) s += blocks[j][col]; out.push(L(s / 35)); }
  return out;
}

const STALL_S = Number(arg('--stall', 20));
const FAKE_SINK = !args.includes('--device');   // --fake-sink: accepted, the default since fw r4

// The sink (fw r4 AUD-1): by default the same harness Chrome as pw.mjs open() (same flags, viewport, heavy slot, silent
// HMR socket) plus --disable-audio-output, Chrome's timer-driven fake output stream, as probe_audio_runtime and
// probe_audio_music already run. The client's graph renders at real time and the tap meters it exactly as on a device;
// only the speakers are left out. On this machine the default output device stalls (11-07: a bare about:blank
// AudioContext frozen at 0.00533 s with state 'running', afplay of a 1 s file still blocked at 10 s; the fake sink's clock
// advances 5.01 s in 5.01 s; fw_r4_aud_ctxclock.mjs), which is what hung this probe. --device: the pw.mjs device path
// (a stalled device then reads not measured, exit 2). The report names the sink.
async function openFakeSink(path) {
  const release = await holdHeavy('probe_audio_mix fake-sink');
  const b = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1',
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  b.on('disconnected', release);
  const context = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.routeWebSocket(/.*/, () => {});
  const p = await context.newPage();
  const lg = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') lg.push(`[${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => lg.push(`[pageerror] ${e.message}`));
  await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
  return { browser: b, page: p, logs: lg };
}
const failures = [];
const notMeasured = [];
const report ={ probe: 'probe_audio_mix', laningS: LANING_S, shortS: SHORT_S, maps: {} };
const URL_PATH = `/?dev=1&render=0&autopilot=${FIGHTER ? 'match' : '1'}&autoflow=1${SEED ? `&seed=${SEED}` : ''}`;
report.sink = FAKE_SINK ? 'fake (--disable-audio-output)' : 'device';
const { browser, page, logs } = FAKE_SINK ? await openFakeSink(URL_PATH) : await open(URL_PATH, { hmr: false });
try {
  for (const map of MAPS) {
    if (map !== MAPS[0]) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!window.__vale, null, { timeout: 60000 }); }
    await page.waitForFunction(() => !!window.__valeAudio, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.keyboard.press('Shift');                       // a gesture: the engine creates + resumes its context
    await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
    report.settings ??= await vale(page, (v) => v.session.profile().settings.audio);
    await page.evaluate(TAP);
    await vale(page, (v, q) => { (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); return true; }, QUEUE[map]);
    log(map, 'queued', QUEUE[map]);
    if (FIGHTER) {
      await page.waitForFunction(() => { const v = window.__vale, s = v.state.draft.value, m = s?.seats.find((x) => x.isYou); return !!v.state.match.value || (s?.phase === 'pick' && s.turn?.action !== 'ban' && s.turn?.players.includes(m?.player)); }, null, { timeout: 120000, polling: 200 });
      await page.evaluate((f) => { const d = window.__vale.session; d.draft({ a: 'hover', fighter: f }); d.draft({ a: 'lock' }); }, FIGHTER);
    }
    await waitFor(page, (v) => !!v.state.match.value, 600000);
    const you = await page.evaluate(() => { const m = window.__vale.state.match.value, p = m?.view.players.find((x) => x.player === m.you); return p ? { fighter: p.fighter ?? null, team: p.team } : null; });
    log(map, 'match', JSON.stringify(you));
    await waitFor(page, (v) => (v.state.match.value?.view.time ?? -1) >= 30, 300000);
    const span = map === 'rift' ? LANING_S : SHORT_S;
    const sync = [];
    const startCt = await page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
    let emitters = null;
    // the deadline (fw r4 AUD-2): the loop runs on the context's clock, which a stalled output device freezes while
    // the context still reads 'running' (11-07: frozen at 0.00533 s, a bare AudioContext and afplay stalled too).
    // Wall time caps it at span x 1.5 + 60 s, and a clock that has not moved for STALL_S of wall time while the match
    // clock has ends it early: that map is reported not measured (exit 2), never hung on and never read as a pass.
    const deadline = Date.now() + (span * 1.5 + 60) * 1000;
    let lastCt = startCt, lastMove = Date.now(), stall = null;
    for (;;) {
      const s = await vale(page, (v) => ({ t: v.state.match.value?.view.time ?? null, ct: window.__valeAudio.graph.ctx.currentTime,
        state: window.__valeAudio.graph.ctx.state, amb: window.__valeAudio.ambience }));
      sync.push([s.ct, s.t]);
      emitters ??= s.amb;
      if (s.t === null || s.ct - startCt >= span) { emitters = s.amb; break; }
      if (s.ct > lastCt + 0.05) { lastCt = s.ct; lastMove = Date.now(); }
      if (Date.now() - lastMove > STALL_S * 1000) {
        stall = `the AudioContext clock froze at ${s.ct.toFixed(5)} s (state '${s.state}') for ${STALL_S} s of wall time while the match ran to ${s.t?.toFixed(1)} s`;
        break;
      }
      if (Date.now() > deadline) { stall = `deadline: the context clock reached ${(s.ct - startCt).toFixed(1)} of ${span} s in ${(span * 1.5 + 60).toFixed(0)} s of wall time`; break; }
      await page.waitForTimeout(2000);
    }
    if (stall) {
      report.maps[map] = { notMeasured: stall, matchTime: [sync[0]?.[1], sync[sync.length - 1]?.[1]], ctx: [startCt, lastCt] };
      notMeasured.push(`${map}: ${stall}`);
      log(map, 'NOT MEASURED', stall);
      await vale(page, (v) => { try { v.state.match.value?.leave(); } catch { /* ended */ } return true; }).catch(() => {});
      continue;
    }
    const res = await page.evaluate((c0) => {
      const a = window.__valeAudio;
      const b = window.__mix.blocks.filter((r) => r[0] >= c0);
      window.__mix.blocks = [];
      return { blocks: b, log: a.log.slice(), rate: a.graph.ctx.sampleRate, trim: a.graph.trim.gain.value };
    }, startCt);
    const cues = await page.evaluate(() => Object.fromEntries(Object.entries(window.__vale?.session?.catalog?.audio?.cues ?? {}).map(([k, c]) => [k, c.bus])));
    const ambLogged = res.log.filter((c) => cues[c] === 'ambience' || /^amb_/.test(c));
    const st = { master: shortTerm(res.blocks, 1), music: shortTerm(res.blocks, 2), ambience: shortTerm(res.blocks, 3), sfx: shortTerm(res.blocks, 4) };
    const masterGain = report.settings?.master ?? 0.8;
    // the same master without the ambience bus (it joins the master unducked by anything else: incoherent sum, the
    // limiter idle in laning), so the floor's lift is attributed to the ambience and not to the fight's SFX. The bus
    // reaches the tap through the master AND the engine's mix trim: leaving the trim out (it arrived in 5414aeb4, after
    // this probe) took out only half of the ambience's energy at 3 dB and read the 2.1 dB floor lift as about 0.9.
    const toLimiter = masterGain * res.trim;
    st.masterNoAmbience = shortTerm(res.blocks.map((r) => [r[0], Math.max(r[1] - toLimiter * toLimiter * r[3], 1e-20)]), 1);
    // reported: the same floor with the pre-trim subtraction, what the failing runs read (0.4 / 0.9 dB, closing r2 done:6)
    st.masterNoAmbienceUntrimmed = shortTerm(res.blocks.map((r) => [r[0], Math.max(r[1] - masterGain * masterGain * r[3], 1e-20)]), 1);
    const sum = Object.fromEntries(Object.entries(st).map(([k, a]) => [k, a.length ? { p10: +pct(a, 0.1).toFixed(1), p50: +pct(a, 0.5).toFixed(1), p90: +pct(a, 0.9).toFixed(1) } : null]));
    const m = {
      you, trimGain: +res.trim.toFixed(3),
      seconds: +(res.blocks.length * 4096 / res.rate).toFixed(1), matchTime: [sync[0]?.[1], sync[sync.length - 1]?.[1]].map((x) => (x == null ? null : +x.toFixed(1))),
      emitters: emitters?.map((e) => ({ cue: e.cue, role: e.role, playing: e.playing, att: +e.att.toFixed(2) })) ?? [],
      ambienceCuesLogged: ambLogged.length, ambienceCues: [...new Set(ambLogged)], shortTermLufs: sum,
      musicThroughMasterP50: sum.music ? +(sum.music.p50 + 20 * Math.log10(masterGain)).toFixed(1) : null,
      floorLiftDb: sum.master && sum.masterNoAmbience ? +(sum.master.p10 - sum.masterNoAmbience.p10).toFixed(1) : null,
      floorLiftUntrimmedDb: sum.master && sum.masterNoAmbienceUntrimmed ? +(sum.master.p10 - sum.masterNoAmbienceUntrimmed.p10).toFixed(1) : null,
      ambienceVsMusicP50Db: sum.ambience && sum.music ? +(sum.ambience.p50 - sum.music.p50).toFixed(1) : null,
    };
    report.maps[map] = m;
    log(map, JSON.stringify({ emitters: m.emitters.length, playing: m.emitters.filter((e) => e.playing).length, logged: m.ambienceCuesLogged, st: sum }));
    await shot(page, `fw_W3_mix_${map}`).catch(() => {});
    // M1
    if (!sum.ambience || sum.ambience.p50 < -60) failures.push(`M1 ${map}: the ambience bus is silent (short-term p50 ${sum.ambience?.p50})`);
    if (!m.emitters.some((e) => e.playing)) failures.push(`M1 ${map}: no ambience emitter playing`);
    // M2
    if (map === 'rift' && sum.master && sum.music && !(sum.master.p10 > sum.music.p50)) {
      failures.push(`M2 rift laning: master short-term p10 ${sum.master.p10} LUFS is not above the music stem's p50 ${sum.music.p50}`);
    }
    if (map === 'rift' && !(m.floorLiftDb >= 1)) failures.push(`M2 rift laning: the ambience lifts the master's floor (p10) by only ${m.floorLiftDb} dB`);
    await vale(page, (v) => { try { v.state.match.value?.leave(); } catch { /* ended */ } return true; }).catch(() => {});
  }
} catch (e) {
  failures.push(`harness: ${e?.message ?? e}`);
} finally {
  report.logs = logs.slice(0, 40);
  report.failures = failures;
  report.notMeasured = notMeasured;
  report.pass = failures.length === 0 && notMeasured.length === 0;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
// exit 1 = a gate failed, 2 = a map not measured (the context clock stalled or the deadline passed): not a pass
if (failures.length) console.log(`FAIL\n  ${failures.join('\n  ')}`);
if (notMeasured.length) console.log(`NOT MEASURED\n  ${notMeasured.join('\n  ')}`);
if (!failures.length && !notMeasured.length) console.log('PASS: ambience plays on every map; the laning mix has a floor above the music alone');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : notMeasured.length ? 2 : 0);
