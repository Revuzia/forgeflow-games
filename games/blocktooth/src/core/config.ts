// BLOCKTOOTH — tuning constants + the size/camera formulas (CONTRACT.md §3–§4).
// THREE-FREE. This is the single source of truth for every number another module
// would otherwise hard-code. Tune HERE (the pacing probe reads the same table).
//
// ═══════════════════════════ ECONOMY + THREAT TABLE (balance pass 2026-09-23; growth → LEVEL 2026-09-24) ═══════════════════════════
// Every number below is either a constant in this file (name in brackets) or MEASURED with the gate bot
// (_harness/bot.ts; 36-run sweep = 12 titan×biome × seeds 1337/7/99, _harness/probe_sim.ts --seed N).
//
// GROWTH (2026-09-24): SIZE is driven by LEVEL — one currency (XP). Every level-up steps the body up
// (titanHeightAt, LEVEL_GROW_S tween); RANK_LEVELS[r] is the MASS BREACH (GROW_TWEEN_S). Mass is retired:
// loot still carries it for the pickup meshes, titan.mass is a legacy mirror of SIZE progress (sizeMassMirror); the HUD / debug read sizeProgress().
//
// ECONOMY (per Size rank)                      I        II        III        IV         V
//   reached at LV [RANK_LEVELS]                 1        7         16         27         35
//   cumulative XP to reach it [cumXpAt]          0        254       1 719      5 851      10 763
//   body H on entry → last level before breach 1.2→2.66 5→9.89    14→24.2    32→47.3    60→63.5→67.2
//   per-level step [BREACH_JUMP]                +17 %    +8.9 %    +5.6 %     +5.7 %     +5.8 % (2 levels)
//   schedule [RANK_SCHEDULE_S] / gate band      0        90/60–150 210/150–300 360/280–450 480/400–560
//   canFlatten (matched tier eaten on contact)  t0       t1        t2         t3         t4
//   matched-tier floor loot xp (mass = mesh)   1 (1)    3 (5)     3 (16)     1.8 (55)   0.75 (170)
//     [lootXp = TIERS × xpScale 1/1/.5/.15/.03; SNACK_FALLOFF 0.35 per tier BELOW canFlatten]
//   growth XP × xpGain × massGain ("growth" stat) × kit (MOLO vacuum 1.25) × rubber band [paceMul]:
//     catch-up × min(3, 1 + 2.0·minBehind) after the next rank's scheduled time [CATCHUP_*];
//     Size V breach only: pace governor × max(0.35, 1 − 1.2·minEarly) when the projected breach is
//     more than 40 s early [AHEAD_*]
//   measured (seed 1337, rubber band on): Size-up s  II 70–121 · III 191–247 · IV 329–388 · V 413–483
//             ungoverned LV at 90/210/360/480 s = 6/15/26/37 (median, _harness/scratch/level_pace.ts;
//             5/14/24/34 under the mass economy)
//             early draft gap median 11.9–17.3 s · drafts per run 39–44 · LV at boss 36–37
//   36-run sweep: clears 29/36, deaths 7/36, every seed passes GATE 2 (mass economy: 28/36, 8/36, and
//     seed 99 failed the II–IV bands on VOLT-KITE/LOCKWATER) — VOLT-KITE and WHITE STACKS
//     are still where runs die (the elite window and the boss fight)
//
// THREAT (per Size rank)                       I        II        III        IV         V
//   titan hp× / dmg× [RANKS]                   1 / 1    1.8 / 3   3.2 / 8    5.5 / 20   9 / 45
//   enemy HP × (1+0.18·min) × [ENEMY_HP_RANK_MUL] 1     1         1.4        2.6        4.5
//     (TORTOISE ≈ 1 800 hp at IV / 3 600 at V; STILT MORTAR ≈ 3 950 / 8 000; RAMROD ≈ 13 500 at IV)
//   hostile dmg × hpMul × [ENEMY_DMG_RANK_MUL]  1       1.8       3.2        9.9        16.2
//     (per landed hit at IV / V: tank shell 257 / 421 · mortar 297 / 486 · RAMROD 446 / 729 · pellet 30 / 49)
//   reach + [ENEMY_REACH_H]×H: tank 45+1.3H (V ≈ 123 m ≈ the spawn ring) · walker 90+1.2H · apc 30+0.8H ·
//     buggy 25+0.5H · RAMROD lane 80+0.8H. Tells scale with H (tank lane w 2.5×(1+.035H), mortar r 6×(1+.02H),
//     rocket r 3×(1+.04H), ram w 8×(1+.02H)); min standoff stays the §9 range.
//   aim lead [ENEMY_AIM_LEAD] (× tell windup)   0        0         0.35       0.6        0.65  (mortars walk the path)
//   director budget/s = (1.2+0.9·min(t,600)/60+0.6·rank) × [DIRECTOR_BUDGET_RANK_MUL 1/1/1.3/2.0/2.6]
//     ≈ 1.9 (t 45) · 3.6 (t 120) · 7.8 (t 240) · 18 (t 400) · 27 (t 460); during the boss × 0.5 with a
//     heavy-weighted mix (director.ts BOSS_MIX: tanks/walkers/drones, little chaff)
//   heavy caps (tank/walker/apc)               —        —         10/0/6     12/6/8     14/8/8
//   measured: enemies alive (mean / heavies)   12 / 0   22 / 0    19 / 2.8   19 / 5.4
//             damage taken per rank (mean)     62       146       143        255        (boss below)
//             min HP (mean)                    72 %     76 %      88 %       79 %
//   ELITE: RAMROD at min(390 s, IV+30 s), repeats every 75 s (max 3) until the boss.
//
// BOSS (Size V; at Size IV HP × 0.8/1.15)
//   HP = BossDef.hp × [BOSS_HP_SCALE] 1.15 → CAISSON-4 218 500 · IRON GULLY 247 250
//   titan damage taken × [BOSS_KIND_MUL]: wire .4 · arc .7 · stomp .75 · magma .65 · vent .9 (others 1)
//   STRAIN/FRACTURE meter fills from dealt × strainMul / (0.45 × maxHp) (bosses/index.ts) → 5 s stagger, ×2 dmg
//   STRUCTURAL FATIGUE [BOSS_FATIGUE]: after 90 s the rig sheds 0.022 %·s⁻² × (t−90) of max HP/s (cap 1.5 %/s)
//   hit = §10 dmg × [BOSS_DMG_MUL 2.0] × phase [BOSS_PHASE_DMG_MUL .9/1.05/1.35] × hpMul 9 →
//     every hit capped at 55 % of the titan's max HP (caisson4.ts / irongully.ts HIT_CAP). CAISSON-4:
//     hookLane 486/567/729 · P1 hookDrop 486 · trolley drop –/265/340 · dash-follow 130/151/194 ·
//     boomSweep –/643/826 · legStomp –/–/1021 · IRON GULLY:
//     paw slam 972 (inner) · plate 486/567/729 · scrap flick 130/151/194 · ridge charge –/1323/1701
//     (titan V hp: VOLT 810 · BRIAR 1080 · MOLO 1260 (armor 10) · HEARTH 1530 (armor 20), before upgrades)
//   GEOMETRY (PC-02): every boss tell is authored in TITAN HEIGHTS H (bosses/index.ts bossH), not §10's
//     metres — hook drop r .55H · hook lane w .5H · winch oval 1.4H×1.0H · boom 2.6H · stomp rig+1.0H ·
//     paw rings 1.1H/2.0H · breath 3.0H · plates r .4H · charge lane w .7H. Windups are fairWindup:
//     0.35 s reaction + 0.15 s accel + walk-out ÷ the titan's walk speed × ESCAPE_K 1.1/1.0/0.9 per phase.
//     Anti dash-spam: a dash is answered by a drop just past its end (walkable, k 1) — P1 only a hot dash;
//     P2+ every dash out of live boss paint too (bosses/index.ts watchDash).
//     Measured (fullrun-policy bot port, god, 5 seeds): tells landed VOLT / MOLO — CAISSON LV 8 10.3 / 15.5 %,
//     LV 34 3.8 / 11.4 %; IRON GULLY LV 34 4.3 / 10.8 %. Before: 1–4 % / 3–10 %.
//   DASH ECONOMY vs bosses (2026-09-24): late-run VOLT-KITE dodged ~94 % of tells because its refund cards
//     (Tripwire Ordinance, Jumper Cables, Peak Commute) handed out WHOLE charges on hook/dash/kill — the pool
//     never ran dry, so the dash-follow answers never landed. Refunds now pay recharge time (engine
//     'dashRefund' p.frac → titansim refundDash): VOLT cards 20 %, Peak Commute 50 %, Emergency Exit Plan
//     (hurt, 12 s) a whole charge. Measured NOT to be the lever (VOLT LV 34 stayed 5–8 %): capping dash
//     charges at 2, move speed at 1.15, dash distance at 2.2; dash i-frames 0.3 → 0.22 changed no hit count.
//     Measured (_harness/scratch/boss_threat_pool.ts, human policy, god, 32 seeds, no adds / with adds):
//       VOLT LV 34  CAISSON 6.5 → 9.7 % / 4.8 → 9.2 % · IRON GULLY 6.7 → 12.0 % / 6.2 → 11.1 %
//       VOLT LV 8   CAISSON 12.3 → 14.3 % · IRON GULLY 13.2 → 15.5 %
//       MOLO / HEARTHBACK / BRIARWICK: identical hit counts without adds (MOLO LV 34 13.3 % / 10.3 %).
//   cadence: attack gap CAISSON 2.6/2.0/1.9 s, IRON GULLY 2.8/2.1/2.0 s (P3 × 0.7/0.75)
//   past its 60–120 m band the rig closes at up to 0.6 × the titan's walk speed (bosses/index.ts keepRange)
//   measured (36 runs): fight 71–172 s (median ≈ 120); deaths 6/36 (seed 1337: 2 of 12; seeds 7/99: 3/1) —
//     all in the boss fight or the elite window, none before 480 s. By titan: VOLT-KITE 4/9, MOLO 2/9 (the
//     seed-1337 MOLO had drafted CONDEMNED STRUCTURE + GUTTED INTERIOR: −40 % max HP), BRIARWICK 0/9,
//     HEARTHBACK 0/9 (BRIARWICK died 2–4/9 in neighbouring tunings — single-seed outcomes are noisy).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════

