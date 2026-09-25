// BLOCKTOOTH — shared SIM contract types. THREE-FREE: this file (and every sim
// module) must run under plain `node` (type stripping). Never import 'three' here.
//
// Conventions (CONTRACT.md §2):
//   * 1 unit = 1 metre. Y up. The sim is planar in XZ; heights are data.
//   * Heading θ (radians): direction vector = (sin θ, cos θ) in (x, z). θ = 0 faces +Z.
//     A THREE object with rotation.y = θ faces the same way IF its model faces +Z.
//   * All sim randomness comes from world.rng streams (mulberry32). Math.random is
//     forbidden in sim code. Date.now/performance.now are forbidden in sim code.
//   * Entities keep px/pz/pheading = pose at the START of the current tick so the view
//     can interpolate: shown = prev + (cur - prev) * alpha.

// ─────────────────────────────── ids ───────────────────────────────
export type TitanId = 'molo' | 'voltkite' | 'hearthback' | 'briarwick';
export type BiomeId = 'grideast' | 'whitestacks' | 'lockwater';
export type BossId = 'caisson4' | 'irongully' | 'parkade6';   // v2: parkade6 = GRID-EAST's boss (FEATURES_V2 §10)
export const BOSS_IDS: readonly BossId[] = ['caisson4', 'irongully', 'parkade6'];
export type EnemyKind =
  | 'android'   // CROSSING WARDEN — patrol android, pellet gun
  | 'squad'     // PICKET SQUAD member — formation androids, 3-round volleys
  | 'drone'     // GNAT — quadcopter swarm, flies over buildings, dive-bomb
  | 'buggy'     // HOPPER — light vehicle, rocket pod with circle telegraph
  | 'apc'       // BULWARK — APC, deploys picket squads, turret
  | 'tank'      // TORTOISE — MBT, lane-telegraphed shells
  | 'walker'    // STILT MORTAR — artillery walker, lobbed circle telegraphs
  | 'elite';    // RAMROD — elite breach-dozer, lane-telegraph charge, drops a chest
export const TITAN_IDS: readonly TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
export const BIOME_IDS: readonly BiomeId[] = ['grideast', 'whitestacks', 'lockwater'];
export const ENEMY_KINDS: readonly EnemyKind[] = ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker', 'elite'];

/** 0..4 → Size I..V */
export type RankIndex = 0 | 1 | 2 | 3 | 4;
/** Destructible tier. 0 = cars/kiosks, 1 = shops, 2 = midrise, 3 = blocks/towers, 4 = megatowers. */
export type Tier = 0 | 1 | 2 | 3 | 4;

// ─────────────────────────────── geometry ───────────────────────────────
export interface Vec2 { x: number; z: number; }

/** Every area test in the game (attacks, telegraphs, hazards) is one of these. */
export type Shape =
  | { k: 'circle'; x: number; z: number; r: number }
  | { k: 'ring'; x: number; z: number; r0: number; r1: number }                 // annulus r0..r1
  | { k: 'cone'; x: number; z: number; dir: number; half: number; r: number }   // sector, half-angle rad
  | { k: 'lane'; x: number; z: number; dir: number; len: number; w: number }    // oriented rect from (x,z) along dir, full width w
  | { k: 'oval'; x: number; z: number; rx: number; rz: number; rot: number }    // ellipse; rx along local +X, rz along local +Z, rotated by rot (heading)
  | { k: 'capsule'; x0: number; z0: number; x1: number; z1: number; r: number }; // swept circle (segment + radius)

// ─────────────────────────────── city ───────────────────────────────
export type ArchShape =
  | 'box'          // generic stacked-floor building (shops, offices, apartments)
  | 'podium'       // wide base + narrower tower (megatower)
  | 'cylinder'     // storage tank / silo (floors = rings)
  | 'dish'         // radar/satellite dish on a plinth
  | 'chimney'      // smoke stack
  | 'containers'   // stacked shipping containers (floors = container layers)
  | 'gantry'       // static dock gantry / crane frame
  | 'shed';        // low industrial shed with sawtooth roof

export interface BuildingArchetype {
  id: string;              // e.g. 'ge_shop', 'ws_tank', 'lw_stack'
  shape: ArchShape;
  tier: Tier;
  floorH: number;          // metres per floor
  floors: [number, number];      // inclusive min/max floor count
  footprint: [number, number];   // inclusive min/max side length (m); w and d drawn independently
  weight: number;          // relative spawn weight within its tier band
  /** palette keys (BiomePalette) used by the mesh kit */
  body: keyof BiomePalette; trim: keyof BiomePalette; roof: keyof BiomePalette;
  signage: boolean;        // coral/neon sign boards on facades
}

export interface Building {
  id: number;
  arch: string;            // BuildingArchetype.id
  shape: ArchShape;
  tier: Tier;
  block: number;           // block index (bx + bz * blocksX)
  x: number; z: number;    // footprint centre
  w: number; d: number;    // full extents along X and Z (axis-aligned; no rotation)
  floorH: number;
  floors: number;          // floors at generation
  alive: number;           // floors still standing (0 = collapsed)
  floorHp: number;         // HP left in the current (lowest standing) floor
  floorHpMax: number;
  collapsed: boolean;
  variant: number;         // cosmetic 0..1 from the city rng
}

export type PropKind =
  | 'car' | 'taxi' | 'van' | 'bus' | 'truck' | 'kiosk' | 'hydrant' | 'lamp' | 'tree' | 'bench'
  | 'vending' | 'signpost' | 'barrier' | 'drum' | 'forklift' | 'container' | 'bollard' | 'boat'
  | 'pylon' | 'snowbank';

