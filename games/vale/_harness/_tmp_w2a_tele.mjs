// orch1 W2-A scratch: the clutter probe's telegraph edge metric (p90 of |dL| / max(L, 16) over the pixels the telegraph
// layer changes, sRGB luma, every 2nd pixel) on a fixed scene: an enemy circle (r 3 m, mid-sweep) injected at RIFT lane,
// jungle and river spots, per variant (env re-key off/on x telegraph ink off/on and ink settings). Fast A/B for teleInk.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_tele.mjs [--t 481] [--seed 7] [--out file.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 481)), SEED = Number(opt('seed', 7)), OUT = opt('out', null), SHOTS = opt('shots', null);
const m = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', 'map_rift.json'), 'utf8'));
const near = (path, x) => path.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a));
const spots = [['lane_mid', near(m.lanes[1].path, 55)], ['lane_high', near(m.lanes[0].path, 55)], ['jungle', m.camps.find((x) => x.id === 'a_glasshorn').units[0].at], ['river', [m.size[0] / 2, 43]]];
const V = [
  ['wave1', { env: false, ink: false }],
  ['rekey_noink', { env: true, ink: false }],
  ['rekey_ink', { env: true, ink: true }],
  ['ink_a8_w6', { env: true, ink: true, key: 0.7, band: 0.8, bandPx: 6 }],
  ['ink_a7_w8', { env: true, ink: true, key: 0.7, band: 0.7, bandPx: 8 }],
  ['ink_a9_w5', { env: true, ink: true, key: 0.8, band: 0.9, bandPx: 5 }],
];
const s = await openBench({ q: 'high', seed: SEED, mode: 'rift', t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); b.renderer.fog.enabled = false; }, T);
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
const def = await B(page, (b) => ({ ...b.renderer.teleInk }));
const res = { t: T, seed: SEED, metric: 'p90 |dL|/max(L,16), clutter teleEdge (bar 0.45)', inkDefault: def, spots: {} };
for (const [name, [x, y]] of spots) {
  res.spots[name] = {};
  for (const [vn, v] of V) {
    const r = await B(page, (b, a) => {
      const R = b.renderer, vw = b.host.view;
      R.w2a.envKey.on = a.v.env; R.w2a.apply();
      Object.assign(R.teleInk, a.def, { on: a.v.ink }, a.v.key != null ? { key: a.v.key, band: a.v.band, bandPx: a.v.bandPx } : {});
      b.focus(a.p[0], a.p[1]); b.frames(4, 1 / 30); b.focus(a.p[0], a.p[1]);
      const c = document.getElementById('c');
      const read = () => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const k = g.getContext('2d'); k.drawImage(c, 0, 0); return k.getImageData(0, 0, c.width, c.height).data; };
      const foe = vw.entities.find((e) => e.kind === 'fighter' && e.team === 1) ?? vw.entities.find((e) => e.kind === 'fighter');
      R.director.telegraphs.length = 0;
      R.injectEvents([{ e: 'area', t: vw.time, src: foe.id, ability: 'w2a_tele', x: a.p[0], y: a.p[1], shape: { kind: 'circle', radius: 3 }, delay: 1.2, telegraph: 'everyone' }]);
      R.render(0.3); R.render(0.3); R.render(0);
      const Bx = read();
      const shot = a.shot ? c.toDataURL('image/png').split(',')[1] : null;
      // the same frame, same time, telegraph layer hidden (as the clutter probe does)
      const tMask = R.teles.mesh.layers.mask, tv = R.overlay.teleScene.visible;
      R.overlay.teleScene.visible = false; R.teles.mesh.layers.disableAll(); R.render(0);
      const A = read();
      R.teles.mesh.layers.mask = tMask; R.overlay.teleScene.visible = tv;
      R.director.telegraphs.length = 0;
      const luma = (px, o) => 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      const d = [];
      for (let o = 0; o < A.length; o += 8) { const p = luma(Bx, o), q = luma(A, o); const dd = Math.abs(p - q) / Math.max(q, p, 16); if (dd > 0.04) d.push(dd); }
      d.sort((u, w) => u - w);
      const gl = []; for (let o = 0; o < A.length; o += 64) gl.push(luma(A, o)); gl.sort((u, w) => u - w);
      return { px: d.length, p50: +(d[Math.floor(d.length * 0.5)] ?? 0).toFixed(3), p90: +(d[Math.floor(d.length * 0.9)] ?? 0).toFixed(3), groundLumaP50: Math.round(gl[gl.length >> 1]), shot };
    }, { p: [x, y], v, def, shot: !!SHOTS && name === 'lane_mid' && true });
    if (r.shot) writeFileSync(join(SHOTS, `tele_${name}_${vn}.png`), Buffer.from(r.shot, 'base64'));
    delete r.shot;
    res.spots[name][vn] = r;
    console.log(name, vn, JSON.stringify(r));
  }
}
await B(page, (b, d) => { Object.assign(b.renderer.teleInk, d); b.renderer.w2a.envKey.on = true; b.renderer.w2a.apply(); }, def);
if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log('errors', s.logs.slice(0, 5));
await s.browser.close();
