// VALE sim — passive trigger dispatcher (catalog Trigger; CONTRACT §5.3).
//
// Kit passives, item passives, boons (setup), team-buff passives and unit passives are all
// PassiveInst records on the entity; their triggers are bucketed by `on` so dispatch is a single
// array walk. Every trigger honours `cooldown`, `perTargetCooldown`, `filter` (against the
// trigger's subject) and `cond`. Effects run with caster = the passive's owner, rank = owner level,
// target = hit = the subject.
//
// Subjects ("hit") per `on`:
//   attackHit / abilityHit / damageDealt / kill / takedown / statusApplied → the unit affected
//   damageTaken / shieldBroken / death → the attacker (may be null)
//   interval / spawn / levelUp / moveDistance / lowHp / abilityCast → none (cast: the cast target)
// `statusApplied` fires on the APPLIER. `lowHp` fires once per dip: when damage leaves the owner
// matching `cond` (default selfHpBelow 0.3), then re-arms once the condition stops holding.
// `interval` uses Trigger.interval seconds; `moveDistance` uses Trigger.interval metres.
// Recursion guard: effects fired by a trigger carry depth+1; nothing fires past MAX_TRIGGER_DEPTH.

import type { PassiveDefT } from '../contracts/catalog.ts';
import {
  TRIGGER_INDEX, type EffectCtx, type Entity, type PassiveInst, type SourceRef, type TriggerInst, type TriggerOn,
} from './entity.ts';
import { evalCondition, matchesFilter, runEffects } from './effects.ts';
import { markStatsDirty } from './stats.ts';
import type { World } from './world.ts';

export const MAX_TRIGGER_DEPTH = 4;
const LOW_HP_DEFAULT = 0.3;
const IDX_INTERVAL = TRIGGER_INDEX.interval;
const IDX_LOWHP = TRIGGER_INDEX.lowHp;
const IDX_MOVE = TRIGGER_INDEX.moveDistance;

/** install a passive; `key` groups records for removal (an item slot, a boon, a team buff) */
export function addPassive(w: World, e: Entity, def: PassiveDefT, kind: SourceRef['kind'], key: string, stats = true): PassiveInst {
  const p: PassiveInst = { def, kind, id: def.id, key, triggers: [], stats };
  for (const t of def.triggers) {
    const ti: TriggerInst = { t, passive: p, cd: 0, per: null, acc: 0, armed: true };
    p.triggers.push(ti);
    e.triggers[TRIGGER_INDEX[t.on]].push(ti);
  }
  e.passives.push(p);
  if (stats && (def.stats || def.statsPerLevel)) markStatsDirty(e);
  return p;
}

export function removePassives(w: World, e: Entity, key: string): void {
  let changed = false;
  for (let i = e.passives.length - 1; i >= 0; i--) {
    const p = e.passives[i];
    if (p.key !== key) continue;
    e.passives.splice(i, 1);
    if (p.stats && (p.def.stats || p.def.statsPerLevel)) changed = true;
    for (const ti of p.triggers) {
      const bucket = e.triggers[TRIGGER_INDEX[ti.t.on]];
      const k = bucket.indexOf(ti);
      if (k >= 0) bucket.splice(k, 1);
    }
  }
  if (changed) markStatsDirty(e);
}

function triggerCtx(e: Entity, ti: TriggerInst, hit: Entity | null, depth: number): EffectCtx {
  const tx = hit ? hit.x : e.x, ty = hit ? hit.y : e.y;
  let dx = tx - e.x, dy = ty - e.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l > 1e-6) { dx /= l; dy /= l; } else { dx = Math.cos(e.facing); dy = Math.sin(e.facing); }
  return {
    caster: e, rank: Math.max(1, e.level), target: hit, px: tx, py: ty, dx, dy, hit,
    ex: tx, ey: ty, hasEnd: false, source: { kind: ti.passive.kind, id: ti.passive.id },
    present: ti.passive.def.present, depth: depth + 1, slot: null,
  };
}

