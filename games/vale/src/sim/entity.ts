// VALE sim — entity, player and team records.
//
// `Entity` implements the presentation's `EntityView` directly (CONTRACT §5.1: `view` is live and
// read-only), so building a view is zero-copy: the renderer reads these objects as they are. The
// public fields are exactly the EntityView fields; everything below "internal" is sim-only state
// that the presentation must not rely on. Likewise `Player` implements `PlayerView`, `TeamState`
// implements `TeamView`, `AbilitySlot` implements `AbilityView`, statuses/buffs extend their views.
//
// Class fields are all initialised in declaration order so every Entity has one hidden class
// (monomorphic property access in the hot loops).

import type {
  FighterDefT, UnitDefT, ResourceDefT, PassiveDefT, StatKeyT, SlotT, StatusKindT, DamageTypeT, ShapeT,
  EffectT, StatBlockT, TeamBuffDefT, Trigger, Present, Condition,
} from '../contracts/catalog.ts';
import type {
  EntityView, EntityKind, ActionState, StatusView, BuffView, AbilityView, PlayerView, TeamView, FighterStatsView,
  EntityId, PlayerId, TeamId, SeatSetup,
} from '../contracts/sim.ts';
import type { z } from 'zod';
import type { AbilityCoreT } from './catalog_index.ts';

export type PresentT = z.infer<typeof Present>;
export type TriggerT = z.infer<typeof Trigger>;
export type TriggerOn = TriggerT['on'];
export type ConditionT = z.infer<typeof Condition>;
export type EffOf<K extends EffectT['op']> = Extract<EffectT, { op: K }>;
export type AttackDefT = FighterDefT['attack'];

/** team id for neutral units (monsters): hostile to every team, contributes no vision */
export const NEUTRAL_TEAM = -1;

// ── stats ───────────────────────────────────────────────────────────────────────────────────────
export const STAT_KEYS: readonly StatKeyT[] = [
  'hp', 'hpRegen', 'res', 'resRegen', 'ad', 'ap', 'armor', 'resist', 'attackSpeed', 'range', 'moveSpeed',
  'moveSpeedPct', 'crit', 'critDamage', 'lifesteal', 'omnivamp', 'haste', 'armorPen', 'armorPenPct',
  'magicPen', 'magicPenPct', 'tenacity', 'healShieldPower',
];

/** final stats of an entity; a superset of FighterStatsView so PlayerView.stats can point at it */
export class Stats implements FighterStatsView {
  hp = 0; hpRegen = 0; res = 0; resRegen = 0; ad = 0; ap = 0; armor = 0; resist = 0;
  attackSpeed = 0; range = 0; moveSpeed = 0; moveSpeedPct = 0; crit = 0; critDamage = 0;
  lifesteal = 0; omnivamp = 0; haste = 0; armorPen = 0; armorPenPct = 0; magicPen = 0; magicPenPct = 0;
  tenacity = 0; healShieldPower = 0;

  reset(): void { for (const k of STAT_KEYS) (this as unknown as Record<StatKeyT, number>)[k] = 0; }
  get(k: StatKeyT): number { return (this as unknown as Record<StatKeyT, number>)[k]; }
  setKey(k: StatKeyT, v: number): void { (this as unknown as Record<StatKeyT, number>)[k] = v; }
  /** add every key of a (partial) stat block, times `mult` */
  addBlock(b: StatBlockT | undefined | null, mult = 1): void {
    if (!b) return;
    const self = this as unknown as Record<string, number>;
    for (const k in b) {
      const v = (b as Record<string, number | undefined>)[k];
      if (v !== undefined && k in self) self[k] += v * mult;
    }
  }
}

// ── effect context (CONTRACT §5.3) ──────────────────────────────────────────────────────────────
export interface SourceRef { readonly kind: 'ability' | 'item' | 'boon' | 'spell' | 'passive'; readonly id: string }

/**
 * Context an effect list runs in. Points are flat numbers (no vector objects) so contexts are
 * cheap to fork: `hit`/`end` change per hit while caster/rank/source stay.
 */
