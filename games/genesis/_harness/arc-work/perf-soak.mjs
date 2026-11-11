#!/usr/bin/env node
// PERF s7 — soak probe on the BUILT game (static server, headless Chromium / SwiftShader): runs the world for --mins
// minutes of wall time at --speed, moving the camera between views every --every s, and samples every --sample s what
// could GROW over time: shader programs, geometries, textures (three's renderer.info), JS heap (CDP), DOM nodes / JS
// event listeners / documents (CDP Memory.getDOMCounters), snapshots full vs 'same', frames, ticks.
// Usage: node _harness/arc-work/perf-soak.mjs --dist=DIR [--scenario=twoworlds] [--speed=10] [--mins=10] [--out=x.json]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const [vw, vh] = String(opts.size ?? '888x500').split('x').map(Number);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const T0 = Date.now();
const el = () => Math.round((Date.now() - T0) / 1000);
const url = `http://127.0.0.1:${PORT}/?scenario=${opts.scenario ?? 'twoworlds'}&quality=${opts.quality ?? 'high'}&intro=0&speed=0${opts.extra ? '&' + opts.extra : ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
console.log('boot', el(), url);
const speed = Number(opts.speed ?? 10);
await page.evaluate((s) => window.__GENESIS__.setSpeed(s), speed).catch((e) => console.log('speed()', String(e)));
const views = [
  { mode: 'orbit', poi: 'city', dist: 220, tilt: 50 },
  { mode: 'orbit', poi: 'city', dist: 1400, tilt: 40 },
  { mode: 'orbit', lat: 12, lon: -30, dist: 7600 },
  { mode: 'orbit', poi: 'forest', dist: 400, tilt: 45 },
];
const sample = async () => {
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({}));
  const r = await page.evaluate(() => {
    const R = globalThis.__GENESIS_R__; const i = R.three.info;
    const s = window.__GENESIS__.state();
    return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures, frames: s.frames, tick: Math.round(s.tick), fps: Math.round(s.fps * 10) / 10, snaps: s.snapshots, draws: R.stats.drawCalls };
  });
  return { t: el(), ...r, heapMB: Math.round((heap.usedSize ?? 0) / 1e5) / 10, nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
};
const rows = [];
const mins = Number(opts.mins ?? 10), every = Number(opts.every ?? 45), each = Number(opts.sample ?? 30);
let vi = 0, nextView = 0, nextSample = 0;
while (el() < mins * 60) {
  if (el() >= nextView) {
    await page.evaluate((c) => window.__GENESIS__.camera(c), { ...views[vi++ % views.length], hour: 10, blend: 1.5 }).catch((e) => console.log('camera', String(e)));
    nextView = el() + every;
  }
  if (el() >= nextSample) {
    const s = await sample();
    rows.push(s);
    console.log('sample', JSON.stringify(s));
    nextSample = el() + each;
  }
  await page.waitForTimeout(1000);
}
console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
if (opts.out) writeFileSync(resolve(ROOT, opts.out), JSON.stringify({ url, rows, errors }, null, 1));
await browser.close();
server.close();
console.log('done', el());
