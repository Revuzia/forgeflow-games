// Verifier: rub on the dome top at various speeds/pressures. Reports how far the whole body gets dragged and whether it lifts.
import { SoftBody } from '../src/physics/softbody.ts';
import { genomeFromParam } from '../src/core/genome.ts';
import type { V3 } from '../src/contracts.ts';
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
for (const press of [0.2, 0.5, 0.8]) for (const dur of [0.3, 0.6, 1.2, 2.4]) for (const z of [0.0, 0.25]) {
  const b = new SoftBody(genomeFromParam(null), { detail: 3 });
  const x0 = -0.3, x1 = 0.3; let lift = 0, maxD = 0;
  const h0 = b.raycast(v3(x0, 3, z), v3(0, -1, 0)); if (!h0) continue;
  b.fingerDown(0, { point: h0.point, normal: h0.normal, dir: v3(0, -1, 0) });
  const T0 = 0.4, T1 = T0 + dur;
  for (let s = 0, t = 0; t < T1 + 2.5; s++) {
    if (t < T1) {
      b.fingerPressure(0, Math.min(1, t / 0.4) * press);
      if (t > T0) { const k = (t - T0) / dur; const h = b.raycast(v3(x0 + (x1 - x0) * k, 3, z), v3(0, -1, 0)); if (h) b.fingerMove(0, h.point); }
    } else if (t - 1 / 60 < T1) b.fingerUp(0);
    b.step(1 / 60); t = (s + 1) / 60;
    let foot = 1e9; for (let i = 0; i < b.vertexCount; i++) foot = Math.min(foot, b.positions[i * 3 + 1]);
    // lift = how high the lowest point is
    lift = Math.max(lift, foot); maxD = Math.max(maxD, Math.hypot(b.center.x, b.center.z));
  }
  console.log(`press ${press} rub ${((x1 - x0) / dur).toFixed(2)} m/s z=${z}: final body drift ${Math.hypot(b.center.x, b.center.z).toFixed(3)} m (max ${maxD.toFixed(3)}), foot lift max ${lift.toFixed(3)}, settledKin ${b.metrics.kinetic.toFixed(2)}`);
}
