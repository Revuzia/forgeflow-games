// VALE harness — owner ruling 20: the match's memory, in the REAL production client.
//
//   node _harness/probe_match_memory.mjs [--modes bridge,rift] [--sec 300] [--no-build] [--wait-idle <min>] [--out <json>] [--shots <prefix>] [--preset ultra] [--track] [--fake-audio] [--raw-cdp] [--pressure] [--infra] [--infra-match] [--no-audio]
//
// --track (round 4 MEM-1): _harness/fw_r4_mem_track.js rides the page (GL textures / buffers / renderbuffers by the bytes
// their storage calls asked for, live AudioBuffers and ImageBitmaps after a GC) and the V8 heap is read too (CDP
// Runtime.getHeapUsage: JS heap, array-buffer backing stores); each poll and each Home carries the tally as `track`.
//
// A production build of the client itself (vite build of index.html into _harness/_prod/client/dist, gitignored; not the bench),
// served by `vite preview` on the first free port in 5191-5199, in real Chrome on the GPU. No dev handle exists in that
// build, so the whole journey is real clicks: Home → Play → the mode → Find match → Ready → a fighter locked → loading →
// the match. In the match your seat is played with real input for --sec wall-seconds (default 300: lane fights have begun,
// every kit's effects and the decoded audio are in): a move order on the minimap, skill points and the ability keys every few seconds. Every 10 s the
// largest renderer process and the GPU process are read (macOS `footprint`); the peak of their sum is the reading. Then Esc →
// Leave match → home, the footprint at Home after a forced GC, the next mode in the SAME page: what a session carries.
// Bars (ruling 20): renderer + GPU <= 3000 MB in a match, on BRIDGE and RIFT; <= 2500 MB at Home.
// The ruling asks for load < 3: the 1-min load average and the heavy slots (anyone else's) are read before, at every poll and
// after. Any busy reading makes the whole verdict "not measured: needs idle machine", with the numbers kept. The harness
// holds a heavy slot of its own. --wait-idle waits for an idle start.
// Exit 0 = PASS, 1 = a bar missed on an idle machine, 2 = not measured (machine busy), 3 = the journey broke.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODES = opt('modes', 'bridge,rift').split(',').filter(Boolean);
const SEC = Number(opt('sec', 300));
const OUT = resolve(ROOT, opt('out', '_harness/_reports/match_memory.json'));
const SHOTS = opt('shots', '');
const WAIT_IDLE_S = Number(opt('wait-idle', 0)) * 60;
const TRACK = args.includes('--track');
const PRESSURE = args.includes('--pressure');
const INFRA = args.includes('--infra');
const INFRA_MATCH = args.includes('--infra-match');
// --no-audio (round 4 MEM-1 refix, diagnostic A/B, needs --fake-audio): the client with ?audio=0 (src/boot/main.ts), no audio lane at all
const NO_AUDIO = args.includes('--no-audio');
const PRESET = opt('preset', '');   // the player's own choice in the profile, set once at Home and the page reloaded (default: what the client starts on, High)
const MATCH_MB = 3000, HOME_MB = 2500, LOAD_MAX = 3;
const QUEUE_CARD = { rift: 'Lantern Drill' };
const PROD_DIR = join(HERE, '_prod', 'client', 'dist');

