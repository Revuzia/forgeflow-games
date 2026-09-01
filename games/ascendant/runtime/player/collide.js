/**
 * ASCENDANT — runtime/player/collide.js
 * ---------------------------------------------------------------------------
 * Swept, per-axis, iterated box collision against the world broadphase.
 * CONTRACT section 12.
 *
 * WHAT THIS GUARANTEES
 * --------------------
 *  - No tunnelling. The move is substepped so no substep ever advances further
 *    than 0.7 * radius, and every axis resolve is a SWEPT test: a collider only
 *    blocks along an axis if the player was NOT already interpenetrating it
 *    before that axis moved. That single rule kills both classes of bug at
 *    once — you cannot pass through a thin beam, and a 40 m floor you are
 *    standing 1 mm inside can never fling you 20 m sideways.
 *  - No jitter on seams. Axis resolves push out by exactly the overlap, so a
 *    resting contact settles at zero penetration and the next frame's test
 *    (epsilon 1e-4) sees nothing to do. Two flush platforms produce identical
 *    corrections, so they cannot fight; ties break deterministically on contact
 *    area then collider id.
 *  - Clean wall slide. X, then Z, then Y, each resolved independently, so
 *    running into a corner slides instead of snagging.
 *  - A ride that stays put. A moving deck carries the player by the deck's
 *    own motion: its frame-mean linear velocity (what movers.js publishes as
 *    linVel — the derivative at t drifts by a*dt^2/2 a frame) and, for a
 *    spinning deck, an EXACT rotation about its axis (a tangent step creeps
 *    outward by (w*dt)^2/2 a substep and never comes back). See carryOn().
 *
 * ORDER OF OPERATIONS, PER SUBSTEP
 * --------------------------------
 *   1. moving-platform carry + push (and the crush test)
 *   2. sweep X, resolve
 *   3. sweep Z, resolve
 *   4. sweep Y, resolve            (step-up runs inside 2 and 3)
 *   5. depenetrate leftovers along the minimum translation vector (max 4)
 *   6. ground probe: contact feeler (no movement) then ground snap (0.12 m)
 *
 * IMPORTANT FOR THE CALLER (runtime/player/controller.js)
 * ------------------------------------------------------
 *  - The returned object is a SINGLE REUSED instance. Read it this frame; copy
 *    anything you need to keep.
 *  - `state.pos` and `state.vel` are mutated in place. Velocity components are
 *    zeroed when a resolve opposes them (that is what makes landing not eat
 *    horizontal speed, and what makes a wall stop you without stopping the
 *    slide along it).
 *  - `platformVel` is REPORTING ONLY. The carry displacement has already been
 *    applied to `state.pos`. Use platformVel for velocity inheritance when the
 *    player jumps off a mover — do NOT integrate it into the position again.
 *  - Pass `state.grounded` (last frame's value). It gates ground snap. Set
 *    `state.jumped = true` on the frame you apply a jump impulse and snap is
 *    skipped outright (the vy > 0 test already covers the normal case).
 *  - After the call, `Scratch.cap` (from world/collider.js) holds the player's
 *    kill capsule for the resolved position, so a hazard test can reuse it
 *    without rebuilding one. `result.kill` is already the first volume that hit.
 */

import * as THREE from 'three';
import { TUNE } from '../core/tuning.js';
import { EPS, Scratch, inflatedHalf } from '../world/collider.js';

/* ===========================================================================
 * Module-scope scratch. Nothing in the update path allocates.
 * ======================================================================== */

const PH = new THREE.Vector3();        // player half extents (radius, h/2, radius)
const PC = new THREE.Vector3();        // player box centre, world
const PC_PREV = new THREE.Vector3();   // player box centre before the current axis move
const QBOX = new THREE.Box3();
const HE = new THREE.Vector3();        // collider half extents inflated by PH, local
const LP = new THREE.Vector3();        // player centre in collider local space
const LPREV = new THREE.Vector3();
const TMPV = new THREE.Vector3();
const TMPN = new THREE.Vector3();
const NRM = new THREE.Vector3();
const ENTRY_POS = new THREE.Vector3();

const CAND_A = [];   // nesting level 0 — sweeps, depenetrate, carry
const CAND_B = [];   // nesting level 1 — step-up clearance, ground probe, crush
const RAY_CANDS = [];
const RAY_BOX = new THREE.Box3();

const _rl = new Float64Array(3);
const _rd = new Float64Array(3);
const _rh = new Float64Array(3);

/** Query padding so near-contacts are never missed by the broadphase. */
const QUERY_MARGIN = 0.03;
/** Vertical clearance left above a step when the player mantles onto it. */
const STEP_CLEAR = 1e-3;
/** Distance below the feet that still counts as standing on something. */
const CONTACT_GAP = 0.035;
/** Ground snap probe depth (contract: 0.12 m). */
const SNAP_DIST = 0.12;
/** Carry probe depth — how far below the feet a platform still carries you. */
const CARRY_DIST = 0.10;
/** Static overlap after a mover push that means the player has been squashed. */
const CRUSH_DEPTH = 0.02;
/** How far a wall may be from the player's shoulder and still count as touched. */
const FEELER = 0.045;
/** Slope steeper than this (normal.y) is a wall, not ground. */
const GROUND_NY = 0.5;
/** A resolve along a sweep axis needs at least this much normal along it. */
const MIN_AXIS_N = 0.2;

/* ===========================================================================
 * The reused CollisionResult.
 * ======================================================================== */

const WALL_POOL = [
  { normal: new THREE.Vector3(), collider: null },
  { normal: new THREE.Vector3(), collider: null },
  { normal: new THREE.Vector3(), collider: null },
  { normal: new THREE.Vector3(), collider: null },
];