export interface Prop {
  id: number;
  kind: PropKind;
  tier: 0 | 1;             // 0 = flattened on contact from Size I; 1 (bus/truck/container) needs Size II (blocks + is chewable before that)
  x: number; z: number; heading: number;
  px: number; pz: number; pheading: number;
  alive: boolean;
  hp: number;
  /** traffic: index into CityLayout.lanes, or -1 for parked/static props */
  lane: number;
  laneS: number;           // distance along the lane polyline (m)
  speed: number;           // current speed (m/s), traffic only
  scared: number;          // >0 while fleeing/braking (s)
}

/** A traffic lane: closed or open polyline of XZ points (m). */
export interface Lane { pts: number[]; closed: boolean; length: number; }

export interface Crosswalk { x: number; z: number; axis: 'x' | 'z'; len: number; width: number; }

export interface CityLayout {
  seed: number;
  biome: BiomeId;
  blocksX: number; blocksZ: number;
  pitch: number; roadW: number; sidewalkW: number;
  /** world X/Z of the centreline of road 0 (the first road line); road i centre = origin + i * pitch */
  originX: number; originZ: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };   // playable clamp for the titan
  buildings: Building[];
  props: Prop[];
  /** per block index → building ids / prop ids whose centre lies in that block's cell */
  blockBuildings: number[][];
  blockProps: number[][];
  crosswalks: Crosswalk[];
  lanes: Lane[];
  /** where the baby titan stands at the open slate: ON a crosswalk, facing along it */
  spawn: { x: number; z: number; heading: number };
  /** flooded streets (LOCKWATER): roads are shallow water */
  flooded: boolean;
}

// ─────────────────────────────── titan ───────────────────────────────
export type StatKey =
  // survival
  | 'maxHp' | 'regen' | 'armor' | 'iframes' | 'thorns' | 'lifesteal' | 'rubbleHeal'
  // movement
  | 'moveSpeed' | 'dashCharges' | 'dashCooldown' | 'dashDistance'
  // growth / economy
  | 'pickupRadius' | 'massGain' | 'xpGain' | 'luck' | 'rerolls'
  // offence (generic)
  | 'damage' | 'attackRate' | 'attackRange' | 'area' | 'critChance' | 'critMult' | 'knockback'
  | 'chains' | 'chainRange' | 'projectiles' | 'buildingDamage'
  // smash (contact destruction)
  | 'smashDamage' | 'smashRadius' | 'sparkChance'
  // hook ability
  | 'abilityCooldown' | 'abilityPower'
  // kit-specific (ignored by titans that do not read them)
  | 'biteCleave' | 'pulseEvery' | 'vacuumRadius'                     // MOLO
  | 'arcForks' | 'wireDuration' | 'wireDamage'                       // VOLT-KITE
  | 'shellCapacity' | 'stompDelay' | 'magmaDuration'                 // HEARTHBACK
  | 'turretCap' | 'turretRate' | 'sporeHeal' | 'vineLength'          // BRIARWICK
  // v2 UPROAR (FEATURES_V2 §3): charge-rate and power multipliers (defaults 1 / 1)
  | 'ultCharge' | 'ultPower';

export type StatBlock = Record<StatKey, number>;

export interface TitanState {
  id: TitanId;
  x: number; z: number; heading: number;
  px: number; pz: number; pheading: number;
  vx: number; vz: number;
  speed: number;           // |v| this tick
  moving: boolean;         // input magnitude > 0.1
  hp: number; maxHp: number;
  level: number; xp: number; xpToNext: number;
  mass: number;            // @deprecated mirror of SIZE progress (config sizeMassMirror); SIZE is level-driven — read sizeProgress()
  rank: RankIndex;
  /** current body height (m) incl. in-rank swell and the rank-up grow tween */
  height: number;
  /** collision radius (m) = height * TITAN_RADIUS_PER_H */
  radius: number;
  growT: number;           // >0 while a grow tween runs (s remaining): MASS BREACH on rank-up, a short step on level-up
  dashCharges: number; dashRecharge: number; dashT: number; dashDirX: number; dashDirZ: number;
  iframeT: number;
  abilityCd: number;       // seconds until the hook is ready
  autoCd: number;          // seconds until the next auto-attack
  stepAcc: number;         // distance accumulator for footsteps (m)
  slowT: number; slowMul: number;
  /** CAISSON-4 winch leash: pull toward (lx,lz) while t > 0 */
  leash: { t: number; lx: number; lz: number; strength: number } | null;
  stats: StatBlock;        // recomputed by upgrades/stats.ts whenever upgrades or rank change
  /** kit-private numeric state (e.g. molo pulse counter, hearthback stored damage) */
  kit: Record<string, number>;
  alive: boolean;
  // run counters (HUD + tabloid)
  kills: number; crushed: number; floorsEaten: number; buildingsLeveled: number; propsEaten: number;
  damageTaken: number;
}

/** Latched per-tick command, already in WORLD space (the app converts screen input). */
export interface TitanInput {
  mx: number; mz: number;  // desired move direction in world XZ, |m| <= 1
  ability: boolean;        // edge: hook pressed this tick (buffered by the input layer)
  abilityHeld: boolean;
  dash: boolean;           // edge: dash pressed this tick (buffered)
  /** v2 edge: UPROAR pressed this tick (buffered like ability). OPTIONAL on purpose (existing literals stay
   *  valid): read it as `!!input.ultimate`. */
  ultimate?: boolean;
}

// ─────────────────────────────── enemies ───────────────────────────────
export interface Enemy {
  id: number;
  kind: EnemyKind;
  alive: boolean;
  x: number; z: number; y: number;        // y > 0 only for drones / airborne
  px: number; pz: number; py: number; pheading: number;
  vx: number; vz: number; heading: number;
  hp: number; maxHp: number;
  radius: number; height: number;
  state: string;           // behaviour state name (ai/enemies.ts)
  t: number;               // time in state (s)
  cd: number;              // weapon cooldown (s)
  squad: number;           // squad id or -1
  slot: number;            // formation slot within squad
  elite: boolean;
  aimX: number; aimZ: number;             // telegraphed aim point (for tanks/elite lanes)
  flash: number;           // hit-flash timer for the view (s)
  stun: number;            // stun / knock timer (s)
  slowT: number;           // > 0 while slowed (frost / spores)
  slowMul: number;         // speed multiplier while slowed (e.g. 0.6)
  kx: number; kz: number;  // knockback velocity (decays ~8/s), added to movement
  spawnT: number;          // world.t at spawn
}

