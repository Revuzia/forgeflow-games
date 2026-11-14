// BLOCKTOOTH — economy breakdown probe (sim-integrator tool, harness code — not sim code).
//
//   node _harness/probe_econ.ts --titan molo --biome grideast [--seed 1337] [--minutes 20]
//
// Runs the same deterministic bot + draft path as probe_sim.ts and accounts, PER SIZE RANK:
// time in rank, nominal XP/mass DROPPED by source (props t0/t1, floors by tier, collapse
// bonus by tier, enemy kills; mass only sizes pickup meshes since SIZE became level-driven), XP GAINED, levels, floors/props per second,
// damage taken, min HP fraction and the peak enemy count. This is how the economy table at
// the top of src/core/config.ts was derived. performance.now() is not used.
//
// REPAIR CREWS (city/citysim.ts rebuild): per rank also crews dispatched / storeys rebuilt / buildings topped out,
// the standing-floor fraction at each rank end and at the city-boss spawn, and live ASSERTS on every rebuild event of
// the real run (stepCity runs first in the tick, so the pre-tick titan / boss / standing state is exactly what the
// works department saw): a crew is only dispatched while standing floors (+ the storeys finished that tick) are
// below REBUILD_TARGET, never during a live gatekeeper fight (no storey either; during the city-boss fight neither
// a crew nor a storey inside its keep-out rebuildStartR), never within rebuildStartR
// of the titan, never on a lot younger than
// REBUILD_MIN_DOWN_S; a storey is never added within rebuildNearR of the titan. SLOW construction (owner 2026-10-01:
// rebuilding never looks instant): a storey never follows the previous one faster than rebuildFloorS, the first never
// comes before site prep + one storey (rebuildScaffoldS + rebuildFloorS), no site tops out under SLOW_MIN_SITE_S from
// groundbreak, and no building pops in (two storeys of one building in a tick, or topped out without raising every
// storey). Per run it also prints the site build-time spread and the peak of sites mid-construction. Any violation ->
// exit code 1.

import type { BiomeId, EnemyKind, TitanId, World } from '../src/core/types.ts';
import { RANKS, TIERS, xpToNext } from '../src/core/config.ts';
import { createWorld, stepWorld } from '../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from './bot.ts';
import { ENEMIES } from '../src/data/enemies.ts';
import {
  REBUILD_MIN_DOWN_S, REBUILD_TARGET, RB_RISING, rebuildBook, rebuildFloorS, rebuildNearR, rebuildScaffoldS, rebuildStartR,
} from '../src/city/citysim.ts';

/** SLOW construction floor: no rebuilt building tops out faster than this from groundbreak (b3005a22: 4.6 s). */
const SLOW_MIN_SITE_S = 24;
/** One sim tick and a half of tolerance on the storey pace (progress accumulates dt in a Float32Array). */
const SLOW_TOL = 1.5 / 30;

/** REPAIR CREWS assert failures across every runEcon call (main exits 1 when > 0). */
export const rebuildFails: string[] = [];

