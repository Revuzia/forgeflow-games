// VALE harness — a small Playwright (playwright-core) driver for the real Chrome on this machine.
// Real key and mouse events in real Chromium, pixels read back (CONTRACT §0 "Verification is at the
// player's layer"). The browser runs from a fresh temporary profile; it never touches the owner's.
//
//   import { open, shot, vale, waitFor } from './pw.mjs';
//   const { browser, page } = await open('/?dev=1');          // 1920×1080, GPU on
//   await shot(page, 'home');                                   // → _harness/_shots/home.png
//
// Env: VALE_URL (default http://localhost:5190), VALE_HEADED=1 (show the window), VALE_SHOTS (dir).

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
export const SHOTS = process.env.VALE_SHOTS ?? join(HERE, '_shots');

/** launch Chrome (the installed channel) with the GPU on, open `path` at 1920×1080 */
export async function open(path = '/?dev=1', o = {}) {
  const release = await holdHeavy('pw ' + path);   // one machine-wide heavy slot per harness process (heavy_slot.mjs)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.VALE_HEADED !== '1',
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  browser.on('disconnected', release);
  const context = await browser.newContext({ viewport: { width: o.width ?? 1920, height: o.height ?? 1080 }, deviceScaleFactor: 1 });
  // o.hmr === false: a silent stand-in for the dev server's HMR socket, so edits other lanes make to the
  // shared checkout mid-run never reload the page under a long measurement
  if (o.hmr === false) await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // failed requests with their URL (Chrome's console line for a 404 does not name the resource)
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) logs.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  if (o.wait !== false) await page.waitForFunction(() => !!window.__vale, null, { timeout: 30000 });
  return { browser, context, page, logs };
}

/** screenshot into SHOTS/<name>.png (optionally a clip {x,y,width,height}) */
export async function shot(page, name, clip) {
  mkdirSync(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  return path;
}

/** evaluate in the page with the dev handle (window.__vale) as `v` */
export async function vale(page, fn, arg) {
  return page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__vale, a), [fn.toString(), arg]);
}

/** poll a predicate over the dev handle until true (or throw after `ms`) */
export async function waitFor(page, fn, ms = 60000, arg) {
  const t0 = Date.now();
  for (;;) {
    if (await vale(page, fn, arg)) return;
    if (Date.now() - t0 > ms) throw new Error(`waitFor timed out: ${fn.toString().slice(0, 120)}`);
    await page.waitForTimeout(250);
  }
}

/** the centre of the first element matching a selector (for real mouse clicks) */
export async function centre(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
