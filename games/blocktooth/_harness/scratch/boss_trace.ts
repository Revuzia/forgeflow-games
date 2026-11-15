// Boss-fight trace (harness scratch). node _harness/scratch/boss_trace.ts molo lockwater 7 [fromT] [toT] [every_s]
import type { BiomeId, TitanId, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';
import { circleInShape } from '../../src/core/math.ts';

const [titan, biome, seedS, fromS, toS, everyS] = process.argv.slice(2);
const w: World = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed: Number(seedS ?? 1337) });
const from = Number(fromS ?? 0), to = Number(toS ?? 780), every = Math.round(Number(everyS ?? 1) * 30);
let hits = 0, hurt = 0;
for (let i = 0; i < to * 30 && !w.run.result; i++) {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, chest);
    if (!offer.length) break;
    pickUpgrade(w, botPickUpgrade(w, offer));
  }
  const inp = botInput(w);
  stepWorld(w, inp);
  for (const e of w.events) { if (e.type === 'bossHit') hits += e.dmg; if (e.type === 'titanHurt') hurt += e.dmg; }
  if (w.t < from || i % every !== 0) continue;
  const T = w.titan, b = w.boss;
  let gap = NaN, gapC = NaN;
  if (b) { gap = Infinity; for (const p of b.parts) gap = Math.min(gap, Math.hypot(p.x - T.x, p.z - T.z) - p.r - T.radius); gapC = Math.hypot(b.x - T.x, b.z - T.z); }
  let cover = 0, paints = 0;
  for (const tg of w.telegraphs) if (tg.alive && tg.owner !== 'titan' && !tg.fired) { paints++; if (circleInShape(tg.shape, T.x, T.z, T.radius * 1.35 + 1.5)) cover++; }
  let en = 0, heavy = 0; for (const e of w.enemies) if (e.alive) { en++; if (e.kind === 'tank' || e.kind === 'walker' || e.kind === 'apc' || e.kind === 'elite') heavy++; }
  const B = w.city.bounds;
  console.log(`t=${w.t.toFixed(1)} R${T.rank} hp ${T.hp.toFixed(0)}/${T.maxHp.toFixed(0)} pos(${T.x.toFixed(0)},${T.z.toFixed(0)}) bnd x${B.minX.toFixed(0)}..${B.maxX.toFixed(0)} z${B.minZ.toFixed(0)}..${B.maxZ.toFixed(0)} | boss ${b ? `p${b.phase} ${(100 * b.hp / b.maxHp).toFixed(0)}% @(${b.x.toFixed(0)},${b.z.toFixed(0)}) atk ${b.attack} cd ${b.cd.toFixed(1)} stag ${b.staggerT.toFixed(1)} meter ${b.meter.toFixed(2)}` : '-'} gap ${gap.toFixed(0)} ctr ${gapC.toFixed(0)} | paints ${paints} cover ${cover} leash ${T.leash ? 1 : 0} in(${inp.mx.toFixed(2)},${inp.mz.toFixed(2)}) dash ${inp.dash ? 1 : 0} | en ${en}/${heavy} dealt ${hits.toFixed(0)} hurt ${hurt.toFixed(0)}`);
  hits = 0; hurt = 0;
}
console.log('result', w.run.result, w.t.toFixed(0));
