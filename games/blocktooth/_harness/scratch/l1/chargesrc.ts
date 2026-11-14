// L1 scratch: UPROAR charge points by source and Size (fire-on-ready bot), to tune §3.2.
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../../../src/core/types.ts';
import { ULT, ULT_CITY_RANK_MUL } from '../../../src/core/config.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { stat } from '../../../src/upgrades/stats.ts';

const src = ['trickle', 'prop', 'floor', 'collapse', 'kill', 'hurt', 'boss'] as const;
const acc: Record<string, number[]> = {}; for (const s of src) acc[s] = [0, 0, 0, 0, 0];
const secs = [0, 0, 0, 0, 0];
for (const titan of TITAN_IDS as readonly TitanId[]) for (const biome of BIOME_IDS as readonly BiomeId[]) {
  const w = createWorld({ titan, biome, seed: 1337 });
  for (let i = 0; i < 13 * 60 * 30 && !w.run.result; i++) {
    let g = 0;
    while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); }
    stepWorld(w, botInput(w));
    const T = w.titan, r = T.rank; secs[r] += w.dt;
    const u = w.ult;
    const live = u.phase === 'idle' && (u.lockT > 0 ? false : true);
    if (!live) continue;
    const m = stat(w, 'ultCharge'), cm = ULT_CITY_RANK_MUL[r], near = ULT.nearH * T.height;
    acc.trickle[r] += ULT.trickle * w.dt * m;
    for (const e of w.events) {
      const d = (x: number, z: number, pad = 0) => Math.hypot(x - T.x, z - T.z) <= near + pad;
      if (e.type === 'propDestroyed' && d(e.x, e.z)) acc.prop[r] += ULT.prop * cm * m;
      else if (e.type === 'floorBreak' && d(e.x, e.z)) acc.floor[r] += ULT.floor * cm * m;
      else if (e.type === 'buildingCollapse' && d(e.x, e.z, 0.5 * Math.max(e.w, e.d))) acc.collapse[r] += ULT.collapsePerTier * (e.tier + 1) * cm * m;
      else if (e.type === 'enemyKilled') acc.kill[r] += ULT.kill[e.kind] * m;
      else if (e.type === 'titanHurt') acc.hurt[r] += ULT.hurt * e.dmg / T.maxHp * m;
      else if (e.type === 'bossHit' && w.boss) acc.boss[r] += ULT.bossHit * e.dmg / w.boss.maxHp * m;
    }
  }
}
console.log('points per minute of charging time, by Size (12 runs, charging ticks only)');
console.log('src       ' + ['I', 'II', 'III', 'IV', 'V'].map((s) => s.padStart(8)).join(''));
for (const s of src) console.log(s.padEnd(10) + acc[s].map((v, r) => (v / Math.max(1, secs[r]) * 60).toFixed(1).padStart(8)).join(''));
console.log('total/min ' + [0, 1, 2, 3, 4].map((r) => (src.reduce((a, s) => a + acc[s][r], 0) / Math.max(1, secs[r]) * 60).toFixed(1).padStart(8)).join(''));
console.log('secs(all) ' + secs.map((v) => v.toFixed(0).padStart(8)).join(''));
