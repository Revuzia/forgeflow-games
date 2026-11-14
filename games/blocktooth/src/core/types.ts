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

import type { BotMemory, PlayerSeat, PlayerVs, VsPhase, VsWorld } from '../vs/types.ts';
export type { PlayerSeat } from '../vs/types.ts';

// ─────────────────────────────── ids ───────────────────────────────
export type TitanId = 'molo' | 'voltkite' | 'hearthback' | 'briarwick';
export type BiomeId = 'grideast' | 'whitestacks' | 'lockwater';
/** The three city bosses (v2: parkade6 = GRID-EAST's boss, FEATURES_V2 §10). BIOMES[*].boss narrows to this. */
export type MainBossId = 'caisson4' | 'irongully' | 'parkade6';
/** The three gatekeepers (GATEKEEPERS.md §2). */
export type GateId = 'stencil1' | 'cordon2' | 'switchboard5';
/** GATEKEEPERS §7.2: gatekeepers run on the shared boss framework, in the w.boss slot. */
export type BossId = MainBossId | GateId;
/** BOSS_IDS keeps its meaning (the city bosses; goals, rematchOrder); its type narrows to MainBossId. */
export const BOSS_IDS: readonly MainBossId[] = ['caisson4', 'irongully', 'parkade6'];
export const GATE_IDS: readonly GateId[] = ['stencil1', 'cordon2', 'switchboard5'];
/** Slot = the Size the fight guards: 1..3 the gatekeeper for the Size 1..3 breach, 4 the city boss
 *  (the Size V finale), 0 none. GATE_OF_SLOT[s] for s 1..3. */
export type GateSlot = 0 | 1 | 2 | 3 | 4;
export const GATE_OF_SLOT: readonly (GateId | null)[] = [null, 'stencil1', 'cordon2', 'switchboard5', null];
export type BossRole = 'main' | 'gate';
/** true for the three gatekeeper ids (type guard). */
export function isGateId(id: string): id is GateId { return id === 'stencil1' || id === 'cordon2' || id === 'switchboard5'; }
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
  /** VS CARD RAIL (B-CORE): 1..3 = pick that card of the rail offer this tick (edge), 0 / absent = none. Never set in
   *  solo (solo drafts go through the modal draft screen + pickUpgrade). Wire form = the 4th input byte (netcode.md §6.3). */
  railPick?: number;
  /** VS CARD RAIL: edge, reroll the current rail offer (spends `rerolls` like the modal draft). */
  railReroll?: boolean;
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
  | 'carLob'                                                                  // v2 hostile: PARKADE-6's lobbed car (lob, circle tell like 'plate')
  | 'paintCan' | 'sawhorse' | 'callFlare';                                    // GATEKEEPERS §7.2: hostile lobs, circle/capsule tells

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

export type HazardKind = 'wire' | 'magma' | 'bloom' | 'spore' | 'frost' | 'fire' | 'oil'
  | 'paint';   // GATEKEEPERS §7.2: WET PAINT (slow only, owner 'boss')

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
  // ── GATEKEEPERS §7.2 (BossStateAddV3) ──
  role: BossRole;
  /** the Size this fight guards (1..4); 0 for a rematch in EXTENDED COVERAGE */
  slot: GateSlot;
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

// ── TITAN PASS D1 BUILD SLOTS (FEATURES_V2 §7.7; upgrades/draft.ts SLOT_CAP · slotsUsed · slotsFull · cardSlot) ──
/** What an offered card is to the slot rule (draft UI tag):
 *  'new' = not owned, takes a new slot · 'upgrade' = owned, another stack · 'shared' = the missing half of a
 *  started evolution recipe, files into its partner's slot · 'evolution' = a ready evolution (takes its base's slot) ·
 *  'overflow' = an OverflowRewardId (no slot, never owned) · 'free' = a ONE-OFF card (maxStacks 1, not an evolution
 *  or perk): files outside the slots, offered only while the slots are filling. */
export type DraftCardSlot = 'new' | 'upgrade' | 'shared' | 'evolution' | 'overflow' | 'free';
/** Served when an owed draft has NOTHING offerable (slots full and every slotted card maxed / banished, no recipe
 *  half and no evolution ready). The ids go in UpgradeState.offer like card ids; pickUpgrade applies one at once,
 *  consumes the draft, and it never enters owned / order / slots. Deterministic (no rng draw). */
