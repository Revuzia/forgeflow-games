// VALE sim — movement: orders → goals, nav paths, steering with soft separation, dashes, blinks,
// displacements, and the per-tick action state for the view (CONTRACT §5.4).
//
// Goals: a move order walks to its point; attack/cast orders chase until in range (attack.ts and
// abilities.ts start the action once in range); taunt chases the taunter; fear walks away from
// its source. Units do not walk while winding up an attack, while casting (unless
// canMoveWhileCasting / channel.canMove), while rooted or hard-CC'd.
// Paths: straight line when line-of-walk holds (rechecked every few ticks), else A* + string
// pulling (nav.ts); recomputed when the goal moves > REPATH_DIST or progress stalls.
// Separation: overlapping mobile units push each other apart softly (half the overlap per tick,
// less when idle); structures are hard circles. Walls win: a step into a blocked cell slides
// along the free axis or stops. Blocking zones act like walls for the units they block.
//
// Dashes move along a straight line clipped to walls at start; `onPass` hits units within
// passWidth of the swept segment once each; `stopOnFirstHit` ends the dash at the first such unit;
// `onArrive` runs at the end (end = arrival point). Non-unstoppable dashes are cancelled by
// stun/root/airborne/sleep (no onArrive). Rooted units cannot start a non-unstoppable dash.
// Displacements (knockback/pull/toward_point/airborne_in_place) are dashes imposed on the target:
// they apply airborne for their duration (no tenacity), cancel the target's cast/dash/attack,
// stop at walls, and are ignored by unstoppable targets and structures.

import { TICK_DT } from '../contracts/sim.ts';
import type { ActionState } from '../contracts/sim.ts';
import { attackRange, attackable, inAttackRange } from './attack.ts';
import { castInRange, interruptCast } from './abilities.ts';
import { matchesFilter, onEffectHit, runEffects, withHit } from './effects.ts';
import {
  CC_FEAR, CC_HARD, CC_ROOT, CC_TAUNT, ORDER_ATTACK, ORDER_ATTACK_MOVE, ORDER_CAST, ORDER_MOVE, ORDER_NONE, ST_UNSTOPPABLE,
  type DashState, type EffOf, type EffectCtx, type Entity,
} from './entity.ts';
import { segPointDist2, segmentCircleT } from './math.ts';
import { applyStatus, canMove, statusFrom } from './status.ts';
import { computeStats } from './stats.ts';
import { noteMoved } from './triggers.ts';
import type { World } from './world.ts';
import { zoneBlocks } from './zones.ts';

/** goal drift (m) that forces a new path */
export const REPATH_DIST = 1;
/** ticks between straight-line re-validation of a direct route */
const DIRECT_RECHECK_TICKS = 10;
/** peak height (m) of airborne arcs */
const KNOCK_ARC = 1.2;
const near: Entity[] = [];
const tmp = { x: 0, y: 0 };

// ── orders ──────────────────────────────────────────────────────────────────────────────────────
export function issueMove(w: World, e: Entity, x: number, y: number, attackMove: boolean): void {
  const m = w.mapDef.size;
  x = Math.max(0, Math.min(m[0] - 1e-3, x)); y = Math.max(0, Math.min(m[1] - 1e-3, y));
  const cs = e.cast;
  if (cs) {
    const keep = cs.phase === 'windup' ? !!cs.def.canMoveWhileCasting : !!cs.def.channel?.canMove;
    if (!keep) interruptCast(w, e, false);
  }
  if (!attackMove) e.atkWindup = -1;
  e.order = attackMove ? ORDER_ATTACK_MOVE : ORDER_MOVE;
  e.orderX = x; e.orderY = y; e.orderTarget = -1; e.pendingSlot = -1;
  e.path.length = 0; e.pathGoalX = NaN;
}
export function issueAttack(w: World, e: Entity, t: Entity): void {
  if (t === e) return;
  if (e.atkTarget !== t.id) e.atkWindup = -1;
  e.order = ORDER_ATTACK; e.orderTarget = t.id; e.pendingSlot = -1;
  e.path.length = 0; e.pathGoalX = NaN;
}
export function issueStop(w: World, e: Entity): void {
  e.order = ORDER_NONE; e.orderTarget = -1; e.pendingSlot = -1;
  e.atkWindup = -1;
  e.path.length = 0; e.pathGoalX = NaN;
}

