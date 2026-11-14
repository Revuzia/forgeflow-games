// L4 scratch: static prop census per biome + spawnRing over a bot run (seed 1337)
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { spawnRing } from '../../../src/ai/director.ts';
import { botInput } from '../../bot.ts';
import type { BiomeId } from '../../../src/core/types.ts';
for (const b of ['grideast', 'whitestacks', 'lockwater'] as BiomeId[]) {
  const w = createWorld({ titan: 'molo', biome: b, seed: 1337 });
  const c: Record<string, number> = {};
  for (const p of w.city.props) if (p.lane === -1) { const k = p.kind + '/t' + p.tier; c[k] = (c[k] ?? 0) + 1; }
  console.log(b, JSON.stringify(c));
}
const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337 });
let last = -1;
while (!w.run.result && w.t < 700) {
  stepWorld(w, botInput(w));
  const s = Math.floor(w.t / 30);
  if (s !== last) { last = s; console.log(`t=${w.t.toFixed(0)} rank ${w.titan.rank} H ${w.titan.height.toFixed(1)} ring ${spawnRing(w).toFixed(1)} radius ${w.titan.radius.toFixed(2)}`); }
}
