// VALE harness — GR-2: the DPR steps' synced frame cost, alternating in ONE page (A/B under the same load), at the fight and at a
// heavy foliage spot. render(0) + 1x1 readPixels, medians of blocks.
//   node _harness/gfx_dpr_alt.mjs --w 1512 --h 982 [--dprs 1,1.25,1.5,2] [--rounds 5] [--q high]
import { writeFileSync } from 'node:fs';
import { openBench, B, timedFrames, median, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const w = Number(arg('w', 1512)), h = Number(arg('h', 982)), dsf = Number(arg('dsf', 2)), q = arg('q', 'high'), rounds = Number(arg('rounds', 5));
const dprs = arg('dprs', '1,1.25,1.5,2').split(',').map(Number);
const { browser, page, logs } = await openBench({ q, t: 300, seed: Number(arg('seed', 7)), w, h, dsf });
const spots = await B(page, (b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y], centre: [m.size[0] / 2, m.size[1] / 2] }; });
const rep = { q, w, h, dsf, dprs, load0: load(), spots: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, [x, y]);
  const blocks = Object.fromEntries(dprs.map((d) => [d, []]));
  for (let r = 0; r < rounds; r++) for (const d of dprs) {
    await B(page, (b, m) => { b.setVideo(b.renderer.stats().tier, { maxDpr: m }); }, d);
    await timedFrames(page, 6);
    blocks[d].push(median(await timedFrames(page, 20)));
  }
  rep.spots[k] = { med: Object.fromEntries(dprs.map((d) => [d, +median(blocks[d]).toFixed(2)])), min: Object.fromEntries(dprs.map((d) => [d, +Math.min(...blocks[d]).toFixed(2)])), load: load() };
  console.log(k, JSON.stringify(rep.spots[k]));
}
writeFileSync(`_harness/_reports/gfx_GR2_alt_${q}_${w}x${h}.json`, JSON.stringify(rep, null, 1));
console.log('errors', logs.slice(0, 3));
await browser.close();
