// titan-view scratch: does the real sim move the titan + emit the events TitanView consumes?
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { screenToWorld } from '../../../src/core/config.ts';
import type { TitanId } from '../../../src/core/types.ts';
for (const id of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) {
  const w = createWorld({ titan: id, biome: 'grideast', seed: 7 });
  const x0 = w.titan.x, z0 = w.titan.z;
  const mv = screenToWorld(1, 0.4);
  const types: Record<string, number> = {};
  for (let i = 0; i < 90; i++) {
    stepWorld(w, { mx: mv.mx, mz: mv.mz, ability: i === 10, abilityHeld: i >= 10 && i < 40, dash: i === 30 });
    for (const e of w.events) types[e.type] = (types[e.type] ?? 0) + 1;
  }
  console.log(id.padEnd(10), 'moved', Math.hypot(w.titan.x - x0, w.titan.z - z0).toFixed(2), 'm  h', w.titan.height.toFixed(2), 'kit', JSON.stringify(w.titan.kit), '\n   events', JSON.stringify(types));
}
