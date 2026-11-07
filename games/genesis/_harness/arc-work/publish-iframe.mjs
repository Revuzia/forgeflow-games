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
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
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

const report = { when: new Date().toISOString(), dists, perf: [], saves: [], entry: [] };
const save = () => writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

// 1) the plain entry (the cold-load opening) in the iframe, per build: console clean?
for (const b of Object.keys(dists)) {
  const o = await open(b, '');
  await o.page.waitForTimeout(8000);
  report.entry.push({ build: b, ready: o.ready, state: await st(o.frame), ...o.log });
  await o.page.screenshot({ path: join(OUT, `entry-${b}.png`) }).catch(() => {});
  await o.page.close(); save();
}

// 2) frame time at the default preset, sandbox world, interleaved A/B
for (let r = 0; r < RUNS; r++) for (const b of Object.keys(dists)) {
  const o = await open(b, '?scenario=sandbox');
  const s0 = await st(o.frame);
  await o.page.waitForTimeout(10_000); // settle
  await o.frame.evaluate(() => { window.__GENESIS__.perf(false); window.__GENESIS__.perf(true); }).catch(() => {});
  await o.page.waitForTimeout(SECS * 1000);
  const perf = await o.frame.evaluate(() => window.__GENESIS__.perf()).catch((e) => ({ err: String(e) }));
  const s1 = await st(o.frame);
  report.perf.push({ build: b, run: r, ready: o.ready, s0, s1, perf, ...o.log });
  await o.page.screenshot({ path: join(OUT, `sandbox-${b}-${r}.png`) }).catch(() => {});
  await o.page.close(); save();
}

// 3) old saves: a save made by the baseline build (B), and the committed fixtures, imported into build A
const saveFiles = [];
if (dists.B) {
  const o = await open('B', '?scenario=sandbox');
  await o.frame.evaluate(() => window.__GENESIS__.step(2400)).catch(() => {});
  const bytes = await o.frame.evaluate(() => window.__GENESIS__.worlds_.saves.bytes()).catch(() => null);
  if (bytes) { writeFileSync(join(OUT, 'baseline-save.gnss'), Buffer.from(bytes)); saveFiles.push(['baseline-save.gnss', bytes]); }
  report.saves.push({ made: 'B', ok: !!bytes, n: bytes?.length ?? 0, ...o.log });
  await o.page.close();
}
for (const f of ['save-1.4-aru.gnss.gz', 'save-1.4-band.gnss.gz', 'save-1.5a-kin.gnss.gz']) saveFiles.push([f, Array.from(readFileSync(join(GAME, 'tests/fixtures', f)))]);
for (const [name, bytes] of saveFiles) {
  const o = await open('A', '?scenario=sandbox');
  const before = await st(o.frame);
  const ok = await o.frame.evaluate(([b, n]) => window.__GENESIS__.worlds_.saves.importFile(b, n), [bytes, name]).catch((e) => String(e));
  await o.page.waitForTimeout(4000);
  const s1 = await st(o.frame);
  const stepped = await o.frame.evaluate(() => window.__GENESIS__.step(720)).catch((e) => String(e));
  await o.frame.evaluate(() => window.__GENESIS__.frames(2)).catch(() => {});
  const s2 = await st(o.frame);
  const arc = await o.frame.evaluate(() => Promise.all([window.__GENESIS__.arc.hearts(), window.__GENESIS__.arc.towers()])).catch((e) => String(e));
  report.saves.push({ name, ok, before, s1, stepped, s2, arc: JSON.stringify(arc).slice(0, 600), ...o.log });
  await o.page.screenshot({ path: join(OUT, `save-${name}.png`) }).catch(() => {});
  await o.page.close(); save();
}

await browser.close(); server.close(); save();
console.log(JSON.stringify(report, (k, v) => (k === 'slots' ? undefined : v), 2));
