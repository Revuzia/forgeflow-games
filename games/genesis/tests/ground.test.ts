// GENESIS — the curved ground (src/sim/grid/surface.ts, CONTRACT §4.3): one surface for the sim, the CPU placement on
// the client and the terrain / water vertex shaders.
//
//   * the sim's Planet.ground() and the client WorldView derive identical curvature gradients from the same field
//   * a JS re-implementation of the GLSL in render/planet/terrainvert.glsl.ts (float32 arithmetic, reading the very
//     arrays FieldTextures uploads) matches groundOffset() to millimetres: feet, trees and picking meet the drawn ground
//   * the surface is continuous across sim-triangle edges (no cracks) and interpolates the cells exactly
//   * on a smooth analytic relief the curved surface is much closer to the truth than flat facets
//   * editing the terrain refreshes the sim's lazily cached gradients

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';
import { FieldTextures } from '../src/render/planet/fieldtex.ts';
import { getGrid, newHit } from '../src/sim/grid/icogrid.ts';
import { Noise3, detailNoise, duneNoise } from '../src/sim/grid/noise.ts';
import { CURVE_ALPHA, curvedSurface, duneAmpOf, groundOffset, surfaceGradients, type GroundSource } from '../src/sim/grid/surface.ts';
import { Rng } from '../src/sim/core/rng.ts';

const f32 = Math.fround;

function randomDir(rng: Rng): [number, number, number] {
  for (;;) {
    const x = rng.float() * 2 - 1, y = rng.float() * 2 - 1, z = rng.float() * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (l > 0.1 && l <= 1) return [x / l, y / l, z / l];
  }
}

/** the terrain vertex shader's ground (tGround + tG, no morph), in float32 like the GPU */
function shaderGround(A: Float32Array, G: Float32Array, D: Float32Array, cells: [number, number, number], wB: number, wC: number, dir: [number, number, number], detail: number, dune: number, radius: number): number {
  const wBf = f32(wB), wCf = f32(wC);
  const wAf = f32(f32(1 - wBf) - wCf);
  const w = [wAf, wBf, wCf];
  let ax = 0, ay = 0, bend = 0, da = 0;
  const dx = f32(dir[0]), dy = f32(dir[1]), dz = f32(dir[2]);
  for (let k = 0; k < 3; k++) {
    const c = cells[k];
    ax = f32(ax + f32(A[c * 4] * w[k]));
    ay = f32(ay + f32(A[c * 4 + 1] * w[k]));
    const d = f32(f32(f32(f32(G[c * 4] * dx) + f32(G[c * 4 + 1] * dy)) + f32(G[c * 4 + 2] * dz)) + G[c * 4 + 3]);
    bend = f32(bend + f32(d * w[k]));
    da = f32(da + f32(D[c * 4] * w[k]));
  }
  const surf = f32(ax + f32(f32(f32(CURVE_ALPHA) * f32(radius)) * bend));
  return f32(f32(surf + f32(f32(detail) * ay)) + f32(f32(dune) * da));
}