const RESULT = {
  grounded: false,
  groundNormal: new THREE.Vector3(0, 1, 0),
  groundCollider: null,
  ceiling: false,
  ceilingCollider: null,
  /** @type {{normal:THREE.Vector3, collider:object}[]} deduped, max 4 */
  walls: [],
  platformVel: new THREE.Vector3(),
  surface: 'normal',
  surfaceProps: null,
  stepped: false,
  crushed: false,
  hitVel: new THREE.Vector3(),
  /** Extra (not required by the contract, free to ignore): */
  kill: null,
  killKind: null,
  substeps: 1,
  contacts: 0,
};

function resetResult() {
  const r = RESULT;
  r.grounded = false;
  r.groundNormal.set(0, 1, 0);
  r.groundCollider = null;
  r.ceiling = false;
  r.ceilingCollider = null;
  for (let i = 0; i < WALL_POOL.length; i++) WALL_POOL[i].collider = null;
  r.walls.length = 0;
  r.platformVel.set(0, 0, 0);
  r.surface = 'normal';
  r.surfaceProps = null;
  r.stepped = false;
  r.crushed = false;
  r.kill = null;
  r.killKind = null;
  r.substeps = 1;
  r.contacts = 0;
  return r;
}

/** Per-call context so the helpers do not need long argument lists. */
const CTX = {
  pos: null, vel: null, res: RESULT,
  bp: null, list: null,
  halfH: 0.9, radius: 0.35,
  stepUp: 0.55,
  grounded: false,
  allowSnap: true,
  wantSnap: null,
};

/** Filled by axisContact(). */
const CONTACT = { push: 0, nx: 0, ny: 0, nz: 0, area: 0, depth: 0 };
/** Filled by probeDown(). */
const PROBE = { hit: false, lift: 0, gap: 0, collider: null, nx: 0, ny: 1, nz: 0 };
/** Returned by sweepGround(). Reused. */
const GROUND_HIT = {
  hit: false, dist: Infinity, collider: null,
  normal: new THREE.Vector3(0, 1, 0),
  point: new THREE.Vector3(),
};

/* ===========================================================================
 * Small helpers
 * ======================================================================== */

function setPlayerBox() {
  PC.set(CTX.pos.x, CTX.pos.y + CTX.halfH, CTX.pos.z);
}

/**
 * Is every number the narrow phase will read off `c` finite?
 *
 * This is not paranoia, it is a hard requirement of the maths below. Every
 * early-out in `mtv` / `axisContact` / `probeDown` is written as
 * `if (overlap <= EPS) bail`, and EVERY comparison against NaN is false — so a
 * collider carrying a single NaN slips past all of them and hands the sweep a
 * NaN push. `moveAndCollide`'s exit guard then restores the entry position and
 * zeroes the velocity, and does it again the next frame, and the next: the
 * player is left perfectly finite and PERMANENTLY FROZEN, unable to move a
 * centimetre in any direction. Reproduced with one bad collider next to the
 * player: 0.000 m of travel over 60 frames with movement held.
 *
 * One add-chain plus one isFinite catches NaN and both infinities in every
 * component at once (Infinity + -Infinity is NaN, which is not finite), and it
 * lives in queryCands because that is the single gate every narrow-phase
 * consumer draws its candidates through — sweeps, depenetrate, step-up
 * clearance, the ground probe, the wall feeler and the mover carry alike.
 */
function usable(c) {
  const b = c.aabb;
  if (b === undefined || b === null) return false;
  return isFinite(
    b.min.x + b.min.y + b.min.z + b.max.x + b.max.y + b.max.z +
    c.center.x + c.center.y + c.center.z +
    c.half.x + c.half.y + c.half.z,
  );
}

function queryCands(buf) {
  const m = QUERY_MARGIN;
  QBOX.min.set(PC.x - PH.x - m, PC.y - PH.y - m, PC.z - PH.z - m);
  QBOX.max.set(PC.x + PH.x + m, PC.y + PH.y + m, PC.z + PH.z + m);

  let list;
  if (CTX.bp !== null) {
    list = CTX.bp.query(QBOX, buf);
  } else {
    buf.length = 0;
    list = buf;
    const src = CTX.list;
    if (src === null) return buf;
    const min = QBOX.min, max = QBOX.max;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (!c || c.active === false) continue;
      const b = c.aabb;
      if (!b) continue;
      if (b.max.x < min.x || b.min.x > max.x) continue;
      if (b.max.y < min.y || b.min.y > max.y) continue;
      if (b.max.z < min.z || b.min.z > max.z) continue;
      buf.push(c);
    }
  }

  // Compact out anything the narrow phase cannot safely reason about.
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!usable(c)) continue;
    list[w++] = c;
  }
  list.length = w;
  return list;
}

/**
 * Minimum translation vector between the player box (PC/PH) and a collider.
 * @returns {number} penetration depth (0 when not overlapping); `outN` is the
 *          unit world normal pointing from the collider toward the player.
 */