interface Acc {
  t0: number; t1: number;
  src: Record<string, { xp: number; mass: number; n: number }>;
  massGain: number; xpGain: number; lv0: number; lv1: number;
  dmgTaken: number; minHp: number; peakE: number; kills: number; drafts: number;
  hurt: Record<string, number>; boss: Record<string, number>; paint: { fired: number; hit: number };
  rbStart: number; rbFloors: number; rbDone: number; standEnd: number;
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
  const mk = (t: number): Acc => ({ t0: t, t1: t, src: {}, massGain: 0, xpGain: 0, lv0: w.titan.level, lv1: w.titan.level, dmgTaken: 0, minHp: 1, peakE: 0, kills: 0, drafts: 0, hurt: {}, boss: {}, paint: { fired: 0, hit: 0 }, rbStart: 0, rbFloors: 0, rbDone: 0, standEnd: 1 });
  // REPAIR CREWS bookkeeping
  let totalFloors = 0;
  for (const b of w.city.buildings) totalFloors += b.floors;
  const standing = (): number => { let s2 = 0; for (const b of w.city.buildings) s2 += b.collapsed ? 0 : b.alive; return s2 / Math.max(1, totalFloors); };
  const footD = (b: { x: number; z: number; w: number; d: number }, x: number, z: number): number =>
    Math.hypot(x - Math.min(Math.max(x, b.x - b.w / 2), b.x + b.w / 2), z - Math.min(Math.max(z, b.z - b.d / 2), b.z + b.d / 2));
  const bk = rebuildBook(w.city);
  const tag = `${titan}/${biome}/${seed}`;
  let standAtCity = NaN;
  // SLOW construction bookkeeping: per site groundbreak time, last storey time, storeys raised
  const siteT0 = new Map<number, number>(), siteTl = new Map<number, number>(), siteN = new Map<number, number>();
  const siteDur: number[] = [];
  let midPeak = 0;
  const fail = (m: string): void => { if (rebuildFails.length < 40) rebuildFails.push(`${tag} @${w.t.toFixed(1)} s: ${m}`); else rebuildFails.length++; };
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
    // pre-tick state = what stepCity (first system of the tick) sees
    const preX = w.titan.x, preZ = w.titan.z, preStand = standing();
    const sR = rebuildStartR(w), nR = rebuildNearR(w);
    const boss = w.boss && w.boss.alive ? { x: w.boss.x, z: w.boss.z, main: w.boss.role === 'main' } : null;
    const downT = bk.downT.slice();
    stepWorld(w, botInput(w));
    const T = w.titan;
    let rbFl = 0, rbStarted = false;
    for (const ev of w.events) {
      if (ev.type !== 'rebuild') continue;
      const b = w.city.buildings[ev.id];
      if (ev.stage === 'floor') {
        rbFl++; cur.rbFloors++;
        const s0 = siteT0.get(b.id);
        if (s0 !== undefined) {
          const last = siteTl.get(b.id) ?? -1;
          if (last === w.t) fail(`building ${b.id} raised two storeys in one tick (popped in)`);
          else if (last < 0) { if (w.t - s0 < rebuildScaffoldS(b) + rebuildFloorS(b) - SLOW_TOL) fail(`building ${b.id} first storey ${(w.t - s0).toFixed(2)} s after groundbreak (< ${(rebuildScaffoldS(b) + rebuildFloorS(b)).toFixed(1)} s)`); }
          else if (w.t - last < rebuildFloorS(b) - SLOW_TOL) fail(`building ${b.id} storey ${(w.t - last).toFixed(2)} s after the previous (< rebuildFloorS ${rebuildFloorS(b)})`);
          siteTl.set(b.id, w.t); siteN.set(b.id, (siteN.get(b.id) ?? 0) + 1);
        }
        if (boss && !boss.main) fail(`storey on building ${b.id} during a live gatekeeper fight`);
        if (boss && boss.main && footD(b, boss.x, boss.z) < sR - 1e-6) fail(`storey on building ${b.id} inside the live city boss's keep-out`);
        if (footD(b, preX, preZ) < nR - 1e-6) fail(`storey on building ${b.id} ${footD(b, preX, preZ).toFixed(1)} m from the titan (< rebuildNearR ${nR.toFixed(1)})`);
      } else if (ev.stage === 'start') {
        rbStarted = true; cur.rbStart++;
        if (boss && !boss.main) fail(`crew dispatched to building ${b.id} during a live gatekeeper fight`);
        if (footD(b, preX, preZ) < sR - 1e-6) fail(`crew on building ${b.id} ${footD(b, preX, preZ).toFixed(1)} m from the titan (< rebuildStartR ${sR.toFixed(1)})`);
        if (boss && footD(b, boss.x, boss.z) < sR - 1e-6) fail(`crew on building ${b.id} inside a live boss's keep-out`);
        if (downT[b.id] >= 0 && w.t - downT[b.id] < REBUILD_MIN_DOWN_S - 1e-6) fail(`crew on building ${b.id} only ${(w.t - downT[b.id]).toFixed(1)} s after its collapse`);
        siteT0.set(b.id, w.t); siteTl.set(b.id, -1); siteN.set(b.id, 0);
      } else {
        cur.rbDone++;
        const s0 = siteT0.get(b.id);
        if (s0 !== undefined) {
          const d = w.t - s0;
          siteDur.push(d);
          if (d < SLOW_MIN_SITE_S) fail(`building ${b.id} (tier ${b.tier}, ${b.floors} fl) topped out ${d.toFixed(1)} s after groundbreak (< ${SLOW_MIN_SITE_S} s)`);
          if ((siteN.get(b.id) ?? 0) !== b.floors) fail(`building ${b.id} topped out after ${siteN.get(b.id)} of ${b.floors} storeys (popped in)`);
          siteT0.delete(b.id);
        }
      }
    }
    if (rbStarted && preStand + rbFl / Math.max(1, totalFloors) >= REBUILD_TARGET) fail(`crew dispatched at ${(preStand * 100).toFixed(1)} % standing (target ${REBUILD_TARGET * 100} %)`);
    for (const ev of w.events) {
      if (ev.type === 'bossSpawn' && w.boss && w.boss.role === 'main' && Number.isNaN(standAtCity)) standAtCity = standing();
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
    if (i % 30 === 0 || T.rank !== rank || w.run.result) cur.standEnd = standing();
    if (i % 30 === 0) {
      let mid = 0;
      for (const id of bk.crews) { const b = w.city.buildings[id]; if (bk.stage[id] === RB_RISING && !b.collapsed && b.alive < b.floors) mid++; }
      midPeak = Math.max(midPeak, mid);
    }
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
      console.log(`      repair crews: dispatched ${a.rbStart} · storeys rebuilt ${a.rbFloors} · topped out ${a.rbDone} · standing floors at rank end ${(a.standEnd * 100).toFixed(0)} %`);
    });
    const sd = siteDur.slice().sort((p, q) => p - q), q = (f: number): string => (sd.length ? sd[Math.min(sd.length - 1, Math.floor(f * sd.length))].toFixed(0) : '—');
    console.log(`  construction: ${sd.length} sites topped out · groundbreak->top-out p10/p50/p90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${sd.length ? sd[sd.length - 1].toFixed(0) : '—'} s · peak sites mid-construction ${midPeak}`);
    console.log(`  city boss spawn: standing floors ${Number.isNaN(standAtCity) ? '—' : (standAtCity * 100).toFixed(0) + ' %'} · repair-crew asserts ${rebuildFails.length ? rebuildFails.length + ' FAILED' : 'ok'}`);
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
  const minutes = Number(get('--minutes', '20'));   // the 20-minute run (PACING_20 §6 HARN; was 10)
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
  if (rebuildFails.length) {
    console.log(`\nREPAIR CREWS: FAIL — ${rebuildFails.length} violation(s)`);
    for (const m of rebuildFails.slice(0, 40)) console.log('  ' + m);
    process.exit(1);
  }
  console.log('\nREPAIR CREWS: PASS (every rebuild event of the run(s) obeyed target / start / near / boss / min-down / slow-construction rules)');
}
