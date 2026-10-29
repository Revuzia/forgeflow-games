// VALE — the DONE journey end to end in real Chrome with real input (CONTRACT §13 "e2e").
//
//   node _harness/e2e.mjs [rift|bridge|fray|flow|store|practice|all] [--speed 16] [--headed] [--audio m4a] [--out <report.json>] [--prefix e2e]
//
// Per mode: Home → Play → pick the mode on the Mode Dial → a queue → Find match → Ready → draft /
// assignment / pick (real clicks) → loading → the match (your seat on the dev autopilot at time scale
// --speed, so it reaches a REAL win condition; a few real inputs are sent in-match first) → the end
// banner → post-game with grants (and, with a teammate, a Lantern nod that Session.nod records on the history entry) → its Scoreboard tab at 1920 and 1280 (client F4: every header's x-centre within 4 px of
// its cells, no header wraps, painted item icons) → Home. In the match the shop (P) is opened: its tag filters must use
// VALE's words (no jungle / gold / minion / turret / champion; originality F8). All modes share one profile.
// STORE (once, after the last mode; `store` runs it alone on a fresh profile): the wallet must have grown by exactly the
// sum of the post-game grants since the first Home (the starter wallet alone under `store`). Then the cheapest skin
// offer in the earned currency is bought and equipped, whatever the matches paid: when the wallet is short (the dev
// autopilot can lose every match: 300 + 117 + 92 + 89 = 598 < 600), the Shop's not-enough state is checked first (the
// CTA reads 'N more Candles needed', pressing it opens 'Not enough Candles' with the same N), then the shortfall is
// topped up through the dev handle (one ledger entry, reason 'migration', ref 'e2e:top_up', recorded in the report and
// checked against the ledger sum) and the skin is bought. Screenshots per step go to
// _harness/_shots/e2e_<mode>_<nn>_<step>.png; a JSON report to _harness/_reports/e2e.json.
// --audio m4a opens the game with ?audio=m4a (the CONTRACT §11 format fallback forced); match_live reports the
// audio files fetched per format either way. Needs the dev server (npm run dev) and a content build. Exit 0 =
// every journey passed; any console warning or error, page error or failed request fails its journey (perf PERF-m3).
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
//
// PRACTICE (`practice` only, not under `all`; gameplay g3, the lab): Play → Practice → a fighter chosen now, a Veteran
// sparring partner (real clicks on the setup screen) → the match on the queue's map: the partner is a bot of that
// fighter on the other team; the Practice tools panel turns Wicks and structures off, sets the training targets' armor,
// removes and places them, moves you to a clicked point, and its damage readout follows the sim's meter and clears.
// Then BRIDGE from the setup's Map choice: the match must load on BRIDGE's map (the bar reads BRIDGE · Practice); if the
// session cannot start it, the step fails and records whether the client recovered (an error notice and the setup
// screen again, never a loading bar that stops).

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
const MODES = which === 'all' ? ['rift', 'bridge', 'fray'] : which === 'flow' || which === 'store' || which === 'practice' ? [] : [which];
const PRACTICE = which === 'practice';
const FLOW = which === 'all' || which === 'flow';
const STORE = MODES.length > 0 || which === 'store';
/** the earned currency's bookkeeping the STORE journey checks: the wallet at the first Home, and every post-game's grant */
const purse = { start: null, granted: 0, matches: 0 };
/** the genre words VALE's own vocabulary replaces (Gleam, Dialwood, Wicks, Needles, fighters) */
const GENRE_WORDS = /\b(jungle|gold|minions?|turrets?|champions?)\b/i;
const QUEUE_CARD = { rift: 'Co-op vs bots', bridge: null, fray: null };

const report = { started: new Date().toISOString(), speed, journeys: [] };

async function controls(page) {
  return page.evaluate(() => [...document.querySelectorAll('button,[role=radio],[role=tab]')].filter((b) => b.offsetParent)
    .map((b) => `${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)}${b.getAttribute('aria-disabled') === 'true' || b.disabled ? ' [disabled]' : ''}`));
}