function setPos(w: World, e: Entity, x: number, y: number): void {
  e.x = x; e.y = y;
  w.hashDirty = true;
}

// ── dashes ──────────────────────────────────────────────────────────────────────────────────────
export function startDash(w: World, eff: EffOf<'dash'>, ctx: EffectCtx): void {
  const e = ctx.caster;
  if (!e.alive || e.static) return;
  if ((e.ccMask & CC_ROOT) !== 0 && !eff.unstoppable) return;
  const t = ctx.target ?? ctx.hit;
  let dx = ctx.dx, dy = ctx.dy, d = eff.distance;
  const unit = (ux: number, uy: number): number => {
    const l = Math.sqrt(ux * ux + uy * uy);
    if (l > 1e-6) { dx = ux / l; dy = uy / l; }
    return l;
  };
  switch (eff.mode) {
    case 'toPoint': { const l = unit(ctx.px - e.x, ctx.py - e.y); d = Math.min(eff.distance, l); break; }
    case 'toTarget': {
      if (t && t !== e) { const l = unit(t.x - e.x, t.y - e.y); d = Math.max(0, Math.min(eff.distance, l - t.radius - e.radius)); }
      else { const l = unit(ctx.px - e.x, ctx.py - e.y); d = Math.min(eff.distance, l); }
      break;
    }
    case 'direction': d = eff.distance; break;
    case 'away': {
      if (t && t !== e) unit(e.x - t.x, e.y - t.y); else { dx = -ctx.dx; dy = -ctx.dy; }
      d = eff.distance;
      break;
    }
    case 'behindTarget': {
      if (t && t !== e) {
        const l = unit(t.x - e.x, t.y - e.y);
        d = Math.min(eff.distance + t.radius * 2 + e.radius, l + t.radius + e.radius + 0.3);
      } else { const l = unit(ctx.px - e.x, ctx.py - e.y); d = Math.min(eff.distance, l); }
      break;
    }
  }
  w.nav.raycast(e.x, e.y, e.x + dx * d, e.y + dy * d, tmp);
  const toX = tmp.x, toY = tmp.y;
  const len = Math.sqrt((toX - e.x) * (toX - e.x) + (toY - e.y) * (toY - e.y));
  const dur = Math.max(TICK_DT, len / eff.speed);
  if (e.cast) interruptCast(w, e, false);
  e.atkWindup = -1;
  e.dash = {
    displace: false, fromX: e.x, fromY: e.y, toX, toY, t: 0, dur, eff, ctx,
    passed: eff.onPass || eff.stopOnFirstHit ? [] : null, unstoppable: !!eff.unstoppable, arc: 0,
  };
  e.actionSeq++;
  if (len > 1e-6) e.facing = Math.atan2(toY - e.y, toX - e.x);
  if (eff.unstoppable) applyStatus(w, e, e, 'unstoppable', dur + TICK_DT);
  e.path.length = 0; e.pathGoalX = NaN;
  w.emit({ e: 'dash', t: w.time, src: e.id, fromX: e.x, fromY: e.y, toX, toY, duration: dur, vfx: eff.present?.vfx });
}

export function interruptDash(w: World, e: Entity): void {
  if (!e.dash) return;
  e.dash = null; e.height = 0; e.vx = 0; e.vy = 0;
  w.hashDirty = true;
}

function finishDash(w: World, e: Entity, hit: Entity | null): void {
  const ds = e.dash!;
  e.dash = null; e.height = 0; e.vx = 0; e.vy = 0;
  w.hashDirty = true;
  if (ds.unstoppable) {
    for (let i = 0; i < e.statuses.length; i++) {
      const s = e.statuses[i];
      if (s.kind === 'unstoppable' && s.src === e.id) { s.remaining = 1e-9; }
    }
  }
  if (!ds.displace && ds.eff && ds.ctx && ds.eff.onArrive) {
    runEffects(w, ds.eff.onArrive, { ...ds.ctx, hit: hit ?? ds.ctx.hit, ex: e.x, ey: e.y, hasEnd: true, depth: ds.ctx.depth + 1 });
  }
}

