import type { BiomeId, TitanId } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { titanMaxSpeed } from '../../../src/titans/titansim.ts';
for (const t of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) {
  const w = createWorld({ titan: t, biome: 'grideast' as BiomeId, seed: 1337 });
  for (let i = 0; i < 30 * 60 * 13 && !w.run.result && !w.boss; i++) {
    let g = 0;
    while (hasPendingDraft(w) && g++ < 100) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); }
    stepWorld(w, botInput(w));
  }
  const S = w.titan.stats;
  console.log(t, 't', w.t.toFixed(0), 'rank', w.titan.rank, 'H', w.titan.height.toFixed(0), 'maxSp', titanMaxSpeed(w).toFixed(0), 'ms', S.moveSpeed.toFixed(2), 'dashC', S.dashCharges, 'dashCd', S.dashCooldown.toFixed(2), 'dashDist', S.dashDistance.toFixed(2), 'armor', S.armor.toFixed(0), 'maxHp', w.titan.maxHp.toFixed(0), 'regen', S.regen.toFixed(2), 'iframes', S.iframes.toFixed(2), 'dmg', S.damage.toFixed(2), 'owned', w.upgrades.order.join(','));
}
