// L5 scratch: why does maxHp drop during scenario A of probe_endless (molo/grideast seed 1337)?
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, rollOffer, pickUpgrade } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { spawnBoss, bossUltHit } from '../../../src/ai/bosses/index.ts';
import { continueEndless } from '../../../src/meta/endless.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337, meta: { unlocked: [], perk: null, palette: 0, reviveUsed: false } });
let prevHp = 0, prevOwned = '';
function step(): void {
  let g = 0;
  while (hasPendingDraft(w) && ++g < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, chest);
    if (!offer || !offer.length) break;
    const pick = botPickUpgrade(w, offer);
    pickUpgrade(w, pick);
  }
  stepWorld(w, botInput(w));
  if (prevHp && w.titan.maxHp < prevHp - 1e-6) {
    const owned = JSON.stringify(w.upgrades.owned);
    console.log(`t=${w.t.toFixed(1)} maxHp ${prevHp.toFixed(0)} → ${w.titan.maxHp.toFixed(0)} rank ${w.titan.rank} lvl ${w.titan.level}`);
    const a = JSON.parse(prevOwned), b = JSON.parse(owned);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) console.log(`   ${k}: ${a[k]} → ${b[k]}`);
  }
  prevHp = w.titan.maxHp; prevOwned = JSON.stringify(w.upgrades.owned);
}
for (let i = 0; i < 600 * 30 && !w.run.result; i++) { step(); if (w.boss && w.boss.alive && w.boss.introT <= 0) break; }
if (!w.boss || !w.boss.alive) spawnBoss(w, BIOMES[w.biomeId].boss);
w.boss!.introT = 0; bossUltHit(w, 1, 0); step();
console.log('clear?', w.run.result, 'continue', continueEndless(w));
for (let i = 0; i < 8 * 60 * 30 && !w.run.result; i++) step();
console.log('end', w.run.result, w.t.toFixed(0));
