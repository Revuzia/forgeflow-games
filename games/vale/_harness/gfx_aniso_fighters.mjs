// VALE harness — GR-1: each fighter on its own at the game camera (zoom 28.5), switch off and on, a 280 x 340 box round the body.
//   node _harness/gfx_aniso_fighters.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, load } from './gfx_lib.mjs';
const OUT = '_harness/_shots/gfx_GR1c'; mkdirSync(OUT, { recursive: true });
const { browser, page } = await openBench({ q: 'high', t: 300, seed: 7 });
const fs = await B(page, (b) => b.entities('fighter').filter((e) => e.alive !== false).map((e) => ({ id: e.id, def: e.def, x: e.x, y: e.y })));
const clip = { x: 820, y: 330, width: 280, height: 340 };
for (const f of fs) {
  await B(page, (b, id) => { b.focusEntity(id); b.zoom(28.5); b.renderer.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 25; i++) b.renderer.render(1 / 60); }, f.id);
  for (const [n, tag] of [[1, 'off'], [8, 'on']]) {
    await B(page, (b, m) => { b.renderer.assets.setModelAnisotropy(m); b.renderer.render(0); }, n);
    await page.screenshot({ path: `${OUT}/${f.def}_${f.id}_${tag}.png`, clip });
  }
}
await browser.close(); console.log(fs.length, load());