export interface EffectCtx {
  caster: Entity;
  rank: number;
  /** the unit target of the cast (unit-targeted abilities, triggers' subject) */
  target: Entity | null;
  /** aimed point */
  px: number; py: number;
  /** aim direction (unit vector) */
  dx: number; dy: number;
  /** the unit the parent effect hit (inside onHit / onPass / perStack lists) */
  hit: Entity | null;
  /** where a projectile/dash ended (anchor 'end') */
  ex: number; ey: number; hasEnd: boolean;
  source: SourceRef;
  present: PresentT | undefined;
  /** nesting depth: triggers fired from triggers stop at MAX_TRIGGER_DEPTH */
  depth: number;
  /** slot the cast came from (cooldown refunds, events) */
  slot: SlotT | null;
}

// ── statuses, buffs, shields, marks, counters ───────────────────────────────────────────────────
export interface Status extends StatusView {
  kind: StatusKindT; remaining: number; duration: number; power: number;
  /** entity that applied it (taunt/fear direction, refresh key) */
  src: EntityId;
  /** team of the applier (reveal grants vision to this team) */
  srcTeam: TeamId;
  basePower: number;
  decay: boolean;
}
export interface Buff extends BuffView {
  id: string; source: string; remaining: number; duration: number; stacks: number; icon?: string;
  src: EntityId;
  /** per-stack stat contribution (stats + resolved statScaling, snapshotted at application) */
  stats: StatBlockT | null;
  empower: EffOf<'buff'>['empowerAttacks'] | null;
  empowerLeft: number;
  maxStacks: number;
  onExpire: EffectT[] | null;
  ctx: EffectCtx | null;
  present: PresentT | undefined;
}
export interface Shield { amount: number; remaining: number; src: EntityId }
export interface Mark { id: string; src: EntityId; stacks: number; remaining: number; max: number }
export interface Counter { id: string; value: number; remaining: number; max: number }

// ── abilities ───────────────────────────────────────────────────────────────────────────────────
/** slot order of Entity.slots (CONTRACT: Slot minus 'passive') */
export const SLOT_NAMES: readonly SlotT[] = ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6'];
export const SLOT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(SLOT_NAMES.map((s, i) => [s, i]));
export const SLOT_COUNT = SLOT_NAMES.length;
export const SLOT_A1 = 0, SLOT_ULT = 3, SLOT_SPELL1 = 4, SLOT_SPELL2 = 5, SLOT_ITEM1 = 6;

export class AbilitySlot implements AbilityView {
  // AbilityView
  slot: SlotT; id: string; rank = 0; maxRank = 1;
  cooldown = 0; cooldownMax = 0; cost = 0;
  charges: number | undefined = undefined; maxCharges: number | undefined = undefined;
  recastWindow: number | undefined = undefined;
  ready = false; canLevel = false;
  // internal
  readonly index: number;
  kind: 'ability' | 'spell' | 'item';
  /** the record this slot was built from (kit ability, spell, item active) */
  baseDef: AbilityCoreT;
  /** the record that casts now (form override or recast); usually === baseDef */
  def: AbilityCoreT;
  /** set while a form overrides this slot */
  formDef: AbilityCoreT | null = null;
  rechargeTimer = 0;
  /** recast record while the window is open */
  recastDef: AbilityCoreT | null = null;
  /** lockout before the recast may be used (the recast record's own cooldown) */
  recastLock = 0;
  /** cooldown owed by the first cast; starts when the recast window closes */
  deferredCd = 0;
  /** cooldowns of records swapped out by forms keep ticking here, keyed by record id */
  stash: Map<string, number> | null = null;
  /** item slots: the item id and index in Player.items */
  itemId: string | null = null;

  constructor(index: number, kind: 'ability' | 'spell' | 'item', def: AbilityCoreT) {
    this.index = index; this.slot = SLOT_NAMES[index]; this.kind = kind;
    this.baseDef = def; this.def = def; this.id = def.id; this.maxRank = def.maxRank;
    if (def.charges) { this.maxCharges = def.charges.max; this.charges = def.charges.max; }
  }
}

