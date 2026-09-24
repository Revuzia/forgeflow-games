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

import type { DamageKind, RankIndex, Tier } from './types.ts';

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
  /** rank-up punch: distance dips by this fraction then eases out over punchS */
  punchFrac: 0.08, punchS: 1.2,
  /** shake amplitude per metre of titan height on a heavy stomp */
  shakePerH: 0.02,
} as const;

// ── auto framing: the titan GROWS INTO THE FRAME level by level (2026-09-24, owner feedback) ──
/**
 * Auto framing per Size rank, as SCREEN FRACTIONS of one body height H (vertical extent D·k):
 *   startFrac[r] — on entering the rank (H0 = titanHeightAt(r, RANK_LEVELS[r]) = RANKS[r].height)
 *   endFrac[r]   — at the rank's last level before the next breach (Size V: its growth cap)
 * D*(H, r) = H0 / (startFrac·k) · (H/H0)^kr, with kr solved at module load from the sim's own growth
 * curve (titanHeightAt at the rank's first and last level), so the body grows on screen whatever
 * per-level step RANK_LEVELS / BREACH_JUMP give; each breach resets to the next rank's small startFrac
 * — the camera pulls back so the new, bigger world fits. kr comes out NEGATIVE on the current curve (I −0.33 · II −0.30 · III −0.37 · IV −0.29 · V +0.39)
 * (an in-rank height ratio of 1.1–2.2× cannot reach 4.5–8.5 % → 13–19 % with any 0 < k < 1): the camera eases
 * in slightly while the body grows. Late ranks start bigger on purpose: Size IV–V framing is bounded by
 * the perf gate (Size V + 250 enemies at p99 ≤ 22 ms); Size V keeps the old 533 m distance.
 *   D (m) / body share of the view height at a rank's first → last level (framing_table.ts prints every level):
 *   I LV 1→6 49.8 → 38.2 m, 4.5 → 13 % · II LV 7→15 133 → 109 m, 7 → 17 % · III LV 16→26 307 → 251 m,
 *   8.5 → 18 % · IV LV 27→34 519 → 464 m, 11.5 → 19 % · V LV 35→37 533 → 557 m, 21 → 22.5 %.
 *   Size I starts WIDE (a whole intersection, the titan tiny on its zebra — the reference's opening).
 */
export const FRAMING = {
  startFrac: [0.045, 0.070, 0.085, 0.115, 0.210] as readonly number[],
  endFrac:   [0.130, 0.170, 0.180, 0.190, 0.225] as readonly number[],
} as const;
/** Player zoom (view-only; the sim never reads it): a multiplier on the auto distance, clamped to
 *  [ZOOM_MIN, ZOOM_MAX] and to the absolute band D_ABS_MIN ≤ D ≤ D_ABS_MAX (m). The far end is where
 *  the whole city already fits and the frame budget still holds (perfcheck --zoom max). */
export const CAMERA_ZOOM = {
  min: 0.55, max: 2.0,
  dAbsMin: 12, dAbsMax: 880,
  /** smoothing rate of ln(zoom) (1/s) — quick but not a snap */
  omega: 11,
} as const;

const CAM_K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
/** in-rank framing exponent limits (k < 0 = the camera eases IN while the body grows) */
const FRAME_K_MIN = -1.2, FRAME_K_MAX = 1;
/** Per-rank {H0, k} derived from FRAMING and the sim's growth curve (see FRAMING). */
const RANK_FRAME: readonly { H0: number; k: number }[] = RANKS.map((R, r) => {
  const L0 = RANK_LEVELS[r] ?? 1;
  const L1 = r < 4 ? (RANK_LEVELS[r + 1] ?? L0 + 1) - 1 : L0 + RANK_V_GROWTH_LEVELS;
  const H0 = titanHeightAt(r as RankIndex, L0) || R.height;
  const H1 = titanHeightAt(r as RankIndex, Math.max(L0, L1)) || H0;
  const g = H1 / H0;
  const f = FRAMING.endFrac[r] / FRAMING.startFrac[r];
  const k = g > 1.02 ? 1 - Math.log(f) / Math.log(g) : 1;
  return { H0, k: Math.max(FRAME_K_MIN, Math.min(FRAME_K_MAX, k)) };
});

/** AUTO camera distance D* (m) from the look target for a body height at a rank (no player zoom, no
 *  punch) — see FRAMING. The camera rig springs toward it; the SIM's enemy spawn ring reads it too
 *  (ai/enemies.ts ringRadius), so foes still walk in from off-screen at the default zoom. */
export function cameraDistance(height: number, rank: RankIndex): number {
  const r = Math.max(0, Math.min(RANKS.length - 1, rank | 0));
  const F = RANK_FRAME[r];
  const H = Math.max(0.05, Number.isFinite(height) ? height : F.H0);
  return F.H0 / (FRAMING.startFrac[r] * CAM_K) * Math.pow(H / F.H0, F.k);
}

/** Screen-height fraction a body height H occupies at the AUTO distance (no zoom, no punch). */
export function autoFrameFrac(height: number, rank: RankIndex): number {
  return height / (cameraDistance(height, rank) * CAM_K);
}

/** The derived per-rank framing (H0, k) — for probes / the debug overlay. */
export function framingTable(): readonly { H0: number; k: number }[] { return RANK_FRAME; }

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
