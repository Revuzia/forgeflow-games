import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const g = makeStarterGenome();
const run = (b: SoftBody) => { for (let i = 0; i < 60; i++) b.step(1 / 60); b.nudge({ x: 1, y: 0.5, z: 0 }); for (let i = 0; i < 120; i++) b.step(1 / 60); return b.stateHash(); };
const fresh = run(new SoftBody(g));
for (const warm of [6, 7, 12, 13]) {
  const b = new SoftBody(g); for (let i = 0; i < warm; i++) b.step(1 / 360); b.reset();
  console.log('substeps before reset', warm, run(b) === fresh ? 'same as fresh' : 'DIFFERS from fresh');
}
