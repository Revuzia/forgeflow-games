// VALE — the DONE journey end to end in real Chrome with real input (CONTRACT §13 "e2e").
//
//   node _harness/e2e.mjs [rift|bridge|fray|flow|all] [--speed 16] [--headed] [--audio m4a] [--out <report.json>] [--prefix e2e]
//
// Per mode: Home → Play → pick the mode on the Mode Dial → a queue → Find match → Ready → draft /
// assignment / pick (real clicks) → loading → the match (your seat on the dev autopilot at time scale
// --speed, so it reaches a REAL win condition; a few real inputs are sent in-match first) → the end
// banner → post-game with grants → Home. All modes share one profile, so after the last one the
// Candles earned buy a skin in the Shop and it is equipped (one STORE journey at the end). Screenshots per step go to
// _harness/_shots/e2e_<mode>_<nn>_<step>.png; a JSON report to _harness/_reports/e2e.json.
// --audio m4a opens the game with ?audio=m4a (the CONTRACT §11 format fallback forced); match_live reports the
// audio files fetched per format either way. Needs the dev server (npm run dev) and a content build. Exit 0 =
// every journey passed.
//
// FLOW (`flow`, and first under `all`; no match is played, the renderer is off): the queue flow's exits.
//   dodge       Find match → Ready → the draft → Esc → Leave draft: back on Play with ONE notice, then the full client
//               on Play and on Home (6 .nav__item, the wallet, the profile chip; no flow bar, no draft left in state);
//               the portal bar's Pause / Menu opens Settings and closes it again; Settings and Profile from the nav.
//   readycheck  the tab hidden the way tabbing away hides it: the ready check raises a system Notification (a recording
//               stand-in: Playwright's Chrome has no notification permission) after ONE permission ask on the first
//               queue, lights the favicon, and at <= 4 s left plays ui_queue_remind and raises the notification again;
//               back on the page the notification closes, Decline leaves ONE notice and the plain favicon.
//   netdown     ?server=ws://127.0.0.1:9 (nothing listens): the bar reads Offline · vs bots after the first failure and
//               stays there for 24 s with Try again offered; Try again reads Connecting… and falls back to Offline.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const speed = Number(args[args.indexOf('--speed') + 1]) || 16;
const audioFmt = args.includes('--audio') ? args[args.indexOf('--audio') + 1] : null;
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'e2e.json');
const PREFIX = args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : 'e2e';
if (args.includes('--headed')) process.env.VALE_HEADED = '1';
const MODES = which === 'all' ? ['rift', 'bridge', 'fray'] : which === 'flow' ? [] : [which];
const FLOW = which === 'all' || which === 'flow';
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
  if (!session) {
    session = await open(`/?dev=1&autopilot=match&speed=${speed}${audioFmt ? `&audio=${audioFmt}` : ''}`);
    session.audioFetches = { ogg: 0, m4a: 0 };
    session.page.on('request', (q) => { const m = /\.(ogg|m4a)$/.exec(new URL(q.url()).pathname); if (m) session.audioFetches[m[1]]++; });
  }
  const { page, logs } = session;
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const info = await fn();
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}`);
      steps.push({ name, ok: true, ms: Date.now() - t0, info: info ?? null, shot: file });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${info ? ' ' + JSON.stringify(info) : ''}`);
    } catch (e) {
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}_FAIL`).catch(() => null);
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
        const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
        await card.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});   // the board lands under the screen wipe
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
      return await vale(page, (v) => { const c = v.state.match.value; const p = c.view.players[c.you]; return { t: Math.round(c.view.time), scale: c.timeScale, kda: `${p.kills}/${p.deaths}/${p.assists}`, gold: p.gold, level: c.view.entity(p.entity)?.level, cues: [...new Set(v.cueLog ?? [])].length }; }).then((x) => ({ ...x, audioFetches: { ...session.audioFetches } }));
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
    // client F4: the post-game scoreboard is a real table at 1920 and 1280 — every header's x-centre within 4 px of
    // its cells' in every row, no header wraps, and every owned item shows its painted icon (never a letter)
    await step('postgame_scoreboard', async () => {
      await click(page.locator('.scr--postgame [role=tab]', { hasText: /Scoreboard|Hour Board/ }).first());
      await page.waitForTimeout(700);
      const out = {};
      for (const [w, h] of [[1920, 1080], [1280, 720]]) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const cx = (e) => { const r = e.getBoundingClientRect(); return (r.left + r.right) / 2; };
          let worst = 0, rows = 0, tdDisplay = new Set(), wrapped = [], itemsFull = 0, itemsImg = 0, letters = 0;
          for (const t of document.querySelectorAll('.scr--postgame:not(.is-leaving) .score__table')) {
            const ths = [...t.querySelectorAll('thead th')];
            for (const th of ths) { const lh = parseFloat(getComputedStyle(th).lineHeight) || 18; const pad = parseFloat(getComputedStyle(th).paddingTop) + parseFloat(getComputedStyle(th).paddingBottom); if (th.getBoundingClientRect().height > lh * 1.5 + pad) wrapped.push(th.innerText.trim()); }
            for (const tr of t.querySelectorAll('tbody tr')) {
              rows++;
              const tds = [...tr.children];
              tds.forEach((td, i) => { tdDisplay.add(getComputedStyle(td).display); if (ths[i]) worst = Math.max(worst, Math.abs(cx(ths[i]) - cx(td))); });
              for (const s of tr.querySelectorAll('.itemslot.is-full')) { itemsFull++; if (s.querySelector('img')) itemsImg++; if ((s.innerText || '').trim()) letters++; }
            }
          }
          return { rows, worstDx: Math.round(worst * 10) / 10, tdDisplay: [...tdDisplay], wrapped, itemsFull, itemsImg, letters };
        });
        out[w] = m;
        await shot(page, `${PREFIX}_${mode}_postgame_scoreboard_${w}`);
        if (!m.rows) throw new Error(`no scoreboard rows at ${w}`);
        if (m.worstDx > 4) throw new Error(`header/cell x-centres differ by ${m.worstDx} px at ${w}`);
        if (m.tdDisplay.some((d) => d !== 'table-cell')) throw new Error(`cells are not table cells at ${w}: ${m.tdDisplay}`);
        if (m.wrapped.length) throw new Error(`headers wrap at ${w}: ${m.wrapped.join(', ')}`);
        if (m.letters || m.itemsImg < m.itemsFull) throw new Error(`items without painted icons at ${w}: ${m.itemsImg}/${m.itemsFull} img, ${m.letters} letters`);
      }
      await page.setViewportSize({ width: 1920, height: 1080 }); await page.waitForTimeout(400);
      await click(page.locator('.scr--postgame [role=tab]', { hasText: 'Summary' }).first());
      await page.waitForTimeout(300);
      return out;
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
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}`);
      steps.push({ name, ok: true, ms: Date.now() - t0, info: info ?? null, shot: file });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${info ? ' ' + JSON.stringify(info) : ''}`);
    } catch (e) {
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}_FAIL`).catch(() => null);
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
        const offers = v.cv.c.store.offers.filter((o) => o.kind === 'skin' && v.cv.skinOnSale(o.ref) && !owned.has(o.ref) && o.price.currency === cur.id && o.price.amount <= bal).sort((a, b) => a.price.amount - b.price.amount);
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


