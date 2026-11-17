// PLAYGROUND (PG_PHYS, _spec/PLAYGROUND_BUILD.md 8.3, 8.4; _spec/PLACES.md 2.1): one place's PROPS, the rigid things squishies meet, built from a PlaceDef for the
// layout in use. It ships in the LIFE CHUNK (D-69): only the shell's life host imports it; softbody.ts (first load) knows a world through PropWorldLike and the
// packed PropSolve it exposes as `solve`. Pure: no DOM, no three, no clock, no Math.random; zero allocation after construction (beginFrame, endFrame, raycast,
// poke, drainStrikes, stateHash); deterministic.
//
// THE PROP ORDER (PropWorldLike.count; D-64): every prop of things[0] (its parts in ThingDef order), then things[1], ..., and the layout's walls LAST. A thing of
// mechanism 0 (a patch or zone thing: the Snooze Rug) has no prop. propThing[k] = its PlaceDef.things index (-1 for a wall), propPart[k] = its part (the wall's
// index for a wall). Parts per mechanism (built now: S0 and S1, plus the chime for PH-23):
//   block   (M1)  1 box: size = half sizes [hx, hy, hz], standing on the floor (centre y = hy), turned by yaw. The Singing Kettle adds part 1: a static sphere
//                 of p.kettleR on its top (PLACES 4.2: "a block and a static sphere").
//   bar     (M2)  1 capsule: size [r, TOTAL length], lying along local x at y = r (p.standing: upright, centre y = length / 2).
//   mound   (M3)  1 sphere: size [r, top above ground]: centre y = top - r (below the floor).
//   ring    (M4)  p.segments capsules (default 6) on the circle size[0], segment radius size[1], gap size[2] degrees centred on yaw (yaw = the gap's direction):
//                 each segment the chord between its arc points with both caps (total length = chord + 2 r), lying on the floor (y = r).
//   seesaw  (M7)  1 box board (half sizes = size) on a HINGE about its local z axis through (x, p.pivot, z): the board's centre IS the pivot (the hinge at
//                 mid-thickness); I = p.inertia, damping p.damping /s, limit p.limit degrees. No floor contact (the floor rule keeps it clear, 8.4).
//   swing   (M8)  1 capsule seat (size [r, total length]) lying along local z, ACROSS its travel (as the render draws it), hung p.rope below a HINGE about local z
//                 through (x, p.pivotY, z): it swings along local x; the seat's own mass SWING_SEAT body masses (I = m rope^2, its gravity restores it).
//   chime   (M10) p.n parts (default 1) spaced over p.span along local x, each a capsule (r size[0], total length 2 size[1], hanging along y; p.box: a box of
//                 half sizes size) on its own HINGE about local x through the rail at CHIME_RAIL_Y (the render's 0.95 m), hanging p.hang below it; limit
//                 p.limit, damping p.damping. Strikable: a body or a poke strikes it (drainStrikes).
//   ball    (M13) 1 sphere, FREE (3 translations; the spin is a look: the pose's quaternion rolls without slipping): r size[0], mass p.mass body masses, roll
//                 damping p.rollDamp /s, at most BALL_VMAX m/s; it meets the floor (y = r), every other prop as a fixed obstacle, and its bounds (the layout's
//                 bounds shrunk by r; setBallBounds: Home's visible table, D-67).
//   walls          1 box each (the layout's walls: half sizes hx, WALL_H / 2, hz).
//   NOT BUILT YET (no prop, so they add nothing to the order): ramp (M5), turntable (M9), pad (M11), floater (M12) (S2 / S3), an arch bar (p.arch), the Shake
//   Pine's branch. A flush pad or turntable has its top at y = 0 and touches nothing until it moves.
// THE POSE (8 floats per prop, `poses`, PG_RENDER's request): x, y, z of the PART'S CENTRE (the ball's centre, the board's centre on its pivot, the seat's centre,
// a chime's centre), its orientation quaternion (yaw, then the hinge angle), and the state (hinge angle in radians, ball speed in m/s, 0 static).
// THE PACKED DATA the bodies read (softbody.ts PropSolve, PS / PA): written by endFrame for the next frame; documented in softbody.ts next to PS.
// INTEGRATION (once per frame, endFrame, AFTER every body stepped; a one-frame lag, stable for damped 1-DOF hinges and one clamped ball): a hinge adds the
// bodies' angular impulse about its axis over (its own inertia + the riders' inertia the bodies reported), its own gravity torque (a swing seat or a chime),
// its damping, the clamp of its fastest point to MOVE_VMAX, then the limits (an inelastic stop: energy only decays); the ball adds the bodies' impulse / its
// mass, gravity and the floor, roll damping, the clamp, the obstacles and its bounds, and comes to rest under BALL_REST m/s.
import type { PropWorldLike } from '../contracts.ts';
import type { PlaceDef, ThingDef } from '../data/places.ts';
import { MECH } from '../data/places.ts';
import { PA, PS } from './softbody.ts';
import type { PropSolve } from './softbody.ts';
import { GRAVITY } from './params.ts';

/** Tunables (PROBES may read them). */
export const PROPS = {
  WALL_H: 2.4,          // wall height (m; PLACES 4.2: 2.4 m log walls)
  SWING_SEAT: 0.5,      // a swing seat's own mass (body masses)
  CHIME_RAIL_Y: 0.95,   // a chime's rail (PG_RENDER: the chime and bell rails at y 0.95 m)
  CHIME_MASS: 0.15,     // a chime part's mass (body masses)
  MOVE_VMAX: 2.0,       // the fastest point of a hinge prop, and the ball (m/s; PLACES 2.1 M8 / M13)
  LIMIT_E: 0.1,         // restitution at a hinge limit
  BALL_E: 0.35,         // the ball's restitution against walls and props
  BALL_FLOOR_E: 0.3,    // ... and the floor
  BALL_REST: 0.03,      // the ball stops under this speed (m/s) when nothing pushed it this frame
  ROLL_FRICTION: 0.15,  // the ball's rolling friction on the floor (m/s^2)
  STRIKE_MIN: 0.004,    // a body's impulse on a strikable prop (body-mass m/s) that strikes it
  STRIKE_NORM: 0.08,    // ... and the impulse that maps to intensity 1
  STRIKE_GAP: 0.15,     // ... at most one strike per prop in this many seconds
};
const JOINT_STATIC = 0, JOINT_HINGE = 1, JOINT_BALL = 2;
const KIND_SPHERE = 1, KIND_CAPSULE = 2, KIND_BOX = 3;
const MAX_STRIKES = 32;

