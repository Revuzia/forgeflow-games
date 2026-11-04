// macfix smooth: FieldTextures' per-frame work. (1) the change check is allocation-free and still uploads exactly the
// textures whose sources changed; (2) the surge slope (W) with its cached grid geometry equals the direct computation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';
import { FieldTextures } from '../src/render/planet/fieldtex.ts';

function setup() {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 32 } });
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planet(sim.u.planets[0].id)!;
  return { pv, ft: new FieldTextures(pv) };
}

test('fieldtex: only textures whose sources changed are refilled', () => {
  const { pv, ft } = setup();
  ft.update();
  const vers = () => Object.fromEntries(Object.entries(ft.tex).map(([k, t]) => [k, t.version]));
  const v0 = vers();
  ft.update();
  assert.deepEqual(vers(), v0, 'nothing changed: no texture is re-uploaded');
  pv.fieldVersion.set('grass', (pv.fieldVersion.get('grass') ?? 0) + 1);
  ft.update();
  const v1 = vers();
  for (const k of Object.keys(v0)) assert.equal(v1[k] !== v0[k], k === 'V', `grass changed: ${k} ${k === 'V' ? 'refilled' : 'untouched'}`);
  pv.fieldVersion.set('water', (pv.fieldVersion.get('water') ?? 0) + 1);
  ft.update();
  const v2 = vers();
  for (const k of Object.keys(v0)) assert.equal(v2[k] !== v1[k], k === 'A' || k === 'W', `water changed: ${k}`);
});

test('fieldtex: W (surge slope) from the cached geometry equals the direct least-squares', () => {
  const { pv, ft } = setup();
  ft.update();
  const g = pv.grid, R = pv.params.radius, P = g.pos, n = g.count;
  const s = pv.fields.get('surface')!;
  const wl = ft.waterLevel, wd = ft.waterDepth;
  const W = ft.tex.W.image.data as Float32Array;
  let wet = 0;
  for (let c = 0; c < n; c++) {
    let ex = 0, gx = 0, gy = 0, gz = 0;
    if (wd[c] > 0.02) {
      const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
      let ax = 1, ay = 0; const az = 0;
      if (Math.abs(px) > 0.8) { ax = 0; ay = 1; }
      let t1x = py * az - pz * ay, t1y = pz * ax - px * az, t1z = px * ay - py * ax;
      const l1 = Math.hypot(t1x, t1y, t1z); t1x /= l1; t1y /= l1; t1z /= l1;
      const t2x = py * t1z - pz * t1y, t2y = pz * t1x - px * t1z, t2z = px * t1y - py * t1x;
      let sxx = 0, sxy = 0, syy = 0, sxw = 0, syw = 0, sxb = 0, syb = 0, k = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (wd[o] <= 0.02) continue;
        const dx0 = (P[o * 3] - px) * R, dy0 = (P[o * 3 + 1] - py) * R, dz0 = (P[o * 3 + 2] - pz) * R;
        const u = dx0 * t1x + dy0 * t1y + dz0 * t1z, v = dx0 * t2x + dy0 * t2y + dz0 * t2z;
        const dw = wl[o] - wl[c], db = s[o] - s[c];
        sxx += u * u; sxy += u * v; syy += v * v; sxw += u * dw; syw += v * dw; sxb += u * db; syb += v * db; k++;
      }
      const det = sxx * syy - sxy * sxy;
      if (k >= 3 && det > 1e-9 * (sxx * syy + 1e-9)) {
        wet++;
        const gwu = (syy * sxw - sxy * syw) / det, gwv = (sxx * syw - sxy * sxw) / det;
        const gbu = (syy * sxb - sxy * syb) / det, gbv = (sxx * syb - sxy * sxb) / det;
        const gw = Math.hypot(gwu, gwv);
        ex = gw > 1e-6 ? gw - Math.max(0, gwu * gbu + gwv * gbv) / gw : 0;
        gx = gwu * t1x + gwv * t2x; gy = gwu * t1y + gwv * t2y; gz = gwu * t1z + gwv * t2z;
      }
    }
    assert.deepEqual([W[c * 4], W[c * 4 + 1], W[c * 4 + 2], W[c * 4 + 3]], [Math.fround(ex), Math.fround(gx), Math.fround(gy), Math.fround(gz)], `cell ${c}`);
  }
  assert.ok(wet > 50, 'the test world has wet cells');
});
