// VALE harness — GR-1: every texture the match scene samples, with the anisotropy three holds AND the value GL reports.
//   node _harness/gfx_tex_census.mjs [--q high] [--t 300] [--out _harness/_reports/gfx_GR1_census.json]
import { writeFileSync } from 'node:fs';
import { openBench, B, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const q = arg('q', 'high'), out = arg('out', '_harness/_reports/gfx_GR1_census.json');
const { browser, page, logs } = await openBench({ q, t: Number(arg('t', 300)) });
const r = await B(page, (b) => {
  const R = b.renderer, G = R.gl, gl = G.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
  const seen = new Map();
  const note = (t, owner, slot) => {
    if (!t || !t.isTexture) return;
    let e = seen.get(t);
    if (!e) {
      const p = G.properties.get(t), img = t.image ?? {};
      let glAniso = null;
      const target = t.isData3DTexture ? gl.TEXTURE_3D : t.isDataArrayTexture ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
      if (p.__webglTexture && ext && !t.isCubeTexture && target === gl.TEXTURE_2D) {
        G.state.bindTexture(target, p.__webglTexture);
        glAniso = gl.getTexParameter(target, ext.TEXTURE_MAX_ANISOTROPY_EXT);
      }
      e = { name: t.name || t.source?.data?.src?.split('/').pop() || '', w: img.width ?? 0, h: img.height ?? 0, three: t.anisotropy, gl: glAniso, minFilter: t.minFilter, mips: t.generateMipmaps, kind: t.isDataTexture ? 'data' : t.isCanvasTexture ? 'canvas' : 'image', slots: new Set(), owners: new Set() };
      seen.set(t, e);
    }
    e.slots.add(slot); if (e.owners.size < 3) e.owners.add(owner);
  };
  const walk = (m, owner) => {
    for (const [k, v] of Object.entries(m)) if (v && v.isTexture) note(v, owner, k);
    for (const [k, u] of Object.entries(m.uniforms ?? {})) if (u?.value?.isTexture) note(u.value, owner, k);
    for (const [k, u] of Object.entries(m.userData ?? {})) if (u?.value?.isTexture) note(u.value, owner, k);
  };
  const scene = R.scene;
  scene.traverse((o) => {
    for (const m of [o.material].flat()) if (m) walk(m, o.name || m.name || o.type);
  });
  const rows = [...seen.values()].map((e) => ({ ...e, slots: [...e.slots], owners: [...e.owners] }));
  return { maxAniso: G.capabilities.getMaxAnisotropy(), rows, cam: R.camera?.get?.() ?? null };
});
const mip = r.rows.filter((x) => x.w > 4 && x.minFilter >= 1008);
const hist = {};
for (const x of mip) hist[x.gl ?? x.three] = (hist[x.gl ?? x.three] ?? 0) + 1;
const summary = { q, load: load(), maxAniso: r.maxAniso, textures: r.rows.length, mipmapped: mip.length, mipmappedByGlAnisotropy: hist };
console.log(summary);
for (const x of r.rows.filter((y) => y.w > 4).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 40)) console.log(String(x.w).padStart(5), String(x.h).padStart(5), 'three', x.three, 'gl', x.gl, 'min', x.minFilter, x.kind, x.slots.join(','), x.owners[0]?.slice(0, 40), x.name.slice(0, 40));
writeFileSync(out, JSON.stringify({ summary, rows: r.rows }, null, 1));
console.log('errors', logs.length, logs.slice(0, 3));
await browser.close();
