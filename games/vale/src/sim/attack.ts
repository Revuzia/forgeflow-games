// VALE sim — basic attacks (CONTRACT §5.2).
//
// period = 1 / attackSpeed (AS capped at 2.5 in stats); the hit lands `windup × period` after the
// attack starts (melee), or a homing projectile leaves then (ranged: attack.projectileSpeed set).
// The crit is rolled from the combat stream when the attack STARTS so the 'attack' event can carry
// it (and the renderer can play the crit clip). Range is edge to edge: attack range + both radii.
// A pending empowered attack (buff.empowerAttacks) adds its rangeBonus and is consumed on release;
// its effects run on hit with the buff's context. attackHit triggers fire on every landed attack.
//
// Targets: taunt forces the taunter; an attack order chases its target; an attack-move with a
// picked enemy (prefer) commits to it while it is attackable; attack-move and idle
// units (autoAttack) acquire the best enemy in range — lowest acquireScore (hooks.acquireScore,
// default: nearest, structures and wards last). Units that are moving, casting, dashing,
// disarmed, feared or hard-CC'd do not start attacks; losing the target (dead or untargetable) or
// getting CC'd during the windup cancels the attack (the cooldown still runs, as with any started
// attack).
// Attack in place (ORDER_ATTACK_AT, Shift + left-click, ruling 39): never walks. Each attack it owes goes to the order's
// target when it is in range, else to the enemy in range nearest the aimed point among those the aim means (within
// ATTACK_AT_CLICK_M of the point or within ATTACK_AT_ARC of the aim line; fighters only when asked); with none it is thrown
// at the ground toward the point: a ranged attack fires a shot along the aim line to its reach (range + radius) that hits
// the first enemy it meets (projectiles.ts; allies and unseen units are passed), a melee swing hits the nearest enemy in
// reach within SWING_ARC of its facing at release, else either misses. Taunt still forces the taunter; disarm, fear and
// hard CC stop it like any attack; cooldown and windup are the basic attack's own.

import { TICK_DT } from '../contracts/sim.ts';
import type { EffectT } from '../contracts/catalog.ts';
import { addResource, dealDamage } from './combat.ts';
import { runEffects } from './effects.ts';
import {
  CC_TAUNT, ORDER_ATTACK, ORDER_ATTACK_AT, ORDER_ATTACK_MOVE, ORDER_NONE, type EffectCtx, type Entity,
} from './entity.ts';
import { spawnAttackProjectile, spawnAttackShot } from './projectiles.ts';
import { computeStats } from './stats.ts';
import { breakInvisibility, canAttack, consumeEmpower, empowerRangeBonus, peekEmpower, statusFrom } from './status.ts';
import { fireTrigger } from './triggers.ts';
import type { World } from './world.ts';
import { datan2, dcos, dsin } from './dmath.ts';

const scratch: Entity[] = [];
/** attack in place (ruling 39): an enemy whose edge is this near (m) the aimed point is meant … */
const ATTACK_AT_CLICK_M = 2;
/** … or one within this angle of the aim line (cos 60°) */
const ATTACK_AT_ARC = 0.5;
/** a melee swing thrown at the ground hits an enemy in reach within this angle of its facing (cos 50°) */
const SWING_ARC = 0.6427876;

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
      // the enemy the player picked: committed to (movement.ts walks to it, past nearer enemies) while it
      // stays attackable; once it dies, hides or leaves vision the order is a plain attack-move to its point
      if (e.orderTarget >= 0) {
        const picked = w.live(e.orderTarget);
        if (picked && attackable(w, e, picked)) return picked;
        e.orderTarget = -1;
      }
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
  e.atkAimed = false;
  e.atkCrit = e.stats.crit > 0 ? w.rng.combat.chance(e.stats.crit) : false;
  e.atkAnim = period;
  e.atkAlt = !e.atkAlt;
  e.actionSeq++;
  e.facing = datan2(t.y - e.y, t.x - e.x);
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
      : { caster: src, rank: Math.max(1, src.level), target: t, px: t.x, py: t.y, dx: dcos(src.facing), dy: dsin(src.facing),
          hit: t, ex: t.x, ey: t.y, hasEnd: true, source: { kind: 'passive', id: src.def }, present: undefined, depth: 1, slot: null };
    runEffects(w, empower, ctx);
  }
}

/** does an attack in place aimed at (ax, ay) mean `t` (ruling 39): its edge near the point, or near the aim line */
export function attackAtMeans(e: Entity, t: Entity, ax: number, ay: number): boolean {
  if (Math.sqrt((t.x - ax) * (t.x - ax) + (t.y - ay) * (t.y - ay)) - t.radius <= ATTACK_AT_CLICK_M) return true;
  const ux = ax - e.x, uy = ay - e.y, vx = t.x - e.x, vy = t.y - e.y;
  const ul = Math.sqrt(ux * ux + uy * uy), vl = Math.sqrt(vx * vx + vy * vy);
  if (ul < 1e-6 || vl < 1e-6) return true;
  return (ux * vx + uy * vy) / (ul * vl) >= ATTACK_AT_ARC;
}