/** a slot whose owner died holds no load (heavy.py reaps it only when someone next queues), so it does not make the machine busy */
const pidAlive = (l) => { const m = /pid (\d+)/.exec(l); if (!m) return true; try { process.kill(Number(m[1]), 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
function heavyOthers() {
  try {
    const s = execFileSync('python3', [join(ROOT, 'art/blender/common/heavy.py'), 'status'], { encoding: 'utf8', timeout: 15000 });
    return s.split('\n').map((l) => l.trim()).filter((l) => /^slot\d+:/.test(l) && !new RegExp(`pid ${process.pid}\\b`).test(l) && pidAlive(l)).map((l) => l.replace(/ for \d+s/, ''));
  } catch (e) { return [`heavy status failed: ${e.message}`]; }
}
const machine = () => { const load = +loadavg()[0].toFixed(2), heavy = heavyOthers(); return { load, heavy, idle: load < LOAD_MAX && heavy.length === 0 }; };
function footprintMb(pid) {
  try {
    const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 }));
    return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null;
  } catch { return null; }
}
async function freePort() {
  for (let p = 5191; p <= 5199; p++) {
    const ok = await new Promise((res) => { const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(p, 'localhost'); });
    if (ok) return p;
  }
  throw new Error('no free port in 5191-5199');
}
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${s}`);

const report = { probe: 'probe_match_memory', at: new Date().toISOString(), build: 'prod client', sec: SEC, bars: { matchMb: MATCH_MB, homeMb: HOME_MB, loadBelow: LOAD_MAX }, matches: [], homes: [], homesAfterPressure: [], machine: { samples: [] }, errors: [] };
const vite = await import('vite');
const configFile = join(ROOT, 'vite.config.ts');
if (!args.includes('--no-build')) {
  await vite.build({ configFile, root: ROOT, logLevel: 'warn', build: { outDir: PROD_DIR, emptyOutDir: true } });
  log(`built the client → ${PROD_DIR}`);
}
const port = await freePort();
const server = await vite.preview({ configFile, root: ROOT, logLevel: 'warn', build: { outDir: PROD_DIR }, preview: { port, strictPort: true, host: 'localhost', open: false } });
process.env.VALE_URL = `http://localhost:${port}`;
const stopServer = async () => { await (server.close ? server.close() : new Promise((r) => server.httpServer.close(r))); };
process.on('SIGINT', () => { void stopServer().finally(() => process.exit(130)); });
const { open } = await import('./pw.mjs');

if (WAIT_IDLE_S > 0) {
  const end = Date.now() + WAIT_IDLE_S * 1000;
  for (;;) { const m = machine(); if (m.idle || Date.now() >= end) break; log(`waiting for an idle machine: load ${m.load}${m.heavy.length ? `; ${m.heavy.join('; ')}` : ''}`); await new Promise((r) => setTimeout(r, 10000)); }
}
const noteMachine = (tag) => { const m = machine(); report.machine.samples.push({ tag, ...m }); return m; };
noteMachine('start');

