// VALE harness — decoded audio across a real session in real Chrome (closing PERF-C2, the audio half; CW2 done-criterion
// "Decoded audio at Home after RIFT, BRIDGE, FRAY <= 150 MB, the previous bed freed on change").
//
//   node _harness/probe_audio_session_mem.mjs [--modes rift,bridge,fray] [--speed 16] [--out _harness/_reports/fw_CW2_session_mem.json]
//
// The closing verifier's method (closing_perf_verify_mem): ONE page (the dev server, ?dev=1&autopilot=match), Home → for
// each mode in turn: Play → the mode's station → (RIFT: Lantern Drill) → Find match → Ready → a fighter locked → loading →
// the match on the dev autopilot at --speed to its REAL end → post-game → Return home; a forced GC (CDP
// HeapProfiler.collectGarbage), 3 s settle, then a sample of the audio engine's own buffer cache
// (window.__valeAudio.buffers: every settled AudioBuffer's length x channels x 4 bytes) with its biggest files, plus the
// JS heap. The match is sampled too (at 60 s of match time) to show what the cache holds in play.
// Gates:
//   S1  decoded audio at Home after each map <= 150 MB
//   S2  no match bed (mus_match_*) and no match-only cue (f_*, u_*, c_*) is left in the cache at Home
//   S3  the previous bed is freed on a bed change: at Home only the menu bed's files of the music beds remain
//   S4  CW1's footprint gate with the audio in it: renderer + GPU process (macOS `footprint`) <= 2500 MB at every Home (the
//       renderer holds the decoded audio, so this is perf_1080's maps-memory number without its "audio comes on top").
//       In-match readings (decoded audio with prewarm, renderer + GPU) are polled to the match's end; their peaks are
//       reported against the same 2500 MB.
// The wait for a match's end counts AWAKE seconds and watches the match clock: wall time the machine slept is reported
// (Date.now runs through a sleep, performance.now does not; the r2v1 attempt "timed out" at 2299 s through a 33-minute
// system sleep), and a stall is named only when the match clock stops moving while the machine is awake.
// Exit 0 = PASS, 1 = a gate fails, 2 = the journey broke (screens / timeouts / a stalled match clock).

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const MODES = String(opt('modes', 'rift,bridge,fray')).split(',');
const SPEED = Number(opt('speed', 16));
const OUT = opt('out', join(HERE, '_reports', 'fw_CW2_session_mem.json'));
const HOME_MB = 150;
const FOOTPRINT_MB = 2500;      // perf_1080 HOME_BUDGET_MB, CW1's maps-memory gate
const END_AWAKE_S = 1500;       // a match's end, in awake seconds
const STALL_AWAKE_S = 300;      // the match clock not moving for this long while awake = a stall
const QUEUE_CARD = { rift: 'Lantern Drill', bridge: null, fray: null };