test('sim and client derive the same curved ground; the shader formula matches groundOffset', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 32 } });
  const p = sim.u.planets[0];
  const simGround = p.ground();
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planet(p.id)!;
  const cg = pv.ground.grad as Float32Array;
  const sg = simGround.grad as Float32Array;
  assert.equal(cg.length, p.count * 4);
  for (let i = 0; i < cg.length; i++) assert.equal(cg[i], sg[i], `gradient ${i} differs between sim and client`);

  const ft = new FieldTextures(pv);
  ft.update();
  const A = ft.tex.A.image.data as Float32Array;
  const G = ft.tex.G.image.data as Float32Array;
  const D = ft.tex.D.image.data as Float32Array;
  let dunes = 0;
  for (let c = 0; c < p.count; c++) if (D[c * 4] > 0) dunes++;
  assert.ok(dunes > 0, 'the test world has deep sand somewhere (the dune term is exercised)');
  const rng = new Rng(5);
  const hit = newHit();
  let worst = 0, worstSim = 0, maxBend = 0;
  for (let i = 0; i < 4000; i++) {
    const d = randomDir(rng);
    pv.grid.locate(d[0], d[1], d[2], hit);
    const detail = f32(detailNoise(pv.noise, d[0], d[1], d[2], pv.params.radius));
    const dune = f32(duneNoise(pv.noise, d[0], d[1], d[2], pv.params.radius));
    const gpu = shaderGround(A, G, D, [hit.a, hit.b, hit.c], hit.wb, hit.wc, d, detail, dune, pv.params.radius);
    const cpu = groundOffset(pv.ground, d[0], d[1], d[2]);
    const simH = groundOffset(simGround, d[0], d[1], d[2]);
    worst = Math.max(worst, Math.abs(gpu - cpu));
    worstSim = Math.max(worstSim, Math.abs(simH - cpu));
    const lin = pv.ground.surface[hit.a] * hit.wa + pv.ground.surface[hit.b] * hit.wb + pv.ground.surface[hit.c] * hit.wc;
    maxBend = Math.max(maxBend, Math.abs(curvedSurface(pv.ground, hit, d[0], d[1], d[2]) - lin));
  }
  assert.ok(worstSim < 1e-9, `sim vs client ground differ by ${worstSim} m`);
  assert.ok(worst < 5e-3, `shader formula vs CPU ground differ by up to ${worst.toFixed(5)} m`);
  // the curvature really is there (a generated world has hills), not a no-op
  assert.ok(maxBend > 0.5, `curved term too small (${maxBend} m)`);
});

test('the curved surface is continuous across triangle edges and passes through every cell', () => {
  const grid = getGrid(16);
  const R = 3000;
  const noise = new Noise3(3);
  const surface = new Float32Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    const x = grid.pos[c * 3], y = grid.pos[c * 3 + 1], z = grid.pos[c * 3 + 2];
    surface[c] = 180 * noise.fbm(x * 2.3, y * 2.3, z * 2.3, 4) + 40 * Math.sin(9 * x) * Math.cos(7 * z);
  }
  const zero = new Float32Array(grid.count);
  const src: GroundSource = { grid, radius: R, noise, surface, soil: zero, sand: zero, snow: zero, grad: surfaceGradients(grid, R, surface) };
  const hit = newHit();
  // through the cells
  for (let c = 0; c < grid.count; c += 7) {
    const x = grid.pos[c * 3], y = grid.pos[c * 3 + 1], z = grid.pos[c * 3 + 2];
    grid.locate(x, y, z, hit);
    assert.ok(Math.abs(curvedSurface(src, hit, x, y, z) - surface[c]) < 1e-3, `cell ${c} not interpolated`);
  }
  // across edges: points on either side of an edge midpoint, a hair apart, land in different triangles but agree
  let checked = 0, worst = 0;
  for (let c = 0; c < grid.count && checked < 600; c += 3) {
    for (let e = grid.nbrStart[c]; e < grid.nbrStart[c + 1]; e++) {
      const k = grid.nbr[e];
      const mx = grid.pos[c * 3] + grid.pos[k * 3], my = grid.pos[c * 3 + 1] + grid.pos[k * 3 + 1], mz = grid.pos[c * 3 + 2] + grid.pos[k * 3 + 2];
      // perpendicular to the edge in the tangent plane
      const ex = grid.pos[k * 3] - grid.pos[c * 3], ey = grid.pos[k * 3 + 1] - grid.pos[c * 3 + 1], ez = grid.pos[k * 3 + 2] - grid.pos[c * 3 + 2];
      let qx = my * ez - mz * ey, qy = mz * ex - mx * ez, qz = mx * ey - my * ex;
      const ql = Math.hypot(qx, qy, qz); qx /= ql; qy /= ql; qz /= ql;
      const ml = Math.hypot(mx, my, mz);
      const eps = 1e-7;
      const sample = (s: number): [number, number] => {
        let x = mx / ml + qx * s, y = my / ml + qy * s, z = mz / ml + qz * s;
        const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        grid.locate(x, y, z, hit);
        return [curvedSurface(src, hit, x, y, z), hit.a * 1e6 + hit.b * 1e3 + hit.c];
      };
      const [h1, t1] = sample(eps);
      const [h2, t2] = sample(-eps);
      if (t1 === t2) continue;
      worst = Math.max(worst, Math.abs(h1 - h2));
      checked++;
    }
  }
  assert.ok(checked > 300, `only ${checked} edges crossed`);
  assert.ok(worst < 1e-3, `crack of ${worst} m across an edge`);
});

