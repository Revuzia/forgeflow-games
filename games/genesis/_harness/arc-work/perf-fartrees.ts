// PERF P2 bench: far-tree layer cost on a 40k-cell world (node .ts; arg: px per radian, default 536 = 888x500 High)
import { Vector3 } from 'three';
import { getGrid } from '../../src/sim/grid/icogrid.ts';
import { Noise3 } from '../../src/sim/grid/noise.ts';
import { GroundGradients } from '../../src/client/groundgrad.ts';
import { Vegetation } from '../../src/render/life/vegetation.ts';
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const SHARED = { uTime: { value: 0 }, uWindDir: { value: null }, uCamBody: { value: null }, uBodyToView: { value: null }, uSunDirBody: { value: null } } as never;
function world() {
  const grid = getGrid(64), n = grid.count, R = 3000, r = rng(11);
  const nz = new Noise3(4);
  const f = (gen: (c: number) => number) => Float32Array.from({ length: n }, (_, c) => gen(c));
  const P = grid.pos;
  const fields = new Map<string, Float32Array>();
  fields.set('tree', f((c) => Math.max(0, Math.min(1, 0.4 + nz.noise(P[c * 3] * 3, P[c * 3 + 1] * 3, P[c * 3 + 2] * 3) * 1.4))));
  fields.set('shrub', f(() => r() * 0.5)); fields.set('burnt', f(() => 0));
  fields.set('water', f(() => 0)); fields.set('temperature', f(() => 14)); fields.set('moisture', f(() => 0.6));
  fields.set('snow', f(() => 0)); fields.set('crop', f(() => 0)); fields.set('road', f(() => 0));
  fields.set('sand', f(() => 0)); fields.set('soil', f(() => 0.5)); fields.set('treeSpecies', f(() => -1)); fields.set('shrubSpecies', f(() => -1));
  fields.set('fire', f(() => 0));
  const surface = f((c) => 40 + 25 * Math.sin(P[c * 3] * 9) * Math.cos(P[c * 3 + 2] * 7));
  fields.set('surface', surface);
  const gg = new GroundGradients(grid);
  gg.update(surface, R);
  const noise = new Noise3(5);
  const pv = {
    grid, noise, params: { radius: R }, fields, fieldVersion: new Map([['surface', 1]]), groundRev: gg, maxSurface: 70,
    ground: { grid, radius: R, noise, surface, soil: fields.get('soil')!, sand: fields.get('sand')!, snow: fields.get('snow')!, grad: gg.grad },
  };
  return { pv, grid, n, R, fields };
}
const { pv, R } = world();
const v = new Vegetation(SHARED) as any;
v.pxPerRad = Number(process.argv[2] ?? 536);
let frame = 0;
const dir = new Vector3(0.3, 0.8, 0.52).normalize();
for (const alt of [2000, 1000, 500, 250, 100, 50]) {
  const cam = dir.clone().multiplyScalar(R + 60 + alt);
  let t = 0, maxMs = 0, fr = 0;
  for (let i = 0; i < 6000; i++) { const t0 = performance.now(); v.update(pv, cam, frame++); const dt = performance.now() - t0; t += dt; maxMs = Math.max(maxMs, dt); fr++; if (v.farStats.queue === 0 && i > 2) break; }
  let tris = 0; for (const b of v.far) if (b) tris += b.live * (b.mesh.geometry.index.count / 3);
  console.log(`alt ${alt}: frames ${fr} total ${t.toFixed(0)} ms max ${maxMs.toFixed(1)} | far inst ${v.farStats.instances} tris ${(tris / 1e6).toFixed(2)}M cells ${v.farStats.cells} blocks ${v.farStats.blocks} | near inst ${v.stats.instances}`);
  const t1 = performance.now(); for (let i = 0; i < 20; i++) v.update(pv, cam, frame++); console.log('   idle frame', ((performance.now() - t1) / 20).toFixed(2), 'ms');
}
// smooth flights (the per-frame cost a player feels): a fast descent 2000 -> 50 m in 240 frames, then a pan
{
  const v2 = new Vegetation(SHARED) as any;
  v2.pxPerRad = v.pxPerRad;
  let fr = 0;
  const at = (alt: number, pan: number) => dir.clone().add(new Vector3(0, 0, 1).cross(dir).normalize().multiplyScalar(pan)).normalize().multiplyScalar(R + 60 + alt);
  for (let i = 0; i < 2000; i++) { v2.update(pv, at(2000, 0), fr++); if (v2.farStats.queue === 0 && i > 2) break; }
  const run = (name: string, n: number, pose: (k: number) => Vector3) => {
    const ms: number[] = [];
    let fm = 0, rm = 0, rc = 0; for (let k = 0; k < n; k++) { v2.farStats.refreshMs = 0; const t0 = performance.now(); v2.update(pv, pose(k), fr++); ms.push(performance.now() - t0); fm = Math.max(fm, v2.farStats.ms); if (v2.farStats.refreshMs > rm) { rm = v2.farStats.refreshMs; rc = v2.farStats.refreshCells; } }
    console.log('  refresh max', rm.toFixed(1), 'ms over', rc, 'cells; grows', v2.farStats.grows);
    console.log("  far part max", fm.toFixed(1));
    ms.sort((a, b) => a - b);
    console.log(`${name}: frames ${n} p50 ${ms[n >> 1].toFixed(2)} p95 ${ms[Math.floor(n * 0.95)].toFixed(2)} max ${ms[n - 1].toFixed(1)} ms | far inst ${v2.farStats.instances} queue ${v2.farStats.queue}`);
  };
  run('descent 2000->50 in 240 f', 240, (k) => at(2000 * Math.pow(50 / 2000, k / 239), 0));
  run('pan at 50 m, 2 m/frame', 300, (k) => at(50, (k * 2) / R));
  run('climb 50->1500 in 240 f', 240, (k) => at(50 * Math.pow(1500 / 50, k / 239), 0.2));
}