export type OverflowRewardId = 'ovf_sick_day' | 'ovf_hot_tip' | 'ovf_hard_hat';
export const OVERFLOW_REWARD_IDS: readonly OverflowRewardId[] = ['ovf_sick_day', 'ovf_hot_tip', 'ovf_hard_hat'];

// ─────────────────────────────── director / run ───────────────────────────────
export type RunPhase = 'intro' | 'waves' | 'elite' | 'boss' | 'clear' | 'dead' | 'endless' | 'vsend';   // 'vsend' = a VS match was decided (run.result 'vs')   // v2: 'endless' after KEEP GOING (§9)

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
  result: 'clear' | 'dead' | 'vs' | null;   // 'vs' = a VS match was decided (World.vs.winner)
  tonnage: number;         // cosmetic running total of flattened mass (tons)
  blocksLeveled: number;   // blocks whose buildings are all collapsed
  peakRank: RankIndex;
}

// ─────────────────────────────── events ───────────────────────────────
/** Emitted by sim systems into world.events during a tick. The view/audio/UI read them;
 *  the upgrade engine fires triggers from them. Never mutate after emit.
 *  B-CORE (online VS): every event carries `p`, the slot of the player that was bound (World.cur) when it was pushed
 *  (-1 = pushed in a VS world-scoped phase with no owner bound). It is stamped by the World.events sink
 *  (core/players.ts EventSink), never written by the 105 push sites. Titan-scoped consumers (processTriggers,
 *  chargeUltimate, stepTally) read only events with `p === w.cur`. Solo: always 0. */
export type SimEvent = SimEventBody & { p?: number };
export type SimEventBody =
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
  | { type: 'runEnd'; result: 'clear' | 'dead' }                                  // SOLO only: a VS match end emits vsEnd instead
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
  | { type: 'revive'; x: number; z: number }                                           // perk_stay_of_demolition revive
  // ── GATEKEEPERS §7.2 (SimEventAddV3). The city boss keeps 'bossSpawn' / 'bossDefeated'. ──
  | { type: 'gateLocked'; slot: GateSlot; capped: boolean }        // size held (SIZE LOCKED); slot 4 = the city boss is due
  | { type: 'gateSpawn'; gate: GateId; slot: GateSlot; rematch: boolean }
  | { type: 'gateDefeated'; gate: GateId; slot: GateSlot; x: number; z: number; fightS: number; rematch: boolean }
  | { type: 'gateEscalate'; level: 1 | 2 | 3 }
  | { type: 'gateReposition'; x: number; z: number }                // the gatekeeper cut the titan off
  | { type: 'gateRam'; x: number; z: number }                       // the stuck rule's RAMMING THROUGH (§3.0)
  | { type: 'finale'; on: boolean }                                 // on: same tick as the city boss's kill + rankUp 4
  // ── TITAN PASS (CONTRACT §8 BRIARWICK kit C, §16; lane SIM emits, lanes VIEW / DATA read) ──
  /** a foe is TANGLED by a BRIARWICK pod burst / POP-UP PARK ring: emitted where the kit sets e.stun (id = enemy
   *  id, t = the stun seconds it got). View: root coils around the foe's legs for t s. */
  | { type: 'rooted'; id: number; x: number; z: number; t: number }
  /** view only (CFIX 2026-09-30): a foe that stood inside a BRIARWICK burst / POP-UP PARK ring circle and died to it
   *  (so it never got a `rooted`): the root coil springs shut where it stood. y = its feet, r / h = its body radius / height. */
  | { type: 'rootSnap'; x: number; y: number; z: number; r: number; h: number }
  /** a BRIARWICK seed pod burst: r = burst radius (m); link = its chain link (0 = a lone / first pop, k = the k-th
   *  link of a chain or POP-UP PARK cascade); ripe = its ripeness at the burst (1 = ripe; < 1 = an unripe pod that
   *  burst at end of life / at the cap). View: petal burst, pitch +1 semitone per link; tally: cascadeBest. */
  | { type: 'bloomBurst'; x: number; z: number; r: number; link: number; ripe: number }
  // ── REPAIR CREWS (city/citysim.ts rebuild): WARD-7 Public Works rebuilds smashed buildings away from the titan ──
  /** stage 'start' = a crew sets up on a rubble lot (scaffold goes up); 'floor' = a storey is finished (alive = floors
   *  standing now; the first one un-collapses the building); 'done' = fully rebuilt (n = buildings rebuilt this run). */
  | { type: 'rebuild'; stage: 'start' | 'floor' | 'done'; id: number; alive: number; x: number; z: number; n: number }
  // ── ONLINE VS (B-CORE contract; vs_design.md §13). Emitted by the VS lane (p = the bound slot, or -1 for match-level ones).
  //    Slots are PlayerState.slot; shapes are the starting proposal, B-VS may add fields (never rename). ──
  | { type: 'vsPhase'; phase: VsPhase }
  | { type: 'rivalHit'; from: number; to: number; pct: number; x: number; z: number; noContest: boolean }   // noContest: OPEN HOUSE shove (no HP)
  | { type: 'evicted'; victim: number; killer: number; assists: number[]; levelsLost: number; x: number; z: number }
  | { type: 'eliminated'; victim: number; killer: number; place: number }
  | { type: 'respawn'; slot: number; x: number; z: number }
  | { type: 'tenderMarker'; gate: GateId; x: number; z: number; leadS: number }
  | { type: 'tenderSpawn'; gate: GateId; x: number; z: number }
  | { type: 'tenderPaid'; gate: GateId; shares: number[]; top: number }
  | { type: 'crown'; holder: number }
  | { type: 'ringStep'; step: number; r: number }
  | { type: 'vsEnd'; winner: number; placements: number[]; scores: number[] }
  // ── CARD RAIL (VS drafts that never pause the sim; PlayerState.rail) ──
  | { type: 'railOffer'; cards: string[]; chest: boolean }
  | { type: 'railPick'; id: string; auto: boolean };

