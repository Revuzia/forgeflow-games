// DEV-ONLY stand-in for the real soft body (src/physics). It implements SoftBodyLike with FAKE but plausible deformation so
// the render lane can develop and the render harness can run before / without the physics lane:
//   * a spring-driven ellipsoid squash (underdamped, so it overshoots into a stretch on release),
//   * a radial gaussian dent under each finger,
//   * a flopping peak (damped spring shear of the top) and a little frame tilt,
//   * a gaussian pull toward a world target (grab), a table plane, gravity with a bounce, and a float-mode hover.
// strain[] is computed from the real edge lengths, so the pressure blush gets honest numbers. Not shipped: nothing in the
// game imports this file.
import type { CutPlane, FingerDownArgs, PieceOpts, RayHit, SoftBodyLike, SoftEvent, SoftMetrics, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { clamp, lerp } from '../core/rng.ts';
import { buildGeodesic } from './geodesic.ts';

interface StubFinger { down: boolean; px: number; py: number; pz: number; dx: number; dy: number; dz: number; target: number; depth: number; holdT: number; pressed: boolean }

export class StubBody implements SoftBodyLike {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly restLocal: Float32Array;
  readonly indices: Uint32Array;
  readonly strain: Float32Array;
  readonly center: V3 = { x: 0, y: 0, z: 0 };
  readonly frame = { x: 0, y: 0, z: 0, w: 1 };
  readonly metrics: SoftMetrics = { compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false };
  readonly restRadius: number;
  gravity = true;

  private readonly R: number;
  private readonly restFloorY: number;
  private readonly nbStart: Uint32Array;
  private readonly nbList: Uint32Array;
  private readonly nbRest: Float32Array;
  private readonly restDir: Float32Array;
  private readonly restVolume: number;
  private readonly fingers: StubFinger[] = [0, 1].map(() => ({ down: false, px: 0, py: 0, pz: 0, dx: 0, dy: -1, dz: 0, target: 0, depth: 0, holdT: 0, pressed: false }));
  private events: SoftEvent[] = [];
  private cx = 0; private cy = 0; private cz = 0;
  private vx = 0; private vy = 0; private vz = 0;
  private sq = 0; private sqv = 0;
  private ax = 0; private ay = 1; private az = 0;       // squash axis
  private peakX = 0; private peakZ = 0; private peakVX = 0; private peakVZ = 0;
  private tiltX = 0; private tiltZ = 0; private tiltVX = 0; private tiltVZ = 0;
  private grabOn = false; private grabAmt = 0;
  private gx = 0; private gy = 0; private gz = 0;        // grab anchor (rest-world of the grabbed vertex)
  private gtx = 0; private gty = 0; private gtz = 0;     // grab target
  private t = 0;
  private prevComp = 0;
  private acc = 0;
  // ceremony drivers (DESIGN 6.4): fold into a ball, slide to a point, tremble, spring open
  private foldGoal = 0; private foldT = 0;
  private trembleAmp = 0;
  private burstX = 0; private burstV = 0;
  private moveGoal: V3 | null = null; private moveK = 1;
  // CUT (dev stand-in for the physics' cut primitives, so the render harness can drive the cut visuals): a piece's volume fraction,
  // a puppet waist along a plane, a smooth volume change, where it rests on the table
  private fracNow = 1; private fracGoal = 1; private fracRate = 0;
  private neckOn = false; private neckT = 0;
  private readonly neckP = { x: 0, y: 0, z: 0 }; private readonly neckN = { x: 1, y: 0, z: 0 };
  private homeX = 0; private homeZ = 0;

  constructor(genome: Genome, opts?: { detail?: number; seed?: number; piece?: PieceOpts }) {
    const piece = opts?.piece;
    const pf = piece && Number.isFinite(piece.frac) ? clamp(piece.frac, 0.125, 1) : 1;
    const detail = opts?.detail ?? (pf < 0.35 ? 2 : 3);
    const geo = buildGeodesic(Math.pow(2, detail));
    this.vertexCount = geo.vertexCount;
    this.R = 0.5 * lerp(0.8, 1.25, genome.size) * Math.cbrt(pf);
    this.fracNow = this.fracGoal = pf; this.fracBuilt = pf;
    this.restRadius = this.R;
    const n = this.vertexCount, R = this.R;
    this.indices = Uint32Array.from(geo.indices);
    // DOLLOP-ish rest shape: squat dome (0.8 flatten) + narrow raised peak
    const rest = new Float32Array(n * 3);
    this.restDir = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dx = geo.dirs[i * 3], dy = geo.dirs[i * 3 + 1], dz = geo.dirs[i * 3 + 2];
      const theta = Math.acos(clamp(dy, -1, 1));
      const w = Math.exp(-(theta / 0.4) * (theta / 0.4));
      let y = dy * R * 0.8 + R * 0.46 * w;
      const floor = -R * 0.72, k = 0.035 * R;
      y = 0.5 * (y + floor + Math.sqrt((y - floor) * (y - floor) + k * k));
      rest[i * 3] = dx * R * (1 - 0.5 * w); rest[i * 3 + 1] = y; rest[i * 3 + 2] = dz * R * (1 - 0.5 * w);
      if (piece?.chunk) {
        // an eyeless chunk: a rounded lump (no peak) with a flat cut face toward cutNormal
        let ny = dy * R * 0.82;
        ny = 0.5 * (ny + floor + Math.sqrt((ny - floor) * (ny - floor) + k * k));
        let x = dx * R, z = dz * R;
        const cn = piece.cutNormal, cl = cn ? Math.hypot(cn.x, cn.y, cn.z) : 0;
        if (cn && cl > 1e-6) {
          const nx = cn.x / cl, nyy = cn.y / cl, nz = cn.z / cl, along = x * nx + ny * nyy + z * nz, cap = 0.55 * R;
          if (along > cap) { const dd = along - cap; x -= nx * dd; ny -= nyy * dd; z -= nz * dd; }
        }
        rest[i * 3] = x; rest[i * 3 + 1] = ny; rest[i * 3 + 2] = z;
      }
    }
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += rest[i * 3]; my += rest[i * 3 + 1]; mz += rest[i * 3 + 2]; }
    mx /= n; my /= n; mz /= n;
    let minY = 1e9;
    for (let i = 0; i < n; i++) {
      rest[i * 3] -= mx; rest[i * 3 + 1] -= my; rest[i * 3 + 2] -= mz;
      minY = Math.min(minY, rest[i * 3 + 1]);
      const l = Math.hypot(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]) || 1;
      this.restDir[i * 3] = rest[i * 3] / l; this.restDir[i * 3 + 1] = rest[i * 3 + 1] / l; this.restDir[i * 3 + 2] = rest[i * 3 + 2] / l;
    }
    this.restLocal = rest;
    this.restFloorY = -minY;
    this.positions = new Float32Array(n * 3);
    this.strain = new Float32Array(n).fill(1);
    // neighbour lists (CSR) with rest edge lengths
    const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t], b = this.indices[t + 1], c = this.indices[t + 2];
      nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    }
    this.nbStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.nbStart[i + 1] = this.nbStart[i] + nb[i].size;
    this.nbList = new Uint32Array(this.nbStart[n]);
    this.nbRest = new Float32Array(this.nbStart[n]);
    for (let i = 0; i < n; i++) {
      let o = this.nbStart[i];
      for (const j of nb[i]) {
        this.nbList[o] = j;
        this.nbRest[o] = Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]);
        o++;
      }
    }
    this.restVolume = this.volumeOf(rest);
    if (piece?.at && Number.isFinite(piece.at.x) && Number.isFinite(piece.at.z)) { this.homeX = piece.at.x; this.homeZ = piece.at.z; }
    this.reset();
    if (piece?.vel) { this.vx = piece.vel.x || 0; this.vy = piece.vel.y || 0; this.vz = piece.vel.z || 0; }
  }

  /** CUT: the volume fraction of the whole squishy this body holds. */
  get frac(): number { return this.fracNow; }
  /** CUT: the fraction of this body on the plane's 'a' side (by vertex count: a stand-in), null when the plane misses it. */
  measureCut(plane: CutPlane): number | null {
    const P = this.positions, n = this.vertexCount, N = plane.normal, l = Math.hypot(N.x, N.y, N.z) || 1;
    let a = 0;
    for (let i = 0; i < n; i++) if (((P[i * 3] - plane.point.x) * N.x + (P[i * 3 + 1] - plane.point.y) * N.y + (P[i * 3 + 2] - plane.point.z) * N.z) / l >= 0) a++;
    return a === 0 || a === n ? null : a / n;
  }
  /** CUT: a puppet waist along the plane (t 0..1: 1 = a thin waist), lobes pushed apart; null releases it. */
  setNeck(plane: CutPlane | null, t: number): void {
    if (!plane) { this.neckOn = false; this.neckT = 0; return; }
    const N = plane.normal, l = Math.hypot(N.x, N.y, N.z) || 1;
    this.neckOn = true; this.neckT = clamp(t, 0, 1);
    this.neckP.x = plane.point.x - this.cx; this.neckP.y = plane.point.y - this.cy; this.neckP.z = plane.point.z - this.cz;
    this.neckN.x = N.x / l; this.neckN.y = N.y / l; this.neckN.z = N.z / l;
  }
  /** CUT: grow / shrink to a new fraction of the whole over `seconds` (the rest shape scales by the cube root). */
  setFrac(frac: number, seconds: number): void {
    this.fracGoal = clamp(Number.isFinite(frac) ? frac : this.fracNow, 0.02, 1.2);
    this.fracRate = Math.abs(this.fracGoal - this.fracNow) / Math.max(1e-3, Number.isFinite(seconds) ? seconds : 0.4);
  }

  /** The fraction the rest shape was BUILT at (the constructor's piece.frac): setFrac scales from there. */
  private fracGoalAtBuild0(): number { return this.fracBuilt; }
  private fracBuilt = 1;

  private volumeOf(p: Float32Array): number {
    let v = 0;
    const idx = this.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return Math.abs(v / 6);
  }

  reset(): void {
    this.cx = this.homeX; this.cz = this.homeZ; this.cy = this.gravity ? this.restFloorY : this.R + 0.35;
    this.vx = this.vy = this.vz = 0;
    this.sq = this.sqv = 0; this.peakX = this.peakZ = this.peakVX = this.peakVZ = 0;
    this.tiltX = this.tiltZ = this.tiltVX = this.tiltVZ = 0;
    this.grabOn = false; this.grabAmt = 0;
    this.foldGoal = this.foldT = 0; this.trembleAmp = 0; this.burstX = this.burstV = 0; this.moveGoal = null;
    for (const f of this.fingers) { f.down = false; f.depth = 0; f.target = 0; }
    this.events.length = 0;
    this.build();
  }

  // ---- fingers / grab -------------------------------------------------------------------------------------------------
  fingerDown(id: 0 | 1, a: FingerDownArgs): void {
    const f = this.fingers[id];
    f.down = true; f.px = a.point.x; f.py = a.point.y; f.pz = a.point.z;
    const l = Math.hypot(a.dir.x, a.dir.y, a.dir.z) || 1;
    f.dx = a.dir.x / l; f.dy = a.dir.y / l; f.dz = a.dir.z / l;
    f.target = 0.15; f.depth = 0; f.holdT = 0; f.pressed = false;
    this.ax = -f.dx; this.ay = -f.dy; this.az = -f.dz;
    // a poke: a short sideways kick of the peak and the tilt, plus a quick squash impulse
    this.sqv += 3.5; this.peakVX += f.dx * 0.9; this.peakVZ += f.dz * 0.9;
    this.tiltVX += (f.pz - this.cz) * 2; this.tiltVZ -= (f.px - this.cx) * 2;
    this.emit('poke', f.px, f.py, f.pz, 0.6, 0, id);
  }
  fingerPressure(id: 0 | 1, target: number): void { this.fingers[id].target = clamp(target, 0, 1); }
  fingerMove(id: 0 | 1, point: V3): void { const f = this.fingers[id]; f.px = point.x; f.py = point.y; f.pz = point.z; }
  fingerUp(id: 0 | 1): void {
    const f = this.fingers[id];
    if (!f.down) return;
    f.down = false; f.target = 0;
    if (this.metrics.compression > 0.08) this.emit('release', f.px, f.py, f.pz, this.metrics.compression, f.holdT, id);
  }
  grab(_id: 0 | 1, vertex: number, target: V3): void {
    this.grabOn = true;
    this.gx = this.positions[vertex * 3]; this.gy = this.positions[vertex * 3 + 1]; this.gz = this.positions[vertex * 3 + 2];
    this.gtx = target.x; this.gty = target.y; this.gtz = target.z;
    this.emit('grab', this.gx, this.gy, this.gz, 0.5, 0, 0);
  }
  grabMove(_id: 0 | 1, target: V3): void { this.gtx = target.x; this.gty = target.y; this.gtz = target.z; }
  grabRelease(_id: 0 | 1): void {
    if (this.grabOn) { this.emit('snap', this.gx, this.gy, this.gz, this.metrics.stretch, 0, 0); this.sqv -= 2; }
    this.grabOn = false;
  }
  setFold(t: number): void { this.foldGoal = clamp(t, 0, 1); }
  moveTo(p: V3 | null, stiffness = 1): void { this.moveGoal = p ? { x: p.x, y: 0, z: p.z } : null; this.moveK = Math.max(0.1, stiffness); }
  tremble(amp: number): void { this.trembleAmp = clamp(amp, 0, 1); }
  burstOpen(strength: number): void { this.burstV += 5.6 * clamp(strength, 0, 1); }

  nudge(i: V3): void { this.vx += i.x; this.vy += i.y; this.vz += i.z; this.peakVX -= i.x * 3; this.peakVZ -= i.z * 3; }
  drainEvents(out: SoftEvent[]): void { for (const e of this.events) out.push(e); this.events.length = 0; }
  stateHash(): number {
    let h = 2166136261;
    for (let i = 0; i < this.positions.length; i += 7) h = Math.imul(h ^ Math.round(this.positions[i] * 1e4), 16777619);
    return h >>> 0;
  }

  private emit(kind: SoftEvent['kind'], x: number, y: number, z: number, intensity: number, heldFor: number, finger: number): void {
    this.events.push({ kind, at: { x, y, z }, normal: { x: 0, y: 1, z: 0 }, intensity: clamp(intensity, 0, 1), heldFor, finger });
  }

  // ---- dynamics -----------------------------------------------------------------------------------------------------
  step(dt: number): void {
    this.acc += clamp(Number.isFinite(dt) ? dt : 0, 0, 1 / 20);
    const H = 1 / 120;
    while (this.acc >= H) { this.acc -= H; this.sub(H); }
    this.build();
    this.updateMetrics(clamp(dt, 1e-4, 1 / 20));
  }

  private sub(h: number): void {
    this.t += h;
    if (this.fracNow !== this.fracGoal) {
      const st = this.fracRate * h;
      this.fracNow = Math.abs(this.fracGoal - this.fracNow) <= st ? this.fracGoal : this.fracNow + Math.sign(this.fracGoal - this.fracNow) * st;
    }
    this.foldT += (this.foldGoal - this.foldT) * (1 - Math.exp(-h * 7));
    this.burstV += (-260 * this.burstX - 7 * this.burstV) * h;
    this.burstX = clamp(this.burstX + this.burstV * h, -0.8, 0.6);
    if (this.moveGoal) {
      const k = 120 * this.moveK, c = 2 * Math.sqrt(k);
      this.vx += (k * (this.moveGoal.x - this.cx) - c * this.vx) * h; this.vz += (k * (this.moveGoal.z - this.cz) - c * this.vz) * h;
    }
    // fingers ease toward their pressure target (critically damped-ish), release retracts fast
    let dMax = 0;
    for (const f of this.fingers) {
      if (f.down) {
        f.holdT += h;
        f.depth += (f.target - f.depth) * (1 - Math.exp(-h / 0.08));
        if (!f.pressed && f.holdT > 0.18) { f.pressed = true; this.emit('press', f.px, f.py, f.pz, f.depth, 0, 0); }
      } else f.depth += (0 - f.depth) * (1 - Math.exp(-h / 0.04));
      dMax = Math.max(dMax, f.depth);
    }
    // squash spring along the press axis: stiff + underdamped = a springy overshoot on release
    const sqTarget = 0.42 * dMax;
    const k = 420, c = 8.5;
    this.sqv += (-k * (this.sq - sqTarget) - c * this.sqv) * h;
    this.sq += this.sqv * h;
    this.sq = clamp(this.sq, -0.45, 0.7);
    // flopping peak + tilt
    const pk = 85, pc = 1.8;
    this.peakVX += (-pk * this.peakX - pc * this.peakVX) * h; this.peakVZ += (-pk * this.peakZ - pc * this.peakVZ) * h;
    this.peakX += this.peakVX * h; this.peakZ += this.peakVZ * h;
    this.peakX = clamp(this.peakX, -0.3, 0.3); this.peakZ = clamp(this.peakZ, -0.3, 0.3);
    const tk = 140, tc = 5;
    this.tiltVX += (-tk * this.tiltX - tc * this.tiltVX) * h; this.tiltVZ += (-tk * this.tiltZ - tc * this.tiltVZ) * h;
    this.tiltX += this.tiltVX * h; this.tiltZ += this.tiltVZ * h;
    this.tiltX = clamp(this.tiltX, -0.25, 0.25); this.tiltZ = clamp(this.tiltZ, -0.25, 0.25);
    // grab
    this.grabAmt += ((this.grabOn ? 1 : 0) - this.grabAmt) * (1 - Math.exp(-h / (this.grabOn ? 0.06 : 0.05)));
    // centre of mass
    const px0 = this.vx;
    if (this.gravity) {
      this.vy -= 9.8 * h;
      this.cy += this.vy * h;
      // lowest point (cheap estimate: rest floor, squashed along the axis)
      const floorY = (this.restFloorY * (1 - this.foldT) + this.R * 0.8 * this.foldT) * Math.cbrt(this.fracNow / this.fracBuilt);
      const low = this.cy - floorY * (1 + this.burstX) * (1 - this.sq * Math.abs(this.ay) + 0.5 * this.sq * (1 - Math.abs(this.ay)));
      if (low < 0) {
        this.cy -= low;
        if (this.vy < -0.5) { this.sqv += -this.vy * 2.2; this.ax = 0; this.ay = 1; this.az = 0; this.emit('land', this.cx, 0, this.cz, clamp(-this.vy / 4.5, 0, 1), 0, -1); }
        this.vy = this.vy < -0.5 ? -this.vy * 0.25 : 0;
      }
    } else {
      const target = this.R + 0.35 + 0.03 * Math.sin(this.t * 2.1);
      this.vy += (28 * (target - this.cy) - 6 * this.vy) * h;
      this.cy += this.vy * h;
    }
    this.vx *= Math.exp(-h * (this.gravity ? 6 : 1.6)); this.vz *= Math.exp(-h * (this.gravity ? 6 : 1.6));
    this.cx += this.vx * h; this.cz += this.vz * h;
    if (!this.gravity) { this.vx += -2.2 * this.cx * h; this.vz += -2.2 * this.cz * h; }
    // lateral acceleration flops the peak
    const axl = (this.vx - px0) / h;
    this.peakVX -= axl * 0.02 * h * 60; // small coupling
  }

  private build(): void {
    const n = this.vertexCount, rest = this.restLocal, P = this.positions, R = this.R;
    // frame from the small tilt angles
    const hx = this.tiltX * 0.5, hz = this.tiltZ * 0.5;
    const qx = Math.sin(hx), qz = Math.sin(hz), qw = Math.cos(hx) * Math.cos(hz);
    const qy = 0;
    const ql = Math.hypot(qx, qy, qz, qw);
    const fx = qx / ql, fy = qy / ql, fz = qz / ql, fw = qw / ql;
    this.frame.x = fx; this.frame.y = fy; this.frame.z = fz; this.frame.w = fw;
    const sq = this.sq, ax = this.ax, ay = this.ay, az = this.az;
    const y0 = R * 0.35, hpk = R * 0.75;
    const f0 = this.fingers[0], f1 = this.fingers[1];
    const sigma = 0.23 * R, inv2s2 = 1 / (2 * sigma * sigma);
    const dd0 = f0.depth * 0.75 * R, dd1 = f1.depth * 0.75 * R;
    const ga = this.grabAmt;
    const fo = this.foldT, Rf = R * 0.8, bsc = 1 + this.burstX, tr = this.trembleAmp * R * 0.012;
    const gdx = this.gtx - this.gx, gdy = this.gty - this.gy, gdz = this.gtz - this.gz;
    const gsig = 0.3 * R, ginv = 1 / (2 * gsig * gsig);
    const fsc = Math.cbrt(this.fracNow / Math.max(1e-6, this.fracGoalAtBuild0())), nk = this.neckOn ? this.neckT : 0;
    const nN = this.neckN, nP = this.neckP, nW = 0.28 * R;
    let minY = 1e9;
    for (let i = 0; i < n; i++) {
      let x = rest[i * 3] * fsc, y = rest[i * 3 + 1] * fsc, z = rest[i * 3 + 2] * fsc;
      if (nk > 1e-3) {
        // the waist: pinch toward the plane's normal axis near the plane, push the two lobes apart (volume roughly kept)
        const s = (x - nP.x) * nN.x + (y - nP.y) * nN.y + (z - nP.z) * nN.z;
        const px = x - s * nN.x, py = y - s * nN.y, pz = z - s * nN.z;          // the point's projection on the plane
        const ax0 = nP.x - ((nP.x) * nN.x + (nP.y) * nN.y + (nP.z) * nN.z) * nN.x, ay0 = nP.y - ((nP.x) * nN.x + (nP.y) * nN.y + (nP.z) * nN.z) * nN.y, az0 = nP.z - ((nP.x) * nN.x + (nP.y) * nN.y + (nP.z) * nN.z) * nN.z;
        const pinch = 0.85 * nk * Math.exp(-(s / nW) * (s / nW));
        x = ax0 + (px - ax0) * (1 - pinch) + s * nN.x; y = ay0 + (py - ay0) * (1 - pinch) + s * nN.y; z = az0 + (pz - az0) * (1 - pinch) + s * nN.z;
        const push = 0.12 * R * nk * Math.sign(s) * (1 - Math.exp(-Math.abs(s) / nW));
        x += nN.x * push; y += nN.y * push; z += nN.z * push;
      }
      const rdx = this.restDir[i * 3], rdy = this.restDir[i * 3 + 1], rdz = this.restDir[i * 3 + 2];
      if (fo > 1e-3) { x += (rdx * Rf - x) * fo; y += (rdy * Rf - y) * fo; z += (rdz * Rf - z) * fo; }   // fold into an equal-volume ball
      if (bsc !== 1) { x *= bsc; y *= bsc; z *= bsc; }
      // 1. squash along the axis, widen across it (volume ~ conserved)
      const along = x * ax + y * ay + z * az;
      x += -ax * along * sq + (x - ax * along) * 0.5 * sq;
      y += -ay * along * sq + (y - ay * along) * 0.5 * sq;
      z += -az * along * sq + (z - az * along) * 0.5 * sq;
      // 2. peak shear
      const hp = clamp((rest[i * 3 + 1] - y0) / hpk, 0, 1), hp2 = hp * hp;
      x += this.peakX * hp2; z += this.peakZ * hp2; y -= 0.3 * (Math.abs(this.peakX) + Math.abs(this.peakZ)) * hp2;
      // 3. tilt (small-angle quaternion rotation)
      const tx = 2 * (fy * z - fz * y), ty = 2 * (fz * x - fx * z), tz = 2 * (fx * y - fy * x);
      const wx = x + fw * tx + (fy * tz - fz * ty), wy = y + fw * ty + (fz * tx - fx * tz), wz = z + fw * tz + (fx * ty - fy * tx);
      let X = this.cx + wx, Y = this.cy + wy, Z = this.cz + wz;
      // 4. finger dents (only the side facing the finger)
      if (dd0 > 1e-4) {
        const ex = X - f0.px, ey = Y - f0.py, ez = Z - f0.pz;
        const facing = Math.max(0, -(rdx * f0.dx + rdy * f0.dy + rdz * f0.dz));
        const g = Math.exp(-(ex * ex + ey * ey + ez * ez) * inv2s2) * Math.sqrt(facing);
        X += f0.dx * dd0 * g; Y += f0.dy * dd0 * g; Z += f0.dz * dd0 * g;
      }
      if (dd1 > 1e-4) {
        const ex = X - f1.px, ey = Y - f1.py, ez = Z - f1.pz;
        const facing = Math.max(0, -(rdx * f1.dx + rdy * f1.dy + rdz * f1.dz));
        const g = Math.exp(-(ex * ex + ey * ey + ez * ez) * inv2s2) * Math.sqrt(facing);
        X += f1.dx * dd1 * g; Y += f1.dy * dd1 * g; Z += f1.dz * dd1 * g;
      }
      // 5. grab: a gaussian patch follows the target
      if (ga > 1e-3) {
        const ex = X - this.gx, ey = Y - this.gy, ez = Z - this.gz;
        const g = Math.exp(-(ex * ex + ey * ey + ez * ez) * ginv) * ga;
        X += gdx * g; Y += gdy * g; Z += gdz * g;
      }
      if (tr > 0) { X += Math.sin(this.t * 61 + i * 1.7) * tr; Y += Math.sin(this.t * 53 + i * 2.3) * tr; Z += Math.sin(this.t * 47 + i * 0.9) * tr; }
      if (Y < 0.0005) Y = 0.0005;
      if (Y < minY) minY = Y;
      P[i * 3] = X; P[i * 3 + 1] = Y; P[i * 3 + 2] = Z;
    }
    this.center.x = this.cx; this.center.y = this.cy; this.center.z = this.cz;
    this.metrics.grounded = this.gravity && minY < 0.004;
    // strain from the real edge lengths
    const nbS = this.nbStart, nbL = this.nbList, nbR = this.nbRest;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const a = nbS[i], b = nbS[i + 1];
      for (let k = a; k < b; k++) {
        const j = nbL[k] * 3;
        s += Math.hypot(P[i * 3] - P[j], P[i * 3 + 1] - P[j + 1], P[i * 3 + 2] - P[j + 2]) / nbR[k];
      }
      this.strain[i] = s / (b - a);
    }
  }

  private updateMetrics(dt: number): void {
    const m = this.metrics;
    const depth = Math.max(this.fingers[0].depth, this.fingers[1].depth);
    const comp = clamp(this.sq * 1.55 + depth * 0.55, 0, 1);
    const raw = (comp - this.prevComp) / dt;
    this.prevComp = comp;
    m.compression = comp;
    m.compressionRate += (raw - m.compressionRate) * (1 - Math.exp(-dt / 0.06));
    m.stretch = clamp(this.grabAmt * Math.hypot(this.gtx - this.gx, this.gty - this.gy, this.gtz - this.gz) / (1.1 * this.R) + Math.max(0, -this.sq) * 1.2, 0, 1);
    m.volume = this.volumeOf(this.positions) / this.restVolume;
    m.kinetic = clamp(Math.abs(this.sqv) * 0.12 + Math.hypot(this.peakVX, this.peakVZ) * 0.35 + Math.hypot(this.vx, this.vz, this.vy) * 0.2, 0, 1);
    m.fingers = (this.fingers[0].down ? 1 : 0) + (this.fingers[1].down ? 1 : 0);
    m.grabbed = this.grabOn;
  }

  raycast(origin: V3, dir: V3): RayHit | null {
    const P = this.positions, idx = this.indices;
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;
    let best = Infinity, bi = -1, bu = 0, bv = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = origin.x - P[a], ty = origin.y - P[a + 1], tz = origin.z - P[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-5 && tt < best) { best = tt; bi = t; bu = u; bv = v; }
    }
    if (bi < 0) return null;
    const a = idx[bi], b = idx[bi + 1], c = idx[bi + 2];
    const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
    const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const w = 1 - bu - bv;
    const vertex = w >= bu && w >= bv ? a : bu >= bv ? b : c;
    return {
      point: { x: origin.x + dx * best, y: origin.y + dy * best, z: origin.z + dz * best },
      normal: { x: nx, y: ny, z: nz }, vertex, t: best,
    };
  }
}
