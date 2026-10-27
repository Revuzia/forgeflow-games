// scratch exploration (not committed)
import { open } from './pw.mjs';
const OUT = '/private/tmp/claude-501/-Users-sitskovich-Developer-forgeflow-games/4e79f165-d0b0-4b1f-a3d3-f4bc44cd631b/scratchpad/env/shots';
const args = process.argv.slice(2);
const map = args[0] ?? 'rift', q = args[1] ?? 'high';
const spots = JSON.parse(args[2] ?? '[[20,52]]');
const zoom = Number(args[3] ?? 0);
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${q}&t=20&dev=1&hud=0&manual=1`, { wait: false, width: q === 'low' ? 1280 : 1920, height: q === 'low' ? 720 : 1080, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
console.log('err', await page.evaluate(() => window.__VALE_BENCH__?.error));
await page.evaluate(() => window.__VALE_BENCH__.frames(30, 1 / 30));
await new Promise((r) => setTimeout(r, 7000));
await page.evaluate(() => { const R = window.__VALE_BENCH__.renderer; R.vfx.draw = () => {}; R.fog.enabled = false; });
let i = 0;
for (const [x, y] of spots) {
  await page.evaluate(([x, y, z]) => { const b = window.__VALE_BENCH__; b.focus(x, y); if (z) b.zoom(z); b.frames(40, 1 / 30); }, [x, y, zoom]);
  await page.screenshot({ path: `${OUT}/${map}_${q}_${i}.png` });
  const st = await page.evaluate(() => window.__VALE_BENCH__.renderer.stats().ambient);
  console.log(i, x, y, JSON.stringify(st));
  i++;
}
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
