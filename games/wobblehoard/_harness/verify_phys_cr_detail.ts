import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
for (const detail of [2, 3, 4]) {
  const b = new SoftBody(makeStarterGenome(), { detail });
  const p0 = Float32Array.from(b.positions);
  for (let i = 0; i < 600; i++) b.step(1 / 60);
  let mv = 0; for (let i = 0; i < p0.length; i++) mv = Math.max(mv, Math.abs(p0[i] - b.positions[i]));
  const top = b.raycast(v(0, 3, 0), v(0, -1, 0))!;
  b.fingerDown(0, { point: top.point, normal: top.normal, dir: v(0, -1, 0) }); b.fingerPressure(0, 1);
  let minVol = 9, maxVol = 0;
  for (let i = 0; i < 90; i++) { b.step(1 / 60); minVol = Math.min(minVol, b.metrics.volume); maxVol = Math.max(maxVol, b.metrics.volume); }
  const comp = b.metrics.compression;
  b.fingerUp(0);
  for (let i = 0; i < 60 * 6; i++) { b.step(1 / 60); minVol = Math.min(minVol, b.metrics.volume); maxVol = Math.max(maxVol, b.metrics.volume); }
  const t0 = performance.now(); for (let i = 0; i < 300; i++) b.step(1 / 60); const ms = (performance.now() - t0) / 300;
  // NaN / strain check
  let strainOk = true; for (let i = 0; i < b.vertexCount; i++) if (!(b.strain[i] > 0.3 && b.strain[i] < 3)) strainOk = false;
  console.log(`detail ${detail}: verts ${b.vertexCount} restMove ${mv.toExponential(1)} comp@press ${comp.toFixed(2)} vol ${minVol.toFixed(3)}..${maxVol.toFixed(3)} final vol ${b.metrics.volume.toFixed(4)} kinetic ${b.metrics.kinetic.toFixed(4)} strainOk ${strainOk} ms/frame ${ms.toFixed(2)} safetyResets ${b.debug.safetyResets}`);
}
