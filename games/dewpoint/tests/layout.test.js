// Layout audit: the real screens (title, level select, settings, pause, complete, the HUD on keyboard and
// touch) are built from the real code and stylesheet in a headless Chromium-based browser, in a window of
// every size we support (and below it: 260 wide), and measured: nothing off screen, no button label on two
// lines, no truncated name, no overlap, and the title's tagline clear of the wordmark's ink.
//   tests/layout/audit.js    the rules          tests/layout/frame.html + audit.html   the page that runs them
// Needs Chrome, Chromium or Edge (set DEWPOINT_BROWSER to its path to choose one). With none installed
// the browser tests print SKIP and pass: this machine's result must be read from the SKIP lines.

import { test, assert, eq } from './lib/harness.js';
import { uiScale, UI_FLOOR } from '../src/ui/scale.js';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [[260, 560], [280, 600], [320, 568], [360, 640], [375, 812], [414, 896], [640, 360], [844, 390], [1280, 800], [1920, 1080]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// (in a worker thread process.env is a plain copy: its names are case-sensitive, Windows' are not)
const envVar = (n) => { const k = Object.keys(process.env).find((x) => x.toLowerCase() === n.toLowerCase()); return k ? process.env[k] : undefined; };

function findBrowser() {
  const env = envVar('DEWPOINT_BROWSER');
  if (env && fs.existsSync(env)) return [env];
  const c = [];
  if (process.platform === 'win32') {
    for (const base of [envVar('ProgramFiles'), envVar('ProgramFiles(x86)'), envVar('LOCALAPPDATA')]) {
      if (!base) continue;
      c.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Chromium/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [n], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) c.push(r.stdout.trim());
    }
  }
  return c.filter((p) => fs.existsSync(p));
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** Run tests/layout/audit.html in headless Chromium; resolves { skipped } or { fatal, results }. */
async function runAudit(query) {
  const list = findBrowser();
  if (!list.length) return { skipped: 'no Chrome, Chromium or Edge found (set DEWPOINT_BROWSER)' };
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/tests/layout/audit.html${query || ''}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dewpoint-layout-'));
  try {
    for (const exe of list) {
      const out = await new Promise((resolve) => {
        const p = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--virtual-time-budget=90000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'] });
        let buf = '';
        p.stdout.on('data', (d) => { buf += d; });
        const t = setTimeout(() => p.kill(), 120000);
        p.on('close', () => { clearTimeout(t); resolve(buf); });
        p.on('error', () => { clearTimeout(t); resolve(''); });
      });
      const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
      if (!m || m[1] === 'running') continue;
      const json = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return JSON.parse(json);
    }
    return { fatal: `the audit page produced no result in ${list.join(', ')}`, results: [] };
  } finally {
    srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* a browser may still hold it */ }
  }
}

const bySize = new Map();
/** One browser run for one window size (cached: a test may be asked twice). */
const auditSize = (w, h) => { const k = `${w}x${h}`; if (!bySize.has(k)) bySize.set(k, runAudit(`?sizes=${k}`)); return bySize.get(k); };
const where = (r) => `${r.w}x${r.h} ${r.screen}${r.state ? `/${r.state}` : ''}${r.touch ? '/touch' : ''}${r.element ? ` (${r.element})` : ''}`;

test('the UI scale is one token - 1 at 360x360 and up, width / 360 below, never under the floor', () => {
  eq(uiScale(360, 640), 1); eq(uiScale(1920, 1080), 1); eq(uiScale(640, 360), 1); eq(uiScale(844, 390), 1);
  eq(uiScale(320, 568), 320 / 360); eq(uiScale(280, 600), 280 / 360); eq(uiScale(268, 604), 268 / 360);
  eq(uiScale(600, 240), 240 / 360, 'a short window scales by its height');
  eq(uiScale(100, 100), UI_FLOOR); eq(uiScale(0, 0), 1); eq(uiScale(NaN, 5), 1);
});

for (const [w, h] of SIZES) {
  test(`layout audit ${w}x${h}: every screen builds; nothing off screen, wrapped, truncated or overlapping; controls big enough`, async () => {
    const a = await auditSize(w, h);
    if (a.skipped) { console.log(`  SKIP  layout audit ${w}x${h}: ${a.skipped}`); return; }
    eq(a.fatal, '', 'audit page error');
    const rs = a.results.filter((r) => r.w === w && r.h === h);
    assert(rs.length >= 15, `${w}x${h}: only ${rs.length} screens were audited`);
    for (const s of ['title', 'levels', 'settings', 'pause', 'complete', 'hud']) assert(rs.some((r) => r.screen === s), `${w}x${h}: no ${s} screen was audited`);
    for (const r of rs) eq(r.scale, uiScale(w, h), `${where(r)}: the UI scale the page applied`);
    const bad = rs.filter((r) => r.violations.length);
    assert(!bad.length, () => `${bad.length} screens broke the layout:` + bad.slice(0, 6).map((r) => `
${where(r)}: ${r.violations.slice(0, 3).join(' | ')}`).join(''));
  });
}

test('the title tagline never touches the wordmark - at any size, in every element skin', async () => {
  const a = await runAudit(`?screens=title&sizes=${SIZES.map(([w, h]) => `${w}x${h}`).join(',')}`);
  if (a.skipped) return;
  eq(a.fatal, '', 'audit page error');
  assert(a.results.length >= SIZES.length * 2, `only ${a.results.length} title screens were audited`);
  const bad = a.results.filter((r) => r.violations.some((v) => /tagline|wordmark/.test(v)));
  assert(!bad.length, () => bad.map((r) => `${where(r)}: ${r.violations.filter((v) => /tagline|wordmark/.test(v)).join(' | ')}`).join('\n'));
});

test('layout audit self-test: with the wordmark/tagline gap removed, narrow windows and a button label squeezed, the audit fails', async () => {
  // a rule that cannot fail proves nothing: break three things on purpose and demand each is caught
  const css = '.logo{gap:0!important}.logo-word{padding-bottom:0!important;margin-bottom:-14px!important}.title-actions .btn:nth-child(3){max-width:70px!important;overflow:visible!important}.hud-banner-name{max-width:90px!important}';
  const a = await runAudit(`?sizes=375x812,360x640&css=${encodeURIComponent(css)}`);
  if (a.skipped) return;
  eq(a.fatal, '');
  const all = a.results.flatMap((r) => r.violations);
  assert(all.some((v) => /^overlap: the tagline/.test(v)), `the tagline pushed onto the wordmark was not caught: ${all.slice(0, 5).join(' | ')}`);
  assert(all.some((v) => /^wrapped: /.test(v)), 'a squeezed label was not caught as wrapped');
});