// --fake-audio (round 4): Chrome's fake output device (--disable-audio-output, as probe_audio_runtime / probe_audio_music).
// This Mac's output device can freeze an AudioContext's clock (3fb4383ce): no source then ever ends and every decoded
// buffer it plays stays alive, which a player's working device never does. The report says which sink it ran on
const FAKE_AUDIO = args.includes('--fake-audio');
report.audioSink = NO_AUDIO ? 'none (?audio=0)' : FAKE_AUDIO ? 'fake (--disable-audio-output)' : 'device';
if (NO_AUDIO && !FAKE_AUDIO) throw new Error('--no-audio needs --fake-audio');
// --raw-cdp (round 5 MEM-3, implies the fake sink): the same Chrome driven over raw CDP with no DevTools Network domain
// (fw_r5_mem_cdp.mjs): Playwright's Network.enable makes the renderer keep a copy of every response body the page
// fetched, a buffer that fills with every match a session loads; no player's browser has it
const RAW_CDP = args.includes('--raw-cdp');
if (RAW_CDP) report.driver = 'raw CDP (no Network domain)';
else report.driver = 'playwright';
const { browser, page, logs } = RAW_CDP ? await openRawCdp() : FAKE_AUDIO ? await openFakeAudio() : await open('/', { wait: false, hmr: false });
async function openRawCdp() {
  if (!FAKE_AUDIO) throw new Error('--raw-cdp needs --fake-audio');
  const { openRaw } = await import('./fw_r5_mem_cdp.mjs');
  const { holdHeavy } = await import('./heavy_slot.mjs');
  const rel = await holdHeavy('probe_match_memory raw-cdp');
  const r = await openRaw(process.env.VALE_URL + (NO_AUDIO ? '/?audio=0' : '/'), { args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  r.browser.on('disconnected', rel);
  return r;
}
async function openFakeAudio() {
  const { chromium } = await import('playwright-core');
  const { holdHeavy } = await import('./heavy_slot.mjs');
  const rel = await holdHeavy('probe_match_memory fake-audio');
  const b = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1', args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
  b.on('disconnected', rel);
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.routeWebSocket(/.*/, () => {});
  const pg = await ctx.newPage(); const lg = [];
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') lg.push(`[${m.type()}] ${m.text()}`); });
  pg.on('pageerror', (e) => lg.push(`[pageerror] ${e.message}`));
  await pg.goto(process.env.VALE_URL + (NO_AUDIO ? '/?audio=0' : '/'), { waitUntil: 'domcontentloaded' });
  return { browser: b, page: pg, logs: lg };
}
const bcdp = await browser.newBrowserCDPSession();
const cdp = await page.context().newCDPSession(page);
if (TRACK) { await page.context().addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') }); await page.reload(); }
/** the tally (--track): GL, audio, bitmaps from the page, the V8 heap from CDP */
const track = async () => {
  if (!TRACK) return undefined;
  const t = await page.evaluate(() => window.__memTrack?.() ?? null).catch(() => null);
  const h = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const mb = (b) => (typeof b === 'number' ? +(b / 1048576).toFixed(1) : null);
  return { ...t, heap: h ? { usedMb: mb(h.usedSize), totalMb: mb(h.totalSize), embedderMb: mb(h.embedderHeapUsedSize), backingMb: mb(h.backingStorageSize) } : null };
};
const trackLine = (t) => (t?.gl ? `  [clock ${t.clock?.t ?? '-'} s ${t.clock?.state ?? ''}; GL tex ${t.gl.texN}/${t.gl.texMb} MB buf ${t.gl.bufN}/${t.gl.bufMb} MB rb ${t.gl.rbN}/${t.gl.rbMb} MB prog ${t.gl.programs}; audio ${t.audio.n}/${t.audio.mb} MB; bitmaps ${t.bitmaps.n}/${t.bitmaps.mb} MB; heap ${t.heap?.usedMb} backing ${t.heap?.backingMb}]` : '');
/** --track: the footprint's top categories of a process (IOAccelerator = GPU allocations, IOSurface, malloc …), MB */
function footprintCats(pid) {
  try {
    const out = {};
    for (const l of execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 }).split('\n')) {
      const m = /^\s*([\d.]+)\s+(B|KB|MB|GB)\s+[\d.]+\s+\S+\s+[\d.]+\s+\S+\s+\d+\s+(.+)$/.exec(l);
      if (m) out[m[3].trim()] = Math.round(Number(m[1]) * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]]));
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 7));
  } catch { return null; }
}
const procs = async (cats = false) => {
  const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
  const gpu = ps.find((x) => x.type === 'GPU');
  // a footprint read that fails (it times out on a loaded machine) is read once more; a renderer still unread makes the
  // whole reading null rather than the largest of the others (a 51 MB "renderer" at Home was the page's read failing)
  const read = (id) => footprintMb(id) ?? footprintMb(id);
  const rends = ps.filter((x) => x.type === 'renderer').map((x) => ({ id: x.id, mb: read(x.id) })).sort((a, b) => (b.mb ?? 0) - (a.mb ?? 0));
  const rendererMb = rends.some((r) => r.mb === null) ? null : rends[0]?.mb ?? null;
  const gpuMb = gpu ? read(gpu.id) : null;
  const r = { rendererMb, gpuMb, totalMb: rendererMb !== null && gpuMb !== null ? rendererMb + gpuMb : null };
  if (cats && TRACK) r.cats = { renderer: rends[0] ? footprintCats(rends[0].id) : null, gpu: gpu ? footprintCats(gpu.id) : null };
  return r;
};
/** --infra (round 4 MEM-1 refix, diagnostic): Chrome's own memory-infra dump (CDP Tracing.requestMemoryDump, detailed),
 *  the largest allocators of the renderer and the GPU process by their own `size` (partition_alloc partitions, malloc,
 *  v8, blink_gc, gpu, skia, web_cache, discardable …): who in the process holds what the footprint shows */
