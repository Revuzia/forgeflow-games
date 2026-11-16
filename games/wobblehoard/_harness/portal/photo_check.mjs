// UI v3 B4b (K10, K07): Snap > Save photo in the REAL game inside the portal's exact iframe (sandbox and allow strings) on the LOCAL stand-in host (_harness/portal/bridge_host.html);
// no real portal, R2 or Supabase API is ever called. The portal's sandbox has no `allow-downloads`, so a download is dropped silently (PUBLISH_CHECKLIST_SHORT 6): the game shows the
// Photo card instead (UI.md 6.1).
//   node _harness/portal/photo_check.mjs [--only=dev,phone,downloads,standalone,prod] [--port=5448] [--dist=<a built dist folder>]
//   dev         888x500 box, dev server: Save > the card (the picture decoded, data: URL, the exact words, the live line, the game covered, no download event), the new-tab button (a popup that
//               shows the PNG, or the button hides itself), the right-click path is not prevented, Done and Esc close it and give the focus back
//   phone       358x201 box: the card fits the frame, every button >= 44 px, the picture decodes
//   downloads   the SAME sandbox plus allow-downloads: the card still shows (an embedded page cannot confirm a download), and Chromium reports 0 download events (the card route never tries one)
//   standalone  a top-level page keeps the download (one PNG with the right name) and the toast "Photo saved."; no card
//   prod        the BUILT game (vite build into a scratch folder or --dist), served from a second origin with the strict CSP header, framed by the host: 0 CSP violations, the card works
// Ports 5440-5449 only (the host and the dev server on --port, the CSP origin on --port + 1). One browser at a time; everything started is stopped.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5448'));
const ONLY = opt('only').split(',').filter(Boolean);
const DIST = opt('dist');
const want = (s) => !ONLY.length || ONLY.includes(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, bad = 0, section = '';
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${section}] ${name}${extra !== '' ? '  ' + extra : ''}`); };
const SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms';
const ALLOW = 'autoplay; fullscreen; gamepad; pointer-lock';
const HINT = 'Press and hold the picture (or right-click it) and choose Save image.';
const LINE = 'Photo ready. Press and hold the picture to save it.';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

let browser, vite;

async function openHost({ size = '888x500', sandbox, game = '../../index.html?dev=1&rseed=7', prod = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 980, height: 780 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
  const page = await context.newPage();
  const errs = [];
  const downloads = [];
  const popups = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  context.on('page', (p) => { if (p !== page) popups.push(p); });
  const q = new URLSearchParams({ mode: 'guest', size, game });
  if (sandbox !== undefined) q.set('sandbox', sandbox);
  await page.goto(`${vite.url}_harness/portal/bridge_host.html?${q}`, { waitUntil: 'load' });
  let frame = null;
  for (let i = 0; i < 300 && !frame; i++) { frame = page.frames().find((x) => x !== page.mainFrame() && /index\.html/.test(x.url())) ?? null; if (!frame) await sleep(100); }
  if (!frame) throw new Error('the game frame did not appear');
  if (prod) {
    try { await frame.waitForSelector('.cta:not([disabled])', { timeout: 90000 }); } catch (e) {
      const dump = await frame.evaluate(() => ({ phase: document.body?.dataset?.phase, text: document.body?.innerText?.slice(0, 200), csp: window.__csp })).catch((x) => ({ err: String(x.message).slice(0, 100) }));
      console.log('     .. prod frame never showed .cta:', JSON.stringify(dump), 'errors:', JSON.stringify(errs.slice(0, 5)), 'frames:', page.frames().map((f) => f.url()).join(' | '));
      throw e;
    }
  }
  else await frame.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, frame, errs, downloads, popups };
}
const playNow = async (frame, prod) => {
  await sleep(900);
  await frame.evaluate(() => document.querySelector('.cta')?.click());
  if (prod) await frame.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 30000 });
  else await frame.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await sleep(700);
};
/** pick Snap in the dock and press Save photo (a real click on the real button); the PNG encode can take seconds under the software GL */
async function snapAndSave(frame) {
  await frame.evaluate(() => document.querySelector('.dock-tool[data-tool="snap"]').click());
  await frame.waitForSelector('.snapbar:not([hidden]) [data-key="save"]', { state: 'visible', timeout: 15000 });
  await sleep(500);
  await frame.locator('.snapbar [data-key="save"]').click();
}
const cardState = (frame) => frame.evaluate(() => {
  const c = document.querySelector('.photo-card');
  if (!c) return null;
  const img = c.querySelector('.photo-img');
  const r = c.getBoundingClientRect();
  const tab = c.querySelector('.photo-tab'), done = c.querySelector('.photo-done');
  const box = (e) => { if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  return {
    role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), name: document.getElementById(c.getAttribute('aria-labelledby'))?.textContent,
    desc: document.getElementById(c.getAttribute('aria-describedby'))?.textContent,
    natural: img.naturalWidth, naturalH: img.naturalHeight, src: img.src.slice(0, 22), alt: img.alt, complete: img.complete, shown: img.getBoundingClientRect().width,
    select: getComputedStyle(img).userSelect, pe: getComputedStyle(img).pointerEvents, focusable: img.tabIndex,
    live: document.getElementById('wh-live')?.textContent, covered: window.__WH__ ? window.__WH__.shell.pauseReasons().includes('covered') : null,
    card: { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom) }, iw: innerWidth, ih: innerHeight,
    tab: box(tab), done: box(done), focus: document.activeElement?.className ?? '', hud: document.querySelector('.hud')?.hasAttribute('inert'),
  };
});

async function cardFlow(frame, page, ctxInfo, label, { prod = false } = {}) {
  const t0 = Date.now();
  await snapAndSave(frame);
  await frame.waitForSelector('.photo-card', { state: 'visible', timeout: 240000 });
  await sleep(700);
  const s = await cardState(frame);
  check(`${label}: Save photo shows the Photo card (a dialog named "Your photo", modal) with the picture decoded (naturalWidth ${s.natural} x ${s.naturalH}) as a data:image/png URL`, !!s && s.role === 'dialog' && s.modal === 'true' && s.name === 'Your photo' && s.natural > 0 && s.naturalH > 0 && s.complete && s.src.startsWith('data:image/png'), JSON.stringify({ name: s.name, natural: s.natural, src: s.src, ms: Date.now() - t0 }));
  check(`${label}: the card says "${HINT}" (described by it), the live region says "${LINE}", the picture has a text alternative`, s.desc === HINT && s.live === LINE && /^Photo of your squishy, /.test(s.alt), JSON.stringify({ desc: s.desc, live: s.live, alt: s.alt }));
  check(`${label}: the picture keeps the browser's own save paths (selectable, takes pointer events, focusable for Shift+F10); the HUD behind is inert`, s.select !== 'none' && s.pe !== 'none' && s.focusable === 0 && s.hud === true, JSON.stringify({ select: s.select, pe: s.pe, tab: s.focusable, hud: s.hud }));
  if (!prod) check(`${label}: the game is covered (suspended) while the card is up`, s.covered === true);
  const ctxMenu = await frame.evaluate(() => { const img = document.querySelector('.photo-img'); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); img.dispatchEvent(e); return e.defaultPrevented; });
  check(`${label}: a right-click (contextmenu) on the picture is NOT prevented, so Save image as is the browser's`, ctxMenu === false);
  check(`${label}: no download event fired (the card route never tries the download the sandbox would drop)`, ctxInfo.downloads.length === 0, ctxInfo.downloads.join());
  return s;
}

