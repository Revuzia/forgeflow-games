// GENESIS — the ForgeFlow games CDN, locally: the REAL worker (workers/games-cdn/src/index.js) serving a built dist/
// under /genesis/ from a stand-in R2 bucket, then a Playwright load of the game through it.
//
//   node _harness/cdn.mjs            serve dist/ at http://localhost:5197/genesis/index.html and smoke-test it
//   node _harness/cdn.mjs --serve    serve only (Ctrl+C to stop)
//
// It checks what the live CDN would do to the game and nothing else: every file the page asks for is in the bucket
// (no 404), the worker's headers (COEP credentialless, no-store HTML, immutable hashed assets for opted-in games) let
// the module worker and fonts load, the sim worker ticks, and the console stays clean. Run `npm run build` first.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..');
const DIST = join(GAME, 'dist');
const WORKER = resolve(GAME, '../../workers/games-cdn/src/index.js');
const SLUG = 'genesis';
const PORT = Number(process.env.CDN_PORT || 5197);

/** an R2 bucket that holds <slug>/<path> = dist/<path> (the keys deploy_game.py uploads) */
const bucket = {
  async get(key) {
    if (!key.startsWith(SLUG + '/')) return null;
    const rel = key.slice(SLUG.length + 1);
    if (rel.split('/').some((p) => p === '..' || p === '')) return null;
    const file = join(DIST, rel);
    let st;
    try { st = await stat(file); } catch { return null; }
    if (!st.isFile()) return null;
    return {
      size: st.size,
      httpEtag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      writeHttpMetadata() { /* deploy_game.py uploads without custom metadata */ },
      get body() { return Readable.toWeb(createReadStream(file)); },
    };
  },
};

const worker = (await import(pathToFileURL(WORKER).href)).default;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers }), { GAMES: bucket, ALLOWED_ORIGIN: 'https://forgeflowgames.com' });
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    // (the Workers runtime would compress a gzip-flagged body itself; nothing GENESIS ships is flagged)
    res.writeHead(r.status, headers);
    if (r.body && req.method !== 'HEAD') Readable.fromWeb(r.body).pipe(res); else res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e && e.stack || e));
  }
});

await stat(join(DIST, 'index.html')).catch(() => { console.error('dist/index.html is missing: run `npm run build` first'); process.exit(2); });
await new Promise((ok) => server.listen(PORT, ok));
const entry = `http://localhost:${PORT}/${SLUG}/index.html`;
console.log(`CDN worker serving dist/ at ${entry}`);
if (process.argv.includes('--serve')) await new Promise(() => {});

// ── smoke test through the CDN ──
// (the same Playwright the shot harness uses: the global install, else a local one)
const require = createRequire(import.meta.url);
let pw = null;
for (const c of ['/opt/node22/lib/node_modules/playwright', 'playwright']) { try { pw = require(c); break; } catch { /* next */ } }
if (!pw) { console.error('playwright not found'); process.exit(2); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const missing = [];
const seen = new Map();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.port !== String(PORT)) return;
  seen.set(u.pathname, { status: r.status(), cache: r.headers()['cache-control'] || '', type: r.headers()['content-type'] || '', coep: r.headers()['cross-origin-embedder-policy'] || '' });
  if (r.status() >= 400) missing.push(`${r.status()} ${u.pathname}`);
});
// 1) the plain entry (a cold load plays the opening), 2) a living sandbox: the sim worker must tick
const loads = [];
for (const url of [entry, `${entry}?scenario=sandbox`]) {
  await page.goto(url, { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => !!window.__GENESIS__, null, { timeout: 60_000 }).then(() => page.evaluate(() => Promise.race([window.__GENESIS__.ready.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 90_000))]))).catch(() => false);
  const t0 = await page.evaluate(() => Number(window.__GENESIS__?.state?.().tick ?? -1)).catch(() => -1);
  // (state().tick refreshes per rendered frame, and a software renderer can take 10-60 s a frame: wait for two more
  // frames, then poll up to 120 s for the tick to move, instead of a fixed 4 s that fails a healthy build)
  await page.evaluate(() => Promise.race([window.__GENESIS__?.frames?.(2), new Promise((ok) => setTimeout(ok, 90_000))])).catch(() => {});
  let t1 = await page.evaluate(() => Number(window.__GENESIS__?.state?.().tick ?? -1)).catch(() => -1);
  for (const until = Date.now() + 120_000; ready && t1 <= t0 && Date.now() < until; ) {
    await page.waitForTimeout(3000);
    t1 = await page.evaluate(() => Number(window.__GENESIS__?.state?.().tick ?? -1)).catch(() => -1);
  }
  loads.push({ url, ready, tick0: t0, tick1: t1 });
  await page.screenshot({ path: join(GAME, '_shots', `cdn-smoke-${loads.length}.png`) }).catch(() => {});
}
const ticked = loads[1].ready && loads[1].tick1 > loads[1].tick0 ? loads[1].tick1 : null;
await browser.close();
server.close();

const hashed = [...seen].filter(([p]) => /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(p));
const report = {
  entry,
  loads,
  ticked,
  requests: seen.size,
  missing,
  consoleErrors: errors,
  html: seen.get(`/${SLUG}/index.html`),
  hashedAssets: hashed.length,
  hashedImmutable: hashed.filter(([, h]) => /immutable/.test(h.cache)).length,
  worker: [...seen].filter(([p]) => /worker/i.test(p)).map(([p, h]) => `${p} ${h.status} ${h.type}`),
};
console.log(JSON.stringify(report, null, 2));
const ok = !!ticked && loads[0].ready && missing.length === 0 && errors.length === 0;
console.log(ok ? 'CDN SMOKE: PASS' : 'CDN SMOKE: FAIL');
process.exit(ok ? 0 : 1);
