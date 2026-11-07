// VALE harness — lane GE: dump the static world round the ground from the real client (walls, rock stacks, landmarks,
// boulders and stones, structures) as raw world-space triangles, so art/blender/maps/ground_contact.py bakes the ground's
// contact shade from exactly what the game draws (terrain.ts places its scatter procedurally: the map JSON does not know it).
//
//   node _harness/gfx_ge_dump_static.mjs --map rift --out /path/map_rift_static.bin      (float32 x y z per vertex, z up: Blender)
//
// Trees, grass, ground clutter, water, mist and units are left out: they hang over or lie flat on the ground and would only
// muddy a contact shade. Triangles wholly above 5 m are dropped (nothing up there touches the ground).

import { writeFileSync } from 'node:fs';
import { open } from './pw.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAP = opt('map', 'rift'), OUT = opt('out', `/tmp/map_${MAP}_static.bin`), LIST = opt('list', '0') === '1';

const { browser, page } = await open(`/_harness/web/render_bench.html?mode=${MAP}&q=high&t=5&seed=7&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 240000 });
  await page.evaluate(() => window.__VALE_BENCH__.frames(60, 1 / 30));
  await page.waitForTimeout(12000);
  await page.evaluate(() => window.__VALE_BENCH__.frames(6, 1 / 30));
  const res = await page.evaluate((list) => {
    const R = window.__VALE_BENCH__.renderer;
    const names = {}, out = [];
        const pathOf = (o) => { const p = []; for (let q = o; q; q = q.parent) if (q.name) p.push(q.name); return p.join('<'); };
    const e = new Float32Array(3);
    const xf = (m, x, y, z) => { const a = m.elements, w = 1; e[0] = a[0] * x + a[4] * y + a[8] * z + a[12] * w; e[1] = a[1] * x + a[5] * y + a[9] * z + a[13] * w; e[2] = a[2] * x + a[6] * y + a[10] * z + a[14] * w; return e; };
    const Mat = R.scene.matrixWorld.constructor;
    const push = (g, world) => {
      const pos = g.getAttribute('position'), idx = g.index, n = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < n; t += 3) {
        const v = [];
        let low = false;
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(t + k) : t + k;
          const w = xf(world, pos.getX(i), pos.getY(i), pos.getZ(i));
          v.push(w[0], w[1], w[2]);
          if (w[1] < 5) low = true;
        }
        if (low) for (let k = 0; k < 3; k++) out.push(v[k * 3], -v[k * 3 + 2], v[k * 3 + 1]);   // three y up -> Blender z up (x, -z, y)
      }
    };
    // the view culls cliffs, landmarks and scatter by cell: walk the map on a grid and take each mesh and instance once
    const seen = new Set(), bench = window.__VALE_BENCH__;
    const [SX, SY] = bench.catalog.maps.find((x) => x.id === bench.host.setup.map).size;
    const take = /^vale_cliffs$|^vale_rock|^vale_stone|^vale_boulder|_body$|needle_bell_.*_base$|needle_.*_base$|dome_.*_base$/i;
    const drop = /trees|clutter|ambient|rig$|vale_outline|skin|glow/i;
    const y = new Mat(), wm = new Mat();
    for (let gy = 0; gy <= SY; gy += 12) for (let gx = 0; gx <= SX; gx += 12) {
      bench.focus(gx, gy); bench.zoom(33); R.render(1 / 60);
      R.scene.updateMatrixWorld(true);
      R.scene.traverse((o) => {
        if (!o.isMesh) return;
        const path = pathOf(o), mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const key = (o.name || 'anon') + (o.isInstancedMesh ? ' [inst]' : '');
        names[key] = Math.max(names[key] ?? 0, o.isInstancedMesh ? o.count : 1);
        if (list || !take.test(o.name || '') || drop.test(path) || mat?.transparent) return;
        if (o.isInstancedMesh) {
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, y);
            const a = y.elements, k = o.geometry.uuid + ':' + [a[12], a[13], a[14]].map((v) => v.toFixed(2)).join(',');
            if (seen.has(k)) continue;
            seen.add(k); wm.multiplyMatrices(o.matrixWorld, y); push(o.geometry, wm);
          }
        } else if (!seen.has(o.uuid) && o.visible) { seen.add(o.uuid); push(o.geometry, o.matrixWorld); }
      });
    }
    if (list) return { names };
    const f = Float32Array.from(out), b = new Uint8Array(f.buffer);
    let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
    return { names, n: f.length / 9, b64: btoa(s), size: window.__VALE_BENCH__.catalog.maps.find((x) => x.id === window.__VALE_BENCH__.host.setup.map).size };
  }, LIST);
  console.log(JSON.stringify(res.names, null, 0).slice(0, 4000));
  if (!LIST) { writeFileSync(OUT, Buffer.from(res.b64, 'base64')); console.log('tris', res.n, 'map size', res.size, '->', OUT); }
} finally {
  await browser.close();
}