// ── FLOW: the queue flow's exits (dodge, ready check in a hidden tab, server down) ─────────────────────────
/** a step runner: a shot per step, the report row, and the first failure ends the journey */
function stepper(page, tag, steps) {
  let n = 0;
  return async (name, fn) => {
    const t0 = Date.now();
    try {
      const info = await fn();
      const file = await shot(page, `${PREFIX}_${tag}_${String(++n).padStart(2, '0')}_${name}`);
      steps.push({ name, ok: true, ms: Date.now() - t0, info: info ?? null, shot: file });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${info ? ' ' + JSON.stringify(info) : ''}`);
      return info;
    } catch (e) {
      const file = await shot(page, `${PREFIX}_${tag}_${String(++n).padStart(2, '0')}_${name}_FAIL`).catch(() => null);
      steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400), controls: await controls(page).catch(() => []), shot: file });
      console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
      throw e;
    }
  };
}
const expect = (cond, what, info) => { if (!cond) throw new Error(`${what}: ${JSON.stringify(info)}`); };

/** the client's chrome as the player sees it */
const chromeOf = (page) => page.evaluate(() => {
  const vis = (sel) => { const el = document.querySelector(sel); return !!el && !!el.offsetParent && el.getBoundingClientRect().width > 0; };
  const v = window.__vale;
  return {
    route: v.router.route.value.screen, draft: !!v.state.draft.value, nav: document.querySelectorAll('.bar .nav__item').length,
    wallet: vis('.bar .bar__wallet'), me: vis('.bar .bar__me'), flowBar: !!document.querySelector('.bar .bar__flow'),
    toasts: [...document.querySelectorAll('.toasts .toast__text')].map((e) => e.textContent.trim()),
  };
});
const fullClient = (c) => c.nav === 6 && c.wallet && c.me && !c.flowBar && !c.draft;

async function flowJourneys() {
  const s = await open('/?dev=1&render=0', { hmr: false });
  const { browser, page, logs } = s;
  const route = () => vale(page, (v) => v.router.route.value.screen);
  const click = async (locator) => { await locator.waitFor({ state: 'visible', timeout: 15000 }); await locator.click({ timeout: 15000 }); };
  const toPlayRift = async () => {
    await click(page.locator('.nav__item', { hasText: 'Play' }));
    await page.waitForTimeout(500);
    await click(page.locator('.station', { hasText: 'RIFT' }).first());
    await page.waitForTimeout(400);
    await click(page.locator('.qcard', { hasText: 'Co-op vs bots' }));
    await page.waitForTimeout(300);
  };
  const lockoutClear = () => waitFor(page, (v) => v.state.lockoutLeft.value <= 0, 70000);
  const hide = (on) => page.evaluate((on) => {
    if (on) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    } else { delete document.hidden; delete document.visibilityState; }
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
  const favicon = () => page.evaluate(() => ({ state: window.__vale.state.readyAlert?.icon ?? null, href: (document.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? '').slice(0, 22) }));
  let ok = true;

  // ── dodge ───────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nFLOW · DODGE');
  const steps = [];
  const step = stepper(page, 'flow_dodge', steps);
  try {
    // a recording stand-in for the Notification API (permission starts 'default', the ask grants it)
    await page.evaluate(() => {
      const rec = { asked: 0, shown: [], closed: 0 };
      window.__notes = rec;
      class Note {
        constructor(title, o = {}) { this.title = title; rec.shown.push({ title, body: o.body ?? '', tag: o.tag ?? '', renotify: !!o.renotify, silent: !!o.silent, t: Math.round(performance.now()) }); }
        close() { rec.closed++; }
        static requestPermission() { rec.asked++; Note.permission = 'granted'; return Promise.resolve('granted'); }
      }
      Note.permission = 'default';
      window.Notification = Note;
    });
    await step('home', async () => { await page.waitForTimeout(1500); const c = await chromeOf(page); expect(fullClient(c), 'Home before the queue is not the full client', c); return c; });
    await step('play', async () => { await toPlayRift(); return { route: await route() }; });
    await step('find_match', async () => {
      await click(page.getByRole('button', { name: 'Find match' }));
      await waitFor(page, (v) => v.state.queue.value?.state === 'found', 30000);
      const notes = await page.evaluate(() => window.__notes);
      expect(notes.asked === 1, 'the first queue did not ask once for notification permission', notes);
      return { queue: 'found', asked: notes.asked, favicon: await favicon() };
    });
    await step('ready', async () => {
      await click(page.getByRole('button', { name: /^Ready/ }).first());
      await waitFor(page, (v) => !!v.state.draft.value, 30000);
      await page.waitForTimeout(1200);
      return { route: await route(), favicon: await favicon() };
    });
    await step('leave_draft', async () => {
      await page.keyboard.press('Escape');
      await click(page.locator('.modal').getByRole('button', { name: 'Leave draft' }));
      await waitFor(page, (v) => v.router.route.value.screen === 'play', 10000);
      return { route: await route() };
    });
    await step('play_after_dodge', async () => {
      await page.waitForTimeout(2000);
      const c = await chromeOf(page);
      const notices = c.toasts.filter((t) => /left the draft/i.test(t)).length;
      expect(c.route === 'play' && fullClient(c), 'Play after Leave draft is not the full client', c);
      expect(notices === 1, 'Leave draft did not leave exactly one notice', c.toasts);
      return { ...c, notices };
    });
    await step('home_after_dodge', async () => {
      await click(page.locator('.nav__item', { hasText: 'Home' }));
      await page.waitForTimeout(900);
      const c = await chromeOf(page);
      expect(c.route === 'home' && fullClient(c), 'Home after Leave draft is not the full client', c);
      return c;
    });
    await step('pause_menu', async () => {
      const btn = page.getByRole('button', { name: 'Pause / Menu' });
      await btn.click();
      await page.waitForTimeout(700);
      const opened = await route();
      expect(opened === 'settings', 'Pause / Menu on Home did not open Settings', { route: opened });
      await btn.click();
      await page.waitForTimeout(700);
      const closed = await route();
      expect(closed === 'home', 'Pause / Menu on Settings did not go back', { route: closed });
      return { opened, closed };
    });
    await step('settings_profile', async () => {
      await click(page.locator('.nav__item', { hasText: 'Settings' }));
      await page.waitForTimeout(700);
      const a = await route();
      await click(page.locator('.nav__item', { hasText: 'Profile' }));
      await page.waitForTimeout(700);
      const b = await route();
      expect(a === 'settings' && b === 'profile', 'Settings / Profile not reachable from the nav', { a, b });
      const c = await chromeOf(page);
      await click(page.locator('.nav__item', { hasText: 'Home' }));
      await page.waitForTimeout(500);
      return { settings: a, profile: b, nav: c.nav, wallet: c.wallet };
    });
  } catch { ok = false; }
  report.journeys.push({ mode: 'flow_dodge', ok, steps, consoleErrors: logs.splice(0).filter((l) => !/Failed to load resource/.test(l)).slice(0, 20) });

  // ── ready check in a hidden tab ─────────────────────────────────────────────────────────────────────────
  console.log('\nFLOW · READY CHECK (hidden tab)');
  let ok2 = true;
  const steps2 = [];
  const step2 = stepper(page, 'flow_ready', steps2);
  try {
    await step2('lockout_clear', async () => { await lockoutClear(); return { lockoutLeft: await vale(page, (v) => v.state.lockoutLeft.value) }; });
    await step2('queue_hidden', async () => {
      await toPlayRift();
      await page.evaluate(() => { window.__notes.shown.length = 0; window.__notes.closed = 0; });
      const cues0 = await vale(page, (v) => v.audioLog.length);
      await click(page.getByRole('button', { name: 'Find match' }));
      await hide(true);
      await waitFor(page, (v) => v.state.queue.value?.state === 'found', 30000);
      await page.waitForTimeout(400);
      const notes = await page.evaluate(() => window.__notes);
      const fav = await favicon();
      const cues = await vale(page, (v, i) => v.audioLog.slice(i).map((x) => x.id), cues0);
      expect(notes.shown.length === 1 && /match found/i.test(notes.shown[0].title), 'no notification on the hidden-tab queue pop', notes);
      expect(fav.state === 'lit' && fav.href.startsWith('data:image/png'), 'the favicon is not badged', fav);
      expect(notes.asked === 1, 'permission was asked again', notes);
      return { notification: notes.shown[0], favicon: fav, title: await page.title(), popCue: cues.includes('ui_queue_pop') };
    });
    await step2('remind', async () => {
      const cues0 = await vale(page, (v) => v.audioLog.length);
      await waitFor(page, (v) => v.state.queue.value?.state === 'found' && (v.state.queue.value.readyTimer ?? 99) <= 3.6, 12000);
      await page.waitForTimeout(300);
      const cues = await vale(page, (v, i) => v.audioLog.slice(i).map((x) => x.id), cues0);
      const notes = await page.evaluate(() => window.__notes);
      const left = await vale(page, (v) => v.state.queue.value?.readyTimer ?? null);
      expect(cues.includes('ui_queue_remind'), 'ui_queue_remind did not play with <= 4 s left', cues);
      expect(notes.shown.length === 2 && notes.shown[1].renotify, 'the notification was not raised again', notes);
      return { readyTimer: left, cues: cues.filter((c) => /queue/.test(c)), notifications: notes.shown.length, renotify: notes.shown[1].renotify };
    });
    await step2('decline_once', async () => {
      await hide(false);
      await page.waitForTimeout(250);
      const closedOnReturn = await page.evaluate(() => window.__notes.closed);
      await click(page.getByRole('button', { name: 'Decline' }));
      await page.waitForTimeout(1500);
      const c = await chromeOf(page);
      const notices = c.toasts.filter((t) => /declined/i.test(t)).length;
      const fav = await favicon();
      expect(closedOnReturn >= 1, 'the notification stayed up after returning to the page', { closedOnReturn });
      expect(notices === 1, 'Decline did not leave exactly one notice', c.toasts);
      expect(fav.state === 'plain', 'the favicon badge outlived the ready check', fav);
      expect(c.route === 'play' && fullClient(c), 'Play after Decline is not the full client', c);
      return { notices, toasts: c.toasts, favicon: fav, closedOnReturn, nav: c.nav, wallet: c.wallet };
    });
    await step2('lockout_after', async () => { await lockoutClear(); return { lockoutLeft: 0 }; });
  } catch { ok2 = false; }
  report.journeys.push({ mode: 'flow_readycheck', ok: ok2, steps: steps2, consoleErrors: logs.splice(0).filter((l) => !/Failed to load resource/.test(l)).slice(0, 20) });

  // ── the game server down ────────────────────────────────────────────────────────────────────────────────
  console.log('\nFLOW · SERVER DOWN');
  let ok3 = true;
  const steps3 = [];
  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // only the dev server's HMR socket is stood in for (other lanes' edits must not reload the page mid-sample);
  // the game-server socket goes out for real and finds nothing listening
  await ctx2.routeWebSocket((u) => u.port === new URL(BASE).port, () => {});
  const p2 = await ctx2.newPage();
  const step3 = stepper(p2, 'flow_netdown', steps3);
  const pill = () => p2.evaluate(() => ({ text: document.querySelector('.bar .netpill')?.textContent?.trim() ?? null, retry: !!document.querySelector('.bar .netpill__retry')?.offsetParent }));
  try {
    await step3('sample_24s', async () => {
      const t0 = Date.now();
      await p2.goto(`${BASE}/?dev=1&render=0&server=ws://127.0.0.1:9`, { waitUntil: 'domcontentloaded' });
      await p2.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
      const samples = [];
      while (Date.now() - t0 < 24000) { samples.push({ s: +((Date.now() - t0) / 1000).toFixed(1), ...(await pill()) }); await p2.waitForTimeout(500); }
      const late = samples.filter((x) => x.s >= 4);
      const connectingLate = late.filter((x) => /connecting/i.test(x.text ?? '')).length;
      const offlineLate = late.filter((x) => /offline/i.test(x.text ?? '')).length;
      const last = samples[samples.length - 1];
      expect(connectingLate === 0 && offlineLate === late.length && last.retry, 'the bar does not settle on Offline with Try again', { connectingLate, offlineLate, n: late.length, last });
      return { samples: samples.length, offlineFrom4s: `${offlineLate}/${late.length}`, connectingFrom4s: connectingLate, last };
    });
    await step3('try_again', async () => {
      await p2.locator('.bar .netpill__retry').click();
      await p2.waitForTimeout(150);
      const during = await pill();
      await p2.waitForTimeout(3000);
      const after = await pill();
      expect(/connecting/i.test(during.text ?? ''), 'Try again did not read Connecting…', during);
      expect(/offline/i.test(after.text ?? '') && after.retry, 'Try again did not fall back to Offline', after);
      return { during, after };
    });
  } catch { ok3 = false; }
  await ctx2.close().catch(() => {});
  report.journeys.push({ mode: 'flow_netdown', ok: ok3, steps: steps3 });
  await browser.close();
  return ok && ok2 && ok3;
}

let all = true;
if (FLOW) all = (await flowJourneys()) && all;
for (const m of MODES) all = (await journey(m)) && all;
if (MODES.length) all = (await store()) && all;
await session?.browser.close();
report.finished = new Date().toISOString();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n${all ? 'PASS' : 'FAIL'}  (${report.journeys.map((j) => `${j.mode}:${j.ok ? 'ok' : 'FAIL'}`).join(' ')})  report: ${OUT}`);
process.exit(all ? 0 : 1);
