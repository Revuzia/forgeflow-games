// Browser check of D-98 (rotate with the right button while cutting; R10_PLAYUX item 3) and D-103 (cut SEVERAL squishies of a party at the same time; R14_MULTICUT, which re-specified
// D-99's rows here on 2026-11-23: the reason is written at the rows). REAL input only for the player's path.
//   D-98, 1280x800: the Cut tool picked by a click on the dock; a RIGHT-button drag turns the camera (yaw changes) and cuts nothing; then a LEFT drag across the squishy
//        cuts it (2 pieces); Reconnect all by its bar button.
//   D-103, 1280x800 (mouse) and 390x844 (touch): three out (the Friends strip's Bring friends) at the LOW tier; with the Cut tool a stroke across a squishy that is not the
//        play one cuts THAT one (the play squishy stays who it was); a stroke across the play squishy cuts it TOO (nothing refused; the bar counts both and shows a chip each);
//        a tap on a chip reconnects only that one; one straight stroke cuts every squishy it crosses; Split in two up to the party's budget, one more stroke SHOWS the budget
//        line; Reconnect all; the physics cost with every piece awake is printed; screenshots in _harness/_renders/cutparty/multicut_*; 0 console errors.
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
    // ---- D-103 (owner 2026-11-23: "allow ability to cut multiple squishies at the same time"): three out (the Friends strip's Bring friends) ----
    // RE-SPECIFIED from D-99's rows (2026-11-23). D-99's two rows asserted what the owner asked to remove: "the crossed squishy becomes the play squishy" (it existed because the cutter had
    // one tree of pieces) and "a stroke across another whole squishy while one is cut cuts nothing and says One squishy at a time". They are replaced by the rows below.
    await page.evaluate(() => window.__WH__.setSetting('quality', 'low'));   // (the low tier: the cap is 3, Bring friends fills to three; the frame cost below is the low tier's)
    await sleep(600);
    await tapSel('.pt-btn'); await tapSel('.pt-bring');
    await sleep(600);
    const n = await page.evaluate(() => window.__WH__.shell.matInfo().count);
    await tapSel('.dock-tool[data-tool="cut"]');
    const settle = async (sec) => { await page.evaluate(() => window.__WH__.pause()); await step(sec); await page.evaluate(() => window.__WH__.resume()); await sleep(500); };
    await settle(2);
    const sets = () => page.evaluate(() => window.__WH__.shell.cutSets());
    const tagOf = () => page.evaluate(() => document.querySelector('.nametag-name')?.textContent ?? '');
    const shownText = () => page.evaluate(() => [...document.querySelectorAll('.toast, .k-toast, [class*="toast"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0.2; }).map((e) => e.textContent ?? '').join(' | '));
    const liveText = () => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
    const across = async (b) => { await drag(b.x + 6, b.y - b.r * 1.6, b.x - 6, b.y + b.r * 1.6, 16); await settle(1.5); };
    const s0 = await sets(), id0 = await page.evaluate(() => window.__WH__.shell.identity().itemId), tag0 = await tagOf();
    // the physics cost of the three WHOLE squishies, every one awake (Float), in this Chromium: the yardstick for the pieces below
    const cost0 = await page.evaluate(async () => {
      const wh = window.__WH__; wh.pause();
      const med = (f) => { const xs = []; for (let k = 0; k < 5; k++) xs.push(f()); return xs.sort((a, c) => a - c)[2]; };
      wh.setSetting('gravity', false); wh.step(1 / 60, 45);
      const ms = med(() => wh.shell.matStepCost(60).msPerFrame), info = wh.shell.cutInfo();
      wh.setSetting('gravity', true); wh.step(1 / 60, 240); wh.resume();
      return { ms: +ms.toFixed(2), awakeParticles: info.awakeParticles };
    });
    await shot('multicut_before');
    // 1 a stroke across a squishy that is NOT the play one cuts that one; the play squishy stays who it was
    const other = s0.out.filter((q) => !q.play).sort((a, c) => Math.abs(c.bodies[0].x - s0.out[0].bodies[0].x) - Math.abs(a.bodies[0].x - s0.out[0].bodies[0].x))[0];
    await across(other.bodies[0]);
    const s1 = await sets();
    check(`D-103 ${frame}: with ${n} out, a ${touch ? 'finger' : 'mouse'} stroke across a squishy that is not the play one cuts THAT one (2 pieces); the play squishy stays who it was (the name tag does not change) and stays whole; all ${n} out`,
      n === 3 && s1.out.find((q) => q.key === other.key)?.pieces === 2 && s1.out[0].pieces === 1 && s1.out[0].key === id0 && (await tagOf()) === tag0 && s1.out.length === 3, JSON.stringify({ n, tag0, out: s1.out.map((q) => [q.key.slice(0, 8), q.pieces]) }));
    // 2 cut the play squishy too while the other is in pieces: no refusal; the bar counts both; a chip per cut squishy
    await across(s1.out[0].bodies[0]);
    const s2 = await sets();
    const bar2 = await page.evaluate(() => ({ count: document.querySelector('.cutbar-count')?.textContent ?? '', chips: [...document.querySelectorAll('.cutbar-chip')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, label: c.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; }), row: !document.querySelector('.cutbar-chips')?.hidden }));
    const said2 = (await shownText()) + ' || ' + (await liveText());
    await shot('multicut_two');
    check(`D-103 ${frame}: while that one is in pieces, a stroke across the play squishy cuts it TOO (two squishies in 2 pieces each, 4 in all); nothing is refused (no "One squishy at a time", no budget line); the bar counts "4 pieces" and shows a Reconnect chip for each cut squishy, on screen, at least 32 px high`,
      s2.out[0].pieces === 2 && s2.out.find((q) => q.key === other.key)?.pieces === 2 && s2.total === 4 && !/One squishy at a time|most at once/.test(said2) && /^4 pieces$/.test(bar2.count) && bar2.row && bar2.chips.length === 2 && bar2.chips.every((c) => c.inView && c.h >= 32 && /^Reconnect .+ \(2 pieces\)$/.test(c.label ?? '')),
      JSON.stringify({ out: s2.out.map((q) => [q.key.slice(0, 8), q.pieces]), bar2, said: said2.slice(0, 160) }));
    // 3 Reconnect ONE by its chip (a real tap)
    await tapSel(`.cutbar-chip[data-id="${other.key}"]`);
    await settle(2);
    const s3 = await sets();
    const d3 = Math.hypot(s3.out.find((q) => q.key === other.key).bodies[0].w[0] - other.bodies[0].w[0], s3.out.find((q) => q.key === other.key).bodies[0].w[2] - other.bodies[0].w[2]);
    check(`D-103 ${frame}: a tap on that squishy's chip puts ONLY it back together, where it stood (within 0.3 m); the play squishy stays in its 2 pieces; with one squishy cut the chips row is gone (Reconnect all is that chip)`,
      s3.out.find((q) => q.key === other.key)?.pieces === 1 && s3.out[0].pieces === 2 && d3 <= 0.3 && (await page.evaluate(() => document.querySelector('.cutbar-chips')?.hidden === true)), JSON.stringify({ out: s3.out.map((q) => [q.key.slice(0, 8), q.pieces]), d3: +d3.toFixed(3) }));
    // 4 Reconnect all, then ONE stroke across as many as line up (three on the wide frame's row)
    await tapSel('[data-key="join"]'); await settle(2);
    const s4 = await sets();
    const cs = s4.out.map((q) => ({ key: q.key, ...q.bodies[0] }));
    // the straight line through two centres that passes closest to the third: the squishies it runs through (within 0.75 of the radius) are the ones a player's one stroke crosses
    let best = null;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const A = cs[i], B = cs[j], L = Math.hypot(B.x - A.x, B.y - A.y) || 1, ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
      const hit = cs.filter((c) => Math.abs((c.x - A.x) * uy - (c.y - A.y) * ux) <= 0.75 * c.r);
      if (!best || hit.length > best.hit.length) best = { A, B, ux, uy, L, hit };
    }
    { // from before the first squishy on that line to past the last one (the third may lie beyond the two that define the line)
      const { A, ux, uy } = best; const vw = page.viewportSize().width, vh = page.viewportSize().height; const cl = (v, m) => Math.max(8, Math.min(m - 8, v));
      const ts = best.hit.map((c) => ({ t: (c.x - A.x) * ux + (c.y - A.y) * uy, r: c.r })), lo = ts.reduce((a, c) => (c.t < a.t ? c : a)), hi = ts.reduce((a, c) => (c.t > a.t ? c : a));
      await drag(cl(A.x + ux * (lo.t - lo.r * 1.7), vw), cl(A.y + uy * (lo.t - lo.r * 1.7), vh), cl(A.x + ux * (hi.t + hi.r * 1.7), vw), cl(A.y + uy * (hi.t + hi.r * 1.7), vh), 24); }
    await settle(1.5);
    const s5 = await sets();
    await shot('multicut_one_stroke');
    check(`D-103 ${frame}: after Reconnect all (everyone whole, ${n} out), ONE straight stroke across the ${best.hit.length} squishies that line up on this frame cuts every one of them (2 pieces each)`,
      s4.total === 1 && s4.out.length === 3 && best.hit.length >= 2 && best.hit.every((c) => s5.out.find((q) => q.key === c.key)?.pieces === 2) && s5.total === 2 * best.hit.length, JSON.stringify({ lineUp: best.hit.length, out: s5.out.map((q) => [q.key.slice(0, 8), q.pieces]) }));
    // 5 the budget: Split in two (real presses) up to the party's budget, one more is refused with a line the player can SEE
    const B0 = s5.budget;
    for (let k = 0; k < 14 && (await sets()).total < B0; k++) { await tapSel('[data-key="split"]'); await settle(1.2); }
    const s6 = await sets();
    const cost = await page.evaluate(async () => {
      const wh = window.__WH__; wh.pause();
      const med = (f) => { const xs = []; for (let k = 0; k < 5; k++) xs.push(f()); return xs.sort((a, c) => a - c)[2]; };
      wh.step(1 / 60, 240);
      const rest = { ms: med(() => wh.shell.matStepCost(60).msPerFrame), info: wh.shell.cutInfo() };
      wh.setSetting('gravity', false); wh.step(1 / 60, 45);   // Float: every piece is awake and rising
      const awake = { ms: med(() => wh.shell.matStepCost(60).msPerFrame), info: wh.shell.cutInfo() };
      wh.setSetting('gravity', true); wh.step(1 / 60, 240);
      wh.resume();
      return { rest: { ms: +rest.ms.toFixed(2), awakeParticles: rest.info.awakeParticles, particles: rest.info.particles, sleeping: rest.info.sleeping }, awake: { ms: +awake.ms.toFixed(2), awakeParticles: awake.info.awakeParticles, sleeping: awake.info.sleeping }, tier: wh.state().stage.tier, frameMsEma: +wh.state().stage.frameMsEma.toFixed(1) };
    });
    console.log(`     (info) ${frame}, tier ${cost.tier}: three WHOLE squishies all awake: physics step ${cost0.ms} ms (${cost0.awakeParticles} particles)`);
    console.log(`     (info) ${frame}, tier ${cost.tier}: ${s6.out.map((q) => q.pieces).join(' + ')} pieces: physics step in this Chromium ${cost.rest.ms} ms at rest (${cost.rest.sleeping} asleep, ${cost.rest.awakeParticles}/${cost.rest.particles} particles awake), ${cost.awake.ms} ms with every piece awake (Float: ${cost.awake.awakeParticles} particles awake); the whole frame here (software WebGL) ${cost.frameMsEma} ms`);
    await sleep(400);
    await shot('multicut_budget_pieces');
    await tapSel('[data-key="split"]');
    await sleep(700);
    const said6 = { shown: await shownText(), live: await liveText(), hint: await page.evaluate(() => document.querySelector('.cutbar-text')?.textContent ?? ''), split: await page.evaluate(() => { const b = document.querySelector('.cutbar [data-key="split"]'); return { disabled: b.disabled, aria: b.getAttribute('aria-disabled') }; }) };
    await shot('multicut_budget_line');
    const s7 = await sets();
    // (the Split button is off at the budget, with the bar's hint as its reason; a STROKE is the way a player still tries, so the visible line is checked on a stroke)
    const big = s7.out.flatMap((q) => q.bodies).sort((a, c) => c.r - a.r)[0];
    await drag(big.x + 6, big.y - big.r * 1.6, big.x - 6, big.y + big.r * 1.6, 16);
    await sleep(350);
    const said7 = { shown: await shownText(), live: await liveText() };
    await shot('multicut_budget_toast');   // (taken while the toast is up: it stays 3.2 s)
    await settle(1.5);
    const s8 = await sets();
    check(`D-103 ${frame}: Split in two (real presses) cuts up to the party's budget of ${B0} pieces (${s6.out.map((q) => q.pieces).join(' + ')}); there the Split button is off and the bar says why ("${said6.hint}"); one more STROKE cuts nothing and SHOWS the line on screen (a toast), also said: "${(said7.shown.match(/That's \d+ pieces out[^|]*/) ?? [''])[0].trim()}"`,
      B0 === 12 && s6.total === B0 && (said6.split.disabled === true || said6.split.aria === 'true') && /most at once/.test(said6.hint) && s8.total === B0 && /pieces out, the most at once/.test(said7.shown), JSON.stringify({ B0, total: s6.total, said6, said7: { shown: said7.shown.slice(0, 120), live: said7.live.slice(0, 120) }, after: s8.total }));
    // 6 Reconnect all: everyone whole again, all out
    await tapSel('[data-key="join"]'); await settle(3);
    const whole = await sets();
    await shot('multicut_whole');
    check(`D-103 ${frame}: Reconnect all puts EVERY squishy back together (three wholes, no piece left) and all ${n} stay out; the play squishy is who it was`,
      whole.total === 1 && whole.out.length === 3 && whole.out.every((q) => q.pieces === 1 && q.bodies.length === 1) && whole.out[0].key === id0 && (await tagOf()) === tag0, JSON.stringify({ out: whole.out.map((q) => [q.key.slice(0, 8), q.pieces, q.bodies.length]) }));
    check(`${frame}: 0 console errors / warnings / page errors / failed requests`, errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(`\n${total - bad}/${total} browser cut-party checks passed`);
process.exit(bad ? 1 : 0);