/** Keys into data/strings.ts ALERTS (full-width broadcast banners). */
export type AlertKey =
  | 'contractors' | 'squads' | 'drones' | 'vehicles' | 'armor' | 'artillery' | 'elite' | 'boss'
  | 'bossPhase2' | 'bossPhase3' | 'lowHp' | 'chest'
  | 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch'    // v2 (FEATURES_V2 §2.5)
  | 'gate1' | 'gate2' | 'gate3' | 'gateEscalate' | 'gateRematch' | 'finale';   // GATEKEEPERS §6.6

// ─────────────────────────────── world ───────────────────────────────
export interface RngStreams {
  city: () => number; spawn: () => number; ai: () => number;
  combat: () => number; loot: () => number; boss: () => number;
  /** v2: objective placement, power-up drops/kinds, endless skew (seeded by hashStr('meta'): shifts no other stream) */
  meta: () => number;
}

/** Solo = the shipped single-titan game (byte-identical to before B-CORE). VS = 1..4 titans, no draft freezes,
 *  no size locks, no city boss, no endless; the VS rules run through the src/vs hooks (core/world.ts stepWorldN). */
export type GameMode = 'solo' | 'vs';
export const MAX_PLAYERS = 4;

/**
 * B-CORE (online VS): everything that is PER PLAYER, in one container (netcode.md §2.2). `World.players[slot]`.
 * The old per-player World fields (titan, titanId, upgrades, ult, tally, meta, input, director) are now a CURSOR:
 * `bindPlayer(w, slot)` (core/players.ts) points them at that player's container, so existing `w.titan`-style code
 * runs unchanged for whichever player is bound. Mutate THROUGH the cursor (w.titan.hp -= ...), never replace a
 * cursor field (w.titan = ...): the next bindPlayer would silently restore the container's object.
 */
export interface PlayerState {
  slot: number;            // seat index 0..3 == index in World.players
  titanId: TitanId;
  titan: TitanState;
  upgrades: UpgradeState;  // builds + the modal-draft offer state (solo) — the CARD RAIL offer rides in `rail` + upgrades.offer
  ult: UltState;
  tally: RunTally;
  meta: RunMeta;           // VS: sanitized to the fresh pool (palette only)
  input: TitanInput;       // this tick's latched command (stepWorldN writes humans' here; the VS bot brain writes bots')
  director: DirectorState; // per-player PvE director (waves / budget relative to THIS titan)
  rail: CardRailState;     // VS CARD RAIL offer state (inert in solo)
  /** per-player credit counters (World.run keeps the WORLD totals); maintained by creditTonnage / creditBlock + stepWorldN */
  run: PlayerRun;
  vs: PlayerVs;            // VS bookkeeping (src/vs/types.ts); neutral in solo
  /** null = a human seat; else the bot brain memory (the VS lane fills `input` for it each tick) */
  bot: BotMemory | null;
}

/** Per-player run counters (the player-credited slice of World.run). */
export interface PlayerRun { tonnage: number; blocksLeveled: number; peakRank: RankIndex }

