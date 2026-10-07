// VALE sim — areas (instant/delayed shape hits) and zones (persistent shapes).
//
// area: shape at an anchor, aimed along ctx.dir (cones/rects). With `delay` it is telegraphed
// immediately (the 'area' event carries delay + telegraph) and resolves later at the snapshotted
// position. Hits: every unit matching the filter whose circle overlaps the shape, nearest first
// (then id), truncated to maxTargets; each gets `onHit` (hit = unit, point = area centre), then
// `onCenter` runs once at the centre.
//
// zone: an entity (kind 'zone', def = zone id) that lives `duration` seconds after `delay`.
// It ticks `onTick` on every unit inside at activation and then every `interval`; `onEnter` fires
// when a unit goes from outside to inside; `onExpire` runs once at the end (end = zone position).
// `follow` keeps it on its anchor unit (self/target/hit). `blocks` makes it an obstacle for
// enemies of the caster or for everyone (movement.ts honours it).
//
// This module's system also drains the world scheduler (delayed areas, repeats) because CONTRACT
// §5.1 puts zones/areas after projectiles and before movement.

import { TICK_DT } from '../contracts/sim.ts';
import type { ShapeT } from '../contracts/catalog.ts';
import { anchorPoint, anchorUnit, matchesFilter, onEffectHit, ranked, runEffects } from './effects.ts';
import type { EffOf, EffectCtx, Entity, ZoneData } from './entity.ts';
import { DEG, inShape, shapeReach } from './math.ts';
import type { World } from './world.ts';

const tmp = { x: 0, y: 0 };

export function shapeView(s: ShapeT): Entity['shape'] {
  switch (s.kind) {
    case 'circle': return { kind: 'circle', radius: s.radius };
    case 'ring': return { kind: 'ring', radius: s.radius, inner: s.inner };
    case 'cone': return { kind: 'cone', radius: s.radius, angle: s.angleDeg * DEG };
    case 'rect': return { kind: 'rect', length: s.length, width: s.width };
  }
}

/** units inside a shape matching a filter, nearest first then id; fresh array (callers run effects) */
export function unitsInShape(w: World, caster: Entity, shape: ShapeT, ox: number, oy: number, dx: number, dy: number,
  filter: EffOf<'area'>['filter'], max = Infinity): Entity[] {
  const cand: Entity[] = [];
  w.query(ox, oy, shapeReach(shape), cand);
  const out: Entity[] = [];
  const d2: number[] = [];
  for (const u of cand) {
    if (!matchesFilter(w, caster, u, filter)) continue;
    if (!inShape(shape, u.x, u.y, u.radius, ox, oy, dx, dy)) continue;
    out.push(u);
  }
  for (const u of out) d2.push((u.x - ox) * (u.x - ox) + (u.y - oy) * (u.y - oy));
  const idx = out.map((_, i) => i).sort((a, b) => d2[a] - d2[b] || out[a].id - out[b].id);
  const sorted = idx.map((i) => out[i]);
  if (sorted.length > max) sorted.length = max;
  return sorted;
}

export function doArea(w: World, eff: EffOf<'area'>, ctx: EffectCtx): void {
  anchorPoint(ctx, eff.at, tmp);
  const ox = tmp.x, oy = tmp.y, dx = ctx.dx, dy = ctx.dy;
  const p = eff.present;
  w.emit({
    e: 'area', t: w.time, src: ctx.caster.id, ability: ctx.source.id, x: ox, y: oy, shape: shapeView(eff.shape), delay: eff.delay,
    vfx: p?.vfx, sfx: p?.sfx, telegraph: p?.telegraph ?? (eff.delay > 0 ? 'everyone' : 'none'),
  });
  if (eff.delay > 0) w.schedule(eff.delay, () => resolveArea(w, eff, ctx, ox, oy, dx, dy));
  else resolveArea(w, eff, ctx, ox, oy, dx, dy);
}

function resolveArea(w: World, eff: EffOf<'area'>, ctx: EffectCtx, ox: number, oy: number, dx: number, dy: number): void {
  const hits = unitsInShape(w, ctx.caster, eff.shape, ox, oy, dx, dy, eff.filter, eff.maxTargets ?? Infinity);
  const center: EffectCtx = { ...ctx, px: ox, py: oy, ex: ox, ey: oy, hasEnd: true, depth: ctx.depth + 1 };
  for (const u of hits) {
    onEffectHit(w, ctx, u);
    runEffects(w, eff.onHit, { ...center, hit: u });
  }
  if (eff.onCenter) runEffects(w, eff.onCenter, center);
}

