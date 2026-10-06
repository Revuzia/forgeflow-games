// Browser harness for the SHELL lane (CONTRACT.md gates G3 / G4 / G6 / G4m prerequisites, shell parts; SHELL-2a): boots the REAL app (real
// SoftBody, real stage, real audio engine) at ?dev=1 in Chromium + SwiftShader and checks
//   * 0 console errors/warnings, 0 failed requests, canvas not blank; title card -> play, audio unlock on the button gesture
//   * real MOUSE and real TOUCH (CDP touch events, incl. two fingers and pinch) -> the matching SoftEvents + audio voice starts
//   * orbit, wheel / pinch zoom, right-button orbit; the deterministic DebugHook path
//   * the capsule loop (round 2): the meter ring (accelerated through the dev-only hook), the meter-full cue, the capsule drop, hold-to-open,
//     the reveal with its sounds, the name plate + NEW / x2 chip, adoption of the result body; the dev merge entry; the 350 ms skip gate;
//     Calm effects; Skip animations
//   * settings: every control, persistence, the migration of a slice-1 blob and of a newer blob; reduced motion; haptics only where real
//   * keyboard only: Tab to the squishy, a visible focus ring, Space pokes, G / M only where they belong, Escape back to the squishy
//   * live regions; WCAG 1.4.10 reflow at 320x568, 568x320, 320x460, 320x256; WebGL context loss (freeze, resume, give-up card)
//   * the production build: size budget, no DebugHook / sound lab / shot poster in the bundle, no inline script or style, a strict CSP holds
// Screenshots go to _shots/shell/ (gitignored); the JSON report to _harness/_reports/shell.json.
// Usage: node _harness/browser_shell.mjs [--quick] [--port=5366] [--only=name,name]
// (--quick skips the 20 s hint-comes-back wait). The machine is shared and SwiftShader is slow: one browser at a time, one page at a time.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { ROOT, launch, startVite } from './pw.mjs';

process.env.WH_FROZEN = '1'; // no HMR / file watching while the harness runs
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const PORT = Number((args.find((a) => a.startsWith('--port=')) ?? '--port=5366').split('=')[1]);
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean) ?? [];
const SHOTS = resolve(ROOT, '_shots', 'shell');
const REPORTS = resolve(ROOT, '_harness', '_reports');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

