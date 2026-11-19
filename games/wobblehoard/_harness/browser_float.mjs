// Browser check of D-97 (R10_PLAYUX item 1; owner 2026-11-19 "float doesnt actually make them float" -> Float floats everyone everywhere).
// 1280x800 (mouse) and 390x844 (touch): with 1 and with 3 squishies out, at Home and at Hearthlog Cabin: the dock's Float pressed by REAL input, then 20 s of
// sim (dev hook steps): every body's centre rises off the ground (>= 0.2 m over its table rest, every second) and its screen disc stays inside the frame;
// the dock's Table pressed: every body rests on the ground again within 4 s; 0 console errors / warnings / page errors / failed requests.
// Usage: node _harness/browser_float.mjs [--port=5361] [--only=desk|phone]   (exits 1 on a failure; screenshots in _harness/_renders/float/)
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5361)), ONLY = arg('only', '');
const SHOTS = resolve(ROOT, '_harness/_renders/float');
mkdirSync(SHOTS, { recursive: true });
let bad = 0, total = 0;
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
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
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/React DevTools/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => errs.push('failed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const tapSel = async (sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {}); const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no ' + sel); await tapAt(b.x + b.width / 2, b.y + b.height / 2); };
    await tapSel('.cta');
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 60000 });
    await page.evaluate(() => { const wh = window.__WH__; wh.pause(); wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'high'); wh.setSetting('skipAnimations', true); });
    const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
    const bodies = () => page.evaluate(() => window.__WH__.shell.matInfo().bodies.map((b) => ({ id: b.itemId, y: b.w[1], sx: b.x, sy: b.y, r: b.r })));
    const vp = page.viewportSize();
    const offFrame = (bs) => bs.filter((b) => !(b.sx - b.r >= -2 && b.sx + b.r <= vp.width + 2 && b.sy - b.r >= -2 && b.sy + b.r <= vp.height + 2)).length;
    /** the dock's Table / Float by real input (on a narrow dock the pair may sit behind More) */
    const press = async (which) => {
      const sel = `.dock-grav-opt[data-grav="${which}"]`;
      const vis = await page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && !b.closest('[hidden]'); }, sel);
      if (!vis) {
        await tapSel('.dock-more'); await sleep(400);
        const it = `.dock-menuitem[data-grav="${which}"]`;
        await tapSel(it);
      } else await tapSel(sel);
      await sleep(200);
      return page.evaluate(() => window.__WH__.state().settings.gravity);
    };
    async function trial(label) {
      await page.evaluate(() => window.__WH__.pause());
      await step(3);
      const rest = await bodies();
      const g = await press('float');
      await page.evaluate(() => window.__WH__.pause());
      await step(3);
      let minRise = Infinity, off = 0;
      for (let k = 0; k < 20; k++) {
        await step(1);
        const bs = await bodies();
        off += offFrame(bs);
        for (const b of bs) { const r0 = rest.find((x) => x.id === b.id); if (r0) minRise = Math.min(minRise, b.y - r0.y); }
      }
      await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; });
      await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); });
      await page.screenshot({ path: resolve(SHOTS, `float_${label}_${frame}.png`), timeout: 240000, caret: 'hide' });
      await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = ''; });
      check(`${frame} ${label}: Float (real ${touch ? 'tap' : 'click'}) -> every body (${rest.length}) rises off the ground (>= 0.2 m every second of 20 s) and stays in frame`,
        g === false && rest.length >= 1 && minRise >= 0.2 && off === 0, JSON.stringify({ setting: g, n: rest.length, minRise: +minRise.toFixed(3), offFrameSamples: off, life: await page.evaluate(() => { const l = window.__WH__.life(); return { place: l.place, floatParked: l.floatParked, autonomy: l.autonomy }; }) }));
      const g2 = await press('table');
      await page.evaluate(() => window.__WH__.pause());
      let tRest = -1;
      for (let k = 1; k <= 16 && tRest < 0; k++) { await step(0.25); const bs = await bodies(); if (bs.every((b) => { const r0 = rest.find((x) => x.id === b.id); return r0 && Math.abs(b.y - r0.y) < 0.05; })) tRest = k * 0.25; }
      check(`${frame} ${label}: Table -> every body rests on the ground again within 4 s`, g2 === true && tRest > 0, `at rest after ${tRest} s`);
    }
    await trial('home1');
    let ok = await page.evaluate(() => window.__WH__.travel('hearthlog', true)); await step(3);
    check(`${frame}: travel to Hearthlog Cabin`, ok === true);
    await trial('cabin1');
    ok = await page.evaluate(() => window.__WH__.travel('home', true)); await step(3);
    // three out: capsules through the meter, then the Hoard's "Bring out" by real input
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    // (the capsules' newcomers may have come out beside Dollop, D-52: everyone back first by the HUD's Put back chip; then two friends by the Friends strip, real input)
    await page.evaluate(() => window.__WH__.resume());
    if ((await page.evaluate(() => window.__WH__.shell.matInfo().count)) > 1) { await tapSel('.mat-chip'); await sleep(600); }
    await tapSel('.pt-btn'); await sleep(500);
    for (let k = 0; k < 2; k++) { await tapSel('.pt-chip[aria-pressed="false"]:not([data-play])'); await sleep(500); }
    await tapSel('.pt-close'); await sleep(300);
    await page.evaluate(() => window.__WH__.pause());
    const n3 = await page.evaluate(() => window.__WH__.shell.matInfo().count);
    check(`${frame}: three squishies out at Home`, n3 === 3, `count ${n3}`);
    await trial('home3');
    ok = await page.evaluate(() => window.__WH__.travel('hearthlog', true)); await step(3);
    await trial('cabin3');
    check(`${frame}: 0 console errors / warnings / page errors / failed requests`, errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(`\n${total - bad}/${total} browser float checks passed`);
process.exit(bad ? 1 : 0);
