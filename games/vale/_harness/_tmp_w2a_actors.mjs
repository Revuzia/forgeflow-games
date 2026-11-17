// orch1 W2-A scratch: the actor triangle bill at a late fight. RIFT bench at --t (seed --seed), the camera on the densest
// fight at the default zoom and locked on your fighter; per view: the frame's triangles by group and the actor detail
// (renderer.profile), the fighters on screen and on LOD2, with lod2Switch on vs off.
//   VALE_URL=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_actors.mjs [--t 1700] [--seed 23] [--mode rift] [--out f.json]
import { writeFileSync } from 'node:fs';
import { openBench, B } from './gfx_lib.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 1700)), SEED = Number(opt('seed', 23)), MODE = opt('mode', 'rift'), OUT = opt('out', null), ROT = Number(opt('rot', 0));
const s = await openBench({ q: 'high', seed: SEED, mode: MODE, t: 10, manual: true, dyn: false, extra: `&rot=${ROT}` });
s.page.on('crash', () => console.log('[page crash]'));
s.page.on('console', (m) => { if (m.type() === 'warning') s.logs.push('[warn] ' + m.text().slice(0, 200)); });
try { await B(s.page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); }, T); console.log('ff ok'); await B(s.page, (b) => { b.frames(40, 1 / 30); }); }
catch (e) { console.log('FAIL', e.message.slice(0, 200), s.logs.slice(0, 10)); process.exit(1); }
const out = { t: T, seed: SEED, mode: MODE, views: [] };
for (const view of ['fight', 'you', 'fight45']) {
  const r = await B(s.page, async (b, v) => {
    const R = b.renderer;
    const z = b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31;
    if (v === 'you') { b.follow(); b.zoom(z); } else { const f = b.fight(); if (f) b.focus(f.x, f.y); b.zoom(v === 'fight45' ? 45 : z); }
    b.frames(6, 1 / 30);
    const read = async (on) => {
      R.lod2Switch.on = on; R.render(0); R.render(0);
      const pp = b.profile(); R.render(0); const p = await pp;
      const det = {};
      for (const [k, x] of Object.entries(p.detail)) if (k.startsWith('actors')) det[k] = [x.calls, x.tris, x.main?.tris, x.shadow?.tris];
      return { drawn: R.lod2Switch.drawn, total: p.total.tris, calls: p.total.calls, actors: p.groups.actors?.tris, vfx: p.groups.vfx?.tris, canopy: p.groups.canopy?.tris, det };
    };
    const off = await read(false), on = await read(true);
    const fighters = b.entities('fighter').filter((e) => e.alive).length;
    return { view: v, zoom: R.camera.distance ?? null, fighters, off, on };
  }, view);
  out.views.push(r);
  console.log(JSON.stringify({ view: r.view, fighters: r.fighters, off: [r.off.total, r.off.actors], on: [r.on.total, r.on.actors, r.on.drawn] }));
  console.log('  det on', JSON.stringify(r.on.det));
}
// per fighter on screen: every visible mesh's triangles as drawn (index count of its current geometry)
out.fighters = await B(s.page, (b) => {
  const R = b.renderer, res = [];
  for (const a of R.actors.values()) {
    if (a.view?.kind !== 'fighter' || !a.model || a.culled) continue;
    const parts = {};
    a.root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis) return;
      const g = o.geometry, n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const k = (o.userData.valeOutline ? o.name : (g.name || o.name || 'mesh'));
      parts[k] = (parts[k] ?? 0) + Math.round(n);
    });
    res.push({ def: a.view.def, level: a.bodyLodLevel, parts });
  }
  return res;
});
for (const f of out.fighters) console.log(f.def, f.level, JSON.stringify(f.parts));
console.log('errors', s.logs.slice(0, 5));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
await s.browser.close();
