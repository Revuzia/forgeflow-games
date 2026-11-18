// orch1 W2-A round-3 verifier scratch: whole-frame reads at the game camera, own captures.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_w2a_r3.mjs <rift|bridge|fray> --out <dir> [--t 420] [--seed 13]
// Frames per map: (1) player view (viewer team 0, fog on) on seat 0, (2) spectator on the densest fighter cluster, A/B:
// before = every W2-A switch off (wave-1 look), after = shipped. Per frame and A/B: all fighter pixels (meshes shown vs
// hidden, same frame), their L* quartiles and C*, against the ground pixels around them. The frame is never pumped
// between the A/B reads (render(0) only).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, B } from './gfx_lib.mjs';

const args = process.argv.slice(2);
const id = args[0] ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 420)), SEED = Number(opt('seed', 13));
const OUT = opt('out', '/tmp'); mkdirSync(OUT, { recursive: true });

const s = await openBench({ q: 'high', seed: SEED, mode: id, t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); }, T);
await page.waitForTimeout(3000);
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
const set = (on) => B(page, (b, on) => { const R = b.renderer; R.w2a.envKey.on = on; R.w2a.charTone.on = on; if (R.w2a.charExpo) R.w2a.charExpo.on = on; R.w2a.apply(); if (R.lod2Switch) R.lod2Switch.on = on; if (R.teleInk) R.teleInk.on = on; for (let i = 0; i < 6; i++) R.render(0); }, on);
const grab = async (file) => { const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]); writeFileSync(join(OUT, file), Buffer.from(b64, 'base64')); };
const measure = () => B(page, (b) => {
  const R = b.renderer, v = b.host.view, c = document.getElementById('c'), W = c.width, H = c.height;
  const read = () => { const g = document.createElement('canvas'); g.width = W; g.height = H; const x = g.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); return x.getImageData(0, 0, W, H).data; };
  const lin = (q) => { q /= 255; return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const lab = (d, i) => { const r = lin(d[i]), g = lin(d[i + 1]), bb = lin(d[i + 2]); const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.95047, YY = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.08883; return [116 * f(YY) - 16, 500 * (f(X) - f(YY)), 200 * (f(YY) - f(Z))]; };
  const meshes = [];
  for (const e of v.entities) if (e.kind === 'fighter' && e.alive) { const a = R.actors.get(e.id); a?.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push([o, o.visible]); }); }
  R.render(0); const F = read();
  meshes.forEach(([m]) => { m.visible = false; }); R.render(0); const G = read();
  meshes.forEach(([m, w]) => { m.visible = w; }); R.render(0);
  const fL = [], fC = [], gL = [], gC = [], all = [];
  for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2) {
    const i = (py * W + px) * 4;
    const d = Math.max(Math.abs(F[i] - G[i]), Math.abs(F[i + 1] - G[i + 1]), Math.abs(F[i + 2] - G[i + 2]));
    const l = lab(F, i); const C = Math.hypot(l[1], l[2]);
    all.push(l[0]);
    if (d >= 24) { fL.push(l[0]); fC.push(C); } else { const g = lab(G, i); gL.push(g[0]); gC.push(Math.hypot(g[1], g[2])); }
  }
  const q = (a, p) => { const s2 = [...a].sort((x, y) => x - y); return +(s2[Math.floor((s2.length - 1) * p)] ?? 0).toFixed(1); };
  const mean = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
  const sl = [...fL].sort((x, y) => x - y), n = sl.length, top = sl.slice(Math.floor(n * 0.75)), bot = sl.slice(0, Math.ceil(n * 0.25));
  return { fighters: v.entities.filter((e) => e.kind === 'fighter' && e.alive).length, fighterPx: fL.length * 4,
    fighter: { L25: q(fL, 0.25), L50: q(fL, 0.5), L75: q(fL, 0.75), topQ: mean(top), botQ: mean(bot), spread: +(mean(top) - mean(bot)).toFixed(1), C50: q(fC, 0.5), C75: q(fC, 0.75), gt90: +(fL.filter((x) => x > 90).length / Math.max(1, n) * 100).toFixed(2) },
    ground: { L25: q(gL, 0.25), L50: q(gL, 0.5), L75: q(gL, 0.75), C50: q(gC, 0.5), C75: q(gC, 0.75), lt15: +(gL.filter((x) => x < 15).length / gL.length * 100).toFixed(1) },
    frameL: { p5: q(all, 0.05), p50: q(all, 0.5), p95: q(all, 0.95) } };
});
const res = { map: id, t: T, seed: SEED };
// player view: seat 0, fog on, own team
const me = await B(page, (b) => { const v = b.host.view; const e = v.entities.find((x) => x.kind === 'fighter' && x.team === 0 && x.alive); return e ? { x: e.x, y: e.y, def: e.def } : null; });
if (me) {
  await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(6, 1 / 30); b.focus(p.x, p.y); }, me);
  for (const [tag, on] of [['before', false], ['after', true]]) { await set(on); await grab(`player_${id}_${tag}.png`); res[`player_${tag}`] = await measure(); }
  res.player = me;
}
await B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; });
const fight = await B(page, (b) => b.fight());
if (fight) {
  await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(4, 1 / 30); b.focus(p.x, p.y); }, fight);
  for (const [tag, on] of [['before', false], ['after', true]]) { await set(on); await grab(`fight_${id}_${tag}.png`); res[`fight_${tag}`] = await measure(); }
  res.fight = fight;
}
res.programs = await B(page, (b) => b.renderer.gl.info.programs.length);
res.errors = s.logs.slice(0, 5);
writeFileSync(join(OUT, `vfy3_${id}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
await s.browser.close();
