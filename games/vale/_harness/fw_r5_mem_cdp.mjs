// VALE harness — round 5 MEM-3: a page driver with NO DevTools Network domain.
//
// Playwright sends Network.enable on every page it drives (playwright-core coreBundle, no buffer sizes, so Chrome's
// defaults), and Chrome's network agent then keeps a copy of every response body inside the renderer (Blink's buffer
// partition) so a later Network.getResponseBody can answer. Round 4 read it at 45.7 MB after one 45 s RIFT
// (_harness/_reports/fw_r4_mem_netbuf.json) and the renderer's buffer partition at 113.5 MB at Home after one RIFT
// against 22.5 at first Home (fw_r4_mem_r1_infra.json); it fills further with every match a session loads, which is
// exactly what ruling 27's three-match gate reads. No player's browser has it.
//
// This opens the same Chrome (channel chrome, the switches Playwright passes, headless, GPU on Metal) on a debugging
// port and drives the page over raw CDP with only Page, Runtime, Input, Emulation, HeapProfiler: the page-side surface
// probe_match_memory.mjs uses (locator / getByRole / mouse / keyboard / evaluate / screenshot / addInitScript / CDP
// sessions), so the probe runs unchanged with --raw-cdp. Locators follow Playwright's rules closely enough for the
// journey: CSS + case-insensitive hasText, role + accessible name (aria-label or text), visible = a non-empty box and
// not visibility:hidden, a click scrolls into view, waits until the element is the hit target at its centre, then
// presses and releases the mouse there.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SWITCHES = [
  '--disable-field-trial-config', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-back-forward-cache', '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-component-extensions-with-background-pages',
  '--disable-component-update', '--no-default-browser-check', '--disable-default-apps', '--disable-dev-shm-usage', '--disable-extensions',
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,OptimizationHints,NetworkTimeServiceQuerying',
  '--allow-pre-commit-input', '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking', '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding', '--force-color-profile=srgb', '--metrics-recording-only', '--no-first-run', '--password-store=basic', '--use-mock-keychain',
  '--no-service-autorun', '--disable-search-engine-choice-screen', '--disable-infobars', '--disable-sync', '--enable-automation', '--no-sandbox',
];
const HEADLESS = ['--headless', '--hide-scrollbars', '--mute-audio', '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'];

