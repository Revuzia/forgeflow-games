// Title-card capture of a PRODUCTION build (dist/) served with the strict CSP, real Chromium (SwiftShader). One browser, one port (5610-5619).
// usage: node cap.mjs <distDir> <outDir> <port> [dpr=1] [name=title] [hide=css,selectors] [waitMs=3500] [moveTo=x,y] [dom=1]
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { launch } from 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/_harness/pw.mjs';

const DIST = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
const PORT = Number(process.argv[4] ?? 5610);
const DPR = Number(process.argv[5] ?? 1);
const NAME = process.argv[6] ?? 'title';
const VARIANTS = JSON.parse(process.argv[11] ?? '[]');
const HIDE = (process.argv[7] ?? '').split(',').filter(Boolean);
const WAIT = Number(process.argv[8] ?? 3500);
const MOVE = process.argv[9] && process.argv[9] !== '-' ? process.argv[9].split(',').map(Number) : null;
const DOM = process.argv[10] === '1';
if (PORT < 5610 || PORT > 5619) throw new Error('port must be 5610-5619');
mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const p = join(DIST, u === '/' ? 'index.html' : u);
  if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(PORT, ok));
const browser = await launch({});
let code = 0;
try {
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dpr ?? 1 });
    const page = await ctx.newPage();
    const bad = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bad.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message.slice(0, 200)));
    await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', (e) => { (window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI); }); });
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => /wake it up/i.test(x.textContent || '')); return !!b && !b.disabled; }, null, { timeout: 150000 });
    await page.waitForTimeout(v.wait ?? 3000);
    // layer S: the scene only (3D canvas + mat), no HTML at all
    await page.evaluate(() => { const u = document.getElementById('ui'); if (u) u.style.setProperty('visibility', 'hidden', 'important'); const bt = document.getElementById('boot'); if (bt) bt.style.setProperty('display', 'none', 'important'); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${v.name}_S.png`) });
    // layer L: the lockup only, transparent page, canvas hidden
    await page.evaluate(() => {
      const u = document.getElementById('ui'); if (u) u.style.setProperty('visibility', 'visible', 'important');
      for (const s of ['.title-promise', '.title-actions', '.hud', '.dock', '.plate', '.toasts', '.sparks', '.title::before', '.title::after']) for (const e of document.querySelectorAll(s)) e.style.setProperty('display', 'none', 'important');
      const c = document.getElementById('stage'); if (c) c.style.setProperty('visibility', 'hidden', 'important');
      for (const e of [document.documentElement, document.body, ...document.querySelectorAll('#ui, .title')]) { e.style.setProperty('background', 'transparent', 'important'); e.style.setProperty('background-image', 'none', 'important'); }
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${v.name}_L.png`), omitBackground: true });
    const csp = await page.evaluate(() => window.__csp ?? []);
    console.log(JSON.stringify({ v: v.name, csp, problems: bad }));
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
process.exit(code);
