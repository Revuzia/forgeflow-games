// BodyProxy: what the renderer actually reads. It wraps ANY SoftBodyLike and exposes the same interface with its own
// `positions` / `strain` / `center` / `metrics`, refreshed by sync() once per frame. That gives the render lane three things
// without touching the physics lane:
//   * a world-space OFFSET per body (multi-body stage: two parents and a result side by side, all simulated at their own origin),
//   * the ceremony drivers (setFold / moveTo / tremble / burstOpen): forwarded to the body when it implements them (PHYS
//     round 2), otherwise a PROCEDURAL PUPPET deforms the proxy's copy of the sim mesh (so the fine mesh, eyes, core and
//     glitter all follow, because they read the proxy),
//   * render-only extras the ceremonies need: contact squash between two bodies, a "charge" compression, scale for pop-in.
// The interactive body (the shell's) is never touched: its raycast / finger / grab calls pass straight through.
import type { FingerDownArgs, RayHit, SoftBodyLike, SoftEvent, SoftMetrics, V3 } from '../contracts.ts';

export class BodyProxy implements SoftBodyLike {
  readonly inner: SoftBodyLike;
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly restLocal: Float32Array;
  readonly indices: Uint32Array;
  readonly strain: Float32Array;
  readonly center: V3 = { x: 0, y: 0, z: 0 };
  readonly frame: { x: number; y: number; z: number; w: number };
  readonly metrics: SoftMetrics;
  readonly restRadius: number;
  /** True when the wrapped body implements the driver natively (the puppet then stays out of the way). */
  readonly native: { fold: boolean; moveTo: boolean; tremble: boolean; burst: boolean };

  // ---- render-space transform ----
  readonly offset: V3 = { x: 0, y: 0, z: 0 };
  /** Uniform scale about the body's table contact (pop-in from the capsule, absorbed parents). */
  scale = 1;
  /**
   * Contact squash against another body (merge T0): a contact PLANE on the side facing (-squashAx, -squashAz), `squashPlane` world
   * units from the centre. Skin that would cross it is flattened onto it and the displaced jelly bulges out sideways and up, like
   * two water balloons pressed together; the far side keeps its shape. `squashAmt` 0..1 blends the effect in.
   */
  squashAx = 1; squashAz = 0; squashAmt = 0; squashPlane = 1e9;
  /** Contact planes on BOTH sides along the axis (the middle body of a 3-in-a-row merge, pressed from left and right). */
  squashTwoSided = false;
  /** Extra "charge" compression 0..1 (blush, core brightening) for the merge ball. */
  charge = 0;

  // ---- procedural puppet state (used only where the body has no native driver) ----
  private fold = 0;
  private foldGoal = 0;
  private trembleAmp = 0;
  private burstX = 0;
  private burstV = 0;
  private moveGoal: V3 | null = null;
  private moveK = 1;
  private time = 0;
  private readonly foldRadius: number;

  constructor(inner: SoftBodyLike) {
    this.inner = inner;
    this.vertexCount = inner.vertexCount;
    this.restLocal = inner.restLocal;
    this.indices = inner.indices;
    this.frame = inner.frame;
    this.restRadius = inner.restRadius;
    this.positions = new Float32Array(inner.positions.length);
    this.strain = new Float32Array(inner.strain.length);
    this.metrics = { ...inner.metrics };
    this.native = {
      fold: typeof inner.setFold === 'function', moveTo: typeof inner.moveTo === 'function',
      tremble: typeof inner.tremble === 'function', burst: typeof inner.burstOpen === 'function',
    };
    this.foldRadius = inner.restRadius * 0.8;
    this.sync(0, 0);
  }

  get gravity(): boolean { return this.inner.gravity; }
  set gravity(v: boolean) { this.inner.gravity = v; }

  setOffset(x: number, y: number, z: number): void { this.offset.x = x; this.offset.y = y; this.offset.z = z; }

