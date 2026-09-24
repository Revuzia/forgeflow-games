// BLOCKTOOTH — economy breakdown probe (sim-integrator tool, harness code — not sim code).
//
//   node _harness/probe_econ.ts --titan molo --biome grideast [--seed 1337] [--minutes 10]
//
// Runs the same deterministic bot + draft path as probe_sim.ts and accounts, PER SIZE RANK:
// time in rank, nominal XP/mass DROPPED by source (props t0/t1, floors by tier, collapse
// bonus by tier, enemy kills; mass only sizes pickup meshes since SIZE became level-driven), XP GAINED, levels, floors/props per second,
// damage taken, min HP fraction and the peak enemy count. This is how the economy table at
// the top of src/core/config.ts was derived. performance.now() is not used.

import type { BiomeId, EnemyKind, TitanId, World } from '../src/core/types.ts';
import { RANKS, TIERS, xpToNext } from '../src/core/config.ts';
import { createWorld, stepWorld } from '../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from './bot.ts';
import { ENEMIES } from '../src/data/enemies.ts';

interface Acc {
  t0: number; t1: number;
  src: Record<string, { xp: number; mass: number; n: number }>;
  massGain: number; xpGain: number; lv0: number; lv1: number;
  dmgTaken: number; minHp: number; peakE: number; kills: number; drafts: number;
  hurt: Record<string, number>; boss: Record<string, number>; paint: { fired: number; hit: number };
}

function add(a: Acc, key: string, xp: number, mass: number): void {
  const s = a.src[key] ?? (a.src[key] = { xp: 0, mass: 0, n: 0 });
  s.xp += xp; s.mass += mass; s.n++;
}

function totalXp(w: World): number {
  let s = 0;
  for (let l = 1; l < w.titan.level; l++) s += xpToNext(l);
  return s + w.titan.xp;
}

