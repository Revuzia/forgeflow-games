// VALE harness — map look-dev shots: the real renderer at the gameplay camera over named spots.
//   node _harness/shot_map.mjs [rift|bridge|fray] [--name map] [--q high] [--at x,y;x,y…  (extra spots, named at0, at1…)] [--nofog]
import { open, shot } from './pw.mjs';
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name', `map_${mode}`);
const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${mode}&q=${opt('q', 'high')}&t=${opt("t", 20)}&dev=1&hud=0&manual=1`, { wait: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 120000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(60, 1 / 30));
await new Promise((r) => setTimeout(r, 5000));
if (args.includes('--nofog')) await B((b) => { b.renderer.fog.enabled = false; });               // look-dev: everything lit                      // async models (props, landmarks) land in real time
await B((b) => b.frames(10, 1 / 30));
const m = await B((b) => { const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); return { size: m.size, bases: m.bases.map((x) => x.spawn) }; });
const [W, H] = m.size;
const spots = { centre: [W / 2, H / 2], lane_w: [W * 0.3, H * 0.5], jungle_nw: [W * 0.33, H * 0.28], ...(m.bases[0] ? { base_w: [m.bases[0][0] + 6, m.bases[0][1]] } : {}) };
const extra = opt('at', '');
if (extra) { for (const k of Object.keys(spots)) delete spots[k]; extra.split(';').forEach((p, i) => { spots[`at${i}`] = p.split(',').map(Number); }); }
for (const [k, [x, y]] of Object.entries(spots)) {
  await B((b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.frames(40, 1 / 30); }, [x, y]);
  await shot(page, `${name}_${k}`);
}
await browser.close();
