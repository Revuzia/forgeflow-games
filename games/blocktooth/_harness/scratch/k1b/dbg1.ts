import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnGate } from '../../../src/ai/bosses/index.ts';
import { growToRank } from '../../../src/titans/titansim.ts';
const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337 });
w.cheats.noSpawns = true;
w.gates.unlocked = 0;
growToRank(w, 0, 7);
w.gates.unlocked = 0;
for (let i = 0; i < 40; i++) stepWorld(w, NO_INPUT);
console.log('rank', w.titan.rank, 'lv', w.titan.level, 'H', w.titan.height);
spawnGate(w, 'stencil1', 0);
const b = w.boss!;
console.log('hp', b.hp, b.maxHp, 'alive', b.alive, 'intro', b.introT, 'pos', b.x.toFixed(1), b.z.toFixed(1), 'titan', w.titan.x.toFixed(1), w.titan.z.toFixed(1));
for (let i = 0; i < 300; i++) {
  stepWorld(w, NO_INPUT);
  for (const e of w.events) if (e.type === 'gateDefeated' || e.type === 'bossAttack' || e.type === 'bossStagger') console.log(w.t.toFixed(2), JSON.stringify(e));
  if (!b.alive) { console.log('dead at', w.t, 'hp', b.hp, 'fatigue', b.data.fatigue, 'engaged', w.gates.engagedS, w.gates.liveFightS); break; }
  if (i % 30 === 0) console.log(w.t.toFixed(1), 'hp', b.hp.toFixed(0), 'att', b.attack, 'd', Math.hypot(b.x - w.titan.x, b.z - w.titan.z).toFixed(1), 'titanHP', w.titan.hp.toFixed(0));
}
