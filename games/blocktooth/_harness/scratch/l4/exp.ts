// L4 scratch: variant experiments over a subset of the GATE 2 matrix (seed 1337).
// usage: node exp.ts <variant> [titan,..] [biome,..]
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { OBJECTIVES, POWERUPS } from '../../../src/core/config.ts';
import { PU_TUNE } from '../../../src/meta/powerups.ts';
import { MAP_TUNE } from '../../../src/meta/objectives.ts';
import { BOT_MAP_TUNE } from '../../bot_map.ts';
import { OBJECTIVE_BIOME } from '../../../src/data/objectives.ts';
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
const variant = process.argv[2] ?? 'base';
const titans = (process.argv[3] ?? 'molo,voltkite,hearthback,briarwick').split(',') as TitanId[];
const biomes = (process.argv[4] ?? 'grideast,whitestacks,lockwater').split(',') as BiomeId[];
const O = OBJECTIVES as any, P = POWERUPS as any;
for (const v of variant.split('+')) {
  if (v === 'norelief') O.relief.firstAtS = 1e9;
  if (v === 'nopu') { for (const k in PU_TUNE.dropByKill) (PU_TUNE.dropByKill as any)[k] = 0; PU_TUNE.dropByCollapse = 0; }
  if (v === 'noover') O.overload.firstAtS = 1e9;
  if (v === 'noannex') O.annex.delayAfterBreachS = 1e9;
  if (v === 'nobossrelief') (BOT_MAP_TUNE as any).noBoss = true;
  if (v.startsWith('xp')) MAP_TUNE.overloadXpFrac = Number(v.slice(2));
  if (v.startsWith('heal')) O.relief.heals = Number(v.slice(4));
  if (v.startsWith('hpb')) O.relief.hpBelow = Number(v.slice(3));
  if (v.startsWith('drop')) { const f = Number(v.slice(4)); for (const k in PU_TUNE.dropByKill) if (k !== 'elite') (PU_TUNE.dropByKill as any)[k] *= f; PU_TUNE.dropByCollapse *= f; }
  if (v.startsWith('ores')) for (const b of Object.values(OBJECTIVE_BIOME)) b.overloadRespawnS += Number(v.slice(4));
  if (v.startsWith('demow')) (P.weights as any).demolition = Number(v.slice(5));
  if (v.startsWith('rhp')) (BOT_MAP_TUNE as any).reliefHp = Number(v.slice(3));
}
let clears = 0, deaths = 0;
const seeds = process.argv[5] ? process.argv[5].split(',').map(Number) : null;
const combos: [TitanId, BiomeId, number][] = [];
if (seeds) { for (const biome of biomes) seeds.forEach((sd, i) => combos.push([(['molo','voltkite','hearthback','briarwick'] as TitanId[])[i % 4], biome, sd])); }
else for (const titan of titans) for (const biome of biomes) combos.push([titan, biome, 1337]);
for (const [titan, biome, seed] of combos) {
  const w = createWorld({ titan, biome, seed });
  const rank: number[] = [];
  const c = { pu: 0, puBoss: 0, relief: 0, reliefBoss: 0, over: 0, annex: 0, heal: 0 };
  while (!w.run.result && w.t < 900) {
    while (hasPendingDraft(w)) { const off = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, off)); }
    stepWorld(w, botInput(w));
    const boss = !!(w.boss && w.boss.alive);
    for (const e of w.events) {
      if (e.type === 'rankUp') rank[e.rank] = Math.round(w.t);
      else if (e.type === 'powerupSpawn') { c.pu++; if (boss) c.puBoss++; }
      else if (e.type === 'objectiveDone') { if (e.kind === 'reliefDepot') { c.relief++; if (boss) c.reliefBoss++; } else if (e.kind === 'overloadSite') c.over++; else c.annex++; }
    }
  }
  if (w.run.result === 'clear') clears++; else if (w.run.result === 'dead') deaths++;
  console.log(`${variant} ${titan.padEnd(10)} ${biome.padEnd(11)} s${seed} ranks ${rank.slice(1).join('/')} ${w.run.result} @${w.run.endT.toFixed(0)} pu ${c.pu}(boss ${c.puBoss}) relief ${c.relief}(boss ${c.reliefBoss}) over ${c.over} annex ${c.annex} demo ${w.map.demolitionKills}`);
}
console.log(`${variant}: clears ${clears} deaths ${deaths}`);
