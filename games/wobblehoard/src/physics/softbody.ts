// WOBBLEHOARD soft body: a volume-preserving jelly on ~600 particles, XPBD + shape matching, pure TypeScript.
//
// No three.js, no DOM, no Math.random, no Date.now, nothing allocated per step (typed-array scratch only; events
// allocate a small object each, only when one is emitted). Same genome + seed + input script => identical stateHash().
//
// TECHNIQUE (as recommended in _spec/CONTRACT.md section 4; no deviation in kind, tuned constants are in params.ts)
//   Particles = vertices of a welded icosphere (detail 3 = 642). Small-step XPBD: a fixed substep H = 1/360 s, ONE
//   solver pass per substep, six substeps per 60 Hz frame (a time accumulator makes the result independent of the
//   frame dt jitter beyond the clamp). Within a substep, in this order:
//     predict (gravity, or the float-mode hover spring) -> grab attachments -> shape matching -> enclosed-volume
//     constraint -> edge distance constraints -> collisions (finger spheres, then the table) -> v = dx/H ->
//     internal-velocity damping + drag + self-righting torque.
//   * edge distance (compliance from genome.stretch, hardening beyond a strain limit): the skin.
//   * ONE global enclosed-volume constraint V = 1/6 sum p_a.(p_b x p_c) = V0 with an XPBD multiplier: this is what
//     makes a squash bulge and a pulled lobe thin its neck. No scale hacks anywhere.
//   * global shape matching (Mueller 2016 quaternion rotation extraction, warm started, 2 iterations): every particle
//     is pulled toward g_i = c + R q_i. Stiffness from genome.firmness; the swirl-peak is 3x softer so it lags and flops.
//   * damping acts on the INTERNAL velocity only (velocity minus the best-fit rigid motion v_cm + w x r), rate from
//     genome.bounce, plus a tiny global drag: it jiggles 2-3 visible cycles but the whole body is never drag-limited.
//   * table y = 0: position projection + Coulomb friction expressed as a tangential displacement bounded by mu x
//     penetration (the normal impulse proxy), so it sits dead still, never creeps, and can still be pushed.
//   * fingers: kinematic spheres. Penetrating particles are projected out and the correction becomes velocity (a
//     poke shoves a floating body). Pull: Gaussian patch soft-attached to a moving world target.
// Units: metres-ish; mass per particle ~1 (tributary area, mean 1).
import type { Genome } from '../core/genome.ts';
import { clamp, lerp, mulberry32 } from '../core/rng.ts';
import type {
  FingerDownArgs, RayHit, SoftBodyLike, SoftEvent, SoftEventKind, SoftMetrics, V3,
} from '../contracts.ts';
import { buildIcosphere } from './mesh.ts';
import { buildRest, meshVolume } from './shape.ts';
import { deriveParams, EVENT_MIN_GAP_S, FINGER, GRAVITY, H, MAX_DT, MAX_SUBSTEPS } from './params.ts';
import type { SoftParams } from './params.ts';
import { extractRotation, rayMesh } from './mathx.ts';

/** Kinematic fingertip (ids 0 and 1). */
class Finger {
  down = false;        // the pointer is down (counts in metrics.fingers)
  retracting = false;  // lifted; the tip is still sliding out (<= 60 ms) and still collides
  contacted = false;   // some particle has touched the tip since fingerDown
  pressed = false;     // 'press' already emitted for this touch
  px = 0; py = 0; pz = 0;   // surface anchor P0 (smoothed)
  tx = 0; ty = 0; tz = 0;   // anchor target (pointer slide)
  dx = 0; dy = -1; dz = 0;  // travel direction (unit)
  nx = 0; ny = 1; nz = 0;   // outward surface normal at the contact (unit)
  depth = 0;           // eased press depth 0..1
  depthV = 0;          // d(depth)/dt, 1/s
  target = 0;          // target depth 0..1 (fingerPressure)
  depthMax = 0.3;      // world distance at depth 1
  holdT = 0;           // seconds since fingerDown
  retractRate = 0;     // depth units per second while retracting
  tipR = 0.1;          // current tip radius
  cx = 0; cy = 0; cz = 0;   // tip centre (world)
  pokeSpeed = 0;       // predicted closing speed (m/s) at first contact
}

/** Soft attachment of a Gaussian vertex patch to a world target. */
class Grab {
  active = false;
  count = 0;
  verts: Int32Array;
  weights: Float64Array;
  anchor = 0;            // grabbed vertex
  t0x = 0; t0y = 0; t0z = 0;   // target at grab time (the pull is measured from here)
  rx = 0; ry = 0; rz = 0;      // raw target (grabMove)
  ex = 0; ey = 0; ez = 0;      // eased target
  ramp = 0;
  holdT = 0;
  constructor(n: number) { this.verts = new Int32Array(n); this.weights = new Float64Array(n); }
}

const KIND_INDEX: Record<SoftEventKind, number> = { poke: 0, press: 1, release: 2, land: 3, grab: 4, snap: 5 };

const SM_ITERS = 2;                // rotation extraction iterations per substep (warm started)
const LAND_MIN_SPEED = 0.9;        // m/s of centre-of-mass fall speed for a 'land' event
const LAND_NORM = 4.5;             // m/s that maps to intensity 1
const POKE_NORM = 3.2;             // m/s predicted closing speed that maps to intensity 1
const MAX_SPEED = 40;              // safety clamp on particle speed (m/s)
const HOVER_OMEGA = 4.6, HOVER_ZETA = 0.62, HOVER_ABOVE = 0.35;
const BOB_AMP = 0.03, BOB_HZ = 0.33;

export class SoftBody implements SoftBodyLike {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly restLocal: Float32Array;
  readonly indices: Uint32Array;
  readonly strain: Float32Array;
  readonly center: V3 = { x: 0, y: 0, z: 0 };
  readonly frame = { x: 0, y: 0, z: 0, w: 1 };
  readonly metrics: SoftMetrics = {
    compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false,
  };
  readonly restRadius: number;
  /** Harness-only counters (not part of SoftBodyLike). `safetyResets` must stay 0: it counts emergency non-finite recoveries. */
  readonly debug = { substeps: 0, safetyResets: 0, contacts: 0, maxSpeed: 0, minVolume: 1 };