import type { DamageKind, EnemyKind, PowerUpKind, RankIndex, Shape, Tier, World } from './types.ts';

// ─────────────────────────────── time ───────────────────────────────
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
/** max sim ticks per rendered frame before the accumulator is dropped (spiral-of-death guard) */
export const MAX_STEPS_PER_FRAME = 5;
/** input edge buffer: a press is honoured on the first valid tick within this window (s) */
export const INPUT_BUFFER_S = 0.2;

// ─────────────────────────────── size ranks ───────────────────────────────
// SIZE is driven by LEVEL (2026-09-24, owner feedback: "the monster grows as it levels up"). XP is the
// one growth currency: every level-up raises the body a visible step (titanHeightAt), and reaching
// RANK_LEVELS[r] is the MASS BREACH into Size r. The old MASS resource no longer drives anything —
// titan.mass is kept only as a mirror of SIZE progress in the legacy units (sizeMassMirror) so a HUD
// that still reads it shows the right bar; new code reads sizeProgress().
export interface RankDef {
  name: 'I' | 'II' | 'III' | 'IV' | 'V';
  height: number;          // body height (m) on entering the rank (the MASS BREACH tween lands here)
  /** @deprecated display units only: the legacy SIZE bar length (see sizeMassMirror). Progression
   *  ignores it — ranks come from RANK_LEVELS. */
  massToNext: number;
  hpMul: number;           // × TitanDef.base.maxHp
  dmgMul: number;          // × every titan damage number (so kill times survive growth)
  speedMul: number;        // × base move speed (see titanSpeed)
  /** camera pitch (deg) at this rank. 2026-09-24: 36/38/40/42/44 → 54° at every Size with the wider
   *  GROW-INTO-THE-FRAME framing (a 38° camera at the wide Size II view sat at tower height and a
   *  foreground tower filled ~40 % of the frame; the steeper view reads the street grid + rooftops).
   *  Size I was 46° in the view lane; integration set it to 54° too (A/B at LV 1: at 46° the corner
   *  facade crowds the frame, 54° reads the zebra + the baby titan) — no pitch swing at the first breach. */
  pitchDeg: number;
  canFlatten: Tier;        // highest tier flattened on contact
  /** × the XP of city loot (floors, props, collapse bonus) while at this rank — a Size V titan
   *  levels up from the fight, not from eating a skyline it pops 20 floors a second of */
  xpScale: number;
}

export const RANKS: readonly RankDef[] = [
  { name: 'I',   height: 1.2, massToNext: 95,       hpMul: 1.0, dmgMul: 1.0,  speedMul: 1, pitchDeg: 54, canFlatten: 0, xpScale: 1 },
  { name: 'II',  height: 5.0, massToNext: 600,      hpMul: 1.8, dmgMul: 3.0,  speedMul: 1, pitchDeg: 54, canFlatten: 1, xpScale: 1 },
  { name: 'III', height: 14,  massToNext: 9000,     hpMul: 3.2, dmgMul: 8.0,  speedMul: 1, pitchDeg: 54, canFlatten: 2, xpScale: 0.5 },
  { name: 'IV',  height: 32,  massToNext: 70000,    hpMul: 5.5, dmgMul: 20,   speedMul: 1, pitchDeg: 54, canFlatten: 3, xpScale: 0.15 },
  { name: 'V',   height: 60,  massToNext: Infinity, hpMul: 9.0, dmgMul: 45,   speedMul: 1, pitchDeg: 54, canFlatten: 4, xpScale: 0.03 },
];

/** LEVEL at which each Size rank is reached (index = rank; Size I is where the run starts). Tuned so
 *  the XP economy lands each breach on RANK_SCHEDULE_S with the rubber band idle: the body now grows
 *  inside every rank and a bigger body eats and kills faster, so the gate bot's ungoverned level at
 *  90 / 210 / 360 / 480 s is 6 / 15 / 26 / 37 (median of 12 runs; it was 5 / 14 / 24 / 34 under the
 *  old mass economy). First draft of 5 / 12 / 22 / 32 put Size II–IV 40–45 % early (II at 36–67 s). */
export const RANK_LEVELS: readonly number[] = [1, 7, 16, 27, 35];
/** Per-level growth inside a rank is geometric from RANKS[r].height toward RANKS[r+1].height ÷
 *  BREACH_JUMP[r+1]; the MASS BREACH (rank-up) is one more step × BREACH_JUMP — the level-up that
 *  crosses a rank is the biggest jump of that stretch. Index = the rank being entered.
 *  Per-level step: Size I +17.3 % · II +8.9 % · III +5.6 % · IV +5.7 % · V +5.8 % (2 levels);
 *  breach step: → II ×1.88 · → III ×1.42 · → IV ×1.32 · → V ×1.27. */
export const BREACH_JUMP: readonly number[] = [1, 1.6, 1.3, 1.25, 1.2];
/** Size V has no next rank: the body keeps growing up to +RANK_V_GROWTH over RANK_V_GROWTH_LEVELS
 *  more levels (60 → 63.5 → 67.2 m). The bosses were tuned against a 67.2 m body (the old mass swell
 *  filled in ~10 s at Size V) and arrive 20 s after the breach, 1–2 levels later. Measured over
 *  36 runs (seeds 1337/7/99): spreading it over 5 levels cost 3 clears (26/36 vs 29/36). */
export const RANK_V_GROWTH = 0.12;
export const RANK_V_GROWTH_LEVELS = 2;
/** Rank-up (MASS BREACH) grow tween duration (s). Height eases (out-back) from old to new. */
export const GROW_TWEEN_S = 0.9;
/** Level-up grow tween duration (s): the per-level step, same easing. */
export const LEVEL_GROW_S = 0.45;
/** Titan collision radius as a fraction of body height. */
export const TITAN_RADIUS_PER_H = 0.42;
/** Enemies whose height < titan.height * CRUSH_RATIO are crushed on contact while the titan moves. */
export const CRUSH_RATIO = 0.45;

