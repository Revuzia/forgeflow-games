// Round 14 (R14_ROOMS, D-104) DEV TOOL: Home's first-play framing with ONE squishy out, measured the same way on any tree (this one, or the LIVE source
// extracted beside it: copy this file into that tree's _harness and run it there). Prints the squishy's screen disc on 1280 x 800 and 390 x 844 and saves a picture.
// Usage: WH_FROZEN=1 node _harness/rooms_one.mjs [--port=5366] [--out=/abs/dir] [--tag=now]
import { launch, startVite } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5366)), OUT = arg('out', '.'), TAG = arg('tag', 'now');
mkdirSync(OUT, { recursive: true });
const srv = await startVite(PORT);
const browser = await launch();
try {
  for (const [frame, ctxOpt] of [['desk', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }]]) {
    const ctx = await browser.newContext(ctxOpt);
    const page = await ctx.newPage();
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    const b = await page.evaluate(() => { const r = document.querySelector('.cta').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (frame === 'phone') await page.touchscreen.tap(b.x, b.y); else await page.mouse.click(b.x, b.y);
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 90000 });
    await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'high'); wh.pause(); });
    for (let k = 0; k < 16; k++) await page.evaluate(() => { window.__WH__.step(1 / 60, 30); });
    const d = await page.evaluate(() => { const m = window.__WH__.shell.matInfo().bodies[0]; return { x: +m.x.toFixed(1), y: +m.y.toFixed(1), r: +m.r.toFixed(1) }; });
    console.log(`${TAG} ${frame}: one out at Home: disc ${JSON.stringify(d)}`);
    await page.evaluate(() => { const e = document.querySelector('.dev'); if (e) e.style.visibility = 'hidden'; });
    await page.screenshot({ path: resolve(OUT, `one_${TAG}_${frame}.png`), timeout: 180000 });
    await ctx.close();
  }
} finally { await browser.close(); srv.stop(); }
