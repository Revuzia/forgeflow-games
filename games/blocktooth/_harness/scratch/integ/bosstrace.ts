// sim-integrator scratch: trace every boss telegraph (spawn → fire) for one run.
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade, BOT_TUNE } from '../../bot.ts';
if (process.env.NODASH) BOT_TUNE.threatDash = false;
if (process.env.RSCALE) BOT_TUNE.reactionScale = Number(process.env.RSCALE);
import { circleInShape } from '../../../src/core/math.ts';
const [titan, biome, seedS] = process.argv.slice(2);
const w = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed: Number(seedS ?? 1337) });
const seen = new Map<number, { tag: string; t0: number; inAtSpawn: boolean; shape: any }>();
let hurtBoss = 0, staggers = 0, dashes = 0, phaseT: number[] = [];
for (let i = 0; i < 30 * 60 * 13 && !w.run.result; i++) {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 100) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); }
  const bi = botInput(w); if (process.env.IDLE_BOSS && w.boss && w.boss.alive) { bi.mx = 0; bi.mz = 0; bi.dash = false; } stepWorld(w, bi);
  const T = w.titan;
  if (!w.boss) continue;
  for (const tg of w.telegraphs) {
    if (!tg.alive || tg.owner !== 'boss') continue;
    if (!seen.has(tg.id)) {
      const inS = circleInShape(tg.shape, T.x, T.z, T.radius);
      seen.set(tg.id, { tag: tg.tag, t0: w.t, inAtSpawn: inS, shape: tg.shape });
    }
  }
  for (const ev of w.events) {
    if (ev.type === 'telegraphFire' && ev.owner === 'boss') {
      const s = seen.get(ev.id);
      let lo = 0, hi = 400; if (s) { for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (circleInShape(s.shape, T.x, T.z, m)) hi = m; else lo = m; } }
      console.log(`t=${w.t.toFixed(1)} ${s?.tag ?? '?'} clear=${(lo - T.radius).toFixed(1)} in@spawn=${s?.inAtSpawn} hit=${ev.hit} dashT=${T.dashT.toFixed(2)} ifr=${T.iframeT.toFixed(2)} charges=${T.dashCharges} spd=${T.speed.toFixed(0)} H=${T.height.toFixed(0)} hp=${(T.hp / T.maxHp * 100).toFixed(0)}%`);
    }
    if (ev.type === 'titanHurt' && w.boss) hurtBoss += ev.dmg;
    if (ev.type === 'bossStagger') { staggers++; console.log(`t=${w.t.toFixed(1)} STAGGER`); }
    if (ev.type === 'dash' && w.boss) dashes++;
    if (ev.type === 'bossPhase') phaseT.push(Math.round(w.t));
    if (ev.type === 'bossAttack') console.log(`t=${w.t.toFixed(1)} ATTACK ${ev.attack} phase ${w.boss.phase} bossHp ${(w.boss.hp / w.boss.maxHp * 100).toFixed(0)}%`);
  }
}
console.log('staggers', staggers, 'dashes', dashes, 'phases@', phaseT.join(','));
console.log('result', w.run.result, w.t.toFixed(0), 'hurt during boss', hurtBoss.toFixed(0), 'maxHp', w.titan.maxHp.toFixed(0));
