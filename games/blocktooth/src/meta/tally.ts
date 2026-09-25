// BLOCKTOOTH v2 — the run tally the goals read (FEATURES_V2 §8.1). SIM: THREE-free, deterministic,
// event-derived only (never reads kit-private state). Lane L5 (META/ENDLESS-SIM).
//
// Tick order (world.ts): … processTriggers → stepObjectives → stepPowerups → chargeUltimate → stepTally →
// peakRank → checkRunEnd. Every event of the tick (incl. trigger procs, objective payouts, DEMOLITION
// kills) is in w.events when stepTally reads it.
//
// What is counted where:
//   * kills / crushed / killsBy        ← 'enemyKilled' (crushed flag)
//   * props / propsBy (boats = propsBy.boat) ← 'propDestroyed'
//   * floors ← 'floorBreak' · collapses / collapsesByTier ← 'buildingCollapse'
//   * tier4Total ← the city's tier-4 buildings, counted on the FIRST stepTally (g_ws_cold_storage)
//   * ults ← 'ultFire' · ultKillsBest ← 'ultEnd'.kills
//   * objectives[kind] ← 'objectiveDone' · powerups[kind] ← 'powerup' (collected)
//   * evolutions / banishes / locks / rerolls ← upgrades/draft.ts (lane L2 writes them at the call)
//   * hpLowFrac ← lowest hp / maxHp seen at the end of a tick · healed ← 'titanHeal'.amount
//   * bossesDefeated / bossDefeatedBy ← 'bossDefeated' (the boss id is w.boss.id that tick), plus a state
//     sweep for a boss that died outside a tick (dev cheats); each BossState is credited once (data.tallied)
//   * staggersThisFight / staggersBestFightBy ← 'bossStagger', reset on 'bossSpawn'; a boss fielded while
//     w.endless is set is a rematch (fightIsRematch) and never updates staggersBestFightBy
//   * endlessS ← w.t − w.endless.startT
//   * HOOK window (HOOK_WINDOW_S after one 'ability' event): hookPickups ← 'pickup', hookKills ←
//     'enemyKilled'; vacuumBest / hookKillsBest are the best single window. A new 'ability' event
//     closes the previous window. (MOLO's GULLET VACUUM is its hook, so vacuumBest is the MOLO number.)
//   * wiresBest ← 'wireDetonate'.pts.length / 4, skipped while w.t ≤ ultWireUntilT (GRIDLOCK SURGE wires
//     may still be live; meta/ultimate.ts sets ultWireUntilT)
//   * fullVents ← 'vent' with power ≥ FULL_VENT (HEARTHBACK's SHELL fill)
//   * bloomsBest ← most titan-owned 'bloom' hazards alive at once WITHOUT data.wild (GREENBELT DECREE
//     blooms carry wild = 1)
//
// TallyV2 adds two run numbers the RunTally struct (types.ts, L0) does not carry but two goals need —
// peakRank (ZONING CHANGE / SKYLINE ADJUSTED) and blocks (URBAN RENEWAL). They live on the same object
// (createTally returns a TallyV2), so game.ts's evalGoals(profile, w.tally, ctx) sees them with no extra
// wiring. Reported to the orchestrator as a contract gap (fold them into RunTally).

import type { RunTally, World } from '../core/types.ts';
import { HOOK_WINDOW_S } from '../core/config.ts';

/** HEARTHBACK: a vent at or above this SHELL fill counts toward FULL PRESSURE */
export const FULL_VENT = 0.95;

/** RunTally + the two run numbers two goals need (see header). */
export interface TallyV2 extends RunTally {
  peakRank: number;        // max titan rank reached this run (0..4)
  blocks: number;          // w.run.blocksLeveled
}

export function createTally(): TallyV2 {
  return {
    kills: 0, crushed: 0,
    killsBy: { android: 0, squad: 0, drone: 0, buggy: 0, apc: 0, tank: 0, walker: 0, elite: 0 },
    props: 0, propsBy: {}, floors: 0, collapses: 0, collapsesByTier: [0, 0, 0, 0, 0], tier4Total: -1,
    ults: 0, ultKillsBest: 0,
    objectives: { overloadSite: 0, reliefDepot: 0, recordsAnnex: 0 },
    powerups: { cleanup: 0, demolition: 0, redLight: 0, rushHour: 0, backPay: 0 },
    evolutions: 0, banishes: 0, locks: 0, rerolls: 0,
    hpLowFrac: 1, healed: 0,
    bossesDefeated: 0, bossDefeatedBy: {}, staggersThisFight: 0, staggersBestFightBy: {}, fightIsRematch: false,
    endlessS: 0,
    vacuumBest: 0, wiresBest: 0, ultWireUntilT: -1, hookKillsBest: 0, fullVents: 0, bloomsBest: 0,
    hookT: -1, hookPickups: 0, hookKills: 0,
    peakRank: 0, blocks: 0,
  };
}

/** The v2 view of a tally (older/foreign tallies without the extra fields read as 0). */
export function tallyV2(t: RunTally): TallyV2 {
  const x = t as Partial<TallyV2> & RunTally;
  if (typeof x.peakRank !== 'number') x.peakRank = 0;
  if (typeof x.blocks !== 'number') x.blocks = 0;
  return x as TallyV2;
}

