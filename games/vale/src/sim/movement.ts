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
/** a walking fighter looks this far (m) ahead for units standing on its line and steers round them (ruling 35) */
const STEER_LOOK = 3;
/** clearance (m) kept past a steered-round body */
const STEER_MARGIN = 0.1;
/** a clear heading on the other side must be this much (rad) nearer the line before a steer flips sides */
const STEER_STICK = 0.2;
/** headings are tried every STEER_STEP rad, out to 135° each side (backing out of a pocket the wave closed round
 *  it); a heading is clear for STEER_CLEAR m of walking */
const STEER_STEP = Math.PI / 36;
const STEER_DIRS = 28;
const STEER_CLEAR = 1.6;
const STEER_COS: number[] = [];
const STEER_SIN: number[] = [];
for (let k = 0; k < STEER_DIRS; k++) { STEER_COS.push(dcos(k * STEER_STEP)); STEER_SIN.push(dsin(k * STEER_STEP)); }
/** a body walking away along the line faster than this fraction of the walker's speed is not steered round */
const STEER_FOLLOW = 0.75;
/** progress watchdog window (ticks, ~1 s) and the share of a full-speed walk it must gain off the route left */
const WATCH_TICKS = 30;
const WATCH_PROGRESS = 0.3;
/** … unless it covered at least this share of a full-speed walk of ground (walking round a wave, not stuck) */
const WATCH_MOVED = 0.6;
const ARRIVE_NEAR = 1;
const ARRIVE_PROGRESS = 0.3;
/** peak height (m) of airborne arcs */
const KNOCK_ARC = 1.2;
const near: Entity[] = [];
const passT: number[] = [];
const passU: Entity[] = [];
const tmp = { x: 0, y: 0 };
const steerLo: number[] = [];
const steerHi: number[] = [];
const steerR: number[] = [];

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

/**
 * Local steering for a walking fighter (rulings 35, 36): bodies within STEER_LOOK m ahead (not the unit it is going
 * for, not a crowd on its own point) are walked round instead of shoved through. Only bodies that are standing,
 * slower than the walker, or coming at it count: one walking the same way about as fast clears the line by itself
 * (no sidestep behind an ally heading to the same spot). Headings are tried every STEER_STEP rad out to 135° each
 * side; a heading is clear when the walker could go STEER_CLEAR m along it (or to its aim) without its body
 * meeting a counted body (radius + STEER_MARGIN; a body it already touches only blocks headings into it) or a wall.
 * The clear heading nearest the line wins, so it passes the bodies along their tangents: the least detour, re-aimed
 * every tick. The side steered last tick is kept unless the other is STEER_STICK rad nearer the line (an exact tie
 * to the right). Boxed in (no clear heading): the heading that gains the most ground before a body, if it beats
 * walking straight. Writes the unit heading into tmp and returns true, or false: walk straight (and shove).
 */
