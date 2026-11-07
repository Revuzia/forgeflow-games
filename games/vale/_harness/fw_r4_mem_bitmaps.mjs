// VALE harness — round 4 MEM-1: who holds the ImageBitmaps a match leaves open. A dev client (?dev=1, its own vite dev
// server on 5197, HMR off) walks Home → BRIDGE → Home with the real UI (autopilot drafts, autoflow accepts), with
// _harness/fw_r4_mem_track.js riding the page. In the match and at Home after it, every texture the renderer can reach
// (the asset cache's landed models, the template library, both scenes) whose source is a live ImageBitmap is listed by
// owner (model key, template key, scene object), next to the tracker's count of every live bitmap.
//   node _harness/fw_r4_mem_bitmaps.mjs [--mode bridge] [--sec 40]
// Report _harness/_reports/fw_r4_mem_bitmaps.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODE = arg('mode', 'bridge'), SEC = Number(arg('sec', 40)), PORT = 5197;
const vite = await import('vite');
process.env.VALE_FROZEN = '1';
const server = await vite.createServer({ configFile: join(ROOT, 'vite.config.ts'), root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true, host: 'localhost', hmr: false } });
await server.listen();
const release = await holdHeavy('fw_r4_mem_bitmaps');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const rep = { mode: MODE, sec: SEC, reads: [] };
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
  const inventory = async (tag) => {
    for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await page.waitForTimeout(500); }
    const r = await page.evaluate(() => {
      const R = window.__vale.state.renderer;
      const live = (t) => t?.isTexture && typeof ImageBitmap !== 'undefined' && t.source?.data instanceof ImageBitmap && t.source.data.width > 0;
      const texOf = (root) => { const out = new Set(); const add = (m) => { for (const v of Object.values(m ?? {})) if (v?.isTexture) out.add(v); for (const u of Object.values(m?.uniforms ?? {})) if (u?.value?.isTexture) out.add(u.value); }; root?.traverse?.((o) => { for (const m of [o.material].flat()) if (m) add(m); }); return out; };
      const owners = new Map();   // ImageBitmap → owner labels
      const note = (t, who) => { if (!live(t)) return; const b = t.source.data; const l = owners.get(b) ?? { wh: `${b.width}x${b.height}`, who: new Set(), textures: new Set(), uploaded: new Set(), hook: new Set() }; l.who.add(who); l.textures.add(t); const pr = R.gl.properties.get(t); if (pr?.__webglTexture) l.uploaded.add(t); l.hook.add(`${typeof t.onUpdate}:${t.name || ''}:v${t.version}:src${t.source.version}`); owners.set(b, l); };
      for (const [k, { m }] of R.assets.landedModels ?? []) if (m) for (const t of texOf(m.gltf.scene)) note(t, `model ${k.replace(/.*\//, '').replace(/^[0-9a-f]{12}-/, '')}`);
      for (const [k, t] of R.lib.landed ?? []) if (t) for (const x of texOf(t.scene ?? t.root ?? t.model?.gltf?.scene)) note(x, `template ${k}`);
      for (const x of texOf(R.scene)) note(x, 'match scene');
      for (const x of texOf(R.menu?.scene)) note(x, 'menu scene');
      const list = [...owners.values()].map((l) => ({ wh: l.wh, who: [...l.who].slice(0, 4), textures: l.textures.size, uploaded: l.uploaded.size, hook: [...l.hook].slice(0, 3) }));
      return { mode: R.mode, reachable: list.length, list, track: window.__memTrack() };
    });
    rep.reads.push({ tag, ...r });
    console.log(`${tag}: renderer mode ${r.mode}; live bitmaps ${r.track.bitmaps.n} (${r.track.bitmaps.mb} MB) ${JSON.stringify(r.track.bitmaps.sizes)}; reachable from the renderer ${r.reachable}`);
    for (const l of r.list) console.log(`   ${l.wh} textures ${l.textures} on GPU ${l.uploaded} ${l.hook.join(',')}  ${l.who.join(' | ')}`);
  };
  await inventory('home_0');
  await page.locator('.nav__item', { hasText: 'Play' }).first().click();
  await page.locator('.station', { hasText: MODE.toUpperCase() }).first().click();
  if (MODE === 'rift') await page.locator('.qcard', { hasText: 'Lantern Drill' }).first().click();
  await page.getByRole('button', { name: 'Find match' }).click();
  await page.locator('.hud .dbar').first().waitFor({ state: 'visible', timeout: 300000 });
  await page.waitForTimeout(SEC * 1000);
  await inventory('match');
  const leave = page.getByRole('button', { name: /Leave match/i }).first();
  for (let i = 0; i < 8 && !(await leave.isVisible().catch(() => false)); i++) { await page.keyboard.press('Escape'); await leave.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {}); }
  await leave.click();
  await page.getByRole('dialog').getByRole('button', { name: /Leave match/i }).click();
  const nav = page.locator('.nav__item', { hasText: 'Play' }).first();
  for (let i = 0; i < 90 && !(await nav.isVisible().catch(() => false)); i++) { const ret = page.getByRole('button', { name: /Return home/i }).first(); if (await ret.isVisible().catch(() => false)) await ret.click().catch(() => {}); await page.waitForTimeout(700); }
  await page.locator('.nav__item', { hasText: 'Home' }).first().click().catch(() => {});
  await page.waitForTimeout(5000);
  await inventory('home_after');
  // --retainers: a V8 heap snapshot at Home after the match, and for each live ImageBitmap and AudioBuffer the chain of
  // objects that holds it (first retainer at each step, skipping weak edges), so the owner is named, not guessed
  if (process.argv.includes('--retainers')) {
    const chunks = [];
    cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    const snap = JSON.parse(chunks.join('')); chunks.length = 0;
    const m = snap.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length;
    const nType = m.node_fields.indexOf('type'), nName = m.node_fields.indexOf('name'), nEc = m.node_fields.indexOf('edge_count');
    const eType = m.edge_fields.indexOf('type'), eName = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node');
    const ntypes = m.node_types[0], etypes = m.edge_types[0];
    const N = snap.nodes, E = snap.edges, S = snap.strings, n = N.length / NF;
    const firstEdge = new Uint32Array(n + 1);
    for (let i = 0, e = 0; i < n; i++) { firstEdge[i] = e; e += N[i * NF + nEc] * EF; }
    firstEdge[n] = E.length;
    const rev = Array.from({ length: n }, () => null);
    for (let i = 0; i < n; i++) for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
      const t = etypes[E[e + eType]]; if (t === 'weak' || t === 'shortcut') continue;
      const to = E[e + eTo] / NF; (rev[to] ??= []).push([i, t === 'element' || t === 'hidden' ? `[${E[e + eName]}]` : S[E[e + eName]]]);
    }
    const label = (i) => `${ntypes[N[i * NF + nType]]}:${S[N[i * NF + nName]]}`.slice(0, 60);
    const chain = (i) => { const out = []; const seen = new Set([i]); let cur = i; for (let d = 0; d < 14; d++) { const r = (rev[cur] ?? []).find(([p]) => !seen.has(p) && !/^synthetic|\(GC roots\)/.test(label(p))); if (!r) break; out.push(`${r[1]} ← ${label(r[0])}`); seen.add(r[0]); cur = r[0]; } return out; };
    rep.retainers = {};
    for (const cls of ['ImageBitmap', 'AudioBuffer']) {
      const hits = []; const names = {};
      for (let i = 0; i < n; i++) { const nm = S[N[i * NF + nName]]; if (!nm.startsWith(cls) && !nm.startsWith(`blink::${cls}`)) continue; const k = `${ntypes[N[i * NF + nType]]}:${nm.slice(0, 40)}`; names[k] = (names[k] ?? 0) + 1; if ((rev[i] ?? []).some(([p]) => /V8PerContextData|FunctionTemplate/.test(label(p)))) continue; hits.push(i); }
      console.log(`${cls} node names: ${JSON.stringify(names)}`);
      rep.retainers[cls] = { n: hits.length, names, chains: hits.slice(0, 40).map(chain) };
      console.log(`${cls}: ${hits.length} in the heap`); for (const c of rep.retainers[cls].chains.slice(0, 10)) console.log(`   ${c.join('  ')}`.slice(0, 900));
    }
  }
  rep.logs = logs.slice(0, 10);
} finally {
  await browser.close().catch(() => {});
  release();
  await server.close();
}
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'fw_r4_mem_bitmaps.json'), JSON.stringify(rep, null, 1));
console.log('→ _harness/_reports/fw_r4_mem_bitmaps.json');
