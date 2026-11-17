// orch1 W2-A scratch: character light and body LOD A/B frames. One page, seed, match time and camera spot drawn with
// the character light as on HEAD 21a6b2b56 (`before`: fill floor 0, crown x1, Fresnel power 2.5, fill x1) and as set
// now (`after`: lighting.ts CHAR_LIGHT), and at the fight the body LOD with every other fighter on LOD1 (`lod1`) vs as
// the renderer picks (`lod2`), plus 2x crops of the fight. Spectator, fog off (every fighter of both teams on screen).
//   VALE_URL=... python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_charab.mjs [--mode rift] [--t 481] [--seed 7] [--out dir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MODE = opt('mode', 'rift'), T = Number(opt('t', 481)), SEED = Number(opt('seed', 7));
const OUT = opt('out', join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'w2-a', 'charlight'));
mkdirSync(OUT, { recursive: true });
const m = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', `map_${MODE}.json`), 'utf8'));
const s = await openBench({ q: 'high', seed: SEED, mode: MODE, t: 10, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
const page = s.page;
await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; }, T);
// the local seat dead greys the frame (the death grade): step on until it is alive (at most 40 s of match)
const T0 = await B(page, (b) => { for (let i = 0; i < 20 && b.you() && !b.you().alive; i++) { b.ff(2); b.frames(2, 1 / 30); } return +b.time().toFixed(1); });
for (let i = 0; i < 60; i++) { if ((await B(page, (b) => b.renderer.lib?.pending ?? 0)) === 0) break; await page.waitForTimeout(1000); }
await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
const S = [];
const fight = await B(page, (b) => b.fight());
if (fight) S.push(['fight', [fight.x, fight.y]]);
if (m.lanes?.length) { const p = m.lanes[Math.min(1, m.lanes.length - 1)].path; S.push(['lane', p[Math.floor(p.length * 0.3)]]); }
const grab = async (file, crop) => {
  const b64 = await page.evaluate((c) => {
    const cv = document.getElementById('c');
    if (!c) return cv.toDataURL('image/png').split(',')[1];
    const o = document.createElement('canvas'); o.width = c.w * 2; o.height = c.h * 2;
    const x = o.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(cv, c.x, c.y, c.w, c.h, 0, 0, c.w * 2, c.h * 2);
    return o.toDataURL('image/png').split(',')[1];
  }, crop ?? null);
  writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
};
// HEAD's character light, read once from the uniforms the build sets, then put back
const setLight = (tag) => B(page, (b, tag) => {
  const R = b.renderer, U = R.w2a.uniforms;
  R.w2a.apply();
  if (!R.__w2aNow) R.__w2aNow = { rim: U.valeCharRim.value.clone(), fill: U.valeCharFill.value.clone(), ao: U.valeCharAo.value.clone(), head: R.__w2aHead };
  const n = R.__w2aNow, H = window.__W2A_HEAD__;
  if (tag === 'before') {
    U.valeCharCrown.value.set(1, H.pow);
    U.valeCharFill.value.copy(n.fill).multiplyScalar(H.fillLum / n.fillLum);
    U.valeCharAo.value.set(n.ao.x, n.ao.y, n.ao.z, 0);
  }
  for (let i = 0; i < 4; i++) R.render(0);
}, tag);
// HEAD 21a6b2b56 lighting.ts CHAR_LIGHT: crown luminance 3.4, power 2.5; fill luminance 0.7; no fill floor
await page.evaluate(() => { window.__W2A_HEAD__ = { crownLum: 3.4, pow: 2.5, fillLum: 0.7 }; });
await B(page, (b) => {
  const R = b.renderer, U = R.w2a.uniforms; R.w2a.apply();
  const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
  R.__w2aNow = { rim: U.valeCharRim.value.clone(), fill: U.valeCharFill.value.clone(), ao: U.valeCharAo.value.clone(), lum: lum(U.valeCharRim.value), fillLum: 0.2126 * U.valeCharFill.value.r + 0.7152 * U.valeCharFill.value.g + 0.0722 * U.valeCharFill.value.b };
});
const rec = { mode: MODE, t: T, tShot: T0, seed: SEED, spots: [] };
for (const [name, [x, y]] of S) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(10, 1 / 30); b.focus(p[0], p[1]); b.frames(1, 1e-4); }, [x, y]);
  const crop = await B(page, (b, p) => { const c = b.screen(p[0], p[1], 1); return { x: Math.max(0, Math.round(c.x - 480)), y: Math.max(0, Math.round(c.y - 300)), w: 960, h: 540 }; }, [x, y]);
  for (const tag of ['before', 'after']) {
    await setLight(tag);
    await grab(`${MODE}_${name}_light_${tag}.png`);
    if (name === 'fight') await grab(`${MODE}_${name}_light_${tag}_crop2x.png`, crop);
  }
  if (name === 'fight') {
    for (const tag of ['lod1', 'lod2']) {
      const drawn = await B(page, (b, on) => { const R = b.renderer; R.lod2Switch.on = on; for (let i = 0; i < 4; i++) R.render(0); return R.lod2Switch.drawn; }, tag === 'lod2');
      await grab(`${MODE}_${name}_${tag}_crop2x.png`, crop);
      rec[tag] = { drawn };
    }
    // the same fight pulled out to 45 m: more fighters far, LOD2 on most
    await B(page, (b) => { b.zoom(45); b.frames(2, 1e-4); });
    for (const tag of ['lod1', 'lod2']) {
      const drawn = await B(page, (b, on) => { const R = b.renderer; R.lod2Switch.on = on; for (let i = 0; i < 4; i++) R.render(0); return R.lod2Switch.drawn; }, tag === 'lod2');
      await grab(`${MODE}_${name}_z45_${tag}.png`);
      rec[`z45_${tag}`] = { drawn };
    }
    await B(page, (b) => b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map)?.camera?.distance ?? 31));
  }
  rec.spots.push({ name, world: [x, y], crop });
}
writeFileSync(join(OUT, `${MODE}_charab.json`), JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec), 'errors', s.logs.slice(0, 5));
await s.browser.close();