function mtv(c, outN) {
  if (c.axisAligned) {
    const hx = c.half.x + PH.x, hy = c.half.y + PH.y, hz = c.half.z + PH.z;
    const dx = PC.x - c.center.x, dy = PC.y - c.center.y, dz = PC.z - c.center.z;
    const ox = hx - Math.abs(dx); if (ox <= EPS) return 0;
    const oy = hy - Math.abs(dy); if (oy <= EPS) return 0;
    const oz = hz - Math.abs(dz); if (oz <= EPS) return 0;
    // Ties prefer Y so a player wedged in a corner is stood up, not shoved out.
    if (oy <= ox && oy <= oz) { outN.set(0, dy >= 0 ? 1 : -1, 0); return oy; }
    if (ox <= oz) { outN.set(dx >= 0 ? 1 : -1, 0, 0); return ox; }
    outN.set(0, 0, dz >= 0 ? 1 : -1);
    return oz;
  }
  inflatedHalf(c, PH, HE);
  c.toLocal(PC, LP);
  const o0 = HE.x - Math.abs(LP.x); if (o0 <= EPS) return 0;
  const o1 = HE.y - Math.abs(LP.y); if (o1 <= EPS) return 0;
  const o2 = HE.z - Math.abs(LP.z); if (o2 <= EPS) return 0;
  if (o1 <= o0 && o1 <= o2) { const s = LP.y >= 0 ? 1 : -1; outN.set(c.ay.x * s, c.ay.y * s, c.ay.z * s); return o1; }
  if (o0 <= o2) { const s = LP.x >= 0 ? 1 : -1; outN.set(c.ax.x * s, c.ax.y * s, c.ax.z * s); return o0; }
  const s = LP.z >= 0 ? 1 : -1;
  outN.set(c.az.x * s, c.az.y * s, c.az.z * s);
  return o2;
}

/**
 * Swept, axis-restricted contact test.
 *
 * `PC` must be the player centre AFTER the axis move and `PC_PREV` the centre
 * before it. A collider only blocks when the player was not already fully
 * interpenetrating it beforehand — that is what makes this a sweep rather than
 * a discrete push, and it is the guard that stops a resting contact on a huge
 * floor from being resolved sideways.
 *
 * @returns {boolean} true when `c` blocks, with CONTACT filled in.
 */
function axisContact(c, axis, sgn) {
  if (sgn === 0) return false;

  if (c.axisAligned) {
    const hx = c.half.x + PH.x, hy = c.half.y + PH.y, hz = c.half.z + PH.z;
    const dx = PC.x - c.center.x, dy = PC.y - c.center.y, dz = PC.z - c.center.z;
    const ox = hx - Math.abs(dx); if (ox <= EPS) return false;
    const oy = hy - Math.abs(dy); if (oy <= EPS) return false;
    const oz = hz - Math.abs(dz); if (oz <= EPS) return false;
    // Already interpenetrating before the move? Leave it to depenetrate().
    if (hx - Math.abs(PC_PREV.x - c.center.x) > EPS &&
        hy - Math.abs(PC_PREV.y - c.center.y) > EPS &&
        hz - Math.abs(PC_PREV.z - c.center.z) > EPS) return false;

    const dir = -sgn;
    const d = axis === 0 ? dx : (axis === 1 ? dy : dz);
    const h = axis === 0 ? hx : (axis === 1 ? hy : hz);
    const mag = h - dir * d;          // exact exit distance on the `dir` side
    if (mag <= 0) return false;
    CONTACT.push = dir * mag;
    CONTACT.depth = axis === 0 ? ox : (axis === 1 ? oy : oz);
    CONTACT.nx = axis === 0 ? dir : 0;
    CONTACT.ny = axis === 1 ? dir : 0;
    CONTACT.nz = axis === 2 ? dir : 0;
    CONTACT.area = axis === 0 ? oy * oz : (axis === 1 ? ox * oz : ox * oy);
    return true;
  }

  // ---- oriented box: work in the collider's local frame ----
  inflatedHalf(c, PH, HE);
  c.toLocal(PC, LP);
  const o0 = HE.x - Math.abs(LP.x); if (o0 <= EPS) return false;
  const o1 = HE.y - Math.abs(LP.y); if (o1 <= EPS) return false;
  const o2 = HE.z - Math.abs(LP.z); if (o2 <= EPS) return false;
  c.toLocal(PC_PREV, LPREV);
  const p0 = HE.x - Math.abs(LPREV.x);
  const p1 = HE.y - Math.abs(LPREV.y);
  const p2 = HE.z - Math.abs(LPREV.z);
  if (p0 > EPS && p1 > EPS && p2 > EPS) return false;

  // Among the local faces we newly crossed, take the shallowest that can be
  // undone along the world sweep axis in the direction opposing motion.
  let bestJ = -1, bestO = Infinity, bestN = 0;
  for (let j = 0; j < 3; j++) {
    const prevO = j === 0 ? p0 : (j === 1 ? p1 : p2);
    if (prevO > EPS) continue;
    const o = j === 0 ? o0 : (j === 1 ? o1 : o2);
    const l = j === 0 ? LP.x : (j === 1 ? LP.y : LP.z);
    const s = l >= 0 ? 1 : -1;
    const av = j === 0 ? c.ax : (j === 1 ? c.ay : c.az);
    const na = (axis === 0 ? av.x : (axis === 1 ? av.y : av.z)) * s;
    if (Math.abs(na) < MIN_AXIS_N) continue;   // too oblique to fix on this axis
    if (na * sgn >= 0) continue;               // would resolve with the motion
    if (o < bestO) { bestO = o; bestJ = j; bestN = na; }
  }
  if (bestJ < 0) return false;

  const av = bestJ === 0 ? c.ax : (bestJ === 1 ? c.ay : c.az);
  const l = bestJ === 0 ? LP.x : (bestJ === 1 ? LP.y : LP.z);
  const s = l >= 0 ? 1 : -1;
  CONTACT.nx = av.x * s; CONTACT.ny = av.y * s; CONTACT.nz = av.z * s;
  CONTACT.push = bestO / bestN;
  CONTACT.depth = bestO;

  // Contact area, approximated from the world AABB overlap on the other axes.
  const b = c.aabb;
  const oxw = Math.min(PC.x + PH.x, b.max.x) - Math.max(PC.x - PH.x, b.min.x);
  const oyw = Math.min(PC.y + PH.y, b.max.y) - Math.max(PC.y - PH.y, b.min.y);
  const ozw = Math.min(PC.z + PH.z, b.max.z) - Math.max(PC.z - PH.z, b.min.z);
  const ax2 = oxw > 0 ? oxw : 0, ay2 = oyw > 0 ? oyw : 0, az2 = ozw > 0 ? ozw : 0;
  CONTACT.area = axis === 0 ? ay2 * az2 : (axis === 1 ? ax2 * az2 : ax2 * ay2);
  return true;
}

