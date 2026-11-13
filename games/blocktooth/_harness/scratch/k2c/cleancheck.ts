// K2c scratch: is WITHOUT A DENT's "no damage during the fight" real in bot runs? Per gate fight: titanHurt events,
// damage summed from events vs HP deltas, the tally's gateFightDmg at the kill.
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import * as D from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { TITAN_IDS } from '../../../src/core/types.ts';
const biome = (process.argv[2] ?? 'grideast') as 'grideast';
for (const titan of TITAN_IDS) {
  const w = createWorld({ titan, biome, seed: 1337, meta: { unlocked: [], perk: null, palette: 0, reviveUsed: false } });
  let hurtN = 0, hurtDmg = 0, hpLoss = 0, lastHp = w.titan.hp, fightOn = false, shots = 0;
  const out: string[] = [];
  for (let i = 0; i < 13 * 60 * 30 && !w.run.result; i++) {
    let g = 0;
    while (D.hasPendingDraft(w) && ++g < 200) { const chest = w.upgrades.chestDrafts > 0; const o = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : D.rollOffer(w, chest); if (!o || !o.length) break; D.pickUpgrade(w, botPickUpgrade(w, o)); }
    const hp0 = w.titan.hp;
    stepWorld(w, botInput(w));
    const a = w.gates.active;
    const inGate = a >= 1 && a <= 3;
    if (inGate) { if (w.titan.hp < hp0) hpLoss += hp0 - w.titan.hp; }
    for (const e of w.events) {
      if (e.type === 'gateSpawn') { fightOn = true; hurtN = 0; hurtDmg = 0; hpLoss = 0; }
      if (e.type === 'titanHurt' && fightOn) { hurtN++; hurtDmg += e.dmg; }
      if (e.type === 'gateDefeated') { out.push(`${e.gate} fight ${e.fightS.toFixed(1)} s · titanHurt ${hurtN} (${hurtDmg.toFixed(1)} dmg) · HP lost ${hpLoss.toFixed(1)} · tally gateFightDmg ${w.tally.gateFightDmg.toFixed(1)} · clean ${w.tally.gateCleanKills}`); fightOn = false; }
    }
    lastHp = w.titan.hp;
  }
  console.log(`${titan}/${biome}: ${w.run.result} @${w.t.toFixed(0)}`);
  for (const l of out) console.log('   ' + l);
}
