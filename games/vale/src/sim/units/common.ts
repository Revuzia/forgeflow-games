// VALE sim — shared unit plumbing: UnitDef.behavior keys, target priority, call-for-help memory,
// unit ability use, per-kind damage tuning (CONTRACT §5.4).
//
// UnitDef.behavior is free-form JSON (`z.record(string, unknown)`), so zod applies NO defaults to
// it. This file is the one place that reads it; a key with the wrong type falls back to its
// default. behavior_keys.ts lists the same keys as data and the content build validates content
// against it — change both together. Every key the sim reads, by unit kind:
//
//   any unit with an attack
//     damageMult        { fighter?, minion?, monster?, structure?, summon?, ward? } multiplier on this
//                       unit's damage (attacks and abilities) to that kind. Default: none (×1).
//   minion
//     aggroRange        m, how far it looks for targets.            default max(7, attack range + 3)
//     chaseRange        m it may chase from where the chase began.  default aggroRange + 4
//     callForHelpRange  m, an ally hurt within this range calls it. default 9
//     priority          target order (see PRIORITY TOKENS).         default MINION_PRIORITY
//   structure
//     targetRules       'tower' (attacks per priority) | 'none'.    default 'tower' when it has an attack
//     priority          default TOWER_PRIORITY
//     callForHelpRange  m around the tower an ally fighter must stand in to call it.
//                       default attack range + radius + 2
//     rampPerHit        bonus damage per consecutive hit on the same fighter. default 0.4 (+40 %)
//     rampMax           cap on that bonus.                           default 1.2 (+120 %)
//     rampReset         s without a hit on that fighter that resets the ramp. default 3
//   monster
//     leash             m from its home spot before it resets.      default 8
//     resetRegen        fraction of max hp healed per second while walking home. default 0.25
//                       (it arrives home at full hp either way)
//   summon
//     aggroRange        default 8 · followRange (stay this close to the owner) default 3
//     ownerLeash        m from the owner before it drops its target and returns. default 12
//     priority, callForHelpRange   as for minions (default SUMMON_PRIORITY, 9)
//   ward
//     invisible         true: hidden from enemies unless revealed.   default false
//   pickup
//     grant             EffectT[] run on the fighter who walks over it (caster = target = that
//                       fighter, rank = its level, source = the pickup's unit id). The content build
//                       zod-parses it and ships it with defaults filled in.
//     gold              gold to that fighter (reason 'pickup', × goldMult). default 0
//   any unit (practice)
//     dummy             true marks THE training dummy for the practice `spawnDummy` command
//                       (the first unit in catalog order with dummy === true).
//
// PRIORITY TOKENS (first matching token wins; nearest within a token; then lower id; a candidate
// matching no token is never chosen):
//   'fighterAttacker'  damaged a fighter of my team within CALL_FOR_HELP_WINDOW s, and that fighter
//                      stands within my callForHelpRange
//   'minionAttacker'   the same for a minion of my team
//   'fighter' 'minion' 'monster' 'structure' 'summon' 'ward'   by entity kind
// Stickiness: a unit keeps a valid current target and only switches when a call-for-help token
// ranks strictly higher than the current target's token.

import type { EffectT, UnitDefT } from '../../contracts/catalog.ts';
import type { EntityKind } from '../../contracts/sim.ts';
import { attackRange, attackable, inAttackRange } from '../attack.ts';
import { castInRange, tryCast } from '../abilities.ts';
import { SLOT_A1, SLOT_ULT, type Entity } from '../entity.ts';
import type { World } from '../world.ts';

/** seconds an attack on an ally keeps "calling for help" */
export const CALL_FOR_HELP_WINDOW = 2;
export const MINION_PRIORITY: readonly string[] = ['fighterAttacker', 'minion', 'summon', 'structure', 'fighter'];
export const TOWER_PRIORITY: readonly string[] = ['fighterAttacker', 'minion', 'summon', 'monster', 'fighter'];
export const SUMMON_PRIORITY: readonly string[] = ['fighterAttacker', 'fighter', 'summon', 'minion', 'monster'];

export interface UnitBehavior {
  aggroRange: number;
  chaseRange: number;
  callForHelpRange: number;
  priority: readonly string[];
  targetRules: 'tower' | 'none';
  rampPerHit: number;
  rampMax: number;
  rampReset: number;
  leash: number;
  resetRegen: number;
  followRange: number;
  ownerLeash: number;
  invisible: boolean;
  dummy: boolean;
  grant: readonly EffectT[];
  gold: number;
  damageMult: Readonly<Partial<Record<EntityKind, number>>> | null;
}

const cache = new WeakMap<UnitDefT, UnitBehavior>();