function tryFire(w: World, e: Entity, ti: TriggerInst, hit: Entity | null, depth: number): boolean {
  if (ti.cd > 0) return false;
  const t = ti.t;
  if (hit && t.filter && !matchesFilter(w, e, hit, t.filter, false)) return false;
  if (hit && ti.per && t.perTargetCooldown) {
    const ready = ti.per.get(hit.id);
    if (ready !== undefined && w.time < ready) return false;
  }
  const ctx = triggerCtx(e, ti, hit, depth);
  if (t.cond && !evalCondition(w, t.cond, ctx)) return false;
  if (t.cooldown) ti.cd = t.cooldown;
  if (hit && t.perTargetCooldown) (ti.per ??= new Map()).set(hit.id, w.time + t.perTargetCooldown);
  runEffects(w, t.effects, ctx);
  return true;
}

/** fire every `on` trigger of an entity for a subject */
export function fireTrigger(w: World, e: Entity, on: TriggerOn, hit: Entity | null, depth = 0): void {
  if (depth >= MAX_TRIGGER_DEPTH) return;
  const bucket = e.triggers[TRIGGER_INDEX[on]];
  if (bucket.length === 0) return;
  // death triggers run on a dead owner; everything else needs it alive
  if (!e.alive && on !== 'death') return;
  if (bucket.length === 1) { tryFire(w, e, bucket[0], hit, depth); return; }
  // copy: effects may add/remove passives while we iterate
  const list = bucket.slice();
  for (let i = 0; i < list.length; i++) tryFire(w, e, list[i], hit, depth);
}

/** lowHp edge detection after damage (see header) */
export function checkLowHp(w: World, e: Entity, depth: number): void {
  const bucket = e.triggers[IDX_LOWHP];
  if (bucket.length === 0 || !e.alive || depth >= MAX_TRIGGER_DEPTH) return;
  for (let i = 0; i < bucket.length; i++) {
    const ti = bucket[i];
    if (!ti.armed || ti.cd > 0) continue;
    if (!lowHpHolds(w, e, ti)) continue;
    if (tryFire(w, e, ti, null, depth)) ti.armed = false;
  }
}
function lowHpHolds(w: World, e: Entity, ti: TriggerInst): boolean {
  if (ti.t.cond) return evalCondition(w, ti.t.cond, triggerCtx(e, ti, null, 0));
  return e.hp < e.maxHp * LOW_HP_DEFAULT;
}

/** per tick: cooldowns, interval triggers, lowHp re-arming, moveDistance accumulation */
export function tickTriggers(w: World, e: Entity, dt: number): void {
  if (e.passives.length === 0) return;
  for (let p = 0; p < e.passives.length; p++) {
    const ts = e.passives[p].triggers;
    for (let i = 0; i < ts.length; i++) if (ts[i].cd > 0) ts[i].cd -= dt;
  }
  if (!e.alive) return;
  const iv = e.triggers[IDX_INTERVAL];
  for (let i = 0; i < iv.length; i++) {
    const ti = iv[i];
    const period = ti.t.interval ?? 1;
    ti.acc += dt;
    if (ti.acc + 1e-9 >= period) { ti.acc -= period; tryFire(w, e, ti, null, 0); }
  }
  const lo = e.triggers[IDX_LOWHP];
  for (let i = 0; i < lo.length; i++) { const ti = lo[i]; if (!ti.armed && !lowHpHolds(w, e, ti)) ti.armed = true; }
}

/** metres moved this tick (movement system) */
export function noteMoved(w: World, e: Entity, metres: number): void {
  const mv = e.triggers[IDX_MOVE];
  if (mv.length === 0 || metres <= 0) return;
  for (let i = 0; i < mv.length; i++) {
    const ti = mv[i];
    const step = ti.t.interval ?? 1;
    ti.acc += metres;
    if (ti.acc >= step) { ti.acc %= step; tryFire(w, e, ti, null, 0); }
  }
}
