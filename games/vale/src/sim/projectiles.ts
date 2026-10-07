// VALE sim — projectiles (DSL `projectile` op and ranged basic attacks).
//
// Projectiles are entities (kind 'projectile', def = ability id) so the renderer draws them from
// the view like anything else; `vx/vy` carry their velocity for interpolation.
//
// Skillshots move `speed × dt` per tick and test the swept segment against unit circles inflated
// by width/2, so nothing tunnels at high speed. Hits along one step resolve in path order (then
// id). `pierce` = how many units it passes through: 0 stops at the first hit. `stopAtWalls` ends
// it at the last point before a map wall (structures are not walls here; with `structures: true`
// in its filter it hits them like units). `returns`: at max range it flies back to the caster (it may hit
// the same units again on the way back) and ends on reaching them. `toward: 'point'` caps the
// flight at the aimed point. `spreadDeg` + `count` fan copies evenly across the spread.
// Homing projectiles (`homing` with toward 'target', and every ranged basic attack) chase their
// target and hit only it; if it dies or turns untargetable they fly to its last position and end
// there without a hit.
// `onHit` runs with hit = the unit and end = the contact point; `onEnd` with end = the final
// position (also after a stopping hit).

import type { EffectT } from '../contracts/catalog.ts';
import { TICK_DT } from '../contracts/sim.ts';
import { applyAttackHit } from './attack.ts';
import { anchorPoint, matchesFilter, onEffectHit, runEffects } from './effects.ts';
import type { EffOf, EffectCtx, Entity, ProjData } from './entity.ts';
import { DEG, segmentCircleT } from './math.ts';
import type { World } from './world.ts';

const scratch: Entity[] = [];
const hitT: number[] = [];
const hitE: Entity[] = [];
const tmp = { x: 0, y: 0 };

function newProjectile(w: World, src: Entity, def: string, x: number, y: number, width: number, vfx: string | undefined): Entity {
  const p = w.create('projectile', def, src.team);
  p.owner = src.owner;
  p.ownerEid = src.id;
  p.x = x; p.y = y;
  p.radius = width * 0.5;
  p.targetable = false;
  p.vfx = vfx;
  p.shape = { kind: 'circle', radius: width * 0.5 };
  p.visibleMask = src.team >= 0 && src.team < 31 ? 1 << src.team : 0;
  p.height = 1;
  return p;
}

export function spawnProjectiles(w: World, eff: EffOf<'projectile'>, ctx: EffectCtx): void {
  const c = ctx.caster;
  anchorPoint(ctx, eff.from, tmp);
  const ox = tmp.x, oy = tmp.y;
  const target = eff.toward === 'target' ? (ctx.target ?? ctx.hit) : null;
  let bx = ctx.dx, by = ctx.dy;
  let maxDist = eff.range;
  if (eff.toward === 'target' && target) { bx = target.x - ox; by = target.y - oy; }
  else if (eff.toward === 'point') {
    bx = ctx.px - ox; by = ctx.py - oy;
    maxDist = Math.min(eff.range, Math.sqrt(bx * bx + by * by));
  }
  let l = Math.sqrt(bx * bx + by * by);
  if (l < 1e-6) { bx = ctx.dx; by = ctx.dy; l = 1; }
  bx /= l; by /= l;
  const homing = !!eff.homing && target !== null;
  const count = Math.max(1, eff.count ?? 1);
  const spread = (eff.spreadDeg ?? 0) * DEG;
  const baseA = Math.atan2(by, bx);
  for (let i = 0; i < count; i++) {
    const a = count > 1 ? baseA - spread / 2 + (spread * i) / (count - 1) : baseA;
    const dx = Math.cos(a), dy = Math.sin(a);
    const p = newProjectile(w, c, ctx.source.id, ox, oy, eff.width, eff.present?.vfx);
    p.facing = a;
    p.vx = dx * eff.speed; p.vy = dy * eff.speed;
    const pd: ProjData = {
      attack: false, eff, ctx, src: c, target: homing && target ? target.id : -1, targetLife: target ? target.lifeSeq : 0, homing,
      speed: eff.speed, range: homing ? eff.range : Math.max(0, maxDist), traveled: 0, width: eff.width,
      pierceLeft: eff.pierce, hits: [], returning: false, stopAtWalls: !!eff.stopAtWalls,
      dirX: dx, dirY: dy, tx: target ? target.x : ox + dx * maxDist, ty: target ? target.y : oy + dy * maxDist,
      crit: false, dtype: 'phys', empower: null, empowerSrc: '',
    };
    p.proj = pd;
    w.emit({ e: 'projectile', t: w.time, id: p.id, src: c.id, ability: ctx.source.id, vfx: eff.present?.vfx });
  }
}

