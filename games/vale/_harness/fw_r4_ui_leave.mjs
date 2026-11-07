// VALE harness — fw r4 UI-1: why Esc after a long match sometimes does not bring up "Leave match".
//
//   node _harness/fw_r4_ui_leave.mjs [--modes bridge,rift] [--sec 300] [--no-build] [--out <json>] [--shots <prefix>]
//
// The production client (vite build into _harness/_prod/fw_r4_ui/dist, its own dir so the memory probe's build is not
// touched), served by `vite preview` on a free port in 5181-5189, real Chrome on the GPU, no dev handle. The journey and
// the in-match input are the same as probe_match_memory.mjs (minimap right click, a skill point, the mouse to the middle,
// Q W E R in turn every 3 s). At the end of each match, BEFORE Esc, the tool reads what a player would see: the slot in
// targeting (.aslot.is-aiming), the cursor mode (.hudsurface cur-*), open modals, the shop, the focused element. Every
// Escape keydown is logged by a window capture listener installed before the client loads (it runs before any of the
// client's listeners), with whether something consumed it (defaultPrevented after dispatch). Then: Esc #1, wait 15 s
// for the menu (the probe's wait). If it does not come: a shot at that moment, the state again, Esc #2, wait 5 s.
// Then out through the menu and confirm, back to Home, the next mode in the same page.
// --trials: also the leave press after every input round from 30 s in (about 70 per match): Esc, the menu within 3 s or
// a shot, the state and a second Esc; the menu is closed again with Esc before play goes on.
// --aim: each trial first learns Q/E/R (Ctrl+key) and presses one until a slot is in targeting, so the first Esc meets an aim.
// Exit 0 = every Esc path (and trial) reached the menu within 2 presses; 1 = one never reached it in 2; 3 = broke.
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
const OUT = resolve(ROOT, opt('out', '_harness/_reports/fw_r4_ui_leave.json'));
const SHOTS = opt('shots', 'fw_r4_ui_leave');
const QUEUE_CARD = { rift: 'Lantern Drill' };
const PROD_DIR = join(HERE, '_prod', 'fw_r4_ui', 'dist');
const TRIALS = args.includes('--trials') || args.includes('--aim');
const AIM = args.includes('--aim');   // each trial first puts a targeted cast in aim (the cancel-then-menu path)
const FOOTPRINT = args.includes('--footprint');   // the memory probe's 10 s polls too (CDP process list + macOS footprint on the renderer and GPU), its exact timing
function footprintMb(pid) {
  try {
    const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 }));
    return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null;
  } catch { return null; }
}

