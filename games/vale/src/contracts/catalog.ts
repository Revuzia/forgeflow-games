// VALE — catalog schema (CONTRACT §4). The ONLY definition of what content looks like.
//
// Content is data: every fighter, item, skin, map, mode, queue, store shelf, client screen tile,
// audio cue and VFX preset is a record in the catalog. Code never hard-codes a content id
// (a harness probe greps for it). A new fighter / item / skin / map / screen tile is a new record
// plus its assets — never a rewrite.
//
// This file is used two ways:
//   * tools/ and _harness/ import the zod schemas to VALIDATE content (strict: unknown keys fail).
//   * src/ imports the inferred TYPES only (`import type`), so zod never ships in the client.
//
// Schema version: SCHEMA_VERSION. Any breaking change bumps it and adds a down-converter in
// tools/schema_migrations.ts so the content build can still emit the old schema for old clients
// (CONTRACT §3.3). Additive optional fields do NOT bump the schema.

import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

// ── primitives ──────────────────────────────────────────────────────────────────────────────────
/** content id: lower snake case, starts with a letter (`ember_lance`, `rift_ranked`). */
export const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lower_snake_case');
/** asset reference, relative to the catalog version root (`assets/fighters/tamsin/tamsin.glb`).
 *  The content build rewrites these to content-addressed paths. */
export const AssetRef = z.string().regex(/^assets\/[A-Za-z0-9_./-]+$/, 'asset refs start with assets/');
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');
export const Vec2 = z.tuple([z.number(), z.number()]);
export const Polygon = z.array(Vec2).min(3);
/** a per-rank table or a single value for every rank */
export const Ranked = z.union([z.number(), z.array(z.number()).min(1)]);

export const DamageType = z.enum(['phys', 'magic', 'true']);
export const StatusKind = z.enum([
  'stun', 'root', 'slow', 'silence', 'disarm', 'airborne', 'taunt', 'fear', 'sleep',
  'haste', 'invisible', 'untargetable', 'unstoppable', 'reveal', 'grievous', 'armor_shred', 'resist_shred',
]);
export const Slot = z.enum(['passive', 'a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6']);

// ── stats ───────────────────────────────────────────────────────────────────────────────────────
/** Every stat the sim knows. All optional in a block; missing = 0. Percent stats are fractions
 *  (0.25 = 25 %). attackSpeed is attacks per second for base, a fraction bonus in growth/items. */
export const StatBlock = z.object({
  hp: z.number(), hpRegen: z.number(), res: z.number(), resRegen: z.number(),
  ad: z.number(), ap: z.number(), armor: z.number(), resist: z.number(),
  attackSpeed: z.number(), range: z.number(), moveSpeed: z.number(), moveSpeedPct: z.number(),
  crit: z.number(), critDamage: z.number(), lifesteal: z.number(), omnivamp: z.number(),
  haste: z.number(), armorPen: z.number(), armorPenPct: z.number(), magicPen: z.number(), magicPenPct: z.number(),
  tenacity: z.number(), healShieldPower: z.number(),
}).partial().strict();
export const StatKey = z.enum([
  'hp', 'hpRegen', 'res', 'resRegen', 'ad', 'ap', 'armor', 'resist', 'attackSpeed', 'range', 'moveSpeed',
  'moveSpeedPct', 'crit', 'critDamage', 'lifesteal', 'omnivamp', 'haste', 'armorPen', 'armorPenPct',
  'magicPen', 'magicPenPct', 'tenacity', 'healShieldPower',
]);

/** A number that scales. `base` may be per-rank. Ratios multiply the caster's (or target's) stat. */
export const Scaling = z.union([
  z.number(),
  z.object({
    base: Ranked,
    ad: z.number().optional(), bonusAd: z.number().optional(), ap: z.number().optional(),
    maxHp: z.number().optional(), bonusHp: z.number().optional(), armor: z.number().optional(),
    resist: z.number().optional(), maxRes: z.number().optional(), level: z.number().optional(),
    /** fractions of the TARGET's hp (0.06 = 6 % of target max hp) */
    targetMaxHp: z.number().optional(), targetMissingHp: z.number().optional(), targetCurrentHp: z.number().optional(),
    /** multiply by the stacks of a counter on the caster, or of a mark on the target */
    perCounter: z.object({ counter: Id, per: z.number() }).optional(),
    perMark: z.object({ mark: Id, per: z.number() }).optional(),
  }).strict(),
]);

export const TargetFilter = z.object({
  enemies: z.boolean().default(true), allies: z.boolean().default(false), self: z.boolean().default(false),
  fighters: z.boolean().default(true), minions: z.boolean().default(true), monsters: z.boolean().default(true),
  structures: z.boolean().default(false), summons: z.boolean().default(true),
}).partial().strict();

export const Shape = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), radius: z.number().positive() }).strict(),
  z.object({ kind: z.literal('ring'), radius: z.number().positive(), inner: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal('cone'), radius: z.number().positive(), angleDeg: z.number().positive().max(360) }).strict(),
  /** rectangle from the anchor toward the aim direction */
  z.object({ kind: z.literal('rect'), length: z.number().positive(), width: z.number().positive() }).strict(),
]);

