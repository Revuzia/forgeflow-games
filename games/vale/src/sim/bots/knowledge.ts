// VALE bots — static knowledge read from the catalog and the match setup (built once per match).
//
// Everything a bot "knows before the game starts" lives here, derived from data only (CONTRACT §0:
// no content id is ever named in code):
//   * the game kind, from the resolved rules, never from ids: end.kind 'core' with more than one
//     lane → rift (jungle from rules.jungle), one lane → bridge; 'last_standing_or_score' → fray
//     (free-for-all); 'score' → brawl; queue.kind 'practice' → practice;
//   * map geometry: lanes as polylines with arc-length projection, structures assigned to the
//     lane they sit on, camps (objective flag), pickups, bases, shops;
//   * per fighter: ai.style, preferredRange, comboOrder, ranged-ness, the stat its kit scales
//     with (damage type for itemization), its retreat threshold and level-up order;
//   * per ability (any castable record: kit, recast, form, battle spell, item active): its AiHint
//     decoded to bit flags, and the geometry of its delivery (projectile speed/width/range, area
//     shape/anchor/delay, dash/blink distance) and damage terms, read from the effect DSL.

import type {
  CatalogT, DamageTypeT, EffectT, FighterDefT, ItemDefT, MapDefT, ModeDefT, QueueDefT, RulesParamsT, ScalingT, ShapeT, SlotT, StatBlockT,
} from '../../contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../../contracts/sim.ts';
import { indexCatalog, resolveRules, type AbilityCoreT, type CatalogIndex, type RoleDefT } from '../catalog_index.ts';
import { mitigated } from '../combat.ts';
import { ranked } from '../effects.ts';
import type { Entity } from '../entity.ts';

export type GameKind = 'rift' | 'bridge' | 'fray' | 'brawl' | 'practice';
export type Style = FighterDefT['ai']['style'];

// ── ability hints ───────────────────────────────────────────────────────────────────────────────
export const U_DAMAGE = 1, U_POKE = 2, U_CC = 4, U_ENGAGE = 8, U_ESCAPE = 16, U_GAPCLOSE = 32, U_HEAL = 64, U_SHIELD = 128,
  U_BUFF = 256, U_ZONE = 512, U_EXECUTE = 1024, U_WAVECLEAR = 2048, U_VISION = 4096, U_SUMMON = 8192;
const USE_BITS: Readonly<Record<string, number>> = {
  damage: U_DAMAGE, poke: U_POKE, cc: U_CC, engage: U_ENGAGE, escape: U_ESCAPE, gapclose: U_GAPCLOSE, heal: U_HEAL,
  shield: U_SHIELD, buff: U_BUFF, zone: U_ZONE, execute: U_EXECUTE, waveclear: U_WAVECLEAR, vision: U_VISION, summon: U_SUMMON,
};
/** any use that hurts or controls enemies */
export const U_OFFENSE = U_DAMAGE | U_POKE | U_CC | U_ENGAGE | U_ZONE | U_EXECUTE;

export type Delivery = 'projectile' | 'area' | 'zone' | 'dash' | 'blink' | 'unit' | 'self' | 'summon' | 'none';
type FilterOut = { enemies?: boolean; allies?: boolean; self?: boolean; fighters?: boolean; minions?: boolean; monsters?: boolean; structures?: boolean; summons?: boolean };

export interface DmgTerm { s: ScalingT; type: DamageTypeT; mult: number; minionMult: number; monsterMult: number; structureMult: number }