/**
 * VS CARD RAIL (vs_design.md §7): 3 cards slide up while play continues. The CURRENT OFFER is
 * `upgrades.offer` (so draft.ts rollOffer / pickUpgrade / rerollOffer work unchanged on it); this struct is the
 * rail's timing + cadence state. Inert (never touched) in solo. B-TITAN owns the logic that fills it.
 */
export interface CardRailState {
  /** an offer is up on the rail (mirror of upgrades.offer !== null while in VS) */
  open: boolean;
  openedT: number;         // world.t the current offer slid up (-1 none)
  expireT: number;         // world.t the 12 s auto-pick fires (Infinity none)
  /** the open offer is a tender chest (rare+, pickUpgrade consumes upgrades.chestDrafts) */
  chest: boolean;
  /** offers presented so far (sequence number; the net layer / logs name an offer by (slot, seq)) */
  seq: number;
  /** level-ups since the last draft was owed (draft cadence: every level to LV 12, then every 2nd) */
  sinceDraft: number;
  /** the pre-match opening card was taken */
  openingDone: boolean;
  /** free numeric scratch for the rail logic (numeric so it hashes) */
  data: Record<string, number>;
}

export interface World {
  seed: number;
  /** ── CURSOR fields (titanId, titan, director, upgrades, input, meta, ult, tally): point at the BOUND player
   *  (players[cur]); see PlayerState / bindPlayer. In solo they always point at players[0]. ── */
  titanId: TitanId;
  biomeId: BiomeId;
  tick: number;
  t: number;               // sim seconds since run start
  dt: number;              // fixed step (1 / SIM_HZ)
  rng: RngStreams;
  city: CityLayout;
  titan: TitanState;       // CURSOR (bound player's titan)
  enemies: Enemy[];        // pooled; iterate and skip !alive
  projectiles: Projectile[];
  telegraphs: Telegraph[];
  hazards: Hazard[];
  pickups: Pickup[];
  boss: BossState | null;
  director: DirectorState; // CURSOR
  upgrades: UpgradeState;  // CURSOR
  run: RunStats;           // WORLD-level (phase / result / endT / world totals); per-player slice = PlayerState.run
  events: SimEvent[];      // this tick's events (cleared at the start of every tick); a sink: push() stamps ev.p = cur
  input: TitanInput;       // CURSOR: latched command for this tick (bound player's)
  // ── B-CORE (online VS) ──
  mode: GameMode;
  /** all seats, index = slot; length 1 in solo. Per-player containers live here (see PlayerState). */
  players: PlayerState[];
  /** slot of the BOUND player (events pushed now are stamped with it); -1 = a VS world-scoped phase with NO owner
   *  bound (cursor fields then point at players[0] as a deterministic fallback — do not rely on them). Solo: always 0. */
  cur: number;
  /** the bound PlayerState (== players[max(cur, 0)]) */
  pl: PlayerState;
  /** the local seat the VIEW/app follows: stepWorldN leaves the cursor bound to it at the end of every tick, so
   *  existing view/HUD/audio code that reads w.titan keeps working for the local player. Never read by the sim. */
  view: number;
  /** World-level VS state (phase machine, ring, tenders, crown, result); null in solo. */
  vs: VsWorld | null;
  /** cheats (only honoured when the page was opened with ?dev=1) */
  cheats: { god: boolean; noSpawns: boolean };
  nextId: number;          // monotonically increasing id source — use newId(w)
  // ── v2 (FEATURES_V2 §2.3): createWorld initialises every one ──
  meta: RunMeta;           // CURSOR · sanitizeRunMeta(opts.meta) — read-only for the sim except reviveUsed
  ult: UltState;           // CURSOR · createUltState()
  map: MapState;           // createMapState()
  tally: RunTally;         // CURSOR · createTally()
  endless: EndlessState | null;   // null until continueEndless()
  // ── GATEKEEPERS §7.2 (WorldAddV3) ──
  gates: GatesState;       // meta/gates.ts createGates()
}

