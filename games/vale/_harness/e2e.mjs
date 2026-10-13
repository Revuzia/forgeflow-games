// VALE — the DONE journey end to end in real Chrome with real input (CONTRACT §13 "e2e").
//
//   node _harness/e2e.mjs [rift|bridge|fray|all] [--speed 16] [--headed]
//
// Per mode: Home → Play → pick the mode on the Mode Dial → a queue → Find match → Ready → draft /
// assignment / pick (real clicks) → loading → the match (your seat on the dev autopilot at time scale
// --speed, so it reaches a REAL win condition; a few real inputs are sent in-match first) → the end
// banner → post-game with grants → Shop → buy a skin → Equip it. Screenshots per step go to
// _harness/_shots/e2e_<mode>_<nn>_<step>.png; a JSON report to _harness/_reports/e2e.json.
// Needs the dev server (npm run dev) and a content build. Exit 0 = every journey passed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const speed = Number(args[args.indexOf('--speed') + 1]) || 16;
if (args.includes('--headed')) process.env.VALE_HEADED = '1';
const MODES = which === 'all' ? ['rift', 'bridge', 'fray'] : [which];
const QUEUE_CARD = { rift: 'Co-op vs bots', bridge: null, fray: null };

const report = { started: new Date().toISOString(), speed, journeys: [] };

async function controls(page) {
  return page.evaluate(() => [...document.querySelectorAll('button,[role=radio],[role=tab]')].filter((b) => b.offsetParent)
    .map((b) => `${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)}${b.getAttribute('aria-disabled') === 'true' || b.disabled ? ' [disabled]' : ''}`));
}