  // ---- ceremony drivers (always present on the proxy) ----
  setFold(t: number): void { this.foldGoal = Math.min(1, Math.max(0, t)); if (this.native.fold) this.inner.setFold?.(this.foldGoal); }
  moveTo(p: V3 | null, stiffness = 1): void {
    if (this.native.moveTo) { this.inner.moveTo?.(p, stiffness); return; }
    this.moveGoal = p ? { x: p.x, y: 0, z: p.z } : null; this.moveK = Math.max(0.1, stiffness);
  }
  tremble(amp: number): void { this.trembleAmp = Math.min(1, Math.max(0, amp)); if (this.native.tremble) this.inner.tremble?.(this.trembleAmp); }
  burstOpen(strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    if (this.native.burst) this.inner.burstOpen?.(s); else this.burstV += 5.6 * s;
  }
  /** Pre-load the open-spring so a freshly created body pops OUT of a smaller size (ceremony reveal): scale starts at 1 + x0. */
  popFrom(x0: number, v0: number): void { this.burstX = x0; this.burstV = v0; }
  get foldAmount(): number { return this.native.fold ? this.foldGoal : this.fold; }

  /** Copy the sim mesh and apply offset + puppet. Call once per frame after the body stepped. */
  sync(dt: number, time: number): void {
    const inner = this.inner, P = inner.positions, out = this.positions, n = this.vertexCount;
    const c = inner.center;
    this.time = time;
    // --- puppet integration ---
    if (!this.native.fold) {
      const k = 1 - Math.exp(-dt * 7);
      this.fold += (this.foldGoal - this.fold) * k;
    }
    if (!this.native.burst && dt > 0) {
      this.burstV += (-260 * this.burstX - 7 * this.burstV) * dt;
      this.burstX += this.burstV * dt;
      if (this.burstX > 0.6) this.burstX = 0.6;
      if (this.burstX < -0.8) this.burstX = -0.8;
    }
    if (!this.native.moveTo && this.moveGoal && dt > 0) {
      const k = 1 - Math.exp(-dt * 9 * this.moveK);
      this.offset.x += (this.moveGoal.x - this.offset.x) * k; this.offset.z += (this.moveGoal.z - this.offset.z) * k;
    }
    const f = this.native.fold ? 0 : this.fold;
    const bs = this.native.burst ? 0 : this.burstX;
    const tr = this.native.tremble ? 0 : this.trembleAmp;
    const sc = this.scale * (1 + bs);
    const ox = this.offset.x, oy = this.offset.y, oz = this.offset.z;
    const R = this.foldRadius;
    const cx = c.x, cy = c.y, cz = c.z;
    const sqA = this.squashAmt, ax = this.squashAx, az = this.squashAz, plane = this.squashPlane, two = this.squashTwoSided;
    const rr = this.restRadius * 0.012 * tr;
    const Rr = this.restRadius;
    const moved = f > 1e-3 || bs !== 0 || tr > 0 || sc !== 1 || sqA > 1e-3;
    let shift = 0;
    let maxOver = 0;
    if (!moved) {
      for (let i = 0; i < n * 3; i += 3) { out[i] = P[i] + ox; out[i + 1] = P[i + 1] + oy; out[i + 2] = P[i + 2] + oz; }
    } else {
      const t = time;
      for (let i = 0, v = 0; i < n * 3; i += 3, v++) {
        let dx = P[i] - cx, dy = P[i + 1] - cy, dz = P[i + 2] - cz;
        if (f > 1e-3) {
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
          const k = f * (R / l - 1);   // morph toward the equal-volume sphere
          dx += dx * k; dy += dy * k; dz += dz * k;
        }
        if (sqA > 1e-3) {
          // flatten onto the contact plane (along = -plane), push the displaced volume out across the axis and up
          const along = dx * ax + dz * az;
          let over = -plane - along, side = 1;              // > 0: this skin point is past the contact plane (on the -axis side)
          if (two && along - plane > over) { over = along - plane; side = -1; }   // ... or past the mirrored one on the +axis side
          if (over > 0) {
            if (over > maxOver) maxOver = over;
            const k = sqA * over;
            const nAlong = along + side * k * 0.92;          // nearly flat face (a little give)
            const bul = 1 + sqA * 0.55 * Math.min(1.5, over / Rr);
            const px = (dx - ax * along) * bul, pz = (dz - az * along) * bul;
            dx = ax * nAlong + px; dz = az * nAlong + pz; dy = dy * (1 + sqA * 0.25 * Math.min(1.5, over / Rr)) + sqA * 0.12 * over;
          } else {
            const g = 1 + sqA * 0.06 * Math.max(0, 1 - (-over) / Rr);   // a little general swelling near the contact
            const px = (dx - ax * along) * g, pz = (dz - az * along) * g;
            dx = ax * along + px; dz = az * along + pz;
          }
        }
        if (tr > 0) {
          dx += Math.sin(t * 61 + v * 1.7) * rr; dy += Math.sin(t * 53 + v * 2.3) * rr; dz += Math.sin(t * 47 + v * 0.9) * rr;
        }
        out[i] = cx + dx * sc + ox; out[i + 1] = cy + dy * sc + oy; out[i + 2] = cz + dz * sc + oz;
      }
      // scaling / folding about the centre of mass lifts or sinks the body: re-seat a grounded body so its lowest vertex stays on the table
      if (inner.metrics.grounded || inner.gravity) {
        let lo = 1e9;
        for (let i = 1; i < n * 3; i += 3) if (out[i] < lo) lo = out[i];
        shift = oy - lo;
        for (let i = 1; i < n * 3; i += 3) out[i] += shift;
      }
    }
    this.center.x = cx + ox; this.center.y = cy + oy + shift; this.center.z = cz + oz;
    // --- strain / metrics (blush and core brightening react to the puppet) ---
    const S = inner.strain, so = this.strain;
    const pressed = sqA * Math.min(1, maxOver / (0.3 * Rr));       // how hard the contact face is pressed (0 until the bodies touch)
    const pc = Math.min(1, f * 0.35 + this.charge * 0.45 + pressed * 0.7);
    const sk = 1 - 0.1 * pc;
    for (let i = 0; i < n; i++) so[i] = S[i] * sk;
    // every metric the body reports passes through, INCLUDING fields this file does not know yet (PHYS adds optional ones: press,
    // reaction, strands, slosh, ...): a generic copy (for..in over the same object every frame: no allocation), then the two the puppet adds to
    const m = this.metrics as unknown as Record<string, unknown>, im = inner.metrics as unknown as Record<string, unknown>;
    for (const key in im) m[key] = im[key];
    const mm = this.metrics, imm = inner.metrics;
    mm.compression = Math.max(imm.compression, pc);
    mm.kinetic = Math.min(1, imm.kinetic + tr * 0.5);
  }

