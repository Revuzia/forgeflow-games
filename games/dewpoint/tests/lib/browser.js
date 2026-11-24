// Run a page of the game in a real, headless Chromium-based browser and get a JSON result back - the
// "player's-eye" tests (tests/play.test.js) use it to drive the real renderer with real input events.
// Dependency-free: a tiny static server on 127.0.0.1 serves the project, the page POSTs its result to
// /__result, and the browser is killed. Every run gets a fresh, throw-away profile (so nothing is read
// from or written to anyone's real save). Console output of the page is captured from the browser's own
// log (it includes WebGL warnings raised by the GPU process, which page code cannot see).
// No Chrome, Chromium or Edge installed: resolves { skipped } and the caller prints SKIP.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
// (in a worker thread process.env is a plain copy: its names are case-sensitive, Windows' are not)
const envVar = (n) => { const k = Object.keys(process.env).find((x) => x.toLowerCase() === n.toLowerCase()); return k ? process.env[k] : undefined; };

export function findBrowser() {
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

function serve(onResult) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/__result') {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => { res.end('ok'); onResult(body); });
        return;
      }
      const rel = decodeURIComponent(url.pathname);
      const file = path.join(root, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/**
 * Open `page` (a path under the project, with its query) and wait for it to POST a JSON result.
 * Resolves { skipped } | { result, console: [lines the page logged], browser } | { fatal }.
 */
export async function runPage(page, { timeout = 150000, width = 1280, height = 900 } = {}) {
  const list = findBrowser();
  if (!list.length) return { skipped: 'no Chrome, Chromium or Edge found (set DEWPOINT_BROWSER)' };
  const release = await browserSlot();
  try { return await runPageNow(page, list, { timeout, width, height }); } finally { release(); }
}

/**
 * The test runner's workers are separate processes, and a headless browser rendering WebGL is heavy: with one
 * per worker they starve each other (and the rest of the suite) until runs time out. A few slots, shared through
 * lock files in the temp folder, keep at most MAX_BROWSERS running at once. A slot left by a crashed run expires.
 */
const MAX_BROWSERS = Math.max(1, Math.min(4, Math.floor((os.availableParallelism ? os.availableParallelism() : os.cpus().length) / 3)));
async function browserSlot() {
  const dir = path.join(os.tmpdir(), 'dewpoint-browser-slots');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* exists */ }
  for (;;) {
    for (let i = 0; i < MAX_BROWSERS; i++) {
      const f = path.join(dir, `slot${i}`);
      try {
        const st = fs.statSync(f);
        if (Date.now() - st.mtimeMs > 300000) fs.rmSync(f, { force: true });     // a run that died holding it
      } catch (e) { /* free */ }
      try {
        fs.writeFileSync(f, String(process.pid), { flag: 'wx' });
        return () => { try { fs.rmSync(f, { force: true }); } catch (e) { /* gone */ } };
      } catch (e) { /* taken */ }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function runPageNow(page, list, { timeout, width, height }) {
  let got = null, wake = () => {};
  const srv = await serve((body) => { got = body; wake(); });
  const url = `http://127.0.0.1:${srv.address().port}/${page}`;
  try {
    for (const exe of list) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dewpoint-play-'));
      got = null;
      const log = [];
      const p = spawn(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        `--window-size=${width},${height}`, `--user-data-dir=${profile}`, '--enable-logging=stderr', '--v=0', url], { stdio: ['ignore', 'ignore', 'pipe'] });
      let buf = '';
      p.stderr.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (/:CONSOLE[:(]/.test(line)) log.push(line.replace(/^\[[^\]]*\]\s*/, '')); }
      });
      const done = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), timeout);
        wake = () => { clearTimeout(t); resolve(true); };
        p.on('close', () => { clearTimeout(t); resolve(!!got); });
        p.on('error', () => { clearTimeout(t); resolve(false); });
      });
      try { p.kill(); } catch (e) { /* gone */ }
      await new Promise((r) => setTimeout(r, 150));
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* a browser may still hold it */ }
      if (done && got) {
        let result;
        try { result = JSON.parse(got); } catch (e) { return { fatal: `bad JSON from the page: ${got.slice(0, 200)}` }; }
        return { result, console: log, browser: exe };
      }
      if (log.length) break;          // this browser ran the page (it logged) and the page failed or timed out: another browser would not help
    }
    return { fatal: `the page ${page} posted no result within ${timeout / 1000} s in ${list.join(', ')}` };
  } finally {
    srv.close();
  }
}
