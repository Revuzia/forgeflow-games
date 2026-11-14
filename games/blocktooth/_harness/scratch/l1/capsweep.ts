// L1 scratch: GATE-2-style matrix (clears in 8–12 min, deaths, earliest clear) for ULT.bossCapFrac values.
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../../../src/core/types.ts';
import { ULT } from '../../../src/core/config.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
const caps = process.argv.slice(2).map(Number);
for (const cap of caps.length ? caps : [0.06, 0.04]) {
  (ULT as unknown as { bossCapFrac: number }).bossCapFrac = cap;
  let clears = 0, deaths = 0; const ends: string[] = [];
  for (const t of TITAN_IDS as readonly TitanId[]) for (const b of BIOME_IDS as readonly BiomeId[]) {
    const w = createWorld({ titan: t, biome: b, seed: 1337 });
    for (let i = 0; i < 13 * 60 * 30 && !w.run.result; i++) {
      let g = 0;
      while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); }
      stepWorld(w, botInput(w));
    }
    if (w.run.result === 'clear' && w.run.endT >= 480 && w.run.endT <= 720) clears++;
    if (w.run.result === 'dead') deaths++;
    ends.push(`${t[0]}${b[0]}:${w.run.result === 'clear' ? 'C' : 'D'}${w.run.endT.toFixed(0)}`);
  }
  console.log(`bossCapFrac ${cap}: clears ${clears}/12 · deaths ${deaths} · ${ends.join(' ')}`);
}
