// VALE harness — r12 B4 "do the HUD's slot components re-render every sim tick?" The real game (RIFT co-op, your
// seat on the dev autopilot at speed 1), 20 s into the match: preact's options.diffed counts every component render
// for 6 s, per component, next to the sim ticks in that window (per-tick re-renders would show ≥ the tick count).
// HUD-4: the sky strip's ledger line must be on screen and render at most once per change of its numbers (exit 1).
//   VALE_URL=http://localhost:<port> node _harness/hud_renders.mjs [--at <s>]   (dev server; prints JSON)
import { open, vale, waitFor } from './pw.mjs';
// hmr: false — edits other lanes make to the shared checkout mid-run must not reload the page under the measurement
const { browser, page } = await open('/?dev=1&autopilot=match&speed=1', { hmr: false });
const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 20000 }); await frames(); await l.click({ timeout: 20000 }); };
await page.waitForTimeout(2000);
await click(page.locator('.nav__item', { hasText: 'Play' })); await page.waitForTimeout(500);
await click(page.locator('.station', { hasText: 'RIFT' }).first()); await page.waitForTimeout(500);
await click(page.locator('.qcard', { hasText: 'Co-op vs bots' })); await page.waitForTimeout(300);
await click(page.getByRole('button', { name: 'Find match' }));
await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
const ready = page.getByRole('button', { name: /^Ready/ }); if (await ready.count()) await click(ready.first());
await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
await waitFor(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !s || !!m?.locked || (s.phase === 'pick' && !!s.turn?.players.includes(m?.player)); }, 90000);
const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(250); }
const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
if (await lock.count()) { await lock.click().catch(() => {}); }
await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 180000);
// --at <s>: measure later in the match (fast-forwarded at time scale 4, then back to 1) — e.g. --at 100 so Wicks fall in the window
const atI = process.argv.indexOf('--at'), AT = atI > 0 ? Number(process.argv[atI + 1]) || 20 : 20;
if (AT > 30) { await vale(page, (v) => v.state.match.value?.setTimeScale(4)); await waitFor(page, (v, at) => (v.state.match.value?.view.time ?? 0) > at - 3, 300000, AT); await vale(page, (v) => v.state.match.value?.setTimeScale(1)); }
await waitFor(page, (v, at) => (v.state.match.value?.view.time ?? 0) > at, 120000, AT);
await page.mouse.move(960, 500);
const r = await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /deps\/preact\.js/.test(n));
  const { options } = await import(url);
  const counts = {};
  const prev = options.diffed;
  options.diffed = (vn) => { if (typeof vn.type === 'function') { const k = vn.type.displayName || vn.type.name || '?'; counts[k] = (counts[k] ?? 0) + 1; } prev?.(vn); };
  const v = window.__vale, c = v.state.match.value;
  const t0 = c.view.tick, s0 = c.view.time, w0 = performance.now();
  // HUD-4: the sky strip's ledger line (T/F/A · Wicks) — how often its numbers changed in the window, sampled
  // every 50 ms (faster than the 30 Hz sim), against how often SkyLedger rendered
  const keyOf = () => { const p = c.view.players[c.you]; return p ? `${p.kills}/${p.deaths}/${p.assists}|${Math.floor(p.cs)}` : ''; };
  let lastKey = keyOf(), changes = 0;
  const poll = setInterval(() => { const k = keyOf(); if (k !== lastKey) { lastKey = k; changes++; } }, 50);
  await new Promise((res) => setTimeout(res, 6000));
  clearInterval(poll);
  options.diffed = prev;
  const el = document.querySelector('.hud .skyledger');
  const ledger = { renders: counts.SkyLedger ?? 0, changes, text: el?.textContent ?? null, box: el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null, font: el ? getComputedStyle(el).fontSize + ' ' + getComputedStyle(el).fontFamily.split(',')[0] : null };
  return { ticks: c.view.tick - t0, simSeconds: +(c.view.time - s0).toFixed(2), wallMs: Math.round(performance.now() - w0), ledger, counts: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40) };
});
console.log(JSON.stringify(r, null, 1));
// HUD-4 gate: the ledger line is on screen and renders only when its numbers change (never per tick)
if (!r.ledger.text || r.ledger.renders > r.ledger.changes + 1) { console.error(`HUD-4 ledger FAIL: ${JSON.stringify(r.ledger)}`); process.exitCode = 1; }
await browser.close();
