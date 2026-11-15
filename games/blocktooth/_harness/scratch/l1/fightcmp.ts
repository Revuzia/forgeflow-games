// L1 scratch: boss-fight length and clear time with vs without UPROAR (same bot otherwise).
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
function run(titan: TitanId, biome: BiomeId, ult: boolean) {
  const w = createWorld({ titan, biome, seed: 1337 });
  let bossT = NaN, staggers = 0, ultBoss = 0;
  for (let i = 0; i < 13 * 60 * 30 && !w.run.result; i++) {
    let g = 0;
    while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); }
    const inp = botInput(w); if (!ult) inp.ultimate = false;
    stepWorld(w, inp);
    for (const e of w.events) { if (e.type === 'bossSpawn') bossT = w.t; if (e.type === 'bossStagger') staggers++; }
  }
  if (w.boss) ultBoss = (w.boss.data.by_ult ?? 0) / w.boss.maxHp;
  return `${(w.run.result ?? 'timeout').padEnd(6)} @${(w.run.endT).toFixed(0)} fight ${(w.run.endT - bossT).toFixed(0)} stag ${staggers} ult% ${(100 * ultBoss).toFixed(0)}`;
}
const only = process.argv[2];
for (const t of TITAN_IDS as readonly TitanId[]) for (const b of BIOME_IDS as readonly BiomeId[]) {
  if (only && !(`${t}/${b}`).includes(only)) continue;
  console.log(`${t.padEnd(10)} ${b.padEnd(12)} ULT: ${run(t, b, true)}   | NO-ULT: ${run(t, b, false)}`);
}
