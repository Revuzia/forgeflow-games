// VALE harness (lane GF): the SAME frames of one fighter under texture variants, swapped live IN ONE PAGE: same sim, same
// pose (dt 0 between variants), same build of the client, so edits other lanes make to the shared tree cannot enter the
// comparison. Real render bench, real Chrome GPU, game camera and Collection stage.
//
//   node _harness/gfx_fighter_ab.mjs burdam --tag gf1 --var g1=/path/burdam_g1.glb [--var g2=/path/b.glb] [--q high|ultra]
//        [--t 25] [--seed 7] [--poses 3] [--menu collection|none] [--zoom 28.5] [--eval "js for every variant"]
//
// A variant GLB gives its images by name (<sid>_orm, <sid>_normal, <sid>_base): every fighter material's map using a
// texture of that name takes a new Texture of the variant's bytes. The base GLB is variant `base`.
// Shots: _harness/_shots/gfx_<tag>_<fighter>_<q>_<variant>_{game<i>,menu}.png
// Report: _harness/_reports/gfx_<tag>_<fighter>_<q>.json (the fighter's screen position, renderer stats per variant)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const fighter = a[0];
const tag = opt('tag', 'a'), q = opt('q', 'high'), t = Number(opt('t', 25)), seed = opt('seed', '7');
const poses = Number(opt('poses', 3)), menu = opt('menu', 'collection'), zoomD = Number(opt('zoom', 28.5));
const vars = a.flatMap((x, i) => (x === '--var' ? [a[i + 1].split('=')] : []));

function glbImages(path) {
  const d = readFileSync(path);
  const jl = d.readUInt32LE(12), js = JSON.parse(d.subarray(20, 20 + jl).toString('utf8')), bo = 20 + jl + 8, out = {};
  for (const im of js.images) {
    const v = js.bufferViews[im.bufferView], o = bo + (v.byteOffset ?? 0);
    if (/_(orm|normal)$/.test(im.name)) out[im.name.replace(/^.*_(orm|normal)$/, '$1')] = d.subarray(o, o + v.byteLength).toString('base64');
  }
  return out;
}
const extra = [];
const payload = vars.map(([n, p]) => ({ n, imgs: glbImages(p) }));

/** in the page: bitmaps of every variant + the base textures; window.__gfSet(name) puts a variant on the fighter's materials */
const install = async (page, sceneExpr) => page.evaluate(async ([payload, fighter, sceneExpr]) => {
  const b = window.__VALE_BENCH__, scene = (0, eval)(`(b)=>${sceneExpr}`)(b);
  const slots = { orm: ['roughnessMap', 'metalnessMap', 'aoMap'], normal: ['normalMap'] };
  const mats = new Set();
  scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.roughnessMap && m.roughnessMap.name?.startsWith(fighter)) mats.add(m); });
  window.__gfMats = mats;
  const base = new Map();
  for (const m of mats) base.set(m, { roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap, aoMap: m.aoMap, normalMap: m.normalMap });
  const lib = {};
  for (const v of payload) {
    lib[v.n] = {};
    for (const [k, s] of Object.entries(v.imgs)) {
      const blob = await (await fetch(`data:image/webp;base64,${s}`)).blob();
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const any = [...mats][0];
      const old = k === 'orm' ? any.roughnessMap : any.normalMap;
      const tx = old.clone();
      tx.source = new old.source.constructor(bmp);
      tx.needsUpdate = true;
      lib[v.n][k] = tx;
    }
  }
  window.__gfSet = (name) => {
    const dm = /^(.*)\+d([\d.]+)(?:t(\d+))?$/.exec(name);       // variant `x+d0.5t60`: variant x with GF-2 strength 0.5, tile 60
    if (window.__valeDetailU) window.__valeDetailU.valeDetail.value.set(dm ? Number(dm[2]) : 0, dm && dm[3] ? Number(dm[3]) : 60);
    if (dm) name = dm[1];
    for (const m of mats) {
      const bs = base.get(m);
      for (const [k, ss] of Object.entries(slots)) for (const sl of ss) m[sl] = (name !== 'base' && lib[name]?.[k]) || bs[sl];
    }
  };
  return mats.size;
}, [payload, fighter, sceneExpr]);

for (const x of a.flatMap((x, i) => (x === '--names' ? a[i + 1].split(',') : []))) extra.push(x);
const out = { fighter, tag, q, t, seed, zoom: zoomD, variants: ['base', ...vars.map((v) => v[0]), ...extra], frames: [], menu: null };
const names = out.variants;
{
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${q}&t=${t}&seed=${seed}&dev=1&hud=0&manual=1&you=${fighter}`, { wait: false, hmr: false });
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__.error);
  if (err) { console.error('bench error:', err); process.exit(1); }
  const B = (fn, x) => page.evaluate(([src, v]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, v), [fn.toString(), x]);
  await B((b) => b.frames(2, 1 / 30));
  await page.waitForTimeout(9000);
  await B((b) => b.frames(60, 1 / 30));
  const n = await install(page, 'b.renderer.scene');
  console.log('fighter materials', n);
  const me = await B((b) => b.you());
  for (let i = 0; i < poses; i++) {
    await B((b, [id, z]) => { b.zoom(z); b.frames(30, 1 / 30); b.focusEntity(id); b.frames(12, 1 / 30); }, [me.id, zoomD]);
    const sp = await B((b) => { const e = b.you(); return { e, s: b.screen(e.x, e.y, 1) }; });
    const stats = {};
    for (const v of names) {
      await B((b, v) => { window.__gfSet(v); b.frames(1, 0); b.frames(1, 0); }, v);
      await shot(page, `gfx_${tag}_${fighter}_${q}_${v.replace("+", "_")}_game${i}`);
      const s = await B((b) => { const s = b.stats(); return { tris: s.triangles, calls: s.calls, programs: s.programs, textures: s.textures }; });
      stats[v] = s;
    }
    await B((b) => { window.__gfSet('base'); });
    out.frames.push({ i, game: sp.s, you: sp.e, stats });
    await B((b) => b.frames(40, 1 / 30));
  }
  const errs = logs.filter((l) => /error/i.test(l) && !/404|Failed to load resource/.test(l));
  if (errs.length) console.log(errs.slice(0, 6).join('\n'));
  await browser.close();
}
if (menu !== 'none') {
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?q=${q}&dev=1&hud=0&menu=${menu}&fighter=${fighter}`, { wait: false, hmr: false });
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(14000);
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });     // the live loop stops: one pose for every variant
  await page.waitForTimeout(300);
  const n = await install(page, 'b.renderer.menu.scene');
  console.log('menu fighter materials', n);
  for (const v of names) {
    await page.evaluate((v) => { window.__gfSet(v); const r = window.__VALE_BENCH__.renderer; r.menu.idle = 0; r.render(0); r.menu.idle = 0; r.render(0); }, v);
    await shot(page, `gfx_${tag}_${fighter}_${q}_${v.replace("+", "_")}_menu`);
  }
  const errs = logs.filter((l) => /error/i.test(l) && !/404|Failed to load resource/.test(l));
  if (errs.length) console.log(errs.slice(0, 6).join('\n'));
  await browser.close();
}
mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', `gfx_${tag}_${fighter}_${q}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.frames.map((f) => [f.game, f.stats])).slice(0, 400));
