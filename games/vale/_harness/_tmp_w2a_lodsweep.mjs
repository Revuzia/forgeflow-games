// orch1 W2-A scratch: what the face-locked LOD2 reaches per fighter (triangles of LOD1 -> LOD2) for a few bounds, and how
// much of the LOD1 the head lock pins. All 16 fighters (two RIFT benches at t 4), dev server only (imports lod.ts live).
//   VALE_URL=... python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_lodsweep.mjs
import { openBench, B } from './gfx_lib.mjs';
const FIGHTERS = ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil'];
const CFGS = [['e30', { ratio: 0.5, errorM: 0.03 }], ['e45', { ratio: 0.5, errorM: 0.045 }], ['e60', { ratio: 0.5, errorM: 0.06 }], ['e45n', { ratio: 0.5, errorM: 0.045, normalW: 0.25, uvW: 30 }], ['e30u', { ratio: 0.5, errorM: 0.03, uvW: 20 }]];
const rows = [];
for (const half of [0, 1]) {
  const seats = half === 0 ? FIGHTERS.slice(0, 10) : FIGHTERS.slice(6, 16);
  const { browser, page } = await openBench({ q: 'high', t: 4, mode: 'rift', seed: 7, extra: `&picks=${seats.join(',')}`, land: 1500 });
  try {
    for (let i = 0; i < 120; i++) { if ((await B(page, (b) => b.renderer.lib?.pending ?? 0)) === 0) break; await page.waitForTimeout(1000); }
    const r = await B(page, async (b, cfgs) => {
      const L = await import('/src/render/lod.ts');
      const out = [];
      for (const a of b.renderer.actors.values()) {
        if (a.view?.kind !== 'fighter' || !a.model) continue;
        let m = null; a.model.traverse((o) => { if (!m && o.isSkinnedMesh && /vale_body_lod/.test(o.geometry.name)) m = o; });
        if (!m) continue;
        const was = m.geometry; a.setBodyLevel(1); const g1 = m.geometry;
        const head = m.skeleton.bones.findIndex((x) => x.name === 'head');
        const SI = g1.getAttribute('skinIndex'), SW = g1.getAttribute('skinWeight');
        const used = new Set(g1.index.array); let locked = 0;
        for (const v of used) { let hw = 0; for (let k = 0; k < 4; k++) if (SI.getComponent(v, k) === head) hw += SW.getComponent(v, k); if (hw >= 0.5) locked++; }
        let headTris = 0; const I = g1.index.array;
        for (let t = 0; t < I.length; t += 3) { let all = true; for (let k = 0; k < 3; k++) { const v = I[t + k]; let hw = 0; for (let q = 0; q < 4; q++) if (SI.getComponent(v, q) === head) hw += SW.getComponent(v, q); if (hw < 0.5) all = false; } if (all) headTris++; }
        const row = { def: a.view.def, lod1: I.length / 3, headTris };
        for (const [name, c] of cfgs) {
          const r = L.faceLockedLod(m, { ...L.LOD.body2, ...c });
          row[name] = r ? r.lodTris : null;
        }
        m.geometry = was;
        out.push(row);
      }
      return out;
    }, CFGS);
    for (const x of r) if (!rows.find((y) => y.def === x.def)) rows.push(x);
  } finally { await browser.close(); }
}
for (const r of rows) console.log(JSON.stringify(r));
const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? r.lod1), 0);
console.log('total lod1', sum('lod1'), 'head', sum('headTris'), CFGS.map(([n]) => `${n} ${sum(n)}`).join(' '));
