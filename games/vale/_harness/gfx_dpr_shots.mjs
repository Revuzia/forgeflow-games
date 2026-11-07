// VALE harness — GR-2: what a Retina player sees at each DPR cap: page.screenshot at deviceScaleFactor 2 (the browser's own upscale of
// the canvas to device pixels), frozen, same page, plus the pan shimmer and a thin-line check of the overlay.
//   node _harness/gfx_dpr_shots.mjs --w 1512 --h 982 [--q high]
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, panMetric, load } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const w = Number(arg('w', 1512)), h = Number(arg('h', 982)), q = arg('q', 'high'), dprs = arg('dprs', '1,1.25,1.5,2').split(',').map(Number);
const OUT = '_harness/_shots/gfx_GR2s'; mkdirSync(OUT, { recursive: true });
const { browser, page, logs } = await openBench({ q, t: 300, seed: 7, w, h, dsf: 2 });
const spots = await B(page, (b) => { const f = b.fight(); const st = b.host.view.entities.filter((e) => e.kind === 'structure'); const s = st[Math.floor(st.length / 3)]; return { fight: [f.x, f.y], struct: [s.x, s.y] }; });
const rep = { w, h, q, load0: load(), pan: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, [x, y]);
  rep.pan[k] = {};
  for (const d of dprs) {
    await B(page, (b, m) => { b.setVideo(b.renderer.stats().tier, { maxDpr: m }); b.renderer.render(0); b.renderer.render(0); }, d);
    await page.screenshot({ path: `${OUT}/${q}_${w}_${k}_dpr${d}.png` });
    rep.pan[k][d] = await panMetric(page, x, y, { step: 0.006, n: 24 });
    await B(page, (b, p) => { b.focus(p[0], p[1]); }, [x, y]);
    console.log(k, d, JSON.stringify(rep.pan[k][d]), load());
  }
}
writeFileSync(`_harness/_reports/gfx_GR2_pan_${q}_${w}.json`, JSON.stringify(rep, null, 1));
console.log('errors', logs.slice(0, 3));
await browser.close();
