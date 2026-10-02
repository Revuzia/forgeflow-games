// Browser harness for the SHELL lane (CONTRACT.md gates G3 / G4 / G6, shell parts): boots the REAL app (real SoftBody,
// real stage, real audio engine) at ?dev=1 in Chromium + SwiftShader and checks
//   * 0 console errors/warnings, 0 failed requests, canvas not blank
//   * title card -> play, audio unlock on the button gesture
//   * real MOUSE and real TOUCH (CDP touch events, incl. two fingers and pinch) -> the matching SoftEvents + audio voice starts
//   * orbit (drag empty space), wheel / pinch zoom, right-button orbit, keyboard (Space/G/M/Esc/Tab)
//   * settings panel: open / change / persist across reload / focus / Escape / 44 px targets, bottom sheet on a phone
//   * 390x844 + 320x568 + landscape layouts: no scroll, controls reachable, hint readable
//   * hidden tab, reduced motion, no navigator.vibrate, blocked localStorage, WebGL2 missing, module load failure
// Screenshots go to _shots/shell/ (gitignored); the JSON report to _harness/_reports/shell.json.
// Usage: node _harness/browser_shell.mjs [--quick] [--port=5365] [--only=name,name]
// (--quick skips the 20 s hint-comes-back wait)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { ROOT, launch, startVite } from './pw.mjs';

process.env.WH_FROZEN = '1'; // no HMR / file watching while the harness runs
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const PORT = Number((args.find((a) => a.startsWith('--port=')) ?? '--port=5365').split('=')[1]);
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean) ?? [];
const SHOTS = resolve(ROOT, '_shots', 'shell');
const REPORTS = resolve(ROOT, '_harness', '_reports');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