// ── passives / triggers ─────────────────────────────────────────────────────────────────────────
export const TRIGGER_ONS: readonly TriggerOn[] = ['attackHit', 'abilityHit', 'abilityCast', 'takedown', 'kill', 'damageTaken',
  'damageDealt', 'interval', 'lowHp', 'spawn', 'death', 'moveDistance', 'shieldBroken', 'statusApplied', 'levelUp'];
export const TRIGGER_INDEX: Readonly<Record<string, number>> = Object.fromEntries(TRIGGER_ONS.map((s, i) => [s, i]));

export interface TriggerInst {
  t: TriggerT;
  passive: PassiveInst;
  /** seconds until it may fire again */
  cd: number;
  /** per-target ready times (lazy) */
  per: Map<EntityId, number> | null;
  /** interval timer / metres moved accumulator */
  acc: number;
  /** lowHp edge detection: fires once per dip below the threshold */
  armed: boolean;
}
export interface PassiveInst {
  def: PassiveDefT;
  kind: SourceRef['kind'];
  /** source id for events/buff sources (passive id) */
  id: string;
  /** removal key ('kit', 'item:2', 'boon:fx_boon', 'team:<buff>') */
  key: string;
  triggers: TriggerInst[];
  /** contributes passive.stats (+ statsPerLevel) */
  stats: boolean;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────
export const ORDER_NONE = 0, ORDER_MOVE = 1, ORDER_ATTACK_MOVE = 2, ORDER_ATTACK = 3, ORDER_CAST = 4;

export interface CastState {
  slot: AbilitySlot | null;
  def: AbilityCoreT;
  ctx: EffectCtx;
  phase: 'windup' | 'channel';
  t: number;
  dur: number;
  tickAcc: number;
  recast: boolean;
}

export interface DashState {
  /** true for a displacement imposed by someone else (knockback/pull) */
  displace: boolean;
  fromX: number; fromY: number; toX: number; toY: number;
  t: number; dur: number;
  eff: EffOf<'dash'> | null;
  ctx: EffectCtx | null;
  passed: EntityId[] | null;
  unstoppable: boolean;
  /** peak height of the arc (airborne displacements) */
  arc: number;
}

export interface ProjData {
  /** basic-attack projectile (homing, payload = attack hit) vs DSL projectile */
  attack: boolean;
  eff: EffOf<'projectile'> | null;
  ctx: EffectCtx | null;
  src: Entity;
  target: EntityId;
  homing: boolean;
  speed: number; range: number; traveled: number; width: number;
  pierceLeft: number;
  hits: EntityId[];
  returning: boolean;
  stopAtWalls: boolean;
  dirX: number; dirY: number;
  /** last known homing-target position (target died → fly there and end) */
  tx: number; ty: number;
  // attack payload
  crit: boolean;
  dtype: DamageTypeT;
  empower: EffectT[] | null;
  empowerSrc: string;
}

export interface ZoneData {
  eff: EffOf<'zone'>;
  ctx: EffectCtx;
  shape: ShapeT;
  remaining: number;
  delay: number;
  tickAcc: number;
  follow: Entity | null;
  dirX: number; dirY: number;
  inside: Set<EntityId>;
  next: Set<EntityId>;
  active: boolean;
}

// ── damage log (death recap) ────────────────────────────────────────────────────────────────────
export interface DamageLogEntry { t: number; src: EntityId; srcName: string; srcDef: string; ability?: string; amount: number; dtype: DamageTypeT }
export class DamageLog {
  readonly entries: DamageLogEntry[];
  readonly cap: number;
  head = 0; count = 0;
  constructor(cap = 96) {
    this.cap = cap;
    this.entries = [];
    for (let i = 0; i < cap; i++) this.entries.push({ t: -1, src: -1, srcName: '', srcDef: '', ability: undefined, amount: 0, dtype: 'phys' });
  }
  push(t: number, src: EntityId, srcName: string, srcDef: string, ability: string | undefined, amount: number, dtype: DamageTypeT): void {
    const e = this.entries[this.head];
    e.t = t; e.src = src; e.srcName = srcName; e.srcDef = srcDef; e.ability = ability; e.amount = amount; e.dtype = dtype;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }
  /** entries with t ≥ since, oldest first (fresh copies: safe to keep) */
  since(since: number): DamageLogEntry[] {
    const out: DamageLogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const e = this.entries[(this.head - this.count + i + this.cap) % this.cap];
      if (e.t >= since) out.push(e.ability === undefined
        ? { t: e.t, src: e.src, srcName: e.srcName, srcDef: e.srcDef, amount: e.amount, dtype: e.dtype }
        : { ...e });
    }
    return out;
  }
}

