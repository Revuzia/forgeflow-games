// BLOCKTOOTH v2 — EXTENDED COVERAGE, the endless mode after a clear (FEATURES_V2 §9). SIM: THREE-free,
// deterministic (no clock; draws only what spawnBoss / ringPoint / spawnEnemy already draw).
// Lane L5 (META/ENDLESS-SIM).
//
// Flow: the city's boss dies → runEnd clear → the clear tabloid → KEEP GOING → app mutate(continueEndless)
// → play resumes with run.phase 'endless' until the titan dies (checkRunEnd only ends an endless run on
// death). Pre-wired call sites (L0): director budgetRate × endlessBudgetMul; enemies spawn HP ×
// endlessHpMul; titansim hurtTitan × endlessDmgMul; bosses bossHostile × endlessBossDmgMul; spawnBoss
// keeps 'endless'; world.ts stepEndless after stepDirector.
//
// Escalation (m = minutes since KEEP GOING; ENDLESS in config.ts):
//   budget × min(budgetMax, 1 + budgetPerMin·m) · spawn HP × (1 + hpPerMin·m) · hostile damage ×
//   min(dmgMax, 1 + dmgPerMin·m) · a RAMROD (elite) 30 s after KEEP GOING then every eliteEveryS ·
//   a rematch boss bossEveryS after KEEP GOING / after the previous rematch dies, in rematchOrder(biome)
//   (bossIx starts at 1: the city's own boss has just been beaten), HP × (1 + rematchHpStep·n) applied
//   right after spawnBoss, damage × (1 + rematchDmgStep·n) (n = rematches won so far). A dead rematch
//   drops a guaranteed power-up + a chest, and rematches++.
// Score (§9.3): floor(10·endlessS + 2·kills since + 5000·rematches + tons since / 500), refreshed every tick.
//
// The rematch's `alert boss` banner (spawnBoss pushes it) is re-keyed to `alert rematch` on the same
// tick, so the player sees one banner: CONTAINMENT RESUBMITTED.

import type { BiomeId, BossId, Enemy, EnemyKind, World } from '../core/types.ts';
import { BOSS_IDS } from '../core/types.ts';
import { ENDLESS } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import { spawnBoss } from '../ai/bosses/index.ts';
import { spawnPickup } from '../combat/pickups.ts';
import { redLightActive, spawnPowerup } from '../meta/powerups.ts';

// ─────────────────────────────── spawn hooks (bound by meta/perks.ts) ───────────────────────────────
/**
 * The RAMROD spawner (ai/enemies.ts ringPoint + spawnEnemy) is BOUND at load time by meta/perks.ts, which
 * only world.ts imports, instead of imported here: titansim / enemies / director / bosses import this
 * module for the multipliers, and a static import of ai/enemies.ts from here would drag enemies → world →
 * upgrades/engine into every one of their import graphs (probe_combat stubs titansim for the combat
 * modules and cannot link engine.ts). stepEndless only ever runs from world.ts, so the hook is always bound
 * when it is needed; unbound (a module test without world.ts) the RAMROD is skipped, never a throw.
 */
export interface EndlessSpawnHooks {
  ringPoint(w: World, kind: EnemyKind, out: { x: number; z: number }): boolean;
  spawnEnemy(w: World, kind: EnemyKind, x: number, z: number, opts?: { squad?: number; slot?: number; elite?: boolean }): Enemy;
}
let HOOKS: EndlessSpawnHooks | null = null;
export function bindEndlessSpawns(h: EndlessSpawnHooks): void { HOOKS = h; }

/** first RAMROD after KEEP GOING (s) — §9.1 nextEliteT = w.t + 30 */
const FIRST_ELITE_S = 30;

/** minutes since KEEP GOING (0 outside endless) */
function minutes(w: World): number {
  const E = w.endless;
  return E ? Math.max(0, w.t - E.startT) / 60 : 0;
}

/** Only when run.result === 'clear'. Turns the cleared run into EXTENDED COVERAGE. */
export function continueEndless(w: World): boolean {
  if (w.run.result !== 'clear' || w.endless || !w.titan.alive) return false;
  w.run.result = null;
  w.run.phase = 'endless';
  w.run.endT = -1;
  w.boss = null;                                   // the dead city boss
  w.endless = {
    startT: w.t,
    rematches: 0,
    nextBossT: w.t + ENDLESS.bossEveryS,
    bossIx: 1,
    nextEliteT: w.t + FIRST_ELITE_S,
    killsAt: w.titan.kills,
    tonsAt: w.run.tonnage,
    score: 0,
  };
  return true;
}

const P = { x: 0, z: 0 };

