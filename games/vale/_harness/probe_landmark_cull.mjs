// VALE harness — landmark / caster box cull A/B (W5a refix handoff, engine-11). The real renderer (render bench, real
// Chrome GPU, heavy slot), manual frames, at the gameplay camera over named spots. At every spot the same frame twice:
//   A  sphere: three's bounding-sphere test for the landmarks' main and shadow pass, the caster cull's sphere + swept
//      shadow sphere (terrain.ts landmarkCull.box = false: the cull as it was)
//   B  box: the world box's 8 corners for the landmarks' main and shadow pass, the caster cull's shadow-volume hull
// and reports, from renderer.profile() (every pass, the frame's own counters): the landmarks' main-pass and shadow
// draws / triangles, the frame's totals, and the pixels that differ between A and B (the box cull is conservative:
// it must not change a pixel). A third frame, A2 (sphere again), is the noise floor: the needlegrass, the canopy's
// sway and the ambient motes move between captures however small the step. `px24` counts the pixels past 24 levels,
// `blob` those with ≥ 3 of their 8 neighbours past 24 too (a landmark or a shadow that went missing is a solid patch;
// the floor's flicker is single pixels); gate: blob(A, B) = 0. Per landmark mesh it also lists the ones each test
// keeps for the main pass (`main`) and casts (`cast`), so a module drawn with no pixel on screen is named.
//
//   node _harness/probe_landmark_cull.mjs [--map rift] [--q high] [--tag integ_engine] [--spots name:x,y;…] [--shots 1]
//   → _harness/_reports/<tag>_landmark_cull_<map>.json, shots _harness/_shots/<tag>_lmcull_<map>_<spot>_{A,B}.png
// Done (engine-11): at RIFT's low-road fight (101.52, 95.6) the south skirt modules draw 0 main-pass triangles with B,
// the landmarks' shadow triangles fall, and no spot changes a solid patch of pixels (blob = 0).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAP = opt('map', 'rift'), Q = opt('q', 'high'), TAG = opt('tag', 'integ_engine'), SHOTS = opt('shots', '1') === '1';
const DEFAULT_SPOTS = {
  rift: 'fight_low:101.52,95.6;s_edge:85,110;s_edge_w:40,110;s_edge_e:130,110;sw_corner:0,110;se_corner:170,110;nw_corner:0,0;ne_corner:170,0;n_edge:85,0;high_road:85,11.5;w_edge:0,55;e_edge:170,55;centre:85,55;sunsplinter:85,78',
  bridge: 'w_end:8,22;e_end:148,22;mid:78,22;n_edge:78,0;s_edge:78,44',
  fray: 'centre:40,40;nw:0,0;se:80,80',
};
const spots = Object.fromEntries((opt('spots', DEFAULT_SPOTS[MAP] ?? 'centre:85,55')).split(';').map((s) => {
  const [k, v] = s.split(':'); return [k, v.split(',').map(Number)];
}));
const REPS = join(HERE, '_reports'), SH = join(HERE, '_shots');
mkdirSync(REPS, { recursive: true }); mkdirSync(SH, { recursive: true });

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MAP}&q=${Q}&t=20&seed=7&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const report = { at: new Date().toISOString(), map: MAP, q: Q, spots: {}, pass: true, fails: [] };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  await B((b) => b.frames(30, 1 / 30));
  await page.waitForTimeout(8000);                                       // async landmarks / props land in real time
  await B((b) => b.frames(10, 1 / 30));
  report.landmarks = await B((b) => {
    const R = b.renderer, out = {};
    const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
    const named = new Map((m.art.terrain?.landmarks ?? []).filter((l) => typeof l.model === 'string').map((l) => [`${(+l.at[0]).toFixed(1)},${(+l.at[1]).toFixed(1)}`, l.model.replace(/^.*\//, '').replace(/\.glb$/, '')]));
    for (const o of R.terrain.group.children) {
      if (o.name.startsWith('vale_')) continue;
      let tris = 0, meshes = 0;
      o.traverse((c) => { if (c.isMesh && c.geometry) { meshes++; const g = c.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
      const k = named.get(`${o.position.x.toFixed(1)},${o.position.z.toFixed(1)}`) ?? (o.name || o.type);
      (out[k] ??= { n: 0, tris, meshes }).n++;
    }
    return out;
  });
  for (const [name, at] of Object.entries(spots)) {
    const row = {};
    for (const mode of ['A', 'B', 'A2']) {
      const r = await page.evaluate(async ([at, box]) => {
        const b = window.__VALE_BENCH__, R = b.renderer;
        R.landmarkCull.box = box;
        b.focus(at[0] + 0.37, at[1]); b.frames(2, 1e-4);                 // a new view version: the caster cull re-runs
        b.focus(at[0], at[1]); b.frames(12, 1e-4);
        const pending = R.profile();
        b.frames(1, 1e-4);
        const p = await pending;
        const g = p.groups.landmarks ?? { calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 };
        // which landmark meshes each test keeps for the main pass, and which cast
        const cam = R.rig.camera;
        const F = new (R.cullView.frustum.constructor)();
        const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
        F.setFromProjectionMatrix(M);
        const main = [], cast = [];
        const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
        const named = new Map((m.art.terrain?.landmarks ?? []).filter((l) => typeof l.model === 'string').map((l) => [`${(+l.at[0]).toFixed(1)},${(+l.at[1]).toFixed(1)}`, l.model.replace(/^.*\//, '').replace(/\.glb$/, '')]));
        for (const o of R.terrain.group.children) {
          if (o.name.startsWith('vale_')) continue;
          const xy = `${o.position.x.toFixed(1)},${o.position.z.toFixed(1)}`;
          o.traverse((c) => {
            if (!c.isMesh) return;
            const tag = `${named.get(xy) ?? o.name ?? '?'}@${xy}`;
            const sph = F.intersectsObject(c), kept = c.intersectsFrustum(F);
            const t = (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
            if (sph || kept) main.push({ m: tag, tris: t, sphere: sph, box: kept });
            if (c.castShadow) cast.push(tag);
          });
        }
        return { lm: g, total: p.total, main, cast };
      }, [at, mode === 'B']);
      if (mode === 'A2') delete r.main;
      if (SHOTS) r.shot = await shot(page, `${TAG}_lmcull_${MAP}_${name}_${mode}`);
      row[mode] = r;
    }
    if (SHOTS) {
      const [a, bb, a2] = await Promise.all([row.A.shot, row.B.shot, row.A2.shot].map((p) => sharp(p).raw().toBuffer({ resolveWithObject: true })));
      const cmp = (x, y) => {
        const W = x.info.width, H = x.info.height, C = x.info.channels, on = new Uint8Array(W * H);
        let max = 0, n24 = 0, n8 = 0, blob = 0;
        for (let i = 0, k = 0; i < x.data.length; i += C, k++) {
          const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
          if (d > max) max = d;
          if (d > 24) { n24++; on[k] = 1; }
          if (d > 8) n8++;
        }
        for (let py = 1; py < H - 1; py++) for (let px = 1; px < W - 1; px++) {
          if (!on[py * W + px]) continue;
          let nb = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && on[(py + dy) * W + px + dx]) nb++;
          if (nb >= 3) blob++;
        }
        return { max, px24: n24, px8: n8, blob };
      };
      row.diff = cmp(a, bb);
      row.floor = cmp(a, a2);
      if (row.diff.blob > 0) { report.pass = false; report.fails.push(`${name}: ${row.diff.blob} px in solid patches differ between sphere and box cull (floor ${row.floor.blob})`); }
    }
    const A = row.A, Bm = row.B;
    row.summary = {
      at, lmMainTris: [A.lm.tris, Bm.lm.tris], lmMainCalls: [A.lm.calls, Bm.lm.calls], lmShadowTris: [A.lm.shadowTris, Bm.lm.shadowTris],
      lmShadowCalls: [A.lm.shadowCalls, Bm.lm.shadowCalls], frameTris: [A.total.tris, Bm.total.tris], frameCalls: [A.total.calls, Bm.total.calls],
      sphereOnly: Bm.main.filter((m) => m.sphere && !m.box).map((m) => `${m.m} (${m.tris})`), diff: row.diff ?? null, floor: row.floor ?? null,
    };
    report.spots[name] = row;
    const s = row.summary;
    console.log(`${MAP} ${Q} ${name.padEnd(10)} lm main ${s.lmMainTris[0]} -> ${s.lmMainTris[1]} tris (${s.lmMainCalls[0]} -> ${s.lmMainCalls[1]} draws)  lm shadow ${s.lmShadowTris[0]} -> ${s.lmShadowTris[1]} (${s.lmShadowCalls[0]} -> ${s.lmShadowCalls[1]})  frame ${s.frameTris[0]} -> ${s.frameTris[1]} tris, ${s.frameCalls[0]} -> ${s.frameCalls[1]} draws  diff ${row.diff ? `max ${row.diff.max}, >24: ${row.diff.px24}, blob ${row.diff.blob} (floor A/A2: >24 ${row.floor.px24}, blob ${row.floor.blob})` : '-'}`);
    if (s.sphereOnly.length) console.log(`           kept by the sphere only: ${s.sphereOnly.join(', ')}`);
  }
  await B((b) => { b.renderer.landmarkCull.box = true; });
} catch (e) {
  report.pass = false; report.fails.push(String(e?.stack ?? e));
  console.log('ERROR', e);
} finally {
  report.logs = logs.slice(0, 20);
  const out = join(REPS, `${TAG}_landmark_cull_${MAP}.json`);
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`console: ${logs.length} warning(s) / error(s)${logs.length ? ': ' + logs.slice(0, 3).join(' · ') : ''}`);
  console.log(`landmark_cull: ${report.pass ? 'PASS' : `FAIL (${report.fails.length})`} → ${out}`);
  await browser.close();
}
process.exit(report.pass ? 0 : 1);
