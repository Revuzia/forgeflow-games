import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { gateRing } from '../../../src/ai/bosses/index.ts';
import { growToRank } from '../../../src/titans/titansim.ts';
import { titanSpeed } from '../../../src/core/config.ts';
for (const [r, lv] of [[0, 7], [1, 16], [2, 27], [4, 36]] as const) {
  const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337 });
  w.cheats.noSpawns = true;
  growToRank(w, r, lv);
  w.gates.unlocked = r as 0;
  for (let i = 0; i < 60; i++) stepWorld(w, NO_INPUT);
  const H = w.titan.height, ring = gateRing(w);
  console.log(`rank ${r} LV ${lv} H ${H.toFixed(2)} ring ${ring.toFixed(1)} m = ${(ring / H).toFixed(1)} H · 2.2×ring ${(2.2 * ring / H).toFixed(1)} H · entry 1.15×ring ${(1.15 * ring / H).toFixed(1)} H · walk ${(titanSpeed(H) / H).toFixed(2)} H/s`);
}