function advanceDash(w: World, e: Entity): void {
  const ds = e.dash!;
  ds.t += TICK_DT;
  const f = Math.min(1, ds.t / ds.dur);
  const px = e.x, py = e.y;
  const nx = ds.fromX + (ds.toX - ds.fromX) * f, ny = ds.fromY + (ds.toY - ds.fromY) * f;
  if (!ds.displace && ds.eff && ds.ctx && ds.passed) {
    const eff = ds.eff;
    const width = eff.passWidth ?? e.radius;
    const mx = (px + nx) * 0.5, my = (py + ny) * 0.5;
    const half = Math.sqrt((nx - px) * (nx - px) + (ny - py) * (ny - py)) * 0.5;
    const n = w.query(mx, my, half + width, near);
    // resolve in path order
    const found: { t: number; u: Entity }[] = [];
    for (let i = 0; i < n; i++) {
      const u = near[i];
      if (u === e || ds.passed.includes(u.id)) continue;
      if (!matchesFilter(w, e, u, eff.passFilter)) continue;
      const rr = width + u.radius;
      if (segPointDist2(px, py, nx, ny, u.x, u.y) > rr * rr) continue;
      const th = segmentCircleT(px, py, nx, ny, u.x, u.y, rr);
      found.push({ t: th < 0 ? 0 : th, u });
    }
    found.sort((a, b) => a.t - b.t || a.u.id - b.u.id);
    for (const { t: th, u } of found) {
      ds.passed.push(u.id);
      if (eff.stopOnFirstHit) {
        // stop just short of the unit
        const sx = px + (nx - px) * th, sy = py + (ny - py) * th;
        setPos(w, e, sx, sy);
        onEffectHit(w, ds.ctx, u);
        if (eff.onPass) runEffects(w, eff.onPass, withHit(ds.ctx, u));
        if (e.dash === ds) finishDash(w, e, u);
        return;
      }
      onEffectHit(w, ds.ctx, u);
      if (eff.onPass) runEffects(w, eff.onPass, withHit(ds.ctx, u));
      if (e.dash !== ds) return; // an effect cancelled the dash
    }
  }
  setPos(w, e, nx, ny);
  e.vx = (nx - px) / TICK_DT; e.vy = (ny - py) / TICK_DT;
  e.height = ds.arc > 0 ? 4 * ds.arc * f * (1 - f) : 0;
  e.moved = true;
  if (f >= 1) finishDash(w, e, null);
}

export function doBlink(w: World, eff: EffOf<'blink'>, ctx: EffectCtx): void {
  const e = ctx.caster;
  if (!e.alive || e.static) return;
  let tx: number, ty: number;
  const t = ctx.target ?? ctx.hit;
  if (eff.to === 'behindTarget' && t && t !== e) {
    let dx = t.x - e.x, dy = t.y - e.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1e-6) { dx /= l; dy /= l; } else { dx = Math.cos(e.facing); dy = Math.sin(e.facing); }
    const off = t.radius + e.radius + 0.3;
    tx = t.x + dx * off; ty = t.y + dy * off;
  } else {
    const dx = ctx.px - e.x, dy = ctx.py - e.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    const d = Math.min(eff.distance, l);
    tx = l > 1e-6 ? e.x + (dx / l) * d : e.x; ty = l > 1e-6 ? e.y + (dy / l) * d : e.y;
  }
  if (!w.nav.walkable(tx, ty)) {
    if (!w.nav.nearestWalkable(tx, ty, tmp)) return;
    tx = tmp.x; ty = tmp.y;
  }
  const fx = e.x, fy = e.y;
  if (Math.abs(tx - fx) + Math.abs(ty - fy) > 1e-6) e.facing = Math.atan2(ty - fy, tx - fx);
  setPos(w, e, tx, ty);
  e.atkWindup = -1;
  e.path.length = 0; e.pathGoalX = NaN;
  w.emit({ e: 'blink', t: w.time, src: e.id, fromX: fx, fromY: fy, toX: tx, toY: ty });
}