  // ---- configuration
  private readonly n: number;
  private readonly ne: number;
  private readonly nt: number;
  private readonly p: SoftParams;
  private readonly genome: Genome;
  private readonly restVolume: number;
  private readonly restCenterY: number;
  private readonly peakVertex: number;
  private readonly invM: Float64Array;      // 1 / mass
  private readonly M: Float64Array;         // mass
  private readonly Mtot: number;
  private readonly Q: Float64Array;         // rest local positions
  private readonly softW: Float64Array;     // per-vertex shape-matching stiffness multiplier
  private readonly tris: Uint32Array;
  private readonly edges: Uint32Array;
  private readonly restLen: Float64Array;
  private readonly valence: Float32Array;
  private readonly volS0: number;           // S0 = sum w |grad C|^2 of the rest shape (scale of the volume constraint)
  private readonly volAlphaT: number;
  private readonly smK: number;             // shape-matching position gain per substep
  private readonly edgeA: number;           // edge alpha tilde
  private readonly dampInt: number;         // internal velocity damping fraction per substep
  private readonly dragF: number;
  private readonly seedPhase: number;

  // ---- state
  private readonly X: Float64Array;         // positions
  private readonly XP: Float64Array;        // predicted positions
  private readonly V: Float64Array;         // velocities
  private readonly GOAL: Float64Array;      // shape-matching goal positions of the last substep
  private readonly GRAD: Float64Array;      // volume gradients (scratch)
  private readonly A9 = new Float64Array(9);
  private readonly qr = new Float64Array([0, 0, 0, 1]);
  private cx = 0; private cy = 0; private cz = 0;       // centre of mass (shape matching, predicted)
  private vcx = 0; private vcy = 0; private vcz = 0;    // rigid centre-of-mass velocity of the last substep
  private gravityOn = true;
  private simTime = 0;
  private acc = 0;
  private parity = 0;
  private airSub = 0;                       // substeps since the last table contact
  private contactCount = 0;                 // table contacts in the last substep
  private keAcc = 0;
  private keSubs = 0;
  private prevCompression = 0;
  private lastAxisX = 0; private lastAxisY = 1; private lastAxisZ = 0;
  private lastAxisT = -10;
  private readonly fingers: Finger[] = [new Finger(), new Finger()];
  private readonly grabs: Grab[];
  private events: SoftEvent[] = [];
  private readonly lastEvent = new Float64Array(6 * 3).fill(-10);
  private readonly rayOut = new Float64Array(4);
  private readonly rayOut2 = new Float64Array(4);
  private pendingLand = -1;                 // land impact speed waiting to be emitted this step

  constructor(genome: Genome, opts: { detail?: number; seed?: number } = {}) {
    const mesh = buildIcosphere(opts.detail ?? 3);
    const rest = buildRest(genome, mesh);
    const n = mesh.vertexCount;
    this.genome = genome;
    this.n = n;
    this.nt = mesh.tris.length / 3;
    this.ne = mesh.edges.length / 2;
    this.p = deriveParams(genome);
    this.vertexCount = n;
    this.tris = mesh.tris;
    this.indices = mesh.tris;
    this.edges = mesh.edges;
    this.restRadius = rest.restRadius;
    this.restVolume = rest.restVolume;
    this.restCenterY = rest.restCenterY;
    this.peakVertex = rest.peakVertex;
    this.Q = rest.restLocal;
    this.softW = rest.soft;
    this.M = rest.mass;
    this.invM = new Float64Array(n);
    let mt = 0;
    for (let i = 0; i < n; i++) { this.invM[i] = 1 / rest.mass[i]; mt += rest.mass[i]; }
    this.Mtot = mt;
    this.restLocal = Float32Array.from(rest.restLocal);
    this.positions = new Float32Array(n * 3);
    this.strain = new Float32Array(n).fill(1);
    this.X = new Float64Array(n * 3);
    this.XP = new Float64Array(n * 3);
    this.V = new Float64Array(n * 3);
    this.GOAL = new Float64Array(n * 3);
    this.GRAD = new Float64Array(n * 3);
    this.grabs = [new Grab(n), new Grab(n)];

    // edges
    this.restLen = new Float64Array(this.ne);
    this.valence = new Float32Array(n);
    for (let e = 0; e < this.ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.restLen[e] = Math.hypot(rest.restLocal[a * 3] - rest.restLocal[b * 3], rest.restLocal[a * 3 + 1] - rest.restLocal[b * 3 + 1], rest.restLocal[a * 3 + 2] - rest.restLocal[b * 3 + 2]);
      this.valence[a] += 1; this.valence[b] += 1;
    }

    // constants derived from params at the fixed substep
    const wh = this.p.smOmega * H;
    this.smK = (wh * wh) / (1 + wh * wh);
    this.edgeA = this.p.edgeAlphaT;
    this.dampInt = 1 - Math.exp(-this.p.intDamp * H);
    this.dragF = 1 - Math.exp(-this.p.drag * H);
    this.volS0 = this.volumeScale(rest.restLocal);
    this.volAlphaT = this.p.volKappa * this.volS0;
    this.seedPhase = mulberry32((opts.seed ?? genome.seed) >>> 0)() * Math.PI * 2;

    this.reset();
  }

  get gravity(): boolean { return this.gravityOn; }
  set gravity(v: boolean) {
    const on = !!v;
    if (on === this.gravityOn) return;
    this.gravityOn = on;
    this.airSub = 0;
  }

  // ------------------------------------------------------------------------------------------------ public API