export interface AbilityInfo {
  readonly def: AbilityCoreT;
  readonly use: number;
  /** 0: no requirement */
  readonly minTargets: number;
  /** cast only below this own hp fraction (2: no gate) */
  readonly selfHpBelow: number;
  /** cast only at targets below this hp fraction (2: no gate) */
  readonly targetHpBelow: number;
  readonly lead: boolean;
  readonly tk: 'none' | 'self' | 'unit' | 'point' | 'direction';
  readonly range: number;
  readonly filter: FilterOut | undefined;
  /** unit-targeted at allies (heals, shields) */
  readonly allyUnit: boolean;
  readonly delivery: Delivery;
  readonly projSpeed: number; readonly projWidth: number; readonly projRange: number;
  readonly shape: ShapeT | null;
  readonly areaAt: 'self' | 'target' | 'point' | 'hit' | 'end';
  readonly delay: number;
  readonly dashDist: number;
  readonly dashMode: string;
  readonly blinkDist: number;
  /** max centre distance at which an enemy can be affected */
  readonly reach: number;
  /** radius of the effect around its impact point (0: single target) */
  readonly radius: number;
  readonly castTime: number;
  readonly cc: boolean;
  readonly dmg: readonly DmgTerm[];
  readonly heal: boolean;
  readonly shield: boolean;
  readonly selfBuff: boolean;
  /** the area/zone/heal reaches allies (support ults) */
  readonly affectsAllies: boolean;
}

const CC_STATUSES = new Set(['stun', 'root', 'slow', 'silence', 'disarm', 'airborne', 'taunt', 'fear', 'sleep']);
const SELF_BUFF_STATUSES = new Set(['haste', 'invisible', 'untargetable', 'unstoppable']);

function shapeReach(s: ShapeT): number {
  switch (s.kind) {
    case 'circle': case 'ring': case 'cone': return s.radius;
    case 'rect': return s.length;
  }
}

interface Acc {
  delivery: Delivery; projSpeed: number; projWidth: number; projRange: number;
  shape: ShapeT | null; areaAt: AbilityInfo['areaAt']; delay: number; dashDist: number; dashMode: string; blinkDist: number;
  cc: boolean; dmg: DmgTerm[]; heal: boolean; shield: boolean; selfBuff: boolean; affectsAllies: boolean;
}

function walk(list: readonly EffectT[] | undefined, mult: number, top: boolean, a: Acc, depth: number): void {
  if (!list || depth > 6) return;
  for (const eff of list) {
    switch (eff.op) {
      case 'damage':
        a.dmg.push({ s: eff.amount, type: eff.type, mult, minionMult: eff.minionMult ?? 1, monsterMult: eff.monsterMult ?? 1, structureMult: eff.structureMult ?? 1 });
        break;
      case 'heal': a.heal = true; break;
      case 'shield': a.shield = true; break;
      case 'status':
        if (CC_STATUSES.has(eff.status) && eff.to !== 'self') a.cc = true;
        else if (SELF_BUFF_STATUSES.has(eff.status) && eff.to === 'self') a.selfBuff = true;
        break;
      case 'buff': if (eff.to === 'self') a.selfBuff = true; if (eff.empowerAttacks) walk(eff.empowerAttacks.effects, mult * eff.empowerAttacks.count, false, a, depth + 1); break;
      case 'displace': if (eff.to !== 'self') a.cc = true; break;
      case 'projectile':
        if (a.delivery === 'none') { a.delivery = 'projectile'; a.projSpeed = eff.speed; a.projWidth = eff.width; a.projRange = eff.range; }
        walk(eff.onHit, mult * Math.max(1, eff.count ?? 1) * (eff.returns ? 1.5 : 1), false, a, depth + 1);
        walk(eff.onEnd, mult, false, a, depth + 1);
        break;
      case 'area':
        if (!a.shape) { a.shape = eff.shape; a.areaAt = eff.at; a.delay = eff.delay; if (a.delivery === 'none' && top) a.delivery = 'area'; }
        if (eff.filter?.allies) a.affectsAllies = true;
        walk(eff.onHit, mult, false, a, depth + 1);
        walk(eff.onCenter, mult, false, a, depth + 1);
        break;
      case 'zone': {
        if (!a.shape) { a.shape = eff.shape; a.areaAt = eff.at; a.delay = eff.delay; if (a.delivery === 'none' && top) a.delivery = 'zone'; }
        if (eff.filter?.allies) a.affectsAllies = true;
        const dur = ranked(eff.duration, 1);
        walk(eff.onTick, mult * Math.max(1, Math.min(20, dur / Math.max(0.05, eff.interval))) * 0.6, false, a, depth + 1);
        walk(eff.onEnter, mult, false, a, depth + 1);
        break;
      }
      case 'dash':
        if (a.delivery === 'none' && top) { a.delivery = 'dash'; a.dashDist = eff.distance; a.dashMode = eff.mode; }
        walk(eff.onPass, mult, false, a, depth + 1);
        walk(eff.onArrive, mult, false, a, depth + 1);
        break;
      case 'blink': if (a.delivery === 'none' && top) { a.delivery = 'blink'; a.blinkDist = eff.distance; } break;
      case 'summon': if (a.delivery === 'none' && top) a.delivery = 'summon'; break;
      case 'if': walk(eff.then, mult, top, a, depth + 1); break;
      case 'repeat': walk(eff.effects, mult * eff.count, top, a, depth + 1); break;
      case 'consumeMark': walk(eff.perStack, mult, false, a, depth + 1); break;
      default: break;
    }
  }
}

