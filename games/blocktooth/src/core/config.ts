// BLOCKTOOTH — tuning constants + the size/camera formulas (CONTRACT.md §3–§4).
// THREE-FREE. This is the single source of truth for every number another module
// would otherwise hard-code. Tune HERE (the pacing probe reads the same table).
//
// ═══════════════════════════ ECONOMY + THREAT TABLE (balance pass, 2026-09-23) ═══════════════════════════
// Every number below is either a constant in this file (name in brackets) or MEASURED with the gate bot
// (_harness/bot.ts; 36-run sweep = 12 titan×biome × seeds 1337/7/99, _harness/scratch/balance_multi.sh).
//
// ECONOMY (per Size rank)                      I        II        III        IV         V
//   massToNext [RANKS]                         95       600       9 000      70 000     —
//   cumulative mass to reach the rank           0        95        695        9 695      79 695
//   schedule [RANK_SCHEDULE_S] / gate band      0        90/60–150 210/150–300 360/280–450 480/400–560
//   canFlatten (matched tier eaten on contact)  t0       t1        t2         t3         t4
//   matched-tier floor loot mass / xp          1 / 1    5 / 3     16 / 3     55 / 1.8   170 / 0.75
//     [lootMass/lootXp = TIERS × xpScale 1/1/.5/.15/.03; SNACK_FALLOFF 0.35 per tier BELOW canFlatten]
//   kill mass × [KILL_MASS_RANK_MUL]            1        1         3          25         30
//   (tank kill at IV = 6×25 = 150 mass ≈ 3 tier-3 floors: fighting the army feeds growth, it is not a detour)
//   rubber band: catch-up × min(3, 1 + 2.0·minBehind) after the scheduled time [CATCHUP_*]; Size V only:
//     pace governor × max(0.35, 1 − 1.2·minEarly) when the projected breach is > 40 s early [AHEAD_*]
//   measured: time in rank (s, mean)           100      115       158        113        (boss)
//             LV at Size II/III/IV/V ≈ 5 / 12 / 22 / 33 · early draft gap median 13–25 s
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
//     hookLane 972/1134/1458 · hookDrop 810/945/1215 · boomSweep –/1040/1337 · legStomp –/–/1701 ·
//     paw slam 972 (inner) · plate 486/567/729 · ridge charge –/1323/1701   (titan V hp: VOLT 810 · BRIAR 1080 ·
//     MOLO 1260 (armor 10) · HEARTH 1530 (armor 20), before upgrades)
//   cadence: attack gap CAISSON 2.6/2.0/1.9 s, IRON GULLY 2.8/2.1/2.0 s (P3 × 0.7/0.75); windups × 1/.8/.68
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
export interface RankDef {
  name: 'I' | 'II' | 'III' | 'IV' | 'V';
  height: number;          // body height (m) at the start of the rank
  massToNext: number;      // mass needed (from the start of this rank) to reach the next
  hpMul: number;           // × TitanDef.base.maxHp
  dmgMul: number;          // × every titan damage number (so kill times survive growth)
  speedMul: number;        // × base move speed (see titanSpeed)
  frameFrac: number;       // fraction of screen height the titan occupies (camera formula)
  pitchDeg: number;        // camera pitch at this rank
  canFlatten: Tier;        // highest tier flattened on contact
  /** × the XP of city loot (floors, props, collapse bonus) while at this rank — a Size V titan
   *  levels up from the fight, not from eating a skyline it pops 20 floors a second of */
  xpScale: number;
}

export const RANKS: readonly RankDef[] = [
  { name: 'I',   height: 1.2, massToNext: 95,       hpMul: 1.0, dmgMul: 1.0,  speedMul: 1, frameFrac: 0.13, pitchDeg: 36, canFlatten: 0, xpScale: 1 },
  { name: 'II',  height: 5.0, massToNext: 600,      hpMul: 1.8, dmgMul: 3.0,  speedMul: 1, frameFrac: 0.15, pitchDeg: 38, canFlatten: 1, xpScale: 1 },
  { name: 'III', height: 14,  massToNext: 9000,     hpMul: 3.2, dmgMul: 8.0,  speedMul: 1, frameFrac: 0.17, pitchDeg: 40, canFlatten: 2, xpScale: 0.5 },
  { name: 'IV',  height: 32,  massToNext: 70000,    hpMul: 5.5, dmgMul: 20,   speedMul: 1, frameFrac: 0.19, pitchDeg: 42, canFlatten: 3, xpScale: 0.15 },
  { name: 'V',   height: 60,  massToNext: Infinity, hpMul: 9.0, dmgMul: 45,   speedMul: 1, frameFrac: 0.21, pitchDeg: 44, canFlatten: 4, xpScale: 0.03 },
];