/** Distance the player must travel along world axis `A` (sign `dir`) to leave `c`. */
function exitAlong(c, A, dir) {
  let cen, h;
  if (c.axisAligned) {
    cen = A === 0 ? c.center.x : (A === 1 ? c.center.y : c.center.z);
    h = (A === 0 ? c.half.x : (A === 1 ? c.half.y : c.half.z));
  } else {
    const b = c.aabb;
    const mn = A === 0 ? b.min.x : (A === 1 ? b.min.y : b.min.z);
    const mx = A === 0 ? b.max.x : (A === 1 ? b.max.y : b.max.z);
    cen = (mn + mx) * 0.5;
    h = (mx - mn) * 0.5;
  }
  h += A === 0 ? PH.x : (A === 1 ? PH.y : PH.z);
  const p = A === 0 ? PC.x : (A === 1 ? PC.y : PC.z);
  return h - dir * (p - cen);
}

function addWall(nx, ny, nz, c) {
  const walls = CTX.res.walls;
  for (let i = 0; i < walls.length; i++) {
    const n = walls[i].normal;
    if (n.x * nx + n.y * ny + n.z * nz > 0.9) return;
  }
  if (walls.length >= WALL_POOL.length) return;
  const e = WALL_POOL[walls.length];
  e.normal.set(nx, ny, nz);
  e.collider = c;
  walls.push(e);
}

function classifyContact(nx, ny, nz, c) {
  const r = CTX.res;
  if (ny >= GROUND_NY) {
    r.grounded = true;
    r.groundCollider = c;
    r.groundNormal.set(nx, ny, nz);
  } else if (ny <= -GROUND_NY) {
    r.ceiling = true;
    r.ceilingCollider = c;
  } else {
    addWall(nx, ny, nz, c);
  }
}

/* ===========================================================================
 * Step-up
 * ======================================================================== */

/**
 * Try to mantle onto `c` instead of being blocked by it.
 * Requires: the player is (or just was) grounded, the collider top is within
 * TUNE.stepUp above the FEET, and the player box fits at the raised height.
 * A wall taller than stepUp fails the height test and blocks normally.
 */
function tryStepUp(c) {
  const r = CTX.res, pos = CTX.pos, vel = CTX.vel;
  if (!(CTX.grounded || r.grounded)) return false;

  const top = c.aabb.max.y;
  const rise = top - pos.y;
  if (rise <= 1e-4 || rise > CTX.stepUp + 1e-4) return false;

  const saveY = pos.y;
  pos.y = top + STEP_CLEAR;
  setPlayerBox();

  const cands = queryCands(CAND_B);
  for (let i = 0; i < cands.length; i++) {
    const c2 = cands[i];
    if (c2.solid === false) continue;
    if (mtv(c2, TMPN) > EPS) {       // no head/body clearance up there
      pos.y = saveY;
      setPlayerBox();
      return false;
    }
  }

  r.grounded = true;
  r.groundCollider = c;
  if (c.ay.y > GROUND_NY) r.groundNormal.copy(c.ay); else r.groundNormal.set(0, 1, 0);
  if (vel.y < 0) vel.y = 0;
  return true;
}

/* ===========================================================================
 * Per-axis sweep
 * ======================================================================== */

function sweepAxis(axis, delta) {
  const pos = CTX.pos, vel = CTX.vel, r = CTX.res;
  if (delta !== 0) {
    if (axis === 0) pos.x += delta;
    else if (axis === 1) pos.y += delta;
    else pos.z += delta;
  }
  const sgn = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
  if (sgn === 0) return;

  setPlayerBox();
  PC_PREV.copy(PC);
  if (axis === 0) PC_PREV.x -= delta;
  else if (axis === 1) PC_PREV.y -= delta;
  else PC_PREV.z -= delta;

  let stepped = false;

  for (let iter = 0; iter < 4; iter++) {
    setPlayerBox();
    const cands = queryCands(CAND_A);

    let best = null, bestPush = 0, bestArea = -1, bestMag = -1;
    let bnx = 0, bny = 0, bnz = 0;

    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.solid === false) continue;
      if (!axisContact(c, axis, sgn)) continue;
      const mag = CONTACT.push < 0 ? -CONTACT.push : CONTACT.push;
      let take = false;
      if (best === null) take = true;
      else if (mag > bestMag + EPS) take = true;
      else if (mag > bestMag - EPS) {
        // Deepest wins; flush ties break on contact area, then id, so two
        // coplanar platforms always agree on who owns the contact.
        if (CONTACT.area > bestArea + 1e-6) take = true;
        else if (CONTACT.area > bestArea - 1e-6 && c.id < best.id) take = true;
      }
      if (take) {
        best = c; bestPush = CONTACT.push; bestMag = mag; bestArea = CONTACT.area;
        bnx = CONTACT.nx; bny = CONTACT.ny; bnz = CONTACT.nz;
      }
    }

    if (best === null) break;

    if (axis !== 1 && !stepped && tryStepUp(best)) {
      stepped = true;
      r.stepped = true;
      setPlayerBox();
      PC_PREV.y = PC.y;    // the mantle reset our vertical reference
      continue;
    }

    if (axis === 0) pos.x += bestPush;
    else if (axis === 1) pos.y += bestPush;
    else pos.z += bestPush;

    // Kill the velocity INTO the surface, keep everything tangential. For an
    // axis-aligned face this is identical to zeroing that one component (so a
    // landing never eats horizontal speed and a wall never eats the slide);
    // for a tilted face it is what makes the player deflect along it instead
    // of stopping dead.
    const vn = vel.x * bnx + vel.y * bny + vel.z * bnz;
    if (vn < 0) { vel.x -= bnx * vn; vel.y -= bny * vn; vel.z -= bnz * vn; }

    r.contacts++;
    classifyContact(bnx, bny, bnz, best);
  }
}