/** One prop while the world is built (allocation is fine here: once per place and layout). */
interface PropBuild {
  thing: number; part: number; kind: number; joint: number; mu: number; capAxis: number; strike: boolean;
  c: [number, number, number]; yaw: number; h: [number, number, number];
  pivot?: [number, number, number]; axisLocal?: 0 | 2; inertia?: number; damping?: number; limitDeg?: number; mgl?: number; reach?: number;
  mass?: number; rollDamp?: number;
}

/** A place's props and zones (PropWorldLike) with the packed data the bodies solve against (`solve`). Build it with buildPropWorld. */
export class PropWorld implements PropWorldLike {
  readonly count: number;
  readonly propThing: Int16Array;
  readonly propPart: Uint8Array;
  readonly poses: Float32Array;
  readonly zoneCount: number;
  readonly zoneOn: Uint8Array;
  /** The packed shapes and accumulators (softbody.ts PropSolve): what SoftBody.setPropWorld reads. */
  readonly solve: PropSolve;
  // per prop configuration
  private readonly kind: Uint8Array; private readonly joint: Uint8Array; private readonly parked: Uint8Array; private readonly strikable: Uint8Array;
  private readonly base: Float64Array;   // per prop 16: rest centre (3), yaw quaternion (4: x y z w), pivot (3), local hinge axis in world (3), spare (3)
  private readonly jp: Float64Array;     // per prop 8: inertia, damping, limit (rad), m g l (own gravity torque), reach (m), mass (ball), roll damping (ball), radius (ball)
  // per prop state
  private readonly st: Float64Array;     // per prop 12: hinge angle, angular velocity | ball x y z, vx vy vz, quaternion (4), speed
  private readonly motorOn: Uint8Array;
  private readonly strikeT: Float64Array;   // per prop: seconds until it may strike again
  private readonly riderI: Float64Array;    // per prop: the riders' inertia about its hinge in the last frame (a poke of a loaded seat or board turns it less)
  // the ball's bounds: shape 0 disc (cx, cz, r), 1 rounded rectangle (cx, cz, hx, hz, round), shrunk by each ball's radius when used
  private readonly bounds = new Float64Array(6);
  private boundsShape = 0;
  // strikes waiting for drainStrikes: quads [prop, intensity, cause, slot]
  private readonly strikes = new Float32Array(MAX_STRIKES * 4);
  private nStrikes = 0;
  // the last raycast (poke's lever point)
  private rayProp = -1; private readonly rayP = new Float64Array(3);
  private readonly sc = new Float64Array(16);   // scratch (no allocation per call)
  private readonly things: Int16Array;          // per thing: its first prop (-1 none) and its prop count (2 per thing)

  constructor(parts: readonly PropBuild[], nThings: number, zones: number, bounds: { shape: number; v: readonly number[] }, parkAll: boolean) {
    const n = parts.length;
    this.count = n;
    this.propThing = new Int16Array(n); this.propPart = new Uint8Array(n);
    this.poses = new Float32Array(n * 8);
    this.zoneCount = zones; this.zoneOn = new Uint8Array(zones).fill(1);
    this.solve = { count: n, S: new Float64Array(n * PS), A: new Float64Array(n * PA) };
    this.kind = new Uint8Array(n); this.joint = new Uint8Array(n); this.parked = new Uint8Array(n); this.strikable = new Uint8Array(n);
    this.base = new Float64Array(n * 16); this.jp = new Float64Array(n * 8); this.st = new Float64Array(n * 12); this.motorOn = new Uint8Array(n); this.strikeT = new Float64Array(n); this.riderI = new Float64Array(n);
    this.things = new Int16Array(nThings * 2).fill(-1);
    this.boundsShape = bounds.shape; for (let i = 0; i < bounds.v.length && i < 6; i++) this.bounds[i] = bounds.v[i];
    const S = this.solve.S;
    for (let k = 0; k < n; k++) {
      const b = parts[k], o = k * PS, B = k * 16, J = k * 8, T = k * 12;
      this.propThing[k] = b.thing; this.propPart[k] = b.part;
      if (b.thing >= 0) { if (this.things[b.thing * 2] < 0) this.things[b.thing * 2] = k; this.things[b.thing * 2 + 1]++; }
      this.kind[k] = b.kind; this.joint[k] = b.joint; this.strikable[k] = b.strike ? 1 : 0;
      this.parked[k] = parkAll && b.thing >= 0 ? 1 : 0;
      const hy = -Math.sin(b.yaw / 2), hw = Math.cos(b.yaw / 2);   // the yaw: Ry(-yaw), local x -> (cos yaw, 0, sin yaw) (the render's rotation.y = -yaw)
      this.base[B] = b.c[0]; this.base[B + 1] = b.c[1]; this.base[B + 2] = b.c[2];
      this.base[B + 3] = 0; this.base[B + 4] = hy; this.base[B + 5] = 0; this.base[B + 6] = hw;
      S[o + 2] = b.mu; S[o + 3] = b.capAxis; S[o + 16] = b.h[0]; S[o + 17] = b.h[1]; S[o + 18] = b.h[2];
      S[o + 28] = b.kind === KIND_SPHERE ? b.h[0] : b.kind === KIND_CAPSULE ? b.h[0] + b.h[1] : Math.sqrt(b.h[0] * b.h[0] + b.h[1] * b.h[1] + b.h[2] * b.h[2]);
      S[o + 30] = b.joint === JOINT_STATIC ? 1 : 0;
      if (b.joint === JOINT_HINGE) {
        const pv = b.pivot!;
        this.base[B + 7] = pv[0]; this.base[B + 8] = pv[1]; this.base[B + 9] = pv[2];
        // the hinge axis: the part's local x or z turned by the yaw
        const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
        if (b.axisLocal === 0) { this.base[B + 10] = cy; this.base[B + 11] = 0; this.base[B + 12] = sy; } else { this.base[B + 10] = -sy; this.base[B + 11] = 0; this.base[B + 12] = cy; }
        this.jp[J] = b.inertia ?? 0.5; this.jp[J + 1] = b.damping ?? 0.5; this.jp[J + 2] = ((b.limitDeg ?? 10) * Math.PI) / 180; this.jp[J + 3] = b.mgl ?? 0; this.jp[J + 4] = b.reach ?? 1;
      } else if (b.joint === JOINT_BALL) {
        this.jp[J + 5] = b.mass ?? 0.2; this.jp[J + 6] = b.rollDamp ?? 0.6; this.jp[J + 7] = b.h[0];
        this.st[T] = b.c[0]; this.st[T + 1] = b.c[1]; this.st[T + 2] = b.c[2]; this.st[T + 9] = 1;   // (quaternion identity: x y z w at T+6..9)
      }
    }
    for (let k = 0; k < n; k++) this.writePose(k);
  }

