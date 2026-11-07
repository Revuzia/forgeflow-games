// VALE harness — GR-1 anisotropy A/B in one page at the game camera (zoom 28.5): live texParameterf on every landed
// mipmapped texture, frozen frames (render(0)) so only the filter differs. Writes PNGs and JSON.
//   node _harness/gfx_aniso_ab.mjs [--q high] [--seed 7] [--t 300] [--out _harness/_shots/gfx_GR1]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, B, grab, abCost, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const q = arg('q', 'high'), OUT = arg('out', '_harness/_shots/gfx_GR1'), seed = Number(arg('seed', 7)), t = Number(arg('t', 300));
const LEVELS = (arg('levels', '1,8,16')).split(',').map(Number);
mkdirSync(OUT, { recursive: true });
const { browser, page, logs } = await openBench({ q, t, seed });
await B(page, (b) => {
  window.__aniso = (glbN, tileN) => {
    const R = b.renderer, G = R.gl, gl = G.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
    const seen = new Set();
    const apply = (t, n) => {
      if (!t?.isTexture || seen.has(t) || t.minFilter !== 1008) return;
      seen.add(t); t.anisotropy = n;
      const p = G.properties.get(t);
      if (p.__webglTexture) { G.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture); gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, n); p.__currentAnisotropy = n; }
    };
    for (const t of R.assets.landedTextures.values()) apply(t, tileN);
    const mats = (o) => { const out = []; o.traverse((x) => { for (const m of [x.material].flat()) if (m) out.push(m); }); return out; };
    const roots = [R.scene, ...[...R.assets.landedModels.values()].map((l) => l.m?.gltf?.scene).filter(Boolean)];
    for (const r of roots) for (const m of mats(r)) for (const v of Object.values(m)) if (v?.isTexture) apply(v, glbN);
    return seen.size;
  };
  window.__freeze = (x, y) => { b.focus(x, y); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 40; i++) { b.host?.pump(0); b.renderer.render(1 / 60); } };
});
const info = await B(page, (b) => {
  const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
  const f = b.fight();
  const st = b.host.view.entities.filter((e) => e.kind === 'structure').map((e) => [e.x, e.y, e.def]);
  return { size: m.size, f, st };
});
const [W, H] = info.size;
const tw = info.st[Math.floor(info.st.length / 3)], tw2 = info.st[Math.floor(2 * info.st.length / 3)];
const spots = { fight: info.f ? [info.f.x, info.f.y] : [W / 2, H / 2], centre: [W / 2, H / 2], struct_a: [tw[0], tw[1]], struct_b: [tw2[0], tw2[1]], q1: [W * 0.3, H * 0.3] };
const report = { q, seed, t, levels: LEVELS, loadStart: load(), spots, cost: {}, shots: [] };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { window.__aniso(1, 8); window.__freeze(p[0], p[1]); }, [x, y]);
  for (const n of LEVELS) {
    await B(page, (b, m) => { window.__aniso(m, Math.max(m, 8)); b.renderer.render(0); b.renderer.render(0); }, n);
    await grab(page, join(OUT, `${q}_${k}_a${String(n).padStart(2, '0')}.png`));
  }
  const noise = await B(page, (b) => { b.renderer.render(0); return 1; });
  const cost = await abCost(page, () => B(page, () => { window.__aniso(1, 8); }), () => B(page, () => { window.__aniso(16, 16); }));
  report.cost[k] = { ...cost, load: load() };
  console.log(k, 'A = shipped (GLB 1, tiling 8), B = 16/16', JSON.stringify(cost), load());
}
report.loadEnd = load(); report.errors = logs;
writeFileSync(`_harness/_reports/gfx_GR1_ab_${q}.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log('done', logs.length, logs.slice(0, 3));
