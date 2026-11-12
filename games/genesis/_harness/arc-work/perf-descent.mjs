#!/usr/bin/env node
// PERF session 6 — visual probe on the BUILT game (static server, headless Chromium / SwiftShader):
//   --phase=descent  a scripted descent over a forest from 2 km to 50 m (every ~150 m), each step flown (blend) from
//                    the last; shots `<shot>-dNNNN-early.png` (2 frames into the flight) and `<shot>-dNNNN.png`
//                    (settled), with the far / near tree counts per step
//   --phase=zoom     a fast zoom orbit -> town through the cloud deck: a shot EVERY frame of the flight
//                    (`<shot>-zNN.png`) for mean-luminance (white frames) checks, plus camera altitude per frame
//   --phase=zoomfixed  the same zoom on a FIXED 60 fps clock (performance.now / rAF time advance 1/60 s per frame,
//                    whatever the real frame takes): every frame of a --zsecs flight, as a 60 fps Mac would draw it;
//                    shots `<shot>-fNNN.png`; mean luminance per frame: python3 _harness/arc-work/perf-lum.py <shot>-f
//   --phase=lowsun   region + ridge views at a low sun (--hour), shots + shadow stats (A/B with --extra=reach=0)
// Usage: node _harness/arc-work/perf-descent.mjs --dist=DIR --phase=descent,zoom --shot=PATH [--extra=a=1&b=2]
//        [--size=888x500] [--quality=high] [--save=world.gnss] [--steps=2000,1850,...] [--blend=0.8] [--settle=6]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const [vw, vh] = String(opts.size ?? '888x500').split('x').map(Number);
const phases = (opts.phase ?? 'descent').split(',');
const shot = resolve(ROOT, opts.shot ?? '_harness/scratch/arc/perf/shots/desc');
mkdirSync(dirname(shot), { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p === '/__save' && opts.save) { res.setHeader('content-type', 'application/octet-stream'); res.end(readFileSync(resolve(ROOT, opts.save))); return; }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
// (the fixed clock for --phase=zoomfixed: off until window.__FIXCLOCK__.on(); then time moves 1/60 s per frame)
await ctx.addInitScript(() => {
  const real = performance.now.bind(performance);
  const rraf = window.requestAnimationFrame.bind(window);
  let on = false, hold = false, base = 0, t = 0;
  // hold(): time stands still (frames drawn meanwhile, e.g. by a screenshot, see dt = 0) so every 60 fps frame is seen
  window.__FIXCLOCK__ = { on() { base = real(); t = 0; on = true; hold = false; }, off() { on = false; }, hold(h) { hold = h; } };
  performance.now = () => (on ? base + t : real());
  window.requestAnimationFrame = (cb) => rraf((ts) => { if (on) { if (!hold) t += 1000 / 60; cb(base + t); } else cb(ts); });
});
const page = await ctx.newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(0) + ' s';
const url = `http://127.0.0.1:${PORT}/?scenario=${opts.scenario ?? 'sandbox'}&quality=${opts.quality ?? 'high'}&intro=0&speed=0&ui=0${opts.extra ? '&' + opts.extra : ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
console.log('boot', el(), url);
if (opts.save) {
  await page.evaluate(async () => { const G = window.__GENESIS__; const b = await (await fetch('/__save')).arrayBuffer(); await G.worlds_.saves.importFile(b, 'perf.gnss'); });
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => { try { return window.__GENESIS__.state().tick > 1000; } catch { return false; } }, null, { timeout: 3600000, polling: 1000 });
  await page.evaluate(() => window.__GENESIS__.ready);
  console.log('loaded save', el());
}
const stats = () => page.evaluate(() => {
  const R = globalThis.__GENESIS_R__; const s = R.stats;
  let far = null, near = null;
  for (const v of R.planets.values()) if (v.vegetation && v.vegetation.farStats) { far = { ...v.vegetation.farStats }; near = { ...v.vegetation.stats }; break; }
  // far-tree meshes that draw (count > 0, visible): the far draws per pass
  let farMeshes = 0, farMeshesAll = 0;
  for (const v of R.planets.values()) v.vegetation?.farGroup?.traverse((o) => { if (o.name === 'fartrees') { farMeshesAll++; if (o.visible && o.count > 0) farMeshes++; } });
  return { alt: Math.round(s.altitude), draws: s.drawCalls, tris: s.triangles, shadowTris: s.shadowTris, sceneTris: s.sceneTris, farMeshes, farMeshesAll, far, near };
});
const out = { url, phases: {} };
const firstSettlement = await page.evaluate(() => { const s = window.__GENESIS__.state(); const l = (s.planets?.[0]?.settlements ?? []).slice().sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0)); return l[0]?.id ?? null; }).catch(() => null);
const town = firstSettlement != null ? `settlement:${firstSettlement}` : 'city';

if (phases.includes('descent')) {
  const steps = (opts.steps ?? '2000,1850,1700,1550,1400,1250,1100,950,800,650,500,350,200,50').split(',').map(Number);
  const rows = [];
  const poi = opts.poi ?? 'forest';
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', poi, dist: steps[0], tilt: 50, hour: 10 });
  await page.evaluate(() => window.__GENESIS__.frames(Number(8)));
  for (const d of steps) {
    await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', poi, dist: d, tilt: 50, hour: 10, blend: Number(opts.blend ?? 0.8) });
    await page.evaluate(() => window.__GENESIS__.frames(2));
    await page.screenshot({ path: `${shot}-d${String(d).padStart(4, '0')}-early.png` });
    const early = await stats();
    await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.settle ?? 6));
    await page.screenshot({ path: `${shot}-d${String(d).padStart(4, '0')}.png` });
    const st = await stats();
    rows.push({ d, early, settled: st });
    console.log('descent', d, el(), JSON.stringify({ early: early.far, settled: st }));
  }
  out.phases.descent = rows;
}

if (phases.includes('zoom')) {
  const rows = [];
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 10 });
  await page.evaluate(() => window.__GENESIS__.frames(6));
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', poi: town, dist: 150, tilt: 52, hour: 10, blend: Number(opts.zblend ?? 1.0) });
  const n = Number(opts.zframes ?? 24);
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__GENESIS__.frames(1));
    const p = `${shot}-z${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: p });
    const st = await stats();
    rows.push({ i, ...st });
    console.log('zoom', i, el(), JSON.stringify(st));
  }
  out.phases.zoom = rows;
}