export function displaceUnit(w: World, ctx: EffectCtx, t: Entity, eff: EffOf<'displace'>): void {
  if (!t.alive || t.static || (t.ccMask & ST_UNSTOPPABLE) !== 0) return;
  const src = ctx.caster;
  let dx = 0, dy = 0, d = 0;
  const unit = (ux: number, uy: number): number => {
    const l = Math.sqrt(ux * ux + uy * uy);
    if (l > 1e-6) { dx = ux / l; dy = uy / l; } else { dx = ctx.dx; dy = ctx.dy; }
    return l;
  };
  switch (eff.mode) {
    case 'knockback': if (t === src) { dx = -ctx.dx; dy = -ctx.dy; } else unit(t.x - src.x, t.y - src.y); d = eff.distance; break;
    case 'pull': { const l = unit(src.x - t.x, src.y - t.y); d = Math.max(0, Math.min(eff.distance, l - src.radius - t.radius)); break; }
    case 'toward_point': { const l = unit(ctx.px - t.x, ctx.py - t.y); d = Math.min(eff.distance, l); break; }
    case 'airborne_in_place': d = 0; break;
  }
  w.nav.raycast(t.x, t.y, t.x + dx * d, t.y + dy * d, tmp);
  // airborne first: it would cancel a non-displacement dash; the displacement replaces any dash
  applyStatus(w, src, t, 'airborne', eff.duration, { depth: ctx.depth });
  interruptCast(w, t, true);
  t.atkWindup = -1;
  t.dash = {
    displace: true, fromX: t.x, fromY: t.y, toX: tmp.x, toY: tmp.y, t: 0, dur: Math.max(TICK_DT, eff.duration),
    eff: null, ctx: null, passed: null, unstoppable: false, arc: eff.mode === 'pull' ? KNOCK_ARC * 0.3 : KNOCK_ARC,
  } satisfies DashState;
  t.actionSeq++;
  t.path.length = 0; t.pathGoalX = NaN;
  w.emit({ e: 'dash', t: w.time, src: t.id, fromX: t.x, fromY: t.y, toX: tmp.x, toY: tmp.y, duration: eff.duration });
}

// ── walking ─────────────────────────────────────────────────────────────────────────────────────
/** where does `e` want to walk this tick? writes tmp; returns false for "stay" */
function goalOf(w: World, e: Entity): boolean {
  if ((e.ccMask & CC_FEAR) !== 0) {
    const s = statusFrom(e, 'fear');
    const src = s ? w.entity(s.src) : undefined;
    let dx = Math.cos(e.facing), dy = Math.sin(e.facing);
    if (src) { const ux = e.x - src.x, uy = e.y - src.y; const l = Math.sqrt(ux * ux + uy * uy); if (l > 1e-6) { dx = ux / l; dy = uy / l; } }
    tmp.x = e.x + dx * 3; tmp.y = e.y + dy * 3;
    return true;
  }
  if ((e.ccMask & CC_TAUNT) !== 0) {
    const s = statusFrom(e, 'taunt');
    const t = s ? w.live(s.src) : null;
    if (t) { if (inAttackRange(e, t)) return false; tmp.x = t.x; tmp.y = t.y; return true; }
  }
  switch (e.order) {
    case ORDER_MOVE: tmp.x = e.orderX; tmp.y = e.orderY; return true;
    case ORDER_ATTACK_MOVE: {
      const cur = w.live(e.atkTarget);
      if (cur && attackable(w, e, cur) && inAttackRange(e, cur)) return false;
      tmp.x = e.orderX; tmp.y = e.orderY; return true;
    }
    case ORDER_ATTACK: {
      const t = w.live(e.orderTarget);
      if (!t || !attackable(w, e, t)) { e.order = ORDER_NONE; return false; }
      if (inAttackRange(e, t)) return false;
      tmp.x = t.x; tmp.y = t.y; return true;
    }
    case ORDER_CAST: {
      const s = e.slots[e.pendingSlot];
      const t = e.pendingTarget >= 0 ? w.live(e.pendingTarget) : null;
      if (!s || (e.pendingTarget >= 0 && !t)) { e.order = ORDER_NONE; return false; }
      const px = t ? t.x : e.pendingX, py = t ? t.y : e.pendingY;
      if (castInRange(e, s.def, t, px, py)) return false;
      tmp.x = px; tmp.y = py; return true;
    }
    default: return false;
  }
}