// ─────────────────────────────── combat ───────────────────────────────
export type Owner = 'titan' | 'enemy' | 'boss';

export type DamageKind =
  | 'bite' | 'pulse' | 'arc' | 'wire' | 'magma' | 'vent' | 'vine' | 'seed' | 'spore' | 'smash' | 'stomp'
  | 'spark' | 'shockwave' | 'rubble' | 'thorns'
  | 'bullet' | 'rocket' | 'shell' | 'mortar' | 'ram' | 'breath' | 'slam' | 'hook' | 'plate' | 'dive' | 'generic';

export interface DamageOpts {
  src: Owner | 'hazard';
  kind: DamageKind;
  /** multiplier applied to building/prop damage (titan attacks default 1; hazards often 0.5) */
  buildingMul?: number;
  /** skip buildings/props entirely */
  noCity?: boolean;
  /** knockback impulse (m/s) away from the shape origin */
  knock?: number;
  /** already-rolled crit (projectiles roll at spawn) */
  crit?: boolean;
  /** do not roll crits (hazard ticks) */
  noCrit?: boolean;
  /** upgrade id that caused this (so triggers don't self-trigger) */
  fromUpgrade?: string;
}

export type ProjectileKind =
  | 'pellet' | 'volley' | 'rocket' | 'shell' | 'mortar' | 'plate' | 'hookDrop'   // hostile
  | 'seed' | 'rubbleShot' | 'spark'                                           // titan-owned
  | 'carLob';                                                                 // v2 hostile: PARKADE-6's lobbed car (lob, circle tell like 'plate')

export interface Projectile {
  id: number;
  alive: boolean;
  owner: Owner;
  kind: ProjectileKind;
  x: number; z: number; y: number;
  px: number; pz: number; py: number;
  vx: number; vz: number; vy: number;
  r: number;               // hit radius
  dmg: number;
  life: number;            // seconds left
  pierce: number;          // extra targets it may pass through
  crit: boolean;
  /** lobbed: lands exactly at (tx,tz) after `life`, damaging a circle of radius `aoe` */
  lob: boolean; tx: number; tz: number; aoe: number;
  /** telegraph id drawn under a lobbed shot (or -1) */
  tg: number;
}

export type TelegraphStyle = 'cone' | 'oval' | 'lane' | 'ring' | 'circle' | 'chain';

export interface Telegraph {
  id: number;
  alive: boolean;
  owner: Owner;
  style: TelegraphStyle;   // visual family (shape + hatch pattern); never colour-only
  shape: Shape;
  windup: number;          // seconds from spawn to fire
  t: number;               // seconds since spawn
  active: number;          // seconds the damage stays live after firing (0 = instant)
  dmg: number;
  kind: DamageKind;
  fired: boolean;
  hitTitan: boolean;       // hostile telegraphs: did it land on the titan
  /** optional owner hook, invoked once when the telegraph fires (after damage) */
  onFire: ((w: World, tg: Telegraph) => void) | null;
  /** chain telegraphs: XZ points of the chain polyline */
  chain: number[] | null;
  tag: string;             // free label for owners ('hookDrop', 'winch', 'magmaStomp', ...)
}

export type HazardKind = 'wire' | 'magma' | 'bloom' | 'spore' | 'frost' | 'fire' | 'oil';

export interface Hazard {
  id: number;
  alive: boolean;
  owner: Owner;
  kind: HazardKind;
  shape: Shape;
  t: number;               // age (s)
  life: number;            // total lifetime (s)
  dps: number;             // generic damage per second to the opposing side inside `shape` (0 = none)
  tickT: number;           // internal accumulator for dps ticks (hazards tick at 5 Hz)
  data: Record<string, number>;   // owner-private (bloom turret cooldowns, wire charge, …)
}

export type PickupKind = 'rubble' | 'scrap' | 'heal' | 'chest';

export interface Pickup {
  id: number;
  alive: boolean;
  kind: PickupKind;
  x: number; z: number; y: number;
  px: number; pz: number; py: number;
  vx: number; vz: number; vy: number;
  xp: number;              // XP granted
  mass: number;            // loot mass: sizes the pickup mesh only (grows nothing since SIZE became level-driven)
  t: number;               // age (s)
  magnet: boolean;         // being pulled to the titan
}

// ─────────────────────────────── boss ───────────────────────────────
export interface BossPart {
  name: string;            // 'body', 'legFL', 'head', 'boom', …
  ox: number; oz: number;  // offset in boss-local frame (rotated by heading)
  r: number;               // collider radius (m)
  y0: number; y1: number;  // vertical span (m) — for the view / reach
  hpMul: number;           // damage multiplier when hit here
  strainMul: number;       // CAISSON-4: strain gained per damage here
  x: number; z: number;    // world position, refreshed each tick by the boss module
}

export interface BossState {
  id: BossId;
  alive: boolean;
  x: number; z: number; heading: number;
  px: number; pz: number; pheading: number;
  hp: number; maxHp: number;
  phase: 1 | 2 | 3;
  /** 0..1 meter shown on the nameplate (CAISSON-4 STRAIN; IRON GULLY uses it for FROST HEAT) */
  meter: number;
  staggerT: number;        // > 0 = staggered (takes bonus damage)
  attack: string | null;   // current attack id
  attackT: number;         // time in current attack
  cd: number;              // time until next attack decision
  introT: number;          // > 0 during the entrance (invulnerable)
  parts: BossPart[];
  /** subtitle currently shown under the nameplate (mechanic hint) */
  subtitle: string;
  data: Record<string, number>;
}