/** Size rank for a level (the highest rank whose RANK_LEVELS threshold the level has reached). */
export function rankForLevel(level: number): RankIndex {
  let r = 0;
  while (r < 4 && level >= RANK_LEVELS[r + 1]) r++;
  return r as RankIndex;
}

/** Body height (m) for a titan at `rank` and `level` (the settled value; the sim tweens toward it).
 *  LV 1 1.2 · 2 1.41 · 3 1.65 · 4 1.94 · 5 2.27 · 6 2.66 → LV 7 (Size II) 5.0 · LV 15 9.89 →
 *  LV 16 (III) 14 · LV 26 24.2 → LV 27 (IV) 32 · LV 34 47.3 → LV 35 (V) 60 · 36 63.5 · 37+ 67.2 m. */
export function titanHeightAt(rank: RankIndex, level: number): number {
  const H0 = RANKS[rank].height;
  if (rank >= 4) {
    const u = Math.min(1, Math.max(0, (level - RANK_LEVELS[4]) / RANK_V_GROWTH_LEVELS));
    return H0 * Math.pow(1 + RANK_V_GROWTH, u);
  }
  const H1 = RANKS[rank + 1].height / BREACH_JUMP[rank + 1];
  const L0 = RANK_LEVELS[rank], L1 = RANK_LEVELS[rank + 1];
  const u = Math.min(1, Math.max(0, (level - L0) / (L1 - L0)));
  return H0 * Math.pow(H1 / H0, u);
}

/** @deprecated (scratch view harnesses) body height for a rank + 0..1 progress through its levels. */
export function titanHeight(rank: RankIndex, progress01: number): number {
  const p = Math.min(1, Math.max(0, progress01));
  const L0 = RANK_LEVELS[rank], L1 = rank < 4 ? RANK_LEVELS[rank + 1] : L0 + RANK_V_GROWTH_LEVELS;
  return titanHeightAt(rank, L0 + p * (L1 - L0 - (rank < 4 ? 1 : 0)));
}

/** Base move speed (m/s) for a body height: heavier = slower on screen, faster in metres.
 *  speed(H) = 3.2 + 1.9 * H^0.8   →  I 5.4 · II 10.1 · III 18.9 · IV 33.6 · V 53.5 m/s (× moveSpeed stat) */
export function titanSpeed(height: number): number {
  return 3.2 + 1.9 * Math.pow(height, 0.8);
}

/** XP curve: xpToNext(level) — level starts at 1. Target ≈ LV 28–34 by the boss (~8.5 min). */
export function xpToNext(level: number): number {
  return Math.round(8 + 6 * Math.pow(level, 1.35));
}

/** Total XP banked from LV 1 to the START of `level` (Σ xpToNext over the levels below it). */
const CUM_XP: number[] = [0, 0];
export function cumXpAt(level: number): number {
  const L = Math.max(1, Math.min(10000, Math.floor(level)));
  while (CUM_XP.length <= L) { const l = CUM_XP.length - 1; CUM_XP.push(CUM_XP[l] + xpToNext(l)); }
  return CUM_XP[L];
}

/** 0..1 progress toward the next Size rank, in XP (what the HUD SIZE bar should show). Size V: 1. */
export function sizeProgress(rank: RankIndex, level: number, xp: number): number {
  if (rank >= 4) return 1;
  const a = cumXpAt(RANK_LEVELS[rank]), b = cumXpAt(RANK_LEVELS[rank + 1]);
  return Math.min(1, Math.max(0, (cumXpAt(level) + Math.max(0, xp) - a) / Math.max(1, b - a)));
}

/** Levels still to gain before the next Size rank (0 at Size V). */
export function levelsToNextSize(rank: RankIndex, level: number): number {
  return rank >= 4 ? 0 : Math.max(0, RANK_LEVELS[rank + 1] - level);
}

/** Legacy mirror the sim writes into titan.mass every tick: Σ massToNext of the ranks below +
 *  sizeProgress × this rank's massToNext. A view that still computes (mass − Σ massToNext) /
 *  massToNext therefore shows the level-driven SIZE bar. @deprecated read sizeProgress() instead. */
export function sizeMassMirror(rank: RankIndex, level: number, xp: number): number {
  let base = 0;
  for (let i = 0; i < rank; i++) base += RANKS[i].massToNext;
  const span = RANKS[rank].massToNext;
  return Number.isFinite(span) ? base + sizeProgress(rank, level, xp) * span : base;
}

/** Pacing schedule (s since run start) the rubber band targets: when each Size rank is due. Growth
 *  XP gets a catch-up multiplier while the run is behind the NEXT rank's time:
 *  mul = 1 + CATCHUP_PER_MIN × minutesBehind (cap CATCHUP_MAX). */
export const RANK_SCHEDULE_S: readonly number[] = [0, 90, 210, 360, 480];
export const CATCHUP_PER_MIN = 2.0;
export const CATCHUP_MAX = 3;
/** The other half of the rubber band (next rank ≥ AHEAD_FROM_RANK, i.e. the Size V breach): a pace
 *  governor projects the next breach from the average XP rate since entering the current rank; a
 *  titan on course to breach more than AHEAD_GRACE_S[next] before RANK_SCHEDULE_S[next] banks XP at
 *  max(AHEAD_MIN, 1 − AHEAD_PER_MIN × minutesEarly) — slow eaters are never touched. It slows DRAFTS
 *  too now (XP is the only currency), so it stays on the last breach only, as before: with
 *  RANK_LEVELS tuned the ungoverned Size II–IV times sit inside their bands, and AHEAD_FROM_RANK = 1
 *  (graces below, each inside its gate band's floor II 60 · III 150 · IV 280 s) changed nothing in the
 *  36-run sweep. It is the lever if a faster eater ever breaks the II–IV floors. */
export const AHEAD_FROM_RANK = 4;
export const AHEAD_GRACE_S: readonly number[] = [0, 20, 35, 45, 40];
export const AHEAD_PER_MIN = 1.2;
export const AHEAD_MIN = 0.35;

// ─────────────────────────────── destruction tiers ───────────────────────────────
export interface TierDef {
  floorHp: number;         // HP per floor (props: HP of the prop)
  floorXp: number;         // XP dropped per floor broken
  floorMass: number;       // mass on the rubble per floor broken — sizes the pickup meshes only (SIZE is level-driven)
  collapseBonus: number;   // extra XP+mass multiplier burst when the building collapses (× floors)
  tonsPerFloor: number;    // cosmetic tabloid tonnage
}
export const TIERS: readonly TierDef[] = [
  { floorHp: 3,    floorXp: 1,  floorMass: 1,   collapseBonus: 0.5, tonsPerFloor: 2 },
  { floorHp: 18,   floorXp: 3,  floorMass: 5,   collapseBonus: 0.5, tonsPerFloor: 60 },
  { floorHp: 80,   floorXp: 6,  floorMass: 16,  collapseBonus: 0.5, tonsPerFloor: 400 },
  { floorHp: 340,  floorXp: 12, floorMass: 55,  collapseBonus: 0.5, tonsPerFloor: 1800 },
  { floorHp: 1300, floorXp: 25, floorMass: 170, collapseBonus: 0.5, tonsPerFloor: 6000 },
];
/** Snack rule: city loot of a tier BELOW the titan's canFlatten is worth SNACK_FALLOFF^(tiers
 *  below) of its table value — props are snacks once shops are on the menu. */
export const SNACK_FALLOFF = 0.35;

/** XP one floor / prop of `tier` drops for a titan at `rank` (CONTRACT §5.4 rubble value
 *  × the snack rule × RANKS[rank].xpScale). Used by citysim, the upgrade engine and the bot. */
export function lootXp(tier: Tier, rank: RankIndex): number {
  const below = RANKS[rank].canFlatten - tier;
  return TIERS[tier].floorXp * RANKS[rank].xpScale * (below > 0 ? Math.pow(SNACK_FALLOFF, below) : 1);
}