  // ------------------------------------------------------------------ PropWorldLike

  beginFrame(): void { this.solve.A.fill(0); }

  endFrame(dt: number): void {
    if (!(dt > 0)) return;   // (NaN, 0, negative: nothing)
    const h = Math.min(0.05, dt);
    this.hNow = h;   // (the steps read it here: a double passed to a call that is not inlined is boxed, one HeapNumber a call)
    const A = this.solve.A;
    for (let k = 0; k < this.count; k++) {
      if (this.parked[k]) continue;
      const j = this.joint[k], a = k * PA;
      if (j === JOINT_HINGE) this.stepHinge(k);
      else if (j === JOINT_BALL) {
        // THE BALL, written out here (a once-a-frame function of its own stayed unoptimised for minutes: 2 KB of boxed doubles a frame; in this loop it is compiled with it)
        const J = k * 8, T = k * 12, st = this.st;
        const m = this.jp[J + 5], r = this.jp[J + 7];
        const pushed = A[a] * A[a] + A[a + 1] * A[a + 1] + A[a + 2] * A[a + 2] > 1e-12;
        st[T + 3] += A[a] / m; st[T + 4] += A[a + 1] / m; st[T + 5] += A[a + 2] / m;
        st[T + 4] -= GRAVITY * h;
        // roll damping on the horizontal speed, and a little rolling friction on the floor (a felt or yarn ball stops: with the 0.5 /s damping alone 2 m/s took 8 s)
        const rd = Math.exp(-this.jp[J + 6] * h);
        st[T + 3] *= rd; st[T + 5] *= rd;
        if (st[T + 1] <= r + 1e-6) {
          const hs = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 5] * st[T + 5]), dec = PROPS.ROLL_FRICTION * h;
          const kf = Math.max(0, hs - dec) / Math.max(hs, 1e-12);
          st[T + 3] *= kf; st[T + 5] *= kf;
        }
        this.clampBall(k);
        st[T] += st[T + 3] * h; st[T + 1] += st[T + 4] * h; st[T + 2] += st[T + 5] * h;
        // the floor
        if (st[T + 1] < r) { st[T + 1] = r; if (st[T + 4] < 0) { st[T + 4] = -PROPS.BALL_FLOOR_E * st[T + 4]; if (st[T + 4] < 0.2) st[T + 4] = 0; } }
        // every other shown prop is a fixed obstacle; then the bounds
        this.ballObstacles(k);
        {   // the ball's centre inside its bounds shrunk by its radius (a disc, or a rounded rectangle): pushed back, its outward speed reflected with BALL_E
          const b = this.bounds;
          const px = st[T] - b[0], pz = st[T + 2] - b[1];
          let nx = 0, nz = 0, over = 0;
          if (this.boundsShape === 0) {
            const R = b[2] - r, d = Math.sqrt(px * px + pz * pz);
            if (d > R && d > 1e-9) { nx = px / d; nz = pz / d; over = d - R; }
          } else {
            const rd = Math.max(0, b[4] - r), hx = b[2] - r - rd, hz = b[3] - r - rd;   // the inner rectangle and the corner radius left after the shrink
            const qx = Math.abs(px) - hx, qz = Math.abs(pz) - hz;
            if (qx > 0 && qz > 0) {
              const d = Math.sqrt(qx * qx + qz * qz);
              if (d > rd && d > 1e-9) { nx = (px < 0 ? -qx : qx) / d; nz = (pz < 0 ? -qz : qz) / d; over = d - rd; }
            } else if (qx > rd) { nx = px < 0 ? -1 : 1; over = qx - rd; } else if (qz > rd) { nz = pz < 0 ? -1 : 1; over = qz - rd; }
          }
          if (over > 0) {
            st[T] -= nx * over; st[T + 2] -= nz * over;
            const vn = st[T + 3] * nx + st[T + 5] * nz;
            if (vn > 0) { const k2 = (1 + PROPS.BALL_E) * vn; st[T + 3] -= k2 * nx; st[T + 5] -= k2 * nz; }
          }
  
        }
        // rest
        const sp2 = st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5];
        if (!pushed && sp2 < PROPS.BALL_REST * PROPS.BALL_REST && st[T + 1] <= r + 1e-6) { st[T + 3] = 0; st[T + 4] = 0; st[T + 5] = 0; }
        // the roll (a look): w = (up x v) / r, integrated into the orientation quaternion
        const vx = st[T + 3], vz = st[T + 5];
        if (vx !== 0 || vz !== 0) {
          const wx = vz / r, wz = -vx / r, wl = Math.sqrt(wx * wx + wz * wz), ang = wl * h;
          const s2 = Math.sin(ang / 2) / wl, c2 = Math.cos(ang / 2), qx = wx * s2, qz = wz * s2;   // dq = (wx s, 0, wz s, c)
          const x = st[T + 6], y = st[T + 7], z = st[T + 8], w = st[T + 9];
          // q' = dq x q
          st[T + 6] = c2 * x + qx * w + (0 * z - qz * y); st[T + 7] = c2 * y + 0 * w + (qz * x - qx * z); st[T + 8] = c2 * z + qz * w + (qx * y - 0 * x); st[T + 9] = c2 * w - (qx * x + 0 * y + qz * z);
          const ql = Math.max(1e-12, Math.sqrt(st[T + 6] * st[T + 6] + st[T + 7] * st[T + 7] + st[T + 8] * st[T + 8] + st[T + 9] * st[T + 9]));
          st[T + 6] /= ql; st[T + 7] /= ql; st[T + 8] /= ql; st[T + 9] /= ql;
        }
        st[T + 10] = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5]);
      }
      // a strikable prop a body hit hard enough this frame (at most one strike per prop per STRIKE_GAP s: a body leaning on a chime does not ring it every frame)
      if (this.strikeT[k] > 0) this.strikeT[k] -= h;
      if (this.strikable[k] && A[a + 7] > PROPS.STRIKE_MIN && this.strikeT[k] <= 0) this.pushStrike(k, A[a + 7] / PROPS.STRIKE_NORM, 1, A[a + 8]);
      this.writePose(k);
    }
  }

  setZoneOn(zone: number, on: boolean): void {
    const z = Math.floor(zone);
    if (z >= 0 && z < this.zoneCount) this.zoneOn[z] = on ? 1 : 0;
  }
  /** Recorded for the S3 motor turntable; nothing in S0 / S1 has a motor. */
  setMotor(prop: number, on: boolean): void {
    const p = Math.floor(prop);
    if (p >= 0 && p < this.count) this.motorOn[p] = on ? 1 : 0;
  }

  /** Ray against the shown props (parked ones are skipped): the nearest prop index or -1. Remembers the hit point as poke's lever. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (!Number.isFinite(ox + oy + oz + dx + dy + dz)) return -1;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 1e-12)) return -1;
    const ux = dx / dl, uy = dy / dl, uz = dz / dl, S = this.solve.S, sc = this.sc;
    let best = -1, bt = Infinity;
    for (let k = 0; k < this.count; k++) {
      if (this.parked[k] || this.kind[k] === 0) continue;
      const o = k * PS, kd = this.kind[k];
      // the ray from the prop's centre (local coordinates for a box)
      const rx = ox - S[o + 4], ry = oy - S[o + 5], rz = oz - S[o + 6];
      let t = Infinity;
      if (kd === KIND_SPHERE) t = raySphere(rx, ry, rz, ux, uy, uz, S[o + 16]);
      else if (kd === KIND_CAPSULE) {
        const ax = S[o + 3] | 0, ax0 = S[o + 7 + ax], ay0 = S[o + 10 + ax], az0 = S[o + 13 + ax], hl = S[o + 17], r = S[o + 16];
        t = rayCapsule(rx, ry, rz, ux, uy, uz, ax0, ay0, az0, hl, r);
      } else {
        // box: the ray in the box's frame (columns of R are its axes), then the slab test
        const lx = rx * S[o + 7] + ry * S[o + 10] + rz * S[o + 13], ly = rx * S[o + 8] + ry * S[o + 11] + rz * S[o + 14], lz = rx * S[o + 9] + ry * S[o + 12] + rz * S[o + 15];
        const vx = ux * S[o + 7] + uy * S[o + 10] + uz * S[o + 13], vy = ux * S[o + 8] + uy * S[o + 11] + uz * S[o + 14], vz = ux * S[o + 9] + uy * S[o + 12] + uz * S[o + 15];
        t = rayBox(lx, ly, lz, vx, vy, vz, S[o + 16], S[o + 17], S[o + 18]);
      }
      if (t < bt) { bt = t; best = k; }
    }
    this.rayProp = best;
    if (best >= 0) { this.rayP[0] = ox + ux * bt; this.rayP[1] = oy + uy * bt; this.rayP[2] = oz + uz * bt; }
    return best;
  }

  /** A player's tap or flick: a velocity change (m/s) of the point it hits (the last raycast's point on this prop, else its lever: a board's +x end, a seat's
   *  centre). A ball rolls (clamped to MOVE_VMAX), a hinge turns, a strikable prop strikes (cause 0). A static prop does not move. */
  poke(prop: number, ix: number, iy: number, iz: number): void {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.parked[k] || !Number.isFinite(ix + iy + iz)) return;
    const j = this.joint[k], T = k * 12, J = k * 8, B = k * 16;
    if (j === JOINT_BALL) {
      this.st[T + 3] += ix; this.st[T + 4] += iy; this.st[T + 5] += iz;
      this.clampBall(k);
    } else if (j === JOINT_HINGE) {
      const S = this.solve.S, o = k * PS;
      let px: number, py: number, pz: number;
      if (this.rayProp === k) { px = this.rayP[0]; py = this.rayP[1]; pz = this.rayP[2]; }
      else if (this.kind[k] === KIND_BOX) { px = S[o + 4] + S[o + 7] * S[o + 16]; py = S[o + 5] + S[o + 10] * S[o + 16]; pz = S[o + 6] + S[o + 13] * S[o + 16]; }
      else { px = S[o + 4]; py = S[o + 5]; pz = S[o + 6]; }
      const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12];
      const rx = px - this.base[B + 7], ry = py - this.base[B + 8], rz = pz - this.base[B + 9], ra = rx * ax + ry * ay + rz * az;
      const r2 = rx * rx + ry * ry + rz * rz - ra * ra;
      if (r2 > 1e-6) {
        // the point's tangential velocity changes by the impulse's part along the tangent: dw = axis . (r x i) / |r_perp|^2
        // (a loaded hinge turns less: the riders' inertia of the last frame shares the push, as a hand pushing a swing with a child on it)
        const cx = ry * iz - rz * iy, cy = rz * ix - rx * iz, cz = rx * iy - ry * ix;
        this.st[T + 1] += ((ax * cx + ay * cy + az * cz) / r2) * (this.jp[J] / (this.jp[J] + this.riderI[k]));
        const wmax = PROPS.MOVE_VMAX / Math.max(0.05, this.jp[J + 4]);
        if (this.st[T + 1] > wmax) this.st[T + 1] = wmax; else if (this.st[T + 1] < -wmax) this.st[T + 1] = -wmax;
      }
    }
    if (this.strikable[k]) this.pushStrike(k, Math.sqrt(ix * ix + iy * iy + iz * iz) / PROPS.MOVE_VMAX, 0, -1);
    this.writePose(k);
  }

  drainStrikes(out: Float32Array): number {
    const m = Math.min(this.nStrikes, Math.floor(out.length / 4));
    for (let i = 0; i < m * 4; i++) out[i] = this.strikes[i];
    this.nStrikes = 0;
    return m;
  }

  stateHash(): number {
    let h = 0x811c9dc5 | 0;
    const st = this.st;
    for (let i = 0; i < st.length; i++) { h ^= Math.round(st[i] * 8192) | 0; h = Math.imul(h, 0x01000193); }
    for (let k = 0; k < this.count; k++) { h ^= this.parked[k]; h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // ------------------------------------------------------------------ physics values beyond the contract (the shell's life host; documented in the report)

  /** Park or show a thing's props (Home's things arrive one by one: a parked prop has no collider and keeps its pose). `thing` = its PlaceDef.things index. */
  setParked(thing: number, parked: boolean): void {
    const t = Math.floor(thing);
    if (!(t >= 0 && t * 2 < this.things.length)) return;
    const k0 = this.things[t * 2], nk = this.things[t * 2 + 1];
    for (let k = k0; k >= 0 && k < k0 + nk; k++) { this.parked[k] = parked ? 1 : 0; this.writePose(k); }
  }
  isParked(prop: number): boolean { const k = Math.floor(prop); return k >= 0 && k < this.count && this.parked[k] === 1; }
  /** The free ball's bounds as a rectangle (Home: StageLike.visibleTable, D-67); each ball keeps its centre inside it shrunk by its radius. */
  setBallBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (!Number.isFinite(minX + minZ + maxX + maxZ) || maxX <= minX || maxZ <= minZ) return;
    this.boundsShape = 1;
    this.bounds[0] = (minX + maxX) / 2; this.bounds[1] = (minZ + maxZ) / 2; this.bounds[2] = (maxX - minX) / 2; this.bounds[3] = (maxZ - minZ) / 2; this.bounds[4] = 0;
  }
  /** A hinge's angle (rad) and angular velocity, or a ball's speed (harness readouts; NaN for a static prop). */
  angle(prop: number): number { const k = Math.floor(prop); return k >= 0 && k < this.count && this.joint[k] === JOINT_HINGE ? this.st[k * 12] : NaN; }
  omega(prop: number): number { const k = Math.floor(prop); return k >= 0 && k < this.count && this.joint[k] === JOINT_HINGE ? this.st[k * 12 + 1] : NaN; }
  /** The world-space velocity of a ball (into out[0..2]); false for another prop. */
  ballVelocity(prop: number, out: Float64Array): boolean {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.joint[k] !== JOINT_BALL) return false;
    out[0] = this.st[k * 12 + 3]; out[1] = this.st[k * 12 + 4]; out[2] = this.st[k * 12 + 5];
    return true;
  }

  // ------------------------------------------------------------------ integration

  private hNow = 1 / 60;
  private stepHinge(k: number): void {
    const h = this.hNow, A = this.solve.A, a = k * PA, B = k * 16, J = k * 8, T = k * 12;
    const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12];
    this.riderI[k] = A[a + 6] / h;
    const I = this.jp[J] + this.riderI[k];                                 // own inertia + the riders' (supported mass x r_perp^2)
    let w = this.st[T + 1] + (A[a + 3] * ax + A[a + 4] * ay + A[a + 5] * az) / I;
    w += (-this.jp[J + 3] * Math.sin(this.st[T]) / I) * h;                  // own gravity (a pendulum: the swing seat, a chime)
    w *= Math.exp(-this.jp[J + 1] * h);
    const wmax = PROPS.MOVE_VMAX / Math.max(0.05, this.jp[J + 4]);
    if (w > wmax) w = wmax; else if (w < -wmax) w = -wmax;
    let th = this.st[T] + w * h;
    const lim = this.jp[J + 2];
    if (th > lim) { th = lim; if (w > 0) w = -PROPS.LIMIT_E * w; } else if (th < -lim) { th = -lim; if (w < 0) w = -PROPS.LIMIT_E * w; }
    this.st[T] = th; this.st[T + 1] = Math.abs(w) < 1e-7 ? 0 * w : w;
  }

  private clampBall(k: number): void {
    const T = k * 12, st = this.st, sp = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5]);
    if (sp > PROPS.MOVE_VMAX) { const s = PROPS.MOVE_VMAX / sp; st[T + 3] *= s; st[T + 4] *= s; st[T + 5] *= s; }
  }

  /** The ball against every other shown prop (as fixed shapes at their current pose): pushed out, its normal speed reflected with BALL_E. */
  private ballObstacles(k: number): void {
    const S = this.solve.S, st = this.st, T = k * 12, r = this.jp[k * 8 + 7], sc = this.sc;
    for (let q = 0; q < this.count; q++) {
      if (q === k || this.parked[q] || this.kind[q] === 0 || this.joint[q] === JOINT_BALL) continue;
      const o = q * PS, kd = this.kind[q];
      const dx = st[T] - S[o + 4], dy = st[T + 1] - S[o + 5], dz = st[T + 2] - S[o + 6];
      const br = S[o + 28] + r;
      if (dx * dx + dy * dy + dz * dz > br * br) continue;
      // the closest point of the shape to the ball's centre (sc 0..2), from which the normal follows
      if (kd === KIND_SPHERE) { const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; const rr = S[o + 16]; sc[0] = S[o + 4] + dx / d * rr; sc[1] = S[o + 5] + dy / d * rr; sc[2] = S[o + 6] + dz / d * rr; sc[3] = d < rr ? 1 : 0; }
      else if (kd === KIND_CAPSULE) {
        const ax = S[o + 3] | 0, ux = S[o + 7 + ax], uy = S[o + 10 + ax], uz = S[o + 13 + ax], hl = S[o + 17], rr = S[o + 16];
        const t0 = dx * ux + dy * uy + dz * uz, t = t0 < -hl ? -hl : t0 > hl ? hl : t0;
        const ex = dx - ux * t, ey = dy - uy * t, ez = dz - uz * t, d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
        sc[0] = S[o + 4] + ux * t + ex / d * rr; sc[1] = S[o + 5] + uy * t + ey / d * rr; sc[2] = S[o + 6] + uz * t + ez / d * rr; sc[3] = d < rr ? 1 : 0;
      } else {
        const lx = dx * S[o + 7] + dy * S[o + 10] + dz * S[o + 13], ly = dx * S[o + 8] + dy * S[o + 11] + dz * S[o + 14], lz = dx * S[o + 9] + dy * S[o + 12] + dz * S[o + 15];
        const hx = S[o + 16], hy = S[o + 17], hz = S[o + 18];
        const inside = Math.abs(lx) < hx && Math.abs(ly) < hy && Math.abs(lz) < hz;
        let cx = lx < -hx ? -hx : lx > hx ? hx : lx, cy = ly < -hy ? -hy : ly > hy ? hy : ly, cz = lz < -hz ? -hz : lz > hz ? hz : lz;
        if (inside) {   // the centre inside the box: out through the nearest face
          const ex = hx - Math.abs(lx), ey = hy - Math.abs(ly), ez = hz - Math.abs(lz);
          if (ex <= ey && ex <= ez) cx = lx < 0 ? -hx : hx; else if (ey <= ez) cy = ly < 0 ? -hy : hy; else cz = lz < 0 ? -hz : hz;
        }
        sc[0] = S[o + 4] + S[o + 7] * cx + S[o + 8] * cy + S[o + 9] * cz; sc[1] = S[o + 5] + S[o + 10] * cx + S[o + 11] * cy + S[o + 12] * cz; sc[2] = S[o + 6] + S[o + 13] * cx + S[o + 14] * cy + S[o + 15] * cz;
        sc[3] = inside ? 1 : 0;
      }
      let nx = st[T] - sc[0], ny = st[T + 1] - sc[1], nz = st[T + 2] - sc[2];
      let d = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (sc[3] === 1) { nx = -nx; ny = -ny; nz = -nz; d = -d; }   // inside: the normal points out through the surface point
      if (d >= r) continue;
      const l = Math.abs(d) > 1e-9 ? Math.abs(d) : 1;
      nx /= l; ny /= l; nz /= l;
      if (Math.abs(d) <= 1e-9) { nx = 0; ny = 1; nz = 0; }
      const push = r - d;
      st[T] += nx * push; st[T + 1] += ny * push; st[T + 2] += nz * push;
      const vn = st[T + 3] * nx + st[T + 4] * ny + st[T + 5] * nz;
      if (vn < 0) { const k2 = (1 + PROPS.BALL_E) * vn; st[T + 3] -= k2 * nx; st[T + 4] -= k2 * ny; st[T + 5] -= k2 * nz; }
    }
  }

  private pushStrike(k: number, intensity: number, cause: number, slot: number): void {
    this.strikeT[k] = PROPS.STRIKE_GAP;
    if (this.nStrikes >= MAX_STRIKES) return;
    const i = this.nStrikes * 4;
    this.strikes[i] = k; this.strikes[i + 1] = intensity > 1 ? 1 : intensity < 0 ? 0 : intensity; this.strikes[i + 2] = cause; this.strikes[i + 3] = slot;
    this.nStrikes++;
  }

  /** The prop's pose from its state: the packed shape (S) for the bodies' next frame and the render pose (poses). */
  private writePose(k: number): void {
    const S = this.solve.S, o = k * PS, B = k * 16, T = k * 12, P = this.poses, p = k * 8, j = this.joint[k], st = this.st, base = this.base;
    let cx = base[B], cy = base[B + 1], cz = base[B + 2];
    let qx = base[B + 3], qy = base[B + 4], qz = base[B + 5], qw = base[B + 6];
    let state = 0;
    // velocities for the bodies' per-substep advance
    let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
    if (j === JOINT_HINGE) {
      const th = st[T], w = st[T + 1], ax = base[B + 10], ay = base[B + 11], az = base[B + 12], px = base[B + 7], py = base[B + 8], pz = base[B + 9];
      // the hinge rotation Rot(axis, th) as a quaternion, composed before the yaw
      const s = Math.sin(th / 2), c = Math.cos(th / 2), hx = ax * s, hy = ay * s, hz = az * s;
      const nqx = c * qx + hx * qw + (hy * qz - hz * qy), nqy = c * qy + hy * qw + (hz * qx - hx * qz), nqz = c * qz + hz * qw + (hx * qy - hy * qx), nqw = c * qw - (hx * qx + hy * qy + hz * qz);
      qx = nqx; qy = nqy; qz = nqz; qw = nqw;
      // the centre turned about the pivot
      const rx = cx - px, ry = cy - py, rz = cz - pz, cs = Math.cos(th), sn = Math.sin(th), dot = ax * rx + ay * ry + az * rz;
      cx = px + rx * cs + (ay * rz - az * ry) * sn + ax * dot * (1 - cs);
      cy = py + ry * cs + (az * rx - ax * rz) * sn + ay * dot * (1 - cs);
      cz = pz + rz * cs + (ax * ry - ay * rx) * sn + az * dot * (1 - cs);
      wx = ax * w; wy = ay * w; wz = az * w; state = th;
      S[o + 25] = px; S[o + 26] = py; S[o + 27] = pz; S[o + 31] = ax; S[o + 32] = ay; S[o + 33] = az;
      S[o + 29] = w !== 0 ? 1 : 0;
    } else if (j === JOINT_BALL) {
      cx = st[T]; cy = st[T + 1]; cz = st[T + 2];
      vx = st[T + 3]; vy = st[T + 4]; vz = st[T + 5];
      state = st[T + 10];
      S[o + 29] = vx !== 0 || vy !== 0 || vz !== 0 ? 1 : 0;
      S[o + 25] = cx; S[o + 26] = cy; S[o + 27] = cz;
    } else S[o + 29] = 0;
    S[o] = this.parked[k] ? 0 : this.kind[k];
    S[o + 1] = j;
    S[o + 4] = cx; S[o + 5] = cy; S[o + 6] = cz;
    S[o + 19] = vx; S[o + 20] = vy; S[o + 21] = vz; S[o + 22] = wx; S[o + 23] = wy; S[o + 24] = wz;
    // the rotation matrix (row-major) of the collision frame: the hinge rotation and the yaw (a ball's spin is a look: its shape frame stays the identity)
    const rq = j === JOINT_BALL ? 0 : 1;
    const ex = qx * rq, ey = qy * rq, ez = qz * rq, ew = qw * rq + (1 - rq);
    const xx = ex * ex, yy = ey * ey, zz = ez * ez, xy = ex * ey, xz = ex * ez, yz = ey * ez, wx2 = ew * ex, wy2 = ew * ey, wz2 = ew * ez;
    S[o + 7] = 1 - 2 * (yy + zz); S[o + 8] = 2 * (xy - wz2); S[o + 9] = 2 * (xz + wy2);
    S[o + 10] = 2 * (xy + wz2); S[o + 11] = 1 - 2 * (xx + zz); S[o + 12] = 2 * (yz - wx2);
    S[o + 13] = 2 * (xz - wy2); S[o + 14] = 2 * (yz + wx2); S[o + 15] = 1 - 2 * (xx + yy);
    // the render pose
    P[p] = cx; P[p + 1] = cy; P[p + 2] = cz;
    if (j === JOINT_BALL) { P[p + 3] = st[T + 6]; P[p + 4] = st[T + 7]; P[p + 5] = st[T + 8]; P[p + 6] = st[T + 9]; }
    else { P[p + 3] = qx; P[p + 4] = qy; P[p + 5] = qz; P[p + 6] = qw; }
    P[p + 7] = state;
  }
}

