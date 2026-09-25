// L3 scratch: full GATE-2-style bot runs on GRID-EAST with the boss patched IN MEMORY (no source flip).
//   BOSS=parkade6 node _harness/scratch/l3_gridrun.ts [titans=molo,voltkite,hearthback,briarwick] [seeds=1337]
import type { BiomeId, BossId, TitanId, World } from '../../src/core/types.ts';
import { EMPTY_RUN_META } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { BIOMES } from '../../src/data/biomes.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';
const boss = (process.env.BOSS ?? 'parkade6') as BossId;
(BIOMES.grideast as { boss: BossId }).boss = boss;
const titans = (process.argv[2] ?? 'molo,voltkite,hearthback,briarwick').split(',') as TitanId[];
const seeds = (process.argv[3] ?? '1337').split(',').map(Number);
const biome = (process.env.BIOME ?? 'grideast') as BiomeId;
for (const seed of seeds) for (const titan of titans) {
  const w: World = createWorld({ titan, biome, seed, meta: { ...EMPTY_RUN_META, unlocked: [] } });
  let bossT = NaN; const hurt: Record<string, number> = {}; let jams = 0, ults = 0, tows = 0; let bossHurt = 0;
  for (let i = 0; i < 780 * 30 && !w.run.result; i++) {
    let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); }
    stepWorld(w, botInput(w));
    for (const ev of w.events) {
      if (ev.type === 'bossSpawn') bossT = w.t;
      else if (ev.type === 'bossStagger') jams++; else if (ev.type === 'ultFire') ults++; else if (ev.type === 'leash' && ev.on) tows++;
      else if (ev.type === 'titanHurt' && w.boss && w.boss.alive) { hurt[ev.src] = (hurt[ev.src] ?? 0) + Math.round(ev.dmg); bossHurt += ev.dmg; }
    }
  }
  const b = w.boss;
  const by = b ? Object.entries(b.data).filter(([k]) => k.startsWith('by_')).map(([k, v]) => `${k.slice(3)} ${Math.round(100 * v / b.maxHp)}%`).join(' ') : '';
  const parts = b && b.id === 'parkade6' ? ` till ${Math.round(100 * b.data.part_till / Math.max(1, b.data.part_till + b.data.part_booth + b.data.part_body + b.data.part_legs))}%` : '';
  console.log(`${boss} ${titan.padEnd(10)} s${seed} ${String(w.run.result ?? 'timeout').padEnd(6)} end ${w.t.toFixed(0)} bossT ${bossT.toFixed(0)} fight ${(w.t - bossT).toFixed(0)} s  bossHp ${b ? (100 * b.hp / b.maxHp).toFixed(0) : '-'}% jams ${jams} ults ${ults} tows ${tows}${parts} · dmg by ${by} · hurt during boss ${JSON.stringify(hurt)} maxHp ${Math.round(w.titan.maxHp)}`);
}