/* ===========================================================================
 * Leftover depenetration (tilted geometry, pushes, spawn overlaps)
 * ======================================================================== */

function depenetrate() {
  const pos = CTX.pos, vel = CTX.vel, r = CTX.res;
  for (let iter = 0; iter < 4; iter++) {
    setPlayerBox();
    const cands = queryCands(CAND_A);

    let best = null, bestDepth = Infinity;
    let bnx = 0, bny = 0, bnz = 0;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.solid === false) continue;
      const d = mtv(c, TMPN);
      if (d <= EPS) continue;
      // Smallest penetration first: the minimum-translation principle. It also
      // means a player clipped into a seam is nudged, never launched.
      if (d < bestDepth - 1e-6 || (d < bestDepth + 1e-6 && best !== null && c.id < best.id)) {
        bestDepth = d; best = c; bnx = TMPN.x; bny = TMPN.y; bnz = TMPN.z;
      }
    }
    if (best === null) break;

    pos.x += bnx * bestDepth;
    pos.y += bny * bestDepth;
    pos.z += bnz * bestDepth;

    const vn = vel.x * bnx + vel.y * bny + vel.z * bnz;
    if (vn < 0) { vel.x -= bnx * vn; vel.y -= bny * vn; vel.z -= bnz * vn; }

    r.contacts++;
    classifyContact(bnx, bny, bnz, best);
  }
}

/* ===========================================================================
 * Downward probe — shared by the contact feeler, the ground snap and the carry
 * ======================================================================== */

/**
 * Drop the player box by `maxD` and find the highest surface it lands on.
 * Fills PROBE. Restores `pos.y` before returning — this never moves anything.
 * PROBE.gap is the distance from the feet down to that surface.
 */
function probeDown(maxD) {
  PROBE.hit = false; PROBE.lift = 0; PROBE.gap = maxD;
  PROBE.collider = null; PROBE.nx = 0; PROBE.ny = 1; PROBE.nz = 0;

  const pos = CTX.pos;
  const saveY = pos.y;
  pos.y = saveY - maxD;
  setPlayerBox();
  const cands = queryCands(CAND_B);

  let bestLift = -1, best = null, bestArea = -1;
  let bnx = 0, bny = 1, bnz = 0;

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.solid === false) continue;

    let lift = -1, nx = 0, ny = 1, nz = 0, area = 0;

    if (c.axisAligned) {
      const hx = c.half.x + PH.x, hy = c.half.y + PH.y, hz = c.half.z + PH.z;
      const dx = PC.x - c.center.x, dy = PC.y - c.center.y, dz = PC.z - c.center.z;
      const ox = hx - Math.abs(dx); if (ox <= EPS) continue;
      const oy = hy - Math.abs(dy); if (oy <= EPS) continue;
      const oz = hz - Math.abs(dz); if (oz <= EPS) continue;
      lift = hy - dy;
      area = ox * oz;
    } else {
      inflatedHalf(c, PH, HE);
      c.toLocal(PC, LP);
      const o0 = HE.x - Math.abs(LP.x); if (o0 <= EPS) continue;
      const o1 = HE.y - Math.abs(LP.y); if (o1 <= EPS) continue;
      const o2 = HE.z - Math.abs(LP.z); if (o2 <= EPS) continue;
      let bl = Infinity;
      for (let j = 0; j < 3; j++) {
        const o = j === 0 ? o0 : (j === 1 ? o1 : o2);
        const l = j === 0 ? LP.x : (j === 1 ? LP.y : LP.z);
        const s = l >= 0 ? 1 : -1;
        const av = j === 0 ? c.ax : (j === 1 ? c.ay : c.az);
        const ny2 = av.y * s;
        if (ny2 < MIN_AXIS_N) continue;
        const cand = o / ny2;
        if (cand < bl) { bl = cand; nx = av.x * s; ny = ny2; nz = av.z * s; }
      }
      if (bl === Infinity) continue;
      lift = bl;
      const b = c.aabb;
      const ow = Math.min(PC.x + PH.x, b.max.x) - Math.max(PC.x - PH.x, b.min.x);
      const od = Math.min(PC.z + PH.z, b.max.z) - Math.max(PC.z - PH.z, b.min.z);
      area = (ow > 0 ? ow : 0) * (od > 0 ? od : 0);
    }

    if (lift < 0 || lift > maxD + EPS) continue;
    let take = false;
    if (best === null) take = true;
    else if (lift > bestLift + 1e-4) take = true;                    // higher surface wins
    else if (lift > bestLift - 1e-4 && area > bestArea) take = true; // then bigger footprint
    if (take) { best = c; bestLift = lift; bestArea = area; bnx = nx; bny = ny; bnz = nz; }
  }

  pos.y = saveY;
  setPlayerBox();

  if (best !== null) {
    PROBE.hit = true;
    PROBE.lift = bestLift;
    PROBE.gap = maxD - bestLift;
    if (PROBE.gap < 0) PROBE.gap = 0;
    PROBE.collider = best;
    PROBE.nx = bnx; PROBE.ny = bny; PROBE.nz = bnz;
  }
  return PROBE;
}

/**
 * Contact feeler + ground snap.
 *  - feeler: a surface within CONTACT_GAP below the feet counts as ground and
 *    the player is NOT moved. This keeps `grounded` stable across frames so
 *    coyote time and jump buffering behave, without any stickiness.
 *  - snap: only when the player was grounded, is not rising, and did not jump
 *    this frame. Pulls the feet down up to SNAP_DIST so running down a stair
 *    or a shallow ramp does not launch you. A real ledge is a bigger drop than
 *    SNAP_DIST, so running off one is never glued.
 */