// ── CC flags (recomputed from statuses whenever the list changes) ───────────────────────────────
export const CC_STUN = 1, CC_ROOT = 2, CC_SILENCE = 4, CC_DISARM = 8, CC_TAUNT = 16, CC_FEAR = 32,
  CC_AIRBORNE = 64, CC_SLEEP = 128, ST_INVISIBLE = 256, ST_UNTARGETABLE = 512, ST_UNSTOPPABLE = 1024;
/** cannot act at all */
export const CC_HARD = CC_STUN | CC_AIRBORNE | CC_SLEEP;

// ── the entity ──────────────────────────────────────────────────────────────────────────────────
export class Entity implements EntityView {
  // EntityView ------------------------------------------------------------------------------
  readonly id: EntityId;
  kind: EntityKind;
  def: string;
  team: TeamId;
  owner: PlayerId | -1 = -1;
  x = 0; y = 0; facing = 0; radius = 0.5;
  hp = 0; maxHp = 0; shield = 0; res = 0; maxRes = 0; level = 1;
  state: ActionState = 'idle'; stateTime = 0; stateDuration = 0; anim = 'idle';
  statuses: Status[] = [];
  buffs: Buff[] = [];
  visibleMask = 0;
  alive = true;
  targetable = true;
  shape: EntityView['shape'] = undefined;
  vx = 0; vy = 0;
  vfx: string | undefined = undefined;
  skin: string | undefined = undefined;
  height = 0;

  // internal ---------------------------------------------------------------------------------
  removed = false;
  /** world time at which the entity is removed from the store (-1: never) */
  removeAt = -1;
  spawnTime = 0;
  deathTime = -1;
  fighter: FighterDefT | null = null;
  unit: UnitDefT | null = null;
  player: Player | null = null;
  /** entity that created this one (summons, projectiles, zones) — kill credit goes through it */
  ownerEid: EntityId = -1;
  stats = new Stats();
  statsDirty = true;
  /** level-derived base (for bonusAd / bonusHp scaling) */
  baseAd = 0; baseHp = 0;
  attackDef: AttackDefT | null = null;
  resource: ResourceDefT | null = null;
  /** heat model: seconds of overheat lock left */
  overheat = 0;
  /** build model: seconds since the resource last changed (decayDelay) */
  resIdle = 0;
  slots: (AbilitySlot | null)[] = [null, null, null, null, null, null, null, null, null, null, null, null];
  passives: PassiveInst[] = [];
  /** trigger instances grouped by TRIGGER_INDEX */
  triggers: TriggerInst[][] = TRIGGER_ONS.map(() => []);
  shields: Shield[] = [];
  marks: Mark[] = [];
  counters: Counter[] = [];
  form: string | null = null;
  formTimer = -1;
  // status-derived (status.ts keeps these in sync)
  ccMask = 0;
  slowPow = 0; hastePow = 0; grievous = 0; armorShred = 0; resistShred = 0;
  /** bit t: revealed to team t (reveal status) */
  revealMask = 0;
  // orders
  order = ORDER_NONE;
  orderX = 0; orderY = 0;
  orderTarget: EntityId = -1;
  /** ORDER_CAST: the cast to start once in range */
  pendingSlot = -1; pendingX = 0; pendingY = 0; pendingTarget: EntityId = -1;
  cast: CastState | null = null;
  // attacks
  atkCd = 0;
  /** seconds until the current attack lands (-1: not winding up) */
  atkWindup = -1;
  atkTarget: EntityId = -1;
  atkCrit = false;
  /** seconds of attack animation left (backswing) */
  atkAnim = 0;
  atkAlt = false;
  /** idle auto-acquire (fighters, towers, summons); unit AI may turn it off */
  autoAttack = true;
  // motion
  dash: DashState | null = null;
  moved = false;
  movedDist = 0;
  path: number[] = [];
  pathIdx = 0;
  pathGoalX = NaN; pathGoalY = NaN;
  /** ticks until the straight-line check toward the goal is redone */
  pathCheck = 0;
  /** static blocker (structures): never moves, pushes units out */
  static = false;
  // bookkeeping
  /** per-player last time (s) they damaged or debuffed this entity (assist window) */
  assistT: Float64Array | null = null;
  dmgLog: DamageLog | null = null;
  /** last entity that damaged this one, and when (kill credit) */
  lastHitBy: EntityId = -1; lastHitAt = -1;
  /** summon lifetime: world time it expires (-1 none) */
  expireAt = -1;
  proj: ProjData | null = null;
  zone: ZoneData | null = null;
  /** index of the thicket the entity stands in (-1 none) */
  thicket = -1;
  /** structures behind protection: damage is ignored while true (lane UNITS toggles it) */
  invulnerable = false;
  /** sight radius in metres (0: gives no vision) */
  sight = 0;
  /** free slot for other lanes' per-entity state (unit AI, bots, modes) */
  ext: Record<string, unknown> | null = null;
  /** bumped whenever a new action starts (attack, cast, dash) so stateTime restarts even if state/anim repeat */
  actionSeq = 0;
  stateSeq = -1;
  /** other lanes force a state (recall channel, spawn pose); null = derived from actions */
  stateOverride: ActionState | null = null;
  animOverride = '';
  stateOverrideDuration = 0;