function steerRound(w: World, e: Entity, ux: number, uy: number, reach: number): boolean {
  const look = Math.min(STEER_LOOK, reach);
  if (look < 0.3) return false;
  const n = w.hash.query(e.x + ux * look * 0.5, e.y + uy * look * 0.5, look * 0.5 + e.radius + 1.2, near);
  steerLo.length = 0; steerHi.length = 0; steerR.length = 0;
  const follow = STEER_FOLLOW * e.stats.moveSpeed;
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (o === e || !o.alive || o.dash || o.static || o.kind === 'ward' || o.kind === 'pickup' || o.kind === 'projectile' || o.kind === 'zone') continue;
    if (o.id === e.orderTarget || o.id === e.atkTarget) continue;
    const ox = o.x - e.x, oy = o.y - e.y;
    const fwd = ox * ux + oy * uy;
    const d = Math.sqrt(ox * ox + oy * oy);
    // behind, out of reach, or crowding the point itself (the arrival watchdog ends a move into a crowd on its point)
    if (fwd <= -o.radius || d > look + o.radius + e.radius || fwd >= reach - (o.radius + e.radius + ARRIVE_NEAR)) continue;
    // walking away along the line about as fast as the walker: it is not in the way for long
    if (o.vx * ux + o.vy * uy > follow) continue;
    steerLo.push(ox); steerHi.push(oy); steerR.push(e.radius + o.radius);
  }
  if (steerLo.length === 0) return false;
  const clear = Math.min(STEER_CLEAR, look);
  const f0 = steerFree(ux, uy, look);
  if (f0 >= look - 1e-9) return false;   // the line itself is clear
  const nav = w.nav;
  const probe = Math.min(clear, reach);
  let best = -1, bestSide = 0, bestGain = f0, bestK = -1, bestKSide = 0;
  let firstR = -1, firstL = -1;
  for (let k = 1; k < STEER_DIRS; k++) {
    for (const side of [1, -1]) {
      if ((side > 0 ? firstR : firstL) >= 0) continue;
      const c = STEER_COS[k], sn = STEER_SIN[k] * side;
      const dx = ux * c + uy * sn, dy = uy * c - ux * sn;   // + side = right of the heading
      const f = steerFree(dx, dy, look);
      const okWall = (): boolean => nav.lineOfWalk(e.x, e.y, e.x + dx * probe, e.y + dy * probe, 0);
      if (f >= clear - 1e-9) { if (okWall()) { if (side > 0) firstR = k; else firstL = k; } continue; }
      const gain = f * c + (side === e.steerSide ? 0.05 : 0);
      if (gain > bestGain + 1e-6 && okWall()) { bestGain = gain; bestK = k; bestKSide = side; }
    }
    if (firstR >= 0 && firstL >= 0) break;
  }
  if (firstR >= 0 || firstL >= 0) {
    const kr = firstR >= 0 ? firstR : Infinity, kl = firstL >= 0 ? firstL : Infinity;
    const stick = STEER_STICK / STEER_STEP;
    if (e.steerSide > 0) bestSide = kl < kr - stick ? -1 : 1;
    else if (e.steerSide < 0) bestSide = kr < kl - stick ? 1 : -1;
    else bestSide = kl < kr ? -1 : 1;
    if ((bestSide > 0 ? kr : kl) === Infinity) bestSide = -bestSide;
    best = bestSide > 0 ? kr : kl;
  } else if (bestK >= 0) { best = bestK; bestSide = bestKSide; }
  if (best < 0) return false;
  e.steerSide = bestSide;
  const c = STEER_COS[best], sn = STEER_SIN[best] * bestSide;
  tmp.x = ux * c + uy * sn; tmp.y = uy * c - ux * sn;
  return true;
}
/** how far (m, up to `cap`) the walker can go along unit heading (dx, dy) before its body meets a counted body */
function steerFree(dx: number, dy: number, cap: number): number {
  let free = cap;
  for (let i = 0; i < steerLo.length; i++) {
    const ox = steerLo[i], oy = steerHi[i], R = steerR[i];
    const along = ox * dx + oy * dy;
    const d2 = ox * ox + oy * oy;
    if (d2 < R * R) {
      // already touching: only a heading into it is blocked (sliding past or away is free)
      if (along > Math.sqrt(d2) * 0.35) return 0;
      continue;
    }
    if (along <= 0) continue;
    const Rm = R + STEER_MARGIN;
    const perp2 = d2 - along * along;
    if (perp2 >= Rm * Rm) continue;
    const t = along - Math.sqrt(Rm * Rm - perp2);
    if (t < free) free = t < 0 ? 0 : t;
  }
  return free;
}

/** route length left from (x, y): to the current waypoint and along the rest of the path, else straight to the goal */
function routeLeft(e: Entity, x: number, y: number, gx: number, gy: number): number {
  if (e.path.length === 0 || e.pathIdx * 2 >= e.path.length) return Math.sqrt((gx - x) * (gx - x) + (gy - y) * (gy - y));
  let px = x, py = y, l = 0;
  for (let i = e.pathIdx * 2; i + 1 < e.path.length; i += 2) {
    const qx = e.path[i], qy = e.path[i + 1];
    l += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
    px = qx; py = qy;
  }
  return l;
}

/** reset the progress watchdog (a new order, or not walking) */
export function resetWatch(e: Entity): void { e.watchTicks = 0; e.watchStage = 0; e.steerOff = 0; }

