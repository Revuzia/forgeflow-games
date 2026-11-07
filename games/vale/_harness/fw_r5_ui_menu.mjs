// VALE harness — fw r5 UI-2 (owner ruling 26): the HUD's Menu tab, the mouse path to the in-match menu.
//
//   VALE_URL=http://localhost:<port> node _harness/fw_r5_ui_menu.mjs [--modes rift,bridge,fray] [--sizes 1280x720,1920x1080]
//                                    [--out _harness/_reports/fw_r5_ui_menu.json] [--shots fw_r5_ui_menu]
//
// The dev client (?dev=1, your seat on the dev autopilot) in real Chrome on the GPU, one browser per mode × size. In the
// match it checks, at the player's layer:
//   place     .hud .hmenu is on screen and its box overlaps none of: the minimap, the target plate, the Dial Bar (the
//             ability bar), the sky strip, the ally frames, the kill feed, the Hour Board, the practice tools, the shop
//             (opened with its key) and the scoreboard (held with its key); again with the minimap swapped left
//   tooltip   hovering it shows a tooltip that names Esc
//   click     a real mouse click opens the menu (Leave match visible); Esc closes it again
//   esc       ruling 26 order: with the shop open, Esc 1 closes the shop and opens no menu; Esc 2 opens the menu
// Shots: <shots>_<mode>_<w>x<h>_{hud,tip,menu}.png. Exit 0 = every check passed; 1 = a check failed; 3 = broke.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODES = opt('modes', 'rift').split(',').filter(Boolean);
const SIZES = opt('sizes', '1280x720,1920x1080').split(',').filter(Boolean).map((s) => s.split('x').map(Number));
const OUT = resolve(ROOT, opt('out', '_harness/_reports/fw_r5_ui_menu.json'));
const SHOTS = opt('shots', 'fw_r5_ui_menu');
const QUEUE_CARD = { rift: 'Lantern Drill' };
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${s}`);
const report = { probe: 'fw_r5_ui_menu', at: new Date().toISOString(), build: 'dev client', loadStart: +loadavg()[0].toFixed(2), runs: [], errors: [] };

/** the boxes the Menu tab must never cover (whatever is on screen) */
const BLOCKERS = { minimap: '.hud .mmap', mapbox: '.hud .hud__map > *', target: '.hud .tplate', dialbar: '.hud .dbar', sky: '.hud .sky', ledger: '.hud .skyledger',
  allies: '.hud .allies', killfeed: '.hud .krow', hourboard: '.hud .hboard', practice: '.hud .ptools', shop: '.hud .lshop', scoreboard: '.hud .hscore', announcer: '.hud .announce' };
const boxes = (page) => page.evaluate((B) => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const m = document.querySelector('.hud .hmenu');
  const out = { menu: m && m.getBoundingClientRect().width > 0 ? r(m) : null, others: {} };
  for (const [k, sel] of Object.entries(B)) {
    const list = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map(r);
    if (list.length) out.others[k] = list;
  }
  return out;
}, BLOCKERS);
const hits = (b) => {
  if (!b.menu) return ['no menu tab'];
  const m = b.menu, o = [];
  for (const [k, list] of Object.entries(b.others)) for (const x of list) {
    if (m.x < x.x + x.w && x.x < m.x + m.w && m.y < x.y + x.h && x.y < m.y + m.h) o.push(`${k} ${JSON.stringify(x)}`);
  }
  return o;
};

async function intoMatch(page, mode) {
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 30000 }); await l.click({ timeout: 30000 }); };
  await click(page.locator('.nav__item', { hasText: 'Play' })); await page.waitForTimeout(500);
  await click(page.locator('.station', { hasText: mode.toUpperCase() }).first()); await page.waitForTimeout(500);
  if (QUEUE_CARD[mode]) { await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] })); await page.waitForTimeout(300); }
  await click(page.getByRole('button', { name: 'Find match' }));
  const until = Date.now() + 240000;
  let lockTries = 0;
  while (!(await page.locator('.hud .dbar').first().isVisible().catch(() => false))) {
    if (Date.now() > until) throw new Error(`${mode}: no HUD after 240 s`);
    const ready = page.getByRole('button', { name: /^Ready/ }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click({ timeout: 3000 }).catch(() => {});
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (lockTries < 40 && await card.isVisible().catch(() => false) && await lock.isVisible().catch(() => false)) {
      lockTries++; await card.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); await lock.click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2500);
}

const leaveVisible = (page) => page.getByRole('button', { name: /Leave match/i }).first().isVisible().catch(() => false);
const menuIn = async (page, ms) => { try { await page.getByRole('button', { name: /Leave match/i }).first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };

async function run(mode, w, h) {
  const tag = `${SHOTS}_${mode}_${w}x${h}`;
  const rec = { mode, size: `${w}x${h}`, checks: {}, fails: [] };
  report.runs.push(rec);
  const fail = (what, info) => { rec.fails.push({ what, info }); log(`  ✗ ${mode} ${w}x${h} ${what} ${JSON.stringify(info).slice(0, 300)}`); };
  const { browser, page, logs } = await open('/?dev=1&autopilot=match&speed=1', { width: w, height: h, hmr: false });
  try {
    await page.waitForTimeout(1500);
    await intoMatch(page, mode);
    log(`${mode} ${w}x${h}: in the match`);
    await page.mouse.move(w * 0.5, h * 0.45);
    // place: the HUD as it stands, then the shop open, then the scoreboard held, then the minimap swapped left
    const states = {};
    states.hud = await boxes(page);
    rec.shotHud = await shot(page, `${tag}_hud`);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(500);
    states.shop = await boxes(page);
    if (!states.shop.others.shop) fail('shop did not open on P', states.shop.others);
    rec.shotShop = await shot(page, `${tag}_shop`);
    // ruling 26: Esc 1 closes the shop (no menu), Esc 2 opens the menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const esc1 = { shop: await page.locator('.hud .lshop').count(), menu: await leaveVisible(page) };
    await page.keyboard.press('Escape');
    const esc2Menu = await menuIn(page, 3000);
    rec.checks.esc = { esc1, esc2Menu };
    if (esc1.shop || esc1.menu || !esc2Menu) fail('Esc order (shop, then menu)', rec.checks.esc);
    if (esc2Menu) { await page.keyboard.press('Escape'); await page.getByRole('button', { name: /Leave match/i }).first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => fail('Esc did not close the menu', {})); }
    await page.keyboard.down('Tab');
    await page.waitForTimeout(500);
    states.scoreboard = await boxes(page);
    if (!states.scoreboard.others.scoreboard) fail('scoreboard did not show on Tab', states.scoreboard.others);
    rec.shotBoard = await shot(page, `${tag}_scoreboard`);
    await page.keyboard.up('Tab');
    await vale(page, (v) => { const s = v.state.settings.peek(); v.session.updateSettings({ gameplay: { ...s.gameplay, minimapSide: 'left' } }); });
    await page.waitForTimeout(600);
    states.mapLeft = await boxes(page);
    rec.shotMapLeft = await shot(page, `${tag}_mapleft`);
    await vale(page, (v) => { const s = v.state.settings.peek(); v.session.updateSettings({ gameplay: { ...s.gameplay, minimapSide: 'right' } }); });
    await page.waitForTimeout(400);
    rec.checks.place = {};
    for (const [k, b] of Object.entries(states)) {
      const o = hits(b);
      rec.checks.place[k] = { menu: b.menu, seen: Object.keys(b.others), overlaps: o };
      if (o.length) fail(`menu tab overlaps (${k})`, o);
    }
    // tooltip: hover the tab, a tooltip naming Esc
    const tab = page.locator('.hud .hmenu').first();
    await tab.hover();
    await page.waitForTimeout(700);
    const tip = await page.evaluate(() => [...document.querySelectorAll('.tipx')].map((e) => e.textContent.trim()).join(' | '));
    rec.checks.tooltip = tip;
    if (!/\bEsc\b/.test(tip)) fail('tooltip does not name Esc', tip);
    rec.shotTip = await shot(page, `${tag}_tip`);
    // click: a real mouse click on the tab opens the menu
    const b = await tab.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const opened = await menuIn(page, 3000);
    rec.checks.click = { opened, box: b };
    if (!opened) fail('click did not open the menu', b);
    rec.shotMenu = await shot(page, `${tag}_menu`);
    if (opened) {
      await page.keyboard.press('Escape');
      const closed = await page.getByRole('button', { name: /Leave match/i }).first().waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false);
      rec.checks.click.closedByEsc = closed;
      if (!closed) fail('Esc did not close the menu opened by click', {});
    }
    rec.console = logs.filter((l) => !/Failed to load resource/.test(l)).slice(0, 20);
    if (rec.console.length) fail('console lines', rec.console);
  } catch (e) {
    rec.broke = String(e?.message ?? e).slice(0, 400);
    rec.shotFail = await shot(page, `${tag}_FAIL`).catch(() => null);
    log(`  broke: ${rec.broke}`);
  } finally {
    await browser.close().catch(() => {});
  }
  log(`${mode} ${w}x${h}: ${rec.broke ? 'BROKE' : rec.fails.length ? `FAIL ${rec.fails.length}` : 'ok'}`);
}

for (const m of MODES) for (const [w, h] of SIZES) await run(m, w, h);
report.loadEnd = +loadavg()[0].toFixed(2);
const broke = report.runs.some((r) => r.broke);
const failed = report.runs.some((r) => r.fails.length);
report.summary = { runs: report.runs.length, ok: report.runs.filter((r) => !r.broke && !r.fails.length).length, broke: report.runs.filter((r) => r.broke).length };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`fw_r5_ui_menu: ${broke ? 'BROKE' : failed ? 'FAIL' : 'PASS'} ${JSON.stringify(report.summary)}; load ${report.loadStart} -> ${report.loadEnd} → ${OUT}`);
process.exit(broke ? 3 : failed ? 1 : 0);
