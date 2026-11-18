// orch1 W2-A fix-1 scratch: where Ardit's top quarter comes from. Per material of his model: name, kind, emissive, and
// the top-25 % L* of his silhouette with each material shown alone lit vs the others hidden; crops saved.
//   VALE_URL=... python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_ardit.mjs --out dir [--fighter ardit]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, B } from './gfx_lib.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp'); mkdirSync(OUT, { recursive: true });
const FIGHTER = opt('fighter', 'ardit');
const { browser, page } = await openBench({ q: 'high', t: 4, mode: 'rift', seed: 7, extra: `&picks=${FIGHTER},burdam,dunsom,ervet,hesmi,ilsheta,kemdo,lisvel,marund,nurrow`, land: 1500 });
for (let i = 0; i < 120; i++) { if ((await B(page, (b) => b.renderer.lib?.pending ?? 0)) === 0) break; await page.waitForTimeout(1000); }
const r = await B(page, (b, F) => {
  b.frames(30, 1 / 30); const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; b.frames(6, 1 / 30);
  const e = b.entities('fighter').find((x) => x.def === F); const act = R.actors.get(e.id);
  b.focus(e.x, e.y); b.zoom(14); b.frames(4, 1e-4);
  const out = { mats: [] };
  act.root.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && o.material && !Array.isArray(o.material)) out.mats.push({ name: o.name, mat: o.material.name, type: o.material.type, vis: o.visible, emissive: o.material.emissive?.getHexString?.(), ei: o.material.emissiveIntensity, map: !!o.material.map, emap: !!o.material.emissiveMap, charMode: o.material.userData?.valeCharMode }); });
  const c = document.getElementById('c'); const mid = b.screen(e.x, e.y, 1.0);
  for (let i = 0; i < 3; i++) R.render(0);
  out.png = c.toDataURL('image/png').split(',')[1]; out.mid = mid;
  return out;
}, FIGHTER);
writeFileSync(join(OUT, `${FIGHTER}_z14.png`), Buffer.from(r.png, 'base64')); delete r.png;
console.log(JSON.stringify(r, null, 1));
await browser.close();
