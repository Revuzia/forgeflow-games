/**
 * CRESTBOUND — runtime/world/collider.js
 * ---------------------------------------------------------------------------
 * The correctness backbone: solid oriented boxes, kill volumes, trigger
 * volumes, terrain heightfields and the broadphase that finds them.
 * CONTRACT §9.
 *
 * Ported by transliteration from ASCENDANT's proven collider (same studio,
 * first-person obby). Everything Ascendant proved is kept verbatim — the
 * oriented-box maths, the exact segment/box distance, the spatial hash, the
 * mover velocity fields. Added for a third-person analog platformer:
 *
 *   Volume       — a non-solid oriented box the player can be INSIDE of:
 *                  water, quicksand, wind, current, ladder, checkpoint, trigger,
 *                  coinsField. Point containment and a capsule overlap test.
 *   Heightfield  — rolling terrain: a regular grid of heights with a bilinear
 *                  surface, an analytic normal (bilinear blend of the four
 *                  surrounding nodes' central-difference gradients — smooth and
 *                  second-order, see `normalAt`) and a marching raycast.
 *   Broadphase   — now also owns `heightfields[]` and has `raycast()` against
 *                  oriented boxes (slab test in the box's local frame) AND the
 *                  heightfields, for the camera pull-in and hazard probes.
 *   KillVolume   — kinds extended with 'toxic' | 'gnasher' | 'warden'.
 *
 * Design rules honoured here:
 *  - ZERO per-frame heap allocation. Every method that runs in the update path
 *    either writes into a caller-supplied `out` or uses a module-scope scratch.
 *  - Every query result is a SUPERSET-free tight candidate list: the broadphase
 *    re-tests world AABBs so hash collisions and cell granularity never leak
 *    bogus candidates into the narrow phase.
 *  - Colliders that move every frame are cheap to keep current: `update()`
 *    re-derives the world AABB and (if the collider is registered) rehashes
 *    itself only when its occupied cell set actually changed.
 *
 * INTEGRATION NOTES FOR OTHER MODULES
 * -----------------------------------
 *  - Vectors passed to the constructors are COPIED, never aliased. To move a
 *    collider, mutate `collider.center` / `collider.quat` in place and call
 *    `collider.update()`. If the collider is registered in a Broadphase,
 *    `update()` rehashes it for you — you never need to call `refresh()`.
 *  - `Collider.ref` is the owning hazard. For carry/push the player collision
 *    reads these OPTIONAL fields off the ref every frame:
 *        ref.linVel    THREE.Vector3   linear velocity, m/s
 *        ref.angVel    number | Vec3   rad/s (scalar => about `ref.angAxis`)
 *        ref.angAxis   THREE.Vector3   unit rotation axis (default +Y)
 *        ref.angCenter THREE.Vector3   world pivot (default collider.center)
 *    A hazard that sets these gets platform carry, push and crush for free.
 *  - `Collider.solid` defaults to true, and is forced false for colliders in
 *    the 'trigger' / 'sensor' groups. The player never blocks against a
 *    non-solid collider, but the broadphase still returns it, so checkpoint /
 *    coin / portal volumes can live in the same broadphase.
 *  - `Collider.active = false` removes the collider from every query result
 *    (vanished platforms) without touching the spatial hash.
 *  - `Collider.props.breakable = true` marks a ground-pound target. The
 *    resolver stays solid against it and REPORTS it (`result.breakable`); the
 *    controller breaks it (`active = false`, FX) — see player/collide.js.
 *  - A Heightfield is NOT hashed into the cell grid (a terrain is one object
 *    the size of the course); the player resolver and the raycast walk
 *    `broadphase.heightfields` directly. There are at most a handful per course.
 */

import * as THREE from 'three';

/** Contact epsilon. Overlaps shallower than this are treated as touching. */
export const EPS = 1e-4;

/** Quaternion components below this are treated as an identity rotation. */
const IDENT_EPS = 1e-7;

/** Colliders thinner than this in any axis are inflated (keeps the maths sane). */
const MIN_HALF = 1e-3;

/** KillVolume kinds — CONTRACT §9. The kind is free text; these are the canon. */
export const KILL_KINDS = Object.freeze(['lava', 'void', 'spike', 'crush', 'saw', 'toxic', 'gnasher', 'warden']);

/** Volume kinds — CONTRACT §9. */
export const VOLUME_KINDS = Object.freeze(['water', 'quicksand', 'wind', 'current', 'ladder', 'checkpoint', 'trigger', 'coinsField']);

let _nextId = 1;

/* ===========================================================================
 * Module-private temporaries. NEVER handed out — `Scratch` below is the
 * public one. Keeping them separate means a consumer using Scratch can call
 * into a Collider method mid-computation without having its values stomped.
 * ======================================================================== */

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _e0 = new THREE.Euler();

// raycast-private scratch (Broadphase.raycast / Heightfield.raycast)
const _rayDir = new THREE.Vector3();
const _rayBox = new THREE.Box3();
const _rayN = new THREE.Vector3();
const _rayCands = [];
const _hfHit = { normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3() };
const _rl = new Float64Array(3);
const _rd = new Float64Array(3);
const _rh = new Float64Array(3);

/**
 * Shared temporaries for the collision consumers (runtime/player/collide.js).
 * Nothing inside collider.js touches these, so they are safe to hold across a
 * call into any Collider / KillVolume / Volume / Heightfield / Broadphase method.
 */
export const Scratch = {
  v0: new THREE.Vector3(), v1: new THREE.Vector3(), v2: new THREE.Vector3(),
  v3: new THREE.Vector3(), v4: new THREE.Vector3(), v5: new THREE.Vector3(),
  v6: new THREE.Vector3(), v7: new THREE.Vector3(), v8: new THREE.Vector3(),
  v9: new THREE.Vector3(),
  q0: new THREE.Quaternion(), q1: new THREE.Quaternion(),
  b0: new THREE.Box3(), b1: new THREE.Box3(),
  /** A reusable player capsule {a,b,r}. */
  cap: { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.38 },
  /** Reusable candidate arrays for broadphase queries. */
  list0: [], list1: [], list2: [],
  /** A reusable raycast result for Broadphase.raycast(). */
  ray: { t: 0, normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(), collider: null, heightfield: null },
};

/* ===========================================================================
 * Liberal input parsing — other agents author course data as plain arrays.
 * ======================================================================== */

function readVec3(src, out, dx, dy, dz) {
  const ax = dx === undefined ? 0 : dx;
  const ay = dy === undefined ? ax : dy;
  const az = dz === undefined ? ax : dz;
  if (src === null || src === undefined) { out.set(ax, ay, az); return out; }
  if (src.isVector3 === true) { out.copy(src); return out; }
  if (typeof src === 'number') { out.set(src, src, src); return out; }
  if (Array.isArray(src) || ArrayBuffer.isView(src)) {
    out.set(Number(src[0]) || 0, Number(src[1]) || 0, Number(src[2]) || 0);
    return out;
  }
  if (typeof src === 'object') {
    out.set(
      typeof src.x === 'number' ? src.x : ax,
      typeof src.y === 'number' ? src.y : ay,
      typeof src.z === 'number' ? src.z : az,
    );
    return out;
  }
  out.set(ax, ay, az);
  return out;
}

function readQuat(src, out) {
  if (src === null || src === undefined) { out.set(0, 0, 0, 1); return out; }
  if (src.isQuaternion === true) { out.copy(src); return out; }
  if (src.isEuler === true) { out.setFromEuler(src); return out; }
  if (typeof src === 'number') {
    // A bare number is a yaw in radians — the common authoring case.
    _e0.set(0, src, 0, 'XYZ');
    out.setFromEuler(_e0);
    return out;
  }
  if (Array.isArray(src) || ArrayBuffer.isView(src)) {
    if (src.length >= 4) {
      out.set(Number(src[0]) || 0, Number(src[1]) || 0, Number(src[2]) || 0, Number(src[3]) || 0);
      if (out.lengthSq() < 1e-12) out.set(0, 0, 0, 1); else out.normalize();
      return out;
    }
    _e0.set(Number(src[0]) || 0, Number(src[1]) || 0, Number(src[2]) || 0, 'XYZ');
    out.setFromEuler(_e0);
    return out;
  }
  if (typeof src === 'object') {
    if (typeof src.w === 'number') {
      out.set(Number(src.x) || 0, Number(src.y) || 0, Number(src.z) || 0, src.w);
      if (out.lengthSq() < 1e-12) out.set(0, 0, 0, 1); else out.normalize();
      return out;
    }
    _e0.set(Number(src.x) || 0, Number(src.y) || 0, Number(src.z) || 0, src.order || 'XYZ');
    out.setFromEuler(_e0);
    return out;
  }
  out.set(0, 0, 0, 1);
  return out;
}

