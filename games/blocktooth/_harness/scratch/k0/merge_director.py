import sys
p = 'src/ai/director.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:90]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""//   * Boss: at min(BOSS_AT_S, t(rank V) + 20) → spawnBoss(w, biome.boss) (which raises
//     `alert boss`, emits `bossSpawn`, sets director.bossSpawned and run.phase 'boss').
//   * cheats.noSpawns: nothing is fielded (waves, trickle, elite, scheduled boss) and the
//     budget does not bank; timers keep running so switching it off resumes the schedule.
""", """//   * Boss: director.bossT = min(BOSS_AT_S, t(rank V) + 20) is still kept here, but the spawn itself
//     moved to meta/gates.ts stepGates (GATEKEEPERS §4.1 / §7.3; the K0 stub runs the old block verbatim).
//   * cheats.noSpawns: nothing is fielded (waves, trickle, elite, scheduled boss) and the
//     budget does not bank; timers keep running so switching it off resumes the schedule.
//   * GATEKEEPERS (§2.8, §6.3, §6.4, lane K0 pre-wire): BOSS_SPAWN_MUL / BOSS_MIX only for a city boss or a
//     gate rematch (slot 0); × gateSpawnMul(w) always; no elite while a gate lock (slot 1–3) is pending or
//     any fight is alive; RAMROD at SWITCHBOARD-5's kill + ELITE_AFTER_RANK_IV_S (the rank IV rule stays
//     for a rank IV reached without that kill: the open-gate skeleton and dev cheats); nothing spawned or
//     banked during the finale; the boss framing keeps a post-kill floor over a gate breach's tween.
""")

rep("""import { BOSS_AT_S, BOSS_FRAME, CAMERA, CITY, DIRECTOR_BUDGET_RANK_MUL, ELITE_AT_S, bossFrameFitAt, bossFrameFloorAt, bossFrameNeed, cameraDistance, frameDistance, stepFrameHold } from '../core/config.ts';""",
    """import {
  BOSS_AT_S, BOSS_FRAME, CAMERA, CITY, DIRECTOR_BUDGET_RANK_MUL, ELITE_AT_S, GROW_TWEEN_S, bossFrameFitAt, bossFrameFloorAt,
  bossFrameNeed, cameraDistance, frameDistance, stepFrameHold, titanHeightAt,
} from '../core/config.ts';""")
rep("""import { ringPoint, ringRadius, spawnEnemy } from './enemies.ts';
import { spawnBoss } from './bosses/index.ts';
import { endlessBudgetMul } from '../meta/endless.ts';""", """import { ringPoint, ringRadius, spawnEnemy } from './enemies.ts';
import { endlessBudgetMul } from '../meta/endless.ts';
import { fightAlive, gateSpawnMul } from '../meta/gates.ts';""")

rep("""function weightOf(w: World, k: EnemyKind): number {
  const bias = BIOMES[w.biomeId].enemyBias[k];
  const b = bias !== undefined && Number.isFinite(bias) ? Math.max(0, bias) : 1;
  return (w.boss && w.boss.alive ? BOSS_MIX[k] : MIX[k][w.titan.rank]) * b;
}

/** Budget points per second at the current time/rank (§9). */
export function budgetRate(w: World): number {
  const r = (1.2 + (0.9 * Math.min(w.t, 600)) / 60 + 0.6 * w.titan.rank) * (DIRECTOR_BUDGET_RANK_MUL[w.titan.rank] ?? 1);
  const out = w.boss && w.boss.alive ? r * BOSS_SPAWN_MUL : r;
  return out * endlessBudgetMul(w);   // v2: EXTENDED COVERAGE escalation (1 outside endless)
}""", """/** GATEKEEPERS §6.3: the city-boss spawn rules (BOSS_SPAWN_MUL, BOSS_MIX) apply to a city boss and to a
 *  gate REMATCH (slot 0); a home gatekeeper keeps the rank's normal MIX (its budget is gateSpawnMul's). */
function bossRules(w: World): boolean {
  const b = w.boss;
  return !!b && b.alive && (b.role === 'main' || b.slot === 0);
}

function weightOf(w: World, k: EnemyKind): number {
  const bias = BIOMES[w.biomeId].enemyBias[k];
  const b = bias !== undefined && Number.isFinite(bias) ? Math.max(0, bias) : 1;
  return (bossRules(w) ? BOSS_MIX[k] : MIX[k][w.titan.rank]) * b;
}