/** Mass one floor / prop of `tier` drops for a titan at `rank` (table value × the snack rule). Since
 *  2026-09-24 it grows nothing (titansim gainMass is retired); the pickup view sizes chunks by it. */
export function lootMass(tier: Tier, rank: RankIndex): number {
  const below = RANKS[rank].canFlatten - tier;
  return TIERS[tier].floorMass * (below > 0 ? Math.pow(SNACK_FALLOFF, below) : 1);
}

/** Attacks against a building/prop whose tier > the rank's canFlatten deal this fraction. */
export const OVERSIZE_DAMAGE_MUL = 0.25;
/** Contact smash: titan must move faster than this fraction of its max speed. */
export const SMASH_MIN_SPEED_FRAC = 0.3;
/** Plowing through flattenable buildings slows the titan to this fraction. */
export const SMASH_SLOW = 0.65;

// ─────────────────────────────── city ───────────────────────────────
export const CITY = {
  pitch: 72,               // road centreline to road centreline (m)
  roadW: 14,               // carriageway width (2 lanes each way, 3.5 m)
  sidewalkW: 3,            // sidewalk ring inside each block cell
  laneW: 3.5,
  crosswalkW: 4,           // zebra depth along the road (m)
  /** blocks around the titan rendered with full per-floor detail (Chebyshev radius) */
  liveRadiusByRank: [2, 2, 2, 3, 3] as readonly number[],
  maxPickups: 600,
  maxEnemies: 320,
  maxProjectiles: 400,
} as const;

/** Parcel (buildable) half-size of a block: (pitch - roadW)/2 - sidewalkW = 26 m */
export const PARCEL_HALF = (CITY.pitch - CITY.roadW) / 2 - CITY.sidewalkW;

// ─────────────────────────────── camera (formulas; view reads these) ───────────────────────────────
export const CAMERA = {
  fovDeg: 30,              // slight perspective
  yawDeg: 45,              // camera sits at +X+Z of the target, looking toward −X−Z
  /** look-ahead along velocity (s) */
  leadS: 0.25,
  /** target height above ground as a fraction of titan height */
  targetYFrac: 0.45,
  /** critically-damped spring rate for distance (1/s) */
  zoomOmega: 4,
  /** smoothing rate (1/s) of the boss-framing look-target offset in the rig (frameOffset) */
  frameOffOmega: 5,
  /** rank-up punch: distance dips by this fraction then eases out over punchS */
  punchFrac: 0.08, punchS: 1.2,
  /** shake amplitude per metre of titan height on a heavy stomp */
  shakePerH: 0.02,
} as const;

// ── auto framing: ONE run-long curve — the titan grows on screen level by level (2026-09-24) ──
/**
 * Auto camera distance is ONE smooth, non-decreasing function of body height for the whole run — a
 * power law whose log-log slope eases up gently with size (x = ln(H / h1), H ≥ h1):
 *   ln D*(H) = ln D1 + k1·x + c·x²,   D1 = h1 / (frac1·K),   c solved so D*(hV) = hV / (fracV·K)
 * (K = 2·tan(fov/2)). The local exponent k(H) = k1 + 2c·x stays inside (0, 1) over the whole growth
 * range (0.57 at LV 1 → 0.86 at Size V, asserted at load), so the body's share of the view height,
 * H / (D*·K), RISES with every level and every MASS BREACH (the body jumps × BREACH_JUMP, the camera
 * follows the same curve and pulls back LESS than the body grew) and the camera never moves in as the
 * titan grows. There is no per-rank reset (the old per-rank framing made each breach a sawtooth: the
 * camera pulled back 2.9–3.5× while the body grew 1.3–1.9×, so the monster looked SMALLER after the
 * three biggest growth moments).
 * Why the slope eases up instead of one fixed k: Size I is pinned (k1 = the round-1 single-k curve, so
 * LV 1–6 and the off-screen spawn ring — GATE 2's Size II band — are unchanged within 2 %), while the
 * late game had to open up: with one k the Size V silhouette (every body vertex projected, 4 headings)
 * filled ~47 % of the screen height for VOLT-KITE (~70 % for MOLO's long body) — far more monster than
 * the reference's late frames — and hid most of the map behind the body.
 * Two on-screen measures (growthseq.py projects both through the live camera):
 *   foot→head — the titan's base-to-crown segment (≈ 0.59 × H / (D·K) at the 54° pitch)
 *   silhouette — the vertical extent of the whole posed body (long bodies read 2.4–3.4× foot→head)
 * Current curve (frac1 0.066, fracV 0.20) — D / foot→head share on screen (framing_table.ts prints
 * every level; the README camera table has the measured silhouette shares):
 *   LV  1  H 1.2  D  34 m  3.9 % (a whole intersection, the baby titan on its zebra)
 *   LV  6  H 2.7  D  55 m  5.3 %  → LV  7 (Size II)  H  5.0  D  83 m  6.6 %
 *   LV 15  H 9.9  D 134 m  8.1 %  → LV 16 (Size III) H 14    D 173 m  8.9 %
 *   LV 26  H 24   D 265 m 10.0 %  → LV 27 (Size IV)  H 32    D 331 m 10.6 %
 *   LV 34  H 47   D 457 m 11.3 %  → LV 35 (Size V)   H 60    D 560 m 11.8 %  · LV 37+ H 67 D 617 m 11.9 %
 * frac1 0.066 (was 0.062): this working tree's Size I economy sat at the top of GATE 2's 60–150 s
 * Size II band (seed 1337 at the old 0.062: two runs at 152 / 167 s); a 6 % tighter Size I view puts
 * the off-screen spawn ring nearer and brings seeds 1337 / 7 / 99 / 11 / 23 / 41 to a 139–146 s worst.
 * The spawn ring (ai/enemies.ts) reads the same curve; while a boss is alive the director widens it
 * (bossFrameNeed / BOSS_FRAME, never below the curve) and the camera follows that widening too.
 */
export const FRAMING = {
  /** reference body height (m, Size I at LV 1) and its analytic share H / (D·K) there */
  h1: 1.2, frac1: 0.066,
  /** log-log slope of D*(H) at LV 1 (= the round-1 single-k curve through Size I) */
  k1: 0.573,
  /** Size V entry body height (m) and its analytic share there */
  hV: 60, fracV: 0.20,
} as const;
/** Player zoom (view-only; the sim never reads it): a multiplier on the auto distance, clamped to
 *  [ZOOM_MIN, ZOOM_MAX] and to the absolute band D_ABS_MIN ≤ D ≤ D_ABS_MAX (m). The far cap binds
 *  from LV 34 on (the curve passes 440 m there and is 560–617 m at Size V, so the zoom-out tops out
 *  at 880 m ≈ 1.4–1.6×): at 880 m the whole district (≤ 14 × 72 m blocks) already fits the view, the
 *  sun's shadow box (render/lighting.ts) is sized to cover exactly that view (half-size ≤ 860 m), and the
 *  frame budget is measured there (perfcheck --zoom max). LV 1–33 keep the full 2×. */
export const CAMERA_ZOOM = {
  min: 0.55, max: 2.0,
  dAbsMin: 12, dAbsMax: 880,
  /** smoothing rate of ln(zoom) (1/s) — quick but not a snap */
  omega: 11,
} as const;

const CAM_K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
/** the run-long framing curve's constants, derived from FRAMING: LV 1 distance, the slope at LV 1 and
 *  the slope's growth (see FRAMING) */
const FRAME_D1 = FRAMING.h1 / (FRAMING.frac1 * CAM_K);
const FRAME_XV = Math.log(FRAMING.hV / FRAMING.h1);
const FRAME_C = (Math.log(FRAMING.hV / (FRAMING.fracV * CAM_K) / FRAME_D1) - FRAMING.k1 * FRAME_XV) / (FRAME_XV * FRAME_XV);
/** local log-log slope of the curve at body height H (0 < k < 1 keeps the share rising) */
function frameSlope(H: number): number {
  return FRAMING.k1 + 2 * FRAME_C * Math.max(0, Math.log(Math.max(1e-6, H) / FRAMING.h1));
}
// the whole growth range (≤ Size V's cap, with room for rank-V growth tuning) must keep 0 < k < 1
{
  const kHi = frameSlope(FRAMING.hV * 1.5);
  if (!(FRAMING.k1 > 0 && FRAME_C >= 0 && kHi < 1)) {
    throw new Error(`FRAMING: slope must stay in (0, 1) — k1 ${FRAMING.k1} c ${FRAME_C} k(1.5·hV) ${kHi}`);
  }
}

