// orch1 W2-A round-1 verifier scratch: independent telegraph contrast, GFX-5 and fight A/B on one page.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_w2a_probe.mjs <rift|bridge|fray> --out <dir> [--t 481]
// before = every W2-A switch off and teleInk off (wave-1 look); after = shipped defaults.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0] ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 481)), SEED = Number(opt('seed', 11));
const OUT = opt('out', '/tmp'); mkdirSync(OUT, { recursive: true });
const m = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', `map_${id}.json`), 'utf8'));
const spots = [];
if (id === 'rift') {
  const near = (path, x) => path.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a));
  spots.push(['lane_mid', near(m.lanes[1].path, 60)], ['jungle', m.camps.find((x) => x.id === 's_stilltusks').units[0].at], ['river', [m.size[0] / 2, 60]]);
} else if (id === 'bridge') {
  const y = m.lanes[0].path[0][1]; spots.push(['span_w', [46, y]], ['span_c', [80, y]]);
} else spots.push(['plate_c', [30, 30]], ['plate_ne', [46, 18]]);

const s = await openBench({ q: 'high', seed: SEED, mode: id, t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); }, T);
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
await B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; });
const set = (on) => B(page, (b, on) => { const R = b.renderer; R.w2a.envKey.on = on; R.w2a.charTone.on = on; R.w2a.apply(); R.lod2Switch.on = on; R.teleInk.on = on; for (let i = 0; i < 6; i++) R.render(0); }, on);
const grab = async (file) => { const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]); writeFileSync(join(OUT, file), Buffer.from(b64, 'base64')); };
const tele = () => B(page, (b) => {
  const R = b.renderer, v = b.host.view, c = document.getElementById('c');
  const read = () => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const lab = (d, i) => { const r = lin(d[i]), g = lin(d[i + 1]), bb = lin(d[i + 2]); const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const cam = R.rig.camera, cx = cam.position, dir = cam.getWorldDirection(new cx.constructor()); const t = -cx.y / dir.y;
  const x = cx.x + dir.x * t, y = cx.z + dir.z * t;
  const foe = v.entities.find((e) => e.kind === 'fighter' && e.team === 1) ?? v.entities.find((e) => e.kind === 'fighter');
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  const a = read();
  R.injectEvents([{ e: 'area', t: v.time, src: foe.id, ability: 'vfy_tele', x, y, shape: { kind: 'circle', radius: 3 }, delay: 0.6, telegraph: 'everyone' }]);
  b.frames(2, 1 / 60);
  const q = read();
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  const de = [], cr = [], dl = [];
  const Y = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  for (let i = 0; i < a.length; i += 16) {
    const p = lab(a, i), r = lab(q, i); const d = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]);
    if (d > 3) { de.push(d); const ya = Y(a, i), yb = Y(q, i); cr.push((Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05)); const la = luma(a, i), lb = luma(q, i); dl.push(Math.abs(lb - la) / Math.max(la, 16)); }
  }
  const pc = (arr, p) => { arr.sort((m, n) => m - n); return +(arr[Math.floor(arr.length * p)] ?? 0).toFixed(3); };
  return { px: de.length, deP50: pc(de, 0.5), edgeCR90: pc(cr, 0.9), teleEdgeP90: pc(dl, 0.9) };
});
const res = { map: id, t: T, seed: SEED, spots: {} };
for (const [name, [x, y]] of spots) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(10, 1 / 30); b.focus(p[0], p[1]); }, [x, y]);
  res.spots[name] = {};
  for (const [tag, on] of [['before', false], ['after', true]]) { await set(on); res.spots[name][tag] = await tele(); }
}
const fight = await B(page, (b) => b.fight());
if (fight) {
  await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(4, 1 / 30); b.focus(p.x, p.y); }, fight);
  for (const [tag, on] of [['before', false], ['after', true]]) { await set(on); await grab(`vfy_${id}_fight_${tag}.png`); }
  res.fight = fight;
}
res.programs = await B(page, (b) => b.renderer.gl.info.programs.length);
res.errors = s.logs.slice(0, 5);
writeFileSync(join(OUT, `vfy_${id}_probe.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await s.browser.close();