function separate(w: World, e: Entity, x: number, y: number, factor: number): void {
  // pushes (x, y) out of overlapping units; result in tmp
  const n = w.hash.query(x, y, e.radius, near);
  let ox = 0, oy = 0;
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (o === e || !o.alive || o.dash || o.kind === 'ward' || o.kind === 'pickup') continue;
    let dx = x - o.x, dy = y - o.y;
    const rr = e.radius + o.radius;
    let d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    if (d2 < 1e-10) { dx = (e.id < o.id ? -1 : 1) * 1e-3; dy = 0; d2 = 1e-6; }
    const d = Math.sqrt(d2);
    const overlap = rr - d;
    const k = o.static ? 1 : factor;
    ox += (dx / d) * overlap * k; oy += (dy / d) * overlap * k;
  }
  tmp.x = x + ox; tmp.y = y + oy;
}

function stepToward(w: World, e: Entity, gx: number, gy: number): void {
  const speed = e.stats.moveSpeed;
  let budget = speed * TICK_DT;
  if (budget <= 0) return;
  const nav = w.nav;
  const r = Math.min(e.radius, nav.cell * 0.9);
  const goalMoved = !(Math.abs(gx - e.pathGoalX) + Math.abs(gy - e.pathGoalY) <= REPATH_DIST);
  if (goalMoved || (e.path.length === 0 && --e.pathCheck <= 0)) {
    e.pathGoalX = gx; e.pathGoalY = gy;
    e.pathIdx = 0;
    if (nav.lineOfWalk(e.x, e.y, gx, gy, r)) { e.path.length = 0; e.pathCheck = DIRECT_RECHECK_TICKS; }
    else if (!nav.findPath(e.x, e.y, gx, gy, e.path, r)) { e.path.length = 0; e.pathCheck = DIRECT_RECHECK_TICKS; return; }
  }
  let x = e.x, y = e.y;
  // walk the waypoint list within this tick's budget
  for (let guard = 0; guard < 4 && budget > 1e-9; guard++) {
    let wx: number, wy: number;
    const usingPath = e.path.length > 0 && e.pathIdx * 2 < e.path.length;
    if (usingPath) { wx = e.path[e.pathIdx * 2]; wy = e.path[e.pathIdx * 2 + 1]; }
    else { wx = gx; wy = gy; }
    const dx = wx - x, dy = wy - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      x = wx; y = wy; budget -= d;
      if (usingPath) { e.pathIdx++; if (e.pathIdx * 2 >= e.path.length) { e.path.length = 0; } }
      else break;
    } else { x += (dx / d) * budget; y += (dy / d) * budget; budget = 0; }
  }
  // soft separation, then walls, then blocking zones
  separate(w, e, x, y, 0.5);
  let nx = tmp.x, ny = tmp.y;
  if (!nav.walkable(nx, ny)) {
    if (nav.walkable(nx, e.y)) ny = e.y;
    else if (nav.walkable(e.x, ny)) nx = e.x;
    else if (nav.walkable(x, y)) { nx = x; ny = y; }
    else { nx = e.x; ny = e.y; e.pathGoalX = NaN; }
  }
  if (w.blockingZones.length > 0 && zoneBlocks(w, e, nx, ny) && !zoneBlocks(w, e, e.x, e.y)) { nx = e.x; ny = e.y; }
  const mdx = nx - e.x, mdy = ny - e.y;
  const moved = Math.sqrt(mdx * mdx + mdy * mdy);
  if (moved < 1e-6) { e.pathGoalX = NaN; return; } // stuck: repath next tick
  e.facing = Math.atan2(mdy, mdx);
  e.vx = mdx / TICK_DT; e.vy = mdy / TICK_DT;
  setPos(w, e, nx, ny);
  e.moved = true;
  e.movedDist += moved;
  noteMoved(w, e, moved);
}