  constructor(id: EntityId, kind: EntityKind, def: string, team: TeamId) {
    this.id = id; this.kind = kind; this.def = def; this.team = team;
  }

  /** true for units that take part in combat (not projectiles/zones) */
  get isUnit(): boolean { return this.kind !== 'projectile' && this.kind !== 'zone'; }
}

// ── players and teams ───────────────────────────────────────────────────────────────────────────
export class Player implements PlayerView {
  readonly player: PlayerId;
  readonly team: TeamId;
  readonly name: string;
  readonly fighter: string;
  readonly skin: string;
  readonly role: string | undefined;
  readonly controller: 'human' | 'bot';
  readonly colorIndex: number;
  entity: EntityId = -1;
  gold = 0; xp = 0; xpToNext = 0;
  kills = 0; deaths = 0; assists = 0; cs = 0;
  damageToFighters = 0; damageTaken = 0; healing = 0; goldEarned = 0;
  /** PlayerResult.structureDamage */
  structureDamage = 0;
  items: (string | null)[] = [null, null, null, null, null, null];
  /** consumable charges per item slot */
  itemCharges: number[] = [0, 0, 0, 0, 0, 0];
  itemCooldowns: number[] = [0, 0, 0, 0, 0, 0];
  /** a1 a2 a3 ult spell1 spell2 (the same objects as the fighter entity's slots) */
  abilities: AbilitySlot[] = [];
  passive = '';
  skillPoints = 0;
  respawnIn = 0;
  lives: number | undefined = undefined;
  score: number | undefined = undefined;
  placement: number | undefined = undefined;
  canShop = false;
  recallProgress = 0;
  streak = 0;
  bounty = 0;
  readonly seat: SeatSetup;
  /** the fighter entity (kept across deaths; respawn reuses it) */
  ent: Entity | null = null;

  constructor(seat: SeatSetup) {
    this.seat = seat;
    this.player = seat.player; this.team = seat.team; this.name = seat.name; this.fighter = seat.fighter;
    this.skin = seat.skin; this.role = seat.role; this.controller = seat.controller; this.colorIndex = seat.colorIndex;
  }
  get stats(): FighterStatsView { return this.ent ? this.ent.stats : EMPTY_STATS; }
}
const EMPTY_STATS = new Stats();

export interface TeamBuffInst { id: string; remaining: number; def: TeamBuffDefT }
export class TeamState implements TeamView {
  readonly team: TeamId;
  kills = 0;
  structuresDestroyed = 0;
  objectives: string[] = [];
  /** active team buffs (remaining = Infinity when the def has no duration) */
  buffs: TeamBuffInst[] = [];
  gold = 0;
  constructor(team: TeamId) { this.team = team; }
}
