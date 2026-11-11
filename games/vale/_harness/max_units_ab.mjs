// VALE harness — MAX units lane: in-game A/B of fighter / wick / monster looks at the gameplay camera, both variants
// from the SAME frozen frame (toggled in the page, so another lane's edit or a different pose never confounds them).
//   node _harness/max_units_ab.mjs --tag u2 --variants base,metal0 [--picks a,b,...] [--t 420] [--q high] [--zoom 28.5]
//        [--seed 7] [--mode rift] [--crop 200x240] [--far 1]
// Variants (comma list, each a '+' join of switches): base (everything as it was before this lane's runtime changes),
//   metal0 (metalness 0 on every actor material), mat (worldUniforms.valeCharMat = 1: the character material response),
//   life (worldUniforms-free: actors' procedural life layer on; see actors.ts ACTOR_LIFE).
// Writes _harness/_shots/maxunits/<tag>/<variant>_<entity>.png crops, <variant>_frame.png, and counts.json (per
// variant: tris, calls, programs, textures, geometries).
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'now'), q = arg('q', 'high'), t = Number(arg('t', 420)), zoom = Number(arg('zoom', 28.5));
const variants = arg('variants', 'base,metal0').split(',');
const [cw, ch] = arg('crop', '200x240').split('x').map(Number);
const picks = arg('picks', '');
const OUT = `_harness/_shots/maxunits/${tag}`; mkdirSync(OUT, { recursive: true });
const extra = `${picks ? `&picks=${picks}` : ''}${arg('rot', '') ? `&rot=${arg('rot')}` : ''}`;
const { browser, page, logs } = await openBench({ q, t, mode: arg('mode', 'rift'), seed: Number(arg('seed', 7)), extra, land: 12000 });

await page.evaluate(async () => {
  const wm = await import('/src/render/world_material.ts');
  const act = await import('/src/render/actors.ts');
  window.__AB = { wm, act };
});
const setVariant = (v) => B(page, (b, v) => {
  const on = new Set(v.split('+'));
  const all = on.has('all');
  const { wm, act } = window.__AB;
  const x = [...on].find((k) => /^matx\d/.test(k));
  if (wm.worldUniforms.valeCharMat) wm.worldUniforms.valeCharMat.value = x ? Number(x.slice(4)) : all || on.has('mat') ? 1 : 0;
  if (act.ACTOR_LIFE) act.ACTOR_LIFE.on = all || on.has('life');
  b.renderer.scene.traverse((o) => {
    if (!o.isMesh) return;
    let r = o; while (r && !/^actor_/.test(r.name)) r = r.parent;
    if (!r) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.metalness === undefined) continue;
      if (m.userData.abMetal === undefined) m.userData.abMetal = m.metalness;
      m.metalness = all || on.has('metal0') ? 0 : m.userData.abMetal;
    }
  });
}, v);

const counts = {};
// a fight, then every fighter (and the nearest monsters) as a 1:1 crop at the gameplay camera
const fight = await B(page, (b) => b.fight());
const ents = await B(page, (b) => b.entities().filter((e) => e.alive && (e.kind === 'fighter' || e.kind === 'monster')));
const only = arg('only', '');
const targets = ents.filter((e) => e.kind === 'fighter' && e.mask !== 0 && (!only || only.split(',').includes(e.def))).concat(ents.filter((e) => e.kind === 'monster').slice(0, Number(arg('monsters', 0))));
const shots = [];
if (fight) shots.push({ name: 'frame', x: fight.x, y: fight.y, full: true });
for (const e of targets) shots.push({ name: `${e.kind}_${e.def}_${e.id}`, x: e.x, y: e.y, id: e.id });
for (const s of shots) {
  await B(page, (b, s) => { b.focus(s.x, s.y); b.zoom(s.z); b.frames(3, 1e-4); }, { ...s, z: zoom });
  for (const v of variants) {
    await setVariant(v);
    const st = await B(page, (b) => b.frames(2, 1e-4));
    if (s.full) counts[v] = { tris: st.triangles, calls: st.calls, programs: st.programs, textures: st.textures, geometries: st.geometries };
    const png = `${OUT}/${v}_${s.name}.png`;
    if (s.full) { await grab(page, png); continue; }
    const sc = await B(page, (b, id) => {
      const e = b.entities().find((x) => x.id === id);
      return e ? b.screen(e.x, e.y, 1.0) : null;
    }, s.id);
    if (!sc) continue;
    const vp = page.viewportSize();
    const x = Math.round(Math.max(0, Math.min(vp.width - cw, sc.x - cw / 2))), y = Math.round(Math.max(0, Math.min(vp.height - ch, sc.y - ch * 0.55)));
    const b64 = await page.evaluate(([x, y, w, h]) => {
      const c = document.getElementById('c'), o = document.createElement('canvas');
      o.width = w; o.height = h; o.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
      return o.toDataURL('image/png').split(',')[1];
    }, [x, y, cw, ch]);
    writeFileSync(png, Buffer.from(b64, 'base64'));
  }
  console.log('shot', s.name);
}
writeFileSync(`${OUT}/counts.json`, JSON.stringify({ counts, shots: shots.map((s) => s.name) }, null, 1));
console.log(JSON.stringify(counts));
if (logs.length) console.log('page errors:', logs.slice(0, 6).join('\n'));
await browser.close();