async function freePort() {
  for (let p = 5181; p <= 5189; p++) {
    const ok = await new Promise((res) => { const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(p, 'localhost'); });
    if (ok) return p;
  }
  throw new Error('no free port in 5181-5189');
}
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${s}`);
const report = { probe: 'fw_r4_ui_leave', at: new Date().toISOString(), build: 'prod client', sec: SEC, loadStart: +loadavg()[0].toFixed(2), matches: [], errors: [] };

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
const { browser, context, page, logs } = await open('/', { wait: false, hmr: false });
// an Escape log: a window capture listener added before any client script, so it sees every Escape first
await context.addInitScript(() => {
  window.__escLog = [];
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const rec = { t: Math.round(performance.now()), target: e.target?.tagName ?? null };
    window.__escLog.push(rec);
    setTimeout(() => { rec.consumed = e.defaultPrevented; }, 0);
  }, { capture: true });
});
await page.reload();
const bcdp = FOOTPRINT ? await browser.newBrowserCDPSession() : null;
const procs = async () => {
  const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
  const gpu = ps.find((x) => x.type === 'GPU');
  const rendererMb = ps.filter((x) => x.type === 'renderer').map((x) => footprintMb(x.id) ?? 0).sort((a, b) => b - a)[0] ?? null;
  return { rendererMb, gpuMb: gpu ? footprintMb(gpu.id) : null, load: +loadavg()[0].toFixed(2) };
};

const click = async (locator, timeout = 30000) => {
  await locator.first().waitFor({ state: 'visible', timeout });
  for (let i = 0; i < 3; i++) {
    try { await locator.first().click({ timeout: 10000 }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(600); }
  }
};
const snap = async (n) => { mkdirSync(join(HERE, '_shots'), { recursive: true }); const p = join(HERE, '_shots', `${SHOTS}_${n}.png`); await page.screenshot({ path: p }).catch(() => {}); return `_harness/_shots/${SHOTS}_${n}.png`; };
/** what the player's screen holds right now (DOM only: the prod build has no dev handle) */
const uiState = () => page.evaluate(() => {
  const surf = document.querySelector('.hudsurface');
  const ae = document.activeElement;
  return {
    aimingSlot: [...document.querySelectorAll('.aslot.is-aiming')].map((e) => e.getAttribute('aria-label') ?? e.className).slice(0, 2),
    cursor: surf ? [...surf.classList].find((c) => c.startsWith('cur-')) ?? null : null,
    modals: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => (d.getAttribute('aria-label') ?? d.querySelector('h1,h2,h3')?.textContent ?? d.className).slice(0, 60)),
    shopOpen: !!document.querySelector('.hud .shop:not([hidden]), .hud [class*="shop--open"], .hud .shop.is-open'),
    wheel: !!document.querySelector('.hud .wheel, .hud [class*="pingwheel"]'),
    leaveVisible: [...document.querySelectorAll('button')].some((b) => /Leave match/i.test(b.textContent ?? '') && b.offsetParent !== null),
    active: ae ? `${ae.tagName.toLowerCase()}${ae.className ? '.' + String(ae.className).split(' ')[0] : ''}` : null,
    hasFocus: document.hasFocus(),
    hudVisible: !!document.querySelector('.hud .dbar'),
    ending: !!document.querySelector('.endbanner, [class*="endbanner"], [class*="victory"], [class*="defeat"]'),
    escLog: window.__escLog?.slice(-6) ?? [],
  };
});
const leaveBtn = () => page.getByRole('button', { name: /Leave match/i });
const menuIn = async (ms) => { try { await leaveBtn().first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };

async function journey(mode) {
  await click(page.locator('.nav__item', { hasText: 'Play' }));
  await click(page.locator('.station', { hasText: mode.toUpperCase() }));
  if (QUEUE_CARD[mode]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] }));
  await click(page.getByRole('button', { name: 'Find match' }));
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
  const rec = { mode, sec: SEC, aimSeenDuringPlay: 0, polls: 0, trials: [], trialShots: 0 };
  report.matches.push(rec);
  const end = Date.now() + SEC * 1000;
  let k = 0, lastPoll = 0;
  rec.series = [];
  while (Date.now() < end) {
    const mm = await page.locator('.hud .mmap').first().boundingBox().catch(() => null);
    if (mm) await page.mouse.click(mm.x + mm.width * (0.5 + (k % 8) * 0.01), mm.y + mm.height * 0.5, { button: 'right' }).catch(() => {});
    const lvl = page.locator('.hud .aslot__lvl').first();
    if (await lvl.isVisible().catch(() => false)) await lvl.click({ timeout: 1000 }).catch(() => {});
    await page.mouse.move(960 + (k % 5) * 40, 480).catch(() => {});
    await page.keyboard.press(['KeyQ', 'KeyW', 'KeyE', 'KeyR'][k % 4]).catch(() => {});
    k++;
    if (FOOTPRINT && Date.now() - lastPoll >= 10000) { lastPoll = Date.now(); rec.series.push({ s: Math.round((Date.now() - end + SEC * 1000) / 1000), ...(await procs()) }); }
    if (k % 4 === 0) { rec.polls++; if ((await page.locator('.aslot.is-aiming').count().catch(() => 0)) > 0) rec.aimSeenDuringPlay++; }
    await page.waitForTimeout(3000);
    // --trials: after every input round from 30 s on, the leave press itself (Esc, the menu within 3 s?), the menu
    // closed again with Esc; a press that brings no menu gets a shot, its state, and a second Esc
    if (TRIALS && Date.now() - (end - SEC * 1000) >= 30000 && Date.now() < end) {
      let aimKey = null;
      if (AIM) {
        // a targeted cast held in aim: learn with Ctrl+key (never Ctrl+W), the mouse on the ground, the key, no click
        for (const c of ['KeyQ', 'KeyE', 'KeyR']) await page.keyboard.press(`Control+${c}`).catch(() => {});
        await page.mouse.move(900, 600).catch(() => {});
        for (const c of ['KeyQ', 'KeyE', 'KeyR', 'KeyW']) {
          await page.keyboard.press(c).catch(() => {});
          await page.waitForTimeout(150);
          if ((await page.locator('.aslot.is-aiming').count().catch(() => 0)) > 0) { aimKey = c; break; }
        }
      }
      const tr = { s: Math.round((Date.now() - end + SEC * 1000) / 1000), key: aimKey ?? ['Q', 'W', 'E', 'R'][(k - 1) % 4], before: await uiState() };
      if (aimKey) tr.aimKey = aimKey;
      await page.keyboard.press('Escape');
      tr.esc1 = await menuIn(3000);
      if (!tr.esc1) {
        tr.after1 = await uiState();
        tr.aimAfter1 = tr.after1.aimingSlot.length;
        if (rec.trialShots < 6) { rec.trialShots++; tr.shot = await snap(`${mode}_trial_${tr.s}s`); }
        await page.keyboard.press('Escape');
        tr.esc2 = await menuIn(3000);
        if (!tr.esc2) { tr.after2 = await uiState(); tr.shot2 = await snap(`${mode}_trial_${tr.s}s_esc2`); }
      }
      if (tr.esc1 || tr.esc2) {
        await page.keyboard.press('Escape');
        tr.menuClosed = await leaveBtn().first().waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false);
      }
      tr.before = { aim: tr.before.aimingSlot.length, cursor: tr.before.cursor, modals: tr.before.modals, active: tr.before.active, focus: tr.before.hasFocus, ending: tr.before.ending };
      rec.trials.push(tr);
      if (tr.esc1 === false) log(`${mode} trial ${tr.s} s key ${tr.key}: Esc#1 no menu (aim ${tr.before.aim}, cursor ${tr.before.cursor}, modals ${tr.before.modals.length}); Esc#2 ${tr.esc2}`);
    }
  }
  rec.lastKey = ['Q', 'W', 'E', 'R'][(k - 1) % 4];
  // the probe's exact moment: Esc right after the last 3 s wait
  rec.before = await uiState();
  rec.shotBefore = await snap(`${mode}_before_esc`);
  await page.keyboard.press('Escape');
  const t1 = Date.now();
  rec.esc1Menu = await menuIn(15000);
  rec.esc1Ms = Date.now() - t1;
  rec.after1 = await uiState();
  if (!rec.esc1Menu) {
    rec.shotTimeout = await snap(`${mode}_esc1_timeout`);
    await page.keyboard.press('Escape');
    const t2 = Date.now();
    rec.esc2Menu = await menuIn(5000);
    rec.esc2Ms = Date.now() - t2;
    rec.after2 = await uiState();
    if (!rec.esc2Menu) rec.shotEsc2 = await snap(`${mode}_esc2_timeout`);
  } else rec.shotMenu = await snap(`${mode}_menu`);
  log(`${mode}: last key ${rec.lastKey}; before Esc aiming ${JSON.stringify(rec.before.aimingSlot)} cursor ${rec.before.cursor} modals ${rec.before.modals.length}; Esc#1 menu ${rec.esc1Menu}${rec.esc1Menu ? '' : `, Esc#2 menu ${rec.esc2Menu}`}`);
  if (!(rec.esc1Menu || rec.esc2Menu)) throw new Error(`${mode}: no menu after 2 Esc`);
  await click(leaveBtn(), 5000);
  await click(page.getByRole('dialog').getByRole('button', { name: /Leave match/i }), 15000);
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
}

