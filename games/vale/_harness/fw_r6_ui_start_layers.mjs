// VALE harness — round 6 UI-6 (diagnostic): what the page rasters across loading → the match's first seconds.
//
//   node _harness/fw_r6_ui_start_layers.mjs [--mode bridge] [--out _harness/_reports/fw_r6_ui_start_layers.json]
//
// Real clicks through Home → Play → the mode → Find match → Ready → a fighter locked → loading → the match (dev server,
// Chrome's fake audio sink). At the loading screen and at 0.5, 1, 2, 4, 8 and 14 s after the HUD shows it reads the
// compositor's layers (CDP LayerTree: count, drawn area in MB at 4 bytes a pixel, the largest with their compositing
// reasons and the screen they belong to; also at Home and the draft) and the renderer's memory-infra (cc tile and image memory). Exit 0 = read,
// 3 = the journey broke. Holds one heavy slot (pw.mjs).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODE = opt('mode', 'bridge');
const OUT = resolve(ROOT, opt('out', '_harness/_reports/fw_r6_ui_start_layers.json'));
const QUEUE_CARD = { rift: 'Lantern Drill' };
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${s}`);

const { browser, page, logs } = await open('/?dev=1', { fakeAudio: true, hmr: false });
const report = { probe: 'fw_r6_ui_start_layers', mode: MODE, at: new Date().toISOString(), reads: [], errors: [] };
let code = 0;
const kill = setTimeout(() => { console.error('timed out'); browser.close().catch(() => {}); process.exit(3); }, 8 * 60 * 1000);
try {
  const cdp = await page.context().newCDPSession(page);
  const bcdp = await browser.newBrowserCDPSession();
  let layers = [];
  cdp.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) layers = e.layers; });
  await cdp.send('LayerTree.enable');
  const infra = async () => {
    const events = [];
    const onData = (e) => { for (const v of e.value ?? []) if (v.ph === 'v') events.push(v); };
    bcdp.on('Tracing.dataCollected', onData);
    try {
      await bcdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } } });
      await bcdp.send('Tracing.requestMemoryDump', { deterministic: false, levelOfDetail: 'detailed' });
      const done = new Promise((res) => bcdp.once('Tracing.tracingComplete', res));
      await bcdp.send('Tracing.end');
      await Promise.race([done, new Promise((res) => setTimeout(res, 15000))]);
      const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
      const mb = (a) => { const v = a?.attrs?.size?.value; return v === undefined ? null : +(parseInt(v, 16) / 1048576).toFixed(1); };
      const out = {};
      for (const p of ps) {
        const ev = events.filter((e) => e.pid === p.id && e.args?.dumps?.allocators);
        if (!ev.length) continue;
        const al = ev.at(-1).args.dumps.allocators;
        const row = { tile: mb(al['cc/tile_memory']), image: mb(al['cc/image_memory']), cc: mb(al.cc), shared: mb(al['gpu/shared_images']) };
        if (p.type === 'renderer' && (row.cc ?? 0) > ((out.renderer?.cc) ?? -1)) out.renderer = row;
        if (p.type === 'GPU') out.gpu = row;
      }
      return out;
    } catch (e) { return { error: String(e?.message ?? e).slice(0, 160) }; } finally { bcdp.off('Tracing.dataCollected', onData); }
  };
  const read = async (tag) => {
    await page.waitForTimeout(50);
    const screens = await page.evaluate(() => [...document.querySelectorAll('.scr')].map((e) => e.className)).catch(() => []);
    const drawn = layers.filter((l) => l.drawsContent);
    const area = drawn.reduce((s, l) => s + l.width * l.height * 4, 0) / 1048576;
    const big = [...drawn].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8);
    const top = [];
    for (const l of big) {
      const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => ({}));
      let node = null;
      if (l.backendNodeId) {
        const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => null);
        node = d?.node ? `${d.node.localName}${(d.node.attributes ?? []).reduce((s, v, i, a) => (a[i - 1] === 'class' ? `${s}.${v.split(' ').slice(0, 2).join('.')}` : s), '')}` : null;
      }
      top.push({ w: Math.round(l.width), h: Math.round(l.height), mb: +((l.width * l.height * 4) / 1048576).toFixed(1), node, reasons: r.compositingReasonIds ?? r.compositingReasons ?? [] });
    }
    const mem = await infra();
    const rec = { tag, s: +((Date.now() - (hudAt ?? Date.now())) / 1000).toFixed(1), screens, layers: layers.length, drawn: drawn.length, drawnMb: +area.toFixed(1), mem, top };
    report.reads.push(rec);
    log(`${tag}: ${screens.join(' | ')}; layers ${rec.layers} (drawn ${rec.drawn}, ${rec.drawnMb} MB); tile ${mem.renderer?.tile} image ${mem.renderer?.image} cc ${mem.renderer?.cc}; GPU shared ${mem.gpu?.shared}`);
    for (const t of top.slice(0, 5)) log(`    ${t.w}x${t.h} ${t.mb} MB ${t.node ?? ''} ${JSON.stringify(t.reasons).slice(0, 120)}`);
  };
  let hudAt = null;
  const click = async (loc) => { await loc.first().waitFor({ state: 'visible', timeout: 30000 }); await loc.first().click({ timeout: 10000 }); };
  await page.waitForTimeout(4000);
  await read('home');
  await click(page.locator('.nav__item', { hasText: 'Play' }));
  await page.waitForTimeout(500);
  await click(page.locator('.station', { hasText: MODE.toUpperCase() }));
  await page.waitForTimeout(500);
  if (QUEUE_CARD[MODE]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[MODE] }));
  await click(page.getByRole('button', { name: 'Find match' }));
  let sawLoading = false, sawDraft = false;
  const until = Date.now() + 300000;
  while (!(await page.locator('.hud').first().isVisible().catch(() => false))) {
    if (Date.now() > until) throw new Error('no HUD after 300 s');
    const ready = page.getByRole('button', { name: /^Ready/ }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click({ timeout: 3000 }).catch(() => {});
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (await card.isVisible().catch(() => false) && await lock.isVisible().catch(() => false)) {
      await card.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); await lock.click({ timeout: 3000 }).catch(() => {});
    }
    if (!sawDraft && await page.locator('.scr--draft:not(.is-leaving) .fcard').first().isVisible().catch(() => false)) { sawDraft = true; await page.waitForTimeout(1500); await read('draft'); }
    if (!sawLoading && await page.locator('.scr--loading .pcard').first().isVisible().catch(() => false)) {
      sawLoading = true; await page.waitForTimeout(1500); await read('loading'); await page.waitForTimeout(1000); await read('loading +1 s');
    }
    await page.waitForTimeout(150);
  }
  hudAt = Date.now();
  for (const at of [0.5, 1, 2, 4, 8, 14]) {
    const wait = hudAt + at * 1000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await read(`match +${at} s`);
  }
} catch (e) { report.errors.push(String(e?.message ?? e)); console.error(e); code = 3; }
report.console = logs.slice(0, 40);
writeFileSync(OUT, JSON.stringify(report, null, 1));
log(`report → ${OUT}`);
clearTimeout(kill);
await browser.close().catch(() => {});
process.exit(code);
