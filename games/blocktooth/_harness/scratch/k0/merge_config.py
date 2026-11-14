import sys
p = 'src/core/config.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:80]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""//   ELITE: RAMROD at min(390 s, IV+30 s), repeats every 75 s (max 3) until the boss.
""", """//   ELITE: RAMROD at min(390 s, IV+30 s), repeats every 75 s (max 3) until the boss.
//     GATEKEEPERS (lane K1a): RAMROD at SWITCHBOARD-5's kill + 30 s instead; never while a gate lock (slot 1-3) is
//     pending or any fight is alive.
//   GATES (GATEKEEPERS.md; K0 skeleton: every gate open, nothing below changes until lane K1a turns it on)
//     gate fight                               STENCIL-1 CORDON-2  SWITCHBOARD-5 city boss  (rematch at V)
//     locks at LV [RANK_LEVELS] / cap [GATES.capS] 7/165 s  16/320 s  27/430 s     35/540 s   -
//     held Size (titan H ceiling)              I 3.1 m   II 10.8 m III 25.6 m    IV 50 m    V 60-67 m
//     HP [GATE_HP_AT_RANK x GATE_HP_MUL]        1 000     4 500     20 000        BossDef x 0.8  100 000 x (1+0.5 n)
//     director budget x [GATES.spawnMul] x (1+0.35 pressure)  0.35  0.4  0.45    0.5 (BOSS_SPAWN_MUL)
//     hit cap [GATES.hitCap] 40 % of titan maxHp; dps cap [GATES.dpsCapFrac] 6 % of the rig's maxHp per 1 s window
//     GATE 2 v3 bands [GATE2_V3]: spawn 60-150 / 170-320 / 270-450 s; breach 80-210 / 210-380 / 300-500 s;
//       city boss spawn 440-560 s (never before GATES.mainEarliestS 440); gate fight 15-90 s (median 25-55)
""")

rep("""/** The framing distance everything default-zoom follows (m): the curve, widened while a boss is alive
 *  by the director's held boss framing (director.data.bossFrameD). The sim's spawn ring and the
 *  camera rig both read THIS, so spawns stay off-screen through a boss fight. Deterministic. */