async function infraDump() {
  const events = [];
  const onData = (e) => { for (const v of e.value ?? []) if (v.ph === 'v') events.push(v); };
  bcdp.on('Tracing.dataCollected', onData);
  try {
    await bcdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } } });
    const r = await bcdp.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
    const done = new Promise((res) => bcdp.once('Tracing.tracingComplete', res));
    await bcdp.send('Tracing.end');
    await Promise.race([done, new Promise((res) => setTimeout(res, 20000))]);
    const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
    const gpuPid = ps.find((x) => x.type === 'GPU')?.id;
    const rendPids = new Set(ps.filter((x) => x.type === 'renderer').map((x) => x.id));
    const top = (pid) => {
      const ev = events.filter((e) => e.pid === pid && e.args?.dumps?.allocators);
      if (!ev.length) return null;
      const al = ev.at(-1).args.dumps.allocators;
      const mb = (a) => { const v = a?.attrs?.size?.value; return v === undefined ? null : +(parseInt(v, 16) / 1048576).toFixed(1); };
      const rows = Object.entries(al).map(([k, a]) => [k, mb(a)]).filter(([k, v]) => v !== null && v >= 1 && k.split('/').length <= 3);
      rows.sort((a, b) => b[1] - a[1]);
      return Object.fromEntries(rows.slice(0, 28));
    };
    const rend = [...rendPids].map((p) => ({ p, t: top(p) })).filter((x) => x.t).sort((a, b) => (b.t?.partition_alloc ?? 0) + (b.t?.v8 ?? 0) - (a.t?.partition_alloc ?? 0) - (a.t?.v8 ?? 0))[0];
    return { ok: r.success, renderer: rend?.t ?? null, gpu: gpuPid ? top(gpuPid) : null };
  } catch (e) { return { error: String(e?.message ?? e).slice(0, 200) }; } finally { bcdp.off('Tracing.dataCollected', onData); }
}
const click = async (locator, timeout = 30000) => {
  await locator.first().waitFor({ state: 'visible', timeout });
  for (let i = 0; i < 3; i++) {
    try { await locator.first().click({ timeout: 10000 }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(600); }
  }
};
const snap = async (n) => { if (SHOTS) { mkdirSync(join(HERE, '_shots'), { recursive: true }); await page.screenshot({ path: join(HERE, '_shots', `${SHOTS}_${n}.png`) }).catch(() => {}); } };
const home = async (tag) => {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(4000);
  const f = await procs(true); const m = noteMachine(tag); const t = await track();
  report.homes.push({ tag, ...f, load: m.load, track: t });
  log(`${tag}: renderer ${f.rendererMb} + GPU ${f.gpuMb} = ${f.totalMb} MB (load ${m.load})${trackLine(t)}${f.cats ? `  cats ${JSON.stringify(f.cats)}` : ''}`);
  if (INFRA) {
    const d = await infraDump();
    (report.infra ??= []).push({ tag, ...d });
    log(`${tag} memory-infra: renderer ${JSON.stringify(d.renderer ?? d.error)}`);
    log(`${tag} memory-infra: gpu ${JSON.stringify(d.gpu ?? null)}`);
  }
  // --pressure (round 4 MEM-1 refix, diagnostic only, never the gate's reading): the same Home once more after Chrome is
  // told memory is critical (CDP Memory.simulatePressureNotification, what macOS memory pressure sends a real browser):
  // the allocators' free pages and Blink's caches are handed back, so what still stands is what the page truly holds
  if (PRESSURE) {
    await cdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch((e) => log(`pressure: ${e.message}`));
    await bcdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch(() => {});
    await page.waitForTimeout(6000);
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(4000);
    const g = await procs(true); const mm = noteMachine(`${tag}_pressure`); const tt = await track();
    report.homesAfterPressure.push({ tag, ...g, load: mm.load, track: tt });
    log(`${tag} after pressure: renderer ${g.rendererMb} + GPU ${g.gpuMb} = ${g.totalMb} MB (load ${mm.load})${trackLine(tt)}${g.cats ? `  cats ${JSON.stringify(g.cats)}` : ''}`);
  }
};

async function journey(mode) {
  await click(page.locator('.nav__item', { hasText: 'Play' }));
  await click(page.locator('.station', { hasText: mode.toUpperCase() }));
  if (QUEUE_CARD[mode]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] }));
  await click(page.getByRole('button', { name: 'Find match' }));
  // ready check, draft, loading, the HUD: whichever each comes up, by what is on the screen
  const hud = page.locator('.hud .dbar').first();
  const until = Date.now() + 240000;
  let lockTries = 0;
  // round 5 MEM-4: the footprint is read through the queue, draft and loading screen too (every ~3 s): a load that decodes
  // everything at once peaks there, before the HUD, and that peak is the match's memory as much as any in-match poll
  const pre = { peak: { totalMb: 0 }, series: [] };
  let lastPre = 0;
  const preT0 = Date.now();
  while (!(await hud.isVisible().catch(() => false))) {
    if (Date.now() - lastPre >= 3000) {
      lastPre = Date.now();
      const f = await procs(); const t = await track();
      const screen = await page.evaluate(() => [...document.querySelectorAll('.scr')].map((e) => e.className.replace(/\bscr\b\s*/, '').split(' ')[0]).join(',')).catch(() => '');
      pre.series.push({ s: Math.round((Date.now() - preT0) / 1000), screen, ...f, load: +loadavg()[0].toFixed(2), track: t });
      if ((f.totalMb ?? 0) > pre.peak.totalMb) pre.peak = { ...f, atS: pre.series.at(-1).s, screen };
    }
    if (Date.now() > until) throw new Error(`${mode}: no HUD after 240 s`);
    const ready = page.getByRole('button', { name: /^Ready/ }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click({ timeout: 3000 }).catch(() => {});
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (lockTries < 40 && await card.isVisible().catch(() => false) && await lock.isVisible().catch(() => false)) {
      lockTries++;
      await card.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
      await lock.click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(700);
  }
  log(`${mode}: in the match`);
  await snap(`${mode}_start`);
  log(`${mode}: before the HUD (queue, draft, loading) peak ${pre.peak.totalMb} MB at ${pre.peak.atS} s on ${pre.peak.screen}; ${pre.series.length} reads`);
  const rec = { mode, sec: SEC, peak: { totalMb: 0 }, series: [], loadMax: 0, polls: 0, preHud: pre };
  report.matches.push(rec);
  const end = Date.now() + SEC * 1000;
  let lastPoll = 0, k = 0;
  while (Date.now() < end) {
    // real input: a move order across the screen (the seat walks the lane), then an ability
    // to the middle of the map on the minimap (lanes cross it, the fights come there), every skill point spent
    const mm = await page.locator('.hud .mmap').first().boundingBox().catch(() => null);
    if (mm) await page.mouse.click(mm.x + mm.width * (0.5 + (k % 8) * 0.01), mm.y + mm.height * 0.5, { button: 'right' }).catch(() => {});
    const lvl = page.locator('.hud .aslot__lvl').first();
    if (await lvl.isVisible().catch(() => false)) await lvl.click({ timeout: 1000 }).catch(() => {});
    await page.mouse.move(960 + (k % 5) * 40, 480).catch(() => {});
    await page.keyboard.press(['KeyQ', 'KeyW', 'KeyE', 'KeyR'][k % 4]).catch(() => {});
    k++;
    if (Date.now() - lastPoll >= 10000) {
      lastPoll = Date.now();
      // round 5 MEM-4: the footprint categories at the first three polls and every sixth after (--track): the start transient by kind
      const f = await procs(rec.polls < 3 || rec.polls % 6 === 0); const m = noteMachine(`${mode}_poll`);
      rec.polls++; rec.loadMax = Math.max(rec.loadMax, m.load);
      const t = await track();
      rec.series.push({ s: Math.round((Date.now() - end + SEC * 1000) / 1000), ...f, load: m.load, track: t });
      if (TRACK) log(`${mode} ${rec.series.at(-1).s} s: ${f.totalMb} MB (renderer ${f.rendererMb}, GPU ${f.gpuMb}; load ${m.load})${trackLine(t)}${f.cats ? `  cats ${JSON.stringify(f.cats)}` : ''}`);
      // --infra-match (diagnostic): Chrome's memory-infra at the match's first three polls: what the start transient is
      if (INFRA_MATCH && rec.polls <= 3) {
        const d = await infraDump();
        (rec.infra ??= []).push({ s: rec.series.at(-1).s, ...d });
        log(`${mode} ${rec.series.at(-1).s} s memory-infra: renderer ${JSON.stringify(d.renderer ?? d.error)}`);
        log(`${mode} ${rec.series.at(-1).s} s memory-infra: gpu ${JSON.stringify(d.gpu ?? null)}`);
      }
      if ((f.totalMb ?? 0) > rec.peak.totalMb) rec.peak = { ...f, atS: rec.series[rec.series.length - 1].s };
    }
    await page.waitForTimeout(3000);
  }
  await snap(`${mode}_end`);
  log(`${mode}: peak renderer ${rec.peak.rendererMb} + GPU ${rec.peak.gpuMb} = ${rec.peak.totalMb} MB at ${rec.peak.atS} s; load max ${rec.loadMax}`);
  // out through the in-match menu, as a player leaves
  // Esc opens the match menu; a key the HUD was still holding (a targeting mode from the QWER input) can take the first
  // press, so it is pressed again until the menu's Leave match shows (each press only while it does not)
  const leaveBtn = page.getByRole('button', { name: /Leave match/i }).first();
  for (let i = 0; i < 8 && !(await leaveBtn.isVisible().catch(() => false)); i++) {
    await page.mouse.click(960, 540, { button: 'right' }).catch(() => {});
    await page.keyboard.press('Escape');
    await leaveBtn.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
  }
  if (!(await leaveBtn.isVisible().catch(() => false))) await snap(`${mode}_noleave`);
  await click(leaveBtn, 15000);
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Leave match/i });
  await click(confirm, 15000);
  const nav = page.locator('.nav__item', { hasText: 'Play' }).first();
  const backBy = Date.now() + 60000;
  while (!(await nav.isVisible().catch(() => false))) {
    if (Date.now() > backBy) throw new Error(`${mode}: not back on a nav screen 60 s after leaving`);
    const ret = page.getByRole('button', { name: /Return home/i }).first();
    if (await ret.isVisible().catch(() => false)) await ret.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await click(page.locator('.nav__item', { hasText: 'Home' })).catch(() => {});
  await page.waitForTimeout(3000);
  await home(`${mode}_home`);
}

