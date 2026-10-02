import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome } from '../src/core/genome.ts';
const base = makeStarterGenome();
for (const [k, val] of [['firmness', NaN], ['size', NaN], ['bounce', 2], ['stretch', -1], ['size', 9], ['firmness', 0], ['bounce', 0], ['stretch', 0], ['size', 0], ['seed', -5]] as const) {
  const b = new SoftBody({ ...base, [k]: val } as any);
  for (let i = 0; i < 300; i++) b.step(1 / 60);
  let ok = true; for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) ok = false;
  console.log(k, val, 'finite', ok, 'safetyResets', b.debug.safetyResets, 'R', b.restRadius, 'vol', b.metrics.volume.toFixed(3), 'ke', b.metrics.kinetic.toFixed(4));
}