/** the 'movement' phase */
export function movementSystem(w: World): void {
  w.ensureHash();
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e.moved = false;
    if (!e.alive || e.static || e.kind === 'projectile' || e.kind === 'zone') continue;
    if (e.dash) { advanceDash(w, e); continue; }
    e.vx = 0; e.vy = 0;
    if (e.statsDirty) computeStats(w, e);
    let wants = false;
    if (canMove(e) && e.atkWindup < 0) {
      const cs = e.cast;
      const free = !cs || (cs.phase === 'windup' ? !!cs.def.canMoveWhileCasting : !!cs.def.channel?.canMove);
      if (free) wants = goalOf(w, e);
    }
    if (wants) {
      const gx = tmp.x, gy = tmp.y;
      if (e.order === ORDER_MOVE || e.order === ORDER_ATTACK_MOVE) {
        const dx = gx - e.x, dy = gy - e.y;
        if (dx * dx + dy * dy < 0.0025) { e.order = ORDER_NONE; e.path.length = 0; continue; }
      }
      stepToward(w, e, gx, gy);
      if ((e.order === ORDER_MOVE || e.order === ORDER_ATTACK_MOVE) && Math.abs(e.x - e.orderX) + Math.abs(e.y - e.orderY) < 0.05) {
        e.order = ORDER_NONE; e.path.length = 0;
      }
    } else if ((e.ccMask & CC_HARD) === 0) {
      // idle units yield softly to overlapping neighbours
      separate(w, e, e.x, e.y, 0.2);
      const dx = tmp.x - e.x, dy = tmp.y - e.y;
      if (dx * dx + dy * dy > 1e-6 && w.nav.walkable(tmp.x, tmp.y) && !(w.blockingZones.length > 0 && zoneBlocks(w, e, tmp.x, tmp.y))) setPos(w, e, tmp.x, tmp.y);
    }
  }
  w.hashDirty = true;
}

// ── view state ──────────────────────────────────────────────────────────────────────────────────
function castAnim(e: Entity): string {
  const cs = e.cast!;
  if (cs.phase === 'channel') return 'channel';
  const a = cs.def.present?.anim;
  if (a) return a;
  const s = cs.slot ? cs.slot.slot : 'a1';
  return s === 'a1' || s === 'a2' || s === 'a3' || s === 'ult' ? `cast_${s}` : 'cast_a1';
}

/** derive state / anim / stateTime / stateDuration for every unit (end of the movement phase) */
export function finalizeStates(w: World): void {
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.kind === 'projectile' || e.kind === 'zone') continue;
    let st: ActionState, anim: string, dur = 0;
    if (!e.alive) { st = 'dead'; anim = 'death'; }
    else if (e.stateOverride) { st = e.stateOverride; anim = e.animOverride || st; dur = e.stateOverrideDuration; }
    else if (e.dash) { st = 'dash'; anim = e.dash.displace ? 'stunned' : (e.dash.eff?.present?.anim ?? 'dash'); dur = e.dash.dur; }
    else if (e.cast) { st = e.cast.phase === 'channel' ? 'channel' : 'cast'; anim = castAnim(e); dur = e.cast.dur; }
    else if ((e.ccMask & CC_HARD) !== 0) { st = 'stunned'; anim = 'stunned'; }
    else if (e.moved) { st = 'move'; anim = 'run'; }
    else if (e.atkWindup >= 0 || e.atkAnim > 0) {
      st = 'attack'; anim = e.atkCrit ? 'crit' : e.atkAlt ? 'attack2' : 'attack1';
      dur = 1 / Math.max(0.05, e.stats.attackSpeed);
    } else { st = 'idle'; anim = 'idle'; }
    if (st !== e.state || anim !== e.anim || e.actionSeq !== e.stateSeq) {
      e.state = st; e.anim = anim; e.stateTime = 0; e.stateSeq = e.actionSeq;
    } else e.stateTime += TICK_DT;
    e.stateDuration = dur;
  }
}

/** attackRange re-exported for unit AI convenience */
export { attackRange };
