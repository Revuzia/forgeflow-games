// GENESIS — ARC publish verifier probe (verify-A-r1-publish). Serves one or two built dist/ dirs with the CDN's headers
// on 127.0.0.1, frames each game in an 888x500 iframe with the site's sandbox tokens from a host page on localhost
// (cross-origin, as on forgeflowgames.com), and reports: console errors (all frames), page crashes, frame time at the
// default preset in a sandbox world (interleaved A/B runs), and old-save loading (fixtures + a save made by build B).
//   node _harness/arc-work/publish-iframe.mjs --a=<distA> [--b=<distBaseline>] --port=5352 --runs=2 --secs=20 --out=<dir>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync as _g } from 'node:zlib';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const PORT = Number(arg('port', '5352'));
const RUNS = Number(arg('runs', '2'));
const SECS = Number(arg('secs', '20'));
const OUT = resolve(arg('out', '.'));
const GAME = resolve(new URL('../..', import.meta.url).pathname);
const dists = { A: resolve(arg('a', join(GAME, 'dist'))) };
if (arg('b', '')) dists.B = resolve(arg('b', ''));
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.gz': 'application/gzip' };
const host = (src) => `<!doctype html><meta charset=utf-8><body style="margin:0;background:#111">
<iframe id=g src="${src}" width=888 height=500 style="border:0;display:block"
 sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"
 allow="autoplay; fullscreen; gamepad; pointer-lock"></iframe>`;
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(host(u.searchParams.get('src'))); return; }
  const m = /^\/(A|B)\/(.*)$/.exec(u.pathname);
  if (!m || !dists[m[1]]) { res.writeHead(404); res.end(); return; }
  const f = join(dists[m[1]], m[2] || 'index.html');
  try {
    await stat(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'cross-origin-embedder-policy': 'credentialless',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'no-store' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(PORT, ok));

const require = createRequire(import.meta.url);
let pw = null;
for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { pw = require(c); break; } catch { /* next */ } }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'] });

async function open(build, query) {
  const page = await browser.newPage({ viewport: { width: 888, height: 500 } });
  const log = { errors: [], warnings: [], crashed: false, missing: [] };
  page.on('console', (m) => { if (m.type() === 'error' && log.errors.length < 50) log.errors.push(m.text().slice(0, 500)); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + String(e)));
  page.on('crash', () => { log.crashed = true; });
  page.on('response', (r) => { if (r.status() >= 400) log.missing.push(`${r.status()} ${r.url()}`); });
  const src = `http://127.0.0.1:${PORT}/${build}/index.html${query}`;
  await page.goto(`http://localhost:${PORT}/host.html?src=${encodeURIComponent(src)}`, { waitUntil: 'load' });
  let frame = null;
  for (const until = Date.now() + 60_000; !frame && Date.now() < until; ) { frame = page.frames().find((f) => f.url().startsWith(src.split('?')[0])); if (!frame) await page.waitForTimeout(500); }
  const ready = await frame.waitForFunction(() => !!window.__GENESIS__, null, { timeout: 90_000 })
    .then(() => frame.evaluate(() => Promise.race([window.__GENESIS__.ready.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 120_000))]))).catch((e) => String(e));
  await frame.evaluate(() => Promise.race([window.__GENESIS__.frames(3), new Promise((ok) => setTimeout(ok, 90_000))])).catch(() => {});
  return { page, frame, log, ready };
}
const st = (frame) => frame.evaluate(() => { const s = window.__GENESIS__.state(); return { tick: s.tick, quality: s.quality, speed: s.speed, scenario: s.scenario, seed: s.seed, frames: s.frames }; }).catch((e) => ({ err: String(e) }));