class Conn {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.subs = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (m.id !== undefined) { const w = this.wait.get(m.id); if (w) { this.wait.delete(m.id); if (m.error) w.rej(new Error(`${w.method}: ${m.error.message}`)); else w.res(m.result); } return; }
      for (const f of [...(this.subs.get(`${m.sessionId ?? ''}|${m.method}`) ?? [])]) f(m.params);
    });
    ws.addEventListener('close', () => { for (const w of this.wait.values()) w.rej(new Error('CDP closed')); this.wait.clear(); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.wait.set(id, { res, rej, method }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  on(sessionId, method, f) { const k = `${sessionId ?? ''}|${method}`; const s = this.subs.get(k) ?? new Set(); s.add(f); this.subs.set(k, s); }
  off(sessionId, method, f) { this.subs.get(`${sessionId ?? ''}|${method}`)?.delete(f); }
}

/** a CDP session with the Playwright CDPSession surface the probe uses (send / on / once / off) */
const session = (c, sid) => ({
  send: (m, p) => c.send(m, p, sid),
  on: (m, f) => c.on(sid, m, f),
  off: (m, f) => c.off(sid, m, f),
  once: (m, f) => { const g = (p) => { c.off(sid, m, g); f(p); }; c.on(sid, m, g); },
});

const KEYS = {
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 }, Escape: { key: 'Escape', code: 'Escape', vk: 27 }, Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
};
const keyDef = (k) => KEYS[k] ?? (/^Key[A-Z]$/.test(k) ? { key: k.slice(3).toLowerCase(), code: k, vk: k.charCodeAt(3), text: k.slice(3).toLowerCase() } : /^Digit\d$/.test(k) ? { key: k.slice(5), code: k, vk: k.charCodeAt(5), text: k.slice(5) } : { key: k, code: k, vk: 0 });

// the in-page half of a locator: every step narrows the set (css + hasText, or role + name), `first` takes one
const FIND = `(steps) => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const ROLE = { button: 'button, [role=button], input[type=button], input[type=submit]', dialog: '[role=dialog], [role=alertdialog], dialog' };
  const name = (e) => norm(e.getAttribute('aria-label') || e.textContent || e.value || '');
  let set = [document];
  for (const s of steps) {
    const out = [];
    for (const root of set) {
      const els = root.querySelectorAll(s.css ?? ROLE[s.role] ?? s.role);
      for (const e of els) {
        if (s.hasText && !norm(e.textContent).toLowerCase().includes(s.hasText.toLowerCase())) continue;
        if (s.name && !new RegExp(s.name.src, s.name.flags).test(name(e))) continue;
        // a role query skips what the accessibility tree hides, as Playwright's getByRole does by default
        if (s.role && (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.closest('[aria-hidden="true"], [inert]'))) continue;
        if (!out.includes(e)) out.push(e);
      }
    }
    set = s.first ? out.slice(0, 1) : out;
  }
  return set;
}`;

class Locator {
  constructor(page, steps) { this.page = page; this.steps = steps; }
  locator(css, o = {}) { return new Locator(this.page, [...this.steps, { css, hasText: o.hasText }]); }
  getByRole(role, o = {}) { return new Locator(this.page, [...this.steps, { role, name: o.name ? { src: o.name.source ?? String(o.name), flags: o.name.flags ?? '' } : undefined }]); }
  first() { const s = this.steps.slice(); s[s.length - 1] = { ...s[s.length - 1], first: true }; return new Locator(this.page, s); }
  /** the first match's box and whether it shows (Playwright's visible: a non-empty box, not visibility:hidden) */
  async probe(scroll = false) {
    return this.page.evalFn(`(steps, scroll) => {
      const e = (${FIND})(steps)[0];
      if (!e) return null;
      if (scroll && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const enabled = !e.disabled && e.getAttribute('aria-disabled') !== 'true';
      return { x, y, width: r.width, height: r.height, left: r.x, top: r.y, visible, hit: !!hit && (hit === e || e.contains(hit)), enabled };
    }`, this.steps, scroll);
  }
  async isVisible() { try { return !!(await this.probe())?.visible; } catch { return false; } }
  async boundingBox() { const b = await this.probe(); return b?.visible ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; }
  async waitFor(o = {}) {
    const until = Date.now() + (o.timeout ?? 30000);
    for (;;) {
      const v = await this.isVisible();
      if ((o.state ?? 'visible') === 'visible' ? v : !v) return;
      if (Date.now() > until) throw new Error(`waitFor ${JSON.stringify(this.steps)} timed out`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  async click(o = {}) {
    const until = Date.now() + (o.timeout ?? 30000);
    for (;;) {
      const b = await this.probe(true).catch(() => null);
      // stable, as Playwright's actionability check asks: a modal still sliding in moves its buttons between the read and
      // the press (a menu's Leave match read mid-entrance put the press on Settings), so the box must hold for 150 ms
      if (b?.visible && b.hit && b.enabled) {
        await new Promise((r) => setTimeout(r, 150));
        const c = await this.probe(false).catch(() => null);
        if (c?.visible && c.hit && c.enabled && Math.abs(c.x - b.x) < 0.5 && Math.abs(c.y - b.y) < 0.5 && Math.abs(c.width - b.width) < 0.5) { await this.page.mouse.click(c.x, c.y, { button: o.button ?? 'left' }); return; }
      }
      if (Date.now() > until) throw new Error(`click ${JSON.stringify(this.steps)}: ${b ? JSON.stringify(b) : 'no element'}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** opens Chrome and one page at `url`; returns { browser, page, logs } shaped like the probe's Playwright objects */
export async function openRaw(url, { chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args = [], headless = process.env.VALE_HEADED !== '1', viewport = { width: 1920, height: 1080 } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vale-r5-cdp-'));
  const proc = spawn(chrome, [...SWITCHES, ...(headless ? HEADLESS : []), ...args, `--user-data-dir=${dir}`, '--remote-debugging-port=0', `--window-size=${viewport.width},${viewport.height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('chrome: no DevTools endpoint in 60 s')), 60000);
    proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
    proc.once('exit', (c) => { clearTimeout(t); rej(new Error(`chrome exited ${c}`)); });
  });
  proc.stderr.resume();
  // the browser never outlives the harness: a killed or crashed probe takes its Chrome with it
  const killChrome = () => { try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch { /* gone */ } };
  process.once('exit', killChrome);
  for (const sig of ['SIGTERM', 'SIGHUP']) process.once(sig, () => { killChrome(); process.exit(143); });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const c = new Conn(ws);
  const { targetInfos } = await c.send('Target.getTargets');
  const blank = targetInfos.find((t) => t.type === 'page');
  const targetId = blank ? blank.targetId : (await c.send('Target.createTarget', { url: 'about:blank' })).targetId;
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = session(c, sessionId);
  const logs = [];
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  s.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error' || e.type === 'warning') logs.push(`[${e.type}] ${(e.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`); });
  s.on('Runtime.exceptionThrown', (e) => logs.push(`[pageerror] ${(e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text ?? '').slice(0, 300)}`));
  await s.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false, screenWidth: viewport.width, screenHeight: viewport.height });
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  let mx = 0, my = 0;
  const mouseEv = (type, x, y, button = 'none', clickCount = 0) => s.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0 });
  const loaded = () => new Promise((res) => { const f = () => res(); s.once('Page.loadEventFired', f); setTimeout(res, 120000); });
  const page = {
    session: s,
    locator: (css, o = {}) => new Locator(page, [{ css, hasText: o.hasText }]),
    getByRole: (role, o = {}) => new Locator(page, []).getByRole(role, o),
    async evalFn(fnSrc, ...a) {
      const r = await s.send('Runtime.evaluate', { expression: `(${fnSrc})(...${JSON.stringify(a)})`, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    evaluate(fn, arg) { return page.evalFn(fn.toString(), ...(arg === undefined ? [] : [arg])); },
    waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
    mouse: {
      async move(x, y) { mx = x; my = y; await mouseEv('mouseMoved', x, y); },
      async click(x, y, o = {}) { const b = o.button ?? 'left'; mx = x; my = y; await mouseEv('mouseMoved', x, y); await mouseEv('mousePressed', x, y, b, 1); await mouseEv('mouseReleased', x, y, b, 1); },
    },
    keyboard: {
      async press(k) {
        const d = keyDef(k);
        await s.send('Input.dispatchKeyEvent', { type: d.text ? 'keyDown' : 'rawKeyDown', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk, ...(d.text ? { text: d.text, unmodifiedText: d.text } : {}) });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk });
      },
    },
    async screenshot(o = {}) { const r = await s.send('Page.captureScreenshot', { format: 'png' }); if (o.path) writeFileSync(o.path, Buffer.from(r.data, 'base64')); },
    async reload() { const l = loaded(); await s.send('Page.reload', {}); await l; },
    async goto(u) { const l = loaded(); await s.send('Page.navigate', { url: u }); await l; },
    context: () => ({
      addInitScript: async ({ path }) => { await s.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(path, 'utf8') }); },
      newCDPSession: async () => s,
    }),
  };
  void mx; void my;
  await page.goto(url);
  const browser = {
    newBrowserCDPSession: async () => session(c, undefined),
    async close() {
      try { await c.send('Browser.close'); } catch { /* already gone */ }
      await new Promise((r) => { if (proc.exitCode !== null) r(); else { proc.once('exit', r); setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } r(); }, 8000); } });
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    },
    on: (ev, f) => { if (ev === 'disconnected') proc.once('exit', f); },
    pid: proc.pid,
  };
  return { browser, page, logs };
}
