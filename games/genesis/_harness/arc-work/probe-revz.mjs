#!/usr/bin/env node
// PERF s18 (ROADMAP-60FPS step 8) — reversed-Z vs log depth image proof: boots babel 307987276 at sim speed 0, visits
// the views (region, town, ridge, orbit, coast, town + injected decals), settles each and takes a screenshot; prints
// the perf report's 'depth:' lines, the page errors and any shader / GL console errors.
//   node _harness/arc-work/probe-revz.mjs --dist=DIR --tag=r1 --extra='revz=1' [--out=DIR] [--views=region,town,...]
//        [--quality=medium] [--size=400x225] [--settle=40] [--seq=pan]   (--seq=pan: a fly / pan sequence, a shot per stop)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/s18/shots');
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
// --hc=N: report N logical cores (>= 6 makes the game start TWO patch workers, as on the owner's Mac)
if (opts.hc) await page.addInitScript((n) => { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => n, configurable: true }); }, Number(opts.hc));
const errors = [];
const glmsgs = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { const t = m.text(); if (/WebGL|GL_|shader|THREE|INVALID|ERROR/i.test(t) && !/GPU stall|GroupMarkerNotSet/.test(t)) glmsgs.push(`${m.type()}: ${t.slice(0, 300)}`); });
const T0 = Date.now();
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'medium'}&intro=0&speed=${opts.speed ?? 0}&ui=0${opts.extra ? '&' + opts.extra : ''}`;
console.log('url', url);
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
console.log('boot s', ((Date.now() - T0) / 1000).toFixed(0));
console.log('ext', await page.evaluate(() => { const gl = globalThis.__GENESIS_R__.three.getContext(); return ['EXT_clip_control', 'EXT_conservative_depth', 'EXT_depth_clamp', 'WEBGL_lose_context'].map((e) => `${e}=${gl.getSupportedExtensions().includes(e)}`).join(' ') + ' reversed=' + globalThis.__GENESIS_R__.three.state.buffers.depth.getReversed() + ' camRev=' + globalThis.__GENESIS_R__.camera.reversedDepth; }));
const hour = Number(opts.hour ?? 10);
const CAM = {
  region: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 1400, tilt: 40, hour, blend: 0 },
  town: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 90, tilt: 60, hour, blend: 0 },
  towndecal: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 150, tilt: 52, hour, blend: 0 },
  ridge: { mode: 'orbit', poi: 'peak', dist: 1800, tilt: 30, hour: 17.6, blend: 0 },
  orbit: { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour, blend: 0 },
  night: { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 0.5, blend: 0 },
  coast: { mode: 'surface', poi: 'coast', alt: 40, pitch: -3, hour, blend: 0 },
  shore: { mode: 'orbit', poi: 'coast', dist: 260, tilt: 55, hour, blend: 0 },
  forest: { mode: 'orbit', poi: 'forest', dist: 200, tilt: 50, hour, blend: 0 },
  // pan / fly stops (item 3: stale pages over the water / clouds): high over the sea, then down and along the coast
  p1: { mode: 'orbit', poi: 'coast', dist: 900, tilt: 35, hour, blend: 0 },
  p2: { mode: 'orbit', poi: 'coast', dist: 520, tilt: 25, hour, blend: 1.5 },
  p3: { mode: 'orbit', poi: 'coast', dist: 300, tilt: 20, hour, blend: 1.5 },
  p4: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 500, tilt: 25, hour, blend: 1.5 },
  p5: { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 250, tilt: 15, hour, blend: 1.5 },
  p6: { mode: 'orbit', poi: 'peak', dist: 600, tilt: 20, hour, blend: 1.5 },
};
const injectDecals = () => page.evaluate(() => {
  if (globalThis.__DECALS_ON__) return; globalThis.__DECALS_ON__ = true;
  const fx = globalThis.__GENESIS_FX__.fx, dp = fx.decals;
  const vis = [...globalThis.__GENESIS_R__.planets.values()][0];
  const orig = dp.prepare.bind(dp);
  for (const k of ['prepareDecals', 'renderDecals']) { const o = fx[k].bind(fx); fx[k] = (...a) => { if (globalThis.__DECALS_ON__) fx.group.visible = true; return o(...a); }; }
  dp.prepare = (...a) => {
    if (!globalThis.__DECALS_ON__) return orig(...a);
    const c = vis.camBody, l = Math.hypot(c.x, c.y, c.z), g = l - globalThis.__GENESIS_R__.stats.altitude;
    const e = vis.uniforms.uBodyToView.value.elements;
    const dx = -e[2], dy = -e[5], dz = -e[8];
    const bq = c.x * dx + c.y * dy + c.z * dz, cq = l * l - g * g, disc = bq * bq - cq;
    const t = disc > 0 ? -bq - Math.sqrt(disc) : 0;
    const P = { x: c.x + dx * t, y: c.y + dy * t, z: c.z + dz * t };
    const mk = (type, r, cr, cg, cb, ca) => ({ type, x: P.x, y: P.y, z: P.z, r, ax: P.x / g, ay: P.y / g, az: P.z / g, cr, cg, cb, ca, p0: r, p1: 0, p2: 0, p3: 0, q0: 0, q1: 0, q2: 0, q3: 0 });
    dp.add(Object.assign(mk(5, 70, 1, 1, 1, 1), { p0: 60, p1: 0.8, p2: 3.3 }));
    dp.add(Object.assign(mk(10, 90, 1, 0.55, 0.2, 1), { p0: 90, p1: 4e3, p2: 20, p3: 40 }));
    dp.add(Object.assign(mk(16, 50, 1, 1, 1, 1), { p0: 40, p1: 0.8, p2: 2 }));
    return orig(...a);
  };
});
const views = String(opts.views ?? 'region,town,towndecal,ridge,orbit,night,coast,shore,forest').split(',');
const settle = Number(opts.settle ?? 40);
for (const v of views) {
  const t1 = Date.now();
  if (v === 'towndecal') await injectDecals(); else await page.evaluate(() => { globalThis.__DECALS_ON__ = false; });
  if (v === 'towndecal') await page.evaluate(() => { globalThis.__DECALS_ON__ = true; });
  await page.evaluate((c) => window.__GENESIS__.camera(c), CAM[v]);
  const early = Number(opts.early ?? 0);
  if (early) { await page.evaluate((n) => window.__GENESIS__.frames(n), early); await page.screenshot({ path: join(OUT, `${tag}-${v}-early.png`) }); }
  // settle: until the terrain stops landing (stats.pending / built unchanged), at most `settle` frames
  for (let f = 0; f < settle; f += 5) await page.evaluate(() => window.__GENESIS__.frames(5));
  await page.screenshot({ path: join(OUT, `${tag}-${v}.png`) });
  const st = await page.evaluate(() => { const s = globalThis.__GENESIS_R__.stats; return { d: s.drawCalls, t: s.triangles, alt: Math.round(s.altitude) }; });
  console.log('view', v, JSON.stringify(st), ((Date.now() - t1) / 1000).toFixed(0), 's');
}
if (opts.report) {
  const txt = await page.evaluate((ms) => window.__GENESIS__.perfReport(ms), Number(opts.recms ?? 3000));
  console.log('REPORT ' + tag + '\n' + txt.split('\n').slice(0, 14).join('\n') + '\nEND REPORT');
}
console.log('gl messages', glmsgs.length, [...new Set(glmsgs)].slice(0, 12).join('\n  '));
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
