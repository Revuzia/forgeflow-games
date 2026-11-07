// VALE harness — GR-1 the shipped switch (Assets.setModelAnisotropy) A/B in one page: frames, synced cost, pan shimmer, live GL read.
//   node _harness/gfx_aniso_final.mjs [--q high]
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, abCost, panMetric, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const q = arg('q', 'high'), OUT = '_harness/_shots/gfx_GR1b';
mkdirSync(OUT, { recursive: true });
const { browser, page, logs } = await openBench({ q, t: 300, seed: 7 });
const set = (n) => B(page, (b, m) => { b.renderer.assets.setModelAnisotropy(m); b.renderer.render(0); }, n);
const prog = () => B(page, (b) => { const s = b.renderer.stats(); return { tris: s.triangles ?? s.tris, calls: s.calls, programs: b.renderer.gl.info.programs?.length }; });
const live = await B(page, (b) => {
  const R = b.renderer, G = R.gl, gl = G.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic'), h = {};
  for (const l of R.assets.landedModels.values()) l.m?.gltf.scene.traverse((o) => { for (const m of [o.material].flat()) if (m) for (const v of Object.values(m)) if (v?.isTexture && v.minFilter === 1008) { const p = G.properties.get(v); const k = p.__webglTexture ? (G.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture), `gl${gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT)}`) : `pending${v.anisotropy}`; h[k] = (h[k] ?? 0) + 1; } });
  return h;
});
console.log('live GL anisotropy of landed GLB textures', live);
const info = await B(page, (b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { size: m.size, f, s: [s.x, s.y] }; });
const spots = { fight: [info.f.x, info.f.y], struct: info.s };
const rep = { q, live, spots, load0: load(), by: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 30; i++) b.renderer.render(1 / 60); }, [x, y]);
  await set(1); await grab(page, `${OUT}/${q}_${k}_off.png`); const offP = await prog();
  await set(8); await grab(page, `${OUT}/${q}_${k}_on.png`); const onP = await prog();
  const cost = await abCost(page, () => set(1), () => set(8));
  await set(1); const panOff = await panMetric(page, x, y);
  await set(8); const panOn = await panMetric(page, x, y);
  rep.by[k] = { cost, offP, onP, panOff, panOn, load: load() };
  console.log(k, JSON.stringify(rep.by[k]));
}
writeFileSync(`_harness/_reports/gfx_GR1_final_${q}.json`, JSON.stringify(rep, null, 1));
await browser.close();
console.log('errors', logs.length, logs.slice(0, 3));
