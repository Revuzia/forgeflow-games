// VALE — ship-hardening journeys in real Chrome (lane W1-E; part of `npm run check:browser`).
//
//   node _harness/e2e_ship.mjs [plate|tabs|fault|all] [--out <report.json>]
//
//   plate   TECH-07  /?render=0 (shipped-build rule): the branded plate, no menu, no way to queue; /?dev=1&render=0 and
//                    /?dev=1 on desktop unchanged; a touch-emulated phone and a 900x500 window get the plate with
//                    "Try anyway", which starts the app; 0 console errors on every page that is meant to be quiet
//   tabs     TECH-08  two pages of one browser profile (?tabs=1): the second shows "VALE is open in another tab", "Play here"
//                    takes over and the first shows the moved plate; the stored profile keeps the first tab's data
//   fault    TECH-09  ?dev=1&autopilot=1&fault=pump:<s>: a coop match is queued, 30 pump throws end it as interrupted: Home,
//                    a notice, the session idle, the saved profile's rating and history unchanged, no post-game
// Needs the dev server (npm run dev) and a content build. Exit 0 = every journey passed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE, shot } from './pw.mjs';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'e2e_ship.json');
const report = { started: new Date().toISOString(), journeys: [] };

const release = await holdHeavy('e2e_ship');
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1',
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
browser.on('disconnected', release);

