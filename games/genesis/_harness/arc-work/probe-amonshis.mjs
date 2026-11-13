#!/usr/bin/env node
// PERF s15 / owner round 4 item 1 — WATER OVER THE HILLS at the owner's spot: babel seed 307987276, "5.1 km west of
// Amonshis by the Lake", camera ~60 m. Prints the fields of the cells around the spot (ground, water level / depth, the
// water patches) and shoots the hill from a ring of headings. Extra URL switches: --extra=water=0 ...
//   node _harness/arc-work/probe-amonshis.mjs --dist=DIR --out=DIR [--extra=a=b&c=d] [--km=5.1] [--dist=120] [--tag=x]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/perf/amon');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const url = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'high'}&intro=0&speed=0${opts.extra ? '&' + opts.extra : ''}`;
await page.goto(url);
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
const km = Number(opts.km ?? 5.1);
const info = await page.evaluate((km) => {
  const G = window.__GENESIS__, R = globalThis.__GENESIS_R__;
  const st = G.state();
  const pl = st.planets[0];
  const vis = [...R.planets.values()][0];
  const pv = vis.pv;
  const rad = pv.params.radius;
  const ss = pv.settlements.map((s) => ({ name: s.name, pos: [...s.pos] }));
  const am = ss.find((s) => /Amonshis/.test(s.name));
  if (!am) return { err: 'no Amonshis', names: ss.map((s) => s.name) };
  let u;
  if (km > 0) {
    const p = am.pos, lon = Math.atan2(p[0], p[2]);
    const east = [Math.cos(lon), 0, -Math.sin(lon)];
    const a = km * 1000 / rad;
    u = [Math.cos(a) * p[0] - Math.sin(a) * east[0], Math.cos(a) * p[1] - Math.sin(a) * east[1], Math.cos(a) * p[2] - Math.sin(a) * east[2]];
  } else {
    // (--km=0) the point under the start view's centre: the owner's 'standard zoom landing' (wheel toward the centre)
    const c = vis.camBody; const l = Math.hypot(c.x, c.y, c.z); u = [c.x / l, c.y / l, c.z / l];
  }
  // nearest living settlement and its distance (the palette's words)
  let nb = null, nd = Infinity;
  for (const s of pv.settlements) { if (s.flags & 2) continue; const d = Math.acos(Math.min(1, s.pos[0] * u[0] + s.pos[1] * u[1] + s.pos[2] * u[2])) * rad; if (d < nd) { nd = d; nb = s.name; } }
  const ll = (v) => [Math.asin(v[1]) * 180 / Math.PI, Math.atan2(v[0], v[2]) * 180 / Math.PI];
  // the cells within 400 m: ground, water fields
  const grid = pv.grid, F = pv.fields;
  const names = [...F.keys()];
  const cells = grid.cellsWithin(u[0], u[1], u[2], 400 / rad);
  const pick = (k, c) => { const f = F.get(k); return f ? Math.round(f[c] * 100) / 100 : null; };
  const rows = cells.slice(0, 60).map((c) => {
    const d = Math.acos(Math.min(1, grid.pos[c * 3] * u[0] + grid.pos[c * 3 + 1] * u[1] + grid.pos[c * 3 + 2] * u[2])) * rad;
    const o = { c, d: Math.round(d) };
    for (const k of names) if (/water|surface|wet|flood|depth|level|lake|river|flow|sea|film/i.test(k)) o[k] = pick(k, c);
    return o;
  }).sort((x, y) => x.d - y.d);
  return { radius: rad, amonshis: ll(am.pos), spot: ll(u), nearest: nb, nearestM: Math.round(nd), fieldNames: names, rows, waterPatches: vis.lod.stats.waterPatches };
}, km);
console.log(JSON.stringify(info, null, 0).slice(0, 6000));
writeFileSync(join(OUT, `${tag}-info.json`), JSON.stringify(info, null, 1));
if (info.spot) {
  const [lat, lon] = info.spot;
  const dists = String(opts.cdist ?? '110').split(',').map(Number);
  for (const dist of dists) for (const turn of [0, 90, 180, 270]) {
    await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', lat, lon, dist, tilt: Number(opts.tilt ?? 62), hour: 10, turn, blend: 0 });
    await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.settle ?? 10));
    const wp = await page.evaluate(() => { const vis = [...globalThis.__GENESIS_R__.planets.values()][0]; return { water: vis.lod.stats.waterPatches, patches: vis.lod.stats.patches, alt: Math.round(globalThis.__GENESIS_R__.stats.altitude ?? -1) }; });
    await page.screenshot({ path: join(OUT, `${tag}-d${dist}-t${turn}.png`) });
    console.log('shot', dist, turn, JSON.stringify(wp));
  }
}
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
