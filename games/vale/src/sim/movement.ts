// VALE sim — movement: orders → goals, nav paths, steering with soft separation, dashes, blinks,
// displacements, and the per-tick action state for the view (CONTRACT §5.4).
//
// Goals: a move order walks to its point; attack/cast orders chase until in range (attack.ts and
// abilities.ts start the action once in range); taunt chases the taunter; fear walks away from
// its source. An attack-move walks to its point and stops for the enemy it attacks; one with a
// picked enemy (prefer) chases that enemy first, past nearer enemies, while it stays attackable.
// A move goal is snapped once, when issued, to where the order can finish (nav.snapGoal, ruling 36: a
// click into a wall, a structure or the border ends at the open point nearest the click that this
// walker's body reaches without walking away from the click, else where its straight walk toward the
// click stops; a pocket the walker cannot reach at the nearest point it can). Arrival: within 5 cm of the
// point, or ARRIVE_STALL_TICKS of direct approach without real progress near it (a crowd
// standing on the spot), or ARRIVE_GIVE_UP_TICKS of it anywhere (truly stuck): the order ends
// instead of shoving or sliding in place forever. Units do not walk while winding up an attack, while casting (unless
// canMoveWhileCasting / channel.canMove), while rooted or hard-CC'd. A move order cancels an
// attack windup and a channel (unless channel.canMove) but never a cast windup: the cast
// resolves and the walk starts after it.
// Paths: straight line when line-of-walk holds (rechecked every few ticks), else A* + string
// pulling (nav.ts); recomputed when the goal moves > REPATH_DIST or progress stalls. While
// walking, waypoints that are already in line of walk are skipped, and a walker that makes no
// progress for NO_PROGRESS_TICKS (jostled in a crowd, a body parked on a corner node) treats a
// near waypoint as reached or recomputes its route.
// Steering (fighters, rulings 35/36): standing, slower or oncoming bodies on the line are passed along
// their tangents (steerRound). Progress watchdog (fighters, steering included): a ~1 s window that
// gains under 30 % of a full-speed walk off the route left and covers under 60 % of one of ground
// (steering in place, inching) re-plans and walks the route without
// steering for a window; a second one in a row ends a move to a point (no steering in place).
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
import { attackable, inAttackRange } from './attack.ts';
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
import { datan2, dcos, dsin } from './dmath.ts';
import { collectDiscs, discsClear, laneDiscs, laneLen, planLane, RASTER_SLACK } from './bodypath.ts';

/** goal drift (m) that forces a new path */
export const REPATH_DIST = 1;
/** ticks between straight-line re-validation of a direct route */
const DIRECT_RECHECK_TICKS = 10;
/** ticks between runtime waypoint skips (line-of-walk to the waypoint after the current one) */
const SKIP_CHECK_TICKS = 5;
/** ticks of walking without progress before the walker gives up on its waypoint / route */
const NO_PROGRESS_TICKS = 15;
/** a blocked waypoint closer than this (m) is treated as reached */
const WAYPOINT_GIVE_UP = 2;
/** ticks of direct approach at under ARRIVE_PROGRESS of full speed before a walker near its point (within its
 *  radius + ARRIVE_NEAR) counts as arrived */
const ARRIVE_STALL_TICKS = 10;
/** ticks of direct approach pinned in place (under PINNED_PROGRESS of full speed: not even shoving through a
 *  crowd) before a walker anywhere gives up on its point (nothing left to walk around: the path is spent) */
const ARRIVE_GIVE_UP_TICKS = 60;
const PINNED_PROGRESS = 0.03;
/** a walking fighter looks this far (m) ahead for bodies in its way (sim/bodypath.ts inTheWay) and plans a lane round
 *  them (ruling 37) */
const LANE_LOOK = 3;
/** a lane ends at most this far (m) along the route leg (the walk resumes the route there) */
const LANE_REACH = 10;
/** ticks between checks that the lane ahead is still clear (a body stepped into it: re-plan) */
const LANE_RECHECK = 5;
/** how far (m) ahead along the lane the check looks */
const LANE_AHEAD = 4;
/** ticks before a failed plan is retried (walk straight and shove meanwhile) */
const LANE_RETRY = 10;
/** a lane longer than LANE_DETOUR × the straight line + LANE_DETOUR_M, or leading more than LANE_AWAY m further from its
 *  end than the walker starts, is not taken */
