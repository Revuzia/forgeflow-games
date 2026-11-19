#!/usr/bin/env node
// `?bench=` end to end on SwiftShader (BENCH.md): serves a built dist, opens ONE launch link, lets the page run its
// steps by itself (every step is a page load), waits for the results page, saves the downloaded results text, the
// panel's own text and screenshots of the progress line and of the panel.
//   bash _harness/slot.sh node _harness/arc-work/bench-e2e.mjs --dist=DIR --out=DIR --tag=a \
//     --query='bench=custom&bv=N~|P~scene:0;shadows:0&breps=2&bsettle=2&brec=2&bload=900' [--size=640x360] [--blur=K] [--abort=K]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/arc/bench/out');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(3 * 3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const T0 = Date.now();
const sec = () => ((Date.now() - T0) / 1000).toFixed(0);
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`nav ${sec()} s`, f.url().replace(/^http:\/\/[^/]+/, '')); });
let saved = '';
page.on('download', async (d) => { saved = join(OUT, `${tag}-${d.suggestedFilename()}`); await d.saveAs(saved); console.log('download', d.suggestedFilename()); });
const url = `http://127.0.0.1:${server.address().port}/?${opts.query ?? 'bench=custom&bv=N~|P~scene:0;shadows:0&breps=2&bsettle=2&brec=2&bload=900'}`;
console.log('launch', url);
await page.goto(url);
// the progress line of the first step that gets as far as its recording (or the abort, when asked)
let shotRun = false, blurred = false, aborted = false;
const poll = setInterval(async () => {
  try {
    const t = await page.evaluate(() => document.querySelector('#bench-progress span')?.textContent ?? '');
    if (t) console.log(`progress ${sec()} s`, t);
    if (!shotRun && /RECORDING|settling/.test(t)) { shotRun = true; await page.screenshot({ path: join(OUT, `${tag}-running.png`) }); }
    // --blur=K: the window "loses the focus" during step K (that step must come out INVALID); --abort=K: Abort in step K
    if (opts.blur && !blurred && t.includes(`step ${opts.blur} of`) && /RECORDING|settling/.test(t)) { blurred = true; console.log('blur event in step', opts.blur); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); }
    if (opts.abort && !aborted && t.includes(`step ${opts.abort} of`)) { aborted = true; console.log('pressing Abort in step', opts.abort); await page.click('#bench-abort'); }
  } catch { /* between two pages */ }
}, Number(opts.poll ?? 4000));
await page.waitForSelector('#bench-results #bench-table', { timeout: 3 * 3600000 });
clearInterval(poll);
await new Promise((ok) => setTimeout(ok, 1500));
await page.setViewportSize({ width: 1500, height: 950 });
await page.screenshot({ path: join(OUT, `${tag}-results.png`) });
const text = await page.evaluate(() => document.querySelector('#bench-text')?.value ?? '');
writeFileSync(join(OUT, `${tag}-panel.txt`), text);
// the buttons: a second download by the button, and Copy's note
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await page.click('#bench-download');
const d2 = await dl;
await page.click('#bench-copy');
await new Promise((ok) => setTimeout(ok, 500));
const note = await page.evaluate(() => document.querySelector('#bench-copy')?.parentElement?.querySelector('span')?.textContent ?? '');
const table = await page.evaluate(() => [...document.querySelectorAll('#bench-table tr')].map((r) => [...r.children].map((c) => c.textContent).join(' | ')));
const warn = await page.evaluate(() => [...(document.querySelector('#bench-warnings')?.children ?? [])].map((c) => c.textContent));
console.log('title', await page.title());
console.log('table\n  ' + table.join('\n  '));
console.log('warnings', JSON.stringify(warn));
console.log('auto download file', saved || 'NONE', '| button download', d2 ? d2.suggestedFilename() : 'NONE', '| copy note:', note);
console.log('download == panel text:', saved ? readFileSync(saved, 'utf8') === text : 'n/a', '| text bytes', text.length);
console.log('page errors', errors.length, errors.slice(0, 5).join(' || ').slice(0, 800));
console.log('total s', sec());
await browser.close();
server.close();