let session = null;
async function ensureSession() {
  if (session) return;
  // hmr: false — other lanes' edits to the shared checkout must not reload the page under a journey
  session = await open(`/?dev=1&autopilot=match&speed=${speed}${audioFmt ? `&audio=${audioFmt}` : ''}`, { hmr: false });
  session.audioFetches = { ogg: 0, m4a: 0 };
  session.page.on('request', (q) => { const m = /\.(ogg|m4a)$/.exec(new URL(q.url()).pathname); if (m) session.audioFetches[m[1]]++; });
}
/** the earned currency's balance (the dev handle) */
const earnedBalance = (page) => vale(page, (v) => { const c = v.cv.earnedCurrency(); return { id: c.id, name: c.name, bal: v.state.profile.value.wallet[c.id] ?? 0 }; });

async function journey(mode) {
  const steps = [];
  let n = 0;
  await ensureSession();
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
    await step('home', async () => {
      await page.waitForTimeout(800); await frames(); await page.waitForTimeout(1200);
      if (purse.start === null) purse.start = (await earnedBalance(page)).bal;
      return { route: await route(), purseStart: purse.start };
    });
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
      // originality F8: the shop's tag filters speak VALE (the jungle tag reads Dialwood)
      const shopTags = await page.locator('.hud .lshop__tag').allTextContents().then((t) => t.map((x) => x.trim()));
      const genre = shopTags.filter((t) => GENRE_WORDS.test(t));
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      if (genre.length) throw new Error(`shop tag filters use genre words: ${genre.join(', ')}`);
      await page.keyboard.down('Tab'); await page.waitForTimeout(250);
      const board = await page.locator('.hud .hscore').count();
      await page.keyboard.up('Tab');
      return { shopOpen: !!shopOpen, shopTags, scoreboard: !!board, hud: await page.locator('.hud .dbar').count() > 0 };
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
      const x = await vale(page, (v) => { const pg = v.state.postgame.value; const me = pg.result.players.find((x) => x.player === pg.you); return { reason: pg.result.reason, won: me.won, placement: me.placement, duration: Math.round(pg.result.duration), grants: pg.grants.currency, earned: pg.grants.currency[v.cv.earnedCurrency().id] ?? 0, xp: pg.grants.xp }; });
      purse.granted += x.earned; purse.matches++;
      // client F15: in a team mode the Lantern nod is offered; lighting one goes through Session.nod onto the match's
      // history entry (FRAY has no teammate, so no nod)
      const mate = page.locator('.scr--postgame:not(.is-leaving) .pgnod__mate').first();
      if (await mate.count()) {
        await click(mate);
        await page.locator('.scr--postgame:not(.is-leaving) .pgnod__done').waitFor({ state: 'visible', timeout: 5000 });
        x.nod = await vale(page, (v) => { const pg = v.state.postgame.value; const h = v.state.profile.value.history.find((e) => e.matchId === pg.result.matchId); return { recorded: h?.nod ?? null, text: document.querySelector('.scr--postgame:not(.is-leaving) .pgnod__done')?.textContent?.trim() ?? null }; });
        if (x.nod.recorded === null) throw new Error(`the Lantern nod was not recorded on the history entry: ${JSON.stringify(x.nod)}`);
      }
      return x;
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
  // perf PERF-m3: any console warning or error, page error or failed request fails the journey (pw.mjs records only
  // those, favicon requests excepted; Chrome's own 'Failed to load resource' echo of a failed request is its http line)
  const errors = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  const hard = errors;
  if (hard.length) { ok = false; console.log(`  ✗ ${hard.length} console warning(s) / error(s) / failed request(s): ${hard.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode, ok, steps, consoleErrors: errors.slice(0, 20) });
  return ok;
}

async function store() {
  const steps = [];
  let n = 0;
  await ensureSession();
  const { page, logs } = session;
  const mode = 'store';
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const info = await fn();
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}`);
      steps.push({ name, ok: true, ms: Date.now() - t0, info: info ?? null, shot: file });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${info ? ' ' + JSON.stringify(info) : ''}`);
      return info;
    } catch (e) {
      const file = await shot(page, `${PREFIX}_${mode}_${String(++n).padStart(2, '0')}_${name}_FAIL`).catch(() => null);
      steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400), controls: await controls(page).catch(() => []), shot: file });
      console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
      throw e;
    }
  };
  const route = () => vale(page, (v) => v.router.route.value.screen);
  const click = async (locator) => { await locator.waitFor({ state: 'visible', timeout: 15000 }); await locator.click(); };
  const fmt = (x) => x.toLocaleString('en-US');
  console.log('\nSTORE');
  let ok = true;
  try {
    // no match played (`store` alone): the wallet is the starter wallet, and nothing was granted
    if (purse.start === null) { await page.waitForTimeout(1500); purse.start = (await earnedBalance(page)).bal; }
    await step('shop', async () => {
      await click(page.locator('.nav__item', { hasText: 'Shop' }));
      await page.waitForTimeout(800);
      const cur = await earnedBalance(page);
      const grew = cur.bal - purse.start;
      // the wallet grew by exactly what the post-games granted (whatever the matches' outcomes)
      expect(grew === purse.granted, 'the wallet did not grow by the sum of the post-game grants', { start: purse.start, granted: purse.granted, wallet: cur.bal });
      return { route: await route(), currency: cur.id, start: purse.start, matches: purse.matches, granted: purse.granted, wallet: cur.bal };
    });
    // the cheapest skin offer in the earned currency, affordable or not
    const pick = await vale(page, (v) => {
      const cur = v.cv.earnedCurrency(); const bal = v.state.profile.value.wallet[cur.id] ?? 0;
      const owned = new Set(v.state.profile.value.owned.map((o) => o.ref));
      const o = v.cv.c.store.offers.filter((o) => o.kind === 'skin' && v.cv.skinOnSale(o.ref) && !owned.has(o.ref) && o.price.currency === cur.id).sort((a, b) => a.price.amount - b.price.amount)[0];
      return o ? { sku: o.sku, skin: v.cv.skin(o.ref).name, price: o.price.amount, bal, short: Math.max(0, o.price.amount - bal), cur: cur.name } : null;
    });
    expect(!!pick, 'no skin offer in the earned currency', pick);
    const card = page.locator(`.offer[aria-label^="${pick.skin},"]`).first();
    await step('select', async () => {
      await card.scrollIntoViewIfNeeded();
      await click(card);
      await waitFor(page, (v, s) => v.router.route.value.params?.sku === s, 5000, pick.sku);
      return pick;
    });
    let topUp = null;
    if (pick.short > 0) {
      // the Shop says what is missing, and pressing the CTA explains it (never a silent dead button)
      await step('not_enough', async () => {
        const need = new RegExp(`^${fmt(pick.short)} more ${pick.cur} needed`);
        const cta = page.locator('.scr__foot').getByRole('button', { name: need });
        await click(cta);
        const modal = page.locator('.modal').filter({ hasText: `Not enough ${pick.cur}` });
        await modal.waitFor({ state: 'visible', timeout: 5000 });
        const body = (await modal.textContent()) ?? '';
        expect(body.includes(`You need ${fmt(pick.short)} more ${pick.cur} for ${pick.skin}`), 'the not-enough dialog does not name the shortfall', { body: body.slice(0, 200) });
        await click(modal.locator('.confirm__actions').getByRole('button', { name: /^Close/ }));
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
        return { cta: `${fmt(pick.short)} more ${pick.cur} needed`, dialog: `You need ${fmt(pick.short)} more ${pick.cur}` };
      });
      // top up exactly the shortfall through the dev handle: the same ledger write economy.addLedger makes (LocalSession
      // internals, dev build only), so wallet === ledger sum still holds
      topUp = await step('top_up', async () => {
        const r = await vale(page, (v, amount) => {
          const s = v.session;
          if (!s.p || typeof s.ctx !== 'function' || typeof s.persist !== 'function') return { error: 'the dev session has no profile internals' };
          const id = v.cv.earnedCurrency().id; const p = s.p; const ctx = s.ctx();
          const bal = (p.wallet[id] ?? 0) + amount;
          p.ledger.push({ txn: ctx.newId('txn'), at: ctx.nowIso(), currency: id, delta: amount, balance: bal, reason: 'migration', ref: 'e2e:top_up' });
          p.wallet[id] = bal;
          s.persist();
          const prof = v.state.profile.value;
          return { amount, wallet: prof.wallet[id] ?? 0, ledgerSum: prof.ledger.filter((e) => e.currency === id).reduce((a, e) => a + e.delta, 0) };
        }, pick.short);
        expect(!r.error && r.wallet === pick.price && r.ledgerSum === r.wallet, 'the top-up did not land on the price with the ledger in step', r);
        await page.waitForTimeout(300);
        return r;
      });
    }
    await step('buy_skin', async () => {
      await click(page.locator('.scr__foot').getByRole('button', { name: /^Buy/ }));
      await page.waitForTimeout(300);
      const confirm = page.locator('.modal').getByRole('button', { name: /^Buy/ });
      if (await confirm.count()) await confirm.first().click();
      await waitFor(page, (v, s) => v.state.profile.value.owned.some((o) => o.sku === s), 10000, pick.sku);
      const after = await earnedBalance(page);
      expect(after.bal === pick.bal + (topUp?.amount ?? 0) - pick.price, 'the wallet did not drop by the price', { before: pick.bal, topUp: topUp?.amount ?? 0, price: pick.price, after: after.bal });
      return { sku: pick.sku, skin: pick.skin, price: pick.price, toppedUp: topUp?.amount ?? 0, wallet: after.bal };
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
  const hardErrs = errs;
  if (hardErrs.length) { ok = false; console.log(`  ✗ ${hardErrs.length} console warning(s) / error(s) / failed request(s): ${hardErrs.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode, ok, steps, purse: { ...purse }, consoleErrors: errs.slice(0, 20) });
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
  const errDodge = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  if (errDodge.length) { ok = false; console.log(`  ✗ ${errDodge.length} console warning(s) / error(s) / failed request(s): ${errDodge.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode: 'flow_dodge', ok, steps, consoleErrors: errDodge.slice(0, 20) });

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
  const errReady = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  if (errReady.length) { ok2 = false; console.log(`  ✗ ${errReady.length} console warning(s) / error(s) / failed request(s): ${errReady.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode: 'flow_readycheck', ok: ok2, steps: steps2, consoleErrors: errReady.slice(0, 20) });

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

// ── PRACTICE: the lab (gameplay g3) ─────────────────────────────────────────────────────────────────────────
async function practiceJourney() {
  const s = await open('/?dev=1', { hmr: false });
  const { browser, page, logs } = s;
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (locator) => { await locator.waitFor({ state: 'visible', timeout: 15000 }); await frames(); await locator.click({ timeout: 15000 }); };
  const SCR = '.scr--practice:not(.is-leaving)';
  const barText = () => page.evaluate(() => document.querySelector('.bar .bar__flow')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toasts .toast__text')].map((e) => e.textContent.trim()));
  const toPractice = async () => {
    await page.waitForTimeout(800); await frames();
    await click(page.locator('.nav__item', { hasText: 'Play' }));
    await page.waitForTimeout(500);
    await click(page.locator('.play__links button', { hasText: 'Practice' }));
    await waitFor(page, (v) => v.router.route.value.screen === 'practice', 10000);
    await page.waitForTimeout(700);
  };
  /** the first fighter card on the setup screen: the fighter chosen now (no solo pick) */
  const presetFighter = async () => {
    await click(page.locator(`${SCR} .fcard`).first());
    await page.waitForTimeout(250);
  };
  /** open a Select by its label and press the option `pick` chooses among the option texts */
  const choose = async (label, pick) => {
    await click(page.locator(`${SCR} .select__btn[aria-label^="${label}"]`).first());
    const opts = page.locator(`${SCR} .select.is-open [role=option]`);
    await opts.first().waitFor({ state: 'visible', timeout: 5000 });
    const texts = (await opts.allTextContents()).map((t) => t.trim());
    const i = pick(texts);
    await opts.nth(i).click();
    await page.waitForTimeout(250);
    return texts[i];
  };
  /** Start practice, then wait for the match (or for the session to give up and the client to say so) */
  const start = async (ms) => {
    await click(page.getByRole('button', { name: 'Start practice' }));
    let bar = null;
    const t0 = Date.now();
    for (;;) {
      const st = await vale(page, (v) => ({ screen: v.router.route.value.screen, loading: !!v.state.loading.value, phase: v.state.match.value?.view.phase ?? null, err: v.state.lastError.value }));
      if (st.screen === 'loading' && !bar) bar = await barText();
      if (st.phase === 'live' || st.phase === 'pregame') return { ...st, bar, ms: Date.now() - t0 };
      if (st.err && /^match/.test(st.err) && st.screen !== 'loading') return { ...st, bar, ms: Date.now() - t0, toasts: await toasts() };
      if (Date.now() - t0 > ms) return { ...st, bar, ms: Date.now() - t0, hung: true };
      await page.waitForTimeout(250);
    }
  };
  const lab = () => vale(page, (v) => {
    const c = v.state.match.value, x = c?.view.practice;
    const dummy = v.cv.c.units.find((u) => u.behavior?.dummy)?.id;
    const me = c?.view.entity(c.view.players[c.you]?.entity);
    return {
      waves: x?.waves, structures: x?.structures, dummy: x?.dummy,
      dummies: (c?.view.entities ?? []).filter((e) => e.def === dummy && e.hp > 0 && e.state !== 'dead').map((e) => ({ id: e.id, x: e.x, y: e.y })),
      me: me ? { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, state: me.state } : null,
      meter: x?.meters.find((m) => m.player === c.you) ?? null,
    };
  });
  let ok = true;
  console.log('\nPRACTICE · RIFT (sparring partner)');
  const steps = [];
  const step = stepper(page, 'practice', steps);
  let spar = null;
  try {
    await step('setup', async () => {
      await toPractice();
      const maps = (await page.locator(`${SCR} .seg__opt`).allTextContents()).map((t) => t.trim());
      await presetFighter();
      spar = await choose('Sparring partner', (t) => t.findIndex((x, i) => i > 0));
      const diff = await choose('Bot difficulty', (t) => t.findIndex((x) => /veteran/i.test(x)));
      expect(maps.length >= 2 && maps.some((m) => /bridge/i.test(m)), 'the Map choice does not offer BRIDGE', maps);
      return { maps, spar, diff };
    });
    await step('loading_rift', async () => {
      const r = await start(150000);
      expect(r.phase === 'live' || r.phase === 'pregame', 'the practice match did not start', r);
      expect(/rift/i.test(r.bar ?? ''), 'the bar did not name RIFT while loading', r);
      return r;
    });
    await step('sparring', async () => {
      await page.waitForTimeout(1500);
      const x = await vale(page, (v) => {
        const c = v.state.match.value, set = c.setup;
        const mine = set.seats.find((q) => q.player === c.you), other = set.seats.find((q) => q.player !== c.you);
        const pe = other ? c.view.entity(c.view.players[other.player]?.entity) : undefined;
        return { seats: set.seats.length, mode: set.mode, mine: mine?.team, other: other ? { team: other.team, controller: other.controller, fighter: other.fighter, name: v.cv.fighter(other.fighter)?.name, difficulty: other.botDifficulty } : null,
          entity: pe ? { def: pe.def, team: pe.team, hp: Math.round(pe.hp), state: pe.state } : null, panel: !!document.querySelector('.hud .ptools') };
      });
      expect(x.seats === 2 && x.other && x.other.team !== x.mine && x.other.controller === 'bot' && x.other.name === spar && x.other.difficulty === 'veteran', 'the sparring partner is not a Veteran bot of the chosen fighter on the other team', x);
      expect(x.entity && x.entity.hp > 0, 'the sparring partner has no fighter on the map', x);
      expect(x.panel, 'no Practice tools panel', x);
      return x;
    });
    await step('tools', async () => {
      const P = '.hud .ptools';
      const before = await lab();
      await click(page.locator(`${P} .ptools__tog`, { hasText: 'Wicks' }));
      await waitFor(page, (v) => v.state.match.value.view.practice?.waves === false, 5000);
      await click(page.locator(`${P} .ptools__tog`, { hasText: 'Structures' }));
      await waitFor(page, (v) => v.state.match.value.view.practice?.structures === false, 5000);
      const armor = page.locator(`${P} .ptools__field`, { hasText: 'Armor' }).locator('input');
      await armor.fill('120'); await armor.press('Enter');
      await waitFor(page, (v) => v.state.match.value.view.practice?.dummy.armor === 120, 5000);
      await click(page.locator(`${P} button`, { hasText: 'Remove all targets' }));
      await page.waitForTimeout(600);
      const cleared = (await lab()).dummies.length;
      await click(page.locator(`${P} button`, { hasText: 'Place a training target' }));
      await page.waitForTimeout(600);
      const after = await lab();
      const pressed = await page.locator(`${P} .ptools__tog`).evaluateAll((b) => b.map((e) => `${e.textContent.trim()}:${e.getAttribute('aria-pressed')}`));
      expect(cleared === 0 && after.dummies.length === 1, 'Remove all targets / Place a training target did not change the targets', { before: before.dummies.length, cleared, after: after.dummies.length });
      expect(pressed.some((p) => p === 'Wicks:false') && pressed.some((p) => p === 'Structures:false'), 'the toggles do not show the sim state', pressed);
      return { before: { waves: before.waves, structures: before.structures, dummy: before.dummy, targets: before.dummies.length }, after: { waves: after.waves, structures: after.structures, dummy: after.dummy, targets: after.dummies.length }, cleared, pressed };
    });
    await step('teleport', async () => {
      const p0 = (await lab()).me;
      let p1 = p0, armed = false, tries = 0;
      for (const [dx, dy] of [[180, 90], [-180, 90], [160, -110], [-160, -110]]) {
        tries++;
        // arm only when not already aiming (a missed click leaves the button reading 'Click the ground…'; pressing it
        // again would disarm), then wait for the aiming class before clicking the ground (the run-2 race)
        const aiming = () => page.evaluate(() => document.body.classList.contains('ptools-aiming'));
        if (!(await aiming())) await click(page.locator('.hud .ptools button', { hasText: /Move to a point|Click the ground/ }));
        armed = await page.waitForFunction(() => document.body.classList.contains('ptools-aiming'), null, { timeout: 3000 }).then(() => true, () => false);
        await page.mouse.click(960 + dx, 540 + dy);
        await page.waitForTimeout(700);
        p1 = (await lab()).me;
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 2) break;
      }
      const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const disarmed = !(await page.evaluate(() => document.body.classList.contains('ptools-aiming')));
      expect(armed && disarmed && moved > 2, 'Move to a point did not move the fighter', { p0, p1, armed, disarmed, tries });
      return { p0, p1, moved: Math.round(moved * 10) / 10, armed, disarmed, tries };
    });
    await step('meter', async () => {
      // the readout follows the sim's meter: stand by the target and attack it (the dev handle sends the commands)
      const t = (await lab()).dummies[0];
      await vale(page, (v, t) => { const c = v.state.match.value; c.send({ type: 'practice', action: 'teleport', x: t.x + 2.5, y: t.y }); }, t);
      await page.waitForTimeout(300);
      await vale(page, (v, t) => { v.state.match.value.send({ type: 'attack', target: t.id }); }, t);
      await waitFor(page, (v) => (v.state.match.value.view.practice?.meters.find((m) => m.player === v.state.match.value.you)?.dealt ?? 0) > 0, 30000);
      await page.waitForTimeout(1200);
      const m = (await lab()).meter;
      const cells = await page.locator('.hud .ptools__stat').evaluateAll((d) => d.map((e) => `${e.querySelector('dt').textContent.trim()}=${e.querySelector('dd').textContent.trim()}`));
      const total = cells.find((c) => c.startsWith('Total='));
      await page.mouse.click(1700, 200, { button: 'right' }).catch(() => {});   // stop attacking: a move order elsewhere
      await click(page.locator('.hud .ptools__dmghead button', { hasText: 'Clear' }));
      await page.waitForTimeout(400);
      const afterClear = (await lab()).meter;
      expect(m && m.dealt > 0 && total && total !== 'Total=—', 'the readout did not show the meter', { m, cells });
      expect(afterClear && afterClear.dealt === 0, 'Clear did not zero the meter', afterClear);
      return { meter: { dealt: Math.round(m.dealt), last: Math.round(m.last), burst: Math.round(m.burst), burstDps: Math.round(m.burstDps), recent5: Math.round(m.recent5) }, cells, afterClear: afterClear.dealt };
    });
  } catch { ok = false; }
  let errors = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  if (errors.length) { ok = false; console.log(`  ✗ ${errors.length} console warning(s) / error(s) / failed request(s): ${errors.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode: 'practice_rift', ok, steps, consoleErrors: errors.slice(0, 20) });

  // ── BRIDGE from the Map choice ──────────────────────────────────────────────────────────────────────────
  console.log('\nPRACTICE · BRIDGE (Map choice)');
  const steps2 = [];
  const step2 = stepper(page, 'practice_bridge', steps2);
  let ok2 = true;
  try {
    await page.goto(BASE + '/?dev=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
    await step2('setup', async () => {
      await toPractice();
      await click(page.locator(`${SCR} .seg__opt`, { hasText: /bridge/i }).first());
      await page.waitForTimeout(400);
      await presetFighter();
      return { kicker: await page.locator(`${SCR} .t-label, ${SCR} [class*=kicker]`).first().textContent().catch(() => null) };
    });
    await step2('loading_bridge', async () => {
      const r = await start(120000);
      const want = await vale(page, (v) => v.cv.mode('bridge')?.map ?? null);
      const set = await vale(page, (v) => { const c = v.state.match.value; return c ? { mode: c.setup.mode, map: c.setup.map } : null; });
      if (!(r.phase === 'live' || r.phase === 'pregame')) {
        // the session could not start it: record whether the client recovered (notice, setup screen) or hung
        throw new Error(`BRIDGE practice did not start (${r.hung ? 'still loading' : `recovered: screen ${r.screen}, notice ${JSON.stringify(r.toasts ?? [])}`}; session: ${r.err ?? 'no error'}; bar while loading: ${r.bar})`);
      }
      expect(set && set.mode === 'bridge' && set.map === want, 'the practice match is not on BRIDGE\'s map', { set, want });
      expect(/bridge/i.test(r.bar ?? ''), 'the bar did not name BRIDGE while loading', r);
      await page.waitForTimeout(1500);
      return { ...r, setup: set, panel: await page.locator('.hud .ptools').count() > 0 };
    });
  } catch { ok2 = false; }
  errors = logs.splice(0).filter((l) => !/Failed to load resource/.test(l));
  if (errors.length) { ok2 = false; console.log(`  ✗ ${errors.length} console warning(s) / error(s) / failed request(s): ${errors.slice(0, 3).join(' · ')}`); }
  report.journeys.push({ mode: 'practice_bridge', ok: ok2, steps: steps2, consoleErrors: errors.slice(0, 20) });
  await browser.close();
  return ok && ok2;
}

let all = true;
if (PRACTICE) all = (await practiceJourney()) && all;
if (FLOW) all = (await flowJourneys()) && all;
for (const m of MODES) all = (await journey(m)) && all;
if (STORE) all = (await store()) && all;
await session?.browser.close();
report.finished = new Date().toISOString();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n${all ? 'PASS' : 'FAIL'}  (${report.journeys.map((j) => `${j.mode}:${j.ok ? 'ok' : 'FAIL'}`).join(' ')})  report: ${OUT}`);
process.exit(all ? 0 : 1);