/** ranged basic attack: a homing projectile that applies the attack on arrival */
export function spawnAttackProjectile(w: World, src: Entity, target: Entity, crit: boolean, dtype: 'phys' | 'magic' | 'true',
  empower: readonly EffectT[] | null, empCtx: EffectCtx | null): void {
  const ad = src.attackDef!;
  const p = newProjectile(w, src, src.def, src.x, src.y, 0.3, ad.present?.vfx);
  const dx = target.x - src.x, dy = target.y - src.y;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = ad.projectileSpeed ?? 20;
  p.facing = Math.atan2(dy, dx);
  p.vx = (dx / l) * speed; p.vy = (dy / l) * speed;
  p.proj = {
    attack: true, eff: null, ctx: empCtx, src, target: target.id, targetLife: target.lifeSeq, homing: true, speed, range: Infinity, traveled: 0, width: 0.3,
    pierceLeft: 0, hits: [], returning: false, stopAtWalls: false, dirX: dx / l, dirY: dy / l, tx: target.x, ty: target.y,
    crit, dtype, empower: empower ? empower.slice() : null, empowerSrc: '',
  };
  w.emit({ e: 'projectile', t: w.time, id: p.id, src: src.id, ability: 'attack', vfx: ad.present?.vfx });
}

function endProjectile(w: World, p: Entity, pd: ProjData): void {
  p.vx = 0; p.vy = 0;
  w.remove(p);
  if (pd.eff && pd.ctx && pd.eff.onEnd) {
    runEffects(w, pd.eff.onEnd, { ...pd.ctx, ex: p.x, ey: p.y, hasEnd: true, depth: pd.ctx.depth + 1 });
  }
}

function hitUnit(w: World, p: Entity, pd: ProjData, u: Entity): void {
  pd.hits.push(u.id);
  if (pd.attack) { applyAttackHit(w, pd.src, u, pd.crit, pd.dtype, pd.empower, pd.ctx); return; }
  const ctx = pd.ctx!;
  onEffectHit(w, ctx, u);
  runEffects(w, pd.eff!.onHit, { ...ctx, hit: u, ex: p.x, ey: p.y, hasEnd: true, depth: ctx.depth + 1 });
}