const infoCache = new WeakMap<object, AbilityInfo>();
/** decoded hints + geometry of a castable record (cached per record object) */
export function abilityInfo(def: AbilityCoreT): AbilityInfo {
  let r = infoCache.get(def);
  if (r) return r;
  const a: Acc = {
    delivery: 'none', projSpeed: 0, projWidth: 0, projRange: 0, shape: null, areaAt: 'point', delay: 0, dashDist: 0, dashMode: '',
    blinkDist: 0, cc: false, dmg: [], heal: false, shield: false, selfBuff: false, affectsAllies: false,
  };
  walk(def.effects, 1, true, a, 0);
  if (def.channel) walk(def.channel.onTick, Math.max(1, def.channel.duration / Math.max(0.1, def.channel.interval ?? def.channel.duration)), false, a, 1);
  let use = 0;
  for (const u of def.ai.use) use |= USE_BITS[u] ?? 0;
  const tk = def.targeting.kind;
  const range = def.targeting.range;
  const filter = def.targeting.filter as FilterOut | undefined;
  const allyUnit = tk === 'unit' && !!filter && !!(filter.allies || filter.self) && filter.enemies === false;
  if (a.delivery === 'none') a.delivery = tk === 'unit' ? 'unit' : (a.heal || a.shield || a.selfBuff) ? 'self' : 'none';
  const sr = a.shape ? shapeReach(a.shape) : 0;
  let reach = 0, radius = 0;
  switch (a.delivery) {
    case 'projectile': reach = a.projRange + a.projWidth * 0.5; radius = a.shape ? sr : 0; break;
    case 'area': case 'zone':
      radius = a.shape && a.shape.kind !== 'rect' ? sr : a.shape ? (a.shape as { width: number }).width * 0.5 : 0;
      reach = a.areaAt === 'self' ? sr : range + radius;
      break;
    case 'dash': reach = (a.dashMode === 'toTarget' ? Math.max(range, a.dashDist) : Math.max(a.dashDist, range)) + (a.shape ? sr : 1); radius = a.shape ? sr : 0; break;
    case 'blink': reach = a.blinkDist; break;
    case 'unit': reach = range > 0 ? range : 1.5; break;
    default: reach = range; break;
  }
  r = {
    def, use, minTargets: def.ai.minTargets ?? 0,
    selfHpBelow: def.ai.castWhenSelfHpBelow ?? 2, targetHpBelow: def.ai.castWhenTargetHpBelow ?? 2,
    lead: !!def.ai.leadTarget, tk, range, filter, allyUnit, delivery: a.delivery,
    projSpeed: a.projSpeed, projWidth: a.projWidth, projRange: a.projRange, shape: a.shape, areaAt: a.areaAt, delay: a.delay,
    dashDist: a.dashDist, dashMode: a.dashMode, blinkDist: a.blinkDist, reach, radius, castTime: def.castTime, cc: a.cc,
    dmg: a.dmg, heal: a.heal, shield: a.shield, selfBuff: a.selfBuff, affectsAllies: a.affectsAllies,
  };
  infoCache.set(def, r);
  return r;
}