/** In-rank swell: the body grows up to +SWELL of its rank height as mass fills toward the next rank. */
export const SWELL = 0.12;
/** Rank-up grow tween duration (s). Height eases (out-back) from old to new over this time. */
export const GROW_TWEEN_S = 0.9;
/** Titan collision radius as a fraction of body height. */
export const TITAN_RADIUS_PER_H = 0.42;
/** Enemies whose height < titan.height * CRUSH_RATIO are crushed on contact while the titan moves. */
export const CRUSH_RATIO = 0.45;

/** Body height (m) for a rank + progress through it (0..1). */
export function titanHeight(rank: RankIndex, progress01: number): number {
  const p = Math.min(1, Math.max(0, progress01));
  return RANKS[rank].height * (1 + SWELL * p);
}

/** Base move speed (m/s) for a body height: heavier = slower on screen, faster in metres.
 *  speed(H) = 3.2 + 1.9 * H^0.8   →  I 5.4 · II 10.1 · III 18.9 · IV 33.6 · V 53.5 m/s (× moveSpeed stat) */
export function titanSpeed(height: number): number {
  return 3.2 + 1.9 * Math.pow(height, 0.8);
}

/** Pacing schedule (s since run start) the rubber-band targets. Mass gain gets a catch-up
 *  multiplier when the run is behind: mul = 1 + CATCHUP_PER_MIN * minutesBehind (cap CATCHUP_MAX). */
export const RANK_SCHEDULE_S: readonly number[] = [0, 90, 210, 360, 480];
export const CATCHUP_PER_MIN = 2.0;
export const CATCHUP_MAX = 3;
/** The other half of the rubber band, for the late ranks only (next rank ≥ AHEAD_FROM_RANK, i.e. the
 *  Size V breach): a pace governor projects the breach from the average mass rate since entering the
 *  current rank; a titan on course to breach more than AHEAD_GRACE_S before RANK_SCHEDULE_S[next]
 *  banks mass at max(AHEAD_MIN, 1 − AHEAD_PER_MIN × minutesEarly) — slow eaters are never touched.
 *  Size IV mass rates spread 3× across titan × city layouts (measured 440–1100 mass/s), which put some Size V breaches before the 400 s
 *  floor of the pacing band while others were late; the catch-up already compresses the late side. */
export const AHEAD_FROM_RANK = 4;
export const AHEAD_GRACE_S = 40;
export const AHEAD_PER_MIN = 1.2;
export const AHEAD_MIN = 0.35;

/** XP curve: xpToNext(level) — level starts at 1. Target ≈ LV 28–34 by the boss (~8.5 min). */
export function xpToNext(level: number): number {
  return Math.round(8 + 6 * Math.pow(level, 1.35));
}

// ─────────────────────────────── destruction tiers ───────────────────────────────
export interface TierDef {
  floorHp: number;         // HP per floor (props: HP of the prop)
  floorXp: number;         // XP dropped per floor broken
  floorMass: number;       // mass dropped per floor broken
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

/** Mass one floor / prop of `tier` drops for a titan at `rank` (table value × the snack rule). */
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

/** Camera distance D (m) from look target for a body height at a rank:
 *  D = H / (frameFrac(rank) · 2·tan(fov/2))
 *  → I 17.2 · II 62.2 · III 153.7 · IV 314.3 · V 533.2 m (at the rank's base height) */
export function cameraDistance(height: number, rank: RankIndex): number {
  const k = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
  return height / (RANKS[rank].frameFrac * k);
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
/** × the MASS an enemy kill drops, by the titan's rank. Kills feed growth: at Size IV–V the army is
 *  most of what the titan fights, and a titan that stops to fight a tank line should not fall off
 *  the growth schedule (measured before: kills were < 1 % of the mass banked in Size IV). */
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