const report = { probe: 'probe_audio_session_mem', at: new Date().toISOString(), speed: SPEED, samples: [], matchPeaks: [], gates: {}, errors: [] };
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${s}`);

const { browser, page, logs } = await open(`/?dev=1&autopilot=match&speed=${SPEED}`, { hmr: false });
const cdp = await page.context().newCDPSession(page);
const bcdp = await browser.newBrowserCDPSession();

/** awake seconds and seconds slept since t0 (performance.now stops in a system sleep, Date.now does not) */
const pw0 = performance.now();
const awakeS = () => (performance.now() - pw0) / 1000;
const sleptS = () => Math.max(0, (Date.now() - t0) / 1000 - awakeS());

function footprintMb(pid) {
  try {
    const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 }));
    return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null;
  } catch { return null; }
}
/** the largest renderer + the GPU process, as perf_1080's maps memory reads them */
async function procs() {
  const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
  const gpu = ps.find((x) => x.type === 'GPU');
  const rend = ps.filter((x) => x.type === 'renderer').map((x) => footprintMb(x.id) ?? 0).sort((a, b) => b - a)[0] ?? null;
  const gpuMb = gpu ? footprintMb(gpu.id) : null;
  return { rendererMb: rend, gpuMb, totalMb: rend !== null && gpuMb !== null ? rend + gpuMb : null };
}

/** the engine's cache: files settled, MB, biggest files, and which match-only / bed files are held */
async function audioCache() {
  return page.evaluate(async () => {
    const a = window.__valeAudio;
    if (!a?.buffers) return null;
    const rows = [];
    for (const [k, p] of a.buffers.entries()) {
      const b = await Promise.race([p, new Promise((r) => setTimeout(r, 50, null))]);
      if (b?.length) rows.push([k, b.length * b.numberOfChannels * 4, b.duration]);
    }
    rows.sort((x, y) => y[1] - x[1]);
    const name = (k) => k.split('/').pop().replace(/^[0-9a-f]{8,}-/, '');   // built files carry a content-hash prefix
    const bytes = rows.reduce((s, r) => s + r[1], 0);
    return {
      files: rows.length, mb: +(bytes / 1048576).toFixed(1),
      top: rows.slice(0, 10).map(([k, b, d]) => [name(k), +(b / 1048576).toFixed(1), Math.round(d)]),
      music: rows.filter(([k]) => /\/music\/|mus_/.test(k)).map(([k]) => name(k)),
      matchOnly: rows.filter(([k]) => /(^|\/)(f_|u_|c_|mus_match)/.test(name(k))).map(([k]) => name(k)),
    };
  });
}
async function sample(tag) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(3000);
  const audio = await audioCache();
  const heapMb = await page.evaluate(() => +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1));
  const route = await vale(page, (v) => v.router.route.value.screen);
  const footprint = await procs();
  const s = { tag, route, heapMb, audio, footprint };
  report.samples.push(s);
  log(`${tag}: route ${route}, heap ${heapMb} MB, audio ${audio?.mb} MB in ${audio?.files} files; renderer ${footprint.rendererMb} + GPU ${footprint.gpuMb} = ${footprint.totalMb} MB; top ${JSON.stringify(audio?.top.slice(0, 4))}`);
  return s;
}

async function click(locator) {
  await locator.first().waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 3; i++) {
    try { await locator.first().click({ timeout: 10000 }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(600); }
  }
}

/** to the match's end: the clock, decoded audio and footprint polled; sleep discounted, a stopped clock named */
async function waitEnd(mode) {
  const peak = { mode, audioMb: 0, audioFiles: 0, audioAtMatchS: null, totalMb: 0, rendererMb: 0, gpuMb: 0, totalAtMatchS: null, polls: 0 };
  report.matchPeaks.push(peak);
  const a0 = awakeS();
  let lastT = -1, lastMove = a0, lastLog = a0, lastPoll = -Infinity;
  for (;;) {
    const st = await vale(page, (v) => ({ end: !!v.state.ending.value || v.router.route.value.screen === 'postgame', t: v.state.match.value?.view.time ?? null }));
    if (st.end) break;
    const now = awakeS();
    if (st.t !== null && st.t !== lastT) { lastT = st.t; lastMove = now; }
    if (now - lastPoll >= 8) {
      lastPoll = now;
      const a = await audioCache();
      peak.polls++;
      if (a && a.mb > peak.audioMb) { peak.audioMb = a.mb; peak.audioFiles = a.files; peak.audioAtMatchS = st.t; peak.audioTop = a.top.slice(0, 6); }
      const f = await procs();
      if ((f.totalMb ?? 0) > peak.totalMb) { peak.totalMb = f.totalMb; peak.rendererMb = f.rendererMb; peak.gpuMb = f.gpuMb; peak.totalAtMatchS = st.t; }
    }
    if (now - lastLog >= 30) {
      lastLog = now;
      log(`${mode}: match ${Math.round(st.t ?? 0)} s (x${((st.t ?? 0) / Math.max(1, now - a0 + 60 / SPEED)).toFixed(1)}), awake ${Math.round(now)} s, slept ${Math.round(sleptS())} s, load ${loadavg()[0].toFixed(1)}, peak audio ${peak.audioMb} MB, peak renderer + GPU ${peak.totalMb} MB`);
    }
    if (now - lastMove > STALL_AWAKE_S) throw new Error(`STALL: the match clock stopped at ${lastT} s for ${STALL_AWAKE_S} awake seconds (slept ${Math.round(sleptS())} s)`);
    if (now - a0 > END_AWAKE_S) throw new Error(`match still running at ${lastT} s after ${END_AWAKE_S} awake seconds (slept ${Math.round(sleptS())} s, load ${loadavg()[0].toFixed(1)})`);
    await page.waitForTimeout(1000);
  }
}

async function journey(mode) {
  await click(page.locator('.nav__item', { hasText: 'Play' }));
  await click(page.locator('.station', { hasText: mode.toUpperCase() }));
  if (QUEUE_CARD[mode]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] }));
  await click(page.getByRole('button', { name: 'Find match' }));
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  const ready = page.getByRole('button', { name: /^Ready/ });
  // the autopilot's ready check can pass between the count and the click (a 10 s timeout that broke the journey in the draft, closing r3): the state below decides
  if (await ready.count()) await click(ready).catch(() => {});
  await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  // a fighter locked when it is your pick turn (else the protocol assigns one)
  await waitFor(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !s || (s.phase !== 'pick' && s.phase !== 'ban') || !!m?.locked || (s.turn?.action !== 'ban' && !!s.turn?.players.includes(m?.player)); }, 90000);
  const need = await vale(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !!s && s.phase === 'pick' && !m?.locked; });
  if (need) {
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    await card.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await card.count()) { await card.click(); await page.waitForTimeout(250); }
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (await lock.count()) { await lock.click(); await page.waitForTimeout(400); }
  }
  await waitFor(page, (v) => !!v.state.loading.value || !!v.state.match.value, 120000);
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'pregame' || v.state.match.value?.view.phase === 'live', 90000);
  log(`${mode}: match loaded`);
  await waitFor(page, (v) => (v.state.match.value?.view.time ?? 0) > 60, 240000);
  await sample(`${mode}_in_match_60s`);
  await waitEnd(mode);
  await waitFor(page, (v) => v.router.route.value.screen === 'postgame', 30000);
  await page.waitForTimeout(2500);
  await sample(`${mode}_postgame`);
  await click(page.getByRole('button', { name: /Return home/i }));
  await waitFor(page, (v) => v.router.route.value.screen === 'home', 20000);
  await page.waitForTimeout(4000);   // the bed change's fade
  const s = await sample(`${mode}_home`);
  await shot(page, `fw_CW2_session_mem_${mode}_home`);
  return s;
}

let broke = false;
try {
  await page.waitForTimeout(4000);
  await sample('home_0');
  for (const m of MODES) {
    try { await journey(m); } catch (e) { broke = true; report.errors.push(`${m}: ${String(e?.message ?? e).slice(0, 300)}`); log(`✗ ${m}: ${e?.message ?? e}`); await shot(page, `fw_CW2_session_mem_${m}_FAIL`).catch(() => {}); break; }
  }
} finally {
  report.consoleErrors = logs.slice(0, 20);
  await browser.close().catch(() => {});
}

const homes = report.samples.filter((s) => /_home$/.test(s.tag));
const s1 = homes.map((s) => ({ tag: s.tag, mb: s.audio?.mb ?? null, ok: (s.audio?.mb ?? Infinity) <= HOME_MB }));
const s2 = homes.map((s) => ({ tag: s.tag, matchOnly: s.audio?.matchOnly ?? null, ok: (s.audio?.matchOnly?.length ?? 1) === 0 }));
const s3 = homes.map((s) => ({ tag: s.tag, music: s.audio?.music ?? null, ok: (s.audio?.music ?? ['?']).every((f) => /mus_menu/.test(f)) }));
const s4 = homes.map((s) => ({ tag: s.tag, ...s.footprint, ok: s.footprint?.totalMb !== null && s.footprint?.totalMb !== undefined && s.footprint.totalMb <= FOOTPRINT_MB }));
report.gates = { S1: s1, S2: s2, S3: s3, S4: s4, homeMbMax: HOME_MB, footprintMbMax: FOOTPRINT_MB };
report.sleptS = Math.round(sleptS());
report.awakeS = Math.round(awakeS());
const pass = !broke && homes.length === MODES.length && [...s1, ...s2, ...s3, ...s4].every((g) => g.ok);
report.pass = pass;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`S1 Home after each map: ${s1.map((g) => `${g.tag} ${g.mb} MB`).join(', ')} (<= ${HOME_MB})`);
console.log(`S2 match-only files at Home: ${s2.map((g) => `${g.tag} ${g.matchOnly?.length ?? '?'}`).join(', ')}`);
console.log(`S3 beds at Home: ${s3.map((g) => `${g.tag} [${(g.music ?? []).join(' ')}]`).join(', ')}`);
console.log(`S4 renderer + GPU at Home: ${s4.map((g) => `${g.tag} ${g.rendererMb} + ${g.gpuMb} = ${g.totalMb} MB`).join(', ')} (<= ${FOOTPRINT_MB})`);
console.log(`match peaks (reported): ${report.matchPeaks.map((p) => !p.polls ? `${p.mode} not polled` : `${p.mode} (${p.polls} polls) audio ${p.audioMb} MB in ${p.audioFiles} files at ${Math.round(p.audioAtMatchS ?? 0)} s, renderer + GPU ${p.rendererMb} + ${p.gpuMb} = ${p.totalMb} MB at ${Math.round(p.totalAtMatchS ?? 0)} s`).join('; ')} (against ${FOOTPRINT_MB})`);
console.log(`awake ${report.awakeS} s, slept ${report.sleptS} s`);
console.log(`${pass ? 'PASS' : broke ? 'BROKE' : 'FAIL'} → ${OUT}`);
process.exit(pass ? 0 : broke ? 2 : 1);