function scaled(s: ScalingT, c: Entity, rank: number, t: Entity | null): number {
  if (typeof s === 'number') return s;
  const cs = c.stats;
  let v = ranked(s.base, rank);
  if (s.ad) v += s.ad * cs.ad;
  if (s.bonusAd) v += s.bonusAd * (cs.ad - c.baseAd);
  if (s.ap) v += s.ap * cs.ap;
  if (s.maxHp) v += s.maxHp * c.maxHp;
  if (s.bonusHp) v += s.bonusHp * (c.maxHp - c.baseHp);
  if (s.armor) v += s.armor * cs.armor;
  if (s.resist) v += s.resist * cs.resist;
  if (s.maxRes) v += s.maxRes * c.maxRes;
  if (s.level) v += s.level * c.level;
  if (t) {
    if (s.targetMaxHp) v += s.targetMaxHp * t.maxHp;
    if (s.targetMissingHp) v += s.targetMissingHp * (t.maxHp - t.hp);
    if (s.targetCurrentHp) v += s.targetCurrentHp * t.hp;
  }
  return v;
}

/** rough post-mitigation damage of one cast of `info` by `caster` at `rank` on `target` */
export function estimateDamage(info: AbilityInfo, caster: Entity, rank: number, target: Entity | null): number {
  let total = 0;
  const r = Math.max(1, rank);
  for (const d of info.dmg) {
    let v = scaled(d.s, caster, r, target) * d.mult;
    if (target) {
      if (target.kind === 'minion') v *= d.minionMult;
      else if (target.kind === 'monster') v *= d.monsterMult;
      else if (target.kind === 'structure') v *= d.structureMult;
      v = mitigated(caster, target, v, d.type);
    }
    total += v;
  }
  return total;
}

// ── map geometry ────────────────────────────────────────────────────────────────────────────────
export interface LaneGeo {
  readonly id: string;
  readonly index: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** cumulative arc length at each point (team 0 direction) */
  readonly cum: Float64Array;
  readonly length: number;
}
export interface StructInfo {
  readonly id: string; readonly unit: string; readonly team: number;
  readonly x: number; readonly y: number;
  /** lane index (-1: base / not on a lane) and arc position along it (team-0 direction) */
  readonly lane: number; readonly s: number;
  /** attacks (a tower) */
  readonly attacks: boolean;
  readonly range: number;
  readonly radius: number;
  readonly isCore: boolean;
  /** comes back after it falls (MapDef structure `respawn`) */
  readonly respawns: boolean;
}
export interface CampInfo {
  readonly id: string; readonly index: number; readonly x: number; readonly y: number;
  readonly objective: boolean; readonly firstSpawn: number; readonly respawn: number;
  readonly units: readonly string[];
}
export interface PickupInfo { readonly id: string; readonly unit: string; readonly x: number; readonly y: number; readonly firstSpawn: number; readonly respawn: number }
export interface BaseInfo { readonly team: number; readonly spawnX: number; readonly spawnY: number; readonly fx: number; readonly fy: number; readonly fr: number; readonly sx: number; readonly sy: number; readonly sr: number }

/** projection result (module-level scratch: read it before the next call) */
export const proj = { s: 0, d2: 0, x: 0, y: 0, dx: 1, dy: 0 };

/** project (x, y) on a lane: proj.s = arc position (team 0 direction), proj.d2 = squared distance */
export function laneProject(l: LaneGeo, x: number, y: number): void {
  let bestD2 = Infinity, bestS = 0;
  const xs = l.xs, ys = l.ys, cum = l.cum;
  for (let i = 1; i < xs.length; i++) {
    const ax = xs[i - 1], ay = ys[i - 1], vx = xs[i] - ax, vy = ys[i] - ay;
    const L2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / L2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = ax + vx * t, py = ay + vy * t;
    const d2 = (px - x) * (px - x) + (py - y) * (py - y);
    if (d2 < bestD2) { bestD2 = d2; bestS = cum[i - 1] + Math.sqrt(L2) * t; }
  }
  proj.s = bestS; proj.d2 = bestD2;
}

