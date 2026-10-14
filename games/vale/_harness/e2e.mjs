// VALE — the DONE journey end to end in real Chrome with real input (CONTRACT §13 "e2e").
//
//   node _harness/e2e.mjs [rift|bridge|fray|all] [--speed 16] [--headed]
//
// Per mode: Home → Play → pick the mode on the Mode Dial → a queue → Find match → Ready → draft /
// assignment / pick (real clicks) → loading → the match (your seat on the dev autopilot at time scale
// --speed, so it reaches a REAL win condition; a few real inputs are sent in-match first) → the end
// banner → post-game with grants → Home. All modes share one profile, so after the last one the
// Candles earned buy a skin in the Shop and it is equipped (one STORE journey at the end). Screenshots per step go to
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

let session = null;
async function journey(mode) {
  const steps = [];
  let n = 0;
  session ??= await open(`/?dev=1&autopilot=match&speed=${speed}`);
  const { page, logs } = session;
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
  // the first frames after a load (shader compiles in the GPU process) can stall Playwright's scroll-into-view
  // without blocking the page: wait until frames flow, and retry a click once
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (locator) => {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    await frames();
    try { await locator.click({ timeout: 15000 }); } catch {
      // diagnose what sits on the target before the retry (overlays, scroll, focus traps)
      const box = await locator.boundingBox().catch(() => null);
      const diag = box ? await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const d = (e) => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}` : 'null';
        return { top: d(el), parent: d(el?.parentElement), scrollY: window.scrollY, docH: document.documentElement.scrollHeight, active: d(document.activeElement),
          inert: !!el?.closest('[inert]'), pe: el ? getComputedStyle(el).pointerEvents : '' };
      }, [box.x + box.width / 2, box.y + box.height / 2]) : 'no box';
      console.log('    click diag:', JSON.stringify({ box, diag }));
      await frames(); await locator.click({ timeout: 15000 });
    }
  };
  console.log(`\n${mode.toUpperCase()}`);
  let ok = true;
  try {
    await step('home', async () => { await page.waitForTimeout(800); await frames(); await page.waitForTimeout(1200); return { route: await route() }; });
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
      const mine = () => vale(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return s ? { phase: s.phase, turn: s.turn?.action ?? null, myTurn: !!s.turn?.players.includes(m?.player), hover: m?.hover ?? null, locked: m?.locked ?? null } : null; });
      const before = await mine();
      let after = before;
      if (before && before.phase !== 'done' && !before.locked) {
        // wait for a pick turn that includes you (blind / FFA pick: everyone at once; draft: in order)
        await waitFor(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !s || (s.phase !== 'pick' && s.phase !== 'ban') || !!m?.locked || (s.turn?.action !== 'ban' && !!s.turn?.players.includes(m?.player)); }, 90000);
        const now = await mine();
        if (!now || now.phase !== 'pick' || now.locked) { await waitFor(page, (v) => !!v.state.loading.value || !!v.state.match.value, 120000); return { before, after: now, assigned: true }; }
        const card = page.locator('.scr--draft .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
        if (await card.count()) { await card.click(); await page.waitForTimeout(250); }
        const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
        if (await lock.count()) { await lock.click(); await page.waitForTimeout(400); }
        after = await mine();
        if (after && after.phase !== 'done' && !after.locked && after.turn !== 'ban') throw new Error(`could not lock a fighter: ${JSON.stringify(after)}`);
      }
      await waitFor(page, (v) => !!v.state.loading.value || !!v.state.match.value, 120000);
      return { before, after };
    });
    await step('loading', async () => { await waitFor(page, (v) => v.state.match.value?.view.phase === 'pregame' || v.state.match.value?.view.phase === 'live', 60000); return { route: await route() }; });
    await step('match_input', async () => {
      // real input while the autopilot drives: open and close the shop, hold the scoreboard, ping
      await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
      const shopOpen = await page.locator('.hud .lshop').count();
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      await page.keyboard.down('Tab'); await page.waitForTimeout(250);
      const board = await page.locator('.hud .hscore').count();
      await page.keyboard.up('Tab');
      return { shopOpen: !!shopOpen, scoreboard: !!board, hud: await page.locator('.hud .dbar').count() > 0 };
    });
    await step('match_live', async () => {
      await waitFor(page, (v) => (v.state.match.value?.view.time ?? 0) > 60, 180000);
      return await vale(page, (v) => { const c = v.state.match.value; const p = c.view.players[c.you]; return { t: Math.round(c.view.time), scale: c.timeScale, kda: `${p.kills}/${p.deaths}/${p.assists}`, gold: p.gold, level: c.view.entity(p.entity)?.level, cues: [...new Set(v.cueLog ?? [])].length }; });
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
    await step('home_again', async () => {
      await click(page.getByRole('button', { name: /Return home/i }).first());
      await page.waitForTimeout(800);
      return { route: await route(), wallet: await vale(page, (v) => v.state.profile.value.wallet) };
    });
  } catch {
    ok = false;
  }
  const errors = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  const hard = errors.filter((l) => /^\[(http [45]|pageerror)/.test(l));
  if (hard.length) { ok = false; console.log(`  ✗ ${hard.length} failed request(s) / page error(s): ${hard.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode, ok, steps, consoleErrors: errors.slice(0, 20) });
  return ok;
}

async function store() {
  const steps = [];
  let n = 0;
  const { page, logs } = session;
  const mode = 'store';
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
  console.log('\nSTORE');
  let ok = true;
  try {
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
      const card = page.locator(`.offer[aria-label^="${name},"]`).first();
      await card.scrollIntoViewIfNeeded();
      await click(card);
      await waitFor(page, (v, s) => v.router.route.value.params?.sku === s, 5000, sku);
      await click(page.locator('.scr__foot').getByRole('button', { name: /^Buy/ }));
      await page.waitForTimeout(300);
      const confirm = page.locator('.modal').getByRole('button', { name: /^Buy/ });
      if (await confirm.count()) await confirm.first().click();
      await waitFor(page, (v, s) => v.state.profile.value.owned.some((o) => o.sku === s), 10000, sku);
      return { sku, skin: name };
    });
    await step('equip', async () => {
      // the post-purchase modal offers "Equip now"; fall back to the screen's Equip CTA
      const eq = page.locator('.modal').getByRole('button', { name: /^Equip/ });
      await click((await eq.count()) ? eq.first() : page.locator('.scr__foot').getByRole('button', { name: /^Equip/ }));
      await waitFor(page, (v) => { const r = v.router.route.value.params?.sku; const s = r && v.cv.skin(v.cv.offer(r)?.ref); return !!s && v.state.profile.value.equipped[s.fighter] === s.id; }, 5000);
      return await vale(page, (v) => v.state.profile.value.equipped);
    });
  } catch {
    ok = false;
  }
  const errs = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  const hardErrs = errs.filter((l) => /^\[(http [45]|pageerror)/.test(l));
  if (hardErrs.length) { ok = false; console.log(`  ✗ ${hardErrs.length} failed request(s) / page error(s): ${hardErrs.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode, ok, steps, consoleErrors: errs.slice(0, 20) });
  return ok;
}

let all = true;
for (const m of MODES) all = (await journey(m)) && all;
all = (await store()) && all;
await session?.browser.close();
report.finished = new Date().toISOString();
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'e2e.json'), JSON.stringify(report, null, 2));
console.log(`\n${all ? 'PASS' : 'FAIL'}  (${report.journeys.map((j) => `${j.mode}:${j.ok ? 'ok' : 'FAIL'}`).join(' ')})  report: _harness/_reports/e2e.json`);
process.exit(all ? 0 : 1);