function readHalf(opts, out) {
  if (opts.half !== undefined && opts.half !== null) {
    readVec3(opts.half, out, 0.5, 0.5, 0.5);
  } else if (opts.size !== undefined && opts.size !== null) {
    readVec3(opts.size, out, 1, 1, 1).multiplyScalar(0.5);
  } else if (opts.s !== undefined && opts.s !== null) {
    readVec3(opts.s, out, 1, 1, 1).multiplyScalar(0.5);
  } else if (opts.min && opts.max) {
    readVec3(opts.max, _p0);
    readVec3(opts.min, _p1);
    out.subVectors(_p0, _p1).multiplyScalar(0.5);
  } else {
    out.set(0.5, 0.5, 0.5);
  }
  out.x = Math.max(Math.abs(out.x), MIN_HALF);
  out.y = Math.max(Math.abs(out.y), MIN_HALF);
  out.z = Math.max(Math.abs(out.z), MIN_HALF);
  return out;
}

function readCenter(opts, half, out) {
  const src = opts.center !== undefined ? opts.center
    : (opts.p !== undefined ? opts.p : opts.position);
  if (src === undefined && opts.min && opts.max) {
    readVec3(opts.max, _p0);
    readVec3(opts.min, _p1);
    return out.addVectors(_p0, _p1).multiplyScalar(0.5);
  }
  return readVec3(src, out, 0, 0, 0);
}

function readRot(opts) {
  return opts.quat !== undefined ? opts.quat
    : (opts.rot !== undefined ? opts.rot : opts.rotation);
}

