// orch1 W2-A scratch: does the face-locked fighter LOD2 engage, and what does it save? RIFT bench at --t, spectator,
// the camera on the fight at the default zoom and pulled out to 45 m; per state the fighters drawing LOD2 and the
// frame's triangles with lod2Switch on vs off.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_lod2.mjs [--t 900] [--seed 7]
import { openBench, B } from './gfx_lib.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 900)), SEED = Number(opt('seed', 7));
const s = await openBench({ q: 'high', seed: SEED, mode: 'rift', t: 10, manual: true, dyn: false });
await B(s.page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; }, T);
const out = [];
for (const zoom of [31, 45]) {
  const r = await B(s.page, (b, z) => {
    const R = b.renderer, f = b.fight();
    if (f) b.focus(f.x, f.y);
    b.zoom(z); b.frames(6, 1 / 30);
    const read = (on) => { R.lod2Switch.on = on; R.render(0); R.render(0); return { drawn: R.lod2Switch.drawn, tris: R.gl.info.render.triangles, calls: R.gl.info.render.calls }; };
    const off = read(false), on = read(true);
    const fighters = b.entities('fighter').length;
    return { zoom: z, fighters, off, on };
  }, zoom);
  out.push(r); console.log(JSON.stringify(r));
}
console.log('errors', s.logs.slice(0, 5));
await s.browser.close();