// ─────────────────────────────── upgrades ───────────────────────────────
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type TriggerOn =
  | 'smash' | 'floorBreak' | 'collapse' | 'kill' | 'crush' | 'hit' | 'crit' | 'dash' | 'ability'
  | 'hurt' | 'pickup' | 'rankUp' | 'levelUp' | 'interval';

export type TriggerAction =
  | 'spark'       // chain spark from the event point: p.dmg (× damage stat), p.chains
  | 'shockwave'   // ring damage around event point: p.r (× titan height), p.dmg
  | 'heal'        // heal p.amount (fraction of maxHp if p.frac)
  | 'shield'      // temporary damage absorb p.amount (fraction of maxHp)
  | 'mass'        // "grow": p.amount × the current level's XP bar (titansim gainGrowth)
  | 'xp'          // bonus xp p.amount
  | 'magnet'      // pull every pickup within p.r titan-heights
  | 'rubbleShot'  // throw p.count rubble chunks at nearest enemies: p.dmg
  | 'frenzy'      // temp buff: stat p.stat × (1+p.mul) for p.dur seconds
  | 'cdReduce'    // reduce hook cooldown by p.amount seconds
  | 'dashRefund'  // recharge p.frac of one dash charge's recharge time (default 1 = a whole charge)
  | 'meteor'      // drop a debris meteor on a random enemy within p.r titan-heights: p.dmg, p.aoe
  | 'arc'         // lightning arc from the titan to p.count nearest enemies: p.dmg
  | 'magma'       // spawn a magma pool at the event point: p.r, p.dps, p.dur
  | 'bloom'       // spawn a bloom turret at the event point (BRIARWICK synergy, works for all)
  | 'slowField'   // spawn a frost hazard slowing enemies: p.r, p.dur
  | 'ultCharge';  // v2: add p.amount UPROAR points (stack-scaled, × ultCharge stat)

export interface UpgradeEffect {
  stat?: StatKey;
  add?: number;            // flat add per stack
  mul?: number;            // fractional multiplier per stack (+0.15 = +15%)
  trigger?: {
    on: TriggerOn;
    chance: number;        // 0..1 per event (after luck)
    icd: number;           // internal cooldown (s) per upgrade
    action: TriggerAction;
    p: Record<string, number | string>;
  };
}

export interface UpgradeDef {
  id: string;
  name: string;            // ORIGINAL name (CONTRACT §1)
  desc: string;            // one line, numbers included, per-stack
  rarity: Rarity;
  maxStacks: number;
  titan?: TitanId;         // only offered to this titan
  tags: string[];          // 'offense' | 'defense' | 'growth' | 'smash' | 'mobility' | 'hook' | …
  effects: UpgradeEffect[];
  /** minimum rank before it can be offered */
  minRank?: RankIndex;
  /** v2 evolution recipe: READY when owned[base] === UPGRADE_BY_ID[base].maxStacks AND owned[with] >= 1
   *  AND owned[this] is 0 (see upgrades/draft.ts evolutionsReady) */
  evo?: { base: string; with: string };
  /** v2: needs a profile unlock (RunMeta.unlocked contains this id) before it can be offered */
  locked?: boolean;
  /** v2 hidden perk card: never offered, never on the ability bar; granted by applyPerk */
  perk?: boolean;
}

export interface UpgradeState {
  owned: Record<string, number>;          // id → stacks
  order: string[];                        // pick order (HUD icons)
  pendingDrafts: number;                  // level-ups not yet drafted
  offer: string[] | null;                 // current 3-card offer
  rerolls: number;
  icd: Record<string, number>;            // trigger internal cooldowns (s remaining)
  buffs: { stat: StatKey; mul: number; t: number }[];   // frenzy buffs
  shield: number;                         // absorb pool
  chestDrafts: number;                    // elite chests → rare+ drafts
  // ── v2 (FEATURES_V2 §7.5): createUpgradeState sets banished [], banishLeft DRAFT_V2.banishes,
  //    lockLeft DRAFT_V2.locks, locked null ──
  banished: string[];      // ids removed from this run's pool
  banishLeft: number;
  lockLeft: number;
  /** id held: it keeps its slot through rerolls of the CURRENT offer and arrives in slot 0 (0-based) of
   *  the NEXT offer; cleared when it is picked or delivered */
  locked: string | null;
}

// ─────────────────────────────── director / run ───────────────────────────────
export type RunPhase = 'intro' | 'waves' | 'elite' | 'boss' | 'clear' | 'dead' | 'endless';   // v2: 'endless' after KEEP GOING (§9)

export interface DirectorState {
  wave: number;
  nextWaveT: number;       // world.t when the next wave spawns
  spawnBudget: number;     // accumulated spawn points
  eliteT: number;          // world.t for the elite (Infinity until scheduled)
  elitesSpawned: number;
  bossT: number;           // world.t for the boss (Infinity until scheduled)
  bossSpawned: boolean;
  squadSeq: number;
  data: Record<string, number>;
}

export interface RunStats {
  phase: RunPhase;
  endT: number;            // world.t when the run ended (or -1)
  result: 'clear' | 'dead' | null;
  tonnage: number;         // cosmetic running total of flattened mass (tons)
  blocksLeveled: number;   // blocks whose buildings are all collapsed
  peakRank: RankIndex;
}

// ─────────────────────────────── events ───────────────────────────────
/** Emitted by sim systems into world.events during a tick. The view/audio/UI read them;
 *  the upgrade engine fires triggers from them. Never mutate after emit. */