function num(b: Record<string, unknown>, k: string, d: number): number {
  const v = b[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function bool(b: Record<string, unknown>, k: string, d: boolean): boolean {
  const v = b[k];
  return typeof v === 'boolean' ? v : d;
}
function strList(b: Record<string, unknown>, k: string, d: readonly string[]): readonly string[] {
  const v = b[k];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : d;
}

/** resolved behavior of a unit def (cached per def object) */
export function behaviorOf(def: UnitDefT): UnitBehavior {
  let r = cache.get(def);
  if (r) return r;
  const b = def.behavior;
  const atk = def.attack ? def.attack.range : 0;
  const kind = def.kind;
  const aggro = num(b, 'aggroRange', kind === 'summon' ? 8 : Math.max(7, atk + 3));
  const prio = kind === 'structure' ? TOWER_PRIORITY : kind === 'summon' ? SUMMON_PRIORITY : MINION_PRIORITY;
  const dm = b.damageMult;
  let damageMult: Partial<Record<EntityKind, number>> | null = null;
  if (dm && typeof dm === 'object' && !Array.isArray(dm)) {
    damageMult = {};
    for (const [k, v] of Object.entries(dm as Record<string, unknown>)) if (typeof v === 'number') (damageMult as Record<string, number>)[k] = v;
  }
  const grant = Array.isArray(b.grant) ? b.grant as EffectT[] : [];
  r = {
    aggroRange: aggro,
    chaseRange: num(b, 'chaseRange', aggro + 4),
    callForHelpRange: num(b, 'callForHelpRange', kind === 'structure' ? atk + def.collisionRadius + 2 : 9),
    priority: strList(b, 'priority', prio),
    targetRules: b.targetRules === 'none' || !def.attack ? 'none' : 'tower',
    rampPerHit: num(b, 'rampPerHit', 0.4),
    rampMax: num(b, 'rampMax', 1.2),
    rampReset: num(b, 'rampReset', 3),
    leash: num(b, 'leash', 8),
    resetRegen: num(b, 'resetRegen', 0.25),
    followRange: num(b, 'followRange', 3),
    ownerLeash: num(b, 'ownerLeash', 12),
    invisible: bool(b, 'invisible', false),
    dummy: bool(b, 'dummy', false),
    grant,
    gold: num(b, 'gold', 0),
    damageMult,
  };
  cache.set(def, r);
  return r;
}

// ── per-entity ext slots (typed accessors over Entity.ext) ──────────────────────────────────────
export function getExt<T>(e: Entity, key: string): T | undefined {
  return e.ext ? e.ext[key] as T | undefined : undefined;
}
export function setExt<T>(e: Entity, key: string, v: T): T {
  (e.ext ??= {})[key] = v;
  return v;
}

// ── call-for-help memory (who recently hurt whom) ───────────────────────────────────────────────
/** stored on the ATTACKER: the last fighter / minion it damaged */
interface AggroMemo { fT: number; fV: number; fTeam: number; mT: number; mV: number; mTeam: number }
const AGGRO = 'aggro';

/** hooks.damage: remember attacks on fighters and minions (feeds the *Attacker priority tokens) */
export function noteAttack(w: World, src: Entity | null, dst: Entity): void {
  if (!src || !src.alive || src.team === dst.team) return;
  if (dst.kind !== 'fighter' && dst.kind !== 'minion') return;
  let m = getExt<AggroMemo>(src, AGGRO);
  if (!m) m = setExt<AggroMemo>(src, AGGRO, { fT: -1e9, fV: -1, fTeam: -2, mT: -1e9, mV: -1, mTeam: -2 });
  if (dst.kind === 'fighter') { m.fT = w.time; m.fV = dst.id; m.fTeam = dst.team; }
  else { m.mT = w.time; m.mV = dst.id; m.mTeam = dst.team; }
}

function calledForHelp(w: World, e: Entity, c: Entity, fighter: boolean, range: number): boolean {
  const m = getExt<AggroMemo>(c, AGGRO);
  if (!m) return false;
  const t = fighter ? m.fT : m.mT, team = fighter ? m.fTeam : m.mTeam, vid = fighter ? m.fV : m.mV;
  if (team !== e.team || w.time - t > CALL_FOR_HELP_WINDOW) return false;
  const v = w.live(vid);
  if (!v) return false;
  const dx = v.x - e.x, dy = v.y - e.y;
  return dx * dx + dy * dy <= range * range;
}

/** index of the first priority token `c` matches (−1: none) */
export function priorityIndex(w: World, e: Entity, c: Entity, prio: readonly string[], cfhRange: number): number {
  for (let i = 0; i < prio.length; i++) {
    const tok = prio[i];
    if (tok === 'fighterAttacker') { if (calledForHelp(w, e, c, true, cfhRange)) return i; }
    else if (tok === 'minionAttacker') { if (calledForHelp(w, e, c, false, cfhRange)) return i; }
    else if (tok === c.kind) return i;
  }
  return -1;
}

/** score for target choice: lower is better, Infinity = never */
export function priorityScore(w: World, e: Entity, c: Entity, d2: number, prio: readonly string[], cfhRange: number): number {
  const i = priorityIndex(w, e, c, prio, cfhRange);
  return i < 0 ? Infinity : i * 1e6 + d2;
}

const scratch: Entity[] = [];
/** best attackable enemy within `range` (centre distance + target radius) by priority */
export function bestTarget(w: World, e: Entity, range: number, prio: readonly string[], cfhRange: number,
  within?: (c: Entity) => boolean): Entity | null {
  const n = w.query(e.x, e.y, range, scratch);
  let best: Entity | null = null, bestS = Infinity;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    if (!attackable(w, e, c)) continue;
    if (within && !within(c)) continue;
    const dx = c.x - e.x, dy = c.y - e.y;
    const s = priorityScore(w, e, c, dx * dx + dy * dy, prio, cfhRange);
    if (s < bestS || (s === bestS && best !== null && c.id < best.id)) { bestS = s; best = c; }
  }
  return bestS === Infinity ? null : best;
}

// Allocation-free `within` filters for the per-tick AI loops. An inline arrow capturing loop-body
// consts makes V8 allocate a context object on EVERY iteration (even when it is not called), which
// was the largest remaining GC churn of a full match; module-level state + plain functions avoid it.
let withinE: Entity | null = null, withinX = 0, withinY = 0, withinR2 = 0;
function withinLeash(c: Entity): boolean { return dist2(c, withinX, withinY) <= withinR2; }
function withinAttackRange(c: Entity): boolean { return inAttackRange(withinE!, c); }
/** bestTarget restricted to candidates within sqrt(r2) of (x, y) (a minion's chase leash) */
export function bestTargetNear(w: World, e: Entity, range: number, prio: readonly string[], cfhRange: number, x: number, y: number, r2: number): Entity | null {
  withinX = x; withinY = y; withinR2 = r2;
  return bestTarget(w, e, range, prio, cfhRange, withinLeash);
}
/** bestTarget restricted to candidates `e` can hit without moving (towers) */
export function bestTargetInAttackRange(w: World, e: Entity, range: number, prio: readonly string[], cfhRange: number): Entity | null {
  withinE = e;
  const t = bestTarget(w, e, range, prio, cfhRange, withinAttackRange);
  withinE = null;
  return t;
}

/**
 * Keep `cur` or switch to `best`? Units stick to a valid target; only a call-for-help token that
 * ranks strictly above the current target's token makes them switch.
 */
export function shouldSwitch(w: World, e: Entity, cur: Entity, best: Entity, prio: readonly string[], cfhRange: number): boolean {
  if (cur === best) return false;
  const bi = priorityIndex(w, e, best, prio, cfhRange);
  if (bi < 0) return false;
  const tok = prio[bi];
  if (tok !== 'fighterAttacker' && tok !== 'minionAttacker') return false;
  const ci = priorityIndex(w, e, cur, prio, cfhRange);
  return ci < 0 || bi < ci;
}

// ── idle / attack-move acquisition (hooks.acquireScore) ─────────────────────────────────────────
/** core's default (nearest; structures, then wards, last) for units without priority rules */
export function defaultAcquireScore(c: Entity, d2: number): number {
  if (c.kind === 'ward') return 2e6 + d2;
  if (c.kind === 'structure') return 1e6 + d2;
  return d2;
}
/** minions, structures and summons acquire by their behavior priority; everyone else by default */
export function unitAcquireScore(w: World, e: Entity, c: Entity, d2: number): number {
  const u = e.unit;
  if (u && (u.kind === 'minion' || u.kind === 'structure' || u.kind === 'summon')) {
    const b = behaviorOf(u);
    return priorityScore(w, e, c, d2, b.priority, b.callForHelpRange);
  }
  return defaultAcquireScore(c, d2);
}

// ── unit abilities ──────────────────────────────────────────────────────────────────────────────
/** cast the first ready unit ability (a1..ult) that can reach `t` from where the unit stands */
export function useUnitAbilities(w: World, e: Entity, t: Entity): boolean {
  if (e.cast || e.dash) return false;
  for (let i = SLOT_A1; i <= SLOT_ULT; i++) {
    const s = e.slots[i];
    if (!s || !s.ready) continue;
    const tk = s.def.targeting.kind;
    if (tk === 'unit' || tk === 'point') {
      if (!castInRange(e, s.def, tk === 'unit' ? t : null, t.x, t.y)) continue;
    } else {
      const reach = Math.max(s.def.targeting.range, attackRange(e)) + e.radius + t.radius;
      const dx = t.x - e.x, dy = t.y - e.y;
      if (dx * dx + dy * dy > reach * reach) continue;
    }
    const r = tk === 'unit' ? tryCast(w, e, i, undefined, undefined, t.id)
      : tk === 'self' || tk === 'none' ? tryCast(w, e, i) : tryCast(w, e, i, t.x, t.y);
    if (r === 'ok') return true;
  }
  return false;
}

// ── hooks shared by every unit kind ─────────────────────────────────────────────────────────────
/** hooks.modifyDamage: UnitDef.behavior.damageMult of the attacking unit */
export function damageMultHook(w: World, src: Entity | null, dst: Entity, raw: number): number {
  if (!src || !src.unit) return raw;
  const dm = behaviorOf(src.unit).damageMult;
  if (!dm) return raw;
  const m = dm[dst.kind];
  return m === undefined ? raw : raw * m;
}

export function dist2(a: Entity, x: number, y: number): number {
  const dx = a.x - x, dy = a.y - y;
  return dx * dx + dy * dy;
}