function numOr(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/**
 * Derive the oriented basis + world AABB shared by every box-shaped thing here
 * (Collider, KillVolume box, Volume). `o` must carry center/half/quat/ax/ay/az/
 * aabb; `abs` (optional) receives the |axis| vectors. Returns axisAligned.
 */
function updateBoxBasis(o, withAbs) {
  const q = o.quat, c = o.center, h = o.half;
  const aligned = Math.abs(q.x) < IDENT_EPS && Math.abs(q.y) < IDENT_EPS && Math.abs(q.z) < IDENT_EPS;
  if (aligned) {
    o.ax.set(1, 0, 0); o.ay.set(0, 1, 0); o.az.set(0, 0, 1);
    if (withAbs) { o.absAx.set(1, 0, 0); o.absAy.set(0, 1, 0); o.absAz.set(0, 0, 1); }
    o.aabb.min.set(c.x - h.x, c.y - h.y, c.z - h.z);
    o.aabb.max.set(c.x + h.x, c.y + h.y, c.z + h.z);
  } else {
    o.ax.set(1, 0, 0).applyQuaternion(q);
    o.ay.set(0, 1, 0).applyQuaternion(q);
    o.az.set(0, 0, 1).applyQuaternion(q);
    const axx = Math.abs(o.ax.x), axy = Math.abs(o.ax.y), axz = Math.abs(o.ax.z);
    const ayx = Math.abs(o.ay.x), ayy = Math.abs(o.ay.y), ayz = Math.abs(o.ay.z);
    const azx = Math.abs(o.az.x), azy = Math.abs(o.az.y), azz = Math.abs(o.az.z);
    if (withAbs) { o.absAx.set(axx, axy, axz); o.absAy.set(ayx, ayy, ayz); o.absAz.set(azx, azy, azz); }
    // World extent along axis i = sum_j |R[i][j]| * half[j], and R[i][j] is
    // component i of local axis j — i.e. read the abs axes column-wise.
    const ex = axx * h.x + ayx * h.y + azx * h.z;
    const ey = axy * h.x + ayy * h.y + azy * h.z;
    const ez = axz * h.x + ayz * h.y + azz * h.z;
    o.aabb.min.set(c.x - ex, c.y - ey, c.z - ez);
    o.aabb.max.set(c.x + ex, c.y + ey, c.z + ez);
  }
  return aligned;
}

/** World point -> local frame of an oriented box `o` (center/ax/ay/az/axisAligned). */
function boxToLocal(o, p, out) {
  const dx = p.x - o.center.x, dy = p.y - o.center.y, dz = p.z - o.center.z;
  if (o.axisAligned) { out.set(dx, dy, dz); return out; }
  out.set(
    dx * o.ax.x + dy * o.ax.y + dz * o.ax.z,
    dx * o.ay.x + dy * o.ay.y + dz * o.ay.z,
    dx * o.az.x + dy * o.az.y + dz * o.az.z,
  );
  return out;
}

/* ===========================================================================
 * 1. Collider — a solid oriented box.
 * ======================================================================== */

export class Collider {
  /**
   * @param {object} opts
   * @param {THREE.Vector3|number[]} [opts.center] world centre (also `p`)
   * @param {THREE.Vector3|number[]} [opts.half]   half extents (also `size`/`s` for full extents)
   * @param {THREE.Quaternion|THREE.Euler|number[]|number} [opts.quat] orientation (also `rot`)
   * @param {string} [opts.surface='normal'] 'normal'|'ice'|'bounce'|'speed'|'conveyor'|'sticky'|'nostick'|'grass'|'stone'|'metal'|'wood'|'snow'|'sand'
   * @param {object} [opts.props]  surface parameters {power, dir, breakable, ...}
   * @param {object} [opts.ref]    owning hazard (velocity source for carry/push)
   * @param {string} [opts.group='world'] 'world'|'hazard'|'trigger'|'sensor'|...
   * @param {boolean} [opts.solid=true] false => never blocks the player
   * @param {boolean} [opts.active=true]
   */
  constructor(opts = {}) {
    /** Monotonic id — used for deterministic tie-breaking and dedupe. */
    this.id = _nextId++;

    this.half = readHalf(opts, new THREE.Vector3());
    this.center = readCenter(opts, this.half, new THREE.Vector3());
    this.quat = readQuat(readRot(opts), new THREE.Quaternion());
    this.invQuat = new THREE.Quaternion();

    /** Local X/Y/Z axes expressed in world space (columns of the rotation matrix). */
    this.ax = new THREE.Vector3(1, 0, 0);
    this.ay = new THREE.Vector3(0, 1, 0);
    this.az = new THREE.Vector3(0, 0, 1);
    /** Component-wise |axis| — the "absolute rotation matrix" trick. */
    this.absAx = new THREE.Vector3(1, 0, 0);
    this.absAy = new THREE.Vector3(0, 1, 0);
    this.absAz = new THREE.Vector3(0, 0, 1);
    /** True when the box is world-axis-aligned (fast path everywhere). */
    this.axisAligned = true;

    this.surface = opts.surface || 'normal';
    this.props = opts.props || null;
    this.ref = opts.ref !== undefined ? opts.ref : null;
    this.group = opts.group || 'world';
    this.solid = opts.solid === false ? false
      : (this.group !== 'trigger' && this.group !== 'sensor');
    this.active = opts.active !== false;
    this.userData = opts.userData || null;

    /** Cached world AABB, rebuilt by update(). */
    this.aabb = new THREE.Box3();

    // --- broadphase bookkeeping (private) ---
    this._bp = null;
    this._stamp = 0;        // visited stamp: equals Broadphase._qid while visited
    this._large = false;    // true => lives in the oversized list
    this._hasCells = false;
    this._c0x = 0; this._c0y = 0; this._c0z = 0;
    this._c1x = 0; this._c1y = 0; this._c1z = 0;

    this.update();
  }

  /**
   * Recompute the orientation basis and the cached world AABB. Call after
   * mutating `center`, `half` or `quat`. Rehashes into the broadphase if the
   * collider is registered (no-op when the occupied cells did not change).
   */
  update() {
    this.axisAligned = updateBoxBasis(this, true);
    if (this.axisAligned) this.invQuat.set(0, 0, 0, 1);
    else this.invQuat.copy(this.quat).conjugate();
    if (this._bp !== null) this._bp.refresh(this);
    return this;
  }

  /** Move the collider and refresh derived data in one call. */
  setCenter(x, y, z) {
    if (typeof x === 'number') this.center.set(x, y, z);
    else readVec3(x, this.center);
    return this.update();
  }

  /** Re-orient the collider and refresh derived data in one call. */
  setQuaternion(q) {
    readQuat(q, this.quat);
    return this.update();
  }

  /** Resize the collider (half extents) and refresh derived data. */
  setHalf(x, y, z) {
    if (typeof x === 'number') this.half.set(x, y, z);
    else readVec3(x, this.half);
    this.half.set(Math.max(Math.abs(this.half.x), MIN_HALF), Math.max(Math.abs(this.half.y), MIN_HALF), Math.max(Math.abs(this.half.z), MIN_HALF));
    return this.update();
  }

  setActive(v) { this.active = !!v; return this; }

  /** World point -> collider local space (box centred at origin). */
  toLocal(pointWorld, out) {
    return boxToLocal(this, pointWorld, out || new THREE.Vector3());
  }

  /** Collider local space -> world point. */
  toWorld(pointLocal, out) {
    const o = out || new THREE.Vector3();
    if (this.axisAligned) {
      o.set(this.center.x + pointLocal.x, this.center.y + pointLocal.y, this.center.z + pointLocal.z);
      return o;
    }
    const x = pointLocal.x, y = pointLocal.y, z = pointLocal.z;
    o.set(
      this.center.x + this.ax.x * x + this.ay.x * y + this.az.x * z,
      this.center.y + this.ax.y * x + this.ay.y * y + this.az.y * z,
      this.center.z + this.ax.z * x + this.ay.z * y + this.az.z * z,
    );
    return o;
  }

  /** Rotate a local-space direction into world space (no translation). */
  dirToWorld(dirLocal, out) {
    const o = out || new THREE.Vector3();
    if (this.axisAligned) { o.copy(dirLocal); return o; }
    const x = dirLocal.x, y = dirLocal.y, z = dirLocal.z;
    o.set(
      this.ax.x * x + this.ay.x * y + this.az.x * z,
      this.ax.y * x + this.ay.y * y + this.az.y * z,
      this.ax.z * x + this.ay.z * y + this.az.z * z,
    );
    return o;
  }

  containsPoint(p) {
    const l = boxToLocal(this, p, _p0);
    return Math.abs(l.x) <= this.half.x && Math.abs(l.y) <= this.half.y && Math.abs(l.z) <= this.half.z;
  }

  /** Closest point on (or in) the box to a world point. */
  closestPoint(p, out) {
    const o = out || new THREE.Vector3();
    const l = boxToLocal(this, p, _p0);
    const h = this.half;
    l.x = l.x < -h.x ? -h.x : (l.x > h.x ? h.x : l.x);
    l.y = l.y < -h.y ? -h.y : (l.y > h.y ? h.y : l.y);
    l.z = l.z < -h.z ? -h.z : (l.z > h.z ? h.z : l.z);
    return this.toWorld(l, o);
  }

  distanceToPoint(p) {
    const l = boxToLocal(this, p, _p0);
    const h = this.half;
    const dx = Math.max(Math.abs(l.x) - h.x, 0);
    const dy = Math.max(Math.abs(l.y) - h.y, 0);
    const dz = Math.max(Math.abs(l.z) - h.z, 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * World-space surface velocity at a point: linear carry + rigid rotation.
   * Reads `ref.linVel`, `ref.angVel`, `ref.angAxis`, `ref.angCenter`.
   * @param {THREE.Vector3} p world point
   * @param {THREE.Vector3} [out]
   * @returns {THREE.Vector3} out
   */
  velocityAt(p, out) {
    const o = out || new THREE.Vector3();
    o.set(0, 0, 0);
    const ref = this.ref;
    if (!ref) return o;

    const lin = ref.linVel;
    if (lin) {
      o.x = Number(lin.x) || 0;
      o.y = Number(lin.y) || 0;
      o.z = Number(lin.z) || 0;
    }

    const av = ref.angVel;
    if (av !== undefined && av !== null) {
      let wx = 0, wy = 0, wz = 0;
      if (typeof av === 'number') {
        if (av !== 0) {
          const axis = ref.angAxis;
          if (axis) { wx = (axis.x || 0) * av; wy = (axis.y || 0) * av; wz = (axis.z || 0) * av; }
          else { wy = av; }
        }
      } else {
        wx = Number(av.x) || 0; wy = Number(av.y) || 0; wz = Number(av.z) || 0;
      }
      if (wx !== 0 || wy !== 0 || wz !== 0) {
        const cc = ref.angCenter || this.center;
        const rx = p.x - cc.x, ry = p.y - cc.y, rz = p.z - cc.z;
        o.x += wy * rz - wz * ry;
        o.y += wz * rx - wx * rz;
        o.z += wx * ry - wy * rx;
      }
    }
    return o;
  }

  /** Cheap test: does this collider carry / push anything this frame? */
  isMoving() {
    const ref = this.ref;
    if (!ref) return false;
    const l = ref.linVel;
    if (l && (l.x || l.y || l.z)) return true;
    const a = ref.angVel;
    if (typeof a === 'number') return a !== 0;
    if (a && (a.x || a.y || a.z)) return true;
    return false;
  }

  /** World-space top of the collider (used by step-up). */
  get top() { return this.aabb.max.y; }
  get bottom() { return this.aabb.min.y; }

  /** Detach from its broadphase. The collider itself is plain data. */
  dispose() {
    if (this._bp) this._bp.remove(this);
    this.ref = null;
    this.props = null;
    this.userData = null;
  }

  /** Build a collider from an axis-aligned THREE.Box3. */
  static fromBox3(box, opts) {
    const o = opts ? Object.assign({}, opts) : {};
    o.center = box.getCenter(new THREE.Vector3());
    o.half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    o.quat = null;
    return new Collider(o);
  }
}

/* ===========================================================================
 * 2. Exact primitive distance tests (scalar, allocation free).
 * ======================================================================== */

/** Breakpoint buffer for segment-vs-box. 2 endpoints + 6 slab crossings. */
const _bp = new Float64Array(10);

/**
 * EXACT squared distance from a segment to an axis-aligned box centred at the
 * origin with half extents (hx,hy,hz).
 *
 * f(t) = sum_i max(0, |a_i + t*d_i| - h_i)^2 is convex and piecewise quadratic
 * with at most six breakpoints (the slab crossings). We split [0,1] at those
 * breakpoints, and on each sub-interval the active set and signs are constant,
 * so the minimum is either the vertex of a quadratic or a sub-interval end.
 * That is exact — no iteration, no tolerance.
 */
function segBoxDistSq(ax, ay, az, bx, by, bz, hx, hy, hz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;

  let n = 0;
  _bp[n++] = 0; _bp[n++] = 1;
  if (dx !== 0) {
    const inv = 1 / dx;
    let t = (hx - ax) * inv; if (t > 0 && t < 1) _bp[n++] = t;
    t = (-hx - ax) * inv; if (t > 0 && t < 1) _bp[n++] = t;
  }
  if (dy !== 0) {
    const inv = 1 / dy;
    let t = (hy - ay) * inv; if (t > 0 && t < 1) _bp[n++] = t;
    t = (-hy - ay) * inv; if (t > 0 && t < 1) _bp[n++] = t;
  }
  if (dz !== 0) {
    const inv = 1 / dz;
    let t = (hz - az) * inv; if (t > 0 && t < 1) _bp[n++] = t;
    t = (-hz - az) * inv; if (t > 0 && t < 1) _bp[n++] = t;
  }

  // insertion sort (n <= 8)
  for (let i = 1; i < n; i++) {
    const v = _bp[i];
    let j = i - 1;
    while (j >= 0 && _bp[j] > v) { _bp[j + 1] = _bp[j]; j--; }
    _bp[j + 1] = v;
  }

  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const lo = _bp[i], hi = _bp[i + 1];
    if (hi - lo < 1e-12) continue;
    const mid = (lo + hi) * 0.5;

    let A = 0, B = 0, C = 0;
    // x
    let p = ax + mid * dx;
    if (p > hx) { const u = ax - hx, v = dx; A += v * v; B += 2 * u * v; C += u * u; }
    else if (p < -hx) { const u = -ax - hx, v = -dx; A += v * v; B += 2 * u * v; C += u * u; }
    // y
    p = ay + mid * dy;
    if (p > hy) { const u = ay - hy, v = dy; A += v * v; B += 2 * u * v; C += u * u; }
    else if (p < -hy) { const u = -ay - hy, v = -dy; A += v * v; B += 2 * u * v; C += u * u; }
    // z
    p = az + mid * dz;
    if (p > hz) { const u = az - hz, v = dz; A += v * v; B += 2 * u * v; C += u * u; }
    else if (p < -hz) { const u = -az - hz, v = -dz; A += v * v; B += 2 * u * v; C += u * u; }

    if (A === 0 && B === 0 && C === 0) return 0; // segment inside the box

    let t;
    if (A > 1e-18) {
      t = -B / (2 * A);
      if (t < lo) t = lo; else if (t > hi) t = hi;
    } else {
      t = lo;
    }
    const f = (A * t + B) * t + C;
    if (f < best) best = f;
    if (best <= 0) return 0;
  }
  return best < 0 ? 0 : best;
}

/** Squared distance from a segment to a point. */
function segPointDistSq(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const ll = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (ll > 1e-12) t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / ll;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = ax + t * dx - px, qy = ay + t * dy - py, qz = az + t * dz - pz;
  return qx * qx + qy * qy + qz * qz;
}

/** Squared distance between two segments (Ericson, Real-Time Collision Detection). */
function segSegDistSq(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0, t = 0;
  const tiny = 1e-12;
  if (a <= tiny && e <= tiny) {
    s = 0; t = 0;
  } else if (a <= tiny) {
    s = 0;
    t = f / e; if (t < 0) t = 0; else if (t > 1) t = 1;
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= tiny) {
      t = 0;
      s = -c / a; if (s < 0) s = 0; else if (s > 1) s = 1;
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom > tiny) {
        s = (b * f - c * e) / denom;
        if (s < 0) s = 0; else if (s > 1) s = 1;
      } else {
        s = 0;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = -c / a; if (s < 0) s = 0; else if (s > 1) s = 1;
      } else if (t > 1) {
        t = 1;
        s = (b - c) / a; if (s < 0) s = 0; else if (s > 1) s = 1;
      }
    }
  }
  const cx = (p1x + d1x * s) - (p2x + d2x * t);
  const cy = (p1y + d1y * s) - (p2y + d2y * t);
  const cz = (p1z + d1z * s) - (p2z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Squared distance from a world capsule segment to an oriented box `o`
 * (center/half/ax/ay/az/axisAligned): take the segment into the box's frame,
 * then the exact axis-aligned test.
 */
function capsuleBoxDistSq(o, ca, cb) {
  const c = o.center;
  const ax0 = ca.x - c.x, ay0 = ca.y - c.y, az0 = ca.z - c.z;
  const bx0 = cb.x - c.x, by0 = cb.y - c.y, bz0 = cb.z - c.z;
  let lax, lay, laz, lbx, lby, lbz;
  if (o.axisAligned) {
    lax = ax0; lay = ay0; laz = az0;
    lbx = bx0; lby = by0; lbz = bz0;
  } else {
    const X = o.ax, Y = o.ay, Z = o.az;
    lax = ax0 * X.x + ay0 * X.y + az0 * X.z;
    lay = ax0 * Y.x + ay0 * Y.y + az0 * Y.z;
    laz = ax0 * Z.x + ay0 * Z.y + az0 * Z.z;
    lbx = bx0 * X.x + by0 * X.y + bz0 * X.z;
    lby = bx0 * Y.x + by0 * Y.y + bz0 * Y.z;
    lbz = bx0 * Z.x + by0 * Z.y + bz0 * Z.z;
  }
  return segBoxDistSq(lax, lay, laz, lbx, lby, lbz, o.half.x, o.half.y, o.half.z);
}

/** Cheap capsule-vs-AABB reject shared by KillVolume.hits and Volume.overlapsCapsule. */
function capsuleAabbReject(box, cap) {
  const cr = cap.r || 0;
  const a = cap.a, b = cap.b;
  const minx = (a.x < b.x ? a.x : b.x) - cr, maxx = (a.x > b.x ? a.x : b.x) + cr;
  if (maxx < box.min.x || minx > box.max.x) return true;
  const miny = (a.y < b.y ? a.y : b.y) - cr, maxy = (a.y > b.y ? a.y : b.y) + cr;
  if (maxy < box.min.y || miny > box.max.y) return true;
  const minz = (a.z < b.z ? a.z : b.z) - cr, maxz = (a.z > b.z ? a.z : b.z) + cr;
  if (maxz < box.min.z || minz > box.max.z) return true;
  return false;
}

/* ===========================================================================
 * 3. KillVolume — box (oriented) / sphere / capsule / plane.
 * ======================================================================== */

const PLANE_BIG = 1e7;
/** Float-noise tolerance on a kill test. Not a gameplay margin. */
const HIT_SLACK = 1e-6;

export class KillVolume {
  /**
   * @param {object} opts
   * @param {'box'|'sphere'|'capsule'|'plane'} [opts.type='box']
   * @param {'lava'|'void'|'spike'|'crush'|'saw'|'toxic'|'gnasher'|'warden'|'laser'} [opts.kind='spike']
   * @param {object} [opts.ref] owning hazard / critter
   * @param {boolean} [opts.active=true]
   *
   * box:     center|p, half (or size|s = full extents), quat|rot
   * sphere:  center|p, radius|r
   * capsule: a, b, radius|r      (segment a->b swept by radius)
   * plane:   normal|n + constant|c   — kills the half-space `n . p + c >= 0`.
   *          Convenience: `{type:'plane', y:killY}` kills everything BELOW y.
   */
  constructor(opts = {}) {
    this.id = _nextId++;
    this.type = opts.type || 'box';
    this.kind = opts.kind || 'spike';
    this.ref = opts.ref !== undefined ? opts.ref : null;
    this.active = opts.active !== false;
    this.userData = opts.userData || null;

    // box
    this.center = new THREE.Vector3();
    this.half = new THREE.Vector3(0.5, 0.5, 0.5);
    this.quat = new THREE.Quaternion();
    this.ax = new THREE.Vector3(1, 0, 0);
    this.ay = new THREE.Vector3(0, 1, 0);
    this.az = new THREE.Vector3(0, 0, 1);
    this.axisAligned = true;
    // sphere / capsule
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.radius = 0.5;
    // plane
    this.normal = new THREE.Vector3(0, -1, 0);
    this.constant = 0;

    this.aabb = new THREE.Box3();

    switch (this.type) {
      case 'sphere':
        readCenter(opts, null, this.center);
        this.radius = Math.max(numOr(opts.radius, numOr(opts.r, 0.5)), 1e-3);
        break;
      case 'capsule':
        readVec3(opts.a, this.a, 0, 0, 0);
        readVec3(opts.b !== undefined ? opts.b : opts.a, this.b, 0, 0, 0);
        this.radius = Math.max(numOr(opts.radius, numOr(opts.r, 0.3)), 1e-3);
        break;
      case 'plane': {
        if (typeof opts.y === 'number' && opts.normal === undefined && opts.n === undefined) {
          this.normal.set(0, -1, 0);
          this.constant = opts.y;
        } else {
          readVec3(opts.normal !== undefined ? opts.normal : opts.n, this.normal, 0, -1, 0);
          if (this.normal.lengthSq() < 1e-12) this.normal.set(0, -1, 0);
          this.normal.normalize();
          this.constant = numOr(opts.constant, numOr(opts.c, 0));
        }
        break;
      }
      default: {
        this.type = 'box';
        readHalf(opts, this.half);
        readCenter(opts, this.half, this.center);
        readQuat(readRot(opts), this.quat);
        break;
      }
    }

    this.update();
  }

  /** Recompute the orientation basis and cached AABB after moving. */
  update() {
    switch (this.type) {
      case 'sphere': {
        const r = this.radius, c = this.center;
        this.aabb.min.set(c.x - r, c.y - r, c.z - r);
        this.aabb.max.set(c.x + r, c.y + r, c.z + r);
        break;
      }
      case 'capsule': {
        const r = this.radius, a = this.a, b = this.b;
        this.aabb.min.set(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r);
        this.aabb.max.set(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
        break;
      }
      case 'plane': {
        const n = this.normal;
        this.aabb.min.set(-PLANE_BIG, -PLANE_BIG, -PLANE_BIG);
        this.aabb.max.set(PLANE_BIG, PLANE_BIG, PLANE_BIG);
        // Tighten for the common axis-aligned case (the void plane).
        if (Math.abs(n.x) > 0.999999) {
          if (n.x > 0) this.aabb.min.x = -this.constant; else this.aabb.max.x = this.constant;
        } else if (Math.abs(n.y) > 0.999999) {
          if (n.y > 0) this.aabb.min.y = -this.constant; else this.aabb.max.y = this.constant;
        } else if (Math.abs(n.z) > 0.999999) {
          if (n.z > 0) this.aabb.min.z = -this.constant; else this.aabb.max.z = this.constant;
        }
        break;
      }
      default:
        this.axisAligned = updateBoxBasis(this, false);
        break;
    }
    return this;
  }

  setActive(v) { this.active = !!v; return this; }

  setBox(center, half, quat) {
    this.type = 'box';
    if (center) readVec3(center, this.center);
    if (half) {
      readVec3(half, this.half);
      this.half.set(Math.max(Math.abs(this.half.x), MIN_HALF), Math.max(Math.abs(this.half.y), MIN_HALF), Math.max(Math.abs(this.half.z), MIN_HALF));
    }
    if (quat !== undefined) readQuat(quat, this.quat);
    return this.update();
  }

  setSphere(center, radius) {
    this.type = 'sphere';
    if (center) readVec3(center, this.center);
    if (typeof radius === 'number') this.radius = Math.max(radius, 1e-3);
    return this.update();
  }

  setCapsule(a, b, radius) {
    this.type = 'capsule';
    if (a) readVec3(a, this.a);
    if (b) readVec3(b, this.b);
    if (typeof radius === 'number') this.radius = Math.max(radius, 1e-3);
    return this.update();
  }

  setPlane(normal, constant) {
    this.type = 'plane';
    if (normal) { readVec3(normal, this.normal); if (this.normal.lengthSq() < 1e-12) this.normal.set(0, -1, 0); this.normal.normalize(); }
    if (typeof constant === 'number') this.constant = constant;
    return this.update();
  }

  /**
   * Signed distance from the player capsule surface to this volume.
   * <= 0 means contact. Useful for FX intensity; `hits()` is the boolean.
   * @param {{a:THREE.Vector3,b:THREE.Vector3,r:number}} cap
   */
  distanceTo(cap) {
    const ca = cap.a, cb = cap.b;
    const cr = cap.r || 0;
    switch (this.type) {
      case 'sphere':
        return Math.sqrt(segPointDistSq(ca.x, ca.y, ca.z, cb.x, cb.y, cb.z,
          this.center.x, this.center.y, this.center.z)) - (this.radius + cr);
      case 'capsule':
        return Math.sqrt(segSegDistSq(ca.x, ca.y, ca.z, cb.x, cb.y, cb.z,
          this.a.x, this.a.y, this.a.z, this.b.x, this.b.y, this.b.z)) - (this.radius + cr);
      case 'plane': {
        const n = this.normal;
        const da = n.x * ca.x + n.y * ca.y + n.z * ca.z + this.constant;
        const db = n.x * cb.x + n.y * cb.y + n.z * cb.z + this.constant;
        return -((da > db ? da : db) + cr);
      }
      default:
        return Math.sqrt(capsuleBoxDistSq(this, ca, cb)) - cr;
    }
  }

  /**
   * Does the player capsule touch this volume?
   * @param {{a:THREE.Vector3,b:THREE.Vector3,r:number}} playerCapsule
   * @returns {boolean}
   */
  hits(playerCapsule) {
    if (!this.active || !playerCapsule) return false;
    // Cheap AABB reject first (planes carry a half-space AABB, so this is safe).
    if (capsuleAabbReject(this.aabb, playerCapsule)) return false;
    // HIT_SLACK absorbs float noise so an exactly-flush volume (lava level with
    // the floor the player stands on) resolves deterministically instead of
    // flickering on the last bit of a square root.
    return this.distanceTo(playerCapsule) <= HIT_SLACK;
  }

  dispose() { this.ref = null; this.userData = null; }
}

/* ===========================================================================
 * 4. Volume — a non-solid oriented box the player can be INSIDE of.
 *    water | quicksand | wind | current | ladder | checkpoint | trigger | coinsField
 * ======================================================================== */

export class Volume {
  /**
   * @param {object} opts
   * @param {THREE.Vector3|number[]} [opts.center] world centre (also `p`)
   * @param {THREE.Vector3|number[]} [opts.half]   half extents (also `size`/`s` full extents)
   * @param {THREE.Quaternion|number[]|number} [opts.quat] orientation (also `rot`); optional
   * @param {'water'|'quicksand'|'wind'|'current'|'ladder'|'checkpoint'|'trigger'|'coinsField'} [opts.kind='trigger']
   * @param {object} [opts.props] kind parameters:
   *   water:     {flow:[x,z]?, surfaceY?:number (default = aabb.max.y), kind2?}
   *   quicksand: {sink?:m/s, escapeJumpV?}
   *   wind:      {dir:[x,y,z], power:m/s²}       current: {dir:[x,y,z], power}
   *   ladder:    {axis:'y'|'pole', top?:number, pole?:[x,z]}   (poles/nets/trees)
   *   checkpoint:{index}     trigger:{id}     coinsField:{...}
   * @param {object} [opts.ref] owning hazard/course object
   * @param {boolean} [opts.active=true]
   */
  constructor(opts = {}) {
    this.id = _nextId++;
    this.kind = opts.kind || 'trigger';
    this.props = opts.props || null;
    this.ref = opts.ref !== undefined ? opts.ref : null;
    this.active = opts.active !== false;
    this.userData = opts.userData || null;
    /** Volumes are never solid — they share the field so a mixed list can be filtered uniformly. */
    this.solid = false;

    this.half = readHalf(opts, new THREE.Vector3());
    this.center = readCenter(opts, this.half, new THREE.Vector3());
    this.quat = readQuat(readRot(opts), new THREE.Quaternion());
    this.ax = new THREE.Vector3(1, 0, 0);
    this.ay = new THREE.Vector3(0, 1, 0);
    this.az = new THREE.Vector3(0, 0, 1);
    this.axisAligned = true;
    this.aabb = new THREE.Box3();

    this.update();
  }

  /** Recompute basis + AABB after mutating center/half/quat. */
  update() {
    this.axisAligned = updateBoxBasis(this, false);
    return this;
  }

  setCenter(x, y, z) {
    if (typeof x === 'number') this.center.set(x, y, z);
    else readVec3(x, this.center);
    return this.update();
  }

  setActive(v) { this.active = !!v; return this; }

  /**
   * World Y of the volume's top face. For 'water' this is the swim surface
   * (`props.surfaceY` overrides it when the visual water sits below the box).
   */
  get top() { return this.aabb.max.y; }
  get bottom() { return this.aabb.min.y; }
  get surfaceY() {
    const p = this.props;
    return (p && typeof p.surfaceY === 'number') ? p.surfaceY : this.aabb.max.y;
  }

  /** World point -> volume local space. */
  toLocal(pointWorld, out) {
    return boxToLocal(this, pointWorld, out || new THREE.Vector3());
  }

  /** Is the world point inside? Inactive volumes contain nothing. */
  contains(p) {
    if (!this.active) return false;
    const b = this.aabb;
    if (p.x < b.min.x || p.x > b.max.x || p.y < b.min.y || p.y > b.max.y || p.z < b.min.z || p.z > b.max.z) return false;
    if (this.axisAligned) return true;
    const l = boxToLocal(this, p, _p0);
    return Math.abs(l.x) <= this.half.x && Math.abs(l.y) <= this.half.y && Math.abs(l.z) <= this.half.z;
  }

  /**
   * Does the player capsule {a,b,r} overlap this volume? Exact (segment-vs-
   * oriented-box distance ≤ r), with a cheap AABB reject first.
   */
  overlapsCapsule(cap) {
    if (!this.active || !cap) return false;
    if (capsuleAabbReject(this.aabb, cap)) return false;
    const r = cap.r || 0;
    return capsuleBoxDistSq(this, cap.a, cap.b) <= r * r + HIT_SLACK;
  }

  /** Alias so a mixed list of KillVolumes and Volumes can be tested uniformly. */
  hits(cap) { return this.overlapsCapsule(cap); }

  /**
   * How deep (metres) a world point is below the volume's surfaceY; negative
   * when above. For water: submersion of the head/feet.
   */
  depthAt(p) { return this.surfaceY - p.y; }

  dispose() { this.ref = null; this.props = null; this.userData = null; }
}

/* ===========================================================================
 * 5. Heightfield — rolling terrain as a regular grid of heights.
 * ======================================================================== */

/** Below this many metres of lateral extent per cell the raycast step floors out. */
const HF_RAY_STEP_MIN = 0.05;
const HF_RAY_STEP_MAX = 0.5;
const HF_BISECT_ITERS = 14;

export class Heightfield {
  /**
   * @param {object} opts
   * @param {number} opts.originX  world X of sample (0,0)
   * @param {number} opts.originZ  world Z of sample (0,0)
   * @param {number} opts.sizeX    world extent along X (metres)
   * @param {number} opts.sizeZ    world extent along Z (metres)
   * @param {number} opts.nx       sample count along X (>= 2)
   * @param {number} opts.nz       sample count along Z (>= 2)
   * @param {Float32Array} opts.heights  nx*nz world heights, row-major by Z: heights[iz*nx + ix]
   * @param {string} [opts.surface='grass'] 'grass'|'snow'|'sand'|'dirt'|'ice'|...
   * @param {string|number} [opts.id]
   * @param {object} [opts.props]  {maxSlopeDeg?, ...} forwarded as `surfaceProps`
   * @param {object} [opts.ref]    owning terrain object
   * @param {boolean} [opts.active=true]
   */
  constructor(opts = {}) {
    this.id = opts.id !== undefined ? opts.id : _nextId++;
    this.originX = numOr(opts.originX, 0);
    this.originZ = numOr(opts.originZ, 0);
    this.nx = Math.max(2, Math.floor(numOr(opts.nx, 2)));
    this.nz = Math.max(2, Math.floor(numOr(opts.nz, 2)));
    this.sizeX = Math.max(numOr(opts.sizeX, this.nx - 1), 1e-3);
    this.sizeZ = Math.max(numOr(opts.sizeZ, this.nz - 1), 1e-3);
    /** Sample spacing. */
    this.cellX = this.sizeX / (this.nx - 1);
    this.cellZ = this.sizeZ / (this.nz - 1);
    this.invCellX = 1 / this.cellX;
    this.invCellZ = 1 / this.cellZ;

    const need = this.nx * this.nz;
    if (opts.heights && opts.heights.length >= need) {
      this.heights = opts.heights instanceof Float32Array ? opts.heights : Float32Array.from(opts.heights);
    } else {
      this.heights = new Float32Array(need);
      if (opts.heights) this.heights.set(opts.heights.subarray ? opts.heights.subarray(0, Math.min(need, opts.heights.length)) : opts.heights.slice(0, need));
    }

    this.surface = opts.surface || 'grass';
    this.props = opts.props || null;
    this.ref = opts.ref !== undefined ? opts.ref : null;
    this.active = opts.active !== false;
    this.userData = opts.userData || null;
    /** Heightfields never block laterally; the player resolver treats them as ground only. */
    this.solid = true;

    this.minH = 0;
    this.maxH = 0;
    this.aabb = new THREE.Box3();
    this._bp = null;

    this.update();
  }

  /** Recompute min/max heights + AABB. Call after editing `heights` in place. */
  update() {
    const h = this.heights;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < h.length; i++) {
      const v = h[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn)) { mn = 0; mx = 0; }
    this.minH = mn;
    this.maxH = mx;
    this.aabb.min.set(this.originX, mn, this.originZ);
    this.aabb.max.set(this.originX + this.sizeX, mx, this.originZ + this.sizeZ);
    return this;
  }

  setActive(v) { this.active = !!v; return this; }

  /** Is (x,z) inside the sampled footprint? A hair of tolerance for the border seam. */
  containsXZ(x, z) {
    const u = (x - this.originX) * this.invCellX;
    const v = (z - this.originZ) * this.invCellZ;
    return u >= -1e-6 && u <= this.nx - 1 + 1e-6 && v >= -1e-6 && v <= this.nz - 1 + 1e-6;
  }

  /**
   * Bilinear height at world (x,z). NaN outside the footprint.
   * @returns {number}
   */
  heightAt(x, z) {
    let u = (x - this.originX) * this.invCellX;
    let v = (z - this.originZ) * this.invCellZ;
    const nx = this.nx, nz = this.nz;
    if (!(u >= -1e-6 && u <= nx - 1 + 1e-6 && v >= -1e-6 && v <= nz - 1 + 1e-6)) return NaN;
    if (u < 0) u = 0; else if (u > nx - 1) u = nx - 1;
    if (v < 0) v = 0; else if (v > nz - 1) v = nz - 1;
    let ix = Math.floor(u), iz = Math.floor(v);
    if (ix > nx - 2) ix = nx - 2;
    if (iz > nz - 2) iz = nz - 2;
    const fx = u - ix, fz = v - iz;
    const h = this.heights;
    const i00 = iz * nx + ix;
    const h00 = h[i00], h10 = h[i00 + 1], h01 = h[i00 + nx], h11 = h[i00 + nx + 1];
    return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
  }

  /**
   * dh/dx at SAMPLE NODE (ix,iz): a central difference where both neighbours
   * exist, one-sided on the footprint border. Scalar in, scalar out — no
   * allocation, no object churn. Second-order accurate in the interior.
   * @private
   */
  _nodeDhdx(ix, iz) {
    const nx = this.nx, h = this.heights, row = iz * nx;
    if (nx < 3 || ix <= 0) return (h[row + 1] - h[row]) * this.invCellX;
    if (ix >= nx - 1) return (h[row + nx - 1] - h[row + nx - 2]) * this.invCellX;
    return (h[row + ix + 1] - h[row + ix - 1]) * 0.5 * this.invCellX;
  }

  /** dh/dz at SAMPLE NODE (ix,iz). Central where possible, one-sided on the border. @private */
  _nodeDhdz(ix, iz) {
    const nx = this.nx, nz = this.nz, h = this.heights;
    if (nz < 3 || iz <= 0) return (h[nx + ix] - h[ix]) * this.invCellZ;
    if (iz >= nz - 1) return (h[(nz - 1) * nx + ix] - h[(nz - 2) * nx + ix]) * this.invCellZ;
    return (h[(iz + 1) * nx + ix] - h[(iz - 1) * nx + ix]) * 0.5 * this.invCellZ;
  }

  /**
   * Analytic surface normal at world (x,z): n = normalize(-dh/dx, 1, -dh/dz),
   * where the gradient is the bilinear blend of the four surrounding SAMPLE
   * NODES' central-difference gradients. Outside the footprint returns +Y.
   *
   * WHY NOT the raw gradient of the bilinear patch? Two reasons, both felt by
   * the player:
   *
   *  1. ACCURACY. The bilinear patch's own d/dx is the one-sided difference
   *     (h10−h00)/cell, i.e. the true slope at the CELL CENTRE, applied across
   *     the whole cell. That is first-order accurate — on a 0.5 m grid over a
   *     gently curved hill it is wrong by ~4.5°, enough to mis-classify a
   *     surface against `TUNE.slope.slideDeg`. Blending node central
   *     differences is second-order: the same hill lands inside 0.5°.
   *  2. CONTINUITY. The bilinear patch is only C0, so its gradient STEPS at
   *     every cell edge. A player walking across terrain would see
   *     `groundSlopeDeg` jump by whole degrees each cell — and on a hill tuned
   *     near the slide threshold that reads as the slide state flickering on
   *     and off in a grid pattern. The blended gradient is continuous
   *     everywhere inside the footprint, so slope response is smooth.
   *
   * This is also the normal the renderer uses (terrain.js smooth-shades from
   * node normals), so what the player sees and what they slide on agree. The
   * O(cell²) disagreement with the exact bilinear facet is far below any
   * gameplay threshold, and `heightAt` remains the authority on WHERE the
   * surface is — only its orientation is smoothed.
   *
   * @param {number} x world X
   * @param {number} z world Z
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3} out
   */
  normalAt(x, z, out) {
    const o = out || new THREE.Vector3();
    let u = (x - this.originX) * this.invCellX;
    let v = (z - this.originZ) * this.invCellZ;
    const nx = this.nx, nz = this.nz;
    if (!(u >= -1e-6 && u <= nx - 1 + 1e-6 && v >= -1e-6 && v <= nz - 1 + 1e-6)) { o.set(0, 1, 0); return o; }
    if (u < 0) u = 0; else if (u > nx - 1) u = nx - 1;
    if (v < 0) v = 0; else if (v > nz - 1) v = nz - 1;
    let ix = Math.floor(u), iz = Math.floor(v);
    if (ix > nx - 2) ix = nx - 2;
    if (iz > nz - 2) iz = nz - 2;
    const fx = u - ix, fz = v - iz;
    const gx = 1 - fx, gz = 1 - fz;
    // Bilinear blend of the four node gradients (8 scalar reads, no allocation).
    const dhdx = (this._nodeDhdx(ix, iz) * gx + this._nodeDhdx(ix + 1, iz) * fx) * gz
               + (this._nodeDhdx(ix, iz + 1) * gx + this._nodeDhdx(ix + 1, iz + 1) * fx) * fz;
    const dhdz = (this._nodeDhdz(ix, iz) * gx + this._nodeDhdz(ix + 1, iz) * fx) * gz
               + (this._nodeDhdz(ix, iz + 1) * gx + this._nodeDhdz(ix + 1, iz + 1) * fx) * fz;
    const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    o.set(-dhdx * inv, inv, -dhdz * inv);
    return o;
  }

  /** Slope angle (degrees) at world (x,z). 0 outside. */
  slopeDegAt(x, z) {
    this.normalAt(x, z, _rayN);
    const ny = _rayN.y > 1 ? 1 : (_rayN.y < -1 ? -1 : _rayN.y);
    return Math.acos(ny) * (180 / Math.PI);
  }

  /**
   * Ray vs the terrain surface. The ray is clipped to the heightfield's AABB,
   * then marched with a fixed step (half a cell, clamped 0.05..0.5 m) looking
   * for the sign change of (ray.y − surface.y); the crossing is then bisected
   * to ~1e-4 m. A ray that STARTS below the surface (inside the ground) hits
   * at the clipped entry t (the camera pull-in treats it as fully blocked).
   *
   * A fixed march can miss a feature thinner than one step at a grazing angle;
   * that is an accepted trade for the camera + probe use-case (terrain is
   * smooth by construction — it is a bilinear grid).
   *
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir   unit direction (normalised defensively)
   * @param {number} maxDist
   * @param {{normal?:THREE.Vector3, point?:THREE.Vector3}} [out] receives hit normal/point
   * @returns {number} t along the ray, or -1
   */
  raycast(origin, dir, maxDist, out) {
    if (!this.active) return -1;
    if (!(maxDist > 0)) return -1;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 1e-12)) return -1;
    if (Math.abs(dl - 1) > 1e-6) { dx /= dl; dy /= dl; dz /= dl; }
    const ox = origin.x, oy = origin.y, oz = origin.z;

    // ---- clip to the AABB (heights min..max, footprint) ----
    const b = this.aabb;
    let t0 = 0, t1 = maxDist;
    // x slab
    if (Math.abs(dx) < 1e-12) { if (ox < b.min.x || ox > b.max.x) return -1; }
    else {
      const inv = 1 / dx;
      let ta = (b.min.x - ox) * inv, tb = (b.max.x - ox) * inv;
      if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    // z slab
    if (Math.abs(dz) < 1e-12) { if (oz < b.min.z || oz > b.max.z) return -1; }
    else {
      const inv = 1 / dz;
      let ta = (b.min.z - oz) * inv, tb = (b.max.z - oz) * inv;
      if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    // y slab (pad slightly so a ray skimming the max height still samples)
    const ymin = b.min.y - 1e-3, ymax = b.max.y + 1e-3;
    if (Math.abs(dy) < 1e-12) { if (oy < ymin || oy > ymax) return -1; }
    else {
      const inv = 1 / dy;
      let ta = (ymin - oy) * inv, tb = (ymax - oy) * inv;
      if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }

    // ---- march ----
    let step = Math.min(this.cellX, this.cellZ) * 0.5;
    if (step < HF_RAY_STEP_MIN) step = HF_RAY_STEP_MIN;
    if (step > HF_RAY_STEP_MAX) step = HF_RAY_STEP_MAX;

    let tPrev = t0;
    let fPrev = this._fAt(ox + dx * t0, oy + dy * t0, oz + dz * t0);
    if (fPrev === fPrev && fPrev <= 0) {          // starts inside the ground
      return this._finishHit(t0, ox + dx * t0, oz + dz * t0, oy + dy * t0, out);
    }
    let t = t0;
    let done = false;
    while (!done) {
      t += step;
      if (t >= t1) { t = t1; done = true; }
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      const f = this._fAt(px, py, pz);
      if (f === f && fPrev === fPrev && fPrev > 0 && f <= 0) {
        // ---- bisect [tPrev, t] ----
        let lo = tPrev, hi = t;
        for (let i = 0; i < HF_BISECT_ITERS; i++) {
          const mid = (lo + hi) * 0.5;
          const fm = this._fAt(ox + dx * mid, oy + dy * mid, oz + dz * mid);
          if (fm !== fm || fm > 0) lo = mid; else hi = mid;
        }
        return this._finishHit(hi, ox + dx * hi, oz + dz * hi, oy + dy * hi, out);
      }
      tPrev = t; fPrev = f;
    }
    return -1;
  }

  /** ray.y − surface.y at a world point; NaN outside the footprint. */
  _fAt(px, py, pz) {
    const h = this.heightAt(px, pz);
    return h === h ? py - h : NaN;
  }

  _finishHit(t, px, pz, py, out) {
    if (out) {
      if (out.normal) this.normalAt(px, pz, out.normal);
      if (out.point) out.point.set(px, py, pz);
    }
    return t;
  }

  dispose() {
    if (this._bp) this._bp.removeHeightfield(this);
    this.ref = null; this.props = null; this.userData = null;
  }
}

/* ===========================================================================
 * 6. Broadphase — uniform spatial hash (XZ grid with vertical buckets)
 *    + the heightfield list + a world raycast.
 * ======================================================================== */

/** Teschner et al. spatial hash. ix magnitudes stay well below 2^24 in practice. */
function cellHash(ix, iy, iz) {
  return (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0);
}

/**
 * Ray vs one oriented box: slab test in the box's local frame. Returns the
 * entry t (>= 0) or -1; `outN` receives the world normal of the entered face.
 * An origin INSIDE the box hits at t = 0 with the normal pointing back along
 * the ray (the camera pull-in wants "fully blocked", not "ignore").
 */
function rayBox(c, ox, oy, oz, dx, dy, dz, maxT, outN) {
  const px = ox - c.center.x, py = oy - c.center.y, pz = oz - c.center.z;
  if (c.axisAligned) {
    _rl[0] = px; _rl[1] = py; _rl[2] = pz;
    _rd[0] = dx; _rd[1] = dy; _rd[2] = dz;
  } else {
    _rl[0] = px * c.ax.x + py * c.ax.y + pz * c.ax.z;
    _rl[1] = px * c.ay.x + py * c.ay.y + pz * c.ay.z;
    _rl[2] = px * c.az.x + py * c.az.y + pz * c.az.z;
    _rd[0] = dx * c.ax.x + dy * c.ax.y + dz * c.ax.z;
    _rd[1] = dx * c.ay.x + dy * c.ay.y + dz * c.ay.z;
    _rd[2] = dx * c.az.x + dy * c.az.y + dz * c.az.z;
  }
  _rh[0] = c.half.x; _rh[1] = c.half.y; _rh[2] = c.half.z;

  let tmin = -Infinity, tmax = maxT, hitJ = -1, hitS = 1;
  for (let j = 0; j < 3; j++) {
    const dj = _rd[j], lj = _rl[j], hj = _rh[j];
    if (dj > -1e-12 && dj < 1e-12) {
      if (lj < -hj || lj > hj) return -1;
      continue;
    }
    const inv = 1 / dj;
    let ta = (-hj - lj) * inv;
    let tb = (hj - lj) * inv;
    const s = dj > 0 ? -1 : 1;           // entering through the -face when moving +
    if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
    if (ta > tmin) { tmin = ta; hitJ = j; hitS = s; }
    if (tb < tmax) tmax = tb;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;                 // box entirely behind the origin
  if (tmin < 0) {                          // origin inside
    outN.set(-dx, -dy, -dz);
    return 0;
  }
  if (tmin > maxT) return -1;
  if (c.axisAligned) {
    outN.set(hitJ === 0 ? hitS : 0, hitJ === 1 ? hitS : 0, hitJ === 2 ? hitS : 0);
  } else {
    const av = hitJ === 0 ? c.ax : (hitJ === 1 ? c.ay : c.az);
    outN.set(av.x * hitS, av.y * hitS, av.z * hitS);
  }
  return tmin;
}

export class Broadphase {
  /** @param {number} [cellSize=6] metres per cell */
  constructor(cellSize = 6) {
    this.cellSize = cellSize > 0 ? cellSize : 6;
    this.inv = 1 / this.cellSize;
    /** @type {Map<number, Collider[]>} */
    this.map = new Map();
    /** Every registered collider, in insertion order. */
    this.items = [];
    /** Colliders too big to hash sensibly — always considered by a query. */
    this.large = [];
    /** Terrain heightfields (not hashed — walked directly; a handful per course). */
    this.heightfields = [];
    this.maxCells = 128;
    this._qid = 0;
    this._pool = [];   // recycled bucket arrays
  }

  get count() { return this.items.length; }

  /** Register a collider. Its current `aabb` decides the cells it occupies. */
  add(c) {
    if (!c) return c;
    if (c._bp === this) { this.refresh(c); return c; }
    if (c._bp) c._bp.remove(c);
    c._bp = this;
    this.items.push(c);
    this._insert(c);
    return c;
  }

  /** Unregister a collider. */
  remove(c) {
    if (!c || c._bp !== this) return;
    this._unlink(c);
    const i = this.items.indexOf(c);
    if (i >= 0) {
      this.items[i] = this.items[this.items.length - 1];
      this.items.pop();
    }
    c._bp = null;
  }

  /** Register a Heightfield. */
  addHeightfield(h) {
    if (!h) return h;
    if (h._bp === this) return h;
    if (h._bp) h._bp.removeHeightfield(h);
    h._bp = this;
    this.heightfields.push(h);
    return h;
  }

  /** Unregister a Heightfield. */
  removeHeightfield(h) {
    if (!h || h._bp !== this) return;
    const i = this.heightfields.indexOf(h);
    if (i >= 0) this.heightfields.splice(i, 1);
    h._bp = null;
  }

  /**
   * Re-hash a collider that has moved. Cheap no-op when the occupied cell set
   * is unchanged, which is the common case for a platform oscillating inside
   * one cell — so a course full of movers costs almost nothing per frame.
   */
  refresh(c) {
    if (!c || c._bp !== this) return;
    const a = c.aabb;
    if (!isFinite(a.min.x) || !isFinite(a.max.x) ||
        !isFinite(a.min.y) || !isFinite(a.max.y) ||
        !isFinite(a.min.z) || !isFinite(a.max.z)) {
      if (!c._large) { this._unlink(c); this._pushLarge(c); }
      return;
    }
    const s = this.inv;
    const x0 = Math.floor(a.min.x * s), x1 = Math.floor(a.max.x * s);
    const y0 = Math.floor(a.min.y * s), y1 = Math.floor(a.max.y * s);
    const z0 = Math.floor(a.min.z * s), z1 = Math.floor(a.max.z * s);
    if (c._hasCells &&
        c._c0x === x0 && c._c1x === x1 &&
        c._c0y === y0 && c._c1y === y1 &&
        c._c0z === z0 && c._c1z === z1) {
      return; // identical cell set — nothing to do
    }
    this._unlink(c);
    this._insert(c);
  }

  /** Refresh every registered collider (course-level bulk update). */
  refreshAll() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) this.refresh(items[i]);
  }

  /**
   * Fill `out` with every ACTIVE collider whose world AABB intersects `aabb`.
   * Allocation free: `out` is reused, dedupe uses a monotonically increasing
   * query id stamped onto each collider.
   * @param {THREE.Box3} aabb
   * @param {Collider[]} out
   * @returns {Collider[]} out
   */
  query(aabb, out) {
    const res = out || [];
    res.length = 0;

    if (this._qid > 2100000000) {
      this._qid = 0;
      const items = this.items;
      for (let i = 0; i < items.length; i++) items[i]._stamp = 0;
    }
    const qid = ++this._qid;

    const s = this.inv;
    const min = aabb.min, max = aabb.max;
    const x0 = Math.floor(min.x * s), x1 = Math.floor(max.x * s);
    const y0 = Math.floor(min.y * s), y1 = Math.floor(max.y * s);
    const z0 = Math.floor(min.z * s), z1 = Math.floor(max.z * s);

    const map = this.map;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const bucket = map.get(cellHash(ix, iy, iz));
          if (bucket === undefined) continue;
          for (let i = 0; i < bucket.length; i++) {
            const c = bucket[i];
            if (c._stamp === qid) continue;
            c._stamp = qid;
            if (!c.active) continue;
            const b = c.aabb;
            if (b.max.x < min.x || b.min.x > max.x) continue;
            if (b.max.y < min.y || b.min.y > max.y) continue;
            if (b.max.z < min.z || b.min.z > max.z) continue;
            res.push(c);
          }
        }
      }
    }

    const large = this.large;
    for (let i = 0; i < large.length; i++) {
      const c = large[i];
      if (c._stamp === qid) continue;
      c._stamp = qid;
      if (!c.active) continue;
      const b = c.aabb;
      if (b.max.x < min.x || b.min.x > max.x) continue;
      if (b.max.y < min.y || b.min.y > max.y) continue;
      if (b.max.z < min.z || b.min.z > max.z) continue;
      res.push(c);
    }

    return res;
  }

  /** Every active collider containing a world point. */
  queryPoint(p, out) {
    const res = out || [];
    res.length = 0;
    const s = this.inv;
    const ix = Math.floor(p.x * s), iy = Math.floor(p.y * s), iz = Math.floor(p.z * s);
    const bucket = this.map.get(cellHash(ix, iy, iz));
    if (this._qid > 2100000000) {
      this._qid = 0;
      for (let i = 0; i < this.items.length; i++) this.items[i]._stamp = 0;
    }
    const qid = ++this._qid;
    if (bucket !== undefined) {
      for (let i = 0; i < bucket.length; i++) {
        const c = bucket[i];
        if (c._stamp === qid) continue;
        c._stamp = qid;
        if (!c.active) continue;
        if (c.containsPoint(p)) res.push(c);
      }
    }
    for (let i = 0; i < this.large.length; i++) {
      const c = this.large[i];
      if (c._stamp === qid) continue;
      c._stamp = qid;
      if (!c.active) continue;
      if (c.containsPoint(p)) res.push(c);
    }
    return res;
  }

  /**
   * Highest active heightfield surface under world (x,z). NaN when none.
   * `out` (optional) receives {heightfield} — the winner.
   */
  heightAt(x, z, out) {
    const hfs = this.heightfields;
    let best = NaN, bh = null;
    for (let i = 0; i < hfs.length; i++) {
      const hf = hfs[i];
      if (!hf.active) continue;
      const h = hf.heightAt(x, z);
      if (h !== h) continue;
      if (best !== best || h > best) { best = h; bh = hf; }
    }
    if (out) out.heightfield = bh;
    return best;
  }

  /**
   * Nearest hit along a ray against every active SOLID collider (oriented box
   * slab test in local space) and every active heightfield. Allocation-free:
   * uses module-private scratch and writes into `out`.
   *
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir      direction (normalised defensively)
   * @param {number} maxDist
   * @param {{t:number, normal:THREE.Vector3, collider:object|null, heightfield?:object|null, point?:THREE.Vector3}} out
   * @returns {boolean} hit
   */
  raycast(origin, dir, maxDist, out) {
    const o = out || Scratch.ray;
    o.t = maxDist;
    o.collider = null;
    o.heightfield = null;
    if (o.normal) o.normal.set(0, 1, 0);
    if (!(maxDist > 0)) return false;

    _rayDir.copy(dir);
    const dl = _rayDir.length();
    if (!(dl > 1e-12)) return false;
    if (Math.abs(dl - 1) > 1e-6) _rayDir.multiplyScalar(1 / dl);
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = _rayDir.x, dy = _rayDir.y, dz = _rayDir.z;

    // ---- boxes: gather every collider whose AABB the ray's AABB touches ----
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    _rayBox.min.set(Math.min(ox, ex) - 1e-3, Math.min(oy, ey) - 1e-3, Math.min(oz, ez) - 1e-3);
    _rayBox.max.set(Math.max(ox, ex) + 1e-3, Math.max(oy, ey) + 1e-3, Math.max(oz, ez) + 1e-3);
    const cands = this.query(_rayBox, _rayCands);

    let best = maxDist;
    let hit = false;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.solid === false) continue;
      const t = rayBox(c, ox, oy, oz, dx, dy, dz, best, _rayN);
      if (t >= 0 && t < best) {
        best = t; hit = true;
        o.collider = c; o.heightfield = null;
        if (o.normal) o.normal.copy(_rayN);
      }
    }
    _rayCands.length = 0;

    // ---- heightfields ----
    const hfs = this.heightfields;
    for (let i = 0; i < hfs.length; i++) {
      const hf = hfs[i];
      if (!hf.active) continue;
      const t = hf.raycast(origin, _rayDir, best, _hfHit);
      if (t >= 0 && t < best) {
        best = t; hit = true;
        o.collider = null; o.heightfield = hf;
        if (o.normal) o.normal.copy(_hfHit.normal);
      }
    }

    o.t = hit ? best : maxDist;
    if (o.point) o.point.set(ox + dx * o.t, oy + dy * o.t, oz + dz * o.t);
    return hit;
  }

  /** Drop every collider and heightfield. */
  clear() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      items[i]._bp = null;
      items[i]._hasCells = false;
      items[i]._large = false;
      items[i]._stamp = 0;
    }
    items.length = 0;
    this.large.length = 0;
    for (let i = 0; i < this.heightfields.length; i++) this.heightfields[i]._bp = null;
    this.heightfields.length = 0;
    this.map.forEach((b) => { b.length = 0; this._pool.push(b); });
    this.map.clear();
  }

  dispose() {
    this.clear();
    this._pool.length = 0;
  }

  // --- internals ---------------------------------------------------------

  _pushLarge(c) {
    c._large = true;
    c._hasCells = true;
    this.large.push(c);
  }

  _insert(c) {
    const a = c.aabb;
    if (!isFinite(a.min.x) || !isFinite(a.max.x) ||
        !isFinite(a.min.y) || !isFinite(a.max.y) ||
        !isFinite(a.min.z) || !isFinite(a.max.z)) {
      this._pushLarge(c);
      return;
    }
    const s = this.inv;
    const x0 = Math.floor(a.min.x * s), x1 = Math.floor(a.max.x * s);
    const y0 = Math.floor(a.min.y * s), y1 = Math.floor(a.max.y * s);
    const z0 = Math.floor(a.min.z * s), z1 = Math.floor(a.max.z * s);
    c._c0x = x0; c._c1x = x1;
    c._c0y = y0; c._c1y = y1;
    c._c0z = z0; c._c1z = z1;

    const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (n > this.maxCells) { this._pushLarge(c); return; }

    c._large = false;
    c._hasCells = true;
    const map = this.map;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = cellHash(ix, iy, iz);
          let bucket = map.get(k);
          if (bucket === undefined) {
            bucket = this._pool.length > 0 ? this._pool.pop() : [];
            bucket.length = 0;
            map.set(k, bucket);
          }
          bucket.push(c);
        }
      }
    }
  }

  _unlink(c) {
    if (!c._hasCells) return;
    if (c._large) {
      const i = this.large.indexOf(c);
      if (i >= 0) { this.large[i] = this.large[this.large.length - 1]; this.large.pop(); }
      c._large = false;
      c._hasCells = false;
      return;
    }
    const map = this.map;
    for (let ix = c._c0x; ix <= c._c1x; ix++) {
      for (let iy = c._c0y; iy <= c._c1y; iy++) {
        for (let iz = c._c0z; iz <= c._c1z; iz++) {
          const k = cellHash(ix, iy, iz);
          const bucket = map.get(k);
          if (bucket === undefined) continue;
          const i = bucket.indexOf(c);
          if (i >= 0) { bucket[i] = bucket[bucket.length - 1]; bucket.pop(); }
          if (bucket.length === 0) { map.delete(k); this._pool.push(bucket); }
        }
      }
    }
    c._hasCells = false;
  }
}

