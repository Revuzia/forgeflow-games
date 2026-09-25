// L3 scratch: gate-bot (non-god, no adds) boss fight length per boss id, same harness as probe_boss3 §E.
//   node _harness/scratch/l3_bosscmp.ts caisson4,irongully,parkade6 [seeds=1,2,3] [adds=0]
import type { BiomeId, BossId, TitanId, TitanInput, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { gainGrowth } from '../../src/titans/titansim.ts';
import { spawnBoss } from '../../src/ai/bosses/index.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const ids = (process.argv[2] ?? 'caisson4,irongully,parkade6').split(',') as BossId[];
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
const adds = process.argv[4] === '1';
function drafts(w: World): void { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); } }
for (const id of ids) {
  const lens: number[] = []; let deaths = 0;
  for (const titan of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) for (const seed of seeds) {
    const w = createWorld({ titan, biome: 'grideast' as BiomeId, seed });
    w.cheats.noSpawns = !adds;
    for (let g = 0; g < 200 && w.titan.level < 37; g++) { gainGrowth(w, 1); drafts(w); }
    for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO); }
    if (!adds) w.enemies.length = 0;
    spawnBoss(w, id);
    const b = w.boss!; let fight = 0, jams = 0, ults = 0; const hit: Record<string, number> = {};
    for (let i = 0; i < 30 * 420 && b.alive && w.titan.alive; i++) {
      drafts(w); stepWorld(w, botInput(w)); if (b.introT <= 0) fight += w.dt;
      for (const ev of w.events) { if (ev.type === 'bossStagger') jams++; else if (ev.type === 'ultFire') ults++; else if (ev.type === 'titanHurt') hit[ev.src] = (hit[ev.src] ?? 0) + Math.round(ev.dmg); }
    }
    const res = !b.alive ? 'clear' : !w.titan.alive ? 'dead' : 'timeout';
    if (res === 'clear') lens.push(fight); else if (res === 'dead') deaths++;
    const by = Object.entries(b.data).filter(([k]) => k.startsWith('by_')).map(([k, v]) => `${k.slice(3)} ${Math.round(100 * v / b.maxHp)}%`).join(' ');
    console.log(`${id} ${titan.padEnd(10)} s${seed} ${res.padEnd(7)} ${fight.toFixed(0).padStart(4)} s  hp left ${(100 * b.hp / b.maxHp).toFixed(0)}%  jams ${jams} ults ${ults} fatigue ${(b.data.fatigue ?? 0).toFixed(4)}  dmg by ${by}  hurt ${JSON.stringify(hit)}`);
  }
  const s = lens.sort((a, c) => a - c);
  console.log(`== ${id}: median ${s.length ? s[s.length >> 1].toFixed(0) : 'n/a'} s over ${s.length} clears, ${deaths} deaths\n`);
}