export type SimEvent =
  | { type: 'footstep'; x: number; z: number; heavy: number }           // heavy 0..1 (rank/4)
  | { type: 'propDestroyed'; id: number; kind: PropKind; x: number; z: number; crushed: boolean }
  | { type: 'floorBreak'; id: number; remaining: number; x: number; z: number; tier: Tier }
  | { type: 'buildingCollapse'; id: number; x: number; z: number; tier: Tier; w: number; d: number; h: number }
  | { type: 'smash'; x: number; z: number; tier: Tier }                  // contact destruction beat (juice)
  | { type: 'bump'; x: number; z: number; tier: Tier }                   // blocked by a too-big building
  | { type: 'titanAttack'; attack: string; x: number; z: number; dir: number; r: number; hits: number }
  | { type: 'arc'; pts: number[]; kind: 'fork' | 'spark' | 'upgrade' }   // lightning polyline XZ pairs
  | { type: 'pulse'; x: number; z: number; r: number }
  | { type: 'vine'; x0: number; z0: number; x1: number; z1: number }
  | { type: 'dash'; x0: number; z0: number; x1: number; z1: number }
  | { type: 'ability'; titan: TitanId; x: number; z: number; power: number }
  | { type: 'wireDetonate'; pts: number[] }
  | { type: 'vent'; x: number; z: number; r: number; power: number }
  | { type: 'bloomSpawn'; id: number; x: number; z: number }
  | { type: 'spore'; x: number; z: number; r: number }
  | { type: 'enemySpawn'; id: number; kind: EnemyKind; x: number; z: number }
  | { type: 'enemyHit'; id: number; x: number; z: number; dmg: number; crit: boolean }
  | { type: 'enemyKilled'; id: number; kind: EnemyKind; x: number; z: number; crushed: boolean }
  | { type: 'enemyFire'; id: number; kind: EnemyKind; x: number; z: number; tx: number; tz: number }
  | { type: 'titanHurt'; dmg: number; x: number; z: number; src: DamageKind }
  | { type: 'titanHeal'; amount: number }
  | { type: 'pickup'; kind: PickupKind; xp: number; x: number; z: number }
  | { type: 'levelUp'; level: number }
  | { type: 'rankUp'; rank: RankIndex }
  | { type: 'telegraphStart'; id: number; owner: Owner; style: TelegraphStyle }
  | { type: 'telegraphFire'; id: number; owner: Owner; hit: boolean; x: number; z: number }
  | { type: 'projectileHit'; x: number; z: number; kind: ProjectileKind }
  | { type: 'explosion'; x: number; z: number; r: number; kind: DamageKind }
  | { type: 'waveStart'; wave: number }
  | { type: 'alert'; key: AlertKey }
  | { type: 'eliteSpawn'; id: number }
  | { type: 'chest'; x: number; z: number }
  | { type: 'bossSpawn'; boss: BossId }
  | { type: 'bossPhase'; phase: 1 | 2 | 3 }
  | { type: 'bossAttack'; attack: string; x: number; z: number }
  | { type: 'bossHit'; part: string; dmg: number; x: number; z: number }
  | { type: 'bossStagger' }
  | { type: 'bossDefeated'; x: number; z: number }
  | { type: 'leash'; on: boolean; x: number; z: number }
  | { type: 'upgradeProc'; id: string; x: number; z: number }
  | { type: 'runEnd'; result: 'clear' | 'dead' }
  // ── v2 (FEATURES_V2 §2.1, SimEventAdd) ──
  | { type: 'ultCharged' }                                                             // rising edge of ult.ready
  | { type: 'ultFire'; titan: TitanId; x: number; z: number; r: number }               // roar starts (0.4–0.6 s windup)
  | { type: 'ultPulse'; titan: TitanId; x: number; z: number; r0: number; r1: number; n: number; kind: DamageKind } // each damage pulse
  | { type: 'ultEnd'; titan: TitanId; kills: number }
  | { type: 'objectiveSpawn'; id: number; kind: ObjectiveKind; x: number; z: number }
  | { type: 'objectiveDone'; id: number; kind: ObjectiveKind; x: number; z: number }
  | { type: 'objectiveExpire'; id: number; kind: ObjectiveKind }
  | { type: 'powerupSpawn'; id: number; kind: PowerUpKind; x: number; z: number }
  | { type: 'powerup'; id: number; kind: PowerUpKind; x: number; z: number }            // collected
  | { type: 'powerupEnd'; kind: 'redLight' | 'rushHour' }
  | { type: 'endlessBoss'; boss: BossId; n: number }                                   // a rematch is fielded
  | { type: 'revive'; x: number; z: number };                                          // perk_stay_of_demolition revive

/** Keys into data/strings.ts ALERTS (full-width broadcast banners). */
export type AlertKey =
  | 'contractors' | 'squads' | 'drones' | 'vehicles' | 'armor' | 'artillery' | 'elite' | 'boss'
  | 'bossPhase2' | 'bossPhase3' | 'lowHp' | 'chest'
  | 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch';   // v2 (FEATURES_V2 §2.5)

// ─────────────────────────────── world ───────────────────────────────
export interface RngStreams {
  city: () => number; spawn: () => number; ai: () => number;
  combat: () => number; loot: () => number; boss: () => number;
  /** v2: objective placement, power-up drops/kinds, endless skew (seeded by hashStr('meta'): shifts no other stream) */
  meta: () => number;
}

export interface World {
  seed: number;
  titanId: TitanId;
  biomeId: BiomeId;
  tick: number;
  t: number;               // sim seconds since run start
  dt: number;              // fixed step (1 / SIM_HZ)
  rng: RngStreams;
  city: CityLayout;
  titan: TitanState;
  enemies: Enemy[];        // pooled; iterate and skip !alive
  projectiles: Projectile[];
  telegraphs: Telegraph[];
  hazards: Hazard[];
  pickups: Pickup[];
  boss: BossState | null;
  director: DirectorState;
  upgrades: UpgradeState;
  run: RunStats;
  events: SimEvent[];      // this tick's events (cleared at the start of every tick)
  input: TitanInput;       // latched command for this tick
  /** cheats (only honoured when the page was opened with ?dev=1) */
  cheats: { god: boolean; noSpawns: boolean };
  nextId: number;          // monotonically increasing id source — use newId(w)
  // ── v2 (FEATURES_V2 §2.3): createWorld initialises every one ──
  meta: RunMeta;           // sanitizeRunMeta(opts.meta) — read-only for the sim except reviveUsed
  ult: UltState;           // createUltState()
  map: MapState;           // createMapState()
  tally: RunTally;         // createTally()
  endless: EndlessState | null;   // null until continueEndless()
}