/** AUTO camera distance D* (m) from the look target for a body height (no player zoom, no punch, no
 *  boss widening) — see FRAMING. Smooth and non-decreasing in H for the whole run; `rank` is accepted
 *  for old callers and ignored. The camera rig springs toward it; the SIM's spawn ring reads it too
 *  (ai/enemies.ts frameDistance), so foes walk in from off-screen at the default zoom. */
export function cameraDistance(height: number, _rank?: RankIndex): number {
  const H = Math.max(0.05, Number.isFinite(height) ? height : FRAMING.h1);
  const x = Math.log(H / FRAMING.h1);
  const xp = x > 0 ? x : 0;
  return FRAME_D1 * Math.exp(FRAMING.k1 * x + FRAME_C * xp * xp);
}

/** Analytic share of the view height a body height H occupies at the AUTO distance (H / (D*·K)). */
export function autoFrameFrac(height: number, _rank?: RankIndex): number {
  return height / (cameraDistance(height) * CAM_K);
}

/** The framing curve's constants (for probes / the debug overlay): D1, h1, the LV 1 slope k (= k1),
 *  the slope growth c, and the local slope at Size V entry (kV). */
export function framingCurve(): { D1: number; h1: number; k: number; c: number; kV: number } {
  return { D1: FRAME_D1, h1: FRAMING.h1, k: FRAMING.k1, c: FRAME_C, kV: frameSlope(FRAMING.hV) };
}
/** @deprecated per-rank view of the single curve (H0 = RANKS[r].height, k = the curve's local slope there). */
export function framingTable(): readonly { H0: number; k: number }[] {
  return RANKS.map((R) => ({ H0: R.height, k: frameSlope(R.height) }));
}

/** Visible ground footprint around the look target in units of D·K (a trapezoid at the camera
 *  pitch): n = near (bottom) edge, f = far (top) edge, hn / hf = half-widths at those edges,
 *  s = (hf − hn) / (n + f). Aspect = width / height of the view. */
export function viewFootprint(pitchDeg: number, aspect = 16 / 9): { n: number; f: number; hn: number; hf: number; s: number } {
  const al = (CAMERA.fovDeg * Math.PI) / 360, p = (pitchDeg * Math.PI) / 180;
  const h = Math.sin(p), b = Math.cos(p), tw = Math.max(0.3, aspect) * Math.tan(al) * Math.cos(al);
  const n = (b - h / Math.tan(p + al)) / CAM_K;
  const f = (p - al > 0.05 ? h / Math.tan(p - al) - b : 4) / CAM_K;
  const hn = (h / Math.sin(p + al)) * tw / CAM_K;
  const hf = (p - al > 0.05 ? (h / Math.sin(p - al)) * tw : 4) / CAM_K;
  return { n, f, hn, hf, s: (hf - hn) / (n + f) };
}

/** BOSS FRAMING: while a boss is alive the default-zoom view keeps the boss rig, every live boss
 *  telegraph AND the titan in frame (16:9): first by widening the auto distance (never below the
 *  curve); when the fight is lopsided (a paw-slam ring 2 H around a boss 60 m away, a 3 H breath cone)
 *  the look target also slides toward the fight's centre, which frames the same paint from far closer
 *  than widening alone (a paw slam needed the 2× cap without the slide). Measured at LV 37, curve 617 m
 *  (_harness/scratch/view/bossframe.py, tell 70–92 % through its windup, every framed point in view):
 *  paw slam 659 m · breath cone 618 m · boom sweep, leg stomp, winch, ridge charge 617 m (the curve).
 *  (At the round-1 362 m curve the same attacks needed 428–647 m.)
 *  margin — × the tightest fit (screen-edge breathing room + the corner HUD panels + the camera's lead)
 *  topNdc — nothing framed above this height of the frame (ndc y): the boss nameplate + hint bar sit
 *           across the top ~20 % of the screen and hid the titan's head in a paw-slam shot
 *  maxMul — never wider than this × the curve (a boss walking in from 230 m, a far chase)
 *  holdS / releaseOmega — the director holds a widening this long after it is no longer needed,
 *  then eases back at this rate (1/s), so the camera does not pump in and out with every attack
 *  offsetOmega — the director eases the look-target offset toward its target at this rate (1/s). */
export const BOSS_FRAME = { margin: 1.12, topNdc: 0.58, maxMul: 2.0, holdS: 1.6, releaseOmega: 1.0, offsetOmega: 3.5 } as const;

/** scratch for bossFrameNeed: the framed points relative to the titan (world dx, dz, height y) and the
 *  same points in screen-aligned ground metres (u across, v toward the top of the screen, v including
 *  the height lift y·cot(pitch)) for the cheap footprint estimate that picks the look-target offset */
const BF_X: number[] = [], BF_Z: number[] = [], BF_Y: number[] = [];
const BF_U: number[] = [], BF_V: number[] = [];
const BF_OUT = { d: 0, ox: 0, oz: 0 };
const BF = { n: 0, dLo: 0, dHi: 0, ty: 0, ox: 0, oy: 0, oz: 0, ux: 0, uy: 0, uz: 0, rx: 0, rz: 0 };
const BF_TAN = Math.tan((CAMERA.fovDeg * Math.PI) / 360), BF_ASPECT = 16 / 9;
/** Tightest framing need (in units of D·K) of the scratch points around the screen-space centre (u0, v0)
 *  from the ground-footprint trapezoid (an estimate — picks the offset; the distance is fitted exactly). */
function bfNeed(n: number, u0: number, v0: number, FP: { n: number; f: number; hn: number; s: number }): number {
  let need = 0;
  const den = FP.hn + FP.s * FP.n;
  for (let i = 0; i < n; i++) {
    const v = BF_V[i] - v0, u = Math.abs(BF_U[i] - u0);
    let k = v > 0 ? v / FP.f : -v / FP.n;
    const kw = (u - FP.s * v) / den;
    if (kw > k) k = kw;
    if (k > need) need = k;
  }
  return need;
}
/** How far the scratch points reach toward the frame edges for the default-zoom camera (the rank's
 *  pitch, fixed yaw, 16:9) at distance D looking at the titan + (ox, oz) at the rig's target height — the
 *  projection the spawn ring uses (ai/enemies.ts screenOut) — as a fraction of the usable frame:
 *  |ndc x| and the bottom × BOSS_FRAME.margin, the top against BOSS_FRAME.topNdc. ≤ 1 = framed. */
function bfNdc(D: number, ox: number, oz: number): number {
  const cx = ox + D * BF.ox, cy = BF.ty + D * BF.oy, cz = oz + D * BF.oz;
  let m = 0;
  for (let i = 0; i < BF.n; i++) {
    const dx = BF_X[i] - cx, dy = BF_Y[i] - cy, dz = BF_Z[i] - cz;
    const depth = -(dx * BF.ox + dy * BF.oy + dz * BF.oz);
    if (!(depth > 0.1)) return Infinity;
    const sx = Math.abs((dx * BF.rx + dz * BF.rz) / depth) / (BF_TAN * BF_ASPECT) * BOSS_FRAME.margin;
    const syr = (dx * BF.ux + dy * BF.uy + dz * BF.uz) / depth / BF_TAN;
    const sy = syr > 0 ? syr / BOSS_FRAME.topNdc : -syr * BOSS_FRAME.margin;
    if (sx > m) m = sx; if (sy > m) m = sy;
  }
  return m;
}
/** Smallest distance in [dLo, dHi] (the curve … maxMul × the curve) at which every scratch point sits
 *  inside the usable frame around the offset (bfNdc ≤ 1; bisection; dHi when even that fails). */
