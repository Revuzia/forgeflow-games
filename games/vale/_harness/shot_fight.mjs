// VALE harness — the densest fight in a real bot match at the gameplay camera.
//   node _harness/shot_fight.mjs [rift|bridge|fray] [--t 75] [--name fight]
import { open, shot } from './pw.mjs';
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name', `fight_${mode}`);
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${mode}&q=high&t=${opt('t', 75)}&dev=1&hud=0&manual=1`, { wait: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(60, 1 / 30));
for (let i = 0; i < 3; i++) {
  const f = await B((b) => b.fight());
  if (f) await B((b, p) => { b.focus(p.x, p.y); b.frames(8, 1 / 30); }, f);
  await shot(page, `${name}_${i + 1}`);
  await B((b) => b.frames(45, 1 / 30));
}
await browser.close();