// ------------------------------------------------------------------ tiny test framework
const results = [];
const notRun = [];
let failures = 0;
function check(name, ok, extra = '') {
  results.push({ name, ok: !!ok, extra: String(extra) });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + extra : ''}`);
}
async function section(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) { notRun.push(`${name} (filtered by --only)`); return; }
  console.log(`\n== ${name}`);
  const t0 = Date.now();
  try { await fn(); } catch (e) { check(`${name}: section ran to the end`, false, String(e && e.message ? e.message : e).split('\n')[0]); }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ page helpers
function watch(page) {
  const w = { errors: [], failed: [], bad: [], pageErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') w.errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => { w.pageErrors.push(e.message); w.errors.push('pageerror: ' + e.message); });
  page.on('requestfailed', (r) => w.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) w.bad.push(`${r.status()} ${r.url()}`); });
  return w;
}
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

let srv, browser;
async function open({ query = '?dev=1', ctx = DESKTOP, init = null, waitTitle = true } = {}) {
  const context = await browser.newContext(ctx);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const w = watch(page);
  await page.goto(srv.url + query, { waitUntil: 'load' });
  if (waitTitle) await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, w };
}
const state = (page) => page.evaluate(() => window.__WH__.state());
async function fpsNote(page, label) { const f = (await state(page)).fps; fpsLog.push([label, f]); console.log(`   fps ${f} (${label})`); return f; }
const fpsLog = [];
const started = (page) => page.evaluate(() => window.__WH__.state().audio.started);
const body = (page) => page.evaluate(() => window.__WH__.bodyScreen());
async function ctaCentre(page) { const b = await page.locator('.cta').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function wake(page, { touch = false } = {}) {
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const c = await ctaCentre(page);
  if (touch) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hud')).opacity === '1' && !document.querySelector('.title'), null, { timeout: 30000 });
}
async function shot(page, name) { await page.screenshot({ path: resolve(SHOTS, name + '.png'), timeout: 180000, caret: 'hide' }); }

// events: the debug ring has no ids, so "new" = not in the set of JSON strings seen before
const evKeys = (page) => page.evaluate(() => window.__WH__.state().events.map((e) => JSON.stringify(e)));
async function waitEvent(page, seen, kind, { finger = null, timeout = 20000 } = {}) {
  try {
    const h = await page.waitForFunction(([s, k, f]) => {
      const set = new Set(s);
      return window.__WH__.state().events.find((e) => !set.has(JSON.stringify(e)) && e.kind === k && (f === null || e.finger === f)) ?? false;
    }, [seen, kind, finger], { timeout });
    return await h.jsonValue();
  } catch { return null; }
}
async function waitUntil(page, fn, arg, timeout = 15000) { try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; } }

// canvas statistics (blank test) and a coarse image signature (orbit test): taken inside one task right after a render
async function canvasSig(page) {
  return page.evaluate(async () => {
    const wh = window.__WH__;
    const was = wh.state().phase;
    wh.pause();
    wh.step(1 / 60, 1);
    const url = document.getElementById('stage').toDataURL('image/png');
    wh.resume();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const W = 48, H = 30;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = []; const colors = new Set();
    for (let i = 0; i < d.length; i += 4) { lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); colors.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); }
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lum.length);
    return { phase: was, mean, sd, colors: colors.size, lum };
  });
}
const sigDiff = (a, b) => a.lum.reduce((s, v, i) => s + Math.abs(v - b.lum[i]), 0) / a.lum.length;

// CDP touch
async function cdpFor(page) { return page.context().newCDPSession(page); }
const tp = (pts) => pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 6, radiusY: 6, force: 0.6 }));
async function touchStart(cdp, pts) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts) }); }
async function touchMove(cdp, pts) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(pts) }); }
async function touchEnd(cdp, pts = []) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: tp(pts) }); }

async function layoutOf(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const q = (s) => document.querySelector(s);
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const hint = q('.hint');
    return {
      sw: d.scrollWidth, sh: d.scrollHeight, iw: innerWidth, ih: innerHeight, bsw: document.body.scrollWidth, bsh: document.body.scrollHeight,
      gear: r(q('.hud-actions button[aria-label="Settings"]')), mute: r(q('.hud-actions button[aria-pressed]')), hint: r(hint), name: r(q('.nametag')), wordmark: r(q('.wordmark')), panel: r(q('.panel')),
      hintFont: hint ? parseFloat(getComputedStyle(hint).fontSize) : 0, hintClipped: hint ? hint.scrollWidth > hint.clientWidth + 1 : false,
      hintLines: hint ? (() => { const rg = document.createRange(); rg.selectNodeContents(hint); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })() : 0,
    };
  });
}
const overlap = (a, b) => a && b && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);

// =====================================================================================================
async function main() {
  srv = await startVite(PORT);
  browser = await launch();
  const mainWatches = []; // contexts whose console / network must be perfectly clean
  try {
    // ------------------------------------------------------------------------------------------------
    // G3: boot, title card, wake, canvas, HUD
    // ------------------------------------------------------------------------------------------------
    let D = null;
    await section('desktop-boot', async () => {
      D = await open({ query: '?dev=1' });
      mainWatches.push(['desktop', D.w]);
      const { page } = D;
      const t = await page.evaluate(() => ({
        mark: document.querySelector('.title-mark')?.textContent, promise: document.querySelector('.title-promise')?.textContent,
        btn: document.querySelector('.cta')?.textContent, disabled: document.querySelector('.cta')?.disabled, role: document.querySelector('.title')?.getAttribute('role'),
        h1: document.querySelector('h1')?.textContent, viewport: document.querySelector('meta[name=viewport]')?.content, theme: document.querySelector('meta[name=theme-color]')?.content,
        hudHidden: getComputedStyle(document.querySelector('.hud')).visibility,
      }));
      check('title card: wordmark WOBBLEHOARD, one-line promise, big button "Tap to wake it up" (enabled once loaded)', t.mark === 'WOBBLEHOARD' && t.btn === 'Tap to wake it up' && t.disabled === false && !!t.promise && t.role === 'dialog', JSON.stringify(t));
      check('index.html: viewport-fit=cover, theme-color is the ink token, one h1 for assistive tech', /viewport-fit=cover/.test(t.viewport) && t.theme === '#14102a' && t.h1 === 'WOBBLEHOARD');
      check('title card: the HUD is not shown (or reachable) underneath it', t.hudHidden === 'hidden');
      const a0 = await state(page);
      check('audio is locked before the gesture (nothing created before unlock)', a0.audio.state === 'locked' || a0.audio.state === 'suspended', a0.audio.state);
      const sig0 = await canvasSig(page);
      check('canvas is not blank behind the title card', sig0.sd > 4 && sig0.colors > 12, `sd ${sig0.sd.toFixed(1)}, ${sig0.colors} colours`);
      await sleep(700);
      await shot(page, 'title_desktop');
      await wake(page);
      const a1 = await state(page);
      check('title card -> play on the button press; audio unlocked by that same gesture (state running)', a1.phase === 'play' && a1.audio.state === 'running', `${a1.phase} / ${a1.audio.state}`);
      const hud = await page.evaluate(() => ({
        wordmark: document.querySelector('.wordmark')?.textContent, name: document.querySelector('.nametag-name')?.textContent,
        hint: document.querySelector('.hint')?.textContent, hintShow: document.querySelector('.hint')?.dataset.show,
        gear: !!document.querySelector('button[aria-label="Settings"]'), mute: !!document.querySelector('button[aria-label="Mute sound"]'),
      }));
      check('HUD: wordmark top-left, gear + mute, name tag "Dollop", one-line hint', hud.wordmark === 'WOBBLEHOARD' && hud.name === 'Dollop' && hud.gear && hud.mute && hud.hintShow === 'true' && /poke/i.test(hud.hint), JSON.stringify(hud));
      const sig = await canvasSig(page);
      check('canvas not blank in play', sig.sd > 4 && sig.colors > 12, `sd ${sig.sd.toFixed(1)}`);
      const b = await body(page);
      check('debug hook: bodyScreen() reports the squishy near the middle of the canvas', !!b && b.x > 0.3 && b.x < 0.7 && b.y > 0.25 && b.y < 0.8 && b.rPx > 40, JSON.stringify(b));
      await sleep(600);
      await shot(page, 'play_rest_desktop');
      const hs = await page.evaluate(() => window.__WH__.shot('canvas_only_rest'));
      check('debug hook: shot(name) posts the canvas to /__shot and the file lands under _shots/', hs.ok === true && /canvas_only_rest\.png$/.test(hs.path ?? '') && existsSync(hs.path), JSON.stringify(hs));
      check('hook shape: version 1, state() carries every documented field', await page.evaluate(() => { const h = window.__WH__; const s = h.state(); return h.version === 1 && ['phase', 'metrics', 'settings', 'genome', 'genomeCode', 'fps', 'stage', 'audio', 'events', 'stateHash'].every((k) => k in s) && ['pause', 'resume', 'step', 'pointerDown', 'pointerMove', 'pointerUp', 'setGenome', 'setSetting', 'shot', 'playSound'].every((k) => typeof h[k] === 'function'); }));
    });

    // ------------------------------------------------------------------------------------------------
    // G4 (mouse)
    // ------------------------------------------------------------------------------------------------
    await section('mouse-gestures', async () => {
      const { page } = D;
      const vp = page.viewportSize();
      const B = await body(page);
      const cx = B.x * vp.width, cy = B.y * vp.height, r = B.rPx;
      const px = (dx, dy) => [cx + dx * r, cy + dy * r];
      await fpsNote(page, 'desktop, mouse section start');

      // tap -> poke
      let seen = await evKeys(page), a0 = await started(page);
      await page.mouse.move(...px(0, -0.1));
      await page.mouse.down(); await sleep(50); await page.mouse.up();
      const poke = await waitEvent(page, seen, 'poke', { finger: 0 });
      const a1 = await started(page);
      check('mouse tap on the body -> a poke SoftEvent (finger 0) and an audio poke voice', !!poke && a1.poke === a0.poke + 1, `poke intensity ${poke?.intensity?.toFixed(2)}, audio.poke ${a0.poke}->${a1.poke}`);
      check('a tap does not start a held squish voice', a1.squish === a0.squish);
      await sleep(900);

      // hold -> press -> squish voice; release -> release event + sound
      seen = await evKeys(page); a0 = await started(page);
      await page.mouse.move(...px(0.05, -0.45));
      await page.mouse.down();
      const press = await waitEvent(page, seen, 'press', { finger: 0, timeout: 40000 });
      const a2 = await started(page);
      check('mouse hold -> a press SoftEvent (after >= 0.18 s) and exactly one audio squish voice', !!press && a2.squish === a0.squish + 1, `squish voices ${a0.squish}->${a2.squish}`);
      const deep = await waitUntil(page, () => window.__WH__.state().metrics.compression > 0.12, null, 90000);
      const mid = await state(page);
      check('held squish: pressing the dome squeezes it (compression > 0.12 while held) and volume stays 0.85..1.15', deep && mid.metrics.volume > 0.85 && mid.metrics.volume < 1.15 && mid.metrics.fingers === 1, `compression ${mid.metrics.compression.toFixed(2)}, volume ${mid.metrics.volume.toFixed(3)}, fps ${mid.fps}`);
      check('held squish: still exactly one squish voice after 1.3 s (no re-triggering)', (await started(page)).squish === a0.squish + 1);
      await shot(page, 'squish_held_desktop');
      const seenRel = await evKeys(page);
      const a3 = await started(page);
      await page.mouse.up();
      const rel = await waitEvent(page, seenRel, 'release', { finger: 0, timeout: 40000 });
      const a4 = await started(page);
      check('mouse release -> a release SoftEvent and an audio release voice', !!rel && a4.release === a3.release + 1, `release intensity ${rel?.intensity?.toFixed(2)}, audio.release ${a3.release}->${a4.release}`);
      const relI = rel?.intensity ?? 0;
      const popped = await waitUntil(page, (n) => window.__WH__.state().audio.started.pop > n, a3.pop, relI > 0.3 ? 30000 : 3000);
      check('a squeeze release above 0.3 spawns bubble pops (and a gentler one stays quiet)', relI > 0.3 ? popped : !popped, `release intensity ${relI.toFixed(2)}, pops ${a3.pop}->${(await started(page)).pop}`);
      await sleep(80);
      await shot(page, 'release_t80_desktop');
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return m.compression < 0.06 && m.fingers === 0; }, null, 60000);
      const rest = await state(page);
      check('after release the body recovers (volume 1 +- 0.03, compression ~0)', Math.abs(rest.metrics.volume - 1) < 0.03 && rest.metrics.compression < 0.1 && rest.metrics.fingers === 0, `volume ${rest.metrics.volume.toFixed(3)}, compression ${rest.metrics.compression.toFixed(2)}`);

      // rub: press then slide along the surface
      seen = await evKeys(page);
      await page.mouse.move(...px(-0.45, 0.1));
      await page.mouse.down();
      await sleep(120);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(...px(-0.45 + i * 0.07, 0.1 + i * 0.03)); await sleep(60); }
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 1, null, 30000);
      const rubS = await state(page);
      check('rub: press-then-move keeps ONE finger on the body, no pull', rubS.metrics.fingers === 1 && !rubS.metrics.grabbed, `fingers ${rubS.metrics.fingers}, grabbed ${rubS.metrics.grabbed}`);
      await page.mouse.up();
      check('rub: no grab event was produced', !(await waitEvent(page, seen, 'grab', { timeout: 1500 })));
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return m.fingers === 0 && m.compression < 0.06; }, null, 60000);

      // pull: press on the right shoulder, drag outward -> grab, stretch, snap
      seen = await evKeys(page); a0 = await started(page);
      await page.mouse.move(...px(0.62, -0.05));
      await page.mouse.down();
      await sleep(150);
      for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + 0.62 * r + i * 22, cy - 0.05 * r - i * 5); await sleep(50); }
      const grab = await waitEvent(page, seen, 'grab', { timeout: 40000 });
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return m.grabbed && m.stretch > 0.1; }, null, 60000);
      const pullS = await state(page);
      check('pull: outward drag from the body -> a grab SoftEvent, metrics.grabbed, real stretch (> 0.1)', !!grab && pullS.metrics.grabbed === true && pullS.metrics.stretch > 0.1, `stretch ${pullS.metrics.stretch.toFixed(2)}`);
      const a5 = await started(page);
      check('pull: the stretch drives an audio squish voice', a5.squish > a0.squish, `squish voices ${a0.squish}->${a5.squish}`);
      await shot(page, 'pull_desktop');
      const seenSnap = await evKeys(page);
      const a6 = await started(page);
      await page.mouse.up();
      const snap = await waitEvent(page, seenSnap, 'snap', { timeout: 40000 });
      const a7 = await started(page);
      check('pull release -> a snap SoftEvent, audio release + pops', !!snap && a7.release > a6.release, `snap intensity ${snap?.intensity?.toFixed(2)}, release ${a6.release}->${a7.release}`);
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return !m.grabbed && m.stretch < 0.05; }, null, 60000);
      const afterPull = await state(page);
      check('after the snap the body is back (volume 1 +- 0.03, not grabbed)', !afterPull.metrics.grabbed && Math.abs(afterPull.metrics.volume - 1) < 0.03, `volume ${afterPull.metrics.volume.toFixed(3)}`);

      // orbit by dragging empty space; the body does not get poked
      seen = await evKeys(page); a0 = await started(page);
      const s0 = await canvasSig(page);
      await page.mouse.move(90, 140);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(90 + i * 22, 140 + i * 3); await sleep(35); }
      await page.mouse.up();
      await sleep(2500);
      const s1 = await canvasSig(page);
      const a8 = await started(page);
      check('orbit: dragging empty space turns the view (image changes) without poking the body', sigDiff(s0, s1) > 1.2 && a8.poke === a0.poke, `mean abs diff ${sigDiff(s0, s1).toFixed(2)}`);
      await shot(page, 'orbit_desktop');

      // wheel zoom on empty space
      const r0 = (await body(page)).rPx;
      await page.mouse.move(90, 140);
      await page.mouse.wheel(0, -700);
      await waitUntil(page, (v) => window.__WH__.bodyScreen().rPx > v * 1.05, r0, 60000);
      await sleep(1500);
      const r1 = (await body(page)).rPx;
      check('wheel up zooms in (the squishy gets bigger on screen)', r1 > r0 * 1.05, `rPx ${r0.toFixed(0)} -> ${r1.toFixed(0)}`);
      await page.mouse.wheel(0, 1400);
      await waitUntil(page, (v) => window.__WH__.bodyScreen().rPx < v * 0.95, r1, 60000);
      await sleep(1500);
      const r2 = (await body(page)).rPx;
      check('wheel down zooms out', r2 < r1 * 0.95, `rPx ${r1.toFixed(0)} -> ${r2.toFixed(0)}`);
      await page.mouse.wheel(0, -700);
      await sleep(2500);

      // right button on the body = orbit, never a finger
      const B2 = await body(page);
      const bx = B2.x * vp.width, by = B2.y * vp.height;
      seen = await evKeys(page); a0 = await started(page);
      const sR0 = await canvasSig(page);
      await page.mouse.move(bx, by);
      await page.mouse.down({ button: 'right' });
      await sleep(200);
      const dur = await state(page);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(bx + i * 14, by + 2 * i); await sleep(40); }
      await page.mouse.up({ button: 'right' });
      await sleep(2500);
      const sR1 = await canvasSig(page);
      check('right button on the body orbits: no finger down, no poke, view changes', dur.metrics.fingers === 0 && (await started(page)).poke === a0.poke && sigDiff(sR0, sR1) > 0.8, `fingers ${dur.metrics.fingers}, diff ${sigDiff(sR0, sR1).toFixed(2)}`);

      // keyboard
      seen = await evKeys(page); a0 = await started(page);
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space');
      const kp = await waitEvent(page, seen, 'poke', { finger: 0, timeout: 40000 });
      check('keyboard: Space pokes the centre of the squishy (poke SoftEvent + audio poke)', !!kp && (await started(page)).poke === a0.poke + 1);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      await page.keyboard.press('g');
      await sleep(400);
      let ks = await state(page);
      check('keyboard: G toggles gravity <-> float (settings.gravity false)', ks.settings.gravity === false);
      await sleep(2200);
      await shot(page, 'float_desktop');
      await page.keyboard.press('g');
      check('keyboard: G again returns to the table', (await state(page)).settings.gravity === true);
      await page.keyboard.press('m');
      await sleep(150);
      check('keyboard: M mutes (the HUD button reflects it)', await page.evaluate(() => document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed') === 'true'));
      await page.keyboard.press('m');
      await sleep(150);
      check('keyboard: M again unmutes', await page.evaluate(() => document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed') === 'false'));
      const keyHold = await started(page);
      await page.keyboard.down('Space');
      const kd = await waitUntil(page, () => window.__WH__.state().metrics.compression > 0.12, null, 60000);
      const kh = await state(page);
      await page.keyboard.up('Space');
      check('keyboard: holding Space squishes (fingers 1, a squish voice, compression rises)', kd && kh.metrics.fingers === 1 && (await started(page)).squish > keyHold.squish, `compression ${kh.metrics.compression.toFixed(2)}`);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 60000);
    });

    // ------------------------------------------------------------------------------------------------
    // G4 via the debug hook: paused + step() makes squeezing, pulling and releasing machine-speed independent.
    // The synthetic pointer goes through the SAME gesture code path as a real pointer (contracts.ts DebugHook).
    // ------------------------------------------------------------------------------------------------
    await section('hook-deterministic', async () => {
      const { page } = D;
      const out = await page.evaluate(() => {
        const wh = window.__WH__;
        const log = {};
        const B = wh.bodyScreen();
        wh.pause();
        wh.step(1 / 60, 30);
        // --- tap: 50 ms down, then up
        let s0 = wh.state();
        wh.pointerDown(B.x, B.y - 0.3 * B.rPx / window.innerHeight);
        wh.step(1 / 60, 3);
        wh.pointerUp();
        wh.step(1 / 60, 40);
        let s1 = wh.state();
        log.tap = { pokes: s1.audio.started.poke - s0.audio.started.poke, squish: s1.audio.started.squish - s0.audio.started.squish, kinds: s1.events.map((e) => e.kind).slice(-4) };
        // --- hold 1.6 s (pressure ramp 0.55 -> 1 over 0.9 s after 0.18 s), sample compression on the way
        s0 = wh.state();
        const capY = B.y - 0.45 * B.rPx / window.innerHeight;
        wh.pointerDown(B.x, capY);
        const comp = [];
        for (let i = 0; i < 8; i++) { wh.step(1 / 60, 12); comp.push(+wh.state().metrics.compression.toFixed(3)); }
        const held = wh.state();
        log.hold = { comp, voices: held.audio.started.squish - s0.audio.started.squish, fingers: held.metrics.fingers, volume: held.metrics.volume };
        wh.pointerUp();
        wh.step(1 / 60, 20);
        const rel = wh.state();
        log.release = { releases: rel.audio.started.release - s0.audio.started.release, pops: rel.audio.started.pop - s0.audio.started.pop, kinds: rel.events.map((e) => e.kind), maxIntensity: rel.events.filter((e) => e.kind === 'release').at(-1)?.intensity ?? 0 };
        wh.step(1 / 60, 240);
        const rest = wh.state();
        log.rest = { volume: rest.metrics.volume, compression: rest.metrics.compression, fingers: rest.metrics.fingers };
        log.afterRelease = { pops: rest.audio.started.pop - s0.audio.started.pop };
        // --- pull: press the right shoulder, drag outward, hold, let go
        s0 = wh.state();
        const rr = B.rPx / window.innerWidth;
        wh.pointerDown(B.x + 0.62 * rr, B.y - 0.04);
        wh.step(1 / 60, 8);
        for (let i = 1; i <= 12; i++) { wh.pointerMove(B.x + 0.62 * rr + i * 0.022, B.y - 0.04 - i * 0.006); wh.step(1 / 60, 3); }
        wh.step(1 / 60, 40);
        const pulled = wh.state();
        log.pull = { grabbed: pulled.metrics.grabbed, stretch: pulled.metrics.stretch, volume: pulled.metrics.volume, voices: pulled.audio.started.squish - s0.audio.started.squish, kinds: pulled.events.map((e) => e.kind) };
        wh.pointerUp();
        wh.step(1 / 60, 20);
        const snapped = wh.state();
        log.snap = { releases: snapped.audio.started.release - s0.audio.started.release, kinds: snapped.events.map((e) => e.kind) };
        wh.step(1 / 60, 300);
        const after = wh.state();
        log.afterPull = { grabbed: after.metrics.grabbed, stretch: after.metrics.stretch, volume: after.metrics.volume };
        // --- two fingers on the body
        s0 = wh.state();
        wh.pointerDown(B.x - 0.4 * rr, B.y, 0);
        wh.pointerDown(B.x + 0.4 * rr, B.y, 1);
        wh.step(1 / 60, 60);
        const two = wh.state();
        log.two = { fingers: two.metrics.fingers, voices: two.audio.started.squish - s0.audio.started.squish, pokeFingers: [...new Set(two.events.filter((e) => e.kind === 'poke').map((e) => e.finger))].sort(), volume: two.metrics.volume };
        wh.pointerUp(0); wh.pointerUp(1);
        wh.step(1 / 60, 240);
        log.twoAfter = { fingers: wh.state().metrics.fingers, volume: wh.state().metrics.volume };
        wh.resume();
        return log;
      });
      check('hook tap: a short synthetic press is exactly one poke and no squish voice', out.tap.pokes === 1 && out.tap.squish === 0, JSON.stringify(out.tap));
      check('hook hold: pressing the dome holds a real squeeze (> 0.1 after the poke transient) with exactly one squish voice', out.hold.voices === 1 && out.hold.fingers === 1 && out.hold.comp[7] > 0.1 && out.hold.comp[7] >= out.hold.comp[2] * 0.9 && out.hold.comp.slice(2).every((v) => v > 0.05), JSON.stringify(out.hold));
      check('hook hold: volume stays within 0.85..1.15 under the full squeeze', out.hold.volume > 0.85 && out.hold.volume < 1.15, out.hold.volume.toFixed(3));
      check('hook release: a release SoftEvent, one audio release, bubbles pop, and the voice is gone', out.release.kinds.includes('release') && out.release.releases === 1 && out.release.maxIntensity > 0.1, JSON.stringify(out.release));
      check('hook release: pops follow a release only above 0.3 intensity, never more than 3', out.afterRelease.pops <= 3 && (out.release.maxIntensity > 0.3 ? out.afterRelease.pops >= 1 : out.afterRelease.pops === 0), `intensity ${out.release.maxIntensity.toFixed(2)}, pops ${out.afterRelease.pops}`);
      check('hook release: the body recovers (volume 1 +- 0.015, compression ~ 0)', Math.abs(out.rest.volume - 1) < 0.015 && out.rest.compression < 0.05 && out.rest.fingers === 0, JSON.stringify(out.rest));
      check('hook pull: outward drag grabs and stretches (stretch > 0.08), stretch voice started, no stray release bloop', out.pull.grabbed && out.pull.stretch > 0.08 && out.pull.voices >= 1 && out.pull.kinds.includes('grab') && out.pull.volume > 0.85 && out.pull.volume < 1.15, JSON.stringify(out.pull));
      check('hook snap: letting go emits snap + exactly one audio release', out.snap.kinds.includes('snap') && out.snap.releases === 1, JSON.stringify(out.snap));
      check('hook pull: afterwards nothing is grabbed, stretch 0, volume 1 +- 0.03', !out.afterPull.grabbed && out.afterPull.stretch < 0.05 && Math.abs(out.afterPull.volume - 1) < 0.03, JSON.stringify(out.afterPull));
      check('hook two fingers: fingers 2, pokes for finger 0 and 1, two squish voices, volume sane', out.two.fingers === 2 && out.two.pokeFingers.join() === '0,1' && out.two.voices === 2 && out.two.volume > 0.85 && out.two.volume < 1.15, JSON.stringify(out.two));
      check('hook two fingers: released cleanly (0 fingers)', out.twoAfter.fingers === 0 && Math.abs(out.twoAfter.volume - 1) < 0.03, JSON.stringify(out.twoAfter));
      // no leaked squish voice: every one-shot rings out within ~1.5 s of REAL time, a leaked held voice would stay forever
      const noLeak = await waitUntil(page, () => (window.__WH__.state().audio.live ?? 0) === 0, null, 20000);
      check('hook: after all that pressing, pulling and releasing no audio voice is left alive (no squish-voice leak)', noLeak, `live ${(await state(page)).audio.live}`);
    });

    // ------------------------------------------------------------------------------------------------
    // G3: settings panel (desktop): open, change, persist, focus, Escape
    // ------------------------------------------------------------------------------------------------
    await section('settings-panel-desktop', async () => {
      const { page } = D;
      await page.evaluate(() => localStorage.removeItem('wobblehoard:v1:settings'));
      await page.click('button[aria-label="Settings"]');
      await waitUntil(page, () => document.querySelector('.panel').dataset.open === 'true' && getComputedStyle(document.querySelector('.panel')).opacity === '1', null, 8000);
      const info = await page.evaluate(() => ({
        open: document.querySelector('.panel').dataset.open, expanded: document.querySelector('button[aria-label="Settings"]').getAttribute('aria-expanded'),
        focus: document.activeElement?.id, role: document.querySelector('.panel').getAttribute('role'), label: document.querySelector('.panel').getAttribute('aria-labelledby'),
        labels: [...document.querySelectorAll('.panel .row-label')].map((e) => e.textContent), haptics: getComputedStyle(document.querySelector('.row-switch')).display,
      }));
      check('settings: the gear opens the panel (aria-expanded, role=dialog, labelled) and focus moves into it', info.open === 'true' && info.expanded === 'true' && info.focus === 'wh-settings-title' && info.role === 'dialog' && info.label === 'wh-settings-title', JSON.stringify(info));
      check('settings: Volume, Louder squish, Screen shake, Haptics, Gravity, Quality are all there', ['Volume', 'Louder squish', 'Screen shake', 'Haptics', 'Gravity', 'Quality'].every((l) => info.labels.includes(l)), info.labels.join(' | '));
      await shot(page, 'settings_desktop');
      // targets >= 44 px and focus rings
      const sizes = await page.evaluate(() => [...document.querySelectorAll('.panel input[type=range], .panel .seg-face, .panel select, .panel .row-switch, .panel .icon-btn, .hud-actions .icon-btn')].map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className || e.tagName, w: Math.round(b.width), h: Math.round(b.height) }; }));
      check('settings: every control has a >= 44 px touch target', sizes.length >= 8 && sizes.every((s) => s.h >= 44 && s.w >= 44), sizes.filter((s) => s.h < 44 || s.w < 44).map((s) => `${s.cls} ${s.w}x${s.h}`).join(', ') || `${sizes.length} controls checked`);

      // change things with the keyboard (and a radio click, and a select) = the accessible paths
      await page.focus('#wh-volume'); await page.keyboard.press('Home');
      await page.focus('#wh-shake'); await page.keyboard.press('Home');
      await page.focus('#wh-boost'); await page.keyboard.press('End');
      await page.click('.seg-opt:has(input[value=float])');
      await page.selectOption('#wh-quality', 'low');
      await sleep(500);
      let s = await state(page);
      check('settings: volume 0, shake 0, louder squish 1, float, quality low reach the app', s.settings.volume === 0 && s.settings.shake === 0 && s.settings.squishBoost === 1 && s.settings.gravity === false && s.settings.quality === 'low', JSON.stringify(s.settings));
      check('settings: quality low really switches the render tier', await waitUntil(page, () => window.__WH__.state().stage.tier === 'low', null, 10000), (await state(page)).stage.tier);
      const outs = await page.evaluate(() => ({ vol: document.querySelector('#wh-volume').nextElementSibling?.textContent, shake: document.querySelector('#wh-shake').parentElement.querySelector('output').textContent, boost: document.querySelector('#wh-boost').parentElement.querySelector('output').textContent }));
      check('settings: value readouts (0% volume, shake Off, +9.0 dB)', outs.shake === 'Off' && outs.boost === '+9.0 dB', JSON.stringify(outs));
      const hap = await page.evaluate(() => document.querySelector('#wh-haptics').checked);
      await page.click('.row-switch');
      check('settings: the Haptics switch toggles', (await state(page)).settings.haptics === !hap);
      await page.keyboard.press('Escape');
      await waitUntil(page, () => getComputedStyle(document.querySelector('.panel')).visibility === 'hidden', null, 20000);
      const closed = await page.evaluate(() => ({ open: document.querySelector('.panel').dataset.open, focus: document.activeElement?.getAttribute('aria-label'), inert: document.querySelector('.panel').hasAttribute('inert'), vis: getComputedStyle(document.querySelector('.panel')).visibility }));
      check('settings: Escape closes it, focus returns to the gear, closed panel is inert + not focusable', closed.open === 'false' && closed.focus === 'Settings' && closed.inert && closed.vis === 'hidden', JSON.stringify(closed));
      // persistence across reload
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:settings')));
      check('settings: persisted under wobblehoard:v1:settings', stored && stored.volume === 0 && stored.quality === 'low' && stored.gravity === false && stored.squishBoost === 1, JSON.stringify(stored));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      const afterReload = await state(page);
      check('settings: survive a reload', afterReload.settings.volume === 0 && afterReload.settings.quality === 'low' && afterReload.settings.gravity === false && afterReload.settings.shake === 0, JSON.stringify(afterReload.settings));
      await wake(page);
      await page.click('button[aria-label="Settings"]');
      await sleep(500);
      const ui = await page.evaluate(() => ({ vol: document.querySelector('#wh-volume').value, q: document.querySelector('#wh-quality').value, floatChecked: document.querySelector('input[value=float]').checked }));
      check('settings: the reloaded panel shows the saved values', ui.vol === '0' && ui.q === 'low' && ui.floatChecked === true, JSON.stringify(ui));
      // focus trap: Tab from the last control wraps to the first, Shift+Tab from the title wraps to the last
      await page.focus('.panel .icon-btn');
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => document.querySelector('.panel').contains(document.activeElement));
      check('settings: Tab keeps focus inside the open panel (wraps)', inside);
      const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { vis: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, tag: a.tagName }; });
      check('settings: keyboard focus shows a visible focus ring', ring.vis && ring.outline !== 'none 0px', JSON.stringify(ring));
      await page.keyboard.press('Escape');
      // restore defaults, then close this page: later sections each run ONE WebGL page at a time (SwiftShader is slow)
      await page.evaluate(() => localStorage.removeItem('wobblehoard:v1:settings'));
      await D.context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // hint: fades after the first interaction, back after 20 s idle
    // ------------------------------------------------------------------------------------------------
    await section('hint-timing', async () => {
      const { page, context, w } = await open({ query: '?dev=1' });
      mainWatches.push(['hint', w]);
      await wake(page);
      check('hint: visible on arrival', await page.evaluate(() => document.querySelector('.hint').dataset.show === 'true'));
      // timestamps are taken INSIDE the page (performance.now at the attribute change), so a slow screenshot cannot skew them
      await page.evaluate(() => { window.__hintLog = []; const h = document.querySelector('.hint'); new MutationObserver(() => window.__hintLog.push([h.dataset.show, performance.now()])).observe(h, { attributes: true, attributeFilter: ['data-show'] }); });
      const B = await body(page); const vp = page.viewportSize();
      await page.mouse.click(B.x * vp.width, B.y * vp.height);
      const hid = await waitUntil(page, () => document.querySelector('.hint').dataset.show === 'false', null, 5000);
      check('hint: fades after the first interaction', hid);
      await sleep(1200);
      await shot(page, 'hint_hidden_desktop');
      if (QUICK) { notRun.push('hint-timing: the 20 s idle comeback was skipped by --quick'); }
      else {
        const back = await waitUntil(page, () => document.querySelector('.hint').dataset.show === 'true', null, 40000);
        const log = await page.evaluate(() => window.__hintLog);
        const fell = log.find((e) => e[0] === 'false'), rose = log.find((e) => e[0] === 'true');
        const dt = fell && rose ? (rose[1] - fell[1]) / 1000 : -1;
        check('hint: comes back after ~20 s idle (19.5..21.5 s measured in the page)', back && dt >= 19.5 && dt <= 21.5, `${dt.toFixed(2)} s`);
        await page.mouse.click(B.x * vp.width, B.y * vp.height);
        check('hint: hides again on the next interaction', await waitUntil(page, () => document.querySelector('.hint').dataset.show === 'false', null, 5000));
      }
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // G4 (touch) + G6 (phone layout)
    // ------------------------------------------------------------------------------------------------
    await section('touch-phone', async () => {
      const { page, context, w } = await open({ query: '?dev=1', ctx: PHONE });
      mainWatches.push(['phone', w]);
      const cdp = await cdpFor(page);
      const ta = await page.evaluate(() => ({ canvas: getComputedStyle(document.getElementById('stage')).touchAction, html: getComputedStyle(document.documentElement).touchAction, os: getComputedStyle(document.documentElement).overscrollBehavior, us: getComputedStyle(document.body).userSelect, coarse: matchMedia('(pointer: coarse)').matches }));
      check('mobile: touch-action none (no double-tap zoom / scroll), overscroll none, user-select none, pointer: coarse', ta.canvas === 'none' && ta.html === 'none' && ta.os.includes('none') && ta.us === 'none' && ta.coarse, JSON.stringify(ta));
      await sleep(500);
      await shot(page, 'title_phone');
      await wake(page, { touch: true });
      const a1 = await state(page);
      check('phone: a touch tap on the button wakes it up and unlocks audio', a1.phase === 'play' && a1.audio.state === 'running', `${a1.phase} / ${a1.audio.state}`);
      await sleep(700);
      await shot(page, 'play_phone');
      const L = await layoutOf(page);
      check('G6: 390x844 has no horizontal (or vertical) scroll', L.sw <= L.iw && L.bsw <= L.iw && L.sh <= L.ih, `scrollW ${L.sw}/${L.iw}, scrollH ${L.sh}/${L.ih}`);
      check('G6: gear + mute are reachable (inside the viewport, >= 44 px)', L.gear && L.mute && L.gear.r <= L.iw && L.gear.y >= 0 && L.gear.w >= 44 && L.gear.h >= 44 && L.mute.w >= 44, JSON.stringify([L.gear, L.mute]));
      check('G6: hint text is readable (>= 12 px after fit-to-width, not clipped, ONE line, inside the screen, clear of the name tag)', L.hintFont >= 12 && !L.hintClipped && L.hintLines <= 1 && L.hint.x >= 0 && L.hint.r <= L.iw && !overlap(L.hint, L.name), `font ${L.hintFont}px, lines ${L.hintLines}, hint ${JSON.stringify(L.hint)}, name ${JSON.stringify(L.name)}`);
      check('G6: wordmark, name tag and hint are all on screen', L.wordmark.r <= L.iw && L.name.b <= L.ih && L.hint.b <= L.ih);

      const vp = page.viewportSize();
      const B = await body(page);
      const cx = B.x * vp.width, cy = B.y * vp.height, r = B.rPx;
      // tap
      let seen = await evKeys(page), a0 = await started(page);
      await touchStart(cdp, [{ x: cx, y: cy - 0.1 * r }]); await sleep(50); await touchEnd(cdp);
      const poke = await waitEvent(page, seen, 'poke', { finger: 0, timeout: 40000 });
      check('touch tap on the body -> poke SoftEvent + audio poke', !!poke && (await started(page)).poke === a0.poke + 1, `poke ${poke?.intensity?.toFixed(2)}`);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 40000);
      await fpsNote(page, 'phone, after first tap');
      // hold
      seen = await evKeys(page); a0 = await started(page);
      await touchStart(cdp, [{ x: cx + 0.05 * r, y: cy - 0.45 * r }]);
      const press = await waitEvent(page, seen, 'press', { finger: 0, timeout: 40000 });
      const deepT = await waitUntil(page, () => window.__WH__.state().metrics.compression > 0.12, null, 90000);
      const hs = await state(page);
      check('touch hold -> press SoftEvent, one squish voice, real compression (> 0.12)', !!press && (await started(page)).squish === a0.squish + 1 && deepT && hs.metrics.fingers === 1, `compression ${hs.metrics.compression.toFixed(2)}`);
      await shot(page, 'squish_held_phone');
      const seenR = await evKeys(page);
      await touchEnd(cdp);
      const rel = await waitEvent(page, seenR, 'release', { finger: 0, timeout: 40000 });
      check('touch release -> release SoftEvent', !!rel, `intensity ${rel?.intensity?.toFixed(2)}`);
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return m.fingers === 0 && m.compression < 0.06; }, null, 60000);
      // two fingers on the body
      seen = await evKeys(page); a0 = await started(page);
      const p0 = { x: cx - 0.4 * r, y: cy, id: 0 }, p1 = { x: cx + 0.4 * r, y: cy, id: 1 };
      await touchStart(cdp, [p0]); await sleep(30); await touchStart(cdp, [p0, p1]);
      const pk0 = await waitEvent(page, seen, 'poke', { finger: 0, timeout: 40000 });
      const pk1 = await waitEvent(page, seen, 'poke', { finger: 1, timeout: 40000 });
      check('two touches on the body -> two fingers (poke events for finger 0 AND finger 1)', !!pk0 && !!pk1);
      await waitUntil(page, (n) => window.__WH__.state().audio.started.squish >= n + 2, a0.squish, 60000);
      const two = await state(page);
      check('two fingers: metrics.fingers = 2 and two squish voices after the hold', two.metrics.fingers === 2 && (await started(page)).squish >= a0.squish + 2, `fingers ${two.metrics.fingers}, squish voices +${(await started(page)).squish - a0.squish}`);
      // pinch the two fingers together (squeeze)
      for (let i = 1; i <= 8; i++) { await touchMove(cdp, [{ ...p0, x: p0.x + i * 0.03 * r }, { ...p1, x: p1.x - i * 0.03 * r }]); await sleep(40); }
      await sleep(1500);
      const sq = await state(page);
      check('two fingers: the pinch stays stable (no NaN, volume 0.85..1.15, 2 fingers)', sq.metrics.fingers === 2 && Number.isFinite(sq.metrics.compression) && sq.metrics.volume > 0.85 && sq.metrics.volume < 1.15, `volume ${sq.metrics.volume.toFixed(3)}`);
      await shot(page, 'two_fingers_phone');
      await touchEnd(cdp, [p1]); await sleep(200); await touchEnd(cdp);
      const lifted = await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 60000);
      check('two fingers: both lifted, nothing left pressed', lifted, `fingers ${(await state(page)).metrics.fingers}`);
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return m.compression < 0.06; }, null, 60000);
      // touch pull
      seen = await evKeys(page);
      const sx = cx + 0.62 * r, sy = cy - 0.05 * r;
      await touchStart(cdp, [{ x: sx, y: sy }]); await sleep(120);
      for (let i = 1; i <= 14; i++) { await touchMove(cdp, [{ x: sx + i * 12, y: sy - i * 4 }]); await sleep(50); }
      const grab = await waitEvent(page, seen, 'grab', { timeout: 40000 });
      await waitUntil(page, () => window.__WH__.state().metrics.stretch > 0.05, null, 60000);
      const ps = await state(page);
      check('touch pull from the edge -> grab SoftEvent, stretch > 0.05', !!grab && ps.metrics.grabbed && ps.metrics.stretch > 0.05, `stretch ${ps.metrics.stretch.toFixed(2)}`);
      await shot(page, 'pull_phone');
      await touchEnd(cdp);
      await waitUntil(page, () => { const m = window.__WH__.state().metrics; return !m.grabbed && m.stretch < 0.05; }, null, 60000);
      // orbit
      const s0 = await canvasSig(page); a0 = await started(page);
      await touchStart(cdp, [{ x: 60, y: 160 }]);
      for (let i = 1; i <= 12; i++) { await touchMove(cdp, [{ x: 60 + i * 18, y: 160 + i * 3 }]); await sleep(35); }
      await touchEnd(cdp);
      await sleep(2500);
      const s1 = await canvasSig(page);
      check('touch drag on empty space orbits (image changes), no poke', sigDiff(s0, s1) > 1.0 && (await started(page)).poke === a0.poke, `diff ${sigDiff(s0, s1).toFixed(2)}`);
      // pinch zoom on empty space
      const r0 = (await body(page)).rPx;
      const q0 = { x: 150, y: 150, id: 0 }, q1 = { x: 240, y: 150, id: 1 };
      await touchStart(cdp, [q0]); await sleep(30); await touchStart(cdp, [q0, q1]);
      for (let i = 1; i <= 10; i++) { await touchMove(cdp, [{ ...q0, x: q0.x - i * 9 }, { ...q1, x: q1.x + i * 9 }]); await sleep(40); }
      await touchEnd(cdp, [q1]); await touchEnd(cdp);
      await waitUntil(page, (v) => window.__WH__.bodyScreen().rPx > v * 1.05, r0, 60000);
      await sleep(1000);
      const r1 = (await body(page)).rPx;
      check('two-finger pinch on empty space zooms (spread = closer)', r1 > r0 * 1.05, `rPx ${r0.toFixed(0)} -> ${r1.toFixed(0)}`);
      const st2 = await state(page);
      check('pinch on empty space touched no body finger', st2.metrics.fingers === 0);
      // touch events are default-prevented on the canvas (no scroll / pull-to-refresh)
      const prevented = await page.evaluate(() => new Promise((res) => {
        const c = document.getElementById('stage');
        const ev = new Event('touchmove', { cancelable: true, bubbles: true });
        c.dispatchEvent(ev); res(ev.defaultPrevented);
      }));
      check('touchmove on the canvas is preventDefault-ed (no browser scroll / overscroll)', prevented);
      await sleep(300);

      // settings as a bottom sheet
      await page.touchscreen.tap(L.gear.x + L.gear.w / 2, L.gear.y + L.gear.h / 2);
      await waitUntil(page, () => document.querySelector('.panel').dataset.open === 'true' && getComputedStyle(document.querySelector('.panel')).opacity === '1', null, 8000);
      await sleep(900);
      const L2 = await layoutOf(page);
      check('phone: settings is a bottom sheet (full width, docked to the bottom edge)', L2.panel && Math.abs(L2.panel.x) < 1 && Math.abs(L2.panel.w - L2.iw) < 2 && Math.abs(L2.panel.b - L2.ih) < 2, JSON.stringify(L2.panel));
      check('phone: the sheet leaves the top half free (sheet is < 60% of the screen) and no scroll appears', L2.panel.h < L2.ih * 0.6 && L2.sw <= L2.iw && L2.sh <= L2.ih, `sheet ${Math.round(L2.panel.h)} of ${L2.ih}`);
      const sizes = await page.evaluate(() => [...document.querySelectorAll('.panel input[type=range], .panel .seg-face, .panel select, .panel .row-switch, .panel .icon-btn')].map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className || e.tagName, w: Math.round(b.width), h: Math.round(b.height) }; }));
      check('phone: every settings control is >= 44 px', sizes.every((s) => s.h >= 44 && s.w >= 44), sizes.filter((s) => s.h < 44 || s.w < 44).map((s) => `${s.cls} ${s.w}x${s.h}`).join(', ') || `${sizes.length} checked`);
      const bd = await body(page);
      check('phone: with the sheet open the squishy is still visible above it (centre above the sheet top)', bd && bd.y * L2.ih < L2.panel.y, `squishy y ${(bd.y * L2.ih).toFixed(0)} vs sheet top ${L2.panel.y.toFixed(0)}`);
      await shot(page, 'settings_phone');
      // drag the volume slider with a finger
      const vb = await page.locator('#wh-volume').boundingBox();
      await touchStart(cdp, [{ x: vb.x + vb.width * 0.8, y: vb.y + vb.height / 2 }]);
      for (let i = 1; i <= 8; i++) { await touchMove(cdp, [{ x: vb.x + vb.width * (0.8 - i * 0.07), y: vb.y + vb.height / 2 }]); await sleep(30); }
      await touchEnd(cdp);
      await sleep(300);
      const vol = (await state(page)).settings.volume;
      check('phone: dragging the volume slider with a finger changes it (and does not poke / orbit the body)', vol < 0.6 && vol > 0.05, `volume ${vol}`);
      await page.touchscreen.tap(L.gear.x + L.gear.w / 2, L.gear.y + L.gear.h / 2);
      await sleep(600);
      check('phone: the gear closes the sheet again', await page.evaluate(() => document.querySelector('.panel').dataset.open === 'false'));

      // rotate to landscape
      await page.setViewportSize({ width: 844, height: 390 });
      await sleep(1200);
      const L3 = await layoutOf(page);
      check('landscape phone 844x390: no scroll, HUD on screen', L3.sw <= L3.iw && L3.sh <= L3.ih && L3.gear.r <= L3.iw && L3.name.b <= L3.ih, `scroll ${L3.sw}x${L3.sh} of ${L3.iw}x${L3.ih}`);
      await page.touchscreen.tap(L3.gear.x + L3.gear.w / 2, L3.gear.y + L3.gear.h / 2);
      await sleep(900);
      const L4 = await layoutOf(page);
      check('landscape phone: the settings panel fits (scrolls inside itself) and does not overflow the screen', L4.panel.b <= L4.ih + 1 && L4.panel.y >= 0 && L4.sw <= L4.iw, JSON.stringify(L4.panel));
      await shot(page, 'settings_landscape');
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.setViewportSize({ width: 320, height: 568 });
      await sleep(1000);
      const L5 = await layoutOf(page);
      check('small phone 320x568: no scroll, hint inside the screen, not clipped, at most two lines', L5.sw <= L5.iw && L5.sh <= L5.ih && L5.hint.x >= 0 && L5.hint.r <= L5.iw && !L5.hintClipped && L5.hintLines <= 2, `hint ${JSON.stringify(L5.hint)}, lines ${L5.hintLines}`);
      await shot(page, 'play_small_phone');
      await page.setViewportSize({ width: 390, height: 844 });
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // keyboard-only flow, tab order, focus
    // ------------------------------------------------------------------------------------------------
    await section('keyboard-only', async () => {
      const { page, context, w } = await open({ query: '?dev=1' });
      mainWatches.push(['keyboard', w]);
      const onCta = await page.evaluate(() => document.activeElement?.classList.contains('cta'));
      check('title card: the button has focus on load (Enter / Space starts)', onCta);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await waitUntil(page, () => getComputedStyle(document.querySelector('.hud')).opacity === '1', null, 8000);
      check('Enter on the title button starts the game (keyboard-only works)', (await state(page)).audio.state === 'running');
      const order = [];
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)); }
      check('tab order in play: Mute, Settings (then out of the page)', order[0] === 'Mute sound' && order[1] === 'Settings', order.join(' > '));
      await page.focus('button[aria-label="Settings"]');
      await page.keyboard.press('Enter');
      await sleep(500);
      check('Enter on the gear opens the panel and moves focus into it', await page.evaluate(() => document.querySelector('.panel').dataset.open === 'true' && document.querySelector('.panel').contains(document.activeElement)));
      await page.keyboard.press('Escape');
      await sleep(400);
      check('Escape closes it and focus returns to the gear', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Settings'));
      // Space on the focused gear must activate the button, NOT poke the squishy
      const a0 = await started(page);
      await page.keyboard.press('Space');
      await sleep(500);
      const gearOpened = await page.evaluate(() => document.querySelector('.panel').dataset.open === 'true');
      check('Space on the focused gear opens settings and does NOT poke the squishy', gearOpened && (await started(page)).poke === a0.poke);
      await page.keyboard.press('Escape');
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // hidden tab: sim + audio pause, fingers released, resume without a spike
    // ------------------------------------------------------------------------------------------------
    await section('hidden-tab', async () => {
      const { page, context, w } = await open({ query: '?dev=1' });
      mainWatches.push(['hidden', w]);
      await wake(page);
      const B = await body(page); const vp = page.viewportSize();
      await page.mouse.move(B.x * vp.width, B.y * vp.height - 20);
      await page.mouse.down();
      await waitUntil(page, () => window.__WH__.state().audio.started.squish > 0, null, 20000);
      await sleep(400);
      const held = await state(page);
      check('hidden: setup has a finger down and a live squish voice', held.metrics.fingers === 1 && (held.audio.live ?? 1) >= 1, `fingers ${held.metrics.fingers}, live ${held.audio.live}`);
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(500);
      const h1 = await state(page);
      const hashA = h1.stateHash;
      const rel0 = h1.audio.started.release;
      await sleep(900);
      const h2 = await state(page);
      check('hidden tab: the squish voice is gone at once (no live audio voice while hidden)', (h2.audio.live ?? 0) === 0, `live ${h2.audio.live}`);
      check('hidden tab: the simulation is paused (state hash frozen for 0.9 s)', h2.stateHash === hashA, `${hashA} vs ${h2.stateHash}`);
      await page.mouse.up();
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      const freed = await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      await sleep(800);
      const h3 = await state(page);
      check('visible again: the finger that was released while hidden is up, the sim runs and the body is sane (volume 0.85..1.15, no NaN)', freed && Number.isFinite(h3.metrics.volume) && h3.metrics.volume > 0.85 && h3.metrics.volume < 1.15, `volume ${h3.metrics.volume.toFixed(3)}`);
      check('visible again: no surprise release bloop for the press that was cancelled by hiding', h3.audio.started.release === rel0, `release ${rel0} -> ${h3.audio.started.release}`);
      // blur mid-press releases too
      await page.mouse.move(B.x * vp.width, B.y * vp.height - 20);
      await page.mouse.down();
      await sleep(500);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 1, null, 20000);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      const blurFreed = await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      check('window blur mid-press releases the finger', blurFreed, `fingers ${(await state(page)).metrics.fingers}`);
      await page.mouse.up();
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // reduced motion, no vibrate, blocked storage
    // ------------------------------------------------------------------------------------------------
    await section('reduced-motion', async () => {
      const { page, context, w } = await open({ query: '?dev=1', ctx: { ...DESKTOP, reducedMotion: 'reduce' } });
      mainWatches.push(['reduced-motion', w]);
      const anim = await page.evaluate(() => ({ letter: getComputedStyle(document.querySelector('.title-letter')).animationName, cta: getComputedStyle(document.querySelector('.cta')).animationName }));
      check('prefers-reduced-motion: no wobbling title letters, no breathing button', anim.letter === 'none' && anim.cta === 'none', JSON.stringify(anim));
      const s = await state(page);
      check('prefers-reduced-motion: screen shake defaults to 0', s.settings.shake === 0, `shake ${s.settings.shake}`);
      await wake(page);
      await page.click('button[aria-label="Settings"]');
      await sleep(500);
      const sh = await page.evaluate(() => document.querySelector('#wh-shake').parentElement.querySelector('output').textContent);
      check('prefers-reduced-motion: the settings panel shows Screen shake Off', sh === 'Off', sh);
      await shot(page, 'settings_reduced_motion');
      await context.close();
    });

    await section('no-vibrate', async () => {
      const { page, context, w } = await open({
        query: '?dev=1', init: () => { Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true }); },
      });
      mainWatches.push(['no-vibrate', w]);
      await wake(page);
      const s = await state(page);
      await page.click('button[aria-label="Settings"]');
      await sleep(500);
      const row = await page.evaluate(() => ({ vib: typeof navigator.vibrate, shown: getComputedStyle(document.querySelector('.row-switch')).display !== 'none' && document.querySelector('.row-switch').offsetParent !== null, labels: [...document.querySelectorAll('.panel .row-label')].filter((e) => e.offsetParent !== null).map((e) => e.textContent) }));
      check('no navigator.vibrate: the Haptics control is hidden, haptics default off', row.vib === 'undefined' && !row.shown && !row.labels.includes('Haptics') && s.settings.haptics === false, JSON.stringify(row));
      // everything else still works
      const B = await body(page); const vp = page.viewportSize();
      const a0 = await started(page);
      await page.mouse.click(B.x * vp.width, B.y * vp.height - 20);
      check('no navigator.vibrate: a tap still pokes (no exception from the haptics wrapper)', await waitUntil(page, (n) => window.__WH__.state().audio.started.poke > n, a0.poke, 15000) && w.pageErrors.length === 0);
      await shot(page, 'settings_no_haptics');
      await context.close();
    });

    await section('storage-blocked', async () => {
      for (const [label, init] of [
        ['every Storage call throws', () => { for (const k of ['getItem', 'setItem', 'removeItem']) Storage.prototype[k] = function () { throw new DOMException('blocked', 'SecurityError'); }; }],
        ['window.localStorage itself throws (blocked site data)', () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); }],
      ]) {
        const { page, context, w } = await open({ query: '?dev=1', init });
        mainWatches.push([`storage:${label}`, w]);
        await wake(page);
        await page.click('button[aria-label="Settings"]');
        await sleep(400);
        await page.focus('#wh-volume'); await page.keyboard.press('Home');
        await page.click('.seg-opt:has(input[value=float])');
        await sleep(400);
        const s = await state(page);
        const B = await body(page); const vp = page.viewportSize();
        const a0 = await started(page);
        await page.keyboard.press('Escape');
        await page.mouse.click(B.x * vp.width, B.y * vp.height - 20);
        const poked = await waitUntil(page, (n) => window.__WH__.state().audio.started.poke > n, a0.poke, 15000);
        check(`blocked storage (${label}): the game boots, settings still work in memory, a tap still pokes, zero errors`, s.settings.volume === 0 && s.settings.gravity === false && poked && w.errors.length === 0, w.errors.slice(0, 2).join(' | '));
        await context.close();
      }
    });

    // ------------------------------------------------------------------------------------------------
    // friendly errors
    // ------------------------------------------------------------------------------------------------
    await section('error-cards', async () => {
      {
        const { page, context } = await open({
          query: '?dev=1', waitTitle: false,
          init: () => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (t === 'webgl2') return null; return o.call(this, t, ...a); }; },
        });
        await page.waitForSelector('.errorcard', { timeout: 30000 });
        const e = await page.evaluate(() => ({ title: document.querySelector('.errorcard h2')?.textContent, msg: document.querySelector('.errorcard p')?.textContent, btn: document.querySelector('.errorcard .cta')?.textContent, focus: document.activeElement?.classList.contains('cta'), role: document.querySelector('.errorcard')?.getAttribute('role'), phase: document.body.dataset.phase }));
        check('WebGL2 missing: a friendly card says what failed and offers Reload (never blank)', /draw|WebGL/i.test(e.title + e.msg) && /WebGL2/.test(e.msg) && e.btn === 'Reload' && e.focus && e.role === 'alertdialog' && e.phase === 'error', JSON.stringify(e));
        await shot(page, 'error_webgl2');
        await context.close();
      }
      {
        const context = await browser.newContext(DESKTOP);
        const page = await context.newPage();
        await page.route('**/src/render/stage.ts*', (route) => route.abort());
        await page.goto(srv.url + '?dev=1', { waitUntil: 'load' });
        await page.waitForSelector('.errorcard', { timeout: 60000 });
        const e = await page.evaluate(() => ({ title: document.querySelector('.errorcard h2')?.textContent, detail: document.querySelector('.errorcard-detail')?.textContent, btn: document.querySelector('.errorcard .cta')?.textContent, title_card: !!document.querySelector('.title') }));
        check('a sibling module that fails to load: a friendly error card with the cause and a Reload button, title card gone', /wake/i.test(e.title) && e.btn === 'Reload' && !e.title_card && !!e.detail, JSON.stringify(e));
        await shot(page, 'error_module');
        await context.close();
      }
    });

    // ------------------------------------------------------------------------------------------------
    // URL params
    // ------------------------------------------------------------------------------------------------
    await section('url-params', async () => {
      const { page, context, w } = await open({ query: '?dev=1&float=1&quality=low&mute=1&genome=7' });
      mainWatches.push(['url', w]);
      const s = await state(page);
      check('?float=1 ?quality=low apply as session overrides', s.settings.gravity === false && s.settings.quality === 'low' && s.stage.tier === 'low', JSON.stringify([s.settings.gravity, s.settings.quality, s.stage.tier]));
      check('?genome=7 builds a different squishy with another name, ?mute=1 starts muted', s.genomeCode !== undefined && s.genomeCode.startsWith('g1.') && await page.evaluate(() => document.querySelector('.nametag-name').textContent !== 'Dollop' && document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed') === 'true'));
      check('URL overrides were not written to storage', await page.evaluate(() => localStorage.getItem('wobblehoard:v1:settings') === null));
      await wake(page);
      await sleep(1500);
      await shot(page, 'url_genome7_float');
      const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:profile')));
      check('profile: the stable starter instance is stored once and ?genome= did not overwrite it', prof && prof.v === 1 && prof.instance.name === 'Dollop' && prof.instance.origin.kind === 'starter' && prof.instance.genome.hue === 32, prof ? `${prof.instance.id}` : 'none');
      const id = prof.instance.id;
      await page.goto(srv.url + '?dev=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      const prof2 = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:profile')));
      check('profile: the squishy keeps the SAME id across visits (the trade seam)', prof2.instance.id === id);
      await page.evaluate(() => localStorage.setItem('wobblehoard:v1:profile', '{"v":1,"instance":'));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      const prof3 = await page.evaluate(() => ({ p: JSON.parse(localStorage.getItem('wobblehoard:v1:profile')), bad: localStorage.getItem('wobblehoard:v1:profile.unreadable') }));
      check('profile: a corrupt profile in storage boots fine, is replaced by a fresh starter, old text parked', prof3.p.instance.id !== id && !!prof3.bad);
      await context.close();
    });

    await section('lab-panel', async () => {
      const { page, context, w } = await open({ query: '?dev=1&lab=1' });
      mainWatches.push(['lab', w]);
      await wake(page);
      const names = await page.evaluate(() => [...document.querySelectorAll('.lab .lab-btn')].map((b) => b.textContent));
      check('?lab=1 (dev): the sound lab has poke / squish (hold) / release / land / pop / blend', ['poke', 'squish (hold)', 'release', 'land', 'pop', 'blend'].every((n) => names.includes(n)), names.join(', '));
      const a0 = await started(page);
      await page.click('.lab .lab-btn:text-is("poke")');
      await page.click('.lab .lab-btn:text-is("release")');
      await page.click('.lab .lab-btn:text-is("land")');
      await page.click('.lab .lab-btn:text-is("pop")');
      await page.click('.lab .lab-btn:text-is("blend")');
      const a1 = await started(page);
      check('lab: each button starts its voice', a1.poke === a0.poke + 1 && a1.release === a0.release + 1 && a1.land === a0.land + 1 && a1.pop === a0.pop + 1 && a1.blend === a0.blend + 1, JSON.stringify(a1));
      const hb = await page.locator('.lab .lab-btn:text-is("squish (hold)")').boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await sleep(700);
      const live = await state(page);
      await page.mouse.up();
      await sleep(400);
      const after = await state(page);
      check('lab: squish (hold) runs a voice while held and ends it on release', (await started(page)).squish === a1.squish + 1 && (live.audio.live ?? 1) >= 1 && (after.audio.live ?? 0) < (live.audio.live ?? 1));
      await shot(page, 'lab_desktop');
      await context.close();
      const { page: p2, context: c2 } = await open({ query: '?dev=1' });
      check('without ?lab=1 there is no sound lab', await p2.evaluate(() => !document.querySelector('.lab')));
      await c2.close();
    });

    // ------------------------------------------------------------------------------------------------
    // not in dev mode: no hook, no overlay
    // ------------------------------------------------------------------------------------------------
    await section('prod-mode', async () => {
      const context = await browser.newContext(DESKTOP);
      const page = await context.newPage();
      const w = watch(page);
      mainWatches.push(['no-dev', w]);
      await page.goto(srv.url, { waitUntil: 'load' });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 120000 });
      const x = await page.evaluate(() => ({ hook: typeof window.__WH__, dev: !!document.querySelector('.dev'), lab: !!document.querySelector('.lab') }));
      check('without ?dev=1: window.__WH__ is NOT exposed, no stats overlay', x.hook === 'undefined' && !x.dev && !x.lab, JSON.stringify(x));
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // the PRODUCTION build (vite build -> static files, relative base './'): chunks load, boots, plays, no dev hook
    // ------------------------------------------------------------------------------------------------
    await section('prod-build', async () => {
      const out = resolve(SHOTS, 'dist_check');
      const b = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
      check('vite build succeeds', b.status === 0, (b.stderr || '').split('\n')[0]);
      if (b.status !== 0) return;
      const size = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(resolve(dir, e.name)) : statSync(resolve(dir, e.name)).size), 0);
      const total = size(out);
      check('dist stays under the 1.2 MB budget (G0)', total < 1.2 * 1024 * 1024, `${(total / 1024).toFixed(0)} KB`);
      const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      const server = createServer((req, res) => {
        const path = resolve(out, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'));
        if (!path.startsWith(out) || !existsSync(path) || statSync(path).isDirectory()) { res.statusCode = 404; res.end('nope'); return; }
        res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
      await new Promise((ok) => server.listen(PORT + 1, ok));
      try {
        const context = await browser.newContext(DESKTOP);
        const page = await context.newPage();
        const w = watch(page);
        await page.goto(`http://localhost:${PORT + 1}/index.html`, { waitUntil: 'load' });
        await page.waitForSelector('.cta:not([disabled])', { timeout: 120000 });
        const c = await ctaCentre(page);
        await page.mouse.click(c.x, c.y);
        await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 30000 });
        await sleep(1500);
        const info = await page.evaluate(() => ({ hook: typeof window.__WH__, dev: !!document.querySelector('.dev'), hud: getComputedStyle(document.querySelector('.hud')).visibility, scripts: [...document.scripts].map((s) => s.src).filter(Boolean) }));
        check('production build: boots from static files, title -> play, no dev hook / overlay', info.hook === 'undefined' && !info.dev && info.hud === 'visible', JSON.stringify(info));
        check('production build: 0 console errors / warnings, 0 failed requests', w.errors.length === 0 && w.failed.length === 0 && w.bad.length === 0, [...w.errors, ...w.failed, ...w.bad].slice(0, 3).join(' | '));
        await shot(page, 'prod_build_play');
        await context.close();
      } finally { server.close(); }
    });

    // ------------------------------------------------------------------------------------------------
    // G3: zero console errors / warnings / failed requests across the main flows
    // ------------------------------------------------------------------------------------------------
    await section('console-and-network', async () => {
      for (const [label, w] of mainWatches) {
        const noise = w.errors.filter((e) => !/Download the React DevTools/.test(e));
        check(`${label}: 0 console errors / warnings, 0 page errors`, noise.length === 0 && w.pageErrors.length === 0, noise.slice(0, 3).join(' | '));
        check(`${label}: 0 failed requests, 0 HTTP >= 400`, w.failed.length === 0 && w.bad.length === 0, [...w.failed, ...w.bad].slice(0, 3).join(' | '));
      }
    });
  } finally {
    try { await browser.close(); } catch { /* gone */ }
    try { srv.stop(); } catch { /* gone */ }
  }

  const report = { at: new Date().toISOString(), quick: QUICK, passed: results.filter((r) => r.ok).length, failed: failures, total: results.length, notRun, results };
  writeFileSync(resolve(REPORTS, 'shell.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.passed}/${report.total} shell browser checks passed${notRun.length ? `   (not run: ${notRun.join('; ')})` : ''}`);
  console.log(`screenshots: ${SHOTS}\nreport: ${resolve(REPORTS, 'shell.json')}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); try { srv?.stop(); } catch { /* ignore */ } process.exit(2); });
