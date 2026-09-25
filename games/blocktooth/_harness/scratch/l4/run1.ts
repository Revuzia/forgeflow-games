// L4 scratch: one bot run, print objective / power-up timeline
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
const titan = (process.argv[2] ?? 'molo') as TitanId, biome = (process.argv[3] ?? 'grideast') as BiomeId, seed = Number(process.argv[4] ?? 1337);
const verbose = process.argv.includes('-v');
const w = createWorld({ titan, biome, seed });
const c: Record<string, number> = {};
while (!w.run.result && w.t < 800) {
  while (hasPendingDraft(w)) { const off = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, off)); }
  stepWorld(w, botInput(w));
  for (const e of w.events) {
    if (e.type === 'objectiveSpawn' || e.type === 'objectiveDone' || e.type === 'objectiveExpire') {
      const k = e.type + ':' + e.kind; c[k] = (c[k] ?? 0) + 1;
      if (verbose) { const o = w.map.objectives.find((q) => q.id === e.id); console.log(`t=${w.t.toFixed(1)} rank ${w.titan.rank} ${e.type} ${e.kind} id ${e.id} ${o ? o.target + '#' + o.targetId + ' d=' + Math.hypot(o.x - w.titan.x, o.z - w.titan.z).toFixed(0) + ' age ' + o.t.toFixed(1) : ''}`); }
    }
    if (e.type === 'powerupSpawn' || e.type === 'powerup') { const k = e.type + ':' + e.kind; c[k] = (c[k] ?? 0) + 1; if (verbose) console.log(`t=${w.t.toFixed(1)} ${e.type} ${e.kind}`); }
    if (e.type === 'rankUp') console.log(`t=${w.t.toFixed(1)} rankUp ${e.rank}`);
  }
}
console.log(titan, biome, seed, w.run.result, 'endT', w.run.endT.toFixed(0), 'overloadXp', w.map.overloadXp.toFixed(0), 'demoKills', w.map.demolitionKills);
console.log(JSON.stringify(c, null, 0));