function bfFit(ox: number, oz: number): number {
  const lim = 1;
  if (bfNdc(BF.dLo, ox, oz) <= lim) return BF.dLo;
  let lo = BF.dLo, hi = BF.dHi;
  if (bfNdc(hi, ox, oz) > lim) return hi;
  for (let it = 0; it < 16; it++) {
    const mid = (lo + hi) / 2;
    if (bfNdc(mid, ox, oz) <= lim) hi = mid; else lo = mid;
  }
  return hi;
}

/** What the boss framing needs this tick (d = 0 when no boss): the smallest distance d and look-target
 *  offset (ox, oz from the titan, world metres) that keep the boss rig (every part's ground circle and
 *  its top), every live boss-owned telegraph and the titan itself inside the default-zoom frame with
 *  BOSS_FRAME.margin to spare (projected exactly through the rig's camera), d between the curve and
 *  maxMul × it. No offset while the curve's own view (centred on the titan) already holds everything;
 *  otherwise the smallest shift toward the fight's centre that does (or the full centring, widened).
 *  THREE-free and deterministic: the director eases/holds it (director.data.bossFrameD / bossFrameOx /
 *  bossFrameOz) for the spawn ring AND the camera. The returned object is reused. */
export function bossFrameNeed(w: World): { d: number; ox: number; oz: number } {
  BF_OUT.d = 0; BF_OUT.ox = 0; BF_OUT.oz = 0;
  BF.n = 0;
  const b = w.boss;
  if (!b || !b.alive) return BF_OUT;
  const T = w.titan;
  const pitch = RANKS[T.rank]?.pitchDeg ?? 54;
  const FP = viewFootprint(pitch);
  const pr = (pitch * Math.PI) / 180, cot = 1 / Math.tan(pr);
  const yaw = (CAMERA.yawDeg * Math.PI) / 180, sy = Math.sin(yaw), cy = Math.cos(yaw);
  const cp = Math.cos(pr), sp = Math.sin(pr);
  BF.ox = cp * sy; BF.oy = sp; BF.oz = cp * cy;          // target → camera (unit)
  BF.ux = -sp * sy; BF.uy = cp; BF.uz = -sp * cy;        // camera up
  BF.rx = cy; BF.rz = -sy;                                // camera right
  BF.ty = T.height * CAMERA.targetYFrac;
  const cx = T.x, cz = T.z;
  let n = 0;
  const pt = (x: number, z: number, y: number): void => {
    const dx = x - cx, dz = z - cz;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
    const yy = Math.max(0, Number.isFinite(y) ? y : 0);
    BF_X[n] = dx; BF_Z[n] = dz; BF_Y[n] = yy;
    BF_U[n] = dx * cy - dz * sy;                          // across the screen
    BF_V[n] = -(dx * sy + dz * cy) + yy * cot;            // + = toward the top of the screen
    n++;
  };
  const R = Math.max(0.5, T.radius || T.height * TITAN_RADIUS_PER_H);
  pt(cx + R, cz, 0); pt(cx - R, cz, 0); pt(cx, cz + R, 0); pt(cx, cz - R, 0); pt(cx, cz, T.height);
  for (let i = 0; i < b.parts.length; i++) {
    const p = b.parts[i];
    pt(p.x + p.r, p.z, 0); pt(p.x - p.r, p.z, 0); pt(p.x, p.z + p.r, 0); pt(p.x, p.z - p.r, 0);
    pt(p.x, p.z, p.y1);
  }
  for (let i = 0; i < w.telegraphs.length; i++) {
    const tg = w.telegraphs[i];
    if (!tg.alive || tg.owner !== 'boss') continue;
    shapePoints(tg.shape, pt);
  }
  BF.n = n;
  const dCurve = cameraDistance(T.height);
  BF.dLo = dCurve; BF.dHi = BOSS_FRAME.maxMul * dCurve;
  const d0 = bfFit(0, 0);
  let d = d0, ox = 0, oz = 0;
  if (d0 > dCurve) {
    // the fight's centre in screen terms (footprint estimate), then fitted exactly
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < n; i++) {
      if (BF_U[i] < umin) umin = BF_U[i]; if (BF_U[i] > umax) umax = BF_U[i];
      if (BF_V[i] < vmin) vmin = BF_V[i]; if (BF_V[i] > vmax) vmax = BF_V[i];
    }
    // usable frame: the bottom at 1 / margin, the top at topNdc (the nameplate) — as ground reach
    const ta = Math.tan((CAMERA.fovDeg * Math.PI) / 360);
    const bTop = Math.atan(BOSS_FRAME.topNdc * ta), bBot = Math.atan(ta / BOSS_FRAME.margin);
    const fU = pr - bTop > 0.05 ? sp / Math.tan(pr - bTop) - cp : 4, nU = cp - sp / Math.tan(pr + bBot);
    const uc = (umin + umax) / 2, vc0 = (fU * vmin + nU * vmax) / (nU + fU);
    // screen (u, v) → world: u along (cos yaw, −sin yaw), v along (−sin yaw, −cos yaw)
    let oxc = 0, ozc = 0, d1 = Infinity;
    const span = Math.max(1, vmax - vmin);
    for (let j = -2; j <= 2; j++) {
      const vc = vc0 + j * 0.08 * span;
      const x = uc * cy - vc * sy, z = -uc * sy - vc * cy;
      const dj = bfFit(x, z);
      if (dj < d1 - 1e-6) { d1 = dj; oxc = x; ozc = z; }
    }
    if (d1 < d0) {
      if (d1 <= dCurve) {
        // the curve's own distance suffices with part of the shift: the smallest such shift
        const lim = 1;
        let lo = 0, hi = 1;
        for (let it = 0; it < 10; it++) {
          const s = (lo + hi) / 2;
          if (bfNdc(dCurve, oxc * s, ozc * s) <= lim) hi = s; else lo = s;
        }
        ox = oxc * hi; oz = ozc * hi; d = dCurve;
      } else { ox = oxc; oz = ozc; d = d1; }
    }
  }
  BF_OUT.d = d; BF_OUT.ox = ox; BF_OUT.oz = oz;
  return BF_OUT;
}

/** Distance (m) that frames the points of the LAST bossFrameNeed call (same tick) around a given
 *  look-target offset (world m from the titan) — the director uses it for the offset the rig actually
 *  has while it is still sliding toward the need's, so the frame never clips mid-slide. 0 when that
 *  call had no boss. */
export function bossFrameFitAt(ox: number, oz: number): number {
  if (BF.n <= 0) return 0;
  return bfFit(ox, oz);
}

/** The framing distance everything default-zoom follows (m): the curve, widened while a boss is alive
 *  by the director's held boss framing (director.data.bossFrameD). The sim's spawn ring and the
 *  camera rig both read THIS, so spawns stay off-screen through a boss fight. Deterministic. */
export function frameDistance(w: World): number {
  const d = cameraDistance(w.titan.height);
  const b = w.boss;
  if (!b || !b.alive) return d;
  const bd = w.director.data.bossFrameD;
  return Number.isFinite(bd) && bd > d ? bd : d;
}

/** Look-target offset (world m, from the titan) of the default-zoom framing: the director's eased
 *  boss framing offset while a boss is alive, else 0. The spawn ring and the camera read it. */
const FO = { x: 0, z: 0 };
export function frameOffset(w: World): { x: number; z: number } {
  FO.x = 0; FO.z = 0;
  const b = w.boss;
  if (!b || !b.alive) return FO;
  const ox = w.director.data.bossFrameOx, oz = w.director.data.bossFrameOz;
  if (Number.isFinite(ox) && Number.isFinite(oz)) { FO.x = ox; FO.z = oz; }
  return FO;
}

/** The default-zoom view the camera is SHOWING, as the sim can know it (m / world m from the titan):
 *  distance = max(frameDistance, the director's replica of the rig's distance spring) and the rig's
 *  smoothed look-target offset (director.data.camD / camOx / camOz, stepped with CAMERA.zoomOmega /
 *  frameOffOmega while a boss is alive). The rig lags a boss-framing RELEASE (it is still wider than
 *  frameDistance) and a slide of the offset — the spawn ring must stay off THAT view, not the target's.
 *  Without a boss it is exactly the curve centred on the titan (the rig only lags growth, which is
 *  narrower = safe). Deterministic; the returned object is reused. */
