#!/usr/bin/env node
// PERF s17 — terrain patch CHURN at rest (still camera, speed 0): instruments every ChunkLOD (store / evict / prefetch),: boots babel 307987276, rests the camera on the
// town view, waits for the freeze to take hold (when freeze=1), takes a shot, records the in-game perf report over
// --recms of frames and prints it (gl calls / angle transients / gpuprobe lines), then a second shot.
//   node _harness/arc-work/probe-freeze.mjs --dist=DIR --tag=on --extra='freeze=1&gpuprobe=1' [--out=DIR] [--recms=8000]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/freeze');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '400x225').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { const t = m.text(); if (/gpuprobe|freeze/.test(t)) console.log('console:', t); });
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=${opts.speed ?? 1}&ui=0${opts.extra ? '&' + opts.extra : ''}`;
console.log('url', url);
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 90, tilt: 60, hour: 10, blend: 0 });
await page.evaluate((k) => window.__GENESIS__.frames(k), Number(opts.settle ?? 30));
await page.evaluate(() => {
  const L = globalThis.__CHURN__ = [];
  let i = 0;
  for (const vis of globalThis.__GENESIS_R__.planets.values()) {
    const lod = vis.lod; const id = i++;
    const st = { id, builds: 0, rebuilds: 0, evicted: 0, evictCalls: 0, keys: new Map(), ever: new WeakSet(), levels: {}, stale: 0 };
    L.push(st);
    const store = lod.store.bind(lod);
    lod.store = (p, geo) => { st.builds++; if (st.ever.has(p)) st.rebuilds++; st.ever.add(p); st.levels[p.level] = (st.levels[p.level] ?? 0) + 1; const k = `${p.face}/${p.level}/${p.a}`; st.keys.set(k, (st.keys.get(k) ?? 0) + 1); return store(p, geo); };
    const ev = lod.evict.bind(lod);
    lod.evict = (f) => { const b = lod.live.size; ev(f); st.evictCalls++; st.evicted += b - lod.live.size; st.live = lod.live.size; st.sel = lod.selected.length; st.budget = Math.max(lod.maxCached, Math.ceil(lod.selected.length * 1.5)); st.pending = lod.pending.size; st.ready = lod.ready.length; };
    // patches with lastUsed older than the frame among the live ones after select
  }
});
const n = Number(opts.frames ?? 8);
for (let f = 0; f < n; f++) {
  await page.evaluate(() => window.__GENESIS__.frames(1));
  const r = await page.evaluate(() => globalThis.__CHURN__.map((s) => ({ id: s.id, builds: s.builds, rebuilds: s.rebuilds, evicted: s.evicted, live: s.live, sel: s.sel, budget: s.budget, pending: s.pending, ready: s.ready, levels: s.levels })));
  console.log('frame', f, JSON.stringify(r));
}
const top = await page.evaluate(() => globalThis.__CHURN__.map((s) => [...s.keys].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 12)));
console.log('most rebuilt keys per lod', JSON.stringify(top));
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