/** Ray (origin relative to the sphere's centre, unit direction) against a sphere: the entry distance, or Infinity. */
function raySphere(rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, r: number): number {
  const b = rx * ux + ry * uy + rz * uz, c = rx * rx + ry * ry + rz * rz - r * r, disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (c <= 0 ? 0 : Infinity);
}
/** Ray against a capsule (segment centre at the origin along unit (ax, ay, az), half length hl, radius r): the entry distance, or Infinity. */
function rayCapsule(rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, ax: number, ay: number, az: number, hl: number, r: number): number {
  // the infinite cylinder, clipped to the segment, then the two end spheres
  const da = ux * ax + uy * ay + uz * az, oa = rx * ax + ry * ay + rz * az;
  const dpx = ux - ax * da, dpy = uy - ay * da, dpz = uz - az * da, opx = rx - ax * oa, opy = ry - ay * oa, opz = rz - az * oa;
  const A = dpx * dpx + dpy * dpy + dpz * dpz, Bh = dpx * opx + dpy * opy + dpz * opz, C = opx * opx + opy * opy + opz * opz - r * r;
  let best = Infinity;
  if (A > 1e-12) {
    const disc = Bh * Bh - A * C;
    if (disc >= 0) {
      const t = (-Bh - Math.sqrt(disc)) / A, s = oa + da * t;
      if (t >= 0 && s >= -hl && s <= hl) best = t;
    }
  }
  const t1 = raySphere(rx - ax * hl, ry - ay * hl, rz - az * hl, ux, uy, uz, r), t2 = raySphere(rx + ax * hl, ry + ay * hl, rz + az * hl, ux, uy, uz, r);
  return Math.min(best, t1, t2);
}
/** Ray in a box's frame (origin, direction) against the box of half sizes h: the entry distance (slab test), or Infinity. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hx: number, hy: number, hz: number): number {
  SLAB[0] = 0; SLAB[1] = Infinity;
  if (!slab(ox, dx, hx) || !slab(oy, dy, hy) || !slab(oz, dz, hz)) return Infinity;
  return SLAB[0];
}
const SLAB = new Float64Array(2);   // [t entry, t exit] of rayBox (no allocation per ray)
function slab(o: number, d: number, h: number): boolean {
  if (Math.abs(d) < 1e-12) return o >= -h && o <= h;
  const a = (-h - o) / d, b = (h - o) / d, lo = a < b ? a : b, hi = a < b ? b : a;
  if (lo > SLAB[0]) SLAB[0] = lo;
  if (hi < SLAB[1]) SLAB[1] = hi;
  return SLAB[0] <= SLAB[1];
}

/**
 * Build the PropWorld of `place` for the layout in use ('wide': the PlaceDef's own fields; 'tall': `place.tall`, D-68). Home (`unit: 'slot'`) places its things
 * at spot x bodyScale (D-67) and builds them PARKED (Home's things arrive one by one: the shell calls setParked(thing, false) when one arrives; sizes stay in metres).
 * The ball's bounds are the layout's bounds (setBallBounds overrides them: Home's visible table).
 */