export function spawnZone(w: World, eff: EffOf<'zone'>, ctx: EffectCtx): Entity {
  const c = ctx.caster;
  anchorPoint(ctx, eff.at, tmp);
  const z = w.create('zone', eff.id, c.team);
  z.owner = c.owner; z.ownerEid = c.id;
  z.x = tmp.x; z.y = tmp.y;
  z.radius = shapeReach(eff.shape);
  z.targetable = false;
  z.facing = Math.atan2(ctx.dy, ctx.dx);
  z.shape = shapeView(eff.shape);
  z.vfx = eff.present?.vfx;
  z.visibleMask = c.team >= 0 && c.team < 31 ? 1 << c.team : 0;
  const duration = ranked(eff.duration, ctx.rank);
  z.stateDuration = duration;
  const zd: ZoneData = {
    eff, ctx: { ...ctx, px: z.x, py: z.y, depth: ctx.depth + 1 }, shape: eff.shape, remaining: duration,
    delay: eff.delay, tickAcc: 0, follow: eff.follow ? anchorUnit(ctx, eff.at) : null, dirX: ctx.dx, dirY: ctx.dy,
    inside: new Set(), next: new Set(), active: eff.delay <= 0,
  };
  if (zd.active) zd.tickAcc = eff.interval;
  z.zone = zd;
  if (eff.blocks && eff.blocks !== 'none') w.blockingZones.push(z);
  const p = eff.present;
  w.emit({
    e: 'area', t: w.time, src: c.id, ability: ctx.source.id, x: z.x, y: z.y, shape: z.shape, delay: eff.delay,
    vfx: p?.vfx, sfx: p?.sfx, telegraph: p?.telegraph ?? (eff.delay > 0 ? 'everyone' : 'none'),
  });
  return z;
}

function removeZone(w: World, z: Entity): void {
  w.remove(z);
  const k = w.blockingZones.indexOf(z);
  if (k >= 0) w.blockingZones.splice(k, 1);
}

/** does an active blocking zone forbid `u` from standing at (x, y)? */
export function zoneBlocks(w: World, u: Entity, x: number, y: number): boolean {
  const bz = w.blockingZones;
  for (let i = 0; i < bz.length; i++) {
    const z = bz[i];
    const zd = z.zone;
    if (!zd || !zd.active || z.removed) continue;
    if (zd.eff.blocks === 'enemies' && w.relation(zd.ctx.caster, u) !== 2) continue;
    if (inShape(zd.shape, x, y, u.radius, z.x, z.y, zd.dirX, zd.dirY)) return true;
  }
  return false;
}

/** the 'zones' phase: scheduled tasks, then every zone */
export function zoneSystem(w: World): void {
  w.runDueTasks();
  const list = w.entities;
  const n = list.length;
  const dt = TICK_DT;
  for (let i = 0; i < n; i++) {
    const z = list[i];
    if (z.kind !== 'zone' || z.removed || !z.zone) continue;
    const zd = z.zone;
    if (zd.follow) {
      if (zd.follow.alive) { z.x = zd.follow.x; z.y = zd.follow.y; zd.ctx.px = z.x; zd.ctx.py = z.y; }
    }
    if (!zd.active) {
      zd.delay -= dt;
      if (zd.delay > 1e-9) continue;
      zd.active = true;
      zd.tickAcc = zd.eff.interval;
    }
    z.stateTime += dt;
    // membership + onEnter
    const inside = unitsInShape(w, zd.ctx.caster, zd.shape, z.x, z.y, zd.dirX, zd.dirY, zd.eff.filter);
    inside.sort((a, b) => a.id - b.id);
    const next = zd.next; next.clear();
    for (const u of inside) {
      next.add(u.id);
      if (!zd.inside.has(u.id) && zd.eff.onEnter) {
        onEffectHit(w, zd.ctx, u);
        runEffects(w, zd.eff.onEnter, { ...zd.ctx, hit: u });
      }
    }
    zd.next = zd.inside; zd.inside = next;
    // ticks
    zd.tickAcc += dt;
    if (zd.tickAcc + 1e-6 >= zd.eff.interval + dt) {
      zd.tickAcc -= zd.eff.interval;
      for (const u of inside) {
        if (!u.alive) continue;
        onEffectHit(w, zd.ctx, u);
        runEffects(w, zd.eff.onTick, { ...zd.ctx, hit: u });
      }
    }
    zd.remaining -= dt;
    if (zd.remaining <= 1e-9) {
      removeZone(w, z);
      if (zd.eff.onExpire) runEffects(w, zd.eff.onExpire, { ...zd.ctx, hit: null, ex: z.x, ey: z.y, hasEnd: true });
    }
  }
}
