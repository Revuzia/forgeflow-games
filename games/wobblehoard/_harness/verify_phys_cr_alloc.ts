import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const v = (x: number, y: number, z: number) => ({ x, y, z });
const b = new SoftBody(makeStarterGenome());
for (let i = 0; i < 120; i++) b.step(1 / 60);
const top = b.raycast(v(0, 3, 0), v(0, -1, 0))!;
b.fingerDown(0, { point: top.point, normal: top.normal, dir: v(0, -1, 0) }); b.fingerPressure(0, 1);
b.grab(1, 5, v(0.3, 0.6, 0)); 
const gc = (globalThis as any).gc;
for (let i = 0; i < 2000; i++) b.step(1 / 60); // warm up JIT
gc(); gc();
const m0 = process.memoryUsage().heapUsed;
for (let i = 0; i < 20000; i++) { b.step(1 / 60); b.grabMove(1, v(0.3 + 0.1 * Math.sin(i * 0.01), 0.6, 0)); b.fingerMove(0, v(0.05 * Math.sin(i * 0.02), 0.4, 0)); }
gc(); gc();
const m1 = process.memoryUsage().heapUsed;
console.log('retained delta KB after 20000 steps:', ((m1 - m0) / 1024).toFixed(1));
// churn test: allocated bytes via --trace-gc not needed; count young-gen scavenges using PerformanceObserver