// ── conditions ─────────────────────────────────────────────────────────────────────────────────
export const Condition: z.ZodType<ConditionT, unknown> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('targetHpBelow'), pct: z.number() }).strict(),
  z.object({ kind: z.literal('selfHpBelow'), pct: z.number() }).strict(),
  z.object({ kind: z.literal('targetHasMark'), mark: Id, min: z.number().default(1) }).strict(),
  z.object({ kind: z.literal('targetHasStatus'), status: StatusKind }).strict(),
  z.object({ kind: z.literal('counterAtLeast'), counter: Id, n: z.number() }).strict(),
  z.object({ kind: z.literal('targetIs'), filter: TargetFilter }).strict(),
  z.object({ kind: z.literal('inForm'), form: Id }).strict(),
  z.object({ kind: z.literal('chance'), p: z.number().min(0).max(1) }).strict(),
  z.object({ kind: z.literal('not'), cond: Condition }).strict(),
  z.object({ kind: z.literal('all'), conds: z.array(Condition) }).strict(),
  z.object({ kind: z.literal('any'), conds: z.array(Condition) }).strict(),
]));
export type ConditionT =
  | { kind: 'targetHpBelow'; pct: number } | { kind: 'selfHpBelow'; pct: number }
  | { kind: 'targetHasMark'; mark: string; min?: number } | { kind: 'targetHasStatus'; status: z.infer<typeof StatusKind> }
  | { kind: 'counterAtLeast'; counter: string; n: number } | { kind: 'targetIs'; filter: z.infer<typeof TargetFilter> }
  | { kind: 'inForm'; form: string } | { kind: 'chance'; p: number }
  | { kind: 'not'; cond: ConditionT } | { kind: 'all'; conds: ConditionT[] } | { kind: 'any'; conds: ConditionT[] };

// ── presentation hints carried by sim records (sim ignores them; it echoes ids in events) ─────────
export const Present = z.object({
  anim: z.string().optional(),          // clip role on the fighter (see FighterArt.clips)
  vfx: Id.optional(),                   // VfxDef id
  sfx: Id.optional(),                   // audio cue id
  hitVfx: Id.optional(), hitSfx: Id.optional(),
  telegraph: z.enum(['none', 'ally_only', 'everyone']).optional(), // ground warning visibility
}).strict();

// ── the effect DSL (CONTRACT §6) ─────────────────────────────────────────────────────────────────
// Effects run against a context { caster, target?, point, dir, rank, source }. `at`/anchor values:
//   'self' caster position · 'target' the unit target · 'point' the aimed point · 'hit' the unit
//   the parent effect hit (inside onHit lists) · 'end' where a projectile/dash ended.
export const Anchor = z.enum(['self', 'target', 'point', 'hit', 'end']);
export const ApplyTo = z.enum(['hit', 'self', 'target']);

/** Parsed (defaults applied) effect records. The content build ships parsed JSON, so the runtime
 *  can rely on every defaulted field being present. Mirrors the zod union below exactly. */
