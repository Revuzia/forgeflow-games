import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
const mode = process.argv[2] ?? 'rest';
const b = new SoftBody(makeStarterGenome());
for (let i = 0; i < 120; i++) b.step(1 / 60);
if (mode !== 'rest') {
  const top = b.raycast(v(0, 3, 0), v(0, -1, 0))!;
  b.fingerDown(0, { point: top.point, normal: top.normal, dir: v(0, -1, 0) }); b.fingerPressure(0, 1);
  if (mode === 'grab') b.grab(1, 5, v(0.3, 0.6, 0));
}
for (let i = 0; i < 3000; i++) b.step(1 / 60); // warm
console.log('MARK');
for (let i = 0; i < 20000; i++) b.step(1 / 60);
console.log('END');