export interface RunOptions {
  titan: TitanId; biome: BiomeId; seed: number;
  /** v2: profile-derived run meta (unlocks, perk, palette); EMPTY_RUN_META when absent */
  meta?: RunMeta;
}

// ─────────────────────────────── data defs ───────────────────────────────
export interface TitanDef {
  id: TitanId;
  name: string;            // 'MOLO'
  species: string;         // 'squat jade monitor'
  role: string;            // 'SMASH TANK'
  tagline: string;         // one line for the select screen
  lore: string[];          // 2–4 short lines for the lore column
  difficulty: 1 | 2 | 3;
  colors: { primary: string; secondary: string; belly: string; accent: string; glow: string; eye: string };
  base: StatBlock;         // complete base stat block (every StatKey present)
  auto: { id: string; name: string; desc: string };
  hook: { id: string; name: string; desc: string };
  dash: { name: string; desc: string };
}

export interface BiomePalette {
  sky: string; skyHorizon: string; fog: string;
  ground: string; road: string; roadLine: string; sidewalk: string; curb: string; crosswalk: string;
  bodyA: string; bodyB: string; bodyC: string;   // building body colours
  trimA: string; trimB: string;                  // window frames / cornices
  roofA: string; roofB: string;
  glass: string; glassLit: string;               // windows (lit = night emissive)
  sign: string; signB: string;                   // signage accents (coral / neon)
  foliage: string; foliageB: string;             // trees (pink blossoms in GRID-EAST)
  water: string; waterGlow: string;
  sun: string; ambient: string; rim: string;
  telegraph: string;                             // pink family, same across biomes
}

export interface BiomeDef {
  id: BiomeId;
  name: string;            // 'GRID-EAST'
  subtitle: string;        // 'daytime commercial blocks'
  lore: string[];
  slate: string;           // open-slate headline, e.g. 'UNIDENTIFIED MASS — DOWNTOWN GRID'
  time: 'day' | 'overcast' | 'night';
  weather: 'none' | 'snow' | 'rain';
  blocks: [number, number];
  flooded: boolean;
  palette: BiomePalette;
  archetypes: BuildingArchetype[];
  /** tier band weights by distance-from-downtown (0 = centre … 1 = edge): [tier0..4] */
  tierCentre: [number, number, number, number, number];
  tierEdge: [number, number, number, number, number];
  props: { kind: PropKind; perBlock: number }[];
  trafficPerLane: number;
  boss: BossId;
  /** enemy weight multipliers for the director (1 = neutral) */
  enemyBias: Partial<Record<EnemyKind, number>>;
  music: { bpm: number; root: number; scale: 'major' | 'minor' | 'dorian' | 'phrygian'; mood: string };
  sunDir: [number, number, number];              // normalized-ish world direction TO the sun
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;            // 'CROSSING WARDEN'
  hp: number; speed: number; radius: number; height: number;
  flies: boolean;
  dmg: number;             // per shot / contact
  range: number;           // preferred engagement range (m)
  fireCd: number;          // seconds between attacks
  xp: number; mass: number;
  cost: number;            // director spawn cost
  minRank: RankIndex;      // earliest rank the director fields it
  crushable: boolean;      // can be stepped on when titan.height > height * CRUSH_RATIO
}

export interface BossDef {
  id: BossId;
  name: string;            // 'CAISSON-4'
  title: string;           // flavour title for the intro card
  meterName: string;       // 'STRAIN'
  hp: number;              // base; scaled by BOSS_HP_SCALE[rank]
  height: number;          // metres (view scale reference)
  attacks: { id: string; name: string; subtitle: string; phase: 1 | 2 | 3 }[];
}

// ═══════════════════════════════ v2 (FEATURES_V2 §2.1 — merged from _spec/features_v2_types.ts) ═══════════════════════════════

// ── #2 UPROAR (ultimate) ──
export type UltPhase = 'idle' | 'roar' | 'blast';
export interface UltState {
  charge: number;          // 0..ULT.max (100)
  ready: boolean;          // charge >= ULT.max (latched; 'ultCharged' emitted on the rising edge)
  phase: UltPhase;
  t: number;               // seconds in the current phase
  x: number; z: number;    // blast centre (latched at fire)
  r: number;               // blast radius R (m), latched at fire = ultRadius(w)
  pulse: number;           // index of the next scheduled pulse (data/ultimates.ts)
  lockT: number;           // > 0: charge frozen after a fire (ULT.lockoutS)
  /** > 0: the titan takes NO damage of any kind, dot included (ROAR; perk revive window). titansim.ts
   *  hurtTitan returns 0 while it is > 0 (L0 pre-wire). stepUltimate counts it down. */
  invulnT: number;
  fired: number;           // ultimates fired this run
  kills: number;           // kills credited to the ultimate in flight
  killsBest: number;       // best single-ultimate kill count this run (tally/goals)
  heal: number;            // BRIARWICK heal-over-time pool left (HP), 0 otherwise
  // ── kill-XP bank (§3.5 / perf): kills while phase !== 'idle' do not spawn their own scrap; they bank
  //    here and stepUltimate flushes ≤ ULT.bankPickupsPerTick merged pickups per tick ──
  bankXp: number; bankMass: number;
  /** true while meta/powerups.ts runs its DEMOLITION kill loop: those kills bank too (normal XP, no
   *  killXpMul, no xpCap) so a screen of kills never spawns hundreds of pickups in one tick */
  bankOpen: boolean;
  bankPts: number[];       // x,z pairs of the first kills banked this tick (≤ 2 × ULT.bankPickupsPerTick numbers)
  xpCap: number;           // XP this fire may still grant (latched at fire = ULT.xpCapLevelFrac × current level's XP need)
  xpTotal: number;         // XP granted through the bank this run (GATE 2 reporting)
}