let broke = false;
try {
  await page.locator('.nav__item', { hasText: 'Play' }).first().waitFor({ state: 'visible', timeout: 180000 });
  await page.waitForTimeout(6000);
  for (const m of MODES) await journey(m);
} catch (e) {
  broke = true; report.errors.push(String(e?.message ?? e).slice(0, 400)); log(`broke: ${e?.message ?? e}`);
  report.shotFail = await snap('FAIL');
} finally {
  report.console = logs.slice(0, 20);
  await browser.close().catch(() => {});
  await stopServer();
}
report.loadEnd = +loadavg()[0].toFixed(2);
const needed2 = report.matches.filter((r) => r.esc1Menu === false && r.esc2Menu === true).length;
const never = report.matches.filter((r) => r.esc1Menu === false && r.esc2Menu !== true).length;
const trials = report.matches.flatMap((r) => r.trials ?? []);
const trNever = trials.filter((t) => !t.esc1 && !t.esc2).length;
report.summary = { matches: report.matches.length, menuOnEsc1: report.matches.filter((r) => r.esc1Menu).length, needed2, never,
  trials: trials.length, trialEsc1: trials.filter((t) => t.esc1).length, trialEsc2: trials.filter((t) => !t.esc1 && t.esc2).length, trialNever: trNever,
  trialNoMenuWithAim: trials.filter((t) => !t.esc1 && t.before.aim > 0).length, trialNoMenuNoAim: trials.filter((t) => !t.esc1 && t.before.aim === 0).length,
  trialMenuNotClosed: trials.filter((t) => (t.esc1 || t.esc2) && !t.menuClosed).length };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`leave: ${JSON.stringify(report.summary)}; load ${report.loadStart} -> ${report.loadEnd}  → ${OUT}`);
process.exit(broke ? 3 : never || trNever ? 1 : 0);
