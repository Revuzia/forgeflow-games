// WOBBLEHOARD soft body: a volume-preserving jelly on ~600 particles, XPBD + shape matching, pure TypeScript.
//
// No three.js, no DOM, no Math.random, no Date.now, nothing allocated per step (typed-array scratch only; an event
// allocates one small object, and only when one is emitted). Same genome + seed + input script => identical stateHash().
//
// TECHNIQUE (as recommended in _spec/CONTRACT.md section 4; tuned constants and the reasons are in params.ts)
//   Particles = vertices of a welded icosphere (detail 3 = 642). Small-step XPBD: a fixed substep H = 1/360 s, ONE
//   solver pass per substep, six substeps per 60 Hz frame; a time accumulator makes the result independent of the
//   frame dt jitter beyond the clamp. Inside a substep, in this order:
//     fingers/grabs advance -> predict (gravity, or the float-mode hover spring) -> global shape matching ->
//     local Laplacian shape memory -> enclosed-volume constraint -> edge distance constraints -> grab attachments ->
//     collisions (fingertip spheres, then the table) -> v = dx/H -> internal-velocity damping, drag, self-righting.
//   * edge distance (compliance from genome.stretch, hardening past a strain limit): the skin.
//   * ONE global enclosed-volume constraint V = 1/6 sum p_a.(p_b x p_c) = V0 with an XPBD multiplier. Blocked particles
//     (inside a fingertip's reach, touching the table) get zero inverse mass in it, so the pressure is absorbed by the
//     free particles around the contact: a dent pushes up a bulge ring beside it, a table squash bulges at the flanks,
//     a pulled lobe thins its neck. No scale hacks anywhere.
//   * global shape matching (Mueller 2016 rotation extraction, warm started, 2 iterations): every particle is pulled
//     toward g_i = c + R q_i. Firmness sets the stiffness; the swirl-peak is softer so it lags and flops.
//   * Laplacian shape memory (a local, bending-like term, applied every other substep at twice the gain): each particle
//     is pulled toward the mean of its neighbours plus its rotated rest offset. Dents become smooth bowls instead of
//     pits with creased rims, and the surface recovers locally.
//   * damping acts on the INTERNAL velocity only (velocity minus the best-fit rigid motion v_cm + w x r): the global
//     affine part (squash / stretch / shear) and the local part (peak flop, ripples) have separate rates, plus a
//     speed-proportional term that kills fast spikes (a lobe snapping back) but leaves small jiggle alone, plus a global
//     drag that damps the body bobbing on its foot. All rates come from genome.bounce (and firmness).
//   * table y = 0: position projection + Coulomb friction (a tangential displacement bounded by mu x normal load, where
//     the load is the weight, the penetration and the downward push of a fingertip).
//   * fingers: kinematic spheres with Coulomb contact friction (the skin follows the tip, so a sloped press does not
//     squirt the body out sideways). Penetrating particles are projected out and the correction becomes velocity (a
//     poke shoves a floating body). Pull: a Gaussian patch soft-attached to a moving world target; the feet stay glued
//     to the table while the lobe is pulled (and for a moment after, so it springs back in place).
//   * DEVIATIONS from the recommended recipe, and why (both are what makes the body REST exactly and not hop):
//     (1) SUPPORTED-BODY GRAVITY. With one solver pass a soft network cannot carry the weight of 640 particles down to a
//         small foot (the load path is longer than the solver reaches in a frame), so a resting body sagged and crept.
//         While the foot is on the table gravity is faded out by `supp`; every deformation, finger load and impact is
//         still solved by the constraints, and friction still sees the true normal load.
//     (2) TACK. Squishies are sticky: a foot particle that lifts off its REST height by less than a thin layer in one
//         substep is mostly pulled back, so the springing-back body wobbles on its foot instead of hopping like a ball.
// Units: metres-ish; mass per particle ~1 (tributary area, mean 1).
import type { Genome } from '../core/genome.ts';
import { clamp, mulberry32 } from '../core/rng.ts';
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
  share = 1;           // eased fraction of the depth range this tip uses (1 alone, FINGER.pinchShare as one jaw of a pinch)
  cx = 0; cy = 0; cz = 0;   // tip centre (world)
  ocx = 0; ocy = 0; ocz = 0; // tip centre at the previous substep (for the contact friction)
}

/** Soft attachment of a Gaussian vertex patch to a world target. */
class Grab {
  active = false;
  count = 0;
  verts: Int32Array;
  weights: Float64Array;
  p0: Float64Array;            // world positions of the patch at grab time (the patch translates with the hand)
  anchor = 0;                  // grabbed vertex
  t0x = 0; t0y = 0; t0z = 0;   // target at grab time (the pull is measured from here)
  rx = 0; ry = 0; rz = 0;      // raw target (grabMove)
  ex = 0; ey = 0; ez = 0;      // eased target
  ramp = 0;
  holdT = 0;
  constructor(n: number) { this.verts = new Int32Array(n); this.weights = new Float64Array(n); this.p0 = new Float64Array(n * 3); }
}

const KIND_INDEX: Record<SoftEventKind, number> = { poke: 0, press: 1, release: 2, land: 3, grab: 4, snap: 5 };

