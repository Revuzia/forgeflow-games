import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome, randomGenome } from '../src/core/genome.ts';
import { meshVolume } from '../src/physics/shape.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
function run(label: string, both: boolean, g = makeStarterGenome()) {
  const b = new SoftBody(g);
  for (let i = 0; i < 120; i++) b.step(1 / 60);
  const mk = (sx: number) => { const o = v(sx * 3, 0.35, 0), d = v(-sx, 0, 0); const h = b.raycast(o, d)!; return { point: h.point, normal: h.normal, dir: d }; };
  b.fingerDown(0, mk(-1)); b.fingerDown(1, mk(1));
  b.fingerPressure(0, 1); b.fingerPressure(1, 1);
  for (let i = 0; i < 90; i++) b.step(1 / 60);
  const c0 = b.metrics.compression, w0 = Math.hypot(...[0]) ;
  const width = () => { let mn = 1e9, mx = -1e9; for (let i = 0; i < b.vertexCount; i++) { const x = b.positions[i * 3]; mn = Math.min(mn, x); mx = Math.max(mx, x); } return mx - mn; };
  const wBefore = width();
  b.fingerUp(0); if (both) b.fingerUp(1);
  let minW = 1e9, maxComp = 0, minVol = 9, maxSpeedP = 0, inv = false; let t = 0;
  let minWAt = 0;
  for (let s = 0; s < 360 * 0.3; s++) {
    b.step(1 / 360); t += 1 / 360;
    const w = width(); if (w < minW) { minW = w; minWAt = t; }
    maxComp = Math.max(maxComp, b.metrics.compression);
    minVol = Math.min(minVol, meshVolume(b.positions, b.indices) / 1 / (b.metrics.volume ? meshVolume(b.positions, b.indices) / b.metrics.volume : 1));
  }
  console.log(label.padEnd(34), 'width before', wBefore.toFixed(3), ' min width after lift', minW.toFixed(3), `@${(minWAt * 1000).toFixed(0)}ms`, ' comp before', c0.toFixed(2), 'max comp after', maxComp.toFixed(2), 'minVol', minVol.toFixed(3));
}
run('starter, release both', true);
run('starter, release one', false);
const g2 = makeStarterGenome();
run('soft/bouncy, release both', true, { ...g2, firmness: 0, bounce: 1 });
run('firm, release both', true, { ...g2, firmness: 1, bounce: 0.3 });
