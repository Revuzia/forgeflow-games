// VALE sim — summons (DSL `summon` op) and wards (CONTRACT §5.4).
//
// Summons are owned by their caster (Entity.owner = seat, ownerEid = caster): kills, gold and
// assists go to the owner (core creditFighter), they live `duration` s (core expiry) and maxAlive
// trims the oldest (core summonUnits). AI every SUMMON_THINK_TICKS (staggered):
//   * farther than behavior.ownerLeash from a living owner → drop everything and walk back;
//   * else attack: the owner's current attack target if it is within aggroRange of the summon,
//     else the best enemy within aggroRange by `priority` (default: attackers of an allied
//     fighter, fighters, summons, minions, monsters), casting ready unit abilities at it;
//   * else follow: walk to the owner when farther than behavior.followRange.
// A summon whose owner is gone keeps fighting what comes near (idle auto-attack). Summons with
// no move speed (turrets) only pick targets in reach.
//
// Wards (kind 'ward', usually from a `summon` op on an item active): static, give vision with
// UnitDef.sightRange, expire with the summon duration; behavior.invisible keeps them hidden from
// enemies unless revealed. Every damage instance hurts them normally (author their hp).

import { attackable } from '../attack.ts';
import { ORDER_ATTACK, ORDER_MOVE, type Entity } from '../entity.ts';
import { issueAttack, issueMove, issueStop } from '../movement.ts';
import { applyStatus } from '../status.ts';
import type { World } from '../world.ts';
import { behaviorOf, bestTarget, dist2, useUnitAbilities } from './common.ts';

export const SUMMON_THINK_TICKS = 5;

/** 'ai' phase */
export function summonSystem(w: World): void {
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.kind !== 'summon' || !e.alive || !e.unit) continue;
    const cur = e.order === ORDER_ATTACK ? w.live(e.orderTarget) : null;
    const curOk = !!cur && attackable(w, e, cur);
    if (curOk && (w.tick + e.id) % SUMMON_THINK_TICKS !== 0) { useUnitAbilities(w, e, cur!); continue; }
    if (!curOk && e.order !== ORDER_ATTACK && (w.tick + e.id) % SUMMON_THINK_TICKS !== 0) continue;
    const b = behaviorOf(e.unit);
    const owner = e.ownerEid >= 0 ? w.live(e.ownerEid) : null;
    const mobile = e.stats.moveSpeed > 0;
    if (owner && mobile && dist2(e, owner.x, owner.y) > b.ownerLeash * b.ownerLeash) {
      issueMove(w, e, owner.x, owner.y, false);
      continue;
    }
    const aggro2 = b.aggroRange * b.aggroRange;
    let t: Entity | null = null;
    const ot = owner && owner.atkTarget >= 0 ? w.live(owner.atkTarget) : null;
    if (ot && attackable(w, e, ot) && dist2(ot, e.x, e.y) <= aggro2) t = ot;
    if (!t) t = curOk && dist2(cur!, e.x, e.y) <= aggro2 ? cur : null;
    if (!t) t = bestTarget(w, e, mobile ? b.aggroRange : e.stats.range + e.radius, b.priority, b.callForHelpRange);
    if (t) {
      if (t !== cur) issueAttack(w, e, t);
      useUnitAbilities(w, e, t);
      continue;
    }
    if (owner && mobile && dist2(e, owner.x, owner.y) > b.followRange * b.followRange) {
      if (e.order !== ORDER_MOVE || Math.abs(e.orderX - owner.x) + Math.abs(e.orderY - owner.y) > 1) issueMove(w, e, owner.x, owner.y, false);
    } else if (e.order === ORDER_ATTACK || e.order === ORDER_MOVE) {
      issueStop(w, e);
    }
  }
}

/** hooks.spawn: invisible wards */
export function wardSpawnHook(w: World, e: Entity): void {
  if (e.kind !== 'ward' || !e.unit) return;
  if (behaviorOf(e.unit).invisible) applyStatus(w, null, e, 'invisible', Infinity);
}