let broke = false;
try {
  await page.locator('.nav__item', { hasText: 'Play' }).first().waitFor({ state: 'visible', timeout: 180000 });
  await page.waitForTimeout(6000);      // the first-run calibration and the Home vale settle
  if (PRESET) {
    report.preset = await page.evaluate((preset) => {
      const raw = localStorage.getItem('vale.profile.v1'); if (!raw) return { error: 'no profile stored' };
      const p = JSON.parse(raw); const L = { ultra: { renderScale: 1, shadows: 3, ao: 2, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 2 } }[preset];
      if (!p.settings?.video || !L) return { error: 'no video settings or unknown preset' };
      p.settings.video = { ...p.settings.video, ...L, preset }; localStorage.setItem('vale.profile.v1', JSON.stringify(p));
      return p.settings.video;
    }, PRESET);
    log(`preset ${JSON.stringify(report.preset)}`);
    if (report.preset.error) throw new Error(report.preset.error);
    await page.reload();
    await page.locator('.nav__item', { hasText: 'Play' }).first().waitFor({ state: 'visible', timeout: 180000 });
    await page.waitForTimeout(6000);
    report.presetAfterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('vale.profile.v1')).settings.video.preset);
    log(`preset after reload ${report.presetAfterReload}`);
  }
  // a player's Home has heard a key or a click: the audio engine makes its context on the first gesture and the menu bed
  // decodes then. The silent Home (no gesture yet) is kept as home_0_silent; home_0 is Home with its music, the
  // reading every later Home compares against
  await home('home_0_silent');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(12000);
  await home('home_0');
  for (const m of MODES) await journey(m);
} catch (e) {
  broke = true; report.errors.push(String(e?.message ?? e).slice(0, 400)); log(`broke: ${e?.message ?? e}`);
  await snap('FAIL');
} finally {
  report.console = logs.slice(0, 20);
  await browser.close().catch(() => {});
  await stopServer();
}
noteMachine('end');
const idle = report.machine.samples.every((s) => s.idle);
const busy = report.machine.samples.filter((s) => !s.idle);
const misses = [];
for (const r of report.matches) if (r.peak.totalMb > MATCH_MB) misses.push(`${r.mode} match peak ${r.peak.totalMb} MB > ${MATCH_MB}`);
for (const r of report.matches) if ((r.preHud?.peak.totalMb ?? 0) > MATCH_MB) misses.push(`${r.mode} loading peak ${r.preHud.peak.totalMb} MB > ${MATCH_MB}`);
for (const h of report.homes) if ((h.totalMb ?? 0) > HOME_MB) misses.push(`${h.tag} ${h.totalMb} MB > ${HOME_MB}`);
report.misses = misses; report.idle = idle;
// round 4: what each Home after a match carries over Home with its music (home_0), and each match's margin under the bar
const h0 = report.homes.find((h) => h.tag === 'home_0')?.totalMb ?? null;
report.homeOverFirst = Object.fromEntries(report.homes.filter((h) => /_home$/.test(h.tag)).map((h) => [h.tag, h0 !== null && h.totalMb !== null ? h.totalMb - h0 : null]));
if (PRESSURE) { const p0 = report.homesAfterPressure.find((h) => h.tag === 'home_0')?.totalMb ?? null; report.homeOverFirstAfterPressure = Object.fromEntries(report.homesAfterPressure.filter((h) => /_home$/.test(h.tag)).map((h) => [h.tag, p0 !== null && h.totalMb !== null ? h.totalMb - p0 : null])); }
report.matchMargin = Object.fromEntries(report.matches.map((r) => [r.mode, MATCH_MB - r.peak.totalMb]));
// round 5 (ruling 27): per match in order, its peak, its steady max (polls after the first 20 s), the start transient
// (the first 20 s over the steady max) and the climb over the same map's earlier peak; per Home, the live object set
// (GL textures + buffers + renderbuffers + audio + bitmaps + JS heap used + array-buffer backing, --track) over home_0's
const liveMb = (t) => (t?.gl ? +(t.gl.texMb + t.gl.bufMb + t.gl.rbMb + t.audio.mb + t.bitmaps.mb + (t.heap?.usedMb ?? 0) + (t.heap?.backingMb ?? 0)).toFixed(1) : null);
report.r27 = { matches: [], homes: [] };
report.matches.forEach((r, i) => {
  const steady = r.series.filter((x) => x.s > 20 && x.totalMb !== null).map((x) => x.totalMb);
  const start = r.series.filter((x) => x.s <= 20 && x.totalMb !== null).map((x) => x.totalMb);
  const steadyMax = steady.length ? Math.max(...steady) : null;
  const earlier = report.matches.slice(0, i).filter((q) => q.mode === r.mode).map((q) => q.peak.totalMb);
  report.r27.matches.push({ n: i + 1, mode: r.mode, preHudPeakMb: r.preHud?.peak.totalMb ?? null, preHudScreen: r.preHud?.peak.screen ?? null, peakMb: r.peak.totalMb, atS: r.peak.atS, steadyMaxMb: steadyMax, startTransientMb: steadyMax !== null && start.length ? Math.max(...start) - steadyMax : null, climbMb: earlier.length ? r.peak.totalMb - Math.max(...earlier) : null, loadMax: r.loadMax });
});
const live0 = liveMb(report.homes.find((h) => h.tag === 'home_0')?.track);
report.r27.homes = report.homes.map((h) => ({ tag: h.tag, totalMb: h.totalMb, liveMb: liveMb(h.track), liveOverFirstMb: live0 !== null && liveMb(h.track) !== null ? +(liveMb(h.track) - live0).toFixed(1) : null, load: h.load }));
report.r27.pass = report.r27.matches.every((m) => m.peakMb <= MATCH_MB && (m.preHudPeakMb ?? 0) <= MATCH_MB && (m.climbMb === null || m.climbMb <= 150)) && report.r27.homes.every((h) => (h.totalMb ?? 0) <= HOME_MB && (h.liveOverFirstMb === null || h.liveOverFirstMb <= 150));
console.log(`ruling 27: ${JSON.stringify(report.r27)}`);
report.verdict = broke ? `journey broke: ${report.errors[0]}` : !idle ? `needs idle machine (load max ${Math.max(...report.machine.samples.map((s) => s.load))}, ${busy.length} of ${report.machine.samples.length} readings busy); ${misses.length ? misses.join(', ') : 'would pass'}` : misses.length ? `MISS: ${misses.join(', ')}` : 'pass';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`match memory: ${report.matches.map((r) => `${r.mode} ${r.peak.totalMb} MB`).join(', ')}; homes ${report.homes.map((h) => `${h.tag} ${h.totalMb}`).join(', ')}; margin ${JSON.stringify(report.matchMargin)}; Home over home_0 ${JSON.stringify(report.homeOverFirst)}  → ${OUT}`);
console.log(`GATE ${broke ? 'BROKE' : report.verdict === 'pass' ? 'PASS' : idle ? 'FAIL' : 'NOT MEASURED'}: ${report.verdict}`);
process.exit(broke ? 3 : report.verdict === 'pass' ? 0 : idle ? 1 : 2);