if (phases.includes('zoomfixed')) {
  const rows = [];
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 10 });
  await page.evaluate(() => window.__GENESIS__.frames(8));
  await page.evaluate(() => window.__FIXCLOCK__.on());
  const secs = Number(opts.zsecs ?? 1.2);
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', poi: town, dist: 150, tilt: 52, hour: 10, blend: secs });
  const n = Math.round(secs * 60) + Number(opts.zafter ?? 20);
  // --zhi / --zlo: shoot only frames with the camera altitude in [zlo, zhi] (the deck crossing); others just advance
  const zhi = Number(opts.zhi ?? 1e9), zlo = Number(opts.zlo ?? -1e9);
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__GENESIS__.frames(1));
    await page.evaluate(() => window.__FIXCLOCK__.hold(true));
    const st = await stats();
    if (st.alt <= zhi && st.alt >= zlo) await page.screenshot({ path: `${shot}-f${String(i).padStart(3, '0')}.png` });
    await page.evaluate(() => window.__FIXCLOCK__.hold(false));
    rows.push({ i, ...st });
    console.log('zf', i, el(), JSON.stringify({ alt: st.alt, draws: st.draws }));
    if (st.alt < zlo) break;
  }
  await page.evaluate(() => window.__FIXCLOCK__.off());
  out.phases.zoomfixed = rows;
}

if (phases.includes('wheelfixed')) {
  // the player's zoom through the deck: wheel events on the canvas on the fixed 60 fps clock (--wdy per event, one
  // event every --wevery frames: -100 / 4 = a mouse wheel spun briskly, -6 / 1 = a trackpad scroll), from --wdist
  const rows = [];
  const dist0 = Number(opts.wdist ?? 1400), wdy = Number(opts.wdy ?? -100), every = Number(opts.wevery ?? 4);
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', poi: town, dist: dist0, tilt: 52, hour: Number(opts.hour ?? 10) });
  await page.evaluate(() => window.__GENESIS__.frames(10));
  console.log('shell', JSON.stringify(await page.evaluate(() => { for (const v of globalThis.__GENESIS_R__.planets.values()) if (v.cloudOuter) return { inner: v.cloudInner - v.params.radius, outer: v.cloudOuter - v.params.radius, R: v.params.radius }; return null; })));
  await page.evaluate(() => window.__FIXCLOCK__.on());
  const zhi = Number(opts.zhi ?? 1e9), zlo = Number(opts.zlo ?? -1e9);
  const n = Number(opts.wframes ?? 240);
  let below = 0;
  for (let i = 0; i < n; i++) {
    if (i % every === 0) await page.evaluate((dy) => {
      const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
      cs[0].dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
    }, wdy);
    await page.evaluate(() => window.__GENESIS__.frames(1));
    await page.evaluate(() => window.__FIXCLOCK__.hold(true));
    const st = await stats();
    if (st.alt <= zhi && st.alt >= zlo && i % Number(opts.zevery ?? 1) === 0) await page.screenshot({ path: `${shot}-w${String(i).padStart(3, '0')}.png` });
    await page.evaluate(() => window.__FIXCLOCK__.hold(false));
    rows.push({ i, ...st });
    console.log('wf', i, el(), JSON.stringify({ alt: st.alt, draws: st.draws }));
    if (st.alt < zlo && ++below > 6) break;
  }
  await page.evaluate(() => window.__FIXCLOCK__.off());
  out.phases.wheelfixed = rows;
}

if (phases.includes('lowsun')) {
  const rows = [];
  const hour = Number(opts.hour ?? 17.6);
  for (const [name, cam] of [['regionlow', { mode: 'orbit', poi: town, dist: 1400, tilt: 40, hour }], ['ridgelow', { mode: 'orbit', poi: 'peak', dist: 1800, tilt: 30, hour }], ['townlow', { mode: 'orbit', poi: town, dist: 150, tilt: 52, hour }], ['town', { mode: 'orbit', poi: town, dist: 150, tilt: 52, hour: 10 }]]) {
    await page.evaluate((c) => window.__GENESIS__.camera(c), cam);
    await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.settle ?? 6));
    await page.screenshot({ path: `${shot}-${name}.png` });
    const st = await stats();
    rows.push({ name, ...st });
    console.log('lowsun', name, el(), JSON.stringify(st));
  }
  out.phases.lowsun = rows;
}

out.errors = errors;
console.log('errors', errors.length, errors.slice(0, 5).join(' | '));
writeFileSync(`${shot}.json`, JSON.stringify(out, null, 1));
await browser.close();
server.close();
console.log('done', el());