  reset(): void {
    const n = this.n, X = this.X, Q = this.Q;
    const oy = this.gravityOn ? this.restCenterY + 1e-4 : this.hoverY(0);
    for (let i = 0; i < n; i++) {
      X[i * 3] = Q[i * 3]; X[i * 3 + 1] = Q[i * 3 + 1] + oy; X[i * 3 + 2] = Q[i * 3 + 2];
      this.GOAL[i * 3] = X[i * 3]; this.GOAL[i * 3 + 1] = X[i * 3 + 1]; this.GOAL[i * 3 + 2] = X[i * 3 + 2];
    }
    this.XP.set(X);
    this.V.fill(0);
    this.qr[0] = 0; this.qr[1] = 0; this.qr[2] = 0; this.qr[3] = 1;
    this.cx = 0; this.cy = oy; this.cz = 0;
    this.vcx = 0; this.vcy = 0; this.vcz = 0;
    this.acc = 0; this.airSub = this.gravityOn ? 0 : 1000; this.contactCount = 0;
    this.keAcc = 0; this.keSubs = 0; this.prevCompression = 0;
    this.lastAxisX = 0; this.lastAxisY = 1; this.lastAxisZ = 0; this.lastAxisT = -10;
    for (const f of this.fingers) { f.down = false; f.retracting = false; f.contacted = false; f.pressed = false; f.depth = 0; f.depthV = 0; f.target = 0; f.holdT = 0; }
    for (const g of this.grabs) { g.active = false; g.count = 0; }
    this.events.length = 0;
    this.lastEvent.fill(-10);
    this.pendingLand = -1;
    const m = this.metrics;
    m.compression = 0; m.compressionRate = 0; m.stretch = 0; m.volume = 1; m.kinetic = 0; m.grounded = this.gravityOn; m.fingers = 0; m.grabbed = false;
    this.strain.fill(1);
    this.syncOutputs();
  }

  step(dt: number): void {
    let d = Number.isFinite(dt) ? dt : (dt > 0 ? MAX_DT : 0);
    if (d < 0) d = 0;
    if (d > MAX_DT) d = MAX_DT;
    this.acc += d;
    let nsub = Math.floor(this.acc / H + 1e-6);
    if (nsub > MAX_SUBSTEPS) nsub = MAX_SUBSTEPS;
    this.acc -= nsub * H;
    if (this.acc < 0) this.acc = 0;
    if (nsub === 0) return;
    this.keAcc = 0; this.keSubs = 0;
    for (let s = 0; s < nsub; s++) {
      this.substep();
      this.simTime += H;
      this.postSubstep();
    }
    this.finalize(nsub * H);
  }

  raycast(origin: V3, dir: V3): RayHit | null {
    if (!origin || !dir) return null;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    if (!Number.isFinite(ox + oy + oz + dx + dy + dz)) return null;
    if (dx * dx + dy * dy + dz * dz < 1e-24) return null;
    if (!rayMesh(this.X, this.tris, ox, oy, oz, dx, dy, dz, this.rayOut)) return null;
    const t = this.rayOut[0], tri = this.rayOut[1] | 0, u = this.rayOut[2], v = this.rayOut[3];
    const a = this.tris[tri * 3], b = this.tris[tri * 3 + 1], c = this.tris[tri * 3 + 2];
    const nrm = this.triNormal(a, b, c);
    const w0 = 1 - u - v;
    const vertex = w0 >= u && w0 >= v ? a : u >= v ? b : c;
    return {
      point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
      normal: { x: nrm[0], y: nrm[1], z: nrm[2] },
      vertex, t,
    };
  }

  fingerDown(id: 0 | 1, a: FingerDownArgs): void {
    const f = this.fingers[id];
    if (!f || !a || !a.point || !a.normal || !a.dir) return;
    const px = a.point.x, py = a.point.y, pz = a.point.z;
    let dx = a.dir.x, dy = a.dir.y, dz = a.dir.z;
    let nx = a.normal.x, ny = a.normal.y, nz = a.normal.z;
    if (!Number.isFinite(px + py + pz + dx + dy + dz + nx + ny + nz)) return;
    let dl = Math.hypot(dx, dy, dz);
    const nl = Math.hypot(nx, ny, nz);
    if (dl < 1e-6) {
      if (nl < 1e-6) { dx = 0; dy = -1; dz = 0; } else { dx = -nx / nl; dy = -ny / nl; dz = -nz / nl; }
      dl = 1;
    }
    dx /= dl; dy /= dl; dz /= dl;
    // a grab on this id is cancelled by a new touch
    if (this.grabs[id].active) this.grabs[id].active = false;

    const R = this.restRadius;
    // re-seat the contact on the CURRENT surface along the ray (the hit point may be a frame old)
    const L = 8 * R;
    let hx = px, hy = py, hz = pz;
    let hitTri = -1;
    if (rayMesh(this.X, this.tris, px - dx * L, py - dy * L, pz - dz * L, dx, dy, dz, this.rayOut)) {
      const t = this.rayOut[0];
      hx = px - dx * L + dx * t; hy = py - dy * L + dy * t; hz = pz - dz * L + dz * t;
      hitTri = this.rayOut[1] | 0;
    }
    if (nl > 1e-6 && (nx * -dx + ny * -dy + nz * -dz) > 0.05 * nl) { nx /= nl; ny /= nl; nz /= nl; }
    else if (hitTri >= 0) {
      const t3 = hitTri * 3;
      const nr = this.triNormal(this.tris[t3], this.tris[t3 + 1], this.tris[t3 + 2]);
      nx = nr[0]; ny = nr[1]; nz = nr[2];
    } else { nx = -dx; ny = -dy; nz = -dz; }

    // body thickness along the finger direction -> max safe depth
    let T = 2 * R;
    if (hitTri >= 0 && rayMesh(this.X, this.tris, hx + dx * L, hy + dy * L, hz + dz * L, -dx, -dy, -dz, this.rayOut2)) {
      T = Math.max(0.3 * R, L - this.rayOut2[0]);
    }
    f.down = true; f.retracting = false; f.contacted = false; f.pressed = false;
    f.px = hx; f.py = hy; f.pz = hz; f.tx = hx; f.ty = hy; f.tz = hz;
    f.dx = dx; f.dy = dy; f.dz = dz; f.nx = nx; f.ny = ny; f.nz = nz;
    f.depth = 0; f.depthV = 0; f.target = 0; f.holdT = 0;
    f.depthMax = Math.max(0.2 * R, FINGER.maxThickness * T);
    f.tipR = R * FINGER.rMin;
    this.placeTip(f);
  }

  fingerPressure(id: 0 | 1, target: number): void {
    const f = this.fingers[id];
    if (!f || !f.down || !Number.isFinite(target)) return;
    f.target = clamp(target, 0, 1);
  }