const SV = { d: 0, ox: 0, oz: 0 };
export function spawnView(w: World): { d: number; ox: number; oz: number } {
  SV.d = frameDistance(w); SV.ox = 0; SV.oz = 0;
  const b = w.boss;
  if (!b || !b.alive) return SV;
  const dat = w.director.data;
  if (Number.isFinite(dat.camD) && dat.camD > SV.d) SV.d = dat.camD;
  if (Number.isFinite(dat.camOx) && Number.isFinite(dat.camOz)) { SV.ox = dat.camOx; SV.oz = dat.camOz; }
  return SV;
}

/** Outline sample points of an area shape (ground level). */
function shapePoints(s: Shape, pt: (x: number, z: number, y: number) => void): void {
  switch (s.k) {
    case 'circle': case 'ring': {
      const r = s.k === 'circle' ? s.r : s.r1;
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; pt(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, 0); }
      break;
    }
    case 'cone': {
      pt(s.x, s.z, 0);
      for (let i = 0; i <= 6; i++) { const a = s.dir - s.half + (2 * s.half * i) / 6; pt(s.x + Math.sin(a) * s.r, s.z + Math.cos(a) * s.r, 0); }
      break;
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir), h = s.w / 2;
      const ex = s.x + fx * s.len, ez = s.z + fz * s.len;
      pt(s.x + fz * h, s.z - fx * h, 0); pt(s.x - fz * h, s.z + fx * h, 0);
      pt(ex + fz * h, ez - fx * h, 0); pt(ex - fz * h, ez + fx * h, 0);
      break;
    }
    case 'oval': {
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, lx = Math.sin(a) * s.rx, lz = Math.cos(a) * s.rz;
        pt(s.x + lx * fz + lz * fx, s.z - lx * fx + lz * fz, 0);
      }
      break;
    }
    case 'capsule': {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, ox = Math.sin(a) * s.r, oz = Math.cos(a) * s.r;
        pt(s.x0 + ox, s.z0 + oz, 0); pt(s.x1 + ox, s.z1 + oz, 0);
      }
      break;
    }
    default: break;
  }
}

/** Near/far planes that keep depth precision sane across a 30× zoom range. */
export function cameraClip(distance: number): { near: number; far: number } {
  return { near: Math.max(0.1, distance * 0.02), far: distance * 6 + 400 };
}

/** Screen-space stick (ix right, iy up) → world XZ move vector for the fixed camera yaw.
 *  fwd = (−sin ψ, −cos ψ), right = (cos ψ, −sin ψ). Deterministic: uses the constant yaw. */
export function screenToWorld(ix: number, iy: number): { mx: number; mz: number } {
  const psi = (CAMERA.yawDeg * Math.PI) / 180;
  const s = Math.sin(psi), c = Math.cos(psi);
  let mx = c * ix - s * iy;
  let mz = -s * ix - c * iy;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  return { mx, mz };
}

// ─────────────────────────────── combat / run ───────────────────────────────
export const TITAN = {
  dashS: 0.22,             // dash duration (s)
  dashIframes: 0.3,
  hurtIframes: 0.35,
  regenDelayS: 3,          // regen pauses this long after taking damage
} as const;

/** Enemy stats scale with elapsed minutes: hp × (1 + ENEMY_HP_PER_MIN · min), dmg × rankHpMul. */
export const ENEMY_HP_PER_MIN = 0.18;
/** × enemy HP at spawn by the titan's rank (on top of the per-minute ramp). The titan's damage
 *  grows ×45 from Size I to V while the minute ramp only gives ×2.5, so without this every heavy
 *  died before its first shot at Size IV–V (measured: 0–4 hostile paints per 100 s). */
export const ENEMY_HP_RANK_MUL: readonly number[] = [1, 1, 1.4, 2.6, 4.5];
/** × hostile damage by the titan's rank, on top of RANKS[rank].hpMul (§5.4). */
export const ENEMY_DMG_RANK_MUL: readonly number[] = [1, 1, 1, 1.8, 1.8];
/** Engagement reach grows with the titan: effective range = EnemyDef.range + this × titan height (m).
 *  A 60 m titan is a target a tank can hit from the edge of the screen; without it the heavies
 *  crawled 20 s from the spawn ring before they could fire and the titan had eaten its way off. */
export const ENEMY_REACH_H: Readonly<Record<string, number>> = {
  android: 0.15, squad: 0.2, drone: 0, buggy: 0.5, apc: 0.8, tank: 1.3, walker: 1.2, elite: 0.8,
};
/** × the MASS an enemy kill drops, by the titan's rank. Since 2026-09-24 mass grows nothing (SIZE is
 *  level-driven; kills feed growth through their XP, which city loot's xpScale does not cut), so this
 *  only sizes the scrap meshes and splits the drop into 1–4 chunks (combat/damage.ts killEnemy). */
export const KILL_MASS_RANK_MUL: readonly number[] = [1, 1, 3, 25, 30];
/** Aim lead by titan rank: heavier tells (tank lanes, rockets, mortar barrages, dives, the RAMROD
 *  lane) are painted where the titan WILL be after this fraction of the tell's windup at its current
 *  velocity. The paint is on the ground for the whole windup, so it stays an honest tell — but a
 *  titan that just keeps walking no longer out-runs every shell (measured: 97–100 % of hostile
 *  paint dodged at Size III–V before this). Mortar barrages walk along the predicted path. */
export const ENEMY_AIM_LEAD: readonly number[] = [0, 0, 0.35, 0.6, 0.65];
/** Director spawn budget × this by titan rank (the §9 rate is tuned for Size I–II bodies). */
export const DIRECTOR_BUDGET_RANK_MUL: readonly number[] = [1, 1, 1.3, 2.0, 2.6];
/** Boss HP × this per rank reached when it spawns (it expects Size V, copes with IV). */
export const BOSS_HP_SCALE: readonly number[] = [0.2, 0.3, 0.45, 0.8, 1.15];
/** STRUCTURAL FATIGUE: a containment rig that has been fighting for longer than `startS` (after its
 *  intro) starts shedding plates — it loses `rampPerS` × (fightT − startS) of its max HP per second
 *  (capped at `maxPerS`), on top of the titan's damage. Pins the long tail of the fight length
 *  (measured without it: 58–259 s over 36 runs; titans whose auto-attacks were soaked by adds, or
 *  that got kited by a P3 cadence, dragged fights past 200 s). The view may read boss.data.fatigue. */
export const BOSS_FATIGUE = { startS: 90, rampPerS: 0.00022, maxPerS: 0.015 } as const;
/** × titan damage a boss takes, by DamageKind (1 when absent). The containment rigs are grounded,
 *  insulated heavy plant: chain lightning and live wire bleed into the ground, and heat soaks into
 *  the hull. Without it VOLT-KITE / HEARTHBACK melted a boss 2–3× faster than MOLO / BRIARWICK
 *  (measured boss DPS medians over 3 seeds: 3000 / 2100 vs 1300 / 1150). */
export const BOSS_KIND_MUL: Readonly<Partial<Record<DamageKind, number>>> = {
  wire: 0.4, arc: 0.7, stomp: 0.75, magma: 0.65, vent: 0.9,
};
/** × every boss attack's §10 damage (then × RANKS[titan.rank].hpMul, §5.4). */
export const BOSS_DMG_MUL = 2.0;
/** × boss attack damage by boss phase (index = phase 1..3): the rig gets meaner as it breaks down. */
export const BOSS_PHASE_DMG_MUL: readonly number[] = [1, 0.9, 1.05, 1.35];
/** Elite arrives at min(time, rank IV + 30 s); boss at min(time, rank V + 20 s). */
export const ELITE_AT_S = 390;
export const BOSS_AT_S = 540;

