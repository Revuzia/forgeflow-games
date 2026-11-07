// VALE harness — round 4 MEM-1 refix: does the HARNESS hold the page's downloads? Playwright enables the DevTools Network
// domain on every page it drives (Network.enable, Chrome's default buffers), and Chrome's network agent then keeps a copy
// of each response body inside the renderer (Blink's buffer partition) so Network.getResponseBody can answer later.
// This walks the prod client (the build probe_match_memory made in _harness/_prod/client/dist, served on 5189) Home →
// <mode> → Home in Playwright, and at Home after the match asks Chrome, through Playwright's own session
// (response.body()), for the bodies of every response the page fetched: the bytes it can still hand back are bytes the
// renderer still holds for the inspector, not for the game. Next to it, Chrome's memory-infra size of the renderer's
// buffer partition.
//   node _harness/fw_r4_mem_netbuf.mjs [--mode rift] [--sec 60]
// Report _harness/_reports/fw_r4_mem_netbuf.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODE = arg('mode', 'rift'), SEC = Number(arg('sec', 60)), PORT = 5189;
const vite = await import('vite');
const server = await vite.preview({ configFile: join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'warn', build: { outDir: join(HERE, '_prod', 'client', 'dist') }, preview: { port: PORT, strictPort: true, host: 'localhost', open: false } });
const release = await holdHeavy('fw_r4_mem_netbuf');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const rep = { mode: MODE, sec: SEC, reads: [] };
const responses = [];
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  page.on('response', (r) => responses.push({ r, at: Date.now() }));
  const bcdp = await browser.newBrowserCDPSession();
  const infra = async () => {
    const ev = []; const on = (e) => { for (const v of e.value ?? []) if (v.ph === 'v') ev.push(v); };
    bcdp.on('Tracing.dataCollected', on);
    await bcdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } } });
    await bcdp.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
    const done = new Promise((res) => bcdp.once('Tracing.tracingComplete', res));
    await bcdp.send('Tracing.end'); await Promise.race([done, new Promise((r) => setTimeout(r, 20000))]);
    bcdp.off('Tracing.dataCollected', on);
    const rend = new Set((await bcdp.send('SystemInfo.getProcessInfo')).processInfo.filter((x) => x.type === 'renderer').map((x) => x.id));
    let best = null;
    for (const e of ev) if (rend.has(e.pid) && e.args?.dumps?.allocators) { const a = e.args.dumps.allocators; const v = (k) => (a[k]?.attrs?.size?.value ? +(parseInt(a[k].attrs.size.value, 16) / 1048576).toFixed(1) : null); const r = { buffer: v('partition_alloc/partitions/buffer'), arrayBuffer: v('partition_alloc/partitions/array_buffer'), pa: v('partition_alloc') }; if (!best || (r.pa ?? 0) > (best.pa ?? 0)) best = r; }
    return best;
  };
  const bodies = async (tag) => {
    let n = 0, held = 0, bytes = 0; const big = [];
    for (const { r } of responses) {
      n++;
      const b = await r.body().catch(() => null);
      if (!b) continue;
      held++; bytes += b.length;
      if (b.length > 1048576) big.push(`${r.url().replace(/.*\//, '').slice(0, 40)} ${(b.length / 1048576).toFixed(1)}MB`);
    }
    const m = await infra();
    const out = { tag, responses: n, bodiesStillHeld: held, heldMb: +(bytes / 1048576).toFixed(1), largest: big.slice(0, 12), infra: m };
    rep.reads.push(out);
    console.log(`${tag}: ${n} responses, ${held} bodies Chrome can still hand back = ${out.heldMb} MB; renderer buffer partition ${m?.buffer} MB, array_buffer ${m?.arrayBuffer} MB; ${big.slice(0, 6).join(', ')}`);
  };
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  const nav = page.locator('.nav__item', { hasText: 'Play' }).first();
  await nav.waitFor({ state: 'visible', timeout: 180000 });
  await page.keyboard.press('Shift');
  await page.waitForTimeout(10000);
  await bodies('home_0');
  await nav.click();
  await page.locator('.station', { hasText: MODE.toUpperCase() }).first().click();
  if (MODE === 'rift') await page.locator('.qcard', { hasText: 'Lantern Drill' }).first().click();
  await page.getByRole('button', { name: 'Find match' }).click();
  const hud = page.locator('.hud .dbar').first();
  for (let k = 0; k < 400 && !(await hud.isVisible().catch(() => false)); k++) {
    const ready = page.getByRole('button', { name: /^Ready/ }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click({ timeout: 3000 }).catch(() => {});
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (await card.isVisible().catch(() => false) && await lock.isVisible().catch(() => false)) { await card.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); await lock.click({ timeout: 3000 }).catch(() => {}); }
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(SEC * 1000);
  const leave = page.getByRole('button', { name: /Leave match/i }).first();
  for (let k = 0; k < 8 && !(await leave.isVisible().catch(() => false)); k++) { await page.keyboard.press('Escape'); await leave.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {}); }
  await leave.click();
  await page.getByRole('dialog').getByRole('button', { name: /Leave match/i }).click();
  for (let k = 0; k < 90 && !(await nav.isVisible().catch(() => false)); k++) { const ret = page.getByRole('button', { name: /Return home/i }).first(); if (await ret.isVisible().catch(() => false)) await ret.click().catch(() => {}); await page.waitForTimeout(700); }
  await page.locator('.nav__item', { hasText: 'Home' }).first().click().catch(() => {});
  await page.waitForTimeout(6000);
  await bodies(`${MODE}_home`);
} finally {
  await browser.close().catch(() => {});
  release();
  await new Promise((r) => (server.httpServer ? server.httpServer.close(r) : r()));
}
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'fw_r4_mem_netbuf.json'), JSON.stringify(rep, null, 1));
console.log('→ _harness/_reports/fw_r4_mem_netbuf.json');
