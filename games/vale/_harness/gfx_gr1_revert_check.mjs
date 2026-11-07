// VALE harness — GR-1 revert check: the same frozen frames at the game camera (zoom 28.5) from a fresh page, so a tree with
// the switch (forced to 1) and a tree without it can be compared pixel for pixel, plus the live GL anisotropy of every GLB texture.
//   node _harness/gfx_gr1_revert_check.mjs --tag before --q high --mode rift --seed 41 --t 640
//   compare: _harness/gfx_gr1_revert_diff.py
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'after'), q = arg('q', 'high'), mode = arg('mode', 'rift'), seed = Number(arg('seed', 41)), t = Number(arg('t', 640));
const OUT = `_harness/_shots/gfx_GR1_revert`, name = `${mode}_${q}`;
mkdirSync(OUT, { recursive: true });
const { browser, page, logs } = await openBench({ q, mode, t, seed, land: 15000 });
const liveGl = () => B(page, (b) => {
  const R = b.renderer, G = R.gl, gl = G.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic'), h = {};
  const seen = new Set();
  for (const l of R.assets.landedModels.values()) l.m?.gltf.scene.traverse((o) => { for (const m of [o.material].flat()) if (m) for (const v of Object.values(m)) if (v?.isTexture && v.minFilter === 1008 && !seen.has(v)) { seen.add(v); const p = G.properties.get(v); const k = p.__webglTexture ? (G.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture), `gl${gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT)}`) : `pending${v.anisotropy}`; h[k] = (h[k] ?? 0) + 1; } });
  return h;
});
const hasSwitch = await B(page, (b) => typeof b.renderer.assets.setModelAnisotropy === 'function');
const set = (n) => B(page, (b, m) => { b.renderer.assets.setModelAnisotropy?.(m); b.renderer.render(0); b.renderer.render(0); }, n);
const counts = () => B(page, (b) => { const i = b.renderer.gl.info; b.renderer.render(0); return { tris: i.render.triangles, programs: i.programs?.length, textures: i.memory.textures, geoms: i.memory.geometries }; });
const liveAsLoaded = await liveGl();
const info = await B(page, (b) => { const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { f, s: s ? [s.x, s.y] : null }; });
const spots = { fight: [info.f.x, info.f.y], ...(info.s ? { struct: info.s } : {}) };
const rep = { tag, q, mode, seed, t, hasSwitch, liveAsLoaded, spots, load0: load(), frames: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 30; i++) b.renderer.render(1 / 60); }, [x, y]);
  await set(1); await grab(page, `${OUT}/${tag}_${name}_${k}.png`); rep.frames[k] = await counts();
  if (hasSwitch) { await set(8); await grab(page, `${OUT}/${tag}_${name}_${k}_on.png`); await set(1); }
}
rep.liveAtEnd = await liveGl(); rep.load1 = load(); rep.errors = logs;
writeFileSync(`${OUT}/${tag}_${name}.json`, JSON.stringify(rep, null, 1));
await browser.close();
console.log(JSON.stringify(rep));
