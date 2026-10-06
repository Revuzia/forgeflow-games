// Shared setup for the verifier probes: Vite on port 5371, Chromium (SwiftShader), the renderview page as host, lib.js injected.
import { startVite, launch } from '/home/user/forgeflow-games/games/wobblehoard/_harness/pw.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
export const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/render_verify';
export const PORT = 5371;
const LIB = readFileSync(S + '/lib.js', 'utf8');
process.env.WH_FROZEN ??= '1';

export async function setup({ width = 800, height = 600, dpr = 1, body = '' } = {}) {
  const srv = await startVite(PORT);
  const browser = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const bad = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/\[vite\]|GPU stall due to ReadPixels/.test(m.text())) bad.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  page.on('crash', () => bad.push('crash'));
  await page.goto(`http://localhost:${PORT}/_harness/renderview/index.html?quality=low&body=${body}`);
  await page.waitForFunction(() => window.__RV_READY__ === true, null, { timeout: 280000 });
  await page.evaluate(() => { document.getElementById('c').style.display = 'none'; });
  const info = await page.evaluate(LIB);
  const cdp = await ctx.newCDPSession(page);
  const close = async () => { try { await browser.close(); } catch { /* gone */ } srv.stop(); };
  return { srv, browser, ctx, page, bad, info, cdp, close };
}
export const b64 = (u) => Buffer.from(u.split(',')[1], 'base64');
export function save(name, obj) { mkdirSync(S + '/out', { recursive: true }); writeFileSync(`${S}/out/${name}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1)); }

/** Direction flips of a series after a swing >= thr (the DESIGN 6.6 / harness definition of a luminance transition). */
export function zigzag(L, thr) {
  const idx = []; let dir = 0, pivot = L[0];
  for (let k = 1; k < L.length; k++) {
    const v = L[k];
    if (dir === 0) { if (v - pivot >= thr) { dir = 1; pivot = v; idx.push(k); } else if (pivot - v >= thr) { dir = -1; pivot = v; idx.push(k); } }
    else if (dir === 1) { if (v > pivot) pivot = v; else if (pivot - v >= thr) { dir = -1; pivot = v; idx.push(k); } }
    else { if (v < pivot) pivot = v; else if (v - pivot >= thr) { dir = 1; pivot = v; idx.push(k); } }
  }
  return idx;
}
/** WCAG-style: a transition = a swing of >= 10% of max relative luminance (relative to the pair), where the darker state is < 0.80. */
export function zigzagRel(L, frac = 0.1) {
  const idx = []; let dir = 0, pivot = L[0];
  const ok = (a, b) => Math.abs(a - b) >= frac && Math.min(a, b) < 0.8;
  for (let k = 1; k < L.length; k++) {
    const v = L[k];
    if (dir === 0) { if (v > pivot && ok(v, pivot)) { dir = 1; pivot = v; idx.push(k); } else if (v < pivot && ok(v, pivot)) { dir = -1; pivot = v; idx.push(k); } }
    else if (dir === 1) { if (v > pivot) pivot = v; else if (ok(v, pivot)) { dir = -1; pivot = v; idx.push(k); } }
    else { if (v < pivot) pivot = v; else if (ok(v, pivot)) { dir = 1; pivot = v; idx.push(k); } }
  }
  return idx;
}
export function worstWindow(idx, dt) { let w = 0, at = -1; for (let i = 0; i < idx.length; i++) { let n = 0; for (let j = i; j < idx.length && (idx[j] - idx[i]) * dt < 1 - 1e-9; j++) n++; if (n > w) { w = n; at = idx[i]; } } return { n: w, atFrame: at }; }