/** point at arc position s (team-0 direction), with the lane direction there: proj.x/y/dx/dy */
export function lanePoint(l: LaneGeo, s: number): void {
  const xs = l.xs, ys = l.ys, cum = l.cum;
  if (s <= 0) s = 0; else if (s >= l.length) s = l.length;
  let i = 1;
  while (i < xs.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  const dx = (xs[i] - xs[i - 1]) / seg, dy = (ys[i] - ys[i - 1]) / seg;
  proj.x = xs[i - 1] + (xs[i] - xs[i - 1]) * t; proj.y = ys[i - 1] + (ys[i] - ys[i - 1]) * t;
  proj.dx = dx; proj.dy = dy;
}

/** arc position in a team's own progress coordinates (0 = own base end) */
export function progress(l: LaneGeo, team: number, s: number): number { return team === 1 ? l.length - s : s; }
export function fromProgress(l: LaneGeo, team: number, p: number): number { return team === 1 ? l.length - p : p; }

// ── fighters ────────────────────────────────────────────────────────────────────────────────────
export interface FighterProfile {
  readonly def: FighterDefT;
  readonly style: Style;
  readonly prefRange: number;
  readonly attackRange: number;
  readonly ranged: boolean;
  /** the stat the kit scales with (itemization) */
  readonly scaling: 'phys' | 'magic';
  readonly combo: readonly SlotT[];
  /** basic abilities in level-up priority order */
  readonly levelOrder: readonly ('a1' | 'a2' | 'a3')[];
  /** base hp fraction under which the style disengages */
  readonly retreatHp: number;
  /** frontline-ish (engages first, soaks) */
  readonly front: boolean;
}

const RETREAT_HP: Readonly<Record<Style, number>> = {
  frontline: 0.2, warden: 0.28, diver: 0.24, skirmisher: 0.27, sustain: 0.26, burst: 0.32, artillery: 0.34, marksman: 0.34,
};
/** draft threat / power heuristic by style (bans) */
export const STYLE_POWER: Readonly<Record<Style, number>> = {
  burst: 1.2, diver: 1.1, marksman: 1.1, skirmisher: 1.05, artillery: 1.0, frontline: 0.95, sustain: 0.95, warden: 0.85,
};
export const FRONT_STYLES: ReadonlySet<Style> = new Set<Style>(['frontline', 'warden', 'diver']);

function useRank(u: number): number {
  if (u & (U_DAMAGE | U_WAVECLEAR | U_POKE | U_EXECUTE)) return 4;
  if (u & (U_CC | U_ZONE)) return 3;
  if (u & (U_HEAL | U_SHIELD)) return 2;
  if (u & (U_ENGAGE | U_GAPCLOSE | U_BUFF)) return 1.5;
  return 1;
}

export function fighterProfile(def: FighterDefT): FighterProfile {
  const kit = [def.kit.a1, def.kit.a2, def.kit.a3, def.kit.ult];
  let ap = 0, ad = 0;
  for (const a of kit) {
    for (const d of abilityInfo(a).dmg) {
      if (typeof d.s === 'number') continue;
      ap += (d.s.ap ?? 0);
      ad += (d.s.ad ?? 0) + (d.s.bonusAd ?? 0);
    }
  }
  const style = def.ai.style;
  const attackWeight = style === 'marksman' ? 1.5 : style === 'skirmisher' || style === 'diver' ? 0.8 : 0.3;
  if (def.attack.damageType === 'magic') ap += attackWeight * 0.5; else ad += attackWeight;
  const scaling: 'phys' | 'magic' = ap > ad ? 'magic' : 'phys';
  const combo: SlotT[] = def.ai.comboOrder && def.ai.comboOrder.length > 0 ? def.ai.comboOrder.slice() : ['a1', 'a2', 'a3', 'ult'];
  const basics: ('a1' | 'a2' | 'a3')[] = [];
  for (const s of combo) if ((s === 'a1' || s === 'a2' || s === 'a3') && !basics.includes(s)) basics.push(s);
  const rest = (['a1', 'a2', 'a3'] as const).filter((s) => !basics.includes(s));
  rest.sort((a, b) => useRank(abilityInfo(def.kit[b]).use) - useRank(abilityInfo(def.kit[a]).use) || (a < b ? -1 : 1));
  for (const s of rest) basics.push(s);
  const ranged = def.attack.range >= 3;
  return {
    def, style, prefRange: def.ai.preferredRange, attackRange: def.attack.range, ranged, scaling, combo, levelOrder: basics,
    retreatHp: RETREAT_HP[style] ?? 0.28, front: FRONT_STYLES.has(style),
  };
}

// ── itemization ─────────────────────────────────────────────────────────────────────────────────
type TagW = Partial<Record<ItemDefT['tags'][number], number>>;
const STYLE_TAGS: Readonly<Record<Style, TagW>> = {
  marksman: { attack: 3, crit: 3, onhit: 2, speed: 0.5 },
  artillery: { magic: 3, haste: 2 },
  burst: { attack: 3, magic: 0, haste: 1.5 },
  frontline: { defense: 3, sustain: 1, utility: 1 },
  warden: { support: 3, haste: 2, defense: 1, utility: 1 },
  diver: { defense: 2, attack: 2, haste: 1 },
  skirmisher: { attack: 3, sustain: 1.5, onhit: 1, crit: 1 },
  sustain: { sustain: 3, attack: 2, defense: 1 },
};
type StatW = Partial<Record<keyof StatBlockT, number>>;
/** value points per unit of stat, by style (phys-scaling kit; magic kits swap ad/ap) */
const STYLE_STATS: Readonly<Record<Style, StatW>> = {
  marksman: { ad: 1, attackSpeed: 70, crit: 70, lifesteal: 35, armorPen: 0.9, range: 20, moveSpeed: 8, hp: 0.02 },
  artillery: { ap: 0.8, haste: 0.9, magicPenPct: 70, magicPen: 0.8, hp: 0.02, res: 0.03 },
  burst: { ad: 1, ap: 0.8, haste: 0.6, armorPen: 1, magicPenPct: 70, hp: 0.025, moveSpeed: 8 },
  frontline: { hp: 0.08, armor: 0.6, resist: 0.6, haste: 0.5, hpRegen: 4, ad: 0.3, tenacity: 30, moveSpeed: 6 },
  warden: { healShieldPower: 80, haste: 0.8, hp: 0.05, armor: 0.4, resist: 0.4, ap: 0.3, resRegen: 3, moveSpeed: 6 },
  diver: { ad: 0.8, hp: 0.06, armor: 0.45, resist: 0.4, haste: 0.6, lifesteal: 30, moveSpeed: 8 },
  skirmisher: { ad: 1, attackSpeed: 40, crit: 35, lifesteal: 40, hp: 0.04, armor: 0.3, haste: 0.4, omnivamp: 40 },
  sustain: { ad: 0.7, ap: 0.7, hp: 0.06, omnivamp: 50, lifesteal: 30, hpRegen: 4, armor: 0.3, resist: 0.3, haste: 0.4 },
};

export function itemValue(it: ItemDefT, prof: FighterProfile): number {
  const st = STYLE_STATS[prof.style];
  const magic = prof.scaling === 'magic';
  let v = 0;
  for (const k in it.stats) {
    const amount = (it.stats as Record<string, number | undefined>)[k] ?? 0;
    let wgt = (st as Record<string, number | undefined>)[k] ?? 0;
    if (k === 'ad' && magic) wgt = Math.min(wgt, 0.15);
    else if (k === 'ap' && !magic) wgt = Math.min(wgt, 0.1);
    else if (k === 'ap' && magic && wgt === 0) wgt = 0.7;
    else if (k === 'ad' && !magic && wgt === 0) wgt = 0.4;
    v += amount * wgt;
  }
  const tw = STYLE_TAGS[prof.style];
  let tags = 0;
  for (const t of it.tags) {
    let w = tw[t] ?? 0;
    if (t === 'attack' && magic && (prof.style === 'burst' || prof.style === 'sustain' || prof.style === 'diver' || prof.style === 'skirmisher')) w = 0;
    if (t === 'magic' && magic) w = Math.max(w, 3);
    tags += w;
  }
  // passives and actives carry value the stat block cannot show
  const extra = it.passives.length * 6 + (it.active ? 5 : 0);
  return v + tags * 4 + extra;
}

export interface BuildPlan {
  /** completed items in buy order (core → apex), boots handled separately */
  readonly core: readonly string[];
  readonly boots: readonly string[];
  readonly starter: string | null;
  readonly consumable: string | null;
  readonly ward: string | null;
}

export function buildPlan(idx: CatalogIndex, rules: RulesParamsT, prof: FighterProfile, jungler: boolean): BuildPlan {
  const pool = rules.itemPool;
  const inPool = (it: ItemDefT): boolean => it.pools.length === 0 || it.pools.includes(pool);
  const items = idx.catalog.items.filter(inPool);
  const score = (it: ItemDefT): number => itemValue(it, prof) / Math.max(150, it.cost) * 1000;
  const byScore = (list: ItemDefT[]): ItemDefT[] => list.slice().sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
  const cores = byScore(items.filter((i) => i.tier === 'core'));
  const apexes = byScore(items.filter((i) => i.tier === 'apex'));
  const core: string[] = [];
  const takeGroup = new Set<string>();
  const ok = (it: ItemDefT): boolean => !it.uniqueGroup || !takeGroup.has(it.uniqueGroup);
  const take = (it: ItemDefT): void => { core.push(it.id); if (it.uniqueGroup) takeGroup.add(it.uniqueGroup); };
  // two core items, then apex items (preferring ones that build out of a chosen core), then fill
  for (const it of cores) { if (core.length >= 2) break; if (ok(it)) take(it); }
  const apexOrder = apexes.slice().sort((a, b) => {
    const ba = a.components.some((c) => core.includes(c)) ? 1 : 0, bb = b.components.some((c) => core.includes(c)) ? 1 : 0;
    return bb - ba || score(b) - score(a) || (a.id < b.id ? -1 : 1);
  });
  for (const it of apexOrder) { if (core.length >= 4) break; if (ok(it) && !core.includes(it.id)) take(it); }
  for (const it of [...apexOrder, ...cores]) { if (core.length >= 5) break; if (ok(it) && !core.includes(it.id)) take(it); }
  if (core.length === 0) for (const it of byScore(items.filter((i) => i.tier === 'basic'))) { if (core.length >= 5) break; if (!it.active) take(it); }
  const bootsAll = items.filter((i) => i.tier === 'boots');
  const boots1 = bootsAll.filter((b) => b.components.length === 0).sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1))[0];
  const boots2 = byScore(bootsAll.filter((b) => b.components.length > 0))[0];
  const boots = [boots1?.id, boots2?.id].filter((x): x is string => !!x);
  const starters = items.filter((i) => i.tier === 'starter' && i.cost > 0 && i.cost <= rules.startGold);
  const starter = (jungler ? starters.find((s) => s.tags.includes('jungle')) : undefined)
    ?? byScore(starters.filter((s) => !s.tags.includes('jungle')))[0] ?? null;
  const cons = items.filter((i) => i.tier === 'consumable' && i.active && (abilityInfo(i.active).use & U_HEAL)).sort((a, b) => a.cost - b.cost)[0] ?? null;
  const ward = items.filter((i) => i.active && (abilityInfo(i.active).use & U_VISION) && !i.consumable).sort((a, b) => a.cost - b.cost)[0] ?? null;
  return { core, boots, starter: starter ? starter.id : null, consumable: cons ? cons.id : null, ward: ward ? ward.id : null };
}