/** a page in its own (or the given) context; console errors and warnings are collected unless they match `allow` */
async function page(ctx, path, { allow = null } = {}) {
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !(allow && allow.test(m.text()))) logs.push(`[${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) logs.push(`[http ${r.status()}] ${r.url()}`); });
  await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  return { p, logs };
}
const newCtx = async (o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, ...o });
  await ctx.routeWebSocket((u) => u.port === new URL(BASE).port, () => {});   // no HMR reloads under a journey
  return ctx;
};
const plateOf = (p) => p.evaluate(() => {
  const el = document.querySelector('[data-plate="ship"]');
  return el ? { text: el.querySelector('.errstate__text')?.textContent ?? '', title: el.querySelector('.booterr__title')?.textContent ?? '', buttons: [...el.querySelectorAll('button')].map((b) => b.textContent.trim()), nav: document.querySelectorAll('.nav__item').length } : null;
});
const appUp = (p) => p.evaluate(() => document.querySelectorAll('.bar .nav__item').length >= 3);
const waitPlate = (p) => p.waitForSelector('[data-plate="ship"]', { timeout: 20000 });
const waitApp = (p) => p.waitForFunction(() => document.querySelectorAll('.bar .nav__item').length >= 3, null, { timeout: 40000 });

function expect(ok, msg, extra) { if (!ok) throw Object.assign(new Error(msg), { extra }); }
async function journey(name, fn) {
  const j = { name, ok: false, steps: [] };
  const t0 = Date.now();
  try { await fn((s, data) => j.steps.push({ s, ...data })); j.ok = true; console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { j.error = String(e.message); j.extra = e.extra; console.log(`FAIL ${name}: ${e.message}${e.extra ? ` ${JSON.stringify(e.extra)}` : ''}`); }
  report.journeys.push(j);
}

if (which === 'all' || which === 'plate') {
  await journey('plate: ?render=0 (shipped rule) shows the plate, no menu', async (step) => {
    const ctx = await newCtx();
    const { p, logs } = await page(ctx, '/?render=0');
    await waitPlate(p);
    const pl = await plateOf(p);
    await shot(p, 'ship_plate_render0').catch(() => {});
    expect(/can't draw the game/.test(pl.text), 'wrong plate text', pl);
    expect(pl.buttons.join() === 'Reload' && pl.nav === 0, 'webgl plate has Reload only and no nav', pl);
    expect(!(await appUp(p)), 'the app mounted behind the plate');
    expect(await p.evaluate(() => !window.__vale && !document.querySelector('.queue, [data-queue]')), 'a queue surface exists');
    step('plate', { text: pl.text, logs: logs.length });
    expect(logs.length === 0, 'console not quiet', logs);
    await ctx.close();
  });
  await journey('plate: desktop runs unchanged (?dev=1, ?dev=1&render=0)', async (step) => {
    const ctx = await newCtx();
    for (const path of ['/?dev=1', '/?dev=1&render=0']) {
      const { p, logs } = await page(ctx, path);
      await waitApp(p);
      expect(!(await plateOf(p)), `plate on ${path}`);
      await p.waitForTimeout(1500);
      step(path, { logs: logs.length });
      expect(logs.length === 0, `console not quiet on ${path}`, logs);
      await p.close();
    }
    await ctx.close();
  });
  await journey('plate: touch-emulated phone gets the plate; Try anyway starts the app', async (step) => {
    const ctx = await newCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const { p, logs } = await page(ctx, '/?dev=1');
    await waitPlate(p);
    const pl = await plateOf(p);
    await shot(p, 'ship_plate_touch').catch(() => {});
    expect(/mouse and keyboard/.test(pl.text) && pl.buttons.join() === 'Try anyway' && pl.nav === 0, 'touch plate wrong', pl);
    expect(!(await appUp(p)), 'the app mounted behind the plate');
    expect(logs.length === 0, 'console not quiet', logs);
    await p.getByRole('button', { name: 'Try anyway' }).click();
    await p.waitForFunction(() => !!window.__vale, null, { timeout: 40000 });
    expect(!(await plateOf(p)), 'plate still up after Try anyway');
    step('try_anyway', { ok: true });
    await ctx.close();
  });
  await journey('plate: a 900x500 window gets the small plate; Try anyway starts the app', async (step) => {
    const ctx = await newCtx({ viewport: { width: 900, height: 500 } });
    const { p, logs } = await page(ctx, '/?dev=1');
    await waitPlate(p);
    const pl = await plateOf(p);
    expect(/too small/.test(pl.text) && pl.buttons.join() === 'Try anyway', 'small plate wrong', pl);
    expect(logs.length === 0, 'console not quiet', logs);
    await p.getByRole('button', { name: 'Try anyway' }).click();
    await p.waitForFunction(() => !!window.__vale, null, { timeout: 40000 });
    step('try_anyway', { ok: true });
    await ctx.close();
  });
}

if (which === 'all' || which === 'tabs') {
  await journey('tabs: the second tab is told, Play here takes over, the profile survives', async (step) => {
    const ctx = await newCtx();
    const A = await page(ctx, '/?dev=1&tabs=1');
    await waitApp(A.p);
    const idA = await A.p.evaluate(() => window.__vale.session.identity.id);
    await A.p.evaluate(() => window.__vale.session.rename('Tab Alpha'));
    const B = await page(ctx, '/?dev=1&tabs=1');
    await waitPlate(B.p);
    const pl = await plateOf(B.p);
    await shot(B.p, 'ship_plate_tab').catch(() => {});
    expect(pl.title === 'VALE is open in another tab' && pl.buttons.join() === 'Play here' && pl.nav === 0, 'second-tab plate wrong', pl);
    step('second_tab_plate', { text: pl.text });
    const stored = await B.p.evaluate(() => JSON.parse(localStorage.getItem('vale.profile.v1')));
    expect(stored.identity.displayName === 'Tab Alpha' && stored.identity.id === idA, 'second tab disturbed the stored profile', stored.identity);
    await B.p.getByRole('button', { name: 'Play here' }).click();
    await waitApp(B.p);
    await A.p.waitForSelector('[data-plate="ship"]', { timeout: 10000 });
    const moved = await plateOf(A.p);
    expect(/moved to another tab/.test(moved.text), 'first tab did not show the moved plate', moved);
    expect(await B.p.evaluate(() => window.__vale.session.identity.displayName) === 'Tab Alpha', 'the new tab lost the profile');
    step('play_here', { moved: moved.text });
    // the stale tab cannot overwrite: its session still thinks it can save, the store refuses once the new tab is ahead
    await B.p.evaluate(() => window.__vale.session.rename('Tab Bravo'));
    await A.p.evaluate(() => { try { window.__vale.session.rename('Stale Writer'); } catch { /* unmounted */ } });
    const after = await B.p.evaluate(() => JSON.parse(localStorage.getItem('vale.profile.v1')).identity.displayName);
    expect(after === 'Tab Bravo', 'the replaced tab overwrote the profile', after);
    step('no_overwrite', { name: after });
    expect(A.logs.length === 0 && B.logs.length === 0, 'console not quiet', [...A.logs, ...B.logs]);
    await ctx.close();
  });
}

if (which === 'all' || which === 'fault') {
  await journey('fault: 30 pump throws end the match as interrupted, Home with a notice, rating unchanged', async (step) => {
    const ctx = await newCtx();
    const { p, logs } = await page(ctx, '/?dev=1&autopilot=1&autoflow=1&speed=4&fault=pump:4', { allow: /\[vale\] (match pump|match interrupted|renderer)|injected pump fault|Failed to load resource/ });
    await p.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
    const before = await p.evaluate(() => { const v = window.__vale; return { ratings: JSON.stringify(v.session.profile().ratings), history: v.session.profile().history.length, wallet: JSON.stringify(v.session.profile().wallet) }; });
    await p.evaluate(() => { window.__postgames = 0; window.__vale.session.on((e) => { if (e.type === 'postgame') window.__postgames++; }); window.__vale.session.queue({ queue: 'rift_coop' }); });
    await p.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 180000 });
    step('match_started', { t: await p.evaluate(() => window.__vale.state.match.value.view.time) });
    await p.waitForFunction(() => !window.__vale.state.match.value, null, { timeout: 90000 });
    const after = await p.evaluate(() => {
      const v = window.__vale; const pr = v.session.profile();
      return { phase: v.session.phase, route: v.router.route.value.screen, toasts: v.state.toasts.value.map((t) => t.text), ratings: JSON.stringify(pr.ratings), history: pr.history.length, wallet: JSON.stringify(pr.wallet),
        postgames: window.__postgames, saved: JSON.parse(localStorage.getItem('vale.profile.v1')), cur: v.session.currentMatch() };
    });
    await shot(p, 'ship_fault_home').catch(() => {});
    expect(after.phase === 'idle' && after.cur === null, 'session not idle', after.phase);
    expect(after.route === 'home', 'not on Home', after.route);
    expect(after.toasts.some((t) => /hit a problem and was ended/.test(t)), 'no notice', after.toasts);
    expect(after.postgames === 0, 'a post-game was booked', after.postgames);
    expect(after.ratings === before.ratings && after.history === before.history && after.wallet === before.wallet, 'rating, history or wallet changed', { before, after: { r: after.ratings, h: after.history } });
    expect(JSON.stringify(after.saved.ratings) === before.ratings, 'saved profile differs', after.saved.ratings);
    step('interrupted', { route: after.route, toasts: after.toasts, history: after.history });
    // and the session still plays: queue again
    await p.evaluate(() => window.__vale.session.queue({ queue: 'rift_coop' }));
    await p.waitForFunction(() => ['searching', 'found', 'accepted', 'draft', 'loading', 'match'].includes(window.__vale.session.phase), null, { timeout: 30000 });
    step('requeue', { phase: await p.evaluate(() => window.__vale.session.phase) });
    expect(logs.length === 0, 'unexpected console output', logs);
    await ctx.close();
  });
}

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
report.ok = report.journeys.every((j) => j.ok);
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\ne2e_ship ${report.ok ? 'PASS' : 'FAIL'}: ${report.journeys.filter((j) => j.ok).length}/${report.journeys.length}`);
process.exit(report.ok ? 0 : 1);