export interface RunOptions {
  /** solo: the titan (required unless `players` is given; with `players`, slot 0's titan wins and this is ignored) */
  titan?: TitanId; biome: BiomeId; seed: number;
  /** v2: profile-derived run meta (unlocks, perk, palette); EMPTY_RUN_META when absent. Solo only (VS: per seat). */
  meta?: RunMeta;
  /** B-CORE: 'solo' (default) or 'vs' */
  mode?: GameMode;
  /** B-CORE: the seats. Solo: omit, or exactly 1 seat. VS: 1..4 seats (index = slot). Bot seats (`bot` set) are driven
   *  by the VS bot brain. */
  players?: PlayerSeat[];
  /** B-CORE: the local seat the view follows (default 0) */
  view?: number;
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
  boss: MainBossId;
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
  // ── GATEKEEPERS §7.2 (BossDefAddV3). Main bosses: role 'main', slot 4, kicker ''. ──
  role: BossRole;
  slot: GateSlot;
  /** small line above the nameplate name, e.g. 'GATEKEEPER · SIZE I HEIGHT LIMIT' ('' = none) */
  kicker: string;
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
  bloomsBest: number;      // BRIARWICK (pre-TITAN PASS goal metric, kept for save/probe compatibility): most titan-owned
                           // 'bloom' hazards alive at once WITHOUT data.wild (ult blooms excluded)
  /** TITAN PASS: BRIARWICK's longest pod chain this run, in links (+1 = pods in the chain), from 'bloomBurst'
   *  events (meta/tally.ts; lane DATA decides and documents whether UPROAR-seeded chains count). Goal FULL BLOOM. */
  cascadeBest: number;
  // window bookkeeping (lane-internal but part of the struct so it survives compaction/probes)
  hookT: number;           // world.t of the last 'ability' event (-1 = none)
  hookPickups: number; hookKills: number;
  // ── GATEKEEPERS §7.2 (RunTallyAddV3; meta/tally.ts, event-derived; lane K1a fills the cases) ──
  gateKills: number;
  gateCleanKills: number;                              // gate kills with gateFightDmg === 0 at the kill
  gateTotalFightS: number;                             // Σ spawn→kill of slots 1..3 (Infinity until all three died)
  gateTippedFastS: number;                             // STENCIL-1: seconds from spawn to its first TIPPED OVER (Infinity)
  gateStallsBestFight: number;                         // CORDON-2: most STALLED in one fight
  gateSwitchFastS: number;                             // SWITCHBOARD-5: fastest spawn→kill (Infinity)
  gateRematches: number;                               // gatekeeper rematches won this run (EXTENDED COVERAGE)
  gateStaggersThisFight: number;                       // bookkeeping (reset on gateSpawn)
  gateFightDmg: number;                                // titan damage taken since the live gate fight spawned (reset on gateSpawn)
}

// ── #5 meta / unlocks ──
export type PerkId = 'perk_petty_cash' | 'perk_red_tape' | 'perk_warm_mic' | 'perk_safety_inspection' | 'perk_stay_of_demolition' | 'perk_tip_line'
  | 'perk_deferred_maintenance';   // GATEKEEPERS §6.5 (unlocked by WITHOUT A DENT; applied by bosses/index.ts spawnGate)
/** The perks the select screen offers and probe_meta counts (lane K2c added DEFERRED MAINTENANCE with its goal WITHOUT A DENT). */
export const PERK_IDS: readonly PerkId[] = ['perk_petty_cash', 'perk_red_tape', 'perk_warm_mic', 'perk_safety_inspection', 'perk_stay_of_demolition', 'perk_tip_line', 'perk_deferred_maintenance'];

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
  | 'props' | 'overloadSites' | 'tier4CollapseFrac' | 'bossKillsLife' | 'staggersBestFight' | 'boats' | 'fastClearS'
  // GATEKEEPERS §6.5 (lane K2c fills goalProgress; K0 returns the neutral value)
  | 'gateTippedFastS' | 'gateStallsBestFight' | 'gateSwitchFastS' | 'gateCleanKills' | 'gateTotalFightS' | 'gateRematchesLife'
  // TITAN PASS (lane DATA retargets g_bw_full_bloom to it and fills goalProgress; T0: neutral value 0)
  | 'cascadeBest';
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
  /** lower is better (target = seconds): 'fastClearS' and the timed gate metrics gateTippedFastS / gateSwitchFastS / gateTotalFightS */
  lowerIsBetter?: boolean;
  unlocks: UnlockRef[];
}

/** data/palettes.ts TITAN_PALETTES: Record<TitanId, [TitanPalette, TitanPalette]>. */
export interface TitanPalette { id: string; name: string; primary: string; secondary: string; belly: string; accent: string; glow: string; eye: string; extra?: string }

/** data/perks.ts PERKS_DEF: Record<PerkId, PerkDef>. */
export interface PerkDef { id: PerkId; name: string; desc: string; card: string | null }