export function runEcon(titan: TitanId, biome: BiomeId, seed: number, minutes: number, print = true): { accs: Acc[]; w: World } {
  const w = createWorld({ titan, biome, seed });
  const accs: Acc[] = [];
  const mk = (t: number): Acc => ({ t0: t, t1: t, src: {}, massGain: 0, xpGain: 0, lv0: w.titan.level, lv1: w.titan.level, dmgTaken: 0, minHp: 1, peakE: 0, kills: 0, drafts: 0, hurt: {}, boss: {}, paint: { fired: 0, hit: 0 } });
  let cur = mk(0); accs.push(cur);
  let rank = 0;
  const maxTicks = Math.round(minutes * 60 * 30);
  let lastMass = w.titan.mass, lastXp = totalXp(w);
  for (let i = 0; i < maxTicks && !w.run.result; i++) {
    let guard = 0;
    while (hasPendingDraft(w) && guard++ < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : rollOffer(w, chest);
      if (!offer.length) break;
      pickUpgrade(w, botPickUpgrade(w, offer));
      cur.drafts++;
    }
    stepWorld(w, botInput(w));
    const T = w.titan;
    for (const ev of w.events) {
      if (ev.type === 'propDestroyed') {
        const p = w.city.props[ev.id];
        const td = TIERS[p.tier];
        add(cur, `prop t${p.tier}`, td.floorXp, td.floorMass);
      } else if (ev.type === 'floorBreak') {
        const td = TIERS[ev.tier];
        add(cur, `floor t${ev.tier}`, td.floorXp, td.floorMass);
      } else if (ev.type === 'buildingCollapse') {
        const b = w.city.buildings[ev.id];
        const td = TIERS[ev.tier];
        const bonus = td.collapseBonus * b.floors;
        add(cur, `collapse t${ev.tier}`, td.floorXp * bonus, td.floorMass * bonus);
      } else if (ev.type === 'enemyKilled') {
        const d = ENEMIES[ev.kind as EnemyKind];
        add(cur, `kill ${ev.kind}`, d.xp, d.mass);
        cur.kills++;
      } else if (ev.type === 'titanHurt') {
        cur.dmgTaken += ev.dmg;
        cur.hurt[ev.src] = (cur.hurt[ev.src] ?? 0) + ev.dmg;
      } else if (ev.type === 'bossAttack') {
        cur.boss[ev.attack] = (cur.boss[ev.attack] ?? 0) + 1;
      } else if (ev.type === 'telegraphFire' && ev.owner !== 'titan') {
        cur.paint.fired++; if (ev.hit) cur.paint.hit++;
      }
    }
    const m = T.mass, x = totalXp(w);
    cur.massGain += m - lastMass; cur.xpGain += x - lastXp; lastMass = m; lastXp = x;
    cur.minHp = Math.min(cur.minHp, T.hp / T.maxHp);
    let alive = 0; for (const e of w.enemies) if (e.alive) alive++;
    cur.peakE = Math.max(cur.peakE, alive);
    cur.t1 = w.t; cur.lv1 = T.level;
    if (T.rank !== rank) {
      rank = T.rank;
      cur = mk(w.t); accs.push(cur);
    }
  }
  if (print) {
    console.log(`\n${titan}/${biome} seed ${seed}: result ${w.run.result ?? 'timeout'} @ ${w.t.toFixed(0)} s · Size ${['I', 'II', 'III', 'IV', 'V'][w.titan.rank]} · LV ${w.titan.level} · boss ${w.boss ? `${w.boss.id} hp ${(w.boss.hp / w.boss.maxHp * 100).toFixed(0)}%` : '—'}`);
    accs.forEach((a, r) => {
      const dt = Math.max(1e-6, a.t1 - a.t0);
      console.log(`  Size ${['I', 'II', 'III', 'IV', 'V'][r]}  ${a.t0.toFixed(0)}→${a.t1.toFixed(0)} s (${dt.toFixed(0)} s)  LV ${a.lv0}→${a.lv1} drafts ${a.drafts}  xp +${a.xpGain.toFixed(0)} (${(a.xpGain / dt).toFixed(1)}/s)  kills ${a.kills}  dmgTaken ${a.dmgTaken.toFixed(0)}  minHp ${(a.minHp * 100).toFixed(0)}%  peakE ${a.peakE}`);
      const keys = Object.keys(a.src).sort((p, q) => a.src[q].xp - a.src[p].xp);
      console.log(`      hurt by: ${Object.entries(a.hurt).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ') || '—'}  | hostile paint hit ${a.paint.hit}/${a.paint.fired}  | boss attacks: ${Object.entries(a.boss).map(([k, v]) => `${k}×${v}`).join(' ') || '—'}`);
      console.log('      ' + keys.map((k) => `${k}: n${a.src[k].n} m${a.src[k].mass.toFixed(0)} x${a.src[k].xp.toFixed(0)}`).join(' · '));
    });
  }
  return { accs, w };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('_harness/probe_econ.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const get = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const titans = get('--titan', 'molo').split(',') as TitanId[];
  const biomes = get('--biome', 'grideast').split(',') as BiomeId[];
  const seed = Number(get('--seed', '1337'));
  const minutes = Number(get('--minutes', '10'));
  if (argv.includes('--matrix')) {
    // one compact line per titan × biome: per-rank duration · damage taken (as % of the rank's
    // maxHp) · min HP, then the boss fight (spawn t, fight length, attacks, paint hits, min HP)
    const all = argv.includes('--all');
    const ts = all ? (['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) : titans;
    const bs = all ? (['grideast', 'whitestacks', 'lockwater'] as BiomeId[]) : biomes;
    const seeds = get('--seeds', String(seed)).split(',').map(Number);
    for (const sd of seeds) for (const t of ts) for (const b of bs) {
      const { accs, w } = runEcon(t, b, sd, minutes, false);
      const cells = accs.map((a, r) => {
        const hpR = w.titan.stats.maxHp / RANKS[w.titan.rank].hpMul * RANKS[r].hpMul;
        return `${['I', 'II', 'III', 'IV', 'V'][r]} ${(a.t1 - a.t0).toFixed(0)}s d${(a.dmgTaken / Math.max(1, hpR) * 100).toFixed(0)}% m${(a.minHp * 100).toFixed(0)}%`;
      });
      const last = accs[accs.length - 1];
      const bt = w.director.bossSpawned ? (w.boss ? w.t - (w.director.bossT ?? 0) : 0) : -1;
      const atk = Object.values(last.boss).reduce((s, v) => s + v, 0);
      console.log(`${(t + '/' + b).padEnd(22)} s${sd} ${(w.run.result ?? 'timeout').padEnd(7)} ${w.t.toFixed(0).padStart(4)}s LV${String(w.titan.level).padStart(3)} | ${cells.join(' | ')}`
        + (w.director.bossSpawned ? ` || boss@${(w.director.bossT).toFixed(0)} fight ${bt.toFixed(0)}s atk ${atk} paint ${last.paint.hit}/${last.paint.fired} hp ${w.boss ? (w.boss.hp / w.boss.maxHp * 100).toFixed(0) : '-'}%` : ''));
      if (w.boss && argv.includes('--bossdmg')) {
        const by = Object.entries(w.boss.data).filter(([k]) => k.startsWith('by_')).sort((p, q) => q[1] - p[1]);
        const tot = by.reduce((s, [, v]) => s + v, 0);
        console.log('    boss dmg by kind: ' + by.map(([k, v]) => `${k.slice(3)} ${(v / tot * 100).toFixed(0)}%`).join(' · ') + ` (total ${tot.toFixed(0)} of maxHp ${w.boss.maxHp.toFixed(0)})`);
      }
    }
  } else for (const t of titans) for (const b of biomes) runEcon(t, b, seed, minutes);
}