// ── #4 objectives + #8 power-ups (one map-state struct) ──
export type ObjectiveKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex';
export const OBJECTIVE_KINDS: readonly ObjectiveKind[] = ['overloadSite', 'reliefDepot', 'recordsAnnex'];
/** what an objective is bound to: a tagged building (Size II+ OVERLOAD SITE, RECORDS ANNEX), a tagged
 *  static prop (Size I OVERLOAD SITE), or nothing (RELIEF DEPOT, a free-standing entity). */
export type ObjectiveTarget = 'building' | 'prop' | 'none';
export interface Objective {
  id: number;              // newId(w)
  kind: ObjectiveKind;
  alive: boolean;          // false once done or expired (compacted every 30 ticks)
  x: number; z: number;    // marker anchor (building centre / prop / crate centre)
  target: ObjectiveTarget;
  targetId: number;        // building id or prop id; -1 for 'none'
  r: number;               // reliefDepot contact radius (m) / building half-diagonal for markers
  h: number;               // marker height anchor (m): building height, prop height or crate height
  t: number;               // age (s)
  life: number;            // expires after this (s)
  rank: RankIndex;         // titan rank when placed (sizes the crate + beacon)
  done: boolean;           // completed (payout paid) vs expired
}
export type PowerUpKind = 'cleanup' | 'demolition' | 'redLight' | 'rushHour' | 'backPay';
export const POWERUP_KINDS: readonly PowerUpKind[] = ['cleanup', 'demolition', 'redLight', 'rushHour', 'backPay'];
export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  alive: boolean;
  x: number; z: number;
  t: number;               // age (s)
  life: number;            // POWERUPS.lifeS
  h: number;               // titan height at spawn (sizes the token)
}
export interface MapState {
  objectives: Objective[];
  powerups: PowerUp[];
  nextOverloadT: number;   // world.t when the next OVERLOAD SITE may be placed
  nextReliefT: number;
  annexDue: number[];      // world.t values at which a RECORDS ANNEX is owed (pushed on rankUp)
  lastDropT: number;       // world.t of the last RANDOM power-up drop (gap rule)
  redLightT: number;       // > 0: RED LIGHT active (s left)
  rushHourT: number;       // > 0: RUSH HOUR active (s left)
  overloadsDone: number; reliefsDone: number; annexesDone: number;   // this run (tally mirrors them)
  // GATE 2 reporting (probe_sim prints them; never read by gameplay)
  overloadXp: number;      // XP granted by OVERLOAD SITE payouts this run
  demolitionKills: number; // kills made by DEMOLITION NOTICE this run
}

// ── #8 endless ──
export interface EndlessState {
  startT: number;          // world.t at KEEP GOING
  rematches: number;       // rematch bosses defeated
  nextBossT: number;       // world.t for the next rematch (Infinity while one is alive)
  bossIx: number;          // index into rematchOrder(biome)
  nextEliteT: number;
  killsAt: number;         // titan.kills at KEEP GOING (score counts kills since)
  tonsAt: number;          // run.tonnage at KEEP GOING
  score: number;           // endlessScore(w), refreshed every tick
}

// ── #5 / #8 run tally (sim-side counters the goals read; THREE-free, deterministic) ──
export interface RunTally {
  kills: number; crushed: number;
  killsBy: Record<EnemyKind, number>;
  props: number;
  propsBy: Partial<Record<PropKind, number>>;
  floors: number;
  collapses: number;
  collapsesByTier: [number, number, number, number, number];
  tier4Total: number;      // tier-4 buildings the city generated (set on the first stepTally; g_ws_cold_storage)
  ults: number; ultKillsBest: number;
  objectives: Record<ObjectiveKind, number>;
  powerups: Record<PowerUpKind, number>;
  evolutions: number; banishes: number; locks: number; rerolls: number;
  hpLowFrac: number;       // lowest hp/maxHp seen this run (1 at start)
  healed: number;          // HP healed this run (titanHeal events)
  bossesDefeated: number;
  bossDefeatedBy: Partial<Record<BossId, number>>;
  staggersThisFight: number;
  /** best staggers in ONE fight per boss — the city's own boss fight only (a boss fielded while
   *  w.endless is set, i.e. a rematch, does not count) */
  staggersBestFightBy: Partial<Record<BossId, number>>;
  fightIsRematch: boolean; // bookkeeping for the above
  endlessS: number;
  // kit-derived (event-derived, never read from kit-private state)
  vacuumBest: number;      // MOLO: pickups collected within HOOK_WINDOW_S of one 'ability' event
  wiresBest: number;       // VOLT-KITE: most wires in one 'wireDetonate' (pts.length / 4), EXCLUDING detonations
                           // before ultWireUntilT (ultimate-laid wires would make the goal trivial)
  ultWireUntilT: number;   // world.t until which VOLT-KITE's GRIDLOCK SURGE wires may still be live
  hookKillsBest: number;   // any titan: kills within HOOK_WINDOW_S of one 'ability' event
  fullVents: number;       // HEARTHBACK: 'vent' events with power (fill) >= 0.95
  bloomsBest: number;      // BRIARWICK: most titan-owned 'bloom' hazards alive at once WITHOUT data.wild (ult blooms excluded)
  // window bookkeeping (lane-internal but part of the struct so it survives compaction/probes)
  hookT: number;           // world.t of the last 'ability' event (-1 = none)
  hookPickups: number; hookKills: number;
}

// ── #5 meta / unlocks ──
export type PerkId = 'perk_petty_cash' | 'perk_red_tape' | 'perk_warm_mic' | 'perk_safety_inspection' | 'perk_stay_of_demolition' | 'perk_tip_line';
export const PERK_IDS: readonly PerkId[] = ['perk_petty_cash', 'perk_red_tape', 'perk_warm_mic', 'perk_safety_inspection', 'perk_stay_of_demolition', 'perk_tip_line'];

