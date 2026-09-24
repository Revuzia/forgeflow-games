// BLOCKTOOTH — tuning constants + the size/camera formulas (CONTRACT.md §3–§4).
// THREE-FREE. This is the single source of truth for every number another module
// would otherwise hard-code. Tune HERE (the pacing probe reads the same table).

import type { RankIndex, Tier } from './types.ts';

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
  { name: 'IV',  height: 32,  massToNext: 80000,    hpMul: 5.5, dmgMul: 20,   speedMul: 1, frameFrac: 0.19, pitchDeg: 42, canFlatten: 3, xpScale: 0.15 },
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
export const CATCHUP_PER_MIN = 1.2;
export const CATCHUP_MAX = 3;

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
/** Boss HP × this per rank reached when it spawns (it expects Size V, copes with IV). */
export const BOSS_HP_SCALE: readonly number[] = [0.2, 0.3, 0.45, 0.7, 1];
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