test('on a smooth relief the curved ground beats flat facets', () => {
  const grid = getGrid(24);
  const R = 3000;
  const truth = (x: number, y: number, z: number) => 150 * Math.sin(5 * x + 1) * Math.cos(4 * y) + 60 * Math.sin(7 * z);
  const surface = new Float32Array(grid.count);
  for (let c = 0; c < grid.count; c++) surface[c] = truth(grid.pos[c * 3], grid.pos[c * 3 + 1], grid.pos[c * 3 + 2]);
  const zero = new Float32Array(grid.count);
  const src: GroundSource = { grid, radius: R, noise: new Noise3(1), surface, soil: zero, sand: zero, snow: zero, grad: surfaceGradients(grid, R, surface) };
  const rng = new Rng(9);
  const hit = newHit();
  let eLin = 0, eCurve = 0;
  for (let i = 0; i < 3000; i++) {
    const d = randomDir(rng);
    grid.locate(d[0], d[1], d[2], hit);
    const t = truth(d[0], d[1], d[2]);
    const lin = surface[hit.a] * hit.wa + surface[hit.b] * hit.wb + surface[hit.c] * hit.wc;
    eLin += (lin - t) ** 2;
    eCurve += (curvedSurface(src, hit, d[0], d[1], d[2]) - t) ** 2;
  }
  const rl = Math.sqrt(eLin / 3000), rc = Math.sqrt(eCurve / 3000);
  assert.ok(rc < rl * 0.6, `curved RMS ${rc.toFixed(3)} m vs linear ${rl.toFixed(3)} m`);
});

test('terrain edits refresh the sim ground (lazy gradients follow surface changes)', () => {
  const sim = new Sim({ seed: 4, scenario: 'barren', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  const pos: [number, number, number] = [0.3, 0.2, 0.93];
  const l = Math.hypot(...pos);
  const d: [number, number, number] = [pos[0] / l, pos[1] / l, pos[2] / l];
  const before = groundOffset(p.ground(), ...d);
  const g1 = p.ground().grad;
  const r = sim.applyNow({ k: 'terrain.raise', pos: d, radius: 400, strength: 60 });
  assert.ok(r.ok, r.msg);
  const src = p.ground();
  assert.notEqual(src.grad, null);
  const after = groundOffset(src, ...d);
  assert.ok(after > before + 5, `ground did not rise (${before} -> ${after})`);
  // the gradients were recomputed for the new surface
  const fresh = surfaceGradients(p.grid, p.st.radius, p.f.surface);
  const cached = src.grad as Float32Array;
  for (let i = 0; i < fresh.length; i++) assert.equal(cached[i], fresh[i]);
  assert.equal(g1, src.grad, 'the gradient buffer is reused, not reallocated');
});

test('dunes: continuous everywhere (antimeridian included), asymmetric (gentle stoss, steep lee), deep sand only', () => {
  const noise = new Noise3(7);
  const R = 3000;
  const at = (lat: number, lon: number) => duneNoise(noise, Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), R);
  let worst = 0;
  for (let lat = -1.2; lat <= 1.2; lat += 0.05) worst = Math.max(worst, Math.abs(at(lat, Math.PI - 1e-7) - at(lat, -Math.PI + 1e-7)));
  assert.ok(worst < 1e-3, `seam of ${worst} at the antimeridian`);
  // along the wind (east) the profile rises slowly and drops fast: more of the path climbs than falls
  let up = 0, down = 0;
  const lat = 0.3;
  for (let i = 0; i < 4000; i++) {
    const lon = 0.2 + i * 2e-5;
    const d = at(lat, lon + 1e-5) - at(lat, lon);
    if (d > 0) up++; else down++;
  }
  assert.ok(up > down * 1.8, `windward ${up} vs lee ${down} samples`);
  assert.equal(duneAmpOf(0.3), 0, 'no dunes on a thin beach');
  assert.ok(duneAmpOf(4) > 1, 'a sand sea builds dunes');
});
