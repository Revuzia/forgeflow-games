// VALE sim — map pickups from MapDef.pickups (CONTRACT §5.4; Fray/Bridge).
//
// Each map entry spawns its `unit` (kind 'pickup', team NEUTRAL, static, never attacked) at
// `firstSpawn` and again `respawn` s after it was taken. A living fighter whose body touches it
// (centre distance ≤ both radii + PICKUP_REACH) takes it — lowest entity id first when several
// touch it on the same tick. Taking it runs behavior.grant (EffectT[]; caster = target = hit = the
// fighter, rank = its level, source { kind: 'passive', id: <unit id> }, so a `gold` op in the
// list pays reason 'pickup'), pays behavior.gold (× goldMult, reason 'pickup'), emits 'pickup'
// { player, def, x, y } and removes the pickup entity (no death event: it was taken, not killed).

import { makeCtx, runEffects } from '../effects.ts';
import { NEUTRAL_TEAM, type Entity } from '../entity.ts';
import { payGold } from '../economy.ts';
import { spawnUnit } from '../spawn.ts';
import type { MapDefT } from '../../contracts/catalog.ts';
import type { World } from '../world.ts';
import { behaviorOf } from './common.ts';

export const PICKUP_REACH = 0.3;

type PickupDef = MapDefT['pickups'][number];
interface PickupEntry { def: PickupDef; ent: Entity | null; spawnAt: number }
const KEY = 'pickups';
const near: Entity[] = [];

function entries(w: World): PickupEntry[] { return w.ext[KEY] as PickupEntry[]; }

export function initPickups(w: World): void {
  w.ext[KEY] = w.mapDef.pickups.map((def): PickupEntry => ({ def, ent: null, spawnAt: def.firstSpawn }));
}

/** 'ai' phase: spawns due pickups, hands out touched ones */
export function pickupSystem(w: World): void {
  if (w.phase === 'ended') return;
  for (const p of entries(w)) {
    if (!p.ent && p.spawnAt >= 0 && w.time + 1e-9 >= p.spawnAt) {
      p.ent = spawnUnit(w, p.def.unit, NEUTRAL_TEAM, p.def.at[0], p.def.at[1]);
      p.ent.autoAttack = false;
      p.spawnAt = -1;
    }
    const e = p.ent;
    if (!e || !e.alive) continue;
    const n = w.query(e.x, e.y, e.radius + PICKUP_REACH, near);
    let taker: Entity | null = null;
    for (let i = 0; i < n; i++) {
      const f = near[i];
      if (f.kind !== 'fighter' || !f.alive || !f.player) continue;
      if (!taker || f.id < taker.id) taker = f;
    }
    if (taker) take(w, p, e, taker);
  }
}

function take(w: World, p: PickupEntry, e: Entity, f: Entity): void {
  const def = e.unit!;
  const b = behaviorOf(def);
  const player = f.player!;
  w.emit({ e: 'pickup', t: w.time, player: player.player, def: def.id, x: e.x, y: e.y });
  if (b.grant.length > 0) {
    const ctx = makeCtx(f, { kind: 'passive', id: def.id }, Math.max(1, f.level), f, f.x, f.y, undefined, null, 1);
    runEffects(w, b.grant, ctx);
  }
  if (b.gold > 0) payGold(w, player.player, b.gold * w.rules.goldMult, 'pickup', e.x, e.y);
  w.remove(e);
  p.ent = null;
  p.spawnAt = w.time + p.def.respawn;
}