const LANE_DETOUR = 1.5;
const LANE_DETOUR_M = 1.5;
const LANE_AWAY = 0.5;
/** progress watchdog window (ticks, ~1 s) and the share of a full-speed walk it must gain off the route left */
const WATCH_TICKS = 30;
const WATCH_PROGRESS = 0.3;
/** … unless it covered at least this share of a full-speed walk of ground (walking round a wave, not stuck) */
const WATCH_MOVED = 0.6;
/** … or that ended this much (m) further from its point than it started (carried off, however far it moved) */
const WATCH_LOST = 0.5;
/** no-progress windows in a row after which a move to a point ends even though lanes keep being found */
const WATCH_MAX = 4;
const ARRIVE_NEAR = 1;
const ARRIVE_PROGRESS = 0.3;
/** peak height (m) of airborne arcs */
const KNOCK_ARC = 1.2;
const near: Entity[] = [];
const passT: number[] = [];
const passU: Entity[] = [];
const tmp = { x: 0, y: 0 };

// ── orders ──────────────────────────────────────────────────────────────────────────────────────
export function issueMove(w: World, e: Entity, x: number, y: number, attackMove: boolean, prefer = -1): void {
  const m = w.mapDef.size;
  x = Math.max(0, Math.min(m[0] - 1e-3, x)); y = Math.max(0, Math.min(m[1] - 1e-3, y));
  e.orderReqX = x; e.orderReqY = y;
  // the goal the order can actually finish at (never a point inside a wall the walker would slide against)
  if (w.nav.snapGoal(e.x, e.y, x, y, tmp, e.radius)) { x = tmp.x; y = tmp.y; }
  // a windup always finishes (the walk starts after release); a channel ends unless it allows moving
  const cs = e.cast;
  if (cs && cs.phase === 'channel' && !cs.def.channel?.canMove) interruptCast(w, e, false);
  if (!attackMove) e.atkWindup = -1;
  e.order = attackMove ? ORDER_ATTACK_MOVE : ORDER_MOVE;
  e.orderX = x; e.orderY = y; e.orderTarget = attackMove ? prefer : -1; e.pendingSlot = -1;
  e.path.length = 0; e.pathGoalX = NaN;
  e.arriveStall = 0; e.arrivePinned = 0;
  resetWatch(e);
}
export function issueAttack(w: World, e: Entity, t: Entity): void {
  if (t === e) return;
  if (e.atkTarget !== t.id) e.atkWindup = -1;
  e.order = ORDER_ATTACK; e.orderTarget = t.id; e.pendingSlot = -1;
  e.path.length = 0; e.pathGoalX = NaN;
  resetWatch(e);
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
    passed: eff.onPass || eff.stopOnFirstHit ? [] : null, unstoppable: !!eff.unstoppable, arc: selfDashArc(eff),
  };
  e.actionSeq++;
  if (len > 1e-6) e.facing = datan2(toY - e.y, toX - e.x);
  if (eff.unstoppable) applyStatus(w, e, e, 'unstoppable', dur + TICK_DT, { source: ctx.source.id });
  e.path.length = 0; e.pathGoalX = NaN;
  w.emit({ e: 'dash', t: w.time, src: e.id, fromX: e.x, fromY: e.y, toX, toY, duration: dur, vfx: eff.present?.vfx });
}

/** a self-dash's airborne arc peak (m): the effect's optional `arc` (a leap, e.g. a slam ult whose clip already
 *  lifts the hips; marund-M2), clamped to [0, KNOCK_ARC]; 0 = a ground dash. Presentation only: e.height drives
 *  the drawn root, never hits or pathing; the cast shadow stays on the floor. */
