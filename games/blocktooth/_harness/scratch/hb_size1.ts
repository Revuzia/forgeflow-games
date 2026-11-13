// HEARTHBACK Size I trace (scratch). node _harness/scratch/hb_size1.ts [titan] [biome] [seed] [secs]
import type { BiomeId, TitanId } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { BOT_TUNE, botInput, botPickUpgrade } from '../bot.ts';
const [titan, biome, seedS, secS] = process.argv.slice(2);
BOT_TUNE.lapseP = 0; BOT_TUNE.reactionScale = 0.6;
const w = createWorld({ titan: (titan ?? 'hearthback') as TitanId, biome: (biome ?? 'whitestacks') as BiomeId, seed: Number(seedS ?? 924050167) });
let fired = 0, hits = 0, attacks = 0, crushed = 0, killsBy: Record<string, number> = {}, nearSum = 0, nearN = 0, inRange = 0;
const lv: number[] = [];
for (let i = 0; i < Number(secS ?? 110) * 30 && w.titan.rank === 0; i++) {
  while (hasPendingDraft(w)) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); }
  stepWorld(w, botInput(w));
  for (const e of w.events) {
    if (e.type === 'titanAttack') attacks++;
    if (e.type === 'telegraphFire' && e.owner === 'titan') { fired++; if (e.hit) hits++; }
    if (e.type === 'enemyKilled') { killsBy[(e as any).kind + ((e as any).crushed ? '*' : '')] = (killsBy[(e as any).kind + ((e as any).crushed ? '*' : '')] ?? 0) + 1; }
    if (e.type === 'levelUp') lv.push(+w.t.toFixed(1));
  }
  if (i % 30 === 0) {
    const T = w.titan; let nd = Infinity;
    for (const e of w.enemies) if (e.alive) nd = Math.min(nd, Math.hypot(e.x - T.x, e.z - T.z) - e.radius - T.radius);
    if (Number.isFinite(nd)) { nearSum += nd; nearN++; if (nd < 2.5 * T.height) inRange++; }
  }
}
console.log(JSON.stringify({ t: +w.t.toFixed(1), rank: w.titan.rank, kills: w.titan.kills, crushed: w.titan.crushed, killsBy, attacks, stompFired: fired, stompHit: hits, nearestEnemyAvg: +(nearSum / Math.max(1, nearN)).toFixed(1), secsWithEnemyInReach: inRange, levelUps: lv }));
