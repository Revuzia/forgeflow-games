// orch1 W2-A scratch: the lane's frame cost on one page (High 1920x1080, RIFT / BRIDGE fight), synced frame ms (gfx_lib
// abCost: render + 1x1 readPixels), A = every W2-A switch off (env re-key, fighter tone, LOD2) vs B = on. Idle machine only.
//   VALE_URL=... python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_cost.mjs [--mode rift] [--t 481]
import { openBench, B, abCost } from './gfx_lib.mjs';
import { loadavg } from 'node:os';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODE = opt('mode', 'rift'), T = Number(opt('t', 481));
const load0 = loadavg()[0];
const s = await openBench({ q: 'high', seed: 7, mode: MODE, t: 10, manual: true, dyn: false });
await B(s.page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); for (let i = 0; i < 20 && b.you() && !b.you().alive; i++) { b.ff(2); b.frames(2, 1 / 30); } const f = b.fight(); if (f) b.focus(f.x, f.y); b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31); b.frames(10, 1 / 30); }, T);
const set = (on) => () => B(s.page, (b, on) => { const R = b.renderer; R.w2a.envKey.on = on; R.w2a.charTone.on = on; R.w2a.apply(); R.lod2Switch.on = on; R.render(0); }, on);
const r = await abCost(s.page, set(false), set(true), { rounds: 8, n: 30 });
const drawn = await B(s.page, (b) => b.renderer.lod2Switch.drawn);
console.log(JSON.stringify({ mode: MODE, t: T, load: [load0, loadavg()[0]], off: r.a, on: r.b, deltaMs: r.delta, blocksOff: r.blocksA, blocksOn: r.blocksB, lod2Drawn: drawn }));
await s.browser.close();
