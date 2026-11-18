// orch1 W2-A fix-1 scratch: enemy telegraph edge contrast, the round-1 verifier's method (_tmp_vfy_w2a_probe.mjs: seed 11,
// t 481, enemy circle r 3 m injected at the screen centre, 2 frames into its sweep; pixels with dE76 > 3 between the
// frame with and without it: dE p50, WCAG contrast p90, clutter teleEdge p90 = |dL| / max(L_before, 16)) at the same
// spots, for wave-1 (every W2-A switch off, teleInk off) and each teleInk variant on the shipped look.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_tele2.mjs <rift|bridge|fray> [--variants '<json>'] [--out f.json] [--shots dir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0] ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 481)), SEED = Number(opt('seed', 11)), OUT = opt('out', null), SHOTS = opt('shots', null);
const RADIUS = Number(opt('radius', 3)), SHAPE = opt('shape', 'circle');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const VARIANTS = JSON.parse(opt('variants', '[{"name":"head"}]'));
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
const def = await B(page, (b) => ({ ...b.renderer.teleInk }));
const set = (on, v) => B(page, (b, a) => {
  const R = b.renderer; R.w2a.envKey.on = a.on; R.w2a.charTone.on = a.on; R.w2a.apply(); R.lod2Switch.on = a.on;
  Object.assign(R.teleInk, a.def, a.v ?? {}, { on: a.on && (a.v?.on ?? true) });
  for (let i = 0; i < 6; i++) R.render(0);
}, { on, v, def });
const tele = (shot, a_clean, a_none = false) => B(page, (b, a) => {
  const R = b.renderer, v = b.host.view, c = document.getElementById('c');
  const read = () => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const lab = (d, i) => { const r = lin(d[i]), g = lin(d[i + 1]), bb = lin(d[i + 2]); const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const cam = R.rig.camera, cx = cam.position, dir = cam.getWorldDirection(new cx.constructor()); const t = -cx.y / dir.y;
  const x = cx.x + dir.x * t, y = cx.z + dir.z * t;
  const foe = v.entities.find((e) => e.kind === 'fighter' && e.team === 1) ?? v.entities.find((e) => e.kind === 'fighter');
  // clean mode: effects hidden and the frame frozen (render(0), no sim pump), so only the telegraph changes pixels;
  // vfy mode: the round-1 verifier's frames (sim pumped 2 x 1/60 s between the two reads, effects live)
  const vd = R.vfx.draw;
  if (a.clean) { R.vfx.draw = () => {}; R.vfx.group.visible = false; }
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  const A = read();
  const shape = a.shape === 'cone' ? { kind: 'cone', radius: a.radius * 2, angle: 1.0 } : a.shape === 'rect' ? { kind: 'line', length: a.radius * 3, width: 1.2 } : { kind: 'circle', radius: a.radius };
  if (!a.noTele) R.injectEvents([{ e: 'area', t: v.time, src: foe.id, ability: 'w2a_tele2', x, y, dir: 0.4, shape, delay: 0.6, telegraph: 'everyone' }]);
  if (a.clean) { for (let i = 0; i < 3; i++) R.render(0); if (!R.teles.size) R.render(1 / 60); } else b.frames(2, 1 / 60);
  const Q = read();
  R.vfx.draw = vd; R.vfx.group.visible = true;
  // the region of interest: the shape's screen box + 24 px (clean mode)
  let box = null;
  if (a.clean) {
    const ext = (a.shape === 'cone' ? a.radius * 2 : a.shape === 'rect' ? a.radius * 3 : a.radius) + 1;
    const pts = [[x - ext, y - ext], [x + ext, y - ext], [x - ext, y + ext], [x + ext, y + ext]].map(([px, py]) => b.screen(px, py, 0));
    const dpr = c.width / c.clientWidth;
    box = [Math.min(...pts.map((p) => p.x)) * dpr - 24, Math.min(...pts.map((p) => p.y)) * dpr - 24, Math.max(...pts.map((p) => p.x)) * dpr + 24, Math.max(...pts.map((p) => p.y)) * dpr + 24];
  }
  const png = a.shot ? c.toDataURL('image/png').split(',')[1] : null;
  R.director.telegraphs.length = 0; for (let i = 0; i < 3; i++) R.render(0);
  const de = [], cr = [], dl = [];
  const Y = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  for (let i = 0; i < A.length; i += 16) {
    if (box) { const px = (i >> 2) % c.width, py = Math.floor((i >> 2) / c.width); if (px < box[0] || px > box[2] || py < box[1] || py > box[3]) continue; }
    const p = lab(A, i), r = lab(Q, i); const d = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]);
    if (d > 3) { de.push(d); const ya = Y(A, i), yb = Y(Q, i); cr.push((Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05)); const la = luma(A, i), lb = luma(Q, i); dl.push(Math.abs(lb - la) / Math.max(la, 16)); }
  }
  const pc = (arr, p) => { arr.sort((m, n) => m - n); return +(arr[Math.floor(arr.length * p)] ?? 0).toFixed(3); };
  return { px: de.length, deP50: pc(de, 0.5), edgeCR90: pc(cr, 0.9), teleEdgeP90: pc(dl, 0.9), png };
}, { shot, radius: RADIUS, shape: SHAPE, clean: a_clean, noTele: a_none });
const res = { map: id, t: T, seed: SEED, shape: SHAPE, radius: RADIUS, inkDefault: def, variants: VARIANTS, spots: {} };
for (const [name, [x, y]] of spots) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(10, 1 / 30); b.focus(p[0], p[1]); }, [x, y]);
  res.spots[name] = {};
  for (const [tag, on, v] of [['wave1', false, null], ...VARIANTS.map((q) => [q.name, true, q])]) {
    await set(on, v);
    const r = await tele(!!SHOTS, true);
    if (r.png) writeFileSync(join(SHOTS, `tele_${id}_${name}_${tag}.png`), Buffer.from(r.png, 'base64'));
    delete r.png;
    const q = await tele(false, false); delete q.png;
    r.vfy = q;
    // the verifier-method frames with NO telegraph injected: what that method counts from the sim and effects alone
    const z = await tele(false, false, true); delete z.png; r.vfyNoTele = z;
    res.spots[name][tag] = r;
    console.log(id, name.padEnd(9), tag.padEnd(10), JSON.stringify(r));
  }
}
await set(true, null);
res.errors = s.logs.slice(0, 5);
if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1));
await s.browser.close();
