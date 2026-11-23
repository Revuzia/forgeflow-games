// Round 14 (R14_ROOMS, D-104) DEV TOOL: quick pictures of every place with three out: the default view (the room camera by itself) and the whole-room view.
// Not a check (browser_rooms.mjs is): it travels by the dev hook and zooms by the stage's own zoom(), to look at layouts and sets while they are built.
// Usage: WH_FROZEN=1 node _harness/rooms_shots.mjs [--port=5364] [--places=home,hearthlog] [--only=desk|phone] [--tag=a]   -> _harness/_renders/rooms/<tag>_<frame>_<place>_<view>.png
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5364)), PLACES = arg('places', 'home,hearthlog,ripple,frostbell,rainleaf,lanternroof,cloudloft').split(','), ONLY = arg('only', ''), TAG = arg('tag', 'a');
const SHOTS = resolve(ROOT, '_harness/_renders/rooms');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAMES = [
  ['desk', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }],
].filter(([n]) => !ONLY || n === ONLY);
const srv = await startVite(PORT);
const browser = await launch();
try {
  for (const [frame, ctxOpt] of FRAMES) {
    const touch = frame === 'phone';
    const ctx = await browser.newContext(ctxOpt);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const clickSel = async (sel) => { const b = await page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel); if (!b) return false; await tapAt(b.x, b.y); await sleep(500); return true; };
    await clickSel('.cta');
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 60000 });
    const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
    const shot = async (n) => { await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; }); await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); }); await page.screenshot({ path: resolve(SHOTS, `${TAG}_${frame}_${n}.png`), timeout: 180000 }); };
    await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'high'); wh.setSetting('skipAnimations', true); wh.pause(); });
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    const count = () => page.evaluate(() => window.__WH__.shell.matInfo().count);
    await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    if ((await count()) > 1) { await clickSel('.mat-chip'); await sleep(600); }
    if (await clickSel('.pt-btn')) { for (let k = 0; k < 2; k++) await clickSel('.pt-chip[aria-pressed="false"]:not([data-play])'); await clickSel('.pt-close'); }
    await page.evaluate(() => window.__WH__.pause()); await step(1);
    console.log(`${frame}: ${await count()} out`);
    for (const place of PLACES) {
      const ok = await page.evaluate((p) => window.__WH__.travel(p, true), place);
      await step(4);
      await page.evaluate(() => window.__WH__.resume()); await sleep(300); await page.evaluate(() => window.__WH__.pause());
      const view = () => page.evaluate(() => { const st = window.__WH__.shell.stageObj(), o = new Float32Array(6); const on = st.roomView ? st.roomView(o) : false; return on ? Array.from(o).map((v) => +v.toFixed(3)) : null; });
      console.log(`${frame} ${place}: travel ${ok}; view ${JSON.stringify(await view())}; bodies ${JSON.stringify((await page.evaluate(() => window.__WH__.shell.matInfo().bodies.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]))))}`);
      await shot(`${place}_default`);
      await page.evaluate(() => { const st = window.__WH__.shell.stageObj(); for (let k = 0; k < 12; k++) st.zoom(3); });
      await step(2.5);
      console.log(`${frame} ${place}: whole room view ${JSON.stringify(await view())}; bodies ${JSON.stringify((await page.evaluate(() => window.__WH__.shell.matInfo().bodies.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]))))}`);
      await shot(`${place}_room`);
      await page.evaluate(() => { const st = window.__WH__.shell.stageObj(); for (let k = 0; k < 24; k++) st.zoom(-3); });
      await step(0.2);
      if (process.argv.includes('--chipdebug')) {
        await step(2.5); await page.evaluate(() => { window.__WH__.shell.stageObj().pan(1400, 0); }); await step(1.5); await page.evaluate(() => window.__WH__.resume()); await sleep(1200); await page.evaluate(() => window.__WH__.pause()); await sleep(400);
        console.log(`${frame} ${place} chips:`, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.rm-chip')].filter((c) => !c.hidden).map((c) => { const r = c.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, cs = getComputedStyle(c), ls = getComputedStyle(c.parentElement);
          return { label: c.getAttribute('aria-label'), x: Math.round(x), y: Math.round(y), pe: cs.pointerEvents, vis: cs.visibility, layerPe: ls.pointerEvents, layerVis: ls.visibility, inert: !!c.closest('[inert]'), parent: c.parentElement.parentElement?.id || c.parentElement.parentElement?.className, at: document.elementsFromPoint(x, y).slice(0, 4).map((e) => `${e.tagName}.${typeof e.className === 'string' ? e.className : ''}#${e.id}`) }; }))));
        await shot(`${place}_close`);
      }
    }
    if (errs.length) console.log(`${frame} errors:`, errs.slice(0, 6).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