async function journey(mode) {
  const steps = [];
  let n = 0;
  const { browser, page, logs } = await open(`/?dev=1&autopilot=match&speed=${speed}`);
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const info = await fn();
      const file = await shot(page, `e2e_${mode}_${String(++n).padStart(2, '0')}_${name}`);
      steps.push({ name, ok: true, ms: Date.now() - t0, info: info ?? null, shot: file });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${info ? ' ' + JSON.stringify(info) : ''}`);
    } catch (e) {
      const file = await shot(page, `e2e_${mode}_${String(++n).padStart(2, '0')}_${name}_FAIL`).catch(() => null);
      steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400), controls: await controls(page).catch(() => []), shot: file });
      console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
      throw e;
    }
  };
  const route = () => vale(page, (v) => v.router.route.value.screen);
  const click = async (locator) => { await locator.waitFor({ state: 'visible', timeout: 15000 }); await locator.click(); };
  console.log(`\n${mode.toUpperCase()}`);
  let ok = true;
  try {
    await step('home', async () => { await page.waitForTimeout(800); return { route: await route() }; });
    await step('play', async () => {
      await click(page.locator('.nav__item', { hasText: 'Play' }));
      await page.waitForTimeout(500);
      await click(page.locator('.station', { hasText: mode.toUpperCase() }).first());
      await page.waitForTimeout(500);
      if (QUEUE_CARD[mode]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] }));
      await page.waitForTimeout(300);
      return { route: await route() };
    });
    await step('find_match', async () => {
      await click(page.getByRole('button', { name: 'Find match' }));
      await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
      return { queue: await vale(page, (v) => v.state.queue.value?.state ?? null) };
    });
    await step('ready', async () => {
      const ready = page.getByRole('button', { name: /^Ready/ });
      if (await ready.count()) await click(ready.first());
      await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
      return { route: await route() };
    });
    await step('pick', async () => {
      const d = await vale(page, (v) => { const s = v.state.draft.value; return s ? { phase: s.phase, turn: s.turn, mine: s.seats.find((x) => x.isYou) ?? null } : null; });
      if (d && d.phase !== 'done') {
        // a pick protocol where you choose: hover the first available fighter card, then lock in
        const card = page.locator(".fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled=\"true\"])").first();
        if (await card.count()) { await card.click(); await page.waitForTimeout(200); }
        const lock = page.getByRole('button', { name: /Lock in/i });
        if (await lock.count() && !(await lock.first().getAttribute('aria-disabled'))) await lock.first().click();
      }
      await waitFor(page, (v) => !!v.state.loading.value || !!v.state.match.value, 120000);
      return { draft: d ? { phase: d.phase, fighter: d.mine?.locked ?? d.mine?.hover ?? null } : null };
    });
    await step('loading', async () => { await waitFor(page, (v) => v.state.match.value?.view.phase === 'pregame' || v.state.match.value?.view.phase === 'live', 60000); return { route: await route() }; });
    await step('match_input', async () => {
      // real input while the autopilot drives: open and close the shop, hold the scoreboard, ping
      await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
      const shopOpen = await page.locator('.hud .shop').count();
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      await page.keyboard.down('Tab'); await page.waitForTimeout(250);
      const board = await page.locator('.hud .score').count();
      await page.keyboard.up('Tab');
      return { shopOpen: !!shopOpen, scoreboard: !!board, hud: await page.locator('.hud .dbar').count() > 0 };
    });
    await step('match_live', async () => {
      await waitFor(page, (v) => (v.state.match.value?.view.time ?? 0) > 60, 180000);
      return await vale(page, (v) => { const c = v.state.match.value; const p = c.view.players[c.you]; return { t: Math.round(c.view.time), scale: c.timeScale, kda: `${p.kills}/${p.deaths}/${p.assists}`, gold: p.gold, level: c.view.entity(p.entity)?.level }; });
    });
    await step('match_end', async () => {
      await waitFor(page, (v) => v.state.ending.value || v.router.route.value.screen === 'postgame', 1500000);
      await page.waitForTimeout(600);
      return { banner: await page.locator('.endban__title').textContent().catch(() => null) };
    });
    await step('postgame', async () => {
      await waitFor(page, (v) => v.router.route.value.screen === 'postgame', 20000);
      await page.waitForTimeout(1500);
      return await vale(page, (v) => { const pg = v.state.postgame.value; const me = pg.result.players.find((x) => x.player === pg.you); return { reason: pg.result.reason, won: me.won, placement: me.placement, duration: Math.round(pg.result.duration), grants: pg.grants.currency, xp: pg.grants.xp }; });
    });
    await step('shop', async () => {
      await click(page.locator('.nav__item', { hasText: 'Shop' }));
      await page.waitForTimeout(800);
      return { route: await route(), wallet: await vale(page, (v) => v.state.profile.value.wallet) };
    });
    await step('buy_skin', async () => {
      // the cheapest affordable skin offer in the earned currency
      const sku = await vale(page, (v) => {
        const cur = v.cv.earnedCurrency(); const bal = v.state.profile.value.wallet[cur.id] ?? 0;
        const owned = new Set(v.state.profile.value.owned.map((o) => o.ref));
        const offers = v.cv.c.store.offers.filter((o) => o.kind === 'skin' && !owned.has(o.ref) && o.price.currency === cur.id && o.price.amount <= bal).sort((a, b) => a.price.amount - b.price.amount);
        return offers[0]?.sku ?? null;
      });
      if (!sku) throw new Error('no affordable skin offer (grants too low?)');
      const name = await vale(page, (v, s) => v.cv.skin(v.cv.offer(s).ref).name, sku);
      await click(page.locator('button, [role=button]', { hasText: name }).first());
      await page.waitForTimeout(400);
      await click(page.getByRole('button', { name: /^Buy/ }).first());
      await page.waitForTimeout(300);
      const confirm = page.locator('.modal').getByRole('button', { name: /^Buy/ });
      if (await confirm.count()) await confirm.first().click();
      await waitFor(page, (v, s) => v.state.profile.value.owned.some((o) => o.sku === s), 10000, sku);
      return { sku, skin: name };
    });
    await step('equip', async () => {
      const eq = page.getByRole('button', { name: /^Equip/ });
      await click(eq.first());
      await page.waitForTimeout(400);
      return await vale(page, (v) => v.state.profile.value.equipped);
    });
  } catch {
    ok = false;
  }
  const errors = logs.filter((l) => !/404|unavailable|Failed to load resource/.test(l));
  report.journeys.push({ mode, ok, steps, consoleErrors: errors.slice(0, 20) });
  await browser.close();
  return ok;
}

let all = true;
for (const m of MODES) all = (await journey(m)) && all;
report.finished = new Date().toISOString();
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'e2e.json'), JSON.stringify(report, null, 2));
console.log(`\n${all ? 'PASS' : 'FAIL'}  (${report.journeys.map((j) => `${j.mode}:${j.ok ? 'ok' : 'FAIL'}`).join(' ')})  report: _harness/_reports/e2e.json`);
process.exit(all ? 0 : 1);