export function buildPropWorld(place: PlaceDef, layout: 'wide' | 'tall', bodyScale: number): PropWorld {
  const tall = layout === 'tall';
  const lay = tall ? place.tall : null;
  const home = place.unit === 'slot';
  const sc = home && Number.isFinite(bodyScale) && bodyScale > 0 ? bodyScale : 1;
  const parts: PropBuild[] = [];
  const things = place.things;
  for (let t = 0; t < things.length; t++) {
    const d = things[t];
    const spot = lay ? lay.things[t] : null;
    const x = (spot ? spot.x : d.x) * sc, z = (spot ? spot.z : d.z) * sc, yaw = spot ? spot.yaw : d.yaw;
    addThing(parts, t, d, x, z, yaw);
  }
  const walls = lay ? lay.walls : place.walls;
  for (let w = 0; w < walls.length; w++) {
    const a = walls[w];
    if (a.shape !== 'box') continue;
    const hw = PROPS.WALL_H / 2;
    parts.push({ thing: -1, part: w, kind: KIND_BOX, joint: JOINT_STATIC, mu: 0.8, capAxis: 0, strike: false, c: [a.x, hw, a.z], yaw: a.yaw ?? 0, h: [a.hx ?? 0.15, hw, a.hz ?? 0.15] });
  }
  const bd = lay ? lay.bounds : place.bounds;
  const bounds = bd.shape === 'disc'
    ? { shape: 0, v: [bd.x * sc, bd.z * sc, (bd.r ?? 3.4) * (home ? 1 : 1)] }
    : { shape: 1, v: [bd.x, bd.z, bd.hx ?? 3.4, bd.hz ?? 2.4, bd.round ?? 0] };
  return new PropWorld(parts, things.length, place.zones.length, bounds, home);
}

