// VALE harness — MAX env lane: fixed gameplay-camera spots per map, PNG + counts, for before/after A/B sheets.
//   node _harness/max_env_shots.mjs --tag before [--maps rift,bridge,fray] [--q high] [--t 20] [--spots name,name] [--nofog]
// Writes _harness/_shots/maxenv/<tag>/<map>_<spot>.png and <tag>/counts.json (per spot: tris, calls, programs, geometries, textures).
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'now'), q = arg('q', 'high'), t = Number(arg('t', 20)), only = arg('spots', '');
const SPOTS = {
  rift: {
    core: [22, 55], gate: [30, 52], tower: [46, 57.8], jungle_w: [40, 36], xi: [55.3, 30], shaft: [85, 68], shaft_s: [85, 78], seat: [85, 55], jungle_e: [128, 74], slab: [85, 22],
  },
  bridge: { base: [18, 22], deck: [45, 22], snap: [78, 22] },
  fray: { centre: [32, 32], stones: [44, 22] },
};
const OUT = `_harness/_shots/maxenv/${tag}`; mkdirSync(OUT, { recursive: true });
const counts = {};
for (const map of arg('maps', 'rift,bridge,fray').split(',')) {
  const { browser, page, logs } = await openBench({ q, t, mode: map, land: 9000 });
  if (process.argv.includes('--nofog')) await B(page, (b) => { b.renderer.fog.enabled = false; });
  await B(page, (b) => { b.frames(10, 1 / 30); });
  for (const [k, [x, y]] of Object.entries(SPOTS[map])) {
    if (only && !only.split(',').includes(k)) continue;
    const s = await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); return b.frames(40, 1 / 30); }, [x, y]);
    await grab(page, `${OUT}/${map}_${k}.png`);
    counts[`${map}_${k}`] = { tris: s.triangles, calls: s.calls, programs: s.programs, geometries: s.geometries, textures: s.textures };
    console.log(map, k, JSON.stringify(counts[`${map}_${k}`]));
  }
  if (logs.length) console.log('page errors:', logs.slice(0, 6).join('\n'));
  await browser.close();
}
writeFileSync(`${OUT}/counts.json`, JSON.stringify(counts, null, 1));
