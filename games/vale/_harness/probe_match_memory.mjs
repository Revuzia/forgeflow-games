// VALE harness — owner ruling 20: the match's memory, in the REAL production client.
//
//   node _harness/probe_match_memory.mjs [--modes bridge,rift] [--sec 300] [--no-build] [--wait-idle <min>] [--out <json>] [--shots <prefix>]
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
const MATCH_MB = 3000, HOME_MB = 2500, LOAD_MAX = 3;
const QUEUE_CARD = { rift: 'Lantern Drill' };
const PROD_DIR = join(HERE, '_prod', 'client', 'dist');

function heavyOthers() {
  try {
    const s = execFileSync('python3', [join(ROOT, 'art/blender/common/heavy.py'), 'status'], { encoding: 'utf8', timeout: 15000 });
    return s.split('\n').map((l) => l.trim()).filter((l) => /^slot\d+:/.test(l) && !new RegExp(`pid ${process.pid}\\b`).test(l)).map((l) => l.replace(/ for \d+s/, ''));
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

const report = { probe: 'probe_match_memory', at: new Date().toISOString(), build: 'prod client', sec: SEC, bars: { matchMb: MATCH_MB, homeMb: HOME_MB, loadBelow: LOAD_MAX }, matches: [], homes: [], machine: { samples: [] }, errors: [] };
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

const { browser, page, logs } = await open('/', { wait: false, hmr: false });
const bcdp = await browser.newBrowserCDPSession();
const cdp = await page.context().newCDPSession(page);
const procs = async () => {
  const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
  const gpu = ps.find((x) => x.type === 'GPU');
  const rendererMb = ps.filter((x) => x.type === 'renderer').map((x) => footprintMb(x.id) ?? 0).sort((a, b) => b - a)[0] ?? null;
  const gpuMb = gpu ? footprintMb(gpu.id) : null;
  return { rendererMb, gpuMb, totalMb: rendererMb !== null && gpuMb !== null ? rendererMb + gpuMb : null };
};
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
  const f = await procs(); const m = noteMachine(tag);
  report.homes.push({ tag, ...f, load: m.load });
  log(`${tag}: renderer ${f.rendererMb} + GPU ${f.gpuMb} = ${f.totalMb} MB (load ${m.load})`);
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
  while (!(await hud.isVisible().catch(() => false))) {
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
  const rec = { mode, sec: SEC, peak: { totalMb: 0 }, series: [], loadMax: 0, polls: 0 };
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
      const f = await procs(); const m = noteMachine(`${mode}_poll`);
      rec.polls++; rec.loadMax = Math.max(rec.loadMax, m.load);
      rec.series.push({ s: Math.round((Date.now() - end + SEC * 1000) / 1000), ...f, load: m.load });
      if ((f.totalMb ?? 0) > rec.peak.totalMb) rec.peak = { ...f, atS: rec.series[rec.series.length - 1].s };
    }
    await page.waitForTimeout(3000);
  }
  await snap(`${mode}_end`);
  log(`${mode}: peak renderer ${rec.peak.rendererMb} + GPU ${rec.peak.gpuMb} = ${rec.peak.totalMb} MB at ${rec.peak.atS} s; load max ${rec.loadMax}`);
  // out through the in-match menu, as a player leaves
  await page.keyboard.press('Escape');
  await click(page.getByRole('button', { name: /Leave match/i }), 15000);
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
for (const h of report.homes) if ((h.totalMb ?? 0) > HOME_MB) misses.push(`${h.tag} ${h.totalMb} MB > ${HOME_MB}`);
report.misses = misses; report.idle = idle;
report.verdict = broke ? `journey broke: ${report.errors[0]}` : !idle ? `needs idle machine (load max ${Math.max(...report.machine.samples.map((s) => s.load))}, ${busy.length} of ${report.machine.samples.length} readings busy); ${misses.length ? misses.join(', ') : 'would pass'}` : misses.length ? `MISS: ${misses.join(', ')}` : 'pass';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`match memory: ${report.matches.map((r) => `${r.mode} ${r.peak.totalMb} MB`).join(', ')}; homes ${report.homes.map((h) => `${h.tag} ${h.totalMb}`).join(', ')}  → ${OUT}`);
console.log(`GATE ${broke ? 'BROKE' : report.verdict === 'pass' ? 'PASS' : idle ? 'FAIL' : 'NOT MEASURED'}: ${report.verdict}`);
process.exit(broke ? 3 : report.verdict === 'pass' ? 0 : idle ? 1 : 2);
