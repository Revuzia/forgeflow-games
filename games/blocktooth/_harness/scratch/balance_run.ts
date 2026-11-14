// BALANCE scratch runner (harness scratch, not gate code). One run → one JSON line on stdout.
//   node _harness/scratch/balance_run.ts molo grideast [seed] [minutes]
// Same bot + draft path as probe_sim.ts. Reports per-rank threat telemetry + the boss fight.
import type { BiomeId, TitanId, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';

const [titan, biome, seedS, minS] = process.argv.slice(2);
const seed = Number(seedS ?? 1337), minutes = Number(minS ?? 13);
const w: World = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed });

interface R { t0: number; t1: number; dmg: Record<string, number>; hits: Record<string, number>; minHp: number; heal: number; fire: Record<string, number>; kills: Record<string, number>; aliveSum: number; aliveN: number; heavyAliveSum: number; paintF: number; paintH: number }
const mk = (t: number): R => ({ t0: t, t1: t, dmg: {}, hits: {}, minHp: 1, heal: 0, fire: {}, kills: {}, aliveSum: 0, aliveN: 0, heavyAliveSum: 0, paintF: 0, paintH: 0 });
const ranks: R[] = [mk(0)];
let cur = ranks[0];
let bossT = NaN, bossMinHp = 1, bossDmg = 0, bossHits = 0, lastHurt = '', lastHurtT = 0, eliteT = NaN, eliteMinHp = 1, eliteDmg = 0;
const bossHpAt: number[] = [];
const phaseT = [0, 0, 0, 0]; let staggers = 0, bossDmgTicks = 0, bossTicks = 0, gapSum = 0; const atk: Record<string, number> = {};
const gapHist = [0, 0, 0, 0, 0];
const maxTicks = Math.round(minutes * 60 * 30);
let drafts = 0;
for (let i = 0; i < maxTicks && !w.run.result; i++) {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, chest);
    if (!offer.length) break;
    pickUpgrade(w, botPickUpgrade(w, offer)); drafts++;
  }
  stepWorld(w, botInput(w));
  const T = w.titan;
  for (const ev of w.events) {
    if (ev.type === 'titanHurt') {
      cur.dmg[ev.src] = (cur.dmg[ev.src] ?? 0) + ev.dmg; cur.hits[ev.src] = (cur.hits[ev.src] ?? 0) + 1;
      lastHurt = ev.src; lastHurtT = w.t;
      if (!Number.isNaN(bossT)) { bossDmg += ev.dmg; bossHits++; }
      else if (!Number.isNaN(eliteT)) eliteDmg += ev.dmg;
    } else if (ev.type === 'titanHeal') cur.heal += ev.amount;
    else if (ev.type === 'enemyFire') cur.fire[ev.kind] = (cur.fire[ev.kind] ?? 0) + 1;
    else if (ev.type === 'enemyKilled') cur.kills[ev.kind] = (cur.kills[ev.kind] ?? 0) + 1;
    else if (ev.type === 'telegraphFire' && ev.owner !== 'titan') { cur.paintF++; if (ev.hit) cur.paintH++; }
    else if (ev.type === 'bossSpawn') bossT = w.t;
    else if (ev.type === 'bossStagger') staggers++;
    else if (ev.type === 'bossAttack') atk[`${w.boss?.phase}:${ev.attack}`] = (atk[`${w.boss?.phase}:${ev.attack}`] ?? 0) + 1;
    else if (ev.type === 'eliteSpawn' && Number.isNaN(eliteT)) eliteT = w.t;
    else if (ev.type === 'rankUp') { cur.t1 = w.t; cur = mk(w.t); ranks.push(cur); }
  }
  const f = T.maxHp > 0 ? T.hp / T.maxHp : 0;
  cur.minHp = Math.min(cur.minHp, f);
  if (!Number.isNaN(bossT)) bossMinHp = Math.min(bossMinHp, f);
  else if (!Number.isNaN(eliteT)) eliteMinHp = Math.min(eliteMinHp, f);
  if (i % 30 === 0) {
    let a = 0, h = 0;
    for (const e of w.enemies) if (e.alive) { a++; if (e.kind === 'tank' || e.kind === 'walker' || e.kind === 'apc' || e.kind === 'elite') h++; }
    cur.aliveSum += a; cur.heavyAliveSum += h; cur.aliveN++;
  }
  if (w.boss && i % 300 === 0 && !Number.isNaN(bossT)) bossHpAt.push(Math.round(100 * w.boss.hp / w.boss.maxHp));
  if (w.boss && w.boss.alive && w.boss.introT <= 0) {
    bossTicks++; phaseT[w.boss.phase] += w.dt;
    if (w.events.some((e) => e.type === 'bossHit')) bossDmgTicks++;
    let g = Infinity; for (const p of w.boss.parts) g = Math.min(g, Math.hypot(p.x - T.x, p.z - T.z) - p.r - T.radius);
    gapSum += g; gapHist[g < 0 ? 0 : g < 30 ? 1 : g < 60 ? 2 : g < 120 ? 3 : 4]++;
  }
  cur.t1 = w.t;
}
const T = w.titan;
const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
console.log(JSON.stringify({
  titan, biome, seed, result: w.run.result ?? 'timeout', endT: Math.round(w.run.result ? w.run.endT : w.t), level: T.level, rank: T.rank, drafts,
  rankT: ranks.map((r) => Math.round(r.t0)), bossT: Math.round(bossT), fight: Number.isNaN(bossT) ? null : Math.round((w.run.result ? w.run.endT : w.t) - bossT),
  bossHp: w.boss ? Math.round(100 * w.boss.hp / w.boss.maxHp) : null, bossMaxHp: w.boss ? Math.round(w.boss.maxHp) : null, bossHpAt, bossMinHp: +bossMinHp.toFixed(2), bossDmg: Math.round(bossDmg), bossHits,
  eliteT: Math.round(eliteT), eliteMinHp: +eliteMinHp.toFixed(2), eliteDmg: Math.round(eliteDmg),
  phaseT: phaseT.slice(1).map(Math.round), staggers, bossDmgFrac: +(bossDmgTicks / Math.max(1, bossTicks)).toFixed(2), gapAvg: Math.round(gapSum / Math.max(1, bossTicks)), gapHist: gapHist.map((x) => Math.round(100 * x / Math.max(1, bossTicks))), atk,
  lastHurt, lastHurtT: Math.round(lastHurtT), maxHp: Math.round(T.maxHp),
  bossBy: w.boss ? round(Object.fromEntries(Object.entries(w.boss.data).filter(([k]) => k.startsWith('by_')))) : null,
  ranks: ranks.map((r) => ({ dt: Math.round(r.t1 - r.t0), dmg: round(r.dmg), hits: r.hits, minHp: +r.minHp.toFixed(2), heal: Math.round(r.heal), fire: r.fire, kills: r.kills, alive: +(r.aliveSum / Math.max(1, r.aliveN)).toFixed(1), heavy: +(r.heavyAliveSum / Math.max(1, r.aliveN)).toFixed(1), paint: `${r.paintH}/${r.paintF}` })),
}));
