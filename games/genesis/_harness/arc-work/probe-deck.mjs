#!/usr/bin/env node
// PERF s16 / owner round 4 item 2 — CLOUD DECK at the owner's stops: babel seed 307987276, the standard zoom landing
// (the point under the start view's centre), the camera RESTING at each --stops altitude (m over the ground, as the
// game's stats.altitude reports it; the orbit dist is searched for it, tilt = the orbit's autoTilt like a wheel zoom).
// Shots <out>/<tag>-aNNN.png + a white-fraction metric (pixels with luminance > 0.85 and low chroma).
//   node _harness/arc-work/probe-deck.mjs --dist=DIR --out=DIR --tag=new [--extra=deckfull=0] [--stops=540,456,...]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/deck');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '480x270').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=0&ui=0${opts.extra ? '&' + opts.extra : ''}`;
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
const spot = await page.evaluate(() => {
  const vis = [...globalThis.__GENESIS_R__.planets.values()][0];
  const c = vis.camBody; const l = Math.hypot(c.x, c.y, c.z);
  const R = vis.pv.params.radius;
  return { lat: Math.asin(c.y / l) * 180 / Math.PI, lon: Math.atan2(c.x, c.z) * 180 / Math.PI, R, inner: vis.cloudInner != null ? vis.cloudInner - R : null, outer: vis.cloudOuter != null ? vis.cloudOuter - R : null };
});
console.log('spot', JSON.stringify(spot), url);
const alt = () => page.evaluate(() => globalThis.__GENESIS_R__.stats.altitude);
const stops = String(opts.stops ?? '540,456,383,320,266,220,181').split(',').map(Number);
const hour = Number(opts.hour ?? 10);
let dist = stops[0];
const rows = [];
for (const target of stops) {
  // search the orbit dist that rests the camera at `target` m over the ground
  for (let k = 0; k < 3; k++) {
    await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', lat: spot.lat, lon: spot.lon, dist, hour, blend: 0 });
    await page.evaluate(() => window.__GENESIS__.frames(2));
    const a = await alt();
    if (Math.abs(a - target) < 3) break;
    dist = Math.max(20, dist * target / Math.max(5, a));
  }
  await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.settle ?? 6));
  const a = await alt();
  const p = join(OUT, `${tag}-a${String(target).padStart(3, '0')}.png`);
  await page.screenshot({ path: p });
  // white fraction / mean luminance of the frame (the canvas read back via a 2d copy of the screenshot)
  const m = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = new OffscreenCanvas(img.width, img.height); const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height).data; let w = 0, s = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], bl = d[i + 2]; const L = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255; s += L; if (L > 0.85 && Math.max(r, g, bl) - Math.min(r, g, bl) < 25) w++; }
    return { white: Math.round(w / n * 1000) / 1000, lum: Math.round(s / n * 1000) / 1000 };
  }, readFileSync(p).toString('base64'));
  const row = { target, alt: Math.round(a), dist: Math.round(dist), ...m };
  rows.push(row);
  console.log('stop', JSON.stringify(row));
}
writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ url, spot, rows, errors }, null, 1));
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