  fingerMove(id: 0 | 1, point: V3): void {
    const f = this.fingers[id];
    if (!f || !f.down || !point) return;
    const qx = point.x, qy = point.y, qz = point.z;
    if (!Number.isFinite(qx + qy + qz)) return;
    // project the pointer hit onto the plane through the anchor, perpendicular to the travel direction
    const ex = qx - f.px, ey = qy - f.py, ez = qz - f.pz;
    const s = ex * f.dx + ey * f.dy + ez * f.dz;
    const lx = f.px + ex - f.dx * s, ly = f.py + ey - f.dy * s, lz = f.pz + ez - f.dz * s;
    // follow the relief of the UNDEFORMED (goal) surface: the difference of two hits on the same goal mesh, so the
    // body's own motion / squash cancels and the press depth never feeds back on itself
    const L = 8 * this.restRadius;
    let ox = lx, oy = ly, oz = lz;
    if (rayMesh(this.GOAL, this.tris, f.px - f.dx * L, f.py - f.dy * L, f.pz - f.dz * L, f.dx, f.dy, f.dz, this.rayOut)
      && rayMesh(this.GOAL, this.tris, lx - f.dx * L, ly - f.dy * L, lz - f.dz * L, f.dx, f.dy, f.dz, this.rayOut2)) {
      const dt = this.rayOut2[0] - this.rayOut[0];
      ox = lx + f.dx * dt; oy = ly + f.dy * dt; oz = lz + f.dz * dt;
    }
    // keep the slide inside a sane distance of the body
    const dc = Math.hypot(ox - this.cx, oy - this.cy, oz - this.cz);
    if (dc > 3 * this.restRadius) return;
    f.tx = ox; f.ty = oy; f.tz = oz;
  }

  fingerUp(id: 0 | 1): void {
    const f = this.fingers[id];
    if (!f || !f.down) return;
    const comp = this.metrics.compression;
    if (f.contacted && comp > 0.08) {
      const front = f.depth * f.depthMax;
      this.emit('release', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz, comp, f.holdT, id);
    }
    f.down = false;
    if (f.depth > 1e-4) { f.retracting = true; f.retractRate = f.depth / FINGER.retractS; } else f.retracting = false;
    f.target = 0; f.depthV = 0;
  }