// ── the match knowledge ─────────────────────────────────────────────────────────────────────────
export interface Knowledge {
  readonly catalog: CatalogT;
  readonly setup: MatchSetup;
  readonly idx: CatalogIndex;
  readonly rules: RulesParamsT;
  readonly map: MapDefT;
  readonly mode: ModeDefT;
  readonly queue: QueueDefT;
  readonly kind: GameKind;
  readonly ffa: boolean;
  readonly lanes: readonly LaneGeo[];
  readonly structs: readonly StructInfo[];
  readonly camps: readonly CampInfo[];
  readonly pickups: readonly PickupInfo[];
  readonly bases: readonly BaseInfo[];
  readonly shops: readonly { x: number; y: number; r: number }[];
  readonly profiles: ReadonlyMap<string, FighterProfile>;
  readonly roles: ReadonlyMap<string, RoleDefT>;
  readonly mapCenterX: number;
  readonly mapCenterY: number;
}

export function gameKindOf(rules: RulesParamsT, map: MapDefT, queue: QueueDefT, teams: number): GameKind {
  if (queue.kind === 'practice') return 'practice';
  if (rules.end.kind === 'last_standing_or_score' || teams > 2) return 'fray';
  if (rules.end.kind === 'score') return 'brawl';
  return map.lanes.length > 1 ? 'rift' : 'bridge';
}

