// VALE sim — basic attacks (CONTRACT §5.2).
//
// period = 1 / attackSpeed (AS capped at 2.5 in stats); the hit lands `windup × period` after the
// attack starts (melee), or a homing projectile leaves then (ranged: attack.projectileSpeed set).
// The crit is rolled from the combat stream when the attack STARTS so the 'attack' event can carry
// it (and the renderer can play the crit clip). Range is edge to edge: attack range + both radii.
// A pending empowered attack (buff.empowerAttacks) adds its rangeBonus and is consumed on release;
// its effects run on hit with the buff's context. attackHit triggers fire on every landed attack.
//
// Targets: taunt forces the taunter; an attack order chases its target; attack-move and idle
// units (autoAttack) acquire the best enemy in range — lowest acquireScore (hooks.acquireScore,
// default: nearest, structures and wards last). Units that are moving, casting, dashing,
// disarmed, feared or hard-CC'd do not start attacks; losing the target or getting CC'd during
// the windup cancels the attack (the cooldown still runs, as with any started attack).

import { TICK_DT } from '../contracts/sim.ts';
import type { EffectT } from '../contracts/catalog.ts';
import { addResource, dealDamage } from './combat.ts';
import { runEffects } from './effects.ts';
import {
  CC_TAUNT, ORDER_ATTACK, ORDER_ATTACK_MOVE, ORDER_NONE, type EffectCtx, type Entity,
} from './entity.ts';
import { spawnAttackProjectile } from './projectiles.ts';
import { computeStats } from './stats.ts';
import { breakInvisibility, canAttack, consumeEmpower, empowerRangeBonus, peekEmpower, statusFrom } from './status.ts';
import { fireTrigger } from './triggers.ts';
import type { World } from './world.ts';

const scratch: Entity[] = [];

export function attackRange(e: Entity): number { return e.stats.range + empowerRangeBonus(e); }
export function inAttackRange(e: Entity, t: Entity): boolean {
  const r = attackRange(e) + e.radius + t.radius;
  const dx = t.x - e.x, dy = t.y - e.y;
  return dx * dx + dy * dy <= r * r;
}

/** can `e` basic-attack `t` at all (alive, hostile, targetable, visible to e's team) */
export function attackable(w: World, e: Entity, t: Entity): boolean {
  if (!t.alive || t.removed || t === e || !t.targetable) return false;
  if (t.kind === 'projectile' || t.kind === 'zone' || t.kind === 'pickup') return false;
  if (w.relation(e, t) !== 2) return false;
  if (e.team >= 0 && e.team < 31 && (t.visibleMask & (1 << e.team)) === 0) return false;
  return true;
}

function defaultScore(e: Entity, c: Entity, d2: number): number {
  if (c.kind === 'ward') return 2e6 + d2;
  if (c.kind === 'structure') return 1e6 + d2;
  return d2;
}

/** best enemy within attack range by acquireScore (ties: lower id) */
export function acquireTarget(w: World, e: Entity): Entity | null {
  const range = attackRange(e) + e.radius;
  const n = w.query(e.x, e.y, range, scratch);
  const score = w.hooks.acquireScore;
  let best: Entity | null = null, bestS = Infinity;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    if (!attackable(w, e, c)) continue;
    const dx = c.x - e.x, dy = c.y - e.y;
    const d2 = dx * dx + dy * dy;
    const s = score ? score(w, e, c, d2) : defaultScore(e, c, d2);
    if (s < bestS || (s === bestS && best !== null && c.id < best.id)) { bestS = s; best = c; }
  }
  return bestS === Infinity ? null : best;
}

/** the target this entity should be attacking right now (null: none) */
export function desiredAttackTarget(w: World, e: Entity): Entity | null {
  if ((e.ccMask & CC_TAUNT) !== 0) {
    const s = statusFrom(e, 'taunt');
    const t = s ? w.live(s.src) : null;
    if (t) return t;
  }
  switch (e.order) {
    case ORDER_ATTACK: {
      const t = w.live(e.orderTarget);
      if (t && attackable(w, e, t)) return t;
      e.order = ORDER_NONE; e.orderTarget = -1;
      return null;
    }
    case ORDER_ATTACK_MOVE: {
      const cur = w.live(e.atkTarget);
      if (cur && attackable(w, e, cur) && inAttackRange(e, cur)) return cur;
      return acquireTarget(w, e);
    }
    case ORDER_NONE: {
      if (!e.autoAttack) return null;
      const cur = w.live(e.atkTarget);
      if (cur && attackable(w, e, cur) && inAttackRange(e, cur)) return cur;
      return acquireTarget(w, e);
    }
    default: return null;
  }
}