// ─────────────────────────────── perf budgets (gates read these) ───────────────────────────────
export const BUDGET = {
  fpsMin: 55,
  drawCallsMax: 450,
  simTickMsMax: 4,
  dprMax: 1.5,
  shadowMap: 1024,          // doctrine §3: 1024, fit the frustum tightly instead
} as const;

// ═══════════════════════════════ v2 (FEATURES_V2 §2.2 — verbatim from _spec/features_v2_types.ts) ═══════════════════════════════
// Starting points. The lane that owns the system tunes them with its probe; GATE 2 is the arbiter.

/** #2 UPROAR. Points, not percent: max 100. */
export const ULT = {
  max: 100,
  /** passive trickle (points/s) while the run is live and not locked out */
  trickle: 0.6,
  /** points per destruction event, before × ultCharge stat × ULT_CITY_RANK_MUL[rank] (city sources only) */
  prop: 0.4,
  floor: 0.9,
  collapsePerTier: 2,      // × (tier + 1)
  /** only city events within this × titan height of the titan charge the meter (boss crush does not) */
  nearH: 4,
  /** points per enemy kill by kind (× ultCharge) */
  kill: { android: 0.45, squad: 0.45, drone: 0.6, buggy: 1.6, apc: 3, tank: 4, walker: 6, elite: 20 } as Readonly<Record<EnemyKind, number>>,
  /** rage: points = hurt × dmg / maxHp (taking 10 % of max HP → +3) */
  hurt: 30,
  /** points = bossHit × dmg / boss.maxHp (dealing 5 % of the boss → +7.5) */
  bossHit: 150,
  /** after a fire the meter is frozen for this long (s) */
  lockoutS: 6,
  /** blast radius R = max(rFloorH × H, rFrac × spawnRing(w)) — covers the AUTO-framed view (zoom 1) */
  rFrac: 0.95, rFloorH: 3,
  /** ROAR: invulT = roar length (no damage of any kind) + move × roarMove (ultMoveMul); hostile NON-boss
   *  projectiles and unfired enemy-owned telegraphs inside R are deleted when the roar ends */
  roarMove: 0.3,
  /** kills while phase !== 'idle' bank their XP × killXpMul (combat killEnemy → ultBankKill) */
  killXpMul: 0.5,
  /** one fire grants at most this × the XP the titan's CURRENT level needs; banked XP past it is dropped */
  xpCapLevelFrac: 0.5,
  /** the bank spawns at most this many merged scrap pickups per tick (perf: a Size V fire kills ~250) */
  bankPickupsPerTick: 6,
  /** boss: one fire removes exactly bossCapFrac × maxHp (split over the pulses that reach it) + bossMeter */
  bossCapFrac: 0.06, bossMeter: 0.3,
  /** app hit-stop on 'ultFire' blast start (view/app only) */
  hitStopScale: 0.3, hitStopS: 0.18,
} as const;
/** × city-source charge by titan rank (a Size V body breaks 20 floors a second). */
export const ULT_CITY_RANK_MUL: readonly number[] = [1, 0.7, 0.4, 0.22, 0.12];
/** probe_ult acceptance: median seconds between "ready" edges for the fire-on-ready bot, per rank band. */
export const ULT_GAP_BAND_S: readonly [number, number] = [30, 65];

/** #4 objectives (per-biome overrides in data/objectives.ts). */
export const OBJECTIVES = {
  overload: { firstAtS: 25, respawnS: 35, lifeS: 75, bandMin: 0.8, bandMax: 1.8, maxActive: 1, uproar: 35, xpFrac: 0.2 },
  relief: { firstAtS: 40, respawnS: 40, lifeS: 90, bandMin: 0.5, bandMax: 1.4, maxActiveLow: 1, maxActiveHigh: 2, hpBelow: 0.85, forceEveryS: 90, heals: 3, fullHpUproar: 8, sizeH: 0.35, sizeMinM: 1.5 },
  annex: { delayAfterBreachS: 20, lifeS: 120, bandMin: 1.0, bandMax: 2.2, fromRank: 1 as RankIndex },
  /** leaving an objective behind: expire once it is farther than this × spawnRing */
  strandMul: 2.8,
  /** candidates scored, the pick is rng.meta-weighted over the best N */
  topN: 12,
} as const;

/** #8 map power-ups. */
export const POWERUPS = {
  lifeS: 30, blinkS: 5, maxAlive: 3, minGapS: 18,
  /** collect distance = titan.radius + max(1, collectH × titan.height) */
  collectH: 0.6,
  dropByKill: { android: 0.002, squad: 0.002, drone: 0.004, buggy: 0.012, apc: 0.03, tank: 0.035, walker: 0.05, elite: 1 } as Readonly<Record<EnemyKind, number>>,
  dropByCollapse: 0.006,   // tier >= 2 collapses
  bossDropMul: 0.5,
  weights: { cleanup: 30, demolition: 18, redLight: 16, rushHour: 22, backPay: 14 } as Readonly<Record<PowerUpKind, number>>,
  redLightS: 6, redLightBossS: 4.5,
  rushHourS: 10, rushAttackRate: 0.5, rushMoveSpeed: 0.2, rushSmash: 1.0,
  demolitionEliteFrac: 0.25, demolitionBossFrac: 0.02, demolitionBossMeter: 0.1,
  /** DEMOLITION kills bank like UPROAR kills (merged pickups, ≤ bankPickupsPerTick per tick) — perf */
  demolitionBanks: true,
} as const;

/** #8 draft extras. */
export const DRAFT_V2 = {
  banishes: 2, locks: 2,
  /** a READY evolution joins a level-up offer (slot 2, 0-based) with this chance (one rng.loot draw, ONLY
   *  when at least one evolution is ready — otherwise the loot stream is untouched); chest offers always
   *  put the first ready evolution in slot 0 (slot 1 when a held card occupies slot 0) */
  evoDraftChance: 0.2,
  /** BANISH ignores presses for this long after the draft opens (on top of the screen's armMs) */
  banishArmS: 0.6,
  /** pad BANISH is a HOLD of pad Y this long (a fill ring on the card); a tap never banishes */
  banishHoldS: 0.5,
} as const;

/** #8 endless. */
export const ENDLESS = {
  budgetPerMin: 0.30, budgetMax: 6,
  hpPerMin: 0.35,
  dmgPerMin: 0.10, dmgMax: 3,
  eliteEveryS: 60,
  bossEveryS: 150,
  rematchHpStep: 0.5, rematchDmgStep: 0.1,
  score: { perSecond: 10, perKill: 2, perRematch: 5000, perTons: 1 / 500 },
} as const;

/** #5 perks (numbers the perk cards / applyPerk use). */
export const PERKS = {
  pettyCashRerolls: 1, redTapeBanish: 1, redTapeLock: 1, safetyArmor: 8,
  stayHpFrac: 0.25, stayInvulnS: 2, tipLineExtraOverload: 1, tipLineMarkerMul: 2,
} as const;

/** tally: the window after an 'ability' event that counts hook pickups / hook kills (s) */
export const HOOK_WINDOW_S = 1.4;

/** Modal-screen bindings (FEATURES_V2 §2.4), compared against ui/dom.ts UiPress.key (lower-case
 *  KeyboardEvent.key or 'pad:<n>') inside the screen module, BEFORE its `switch (p.act)`. Pad 8 (Select)
 *  stays 'back' and pad 3 (Y) stays 'alt' = confirm on the title/select screens. ui/dom.ts is NOT edited. */
export const UI_BIND = {
  /** draft: X / hold pad Y (DRAFT_V2.banishHoldS). pad Y maps to act 'alt', which the draft ignores. */
  banish: { key: 'x', pad: 'pad:3' },
  /** draft: C / pad LB (4). Unmapped in PAD_MAP → act null. */
  lock: { key: 'c', pad: 'pad:4' },
  /** title + select: G / pad X (2). pad X maps to act 'reroll', which title and select ignore. */
  goals: { key: 'g', pad: 'pad:2' },
  /** clear tabloid: K; on pad the KEEP GOING button is reached with the d-pad and confirmed with A */
  keepGoing: { key: 'k', pad: null },
} as const;
