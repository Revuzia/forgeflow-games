// cost of the rig's per-frame boss floor (bossFrameNeed + bossFrameFloorAt) on a live LV 37 IRON GULLY fight
import type { TitanInput } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { bossFrameNeed, bossFrameFloorAt } from '../../../src/core/config.ts';
import { gainGrowth } from '../../../src/titans/titansim.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const w = createWorld({ titan: 'molo', biome: 'whitestacks', seed: 3 });
w.cheats.god = true; w.cheats.noSpawns = true;
const drafts = () => { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); } };
for (let g = 0; g < 200 && w.titan.level < 37; g++) { gainGrowth(w, 1); drafts(); }
for (let i = 0; i < 150; i++) { drafts(); stepWorld(w, NO); }
spawnBoss(w, 'irongully');
let worst = 0, tot = 0, n = 0, tgMax = 0;
for (let i = 0; i < 30 * 60 && w.boss && w.boss.alive; i++) {
  drafts(); stepWorld(w, botInput(w));
  const t0 = performance.now();
  for (let r = 0; r < 4; r++) { bossFrameNeed(w); bossFrameFloorAt(0, 0, 16 / 9); }
  const dtm = (performance.now() - t0) / 4;
  if (i > 30) { worst = Math.max(worst, dtm); tot += dtm; n++; }
  tgMax = Math.max(tgMax, w.telegraphs.filter(t => t.alive && t.owner === 'boss').length);
}
console.log(`rig boss floor per frame: mean ${(tot / n * 1000).toFixed(1)} µs · worst ${(worst * 1000).toFixed(1)} µs over ${n} ticks · max live boss tells ${tgMax}`);
