// VALE harness — max2 env: whole-map tree triangle sum (every instance of every vale_trees_* variant, before culling)
//   node _harness/max2_env_treecount.mjs [--q high]
import { openBench, B } from './gfx_lib.mjs';
const q = process.argv.includes('--q') ? process.argv[process.argv.indexOf('--q') + 1] : 'high';
const { browser, page } = await openBench({ q, t: 20, mode: 'rift', land: 9000 });
const r = await B(page, (b) => {
  const out = {}; let tris = 0, n = 0;
  b.renderer.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^vale_trees_\d+/.test(o.name) || /_lod$/.test(o.name)) return;
    const key = o.name.match(/vale_trees_\d+/)[0];
    const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const cap = o.instanceMatrix.count;
    out[key] = out[key] ?? { inst: 0, tris: 0, per: t };
    out[key].inst += cap; out[key].tris += cap * t; tris += cap * t; n += cap;
  });
  return { out, tris, n };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
