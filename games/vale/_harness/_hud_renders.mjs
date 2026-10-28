// scratch (B4 lane): do HUD components re-render per sim tick? Real game, RIFT co-op, autopilot at speed 1;
// counts preact component renders (options.diffed) over a window of live play, per component.
import { open, vale, waitFor } from './pw.mjs';
const { browser, page } = await open('/?dev=1&autopilot=match&speed=1');
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
await waitFor(page, (v) => (v.state.match.value?.view.time ?? 0) > 20, 120000);
await page.mouse.move(960, 500);
const r = await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /deps\/preact\.js/.test(n));
  const { options } = await import(url);
  const counts = {};
  const prev = options.diffed;
  options.diffed = (vn) => { if (typeof vn.type === 'function') { const k = vn.type.displayName || vn.type.name || '?'; counts[k] = (counts[k] ?? 0) + 1; } prev?.(vn); };
  const v = window.__vale, c = v.state.match.value;
  const t0 = c.view.tick, s0 = c.view.time, w0 = performance.now();
  await new Promise((res) => setTimeout(res, 6000));
  options.diffed = prev;
  return { ticks: c.view.tick - t0, simSeconds: +(c.view.time - s0).toFixed(2), wallMs: Math.round(performance.now() - w0), counts: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