/** meta/goals.ts run context (APP-PURE). */
export interface RunCtx { titan: TitanId; biome: BiomeId; result: 'clear' | 'dead' | 'vs' | null; endT: number }

/** save.ts profile (key 'blocktooth.profile.v1', sanitised by meta/profile.ts sanitizeProfile). */
export interface Profile {
  v: 1;
  done: Record<string, number>;          // goal id → epoch ms of first completion
  best: Record<string, number>;          // goal id → best progress value seen (x in "x of y")
  life: {
    runs: number; clears: number; banishes: number; evolutions: number;
    clearedBy: Record<TitanId, BiomeId[]>;     // distinct biomes cleared per titan
    bossKills: Partial<Record<BossId, number>>;
    /** GATEKEEPERS §6.5 (lane K2c): gatekeeper rematches won in EXTENDED COVERAGE, lifetime (goal REISSUED) */
    gateRematches: number;
  };
  perk: PerkId | null;                   // last equipped perk (re-offered on the select screen)
  palette: Record<TitanId, number>;      // last chosen palette per titan
  cineSeen: Record<string, 1>;           // `${titan}.${biome}` → the FULL cinematic has played once
  newUnlocks: string[];                  // card ids not yet seen in a draft ("NEW" ribbon); game.ts removes the
                                         // ids of each offer it shows (markSeen) and saves at once
}

// ═══════════════════════════════ GATEKEEPERS (§7.2 — merged by lane K0) ═══════════════════════════════
/** World.gates (meta/gates.ts). Deterministic, THREE-free. */
export interface GatesState {
  /** highest Size rank the titan may hold: 0 at the start; r after gate r's kill; 4 after the city boss's kill */
  unlocked: RankIndex;
  /** the breach the titan is waiting at (level ≥ RANK_LEVELS[slot] or the time cap, rank = slot − 1); 0 = none */
  pending: GateSlot;
  /** the fight alive right now (w.boss is it); 0 = none */
  active: GateSlot;
  capped: boolean;         // the pending lock came from the time cap (level below the gate level)
  lockT: number;           // world.t the pending lock began (-1)
  dueT: number;            // world.t the pending fight spawns (Infinity while nothing is pending)
  lastBreachT: number;     // world.t of the last gate breach (-1) — GATES.chainGapS
  spawnT: number[];        // index = slot 1..4 → spawn world.t (NaN until)
  killT: number[];         // index = slot 1..4 → kill world.t (NaN until)
  fightS: number;          // Σ seconds a gatekeeper or the city boss has been alive this run
  pressure: 0 | 1 | 2 | 3; // containment escalation of the live gate fight
  ignoredS: number;        // seconds since the titan last damaged the live gatekeeper
  engagedS: number;        // seconds of the live gate fight in which the titan damaged it within 5 s (fatigue clock)
  farS: number;            // seconds the titan has been farther than GATES.repositionRingMul × spawnRing
  dpsWin: number;          // titan damage to the gatekeeper in the current TUMBLING 1 s window (GATES.dpsCapFrac; damageBoss writes it)
  dpsWinT: number;         // start of that window (world.t); a hit at w.t >= dpsWinT + 1 starts a new window (dpsWin = 0)
  liveFightS: number;      // seconds since the live gate fight's intro ended (fatigue floor: clock = max(engagedS, 0.5 × liveFightS))
  lastAddHitT: number;     // world.t the titan last damaged one of the live gatekeeper's adds (-Infinity) — engagement rule (b)
  breachDue: GateSlot;     // set by defeat(); flushGateBreach() at the end of stepWorld runs the breach on that tick (0 = none)
  mainEarliestT: number;   // GATES.mainEarliestS (copied at createGates so a cheat/probe can move it)
  rematchN: [number, number, number];  // gatekeeper rematches defeated, by GATE_IDS index (EXTENDED COVERAGE)
  rematchSeq: number;      // alternation index of the EXTENDED COVERAGE rotation (even = gatekeeper, odd = city boss)
  finaleT: number;         // > 0: the Size V finale is running (s left)
  finaleDone: boolean;     // the finale ended → checkRunEnd clears the run
  mainKillT: number;       // world.t of the city boss's kill (-1) — becomes run.endT on clear
  topUpLevels: number;     // levels granted by time-cap top-ups this run (probe telemetry)
  rematchGates: number;    // gatekeeper rematches defeated in EXTENDED COVERAGE
}
