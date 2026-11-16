// orch1 W2-A A/B frames: the same page, seed, match time and camera spot drawn twice, the lane's changes OFF (the wave-1
// look: r12 B5 environment key, character light without the AO weight and roll-off, every fighter on LOD1) then ON.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_ab.mjs <rift|bridge|fray> [--t 481] [--fog 1] [--out dir]
// Writes <out>/<map>_<spot>_{before,after}.png and <out>/<map>_ab.json (per frame: the frame's display L* p5/p50/p95 and
// mean chroma; the fighters' on-screen boxes for a by-eye check).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args[0] ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 481)), FOG = opt('fog', '1') === '1', SEED = Number(opt('seed', 7));
const OUT = opt('out', join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'w2-a'));
mkdirSync(OUT, { recursive: true });
const m = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', `map_${id}.json`), 'utf8'));
const S = [];
if (id === 'rift') {
  const near = (path, x) => path.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a));
  for (const l of m.lanes) S.push([`lane_${l.id.replace('road_', '')}`, near(l.path, 55)]);
  S.push(['base_aubade', [m.bases[0].spawn[0] + 6, m.bases[0].spawn[1]]]);
  for (const c of ['a_glasshorn', 's_gloamoths']) S.push([`jungle_${c}`, m.camps.find((x) => x.id === c).units[0].at]);
  S.push(['river_north', [m.size[0] / 2, 43]]);
  S.push(['pit_longshade', m.camps.find((x) => x.id === 'longshade').units[0].at]);
} else if (id === 'bridge') {
  const y = m.lanes[0].path[0][1];
  S.push(['span_west_base', [m.bases[0].spawn[0] + 6, m.bases[0].spawn[1]]], ['span_west', [40, y]], ['span_centre', [78, y]]);
} else {
  S.push(['plate_centre', [32, 32]], ['plate_rim_w', [8, 32]]);
}
const s = await openBench({ q: 'high', seed: SEED, mode: id, t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); }, T);
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
if (!FOG) await B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; });
const fight = await B(page, (b) => b.fight());
if (fight) S.push(['fight', [fight.x, fight.y]]);
const stats = () => page.evaluate(() => {
  const c = document.getElementById('c');
  const g = document.createElement('canvas'); g.width = 480; g.height = 270;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0, 480, 270);
  const d = x.getImageData(0, 0, 480, 270).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const L = [], C = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = lin(d[i]), gg = lin(d[i + 1]), bb = lin(d[i + 2]);
    const X = (0.4124 * r + 0.3576 * gg + 0.1805 * bb) / 0.95047, Y = 0.2126 * r + 0.7152 * gg + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * gg + 0.9505 * bb) / 1.08883;
    const l = 116 * f(Y) - 16, a = 500 * (f(X) - f(Y)), bz = 200 * (f(Y) - f(Z));
    L.push(l); C.push(Math.hypot(a, bz));
  }
  L.sort((p, q) => p - q);
  const q = (p) => +L[Math.floor(p * (L.length - 1))].toFixed(1);
  return { p5: q(0.05), p50: q(0.5), p95: q(0.95), meanC: +(C.reduce((p, v) => p + v, 0) / C.length).toFixed(1) };
});
const grab = async (file) => {
  const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);
  writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
};
const set = (on) => B(page, (b, on) => { const R = b.renderer; R.w2a.envKey.on = on; R.w2a.charTone.on = on; R.w2a.apply(); R.lod2Switch.on = on; }, on);
const rec = [];
for (const [name, [x, y]] of S) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(20, 1 / 30); b.focus(p[0], p[1]); }, [x, y]);
  const r = { spot: name, world: [x, y] };
  for (const [tagName, on] of [['before', false], ['after', true]]) {
    await set(on);
    await B(page, (b) => { for (let i = 0; i < 6; i++) b.renderer.render(0); });
    const file = `${id}_${name}_${tagName}.png`;
    await grab(file);
    r[tagName] = { file, ...(await stats()), lod2: await B(page, (b) => b.renderer.lod2Switch.drawn) };
  }
  rec.push(r);
  console.log(name, JSON.stringify(r.before), JSON.stringify(r.after));
}
// telegraph contrast on the ground (the overlay draws after the grade, so a brighter ground can only cost it): an enemy
// delayed circle (r 3 m) injected at the first spot, the frame read with and without it; over the pixels it changes
// (dE76 > 3), the median and p10 dE76 of telegraph-over-ground against the bare ground, before and after.
const teleDE = () => B(page, (b) => {
  const R = b.renderer, v = b.host.view, c = document.getElementById('c');
  const read = () => { const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const lab = (d, i) => { const r = lin(d[i]), g = lin(d[i + 1]), bb = lin(d[i + 2]); const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  const cx = R.rig.camera.position; const dir = R.rig.camera.getWorldDirection(new cx.constructor()); const t = -cx.y / dir.y;
  const x = cx.x + dir.x * t, y = cx.z + dir.z * t;
  const foe = v.entities.find((e) => e.kind === 'fighter' && e.team === 1) ?? v.entities.find((e) => e.kind === 'fighter');
  R.director.telegraphs.length = 0;
  for (let i = 0; i < 3; i++) R.render(0);
  const a = read();
  R.injectEvents([{ e: 'area', t: v.time, src: foe.id, ability: 'w2a_tele', x, y, shape: { kind: 'circle', radius: 3 }, delay: 0.6, telegraph: 'everyone' }]);
  b.frames(2, 1 / 60);
  const bb = read();
  R.director.telegraphs.length = 0;
  const de = [];
  for (let i = 0; i < a.length; i += 16) { const p = lab(a, i), q = lab(bb, i); const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d > 3) de.push(d); }
  de.sort((m, n) => m - n);
  return { px: de.length * 4, p10: +(de[Math.floor(de.length * 0.1)] ?? 0).toFixed(1), p50: +(de[Math.floor(de.length * 0.5)] ?? 0).toFixed(1) };
});
const lane0 = S[0][1];
await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(10, 1 / 30); b.focus(p[0], p[1]); }, lane0);
const tele = {};
for (const [tagName, on] of [['before', false], ['after', true]]) { await set(on); tele[tagName] = await teleDE(); }
console.log('telegraph dE76', JSON.stringify(tele));
// GFX-5 (RIFT): the Standing Shadow against fogged ground, paired on the Noonline. One frame lit (fog off), one with every
// pixel fully unseen (the vision texture held at 0, as value_probe --fog does); 9 x 9 px patches at a point inside the
// Shadow (85, 30) and at ground beside it (74, 31) and below it (85, 52): display CIELAB means and dE76.
let gfx5 = null;
if (id === 'rift') {
  await B(page, () => {
    const b = window.__VALE_BENCH__, R = b.renderer;
    if (!R.__w2aFog) {
      R.__w2aFog = { force: false };
      const up = R.fog.update.bind(R.fog);
      R.fog.update = (view, team, dt) => { up(view, team, dt); if (R.__w2aFog.force && R.fog.tex) { R.fog.bytes.fill(0); R.fog.cur.fill(0); R.fog.tex.needsUpdate = true; } };
    }
  });
  const patch = (unseen) => B(page, (b, u) => {
    const R = b.renderer, c = document.getElementById('c');
    R.palette.viewer.team = 0; R.rig.spectator = false; R.fog.enabled = u; R.__w2aFog.force = u;
    b.focus(85, 36); b.frames(4, 1 / 30); b.focus(85, 36);
    for (let i = 0; i < 4; i++) R.render(0);
    const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0);
    const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const at = (wx, wy) => {
      const s = b.screen(wx, wy, 0.02); const d = x.getImageData(Math.round(s.x) - 4, Math.round(s.y) - 4, 9, 9).data;
      let r = 0, gg = 0, bb = 0; for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); gg += lin(d[i + 1]); bb += lin(d[i + 2]); }
      r /= 81; gg /= 81; bb /= 81;
      const X = (0.4124 * r + 0.3576 * gg + 0.1805 * bb) / 0.95047, Y = 0.2126 * r + 0.7152 * gg + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * gg + 0.9505 * bb) / 1.08883;
      return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))].map((v) => +v.toFixed(1));
    };
    return { shadow: at(85, 30), side: at(74, 31), below: at(85, 52) };
  }, unseen);
  const dE = (p, q) => +Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]).toFixed(1);
  gfx5 = {};
  for (const [tagName, on] of [['before', false], ['after', true]]) {
    await set(on);
    const lit = await patch(false), fog = await patch(true);
    gfx5[tagName] = { lit, fog, dE_shadowLit_vs_fogSide: dE(lit.shadow, fog.side), dE_shadowLit_vs_fogBelow: dE(lit.shadow, fog.below), dE_shadowFog_vs_fogSide: dE(fog.shadow, fog.side), dE_shadowFog_vs_fogBelow: dE(fog.shadow, fog.below) };
    await grab(`${id}_gfx5_noonline_unseen_${tagName}.png`);
    await patch(false);
    await grab(`${id}_gfx5_noonline_lit_${tagName}.png`);
  }
  await B(page, (b) => { b.renderer.__w2aFog.force = false; });
  console.log('gfx5', JSON.stringify(gfx5));
}
const progs = await B(page, (b) => b.renderer.gl.info.programs.length);
writeFileSync(join(OUT, `${id}_ab.json`), JSON.stringify({ map: id, t: T, seed: SEED, fog: FOG, programs: progs, telegraph: tele, gfx5, spots: rec }, null, 1));
console.log('programs', progs, 'errors', s.logs.slice(0, 5));
await s.browser.close();
