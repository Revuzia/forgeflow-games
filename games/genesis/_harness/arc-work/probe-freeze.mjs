#!/usr/bin/env node
// PERF s17 (ROADMAP-60FPS step 2) — ?freeze=1 and ?gpuprobe=1 locally: boots babel 307987276, rests the camera on the
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
// let the landing converge (freeze=1 takes hold after 90 quiet frames); at most --wait frames
const wait = Number(opts.wait ?? 200);
let f = 0;
for (; f < wait; f += 5) {
  await page.evaluate(() => window.__GENESIS__.frames(5));
  const st = await page.evaluate(() => globalThis.__GENESIS_FREEZE__ ? { on: globalThis.__GENESIS_FREEZE__.on, active: globalThis.__GENESIS_FREEZE__.active, quiet: globalThis.__GENESIS_FREEZE__.quiet } : null);
  if (!st || !st.on) { if (f >= Number(opts.settle ?? 40)) break; continue; }
  if (st.active) break;
}
await page.evaluate(() => window.__GENESIS__.frames(3));
console.log('settled after', f, 'frames; freeze', JSON.stringify(await page.evaluate(() => globalThis.__GENESIS_FREEZE__)));
await page.screenshot({ path: join(OUT, `${tag}-1.png`) });
const st0 = await page.evaluate(() => ({ ...globalThis.__GENESIS_R__.stats }));
const txt = await page.evaluate((ms) => window.__GENESIS__.perfReport(ms), Number(opts.recms ?? 8000));
await page.screenshot({ path: join(OUT, `${tag}-2.png`) });
const st1 = await page.evaluate(() => ({ ...globalThis.__GENESIS_R__.stats }));
console.log('stats before', JSON.stringify({ d: st0.drawCalls, t: st0.triangles, alt: Math.round(st0.altitude) }), 'after', JSON.stringify({ d: st1.drawCalls, t: st1.triangles, alt: Math.round(st1.altitude) }));
console.log('REPORT ' + tag + '\n' + txt + '\nEND REPORT');
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