async function main() {
  vite = await startVite(PORT);
  browser = await launch();
  try {
    // ───────────────────────────────────────────────────────────── 888x500, the portal's exact sandbox
    if (want('dev')) {
      section = 'dev';
      const h = await openHost({ size: '888x500' });
      const attrs = await h.page.evaluate(() => { const f = document.querySelector('iframe'); return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), w: f.clientWidth, h: f.clientHeight }; });
      check('the frame has the portal\'s exact sandbox and allow strings at 888x500 (no allow-downloads, no allow-popups-to-escape-sandbox)', attrs.sandbox === SANDBOX && attrs.allow === ALLOW && attrs.w === 888 && attrs.h === 500 && !/allow-downloads|escape/.test(attrs.sandbox), JSON.stringify(attrs));
      await playNow(h.frame);
      const emb = await h.frame.evaluate(() => ({ embedded: window.self !== window.top, a: 'download' in document.createElement('a') }));
      check('inside the frame the page is embedded (self !== top) and anchors still know `download` (so the route is chosen by the frame, not by a missing feature)', emb.embedded && emb.a);
      const s = await cardFlow(h.frame, h.page, h, '888x500');
      check('888x500: the card sits inside the frame (nothing cut off) and both buttons are >= 44 px high', s.card.x >= 0 && s.card.y >= 0 && s.card.r <= s.iw && s.card.b <= s.ih && (!s.tab || s.tab.h >= 44) && s.done.h >= 44, JSON.stringify({ card: s.card, tab: s.tab, done: s.done }));
      // the new-tab button: a popup that shows the PNG, or the button hides itself
      const pop = h.context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
      await h.frame.click('.photo-tab');
      const p = await pop;
      if (p) {
        await p.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
        await sleep(500);
        const pi = await p.evaluate(() => ({ ct: document.contentType, img: document.querySelector('img') ? { w: document.querySelector('img').naturalWidth, h: document.querySelector('img').naturalHeight } : null, url: location.protocol })).catch((e) => ({ err: String(e.message).slice(0, 80) }));
        check('"Open in a new tab": the popup opens and shows the PNG (an image document with a decoded picture)', !!pi.img && pi.img.w > 0 && /image\/png/.test(pi.ct), JSON.stringify(pi));
        console.log(`     .. popup: ${JSON.stringify(pi)} url=${p.url().slice(0, 40)}`);
        await p.close().catch(() => {});
      } else {
        const gone = await h.frame.evaluate(() => ({ hidden: document.querySelector('.photo-tab').hidden, note: document.querySelector('.photo-note').textContent, noteShown: !document.querySelector('.photo-note').hidden }));
        check('"Open in a new tab": the browser opened nothing, so the button hid itself and the card says how to save instead', gone.hidden && gone.noteShown && /Press and hold the picture/.test(gone.note), JSON.stringify(gone));
      }
      const afterTab = await h.frame.evaluate(() => ({ stillThere: !!document.querySelector('.photo-card'), tabHidden: document.querySelector('.photo-tab').hidden }));
      console.log(`     .. after the new-tab press: card still open ${afterTab.stillThere}, button hidden ${afterTab.tabHidden}`);
      // the 250 ms arm and Done
      await h.frame.focus('.photo-done');
      await h.page.keyboard.press('Enter'); await sleep(700);
      const d1 = await h.frame.evaluate(() => ({ gone: !document.querySelector('.photo-card'), covered: window.__WH__.shell.pauseReasons().includes('covered'), focus: document.activeElement?.getAttribute('data-key') || document.activeElement?.className, hud: document.querySelector('.hud').hasAttribute('inert'), snap: document.body.dataset.tool }));
      check('Done closes the card, the game runs again, the HUD is live and the focus returns to the Save photo button that opened it', d1.gone && !d1.covered && !d1.hud && d1.focus === 'save' && d1.snap === 'snap', JSON.stringify(d1));
      // Esc closes it too (a second photo)
      await h.frame.locator('.snapbar [data-key="save"]').click();
      await h.frame.waitForSelector('.photo-card', { state: 'visible', timeout: 240000 }); await sleep(600);
      await h.frame.locator('.photo-done').focus();
      await h.page.keyboard.press('Escape'); await sleep(600);
      const e1 = await h.frame.evaluate(() => ({ gone: !document.querySelector('.photo-card'), covered: window.__WH__.shell.pauseReasons().includes('covered'), tool: document.body.dataset.tool }));
      check('Esc closes the card (layers 2 and 3 of the Esc order): the Snap tool stays (Esc did not also leave Snap), the game runs again', e1.gone && !e1.covered && e1.tool === 'snap', JSON.stringify(e1));
      check('0 CSP violations, no page error, still 0 download events', (await h.page.evaluate(() => window.__csp || [])).length === 0 && h.errs.length === 0 && h.downloads.length === 0, h.errs.slice(0, 2).join(' | '));
      await h.context.close();
    }

    // ───────────────────────────────────────────────────────────── 358x201, the portal phone
    if (want('phone')) {
      section = 'phone';
      const h = await openHost({ size: '358x201' });
      await playNow(h.frame);
      const s = await cardFlow(h.frame, h.page, h, '358x201');
      check('358x201: the card fits the frame, the picture decodes, Done is >= 44 px high and fully inside', s.card.x >= 0 && s.card.y >= 0 && s.card.r <= s.iw && s.card.b <= s.ih && s.done.h >= 44 && s.done.b <= s.ih && s.done.r <= s.iw && s.natural > 0, JSON.stringify({ card: s.card, done: s.done, tab: s.tab, iw: s.iw, ih: s.ih }));
      check('358x201: "Open in a new tab" (if shown) is >= 44 px high and inside the frame too', !s.tab || (s.tab.h >= 44 && s.tab.b <= s.ih && s.tab.r <= s.iw), JSON.stringify(s.tab));
      await h.page.screenshot({ path: resolve(ROOT, '_shots', 'uikit', 'B4b', 'portal_phone_photo.png') }).catch(() => {});
      await h.context.close();
    }

    // ───────────────────────────────────────────────────────────── the same sandbox plus allow-downloads
    if (want('downloads')) {
      section = 'downloads';
      const h = await openHost({ size: '888x500', sandbox: `${SANDBOX} allow-downloads` });
      await playNow(h.frame);
      await cardFlow(h.frame, h.page, h, 'with allow-downloads');
      console.log('     .. an embedded page cannot read its parent\'s sandbox flags and gets no event for a dropped download, so it cannot confirm one: the card shows in any frame');
      await h.context.close();
    }

    // ───────────────────────────────────────────────────────────── a top-level page keeps the download
    if (want('standalone')) {
      section = 'standalone';
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
      const page = await context.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(`${vite.url}index.html?dev=1&rseed=7`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await playNow(page.mainFrame());
      await page.evaluate(() => document.querySelector('.dock-tool[data-tool="snap"]').click());
      await page.waitForSelector('.snapbar:not([hidden]) [data-key="save"]', { state: 'visible' }); await sleep(500);
      const dl = page.waitForEvent('download', { timeout: 240000 });
      await page.locator('.snapbar [data-key="save"]').click();
      const d = await dl;
      await sleep(1200);
      const st = await page.evaluate(() => ({ card: !!document.querySelector('.photo-card'), toast: [...document.querySelectorAll('.k-toast')].map((t) => t.textContent).join(' | '), live: document.getElementById('wh-live')?.textContent }));
      check('a top-level page keeps the download (one PNG named squish-keeper-<species>-<date>.png) and shows the toast "Photo saved."; no card', /^squish-keeper-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.png$/.test(d.suggestedFilename()) && !st.card && /Photo saved\./.test(st.toast) && /Photo saved\./.test(st.live), JSON.stringify({ name: d.suggestedFilename(), ...st }));
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────────────────── the production build, a second origin, the strict CSP header
    if (want('prod')) {
      section = 'prod';
      let out = DIST ? resolve(DIST) : DIST;
      if (!out) {
        out = resolve(ROOT, '_shots', 'uikit', 'B4b', 'dist_photo');
        const b = spawnSync(process.execPath, [resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, windowsHide: true });
        check('vite build succeeds', b.status === 0, b.error ? String(b.error.message) : (b.stderr || '').split('\n')[0]);
        if (b.status !== 0) return;
      }
      const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      const server = createServer((req, res) => {
        const path = resolve(out, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/\/$/, '/index.html'));
        if (!path.startsWith(out) || !existsSync(path) || statSync(path).isDirectory()) { res.statusCode = 404; res.end('nope'); return; }
        res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream');
        res.setHeader('Content-Security-Policy', CSP);
        res.end(readFileSync(path));
      });
      await new Promise((ok) => server.listen(PORT + 1, ok));
      try {
        const h = await openHost({ size: '888x500', game: `http://localhost:${PORT + 1}/index.html`, prod: true });
        await playNow(h.frame, true);
        await sleep(500);
        // there is no dev hook in a production build: the card is reached the way a player does it
        await h.frame.evaluate(() => document.querySelector('.dock-tool[data-tool="snap"]').click());
        await h.frame.waitForSelector('.snapbar:not([hidden]) [data-key="save"]', { state: 'visible', timeout: 15000 }); await sleep(500);
        await h.frame.locator('.snapbar [data-key="save"]').click();
        await h.frame.waitForSelector('.photo-card', { state: 'visible', timeout: 240000 }); await sleep(700);
        const s = await cardState(h.frame);
        check('production build, strict CSP, framed from another origin: the Photo card shows with the picture decoded (data: URL passes img-src)', !!s && s.natural > 0 && s.src.startsWith('data:image/png') && s.name === 'Your photo' && s.live === LINE, JSON.stringify({ natural: s.natural, src: s.src, live: s.live }));
        const pop = h.context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
        await h.frame.click('.photo-tab').catch(() => {});
        const p = await pop;
        if (p) {
          await p.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
          const pi = await p.evaluate(() => ({ ct: document.contentType, w: document.querySelector('img')?.naturalWidth ?? 0 })).catch(() => ({ ct: '?', w: 0 }));
          check('production build: the new tab shows the PNG (blob navigation is allowed under the CSP)', pi.w > 0 && /image\/png/.test(pi.ct), JSON.stringify(pi));
          await p.close().catch(() => {});
        } else {
          check('production build: the browser opened no tab, so the button hid itself', await h.frame.evaluate(() => document.querySelector('.photo-tab').hidden));
        }
        await h.frame.locator('.photo-done').click(); await sleep(600);
        const csp = await h.frame.evaluate(() => window.__csp || []);
        check('production build: 0 CSP violations in the game frame across the whole photo flow, no page error, no download event', csp.length === 0 && h.errs.length === 0 && h.downloads.length === 0, JSON.stringify(csp.slice(0, 3)) + ' ' + h.errs.slice(0, 2).join(' | '));
        await h.context.close();
      } finally { server.close(); }
    }
  } finally {
    await browser?.close().catch(() => {});
    await vite.stop();
  }
  console.log(`\n${total - bad}/${total} photo-card checks passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