function groundProbe() {
  const r = CTX.res, pos = CTX.pos, vel = CTX.vel;
  if (r.grounded) return;
  if (vel.y > 1e-4) return;                 // rising: never ground, never snap

  probeDown(SNAP_DIST);
  if (!PROBE.hit) return;
  if (PROBE.ny < GROUND_NY) return;         // too steep to stand on

  if (PROBE.gap <= CONTACT_GAP) {
    r.grounded = true;
    r.groundCollider = PROBE.collider;
    r.groundNormal.set(PROBE.nx, PROBE.ny, PROBE.nz);
    if (vel.y < 0) vel.y = 0;
    return;
  }

  const wants = CTX.wantSnap === null ? CTX.grounded : CTX.wantSnap;
  if (!wants || !CTX.allowSnap) return;

  pos.y -= PROBE.gap;
  setPlayerBox();
  r.grounded = true;
  r.groundCollider = PROBE.collider;
  r.groundNormal.set(PROBE.nx, PROBE.ny, PROBE.nz);
  if (vel.y < 0) vel.y = 0;
}

/**
 * Wall contact feeler.
 *
 * The sweeps only report a wall on the frame the player actually moves into
 * it. Once flush, a controller that has had its into-wall velocity zeroed can
 * produce a frame with no motion on that axis and the wall would vanish for a
 * frame — which reads as a dropped wall-jump. This finds walls the player is
 * merely TOUCHING (within FEELER metres) without moving anything.
 *
 * Steps are excluded: anything whose top is within stepUp of the feet is
 * something you walk onto, not something you wall-jump off.
 */
function wallFeeler() {
  const r = CTX.res;
  if (r.walls.length > 0) return;

  const sx = PH.x, sz = PH.z;
  PH.x = sx + FEELER;
  PH.z = sz + FEELER;
  setPlayerBox();

  const cands = queryCands(CAND_B);
  const stepTop = CTX.pos.y + CTX.stepUp + 1e-3;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.solid === false) continue;
    if (c.aabb.max.y <= stepTop) continue;      // a step, not a wall
    if (mtv(c, TMPN) <= EPS) continue;
    if (TMPN.y >= GROUND_NY || TMPN.y <= -GROUND_NY) continue;
    addWall(TMPN.x, TMPN.y, TMPN.z, c);
    if (r.walls.length >= WALL_POOL.length) break;
  }

  PH.x = sx;
  PH.z = sz;
  setPlayerBox();
}

/* ===========================================================================
 * Moving platforms — carry, push, crush
 * ======================================================================== */

/**
 * Ride `gc` for `sdt`: translate by its linear velocity and ROTATE about its
 * spin axis by exactly angVel * sdt.
 *
 * Why a rotation and not the tangent step `velocityAt(pos) * sdt`: the tangent
 * of a circle leaves the circle. A step of (w x r) * dt lengthens |r| by a
 * factor sqrt(1 + (w dt)^2) — (w dt)^2 / 2 relative — every substep it is
 * applied, and nothing ever pulls it back. On spire-3's ice carousel (radius
 * 6 m, period 5 s, w = 1.257 rad/s) that is 5.5e-5 per 1/120 s substep, 3.9 cm
 * of outward creep every second of simply standing still, straight off the
 * outer edge: measured +0.418 m of radial creep over two revolutions
 * (predicted +0.403). A spinning rotor deck creeps the same way. Rotating the
 * offset from the pivot by the exact angle preserves |r| to floating point, so
 * the rider stays on the spot they stood on. Reads the same `ref` fields
 * Collider.velocityAt does (world/collider.js:25-28): a scalar angVel spins
 * about angAxis (default +Y), a vector angVel is the axis-scaled rate. Nothing
 * here allocates.
 */
function carryOn(gc, pos, sdt) {
  const ref = gc.ref;
  if (!ref) return;

  const lin = ref.linVel;
  if (lin) {
    pos.x += (Number(lin.x) || 0) * sdt;
    pos.y += (Number(lin.y) || 0) * sdt;
    pos.z += (Number(lin.z) || 0) * sdt;
  }

  const av = ref.angVel;
  if (av === undefined || av === null) return;
  let wx = 0, wy = 0, wz = 0;
  if (typeof av === 'number') {
    if (av === 0 || !isFinite(av)) return;
    const axis = ref.angAxis;
    if (axis) { wx = (axis.x || 0) * av; wy = (axis.y || 0) * av; wz = (axis.z || 0) * av; }
    else wy = av;
  } else {
    wx = Number(av.x) || 0; wy = Number(av.y) || 0; wz = Number(av.z) || 0;
  }
  const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (!(w > 1e-9) || !isFinite(w)) return;

  const theta = w * sdt;
  const kx = wx / w, ky = wy / w, kz = wz / w;
  const cc = ref.angCenter || gc.center;
  const rx = pos.x - cc.x, ry = pos.y - cc.y, rz = pos.z - cc.z;
  // Rodrigues: r' = r cos(th) + (k x r) sin(th) + k (k . r) (1 - cos(th)).
  // Its first-order term is (k x r) * th = (w x r) * sdt — the tangent step —
  // so the sign convention is velocityAt's exactly.
  const c = Math.cos(theta), s = Math.sin(theta), m = 1 - c;
  const kd = kx * rx + ky * ry + kz * rz;
  const cx = ky * rz - kz * ry, cy = kz * rx - kx * rz, cz = kx * ry - ky * rx;
  pos.x = cc.x + rx * c + cx * s + kx * kd * m;
  pos.y = cc.y + ry * c + cy * s + ky * kd * m;
  pos.z = cc.z + rz * c + cz * s + kz * kd * m;
}