/* ===========================================================================
 * 7. Shared narrow-phase helpers (used by runtime/player/collide.js).
 * ======================================================================== */

/**
 * Inflate a collider's LOCAL half extents by a world-axis-aligned box's half
 * extents, using the absolute-rotation-matrix trick:
 *     he[j] = half[j] + |axis_j| . playerHalf
 * Exact for axis-aligned and yaw-only colliders, conservative for tilted ones.
 * @param {Collider} c
 * @param {THREE.Vector3} playerHalf
 * @param {THREE.Vector3} out
 */
export function inflatedHalf(c, playerHalf, out) {
  const o = out || new THREE.Vector3();
  if (c.axisAligned) {
    o.set(c.half.x + playerHalf.x, c.half.y + playerHalf.y, c.half.z + playerHalf.z);
    return o;
  }
  o.set(
    c.half.x + c.absAx.x * playerHalf.x + c.absAx.y * playerHalf.y + c.absAx.z * playerHalf.z,
    c.half.y + c.absAy.x * playerHalf.x + c.absAy.y * playerHalf.y + c.absAy.z * playerHalf.z,
    c.half.z + c.absAz.x * playerHalf.x + c.absAz.y * playerHalf.y + c.absAz.z * playerHalf.z,
  );
  return o;
}

/** Alias, in case a consumer reaches for the shouty spelling. */
export { Scratch as SCRATCH };

/** Exposed for tests/tools: squared distance from a segment to a local box. */
export function segmentBoxDistanceSq(ax, ay, az, bx, by, bz, hx, hy, hz) {
  return segBoxDistSq(ax, ay, az, bx, by, bz, hx, hy, hz);
}
/** Exposed for tests/tools: squared distance between two segments. */
export function segmentSegmentDistanceSq(p1, q1, p2, q2) {
  return segSegDistSq(p1.x, p1.y, p1.z, q1.x, q1.y, q1.z, p2.x, p2.y, p2.z, q2.x, q2.y, q2.z);
}
/** Exposed for tests/tools: squared distance from a segment to a point. */
export function segmentPointDistanceSq(a, b, p) {
  return segPointDistSq(a.x, a.y, a.z, b.x, b.y, b.z, p.x, p.y, p.z);
}
/** Exposed for tests/tools: ray vs one oriented box (entry t or -1, normal into `outN`). */
export function rayBoxT(c, origin, dir, maxT, outN) {
  return rayBox(c, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT, outN || _rayN);
}