/** Fixed per run, passed in through RunOptions.meta (the app builds it from the profile). The sim only
 *  READS it: which locked cards/evolutions are in the pool, the perk, the cosmetic palette. */
export interface RunMeta {
  unlocked: string[];      // UpgradeDef ids with `locked: true` that this profile has unlocked (sorted)
  perk: PerkId | null;
  palette: number;         // 0 = canonical colours; 1..2 = data/palettes.ts TITAN_PALETTES[titan][i-1] (view-only)
  reviveUsed: boolean;     // perk_stay_of_demolition bookkeeping (sim writes it; starts false)
}
export const EMPTY_RUN_META: Readonly<RunMeta> = Object.freeze({ unlocked: [], perk: null, palette: 0, reviveUsed: false });

/** PARKADE-6 keeps its own keys in BossState.data (no structural change):
 *  tillOpen — s left of the open-till window (> 0 = the TILL drawer is out, §10.2);
 *  tow — 1 while the tow chain holds; deckTilt — rampLaunch deck tilt 0..1 (view);
 *  part_till / part_booth / part_body / part_legs — titan damage dealt per part group (probe telemetry).
 *  parkade6.ts step() REWRITES the 'till' BossPart every tick (FEATURES_V2 §10.2). */
export type BossDataKeysParkade = 'tillOpen' | 'tow' | 'deckTilt' | 'part_till' | 'part_booth' | 'part_body' | 'part_legs';

// ── v2 data shapes (new data files) ──
/** data/ultimates.ts ULTS: Record<TitanId, UltDef>. Radii are fractions of R (the blast radius). */
export interface UltPulse { t: number; r0: number; r1: number; dmg: number; kind: DamageKind; knock?: number; stun?: number }
export interface UltDef {
  id: string; name: string; burst: string; desc: string;
  roarS: number;           // windup (invulnerable) before the first pulse
  blastS: number;          // blast phase length after the roar
  pulses: UltPulse[];      // t = seconds after the roar ends
}

/** data/objectives.ts per-biome config. */
export interface ObjectiveBiomeCfg {
  overloadRespawnS: number; reliefRespawnS: number;
  overloadLabel: string;          // Size II+ building dressing: 'rooftop transformer' / 'pump house' / 'tide relay'
  overloadLabelS1: string;        // Size I prop dressing: 'utility truck' / 'generator container' / 'relay container'
  overloadPropsS1: PropKind[];    // static props eligible at Size I (tier 1 first, then tier 0)
  reliefLabel: string; annexLabel: string;
  reliefProps: PropKind[];
}

/** data/evolutions.ts (EVO_OF_BASE: Readonly<Record<string, string>> maps base id → evo id). */
export interface EvolutionRow { id: string; base: string; with: string }

/** data/goals.ts GOALS: GoalDef[] (40). */
export type GoalMetric =
  | 'runsFinished' | 'peakRank' | 'clears' | 'biomesCleared' | 'kills' | 'cleanClear' | 'ults' | 'banishesLife'
  | 'blocks' | 'endlessS' | 'bossesInRun' | 'evolutionsLife' | 'powerups' | 'objectives' | 'vacuumBest' | 'crushed'
  | 'titanClears' | 'titanBiomesCleared' | 'wiresBest' | 'hookKillsBest' | 'fullVents' | 'bloomsBest' | 'healed'
  | 'props' | 'overloadSites' | 'tier4CollapseFrac' | 'bossKillsLife' | 'staggersBestFight' | 'boats' | 'fastClearS';
export type UnlockRef =
  | { kind: 'card'; id: string }             // locked UpgradeDef (incl. evolutions)
  | { kind: 'perk'; id: PerkId }
  | { kind: 'palette'; titan: TitanId; index: 1 | 2 };
export interface GoalDef {
  id: string; name: string; desc: string;
  group: 'general' | 'titan' | 'city';
  titan?: TitanId; biome?: BiomeId; boss?: BossId;
  metric: GoalMetric;
  target: number;
  scope: 'run' | 'life';
  /** 'fastClearS' only: lower is better (target = seconds) */
  lowerIsBetter?: boolean;
  unlocks: UnlockRef[];
}

/** data/palettes.ts TITAN_PALETTES: Record<TitanId, [TitanPalette, TitanPalette]>. */
export interface TitanPalette { id: string; name: string; primary: string; secondary: string; belly: string; accent: string; glow: string; eye: string; extra?: string }

/** data/perks.ts PERKS_DEF: Record<PerkId, PerkDef>. */
export interface PerkDef { id: PerkId; name: string; desc: string; card: string | null }

/** meta/goals.ts run context (APP-PURE). */
export interface RunCtx { titan: TitanId; biome: BiomeId; result: 'clear' | 'dead' | null; endT: number }

/** save.ts profile (key 'blocktooth.profile.v1', sanitised by meta/profile.ts sanitizeProfile). */
export interface Profile {
  v: 1;
  done: Record<string, number>;          // goal id → epoch ms of first completion
  best: Record<string, number>;          // goal id → best progress value seen (x in "x of y")
  life: {
    runs: number; clears: number; banishes: number; evolutions: number;
    clearedBy: Record<TitanId, BiomeId[]>;     // distinct biomes cleared per titan
    bossKills: Partial<Record<BossId, number>>;
  };
  perk: PerkId | null;                   // last equipped perk (re-offered on the select screen)
  palette: Record<TitanId, number>;      // last chosen palette per titan
  cineSeen: Record<string, 1>;           // `${titan}.${biome}` → the FULL cinematic has played once
  newUnlocks: string[];                  // card ids not yet seen in a draft ("NEW" ribbon); game.ts removes the
                                         // ids of each offer it shows (markSeen) and saves at once
}