function stepToward(w: World, e: Entity, gx: number, gy: number): void {
  const speed = e.stats.moveSpeed;
  let budget = speed * TICK_DT;
  if (budget <= 0) return;
  const nav = w.nav;
  const r = Math.min(e.radius, nav.cell * 0.45);
  const goalMoved = !(Math.abs(gx - e.pathGoalX) + Math.abs(gy - e.pathGoalY) <= REPATH_DIST);
  if (goalMoved || (e.path.length === 0 && --e.pathCheck <= 0)) {
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
  const aimX = onPath ? e.path[e.pathIdx * 2] : gx, aimY = onPath ? e.path[e.pathIdx * 2 + 1] : gy;
  const aimD0 = Math.sqrt((aimX - e.x) * (aimX - e.x) + (aimY - e.y) * (aimY - e.y));
  const want = Math.min(budget, aimD0);
  let x = e.x, y = e.y;
  // progress watchdog (ruling 36), steering included: the route length left when this window opened
  const watch = e.kind === 'fighter';
  if (watch && e.watchTicks === 0) { e.watchRem = routeLeft(e, e.x, e.y, gx, gy); e.watchX = e.x; e.watchY = e.y; }
  // a walking fighter steers round units standing on its line (rulings 35, 36) instead of grinding through them
  let steered = false;
  if (e.steerOff > 0) e.steerOff--;
  if (e.kind === 'fighter' && aimD0 > 1e-6 && e.steerOff === 0) {
    const ux = (aimX - e.x) / aimD0, uy = (aimY - e.y) / aimD0;
    const goalD = Math.sqrt((gx - e.x) * (gx - e.x) + (gy - e.y) * (gy - e.y));
    if (steerRound(w, e, ux, uy, Math.min(aimD0, goalD))) {
      x = e.x + tmp.x * budget; y = e.y + tmp.y * budget; budget = 0;
      steered = true;
    } else e.steerSide = 0;
  } else e.steerSide = 0;
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
  // a unit standing in a blocked cell (an obstacle appeared under it) may walk out freely
  if (nav.walkable(e.x, e.y) && !nav.walkable(nx, ny)) {
    if (nav.walkable(nx, e.y)) ny = e.y;
    else if (nav.walkable(e.x, ny)) nx = e.x;
    else if (nav.walkable(x, y)) { nx = x; ny = y; }
    else { nx = e.x; ny = e.y; e.pathGoalX = NaN; }
  }
  if (w.blockingZones.length > 0 && zoneBlocks(w, e, nx, ny) && !zoneBlocks(w, e, e.x, e.y)) { nx = e.x; ny = e.y; }
  // progress watchdog: jostled in place (separation cancelling the step) for NO_PROGRESS_TICKS →
  // a near waypoint counts as reached, otherwise the route is recomputed from here
  const aimD1 = Math.sqrt((aimX - nx) * (aimX - nx) + (aimY - ny) * (aimY - ny));
  if (want > 1e-6 && !steered && aimD0 - aimD1 < want * 0.25) {
    if (++e.noProgress >= NO_PROGRESS_TICKS) {
      e.noProgress = 0;
      if (onPath && aimD1 < WAYPOINT_GIVE_UP && (e.pathIdx + 1) * 2 < e.path.length) e.pathIdx++;
      else { e.pathGoalX = NaN; e.pathCheck = 0; }
    }
  } else e.noProgress = 0;
  // the window closes: under WATCH_PROGRESS of a full-speed walk off the route left (steering in place, inching
  // sideways in a wave, pinned on a body) → re-plan from here and walk the route without steering for a window;
  // a second such window in a row tells movementSystem to end a move to a point (watchStage 2)
  if (watch && ++e.watchTicks >= WATCH_TICKS) {
    const gain = e.watchRem - routeLeft(e, nx, ny, gx, gy);
    const full = speed * WATCH_TICKS * TICK_DT;
    // walking round a wave gains little route but covers ground; steering in place or inching does neither
    const shift = Math.sqrt((nx - e.watchX) * (nx - e.watchX) + (ny - e.watchY) * (ny - e.watchY));
    e.watchTicks = 0;
    if (gain < full * WATCH_PROGRESS && shift < full * WATCH_MOVED) {
      e.watchStage++;
      e.pathGoalX = NaN; e.pathCheck = 0; e.noProgress = 0;
      e.steerOff = WATCH_TICKS; e.steerSide = 0;
    } else e.watchStage = 0;
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
      const direct = e.path.length === 0;
      stepToward(w, e, gx, gy);
      if (toPoint) {
        if (Math.abs(e.x - e.orderX) + Math.abs(e.y - e.orderY) < 0.05) { arrive(e); continue; }
        // direct approach without real progress: a crowd on the spot, or a body pinned against a corner
        const d1 = Math.sqrt((gx - e.x) * (gx - e.x) + (gy - e.y) * (gy - e.y));
        const step = e.stats.moveSpeed * TICK_DT, gain = d0 - d1;
        const straight = direct && e.path.length === 0;
        if (straight && gain < step * ARRIVE_PROGRESS) e.arriveStall++; else e.arriveStall = 0;
        if (straight && gain < step * PINNED_PROGRESS) e.arrivePinned++; else e.arrivePinned = 0;
        if ((e.arriveStall >= ARRIVE_STALL_TICKS && d1 < e.radius + ARRIVE_NEAR) || e.arrivePinned >= ARRIVE_GIVE_UP_TICKS || e.watchStage >= 2) arrive(e);
      }
    } else if ((e.ccMask & CC_HARD) === 0) {
      if (e.watchTicks !== 0 || e.watchStage !== 0) resetWatch(e);
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