function spawnEndlessElite(w: World): void {
  if (!HOOKS) return;
  HOOKS.ringPoint(w, 'elite', P);
  const e = HOOKS.spawnEnemy(w, 'elite', P.x, P.z, { elite: true });
  const D = w.director;
  D.data.spawned_elite = (D.data.spawned_elite ?? 0) + 1;
  w.events.push({ type: 'alert', key: 'elite' });
  w.events.push({ type: 'eliteSpawn', id: e.id });
}

function spawnRematch(w: World): void {
  const E = w.endless;
  if (!E) return;
  const order = rematchOrder(w.biomeId);
  const id = order[E.bossIx % order.length];
  const ev0 = w.events.length;
  spawnBoss(w, id);
  const b = w.boss;
  if (!b || !b.alive || b.id !== id) return;       // refused (should not happen: no boss alive)
  const mul = 1 + ENDLESS.rematchHpStep * E.rematches;
  b.maxHp *= mul;
  b.hp = b.maxHp;
  E.nextBossT = Infinity;
  E.bossIx++;
  // one banner: spawnBoss's `alert boss` becomes `alert rematch`
  let keyed = false;
  for (let i = ev0; i < w.events.length; i++) {
    const e = w.events[i];
    if (e.type === 'alert' && e.key === 'boss') { w.events[i] = { type: 'alert', key: 'rematch' }; keyed = true; break; }
  }
  if (!keyed) w.events.push({ type: 'alert', key: 'rematch' });
  w.events.push({ type: 'endlessBoss', boss: id, n: E.rematches + 1 });
}

/** Tick order: after stepDirector; no-op unless w.endless. Keeps run.phase 'endless'. */
export function stepEndless(w: World): void {
  const E = w.endless;
  if (!E || w.run.result) return;
  w.run.phase = 'endless';
  if (w.titan.alive) {
    const red = redLightActive(w);

    // a rematch that died (last tick's stepBoss / damage): reward + schedule the next
    const b = w.boss;
    if (b && !b.alive && E.nextBossT === Infinity) {
      E.rematches++;
      E.nextBossT = w.t + ENDLESS.bossEveryS;
      spawnPowerup(w, null, b.x, b.z, true);
      spawnPickup(w, 'chest', b.x, b.z, 0, 0);
    }

    // rematch
    if (!(w.boss && w.boss.alive) && w.t >= E.nextBossT) spawnRematch(w);

    // RAMROD every eliteEveryS (held while RED LIGHT stops the city; skipped under the noSpawns cheat)
    if (w.t >= E.nextEliteT) {
      if (red) E.nextEliteT += w.dt;
      else {
        if (!w.cheats.noSpawns) spawnEndlessElite(w);
        E.nextEliteT = w.t + ENDLESS.eliteEveryS;
      }
    }
  }
  E.score = endlessScore(w);
}

/** director budgetRate × this: min(budgetMax, 1 + budgetPerMin · m); 1 outside endless. */
export function endlessBudgetMul(w: World): number {
  if (!w.endless) return 1;
  return Math.min(ENDLESS.budgetMax, 1 + ENDLESS.budgetPerMin * minutes(w));
}

/** enemies spawn HP × this: 1 + hpPerMin · m; 1 outside endless. */
export function endlessHpMul(w: World): number {
  if (!w.endless) return 1;
  return 1 + ENDLESS.hpPerMin * minutes(w);
}

/** titansim hurtTitan (all hostile damage) × this: min(dmgMax, 1 + dmgPerMin · m); 1 outside endless. */
export function endlessDmgMul(w: World): number {
  if (!w.endless) return 1;
  return Math.min(ENDLESS.dmgMax, 1 + ENDLESS.dmgPerMin * minutes(w));
}

/** bosses/index.ts bossHostile × this: 1 + rematchDmgStep × rematches while a rematch is alive, else 1. */
export function endlessBossDmgMul(w: World): number {
  const E = w.endless;
  if (!E || !w.boss || !w.boss.alive) return 1;
  return 1 + ENDLESS.rematchDmgStep * E.rematches;
}

/** §9.3: floor(10·endlessS + 2·kills since + 5000·rematches + tons since / 500); 0 outside endless. */
export function endlessScore(w: World): number {
  const E = w.endless;
  if (!E) return 0;
  const S = ENDLESS.score;
  const secs = Math.max(0, w.t - E.startT);
  const kills = Math.max(0, w.titan.kills - E.killsAt);
  const tons = Math.max(0, w.run.tonnage - E.tonsAt);
  const v = Math.floor(S.perSecond * secs + S.perKill * kills + S.perRematch * E.rematches + tons * S.perTons);
  return Number.isFinite(v) ? v : 0;
}

/** Rematch order for a city: its own boss first, then the other two in BOSS_IDS order. */
export function rematchOrder(biome: BiomeId): BossId[] {
  const own = BIOMES[biome].boss;
  return [own, ...BOSS_IDS.filter((b) => b !== own)];
}
