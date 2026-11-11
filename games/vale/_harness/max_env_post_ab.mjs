// VALE harness — MAX env ENV-9: the post chain's sharpen, A/B in one page (PostChain.setSharpen): frozen frames per spot,
// the slow-pan shimmer metric (gfx_lib panMetric, the GR-3 tool's) with and without, the synced frame cost, the counts.
//   node _harness/max_env_post_ab.mjs [--q high] [--mode rift] [--sharp 0.3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab, panMetric, abCost, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const q = arg('q', 'high'), mode = arg('mode', 'rift'), sharp = arg('sharp', null);
const OUT = '_harness/_shots/maxenv/sharpen'; mkdirSync(OUT, { recursive: true });
const spots = { rift: { jungle: [40, 36], core: [22, 55], xi: [55.3, 30] }, bridge: { deck: [45, 22] }, fray: { centre: [32, 32] } }[mode];
const { browser, page } = await openBench({ q, t: 20, mode });
const set = (v) => B(page, (b, x) => { b.renderer.post.setSharpen(x); b.renderer.render(0); b.renderer.render(0); return b.renderer.stats(); }, v);
const res = { q, mode, load0: load(), spots: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.frames(40, 1 / 30); }, [x, y]);
  const a = await set(0); await grab(page, `${OUT}/${mode}_${q}_${k}_off.png`);
  const bb = await set(sharp == null ? null : Number(sharp)); await grab(page, `${OUT}/${mode}_${q}_${k}_on.png`);
  await set(0); const panOff = await panMetric(page, x, y, { maskKey: k });
  await set(sharp == null ? null : Number(sharp)); const panOn = await panMetric(page, x, y, { maskKey: k });
  res.spots[k] = { off: { tris: a.triangles, calls: a.calls, programs: a.programs }, on: { tris: bb.triangles, calls: bb.calls, programs: bb.programs }, panOff, panOn };
  console.log(k, JSON.stringify(res.spots[k]));
}
res.cost = await abCost(page, () => set(0), () => set(sharp == null ? null : Number(sharp)));
res.load1 = load();
console.log('cost', JSON.stringify(res.cost), 'load', res.load0, res.load1);
writeFileSync(`${OUT}/${mode}_${q}.json`, JSON.stringify(res, null, 1));
await browser.close();