  grab(id: 0 | 1, vertex: number, target: V3): void {
    const g = this.grabs[id];
    if (!g || !target) return;
    const tx = target.x, ty = target.y, tz = target.z;
    if (!Number.isFinite(tx + ty + tz + vertex)) return;
    const v = Math.floor(vertex);
    if (v < 0 || v >= this.n) return;
    if (g.active) this.grabRelease(id);
    const f = this.fingers[id];
    if (f.down || f.retracting) { f.down = false; f.retracting = false; f.depth = 0; f.depthV = 0; }
    const Q = this.Q, r0 = 0.3 * this.restRadius;
    const qx = Q[v * 3], qy = Q[v * 3 + 1], qz = Q[v * 3 + 2];
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = Q[i * 3] - qx, dy = Q[i * 3 + 1] - qy, dz = Q[i * 3 + 2] - qz;
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) / (r0 * r0));
      if (w < 0.03) continue;
      g.verts[c] = i; g.weights[c] = w; c++;
    }
    g.count = c; g.anchor = v; g.active = true; g.ramp = 0; g.holdT = 0;
    g.t0x = tx; g.t0y = ty; g.t0z = tz; g.rx = tx; g.ry = ty; g.rz = tz; g.ex = tx; g.ey = ty; g.ez = tz;
    const X = this.X;
    this.emit('grab', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], ...this.vertexNormal(v), 0.5, 0, id);
  }

  grabMove(id: 0 | 1, target: V3): void {
    const g = this.grabs[id];
    if (!g || !g.active || !target) return;
    if (!Number.isFinite(target.x + target.y + target.z)) return;
    g.rx = target.x; g.ry = target.y; g.rz = target.z;
  }

  grabRelease(id: 0 | 1): void {
    const g = this.grabs[id];
    if (!g || !g.active) return;
    g.active = false;
    const s = this.metrics.stretch;
    if (s > 0.05) {
      const v = g.anchor, X = this.X;
      this.emit('snap', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], ...this.vertexNormal(v), clamp(s, 0, 1), g.holdT, id);
    }
  }

  nudge(impulse: V3): void {
    if (!impulse) return;
    let ix = impulse.x, iy = impulse.y, iz = impulse.z;
    if (!Number.isFinite(ix + iy + iz)) return;
    const l = Math.hypot(ix, iy, iz);
    if (l > 12) { const k = 12 / l; ix *= k; iy *= k; iz *= k; }
    const V = this.V;
    for (let i = 0; i < this.n; i++) { V[i * 3] += ix; V[i * 3 + 1] += iy; V[i * 3 + 2] += iz; }
  }

  drainEvents(out: SoftEvent[]): void {
    for (let i = 0; i < this.events.length; i++) out.push(this.events[i]);
    this.events.length = 0;
  }

  stateHash(): number {
    let h = 0x811c9dc5 | 0;
    const X = this.X;
    for (let i = 0; i < X.length; i++) {
      h ^= Math.round(X[i] * 8192) | 0;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ------------------------------------------------------------------------------------------------ internals

  private hoverY(t: number): number {
    return this.restRadius + HOVER_ABOVE + BOB_AMP * Math.sin(2 * Math.PI * BOB_HZ * t + this.seedPhase);
  }

  private triNormal(a: number, b: number, c: number): [number, number, number] {
    const X = this.X;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2];
    const vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  }

  private vertexNormal(v: number): [number, number, number] {
    // outward direction of the rest shape rotated by the frame (cheap, always finite)
    const Q = this.Q;
    let x = Q[v * 3], y = Q[v * 3 + 1], z = Q[v * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  }

  private volumeScale(q: Float64Array): number {
    // S0 = sum_i w_i |grad_i V|^2 / V0^2 at the rest shape (translation-invariant, so rest-local coordinates are fine)
    const n = this.n, g = new Float64Array(n * 3), tris = this.tris;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const bcx = q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1], bcy = q[b + 2] * q[c] - q[b] * q[c + 2], bcz = q[b] * q[c + 1] - q[b + 1] * q[c];
      const cax = q[c + 1] * q[a + 2] - q[c + 2] * q[a + 1], cay = q[c + 2] * q[a] - q[c] * q[a + 2], caz = q[c] * q[a + 1] - q[c + 1] * q[a];
      const abx = q[a + 1] * q[b + 2] - q[a + 2] * q[b + 1], aby = q[a + 2] * q[b] - q[a] * q[b + 2], abz = q[a] * q[b + 1] - q[a + 1] * q[b];
      g[a] += bcx; g[a + 1] += bcy; g[a + 2] += bcz;
      g[b] += cax; g[b + 1] += cay; g[b + 2] += caz;
      g[c] += abx; g[c + 1] += aby; g[c + 2] += abz;
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += this.invM[i] * (g[i * 3] * g[i * 3] + g[i * 3 + 1] * g[i * 3 + 1] + g[i * 3 + 2] * g[i * 3 + 2]);
    const v6 = 6 * this.restVolume;
    return s / (v6 * v6);
  }

  private placeTip(f: Finger): void {
    const R = this.restRadius;
    const dv = clamp(f.depth, 0, 1);
    f.tipR = R * (FINGER.rMin + (FINGER.rMax - FINGER.rMin) * dv);
    const s = dv * f.depthMax - f.tipR;
    f.cx = f.px + f.dx * s; f.cy = f.py + f.dy * s; f.cz = f.pz + f.dz * s;
  }

  /** Advance finger depth (critically damped), slide and retract by one substep, then place the tips (pinch-safe). */
  private updateFingers(): void {
    const w = FINGER.omega;
    const slide = 1 - Math.exp(-FINGER.slideRate * H);
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      if (f.down) {
        const a = w * w * (f.target - f.depth) - 2 * w * f.depthV;
        f.depthV += a * H;
        f.depth += f.depthV * H;
        if (f.depth < 0) { f.depth = 0; f.depthV = 0; } else if (f.depth > 1) { f.depth = 1; f.depthV = 0; }
        f.holdT += H;
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f);
      } else if (f.retracting) {
        f.depth -= f.retractRate * H;
        if (f.depth <= 0) { f.depth = 0; f.retracting = false; }
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f);
      }
    }
    // pinch: the two tips never overlap or pass through each other
    const a = this.fingers[0], b = this.fingers[1];
    if ((a.down || a.retracting) && (b.down || b.retracting)) {
      let dx = b.cx - a.cx, dy = b.cy - a.cy, dz = b.cz - a.cz;
      let d = Math.hypot(dx, dy, dz);
      const minD = a.tipR + b.tipR + FINGER.pinchGap * this.restRadius;
      if (d < minD) {
        if (d < 1e-9) { dx = 1; dy = 0; dz = 0; d = 1; }
        const push = 0.5 * (minD - d) / d;
        a.cx -= dx * push; a.cy -= dy * push; a.cz -= dz * push;
        b.cx += dx * push; b.cy += dy * push; b.cz += dz * push;
      }
    }
  }

  private updateGrabs(): void {
    const ease = 1 - Math.exp(-35 * H);
    const maxD = this.p.maxPull * this.restRadius;
    for (let k = 0; k < 2; k++) {
      const g = this.grabs[k];
      if (!g.active) continue;
      g.ramp = Math.min(1, g.ramp + H / 0.06);
      g.holdT += H;
      g.ex += (g.rx - g.ex) * ease; g.ey += (g.ry - g.ey) * ease; g.ez += (g.rz - g.ez) * ease;
      // clamp the pull distance
      let dx = g.ex - g.t0x, dy = g.ey - g.t0y, dz = g.ez - g.t0z;
      const dl = Math.hypot(dx, dy, dz);
      if (dl > maxD) { const s = maxD / dl; g.ex = g.t0x + dx * s; g.ey = g.t0y + dy * s; g.ez = g.t0z + dz * s; }
    }
  }

  private substep(): void {
    const n = this.n, X = this.X, XP = this.XP, V = this.V, M = this.M, invM = this.invM, Q = this.Q;
    const GOAL = this.GOAL, GRAD = this.GRAD;
    this.parity ^= 1;
    this.debug.substeps++;

    this.updateFingers();
    this.updateGrabs();
    let nFingers = 0;
    if (this.fingers[0].down) nFingers++;
    if (this.fingers[1].down) nFingers++;

    // ---- external acceleration + predict
    let ax = 0, ay = 0, az = 0;
    if (this.gravityOn) {
      ay = -GRAVITY;
    } else {
      // float mode: weak hover spring on the centre of mass (stiffer while a finger holds it) + slow bob
      const boost = 1 + 2.5 * nFingers;
      const w2 = HOVER_OMEGA * HOVER_OMEGA * boost, c = 2 * HOVER_ZETA * HOVER_OMEGA * Math.sqrt(boost);
      const hy = this.hoverY(this.simTime);
      ax = -w2 * this.cx - c * this.vcx;
      ay = -w2 * (this.cy - hy) - c * this.vcy;
      az = -w2 * this.cz - c * this.vcz;
    }
    const hax = ax * H, hay = ay * H, haz = az * H;
    for (let i = 0; i < n * 3; i += 3) {
      const vx = V[i] + hax, vy = V[i + 1] + hay, vz = V[i + 2] + haz;
      V[i] = vx; V[i + 1] = vy; V[i + 2] = vz;
      XP[i] = X[i] + vx * H; XP[i + 1] = X[i + 1] + vy * H; XP[i + 2] = X[i + 2] + vz * H;
    }

    // ---- shape matching (global): c, A = sum m p q^T, R, goals, soft pull
    {
      let sx = 0, sy = 0, sz = 0;
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const px = XP[i3], py = XP[i3 + 1], pz = XP[i3 + 2];
        const qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2];
        const mx = m * px, my = m * py, mz = m * pz;
        sx += mx; sy += my; sz += mz;
        a00 += mx * qx; a01 += mx * qy; a02 += mx * qz;
        a10 += my * qx; a11 += my * qy; a12 += my * qz;
        a20 += mz * qx; a21 += mz * qy; a22 += mz * qz;
      }
      const cx = sx / this.Mtot, cy = sy / this.Mtot, cz = sz / this.Mtot;
      this.cx = cx; this.cy = cy; this.cz = cz;
      const A = this.A9;
      A[0] = a00; A[1] = a01; A[2] = a02; A[3] = a10; A[4] = a11; A[5] = a12; A[6] = a20; A[7] = a21; A[8] = a22;
      const q = this.qr;
      extractRotation(A, q, SM_ITERS);
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
      const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
      const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
      const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
      const K = this.smK, soft = this.softW;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const qx_ = Q[i3], qy_ = Q[i3 + 1], qz_ = Q[i3 + 2];
        const gx = cx + r00 * qx_ + r01 * qy_ + r02 * qz_;
        const gy = cy + r10 * qx_ + r11 * qy_ + r12 * qz_;
        const gz = cz + r20 * qx_ + r21 * qy_ + r22 * qz_;
        GOAL[i3] = gx; GOAL[i3 + 1] = gy; GOAL[i3 + 2] = gz;
        const k = K * soft[i];
        XP[i3] += (gx - XP[i3]) * k; XP[i3 + 1] += (gy - XP[i3 + 1]) * k; XP[i3 + 2] += (gz - XP[i3 + 2]) * k;
      }
    }

    // ---- enclosed-volume constraint (one global XPBD multiplier)
    {
      const tris = this.tris, nt = this.nt;
      const ox = this.cx, oy = this.cy, oz = this.cz;
      for (let i = 0; i < n * 3; i++) GRAD[i] = 0;
      let vol6 = 0;
      for (let t = 0; t < nt; t++) {
        const t3 = t * 3;
        const a = tris[t3] * 3, b = tris[t3 + 1] * 3, c = tris[t3 + 2] * 3;
        const ax_ = XP[a] - ox, ay_ = XP[a + 1] - oy, az_ = XP[a + 2] - oz;
        const bx = XP[b] - ox, by = XP[b + 1] - oy, bz = XP[b + 2] - oz;
        const cx = XP[c] - ox, cy = XP[c + 1] - oy, cz = XP[c + 2] - oz;
        const bcx = by * cz - bz * cy, bcy = bz * cx - bx * cz, bcz = bx * cy - by * cx;
        vol6 += ax_ * bcx + ay_ * bcy + az_ * bcz;
        GRAD[a] += bcx; GRAD[a + 1] += bcy; GRAD[a + 2] += bcz;
        GRAD[b] += cy * az_ - cz * ay_; GRAD[b + 1] += cz * ax_ - cx * az_; GRAD[b + 2] += cx * ay_ - cy * ax_;
        GRAD[c] += ay_ * bz - az_ * by; GRAD[c + 1] += az_ * bx - ax_ * bz; GRAD[c + 2] += ax_ * by - ay_ * bx;
      }
      const v6 = 6 * this.restVolume;
      const C = (vol6 - v6) / v6;
      let S = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        S += invM[i] * (GRAD[i3] * GRAD[i3] + GRAD[i3 + 1] * GRAD[i3 + 1] + GRAD[i3 + 2] * GRAD[i3 + 2]);
      }
      S /= v6 * v6;
      const lambda = -C / (S + this.volAlphaT);
      const sc = lambda / v6;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, s = sc * invM[i];
        XP[i3] += GRAD[i3] * s; XP[i3 + 1] += GRAD[i3 + 1] * s; XP[i3 + 2] += GRAD[i3 + 2] * s;
      }
    }

    // ---- edge distance constraints (Gauss-Seidel, direction alternates each substep)
    {
      const E = this.edges, L0 = this.restLen, ne = this.ne;
      const aT = this.edgeA, softS = this.p.edgeSoftStrain;
      const forward = this.parity === 0;
      for (let k = 0; k < ne; k++) {
        const e = forward ? k : ne - 1 - k;
        const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3;
        const dx = XP[a] - XP[b], dy = XP[a + 1] - XP[b + 1], dz = XP[a + 2] - XP[b + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-12) continue;
        const l0 = L0[e];
        const C = len - l0;
        const alpha = C > l0 * softS ? aT * 0.12 : aT;
        const wa = invM[a / 3], wb = invM[b / 3];
        const s = -C / ((wa + wb + alpha) * len);
        const sa = s * wa, sb = s * wb;
        XP[a] += dx * sa; XP[a + 1] += dy * sa; XP[a + 2] += dz * sa;
        XP[b] -= dx * sb; XP[b + 1] -= dy * sb; XP[b + 2] -= dz * sb;
      }
    }

    // ---- grab attachments (applied after the internal constraints so the user's hand wins within the substep)
    for (let k = 0; k < 2; k++) {
      const g = this.grabs[k];
      if (!g.active) continue;
      const px = g.ex - g.t0x, py = g.ey - g.t0y, pz = g.ez - g.t0z;
      const kg = 0.45 * g.ramp;
      for (let j = 0; j < g.count; j++) {
        const i3 = g.verts[j] * 3, w = g.weights[j] * kg;
        XP[i3] += (GOAL[i3] + px - XP[i3]) * w;
        XP[i3 + 1] += (GOAL[i3 + 1] + py - XP[i3 + 1]) * w;
        XP[i3 + 2] += (GOAL[i3 + 2] + pz - XP[i3 + 2]) * w;
      }
    }

    // ---- collisions: finger spheres, then the table (the table always wins)
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      if (!f.down && !f.retracting) continue;
      const r = f.tipR, r2 = r * r, cx = f.cx, cy = f.cy, cz = f.cz;
      let hit = false;
      for (let i = 0; i < n * 3; i += 3) {
        const dx = XP[i] - cx, dy = XP[i + 1] - cy, dz = XP[i + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        hit = true;
        if (d2 > 1e-14) {
          const s = r / Math.sqrt(d2);
          XP[i] = cx + dx * s; XP[i + 1] = cy + dy * s; XP[i + 2] = cz + dz * s;
        } else {
          XP[i] = cx + f.dx * r; XP[i + 1] = cy + f.dy * r; XP[i + 2] = cz + f.dz * r;
        }
      }
      if (hit && !f.contacted && f.down) {
        f.contacted = true;
        const closing = Math.max(0, (f.target - f.depth)) * f.depthMax * FINGER.omega / Math.E + Math.max(0, f.depthV) * f.depthMax;
        f.pokeSpeed = closing;
        const front = f.depth * f.depthMax;
        this.emit('poke', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz,
          clamp(closing / POKE_NORM, 0.05, 1), 0, k);
      }
    }
    {
      const mu = this.p.tableMu;
      let contacts = 0;
      for (let i = 0; i < n * 3; i += 3) {
        const y = XP[i + 1];
        if (y >= 0) continue;
        contacts++;
        const pen = -y;
        XP[i + 1] = 0;
        const tx = XP[i] - X[i], tz = XP[i + 2] - X[i + 2];
        const tl = Math.sqrt(tx * tx + tz * tz);
        if (tl > 1e-12) {
          const cap = mu * pen;
          if (tl <= cap) { XP[i] = X[i]; XP[i + 2] = X[i + 2]; } else { const s = cap / tl; XP[i] -= tx * s; XP[i + 2] -= tz * s; }
        }
      }
      // land detection: first contact after being airborne, speed = centre-of-mass fall speed
      if (contacts > 0) {
        if (this.airSub >= 8 && -this.vcy > LAND_MIN_SPEED) this.pendingLand = Math.max(this.pendingLand, -this.vcy);
        this.airSub = 0;
      } else if (this.airSub < 100000) this.airSub++;
      this.contactCount = contacts;
    }

    // ---- velocity from positions
    const invH = 1 / H;
    for (let i = 0; i < n * 3; i++) { V[i] = (XP[i] - X[i]) * invH; X[i] = XP[i]; }

    // ---- rigid-motion extraction, internal damping, drag, self-righting
    this.dampPass();
  }

  private dampPass(): void {
    const n = this.n, X = this.X, V = this.V, M = this.M;
    let sm = 0, sx = 0, sy = 0, sz = 0, svx = 0, svy = 0, svz = 0, lx = 0, ly = 0, lz = 0;
    let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, m = M[i];
      const x = X[i3], y = X[i3 + 1], z = X[i3 + 2];
      const vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      sm += m; sx += m * x; sy += m * y; sz += m * z;
      svx += m * vx; svy += m * vy; svz += m * vz;
      lx += m * (y * vz - z * vy); ly += m * (z * vx - x * vz); lz += m * (x * vy - y * vx);
      ixx += m * (y * y + z * z); iyy += m * (x * x + z * z); izz += m * (x * x + y * y);
      ixy -= m * x * y; ixz -= m * x * z; iyz -= m * y * z;
    }
    const inv = 1 / sm;
    const cx = sx * inv, cy = sy * inv, cz = sz * inv;
    const vcx = svx * inv, vcy = svy * inv, vcz = svz * inv;
    // about the centre of mass
    lx -= sm * (cy * vcz - cz * vcy); ly -= sm * (cz * vcx - cx * vcz); lz -= sm * (cx * vcy - cy * vcx);
    ixx -= sm * (cy * cy + cz * cz); iyy -= sm * (cx * cx + cz * cz); izz -= sm * (cx * cx + cy * cy);
    ixy += sm * cx * cy; ixz += sm * cx * cz; iyz += sm * cy * cz;
    // omega = I^-1 L (symmetric 3x3 inverse by cofactors)
    const c00 = iyy * izz - iyz * iyz, c01 = ixz * iyz - ixy * izz, c02 = ixy * iyz - ixz * iyy;
    const c11 = ixx * izz - ixz * ixz, c12 = ixy * ixz - ixx * iyz, c22 = ixx * iyy - ixy * ixy;
    const det = ixx * c00 + ixy * c01 + ixz * c02;
    let wx = 0, wy = 0, wz = 0;
    if (det > 1e-9) {
      const id = 1 / det;
      wx = (c00 * lx + c01 * ly + c02 * lz) * id;
      wy = (c01 * lx + c11 * ly + c12 * lz) * id;
      wz = (c02 * lx + c12 * ly + c22 * lz) * id;
    }
    this.vcx = vcx; this.vcy = vcy; this.vcz = vcz;

    // self-righting torque (a weeble: it flops over but rights itself) + angular damping of the rigid spin
    const q = this.qr;
    const upx = 2 * (q[0] * q[1] - q[3] * q[2]), upy = 1 - 2 * (q[0] * q[0] + q[2] * q[2]), upz = 2 * (q[1] * q[2] + q[3] * q[0]);
    const sinT = Math.sqrt(upx * upx + upz * upz);
    const theta = Math.acos(clamp(upy, -1, 1));
    const scale = sinT > 1e-6 ? theta / sinT : 0;
    const float = !this.gravityOn;
    const kUp = float ? 30 : 12, cAng = float ? 4 : 1.2;
    const awx = (-upz * scale * kUp - cAng * wx) * H, awy = -cAng * wy * H, awz = (upx * scale * kUp - cAng * wz) * H;

    const dI = this.dampInt, dr = this.dragF;
    let ke = 0;
    const vmax2 = MAX_SPEED * MAX_SPEED;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const rx = X[i3] - cx, ry = X[i3 + 1] - cy, rz = X[i3 + 2] - cz;
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      // internal velocity = v - v_cm - w x r
      const ivx = vx - vcx - (wy * rz - wz * ry), ivy = vy - vcy - (wz * rx - wx * rz), ivz = vz - vcz - (wx * ry - wy * rx);
      ke += M[i] * (ivx * ivx + ivy * ivy + ivz * ivz);
      vx += -dI * ivx - dr * vx + (awy * rz - awz * ry);
      vy += -dI * ivy - dr * vy + (awz * rx - awx * rz);
      vz += -dI * ivz - dr * vz + (awx * ry - awy * rx);
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) { const s = MAX_SPEED / Math.sqrt(s2); vx *= s; vy *= s; vz *= s; }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    }
    this.keAcc += 0.5 * ke / sm;
    this.keSubs++;
  }

  /** Per-substep bookkeeping that emits events (cheap). */
  private postSubstep(): void {
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      if (f.down && f.contacted && !f.pressed && f.holdT >= FINGER.pressAfterS && f.depth > 0.03) {
        f.pressed = true;
        const front = f.depth * f.depthMax;
        this.emit('press', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz, clamp(f.depth, 0, 1), f.holdT, k);
      }
    }
    if (this.pendingLand > 0) {
      const X = this.X;
      let lx = 0, lz = 0, c = 0;
      for (let i = 0; i < this.n; i++) if (X[i * 3 + 1] < 0.01) { lx += X[i * 3]; lz += X[i * 3 + 2]; c++; }
      if (c > 0) { lx /= c; lz /= c; } else { lx = this.cx; lz = this.cz; }
      this.emit('land', lx, 0, lz, 0, 1, 0, clamp(this.pendingLand / LAND_NORM, 0.05, 1), 0, -1);
      this.pendingLand = -1;
    }
  }

  private emit(kind: SoftEventKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, intensity: number, heldFor: number, finger: number): void {
    const li = KIND_INDEX[kind] * 3 + (finger + 1);
    if (this.simTime - this.lastEvent[li] < EVENT_MIN_GAP_S) return;
    if (this.events.length >= 128) return;
    this.lastEvent[li] = this.simTime;
    const nl = Math.hypot(nx, ny, nz) || 1;
    this.events.push({
      kind, at: { x, y, z }, normal: { x: nx / nl, y: ny / nl, z: nz / nl },
      intensity: clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1), heldFor, finger,
    });
  }

  private syncOutputs(): void {
    const n = this.n, X = this.X, P = this.positions;
    for (let i = 0; i < n * 3; i++) P[i] = X[i];
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += this.M[i] * X[i * 3]; sy += this.M[i] * X[i * 3 + 1]; sz += this.M[i] * X[i * 3 + 2]; }
    this.center.x = sx / this.Mtot; this.center.y = sy / this.Mtot; this.center.z = sz / this.Mtot;
    this.frame.x = this.qr[0]; this.frame.y = this.qr[1]; this.frame.z = this.qr[2]; this.frame.w = this.qr[3];
  }

  /** End-of-step: outputs, strain, metrics, safety net. */
  private finalize(dt: number): void {
    const n = this.n, X = this.X;
    // safety net: a non-finite state is recovered (and counted: the probe requires the count to stay 0)
    let sum = 0;
    for (let i = 0; i < n * 3; i++) sum += X[i];
    if (!Number.isFinite(sum)) {
      this.debug.safetyResets++;
      this.reset();
      return;
    }
    this.syncOutputs();
    const m = this.metrics;

    // strain per vertex = mean(edge / rest edge)
    const st = this.strain, E = this.edges, L0 = this.restLen;
    st.fill(0);
    for (let e = 0; e < this.ne; e++) {
      const a = E[e * 2], b = E[e * 2 + 1];
      const r = Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) / L0[e];
      st[a] += r; st[b] += r;
    }
    for (let i = 0; i < n; i++) st[i] /= this.valence[i];

    // volume
    const vol = meshVolume(X, this.tris) / this.restVolume;
    m.volume = vol;
    if (vol < this.debug.minVolume) this.debug.minVolume = vol;

    // press axis: a finger's travel direction, the pinch line, the last axis for 0.6 s after a lift, else world up
    let ax = 0, ay = 1, az = 0;
    const f0 = this.fingers[0], f1 = this.fingers[1];
    const nf = (f0.down ? 1 : 0) + (f1.down ? 1 : 0);
    if (nf === 2) {
      ax = f1.cx - f0.cx; ay = f1.cy - f0.cy; az = f1.cz - f0.cz;
      const l = Math.hypot(ax, ay, az);
      if (l > 1e-6) { ax /= l; ay /= l; az /= l; } else { ax = 0; ay = 1; az = 0; }
      this.lastAxisX = ax; this.lastAxisY = ay; this.lastAxisZ = az; this.lastAxisT = this.simTime;
    } else if (nf === 1) {
      const f = f0.down ? f0 : f1;
      ax = f.dx; ay = f.dy; az = f.dz;
      this.lastAxisX = ax; this.lastAxisY = ay; this.lastAxisZ = az; this.lastAxisT = this.simTime;
    } else if (this.simTime - this.lastAxisT < 0.6) {
      ax = this.lastAxisX; ay = this.lastAxisY; az = this.lastAxisZ;
    }
    // thickness along the axis now vs at rest (rest axis = axis rotated into body space by the inverse frame)
    const q = this.qr;
    const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
    const tx = 2 * (qy * az - qz * ay), ty = 2 * (qz * ax - qx * az), tz = 2 * (qx * ay - qy * ax);
    const lx = ax + qw * tx + (qy * tz - qz * ty), ly = ay + qw * ty + (qz * tx - qx * tz), lz = az + qw * tz + (qx * ty - qy * tx);
    let mn = Infinity, mx = -Infinity, rmn = Infinity, rmx = -Infinity;
    const Q = this.Q;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const d = X[i3] * ax + X[i3 + 1] * ay + X[i3 + 2] * az;
      if (d < mn) mn = d; if (d > mx) mx = d;
      const r = Q[i3] * lx + Q[i3 + 1] * ly + Q[i3 + 2] * lz;
      if (r < rmn) rmn = r; if (r > rmx) rmx = r;
    }
    const comp = clamp((1 - (mx - mn) / Math.max(1e-6, rmx - rmn)) / 0.75, 0, 1);
    const rate = (comp - this.prevCompression) / dt;
    this.prevCompression = comp;
    m.compression = comp;
    m.compressionRate += (rate - m.compressionRate) * (1 - Math.exp(-dt / 0.06));
    if (!Number.isFinite(m.compressionRate)) m.compressionRate = 0;

    // stretch: biggest outward displacement of any particle from where the rigid frame wants it
    const G = this.GOAL;
    let best = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const ux = G[i3] - this.cx, uy = G[i3 + 1] - this.cy, uz = G[i3 + 2] - this.cz;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      const disp = ((X[i3] - G[i3]) * ux + (X[i3 + 1] - G[i3 + 1]) * uy + (X[i3 + 2] - G[i3 + 2]) * uz) / ul;
      if (disp > best) best = disp;
    }
    m.stretch = clamp((best - 0.1 * this.restRadius) / (2.3 * this.restRadius), 0, 1);

    m.kinetic = clamp((this.keAcc / Math.max(1, this.keSubs)) / 0.08, 0, 1);
    m.grounded = this.contactCount >= 3;
    m.fingers = nf;
    m.grabbed = this.grabs[0].active || this.grabs[1].active;
    const sp = Math.hypot(this.vcx, this.vcy, this.vcz);
    if (sp > this.debug.maxSpeed) this.debug.maxSpeed = sp;
    this.debug.contacts = this.contactCount;
  }
}

// keep lerp referenced for tooling that tree-shakes imports (no runtime effect)
void lerp;