export function buildKnowledge(catalog: CatalogT, setup: MatchSetup, idx?: CatalogIndex): Knowledge {
  const ix = idx ?? indexCatalog(catalog);
  const rules = resolveRules(ix, setup.mode, setup.queue);
  const map = ix.maps.get(setup.map);
  const mode = ix.modes.get(setup.mode);
  const queue = ix.queues.get(setup.queue);
  if (!map || !mode || !queue) throw new Error('bots: setup names an unknown map, mode or queue');
  const teams = new Set(setup.seats.map((s: SeatSetup) => s.team)).size;
  const kind = gameKindOf(rules, map, queue, teams);
  const lanes: LaneGeo[] = map.lanes.map((l, index) => {
    const n = l.path.length;
    const xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = l.path[i][0]; ys[i] = l.path[i][1];
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    return { id: l.id, index, xs, ys, cum, length: cum[n - 1] };
  });
  const structs: StructInfo[] = [];
  if (rules.structures) {
    for (const st of map.structures) {
      const u = ix.units.get(st.unit);
      let lane = -1, s = 0;
      const named = st.lane ? lanes.findIndex((l) => l.id === st.lane) : -1;
      if (named >= 0) { laneProject(lanes[named], st.at[0], st.at[1]); lane = named; s = proj.s; }
      else {
        let best = 81; // a structure within 9 m of a lane belongs to it; farther ones guard the base
        for (const l of lanes) {
          laneProject(l, st.at[0], st.at[1]);
          if (proj.d2 < best) { best = proj.d2; lane = l.index; s = proj.s; }
        }
      }
      const b = u ? u.behavior as Record<string, unknown> : {};
      const attacks = !!u?.attack && u.attack.range > 0 && (u.base.ad ?? 0) > 0 && b.targetRules !== 'none';
      const core = rules.end.coreStructure;
      structs.push({
        id: st.id, unit: st.unit, team: st.team, x: st.at[0], y: st.at[1], lane, s, attacks,
        range: u?.attack?.range ?? 0, radius: u?.collisionRadius ?? 1, isCore: core !== undefined && (st.unit === core || st.id === core),
        respawns: st.respawn !== undefined && st.respawn > 0,
      });
    }
  }
  const camps: CampInfo[] = rules.jungle ? map.camps.map((c, index) => {
    let x = 0, y = 0;
    for (const u of c.units) { x += u.at[0]; y += u.at[1]; }
    const n = Math.max(1, c.units.length);
    return { id: c.id, index, x: x / n, y: y / n, objective: c.objective, firstSpawn: c.firstSpawn, respawn: c.respawn, units: c.units.map((u) => u.unit) };
  }) : [];
  const pickups: PickupInfo[] = map.pickups.map((p) => ({ id: p.id, unit: p.unit, x: p.at[0], y: p.at[1], firstSpawn: p.firstSpawn, respawn: p.respawn }));
  const bases: BaseInfo[] = map.bases.map((b) => ({
    team: b.team, spawnX: b.spawn[0], spawnY: b.spawn[1], fx: b.fountain.at[0], fy: b.fountain.at[1], fr: b.fountain.radius,
    sx: b.shop.at[0], sy: b.shop.at[1], sr: b.shop.radius,
  }));
  const shops = map.shops.map((s) => ({ x: s.at[0], y: s.at[1], r: s.radius }));
  const profiles = new Map<string, FighterProfile>();
  for (const f of catalog.fighters) profiles.set(f.id, fighterProfile(f));
  return {
    catalog, setup, idx: ix, rules, map, mode, queue, kind, ffa: kind === 'fray', lanes, structs, camps, pickups, bases, shops,
    profiles, roles: ix.roles, mapCenterX: map.size[0] / 2, mapCenterY: map.size[1] / 2,
  };
}
