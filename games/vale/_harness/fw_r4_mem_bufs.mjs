// VALE harness — round 4 MEM-1 refix: who keeps the GL buffers (and geometries) a match leaves behind at Home. A dev
// client (?dev=1, its own vite dev server on 5198, HMR off) walks Home → <modes...> → Home with the real UI (autopilot
// drafts, autoflow accepts), _harness/fw_r4_mem_track.js riding the page. Before the first match, three's
// Object3D.prototype.onBeforeRender and EventDispatcher.addEventListener('dispose') are hooked so every geometry three
// uploads is remembered (weakly) with the object path that first drew it. At Home after each match (after a forced
// GC): three's info.memory, the tracker's live buffer count, and every remembered geometry three still holds (never
// disposed), grouped by the drawing object's path.
//   node _harness/fw_r4_mem_bufs.mjs [--modes rift,bridge] [--sec 30]
// Report _harness/_reports/fw_r4_mem_bufs.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODES = arg('modes', 'rift,bridge').split(','), SEC = Number(arg('sec', 30)), PORT = 5198;
const vite = await import('vite');
process.env.VALE_FROZEN = '1';
const server = await vite.createServer({ configFile: join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true, host: 'localhost', hmr: false } });
await server.listen();
const release = await holdHeavy('fw_r4_mem_bufs');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const rep = { modes: MODES, sec: SEC, reads: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.routeWebSocket(/.*/, () => {});
  await context.addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') });
  const page = await context.newPage();
  const logs = []; page.on('pageerror', (e) => logs.push(e.message.slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/?dev=1&autoflow=1&autopilot=draft&calibrate=0`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__vale, null, { timeout: 240000 });
  await page.locator('.nav__item', { hasText: 'Play' }).first().waitFor({ state: 'visible', timeout: 240000 });
  await page.keyboard.press('Shift');
  await page.waitForTimeout(6000);
  // the hooks: the app's own three module (the dep the client loaded), so its prototypes are the ones patched
  const hooked = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\.vite\/deps\/three\.js/.test(n));
    if (!url) return 'no three dep url';
    const T = await import(url);
    const seen = new Set(); const info = new WeakMap(); let tag = 'home_0';
    const path = (o) => { const l = []; for (let x = o; x && l.length < 6; x = x.parent) l.push(x.name || x.type); return l.join('<'); };
    const ED = T.EventDispatcher.prototype, add = ED.addEventListener;
    ED.addEventListener = function (type, fn) {
      if (type === 'dispose' && this.isBufferGeometry && !info.has(this)) { info.set(this, { tag, by: '?', disposed: false }); seen.add(new WeakRef(this)); }
      return add.call(this, type, fn);
    };
    const disp = T.BufferGeometry.prototype.dispose;
    T.BufferGeometry.prototype.dispose = function () { const r = info.get(this); if (r) r.disposed = true; return disp.call(this); };
    const obr = T.Object3D.prototype.onBeforeRender;
    T.Object3D.prototype.onBeforeRender = function (r, s, c, g) { const x = g && info.get(g); if (x && x.by === '?') x.by = path(this); return obr.call(this, r, s, c, g); };
    // three never calls onBeforeRender for a skinned/instanced mesh that overrides it; the scene walk below fills those
    window.__bufHook = {
      setTag: (t) => { tag = t; },
      read: () => {
        const R = window.__vale.state.renderer;
        const fill = (root) => root?.traverse?.((o) => { const x = o.geometry && info.get(o.geometry); if (x && x.by === '?') x.by = path(o); });
        fill(R.scene); fill(R.menu?.scene);
        const groups = {}; let live = 0, held = 0;
        for (const w of seen) {
          const g = w.deref(); if (!g) continue; live++;
          const x = info.get(g); if (x.disposed) continue; held++;
          const k = `${x.tag} ${x.by.replace(/[0-9a-f]{8,}/g, '#').slice(0, 140)}`;
          const a = groups[k] ?? (groups[k] = { n: 0, kb: 0 });
          a.n++; for (const at of Object.values(g.attributes)) a.kb += (at.array?.byteLength ?? at.data?.array?.byteLength ?? 0) / 1024; if (g.index) a.kb += g.index.array.byteLength / 1024;
        }
        const top = Object.entries(groups).sort((p, q) => q[1].n - p[1].n).slice(0, 40).map(([k, v]) => ({ k, n: v.n, kb: Math.round(v.kb) }));
        return { info: { ...R.gl.info.memory }, live, held, top };
      },
    };
    return 'ok';
  });
  console.log(`hooks: ${hooked}`);
  const read = async (tag) => {
    for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await page.waitForTimeout(500); }
    const r = await page.evaluate(() => ({ ...window.__bufHook.read(), track: window.__memTrack() }));
    const t = r.track;
    rep.reads.push({ tag, info: r.info, live: r.live, held: r.held, top: r.top, gl: t.gl ?? null });
    console.log(`${tag}: three geometries ${r.info.geometries} textures ${r.info.textures}; remembered live ${r.live}, never disposed ${r.held}; tracker ${JSON.stringify(t.gl ?? {}).slice(0, 300)}`);
    for (const g of r.top.slice(0, 25)) console.log(`   ${String(g.n).padStart(4)} ${String(g.kb).padStart(6)} KB  ${g.k}`);
  };
  await read('home_0');
  for (const [i, mode] of MODES.entries()) {
    const tag = `${mode}${i}`;
    await page.evaluate((t) => window.__bufHook.setTag(t), tag);
    await page.locator('.nav__item', { hasText: 'Play' }).first().click();
    await page.locator('.station', { hasText: mode.toUpperCase() }).first().click();
    if (mode === 'rift') await page.locator('.qcard', { hasText: 'Lantern Drill' }).first().click();
    await page.getByRole('button', { name: 'Find match' }).click();
    await page.locator('.hud .dbar').first().waitFor({ state: 'visible', timeout: 300000 });
    await page.waitForTimeout(SEC * 1000);
    const leave = page.getByRole('button', { name: /Leave match/i }).first();
    for (let k = 0; k < 8 && !(await leave.isVisible().catch(() => false)); k++) { await page.keyboard.press('Escape'); await leave.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {}); }
    await leave.click();
    await page.getByRole('dialog').getByRole('button', { name: /Leave match/i }).click();
    const nav = page.locator('.nav__item', { hasText: 'Play' }).first();
    for (let k = 0; k < 90 && !(await nav.isVisible().catch(() => false)); k++) { const ret = page.getByRole('button', { name: /Return home/i }).first(); if (await ret.isVisible().catch(() => false)) await ret.click().catch(() => {}); await page.waitForTimeout(700); }
    await page.locator('.nav__item', { hasText: 'Home' }).first().click().catch(() => {});
    await page.evaluate(() => window.__bufHook.setTag('home'));
    await page.waitForTimeout(5000);
    await read(`${tag}_home`);
  }
  rep.logs = logs.slice(0, 10);
} finally {
  await browser.close().catch(() => {});
  release();
  await server.close();
}
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'fw_r4_mem_bufs.json'), JSON.stringify(rep, null, 1));
console.log('→ _harness/_reports/fw_r4_mem_bufs.json');
