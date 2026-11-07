// VALE harness — shared bench opener for the gfx_* experiments (graphics lane GR). Same Chrome flags as pw.mjs, same
// heavy slot, plus what pw.mjs does not offer: a deviceScaleFactor (HiDPI viewports) and HMR silenced, so another
// lane's edit never reloads a page under a measurement.
//   import { openBench, B, png } from './gfx_lib.mjs';
//   const s = await openBench({ q: 'high', t: 300, seed: 7, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { holdHeavy } from './heavy_slot.mjs';

export const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
export const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');

export async function openBench(o = {}) {
  const { q = 'high', t = 300, seed = 7, mode = 'rift', w = 1920, h = 1080, dsf = 1, manual = true, dyn = false, extra = '', land = 9000, prod = false } = o;
  const release = await holdHeavy(`gfx ${q} ${w}x${h}@${dsf}`);
  const browser = await chromium.launch({
    channel: 'chrome', headless: process.env.VALE_HEADED !== '1',
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...(o.args ?? [])],
  });
  browser.on('disconnected', release);
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 240)));
  await page.goto(`${BASE}/_harness/web/render_bench.html?mode=${mode}&q=${q}&t=${t}&seed=${seed}&dev=1&hud=0&manual=${manual ? 1 : 0}&dyn=${dyn ? 1 : 0}${extra}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__.error ?? null);
  if (err) throw new Error(err);
  if (manual) {
    await B(page, (b) => { b.frames(2, 1 / 30); });
    await page.waitForTimeout(land);           // every model, prop and texture lands in real time
    await B(page, (b) => { b.frames(30, 1 / 30); });
  }
  return { browser, context, page, logs };
}

/** evaluate fn(bench, arg) in the page */
export const B = (page, fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);

/** the canvas's drawing buffer as PNG bytes (true buffer pixels, HiDPI included) */
export async function grab(page, path) {
  const { writeFileSync } = await import('node:fs');
  const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);
  const buf = Buffer.from(b64, 'base64');
  if (path) writeFileSync(path, buf);
  return buf;
}

/** a frozen frame's synced cost: renderer.render(0) + a 1x1 readPixels (forces the GPU to finish it), ms per frame.
 *  The Metal timer query is not a frame's GPU time (quality.ts header), a synced wall clock is. Blocks of `n`. */
export const timedFrames = (page, n = 30) => B(page, (b, m) => {
  const R = b.renderer, gl = R.gl.getContext(), px = new Uint8Array(4), out = [];
  for (let i = 0; i < m; i++) { const t = performance.now(); R.render(0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t); }
  return out;
}, n);

export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

/** alternate A and B in the same page in `rounds` blocks; each side's median of the per-block medians, and the deltas */
export async function abCost(page, setA, setB, { rounds = 6, n = 24, skip = 6 } = {}) {
  const A = [], Bb = [];
  for (let i = 0; i < rounds; i++) {
    await setA(); await timedFrames(page, skip); A.push(median(await timedFrames(page, n)));
    await setB(); await timedFrames(page, skip); Bb.push(median(await timedFrames(page, n)));
  }
  const d = A.map((a, i) => Bb[i] - a);
  return { a: +median(A).toFixed(2), b: +median(Bb).toFixed(2), delta: +median(d).toFixed(2), blocksA: A.map((x) => +x.toFixed(2)), blocksB: Bb.map((x) => +x.toFixed(2)) };
}

/** a slow scripted pan with the sim frozen (render(0): no sway, no particles), read back in the page. `step` is world metres
 *  a frame along x. Reports over the whole frame and over an edge mask (dilated gradient of the first frame: thin geometry
 *  and silhouettes): mafd, the mean absolute frame difference; flick, |f[t-1] - 2 f[t] + f[t+1]|, which a steady slide
 *  keeps low and a popping edge does not; pop, % of masked pixels whose frame difference is over 24 of 255 */
export const panMetric = (page, x, y, { step = 0.012, n = 40, dz = 0 } = {}) => B(page, (b, a) => {
  const R = b.renderer, gl = R.gl.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const frame = (i) => {
    b.renderer.camera.setMode('free'); b.renderer.camera.focusOn(a.x + i * a.step, a.y + i * a.dz);
    R.render(0); R.render(0);
    const p = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, p);
    const l = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) l[k] = 0.2126 * p[k * 4] + 0.7152 * p[k * 4 + 1] + 0.0722 * p[k * 4 + 2];
    return l;
  };
  let f0 = frame(0), f1 = frame(1);
  const mask = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x, g = Math.abs(f0[i + 1] - f0[i - 1]) + Math.abs(f0[i + W] - f0[i - W]);
    if (g > 40) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mask[i + dy * W + dx] = 1;
  }
  let nAll = 0, nEdge = 0, mafd = 0, mafdE = 0, flick = 0, flickE = 0, pop = 0;
  for (let t = 2; t < a.n; t++) {
    const f2 = frame(t);
    for (let i = 0; i < W * H; i++) {
      const d = Math.abs(f2[i] - f1[i]), s = Math.abs(f0[i] - 2 * f1[i] + f2[i]);
      mafd += d; flick += s; nAll++;
      if (mask[i]) { mafdE += d; flickE += s; nEdge++; if (d > 24) pop++; }
    }
    f0 = f1; f1 = f2;
  }
  return { W, H, edgePct: +(100 * nEdge / nAll).toFixed(1), mafd: +(mafd / nAll).toFixed(3), mafdEdge: +(mafdE / nEdge).toFixed(3), flick: +(flick / nAll).toFixed(3), flickEdge: +(flickE / nEdge).toFixed(3), popPct: +(100 * pop / nEdge).toFixed(3) };
}, { x, y, step, n, dz });

/** physical footprint (MB, macOS `footprint`) of the GPU process and the largest renderer of this browser */
export async function footprint(browser, page) {
  const { execFileSync } = await import('node:child_process');
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  await cdp.detach();
  const mb = (id) => { try { const m = execFileSync('footprint', ['-p', String(id)], { encoding: 'utf8', timeout: 30000 }).match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/); if (!m) return null; const v = Number(m[1]); return m[2] === 'GB' ? v * 1024 : m[2] === 'KB' ? v / 1024 : v; } catch { return null; } };
  const gpu = processInfo.find((p) => p.type === 'GPU');
  const rend = processInfo.filter((p) => p.type === 'renderer').map((p) => mb(p.id) ?? 0).sort((a, b) => b - a)[0] ?? null;
  const g = gpu ? mb(gpu.id) : null;
  return { gpuMb: g && Math.round(g), rendererMb: rend && Math.round(rend), sumMb: g && rend ? Math.round(g + rend) : null };
}