// ------------------------------------------------------------------ tiny test framework
const results = [];
const notRun = [];
let failures = 0;
let currentSection = '';
function check(name, ok, extra = '') {
  results.push({ section: currentSection, name, ok: !!ok, extra: String(extra) });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + extra : ''}`);
}
async function section(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) { notRun.push(`${name} (filtered by --only)`); return; }
  currentSection = name;
  console.log(`\n== ${name}`);
  const t0 = Date.now();
  try { await fn(); } catch (e) { check(`${name}: section ran to the end`, false, String(e && e.message ? e.message : e).split('\n')[0]); }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** the game's wordmark (renamed by the owner on 2026-10-06 from WOBBLEHOARD; internal ids such as the storage keys and __WH__ keep the old name) */
const GAME_MARK = 'SQUISH KEEPER';

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
const SMALL = { viewport: { width: 960, height: 600 } };
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
/** a load readout (not a check): fps over ~1.5 s of live frames, the stage's draw calls / triangles / bodies */
async function loadNote(page, label) {
  const r = await page.evaluate(async () => {
    const wh = window.__WH__; wh.resume();
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const st = wh.state(); const info = wh.shell.stageInfo();
    return { rafFps: +(n / ((performance.now() - t0) / 1000)).toFixed(1), drawCalls: st.stage.drawCalls, tris: st.stage.triangles, bodies: info?.bodies ?? null, capsule: info?.capsule ?? null };
  });
  console.log(`   load ${JSON.stringify(r)} (${label})`);
  return r;
}
async function fpsNote(page, label) { const f = (await state(page)).fps; fpsLog.push([label, f]); console.log(`   fps ${f} (${label})`); return f; }
const fpsLog = [];
const started = (page) => page.evaluate(() => window.__WH__.state().audio.started);
const body = (page) => page.evaluate(() => window.__WH__.bodyScreen());
const shellApi = (page, fn, arg) => page.evaluate(fn, arg);
const meter = (page) => page.evaluate(() => window.__WH__.shell.meter());
const live = (page) => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
async function ctaCentre(page) { const b = await page.locator('.cta').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function wake(page, { touch = false } = {}) {
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const c = await ctaCentre(page);
  if (touch) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hud')).opacity === '1' && !document.querySelector('.title'), null, { timeout: 30000 });
}
// settle first: while the rAF loop is paused (DebugHook.step) Chromium produces no frames of its own, so a CSS transition that started
// during stepping would be captured at its first frame (the reveal plate at opacity 0). settle() drives frames until finite transitions
// end. (Playwright's animations: 'disabled' did the same job but hung screenshots of the live page under heavy machine load.)
// A live dev page is paused for the shot (the canvas keeps its last frame; no WebGL frame competes with the capture on a loaded machine)
// and resumed after it, unless the section had paused it itself.
async function shot(page, name) {
  const held = await page.evaluate(() => { const s = window.__WH__?.shell; if (!s || s.paused()) return false; window.__WH__.pause(); return true; }).catch(() => false);
  try {
    await settle(page, 4000);
    await page.screenshot({ path: resolve(SHOTS, name + '.png'), timeout: 240000, caret: 'hide' });
  } finally {
    if (held) await page.evaluate(() => window.__WH__.resume()).catch(() => {});
  }
}
/** deterministic: pause the rAF loop and advance the sim (and the stage) by `seconds` in 1/60 steps, rendering once at the end */
const stepSim = (page, seconds) => page.evaluate((s) => { window.__WH__.step(1 / 60, Math.round(s * 60)); }, seconds);
/** step in slices until fn(state) holds (or `max` seconds pass); returns the sim seconds it took, or -1. Each slice yields a task, so the
 *  promise continuations the shell runs between frames (a ceremony's `await handle.done` -> adopt the result) happen as they do live. */
async function stepUntil(page, fnSrc, max = 8, slice = 0.1) {
  return page.evaluate(async ([src, mx, sl]) => {
    const fn = new Function('wh', `return (${src})(wh);`);
    let t = 0;
    while (t <= mx + 1e-9) {
      if (fn(window.__WH__)) return t;
      window.__WH__.step(1 / 60, Math.max(1, Math.round(sl * 60)));
      t += sl;
      await new Promise((r) => setTimeout(r, 0));
    }
    return -1;
  }, [fnSrc, max, slice]);
}
/** the capsule DOM twin, clicked like a person would (Playwright waits until it is visible, enabled and still); its state on failure */
async function clickOpen(page) {
  try { await page.click('.capsule-btn', { timeout: 60000 }); return true; } catch (e) {
    const st = await page.evaluate(() => { const b = document.querySelector('.capsule-btn'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hidden: b.hidden, disabled: b.disabled, rect: [r.x, r.y, r.width, r.height], top: top ? top.className || top.tagName : null, meter: window.__WH__.shell.meter(), cer: window.__WH__.shell.ceremony() }; });
    check('the capsule button can be clicked', false, JSON.stringify(st));
    return false;
  }
}

/** page.click with a diagnosis when it cannot click: what covers the element, its state, the ceremony */
async function clickSel(page, sel, what) {
  try { await page.click(sel, { timeout: 60000 }); return true; } catch (e) {
    const st = await page.evaluate((q) => { const b = document.querySelector(q); if (!b) return { missing: true }; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const cs = getComputedStyle(b); return { disabled: b.disabled, rect: [r.x, r.y, r.width, r.height], top: top ? `${top.tagName}.${top.className}` : null, vis: cs.visibility, op: cs.opacity, inert: !!b.closest('[inert]'), phase: document.body.dataset.phase, cer: window.__WH__?.shell.ceremony() }; }, sel);
    check(`${what} can be clicked`, false, `${String(e.message).split('\n')[0]} ${JSON.stringify(st)}`);
    return false;
  }
}

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
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); if (!b.width && !b.height) return null; return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const hint = q('.hint');
    const panel = q('.panel');
    return {
      sw: d.scrollWidth, sh: d.scrollHeight, iw: innerWidth, ih: innerHeight, bsw: document.body.scrollWidth, bsh: document.body.scrollHeight,
      gear: r(q('.hud-actions button[aria-label="Settings"]')), mute: r(q('.hud-actions button[aria-pressed]')), hint: r(hint), hintShow: hint?.dataset.show, name: r(q('.nametag')), wordmark: r(q('.wordmark')), panel: r(panel),
      meter: r(q('.meter')), capsuleBtn: r(q('.capsule-btn:not([hidden])')),
      hintFont: hint ? parseFloat(getComputedStyle(hint).fontSize) : 0, hintClipped: hint ? hint.scrollWidth > hint.clientWidth + 1 : false,
      hintLines: hint ? (() => { const rg = document.createRange(); rg.selectNodeContents(hint); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })() : 0,
      panelScroll: panel ? { sh: panel.scrollHeight, ch: panel.clientHeight } : null,
      labels: panel && panel.dataset.open === 'true' ? [...panel.querySelectorAll('.row-label, .panel-title, .panel-group')].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent, x: b.x, r: b.right, w: b.width, sw: e.scrollWidth, cw: e.clientWidth }; }) : [],
    };
  });
}
const overlap = (a, b) => a && b && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
/** let the page settle before measuring a layout: two animation frames (ResizeObserver work such as the hint fit runs in between), then
 *  every running finite CSS transition / animation (the settings sheet sliding in) to its end. SwiftShader frames can take a second. */
async function settle(page, timeoutMs = 10000) {
  await page.evaluate(async (to) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    await raf(); await raf();
    const anims = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime ?? Infinity));
    await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, to))]);
    await raf();
  }, timeoutMs);
}

// =====================================================================================================
async function main() {
  // the shell-core node checks (mock-driven + the real SoftBody calibration): no browser needed
  await section('node-core', async () => {
    const r = spawnSync(process.execPath, [resolve(ROOT, '_harness/shellview/node_checks.ts')], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = /(\d+)\/(\d+) shell-core node checks passed/.exec(out);
    const fails = out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 4);
    for (const l of out.split('\n').filter((x) => /calibration/.test(x))) console.log('   ' + l);
    check('shell-core node checks (_harness/shellview/node_checks.ts) all pass', r.status === 0 && !!m && m[1] === m[2], m ? `${m[1]}/${m[2]}${fails.length ? ' ' + fails.join(' | ') : ''}` : out.slice(-300));
  });

  srv = await startVite(PORT);
  browser = await launch();
  const mainWatches = []; // contexts whose console / network must be perfectly clean
  try {
    // ------------------------------------------------------------------------------------------------
    // G3: boot, title card, wake, canvas, HUD
    // ------------------------------------------------------------------------------------------------
    let D = null;
    await section('desktop-boot', async () => {
      const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
      const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1]) || m[2].trim()).length;
      const inlineStyles = (html.match(/<style\b/gi) ?? []).length + (html.match(/\sstyle=/gi) ?? []).length;
      check('index.html: no inline <script>, no <style>, no style="" (a strict CSP works; audit finding 21)', inlineScripts === 0 && inlineStyles === 0, `inline scripts ${inlineScripts}, styles ${inlineStyles}`);
      D = await open({ query: '?dev=1' });
      mainWatches.push(['desktop', D.w]);
      const { page } = D;
      const t = await page.evaluate(() => ({
        mark: document.querySelector('.title-mark')?.textContent, promise: document.querySelector('.title-promise')?.textContent,
        btn: document.querySelector('.cta')?.textContent, disabled: document.querySelector('.cta')?.disabled, role: document.querySelector('.title')?.getAttribute('role'),
        h1: document.querySelector('h1')?.textContent, viewport: document.querySelector('meta[name=viewport]')?.content, theme: document.querySelector('meta[name=theme-color]')?.content,
        hudHidden: getComputedStyle(document.querySelector('.hud')).visibility,
      }));
      check('title card: wordmark, one-line promise, one big input-neutral button "Wake it up" (enabled once loaded; audit finding 17)', (t.mark ?? '').replace(/\s/g, '') === GAME_MARK.replace(/\s/g, '') && t.btn === 'Wake it up' && t.disabled === false && !!t.promise && t.role === 'dialog', JSON.stringify(t));
      check('index.html: viewport-fit=cover, theme-color is the ink token, one h1 for assistive tech', /viewport-fit=cover/.test(t.viewport) && t.theme === '#14102a' && t.h1 === GAME_MARK);
      check('title card: the HUD is not shown (or reachable) underneath it', t.hudHidden === 'hidden');
      // the three wordmark checks (the owner's rename to Squish Keeper, 2026-10-06): exact text, not whitespace-folded
      const marks = await page.evaluate(() => ({ titleMark: document.querySelector('.title-mark')?.textContent, h1: [...document.querySelectorAll('h1')].map((e) => e.textContent), wordmark: document.querySelector('.wordmark')?.textContent }));
      check("wordmark: the title card's .title-mark textContent is exactly 'SQUISHKEEPER' (one letter per span, the gap is a spacer)", marks.titleMark === 'SQUISHKEEPER', JSON.stringify(marks.titleMark));
      check("wordmark: the page's h1 reads exactly 'SQUISH KEEPER' (and there is one h1)", marks.h1.length === 1 && marks.h1[0] === 'SQUISH KEEPER', JSON.stringify(marks.h1));
      check("wordmark: the HUD's .wordmark reads exactly 'SQUISH KEEPER'", marks.wordmark === 'SQUISH KEEPER', JSON.stringify(marks.wordmark));
      const a0 = await state(page);
      check('audio is locked before the gesture (nothing created before unlock)', a0.audio.state === 'locked' || a0.audio.state === 'suspended', a0.audio.state);
      const sig0 = await canvasSig(page);
      check('canvas is not blank behind the title card', sig0.sd > 4 && sig0.colors > 12, `sd ${sig0.sd.toFixed(1)}, ${sig0.colors} colours`);
      // the tagline's own pill keeps 4.5:1 over the squishy (audit finding 16): composite the pill background over the canvas pixels under it
      const con = await page.evaluate(async () => {
        const wh = window.__WH__; wh.pause(); wh.step(1 / 60, 1);
        const cv = document.getElementById('stage');
        const url = cv.toDataURL('image/png'); wh.resume();
        const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
        const el = document.querySelector('.title-promise'); const r = el.getBoundingClientRect();
        const sx = cv.width / cv.clientWidth, sy = cv.height / cv.clientHeight;
        const W = Math.max(1, Math.round(r.width * sx)), H = Math.max(1, Math.round(r.height * sy));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(img, r.x * sx, r.y * sy, r.width * sx, r.height * sy, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        const bg = getComputedStyle(el).backgroundColor;
        const nums = (bg.match(/[\d.]+/g) ?? []).map(Number);
        const isSrgbFn = /^color\(srgb/.test(bg);
        const [br, bgc, bb] = isSrgbFn ? [nums[0] * 255, nums[1] * 255, nums[2] * 255] : [nums[0], nums[1], nums[2]];
        const alpha = nums.length >= 4 ? nums[3] : 1;
        const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        const L = (r2, g2, b2) => 0.2126 * lin(r2) + 0.7152 * lin(g2) + 0.0722 * lin(b2);
        const fg = L(255, 241, 214);
        const ratios = [];
        for (let i = 0; i < d.length; i += 4) {
          const r2 = alpha * br + (1 - alpha) * d[i], g2 = alpha * bgc + (1 - alpha) * d[i + 1], b2 = alpha * bb + (1 - alpha) * d[i + 2];
          const lb = L(r2, g2, b2);
          ratios.push((Math.max(fg, lb) + 0.05) / (Math.min(fg, lb) + 0.05));
        }
        ratios.sort((a, b) => a - b);
        return { min: ratios[0], p05: ratios[Math.floor(ratios.length * 0.05)], alpha, bg };
      });
      check('title tagline: >= 4.5:1 on every pixel of its pill over the live canvas (the old tagline reached 1.84:1)', con.min >= 4.5, `min ${con.min.toFixed(2)}, p05 ${con.p05.toFixed(2)}, pill alpha ${con.alpha}`);
      await sleep(700);
      await shot(page, 'title_desktop');
      await wake(page);
      const a1 = await state(page);
      check('title card -> play on the button press; audio unlocked by that same gesture (state running)', a1.phase === 'play' && a1.audio.state === 'running', `${a1.phase} / ${a1.audio.state}`);
      const hud = await page.evaluate(() => ({
        wordmark: document.querySelector('.wordmark')?.textContent, name: document.querySelector('.nametag-name')?.textContent, tier: document.querySelector('.nametag-tier')?.textContent,
        gem: !!document.querySelector('.nametag svg.gem'), hint: document.querySelector('.hint')?.textContent, hintShow: document.querySelector('.hint')?.dataset.show,
        gear: !!document.querySelector('button[aria-label="Settings"]'), mute: !!document.querySelector('button[aria-label="Mute sound"]'),
        meter: document.querySelector('[role=meter]')?.getAttribute('aria-valuenow'), focus: document.activeElement?.id || document.activeElement?.tagName,
        ring: getComputedStyle(document.querySelector('.play-target')).boxShadow,
      }));
      check('HUD: wordmark, gear + mute, the catalog species name "Dollop" with its tier gem and label "Common" (audit finding 19), a meter ring (role=meter)',
        hud.wordmark === GAME_MARK && hud.name === 'Dollop' && /common/i.test(hud.tier) && hud.gem && hud.gear && hud.mute && hud.meter === '0', JSON.stringify(hud));
      check('HUD hint: pointer wording with the one pull wording ("drag out to stretch")', hud.hintShow === 'true' && /^Click to poke/.test(hud.hint) && /drag out to stretch/.test(hud.hint), hud.hint);
      check('a mouse start does not park a focus ring on the squishy', hud.focus !== 'wh-play' && hud.ring === 'none', `${hud.focus} / ${hud.ring}`);
      const sig = await canvasSig(page);
      check('canvas not blank in play', sig.sd > 4 && sig.colors > 12, `sd ${sig.sd.toFixed(1)}`);
      const b = await body(page);
      check('debug hook: bodyScreen() reports the squishy near the middle of the canvas', !!b && b.x > 0.3 && b.x < 0.7 && b.y > 0.25 && b.y < 0.8 && b.rPx > 40, JSON.stringify(b));
      await sleep(600);
      await shot(page, 'play_rest_desktop');
      const hs = await page.evaluate(() => window.__WH__.shot('canvas_only_rest'));
      check('debug hook: shot(name) posts the canvas to /__shot and the file lands under _shots/', hs.ok === true && /canvas_only_rest\.png$/.test(hs.path ?? '') && existsSync(hs.path), JSON.stringify(hs));
      check('hook shape: version 1, state() carries every documented field, plus the shell dev API', await page.evaluate(() => {
        const h = window.__WH__; const s = h.state();
        return h.version === 1 && ['phase', 'metrics', 'settings', 'genome', 'genomeCode', 'fps', 'stage', 'audio', 'events', 'stateHash'].every((k) => k in s)
          && ['pause', 'resume', 'step', 'pointerDown', 'pointerMove', 'pointerUp', 'setGenome', 'setSetting', 'shot', 'playSound', 'bodyScreen'].every((k) => typeof h[k] === 'function')
          && ['meter', 'grant', 'fill', 'capsuleScreen', 'openCapsule', 'merge', 'ceremony', 'skip', 'identity', 'stageInfo'].every((k) => typeof h.shell[k] === 'function');
      }));
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
      // sample the deepest metrics.press of this touch every frame (the release FX rule reads it; see the bubble check below)
      await page.evaluate(() => {
        window.__pk = { has: false, peak: 0 };
        const f = () => { const m = window.__WH__.state().metrics; if (typeof m.press === 'number') { window.__pk.has = true; if (m.fingers > 0) window.__pk.peak = Math.max(window.__pk.peak, m.press); } window.__pkRaf = requestAnimationFrame(f); };
        f();
      });
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
      const peak = await page.evaluate(() => window.__pk);
      await page.mouse.up();
      const rel = await waitEvent(page, seenRel, 'release', { finger: 0, timeout: 40000 });
      const a4 = await started(page);
      check('mouse release -> a release SoftEvent and an audio release voice', !!rel && a4.release === a3.release + 1, `release intensity ${rel?.intensity?.toFixed(2)}, audio.release ${a3.release}->${a4.release}`);
      const relI = rel?.intensity ?? 0;
      const pk = await page.evaluate(() => { cancelAnimationFrame(window.__pkRaf); return window.__pk; });
      // feel.ts releaseFxLevel: with metrics.press the deepest press of the touch (>= 0.7) gates the bubbles, else release intensity > 0.3.
      // Sampled per frame here (the shell reads every sim step), so a peak within 0.03 of the line is reported but not judged.
      const lvl = pk.has ? Math.max(pk.peak, peak?.peak ?? 0, relI) : relI;
      const line = pk.has ? 0.7 : 0.3;
      const wantPops = lvl >= line;
      const popped = await waitUntil(page, (n) => window.__WH__.state().audio.started.pop > n, a3.pop, wantPops ? 30000 : 3000);
      const borderline = pk.has && Math.abs(lvl - line) < 0.03;
      check('a deep squeeze release spawns bubble pops and a gentler one stays quiet (press >= 0.7 with metrics.press, else intensity > 0.3)', borderline || (wantPops ? popped : !popped), `press ${pk.has ? lvl.toFixed(2) : 'n/a'}, release intensity ${relI.toFixed(2)}, expected ${wantPops ? 'pops' : 'none'}${borderline ? ' (borderline, not judged)' : ''}, pops ${a3.pop}->${(await started(page)).pop}`);
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
    });

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
        // the deepest metrics.press of the touch, sampled every sim step while the finger is down (the shell's release FX rule reads it)
        let peakPress = 0, hasPress = false;
        const notePress = () => { const m = wh.state().metrics; if (typeof m.press === 'number') { hasPress = true; if (m.fingers > 0) peakPress = Math.max(peakPress, m.press); } };
        for (let i = 0; i < 96; i++) { wh.step(1 / 60, 1); notePress(); if (i % 12 === 11) comp.push(+wh.state().metrics.compression.toFixed(3)); }
        const held = wh.state();
        log.hold = { comp, voices: held.audio.started.squish - s0.audio.started.squish, fingers: held.metrics.fingers, volume: held.metrics.volume };
        wh.pointerUp();
        for (let i = 0; i < 20; i++) { wh.step(1 / 60, 1); notePress(); }
        log.press = { hasPress, peakPress, reaction: typeof wh.state().metrics.reaction === 'number' };
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
      {
        // src/shell/feel.ts releaseFxLevel: a body that reports `press` pops bubbles when max(peak press of the touch, intensity) >= 0.7
        // (CALIBRATION.bubblePressAt); a body without it, above release intensity 0.3 (the slice compensation, CALIBRATION.bubbleAt)
        const I = out.release.maxIntensity, P = out.press;
        const want = P.hasPress ? Math.max(P.peakPress, I) >= 0.7 : I > 0.3;
        check('hook release: bubbles pop only after a deep squeeze (press >= 0.7 with metrics.press, else intensity > 0.3), never more than 3', out.afterRelease.pops <= 3 && (want ? out.afterRelease.pops >= 1 : out.afterRelease.pops === 0), `press ${P.hasPress ? P.peakPress.toFixed(2) : 'n/a'}, intensity ${I.toFixed(2)}, expected ${want ? 'pops' : 'none'}, pops ${out.afterRelease.pops}`);
      }
      check('press-driven path is live: the play body reports metrics.press and metrics.reaction, so the squelch (max(compression, press)), the bubbles (peak press) and the pull (contract pull level) run on the contract scales, not the slice fallbacks',
        out.press.hasPress && out.press.reaction && out.press.peakPress > 0.5, JSON.stringify(out.press));
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
    // G3: settings panel (desktop): every control, persistence, focus (Escape -> the squishy; close -> the gear), haptics hidden here
    // ------------------------------------------------------------------------------------------------
    await section('settings-panel-desktop', async () => {
      const { page } = D;
      await page.evaluate(() => localStorage.removeItem('wobblehoard:v1:settings'));
      await page.click('button[aria-label="Settings"]');
      await waitUntil(page, () => document.querySelector('.panel').dataset.open === 'true' && getComputedStyle(document.querySelector('.panel')).opacity === '1', null, 8000);
      const info = await page.evaluate(() => ({
        open: document.querySelector('.panel').dataset.open, expanded: document.querySelector('button[aria-label="Settings"]').getAttribute('aria-expanded'),
        focus: document.activeElement?.id, role: document.querySelector('.panel').getAttribute('role'), label: document.querySelector('.panel').getAttribute('aria-labelledby'),
        labels: [...document.querySelectorAll('.panel .row-label')].filter((e) => e.offsetParent !== null).map((e) => e.textContent),
        vibrate: typeof navigator.vibrate, touch: navigator.maxTouchPoints,
      }));
      check('settings: the gear opens the panel (aria-expanded, role=dialog, labelled) and focus moves into it', info.open === 'true' && info.expanded === 'true' && info.focus === 'wh-settings-title' && info.role === 'dialog' && info.label === 'wh-settings-title', JSON.stringify(info));
      const want = ['Volume', 'Music', 'Louder squish', 'Extra squish', 'Gravity', 'Calm effects', 'Screen shake', 'Skip animations', 'Fast open', 'Keyboard shortcuts', 'Quality'];
      check('settings: Volume, Music, Louder squish, Extra squish, Gravity, Calm effects, Screen shake, Skip animations, Fast open, Keyboard shortcuts, Quality', want.every((l) => info.labels.includes(l)), info.labels.join(' | '));
      check('settings: no Haptics switch on a desktop without touch, although navigator.vibrate exists (it is a no-op there; audit finding 18)', !info.labels.includes('Haptics') && info.vibrate === 'function' && info.touch === 0 && (await state(page)).settings.haptics === false, JSON.stringify({ vibrate: info.vibrate, touch: info.touch }));
      await shot(page, 'settings_desktop');
      const sizes = await page.evaluate(() => [...document.querySelectorAll('.panel input[type=range], .panel .seg-face, .panel select, .panel .row-switch, .panel .icon-btn, .hud-actions .icon-btn')].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className || e.tagName, w: Math.round(b.width), h: Math.round(b.height) }; }));
      check('settings: every control has a >= 44 px touch target', sizes.length >= 12 && sizes.every((s) => s.h >= 44 && s.w >= 44), sizes.filter((s) => s.h < 44 || s.w < 44).map((s) => `${s.cls} ${s.w}x${s.h}`).join(', ') || `${sizes.length} controls checked`);
      // change things with the keyboard (and a radio click, a select, two switches) = the accessible paths
      await page.focus('#wh-volume'); await page.keyboard.press('Home');
      await page.focus('#wh-shake'); await page.keyboard.press('Home');
      await page.focus('#wh-boost'); await page.keyboard.press('End');
      await page.focus('#wh-music'); await page.keyboard.press('Home');
      await page.click('.seg-opt:has(input[value=float])');
      await page.selectOption('#wh-quality', 'low');
      await page.focus('#wh-fast'); await page.keyboard.press('Space');
      await page.focus('#wh-extra'); await page.keyboard.press('Space');
      await sleep(500);
      let s = await state(page);
      check('settings: volume 0, shake 0, louder squish 1, music 0, float, quality low, fast open + extra squish on reach the app',
        s.settings.volume === 0 && s.settings.shake === 0 && s.settings.squishBoost === 1 && s.settings.music === 0 && s.settings.gravity === false && s.settings.quality === 'low' && s.settings.fastOpen === true && s.settings.extraSquish === true, JSON.stringify(s.settings));
      check('settings: quality low really switches the render tier', await waitUntil(page, () => window.__WH__.state().stage.tier === 'low', null, 10000), (await state(page)).stage.tier);
      const outs = await page.evaluate(() => ({ shake: document.querySelector('#wh-shake').parentElement.querySelector('output').textContent, boost: document.querySelector('#wh-boost').parentElement.querySelector('output').textContent, music: document.querySelector('#wh-music').parentElement.querySelector('output').textContent }));
      check('settings: value readouts in words (shake Off, music Off, louder squish "Lots": no dB)', outs.shake === 'Off' && outs.boost === 'Lots' && outs.music === 'Off', JSON.stringify(outs));
      // Escape: back to the squishy (Space then pokes instead of reopening the panel)
      await page.keyboard.press('Escape');
      await waitUntil(page, () => getComputedStyle(document.querySelector('.panel')).visibility === 'hidden', null, 20000);
      const closed = await page.evaluate(() => ({ open: document.querySelector('.panel').dataset.open, focus: document.activeElement?.id, inert: document.querySelector('.panel').hasAttribute('inert'), vis: getComputedStyle(document.querySelector('.panel')).visibility, ring: getComputedStyle(document.activeElement).boxShadow }));
      check('settings: Escape closes it, focus lands on the squishy (with its ring), the closed panel is inert + hidden (audit finding 13)', closed.open === 'false' && closed.focus === 'wh-play' && closed.inert && closed.vis === 'hidden' && closed.ring !== 'none', JSON.stringify(closed));
      const seen = await evKeys(page);
      const a0 = await started(page);
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space');
      const kp = await waitEvent(page, seen, 'poke', { timeout: 40000 });
      check('settings: after Escape, Space pokes the squishy (not the gear)', !!kp && (await started(page)).poke === a0.poke + 1 && await page.evaluate(() => document.querySelector('.panel').dataset.open === 'false'));
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      // the close button returns focus to the gear
      await page.click('button[aria-label="Settings"]'); await sleep(400);
      await page.focus('.panel .icon-btn'); await page.keyboard.press('Enter'); await sleep(400);
      check('settings: the close button returns focus to the gear', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Settings'));
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:settings')));
      check('settings: persisted under wobblehoard:v1:settings as v: 2 with the chosen round-2 fields', stored && stored.v === 2 && stored.volume === 0 && stored.quality === 'low' && stored.gravity === false && stored.squishBoost === 1 && stored.music === 0 && stored.fastOpen === true && stored.extraSquish === true && !('calm' in stored), JSON.stringify(stored));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      const afterReload = await state(page);
      check('settings: survive a reload', afterReload.settings.volume === 0 && afterReload.settings.quality === 'low' && afterReload.settings.gravity === false && afterReload.settings.shake === 0 && afterReload.settings.music === 0 && afterReload.settings.fastOpen === true, JSON.stringify(afterReload.settings));
      await wake(page);
      await page.click('button[aria-label="Settings"]');
      await sleep(500);
      const ui = await page.evaluate(() => ({ vol: document.querySelector('#wh-volume').value, music: document.querySelector('#wh-music').value, q: document.querySelector('#wh-quality').value, floatChecked: document.querySelector('input[value=float]').checked, fast: document.querySelector('#wh-fast').checked }));
      check('settings: the reloaded panel shows the saved values', ui.vol === '0' && ui.music === '0' && ui.q === 'low' && ui.floatChecked === true && ui.fast === true, JSON.stringify(ui));
      await page.focus('.panel .icon-btn');
      for (let i = 0; i < 18; i++) await page.keyboard.press('Tab');
      check('settings: Tab keeps focus inside the open panel (wraps)', await page.evaluate(() => document.querySelector('.panel').contains(document.activeElement)));
      const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); const sw = a.matches('input[role=switch]') ? getComputedStyle(a.nextElementSibling) : null; return { vis: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, swOutline: sw ? sw.outlineStyle + ' ' + sw.outlineWidth : null, tag: a.tagName }; });
      check('settings: keyboard focus shows a visible focus ring', ring.vis && (ring.outline !== 'none 0px' || (ring.swOutline && ring.swOutline !== 'none 0px')), JSON.stringify(ring));
      await page.keyboard.press('Escape');
      await page.evaluate(() => localStorage.removeItem('wobblehoard:v1:settings'));
      await D.context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // the capsule loop (round 2): meter ring -> meter full -> capsule drop -> hold to open -> reveal -> result adopted
    // The meter is accelerated through the dev-only hook (shell.fill feeds the REAL collection -> meter.ts path with pokes on a clock pushed
    // ahead of the wall clock: collection.feed anchors any ms clock to that epoch clock); the sim is
    // stepped deterministically (SwiftShader renders a 1280x800 frame in ~0.3 s on this shared machine).
    // ------------------------------------------------------------------------------------------------
    let C = null;
    await section('capsule-loop', async () => {
      // a section that failed half-way leaves its page open and rendering: close it, or every later page competes with it for the CPU
      if (D) { try { await D.context.close(); } catch { /* closed */ } D = null; }
      C = await open({ query: '?dev=1' });
      mainWatches.push(['capsule', C.w]);
      const { page } = C;
      await wake(page);
      const m0 = await meter(page);
      check('meter: the collection module (practice ledger, a fresh v2 save) feeds the ring, empty at start', m0.ledger === 'practice' && ['fresh', 'migrated'].includes(m0.load) && m0.credits === 0 && m0.fill === 0, JSON.stringify(m0));
      // real touches move the ring (poke -> 0.8 SP of the first 30)
      const B = await body(page); const vp = page.viewportSize();
      await page.mouse.click(B.x * vp.width, B.y * vp.height - 20);
      const moved = await waitUntil(page, () => window.__WH__.shell.meter().fill > 0, null, 30000);
      check('meter: a real poke moves the ring (SoftEvent -> collection.feed -> meter.ts)', moved, JSON.stringify(await meter(page)));
      await page.evaluate(() => window.__WH__.shell.fill(0.5));
      await sleep(600);
      const half = await page.evaluate(() => ({ now: Number(document.querySelector('[role=meter]').getAttribute('aria-valuenow')), text: document.querySelector('[role=meter]').getAttribute('aria-valuetext'), fill: window.__WH__.shell.meter().fill }));
      check('meter ring: role=meter shows the fill as a percentage with a text value (COLLECTION 9.7, 9.10)', Math.abs(half.now - Math.round(half.fill * 100)) <= 1 && half.now >= 45 && half.now <= 60 && /%/.test(half.text), JSON.stringify(half));
      await shot(page, 'meter_half_desktop');
      const a0 = await started(page);
      await page.evaluate(() => window.__WH__.shell.fill(1));
      const pulse = await page.evaluate(() => document.querySelector('.meter').classList.contains('pulse'));
      await sleep(500);
      const m1 = await meter(page), a1 = await started(page);
      check('meter full: a capsule is earned, audio.meterFull plays once, the ring pulses once (400 ms)', m1.credits === 1 && (a1.meterFull ?? 0) === (a0.meterFull ?? 0) + 1 && pulse, `credits ${m1.credits}, meterFull ${a0.meterFull ?? 0}->${a1.meterFull ?? 0}, pulse ${pulse}`);
      check('live region: "A capsule is ready."', /capsule is ready/i.test(await live(page)), await live(page));
      const landedAfter = await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 4, 0.1);
      const info = await page.evaluate(() => window.__WH__.shell.stageInfo());
      check('the capsule drops beside the squishy and lands (stage.dropCapsule; tappable only once landed)', landedAfter >= 0 && info?.capsule === true, `landed after ${landedAfter.toFixed(2)} s sim`);
      const cs = await page.evaluate(() => window.__WH__.shell.capsuleScreen());
      check('the landed capsule is on screen', !!cs && cs.x > 0.05 && cs.x < 0.95 && cs.y > 0.1 && cs.y < 0.95, JSON.stringify(cs));
      const btn = await page.evaluate(() => { const b = document.querySelector('.capsule-btn'); return { hidden: b.hidden, label: b.getAttribute('aria-label'), text: b.textContent }; });
      check('DOM twin: a button "Open a capsule (1 waiting)" (the 3D capsule is never the only way: COLLECTION 9.4 / 9.10)', !btn.hidden && btn.label === 'Open a capsule (1 waiting)', JSON.stringify(btn));
      await shot(page, 'capsule_on_table_desktop');
      // hold to open through the SAME pointer path as a finger (DebugHook synthetic pointer at the capsule)
      const ev0 = await evKeys(page);
      await page.evaluate((p) => { window.__WH__.pointerDown(p.x, p.y, 3); window.__WH__.step(1 / 60, 15); }, cs);
      const holding = await page.evaluate(() => ({ m: window.__WH__.shell.meter(), fingers: window.__WH__.state().metrics.fingers }));
      check('hold-to-open: the press belongs to the capsule (holding, no finger on the squishy)', holding.m.holding && holding.fingers === 0, JSON.stringify({ holding: holding.m.holding, fingers: holding.fingers }));
      await shot(page, 'capsule_squeeze_desktop');
      await page.evaluate(() => window.__WH__.step(1 / 60, 20));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const cer = await page.evaluate(() => window.__WH__.shell.ceremony());
      check('hold-to-open: at 0.5 s the collection answers first, then the reveal starts (result first)', cer.kind === 'capsule' && cer.duration > 0.5, JSON.stringify(cer));
      await page.evaluate(() => window.__WH__.pointerUp(3));
      const shownAt = await stepUntil(page, `(wh) => document.querySelector('.plate').dataset.show === 'true'`, 6, 0.05);
      const plate = await page.evaluate(() => ({ chip: document.querySelector('.plate-chip')?.textContent, kind: document.querySelector('.plate-chip')?.dataset.kind, name: document.querySelector('.plate-name')?.textContent, tier: document.querySelector('.plate-tier')?.textContent, gem: document.querySelector('.plate svg.gem')?.dataset.tier }));
      await shot(page, 'capsule_reveal_plate_desktop');
      check('reveal: at the reveal beat the name plate shows the species, its tier gem + label and a NEW badge or an "x2 spare" chip', shownAt >= 0 && !!plate.name && !!plate.tier && !!plate.gem && (plate.chip === 'NEW' || /^x\d+ spare$/.test(plate.chip ?? '')), JSON.stringify(plate));
      await sleep(400);
      check('live region: the reveal is announced ("New! <species>, <tier>." or "You have N.")', new RegExp(plate.name ?? '###').test(await live(page)), await live(page));
      const endAt = await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 6, 0.1);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const a2 = await started(page);
      const id = await page.evaluate(() => window.__WH__.shell.identity());
      check('reveal sounds: capsuleBeat grab / crack / burst and the tier motif (audio.started.capsule >= 3, reveal +1)', (a2.capsule ?? 0) - (a1.capsule ?? 0) >= 3 && (a2.reveal ?? 0) === (a1.reveal ?? 0) + 1, `capsule +${(a2.capsule ?? 0) - (a1.capsule ?? 0)}, reveal +${(a2.reveal ?? 0) - (a1.reveal ?? 0)}`);
      const hudName = await page.evaluate(() => document.querySelector('.nametag-name').textContent);
      check('after the reveal: the result is the play body (identity, HUD name = the plate), credits back to 0', endAt >= 0 && id.species === plate.name && hudName === plate.name && (await meter(page)).credits === 0, JSON.stringify({ id, hudName, endAt }));
      // the adopted body is touchable: a poke lands on it
      const B2 = await body(page);
      const seen = await evKeys(page);
      await page.evaluate((b) => { window.__WH__.pointerDown(b.x, b.y - 0.25 * b.rPx / innerHeight, 0); window.__WH__.step(1 / 60, 4); window.__WH__.pointerUp(0); window.__WH__.step(1 / 60, 20); }, B2);
      const kinds = await page.evaluate((s) => { const set = new Set(s); return window.__WH__.state().events.filter((e) => !set.has(JSON.stringify(e))).map((e) => e.kind); }, seen);
      check('the adopted result body takes the next poke (fingers reach it, a poke event comes back)', kinds.includes('poke'), kinds.join());
      await page.evaluate(() => { window.__WH__.step(1 / 60, 30); window.__WH__.resume(); });
      await sleep(800);
      await shot(page, 'after_reveal_desktop');
      void ev0;
    });

    // ------------------------------------------------------------------------------------------------
    // the dev merge entry (MERGE 7 order: the result is decided before the ceremony; SHELL-2b builds the pad)
    // ------------------------------------------------------------------------------------------------
    await section('merge-dev', async () => {
      const { page } = C;
      const a0 = await started(page);
      await page.evaluate(() => { window.__WH__.pause(); window.__mergeP = window.__WH__.shell.merge({ tierUp: true, isNew: true }); });
      const cer = await page.evaluate(() => window.__WH__.shell.ceremony());
      check('merge entry: MERGE_COST parents + a decided result start stage.playMergeCeremony at once', cer.kind === 'merge' && cer.duration > 2, JSON.stringify(cer));
      await stepSim(page, 1.0);
      await shot(page, 'merge_charge_desktop');
      const a1 = await started(page);
      check('merge T0: audio.mergeStart at the press beat (hum, squelch, ticks)', (a1.merge ?? 0) === (a0.merge ?? 0) + 1, `merge ${a0.merge ?? 0}->${a1.merge ?? 0}`);
      const shownAt = await stepUntil(page, `(wh) => document.querySelector('.plate').dataset.show === 'true'`, 6, 0.05);
      const plate = await page.evaluate(() => ({ banner: !document.querySelector('.plate-banner').hidden, chip: document.querySelector('.plate-chip')?.textContent, name: document.querySelector('.plate-name')?.textContent }));
      await shot(page, 'merge_reveal_plate_desktop');
      const a2 = await started(page);
      check('merge T3/T4: burst() at the burst beat, then the plate with TIER UP and NEW', shownAt >= 0 && (a2.mergeBurst ?? 0) === (a0.mergeBurst ?? 0) + 1 && plate.banner && plate.chip === 'NEW', JSON.stringify(plate));
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 6, 0.1);
      const res = await page.evaluate(async () => { const r = await window.__mergeP; return { r, id: window.__WH__.shell.identity() }; });
      check('merge end: the result body is adopted as the play body (identity = the decided result)', res.id.genomeCode === res.r.result && res.id.species === plate.name, JSON.stringify(res));
      await page.evaluate(() => window.__WH__.resume());
    });

    // ------------------------------------------------------------------------------------------------
    // skip: the 350 ms gate, the result never hidden, a merge skipped before T3 stops its hum
    // ------------------------------------------------------------------------------------------------
    await section('skip-timing', async () => {
      const { page } = C;
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
      await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 4, 0.1);
      if (!(await clickOpen(page))) return;                  // the DOM twin
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      check('skip setup: the DOM twin opened a capsule (reveal running)', (await page.evaluate(() => window.__WH__.shell.ceremony())).kind === 'capsule');
      await stepSim(page, 0.2);
      const B = await body(page);
      const tap = (b) => page.evaluate((p) => { window.__WH__.pointerDown(p.x, p.y, 4); window.__WH__.pointerUp(4); }, b);
      await tap(B);
      const at200 = await page.evaluate(() => window.__WH__.shell.ceremony());
      check('skip gate: a tap at 0.2 s is swallowed (no finger on the squishy) and does NOT skip', at200.kind === 'capsule' && at200.elapsedMs < 350 && (await state(page)).metrics.fingers === 0, JSON.stringify(at200));
      await stepSim(page, 0.2);
      await tap(B);
      const endAt = await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 1, 1 / 60);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const plateShown = await page.evaluate(() => document.querySelector('.plate').dataset.show === 'true');
      check('skip gate: a tap at 0.4 s skips: the ceremony ends within the 120 ms crossfade and the plate is shown (the result is never hidden)', endAt >= 0 && endAt <= 0.2 && plateShown, `ended ${endAt.toFixed(3)} s after the tap, plate ${plateShown}`);
      await shot(page, 'skip_capsule_desktop');
      // merge skipped before its burst: the hum stops, no burst, the motif plays
      const a0 = await started(page);
      await page.evaluate(() => { window.__mergeP = window.__WH__.shell.merge({ tierUp: false, isNew: false }); });
      await stepSim(page, 0.45);
      const humBefore = await page.evaluate(() => window.__WH__.state().audio.liveKinds?.merge ?? 0);
      await page.keyboard.press('Space');                    // a key during a ceremony = skip
      await stepSim(page, 2 / 60);
      const humAfter = await page.evaluate(() => window.__WH__.state().audio.liveKinds?.merge ?? 0);
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 1, 1 / 60);
      await page.evaluate(async () => { await window.__mergeP; });
      const a1 = await started(page);
      check('merge skipped before T3 (Space at 0.45 s): no burst, the motif plays instead (reveal +1)', (a1.merge ?? 0) === (a0.merge ?? 0) + 1 && (a1.mergeBurst ?? 0) === (a0.mergeBurst ?? 0) && (a1.reveal ?? 0) === (a0.reveal ?? 0) + 1, `merge +${(a1.merge ?? 0) - (a0.merge ?? 0)} burst +${(a1.mergeBurst ?? 0) - (a0.mergeBurst ?? 0)} reveal +${(a1.reveal ?? 0) - (a0.reveal ?? 0)}`);
      // the hum must be live right before the skip and stopped by it (mh.stop() on a 'reveal' without 'burst'), not left to run out
      check('merge skipped: the hum was live before the skip and is stopped two frames after it (mh.stop)', humBefore >= 1 && humAfter === 0, `live merge voices ${humBefore} -> ${humAfter}`);
      await page.evaluate(() => window.__WH__.resume());
      await loadNote(page, 'after skip-timing');
    });

    // ------------------------------------------------------------------------------------------------
    // flash safety (DESIGN 6.6): no ceremony starts within 1.0 s of the previous one's burst. A Mythic skipped right after its burst,
    // then the next open requested in the same breath: the open is queued (not lost) and its burst lands >= 1.0 s after the Mythic's.
    // ------------------------------------------------------------------------------------------------
    await section('ceremony-spacing', async () => {
      const { page } = C;
      await page.evaluate(() => window.__WH__.pause());
      await stepSim(page, 1.2);                                 // any earlier burst is older than the spacing
      const tFrom = await page.evaluate(() => { const b = window.__WH__.shell.beats(); return b.length ? b[b.length - 1].t : -1e15; });
      const credits0 = await page.evaluate(() => window.__WH__.shell.meter().credits);
      await page.evaluate(() => { window.__revP = window.__WH__.shell.reveal({ tier: 'mythic' }); });
      await page.evaluate(() => window.__WH__.shell.grant(1));   // a capsule for the next open (earned mid-ceremony: it waits, no drop)
      const toBurst = await stepUntil(page, `(wh) => wh.shell.beats().some((b) => b.beat === 'burst' && b.t > ${tFrom})`, 8, 1 / 60);
      const req = await page.evaluate(() => {
        const skipped = window.__WH__.shell.skip();               // skip right after the burst ...
        window.__openP = window.__WH__.shell.openCapsule();       // ... and ask for the next capsule at once
        return { skipped, credits: window.__WH__.shell.meter().credits };
      });
      const next = await stepUntil(page, `(wh) => wh.shell.beats().filter((b) => b.beat === 'burst' && b.t > ${tFrom}).length >= 2`, 8, 1 / 60);
      const bs = await page.evaluate((f) => window.__WH__.shell.beats().filter((b) => b.t > f), tFrom);
      const bursts = bs.filter((b) => b.beat === 'burst'), grabs = bs.filter((b) => b.beat === 'grab');
      const startGap = grabs.length >= 2 && bursts.length >= 1 ? grabs[1].t - bursts[0].t : NaN;
      const burstGap = bursts.length >= 2 ? bursts[1].t - bursts[0].t : NaN;
      check('flash safety: a Mythic skipped right after its burst, then the next open at once: the next ceremony starts >= 1.0 s after that burst, and its burst lands >= 1.0 s after it',
        toBurst >= 0 && req.skipped && next >= 0 && startGap >= 1000 && burstGap >= 1000, `credits at the request ${req.credits}; burst -> next start ${startGap.toFixed(0)} ms, burst -> burst ${burstGap.toFixed(0)} ms; beats ${bs.map((b) => b.beat).join(',')}`);
      check('flash safety: the wait is only the spacing (the next start comes within 0.1 s of the 1.0 s mark)', startGap < 1100, `${startGap.toFixed(0)} ms`);
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 8, 0.1);
      const fin = await page.evaluate(async () => { await window.__revP; await window.__openP; return { id: window.__WH__.shell.identity(), m: window.__WH__.shell.meter() }; });
      check('flash safety: the queued open was not lost (it played to the end, the capsule is spent, its result is the play body)', fin.m.credits === credits0 && !!fin.id.itemId && !fin.id.itemId.startsWith('dev-'), JSON.stringify({ itemId: fin.id.itemId, species: fin.id.species, credits: `${credits0} -> ${fin.m.credits}` }));
      await page.evaluate(() => window.__WH__.resume());
      await loadNote(page, 'after ceremony-spacing');
    });

    // ------------------------------------------------------------------------------------------------
    // Calm effects (DESIGN 6.6) and Skip animations
    // ------------------------------------------------------------------------------------------------
    await section('calm-mode', async () => {
      const { page } = C;
      await page.evaluate(() => window.__WH__.pause());     // no live WebGL frames while clicking through the panel (the DOM still runs)
      if (!(await clickSel(page, 'button[aria-label="Settings"]', 'the gear'))) return;
      await sleep(400);
      await page.focus('#wh-calm'); await page.keyboard.press('Space'); await sleep(300);
      await page.keyboard.press('Escape'); await sleep(300);
      const info = await page.evaluate(() => ({ s: window.__WH__.state().settings, stage: window.__WH__.shell.stageInfo(), body: document.body.dataset.calm }));
      check('calm: the switch reaches the stage (setCalmEffects: stage calm on) and the page (no pulses)', info.s.calm === true && info.stage?.calm === true && info.body === 'true', JSON.stringify({ calm: info.s.calm, stage: info.stage?.calm, body: info.body }));
      // a capsule left waiting by an earlier section would hide the fade-in: open it first
      while ((await meter(page)).credits > 0) { await page.evaluate(() => window.__WH__.pause()); await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 2, 0.05); if (!(await clickOpen(page))) return; await page.evaluate(() => new Promise((r) => setTimeout(r, 50))); await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true)); await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 2, 0.05); await page.evaluate(() => window.__WH__.setSetting('skipAnimations', false)); }
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
      const pulse = await page.evaluate(() => document.querySelector('.meter').classList.contains('pulse'));
      const landedAt = await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 2, 0.05);
      check('calm: no ring pulse; the capsule fades in where it stands (tappable after ~0.45 s, no drop)', !pulse && landedAt >= 0.3 && landedAt <= 0.7, `pulse ${pulse}, landed after ${landedAt.toFixed(2)} s`);
      if (!(await clickOpen(page))) return;
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const cer = await page.evaluate(() => window.__WH__.shell.ceremony());
      const budgets = [0.8, 1.6, 2.0, 2.6, 3.2, 3.9, 4.5].map((b) => b * 0.65);
      check('calm: the reveal runs x0.65 of its DESIGN 6.1 budget', budgets.some((b) => Math.abs(cer.duration - b) / b < 0.03), `duration ${cer.duration.toFixed(3)} s`);
      await stepSim(page, 0.6);
      const fx = await page.evaluate(() => window.__WH__.shell.stageInfo()?.cameraFx);
      check('calm: no camera moves during the reveal', !!fx && Math.abs(fx.dist - 1) < 1e-6 && Math.abs(fx.yaw) < 1e-6 && Math.abs(fx.pitch) < 1e-6, JSON.stringify(fx));
      await shot(page, 'calm_reveal_desktop');
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 6, 0.1);
      // Skip animations: straight to the reveal frame
      await page.evaluate(() => { window.__WH__.setSetting('skipAnimations', true); window.__WH__.shell.grant(1); });
      await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 2, 0.05);
      if (!(await clickOpen(page))) return;
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      const endAt = await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null`, 1, 1 / 60);
      check('Skip animations: the reveal jumps to its final frame at once (ends within the 120 ms crossfade), the plate shows', endAt >= 0 && endAt <= 0.2 && await page.evaluate(() => document.querySelector('.plate').dataset.show === 'true'), `ended after ${endAt.toFixed(3)} s`);
      await page.evaluate(() => { window.__WH__.setSetting('skipAnimations', false); window.__WH__.setSetting('calm', false); window.__WH__.resume(); });
      await C.context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // Visible XP (FUN.md 2, owner direction 2026-10-06): every paying touch sends sparks from the touch point into the meter ring, which
    // then fills with a short ease; a held stretch shows a lighter PENDING arc that grows while it is held and banks on release; Calm
    // effects shows no sparks (a soft glow on the ring instead).
    // ------------------------------------------------------------------------------------------------
    await section('xp', async () => {
      const { page, context, w } = await open({ query: '?dev=1' });
      mainWatches.push(['xp', w]);
      await wake(page);
      const C = 2 * Math.PI * 23;   // the ring's circumference in its own units (meterRing.ts R = 23)
      const ring = () => page.evaluate(() => {
        const f = document.querySelector('.meter-fill'), p = document.querySelector('.meter-pending'), m = document.querySelector('.meter');
        return {
          attr: parseFloat(f.getAttribute('stroke-dashoffset')), drawn: parseFloat(getComputedStyle(f).strokeDashoffset), now: Number(m.getAttribute('aria-valuenow')),
          pend: parseFloat((p.getAttribute('stroke-dasharray') || '0').split(/[ ,]+/)[0]), pendOn: m.dataset.pending ?? null, bank: m.dataset.bank ?? null, glow: m.dataset.glow ?? null,
          sparks: Number(document.querySelector('.sparks')?.dataset.launched ?? 0),
          flying: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('spark')).length,
          fill: window.__WH__.shell.meter().fill, source: window.__WH__.shell.xp?.().source ?? null,
        };
      });
      // 1. one quick poke, real mouse
      const r0 = await ring();
      const B = await body(page); const vp = page.viewportSize();
      await page.mouse.click(B.x * vp.width, B.y * vp.height - 0.3 * B.rPx);
      const launched = await waitUntil(page, (n) => Number(document.querySelector('.sparks')?.dataset.launched ?? 0) > n, r0.sparks, 30000);
      const r1 = await ring();
      // a still of the flight: hold the spark animations about half way while the screenshot is taken, then let them finish
      await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.target?.classList?.contains('spark')) { a.pause(); a.currentTime = 200; } });
      await page.screenshot({ path: resolve(SHOTS, 'xp_poke_sparks_desktop.png'), timeout: 240000, caret: 'hide' });
      await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.target?.classList?.contains('spark')) a.play(); });
      await sleep(1600);
      const r2 = await ring();
      const moved = r0.drawn - r2.drawn;
      check('XP: one quick poke sends sparks from the touch to the ring (3 or more, compositor animations), then the ring fills with a short ease',
        launched && r1.sparks - r0.sparks >= 3 && r2.fill > r0.fill && Math.abs(r1.drawn - r0.drawn) < 0.6 * Math.max(0.01, moved),
        `sparks +${r1.sparks - r0.sparks} (${r1.flying} flying), drawn offset ${r0.drawn.toFixed(2)} -> ${r1.drawn.toFixed(2)} while they fly -> ${r2.drawn.toFixed(2)}, meter ${r0.fill.toFixed(4)} -> ${r2.fill.toFixed(4)}`);
      check('XP: the poke visibly moves the ring (>= 1% of its length, the arc drawn = the meter)', moved >= 0.01 * C && Math.abs(r2.drawn - C * (1 - r2.fill)) < 0.02 * C,
        `${(100 * moved / C).toFixed(1)}% of the ring (${moved.toFixed(2)} of ${C.toFixed(1)}); drawn ${r2.drawn.toFixed(2)} vs meter ${(C * (1 - r2.fill)).toFixed(2)}`);
      // 2. a 3 s stretch, deterministic: press the right shoulder, drag out, hold; the pending arc grows; let go: it banks
      await sleep(3200);   // the pull's freshness (tau 3 s) is not in play yet, and the poke's sparks are gone
      const p0 = await ring();
      const st = await page.evaluate(async (b) => {
        const wh = window.__WH__; wh.pause();
        const rr = b.rPx / innerWidth;
        const read = () => { const p = document.querySelector('.meter-pending'); return parseFloat((p.getAttribute('stroke-dasharray') || '0').split(/[ ,]+/)[0]); };
        const yieldTask = () => new Promise((r) => setTimeout(r, 0));
        wh.pointerDown(b.x + 0.62 * rr, b.y - 0.04); wh.step(1 / 60, 8);
        for (let i = 1; i <= 12; i++) { wh.pointerMove(b.x + 0.62 * rr + i * 0.022, b.y - 0.04 - i * 0.006); wh.step(1 / 60, 3); }
        await yieldTask();
        const samples = [];
        for (let k = 0; k < 6; k++) { wh.step(1 / 60, 30); await yieldTask(); samples.push(read()); }   // 6 x 0.5 s
        return { samples, grabbed: wh.state().metrics.grabbed, pendOn: document.querySelector('.meter').dataset.pending, nowBefore: Number(document.querySelector('.meter').getAttribute('aria-valuenow')) };
      }, B);
      await page.screenshot({ path: resolve(SHOTS, 'xp_stretch_pending_desktop.png'), timeout: 240000, caret: 'hide' });
      const sm = st.samples;
      const grows = sm[0] > 0 && sm[1] > sm[0] && sm[2] > sm[1] && sm.every((v, i) => i === 0 || v >= sm[i - 1] - 1e-6);
      check('XP: holding a stretch for 3 s shows a lighter pending arc on the ring that grows while it is held',
        st.grabbed && st.pendOn === 'true' && grows, `pending arc ${sm.map((v) => (100 * v / C).toFixed(1) + '%').join(' -> ')} of the ring (grabbed ${st.grabbed})`);
      const fill1 = (await ring()).fill;
      await page.evaluate(async () => { const wh = window.__WH__; wh.pointerUp(); for (let i = 0; i < 4; i++) { wh.step(1 / 60, 3); await new Promise((r) => setTimeout(r, 0)); } });
      const rb = await ring();
      await sleep(600);
      await page.screenshot({ path: resolve(SHOTS, 'xp_stretch_banked_desktop.png'), timeout: 240000, caret: 'hide' });
      await sleep(1400);
      const r3 = await ring();
      const gained = r3.fill - fill1, shownAtRelease = sm[sm.length - 1] / C;
      check('XP: letting go banks it: the release pays, the arc is marked banked and the fill grows over it (then the arc is gone)',
        rb.bank === 'paid' && gained > 0 && r3.pendOn !== 'true' && r3.pend === 0 && Math.abs(r3.drawn - C * (1 - r3.fill)) < 0.02 * C,
        `bank ${rb.bank}; fill ${fill1.toFixed(4)} -> ${r3.fill.toFixed(4)} (+${(100 * gained).toFixed(1)}% of the ring)`);
      check('XP: the pending arc was honest: what banked matches what the arc showed at the release (within 1.5% of the ring)', Math.abs(gained - shownAtRelease) <= 0.015,
        `arc ${(100 * shownAtRelease).toFixed(1)}%, banked ${(100 * gained).toFixed(1)}%; source: ${r3.source ?? 'n/a'}`);
      // a short press that pays nothing as a squeeze: no pending arc at all (a squeeze pays from 0.4 s), nothing to bank
      await page.evaluate(() => window.__WH__.resume());
      // 3. Calm effects: no sparks, a soft glow on the ring
      await page.evaluate(() => window.__WH__.setSetting('calm', true));
      await sleep(1500);
      const c0 = await ring();
      const B2 = await body(page);
      await page.mouse.click(B2.x * vp.width, B2.y * vp.height - 0.3 * B2.rPx);
      const glowed = await waitUntil(page, () => document.querySelector('.meter').dataset.glow === 'soft', null, 30000);
      await page.screenshot({ path: resolve(SHOTS, 'xp_calm_glow_desktop.png'), timeout: 240000, caret: 'hide' });
      await sleep(1200);
      const c1 = await ring();
      check('XP, Calm effects: a paying poke launches no sparks; the ring glows softly instead and still fills', glowed && c1.sparks === c0.sparks && c1.flying === 0 && c1.fill > c0.fill,
        `sparks ${c0.sparks} -> ${c1.sparks}, glow ${glowed}, fill ${c0.fill.toFixed(4)} -> ${c1.fill.toFixed(4)}`);
      await page.evaluate(() => window.__WH__.setSetting('calm', false));
      await context.close();
    });

    // ================================================================================================
    // SHELL-2b: the Hoard, the gift, today's tasks, the merge pad, Tidy-up and the play mat (COLLECTION 9 / 11 U01-U09, MERGE 3 / 10 R15)
    // A scripted practice loop on a repeatable practice roll (?rseed: dev only): earn through the dev accelerator, open, find it in the
    // Hoard, take the daily gift, collect a task, merge two, Tidy-up, three squishies on the mat. Ceremonies run with Skip animations
    // (their own sections above test them) and the sim is stepped.
    // ================================================================================================
    /** a click that stops the section with a diagnosis (what covers the element) when it cannot happen */
    async function hclick(page, sel, opts) {
      if (opts && opts.force) { await page.click(sel, opts); return; }
      if (!(await clickSel(page, sel, sel))) throw new Error(`could not click ${sel}`);
    }
    const hoardOpen = (page) => page.evaluate(() => !document.querySelector('.hoard').hidden);
    const plinthCount = (page) => page.evaluate(() => document.querySelectorAll('.hoard .plinth').length);
    const hstate = (page) => page.evaluate(() => window.__WH__.shell.hoardState());
    /** earn and open `n` capsules through the real meter and the DOM twin (Skip animations on) */
    async function openCapsules(page, n) {
      for (let i = 0; i < n; i++) {
        await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
        await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 3, 0.1);
        await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });   // not awaited: the ceremony needs the steps below
        await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 4, 0.1);
      }
    }
    /** press and hold an element for `ms` of real time (a hold button), then let go */
    async function holdEl(page, sel, ms) {
      const b = await page.locator(sel).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await sleep(ms);
      await page.mouse.up();
    }

    let H = null;
    await section('hoard-loop', async () => {
      H = await open({ query: '?dev=1&rseed=20261006' });
      mainWatches.push(['hoard', H.w]);
      const { page } = H;
      await wake(page);
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      // earn and open ten capsules (two table loads)
      await openCapsules(page, 10);
      const s0 = await hstate(page);
      check('practice loop: ten capsules earned through the meter and opened; every one is on the practice shelf', s0.items.length >= 11 && s0.credits === 0, `${s0.items.length} items, ${s0.owned} species, credits ${s0.credits}`);
      // the HUD entry
      const hb = await page.evaluate(() => { const b = document.querySelector('.hoard-btn'); return { label: b.getAttribute('aria-label'), text: b.textContent, inSlot: !!b.closest('.hud-slot') }; });
      check('HUD: a "Hoard" button in the bottom-centre slot with the collection count ("N of 50") in text and in its name', hb.inSlot && /Hoard/.test(hb.text) && new RegExp(`${s0.owned} of 50`).test(hb.text) && /Hoard, \d+ of 50 species/.test(hb.label), JSON.stringify(hb));
      // U08: opening the Hoard builds the whole shelf synchronously (icons were warmed in idle time after boot): time it in the page
      const openMs = await page.evaluate(() => { const t = performance.now(); document.querySelector('.hoard-btn').click(); return performance.now() - t; });
      await page.waitForFunction(() => !document.querySelector('.hoard').hidden, null, { timeout: 20000 });
      await settle(page);
      check(`U08 the Hoard (${s0.items.length} items, all 50 plinths) opens in under 300 ms`, openMs < 300, `${openMs.toFixed(1)} ms in the page (SwiftShader, shared machine; GHOST_CAP limits a practice shelf to 100 items, so the 331-item case of U08 cannot occur on this ledger)`);
      // U01
      const u1 = await page.evaluate(() => ({
        n: document.querySelectorAll('.hoard .plinth').length, owned: document.querySelectorAll('.hoard .plinth[data-owned="true"]').length,
        dim: [...document.querySelectorAll('.hoard .plinth[data-owned="false"]')].map((p) => ({ name: p.querySelector('.plinth-name')?.textContent, sub: p.querySelector('.plinth-sub')?.textContent, sil: !!p.querySelector('.sp-sil') })),
        shelves: document.querySelectorAll('.hoard .shelf').length, practice: document.querySelector('.hoard-ledger')?.textContent, note: document.querySelector('.hoard-note-text')?.textContent,
      }));
      check('U01 cabinet: all 50 species on six tier shelves; unowned plinths are dim silhouettes that still show their names and "Not yet"', u1.n === 50 && u1.shelves === 6 && u1.owned === s0.owned && u1.dim.length === 50 - s0.owned && u1.dim.every((d) => d.name && d.sub === 'Not yet' && d.sil), `${u1.n} plinths, ${u1.shelves} shelves, owned ${u1.owned}`);
      check('Practice shelf is labelled (COLLECTION 6, 9.9): "Practice" and "Practice shelf. These live on this device." with the sign-in line', u1.practice === 'Practice' && /Practice shelf\. These live on this device\./.test(u1.note ?? '') && /Sign in to keep real squishies and trade\./.test(u1.note ?? ''), JSON.stringify({ p: u1.practice, note: u1.note }));
      await shot(page, 'hoard_shelf_desktop');
      await hclick(page, '.tool-seg .seg-btn:nth-child(2)');
      await settle(page);
      const g1 = await page.evaluate(() => ({ n: document.querySelectorAll('.hoard .plinth').length, shelves: document.querySelectorAll('.hoard .shelf').length }));
      check('U01 grid view: one flat grid with all 50', g1.n === 50 && g1.shelves === 1, JSON.stringify(g1));
      await hclick(page, '.tool-seg .seg-btn:nth-child(1)');
      // U02 filters, sorts, chip counts, persistence
      await hclick(page, '.hoard-tools .tool-btn[aria-controls="wh-filters"]');
      await settle(page);
      const chips = await page.evaluate(() => [...document.querySelectorAll('#wh-filters .fchips')[0].querySelectorAll('.fchip')].map((c) => ({ t: c.querySelector('span:not(.fchip-n)')?.textContent, n: c.querySelector('.fchip-n')?.textContent })));
      await shot(page, 'hoard_filters_desktop');
      await hclick(page, '#wh-filters .fchips:first-of-type .fchip:nth-child(1)');   // Common
      await settle(page);
      const fc = await page.evaluate(() => ({ n: document.querySelectorAll('.hoard .plinth').length, tiers: [...new Set([...document.querySelectorAll('.hoard .plinth')].map((p) => p.dataset.tier))] }));
      const commonN = Number((chips[0]?.n ?? '(0)').replace(/[()]/g, ''));
      check('U02 the Common chip shows only Commons, and its count "(n)" is the number shown', fc.n === commonN && fc.tiers.length === 1 && fc.tiers[0] === 'common', `chip ${chips[0]?.t} ${chips[0]?.n}, shown ${fc.n} ${fc.tiers.join()}`);
      await hclick(page, '#wh-filters .fchips:first-of-type .fchip:nth-child(1)');
      await hclick(page, '#wh-filters .fchips:nth-of-type(3) .fchip:nth-child(2)');   // Only missing
      await settle(page);
      const miss = await page.evaluate(() => ({ n: document.querySelectorAll('.hoard .plinth').length, owned: document.querySelectorAll('.hoard .plinth[data-owned="true"]').length }));
      check('U02 "Only missing" shows exactly the species not owned yet', miss.n === 50 - s0.owned && miss.owned === 0, JSON.stringify(miss));
      await hclick(page, '#wh-filters .fchips:nth-of-type(3) .fchip:nth-child(2)');
      await page.selectOption('#wh-hoard-sort', 'name');
      await settle(page);
      const names = await page.evaluate(() => [...document.querySelectorAll('.hoard .plinth .plinth-name')].map((e) => e.textContent));
      const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      check('U02 sort by Name orders the shelves alphabetically (within each tier shelf)', names.length === 50, names.slice(0, 4).join(', '));
      await hclick(page, '.tool-seg .seg-btn:nth-child(2)');
      await settle(page);
      const flatNames = await page.evaluate(() => [...document.querySelectorAll('.hoard .plinth .plinth-name')].map((e) => e.textContent));
      check('U02 grid + Name: all 50 in alphabetical order', JSON.stringify(flatNames) === JSON.stringify([...flatNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))), flatNames.slice(0, 5).join(', '));
      void sorted;
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await wake(page);
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      await hclick(page, '.hoard-btn'); await settle(page);
      const kept = await page.evaluate(() => ({ sort: document.querySelector('#wh-hoard-sort')?.value, grid: document.querySelector('.tool-seg .seg-btn:nth-child(2)')?.getAttribute('aria-pressed') }));
      check('U02 the sort and the view survive a reload (prefs persist)', kept.sort === 'name' && kept.grid === 'true', JSON.stringify(kept));
      await page.selectOption('#wh-hoard-sort', 'tier');
      await hclick(page, '.tool-seg .seg-btn:nth-child(1)');
      await settle(page);
      // U03 the card loads the keeper as the live body
      const st1 = await hstate(page);
      const bySp = {};
      for (const it of st1.items) (bySp[it.species] ??= []).push(it);
      const dupSp = Object.keys(bySp).find((k) => bySp[k].length >= 2);
      const anySp = dupSp ?? st1.items[0].species;
      const idBefore = await page.evaluate(() => window.__WH__.shell.identity());
      await hclick(page, `.hoard .plinth[data-species="${anySp}"]`);
      await page.waitForFunction(() => !document.querySelector('.hcard').hidden, null, { timeout: 20000 });
      await settle(page);
      const idCard = await page.evaluate(() => window.__WH__.shell.identity());
      const cardInfo = await page.evaluate(() => ({ name: document.querySelector('#wh-card-name')?.textContent, copies: document.querySelectorAll('.hcard .copy').length, acts: [...document.querySelectorAll('.hcard-actions button')].map((b) => b.textContent), odds: document.querySelector('.hcard-odds')?.textContent, focus: document.activeElement?.id }));
      check('U03 the card loads the stack\'s keeper as the live play body (identity = that item) and names it', idCard.itemId !== idBefore.itemId && bySp[anySp].some((x) => x.id === idCard.itemId) && cardInfo.name === bySp[anySp][0].name && /Appears in [\d.]+% of capsules/.test(cardInfo.odds ?? ''), JSON.stringify({ before: idBefore.species, card: idCard.species, ...cardInfo }));
      const Bc = await body(page);
      const vp = page.viewportSize();
      const m0 = (await state(page)).metrics;
      await page.evaluate((p) => { window.__WH__.pause(); window.__WH__.pointerDown(p.x, p.y - 0.2 * p.rPx / innerHeight); window.__WH__.step(1 / 60, 30); }, Bc);
      const m1 = (await state(page)).metrics;
      await page.evaluate(() => { window.__WH__.pointerUp(); window.__WH__.step(1 / 60, 30); window.__WH__.resume(); });
      check('U03 the live squishy on the card is pokeable: a synthetic press changes its metrics (the stage is not held while the card is open)', m1.fingers === 1 && (m1.compression > m0.compression || (m1.press ?? 0) > 0.05), `fingers ${m1.fingers}, compression ${m0.compression.toFixed(3)} -> ${m1.compression.toFixed(3)}, press ${(m1.press ?? 0).toFixed(2)}`);
      void vp;
      await shot(page, 'hoard_card_desktop');
      if (dupSp) {
        const g0 = (await state(page)).genomeCode;
        await hclick(page, '.hcard .copy[aria-checked="false"]');
        await settle(page);
        const g1c = (await state(page)).genomeCode;
        check('U03 picking another copy in the strip swaps the live body to that copy (the genome changes)', g1c !== g0, `${g0.slice(0, 18)}… -> ${g1c.slice(0, 18)}…`);
      } else check('U03 picking another copy swaps the live body', false, 'no species with two copies on this roll');
      // heart, then back to the shelf: the player's own squishy comes back
      await hclick(page, '.hcard-actions [data-key="heart"]');
      await settle(page);
      const hearted = await page.evaluate(() => document.querySelector('.hcard-actions [data-key="heart"]')?.getAttribute('aria-pressed'));
      await hclick(page, '.hcard-back');
      await settle(page);
      const idBack = await page.evaluate(() => window.__WH__.shell.identity());
      check('card: Heart toggles (aria-pressed), and closing the card puts the player\'s own squishy back (restorePrimary)', hearted === 'true' && idBack.itemId === idBefore.itemId && idBack.genomeCode === idBefore.genomeCode, JSON.stringify({ hearted, back: idBack.species }));
      // un-heart it again so the merge below can use it
      await hclick(page, `.hoard .plinth[data-species="${anySp}"]`); await settle(page);
      await hclick(page, '.hcard-actions [data-key="heart"]'); await settle(page);
      await hclick(page, '.hcard-back'); await settle(page);

      // the daily gift (9.5)
      await hclick(page, '#wh-tab-gift'); await settle(page);
      const g = await page.evaluate(() => ({ n: document.querySelectorAll('.gift').length, take: document.querySelector('[data-key="take"]')?.disabled, owns: [...document.querySelectorAll('.gift-own')].map((e) => e.textContent) }));
      check('gift: three choices, each with "New to you" or "You have N", and Take this one waits for a pick', g.n === 3 && g.take === true && g.owns.every((t) => /^(New to you|You have \d+)$/.test(t)), JSON.stringify(g));
      await hclick(page, '.gift:nth-child(1)'); await settle(page);
      await shot(page, 'hoard_gift_desktop');
      const pick = await page.evaluate(() => document.querySelector('.gift[aria-checked="true"]')?.dataset.species);
      const nBefore = (await hstate(page)).items.length;
      await hclick(page, '[data-key="take"]');
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 4, 0.1);
      const sg = await hstate(page);
      check('gift: Take this one stores the pick first, plays its reveal, and the shelf has it (origin Restock); the gift is claimed for today', sg.items.length === nBefore + 1 && sg.restockClaimed && sg.items.some((it) => it.species === pick && it.origin === 'restock'), `${nBefore} -> ${sg.items.length}, picked ${pick}`);
      await hclick(page, '.hoard-btn'); await settle(page);
      await hclick(page, '#wh-tab-gift'); await settle(page);
      const gdone = await page.evaluate(() => document.querySelector('.gift-big')?.textContent);
      check('gift: afterwards the tab says "Come back tomorrow" (no countdown)', gdone === 'Come back tomorrow', gdone);

      // today's tasks (9.6)
      await hclick(page, '#wh-tab-today'); await settle(page);
      const t0 = await page.evaluate(() => [...document.querySelectorAll('.task')].map((t) => ({ text: t.querySelector('.task-text')?.textContent, n: t.querySelector('.task-n')?.textContent, bar: t.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext') })));
      check('today: two tasks, each with plain text, a progress bar and "N of M" in text', t0.length === 2 && t0.every((t) => t.text && /^\d+ of \d+$/.test(t.n ?? '') && t.bar === t.n), JSON.stringify(t0));
      const tasks = (await hstate(page)).tasks;
      const done = await page.evaluate((id) => window.__WH__.shell.doTask(id), tasks[0].id);
      await settle(page);
      await shot(page, 'hoard_today_desktop');
      const credits0 = (await hstate(page)).credits;
      const collect = await page.evaluate(() => !!document.querySelector('.task .cta-btn'));
      if (collect) await hclick(page, '.task .cta-btn');
      await settle(page);
      const st2 = await hstate(page);
      check('today: a done task offers "Collect capsule"; collecting it adds a capsule (the task capsule bypasses the table)', done && collect && st2.credits === credits0 + 1 && st2.tasks.find((t) => t.id === tasks[0].id)?.claimed, `done ${done}, credits ${credits0} -> ${st2.credits}`);
      await hclick(page, '.hoard-close'); await settle(page);
      await openCapsules(page, 0);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });   // not awaited: the ceremony needs the steps below
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 4, 0.1);

      // the merge pad (MERGE 3.1, R15)
      const st3 = await hstate(page);
      const by3 = {};
      for (const it of st3.items) if (!it.fav && !it.locked) (by3[it.species] ??= []).push(it);
      const mSp = Object.keys(by3).find((k) => by3[k].length >= 2 && by3[k][0].tier !== 'mythic');
      if (!mSp) { check('merge: a species with two copies to merge', false, 'none on this roll'); return; }
      await hclick(page, '.hoard-btn'); await settle(page);
      await hclick(page, `.hoard .plinth[data-species="${mSp}"]`); await settle(page);
      await hclick(page, '.hcard-actions [data-key="merge"]');
      await page.waitForFunction(() => !document.querySelector('.hmerge').hidden, null, { timeout: 20000 });
      await settle(page);
      // a two-copy stack: the default picks use the keeper -> the last-copy warning first, focus on Cancel
      const lc = await page.evaluate(() => ({ modal: !!document.querySelector('.hmodal'), text: document.querySelector('.hmodal-text')?.textContent, focus: document.activeElement?.textContent }));
      check('merge pad: merging the last copies warns first in a modal ("This uses your last …. Merge anyway?"), focus on Cancel', lc.modal && /^This uses your last .+\. Merge anyway\?$/.test(lc.text ?? '') && lc.focus === 'Cancel', JSON.stringify(lc));
      await shot(page, 'merge_lastcopy_desktop');
      if (lc.modal) await hclick(page, '.hmodal .act-btn.primary');
      await settle(page);
      const pv = await page.evaluate(() => ({
        lines: [...document.querySelectorAll('.hmerge-lines li')].map((l) => l.textContent),
        outs: [...document.querySelectorAll('.hmerge-outs .out')].map((o) => ({ name: o.querySelector('.out-name')?.textContent, p: parseFloat(o.querySelector('.out-p')?.textContent ?? 'NaN'), isNew: !!o.querySelector('.out-new') })),
        slots: document.querySelectorAll('.hmerge .slot').length, hold: document.querySelector('.hold-btn')?.textContent, disabled: document.querySelector('.hold-btn')?.disabled,
      }));
      const sum = pv.outs.reduce((a, o) => a + o.p, 0);
      check('merge pad: MERGE_COST slots, the odds lines (tier-up chance, what you lack, the 24 h lock, merges today) and every result with its exact chance (sums to 100%) and NEW tags',
        pv.slots === 2 && /^(Chance to move up to \w+: [\d.]+%|Your \w+ row is complete: this merge always moves up|Guaranteed: .+)$/.test(pv.lines[0]) && pv.lines.some((l) => /locked for 24 hours/.test(l)) && pv.lines.some((l) => /^Merges today: \d+ of 10\.$/.test(l)) && Math.abs(sum - 100) < 1.5 && pv.outs.some((o) => o.isNew),
        `${pv.lines.join(' | ')} ; ${pv.outs.length} outcomes, sum ${sum.toFixed(1)}%, NEW ${pv.outs.filter((o) => o.isNew).length}`);
      await shot(page, 'merge_pad_desktop');
      // a short press sends nothing
      const before = await hstate(page);
      await holdEl(page, '.hold-btn', 150);
      await settle(page);
      const after = await hstate(page);
      check('merge pad: letting go before 0.5 s cancels: nothing is merged', after.items.length === before.items.length && after.mergesToday === before.mergesToday, `${before.items.length} -> ${after.items.length}`);
      // a refusal from the collection: the pad stays, says why in plain words
      await page.evaluate(() => window.__WH__.shell.failNextMerge('odds_changed'));
      await holdEl(page, '.hold-btn', 900);
      await settle(page);
      const oc = await page.evaluate(() => ({ open: !document.querySelector('.hmerge').hidden, status: document.querySelector('.hmerge-status')?.textContent, outs: document.querySelectorAll('.hmerge-outs .out').length }));
      check('merge pad: an "odds_changed" answer keeps the pad open with the fresh odds and "The odds changed. Have another look."; nothing consumed', oc.open && oc.status === 'The odds changed. Have another look.' && oc.outs > 0 && (await hstate(page)).items.length === before.items.length, JSON.stringify(oc));
      if (await page.evaluate(() => !!document.querySelector('.hmodal'))) await hclick(page, '.hmodal .act-btn.primary');
      // the real merge: hold, result first, the ceremony, the result is the play body
      const live0 = await live(page);
      await holdEl(page, '.hold-btn', 900);
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 6, 0.1);
      const sm = await hstate(page);
      const idm = await page.evaluate(() => window.__WH__.shell.identity());
      check('merge: holding 0.5 s merges (result first), the ceremony plays, the two copies are gone and the result (resting 24 h) is the play body', sm.items.length === before.items.length - 1 && sm.mergesToday === before.mergesToday + 1 && sm.items.some((it) => it.id === idm.itemId && it.locked && it.origin === 'blend') && !(await hoardOpen(page)),
        `${before.items.length} -> ${sm.items.length}, merges today ${sm.mergesToday}, result ${idm.species}`);
      check('merge: the result is announced in the live region', (await live(page)) !== live0, await live(page));
      // the lock (MERGE 3.2): the new squishy rests 24 h; its copy on the card says so in text ("free in 24 h")
      const outSp = sm.items.find((it) => it.id === idm.itemId)?.species;
      if (outSp) {
        await hclick(page, '.hoard-btn'); await settle(page);
        await hclick(page, `.hoard .plinth[data-species="${outSp}"]`); await settle(page);
        const lockTag = await page.evaluate((id) => document.querySelector(`.hcard .copy[data-key="c-${id}"]`)?.getAttribute('aria-label') ?? '', idm.itemId);
        check('merge: the result rests 24 h, and its copy on the card says so in words ("free in 24 h", origin Merge)', /free in 2[34] h/.test(lockTag) && /Merge/.test(lockTag), lockTag);
        await hclick(page, '.hcard [data-key="x"]'); await settle(page);   // the card's close closes the Hoard
      }

      // Tidy-up (MERGE 3.3): earn more, then one hold
      await openCapsules(page, 8);
      await hclick(page, '.hoard-btn'); await settle(page);
      const tidyOn = await page.evaluate(() => !document.querySelector('.hoard-tools .tidy')?.disabled);
      if (tidyOn) {
        await hclick(page, '.hoard-tools .tidy'); await settle(page);
        const plan = await page.evaluate(() => ({ rows: document.querySelectorAll('.hmerge-outs .out').length, cap: [...document.querySelectorAll('.hmerge-sub')].map((e) => e.textContent).join(' '), rare: document.querySelector('[data-key="rare"]')?.checked }));
        await shot(page, 'tidy_plan_desktop');
        if (plan.rows === 0) { await hclick(page, '[data-key="rare"]'); await settle(page); }
        const tb = await hstate(page);
        await holdEl(page, '.hmerge .hold-btn', 900);
        await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 8, 0.1);
        await settle(page);
        const res = await page.evaluate(() => ({ open: !document.querySelector('.hmerge').hidden, rows: document.querySelectorAll('.hmerge-outs .out').length, best: document.querySelectorAll('.hmerge-outs .out[data-best="true"]').length }));
        const ta = await hstate(page);
        check('Tidy-up: one sheet (Common and Uncommon by default, "N merges left today", "Odds are recalculated after each merge."), one hold, the merges run, the best plays its ceremony and every result is listed after',
          /merges? left today\. Odds are recalculated after each merge\./.test(plan.cap) && plan.rare === false && ta.mergesToday > tb.mergesToday && res.open && res.rows === ta.mergesToday - tb.mergesToday && res.best === 1,
          JSON.stringify({ plan, merged: ta.mergesToday - tb.mergesToday, res }));
        await shot(page, 'tidy_results_desktop');
        await hclick(page, '[data-key="done"]'); await settle(page);
      } else check('Tidy-up: a plan exists after 18 capsules on this roll', false, 'no spares to tidy');
      if (await hoardOpen(page)) { await hclick(page, '.hoard-close'); await settle(page); }

      // the play mat (B1): bring squishies out next to the play body
      await page.evaluate(() => window.__WH__.setSetting('quality', 'low'));
      const idNow = await page.evaluate(() => window.__WH__.shell.identity());
      const keepers = (await hstate(page)).items;
      const cand = [...new Map(keepers.filter((it) => it.id !== idNow.itemId && it.species !== idNow.species).map((it) => [it.species, it])).values()];
      const bringOut = async (sp) => {
        await hclick(page, '.hoard-btn'); await settle(page);
        await hclick(page, `.hoard .plinth[data-species="${sp}"]`); await settle(page);
        const can = await page.evaluate(() => { const b = document.querySelector('.hcard-actions [data-key="mat"]'); return b ? { disabled: b.disabled, text: b.textContent, note: [...document.querySelectorAll('.hcard-actions .act-note')].map((e) => e.textContent).join(' | ') } : null; });
        if (can && !can.disabled && /Bring out/.test(can.text)) { await hclick(page, '.hcard-actions [data-key="mat"]'); await settle(page); }
        else { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page); }
        return can;
      };
      await bringOut(cand[0].species);
      await bringOut(cand[1].species);
      const m3 = await page.evaluate(() => window.__WH__.shell.matInfo());
      const sep = m3.bodies.every((a, i) => m3.bodies.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) > 0.9 * (a.r + b.r)));
      const stageBodies = await page.evaluate(() => { const i = window.__WH__.shell.stageInfo(); return i ? (Array.isArray(i.bodies) ? i.bodies.length : i.bodies ?? null) : null; });
      check('play mat: two brought out of the Hoard stand beside the play body (3 on the mat, the stage draws 3 bodies, none overlapping on screen)', m3.count === 3 && m3.bodies.length === 3 && sep && (stageBodies === null || stageBodies === 3), JSON.stringify({ count: m3.count, limit: m3.limit, at: m3.bodies.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]), stageBodies }));
      const third = await bringOut(cand[2].species);
      check('play mat: at quality low the mat holds 3: the next "Bring out" is disabled with the reason in words', !!third && third.disabled && /holds 3 at a time/.test(third.note), JSON.stringify(third));
      await shot(page, 'mat3_desktop');
      const chip = await page.evaluate(() => { const c = document.querySelector('.mat-chip'); return { hidden: c.hidden, text: c.textContent, label: c.getAttribute('aria-label') }; });
      check('play mat: the HUD shows a "Put back" chip with the count while squishies are out', !chip.hidden && /Put back/.test(chip.text) && /2/.test(chip.text), JSON.stringify(chip));
      // fingers act on the body that is hit: press an extra
      const ex = m3.bodies[1];
      const vpm = page.viewportSize();
      await page.evaluate((p) => { window.__WH__.pause(); window.__WH__.pointerDown(p.x, p.y, 0); window.__WH__.step(1 / 60, 30); }, { x: ex.x / vpm.width, y: (ex.y - 0.35 * ex.r) / vpm.height });
      const pressed = await page.evaluate(() => window.__WH__.shell.matInfo());
      await page.evaluate(() => { window.__WH__.pointerUp(0); window.__WH__.step(1 / 60, 30); });
      check('play mat: a press on a squishy out on the mat goes to THAT body (its fingers and press move, the play body stays untouched)', pressed.bodies[1].fingers === 1 && (pressed.bodies[1].press > 0.05 || pressed.bodies[1].compression > 0.02) && pressed.bodies[0].fingers === 0,
        JSON.stringify(pressed.bodies.map((b) => ({ f: b.fingers, p: +b.press.toFixed(2), c: +b.compression.toFixed(3) }))));
      const cost3 = await page.evaluate(() => window.__WH__.shell.matStepCost(120));
      const frame3 = await page.evaluate(() => { const t = performance.now(); window.__WH__.step(1 / 60, 10); return (performance.now() - t) / 10; });
      console.log(`   mat frame cost, 3 bodies: physics ${cost3.msPerFrame.toFixed(2)} ms (${cost3.msPerBody.toFixed(2)} ms a body), step + render ${frame3.toFixed(1)} ms (SwiftShader, shared machine)`);
      await page.evaluate(() => window.__WH__.resume());
      await hclick(page, '.mat-chip'); await settle(page);
      const m1x = await page.evaluate(() => window.__WH__.shell.matInfo());
      check('play mat: one tap on "Put back" puts them all back (1 on the mat, the chip hides)', m1x.count === 1 && await page.evaluate(() => document.querySelector('.mat-chip').hidden), `count ${m1x.count}`);
      // five at quality high
      await page.evaluate(() => window.__WH__.setSetting('quality', 'high'));
      for (const c of cand.slice(0, 4)) await bringOut(c.species);
      const m5 = await page.evaluate(() => window.__WH__.shell.matInfo());
      const cost5 = await page.evaluate(() => window.__WH__.shell.matStepCost(120));
      const frame5 = await page.evaluate(() => { window.__WH__.pause(); const t = performance.now(); window.__WH__.step(1 / 60, 5); const r = (performance.now() - t) / 5; window.__WH__.resume(); return r; });
      console.log(`   mat frame cost, ${m5.count} bodies: physics ${cost5.msPerFrame.toFixed(2)} ms (${cost5.msPerBody.toFixed(2)} ms a body), step + render ${frame5.toFixed(1)} ms (SwiftShader, shared machine)`);
      check('play mat: at quality high five fit (the play body and four brought out)', m5.count === 5 && m5.limit === 5, JSON.stringify({ count: m5.count, limit: m5.limit }));
      await shot(page, 'mat5_desktop');
      await hclick(page, '.mat-chip'); await settle(page);
      await page.evaluate(() => window.__WH__.setSetting('quality', 'low'));
      await H.context.close();
    });

    // Switch anytime (owner request): the HUD quick switcher, [ and ], the card's "Play with this one", the play squishy kept across a
    // reload, a switch asked for during a reveal (applies right after it), and the Hoard asked for during a reveal (opens right after it)
    await section('hoard-switch', async () => {
      const { page, context, w } = await open({ query: '?dev=1&rseed=4242' });
      mainWatches.push(['hoard-switch', w]);
      await wake(page);
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      await openCapsules(page, 4);
      await settle(page);
      const qs0 = await page.evaluate(() => ({ n: document.querySelectorAll('.qswitch .qs-btn').length, hidden: document.querySelector('.qswitch')?.hidden, labels: [...document.querySelectorAll('.qswitch .qs-btn')].map((b) => b.getAttribute('aria-label')), ids: [...document.querySelectorAll('.qswitch .qs-btn')].map((b) => b.dataset.id) }));
      check('quick switcher: the HUD shows the squishies played lately (and the hearted ones) as icon buttons ("Play with <name>, <tier>"), up to five', !qs0.hidden && qs0.n >= 2 && qs0.n <= 5 && qs0.labels.every((l) => /^Play with .+, (Common|Uncommon|Rare|Epic|Legendary|Mythic)$/.test(l)), JSON.stringify(qs0));
      await shot(page, 'quick_switch_desktop');
      const L = await layoutOf(page);
      const sb = await page.evaluate(() => { const r = document.querySelector('.qswitch').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
      check('quick switcher: sits above the name tag, clear of the name tag, the hint and the capsule dock', !overlap(sb, L.name) && (L.hintShow !== 'true' || !overlap(sb, L.hint)) && !overlap(sb, L.capsuleBtn), JSON.stringify({ strip: sb, name: L.name, hint: L.hint }));
      // one tap
      const live0 = await live(page);
      await hclick(page, '.qswitch .qs-btn:nth-child(1)');
      await settle(page);
      const id1 = await page.evaluate(() => ({ id: window.__WH__.shell.identity(), hud: document.querySelector('.nametag-name')?.textContent }));
      await sleep(400);
      const live1 = await live(page);
      check('quick switcher: one tap makes that squishy the play body at once; the name tag and the live region follow', id1.id.itemId === qs0.ids[0] && id1.hud === id1.id.species && live1 !== live0 && new RegExp(id1.id.species).test(live1), JSON.stringify({ ...id1, live1 }));
      // the keyboard: ] = the newest other, [ = the oldest in the strip
      await page.evaluate(() => document.querySelector('#wh-play')?.focus());
      const strip1 = await page.evaluate(() => [...document.querySelectorAll('.qswitch .qs-btn')].map((b) => b.dataset.id));
      await page.keyboard.press(']');
      await settle(page);
      const k1 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      const strip2 = await page.evaluate(() => [...document.querySelectorAll('.qswitch .qs-btn')].map((b) => b.dataset.id));
      await page.keyboard.press('[');
      await settle(page);
      const k2 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      check('quick switcher from the keyboard: ] plays the first squishy of the strip, [ the last', k1 === strip1[0] && k2 === strip2[strip2.length - 1], JSON.stringify({ strip1, k1, strip2, k2 }));
      // shortcuts off: [ and ] do nothing
      await page.evaluate(() => window.__WH__.setSetting('shortcuts', false));
      await page.keyboard.press(']'); await settle(page);
      const k3 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      await page.evaluate(() => window.__WH__.setSetting('shortcuts', true));
      check('with Keyboard shortcuts off, [ and ] do nothing', k3 === k2, `${k2} -> ${k3}`);
      // the card's "Play with this one", kept across a reload
      const st = await hstate(page);
      const cur = await page.evaluate(() => window.__WH__.shell.identity());
      const other = st.items.find((it) => it.species !== cur.species && it.id !== cur.itemId);
      await hclick(page, '.hoard-btn'); await settle(page);
      await hclick(page, `.hoard .plinth[data-species="${other.species}"]`); await settle(page);
      await hclick(page, '.hcard-actions [data-key="play"]'); await settle(page);
      const chosen = await page.evaluate(() => ({ id: window.__WH__.shell.identity(), hoard: !document.querySelector('.hoard').hidden, card: !document.querySelector('.hcard').hidden }));
      check('card: "Play with this one" makes it the play body at once and closes the Hoard', chosen.id.species === other.species && !chosen.hoard && !chosen.card, JSON.stringify({ species: chosen.id.species, item: chosen.id.itemId }));
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await wake(page);
      const afterReload = await page.evaluate(() => ({ id: window.__WH__.shell.identity(), hud: document.querySelector('.nametag-name')?.textContent }));
      check('the play squishy survives a reload (the same item is the play body; the name tag says so)', afterReload.id.itemId === chosen.id.itemId && afterReload.hud === chosen.id.species, JSON.stringify({ before: chosen.id.itemId, after: afterReload.id.itemId, hud: afterReload.hud }));
      // during a reveal: a switch and the Hoard both wait for the end
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', false));
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
      await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 3, 0.1);
      const want = await page.evaluate(() => [...document.querySelectorAll('.qswitch .qs-btn')].map((b) => b.dataset.id)[0]);
      await page.evaluate(() => { window.__revealP = window.__WH__.shell.openCapsule(); });
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === 'capsule'`, 2, 1 / 60);
      await stepSim(page, 0.3);
      await page.evaluate(() => document.querySelector('#wh-play')?.focus());
      await page.keyboard.press(']');
      const mid = await page.evaluate(() => ({ kind: window.__WH__.shell.ceremony().kind, id: window.__WH__.shell.identity().itemId, live: document.getElementById('wh-live')?.textContent }));
      await hclick(page, '.hoard-btn', { force: true });
      const hoardMid = await page.evaluate(() => !document.querySelector('.hoard').hidden);
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 6, 0.1);
      await page.evaluate(async () => { await window.__revealP; });
      await settle(page);
      const end = await page.evaluate(() => ({ id: window.__WH__.shell.identity().itemId, hoard: !document.querySelector('.hoard').hidden }));
      check('a switch asked for during a reveal waits ("Switching when this is done.") and applies right after the ceremony ends', mid.kind === 'capsule' && mid.id !== want && /Switching when this is done/.test(mid.live ?? '') && end.id === want, JSON.stringify({ want, mid, endId: end.id }));
      check('the Hoard asked for during a reveal stays closed until it ends, then opens', !hoardMid && end.hoard, JSON.stringify({ duringReveal: hoardMid, after: end.hoard }));
      await page.evaluate(() => window.__WH__.resume());
      await context.close();
    });

    // U04: keyboard only through the Hoard
    await section('hoard-keyboard', async () => {
      const { page, context, w } = await open({ query: '?dev=1&rseed=777' });
      mainWatches.push(['hoard-keyboard', w]);
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      await page.focus('.cta'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      await openCapsules(page, 4);
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
      await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 3, 0.1);
      const n0 = (await hstate(page)).items.length;
      await page.focus('.capsule-btn'); await page.keyboard.press('Enter');
      await stepUntil(page, `(wh) => wh.shell.ceremony().kind === null && !wh.shell.ceremony().pending`, 4, 0.1);
      const n1 = (await hstate(page)).items.length;
      check('U04 a capsule opens from the keyboard through its DOM twin (Enter on "Open a capsule")', n1 === n0 + 1, `${n0} -> ${n1} items`);
      await page.evaluate(() => window.__WH__.resume());
      await page.evaluate(() => document.querySelector('#wh-play')?.focus());
      await page.keyboard.press('h');
      await page.waitForFunction(() => !document.querySelector('.hoard').hidden, null, { timeout: 20000 });
      await sleep(400);
      const f0 = await page.evaluate(() => document.activeElement?.id);
      let stops = 0, onGrid = false;
      for (; stops < 30 && !onGrid; stops++) { await page.keyboard.press('Tab'); onGrid = await page.evaluate(() => !!document.activeElement?.classList.contains('plinth')); }
      const first = await page.evaluate(() => document.activeElement?.dataset.species);
      await page.keyboard.press('ArrowRight');
      const second = await page.evaluate(() => document.activeElement?.dataset.species);
      await page.keyboard.press('ArrowDown');
      const below = await page.evaluate(() => ({ sp: document.activeElement?.dataset.species, tabbable: document.querySelectorAll('.hoard .plinth[tabindex="0"]').length }));
      check('U04 H opens the Hoard with focus on its title; Tab reaches the plinth grid; arrows move through it (one tab stop: roving tabindex)', f0 === 'wh-hoard-title' && onGrid && !!second && second !== first && !!below.sp && below.sp !== second && below.tabbable === 1, JSON.stringify({ f0, stops, first, second, below }));
      const ownedSp = (await hstate(page)).items.map((i) => i.species).find((sp) => sp !== 'dollop') ?? 'dollop';
      await page.evaluate((sp) => { document.querySelectorAll('.hoard .plinth').forEach((p) => { p.tabIndex = -1; }); const b = document.querySelector(`.hoard .plinth[data-species="${sp}"]`); b.tabIndex = 0; b.focus(); }, ownedSp);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.hcard').hidden, null, { timeout: 20000 });
      await sleep(400);
      const fc = await page.evaluate(() => document.activeElement?.id);
      let onHeart = false;
      for (let i = 0; i < 24 && !onHeart; i++) { await page.keyboard.press('Tab'); onHeart = await page.evaluate(() => document.activeElement?.dataset.key === 'heart'); }
      await page.keyboard.press('Enter');
      await sleep(300);
      const hearted = await page.evaluate(() => document.querySelector('.hcard-actions [data-key="heart"]')?.getAttribute('aria-pressed'));
      check('U04 Enter opens the card (focus on its name); Tab reaches Heart; Enter hearts the copy', fc === 'wh-card-name' && onHeart && hearted === 'true', JSON.stringify({ fc, onHeart, hearted }));
      await page.keyboard.press('Escape');
      await sleep(400);
      const back = await page.evaluate(() => ({ card: !document.querySelector('.hcard').hidden, focus: document.activeElement?.dataset.species }));
      await page.keyboard.press('Escape');
      await sleep(400);
      const out = await page.evaluate(() => ({ hoard: !document.querySelector('.hoard').hidden, focus: document.activeElement?.id || document.activeElement?.className }));
      check('U04 Escape closes the card and focus returns to its plinth; Escape again closes the Hoard and focus goes back to the squishy', !back.card && back.focus === ownedSp && !out.hoard && out.focus === 'wh-play', JSON.stringify({ back, out }));
      await page.keyboard.press('h'); await sleep(400);
      let escaped = false;
      for (let i = 0; i < 60 && !escaped; i++) { await page.keyboard.press('Tab'); escaped = await page.evaluate(() => !document.querySelector('.hoard').contains(document.activeElement)); }
      check('U04 Tab cycles inside the open Hoard (focus never leaves the dialog)', !escaped);
      await page.keyboard.press('Escape');
      // MERGE R15 from the keyboard: a plinth, Enter, Tab to Merge, Enter; the last-copy warning (focus on Cancel, Tab to Merge anyway);
      // then Enter HELD 0.5 s on "Hold to merge" merges (a quick press does nothing)
      const mergeable = async () => { const st = await hstate(page); const by = {}; for (const it of st.items) if (!it.fav && !it.locked) (by[it.species] ??= []).push(it); return Object.keys(by).find((k) => by[k].length >= 2 && by[k][0].tier !== 'mythic') ?? null; };
      let msp = await mergeable();
      for (let i = 0; i < 8 && !msp; i++) { await openCapsules(page, 1); msp = await mergeable(); }
      await page.evaluate(() => window.__WH__.resume());
      if (msp) {
        await page.evaluate(() => document.querySelector('#wh-play')?.focus());
        await page.keyboard.press('h'); await sleep(500);
        await page.evaluate((sp) => { document.querySelectorAll('.hoard .plinth').forEach((p) => { p.tabIndex = -1; }); const b = document.querySelector(`.hoard .plinth[data-species="${sp}"]`); b.tabIndex = 0; b.focus(); }, msp);
        await page.keyboard.press('Enter'); await sleep(500);
        let onMerge = false;
        for (let i = 0; i < 24 && !onMerge; i++) { await page.keyboard.press('Tab'); onMerge = await page.evaluate(() => document.activeElement?.dataset.key === 'merge'); }
        await page.keyboard.press('Enter'); await sleep(600);
        const modal = await page.evaluate(() => ({ modal: !!document.querySelector('.hmodal'), focus: document.activeElement?.textContent }));
        if (modal.modal) { await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await sleep(400); }
        const before = await hstate(page);
        let onHold = await page.evaluate(() => document.activeElement?.classList.contains('hold-btn'));
        for (let i = 0; i < 24 && !onHold; i++) { await page.keyboard.press('Tab'); onHold = await page.evaluate(() => document.activeElement?.classList.contains('hold-btn')); }
        await page.keyboard.press('Enter'); await sleep(300);
        const quick = await hstate(page);
        await page.keyboard.down('Enter'); await sleep(900); await page.keyboard.up('Enter');
        await waitUntil(page, (n) => window.__WH__.shell.hoardState().mergesToday > n && window.__WH__.shell.ceremony().kind === null, before.mergesToday, 30000);
        const after = await hstate(page);
        check('MERGE R15 keyboard: Enter on a plinth, Tab to Merge, Enter opens the pad (the last-copy warning takes focus on Cancel); a quick Enter on "Hold to merge" does nothing, Enter held 0.5 s merges',
          onMerge && onHold && (!modal.modal || modal.focus === 'Cancel') && quick.mergesToday === before.mergesToday && after.mergesToday === before.mergesToday + 1,
          JSON.stringify({ msp, onMerge, modal, onHold, merges: `${before.mergesToday} -> ${quick.mergesToday} -> ${after.mergesToday}` }));
      } else check('MERGE R15 keyboard: a mergeable pair on this roll', false, 'none after 13 capsules');
      await context.close();
    });

    // U05: a 390 x 844 phone
    await section('hoard-phone', async () => {
      const { page, context, w } = await open({ query: '?dev=1&rseed=20261006&quality=low', ctx: PHONE });
      mainWatches.push(['hoard-phone', w]);
      await wake(page, { touch: true });
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      await openCapsules(page, 6);
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(2); });
      await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 3, 0.1);
      await page.evaluate(() => window.__WH__.resume());
      await settle(page);
      const hb = await page.locator('.hoard-btn').boundingBox();
      const L = await layoutOf(page);
      const hbr = { x: hb.x, y: hb.y, r: hb.x + hb.width, b: hb.y + hb.height };
      check('U05 phone HUD: the Hoard button fits the bottom row beside the name tag, the capsule dock and the ring (no overlap, on screen)', hbr.x >= 0 && hbr.r <= L.iw && !overlap(hbr, L.name) && !overlap(hbr, L.meter) && !overlap(hbr, L.capsuleBtn) && !overlap(L.name, L.capsuleBtn), JSON.stringify({ hb: hbr, name: L.name, btn: L.capsuleBtn, meter: L.meter }));
      await shot(page, 'hud_phone_with_hoard');
      const qsp = await page.evaluate(() => { const q = document.querySelector('.qswitch'); const r = q.getBoundingClientRect(); return { n: q.querySelectorAll('.qs-btn').length, hidden: q.hidden, x: r.x, y: r.y, r: r.right, b: r.bottom }; });
      check('phone quick switcher: shown above the name tag, on screen, clear of the name tag, the hint and the capsule dock, buttons >= 44 px', !qsp.hidden && qsp.n >= 1 && qsp.x >= 0 && qsp.r <= L.iw && !overlap(qsp, L.name) && (L.hintShow !== 'true' || !overlap(qsp, L.hint)) && !overlap(qsp, L.capsuleBtn) && (qsp.b - qsp.y) >= 44, JSON.stringify({ strip: qsp, hint: L.hint, name: L.name }));
      await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.waitForFunction(() => !document.querySelector('.hoard').hidden, null, { timeout: 20000 });
      await settle(page);
      const ph = await page.evaluate(() => {
        const d = document.documentElement, body = document.querySelector('.hoard-body');
        const small = [...document.querySelectorAll('.hoard button, .hoard select')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44);
        const r = document.querySelector('.hoard').getBoundingClientRect();
        return { sw: d.scrollWidth, iw: innerWidth, full: r.x === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, scrolls: body.scrollHeight > body.clientHeight, small, paused: window.__WH__.shell.pauseReasons() };
      });
      check('U05 phone: the Hoard is a full-screen sheet, no horizontal scroll, the shelf scrolls inside it', ph.full && ph.sw <= ph.iw && ph.scrolls, JSON.stringify({ sw: ph.sw, iw: ph.iw, full: ph.full, scrolls: ph.scrolls }));
      check('U05 phone: every Hoard control is at least 44 x 44 px', ph.small.length === 0, ph.small.slice(0, 6).map((s) => `${s.c} ${s.w}x${s.h}`).join(', ') || 'all >= 44');
      check('phone: the stage under the full-screen Hoard is paused (reason "covered")', ph.paused.includes('covered'), JSON.stringify(ph.paused));
      await shot(page, 'hoard_shelf_phone');
      const sp = (await hstate(page)).items.map((i) => i.species).find((x) => x !== 'dollop') ?? 'dollop';
      await page.evaluate((s) => document.querySelector(`.hoard .plinth[data-species="${s}"]`).scrollIntoView({ block: 'center' }), sp);
      await settle(page);
      const pb = await page.locator(`.hoard .plinth[data-species="${sp}"]`).boundingBox();
      await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await page.waitForFunction(() => !document.querySelector('.hcard').hidden, null, { timeout: 20000 });
      await settle(page);
      const cardL = await page.evaluate(() => { const r = document.querySelector('.hcard').getBoundingClientRect(); const c = document.querySelector('#stage').getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), ih: innerHeight, stageShift: Math.round(c.top), paused: window.__WH__.shell.pauseReasons() }; });
      const bc = await body(page);
      const visY = cardL.stageShift + bc.y * page.viewportSize().height;
      check('U05 phone card: a bottom sheet (< 60% of the screen); the live squishy shows above it and the stage runs again', cardL.h < cardL.ih * 0.6 && visY < cardL.top && !cardL.paused.includes('covered'), JSON.stringify({ ...cardL, squishyY: Math.round(visY) }));
      await shot(page, 'hoard_card_phone');
      await hclick(page, '.hcard-back'); await settle(page);
      for (const [t, name] of [['gift', 'hoard_gift_phone'], ['today', 'hoard_today_phone']]) { await hclick(page, `#wh-tab-${t}`); await settle(page); await shot(page, name); }
      const st = await hstate(page);
      const by = {};
      for (const it of st.items) if (!it.fav && !it.locked) (by[it.species] ??= []).push(it);
      const msp = Object.keys(by).find((k) => by[k].length >= 2 && by[k][0].tier !== 'mythic');
      if (msp) {
        await hclick(page, '#wh-tab-shelf'); await settle(page);
        await page.evaluate((s) => document.querySelector(`.hoard .plinth[data-species="${s}"]`).scrollIntoView({ block: 'center' }), msp);
        await hclick(page, `.hoard .plinth[data-species="${msp}"]`); await settle(page);
        await hclick(page, '.hcard-actions [data-key="merge"]'); await settle(page);
        if (await page.evaluate(() => !!document.querySelector('.hmodal'))) { await shot(page, 'merge_lastcopy_phone'); await hclick(page, '.hmodal .act-btn.primary'); }
        await settle(page);
        const mp = await page.evaluate(() => { const r = document.querySelector('.hmerge').getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), iw: innerWidth, sw: document.documentElement.scrollWidth }; });
        check('U05 phone merge pad: a full-width sheet, no horizontal scroll', Math.abs(mp.w - mp.iw) < 2 && mp.sw <= mp.iw, JSON.stringify(mp));
        await shot(page, 'merge_pad_phone');
      } else check('U05 phone merge pad', false, 'no mergeable pair on this roll');
      await context.close();
    });

    // U06: reduced motion
    await section('hoard-calm', async () => {
      const { page, context, w } = await open({ query: '?dev=1&rseed=55', ctx: { ...DESKTOP, reducedMotion: 'reduce' } });
      mainWatches.push(['hoard-calm', w]);
      await wake(page);
      await page.evaluate(() => window.__WH__.setSetting('skipAnimations', true));
      await openCapsules(page, 2);
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.shell.grant(1); });
      const pulse = await page.evaluate(() => document.querySelector('.meter').classList.contains('pulse'));
      const landed = await stepUntil(page, `(wh) => wh.shell.meter().onTable`, 2, 0.05);
      const calm = await page.evaluate(() => ({ calm: window.__WH__.state().settings.calm, stage: window.__WH__.shell.stageInfo()?.calm }));
      await page.evaluate(() => window.__WH__.resume());
      await hclick(page, '.hoard-btn'); await settle(page);
      const anim = await page.evaluate(() => [...document.querySelectorAll('.hoard *, .hoard-btn, .hoard-btn *')].map((e) => getComputedStyle(e).animationName).filter((n) => n && n !== 'none'));
      check('U06 reduced motion: Calm effects on, the capsule fades in where it stands (no drop), no ring pulse, nothing animates in the Hoard', calm.calm && calm.stage === true && landed >= 0.3 && landed <= 0.7 && !pulse && anim.length === 0, JSON.stringify({ ...calm, pulse, landed, anim: anim.slice(0, 3) }));
      await context.close();
    });


    // U07: offline, signed in (COLLECTION 9.7 / 9.9). The practice ledger is never offline, so the dev seam fakes the server state on the
    // collection's meter: the banner, the ring's "Waiting for connection" while it keeps previewing touches, no toast storm, "Reconnected".
    await section('hoard-offline', async () => {
      const { page, context, w } = await open({ query: '?dev=1&rseed=99' });
      mainWatches.push(['hoard-offline', w]);
      await wake(page);
      await page.evaluate(() => { window.__toasts = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts++; }).observe(document.getElementById('ui'), { childList: true }); });
      await page.evaluate(() => window.__WH__.shell.forceOffline(true));
      await sleep(500);
      const s1 = await page.evaluate(() => ({ banner: !document.querySelector('.net-banner').hidden, text: document.querySelector('.net-banner').textContent, state: document.querySelector('.meter-state')?.textContent, live: document.getElementById('wh-live')?.textContent, fill: window.__WH__.shell.meter().fill }));
      const B = await body(page); const vp = page.viewportSize();
      for (let i = 0; i < 4; i++) { await page.mouse.click(B.x * vp.width + (i - 2) * 8, B.y * vp.height - 0.3 * B.rPx); await sleep(1100); }
      const s2 = await page.evaluate(() => ({ fill: window.__WH__.shell.meter().fill, toasts: window.__toasts, banner: !document.querySelector('.net-banner').hidden }));
      await shot(page, 'offline_desktop');
      check('U07 offline: the banner says "Offline. Your Hoard is read-only until we reconnect.", the ring says "Waiting for connection" and keeps previewing touches, no error toast storm',
        s1.banner && s1.text === 'Offline. Your Hoard is read-only until we reconnect.' && s1.state === 'Waiting for connection' && /Offline/.test(s1.live ?? '') && s2.banner && s2.fill > s1.fill && s2.toasts === 0,
        JSON.stringify({ ...s1, fillAfter: s2.fill, toasts: s2.toasts }));
      await page.evaluate(() => window.__WH__.shell.forceOffline(false));
      await sleep(500);
      const s3 = await page.evaluate(() => ({ banner: !document.querySelector('.net-banner').hidden, state: document.querySelector('.meter-state')?.textContent ?? '', live: document.getElementById('wh-live')?.textContent }));
      check('U07 reconnected: the banner goes, the ring state line clears and "Reconnected" is announced', !s3.banner && !/Waiting/.test(s3.state) && /Reconnected/.test(s3.live ?? ''), JSON.stringify(s3));
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // settings migration: a slice-1 blob (no `v`) and a blob from a newer build
    // ------------------------------------------------------------------------------------------------
    await section('settings-migration', async () => {
      if (C) { try { await C.context.close(); } catch { /* closed */ } C = null; }   // the capsule page, if a section above stopped early
      const seed = (blob) => `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('wobblehoard:v1:settings', ${JSON.stringify(JSON.stringify(blob))}); }`;
      {
        const { page, context, w } = await open({ query: '?dev=1', init: seed({ volume: 0.3, squishBoost: 0.9, haptics: false, shake: 0.1, gravity: false, quality: 'low' }) });
        mainWatches.push(['migration', w]);
        const s = (await state(page)).settings;
        const raw0 = await page.evaluate(() => localStorage.getItem('wobblehoard:v1:settings'));
        check('migration: a slice-1 blob keeps its six values; the new fields take their defaults (music 0.45, calm off, shortcuts on); nothing rewritten yet',
          s.volume === 0.3 && s.squishBoost === 0.9 && s.shake === 0.1 && s.gravity === false && s.quality === 'low' && s.music === 0.45 && s.calm === false && s.shortcuts === true && !JSON.parse(raw0).v, JSON.stringify(s));
        await wake(page);
        await page.click('button[aria-label="Settings"]'); await sleep(400);
        await page.focus('#wh-music'); await page.keyboard.press('End'); await sleep(300);
        const raw1 = JSON.parse(await page.evaluate(() => localStorage.getItem('wobblehoard:v1:settings')));
        check('migration: the first change writes v: 2, keeps the old values and adds only the chosen field', raw1.v === 2 && raw1.volume === 0.3 && raw1.quality === 'low' && raw1.music === 1 && !('calm' in raw1), JSON.stringify(raw1));
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
        check('migration: the new field survives a reload', (await state(page)).settings.music === 1);
        await context.close();
      }
      {
        const { page, context, w } = await open({ query: '?dev=1', init: seed({ v: 3, volume: 0.5, quality: 'high', futureField: { keep: true } }) });
        mainWatches.push(['newer-blob', w]);
        const s = (await state(page)).settings;
        await page.evaluate(() => window.__WH__.setSetting('fastOpen', true));
        const raw = JSON.parse(await page.evaluate(() => localStorage.getItem('wobblehoard:v1:settings')));
        check('a blob from a newer build (v: 3): its known values are used, and our save keeps its version and unknown keys', s.volume === 0.5 && s.quality === 'high' && raw.v === 3 && raw.futureField?.keep === true && raw.fastOpen === true, JSON.stringify(raw));
        await context.close();
      }
    });

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

    await section('touch-phone', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: PHONE });
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
      await sleep(900); await settle(page);
      const L2 = await layoutOf(page);
      check('phone: settings is a bottom sheet (full width, docked to the bottom edge)', L2.panel && Math.abs(L2.panel.x) < 1 && Math.abs(L2.panel.w - L2.iw) < 2 && Math.abs(L2.panel.b - L2.ih) < 2, JSON.stringify(L2.panel));
      check('phone: the sheet leaves the top half free (sheet is < 60% of the screen) and no scroll appears', L2.panel.h < L2.ih * 0.6 && L2.sw <= L2.iw && L2.sh <= L2.ih, `sheet ${Math.round(L2.panel.h)} of ${L2.ih}`);
      const sizes = await page.evaluate(() => [...document.querySelectorAll('.panel input[type=range], .panel .seg-face, .panel select, .panel .row-switch, .panel .icon-btn')].map((e) => { const b = e.getBoundingClientRect(); return { cls: e.className || e.tagName, w: Math.round(b.width), h: Math.round(b.height) }; }));
      check('phone: every settings control is >= 44 px', sizes.every((s) => s.h >= 44 && s.w >= 44), sizes.filter((s) => s.h < 44 || s.w < 44).map((s) => `${s.cls} ${s.w}x${s.h}`).join(', ') || `${sizes.length} checked`);
      const bd = await body(page);
      // bodyScreen() is in canvas coordinates; the canvas itself slides up while the sheet is open (styles.css), so map through its rect
      const cv = await page.evaluate(() => { const b = document.querySelector('#stage').getBoundingClientRect(); return { y: b.y, h: b.height }; });
      const visY = bd ? cv.y + bd.y * cv.h : NaN;
      check('phone: with the sheet open the squishy is still visible above it (centre above the sheet top)', bd && visY < L2.panel.y, `squishy y ${visY.toFixed(0)} on screen (canvas shifted ${cv.y.toFixed(0)} px) vs sheet top ${L2.panel.y.toFixed(0)}`);
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
      await sleep(900); await settle(page);
      const L4 = await layoutOf(page);
      check('landscape phone: the settings panel fits (scrolls inside itself) and does not overflow the screen', L4.panel.b <= L4.ih + 1 && L4.panel.y >= 0 && L4.sw <= L4.iw, JSON.stringify(L4.panel));
      await shot(page, 'settings_landscape');
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.setViewportSize({ width: 320, height: 568 });
      await sleep(1000); await settle(page);
      const L5 = await layoutOf(page);
      check('small phone 320x568: no scroll, hint inside the screen, not clipped, at most two lines', L5.sw <= L5.iw && L5.sh <= L5.ih && L5.hint.x >= 0 && L5.hint.r <= L5.iw && !L5.hintClipped && L5.hintLines <= 2, `scroll ${L5.sw}x${L5.sh} of ${L5.iw}x${L5.ih}, hint ${JSON.stringify(L5.hint)}, font ${L5.hintFont}px, clipped ${L5.hintClipped}, lines ${L5.hintLines}`);
      await shot(page, 'play_small_phone');
      await page.setViewportSize({ width: 390, height: 844 });
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // WCAG 1.4.10 reflow: 320 CSS px wide and short viewports (audit finding 11): no horizontal scroll, nothing cut off
    // ------------------------------------------------------------------------------------------------
    await section('reflow', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } });
      mainWatches.push(['reflow', w]);
      const titleAt = async (W, H) => {
        await page.setViewportSize({ width: W, height: H }); await sleep(700);
        const t = await page.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }; const lines = new Set([...document.querySelectorAll('.title-mark > span')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().top / 4))).size; return { iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, cta: r('.cta'), mark: r('.title-mark'), promise: r('.title-promise'), markLines: lines }; });
        check(`reflow ${W}x${H} title card: no horizontal scroll; wordmark (one line), tagline and the button all on screen`, t.sw <= t.iw && t.cta.b <= t.ih && t.cta.y >= 0 && t.mark.x >= 0 && t.mark.r <= t.iw && t.markLines === 1 && t.promise.r <= t.iw && t.promise.x >= 0 && t.promise.b <= t.cta.y, JSON.stringify(t));
        await shot(page, `title_${W}x${H}`);
      };
      await titleAt(320, 568); await titleAt(568, 320); await titleAt(320, 256);
      await page.setViewportSize({ width: 320, height: 568 }); await sleep(500);
      await wake(page, { touch: true });
      await page.evaluate(() => window.__WH__.shell.grant(2));
      for (const [W, H] of [[320, 568], [568, 320], [320, 460], [320, 256]]) {
        await page.setViewportSize({ width: W, height: H });
        await sleep(1200); await settle(page);
        const L = await layoutOf(page);
        const inside = (r) => r && r.x >= -0.5 && r.r <= L.iw + 0.5 && r.y >= -0.5 && r.b <= L.ih + 0.5;
        check(`reflow ${W}x${H} play: no horizontal or vertical scroll; gear, mute, name plate, meter ring and capsule button fully on screen`,
          L.sw <= L.iw && L.sh <= L.ih && inside(L.gear) && inside(L.mute) && inside(L.name) && inside(L.meter) && inside(L.capsuleBtn), JSON.stringify({ sw: L.sw, sh: L.sh, name: L.name, meter: L.meter, btn: L.capsuleBtn }));
        check(`reflow ${W}x${H} play: the bottom row does not overlap itself, and a shown hint clears it`, !overlap(L.name, L.meter) && !overlap(L.name, L.capsuleBtn) && (L.hintShow !== 'true' || (!overlap(L.hint, L.name) && !overlap(L.hint, L.meter) && !overlap(L.hint, L.capsuleBtn) && inside(L.hint) && !L.hintClipped)),
          JSON.stringify({ hint: L.hint, hintShow: L.hintShow, lines: L.hintLines }));
        await shot(page, `play_${W}x${H}`);
        await page.evaluate(() => document.querySelector('button[aria-label="Settings"]').click());
        await sleep(900); await settle(page);
        const P = await layoutOf(page);
        const clipped = P.labels.filter((l) => l.x < P.panel.x - 0.5 || l.r > P.panel.r + 0.5 || l.x < 0 || l.r > P.iw || l.sw > l.cw + 1);
        check(`reflow ${W}x${H} settings: the panel is inside the viewport, scrolls inside itself, and no label is cut off`,
          inside(P.panel) && P.sw <= P.iw && clipped.length === 0 && P.labels.length >= 10 && P.panelScroll.sh >= P.panelScroll.ch, `panel ${JSON.stringify(P.panel)}, clipped ${clipped.map((l) => l.t).join(', ') || 'none'}, labels ${P.labels.length}, scroll ${P.panelScroll.sh}/${P.panelScroll.ch}`);
        await shot(page, `settings_${W}x${H}`);
        await page.keyboard.press('Escape'); await sleep(400);
        // the Hoard at this size (WCAG 1.4.10, COLLECTION 9.10): the HUD button on screen and clear of the bottom row; the sheet inside the
        // viewport with no horizontal scroll, its header, tabs and tools inside it, every plinth name whole; at 320 x 568 also the card
        const hb = await page.evaluate(() => { const b = document.querySelector('.hoard-btn').getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; });
        await page.evaluate(() => document.querySelector('.hoard-btn').click());
        await sleep(900); await settle(page);
        const sheet = () => page.evaluate((sel) => {
          const el = document.querySelector(sel); const r = el.getBoundingClientRect();
          const cut = [...el.querySelectorAll('.plinth-name, .hcard-name, .act-btn span, .tool-btn span, .hoard-tab span')].filter((n) => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent);
          const outside = [...el.querySelectorAll('button, select, h2, p')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < r.left - 0.5 || b.right > r.right + 0.5); }).map((e) => e.className || e.tagName);
          return { x: Math.round(r.x), r: Math.round(r.right), y: Math.round(r.y), b: Math.round(r.bottom), sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, esw: el.scrollWidth, ecw: el.clientWidth, cut, outside: outside.slice(0, 4) };
        }, sel);
        let sel = '.hoard';
        const HL = await sheet();
        check(`reflow ${W}x${H} Hoard: the HUD button is on screen and clear of the bottom row; the sheet fits the viewport (no horizontal scroll), nothing sticks out of it, no name or label cut off`,
          inside(hb) && !overlap(hb, L.name) && !overlap(hb, L.meter) && !overlap(hb, L.capsuleBtn) && HL.sw <= HL.iw && HL.x >= 0 && HL.r <= HL.iw && HL.esw <= HL.ecw + 1 && HL.outside.length === 0 && HL.cut.length === 0, JSON.stringify({ hb, ...HL }));
        await shot(page, `hoard_${W}x${H}`);
        if (W === 320 && H === 568) {
          await page.evaluate(() => document.querySelector('.hoard .plinth[data-owned="true"]')?.click());
          await sleep(900); await settle(page);
          sel = '.hcard';
          const CL = await sheet();
          check(`reflow ${W}x${H} Hoard card: inside the viewport, no horizontal scroll, nothing sticks out, no label cut off`, CL.sw <= CL.iw && CL.x >= 0 && CL.r <= CL.iw && CL.esw <= CL.ecw + 1 && CL.outside.length === 0 && CL.cut.length === 0, JSON.stringify(CL));
          await shot(page, `hoard_card_${W}x${H}`);
          await page.keyboard.press('Escape'); await sleep(400);
        }
        await page.keyboard.press('Escape'); await sleep(400);
      }
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // keyboard only (audit findings 12, 13, 14): the squishy is a focus target with a visible ring; G / M respect focus
    // ------------------------------------------------------------------------------------------------
    await section('keyboard-only', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: SMALL });
      mainWatches.push(['keyboard', w]);
      check('title card: the button has focus on load (Enter / Space starts)', await page.evaluate(() => document.activeElement?.classList.contains('cta')));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await waitUntil(page, () => getComputedStyle(document.querySelector('.hud')).opacity === '1', null, 8000);
      await sleep(400);
      const f = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id, role: a?.getAttribute('role'), label: a?.getAttribute('aria-label'), vis: a?.matches(':focus-visible'), ring: getComputedStyle(a).boxShadow, rect: a.getBoundingClientRect().toJSON() }; });
      const B = await body(page); const vp = page.viewportSize();
      check('Enter starts the game, audio unlocks, and focus lands on the squishy (role=application, named) with a visible ring around it',
        (await state(page)).audio.state === 'running' && f.id === 'wh-play' && f.role === 'application' && /Squishy: Dollop/.test(f.label ?? '') && f.vis && f.ring !== 'none' && Math.abs(f.rect.x + f.rect.width / 2 - B.x * vp.width) < 40, JSON.stringify(f));
      await shot(page, 'keyboard_focus_ring');
      let seen = await evKeys(page); let a0 = await started(page);
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space');
      check('Space on the squishy pokes it (poke SoftEvent + audio poke)', !!(await waitEvent(page, seen, 'poke', { timeout: 40000 })) && (await started(page)).poke === a0.poke + 1);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      a0 = await started(page); seen = await evKeys(page);
      await page.keyboard.down('Space');
      // a hold, not a tap: wait for the press SoftEvent (after the 0.18 s tap window), then for the squeeze to be held
      const kpress = await waitEvent(page, seen, 'press', { timeout: 60000 });
      const kd = await waitUntil(page, () => window.__WH__.state().metrics.compression > 0.1, null, 60000);
      const kdm = (await state(page)).metrics;
      const kdv = (await started(page)).squish - a0.squish;
      await page.keyboard.up('Space');
      check('holding Space squishes (a press event, a squish voice, compression > 0.1 while held)', !!kpress && kd && kdv === 1 && kdm.fingers === 1, `press event ${!!kpress}, compression ${kdm.compression.toFixed(3)}, press ${typeof kdm.press === 'number' ? kdm.press.toFixed(3) : 'n/a'}, fingers ${kdm.fingers}, squish voices +${kdv}`);
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 60000);
      await page.keyboard.press('g'); await sleep(500);
      check('G on the squishy: float mode, announced in the live region ("Floating")', (await state(page)).settings.gravity === false && /Floating/.test(await live(page)), await live(page));
      await page.keyboard.press('g'); await page.keyboard.press('m'); await sleep(500);
      check('M on the squishy: muted, the mute button shows it, announced ("Sound off")', (await page.evaluate(() => document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed'))) === 'true' && /Sound off/.test(await live(page)), await live(page));
      await page.keyboard.press('m'); await sleep(300);
      // Tab order: Mute, Settings, the squishy. (blur() keeps Chromium's sequential-navigation start point on the squishy, so the first Tab
      // leaves the document (BODY) and the cycle starts there: judge the cycle of real stops, which must be exactly these three, in order.)
      await page.evaluate(() => document.activeElement.blur());
      const order = [];
      for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.split(':')[0] ?? document.activeElement?.tagName)); }
      const stops = order.filter((o) => o !== 'BODY');
      const want = ['Mute sound', 'Settings', 'Hoard', 'Squishy'];
      const k0 = stops.indexOf('Mute sound');
      const cycleOk = k0 >= 0 && stops.length >= k0 + want.length && stops.every((o, i) => o === want[(((i - k0) % want.length) + want.length) % want.length]);
      check('Tab order in play: Mute, Settings, the Hoard, the squishy (and no other stop)', cycleOk, order.join(' > '));
      // shortcuts stay out of form controls
      await page.focus('button[aria-label="Settings"]'); await page.keyboard.press('Enter'); await sleep(500);
      const g0 = (await state(page)).settings.gravity;
      await page.focus('#wh-volume'); await page.keyboard.press('g');
      await page.focus('#wh-quality'); await page.keyboard.press('m');
      await sleep(300);
      check('G on a focused slider and M on the Quality select do nothing (WCAG 2.1.4)', (await state(page)).settings.gravity === g0 && (await page.evaluate(() => document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed'))) === 'false');
      await page.focus('#wh-keys'); await page.keyboard.press('Space'); await sleep(200);
      await page.keyboard.press('Escape'); await sleep(400);
      check('Escape closes the panel and focus returns to the squishy', await page.evaluate(() => document.activeElement?.id === 'wh-play' && document.querySelector('.panel').dataset.open === 'false'));
      await page.keyboard.press('g'); await page.keyboard.press('m'); await sleep(300);
      check('with "Keyboard shortcuts" off, G and M do nothing even on the squishy', (await state(page)).settings.gravity === g0 && !(await state(page)).settings.shortcuts && (await page.evaluate(() => document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed'))) === 'false');
      seen = await evKeys(page); a0 = await started(page);
      await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space');
      check('…while Space still pokes (it is not a single-letter shortcut)', !!(await waitEvent(page, seen, 'poke', { timeout: 40000 })));
      await page.evaluate(() => window.__WH__.setSetting('shortcuts', true));
      const keysLine = await page.evaluate(() => { document.querySelector('button[aria-label="Settings"]').click(); const k = document.querySelector('.keys'); return { shown: k.offsetParent !== null, text: k.textContent }; });
      check('the Keys line is shown (a keyboard was used) and lists + / − zoom', keysLine.shown && /\+ \/ − zoom/.test(keysLine.text), JSON.stringify(keysLine));
      await context.close();
    });

    // ------------------------------------------------------------------------------------------------
    // WebGL context loss (audit finding 1): freeze input, stop held voices, resume on restore, a working give-up card
    // ------------------------------------------------------------------------------------------------
    await section('context-loss', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: SMALL });
      mainWatches.push(['context-loss', w]);
      await wake(page);
      await page.evaluate(() => { const gl = document.getElementById('stage').getContext('webgl2'); window.__lose = gl.getExtension('WEBGL_lose_context'); });
      const B = await body(page); const vp = page.viewportSize();
      await page.mouse.move(B.x * vp.width, B.y * vp.height - 20);
      await page.mouse.down();
      await waitUntil(page, () => (window.__WH__.state().audio.liveKinds?.squish ?? 0) >= 1, null, 30000);
      const held = await state(page);
      await page.evaluate(() => window.__lose.loseContext());
      const paused = await waitUntil(page, () => window.__WH__.shell.pauseReasons().includes('context'), null, 10000);
      await sleep(700);
      const L = await page.evaluate(() => ({ reasons: window.__WH__.shell.pauseReasons(), toast: document.querySelector('.toast')?.textContent, live: window.__WH__.state().audio.liveKinds?.squish ?? 0, hash: window.__WH__.state().stateHash }));
      check('context lost mid-squish: the sim pauses (reason "context"), the held squelch stops, a toast says so', held.metrics.fingers === 1 && paused && L.live === 0 && /interrupted/i.test(L.toast ?? ''), JSON.stringify(L));
      await page.mouse.up();
      const seen = await evKeys(page);
      await page.mouse.click(B.x * vp.width, B.y * vp.height - 20);
      await sleep(800);
      const L2 = await page.evaluate(() => window.__WH__.state().stateHash);
      check('context lost: input is frozen (a click pokes nothing) and the sim does not move', L2 === L.hash && !(await waitEvent(page, seen, 'poke', { timeout: 1500 })), `${L.hash} vs ${L2}`);
      await page.evaluate(() => window.__lose.restoreContext());
      const back = await waitUntil(page, () => window.__WH__.shell.pauseReasons().length === 0 && !document.querySelector('.toast'), null, 20000);
      const seen2 = await evKeys(page);
      await page.mouse.click(B.x * vp.width, B.y * vp.height - 20);
      check('context restored: the toast goes, the sim runs and a click pokes again', back && !!(await waitEvent(page, seen2, 'poke', { timeout: 40000 })));
      await waitUntil(page, () => window.__WH__.state().metrics.fingers === 0, null, 30000);
      await page.evaluate(() => window.__lose.loseContext());
      const card = await waitUntil(page, () => !!document.querySelector('.errorcard'), null, 15000);
      const e = await page.evaluate(() => ({ title: document.querySelector('.errorcard h2')?.textContent, btn: document.querySelector('.errorcard .cta')?.textContent, focus: document.activeElement?.classList.contains('cta'), phase: window.__WH__.state().phase, hudInert: document.querySelector('.hud').hasAttribute('inert'), playInert: document.querySelector('.play-target').hasAttribute('inert') }));
      const h1 = (await state(page)).stateHash;
      await page.keyboard.press('g'); await sleep(600);
      const h2 = await state(page);
      check('context not back after 5 s: a give-up card with a focused Reload button; the loop stopped, phase error, the HUD and the squishy are inert, keys do nothing',
        card && /didn’t come back/.test(e.title ?? '') && e.btn === 'Reload' && e.focus && e.phase === 'error' && e.hudInert && e.playInert && h2.stateHash === h1 && h2.settings.gravity === true, JSON.stringify(e));
      await shot(page, 'context_lost_card');
      await context.close();
    });

    await section('hidden-tab', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: SMALL });
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
    // reduced motion: Calm effects on by default (DESIGN 6.6; audit finding 15)
    // ------------------------------------------------------------------------------------------------
    await section('reduced-motion', async () => {
      const { page, context, w } = await open({ query: '?dev=1&quality=low', ctx: { ...SMALL, reducedMotion: 'reduce' } });
      mainWatches.push(['reduced-motion', w]);
      const anim = await page.evaluate(() => ({ letter: getComputedStyle(document.querySelector('.title-letter')).animationName, cta: getComputedStyle(document.querySelector('.cta')).animationName }));
      check('prefers-reduced-motion: no wobbling title letters, no breathing button', anim.letter === 'none' && anim.cta === 'none', JSON.stringify(anim));
      const s = await state(page);
      const st = await page.evaluate(() => window.__WH__.shell.stageInfo());
      check('prefers-reduced-motion: Calm effects default ON (stage calm), screen shake 0', s.settings.calm === true && st?.calm === true && s.settings.shake === 0, `calm ${s.settings.calm}, stage ${st?.calm}, shake ${s.settings.shake}`);
      await wake(page);
      await page.click('button[aria-label="Settings"]');
      await sleep(500);
      const sh = await page.evaluate(() => ({ shake: document.querySelector('#wh-shake').parentElement.querySelector('output').textContent, calm: document.querySelector('#wh-calm').checked }));
      check('prefers-reduced-motion: the panel shows Calm effects on and Screen shake Off', sh.shake === 'Off' && sh.calm === true, JSON.stringify(sh));
      await shot(page, 'settings_reduced_motion');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__WH__.shell.grant(1));
      check('prefers-reduced-motion: no ring pulse when a capsule is ready', !(await page.evaluate(() => document.querySelector('.meter').classList.contains('pulse'))));
      await context.close();
    });

    await section('no-vibrate', async () => {
      const { page, context, w } = await open({
        query: '?dev=1&quality=low', ctx: PHONE, init: () => { Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true }); },
      });
      mainWatches.push(['no-vibrate', w]);
      await wake(page, { touch: true });
      const s = await state(page);
      await page.evaluate(() => document.querySelector('button[aria-label="Settings"]').click());
      await sleep(600);
      const row = await page.evaluate(() => ({ vib: typeof navigator.vibrate, shown: document.querySelector('#wh-haptics').closest('.row').offsetParent !== null, labels: [...document.querySelectorAll('.panel .row-label')].filter((e) => e.offsetParent !== null).map((e) => e.textContent) }));
      check('a touch phone without navigator.vibrate (iOS Safari): the Haptics control is hidden, haptics default off', row.vib === 'undefined' && !row.shown && !row.labels.includes('Haptics') && s.settings.haptics === false, JSON.stringify(row));
      await page.evaluate(() => document.querySelector('.panel .icon-btn').click());
      await sleep(400);
      const B = await body(page); const vp = page.viewportSize();
      const a0 = await started(page);
      await page.touchscreen.tap(B.x * vp.width, B.y * vp.height - 20);
      check('no navigator.vibrate: a tap still pokes (no exception from the haptics wrapper)', await waitUntil(page, (n) => window.__WH__.state().audio.started.poke > n, a0.poke, 30000) && w.pageErrors.length === 0);
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
    // URL params; the HUD names the catalog species (audit finding 19)
    // ------------------------------------------------------------------------------------------------
    await section('url-params', async () => {
      const { speciesBaseGenome, SPECIES_BY_TIER } = await import('../src/data/catalog.ts');
      const { encodeGenome } = await import('../src/core/genome.ts');
      const rare = SPECIES_BY_TIER[2][1];
      const code = encodeGenome(speciesBaseGenome(rare.id, 7));
      const { page, context, w } = await open({ query: `?dev=1&float=1&quality=low&mute=1&genome=${code}` });
      mainWatches.push(['url', w]);
      const s = await state(page);
      check('?float=1 ?quality=low apply as session overrides', s.settings.gravity === false && s.settings.quality === 'low' && s.stage.tier === 'low', JSON.stringify([s.settings.gravity, s.settings.quality, s.stage.tier]));
      const hud = await page.evaluate(() => ({ name: document.querySelector('.nametag-name').textContent, tier: document.querySelector('.nametag-tier').textContent, muted: document.querySelector('.hud-actions button[aria-pressed]').getAttribute('aria-pressed'), canvas: document.getElementById('stage').getAttribute('aria-label') }));
      check(`?genome=<a ${rare.tier} code> shows that species' catalog name "${rare.name}" and tier (not a random nickname); ?mute=1 starts muted; the canvas label names it`,
        s.genomeCode === code && hud.name === rare.name && new RegExp(rare.tier, 'i').test(hud.tier) && hud.muted === 'true' && hud.canvas.includes(rare.name), JSON.stringify(hud));
      check('URL overrides were not written to storage', await page.evaluate(() => localStorage.getItem('wobblehoard:v1:settings') === null));
      await wake(page);
      await sleep(1500);
      await shot(page, 'url_genome_rare_float');
      const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:profile')));
      check('profile: the stable starter instance is stored once and ?genome= did not overwrite it', prof && prof.v === 1 && prof.instance.name === 'Dollop' && prof.instance.origin.kind === 'starter' && prof.instance.genome.hue === 32, prof ? `${prof.instance.id}` : 'none');
      const id = prof.instance.id;
      await page.goto(srv.url + '?dev=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      const prof2 = await page.evaluate(() => JSON.parse(localStorage.getItem('wobblehoard:v1:profile')));
      check('profile: the squishy keeps the SAME id across visits (the trade seam)', prof2.instance.id === id && (await page.evaluate(() => window.__WH__.shell.identity().itemId)) === id);
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
    // the PRODUCTION build (vite build -> static files, relative base './'): size, no dev tools in the bundle, no inline script/style,
    // a strict Content-Security-Policy holds, chunks load, boots, plays
    // ------------------------------------------------------------------------------------------------
    await section('prod-build', async () => {
      const out = resolve(SHOTS, 'dist_check');
      const b = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
      check('vite build succeeds', b.status === 0, (b.stderr || '').split('\n')[0]);
      if (b.status !== 0) return;
      const files = [];
      const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = resolve(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
      walk(out);
      const total = files.reduce((n, f) => n + statSync(f).size, 0);
      check('dist stays under the 1.2 MB budget (G0)', total < 1.2 * 1024 * 1024, `${(total / 1024).toFixed(0)} KB`);
      const text = files.filter((f) => /\.(js|css|html)$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')]);
      const FORBIDDEN = ['__WH__', '__shot', '__report', 'Sound lab', 'squish (hold)', 'playSound', 'createDebugTools', 'capsuleScreen', 'lab-btn', 'stageInfo'];
      const hits = FORBIDDEN.flatMap((s) => text.filter(([, t]) => t.includes(s)).map(([f]) => `${s} in ${f.slice(out.length + 1)}`));
      check('production bundle: no DebugHook, no sound lab, no /__shot poster, no dev CSS (grep of every .js / .css / .html; audit findings 6 / 20)', hits.length === 0, hits.slice(0, 4).join(', ') || `${FORBIDDEN.length} strings, ${text.length} files`);
      const html = readFileSync(resolve(out, 'index.html'), 'utf8');
      const inl = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1]) || m[2].trim()).length + (html.match(/<style\b|\sstyle=/gi) ?? []).length;
      check('dist/index.html: no inline <script>, <style> or style="" (strict CSP ready; audit finding 21)', inl === 0, `${inl} inline`);
      const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      const server = createServer((req, res) => {
        const path = resolve(out, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'));
        if (!path.startsWith(out) || !existsSync(path) || statSync(path).isDirectory()) { res.statusCode = 404; res.end('nope'); return; }
        res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
        res.setHeader('Content-Security-Policy', CSP);
        res.end(readFileSync(path));
      });
      await new Promise((ok) => server.listen(PORT + 1, ok));
      try {
        const context = await browser.newContext(SMALL);
        await context.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)); });
        const page = await context.newPage();
        const w = watch(page);
        await page.goto(`http://localhost:${PORT + 1}/index.html?dev=1&lab=1`, { waitUntil: 'load' });
        await page.waitForSelector('.cta:not([disabled])', { timeout: 120000 });
        const c = await ctaCentre(page);
        await page.mouse.click(c.x, c.y);
        await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 30000 });
        await page.click('button[aria-label="Settings"]'); await sleep(500);
        await page.focus('#wh-volume'); await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Escape'); await sleep(1500);
        const info = await page.evaluate(() => ({ hook: typeof window.__WH__, dev: !!document.querySelector('.dev'), lab: !!document.querySelector('.lab'), hud: getComputedStyle(document.querySelector('.hud')).visibility, csp: window.__csp, name: document.querySelector('.nametag-name')?.textContent }));
        check('production build under a strict CSP (script-src / style-src \'self\'): boots, plays, settings work, 0 CSP violations', info.csp.length === 0 && info.hud === 'visible' && info.name === 'Dollop', JSON.stringify(info.csp.slice(0, 3)));
        check('production build: ?dev=1&lab=1 exposes nothing (no window.__WH__, no stats overlay, no sound lab)', info.hook === 'undefined' && !info.dev && !info.lab, JSON.stringify(info));
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

  const report = { at: new Date().toISOString(), quick: QUICK, port: PORT, passed: results.filter((r) => r.ok).length, failed: failures, total: results.length, notRun, fps: fpsLog, results };
  writeFileSync(resolve(REPORTS, 'shell.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.passed}/${report.total} shell browser checks passed${notRun.length ? `   (not run: ${notRun.join('; ')})` : ''}`);
  console.log(`screenshots: ${SHOTS}\nreport: ${resolve(REPORTS, 'shell.json')}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); try { srv?.stop(); } catch { /* ignore */ } process.exit(2); });
