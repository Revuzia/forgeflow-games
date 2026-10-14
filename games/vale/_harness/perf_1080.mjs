// VALE harness — the 1080p60 check: the real renderer in real Chrome (GPU, 1920×1080, DPR 1) for each
// quality preset, the camera on the densest fight of a live RIFT match, frame times from rAF.
//   VALE_HEADED=1 node _harness/perf_1080.mjs [--t 600] [--sec 8] [--q low,medium,high,ultra]
// Writes _harness/_reports/perf_1080.json and prints one line per preset.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 600)), SEC = Number(opt('sec', 8));
const PRESETS = opt('q', 'low,medium,high,ultra').split(',');
const out = { gpu: null, viewport: '1920x1080', dpr: 1, matchTime: T, seconds: SEC, presets: {} };

for (const q of PRESETS) {
  const { browser, page } = await open(`/_harness/web/render_bench.html?mode=rift&q=${q}&t=${T}&dev=1&hud=1`, { wait: false });
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
  out.gpu ??= await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  await page.waitForTimeout(4000);                                        // models, textures, shader warm-up
  await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate((sec) => new Promise((res) => {
    const d = []; let last = performance.now(); const end = last + sec * 1000;
    const tick = (now) => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else res(d); };
    requestAnimationFrame(tick);
  }), SEC);
  const stats = await page.evaluate(() => window.__VALE_BENCH__.stats());
  r.sort((a, b) => a - b);
  const avg = r.reduce((s, x) => s + x, 0) / r.length;
  const p = (k) => r[Math.min(r.length - 1, Math.floor(r.length * k))];
  out.presets[q] = { fps: +(1000 / avg).toFixed(1), avgMs: +avg.toFixed(2), p95Ms: +p(0.95).toFixed(2), p99Ms: +p(0.99).toFixed(2), frames: r.length, stats };
  console.log(`${q.padEnd(7)} ${out.presets[q].fps} fps  avg ${out.presets[q].avgMs} ms  p95 ${out.presets[q].p95Ms} ms  p99 ${out.presets[q].p99Ms} ms  ${JSON.stringify(stats).slice(0, 160)}`);
  await browser.close();
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '_reports');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'perf_1080.json'), JSON.stringify(out, null, 1));
console.log(`GPU: ${out.gpu}`);
