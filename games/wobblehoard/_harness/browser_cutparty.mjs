// Browser check of D-98 (rotate with the right button while cutting) and D-99 (cut any squishy of a party): R10_PLAYUX items 3 and 4. REAL input only for the player's path.
//   D-98, 1280x800: the Cut tool picked by a click on the dock; a RIGHT-button drag turns the camera (yaw changes) and cuts nothing; then a LEFT drag across the squishy
//        cuts it (2 pieces); Reconnect all by its bar button.
//   D-99, 1280x800 (mouse) and 390x844 (touch): three out (the Friends strip's Bring friends); with the Cut tool a stroke across a squishy that is not the play one cuts
//        THAT one (the name tag follows, 2 pieces) and the other two stay whole; a stroke across another whole squishy while one is cut cuts nothing and says why;
//        Reconnect all puts it back together; screenshots in _harness/_renders/cutparty/; 0 console errors.
// Usage: node _harness/browser_cutparty.mjs [--port=5363] [--only=desk|phone]   (exits 1 on a failure)
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5363)), ONLY = arg('only', '');
const SHOTS = resolve(ROOT, '_harness/_renders/cutparty');
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
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const errs = [];
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/React DevTools/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => errs.push('failed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility !== 'hidden' ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
    const tapSel = async (sel) => { const b = await box(sel); if (!b) throw new Error('not shown: ' + sel); if (touch) await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2); else await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2); await sleep(500); };
    const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
    const shot = async (n) => { await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; }); await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); }); await page.screenshot({ path: resolve(SHOTS, `${n}_${frame}.png`), timeout: 240000, caret: 'hide' }); };
    /** a one-finger drag by CDP touch events (Playwright has no touch drag) or a left mouse drag */
    const drag = async (x0, y0, x1, y1, steps = 12) => {
      if (!touch) { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await page.mouse.up(); return; }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
      for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tapSel('.cta');
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 60000 });
    await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'high'); wh.setSetting('skipAnimations', true); wh.pause(); });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    await page.evaluate(() => window.__WH__.resume());
    if ((await page.evaluate(() => window.__WH__.shell.matInfo().count)) > 1) await tapSel('.mat-chip');
    await sleep(800);
    if (!touch) {
      // ---- D-98: right drag while cutting turns the view; left drag still cuts ----
      await tapSel('.dock-tool[data-tool="cut"]');
      const camOf = () => page.evaluate(() => { const k = window.__WH__.shell.tools(); if (!k.cam) return null; const dx = k.cam.x - k.body.x, dz = k.cam.z - k.body.z; return { yaw: Math.atan2(dx, dz), pieces: k.pieces, tool: k.tool }; });
      const c0 = await camOf();
      await page.mouse.move(200, 300); await page.mouse.down({ button: 'right' });
      for (let i = 1; i <= 12; i++) { await page.mouse.move(200 + i * 25, 300); await sleep(30); }
      await page.mouse.up({ button: 'right' });
      await sleep(800);
      const c1 = await camOf();
      check('D-98 desk: with the Cut tool in hand a RIGHT-button drag turns the view (camera yaw changes) and cuts nothing', c0.tool === 'cut' && Math.abs(c1.yaw - c0.yaw) > 0.05 && c1.pieces === 1, JSON.stringify({ c0, c1 }));
      const b = await page.evaluate(() => window.__WH__.bodyScreen());
      const vw = 1280, vh = 800;
      await drag(b.x * vw - 20, b.y * vh - 160, b.x * vw + 20, b.y * vh + 160, 16);
      await page.evaluate(() => window.__WH__.pause()); await step(1.5); await page.evaluate(() => window.__WH__.resume());
      const c2 = await camOf();
      check('D-98 desk: a LEFT drag across the squishy with the Cut tool still cuts it (2 pieces)', c2.pieces === 2, JSON.stringify(c2));
      await tapSel('[data-key="join"]'); await page.evaluate(() => window.__WH__.pause()); await step(2); await page.evaluate(() => window.__WH__.resume());
      await tapSel('.dock-tool[data-tool="hand"]');
    }
    // ---- D-99: three out (the Friends strip's Bring friends), cut one that is not the play squishy ----
    await page.evaluate(() => window.__WH__.setSetting('quality', 'low'));   // (the cap 3: Bring friends fills to three)
    await sleep(600);
    await tapSel('.pt-btn'); await tapSel('.pt-bring');
    await sleep(600);
    const n = await page.evaluate(() => window.__WH__.shell.matInfo().count);
    await tapSel('.dock-tool[data-tool="cut"]');
    await page.evaluate(() => window.__WH__.pause()); await step(2); await page.evaluate(() => window.__WH__.resume()); await sleep(500);
    const info = await page.evaluate(() => ({ id: window.__WH__.shell.identity().itemId, bodies: window.__WH__.shell.matInfo().bodies.map((b) => ({ id: b.itemId, x: b.x, y: b.y, r: b.r })) }));
    const target = info.bodies.filter((b) => b.id !== info.id && b.r > 0).sort((a, c) => Math.abs(c.x - info.bodies[0].x) - Math.abs(a.x - info.bodies[0].x))[0];
    await shot('cutparty_before');
    await drag(target.x + 6, target.y - target.r * 1.6, target.x - 6, target.y + target.r * 1.6, 16);
    await page.evaluate(() => window.__WH__.pause()); await step(1.5); await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    const after = await page.evaluate(() => ({ id: window.__WH__.shell.identity().itemId, pieces: window.__WH__.shell.tools().pieces, out: window.__WH__.shell.matInfo().count, tag: document.querySelector('.nametag-name')?.textContent ?? '' }));
    await shot('cutparty_cut');
    check(`D-99 ${frame}: with ${n} out, a ${touch ? 'finger' : 'mouse'} stroke across a squishy that is not the play one cuts THAT one (it is the play squishy now, 2 pieces; the others stay out whole)`,
      n === 3 && after.id === target.id && after.pieces === 2 && after.out === 3, JSON.stringify({ n, target: target.id, after }));
    // another whole squishy while one is cut: refused in words
    const other = await page.evaluate(([cut]) => window.__WH__.shell.matInfo().bodies.find((b) => b.itemId !== cut && b.r > 0 && b.itemId), [after.id]);
    const live0 = await page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
    if (other) await drag(other.x + 6, other.y - other.r * 1.6, other.x - 6, other.y + other.r * 1.6, 16);
    await sleep(800);
    const said = await page.evaluate(() => [document.getElementById('wh-live')?.textContent ?? '', ...[...document.querySelectorAll('.toast, .k-toast, .opts-note, .cut-note')].map((e) => e.textContent ?? '')].join(' | '));
    check(`D-99 ${frame}: while it is cut, a stroke across another whole squishy cuts nothing and says why ("One squishy at a time ...")`,
      !!other && (await page.evaluate(() => window.__WH__.shell.tools().pieces)) === 2 && /One squishy at a time/.test(said), JSON.stringify({ said: said.slice(0, 200), live0: live0.slice(0, 80) }));
    await tapSel('[data-key="join"]');
    await page.evaluate(() => window.__WH__.pause()); await step(3); await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    const whole = await page.evaluate(() => ({ pieces: window.__WH__.shell.tools().pieces, out: window.__WH__.shell.matInfo().count }));
    await shot('cutparty_whole');
    check(`D-99 ${frame}: Reconnect all puts it back together (1 piece) and all ${n} stay out`, whole.pieces === 1 && whole.out === n, JSON.stringify(whole));
    check(`${frame}: 0 console errors / warnings / page errors / failed requests`, errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(`\n${total - bad}/${total} browser cut-party checks passed`);
process.exit(bad ? 1 : 0);