  // ---- everything else passes straight through ----
  step(dt: number): void { this.inner.step(dt); }
  raycast(origin: V3, dir: V3): RayHit | null {
    if (this.offset.x === 0 && this.offset.y === 0 && this.offset.z === 0) return this.inner.raycast(origin, dir);
    const h = this.inner.raycast({ x: origin.x - this.offset.x, y: origin.y - this.offset.y, z: origin.z - this.offset.z }, dir);
    if (!h) return null;
    return { point: { x: h.point.x + this.offset.x, y: h.point.y + this.offset.y, z: h.point.z + this.offset.z }, normal: h.normal, vertex: h.vertex, t: h.t };
  }
  fingerDown(id: 0 | 1, a: FingerDownArgs): void { this.inner.fingerDown(id, a); }
  fingerPressure(id: 0 | 1, target: number): void { this.inner.fingerPressure(id, target); }
  fingerMove(id: 0 | 1, point: V3): void { this.inner.fingerMove(id, point); }
  fingerUp(id: 0 | 1): void { this.inner.fingerUp(id); }
  grab(id: 0 | 1, vertex: number, target: V3): void { this.inner.grab(id, vertex, target); }
  grabMove(id: 0 | 1, target: V3): void { this.inner.grabMove(id, target); }
  grabRelease(id: 0 | 1): void { this.inner.grabRelease(id); }
  nudge(impulse: V3): void { this.inner.nudge(impulse); }
  reset(): void { this.inner.reset(); }
  drainEvents(out: SoftEvent[]): void { this.inner.drainEvents(out); }
  stateHash(): number { return this.inner.stateHash(); }
}