function addThing(out: PropBuild[], t: number, d: ThingDef, x: number, z: number, yaw: number): void {
  const p = d.p, s = d.size, mu = d.mu;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  switch (d.mech) {
    case MECH.block: {
      out.push({ thing: t, part: 0, kind: KIND_BOX, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, s[1], z], yaw, h: [s[0], s[1], s[2]] });
      if (p.kettleR) out.push({ thing: t, part: 1, kind: KIND_SPHERE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, 2 * s[1] + p.kettleR, z], yaw, h: [p.kettleR, 0, 0] });
      return;
    }
    case MECH.bar: {
      if (p.arch) return;   // an arch (Cloudloft's Sunbow Arch): not built yet
      const r = s[0], half = Math.max(0, s[1] / 2 - r);
      if (p.standing) out.push({ thing: t, part: 0, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 1, strike: false, c: [x, s[1] / 2, z], yaw, h: [r, half, 0] });
      else out.push({ thing: t, part: 0, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, r, z], yaw, h: [r, half, 0] });
      return;
    }
    case MECH.mound:
      out.push({ thing: t, part: 0, kind: KIND_SPHERE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, s[1] - s[0], z], yaw, h: [s[0], 0, 0] });
      return;
    case MECH.ring: {
      const R = s[0], r = s[1], gap = (s[2] * Math.PI) / 180, nseg = Math.max(1, Math.round(p.segments ?? 6));
      // the arc runs from the gap's edge at yaw + gap / 2 round to yaw + 2 pi - gap / 2 (yaw = the gap's direction, atan2(z, x))
      const a0 = yaw + gap / 2, span = 2 * Math.PI - gap;
      for (let i = 0; i < nseg; i++) {
        const u0 = a0 + (span * i) / nseg, u1 = a0 + (span * (i + 1)) / nseg;
        const x0 = x + R * Math.cos(u0), z0 = z + R * Math.sin(u0), x1 = x + R * Math.cos(u1), z1 = z + R * Math.sin(u1);
        const chord = Math.hypot(x1 - x0, z1 - z0), segYaw = Math.atan2(z1 - z0, x1 - x0);
        out.push({ thing: t, part: i, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [(x0 + x1) / 2, r, (z0 + z1) / 2], yaw: segYaw, h: [r, chord / 2, 0] });
      }
      return;
    }
    case MECH.seesaw: {
      const piv = p.pivot ?? 0.24;
      out.push({ thing: t, part: 0, kind: KIND_BOX, joint: JOINT_HINGE, mu, capAxis: 0, strike: false, c: [x, piv, z], yaw, h: [s[0], s[1], s[2]],
        pivot: [x, piv, z], axisLocal: 2, inertia: p.inertia ?? 0.5, damping: p.damping ?? 1, limitDeg: p.limit ?? 8, mgl: 0, reach: s[0] });
      return;
    }
    case MECH.swing: {
      // (p.box: a box seat of half sizes `size` [along its travel, up, across] instead of the capsule: PG_PHYS's fallback for a rider that slides off the capsule, PH-04)
      const rope = p.rope ?? 1.4, pivY = p.pivotY ?? 1.62, r = s[0], half = Math.max(0, s[1] / 2 - r), m = PROPS.SWING_SEAT, box = !!p.box;
      out.push({ thing: t, part: 0, kind: box ? KIND_BOX : KIND_CAPSULE, joint: JOINT_HINGE, mu, capAxis: 2, strike: false, c: [x, pivY - rope, z], yaw, h: box ? [s[0], s[1], s[2]] : [r, half, 0],
        pivot: [x, pivY, z], axisLocal: 2, inertia: m * rope * rope, damping: p.damping ?? 0.25, limitDeg: p.limit ?? 30, mgl: m * GRAVITY * rope, reach: rope });
      return;
    }
    case MECH.chime: {
      const nP = Math.max(1, Math.round(p.n ?? 1)), span = p.span ?? 0, hang = p.hang ?? 0.5, rail = PROPS.CHIME_RAIL_Y, m = PROPS.CHIME_MASS;
      for (let i = 0; i < nP; i++) {
        const off = nP > 1 ? -span / 2 + (span * i) / (nP - 1) : 0, px = x + cy * off, pz = z + sy * off;
        const box = !!p.box;
        out.push({ thing: t, part: i, kind: box ? KIND_BOX : KIND_CAPSULE, joint: JOINT_HINGE, mu, capAxis: 1, strike: true, c: [px, rail - hang, pz], yaw,
          h: box ? [s[0], s[1], s[2]] : [s[0], Math.max(0, s[1] - s[0]), 0], pivot: [px, rail, pz], axisLocal: 0, inertia: m * hang * hang, damping: p.damping ?? 0.8,
          limitDeg: p.limit ?? 25, mgl: m * GRAVITY * hang, reach: hang });
      }
      return;
    }
    case MECH.ball:
      out.push({ thing: t, part: 0, kind: KIND_SPHERE, joint: JOINT_BALL, mu, capAxis: 0, strike: false, c: [x, s[0], z], yaw: 0, h: [s[0], 0, 0], mass: p.mass ?? 0.2, rollDamp: p.rollDamp ?? 0.6 });
      return;
    default:
      return;   // patch and zone things (mech 0), ramp, pool, turntable, pad, floater, switch: no collider in this build (see the header)
  }
}
