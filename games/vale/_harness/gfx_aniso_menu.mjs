// VALE harness — GR-1: the Home and fighter showcase with the model anisotropy switch off and on.
//   node _harness/gfx_aniso_menu.mjs home|collection ...
import { mkdirSync } from 'node:fs';
import { openBench, grab, B } from './gfx_lib.mjs';
const OUT = '_harness/_shots/gfx_GR1d'; mkdirSync(OUT, { recursive: true });
const screens = process.argv.slice(2).length ? process.argv.slice(2) : ['home'];
for (const s of screens) {
  const { browser, page } = await openBench({ q: 'high', manual: false, extra: `&menu=${s}&fighter=hesmi` });
  await page.waitForTimeout(14000);
  await B(page, (b) => { b.setManual(true); });
  await page.waitForTimeout(300);
  for (const [n, tag] of [[1, 'off'], [8, 'on']]) {
    await B(page, (b, m) => { b.renderer.assets.setModelAnisotropy(m); }, n);
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(120); await B(page, (b) => { b.renderer.render(0); }); }
    await grab(page, `${OUT}/${s}_${tag}.png`);
  }
  await browser.close();
}
