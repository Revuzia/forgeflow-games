// VALE harness — VFX gallery: every VfxDef fired in the real renderer (render bench, real map, real
// post chain), photographed over its life, tiled into contact sheets.
//
//   node _harness/vfx_gallery.mjs [id-prefix ...] [--per 8] [--name gallery]
//
// Each def fires at a clear ground spot near seat 0 (path defs ride a test mover 6 m across); frames at
// 0.1 · 0.3 · 0.6 · 1.0 s are cropped around it. Sheets: _harness/_shots/<name>_<n>.png (8 defs each),
// index: _harness/_reports/vfx_gallery.json.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, SHOTS } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const prefixes = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const per = Number(opt('per', 8));
const name = opt('name', 'gallery');
const TIMES = [0.1, 0.3, 0.6, 1.0];
const CW = 560, CH = 400;

const { browser, page } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=1&dev=1&hud=0&manual=1', { wait: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 120000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(30, 1 / 30));
// open ground: the map centre (the river crossing on RIFT), unless --at x,y
const at = opt('at', null);
const spot = at ? { x: Number(at.split(',')[0]), y: Number(at.split(',')[1]) }
  : await B((b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); return { x: m.size[0] / 2, y: m.size[1] / 2 }; });
const ids = (await B((b) => b.renderer.vfxIds())).filter((id) => !prefixes.length || prefixes.some((p) => id.startsWith(p))).sort();
console.log(`${ids.length} defs at`, spot);
const report = [];
let sheet = [], sheetN = 0;
const flushSheet = async () => {
  if (!sheet.length) return;
  const rows = sheet.length, W = CW * TIMES.length, H = CH * rows;
  const comp = [];
  sheet.forEach((r, i) => r.tiles.forEach((buf, j) => comp.push({ input: buf, left: j * CW, top: i * CH })));
  const labels = sheet.map((r, i) => `<text x="8" y="${i * CH + 22}" font-family="Helvetica" font-size="18" fill="#EDE6D6" stroke="#0B0D11" stroke-width="3" paint-order="stroke">${r.id}  ${r.info?.layers.join(' ') ?? ''}</text>`).join('');
  comp.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`), left: 0, top: 0 });
  mkdirSync(SHOTS, { recursive: true });
  const out = join(SHOTS, `${name}_${String(++sheetN).padStart(2, '0')}.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0B0D11' } }).composite(comp).png().toFile(out);
  console.log('  sheet', out);
  sheet = [];
};
for (const id of ids) {
  const info = await B((b, id) => b.renderer.vfxInfo(id), id);
  await B((b, s) => { b.focus(s.x, s.y); b.zoom(24.5); b.frames(12, 1 / 30); }, spot);
  const path = info?.path;
  // casts read left → right inside the crop: origin 1.5 m left of the spot, target 1.5 m right
  const from = path ? [spot.x - 3, spot.y] : [spot.x - 1.5, spot.y];
  await B((b, a) => b.renderer.vfxTest(a.id, a.from[0], a.from[1], a.path ? { to: [a.from[0] + 6, a.from[1]], travel: 0.6 } : { to: [a.from[0] + 3, a.from[1]] }), { id, from, path });
  const sc = await B((b, s) => b.screen(s.x, s.y, 0.8), spot);
  const tiles = [];
  let t = 0;
  for (const T of TIMES) {
    const n = Math.max(1, Math.round((T - t) * 30));
    await B((b, n) => b.frames(n, 1 / 30), n);
    t += n / 30;
    const clip = { x: Math.max(0, Math.round(sc.x - CW / 2)), y: Math.max(0, Math.round(sc.y - CH * 0.62)), width: CW, height: CH };
    tiles.push(await page.screenshot({ clip }));
  }
  await B((b) => b.frames(Math.round(1.5 * 30), 1 / 30));      // let it die before the next one
  sheet.push({ id, info, tiles });
  report.push({ id, ...info });
  if (sheet.length >= per) await flushSheet();
}
await flushSheet();
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'vfx_gallery.json'), JSON.stringify(report, null, 1));
await browser.close();
