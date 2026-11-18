// orch1 W2-A round-2 verifier scratch: frozen-frame enemy telegraph read (own classifier, own crops) and A/B whole frames.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_w2a_r2.mjs <rift|bridge|fray> --out <dir> [--t 481] [--seed 11]
// before = every W2-A switch off and teleInk off (wave-1 look); after = shipped defaults. The frame is never pumped between the
// two reads (render(0) only), so nothing but the telegraph changes. Pixels are classified by what the telegraph did to them:
//   ink   after luma <= 0.45 x before luma (the dark band)      edge  after hue 20-60 deg, chroma >= 35, brighter than before
// and contrast (WCAG ratio, relative luminance) is reported for edge vs the ground it sits on (no-ink case), edge vs ink and ink vs ground.
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
  const camp = m.camps.find((x) => x.id === 's_stilltusks') ?? m.camps[0];
  spots.push(['lane_mid', near(m.lanes[1].path, 60)], ['lane_top', near(m.lanes[0].path, 40)], ['camp', camp.units[0].at], ['river', [m.size[0] / 2, 60]]);
} else if (id === 'bridge') {
  const y = m.lanes[0].path[0][1]; spots.push(['span_w', [46, y]], ['span_c', [80, y]]);
} else spots.push(['plate_c', [30, 30]], ['plate_ne', [46, 18]]);

const s = await openBench({ q: 'high', seed: SEED, mode: id, t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); }, T);
await page.waitForTimeout(3000);
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
await B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; });
const set = (on) => B(page, (b, on) => { const R = b.renderer; R.w2a.envKey.on = on; R.w2a.charTone.on = on; R.w2a.apply(); R.lod2Switch.on = on; R.teleInk.on = on; for (let i = 0; i < 6; i++) R.render(0); }, on);
const grab = async (file) => { const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]); writeFileSync(join(OUT, file), Buffer.from(b64, 'base64')); };
const tele = (tag) => B(page, (b, tag) => {
  const R = b.renderer, v = b.host.view, c = document.getElementById('c');
  const read = () => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const Y = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const lab = (d, i) => { const r = lin(d[i]), g = lin(d[i + 1]), bb = lin(d[i + 2]); const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047, YY = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883; return [116 * f(YY) - 16, 500 * (f(X) - f(YY)), 200 * (f(YY) - f(Z))]; };
  const cam = R.rig.camera, cx = cam.position, dir = cam.getWorldDirection(new cx.constructor()); const t = -cx.y / dir.y;
  const x = cx.x + dir.x * t, y = cx.z + dir.z * t;
  const foe = v.entities.find((e) => e.kind === 'fighter' && e.team === 1) ?? v.entities.find((e) => e.kind === 'fighter');
  const vfxVis = R.vfx?.root ? R.vfx.root.visible : null;
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  const a = read();
  R.injectEvents([{ e: 'area', t: v.time, src: foe.id, ability: 'vfy_tele', x, y, shape: { kind: 'circle', radius: 3 }, delay: 0.6, telegraph: 'everyone' }]);
  for (let i = 0; i < 3; i++) R.render(0);
  const q = read();
  // crop around the centre for the eye: 360 x 360 px
  const W = c.width, H = c.height, cw = 360, x0 = (W - cw) / 2 | 0, y0 = (H - cw) / 2 | 0;
  const cv = document.createElement('canvas'); cv.width = cw * 2; cv.height = cw; const cx2 = cv.getContext('2d');
  cx2.drawImage(c, x0, y0, cw, cw, 0, 0, cw, cw);
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  cx2.drawImage(c, x0, y0, cw, cw, cw, 0, cw, cw);
  const crop = cv.toDataURL('image/png').split(',')[1];
  let changed = 0; const ink = [], edge = [], ground = [], eg = [];
  for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2) {
    const i = (py * W + px) * 4;
    const la = lab(a, i), lq = lab(q, i);
    const d = Math.hypot(la[0] - lq[0], la[1] - lq[1], la[2] - lq[2]);
    if (d <= 3) continue; changed++;
    const ya = Y(a, i), yq = Y(q, i);
    const C = Math.hypot(lq[1], lq[2]), h = (Math.atan2(lq[2], lq[1]) * 180 / Math.PI + 360) % 360;
    if (yq <= 0.45 * ya) { ink.push(yq); ground.push(ya); }
    else if (C >= 35 && h >= 20 && h <= 75 && yq > ya) { edge.push(yq); eg.push(ya); }
  }
  const med = (arr) => { const s2 = [...arr].sort((m2, n) => m2 - n); return s2[Math.floor(s2.length / 2)] ?? 0; };
  const cr = (p, q2) => (Math.max(p, q2) + 0.05) / (Math.min(p, q2) + 0.05);
  const yE = med(edge), yI = med(ink), yG = med([...ground, ...eg]);
  return { tag, changed, inkPx: ink.length, edgePx: edge.length, Yedge: +yE.toFixed(3), Yink: +yI.toFixed(3), Yground: +yG.toFixed(3),
    crEdgeGround: +cr(yE, yG).toFixed(2), crEdgeInk: ink.length ? +cr(yE, yI).toFixed(2) : null, crInkGround: ink.length ? +cr(yI, yG).toFixed(2) : null, vfxVis, crop };
}, tag);
const res = { map: id, t: T, seed: SEED, spots: {} };
for (const [name, [x, y]] of spots) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(10, 1 / 30); b.focus(p[0], p[1]); }, [x, y]);
  res.spots[name] = {};
  for (const [tag, on] of [['before', false], ['after', true]]) {
    await set(on); const r = await tele(tag);
    writeFileSync(join(OUT, `tele_${id}_${name}_${tag}.png`), Buffer.from(r.crop, 'base64')); delete r.crop;
    res.spots[name][tag] = r;
  }
  await grab(`spot_${id}_${name}_after.png`);
}
const fight = await B(page, (b) => b.fight());
if (fight) {
  await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(4, 1 / 30); b.focus(p.x, p.y); }, fight);
  for (const [tag, on] of [['before', false], ['after', true]]) { await set(on); await grab(`fight_${id}_${tag}.png`); }
  res.fight = fight;
}
res.programs = await B(page, (b) => b.renderer.gl.info.programs.length);
res.errors = s.logs.slice(0, 5);
writeFileSync(join(OUT, `vfy2_${id}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await s.browser.close();