export function frameDistance(w: World): number {
  const d = cameraDistance(w.titan.height);
  const b = w.boss;""", """/** The framing distance everything default-zoom follows (m): the curve, widened while a boss is alive
 *  by the director's held boss framing (director.data.bossFrameD). The sim's spawn ring and the
 *  camera rig both read THIS, so spawns stay off-screen through a boss fight. Deterministic.
 *  GATEKEEPERS §6.4: after a gate kill the director keeps a post-kill floor (director.data.postFrameD)
 *  while the MASS BREACH tween runs, so the camera never moves in as the body jumps (unset = no floor). */
export function frameDistance(w: World): number {
  let d = cameraDistance(w.titan.height);
  const pf = w.director.data.postFrameD;
  if (pf !== undefined && Number.isFinite(pf) && pf > d) d = pf;
  const b = w.boss;""")

rep("""/** Elite arrives at min(time, rank IV + 30 s); boss at min(time, rank V + 20 s). */
export const ELITE_AT_S = 390;
export const BOSS_AT_S = 540;
""", """/** Elite arrives at min(time, rank IV + 30 s); boss at min(time, rank V + 20 s). */
export const ELITE_AT_S = 390;
export const BOSS_AT_S = 540;

// ═══════════════════════════════ GATEKEEPERS (§7.2 — merged by lane K0) ═══════════════════════════════
/** GATEKEEPERS.md §1, §4, §5. Starting points; probe_gatekeepers + GATE 2 tune them. */
export const GATES = {
  /** lock → spawn (the LV step tween settles; the arrival banner plays) */
  summonDelayS: 1.5,
  /** gatekeeper walk-in, invulnerable (the city boss keeps bosses/index.ts INTRO_S 4) */
  introS: 3,
  /** entry distance = this × spawnRing(w), on the titan's heading side */
  entryRingMul: 1.15,
  /** time caps (world.t): slot s is locked at this time even below its level (index = slot; 4 = the city boss,
   *  which also needs unlocked === 3; it reuses BOSS_AT_S) */
  capS: [0, 165, 320, 430, 540] as readonly number[],
  /** the city boss (slot 4) never spawns before this world.t (= RANK_SCHEDULE_S[4] − AHEAD_GRACE_S[4]); §4.1 */
  mainEarliestS: 440,
  /** minimum seconds between a breach and the next fight's arrival */
  chainGapS: 20,
  /** × director budget while a HOME gatekeeper is alive (keyed by id, never by slot); rematches and the
   *  city boss use BOSS_SPAWN_MUL */
  spawnMul: { stencil1: 0.35, cordon2: 0.4, switchboard5: 0.45 } as Readonly<Record<GateId, number>>,
  /** engagement (§2.4): titan within band max + this × H of the rig, or a hit on it / its adds within engageHitS */
  engageMarginH: 0.5, engageHitS: 5,
  /** stuck rule (§3.0): every checkS the distance must drop by progressH × H, else DETOUR, then RAMMING THROUGH */
  stuck: { checkS: 2, progressH: 0.5, detourS: 1.5, ramS: 1.5 },
  /** hunt: past its band a gatekeeper closes at up to this × the titan's walk (pressure ≥ 2: huntHot) */
  huntClose: 0.95, huntHot: 1.05,
  /** farther than this × spawnRing for repositionS → it re-enters off-screen ahead of the titan */
  repositionRingMul: 2.2, repositionS: 4,
  /** containment pressure: +1 per everyS of NOT-engaged time (max 3), −1 per decayS engaged (§2.4) */
  pressure: { everyS: 20, decayS: 10, budgetPer: 0.35, gapPer: 0.1, dmgPer: 0.15 },
  /** no single gatekeeper hit takes more than this × titan maxHp (the city bosses keep HIT_CAP 0.55) */
  hitCap: 0.4,
  /** titan damage to a gatekeeper per TUMBLING 1 s window ≤ this × its maxHp (UPROAR / DEMOLITION exact hits exempt) */
  dpsCapFrac: 0.06,
  /** fatigue on clock = max(engagedS, 0.5 × liveFightS): engaged play wears it down at full rate, avoidance at half */
  fatigue: { startS: 40, rampPerS: 0.0006, maxPerS: 0.025 },
  /** kill reward on top of the MASS BREACH: a chest at the wreck and UPROAR points */
  reward: { uproar: 40 },
  /** home gatekeepers crush props and buildings up to this tier (keyed by id; a rematch crushes tier 4) */
  crushTier: { stencil1: 1, cordon2: 2, switchboard5: 3 } as Readonly<Record<GateId, 0 | 1 | 2 | 3 | 4>>,
  /** STENCIL-1 / CORDON-2 / SWITCHBOARD-5 stagger length (s) */
  staggerS: 4.5,
  /** Size V finale after the city boss's kill (s); the player may skip after finaleSkipS */
  finaleS: 10, finaleSkipS: 3,
} as const;
/** Gatekeeper HP by the titan's rank at spawn (× GATE_HP_MUL[id], × (1 + ENDLESS.rematchHpStep × n) in
 *  EXTENDED COVERAGE). From the gate-bot's measured single-target DPS at the held Size (median 30 / 137 /
 *  553 / 1 509 /s at LV 7 / 16 / 27 / 35) × ~37–40 s × 0.9. Index 4 = rematches at Size V (× 45/20). */
export const GATE_HP_AT_RANK: readonly number[] = [1000, 4500, 20000, 0, 100000];   // [3] unused: no gatekeeper at Size IV
export const GATE_HP_MUL: Readonly<Record<GateId, number>> = { stencil1: 1, cordon2: 1, switchboard5: 1 };
/** GATE 2 v3 (probe_sim + probe_gatekeepers). World seconds. Lane K1a switches probe_sim to these. */
export const GATE2_V3 = {
  /** gatekeeper spawn (index = slot) and breach (Size r reached = gate r's kill) bands */
  spawnBand: [[0, 0], [60, 150], [170, 320], [270, 450]] as readonly (readonly [number, number])[],
  breachBand: [[0, 0], [80, 210], [210, 380], [300, 500]] as readonly (readonly [number, number])[],
  /** the city boss spawns inside this band (LV 35 and ≥ GATES.mainEarliestS, or the cap) */
  mainSpawn: [440, 560] as readonly [number, number],
  /** levels gained from the city boss's spawn to its kill: every run ≤ max, matrix median ≤ median */
  mainFightLevels: { max: 6, median: 4 },
  /** each gate fight spawn→kill; the per-gate median must sit in the median band */
  gateFightS: [15, 90] as readonly [number, number],
  gateFightMedianS: [25, 55] as readonly [number, number],
  /** the city boss fight at Size IV (median band; per-fight hard cap is the run-time window) */
  mainFightMedianS: [60, 150] as readonly [number, number],
} as const;
/** EXTENDED COVERAGE (REPLACES ENDLESS.bossEveryS once lane K1a lands): after KEEP GOING and after every
 *  rematch dies, the next rematch comes rematchGapS later, alternating gatekeeper (G1 → G2 → G3 …) and city
 *  boss (rematchOrder). */
export const ENDLESS_V3 = { rematchGapS: 75, scorePerGateRematch: 1500 } as const;
""")

rep("""import type { DamageKind, EnemyKind, PowerUpKind, RankIndex, Shape, Tier, World } from './types.ts';""",
    """import type { DamageKind, EnemyKind, GateId, PowerUpKind, RankIndex, Shape, Tier, World } from './types.ts';""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok config.ts')