/** one boss defeat, credited once per BossState (b.data.tallied marks it) */
function creditBoss(w: World, t: TallyV2): void {
  const b = w.boss;
  if (!b) { t.bossesDefeated++; return; }
  if (b.data.tallied === 1) return;
  b.data.tallied = 1;
  t.bossesDefeated++;
  t.bossDefeatedBy[b.id] = (t.bossDefeatedBy[b.id] ?? 0) + 1;
}

/** Tick order: after chargeUltimate, before peakRank / checkRunEnd. */
export function stepTally(w: World): void {
  const t = tallyV2(w.tally);
  const T = w.titan;

  if (t.tier4Total < 0) {
    let n = 0;
    const bs = w.city.buildings;
    for (let i = 0; i < bs.length; i++) if (bs[i].tier === 4) n++;
    t.tier4Total = n;
  }

  // HOOK window closes HOOK_WINDOW_S after its 'ability' event
  if (t.hookT >= 0 && w.t - t.hookT > HOOK_WINDOW_S + 1e-9) { t.hookT = -1; t.hookPickups = 0; t.hookKills = 0; }

  const ev = w.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    switch (e.type) {
      case 'enemyKilled':
        t.kills++;
        if (e.crushed) t.crushed++;
        t.killsBy[e.kind] = (t.killsBy[e.kind] ?? 0) + 1;
        if (t.hookT >= 0) t.hookKills++;
        break;
      case 'propDestroyed':
        t.props++;
        t.propsBy[e.kind] = (t.propsBy[e.kind] ?? 0) + 1;
        break;
      case 'floorBreak':
        t.floors++;
        break;
      case 'buildingCollapse':
        t.collapses++;
        if (e.tier >= 0 && e.tier <= 4) t.collapsesByTier[e.tier]++;
        break;
      case 'ultFire':
        t.ults++;
        break;
      case 'ultEnd':
        if (e.kills > t.ultKillsBest) t.ultKillsBest = e.kills;
        break;
      case 'objectiveDone':
        t.objectives[e.kind] = (t.objectives[e.kind] ?? 0) + 1;
        break;
      case 'powerup':
        t.powerups[e.kind] = (t.powerups[e.kind] ?? 0) + 1;
        break;
      case 'titanHeal':
        if (e.amount > 0 && Number.isFinite(e.amount)) t.healed += e.amount;
        break;
      case 'bossSpawn':
        t.staggersThisFight = 0;
        t.fightIsRematch = w.endless !== null;
        break;
      case 'bossStagger':
        t.staggersThisFight++;
        if (!t.fightIsRematch && w.boss) {
          const id = w.boss.id;
          if (t.staggersThisFight > (t.staggersBestFightBy[id] ?? 0)) t.staggersBestFightBy[id] = t.staggersThisFight;
        }
        break;
      case 'bossDefeated':
        creditBoss(w, t);
        break;
      case 'ability':
        // a new hook closes the previous window (fold its counts in) and opens a new one
        if (t.hookPickups > t.vacuumBest) t.vacuumBest = t.hookPickups;
        if (t.hookKills > t.hookKillsBest) t.hookKillsBest = t.hookKills;
        t.hookT = w.t;
        t.hookPickups = 0;
        t.hookKills = 0;
        break;
      case 'pickup':
        if (t.hookT >= 0) t.hookPickups++;
        break;
      case 'wireDetonate':
        if (w.t > t.ultWireUntilT) {
          const n = Math.floor(e.pts.length / 4);
          if (n > t.wiresBest) t.wiresBest = n;
        }
        break;
      case 'vent':
        if (e.power >= FULL_VENT) t.fullVents++;
        break;
      default:
        break;
    }
  }

  // the open HOOK window's running counts are its best so far (events before an 'ability' event in the
  // same tick's list belong to the previous window — the conservative reading)
  if (t.hookT >= 0) {
    if (t.hookPickups > t.vacuumBest) t.vacuumBest = t.hookPickups;
    if (t.hookKills > t.hookKillsBest) t.hookKillsBest = t.hookKills;
  }

  // state sweep: a boss that died OUTSIDE a tick (the dev cheats kill it through app.mutate, whose events
  // never reach a stepTally) is credited here, once (b.data.tallied)
  if (w.boss && !w.boss.alive) creditBoss(w, t);

  // BRIARWICK bloom turrets alive at once (ult blooms carry data.wild and are excluded)
  let blooms = 0;
  const hz = w.hazards;
  for (let i = 0; i < hz.length; i++) {
    const h = hz[i];
    if (h.alive && h.owner === 'titan' && h.kind === 'bloom' && !h.data.wild) blooms++;
  }
  if (blooms > t.bloomsBest) t.bloomsBest = blooms;

  if (T.maxHp > 0) {
    const f = T.alive ? Math.max(0, T.hp) / T.maxHp : 0;
    if (f < t.hpLowFrac) t.hpLowFrac = f;
  }

  if (w.endless) t.endlessS = Math.max(0, w.t - w.endless.startT);
  if (T.rank > t.peakRank) t.peakRank = T.rank;
  if (w.run.peakRank > t.peakRank) t.peakRank = w.run.peakRank;
  t.blocks = w.run.blocksLeveled;
}