const SM_ITERS = 2;                // rotation extraction iterations per substep (warm started)
const LAND_MIN_SPEED = 0.9;        // m/s of centre-of-mass fall speed for a 'land' event
const LAND_NORM = 4.5;             // m/s that maps to intensity 1
const POKE_NORM = 3.2;             // m/s predicted closing speed that maps to intensity 1
const MAX_SPEED = 14;              // safety clamp on particle speed (m/s)
const HOVER_OMEGA = 4.6, HOVER_ZETA = 0.62, HOVER_ABOVE = 0.35;
const BOB_AMP = 0.03, BOB_HZ = 0.33;
const NEAR = 0.01;                // a particle this close to the table counts as touching it (m)
const BLOCK_MARGIN = 0.03;         // particles this close to a fingertip are 'blocked' for the volume constraint (m)
const LOAD_CONC = 10;              // friction normal load per touching particle is capped at this many particle-weights
const smooth01 = (t: number): number => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };

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
  /** Resolved solver parameters (genome-derived plus any `opts.params` override). */
  readonly params: SoftParams;

  // ---- configuration
  private readonly n: number;
  private readonly ne: number;
  private readonly nt: number;
  private readonly p: SoftParams;
  private readonly restVolume: number;
  private readonly restCenterY: number;
  private readonly invM: Float64Array;      // 1 / mass
  private readonly M: Float64Array;         // mass
  private readonly Mtot: number;
  private readonly Q: Float64Array;         // rest local positions
  private readonly softW: Float64Array;     // per-vertex shape-matching stiffness multiplier
  private readonly tris: Uint32Array;
  private readonly E3: Int32Array;          // edge endpoints, pre-multiplied by 3
  private readonly EWA: Float64Array;       // edge inverse masses (a, b) and their sum
  private readonly EWB: Float64Array;
  private readonly EWS: Float64Array;
  private readonly EL: Float64Array;        // edge rest lengths
  private readonly ESOFT: Float64Array;     // strain limit (in length) beyond which the edge hardens
  private readonly nh: number;            // hinge count (interior edges)
  private readonly hingeLim: number;       // hinge barrier limit and compliance after the resolution scaling
  private readonly hingeAlpha: number;
  private readonly H3: Int32Array;          // hinge opposite-vertex pairs (pre-multiplied by 3)
  private readonly HD: Float64Array;        // rest distance between the two opposite vertices
  private readonly HW: Float64Array;        // their inverse-mass sum
  private readonly valence: Float32Array;
  private readonly nbrStart: Int32Array;    // CSR adjacency (vertex -> neighbours) for the Laplacian term
  private readonly nbrIdx: Int32Array;
  private readonly nbrInv: Float64Array;
  private readonly LQ: Float64Array;        // rest Laplacian offsets q_i - mean(q_nbrs)
  private readonly invH: Float64Array;      // 1 / mean rest edge length around each vertex (crease detection scale)
  private readonly volAlphaT: number;       // volume compliance (alpha tilde)
  private readonly smK: number;             // shape-matching position gain per substep
  private readonly bendK: number;           // Laplacian gain per substep
  private readonly dampInt: number;         // local (non-affine) internal velocity damping fraction per substep
  private readonly dampAff: number;         // global (affine squash / stretch / shear) damping fraction per substep
  private readonly dampQ: number;           // nonlinear internal damping, per unit internal speed per substep
  private readonly dragF: number;
  private readonly seedPhase: number;

  // ---- state
  private readonly X: Float64Array;         // positions
  private readonly XP: Float64Array;        // predicted positions
  private readonly V: Float64Array;         // velocities
  private readonly GOAL: Float64Array;      // shape-matching goal positions of the last substep
  private readonly GRAD: Float64Array;      // volume gradients (scratch)
  private readonly H0: Float64Array;        // rest height of each particle above the table (the tack acts on lift beyond it)
  private readonly foot: Int32Array;        // particles whose rest height is within NEAR of the table (the tack layer acts on these)
  private readonly WV: Float64Array;        // per-substep inverse masses of the volume constraint (blocked particles = 0)
  private readonly pinned: Uint8Array;      // foot particles glued to the table while a lobe is pulled
  private pinCount = 0;
  private pinHold = 0;
  private readonly sums = new Float64Array(25);
  private readonly A9 = new Float64Array(9);
  private readonly qr = new Float64Array([0, 0, 0, 1]);
  private cx = 0; private cy = 0; private cz = 0;       // centre of mass (shape matching, predicted)
  private vcx = 0; private vcy = 0; private vcz = 0;    // rigid centre-of-mass velocity of the last substep
  private gravityOn = true;
  private simTime = 0;
  private acc = 0;
  private airSub = 0;                       // substeps since the last table contact
  private contactCount = 0;                 // particles that touched (y < 0) the table in the last substep
  private nearCount = 0;                    // particles within NEAR of the table at the end of the last substep
  private nearMass = 1;                     // their mass (friction normal-load proxy)
  private supp = 0;                         // 0..1 how much of its weight the table carries (see substep)
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

  constructor(genome: Genome, opts: { detail?: number; seed?: number; params?: Partial<SoftParams> } = {}) {
    const mesh = buildIcosphere(opts.detail ?? 3);
    const rest = buildRest(genome, mesh);
    const n = mesh.vertexCount;
    this.n = n;
    this.nt = mesh.tris.length / 3;
    this.ne = mesh.edges.length / 2;
    this.p = { ...deriveParams(genome), ...(opts.params ?? {}) };
    this.params = this.p;
    this.vertexCount = n;
    this.tris = mesh.tris;
    this.indices = mesh.tris;
    this.restRadius = rest.restRadius;
    this.restVolume = rest.restVolume;
    this.restCenterY = rest.restCenterY;
    this.Q = rest.restLocal;
    this.softW = new Float64Array(n);
    for (let i = 0; i < n; i++) this.softW[i] = 1 - (1 - this.p.peakSoft) * rest.floppy[i];
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
    this.pinned = new Uint8Array(n);
    this.WV = new Float64Array(n);
    this.H0 = new Float64Array(n);
    for (let i = 0; i < n; i++) this.H0[i] = rest.restLocal[i * 3 + 1] + rest.restCenterY;
    {
      let fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) fc++;
      this.foot = new Int32Array(fc);
      fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) this.foot[fc++] = i;
    }
    this.grabs = [new Grab(n), new Grab(n)];

    // edges, adjacency, rest Laplacian offsets
    const ne = this.ne, Q = rest.restLocal;
    this.E3 = new Int32Array(ne * 2);
    this.EWA = new Float64Array(ne); this.EWB = new Float64Array(ne); this.EWS = new Float64Array(ne);
    this.EL = new Float64Array(ne); this.ESOFT = new Float64Array(ne);
    {
      const nh = mesh.hinges.length / 4;
      this.nh = nh;
      this.H3 = new Int32Array(nh * 2); this.HD = new Float64Array(nh); this.HW = new Float64Array(nh);
      for (let h = 0; h < nh; h++) {
        const c = mesh.hinges[h * 4 + 2], d = mesh.hinges[h * 4 + 3];
        this.H3[h * 2] = c * 3; this.H3[h * 2 + 1] = d * 3;
        this.HD[h] = Math.sqrt((Q[c * 3] - Q[d * 3]) ** 2 + (Q[c * 3 + 1] - Q[d * 3 + 1]) ** 2 + (Q[c * 3 + 2] - Q[d * 3 + 2]) ** 2);
        this.HW[h] = this.invM[c] + this.invM[d];
      }
    }
    this.valence = new Float32Array(n);
    for (let e = 0; e < ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.E3[e * 2] = a * 3; this.E3[e * 2 + 1] = b * 3;
      this.EWA[e] = this.invM[a]; this.EWB[e] = this.invM[b]; this.EWS[e] = this.invM[a] + this.invM[b];
      const l = Math.sqrt((Q[a * 3] - Q[b * 3]) ** 2 + (Q[a * 3 + 1] - Q[b * 3 + 1]) ** 2 + (Q[a * 3 + 2] - Q[b * 3 + 2]) ** 2);
      this.EL[e] = l; this.ESOFT[e] = l * this.p.edgeSoftStrain;
      this.valence[a] += 1; this.valence[b] += 1;
    }
    this.nbrStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.nbrStart[i + 1] = this.nbrStart[i] + this.valence[i];
    this.nbrIdx = new Int32Array(this.nbrStart[n]);
    const fill = new Int32Array(n);
    for (let e = 0; e < ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.nbrIdx[this.nbrStart[a] + fill[a]++] = b;
      this.nbrIdx[this.nbrStart[b] + fill[b]++] = a;
    }
    this.nbrInv = new Float64Array(n);
    this.LQ = new Float64Array(n * 3);
    this.invH = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.nbrStart[i], e = this.nbrStart[i + 1];
      let mx = 0, my = 0, mz = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; mx += Q[k]; my += Q[k + 1]; mz += Q[k + 2]; }
      const inv = 1 / (e - s);
      this.nbrInv[i] = inv;
      let sl = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; sl += Math.sqrt((Q[k] - Q[i * 3]) ** 2 + (Q[k + 1] - Q[i * 3 + 1]) ** 2 + (Q[k + 2] - Q[i * 3 + 2]) ** 2); }
      this.invH[i] = 1 / (sl * inv);
      this.LQ[i * 3] = Q[i * 3] - mx * inv; this.LQ[i * 3 + 1] = Q[i * 3 + 1] - my * inv; this.LQ[i * 3 + 2] = Q[i * 3 + 2] - mz * inv;
    }

    // constants derived from params at the fixed substep
    const wh = this.p.smOmega * H;
    this.smK = (wh * wh) / (1 + wh * wh);
    // The Laplacian is a 1-ring smoother: per application it spreads a disturbance one edge, so on a mesh with 4x the vertices
    // (detail 4) the same gain smooths a quarter of the physical distance and a press folded the skin it covered. Scale the gain with
    // the vertex count (the diffusion argument: gain x edge^2 stays constant); detail 3 (642 vertices) is the reference.
    this.bendK = Math.min(0.45, this.p.bendK * (n / 642));
    // The hinge barrier likewise wants to be tighter on a finer mesh (more skin under the same fingertip piles up before it can slide
    // out): 0.9 / 0.1 at detail 3 -> 0.8 / 0.05 at detail 4 (log2 of the vertex ratio: +2 at detail 4).
    const lg = Math.log2(n / 642);
    this.hingeLim = clamp(this.p.hingeLimit - 0.05 * lg, 0.6, 0.97);
    this.hingeAlpha = this.p.hingeAlphaT * Math.pow(2, -lg / 2);
    this.dampInt = 1 - Math.exp(-this.p.intDamp * H);
    this.dampAff = 1 - Math.exp(-this.p.affDamp * H);
    this.dampQ = this.p.intDamp2 * H;
    this.dragF = 1 - Math.exp(-this.p.drag * H);
    this.volAlphaT = this.p.volKappa * this.volumeScale(rest.restLocal);
    this.seedPhase = mulberry32((opts.seed ?? genome.seed) >>> 0)() * Math.PI * 2;

    this.reset();
  }

  get gravity(): boolean { return this.gravityOn; }
  set gravity(v: boolean) {
    const on = !!v;
    if (on === this.gravityOn) return;
    this.gravityOn = on;
    this.airSub = 0;
    if (!on) { this.pinned.fill(0); this.pinCount = 0; }   // a floating body has no table to be glued to
  }

  // ------------------------------------------------------------------------------------------------ public API

  reset(): void {
    const n = this.n, X = this.X, Q = this.Q;
    const oy = this.gravityOn ? this.restCenterY : this.hoverY(0);
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
    {
      let near = 0, nearM = 0;
      for (let i = 0; i < n; i++) if (X[i * 3 + 1] < NEAR) { near++; nearM += this.M[i]; }
      this.nearCount = near; this.nearMass = Math.max(1, nearM);
      this.supp = this.gravityOn ? smooth01((near - 1) / 4) : 0;
    }
    this.keAcc = 0; this.keSubs = 0; this.prevCompression = 0;
    this.lastAxisX = 0; this.lastAxisY = 1; this.lastAxisZ = 0; this.lastAxisT = -10;
    for (const f of this.fingers) { f.down = false; f.retracting = false; f.contacted = false; f.pressed = false; f.depth = 0; f.depthV = 0; f.target = 0; f.holdT = 0; f.share = 1; }
    for (const g of this.grabs) { g.active = false; g.count = 0; }
    this.pinned.fill(0); this.pinCount = 0; this.pinHold = 0;
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

  /** Ray vs the current surface, front faces only. `t` is in units of `dir` (point = origin + dir * t). */
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
    let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (dl < 1e-6) {
      if (nl < 1e-6) { dx = 0; dy = -1; dz = 0; } else { dx = -nx / nl; dy = -ny / nl; dz = -nz / nl; }
      dl = 1;
    }
    dx /= dl; dy /= dl; dz /= dl;
    // a grab on this id is cancelled by a new touch
    if (this.grabs[id].active) this.grabRelease(id);

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
    // pressing toward the table can flatten the body to 25% (the table is the other jaw); pressing a free flank goes
    // less deep so the body is squeezed, not pierced
    const supported = hitTri >= 0 && hy + dy * T < 0.03 * R && dy < -0.5;
    // START TANGENT: the sphere is seated on the whole local surface, not just on the hit point. A tip wider than a thin feature (the
    // swirl-peak) would otherwise start with the apex already inside it, and the radial push-out of a vertex that deep ejects it
    // sideways past its own neighbours (a flipped triangle that never comes back). Lift the anchor back along -dir until no
    // vertex under the footprint is inside the tip.
    let lift = 0;
    if (hitTri >= 0) {
      const r0 = R * FINGER.rMin;
      let sc = -r0;                        // centre position along dir relative to the hit (default: sphere bottom on the hit)
      for (let i = 0; i < this.n; i++) {
        const rx = this.X[i * 3] - hx, ry = this.X[i * 3 + 1] - hy, rz = this.X[i * 3 + 2] - hz;
        const sv = rx * dx + ry * dy + rz * dz;
        const l2 = rx * rx + ry * ry + rz * rz - sv * sv;
        if (l2 >= r0 * r0 || sv < -2 * r0) continue;
        const need = sv - Math.sqrt(r0 * r0 - l2);     // centre must stay at or behind this
        if (need < sc) sc = need;
      }
      lift = Math.min(FINGER.maxLift * R, -r0 - sc);
    }
    hx -= dx * lift; hy -= dy * lift; hz -= dz * lift;
    f.down = true; f.retracting = false; f.contacted = false; f.pressed = false;
    f.px = hx; f.py = hy; f.pz = hz; f.tx = hx; f.ty = hy; f.tz = hz;
    f.dx = dx; f.dy = dy; f.dz = dz; f.nx = nx; f.ny = ny; f.nz = nz;
    f.depth = 0; f.depthV = 0; f.target = 0; f.holdT = 0;
    f.share = this.fingers[id ^ 1].down ? FINGER.pinchShare : 1;
    f.tipR = R * FINGER.rMin;
    // a thin free part (the swirl-peak) can be shoved aside by far more than its own thickness, so a flank press may
    // always go FINGER.minFlankDepth rest radii deep
    f.depthMax = lift + Math.max(supported ? 0.2 * R : FINGER.minFlankDepth * R, this.p.squashDepth * (supported ? 1 : FINGER.flankShare) * T);
    this.placeTip(f, 1);
    f.ocx = f.cx; f.ocy = f.cy; f.ocz = f.cz;
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
    const dc = Math.sqrt((ox - this.cx) ** 2 + (oy - this.cy) ** 2 + (oz - this.cz) ** 2);
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
    const Q = this.Q, X = this.X;
    const sigma = 0.3 * this.restRadius / 2.2;       // patch radius 0.3 R = where the Gaussian weight has fallen to ~2%
    const inv2s2 = 1 / (2 * sigma * sigma);
    const qx = Q[v * 3], qy = Q[v * 3 + 1], qz = Q[v * 3 + 2];
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = Q[i * 3] - qx, dy = Q[i * 3 + 1] - qy, dz = Q[i * 3 + 2] - qz;
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2s2);
      if (w < 0.03) continue;
      g.verts[c] = i; g.weights[c] = w;
      g.p0[c * 3] = X[i * 3]; g.p0[c * 3 + 1] = X[i * 3 + 1]; g.p0[c * 3 + 2] = X[i * 3 + 2];
      c++;
    }
    g.count = c; g.anchor = v; g.active = true; g.ramp = 0; g.holdT = 0;
    // squishies are tacky: the particles touching the table now stay glued to it until the lobe is let go
    if (this.gravityOn && this.pinCount === 0) {
      for (let i = 0; i < this.n; i++) if (X[i * 3 + 1] < NEAR) { this.pinned[i] = 1; this.pinCount++; }
    }
    this.pinHold = this.p.pinHold;
    g.t0x = tx; g.t0y = ty; g.t0z = tz; g.rx = tx; g.ry = ty; g.rz = tz; g.ex = tx; g.ey = ty; g.ez = tz;
    const nrm = this.vertexNormal(v);
    this.emit('grab', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], 0.5, 0, id);
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
    if (!this.grabs[0].active && !this.grabs[1].active) this.pinHold = this.p.pinHold;
    if (s > 0.05) {
      const v = g.anchor, X = this.X;
      const nrm = this.vertexNormal(v);
      this.emit('snap', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], clamp(s, 0, 1), g.holdT, id);
    }
  }

  /** Visual aid (finger ghost, debug viewer): the current fingertip sphere of finger `id`, or null when it has no tip. Allocates; not for the hot path. */
  tip(id: 0 | 1): { x: number; y: number; z: number; r: number; depth: number } | null {
    const f = this.fingers[id];
    if (!f || (!f.down && !f.retracting)) return null;
    return { x: f.cx, y: f.cy, z: f.cz, r: f.tipR, depth: f.depth };
  }

  nudge(impulse: V3): void {
    if (!impulse) return;
    let ix = impulse.x, iy = impulse.y, iz = impulse.z;
    if (!Number.isFinite(ix + iy + iz)) return;
    const l = Math.sqrt(ix * ix + iy * iy + iz * iz);
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
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  }

  private vertexNormal(v: number): [number, number, number] {
    // outward direction of the rest shape rotated by the frame (cheap, always finite)
    const Q = this.Q;
    let x = Q[v * 3], y = Q[v * 3 + 1], z = Q[v * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  }

  private volumeScale(q: Float64Array): number {
    // S0 = sum_i w_i |grad_i V|^2 / (6 V0)^2 at the rest shape (translation-invariant, so rest-local coordinates are fine)
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

  /** Tip radius and centre from the eased depth. `share` < 1 limits a pinch jaw to part of its depth range. */
  private placeTip(f: Finger, share: number): void {
    const R = this.restRadius;
    const dv = clamp(f.depth, 0, 1);
    // the tip grows toward its pressure radius at a limited speed: a sphere that swells by 0.1 m in 50 ms shoves the skin around it
    // sideways faster than the mesh can follow (a thin peak is split open and folds); it can shrink at once
    const rT = R * (FINGER.rMin + (FINGER.rMax - FINGER.rMin) * dv);
    f.tipR = rT <= f.tipR ? rT : Math.min(rT, f.tipR + FINGER.growRate * R * H);
    const s = dv * f.depthMax * share - f.tipR;
    f.cx = f.px + f.dx * s; f.cy = f.py + f.dy * s; f.cz = f.pz + f.dz * s;
    // A fingertip cannot go through the table: a low side press would otherwise push its sphere below y = 0, squeezing the foot rim
    // between the sphere and the table (the table always wins, so the rim buckled into a fold).
    if (f.cy < f.tipR) f.cy = f.tipR;
  }

  /**
   * Advance finger depth (critically damped), slide and retract by one substep, then place the tips (pinch-safe).
   * The depth share of a tip (1 alone, FINGER.pinchShare as one jaw of a pinch) is EASED, never switched: a kinematic tip
   * must move continuously, or a finger landing / lifting would teleport the other tip by ~0.3 R in one substep and shove
   * the body (a normal two-finger release used to squeeze MORE for ~30 ms instead of springing back). A retracting tip
   * keeps the share it had, so lifting a finger is a pure depth retraction.
   */
  private updateFingers(): void {
    const w = FINGER.omega;
    const slide = 1 - Math.exp(-FINGER.slideRate * H);
    const a = this.fingers[0], b = this.fingers[1];
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      f.ocx = f.cx; f.ocy = f.cy; f.ocz = f.cz;
      if (f.down) {
        const want = this.fingers[k ^ 1].down ? FINGER.pinchShare : 1;
        f.share += (want - f.share) * (1 - Math.exp(-(want < f.share ? FINGER.shareIn : FINGER.shareOut) * H));
        const acc = w * w * (f.target - f.depth) - 2 * w * f.depthV;
        f.depthV += acc * H;
        f.depth += f.depthV * H;
        if (f.depth < 0) { f.depth = 0; f.depthV = 0; } else if (f.depth > 1) { f.depth = 1; f.depthV = 0; }
        f.holdT += H;
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f, f.share);
      } else if (f.retracting) {
        f.depth -= f.retractRate * H;
        if (f.depth <= 0) { f.depth = 0; f.retracting = false; }
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f, f.share);
      }
    }
    // pinch: the two tips never overlap or pass through each other
    if ((a.down || a.retracting) && (b.down || b.retracting)) {
      let dx = b.cx - a.cx, dy = b.cy - a.cy, dz = b.cz - a.cz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
      const dx = g.ex - g.t0x, dy = g.ey - g.t0y, dz = g.ez - g.t0z;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl > maxD) { const s = maxD / dl; g.ex = g.t0x + dx * s; g.ey = g.t0y + dy * s; g.ez = g.t0z + dz * s; }
    }
  }

  private substep(): void {
    const n = this.n, X = this.X, XP = this.XP, V = this.V, M = this.M, invM = this.invM, Q = this.Q;
    const GOAL = this.GOAL, GRAD = this.GRAD;
    this.debug.substeps++;

    this.updateFingers();
    this.updateGrabs();
    const f0 = this.fingers[0], f1 = this.fingers[1];
    const nFingers = (f0.down ? 1 : 0) + (f1.down ? 1 : 0);
    const grabbing = this.grabs[0].active || this.grabs[1].active;

    // ---- external acceleration + predict
    // SUPPORTED-BODY GRAVITY. With one XPBD pass per substep a soft network cannot carry the weight of 640 particles
    // down to a small contact patch (the load path is longer than the solver reaches in a frame), so a body at rest
    // would sag and creep. Real squishies barely sag under their own weight, so while the foot is on the table the
    // table is treated as carrying the weight of the body as a whole: gravity is faded out by `supp` (0 airborne,
    // 1 resting). That leaves every deformation, finger load and impact to the constraints but makes rest exact.
    // Friction still sees the true normal load (see the table pass).
    let ax = 0, ay = 0, az = 0;
    if (this.gravityOn) {
      ay = -GRAVITY * (1 - this.supp);
    } else {
      // float mode: weak hover spring on the centre of mass (stiffer while a finger or a lobe holds it) + slow bob
      const boost = 1 + 2.5 * nFingers + (grabbing ? 3 : 0);
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
    let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
    {
      let sx = 0, sy = 0, sz = 0;
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const mx = m * XP[i3], my = m * XP[i3 + 1], mz = m * XP[i3 + 2];
        const qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2];
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
      r00 = 1 - 2 * (yy + zz); r01 = 2 * (xy - wz); r02 = 2 * (xz + wy);
      r10 = 2 * (xy + wz); r11 = 1 - 2 * (xx + zz); r12 = 2 * (yz - wx);
      r20 = 2 * (xz - wy); r21 = 2 * (yz + wx); r22 = 1 - 2 * (xx + yy);
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

    // ---- Laplacian shape memory (local): pull each particle toward mean(neighbours) + R (q_i - mean(q_neighbours))
    // (every other substep with twice the gain: it is a soft smoothing term and this saves ~8% of the step)
    if ((this.debug.substeps & 1) === 0) {
      const bk = this.bendK * 2, soft = this.softW, st = this.nbrStart, nb = this.nbrIdx, ni = this.nbrInv, LQ = this.LQ, ih = this.invH;
      const lo = this.p.creaseLo, hi = this.p.creaseHi, boost = this.p.creaseGain, bf = this.p.bendFloor, span = 1 / Math.max(1e-6, hi - lo);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let mx = 0, my = 0, mz = 0;
        for (let j = st[i], e = st[i + 1]; j < e; j++) { const k = nb[j] * 3; mx += XP[k]; my += XP[k + 1]; mz += XP[k + 2]; }
        const inv = ni[i];
        const lx = LQ[i3], ly = LQ[i3 + 1], lz = LQ[i3 + 2];
        const rx = mx * inv + r00 * lx + r01 * ly + r02 * lz - XP[i3];
        const ry = my * inv + r10 * lx + r11 * ly + r12 * lz - XP[i3 + 1];
        const rz = mz * inv + r20 * lx + r21 * ly + r22 * lz - XP[i3 + 2];
        // crease / fold detector: a residual of a good fraction of an edge length is not a smooth bend. There the gain ramps up
        // to the unsoftened body gain (x boost), so a flap is pulled back out even in the floppy peak.
        const res = Math.sqrt(rx * rx + ry * ry + rz * rz) * ih[i];
        let a = (res - lo) * span;
        a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        const sb = soft[i] > bf ? soft[i] : bf;
        const k = Math.min(0.9, bk * (sb + (boost - sb) * a));
        XP[i3] += rx * k; XP[i3 + 1] += ry * k; XP[i3 + 2] += rz * k;
      }
    }

    // ---- enclosed-volume constraint (one global XPBD multiplier)
    {
      const tris = this.tris, nt = this.nt;
      const ox = this.cx, oy = this.cy, oz = this.cz;
      GRAD.fill(0);
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
      // Blocked particles (inside a fingertip's reach or touching the table) cannot absorb pressure: zero inverse mass.
      const WV = this.WV;
      const a0 = f0.down || f0.retracting, a1 = f1.down || f1.retracting;
      const r0 = f0.tipR + BLOCK_MARGIN, r1 = f1.tipR + BLOCK_MARGIN;
      let S = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let w = invM[i];
        if (XP[i3 + 1] < NEAR) w = 0;
        else {
          if (a0) { const dx = XP[i3] - f0.cx, dy = XP[i3 + 1] - f0.cy, dz = XP[i3 + 2] - f0.cz; if (dx * dx + dy * dy + dz * dz < r0 * r0) w = 0; }
          if (a1) { const dx = XP[i3] - f1.cx, dy = XP[i3 + 1] - f1.cy, dz = XP[i3 + 2] - f1.cz; if (dx * dx + dy * dy + dz * dz < r1 * r1) w = 0; }
        }
        WV[i] = w;
        S += w * (GRAD[i3] * GRAD[i3] + GRAD[i3 + 1] * GRAD[i3 + 1] + GRAD[i3 + 2] * GRAD[i3 + 2]);
      }
      S /= v6 * v6;
      const sc = (-C / (S + this.volAlphaT)) / v6;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, s = sc * WV[i];
        XP[i3] += GRAD[i3] * s; XP[i3 + 1] += GRAD[i3 + 1] * s; XP[i3 + 2] += GRAD[i3 + 2] * s;
      }
    }

    // ---- edge distance constraints (Gauss-Seidel, 1 pass)
    {
      const E3 = this.E3, EL = this.EL, ES = this.ESOFT, EWA = this.EWA, EWB = this.EWB, EWS = this.EWS, ne = this.ne;
      const aT = this.p.edgeAlphaT, aH = aT * this.p.edgeHarden;
      for (let e = 0; e < ne; e++) {
        const a = E3[e * 2], b = E3[e * 2 + 1];
        const dx = XP[a] - XP[b], dy = XP[a + 1] - XP[b + 1], dz = XP[a + 2] - XP[b + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-12) continue;
        const C = len - EL[e];
        const s = -C / ((EWS[e] + (C > ES[e] ? aH : aT)) * len);
        const sa = s * EWA[e], sb = s * EWB[e];
        XP[a] += dx * sa; XP[a + 1] += dy * sa; XP[a + 2] += dz * sa;
        XP[b] -= dx * sb; XP[b + 1] -= dy * sb; XP[b + 2] -= dz * sb;
      }
    }

    // ---- hinge barrier: the two vertices opposite an interior edge must not be pressed together (that is a flap folded onto itself)
    if (this.p.hingeLimit > 0) {
      const H3 = this.H3, HD = this.HD, HW = this.HW, nh = this.nh, lim = this.hingeLim, aHg = this.hingeAlpha;
      for (let h = 0; h < nh; h++) {
        const c = H3[h * 2], d = H3[h * 2 + 1];
        const dx = XP[c] - XP[d], dy = XP[c + 1] - XP[d + 1], dz = XP[c + 2] - XP[d + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const lo = lim * HD[h];
        if (len >= lo) continue;
        if (len < 1e-9) continue;
        const sc = (lo - len) / ((HW[h] + aHg) * len);
        const wc = invM[c / 3] * sc, wd = invM[d / 3] * sc;
        XP[c] += dx * wc; XP[c + 1] += dy * wc; XP[c + 2] += dz * wc;
        XP[d] -= dx * wd; XP[d + 1] -= dy * wd; XP[d + 2] -= dz * wd;
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
        XP[i3] += (g.p0[j * 3] + px - XP[i3]) * w;
        XP[i3 + 1] += (g.p0[j * 3 + 1] + py - XP[i3 + 1]) * w;
        XP[i3 + 2] += (g.p0[j * 3 + 2] + pz - XP[i3 + 2]) * w;
      }
    }

    // ---- collisions: finger spheres, then the table (the table always wins)
    let fingerDown = 0;   // mass-weighted downward push of the fingertips this substep: extra normal load on the table
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      if (!f.down && !f.retracting) continue;
      const r = f.tipR, r2 = r * r, cx = f.cx, cy = f.cy, cz = f.cz;
      const fdx = cx - f.ocx, fdy = cy - f.ocy, fdz = cz - f.ocz;   // how far the tip itself moved this substep
      const muF = FINGER.friction;
      let hit = false;
      for (let i = 0; i < n * 3; i += 3) {
        const dx = XP[i] - cx, dy = XP[i + 1] - cy, dz = XP[i + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        hit = true;
        const y0 = XP[i + 1];
        let nx: number, ny: number, nz: number, pen: number;
        if (d2 > 1e-14) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d;
        } else { nx = f.dx; ny = f.dy; nz = f.dz; pen = r; }
        const px0 = XP[i], pz0 = XP[i + 2];
        XP[i] = cx + nx * r; XP[i + 1] = cy + ny * r; XP[i + 2] = cz + nz * r;
        // contact friction: the skin sticks to the fingertip. Undo (up to mu x penetration) the tangential slide of the
        // particle relative to the tip during this substep, so a finger drags the surface with it instead of letting a
        // sloped press squirt the body out sideways.
        const ux = (px0 - X[i]) - fdx, uy = (y0 - X[i + 1]) - fdy, uz = (pz0 - X[i + 2]) - fdz;
        const un = ux * nx + uy * ny + uz * nz;
        const tx = ux - un * nx, ty = uy - un * ny, tz = uz - un * nz;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-12) {
          const k2 = Math.min(1, muF * pen / tl);
          XP[i] -= tx * k2; XP[i + 1] -= ty * k2; XP[i + 2] -= tz * k2;
        }
        if (XP[i + 1] < y0) fingerDown += M[i / 3] * (y0 - XP[i + 1]);
      }
      if (hit && !f.contacted && f.down) {
        f.contacted = true;
        // predicted peak closing speed of the critically damped approach, plus what it already has
        const closing = Math.max(0, f.target - f.depth) * f.depthMax * FINGER.omega / Math.E + Math.max(0, f.depthV) * f.depthMax;
        const front = f.depth * f.depthMax;
        this.emit('poke', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz,
          clamp(closing / POKE_NORM, 0.05, 1), 0, k);
      }
    }
    {
      const mu = this.p.tableMu, glue = this.p.glue * (this.restRadius / 0.5), H0 = this.H0;   // the tack layer scales with the body
      // normal-load proxy for Coulomb friction: this substep's penetration plus the supported weight (g h^2 per
      // particle, concentrated on the particles that are actually touching)
      const load = this.supp * GRAVITY * H * H * Math.min(LOAD_CONC, this.Mtot / Math.max(1, this.nearMass));
      const fload = fingerDown / Math.max(1, this.nearMass);   // a finger pressing down adds its force to the normal load
      let contacts = 0, near = 0, nearM = 0;
      for (let i = 0; i < n * 3; i += 3) {
        const y = XP[i + 1];
        if (y >= NEAR) continue;
        near++; nearM += M[i / 3];
        let pen = load + fload;
        if (y < 0) { contacts++; pen -= y; XP[i + 1] = 0; } else {
          // tack: lifting off its REST height by less than `glue` is mostly undone (the rest pose is the equilibrium)
          const lift = y - H0[i / 3];
          if (lift > 0 && lift < glue) { const k = lift / glue; XP[i + 1] = H0[i / 3] + lift * k * k; }
        }
        const tx = XP[i] - X[i], tz = XP[i + 2] - X[i + 2];
        const tl = Math.sqrt(tx * tx + tz * tz);
        if (tl > 1e-12) {
          const cap = mu * pen;
          if (tl <= cap) { XP[i] = X[i]; XP[i + 2] = X[i + 2]; } else { const s = cap / tl; XP[i] -= tx * s; XP[i + 2] -= tz * s; }
        }
      }
      // The tack layer must be as thick as `glue`, not only as thick as the NEAR band the loop above looks at: a foot particle kicked up
      // by 7 mm in one substep (the shape memory pulls the rim up when the body is stretched tall) starts at y < NEAR, lands above NEAR,
      // is never seen again and the whole foot peels off the table (a hop of 10 cm after a hard release of a large or firm body).
      {
        const foot = this.foot;
        for (let j = 0; j < foot.length; j++) {
          const i = foot[j], y = XP[i * 3 + 1];
          if (y < NEAR) continue;
          const lift = y - H0[i];
          if (lift < glue) { const k = lift / glue; XP[i * 3 + 1] = H0[i] + lift * k * k; }
        }
      }
      // glued feet (a lobe is being pulled, or was just let go): hold them exactly where they were
      if (this.pinCount > 0) {
        if (!grabbing) { this.pinHold -= H; if (this.pinHold <= 0) { this.pinned.fill(0); this.pinCount = 0; } }
        const pn = this.pinned;
        if (this.pinCount > 0) for (let i = 0; i < n; i++) if (pn[i]) { XP[i * 3] = X[i * 3]; XP[i * 3 + 1] = 0; XP[i * 3 + 2] = X[i * 3 + 2]; }
      }
      // land detection: first contact after being airborne, speed = centre-of-mass fall speed
      if (near > 0) {
        if (this.airSub >= 8 && -this.vcy > LAND_MIN_SPEED) this.pendingLand = Math.max(this.pendingLand, -this.vcy);
        this.airSub = 0;
      } else if (this.airSub < 100000) this.airSub++;
      this.contactCount = contacts;
      this.nearCount = near; this.nearMass = nearM;
      this.supp = smooth01((near - 1) / 4);
    }

    // ---- velocity from positions, with the sums the damping pass needs
    {
      const invH = 1 / H, S = this.sums;
      let sm = 0, sx = 0, sy = 0, sz = 0, svx = 0, svy = 0, svz = 0, lx = 0, ly = 0, lz = 0;
      let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
      let b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0, b20 = 0, b21 = 0, b22 = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const x = XP[i3], y = XP[i3 + 1], z = XP[i3 + 2];
        const vx = (x - X[i3]) * invH, vy = (y - X[i3 + 1]) * invH, vz = (z - X[i3 + 2]) * invH;
        X[i3] = x; X[i3 + 1] = y; X[i3 + 2] = z;
        V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
        const mvx = m * vx, mvy = m * vy, mvz = m * vz;
        sm += m; sx += m * x; sy += m * y; sz += m * z;
        svx += mvx; svy += mvy; svz += mvz;
        lx += y * mvz - z * mvy; ly += z * mvx - x * mvz; lz += x * mvy - y * mvx;
        ixx += m * (y * y + z * z); iyy += m * (x * x + z * z); izz += m * (x * x + y * y);
        ixy -= m * x * y; ixz -= m * x * z; iyz -= m * y * z;
        b00 += mvx * x; b01 += mvx * y; b02 += mvx * z;
        b10 += mvy * x; b11 += mvy * y; b12 += mvy * z;
        b20 += mvz * x; b21 += mvz * y; b22 += mvz * z;
      }
      S[0] = sm; S[1] = sx; S[2] = sy; S[3] = sz; S[4] = svx; S[5] = svy; S[6] = svz; S[7] = lx; S[8] = ly; S[9] = lz;
      S[10] = ixx; S[11] = iyy; S[12] = izz; S[13] = ixy; S[14] = ixz; S[15] = iyz;
      S[16] = b00; S[17] = b01; S[18] = b02; S[19] = b10; S[20] = b11; S[21] = b12; S[22] = b20; S[23] = b21; S[24] = b22;
    }
    this.dampPass();
  }

  private dampPass(): void {
    const n = this.n, X = this.X, V = this.V, M = this.M, S = this.sums;
    const sm = S[0];
    let lx = S[7], ly = S[8], lz = S[9];
    let ixx = S[10], iyy = S[11], izz = S[12], ixy = S[13], ixz = S[14], iyz = S[15];
    let b00 = S[16], b01 = S[17], b02 = S[18], b10 = S[19], b11 = S[20], b12 = S[21], b20 = S[22], b21 = S[23], b22 = S[24];
    const inv = 1 / sm;
    const cx = S[1] * inv, cy = S[2] * inv, cz = S[3] * inv;
    const svx = S[4], svy = S[5], svz = S[6];
    const vcx = svx * inv, vcy = svy * inv, vcz = svz * inv;
    // about the centre of mass
    lx -= sm * (cy * vcz - cz * vcy); ly -= sm * (cz * vcx - cx * vcz); lz -= sm * (cx * vcy - cy * vcx);
    ixx -= sm * (cy * cy + cz * cz); iyy -= sm * (cx * cx + cz * cz); izz -= sm * (cx * cx + cy * cy);
    ixy += sm * cx * cy; ixz += sm * cx * cz; iyz += sm * cy * cz;
    b00 -= svx * cx; b01 -= svx * cy; b02 -= svx * cz;
    b10 -= svy * cx; b11 -= svy * cy; b12 -= svy * cz;
    b20 -= svz * cx; b21 -= svz * cy; b22 -= svz * cz;
    // omega = I^-1 L (symmetric 3x3 inverse by cofactors)
    const c00 = iyy * izz - iyz * iyz, c01 = ixz * iyz - ixy * izz, c02 = ixy * iyz - ixz * iyy;
    const c11 = ixx * izz - ixz * ixz, c12 = ixy * ixz - ixx * iyz, c22 = ixx * iyy - ixy * ixy;
    const det = ixx * c00 + ixy * c01 + ixz * c02;
    let wx = 0, wy = 0, wz = 0;
    // second-moment matrix S2 = sum m r r^T = (tr(I)/2) Id - I, and the best affine velocity gradient L = B S2^-1;
    // its symmetric part D is the global squash / stretch / shear rate (damped hard), the rest is local wobble
    let d00 = 0, d01 = 0, d02 = 0, d11 = 0, d12 = 0, d22 = 0;
    if (det > 1e-9) {
      const id = 1 / det;
      wx = (c00 * lx + c01 * ly + c02 * lz) * id;
      wy = (c01 * lx + c11 * ly + c12 * lz) * id;
      wz = (c02 * lx + c12 * ly + c22 * lz) * id;
      const sxx = 0.5 * (iyy + izz - ixx), syy = 0.5 * (ixx + izz - iyy), szz = 0.5 * (ixx + iyy - izz);
      const sxy = -ixy, sxz = -ixz, syz = -iyz;
      const k00 = syy * szz - syz * syz, k01 = sxz * syz - sxy * szz, k02 = sxy * syz - sxz * syy;
      const k11 = sxx * szz - sxz * sxz, k12 = sxy * sxz - sxx * syz, k22 = sxx * syy - sxy * sxy;
      const sdet = sxx * k00 + sxy * k01 + sxz * k02;
      if (sdet > 1e-12) {
        const is = 1 / sdet;
        const l00 = (b00 * k00 + b01 * k01 + b02 * k02) * is, l01 = (b00 * k01 + b01 * k11 + b02 * k12) * is, l02 = (b00 * k02 + b01 * k12 + b02 * k22) * is;
        const l10 = (b10 * k00 + b11 * k01 + b12 * k02) * is, l11 = (b10 * k01 + b11 * k11 + b12 * k12) * is, l12 = (b10 * k02 + b11 * k12 + b12 * k22) * is;
        const l20 = (b20 * k00 + b21 * k01 + b22 * k02) * is, l21 = (b20 * k01 + b21 * k11 + b22 * k12) * is, l22 = (b20 * k02 + b21 * k12 + b22 * k22) * is;
        d00 = l00; d11 = l11; d22 = l22;
        d01 = 0.5 * (l01 + l10); d02 = 0.5 * (l02 + l20); d12 = 0.5 * (l12 + l21);
      }
    }
    this.vcx = vcx; this.vcy = vcy; this.vcz = vcz;

    // self-righting torque (a weeble: it flops over but rights itself) + angular damping of the rigid spin
    const q = this.qr;
    const upx = 2 * (q[0] * q[1] - q[3] * q[2]), upy = 1 - 2 * (q[0] * q[0] + q[2] * q[2]), upz = 2 * (q[1] * q[2] + q[3] * q[0]);
    const sinT = Math.sqrt(upx * upx + upz * upz);
    const theta = Math.acos(clamp(upy, -1, 1));
    const scale = sinT > 1e-6 ? theta / sinT : 0;
    const float = !this.gravityOn;
    const kUp = float ? 30 : 40, cAng = float ? 4 : 8;
    const awx = (-upz * scale * kUp - cAng * wx) * H, awy = -cAng * wy * H, awz = (upx * scale * kUp - cAng * wz) * H;

    const dRes = this.dampInt, dAff = this.dampAff, dr = this.dragF, dQ = this.dampQ;
    let ke = 0;
    const vmax2 = MAX_SPEED * MAX_SPEED;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const rx = X[i3] - cx, ry = X[i3 + 1] - cy, rz = X[i3 + 2] - cz;
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      // internal velocity = v - v_cm - w x r
      const ivx = vx - vcx - (wy * rz - wz * ry), ivy = vy - vcy - (wz * rx - wx * rz), ivz = vz - vcz - (wx * ry - wy * rx);
      const sp2 = ivx * ivx + ivy * ivy + ivz * ivz;
      ke += M[i] * sp2;
      // global (affine, symmetric) part and the local remainder
      const avx = d00 * rx + d01 * ry + d02 * rz, avy = d01 * rx + d11 * ry + d12 * rz, avz = d02 * rx + d12 * ry + d22 * rz;
      const nl = dQ * Math.sqrt(sp2);
      const ga = Math.min(0.9, dAff + nl), gr = Math.min(0.9, dRes + nl);
      vx += -ga * avx - gr * (ivx - avx) - dr * vx + (awy * rz - awz * ry);
      vy += -ga * avy - gr * (ivy - avy) - dr * vy + (awz * rx - awx * rz);
      vz += -ga * avz - gr * (ivz - avz) - dr * vz + (awx * ry - awy * rx);
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
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
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
    const st = this.strain, E3 = this.E3, EL = this.EL;
    st.fill(0);
    for (let e = 0; e < this.ne; e++) {
      const a = E3[e * 2], b = E3[e * 2 + 1];
      const dx = X[a] - X[b], dy = X[a + 1] - X[b + 1], dz = X[a + 2] - X[b + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / EL[e];
      st[a / 3] += r; st[b / 3] += r;
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
      const l = Math.sqrt(ax * ax + ay * ay + az * az);
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
      if (d < mn) mn = d;
      if (d > mx) mx = d;
      const r = Q[i3] * lx + Q[i3 + 1] * ly + Q[i3 + 2] * lz;
      if (r < rmn) rmn = r;
      if (r > rmx) rmx = r;
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
    m.grounded = this.nearCount >= 3;
    m.fingers = nf;
    m.grabbed = this.grabs[0].active || this.grabs[1].active;
    const sp = Math.sqrt(this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz);
    if (sp > this.debug.maxSpeed) this.debug.maxSpeed = sp;
    this.debug.contacts = this.contactCount;
  }
}