// r2b: (1) frame time by driven frames (an OOPIF in headless Chromium reports document.hidden, and the game draws only for
// frame waiters then), interleaved A/B; (2) the committed fixtures, gunzipped, into A and B; (3) a babel world saved by A
// (with arc state) and read back into A.
const gunzipSync = _g;
const report = { when: new Date().toISOString(), dists, vis: [], perf: [], saves: [] };
const save = () => writeFileSync(join(OUT, 'report2.json'), JSON.stringify(report, null, 2));
const b64In = (frame, buf, name) => frame.evaluate(([b64, n]) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return window.__GENESIS__.worlds_.saves.importFile(u.buffer, n); }, [Buffer.from(buf).toString('base64'), name]).catch((e) => String(e));
const N = Number(arg('frames', '40'));
for (let r = 0; r < RUNS; r++) for (const b of Object.keys(dists)) {
  const o = await open(b, '?scenario=sandbox');
  if (r === 0) report.vis.push({ build: b, v: await o.frame.evaluate(() => [document.hidden, document.visibilityState]).catch((e) => String(e)) });
  await o.frame.evaluate(() => window.__GENESIS__.frames(20)).catch(() => {});
  await o.frame.evaluate(() => { window.__GENESIS__.perf(false); window.__GENESIS__.perf(true); }).catch(() => {});
  const t0 = Date.now();
  await o.frame.evaluate((n) => window.__GENESIS__.frames(n), N).catch(() => {});
  const wall = Date.now() - t0;
  const perf = await o.frame.evaluate(() => window.__GENESIS__.perf()).catch((e) => ({ err: String(e) }));
  report.perf.push({ build: b, run: r, n: N, wallMsPerFrame: +(wall / N).toFixed(1), quality: (await st(o.frame)).quality, frames: perf.frames, work: perf.work, interval: perf.interval, slots: perf.slots, errors: o.log.errors });
  await o.page.close(); save();
}
for (const f of ['save-1.4-aru', 'save-1.4-band', 'save-1.5a-kin']) for (const b of Object.keys(dists)) {
  const meta = JSON.parse(readFileSync(join(GAME, 'tests/fixtures', f + '.json'), 'utf8'));
  const bytes = gunzipSync(readFileSync(join(GAME, 'tests/fixtures', f + '.gnss.gz')));
  const o = await open(b, '?scenario=sandbox');
  const ok = await b64In(o.frame, bytes, f + '.gnss');
  await o.frame.evaluate(() => window.__GENESIS__.frames(3)).catch(() => {});
  const s1 = await st(o.frame);
  const stepped = await o.frame.evaluate(() => window.__GENESIS__.step(720)).catch((e) => String(e));
  await o.frame.evaluate(() => window.__GENESIS__.frames(3)).catch(() => {});
  const s2 = await st(o.frame);
  const arc = b === 'A' ? await o.frame.evaluate(() => Promise.all([window.__GENESIS__.arc.hearts(), window.__GENESIS__.arc.towers()])).catch((e) => String(e)) : null;
  report.saves.push({ name: f, build: b, metaTick: meta.tick, ok, s1, stepped, s2, arc: JSON.stringify(arc).slice(0, 400), errors: o.log.errors, crashed: o.log.crashed });
  await o.page.screenshot({ path: join(OUT, `fx-${f}-${b}.png`), timeout: 120_000 }).catch(() => {});
  await o.page.close(); save();
}
{
  const o = await open('A', '?scenario=babel');
  await o.frame.evaluate(() => window.__GENESIS__.step(7200)).catch(() => {});
  const arc0 = await o.frame.evaluate(() => Promise.all([window.__GENESIS__.arc.hearts(), window.__GENESIS__.arc.towers()])).catch((e) => String(e));
  const b64 = await o.frame.evaluate(async () => { const a = await window.__GENESIS__.worlds_.saves.bytes(); if (!a) return null;
    let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.slice(i, i + 8192)); return btoa(s); }).catch(() => null);
  const s0 = await st(o.frame); await o.page.close();
  const rec = { name: 'babel-A', s0, arc0: JSON.stringify(arc0).slice(0, 600), n: b64 ? b64.length : 0 };
  if (b64) {
    const p = await open('A', '?scenario=sandbox');
    rec.ok = await b64In(p.frame, Buffer.from(b64, 'base64'), 'babel-A.gnss');
    await p.frame.evaluate(() => window.__GENESIS__.frames(3)).catch(() => {});
    rec.s1 = await st(p.frame);
    rec.arc1 = JSON.stringify(await p.frame.evaluate(() => Promise.all([window.__GENESIS__.arc.hearts(), window.__GENESIS__.arc.towers()])).catch((e) => String(e))).slice(0, 600);
    rec.stepped = await p.frame.evaluate(() => window.__GENESIS__.step(720)).catch((e) => String(e));
    rec.errors = p.log.errors;
    await p.page.screenshot({ path: join(OUT, 'babel-reload.png'), timeout: 120_000 }).catch(() => {});
    await p.page.close();
  }
  report.saves.push(rec); save();
}
await browser.close(); server.close(); save();
console.log('done');
