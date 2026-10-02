import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
const b = new SoftBody(makeStarterGenome());
for (let i = 0; i < 120; i++) b.step(1 / 60);
const R = b.restRadius;
// pinch from left and right on the flanks
const mk = (sx: number) => { const o = v(sx * 3, 0.35, 0), d = v(-sx, 0, 0); const h = b.raycast(o, d)!; return { point: h.point, normal: h.normal, dir: d }; };
b.fingerDown(0, mk(-1)); b.fingerDown(1, mk(1));
b.fingerPressure(0, 1); b.fingerPressure(1, 1);
for (let i = 0; i < 90; i++) b.step(1 / 60);
const dist = (id: 0 | 1) => { const t = b.tip!(id)!; return t; };
const a0 = dist(0), b0 = dist(1);
console.log('before lift tip0', a0.x.toFixed(3), 'tip1', b0.x.toFixed(3), 'depth', a0.depth.toFixed(2), 'R', R.toFixed(3), 'comp', b.metrics.compression.toFixed(2));
let prevA = a0, prevB = b0;
b.fingerUp(0);
let maxJumpB = 0, maxJumpA = 0;
for (let s = 0; s < 6; s++) {
  b.step(1 / 360);
  const A = b.tip!(0), B = b.tip!(1)!;
  if (A) { const j = Math.hypot(A.x - prevA.x, A.y - prevA.y, A.z - prevA.z); maxJumpA = Math.max(maxJumpA, j); prevA = A; }
  const jb = Math.hypot(B.x - prevB.x, B.y - prevB.y, B.z - prevB.z); maxJumpB = Math.max(maxJumpB, jb); 
  console.log(' substep', s, 'tip0', A ? A.x.toFixed(4) : null, 'tip1', B.x.toFixed(4), 'jumpB', jb.toFixed(4), 'maxSpeed', b.debug.maxSpeed.toFixed(2));
  prevB = B;
}
console.log('max single-substep tip jump: finger0 (lifting)', maxJumpA.toFixed(4), ' finger1 (still down)', maxJumpB.toFixed(4), ' = ', (maxJumpB / R).toFixed(3), 'R');
console.log('normal motion per substep for ref (depth speed): ~', (R * 0.3 / 0.05 / 360).toFixed(4));
