import { createWorld, stepWorld } from '../../src/core/world.ts';
import { botInput } from '../bot.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botPickUpgrade } from '../bot.ts';
const w = createWorld({ titan: (process.argv[2] ?? 'voltkite') as any, biome: 'lockwater', seed: 1337 });
console.log('spawn', w.city.spawn, 'bounds', w.city.bounds);
for (let i = 0; i < 30 * 125 && !w.run.result; i++) {
  while (hasPendingDraft(w)) { const o = w.upgrades.offer ?? rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); }
  const inp = botInput(w);
  stepWorld(w, inp);
  if (i % 150 === 0) {
    const T = w.titan; let n = 0; for (const e of w.enemies) if (e.alive) n++;
    console.log(`t=${w.t.toFixed(0)} pos ${T.x.toFixed(0)},${T.z.toFixed(0)} spd ${T.speed.toFixed(1)} in ${inp.mx.toFixed(2)},${inp.mz.toFixed(2)} hp ${T.hp.toFixed(0)}/${T.maxHp} mass ${T.mass.toFixed(1)} props ${T.propsEaten} enemies ${n} slow ${T.slowT.toFixed(1)}`);
  }
}
