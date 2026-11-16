// LOCK, SHELL leg (_spec/LOCK.md): the Shift lock through the REAL pointer, key and touch events in Chromium (SwiftShader), on the dev server (port 5450 by default, `--port=N`).
//   node _harness/shellview/lock_browser.mjs
// A small standalone check, not part of browser_shell.mjs's 68-minute run: a real mouse pull locked by a real Shift key press, the live region, the hint (Shift is not "a key used"), mouse up keeps the lock,
// the Menu (P) keeps it and Esc closes the Menu first, Esc with a lock and nothing open lets it go (and does not open the Menu), a click on the lobe lets it go, the Hoard (H) lets it go, then five real
// CDP touch points on a touch device: five fingers down, a five-way stretch on slots 0 to 4, Shift locks what is fully stretched, Esc lets go. A dev-server reload (another lane saving a file) can break a run: rerun.
import { launch, startVite } from '../pw.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=5450').slice(7));
let bad = 0, total = 0;
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };

const srv = await startVite(PORT);
const browser = await launch({ headless: true });
let code = 1;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.setDefaultTimeout(120000); await page.goto(srv.url + '?dev=1', { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const cta = await page.locator('.cta').boundingBox();
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await sleep(2500);
  const st = () => page.evaluate(() => { const s = window.__WH__.state(); return { locked: s.metrics.locked ?? 0, pull: s.metrics.pull ?? 0, grabbed: s.metrics.grabbed, carried: !!s.metrics.carried, stretch: s.metrics.stretch }; });
  const live = () => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
  const waitLive = async (re, ms = 1500) => { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { t = await page.evaluate(() => document.getElementById('wh-live')?.textContent ?? ''); if (re.test(t)) return t; await sleep(50); } return t; };
  const hint = () => page.evaluate(() => document.querySelector('.hint')?.textContent ?? '');
  const bodyPx = async () => { const b = await page.evaluate(() => window.__WH__.bodyScreen()); return { x: b.x * 1280, y: b.y * 800, r: b.rPx }; };
  const frames = async (n) => { await page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => { if (++i >= k) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n); };

  const hint0 = await hint();
  check('hint: the pointer line is up at the start', /^Click to poke/.test(hint0), hint0);
  await page.keyboard.press('Shift');
  await sleep(150);
  check('Shift with nothing held: no lock, the live region says nothing, the hint is unchanged (Shift is not "a key used")', (await st()).locked === 0 && (await hint()) === hint0 && !(await live()).startsWith('Locked'), `${await live()} | ${await hint()}`);

  // a real pull with the real mouse: press the right shoulder, drag out past the maximum
  const d = await bodyPx();
  const R = d.r;
  const x0 = d.x + 0.75 * R, y0 = d.y + 0.05 * R;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await sleep(120);
  const steps = 40;
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (i * 300) / steps, y0, { steps: 1 }); await sleep(16); }
  await sleep(500);
  const s1 = await st();
  check('a real mouse pull is held (pull level well up; the loop below tops it to the bar)', s1.grabbed && s1.pull >= 0.8, JSON.stringify(s1));
  // top the pull up if the estimate fell short (the maximum pull in px is not known to the page)
  let extra = 0;
  while ((await st()).pull < 0.97 && extra < 200) { extra += 15; await page.mouse.move(x0 + 300 + extra, y0, { steps: 1 }); await sleep(60); }
  const s2 = await st();
  await page.keyboard.press('Shift');
  await sleep(250);
  const s3 = await st();
  const liveLocked = await waitLive(/Locked in place/);
  check('Shift tap through a real key event locks the pull: metrics.locked 1, the grab slot is free (grabbed false), the live region says "Locked in place."', s2.pull >= 0.95 && s3.locked === 1 && !s3.grabbed && /Locked in place/.test(liveLocked), `${JSON.stringify(s2)} -> ${JSON.stringify(s3)} live "${liveLocked}"`);
  check('... and Shift did not turn the hint to the keyboard wording (it is still a pointer line: the gesture line or the first-run tool line)', !/^Space to poke/.test(await hint()) && !/Press 2 for Cut/.test(await hint()) && (await page.evaluate(() => document.body.dataset.kbd ?? null)) === null, await hint());
  await page.mouse.up();
  await sleep(1500);
  const s4 = await st();
  check('mouse up: the lobe stays held (locked 1, stretch still up, not picked up), 1.5 s later', s4.locked === 1 && s4.stretch > 0.5 * s3.stretch && !s4.carried, JSON.stringify(s4));

  // the Menu (P) keeps the lock; Escape closes the Menu first (a panel is open), the lock stays
  await page.keyboard.press('p');
  await sleep(600);
  const menuOpen = await page.evaluate(() => !!document.querySelector('#wh-menu'));
  await page.keyboard.press('Escape');
  await sleep(600);
  const s5 = await st();
  check('the Menu opened (P) and Esc closed it; the lock is still held through it', menuOpen && s5.locked === 1 && !(await page.evaluate(() => !!document.querySelector('#wh-menu'))), JSON.stringify(s5));
  // Esc with a lock and nothing open lets it go (and does NOT open the Menu)
  await page.keyboard.press('Escape');
  await sleep(300);
  const liveAfter = await waitLive(/Let go/);
  const s6 = await st();
  const menuAfter = await page.evaluate(() => !!document.querySelector('#wh-menu'));
  check('Esc with a lock and nothing open lets it go (metrics.locked 0), says "Let go.", and does not open the Menu', s6.locked === 0 && /Let go/.test(liveAfter) && !menuAfter, `locked ${s6.locked}, live "${liveAfter}", menu ${menuAfter}`);
  await sleep(2500);
  check('the body settles after the let-go (stretch < 0.2)', (await st()).stretch < 0.2, `stretch ${(await st()).stretch.toFixed(2)}`);
  await page.keyboard.press('Escape');
  await sleep(500);
  check('the next Esc (nothing locked) is the usual one: it opens the Menu', await page.evaluate(() => !!document.querySelector('#wh-menu')));
  await page.keyboard.press('Escape');
  await sleep(500);

  // a press on the locked lobe lets it go: lock again, then click the lobe
  const d2 = await bodyPx();
  const R2 = d2.r;
  const px = d2.x + 0.75 * R2, py = d2.y + 0.05 * R2;
  await page.mouse.move(px, py); await page.mouse.down(); await sleep(120);
  for (let i = 1; i <= 40; i++) { await page.mouse.move(px + (i * 340) / 40, py, { steps: 1 }); await sleep(16); }
  await sleep(500);
  let ex2 = 0;
  while ((await st()).pull < 0.97 && ex2 < 200) { ex2 += 15; await page.mouse.move(px + 340 + ex2, py, { steps: 1 }); await sleep(60); }
  await page.keyboard.press('Shift'); await sleep(200);
  await page.mouse.up(); await sleep(800);
  const s7 = await st();
  // find the lobe along the line of the pull: click from the far end inward (a left click on empty space does nothing) until the lock lets go
  let s8 = s7, hitAt = -1;
  for (let off = 340 + ex2; off >= 40 && s8.locked === 1; off -= 20) {
    await page.mouse.move(px + off, py);
    await page.mouse.down(); await sleep(120); await page.mouse.up(); await sleep(250);
    s8 = await st();
    if (s8.locked === 0) hitAt = off;
  }
  const liveGo = await waitLive(/Let go/);
  check('a real click on the locked lobe lets it go (locked 1 -> 0), says "Let go."', s7.locked === 1 && s8.locked === 0 && /Let go/.test(liveGo), `${s7.locked} -> ${s8.locked} at +${hitAt} px from the press (the pull asked ${340 + ex2}), live "${liveGo}"`);
  await sleep(2000);

  // leaving: lock one more, switch squishy with ] if another exists, else open the Hoard (H)
  const d3 = await bodyPx();
  const R3 = d3.r;
  const qx = d3.x - 0.75 * R3, qy = d3.y + 0.05 * R3;
  await page.mouse.move(qx, qy); await page.mouse.down(); await sleep(120);
  for (let i = 1; i <= 40; i++) { await page.mouse.move(qx - (i * 340) / 40, qy, { steps: 1 }); await sleep(16); }
  await sleep(500);
  let ex3 = 0;
  while ((await st()).pull < 0.97 && ex3 < 200) { ex3 += 15; await page.mouse.move(qx - 340 - ex3, qy, { steps: 1 }); await sleep(60); }
  await page.keyboard.press('Shift'); await sleep(200);
  await page.mouse.up(); await sleep(500);
  const s9 = await st();
  await page.keyboard.press('h');
  await sleep(1500);
  const hoardOpen = await page.evaluate(() => !!document.querySelector('.hoard') && getComputedStyle(document.querySelector('.hoard')).display !== 'none');
  const s10 = await st();
  check('opening the Hoard (H) lets the lock go', s9.locked === 1 && s10.locked === 0, `locked ${s9.locked} -> ${s10.locked}, hoard ${hoardOpen}`);
  await page.keyboard.press('Escape');
  await sleep(600);

  // ---- five real touch points (CDP), a five-way stretch on a touch screen (phones: up to 5 fingers, no lock)
  {
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    const tp = await tctx.newPage();
    tp.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`touch ${m.type()}: ${m.text()}`); });
    tp.on('pageerror', (e) => problems.push('touch pageerror: ' + e.message));
    tp.setDefaultTimeout(120000); await tp.goto(srv.url + '?dev=1', { waitUntil: 'load', timeout: 180000 });
    await tp.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    await tp.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    const c2 = await tp.locator('.cta').boundingBox();
    await tp.touchscreen.tap(c2.x + c2.width / 2, c2.y + c2.height / 2);
    await tp.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await sleep(2500);
    const cdp = await tctx.newCDPSession(tp);
    const bb = await tp.evaluate(() => window.__WH__.bodyScreen());
    const cx = bb.x * 1280, cy = bb.y * 800, rr = bb.rPx;
    const pts = [0, 1, 2, 3, 4].map((k) => { const a = (2 * Math.PI * k) / 5 - Math.PI / 2; return { a, x0: cx + Math.cos(a) * rr * 0.7, y0: cy + Math.sin(a) * rr * 0.7 }; });
    const touch = (type, f) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.map((p, k) => ({ id: k + 1, x: p.x0 + Math.cos(p.a) * f, y: p.y0 + Math.sin(p.a) * f })) });
    const until = async (fn, ms = 6000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await tp.evaluate(fn); if (v) return v; await sleep(100); } return v; };   // (a loaded machine runs few frames: the readouts follow the next step)
    await touch('touchStart', 0);
    await until(() => window.__WH__.state().metrics.fingers >= 5);
    const m1 = await tp.evaluate(() => window.__WH__.state().metrics);
    check('five real touch points on the body: the physics has five fingers down', m1.fingers === 5, `fingers ${m1.fingers}`);
    for (let i = 1; i <= 40; i++) { await touch('touchMove', (i * 440) / 40); await sleep(20); }
    await sleep(500);
    const ev = await tp.evaluate(() => window.__WH__.state().events.filter((e) => e.kind === 'grab').map((e) => e.finger).sort().join());
    const m2 = await tp.evaluate(() => window.__WH__.state().metrics);
    check('... and a five-way stretch: five pulls on slots 0 to 4, held', ev === '0,1,2,3,4' && m2.grabbed, `grab fingers ${ev}, grabbed ${m2.grabbed}, stretch ${m2.stretch.toFixed(2)}`);
    await tp.keyboard.press('Shift');
    await until(() => (window.__WH__.state().metrics.locked ?? 0) >= 1, 4000);
    const m3 = await tp.evaluate(() => window.__WH__.state().metrics);
    check('a Shift key on a touch device with a keyboard locks the finger pulls that are fully stretched (the same call; a phone has no Shift)', (m3.locked ?? 0) >= 1, `locked ${m3.locked}`);
    await touch('touchEnd', 0);
    await sleep(800);
    await tp.keyboard.press('Escape');
    await until(() => (window.__WH__.state().metrics.locked ?? 0) === 0 && window.__WH__.state().metrics.stretch < 0.2, 10000);
    const m4 = await tp.evaluate(() => window.__WH__.state().metrics);
    check('... Esc lets them go and the star settles', (m4.locked ?? 0) === 0 && m4.stretch < 0.2 && m4.fingers === 0, `locked ${m4.locked}, stretch ${m4.stretch.toFixed(2)}, fingers ${m4.fingers}`);
    await tctx.close();
  }

  const safe = problems.filter((p) => !/favicon|GPU stall|ReadPixels/.test(p));
  check('no console error or page error during all of it', safe.length === 0, safe.slice(0, 4).join(' | '));
  code = bad ? 1 : 0;
} catch (e) {
  console.log('SCRIPT ERROR', e);
} finally {
  await browser.close();
  srv.stop();
}
console.log(`\n${total - bad}/${total} browser lock checks passed`);
process.exit(code);
