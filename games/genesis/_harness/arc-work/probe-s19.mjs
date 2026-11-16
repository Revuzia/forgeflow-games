#!/usr/bin/env node
// PERF s19 — bisection-switch proof: boots babel 307987276 at speed 0 with --extra, visits the views, screenshots each,
// prints the report's switch line, page errors and shader / GL console messages. --zab=1: in-page zpre A/B per view
// (shots <tag>-<view>-on.png / -off.png / -on2.png, one frame apart).
//   node _harness/arc-work/probe-s19.mjs --dist=DIR --tag=x --extra='tshade=all' [--views=town,forest] [--quality=high] [--size=400x225]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/s19/shots');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '400x225').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [], glmsgs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { const t = m.text(); if (/WebGL|GL_|shader|THREE|INVALID|ERROR/i.test(t) && !/GPU stall|GroupMarkerNotSet/.test(t)) glmsgs.push(`${m.type()}: ${t.slice(0, 400)}`); });
const T0 = Date.now();
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=0&ui=0${opts.extra ? '&' + opts.extra : ''}`;
console.log('url', url);
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
console.log('boot s', ((Date.now() - T0) / 1000).toFixed(0));
const hour = Number(opts.hour ?? 10);
const CAM = {
  region: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 1400, tilt: 40, hour, blend: 0 },
  town: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 90, tilt: 60, hour, blend: 0 },
  low: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 160, tilt: 12, hour, blend: 0 },
  ridge: { mode: 'orbit', poi: 'peak', dist: 1800, tilt: 30, hour: 17.6, blend: 0 },
  shore: { mode: 'orbit', poi: 'coast', dist: 260, tilt: 55, hour, blend: 0 },
  forest: { mode: 'orbit', poi: 'forest', dist: 200, tilt: 50, hour, blend: 0 },
};
const settle = Number(opts.settle ?? 40);
for (const v of String(opts.views ?? 'town,forest').split(',')) {
  await page.evaluate((c) => window.__GENESIS__.camera(c), CAM[v]);
  for (let f = 0; f < settle; f += 5) await page.evaluate(() => window.__GENESIS__.frames(5));
  if (opts.zab) {
    for (const [n, on] of [['on', true], ['off', false], ['on2', true], ['off2', false]]) {
      await page.evaluate((o) => { globalThis.__GENESIS_R__.zpreOn = o; }, on);
      await page.evaluate(() => window.__GENESIS__.frames(1));
      await page.screenshot({ path: join(OUT, `${tag}-${v}-${n}.png`) });
    }
  } else await page.screenshot({ path: join(OUT, `${tag}-${v}.png`) });
  const st = await page.evaluate(() => { const s = globalThis.__GENESIS_R__.stats; return `tris scene ${s.sceneTris} shadow ${s.shadowTris} alt ${s.altitude?.toFixed?.(0)}`; });
  console.log('view', v, st);
}
console.log('page errors', errors.length, errors.slice(0, 5));
console.log('gl messages', glmsgs.length, glmsgs.slice(0, 8));
await browser.close(); server.close();