function startAttack(w: World, e: Entity, t: Entity): void {
  const period = 1 / Math.max(0.05, e.stats.attackSpeed);
  e.atkCd = period;
  e.atkWindup = e.attackDef!.windup * period;
  e.atkTarget = t.id;
  e.atkCrit = e.stats.crit > 0 ? w.rng.combat.chance(e.stats.crit) : false;
  e.atkAnim = period;
  e.atkAlt = !e.atkAlt;
  e.actionSeq++;
  e.facing = Math.atan2(t.y - e.y, t.x - e.x);
  breakInvisibility(w, e);
  w.emit({ e: 'attack', t: w.time, src: e.id, dst: t.id, windup: e.atkWindup, crit: e.atkCrit });
}

function releaseAttack(w: World, e: Entity, t: Entity): void {
  const ad = e.attackDef!;
  let effects: EffectT[] | null = null, ctx: EffectCtx | null = null;
  const b = peekEmpower(e);
  if (b && b.empower) { effects = b.empower.effects; ctx = b.ctx; consumeEmpower(w, e, b); }
  const r = e.resource;
  if (r && r.gainOnAttack) addResource(e, r.gainOnAttack);
  if (ad.projectileSpeed) spawnAttackProjectile(w, e, t, e.atkCrit, ad.damageType, effects, ctx);
  else applyAttackHit(w, e, t, e.atkCrit, ad.damageType, effects, ctx);
}

/** a basic attack connects (melee release or ranged projectile arrival) */
export function applyAttackHit(w: World, src: Entity, t: Entity, crit: boolean, dtype: 'phys' | 'magic' | 'true',
  empower: readonly EffectT[] | null, empCtx: EffectCtx | null): void {
  if (!t.alive) return;
  computeStats(w, src);
  dealDamage(w, src, t, src.stats.ad, dtype, { isAttack: true, crit });
  fireTrigger(w, src, 'attackHit', t, 0);
  if (empower && empower.length) {
    const base = empCtx;
    const ctx: EffectCtx = base
      ? { ...base, caster: src, target: t, hit: t, px: t.x, py: t.y, ex: t.x, ey: t.y, hasEnd: true, depth: base.depth + 1 }
      : { caster: src, rank: Math.max(1, src.level), target: t, px: t.x, py: t.y, dx: Math.cos(src.facing), dy: Math.sin(src.facing),
          hit: t, ex: t.x, ey: t.y, hasEnd: true, source: { kind: 'passive', id: src.def }, present: undefined, depth: 1, slot: null };
    runEffects(w, empower, ctx);
  }
}

/** the 'attacks' phase */
export function attackSystem(w: World): void {
  const list = w.entities;
  const dt = TICK_DT;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive || !e.attackDef) continue;
    if (e.atkCd > 0) e.atkCd -= dt;
    if (e.atkAnim > 0) e.atkAnim -= dt;
    if (e.atkWindup >= 0) {
      const t = w.live(e.atkTarget);
      if (!t || !canAttack(e) || e.cast || e.dash) { e.atkWindup = -1; e.atkAnim = 0; continue; }
      e.atkWindup -= dt;
      if (e.atkWindup <= 1e-9) { e.atkWindup = -1; releaseAttack(w, e, t); }
      continue;
    }
    if (e.cast || e.dash || !canAttack(e)) continue;
    if (e.statsDirty) computeStats(w, e);
    const t = desiredAttackTarget(w, e);
    if (!t) { if (e.order !== ORDER_ATTACK_MOVE) e.atkTarget = -1; continue; }
    if (!inAttackRange(e, t)) continue;
    e.atkTarget = t.id;
    if (e.atkCd > 0) continue;
    startAttack(w, e, t);
  }
}