/** the enemy an attack in place goes for now: its target in range, else the meant enemy in range nearest the point */
function attackAtTarget(w: World, e: Entity): Entity | null {
  const ok = (c: Entity): boolean => attackable(w, e, c) && inAttackRange(e, c) && (!e.atkAtFighters || c.kind === 'fighter');
  if (e.orderTarget >= 0) {
    const p = w.live(e.orderTarget);
    if (p && ok(p)) return p;
  }
  const n = w.query(e.x, e.y, attackRange(e) + e.radius + 2, scratch);
  let best: Entity | null = null, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    if (!ok(c) || !attackAtMeans(e, c, e.orderX, e.orderY)) continue;
    const d = Math.sqrt((c.x - e.orderX) * (c.x - e.orderX) + (c.y - e.orderY) * (c.y - e.orderY)) - c.radius;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && c.id < best.id)) { bestD = d; best = c; }
  }
  return best;
}

/** an attack thrown at the ground toward the order's point (no target) */
function startAimed(w: World, e: Entity): void {
  const period = 1 / Math.max(0.05, e.stats.attackSpeed);
  e.atkCd = period;
  e.atkWindup = e.attackDef!.windup * period;
  e.atkTarget = -1;
  e.atkAimed = true; e.atkAimX = e.orderX; e.atkAimY = e.orderY;
  e.atkCrit = e.stats.crit > 0 ? w.rng.combat.chance(e.stats.crit) : false;
  e.atkAnim = period;
  e.atkAlt = !e.atkAlt;
  e.actionSeq++;
  const dx = e.atkAimX - e.x, dy = e.atkAimY - e.y;
  if (dx * dx + dy * dy > 1e-6) e.facing = datan2(dy, dx);
  breakInvisibility(w, e);
  w.emit({ e: 'attack', t: w.time, src: e.id, dst: -1, windup: e.atkWindup, crit: e.atkCrit });
}

/** an aimed attack is released: a shot along the aim line (ranged), else a swing in its arc */
function releaseAimed(w: World, e: Entity): void {
  e.atkAimed = false;
  const ad = e.attackDef!;
  const reach = attackRange(e) + e.radius;   // before an empowered attack's bonus is consumed
  let effects: EffectT[] | null = null, ctx: EffectCtx | null = null;
  const b = peekEmpower(e);
  if (b && b.empower) { effects = b.empower.effects; ctx = b.ctx; consumeEmpower(w, e, b); }
  const r = e.resource;
  if (r && r.gainOnAttack) addResource(e, r.gainOnAttack);
  let dx = e.atkAimX - e.x, dy = e.atkAimY - e.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l > 1e-6) { dx /= l; dy /= l; } else { dx = dcos(e.facing); dy = dsin(e.facing); }
  if (ad.projectileSpeed) { spawnAttackShot(w, e, dx, dy, reach, e.atkCrit, ad.damageType, effects, ctx); return; }
  const n = w.query(e.x, e.y, reach + 2, scratch);
  let best: Entity | null = null, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    if (!attackable(w, e, c) || !inAttackRange(e, c)) continue;
    const vx = c.x - e.x, vy = c.y - e.y, vl = Math.sqrt(vx * vx + vy * vy);
    if (vl > 1e-6 && (vx * dx + vy * dy) / vl < SWING_ARC) continue;
    if (vl < bestD - 1e-9 || (Math.abs(vl - bestD) <= 1e-9 && best !== null && c.id < best.id)) { bestD = vl; best = c; }
  }
  if (best) applyAttackHit(w, e, best, e.atkCrit, ad.damageType, effects, ctx);
}

/** ORDER_ATTACK_AT: start the attack the order owes when the cooldown allows; end the order once it is paid or lapsed */
function attackAtStep(w: World, e: Entity): void {
  if (e.atkAtLeft <= 0 || w.tick > e.atkAtUntil) { e.order = ORDER_NONE; e.orderTarget = -1; return; }
  if (e.statsDirty) computeStats(w, e);
  const t = attackAtTarget(w, e);
  if (e.atkCd > 0) { e.atkTarget = t ? t.id : -1; return; }
  e.atkAtLeft--;
  if (t) startAttack(w, e, t); else startAimed(w, e);
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
    if (e.atkWindup >= 0 && e.atkAimed) {
      if (!canAttack(e) || e.cast || e.dash) { e.atkWindup = -1; e.atkAnim = 0; e.atkAimed = false; continue; }
      e.atkWindup -= dt;
      if (e.atkWindup <= 1e-9) { e.atkWindup = -1; releaseAimed(w, e); }
      continue;
    }
    if (e.atkWindup >= 0) {
      const t = w.live(e.atkTarget);
      if (!t || !t.targetable || !canAttack(e) || e.cast || e.dash) { e.atkWindup = -1; e.atkAnim = 0; continue; }
      e.atkWindup -= dt;
      if (e.atkWindup <= 1e-9) { e.atkWindup = -1; releaseAttack(w, e, t); }
      continue;
    }
    if (e.cast || e.dash || !canAttack(e)) {
      if (e.order === ORDER_ATTACK_AT && w.tick > e.atkAtUntil) { e.order = ORDER_NONE; e.orderTarget = -1; }
      continue;
    }
    if (e.order === ORDER_ATTACK_AT && (e.ccMask & CC_TAUNT) === 0) { attackAtStep(w, e); continue; }
    if (e.statsDirty) computeStats(w, e);
    const t = desiredAttackTarget(w, e);
    if (!t) { if (e.order !== ORDER_ATTACK_MOVE) e.atkTarget = -1; continue; }
    if (!inAttackRange(e, t)) continue;
    e.atkTarget = t.id;
    if (e.atkCd > 0) continue;
    startAttack(w, e, t);
  }
}
