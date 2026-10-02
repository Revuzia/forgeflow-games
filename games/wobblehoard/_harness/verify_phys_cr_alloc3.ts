import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
const b = new SoftBody(makeStarterGenome());
for (let i = 0; i < 120; i++) b.step(1 / 60);
const top = b.raycast(v(0, 3, 0), v(0, -1, 0))!;
b.fingerDown(0, { point: top.point, normal: top.normal, dir: v(0, -1, 0) }); b.fingerPressure(0, 1);
b.grab(1, 5, v(0.3, 0.6, 0));
const P = v(0, 0.4, 0), T = v(0.3, 0.6, 0);
for (let i = 0; i < 3000; i++) { b.step(1 / 60); b.fingerMove(0, P); b.grabMove(1, T); }
console.log('MARK');
for (let i = 0; i < 20000; i++) { b.step(1 / 60); P.x = 0.05 * Math.sin(i * 0.02); T.y = 0.6 + 0.1 * Math.sin(i * 0.01); b.fingerMove(0, P); b.grabMove(1, T); }
console.log('END');