function carryAndPush(sdt) {
  const pos = CTX.pos, r = CTX.res;

  // --- carry: ride whatever we are standing on ---
  if (CTX.grounded) {
    probeDown(CARRY_DIST);
    const gc = PROBE.collider;
    if (gc !== null && gc.isMoving()) carryOn(gc, pos, sdt);
  }

  // --- push: a mover sweeping into the player displaces them, never eats them ---
  setPlayerBox();
  const cands = queryCands(CAND_A);
  let pushed = false;

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.solid === false) continue;
    if (!c.isMoving()) continue;
    if (mtv(c, TMPN) <= EPS) continue;

    c.velocityAt(PC, TMPV);
    const ax = Math.abs(TMPV.x), ay = Math.abs(TMPV.y), az = Math.abs(TMPV.z);
    let A, av;
    if (ay >= ax && ay >= az) { A = 1; av = TMPV.y; }
    else if (ax >= az) { A = 0; av = TMPV.x; }
    else { A = 2; av = TMPV.z; }
    if (Math.abs(av) < 1e-4) continue;

    const dir = av > 0 ? 1 : -1;
    const mag = exitAlong(c, A, dir);
    if (mag <= 0 || mag > 8) continue;

    if (A === 0) pos.x += dir * mag;
    else if (A === 1) pos.y += dir * mag;
    else pos.z += dir * mag;
    pushed = true;
    setPlayerBox();
  }

  // --- crush: the displacement itself was blocked by static geometry ---
  if (pushed) {
    const c2 = queryCands(CAND_B);
    for (let i = 0; i < c2.length; i++) {
      const c = c2[i];
      if (c.solid === false) continue;
      if (c.isMoving()) continue;
      if (mtv(c, TMPN) > CRUSH_DEPTH) { r.crushed = true; break; }
    }
  }
}

/* ===========================================================================
 * PUBLIC API
 * ======================================================================== */

/**
 * Move the player by `vel * dt`, resolving the world.
 *
 * @param {{pos:THREE.Vector3, vel:THREE.Vector3, radius?:number, height?:number,
 *          crouching?:boolean, grounded?:boolean, jumped?:boolean}} state
 *        `pos` is the FEET position. `pos` and `vel` are mutated in place.
 *        `grounded` is last frame's value and gates the ground snap.
 * @param {{broadphase:object, killVolumes?:object[], colliders?:object[]}} world
 * @param {number} dt seconds
 * @returns {typeof RESULT} the shared, reused CollisionResult
 */
export function moveAndCollide(state, world, dt) {
  const r = resetResult();
  const pos = state.pos, vel = state.vel;
  if (!pos || !vel) return r;

  r.hitVel.copy(vel);
  ENTRY_POS.copy(pos);

  if (!(dt > 0) || !isFinite(dt)) dt = 0;

  const radius = numOr(state.radius, numOr(TUNE.radius, 0.35));
  const height = numOr(state.height,
    state.crouching ? numOr(TUNE.crouchHeight, 1.05) : numOr(TUNE.height, 1.8));
  const halfH = Math.max(height * 0.5, 0.05);

  PH.set(Math.max(radius, 1e-3), halfH, Math.max(radius, 1e-3));

  CTX.pos = pos;
  CTX.vel = vel;
  CTX.res = r;
  CTX.halfH = halfH;
  CTX.radius = radius;
  CTX.stepUp = numOr(state.stepUp, numOr(TUNE.stepUp, 0.55));
  CTX.bp = (world && world.broadphase) ? world.broadphase : null;
  CTX.list = (!CTX.bp && world && Array.isArray(world.colliders)) ? world.colliders : null;
  CTX.grounded = state.grounded === true || state.wasGrounded === true;
  // The caller may veto the down-snap two ways: `justJumped`/`jumped` for the
  // impulse frame, and `wantSnap:false` for a deliberate ledge departure the
  // controller does not want undone. Contact DETECTION is never vetoed — only
  // the movement — so `grounded` still reflects reality.
  CTX.allowSnap = state.jumped !== true && state.jumpedThisFrame !== true && state.justJumped !== true;
  CTX.wantSnap = (typeof state.wantSnap === 'boolean') ? state.wantSnap : null;

  if (CTX.bp === null && CTX.list === null) {
    // No world to collide with — free flight rather than a frozen player.
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    return r;
  }

  // ---- substeps: never advance more than 0.7 * radius in one resolve ----
  const stepLimit = Math.max(radius * 0.7, 1e-4);
  const travel = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) * dt;
  let n = Math.ceil(travel / stepLimit);
  if (!(n >= 1) || !isFinite(n)) n = 1;
  if (n > 8) n = 8;
  const sdt = dt / n;
  r.substeps = n;

  for (let s = 0; s < n; s++) {
    r.grounded = false;
    r.groundCollider = null;
    r.groundNormal.set(0, 1, 0);

    carryAndPush(sdt);
    sweepAxis(0, vel.x * sdt);
    sweepAxis(2, vel.z * sdt);
    sweepAxis(1, vel.y * sdt);
    depenetrate();
    groundProbe();

    CTX.grounded = r.grounded;
  }

  wallFeeler();

  // ---- surface + platform velocity from the final ground contact ----
  const gc = r.groundCollider;
  if (gc !== null) {
    r.surface = gc.surface || 'normal';
    r.surfaceProps = gc.props || null;
    if (gc.isMoving()) gc.velocityAt(pos, r.platformVel);
  }

  // ---- hazard test against the resolved position (extra, safe to ignore) ----
  const kv = world && world.killVolumes;
  if (kv && kv.length > 0) {
    const cap = capsuleFor(state, Scratch.cap);
    for (let i = 0; i < kv.length; i++) {
      const v = kv[i];
      if (!v || v.active === false) continue;
      if (v.hits(cap)) { r.kill = v; r.killKind = v.kind || null; break; }
    }
  }

  // ---- last line of defence: never hand back a NaN position ----
  if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
    pos.copy(ENTRY_POS);
    vel.set(0, 0, 0);
  }

  return r;
}

