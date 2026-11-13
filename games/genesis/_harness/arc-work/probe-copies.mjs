#!/usr/bin/env node
// PERF s15 — who causes ANGLE-Metal whole-buffer copies: boots babel, visits the soak's views, prints gpuMem's
// 'angle transients' line (copied bytes by owner) and the top buffers by copied bytes.
//   node _harness/arc-work/probe-copies.mjs --dist=DIR [--extra=a=b] [--frames=40]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=1${opts.extra ? '&' + opts.extra : ''}`);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
const views = [
  { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 90, tilt: 60 },
  { mode: 'orbit', lat: -3.7, lon: 140, dist: 120, tilt: 60 },
  { mode: 'orbit', lat: -10.4, lon: 150, dist: 150, tilt: 55 },
];
const n = Number(opts.frames ?? 30);
for (const v of views) { await page.evaluate((c) => window.__GENESIS__.camera(c), { ...v, hour: 10, blend: 1.5 }); await page.evaluate((k) => window.__GENESIS__.frames(k), n); }
const out = await page.evaluate(() => {
  const gm = globalThis.__GENESIS_GPUMEM__;
  const L = gm.lines().filter((l) => /angle transients|by owner/.test(l));
  // the biggest copied buffers with their size and owner
  const own = gm.ownerProbe?.() ?? new Map();
  const rows = [];
  for (const e of gm.live.values()) if (e.copied) { const o = e.src?.deref(); rows.push([Math.round(e.copied / 1e5) / 10, Math.round(e.bytes / 1e3), e.desc, o ? own.get(o) ?? (o.byteLength != null ? `arr ${o.byteLength}` : 'tex') : 'gone']); }
  rows.sort((a, b) => b[0] - a[0]);
  return { L, rows: rows.slice(0, 25), frame: gm.frame };
});
console.log(out.L.join('\n'));
console.log('frames', out.frame);
for (const r of out.rows) console.log('copied MB', r[0], 'size kB', r[1], r[2], r[3]);
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
