#!/usr/bin/env node
// PERF s18 — the reload leak: loads the game N times in ONE tab (each a navigation to the same page with another
// query, as the owner's A/B rounds do) and after each load samples the resident memory of the browser's GPU process
// and of its renderer process(es) (ps RSS; with SwiftShader the "GPU memory" is the GPU process's own RSS).
//   node _harness/arc-work/probe-reload.mjs --dist=DIR --tag=on --extra='pagerelease=1' [--loads=4] [--quality=medium]
//        [--size=640x360] [--frames=20] [--bfcache=1]   (--bfcache=1: leave Chrome's back/forward cache on)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => { let p = decodeURIComponent((req.url ?? '/').split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(DIST, p); if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; } res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', `--user-agent-tag=genesis-reload-${tag}-${process.pid}`];
const launch = { args };
if (opts.bfcache) { launch.ignoreDefaultArgs = ['--disable-back-forward-cache']; args.push('--enable-features=BackForwardCache'); }
const browser = await chromium.launch(launch);
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// the browser's processes: every chrome process whose command line carries this run's marker
const marker = `genesis-reload-${tag}-${process.pid}`;
function procs() {
  const out = execSync('ps -eo pid,ppid,rss,args --no-headers', { encoding: 'utf8', maxBuffer: 64 << 20 });
  const all = out.split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] } : null; }).filter(Boolean);
  const root = all.find((p) => p.args.includes(marker) && !/--type=/.test(p.args));
  if (!root) return { gpu: 0, renderer: 0, n: 0 };
  // descendants of the browser process
  const kids = new Set([root.pid]);
  for (let pass = 0; pass < 6; pass++) for (const p of all) if (kids.has(p.ppid)) kids.add(p.pid);
  let gpu = 0, renderer = 0, n = 0;
  for (const p of all) {
    if (!kids.has(p.pid)) continue;
    if (/--type=gpu-process/.test(p.args)) gpu += p.rss;
    else if (/--type=renderer/.test(p.args)) { renderer += p.rss; n++; }
  }
  return { gpu: Math.round(gpu / 1024), renderer: Math.round(renderer / 1024), n };
}
const base = `http://127.0.0.1:${server.address().port}/?scenario=babel&seed=307987276&quality=${opts.quality ?? 'medium'}&intro=0&speed=0&ui=0${opts.extra ? '&' + opts.extra : ''}`;
const loads = Number(opts.loads ?? 4);
const rows = [];
for (let i = 1; i <= loads; i++) {
  const t0 = Date.now();
  await page.goto(`${base}&n=${i}`);
  await page.waitForFunction(() => !!window.__GENESIS__);
  await page.evaluate(() => window.__GENESIS__.ready);
  await page.evaluate((c) => window.__GENESIS__.camera(c), { mode: 'orbit', target: { kind: 'settlement', id: 1 }, dist: 300, tilt: 50, hour: 10, blend: 0 });
  await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.frames ?? 20));
  const m = procs();
  const st = await page.evaluate(() => ({ rel: globalThis.__GENESIS_RELEASE__ ?? null, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), nav: performance.getEntriesByType('navigation')[0]?.type }));
  rows.push({ load: i, ...m, heap: st.heap });
  console.log(`load ${i}: GPU process ${m.gpu} MB | renderer ${m.renderer} MB (${m.n} proc) | js heap ${st.heap} MB | release installed ${st.rel?.installed ?? 'n/a'} | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
// --inpage=1: the page is KEPT (as the back/forward cache keeps it) but told it is hidden: a synthetic pagehide with
// persisted; memory before / after shows what the release gives back while the document still lives; then a synthetic
// pageshow with persisted must reload the page (it has no context any more)
if (opts.inpage) {
  const before = procs();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); });
  await page.waitForTimeout(4000);
  const after = procs();
  const st = await page.evaluate(() => ({ rel: globalThis.__GENESIS_RELEASE__ ?? null, lost: globalThis.__GENESIS_R__.three.getContext().isContextLost() }));
  console.log(`INPAGE ${tag}: before pagehide GPU ${before.gpu} MB renderer ${before.renderer} MB | after GPU ${after.gpu} MB renderer ${after.renderer} MB | freed GPU ${before.gpu - after.gpu} MB renderer ${before.renderer - after.renderer} MB | state ${JSON.stringify(st)}`);
  const nav = page.waitForNavigation({ timeout: 20000 }).then(() => 'reloaded').catch(() => 'no reload');
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); }).catch(() => {});
  console.log(`INPAGE ${tag}: pageshow(persisted) -> ${await nav}`);
}
// one more sample after an idle pause (lazy collection of the last dead document)
await page.waitForTimeout(Number(opts.idle ?? 5000));
const m = procs();
console.log(`after idle: GPU process ${m.gpu} MB | renderer ${m.renderer} MB`);
console.log(`SUMMARY ${tag}: GPU MB by load ${rows.map((r) => r.gpu).join(' -> ')} | renderer MB ${rows.map((r) => r.renderer).join(' -> ')} | growth load1->last: GPU ${rows.at(-1).gpu - rows[0].gpu} MB, renderer ${rows.at(-1).renderer - rows[0].renderer} MB`);
console.log('errors', errors.length, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