/** Budget points per second at the current time/rank (§9). */
export function budgetRate(w: World): number {
  const r = (1.2 + (0.9 * Math.min(w.t, 600)) / 60 + 0.6 * w.titan.rank) * (DIRECTOR_BUDGET_RANK_MUL[w.titan.rank] ?? 1);
  const out = bossRules(w) ? r * BOSS_SPAWN_MUL : r;
  return out * endlessBudgetMul(w)    // v2: EXTENDED COVERAGE escalation (1 outside endless)
    * gateSpawnMul(w);                // GATEKEEPERS §6.3: GATES.spawnMul × pressure while a home gatekeeper is alive (1 otherwise)
}""")

rep("""  const b = w.boss;
  if (!b || !b.alive) {
    if (dat.bossFrameD) {""", """  const b = w.boss;
  stepPostFrame(w);
  if (!b || !b.alive) {
    // GATEKEEPERS §6.4: after a gate kill the held framing is not released while the breach tween runs —
    // a floor of max(held framing, curve(new H)) for GROW_TWEEN_S, then released at BOSS_FRAME.releaseOmega
    if (b && b.role === 'gate' && dat.bossFrameD > 0) {
      const T = w.titan;
      const curve = cameraDistance(Math.max(T.height, titanHeightAt(T.rank, T.level)));
      dat.postFrameD = Math.max(dat.bossFrameD, curve);
      dat.postFrameT = GROW_TWEEN_S;
    }
    if (dat.bossFrameD) {""")

rep("""export function stepDirector(w: World): void {
  const D = w.director, T = w.titan;
  if (w.run.result || !T.alive) return;
  stepBossFrame(w);

  // schedule tightening from the titan's growth (never pushes a time later)
  if (T.rank >= 3 && D.data.rankIVT === undefined) {""", """/** GATEKEEPERS §6.4: the post-kill framing floor (director.data.postFrameD, read by config frameDistance):
 *  held for postFrameT, then eased down to the curve at BOSS_FRAME.releaseOmega and cleared. */
function stepPostFrame(w: World): void {
  const dat = w.director.data;
  const pf = dat.postFrameD;
  if (pf === undefined || !(pf > 0)) return;
  if (dat.postFrameT > 0) { dat.postFrameT = Math.max(0, dat.postFrameT - w.dt); return; }
  const curve = cameraDistance(w.titan.height);
  const next = pf + (curve - pf) * (1 - Math.exp(-BOSS_FRAME.releaseOmega * w.dt));
  dat.postFrameD = next <= curve * 1.002 ? 0 : next;
}

export function stepDirector(w: World): void {
  const D = w.director, T = w.titan;
  if (w.run.result || !T.alive) return;
  stepBossFrame(w);

  // GATEKEEPERS §2.8: RAMROD comes ELITE_AFTER_RANK_IV_S after SWITCHBOARD-5's kill (replaces the rank IV
  // rule whenever Size IV came from that kill; the rank IV rule below stays for the open-gate skeleton)
  const k3 = w.gates.killT[3];
  if (Number.isFinite(k3) && D.data.gate3KillT === undefined) {
    D.data.gate3KillT = k3;
    if (D.data.rankIVT === undefined) D.data.rankIVT = w.t;
    D.eliteT = k3 + ELITE_AFTER_RANK_IV_S;
  }
  // schedule tightening from the titan's growth (never pushes a time later)
  if (T.rank >= 3 && D.data.rankIVT === undefined) {""")

rep("""  if (w.cheats.noSpawns) {
    D.spawnBudget = 0;
    if (w.t >= D.nextWaveT) D.nextWaveT = w.t + WAVE_MIN_S;
    return;
  }
""", """  if (w.cheats.noSpawns) {
    D.spawnBudget = 0;
    if (w.t >= D.nextWaveT) D.nextWaveT = w.t + WAVE_MIN_S;
    return;
  }
  // GATEKEEPERS §4.3: the finale — the director spawns nothing and banks nothing
  if (w.gates.finaleT > 0) {
    if (w.t >= D.nextWaveT) D.nextWaveT = w.t + WAVE_MIN_S;
    return;
  }
""")

rep("""  // ── boss ──
  if (!D.bossSpawned && w.t >= D.bossT) {
    spawnBoss(w, BIOMES[w.biomeId].boss);
    D.bossSpawned = true;
    if (!w.endless) w.run.phase = 'boss';   // v2: never overwrite 'endless'
  }

  // ── elite(s) ──
  if (!D.bossSpawned) {""", """  // ── boss ── moved to meta/gates.ts stepGates (GATEKEEPERS §4.1 / §7.3)

  // ── elite(s) ── (GATEKEEPERS §2.8: never while a gate lock, slot 1–3, is pending or any fight is alive)
  const gatePending = w.gates.pending >= 1 && w.gates.pending <= 3;
  if (!D.bossSpawned && !gatePending && !fightAlive(w)) {""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok director.ts')