/** the 'projectiles' phase */
export function projectileSystem(w: World): void {
  const list = w.entities;
  const n = list.length; // projectiles spawned by hits this tick start moving next tick
  const dt = TICK_DT;
  for (let i = 0; i < n; i++) {
    const p = list[i];
    if (p.kind !== 'projectile' || p.removed || !p.proj) continue;
    const pd = p.proj;
    const step = pd.speed * dt;

    if (pd.homing) {
      let t = w.live(pd.target);
      // died (and respawned) mid-flight, or turned untargetable (untargetable units cannot be hit):
      // the shot is lost and flies on to the last known spot
      if (t && (t.lifeSeq !== pd.targetLife || (!t.targetable && t !== pd.src))) { t = null; pd.target = -1; }
      if (t) { pd.tx = t.x; pd.ty = t.y; }
      const dx = pd.tx - p.x, dy = pd.ty - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = (t ? t.radius : 0) + pd.width * 0.5;
      if (d - reach <= step) {
        const adv = Math.max(0, d - reach);
        if (d > 1e-6) { p.x += (dx / d) * adv; p.y += (dy / d) * adv; }
        if (t) hitUnit(w, p, pd, t);
        endProjectile(w, p, pd);
        continue;
      }
      pd.dirX = dx / d; pd.dirY = dy / d;
      p.x += pd.dirX * step; p.y += pd.dirY * step;
      p.vx = pd.dirX * pd.speed; p.vy = pd.dirY * pd.speed;
      p.facing = Math.atan2(pd.dirY, pd.dirX);
      pd.traveled += step;
      if (pd.traveled >= pd.range) endProjectile(w, p, pd);
      continue;
    }

    // skillshot
    let remaining: number;
    if (pd.returning) {
      const c = pd.src;
      if (!c.alive) { endProjectile(w, p, pd); continue; }
      const dx = c.x - p.x, dy = c.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      remaining = Math.max(0, d - c.radius);
      if (d > 1e-6) { pd.dirX = dx / d; pd.dirY = dy / d; }
    } else remaining = pd.range - pd.traveled;
    const adv = Math.min(step, Math.max(0, remaining));
    const sx = p.x, sy = p.y;
    let ex = sx + pd.dirX * adv, ey = sy + pd.dirY * adv;
    let wallStop = false;
    // map walls only: a structure's path-clearance disc is not a wall (filters decide whether
    // a projectile hits structures)
    if (pd.stopAtWalls && !w.nav.wallFree(ex, ey)) {
      w.nav.raycast(sx, sy, ex, ey, tmp, true);
      ex = tmp.x; ey = tmp.y; wallStop = true;
    }

    // swept collision
    const eff = pd.eff!;
    const half = pd.width * 0.5;
    const mx = (sx + ex) * 0.5, my = (sy + ey) * 0.5;
    const segHalf = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy)) * 0.5;
    const cn = w.query(mx, my, segHalf + half, scratch);
    hitT.length = 0; hitE.length = 0;
    for (let k = 0; k < cn; k++) {
      const u = scratch[k];
      if (pd.hits.includes(u.id)) continue;
      if (!matchesFilter(w, pd.src, u, eff.filter)) continue;
      const th = segmentCircleT(sx, sy, ex, ey, u.x, u.y, u.radius + half);
      if (th < 0) continue;
      // insertion by (t, id)
      let j = hitT.length;
      hitT.push(th); hitE.push(u);
      while (j > 0 && (hitT[j - 1] > th || (hitT[j - 1] === th && hitE[j - 1].id > u.id))) {
        hitT[j] = hitT[j - 1]; hitE[j] = hitE[j - 1]; j--;
      }
      hitT[j] = th; hitE[j] = u;
    }
    let stopped = false;
    if (hitE.length > 0) {
      const ts = hitT.slice(), us = hitE.slice(); // effects below may re-enter queries
      for (let k = 0; k < us.length; k++) {
        p.x = sx + (ex - sx) * ts[k]; p.y = sy + (ey - sy) * ts[k];
        hitUnit(w, p, pd, us[k]);
        if (pd.pierceLeft <= 0) { stopped = true; break; }
        pd.pierceLeft--;
      }
    }
    if (stopped) { endProjectile(w, p, pd); continue; }
    p.x = ex; p.y = ey;
    p.vx = pd.dirX * pd.speed; p.vy = pd.dirY * pd.speed;
    p.facing = Math.atan2(pd.dirY, pd.dirX);
    pd.traveled += adv;
    if (wallStop) { endProjectile(w, p, pd); continue; }
    if (adv >= remaining - 1e-9) {
      if (eff.returns && !pd.returning) { pd.returning = true; pd.hits.length = 0; }
      else endProjectile(w, p, pd);
    }
  }
}
