// VALE harness — one fighter in a real match at the game camera (the in-engine read of a model).
//
//   node _harness/shot_fighter.mjs marund [--t 25] [--zoom 0.6] [--name art2_marund]
//
// Opens the render bench (real catalog, real renderer, bots everywhere, seat 0 = the fighter on
// autopilot), fast-forwards, then frames seat 0 three ways: the default gameplay zoom, a close zoom,
// and close again a second later (another pose). Shots: _harness/_shots/<name>_{game,close,close2}.png

import { open, shot } from './pw.mjs';

const args = process.argv.slice(2);
const fighter = args.find((a) => !a.startsWith('--')) ?? 'marund';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const t = Number(opt('t', 25));
const name = opt('name', `ingame_${fighter}`);
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${t}&dev=1&hud=0&manual=1&you=${fighter}`, { wait: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 120000 });
const err = await page.evaluate(() => window.__VALE_BENCH__.error);
if (err) { console.error('bench error:', err); process.exit(1); }
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(90, 1 / 30));
const me = await B((b) => b.you());
console.log('seat 0', me);
await B((b, id) => { b.focusEntity(id); b.frames(20, 1 / 30); }, me.id);
await shot(page, `${name}_game`);
await B((b, z) => { b.zoom(z); b.frames(20, 1 / 30); }, Number(opt('zoom', 0.45)));
await B((b, id) => { b.focusEntity(id); b.frames(10, 1 / 30); }, me.id);
await shot(page, `${name}_close`);
await B((b, id) => { b.frames(30, 1 / 30); b.focusEntity(id); b.frames(2, 1 / 30); }, me.id);
await shot(page, `${name}_close2`);
const errs = logs.filter((l) => /error/i.test(l) && !/404|Failed to load resource/.test(l));
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
await browser.close();