type PresentT = { anim?: string; vfx?: string; sfx?: string; hitVfx?: string; hitSfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone' };
type AnchorT = 'self' | 'target' | 'point' | 'hit' | 'end';
type ApplyToT = 'hit' | 'self' | 'target';
type RankedT = number | number[];
type ScalingOut = number | { base: RankedT; ad?: number; bonusAd?: number; ap?: number; maxHp?: number; bonusHp?: number; armor?: number;
  resist?: number; maxRes?: number; level?: number; targetMaxHp?: number; targetMissingHp?: number; targetCurrentHp?: number;
  perCounter?: { counter: string; per: number }; perMark?: { mark: string; per: number } };
type FilterOut = { enemies?: boolean; allies?: boolean; self?: boolean; fighters?: boolean; minions?: boolean; monsters?: boolean; structures?: boolean; summons?: boolean };
type ShapeOut = { kind: 'circle'; radius: number } | { kind: 'ring'; radius: number; inner: number } | { kind: 'cone'; radius: number; angleDeg: number } | { kind: 'rect'; length: number; width: number };
type StatsOut = Partial<Record<'hp' | 'hpRegen' | 'res' | 'resRegen' | 'ad' | 'ap' | 'armor' | 'resist' | 'attackSpeed' | 'range' | 'moveSpeed' |
  'moveSpeedPct' | 'crit' | 'critDamage' | 'lifesteal' | 'omnivamp' | 'haste' | 'armorPen' | 'armorPenPct' | 'magicPen' | 'magicPenPct' |
  'tenacity' | 'healShieldPower', number>>;
type StatusOut = 'stun' | 'root' | 'slow' | 'silence' | 'disarm' | 'airborne' | 'taunt' | 'fear' | 'sleep' | 'haste' | 'invisible' |
  'untargetable' | 'unstoppable' | 'reveal' | 'grievous' | 'armor_shred' | 'resist_shred';
type SlotOut = 'passive' | 'a1' | 'a2' | 'a3' | 'ult' | 'spell1' | 'spell2' | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6';
export type EffectT =
  | { op: 'damage'; amount: ScalingOut; type: 'phys' | 'magic' | 'true'; to: ApplyToT; canCrit?: boolean; onHitEffects?: boolean; minionMult?: number; monsterMult?: number; structureMult?: number }
  | { op: 'heal'; amount: ScalingOut; to: ApplyToT }
  | { op: 'shield'; amount: ScalingOut; duration: RankedT; to: ApplyToT }
  | { op: 'status'; status: StatusOut; duration: RankedT; power?: RankedT; to: ApplyToT; decay?: boolean }
  | { op: 'buff'; id: string; duration: RankedT; stats?: StatsOut; statScaling?: Partial<Record<keyof StatsOut, ScalingOut>>; to: ApplyToT; maxStacks?: number;
      empowerAttacks?: { count: number; effects: EffectT[]; rangeBonus?: number; resetAttack?: boolean }; onExpire?: EffectT[]; present?: PresentT }
  | { op: 'projectile'; speed: number; range: number; width: number; from: AnchorT; toward: 'dir' | 'target' | 'point'; pierce: number; filter?: FilterOut;
      homing?: boolean; returns?: boolean; spreadDeg?: number; count?: number; stopAtWalls?: boolean; onHit: EffectT[]; onEnd?: EffectT[]; present?: PresentT }
  | { op: 'dash'; mode: 'toPoint' | 'toTarget' | 'direction' | 'away' | 'behindTarget'; distance: number; speed: number; unstoppable?: boolean;
      stopOnFirstHit?: boolean; passFilter?: FilterOut; passWidth?: number; onPass?: EffectT[]; onArrive?: EffectT[]; present?: PresentT }
  | { op: 'blink'; distance: number; to: 'point' | 'behindTarget' }
  | { op: 'area'; shape: ShapeOut; at: AnchorT; delay: number; filter?: FilterOut; maxTargets?: number; onHit: EffectT[]; onCenter?: EffectT[]; present?: PresentT }
  | { op: 'zone'; id: string; shape: ShapeOut; at: AnchorT; duration: RankedT; interval: number; delay: number; follow?: boolean; filter?: FilterOut;
      onTick: EffectT[]; onEnter?: EffectT[]; onExpire?: EffectT[]; blocks?: 'none' | 'enemies' | 'all'; present?: PresentT }
  | { op: 'displace'; mode: 'knockback' | 'pull' | 'toward_point' | 'airborne_in_place'; distance: number; duration: number; to: ApplyToT }
  | { op: 'summon'; unit: string; count: number; duration: RankedT; at: AnchorT; maxAlive?: number }
  | { op: 'resource'; amount: ScalingOut }
  | { op: 'cooldown'; slot: SlotOut | 'all_abilities'; seconds?: number; percent?: number }
  | { op: 'mark'; mark: string; duration: number; stacks: number; max: number; to: ApplyToT }
  | { op: 'consumeMark'; mark: string; perStack: EffectT[]; to: ApplyToT }
  | { op: 'counter'; counter: string; add: number; max?: number; duration?: number; reset?: boolean }
  | { op: 'if'; cond: ConditionT; then: EffectT[]; else?: EffectT[] }
  | { op: 'repeat'; count: number; interval: number; effects: EffectT[] }
  | { op: 'form'; form: string; duration?: number }
  | { op: 'reveal'; duration: number; to: ApplyToT }
  | { op: 'gold'; amount: number }
  | { op: 'script'; id: string; params?: Record<string, unknown> };
export type EffectOp = EffectT['op'];
const Effects = z.lazy(() => z.array(Effect));
export const Effect: z.ZodType<EffectT, unknown> = z.lazy(() => z.discriminatedUnion('op', [
  z.object({ op: z.literal('damage'), amount: Scaling, type: DamageType, to: ApplyTo.default('hit'),
    canCrit: z.boolean().optional(), onHitEffects: z.boolean().optional(), minionMult: z.number().optional(),
    monsterMult: z.number().optional(), structureMult: z.number().optional() }).strict(),
  z.object({ op: z.literal('heal'), amount: Scaling, to: ApplyTo.default('self') }).strict(),
  z.object({ op: z.literal('shield'), amount: Scaling, duration: Ranked, to: ApplyTo.default('self') }).strict(),
  z.object({ op: z.literal('status'), status: StatusKind, duration: Ranked, power: Ranked.optional(),
    to: ApplyTo.default('hit'), decay: z.boolean().optional() }).strict(),
  /** timed stat buff (or debuff with negative values); `id` makes re-application refresh instead of stack */
  z.object({ op: z.literal('buff'), id: Id, duration: Ranked, stats: StatBlock.optional(),
    statScaling: z.record(StatKey, Scaling).optional(), to: ApplyTo.default('self'),
    maxStacks: z.number().int().positive().optional(),
    /** next N basic attacks are empowered with these effects (consumed per attack) */
    empowerAttacks: z.object({ count: z.number().int().positive(), effects: Effects, rangeBonus: z.number().optional(),
      resetAttack: z.boolean().optional() }).strict().optional(),
    onExpire: Effects.optional(), present: Present.optional() }).strict(),
  z.object({ op: z.literal('projectile'), speed: z.number().positive(), range: z.number().positive(),
    width: z.number().positive(), from: Anchor.default('self'), toward: z.enum(['dir', 'target', 'point']).default('dir'),
    pierce: z.number().int().nonnegative().default(0), filter: TargetFilter.optional(), homing: z.boolean().optional(),
    returns: z.boolean().optional(), spreadDeg: z.number().optional(), count: z.number().int().positive().optional(),
    stopAtWalls: z.boolean().optional(), onHit: Effects, onEnd: Effects.optional(), present: Present.optional() }).strict(),
  z.object({ op: z.literal('dash'), mode: z.enum(['toPoint', 'toTarget', 'direction', 'away', 'behindTarget']),
    distance: z.number().positive(), speed: z.number().positive(), unstoppable: z.boolean().optional(),
    stopOnFirstHit: z.boolean().optional(), passFilter: TargetFilter.optional(), passWidth: z.number().optional(),
    onPass: Effects.optional(), onArrive: Effects.optional(), present: Present.optional() }).strict(),
  z.object({ op: z.literal('blink'), distance: z.number().positive(), to: z.enum(['point', 'behindTarget']).default('point') }).strict(),
  z.object({ op: z.literal('area'), shape: Shape, at: Anchor.default('point'), delay: z.number().nonnegative().default(0),
    filter: TargetFilter.optional(), maxTargets: z.number().int().positive().optional(),
    onHit: Effects, onCenter: Effects.optional(), present: Present.optional() }).strict(),
  z.object({ op: z.literal('zone'), id: Id, shape: Shape, at: Anchor.default('point'), duration: Ranked,
    interval: z.number().positive(), delay: z.number().nonnegative().default(0), follow: z.boolean().optional(),
    filter: TargetFilter.optional(), onTick: Effects, onEnter: Effects.optional(), onExpire: Effects.optional(),
    blocks: z.enum(['none', 'enemies', 'all']).optional(), present: Present.optional() }).strict(),
  z.object({ op: z.literal('displace'), mode: z.enum(['knockback', 'pull', 'toward_point', 'airborne_in_place']),
    distance: z.number().nonnegative(), duration: z.number().positive(), to: ApplyTo.default('hit') }).strict(),
  z.object({ op: z.literal('summon'), unit: Id, count: z.number().int().positive().default(1), duration: Ranked,
    at: Anchor.default('point'), maxAlive: z.number().int().positive().optional() }).strict(),
  z.object({ op: z.literal('resource'), amount: Scaling }).strict(),
  z.object({ op: z.literal('cooldown'), slot: z.union([Slot, z.literal('all_abilities')]), seconds: z.number().optional(),
    percent: z.number().optional() }).strict(),
  z.object({ op: z.literal('mark'), mark: Id, duration: z.number().positive(), stacks: z.number().int().default(1),
    max: z.number().int().positive().default(1), to: ApplyTo.default('hit') }).strict(),
  z.object({ op: z.literal('consumeMark'), mark: Id, perStack: Effects, to: ApplyTo.default('hit') }).strict(),
  z.object({ op: z.literal('counter'), counter: Id, add: z.number(), max: z.number().optional(),
    duration: z.number().optional(), reset: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('if'), cond: Condition, then: Effects, else: Effects.optional() }).strict(),
  z.object({ op: z.literal('repeat'), count: z.number().int().positive(), interval: z.number().nonnegative(), effects: Effects }).strict(),
  z.object({ op: z.literal('form'), form: Id, duration: z.number().optional() }).strict(),
  z.object({ op: z.literal('reveal'), duration: z.number().positive(), to: ApplyTo.default('hit') }).strict(),
  z.object({ op: z.literal('gold'), amount: z.number() }).strict(),
  /** registered TS behaviour (src/sim/scripts/<id>.ts). Escape hatch; every use is listed in DESIGN. */
  z.object({ op: z.literal('script'), id: Id, params: z.record(z.string(), z.unknown()).optional() }).strict(),
]));

// ── abilities, passives, triggers ──────────────────────────────────────────────────────────────
export const AiHint = z.object({
  /** what a bot uses this for; drives bots' desire scoring */
  use: z.array(z.enum(['damage', 'poke', 'cc', 'engage', 'escape', 'gapclose', 'heal', 'shield', 'buff', 'zone', 'execute', 'waveclear', 'vision', 'summon'])).min(1),
  minTargets: z.number().int().positive().optional(),
  castWhenSelfHpBelow: z.number().optional(),
  castWhenTargetHpBelow: z.number().optional(),
  leadTarget: z.boolean().optional(),
}).strict();

export const Targeting = z.object({
  kind: z.enum(['none', 'self', 'unit', 'point', 'direction']),
  range: z.number().nonnegative().default(0),
  filter: TargetFilter.optional(),
  /** the ground indicator drawn while aiming (and for enemies when Present.telegraph says so) */
  indicator: Shape.optional(),
  minRange: z.number().optional(),
}).strict();

const AbilityCore = z.object({
  id: Id,
  name: z.string().min(1),
  /** player-facing text. {placeholders} name Scaling paths filled in by the tooltip formatter */
  desc: z.string().min(1),
  icon: AssetRef,
  maxRank: z.number().int().positive().default(5),
  cooldown: Ranked,
  cost: Ranked.default(0),
  costKind: z.enum(['res', 'hp', 'none']).default('res'),
  charges: z.object({ max: z.number().int().positive(), recharge: Ranked }).strict().optional(),
  targeting: Targeting,
  castTime: z.number().nonnegative().default(0.25),
  channel: z.object({ duration: z.number().positive(), interruptible: z.boolean().default(true),
    interval: z.number().positive().optional(), onTick: Effects.optional(), canMove: z.boolean().optional() }).strict().optional(),
  canMoveWhileCasting: z.boolean().optional(),
  effects: Effects,
  ai: AiHint,
  present: Present.optional(),
}).strict();
export const AbilityDef = AbilityCore.extend({
  /** after cast, the slot becomes `ability` for `window` seconds (second-cast abilities; one level deep) */
  recast: z.object({ window: z.number().positive(), ability: AbilityCore }).strict().optional(),
}).strict();

export type AbilityDefT = z.infer<typeof AbilityDef>;

export const Trigger = z.object({
  on: z.enum(['attackHit', 'abilityHit', 'abilityCast', 'takedown', 'kill', 'damageTaken', 'damageDealt',
    'interval', 'lowHp', 'spawn', 'death', 'moveDistance', 'shieldBroken', 'statusApplied', 'levelUp']),
  interval: z.number().positive().optional(),     // for interval / moveDistance (metres)
  cooldown: z.number().nonnegative().optional(),
  /** per-target cooldown (e.g. once per 6 s per enemy) */
  perTargetCooldown: z.number().nonnegative().optional(),
  filter: TargetFilter.optional(),
  cond: Condition.optional(),
  effects: Effects,
}).strict();

export const PassiveDef = z.object({
  id: Id, name: z.string().min(1), desc: z.string().min(1), icon: AssetRef,
  stats: StatBlock.optional(), statsPerLevel: StatBlock.optional(),
  triggers: z.array(Trigger).default([]),
  /** named forms this passive can switch the fighter into (kit overrides while in form) */
  forms: z.record(Id, z.object({ name: z.string(), stats: StatBlock.optional(),
    kit: z.object({ a1: AbilityDef.optional(), a2: AbilityDef.optional(), a3: AbilityDef.optional(), ult: AbilityDef.optional() }).strict().optional(),
    attackRange: z.number().optional(), present: Present.optional() }).strict()).optional(),
  present: Present.optional(),
}).strict();

// ── resources ──────────────────────────────────────────────────────────────────────────────────
export const ResourceDef = z.object({
  id: Id, name: z.string(), desc: z.string(), color: Color,
  /** pool: spend from a regenerating pool · build: starts empty, built by actions, may decay · none: cooldowns only · heat: builds on spend, overheat locks */
  model: z.enum(['pool', 'build', 'none', 'heat']),
  max: z.number().nonnegative(), maxPerLevel: z.number().default(0),
  regen: z.number().default(0), regenPerLevel: z.number().default(0),
  startFull: z.boolean().default(true),
  decayPerSec: z.number().optional(), decayDelay: z.number().optional(),
  gainOnAttack: z.number().optional(), gainOnHitTaken: z.number().optional(), gainOnAbilityHit: z.number().optional(),
  overheatLock: z.number().optional(),
}).strict();

export const RoleDef = z.object({
  id: Id, name: z.string(), contract: z.string(), icon: AssetRef, color: Color,
}).strict();

// ── fighters ────────────────────────────────────────────────────────────────────────────────────
export const ClipRole = z.enum(['idle', 'run', 'attack1', 'attack2', 'crit', 'cast_a1', 'cast_a2', 'cast_a3', 'cast_ult',
  'channel', 'death', 'recall', 'spawn', 'victory', 'stunned', 'dash', 'idle_lobby', 'taunt']);
export const FighterArt = z.object({
  /** base GLB: mesh + skeleton + ALL animation clips */
  model: AssetRef,
  portrait: AssetRef, splash: AssetRef, icon: AssetRef,
  /** world height in metres the model is authored at (for health bar placement) */
  height: z.number().positive(),
  scale: z.number().positive().default(1),
  /** the speed (m/s) the run clip was authored for; the renderer scales playback by speed / runRefSpeed */
  runRefSpeed: z.number().positive().default(3.6),
  /** clip role → clip name inside the GLB */
  clips: z.record(ClipRole, z.string()),
  /** bone/empty names for VFX sockets */
  sockets: z.record(z.string(), z.string()).default({}),
  /** the material whose emissive is tinted with the readability color (team in Rift/Bridge, player in Fray) */
  accentMaterial: z.string().default('accent'),
}).strict();

export const FighterDef = z.object({
  id: Id,
  name: z.string().min(1),
  title: z.string().min(1),
  role: Id, secondaryRole: Id.optional(),
  resource: Id,
  /** the one-line job in a fight (shown in draft and collection) */
  job: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  lore: z.string().min(1),
  tags: z.array(z.string()).default([]),
  base: StatBlock,
  growth: StatBlock,
  attack: z.object({ range: z.number().positive(), windup: z.number().positive().max(0.9), damageType: DamageType.default('phys'),
    projectileSpeed: z.number().positive().optional(), present: Present.optional() }).strict(),
  collisionRadius: z.number().positive().default(0.55),
  kit: z.object({ passive: PassiveDef, a1: AbilityDef, a2: AbilityDef, a3: AbilityDef, ult: AbilityDef }).strict(),
  art: FighterArt,
  ai: z.object({ style: z.enum(['frontline', 'diver', 'skirmisher', 'artillery', 'burst', 'sustain', 'warden', 'marksman']),
    preferredRange: z.number().positive(), comboOrder: z.array(Slot).optional() }).strict(),
  /** palette for collection/draft backgrounds */
  palette: z.object({ primary: Color, secondary: Color }).strict(),
}).strict();
export type FighterDefT = z.infer<typeof FighterDef>;

// ── skins (cosmetic ONLY — the schema forbids every stat-bearing key) ───────────────────────────
export const SkinDef = z.object({
  id: Id, fighter: Id, name: z.string().min(1),
  tier: z.enum(['base', 'standard', 'deluxe', 'legend']),
  /** mesh + skeleton (no clips needed: clips come from the fighter's base model by bone name) */
  model: AssetRef,
  portrait: AssetRef, splash: AssetRef,
  /** optional VFX palette override (cosmetic) */
  vfxTint: Color.optional(),
  desc: z.string().default(''),
  releasedIn: z.string(),
}).strict();

// ── items + setup layer ────────────────────────────────────────────────────────────────────────
export const ItemDef = z.object({
  id: Id, name: z.string().min(1), desc: z.string().min(1), icon: AssetRef,
  tier: z.enum(['starter', 'basic', 'core', 'apex', 'boots', 'consumable']),
  /** TOTAL price including components */
  cost: z.number().int().nonnegative(),
  components: z.array(Id).default([]),
  stats: StatBlock.default({}),
  passives: z.array(PassiveDef).default([]),
  active: AbilityDef.optional(),
  /** items sharing a group cannot be owned together */
  uniqueGroup: Id.optional(),
  consumable: z.object({ charges: z.number().int().positive(), maxStack: z.number().int().positive() }).strict().optional(),
  tags: z.array(z.enum(['attack', 'magic', 'defense', 'speed', 'sustain', 'support', 'jungle', 'utility', 'crit', 'onhit', 'haste', 'vision'])).default([]),
  /** rule-set pools that may sell it (CONTRACT §5.6). Empty = every pool. */
  pools: z.array(Id).default([]),
  sellRatio: z.number().min(0).max(1).default(0.7),
}).strict();

export const SetupDef = z.object({
  /** activated battle spells (same DSL as abilities; slots spell1/spell2) */
  spells: z.array(AbilityDef.and(z.object({ pools: z.array(Id).default([]) }))).min(2),
  spellSlots: z.number().int().positive(),
  /** pre-match passive choices */
  boons: z.array(PassiveDef.and(z.object({ path: Id, pools: z.array(Id).default([]) }))).min(1),
  boonSlots: z.number().int().positive(),
  paths: z.array(z.object({ id: Id, name: z.string(), desc: z.string(), color: Color, icon: AssetRef }).strict()),
  defaults: z.object({ spells: z.array(Id), boons: z.array(Id) }).strict(),
}).strict();

// ── units (minions, monsters, structures, summons, wards, pickups) ─────────────────────────────────
export const UnitDef = z.object({
  id: Id, name: z.string(),
  kind: z.enum(['minion', 'monster', 'structure', 'summon', 'ward', 'pickup']),
  base: StatBlock, growth: StatBlock.default({}),
  attack: z.object({ range: z.number().nonnegative(), windup: z.number().positive(), damageType: DamageType.default('phys'),
    projectileSpeed: z.number().positive().optional(), present: Present.optional() }).strict().optional(),
  collisionRadius: z.number().nonnegative(),
  bounty: z.object({ gold: z.number().default(0), xp: z.number().default(0), goldGlobal: z.number().optional() }).strict().default({ gold: 0, xp: 0 }),
  passive: PassiveDef.optional(),
  abilities: z.array(AbilityDef).default([]),
  /** monster: leash radius; structure: target rules; pickup: what it grants */
  behavior: z.record(z.string(), z.unknown()).default({}),
  sightRange: z.number().positive().default(10),
  /** structures/objectives: buff granted to the killer's team (TeamBuff id) */
  onTakedownTeamBuff: Id.optional(),
  art: z.object({ model: AssetRef, scale: z.number().positive().default(1), height: z.number().positive(),
    clips: z.record(z.string(), z.string()).default({}), icon: AssetRef.optional(), instanced: z.boolean().default(false) }).strict(),
}).strict();

export const TeamBuffDef = z.object({
  id: Id, name: z.string(), desc: z.string(), icon: AssetRef, duration: z.number().positive().optional(),
  stats: StatBlock.default({}), passives: z.array(PassiveDef).default([]),
  /** minion empowerment while active (Rift's late objective) */
  minionStats: StatBlock.optional(),
}).strict();

// ── maps ────────────────────────────────────────────────────────────────────────────────────────
export const MapDef = z.object({
  id: Id, name: z.string(), desc: z.string(),
  /** sim plane extents in metres: x ∈ [0, size[0]], y ∈ [0, size[1]] (world X = x, world Z = y) */
  size: Vec2,
  navCell: z.number().positive().default(0.5),
  walls: z.array(Polygon),            // impassable
  thickets: z.array(Polygon).default([]), // concealment volumes (units inside are hidden to outsiders)
  lanes: z.array(z.object({ id: Id, name: z.string(), path: z.array(Vec2).min(2) }).strict()),  // path from team 0 base to team 1 base
  bases: z.array(z.object({ team: z.number().int().nonnegative(), spawn: Vec2, fountain: z.object({ at: Vec2, radius: z.number() }).strict(),
    shop: z.object({ at: Vec2, radius: z.number() }).strict() }).strict()),
  /** free-for-all spawn ring (Fray) */
  spawns: z.array(Vec2).default([]),
  structures: z.array(z.object({ id: Id, unit: Id, team: z.number().int(), lane: Id.optional(), at: Vec2,
    /** structure ids that must fall before this one is damageable */
    requires: z.array(Id).default([]), respawn: z.number().optional() }).strict()).default([]),
  camps: z.array(z.object({ id: Id, units: z.array(z.object({ unit: Id, at: Vec2 }).strict()), firstSpawn: z.number(), respawn: z.number(),
    objective: z.boolean().default(false) }).strict()).default([]),
  pickups: z.array(z.object({ id: Id, unit: Id, at: Vec2, firstSpawn: z.number(), respawn: z.number() }).strict()).default([]),
  /** shared shops on the map (Fray) */
  shops: z.array(z.object({ at: Vec2, radius: z.number() }).strict()).default([]),
  art: z.object({
    scene: AssetRef,          // Blender-authored landmarks + terrain GLB
    sky: AssetRef,            // equirect HDR
    lut: AssetRef,            // locked color grade (.cube)
    minimap: AssetRef,        // painted minimap image
    terrain: z.record(z.string(), z.unknown()).default({}),
    lighting: z.object({ sunDir: z.tuple([z.number(), z.number(), z.number()]), sunColor: Color, sunIntensity: z.number(),
      ambient: z.number(), fogColor: Color, fogDensity: z.number(), exposure: z.number() }).strict(),
    music: Id,
  }).strict(),
  camera: z.object({ pitchDeg: z.number(), fovDeg: z.number(), distance: z.number(), minDistance: z.number(), maxDistance: z.number() }).strict(),
}).strict();

// ── modes, rule sets, queues ───────────────────────────────────────────────────────────────────
export const RulesParams = z.object({
  startLevel: z.number().int().positive(),
  maxLevel: z.number().int().positive(),
  startGold: z.number().int().nonnegative(),
  passiveGoldPerSec: z.number().nonnegative(),
  passiveGoldStart: z.number().nonnegative(),
  goldMult: z.number().positive(), xpMult: z.number().positive(),
  xpTable: z.array(z.number()),               // xp needed to reach level i+2 from i+1
  respawn: z.object({ base: z.number(), perLevel: z.number(), max: z.number(), lateGameRampAt: z.number().optional(), lateGameMult: z.number().optional() }).strict(),
  shopAccess: z.enum(['base', 'base_or_dead', 'anywhere', 'shops']),
  recall: z.boolean(), recallTime: z.number().optional(),
  fountainHeals: z.boolean(),
  itemPool: Id,                                 // ItemDef.pools / setup pools filter
  minionWaves: z.object({ first: z.number(), interval: z.number(), composition: z.array(z.object({ unit: Id, count: z.number().int(), everyNth: z.number().int().default(1), from: z.number().default(0) }).strict()),
    upgradeEvery: z.number().optional() }).strict().optional(),
  structures: z.boolean(), jungle: z.boolean(),
  surrender: z.object({ earliest: z.number(), votesNeeded: z.number() }).strict().optional(),
  suddenDeathAt: z.number().optional(),
  /** win conditions in priority order */
  end: z.object({
    kind: z.enum(['core', 'last_standing_or_score', 'score']),
    coreStructure: Id.optional(),               // structure unit id whose death ends the match
    killScore: z.number().int().positive().optional(),
    lives: z.number().int().positive().optional(),
    timeLimit: z.number().positive().optional(),
  }).strict(),
  /** FFA placement → points table (index 0 = 1st) */
  placementPoints: z.array(z.number()).optional(),
  bounty: z.object({ kill: z.number(), assistShare: z.number(), streakStep: z.number(), streakMax: z.number(), shutdownMax: z.number() }).strict(),
  abilityRanks: z.object({ basicMax: z.number().int(), ultLevels: z.array(z.number().int()) }).strict(),
}).strict();

export const ModeDef = z.object({
  id: Id, name: z.string(), tagline: z.string(), desc: z.string(),
  map: Id,
  teams: z.number().int().positive(), perTeam: z.number().int().positive(),
  pick: z.enum(['draft', 'blind', 'random_bench', 'ffa_pick']),
  rules: RulesParams,
  roles: z.boolean(),                           // role contract on (Rift)
  card: z.object({ art: AssetRef, accent: Color, glyph: AssetRef }).strict(),
  /** FFA: every player gets their own readability color from this list (colorblind list in settings) */
  playerColors: z.array(Color).optional(),
}).strict();

export const QueueDef = z.object({
  id: Id, mode: Id, name: z.string(), desc: z.string(),
  kind: z.enum(['standard', 'quick', 'ranked', 'coop', 'custom', 'practice']),
  rules: RulesParams.partial().default({}),     // overrides layered on ModeDef.rules
  pick: z.enum(['draft', 'blind', 'random_bench', 'ffa_pick', 'role_preset']).optional(),
  draft: z.object({ bansPerTeam: z.number().int().nonnegative(), pickSeconds: z.number(), banSeconds: z.number(),
    finalizeSeconds: z.number() }).strict().optional(),
  bench: z.object({ size: z.number().int().nonnegative(), rerolls: z.number().int().nonnegative() }).strict().optional(),
  ranked: z.object({ ratingId: Id, model: z.literal('glicko2'), placementGames: z.number().int() }).strict().optional(),
  bots: z.object({ fill: z.enum(['all_open', 'opponents_only', 'none']), difficulty: z.enum(['novice', 'adept', 'veteran', 'by_rating']) }).strict(),
  partyMax: z.number().int().positive(),
  grants: z.object({ win: z.number().int(), loss: z.number().int(), perMinute: z.number(), cap: z.number().int(),
    xpWin: z.number().int(), xpLoss: z.number().int(), placement: z.array(z.number().int()).optional() }).strict(),
  order: z.number().int(),
  unlockLevel: z.number().int().default(1),
}).strict();

export const RankTier = z.object({ id: Id, name: z.string(), minRating: z.number(), color: Color, emblem: AssetRef }).strict();

// ── economy / store / client ───────────────────────────────────────────────────────────────────
export const CurrencyDef = z.object({ id: Id, name: z.string(), desc: z.string(), icon: AssetRef, earnedOnly: z.boolean() }).strict();
export const Offer = z.object({ sku: Id, kind: z.enum(['skin']), ref: Id, price: z.object({ currency: Id, amount: z.number().int().positive() }).strict(),
  from: z.string().optional(), until: z.string().optional(), badge: z.string().optional() }).strict();
export const StoreDef = z.object({
  currencies: z.array(CurrencyDef).min(1),
  offers: z.array(Offer),
  shelves: z.array(z.object({ id: Id, name: z.string(), skus: z.array(Id), layout: z.enum(['hero', 'grid', 'row']) }).strict()),
  starterOwnership: z.array(Id).default([]),    // skin ids every new profile owns (the base skins)
  starterWallet: z.record(Id, z.number().int().nonnegative()).default({}),
}).strict();

export const ClientDef = z.object({
  nav: z.array(z.object({ screen: Id, label: z.string(), icon: AssetRef, hotkey: z.string().optional() }).strict()),
  /** mode select tiles in order. A slot with mode=null renders as a reserved, data-driven future slot. */
  modeSlots: z.array(z.object({ mode: Id.nullable(), status: z.enum(['live', 'reserved']), label: z.string().optional(),
    note: z.string().optional() }).strict()),
  home: z.object({ headline: z.string(), sub: z.string(), feature: z.object({ art: AssetRef, title: z.string(), body: z.string(),
    cta: z.object({ label: z.string(), screen: Id, params: z.record(z.string(), z.string()).default({}) }).strict() }).strict(),
    tiles: z.array(z.object({ id: Id, title: z.string(), body: z.string(), art: AssetRef, screen: Id,
      params: z.record(z.string(), z.string()).default({}) }).strict()) }).strict(),
  menuScene: z.object({ model: AssetRef, sky: AssetRef, lut: AssetRef }).strict(),
  tips: z.array(z.string()).default([]),
}).strict();

// ── audio + vfx ─────────────────────────────────────────────────────────────────────────────────
export const AudioCue = z.object({
  files: z.array(AssetRef).min(1), bus: z.enum(['music', 'sfx', 'ui', 'voice', 'ambience']),
  gain: z.number().default(1), pitchVar: z.number().default(0), maxVoices: z.number().int().positive().default(4),
  priority: z.number().int().default(5), spatial: z.boolean().default(false), loop: z.boolean().default(false),
  cooldown: z.number().default(0),
}).strict();
export const MusicDef = z.object({
  file: AssetRef, bpm: z.number().positive(), loopStart: z.number().default(0), loopEnd: z.number().optional(),
  gain: z.number().default(1), layers: z.array(z.object({ id: Id, file: AssetRef }).strict()).default([]),
}).strict();
export const AudioDef = z.object({ cues: z.record(Id, AudioCue), music: z.record(Id, MusicDef) }).strict();

export const VfxDef = z.object({
  id: Id,
  /** emitter layers interpreted by render/vfx (CONTRACT §9.5) */
  layers: z.array(z.record(z.string(), z.unknown())).min(1),
  duration: z.number().positive(),
  teamTint: z.boolean().default(true),
}).strict();

// ── strings + bot names ─────────────────────────────────────────────────────────────────────────
export const StringsDef = z.record(z.string(), z.string());

// ── the catalog root ────────────────────────────────────────────────────────────────────────────
export const Catalog = z.object({
  schema: z.literal(SCHEMA_VERSION),
  version: z.string().regex(/^\d{4}\.\d{1,2}\.\d+$/, 'catalog version is YYYY.M.patch'),
  builtAt: z.string(),
  roles: z.array(RoleDef),
  resources: z.array(ResourceDef),
  fighters: z.array(FighterDef),
  skins: z.array(SkinDef),
  items: z.array(ItemDef),
  setup: SetupDef,
  units: z.array(UnitDef),
  teamBuffs: z.array(TeamBuffDef),
  maps: z.array(MapDef),
  modes: z.array(ModeDef),
  queues: z.array(QueueDef),
  ranks: z.array(RankTier),
  store: StoreDef,
  client: ClientDef,
  audio: AudioDef,
  vfx: z.array(VfxDef),
  strings: StringsDef,
  botNames: z.array(z.string()).min(20),
}).strict();

export type CatalogT = z.infer<typeof Catalog>;
export type ItemDefT = z.infer<typeof ItemDef>;
export type SkinDefT = z.infer<typeof SkinDef>;
export type UnitDefT = z.infer<typeof UnitDef>;
export type MapDefT = z.infer<typeof MapDef>;
export type ModeDefT = z.infer<typeof ModeDef>;
export type QueueDefT = z.infer<typeof QueueDef>;
export type RulesParamsT = z.infer<typeof RulesParams>;
export type PassiveDefT = z.infer<typeof PassiveDef>;
export type ResourceDefT = z.infer<typeof ResourceDef>;
export type StatBlockT = z.infer<typeof StatBlock>;
export type ScalingT = z.infer<typeof Scaling>;
export type ShapeT = z.infer<typeof Shape>;
export type TargetFilterT = z.infer<typeof TargetFilter>;
export type SetupDefT = z.infer<typeof SetupDef>;
export type TeamBuffDefT = z.infer<typeof TeamBuffDef>;
export type StoreDefT = z.infer<typeof StoreDef>;
export type ClientDefT = z.infer<typeof ClientDef>;
export type AudioDefT = z.infer<typeof AudioDef>;
export type VfxDefT = z.infer<typeof VfxDef>;
export type RankTierT = z.infer<typeof RankTier>;
export type StatKeyT = z.infer<typeof StatKey>;
export type SlotT = z.infer<typeof Slot>;
export type StatusKindT = z.infer<typeof StatusKind>;
export type DamageTypeT = z.infer<typeof DamageType>;
export type ClipRoleT = z.infer<typeof ClipRole>;
