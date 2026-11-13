export {};
// F2 scratch: reproduce probe_map grideast/voltkite seed 7 OVERLOAD next-tick XP miss
const world = await import('../../../src/core/world.ts');
const draft = await import('../../../src/upgrades/draft.ts');
const bot = await import('../../bot_map.ts').catch(() => null);
const gbot = await import('../../bot.ts');
const T0 = 329.3, T1 = 329.7;
const w = world.createWorld({ titan: 'voltkite', biome: 'grideast', seed: 7 } as any);
const inputFn = gbot.botInput;
console.log('input fn', inputFn.name);
while (!w.run.result && w.t < 331) {
  while (draft.hasPendingDraft(w)) { const off = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : draft.rollOffer(w, w.upgrades.chestDrafts > 0); draft.pickUpgrade(w, gbot.botPickUpgrade(w, off)); }
  world.stepWorld(w, inputFn(w));
  if (w.t >= T0 && w.t <= T1) {
    const ev = w.events.filter((e: any) => ['objectiveDone', 'pickup', 'levelUp', 'ultFire', 'powerup'].includes(e.type));
    console.log(w.tick, w.t.toFixed(2), 'lv', w.titan.level, 'xpToNext', w.titan.xpToNext, 'ult', w.ult.phase, JSON.stringify(ev));
  }
}