/**
 * Cast a downward ray from `pos` and report the first solid surface.
 * Used by the contact-shadow blob and by hazards asking "is the player above
 * me?". The returned object is reused — copy what you keep.
 *
 * @param {THREE.Vector3} pos world origin (normally the player's feet)
 * @param {{broadphase:object, colliders?:object[]}} world
 * @param {number} [maxDist=8]
 * @returns {{hit:boolean, dist:number, collider:object|null,
 *            normal:THREE.Vector3, point:THREE.Vector3}}
 */
export function sweepGround(pos, world, maxDist) {
  const md = (typeof maxDist === 'number' && maxDist > 0) ? maxDist : 8;
  const h = GROUND_HIT;
  h.hit = false;
  h.dist = md;
  h.collider = null;
  h.normal.set(0, 1, 0);
  h.point.set(pos.x, pos.y - md, pos.z);
  if (!world) return h;

  const bp = world.broadphase || null;
  const list = (!bp && Array.isArray(world.colliders)) ? world.colliders : null;
  if (!bp && !list) return h;

  // Start a hair above the origin so standing exactly on a surface is not a
  // degenerate on-boundary case.
  const lift = 0.05;
  const oy = pos.y + lift;
  RAY_BOX.min.set(pos.x - 1e-3, pos.y - md, pos.z - 1e-3);
  RAY_BOX.max.set(pos.x + 1e-3, oy, pos.z + 1e-3);

  let cands;
  if (bp) {
    cands = bp.query(RAY_BOX, RAY_CANDS);
  } else {
    RAY_CANDS.length = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.active === false || !c.aabb) continue;
      if (c.aabb.intersectsBox(RAY_BOX)) RAY_CANDS.push(c);
    }
    cands = RAY_CANDS;
  }

  let bestT = md + lift;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.solid === false) continue;
    const t = rayDown(c, pos.x, oy, pos.z, bestT, NRM);
    if (t >= 0 && t < bestT) {
      bestT = t;
      h.hit = true;
      h.collider = c;
      h.normal.copy(NRM);
    }
  }

  if (h.hit) {
    let d = bestT - lift;
    if (d < 0) d = 0;
    h.dist = d;
    h.point.set(pos.x, pos.y - d, pos.z);
  }
  return h;
}

/** Downward ray (0,-1,0) against one collider. Returns t or -1. */
function rayDown(c, ox, oy, oz, maxT, outN) {
  if (c.axisAligned) {
    const b = c.aabb;
    if (ox < b.min.x || ox > b.max.x || oz < b.min.z || oz > b.max.z) return -1;
    let t = oy - b.max.y;
    if (t < 0) {
      if (oy < b.min.y) return -1;   // entirely above us — the ray goes away from it
      t = 0;                          // origin is inside
    }
    if (t > maxT) return -1;
    outN.set(0, 1, 0);
    return t;
  }

  const px = ox - c.center.x, py = oy - c.center.y, pz = oz - c.center.z;
  _rl[0] = px * c.ax.x + py * c.ax.y + pz * c.ax.z;
  _rl[1] = px * c.ay.x + py * c.ay.y + pz * c.ay.z;
  _rl[2] = px * c.az.x + py * c.az.y + pz * c.az.z;
  _rd[0] = -c.ax.y; _rd[1] = -c.ay.y; _rd[2] = -c.az.y;
  _rh[0] = c.half.x; _rh[1] = c.half.y; _rh[2] = c.half.z;

  let tmin = 0, tmax = maxT, hitJ = -1, hitS = 1;
  for (let j = 0; j < 3; j++) {
    const dj = _rd[j], lj = _rl[j], hj = _rh[j];
    if (dj > -1e-9 && dj < 1e-9) {
      if (lj < -hj || lj > hj) return -1;
      continue;
    }
    const inv = 1 / dj;
    let t1 = (-hj - lj) * inv;
    let t2 = (hj - lj) * inv;
    const s = dj > 0 ? -1 : 1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; hitJ = j; hitS = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin > maxT) return -1;
  if (hitJ < 0) { outN.set(0, 1, 0); return tmin; }
  const av = hitJ === 0 ? c.ax : (hitJ === 1 ? c.ay : c.az);
  outN.set(av.x * hitS, av.y * hitS, av.z * hitS);
  return tmin;
}

/**
 * Build the player's kill-test capsule from their state.
 * The capsule is inscribed in the collision box: two sphere centres on the
 * body axis, radius = the player radius.
 *
 * @param {{pos:THREE.Vector3, radius?:number, height?:number, crouching?:boolean}} state
 * @param {{a:THREE.Vector3,b:THREE.Vector3,r:number}} [out]
 * @returns {{a:THREE.Vector3,b:THREE.Vector3,r:number}}
 */
export function capsuleFor(state, out) {
  let o = out;
  if (!o) o = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.35 };
  if (!o.a) o.a = new THREE.Vector3();
  if (!o.b) o.b = new THREE.Vector3();

  const pos = state.pos;
  const radius = numOr(state.radius, numOr(TUNE.radius, 0.35));
  const height = numOr(state.height,
    state.crouching ? numOr(TUNE.crouchHeight, 1.05) : numOr(TUNE.height, 1.8));
  const r = Math.min(Math.max(radius, 1e-3), Math.max(height * 0.5, 1e-3));

  o.r = r;
  o.a.set(pos.x, pos.y + r, pos.z);
  o.b.set(pos.x, pos.y + Math.max(height - r, r), pos.z);
  return o;
}

function numOr(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