function selfDashArc(eff: EffOf<'dash'>): number {
  const a = (eff as { arc?: unknown }).arc;
  return typeof a === 'number' && a > 0 ? Math.min(a, KNOCK_ARC) : 0;
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
    // resolve in path order (t, then id); scratch arrays, copied only when something was passed
    passT.length = 0; passU.length = 0;
    for (let i = 0; i < n; i++) {
      const u = near[i];
      if (u === e || ds.passed.includes(u.id)) continue;
      if (!matchesFilter(w, e, u, eff.passFilter)) continue;
      const rr = width + u.radius;
      if (segPointDist2(px, py, nx, ny, u.x, u.y) > rr * rr) continue;
      const th0 = segmentCircleT(px, py, nx, ny, u.x, u.y, rr);
      const th = th0 < 0 ? 0 : th0;
      let j = passT.length;
      passT.push(th); passU.push(u);
      while (j > 0 && (passT[j - 1] > th || (passT[j - 1] === th && passU[j - 1].id > u.id))) { passT[j] = passT[j - 1]; passU[j] = passU[j - 1]; j--; }
      passT[j] = th; passU[j] = u;
    }
    const ts = passT.length > 0 ? passT.slice() : passT, us = passU.length > 0 ? passU.slice() : passU; // effects below may re-enter
    for (let k = 0; k < us.length; k++) {
      const th = ts[k], u = us[k];
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
    if (l > 1e-6) { dx /= l; dy /= l; } else { dx = dcos(e.facing); dy = dsin(e.facing); }
    const off = t.radius + e.radius + 0.3;
    tx = t.x + dx * off; ty = t.y + dy * off;
  } else {
    const dx = ctx.px - e.x, dy = ctx.py - e.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    const d = Math.min(eff.distance, l);
    tx = l > 1e-6 ? e.x + (dx / l) * d : e.x; ty = l > 1e-6 ? e.y + (dy / l) * d : e.y;
  }
  if (!w.nav.walkable(tx, ty)) {
    // nearest open spot; a tie goes to the caster's side of the wall
    if (!w.nav.nearestWalkable(tx, ty, tmp, 64, e.x, e.y)) return;
    tx = tmp.x; ty = tmp.y;
  }
  const fx = e.x, fy = e.y;
  if (Math.abs(tx - fx) + Math.abs(ty - fy) > 1e-6) e.facing = datan2(ty - fy, tx - fx);
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
  applyStatus(w, src, t, 'airborne', eff.duration, { depth: ctx.depth, source: ctx.source.id });
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
    let dx = dcos(e.facing), dy = dsin(e.facing);
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
      // a picked enemy is chased first (attack.ts desiredAttackTarget drops it once it is lost)
      const picked = e.orderTarget >= 0 ? w.live(e.orderTarget) : null;
      if (picked && attackable(w, e, picked)) {
        if (inAttackRange(e, picked)) return false;
        tmp.x = picked.x; tmp.y = picked.y; return true;
      }
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

/** route length left from (x, y): along the lane (if any), to the current waypoint and along the rest of the path, else
 *  straight to the goal */
function routeLeft(e: Entity, x: number, y: number, gx: number, gy: number): number {
  let l = 0;
  if (e.lane.length > 0 && e.laneIdx * 2 < e.lane.length) {
    l = laneLen(x, y, e.lane, e.laneIdx * 2);
    x = e.lane[e.lane.length - 2]; y = e.lane[e.lane.length - 1];
  }
  if (e.path.length === 0 || e.pathIdx * 2 >= e.path.length) return l + Math.sqrt((gx - x) * (gx - x) + (gy - y) * (gy - y));
  let px = x, py = y;
  for (let i = e.pathIdx * 2; i + 1 < e.path.length; i += 2) {
    const qx = e.path[i], qy = e.path[i + 1];
    l += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
    px = qx; py = qy;
  }
  return l;
}

/** reset the progress watchdog (a new order, or not walking) */
export function resetWatch(e: Entity): void { e.watchTicks = 0; e.watchStage = 0; e.laneAll = false; e.lanePlanned = false; clearLane(e); e.laneCheck = 0; }
function clearLane(e: Entity): void { e.lane.length = 0; e.laneIdx = 0; e.steerSide = 0; }
const onLane = (e: Entity): boolean => e.lane.length > 0 && e.laneIdx * 2 < e.lane.length;

/**
 * Body lanes for a walking fighter (ruling 37, sim/bodypath.ts): when bodies in its way (standing or coming at it; not
 * allies walking with it, not the unit it is going for, not a crowd on its own point) block its line within LANE_LOOK m,
 * it plans a lane round them on a fine grid, out to LANE_REACH m along its route leg, and walks it: one side, committed,
 * the least detour. The lane ahead is re-checked every LANE_RECHECK ticks: a body stepped into it re-plans from where
 * the walker stands; a straight line that cleared drops the lane. No lane (boxed in): walk straight and shove, retried
 * after LANE_RETRY ticks. steerSide reports the side the lane passes on (+1 right, −1 left).
 */
function updateLane(w: World, e: Entity, aimX: number, aimY: number, gx: number, gy: number, r: number): void {
  const aD = Math.sqrt((aimX - e.x) * (aimX - e.x) + (aimY - e.y) * (aimY - e.y));
  if (aD < 1e-6) { clearLane(e); return; }
  const ux = (aimX - e.x) / aD, uy = (aimY - e.y) / aD;
  const goalD = Math.sqrt((gx - e.x) * (gx - e.x) + (gy - e.y) * (gy - e.y));
  if (onLane(e)) {
    // the route moved on (a new waypoint, a chased unit moved off): the lane was for another leg
    if (Math.abs(e.laneAimX - aimX) + Math.abs(e.laneAimY - aimY) > REPATH_DIST) clearLane(e);
    else {
      if (--e.laneCheck > 0) return;
      e.laneCheck = LANE_RECHECK;
      const ex = e.lane[e.lane.length - 2], ey = e.lane[e.lane.length - 1];
      collectDiscs(w, e, Math.min(e.x, ex) - 2, Math.min(e.y, ey) - 2, Math.max(e.x, ex) + 2, Math.max(e.y, ey) + 2, ux, uy, gx, gy, ARRIVE_NEAR, e.laneAll);
      // the way straight to the lane's end cleared (with room to spare): drop the lane
      if (discsClear(e.x, e.y, ex, ey, -0.15) && w.nav.lineOfWalk(e.x, e.y, ex, ey, r) && w.nav.lineOfWalk(ex, ey, aimX, aimY, r)) {
        clearLane(e);
        e.lane.push(ex, ey);   // walk straight to it (the leg resumes there)
        e.laneIdx = 0;
        return;
      }
      // the lane ahead (LANE_AHEAD m of it) still clear?
      let px = e.x, py = e.y, left = LANE_AHEAD, ok = true;
      for (let i = e.laneIdx * 2; i + 1 < e.lane.length && left > 0; i += 2) {
        const qx = e.lane[i], qy = e.lane[i + 1];
        if (!discsClear(px, py, qx, qy, RASTER_SLACK + 0.1)) { ok = false; break; }
        left -= Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
        px = qx; py = qy;
      }
      if (ok) return;
      clearLane(e);
      e.laneCheck = 0;
      // fall through: re-plan from here (the shortest way round now: keeping a side cost more in the wave probe)
    }
  }
  if (e.laneCheck > 0) { e.laneCheck--; return; }
  const look = Math.min(LANE_LOOK, aD, goalD);
  if (look < 0.3) return;
  collectDiscs(w, e, Math.min(e.x, e.x + ux * look) - 1.5, Math.min(e.y, e.y + uy * look) - 1.5, Math.max(e.x, e.x + ux * look) + 1.5, Math.max(e.y, e.y + uy * look) + 1.5, ux, uy, gx, gy, ARRIVE_NEAR, e.laneAll);
  if (laneDiscs.length === 0 || discsClear(e.x, e.y, e.x + ux * look, e.y + uy * look, 0)) return;
  // blocked: plan to a point on the leg past the bodies (the aim itself when it is near)
  const L = Math.min(aD, LANE_REACH);
  collectDiscs(w, e, Math.min(e.x, e.x + ux * L) - 4, Math.min(e.y, e.y + uy * L) - 4, Math.max(e.x, e.x + ux * L) + 4, Math.max(e.y, e.y + uy * L) + 4, ux, uy, gx, gy, ARRIVE_NEAR, e.laneAll);
  let s = L;
  const inDisc = (d: number): boolean => !discsClear(e.x + ux * d, e.y + uy * d, e.x + ux * d, e.y + uy * d, 0);
  if (s < aD) { while (s < aD && s < L + 4 && inDisc(s)) s = Math.min(aD, s + 0.25); }
  if (inDisc(s)) { s = L; while (s > look && inDisc(s)) s -= 0.25; }
  const tx = e.x + ux * s, ty = e.y + uy * s;
  if (!inDisc(s) && planLane(w, e, tx, ty, r, e.lane) && laneFair(e, tx, ty)) {
    e.laneIdx = 0; e.laneAimX = aimX; e.laneAimY = aimY; e.laneCheck = LANE_RECHECK; e.lanePlanned = true;
    const fx = e.lane[0] - e.x, fy = e.lane[1] - e.y;
    e.steerSide = ux * fy - uy * fx > 0 ? -1 : 1;
  } else {
    clearLane(e);
    e.laneCheck = LANE_RETRY;
  }
}

/** a lane is taken only when it goes round, not back: at most LANE_DETOUR × the straight line + LANE_DETOUR_M long and
 *  never more than LANE_AWAY m further from its end than the walker starts (a pocket the bodies closed round it is
 *  shoved through instead, and the progress watchdog decides) */
function laneFair(e: Entity, tx: number, ty: number): boolean {
  const d0 = Math.sqrt((tx - e.x) * (tx - e.x) + (ty - e.y) * (ty - e.y));
  if (laneLen(e.x, e.y, e.lane, 0) > d0 * LANE_DETOUR + LANE_DETOUR_M) return false;
  let px = e.x, py = e.y;
  const lim = (d0 + LANE_AWAY) * (d0 + LANE_AWAY);
  for (let i = 0; i + 1 < e.lane.length; i += 2) {
    const qx = e.lane[i], qy = e.lane[i + 1];
    for (const f of [0.5, 1]) {
      const x = px + (qx - px) * f, y = py + (qy - py) * f;
      if ((x - tx) * (x - tx) + (y - ty) * (y - ty) > lim) return false;
    }
    px = qx; py = qy;
  }
  return true;
}

function stepToward(w: World, e: Entity, gx: number, gy: number): void {
  const speed = e.stats.moveSpeed;
  let budget = speed * TICK_DT;
  if (budget <= 0) return;
  const nav = w.nav;
  const r = Math.min(e.radius, nav.cell * 0.45);
  const goalMoved = !(Math.abs(gx - e.pathGoalX) + Math.abs(gy - e.pathGoalY) <= REPATH_DIST);
  if (goalMoved || (e.path.length === 0 && --e.pathCheck <= 0)) {
    if (goalMoved) clearLane(e);
    e.pathGoalX = gx; e.pathGoalY = gy;
    e.pathIdx = 0;
    if (nav.lineOfWalk(e.x, e.y, gx, gy, r)) { e.path.length = 0; e.pathCheck = DIRECT_RECHECK_TICKS; }
    else if (!nav.findPath(e.x, e.y, gx, gy, e.path, r)) { e.path.length = 0; e.pathCheck = DIRECT_RECHECK_TICKS; return; }
  }
  // runtime string pulling: crowds push walkers off the pulled line, and a body parked on a corner
  // node would block everyone aiming at it — so skip every waypoint we can already walk past
  if (e.path.length > 0 && --e.skipCheck <= 0) {
    e.skipCheck = SKIP_CHECK_TICKS;
    while ((e.pathIdx + 1) * 2 < e.path.length && nav.lineOfWalk(e.x, e.y, e.path[e.pathIdx * 2 + 2], e.path[e.pathIdx * 2 + 3], r)) e.pathIdx++;
  }
  const onPath = e.path.length > 0 && e.pathIdx * 2 < e.path.length;
  const routeX = onPath ? e.path[e.pathIdx * 2] : gx, routeY = onPath ? e.path[e.pathIdx * 2 + 1] : gy;
  // a walking fighter walks a lane round the bodies in its way (ruling 37) instead of grinding through them
  if (e.kind === 'fighter') updateLane(w, e, routeX, routeY, gx, gy, r);
  const laned = onLane(e);
  const aimX = laned ? e.lane[e.laneIdx * 2] : routeX, aimY = laned ? e.lane[e.laneIdx * 2 + 1] : routeY;
  const aimD0 = Math.sqrt((aimX - e.x) * (aimX - e.x) + (aimY - e.y) * (aimY - e.y));
  const want = Math.min(budget, aimD0);
  let x = e.x, y = e.y;
  // progress watchdog (rulings 36, 37), lanes included: the route length left when this window opened
  const watch = e.kind === 'fighter';
  if (watch && e.watchTicks === 0) { e.watchRem = routeLeft(e, e.x, e.y, gx, gy); e.watchX = e.x; e.watchY = e.y; }
  // walk the lane, then the waypoint list, within this tick's budget
  for (let guard = 0; guard < 6 && budget > 1e-9; guard++) {
    let wx: number, wy: number;
    const lane = onLane(e);
    const usingPath = !lane && e.path.length > 0 && e.pathIdx * 2 < e.path.length;
    if (lane) { wx = e.lane[e.laneIdx * 2]; wy = e.lane[e.laneIdx * 2 + 1]; }
    else if (usingPath) { wx = e.path[e.pathIdx * 2]; wy = e.path[e.pathIdx * 2 + 1]; }
    else { wx = gx; wy = gy; }
    const dx = wx - x, dy = wy - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      x = wx; y = wy; budget -= d;
      if (lane) { e.laneIdx++; if (!onLane(e)) clearLane(e); }
      else if (usingPath) { e.pathIdx++; if (e.pathIdx * 2 >= e.path.length) { e.path.length = 0; } }
      else break;
    } else { x += (dx / d) * budget; y += (dy / d) * budget; budget = 0; }
  }
  // soft separation, then walls, then blocking zones
  separate(w, e, x, y, 0.5);
  let nx = tmp.x, ny = tmp.y;
  // a unit standing in a blocked cell (an obstacle appeared under it) may walk out freely
  if (nav.walkable(e.x, e.y) && !nav.walkable(nx, ny)) {
    if (nav.walkable(nx, e.y)) ny = e.y;
    else if (nav.walkable(e.x, ny)) nx = e.x;
    else if (nav.walkable(x, y)) { nx = x; ny = y; }
    else { nx = e.x; ny = e.y; e.pathGoalX = NaN; }
  }
  if (w.blockingZones.length > 0 && zoneBlocks(w, e, nx, ny) && !zoneBlocks(w, e, e.x, e.y)) { nx = e.x; ny = e.y; }
  // jostled in place (separation cancelling the step) for NO_PROGRESS_TICKS → on a lane: re-plan it; else a near
  // waypoint counts as reached, otherwise the route is recomputed from here
  const aimD1 = Math.sqrt((aimX - nx) * (aimX - nx) + (aimY - ny) * (aimY - ny));
  if (want > 1e-6 && aimD0 - aimD1 < want * 0.25) {
    if (++e.noProgress >= NO_PROGRESS_TICKS) {
      e.noProgress = 0;
      if (laned) { clearLane(e); e.laneCheck = 0; }
      else if (onPath && aimD1 < WAYPOINT_GIVE_UP && (e.pathIdx + 1) * 2 < e.path.length) e.pathIdx++;
      else { e.pathGoalX = NaN; e.pathCheck = 0; }
    }
  } else e.noProgress = 0;
  // the window closes: under WATCH_PROGRESS of a full-speed walk off the route left and under WATCH_MOVED of one in
  // ground (pinned, inching, shoved back and forth) → re-plan from here with every body counted; movementSystem ends a
  // move to a point after a second such window unless that re-plan found a lane (and after WATCH_MAX regardless)
  if (watch && ++e.watchTicks >= WATCH_TICKS) {
    const gain = e.watchRem - routeLeft(e, nx, ny, gx, gy);
    const full = speed * WATCH_TICKS * TICK_DT;
    // walking round a wave gains little route but covers ground; being pinned or inching does neither
    const shift = Math.sqrt((nx - e.watchX) * (nx - e.watchX) + (ny - e.watchY) * (ny - e.watchY));
    // … unless it was carried AWAY from its point (a wave marching through it): ground covered then is no progress
    const lost = Math.sqrt((gx - nx) * (gx - nx) + (gy - ny) * (gy - ny)) - Math.sqrt((gx - e.watchX) * (gx - e.watchX) + (gy - e.watchY) * (gy - e.watchY)) > WATCH_LOST;
    e.watchTicks = 0;
    if (gain < full * WATCH_PROGRESS && (shift < full * WATCH_MOVED || lost)) {
      e.watchStage++;
      // a second window in a row with no lane found since the first: boxed in, the move to a point ends
      if (e.watchStage >= 2 && !e.lanePlanned) e.watchStage = WATCH_MAX;
      e.pathGoalX = NaN; e.pathCheck = 0; e.noProgress = 0;
      clearLane(e); e.laneCheck = 0; e.laneAll = true; e.lanePlanned = false;
    } else { e.watchStage = 0; e.laneAll = false; }
  }
  const mdx = nx - e.x, mdy = ny - e.y;
  const moved = Math.sqrt(mdx * mdx + mdy * mdy);
  if (moved < 1e-6) { if (--e.pathCheck <= 0) { e.pathGoalX = NaN; e.pathCheck = DIRECT_RECHECK_TICKS; } return; } // stuck: repath soon
  e.facing = datan2(mdy, mdx);
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
      // walking to the order's own point (not chasing a picked enemy)
      const toPoint = (e.order === ORDER_MOVE || e.order === ORDER_ATTACK_MOVE) && gx === e.orderX && gy === e.orderY;
      let d0 = 0;
      if (toPoint) {
        const dx = gx - e.x, dy = gy - e.y;
        d0 = dx * dx + dy * dy;
        if (d0 < 0.0025) { arrive(e); continue; }
        d0 = Math.sqrt(d0);
      }
      const direct = e.path.length === 0 && !onLane(e);
      stepToward(w, e, gx, gy);
      if (toPoint) {
        if (Math.abs(e.x - e.orderX) + Math.abs(e.y - e.orderY) < 0.05) { arrive(e); continue; }
        // direct approach without real progress: a crowd on the spot, or a body pinned against a corner
        const d1 = Math.sqrt((gx - e.x) * (gx - e.x) + (gy - e.y) * (gy - e.y));
        const step = e.stats.moveSpeed * TICK_DT, gain = d0 - d1;
        const straight = direct && e.path.length === 0 && !onLane(e);
        if (straight && gain < step * ARRIVE_PROGRESS) e.arriveStall++; else e.arriveStall = 0;
        if (straight && gain < step * PINNED_PROGRESS) e.arrivePinned++; else e.arrivePinned = 0;
        if ((e.arriveStall >= ARRIVE_STALL_TICKS && d1 < e.radius + ARRIVE_NEAR) || e.arrivePinned >= ARRIVE_GIVE_UP_TICKS
          || e.watchStage >= WATCH_MAX) arrive(e);
      }
    } else if ((e.ccMask & CC_HARD) === 0) {
      if (e.watchTicks !== 0 || e.watchStage !== 0 || e.lane.length > 0) resetWatch(e);
      // idle units yield softly to overlapping neighbours
      separate(w, e, e.x, e.y, 0.2);
      const dx = tmp.x - e.x, dy = tmp.y - e.y;
      if (dx * dx + dy * dy > 1e-6 && w.nav.walkable(tmp.x, tmp.y) && !(w.blockingZones.length > 0 && zoneBlocks(w, e, tmp.x, tmp.y))) setPos(w, e, tmp.x, tmp.y);
    }
  }
  w.hashDirty = true;
}

function arrive(e: Entity): void {
  e.order = ORDER_NONE; e.orderTarget = -1; e.path.length = 0; e.arriveStall = 0; e.arrivePinned = 0;
  resetWatch(e);
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

