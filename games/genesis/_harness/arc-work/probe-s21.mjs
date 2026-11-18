#!/usr/bin/env node
// PERF s21 (water: waterland / wfast / wdebug; views land sea lake shore river night orbit added) — from probe-s20:
// PERF s20 — `?tnoise=tex` / `?tcache=1` look proof on SwiftShader, made fast: trees / cover / clouds / shadows / post off
// (the same in A and B: the terrain's own shading is what is compared). Boots babel 307987276 at speed 0, visits views,
// one screenshot each; --edits=1 then paints snow, digs a crater, paints sand and lava near the town and shoots each.
//   node _harness/arc-work/probe-s20.mjs --dist=DIR --tag=base --extra='tnoise=tex' [--views=a,b] [--size=640x360] [--edits=1]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/s21/shots');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [], glmsgs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { const t = m.text(); if (/WebGL|GL_|shader|THREE|INVALID|ERROR|tnoise|tcache/i.test(t) && !/GPU stall|GroupMarkerNotSet/.test(t)) glmsgs.push(`${m.type()}: ${t.slice(0, 600)}`); });
const T0 = Date.now();
const FAST = opts.full ? '' : '&hide=veg,cover,life&clouds=0&gtao=0&bloom=0&godrays=0&shadows=0&fartrees=0&water=' + (opts.water ?? '1');
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=0&ui=0${FAST}${opts.extra ? '&' + opts.extra : ''}`;
console.log('url', url);
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
console.log('boot s', ((Date.now() - T0) / 1000).toFixed(0));
const hour = Number(opts.hour ?? 10);
const S1 = { kind: 'settlement', id: 1 };
const LAND = { lat: 17.87588, lon: -35.0 };   // the owner's landing spot, 5.1 km west of Amonshis
const CAM = {
  land: { mode: 'orbit', ...LAND, dist: 90, tilt: 62, hour, blend: 0 },
  land2: { mode: 'orbit', ...LAND, dist: 60, tilt: 75, hour, blend: 0 },
  sea: { mode: 'orbit', lat: 17.9, lon: -35.6, dist: 60, tilt: 75, hour, blend: 0 },
  seafar: { mode: 'orbit', lat: 17.9, lon: -35.6, dist: 600, tilt: 70, hour: 16.5, blend: 0 },
  lake: { mode: 'orbit', target: S1, dist: 120, tilt: 65, hour, blend: 0 },
  shore: { mode: 'orbit', poi: 'coast', dist: 40, tilt: 55, hour, blend: 0 },
  river: { mode: 'orbit', poi: 'river', dist: 60, tilt: 55, hour, blend: 0 },
  night: { mode: 'orbit', ...LAND, dist: 90, tilt: 70, hour: 23.5, blend: 0 },
  dusk: { mode: 'orbit', lat: 17.9, lon: -35.6, dist: 80, tilt: 78, hour: 18.2, blend: 0 },
  town: { mode: 'orbit', target: S1, dist: 90, tilt: 60, hour, blend: 0 },
  meadow: { mode: 'orbit', target: S1, dist: 14, tilt: 35, hour, blend: 0 },       // near ground, a few m across
  graze: { mode: 'orbit', target: S1, dist: 160, tilt: 8, hour, blend: 0 },        // grazing view to the horizon
  rake: { mode: 'orbit', target: S1, dist: 60, tilt: 40, hour: 17.9, blend: 0 },   // low sun: the bump normal shows
  floor: { mode: 'orbit', poi: 'forest', dist: 18, tilt: 40, hour, blend: 0 },     // forest floor (trees hidden)
  forest: { mode: 'orbit', poi: 'forest', dist: 200, tilt: 50, hour, blend: 0 },
  rock: { mode: 'orbit', poi: 'peak', dist: 40, tilt: 45, hour, blend: 0 },
  peak: { mode: 'orbit', poi: 'peak', dist: 500, tilt: 45, hour: 16.5, blend: 0 }, // rock and snow
  sand: { mode: 'orbit', poi: 'coast', dist: 30, tilt: 40, hour, blend: 0 },
  sand2: { mode: 'orbit', poi: 'coast', dist: 120, tilt: 50, hour, blend: 0 },
  desert: { mode: 'orbit', poi: 'desert', dist: 60, tilt: 40, hour, blend: 0 },
  far: { mode: 'orbit', target: S1, dist: 2600, tilt: 35, hour: 15, blend: 0 },
  orbit: { mode: 'orbit', lat: 18, lon: -35, dist: 7800, hour: 16.25, blend: 0 },
};
const settle = Number(opts.settle ?? 12);
// (PERF s23) --cams='{"name":{spec},...}' adds camera specs (views by these names)
if (opts.cams) Object.assign(CAM, JSON.parse(opts.cams));
const G = (fn, a) => page.evaluate(fn, a);
async function shot(name) {
  for (let f = 0; f < settle; f += 4) await G(() => window.__GENESIS__.frames(4));
  await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) });
  console.log('shot', name, ((Date.now() - T0) / 1000).toFixed(0), 's');
}
// (PERF s23) --step=N advances the sim N ticks first; view 'boot' keeps the game's own landing camera
if (opts.step) console.log('step', await G((n) => window.__GENESIS__.step(n), Number(opts.step)));
for (const v of String(opts.views ?? 'town,meadow').split(',').filter(Boolean)) {
  if (v !== 'boot') await G((c) => window.__GENESIS__.camera(c), CAM[v]);
  await shot(v);
}
if (opts.edits) {
  const p = await G(() => window.__GENESIS__.poi('settlement:1'));
  const cmd = (c) => G((c) => window.__GENESIS__.cmd(c), c);
  await G((c) => window.__GENESIS__.camera(c), { mode: 'orbit', target: S1, dist: 220, tilt: 50, hour, blend: 0 });
  await shot('e0');
  for (const [n, c] of [
    ['e1-snow', { k: 'terrain.paint-material', material: 'snow', pos: p.pos, radius: 60, depth: 0.5 }],
    ['e2-crater', { k: 'terrain.crater', pos: p.pos, radius: 35, strength: 5 }],
    ['e3-sand', { k: 'terrain.paint-material', material: 'sand', pos: p.pos, radius: 30, depth: 0.6 }],
    ['e4-lava', { k: 'terrain.paint-material', material: 'lava', pos: p.pos, radius: 14, depth: 2 }],
  ]) {
    console.log(n, JSON.stringify(await cmd(c)).slice(0, 160));
    await G(() => window.__GENESIS__.step(Number(4)));
    await shot(n);
  }
  await G(() => window.__GENESIS__.step(600));   // the snow thaws / wets the ground, the lava cools
  await shot('e5-later');
}
if (opts.storm) { }
if (opts.stats) console.log('perf', JSON.stringify(await G(() => { const p = window.__GENESIS__.perf(); return p; })).slice(0, 1500));
console.log('state', JSON.stringify(await G(() => window.__GENESIS__.state())).slice(0, 400));
console.log('switches', await G(() => { try { return (window.__GENESIS__.perfSwitches?.() ?? '') ; } catch { return ''; } }));
console.log('page errors', errors.length, errors.slice(0, 5));
console.log('gl messages', glmsgs.length, glmsgs.slice(0, 8));
await browser.close(); server.close();
