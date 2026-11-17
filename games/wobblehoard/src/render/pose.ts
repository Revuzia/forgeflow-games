// PLAYGROUND render pose (StageLike.setBodyPose, PLAYGROUND_BUILD.md 9, LIFE.md 5.1): the motion that does not move the body, so a sleeping
// squishy can lean, sway, wiggle, shiver and breathe at about zero physics cost. One small shear-and-scale about the body's ground point,
// applied in the jelly's vertex stage (material.ts POSE_VERT, uniforms uPose / uPoseC) and, with the SAME formula, to the eye anchors on the CPU
// (face.ts: the beads are fitted to the sim footprint, so they need it; RD-11: a swaying sleeper's eyes stay on its skin).
//
//   h      = clamp((y - g) / H, 0, 1.6)            the height share above the ground point g (H = the body's rest height)
//   x'     = x + sx * h + (x - cx) * (-b / 2)       sx = lean x R + sway(t) x R   (a sway is side to side: world x)
//   z'     = z + sz * h + (z - cz) * (-b / 2)       sz = lean z R
//   y'     = y + (y - g) * b                        b  = a slow breath (asleep), a slow deep breath (basking firm silicone / pop dome)
//
// Every term is ADDED (never a re-centred product), so with every input at 0 the vertex is bit-identical to today's (RD-02's pixel identity).
// Limits (LIFE.md 5.1, contracts.ts): lean at most 0.1 R, sway at most 0.05 R at at most 4 Hz, a shiver (Hz above 4) 7 Hz at most 0.015 R.
// Calm or reduced motion: no sway above 2 Hz (LIFE.md 5.2, LF-17), the stage's backstop; breathing stays (it is slow). Zero allocation.
import * as THREE from 'three';

const TAU = Math.PI * 2;
/** Breathing while asleep: depth (share of the height) and rate (Hz): one breath every 4 s. */
const SLEEP_BREATH = 0.012, SLEEP_HZ = 0.25;
/** setBodyBreath(1): the slow, deep breaths of a basking firm silicone or pop dome (PLACES 3.1). */
const DEEP_BREATH = 0.03, DEEP_HZ = 0.18;

export class RenderPose {
  // targets (setBodyPose / setBodyBreath / setBodyAsleep)
  leanX = 0; leanZ = 0; swayAmp = 0; swayHz = 0; swayPhase = 0; deep = 0; asleep = false;
  /** Stage time at the last setBodyPose: the sway is sin(2 pi hz (t - t0) + phase), so a phase from the shell's beat holds from its call on. */
  t0 = 0;
  // eased (never a pop: ~0.15 s)
  private lx = 0; private lz = 0; private sa = 0; private bs = 0; private bd = 0;
  /** uPose: (sx, sz, b, 0) and uPoseC: (cx, g, cz, 1 / H), recomputed by update(); exactly 0 when the pose is off. */
  readonly u = new THREE.Vector4();
  readonly c = new THREE.Vector4(0, 0, 0, 1);
  /** True when any term is non-zero this frame (the eye anchors then need it). */
  active = false;

  set(leanX: number, leanZ: number, swayAmp: number, swayHz: number, swayPhase: number, now: number): void {
    const f = (v: number): number => (Number.isFinite(v) ? v : 0);
    let lx = f(leanX), lz = f(leanZ);
    const l = Math.sqrt(lx * lx + lz * lz);
    if (l > 0.1) { lx *= 0.1 / l; lz *= 0.1 / l; }
    this.leanX = lx; this.leanZ = lz;
    let hz = Math.max(0, f(swayHz));
    // a shiver is the one fast motion: 7 Hz at most 0.015 R; any other sway at most 4 Hz and 0.05 R
    const shiver = hz > 4;
    hz = shiver ? Math.min(7, hz) : hz;
    this.swayHz = hz;
    this.swayAmp = Math.max(0, Math.min(shiver ? 0.015 : 0.05, f(swayAmp)));
    this.swayPhase = f(swayPhase);
    this.t0 = now;
  }

  /** One frame. (cx, cz) the body's centre, g its ground point (lowest skin), H its rest height, R its rest radius (all world). */
  update(dt: number, time: number, cx: number, cz: number, g: number, H: number, R: number, quiet: boolean): void {
    const k = 1 - Math.exp(-dt * 7);
    this.lx += (this.leanX - this.lx) * k;
    this.lz += (this.leanZ - this.lz) * k;
    this.sa += (this.swayAmp - this.sa) * k;
    this.bs += ((this.asleep ? 1 : 0) - this.bs) * (1 - Math.exp(-dt * 2));
    this.bd += (this.deep - this.bd) * (1 - Math.exp(-dt * 2));
    const tiny = (v: number, goal: number): boolean => goal === 0 && Math.abs(v) < 1e-4;
    if (tiny(this.lx, this.leanX)) this.lx = 0;
    if (tiny(this.lz, this.leanZ)) this.lz = 0;
    if (tiny(this.sa, this.swayAmp)) this.sa = 0;
    if (tiny(this.bs, this.asleep ? 1 : 0)) this.bs = 0;
    if (tiny(this.bd, this.deep)) this.bd = 0;
    if (this.lx === 0 && this.lz === 0 && this.sa === 0 && this.bs === 0 && this.bd === 0) {
      this.active = false; this.u.set(0, 0, 0, 0); return;
    }
    this.active = true;
    // Calm or reduced motion: no sway faster than 2 Hz (a shiver becomes a slow, small sway)
    const hz = quiet ? Math.min(2, this.swayHz) : this.swayHz;
    const sway = this.sa > 0 ? this.sa * Math.sin(TAU * hz * (time - this.t0) + this.swayPhase) : 0;
    const b = this.bs * SLEEP_BREATH * Math.sin(TAU * SLEEP_HZ * time) + this.bd * DEEP_BREATH * Math.sin(TAU * DEEP_HZ * time);
    this.u.set((this.lx + sway) * R, this.lz * R, b, 0);
    this.c.set(cx, g, cz, 1 / Math.max(0.05, H));
  }

  /** The CPU twin of the vertex stage: posed (x, y, z) into out[o..o+2] (out may alias the input's own array). */
  apply(x: number, y: number, z: number, out: { [i: number]: number }, o: number): void {
    const u = this.u, c = this.c;
    const h = Math.min(1.6, Math.max(0, (y - c.y) * c.w));
    out[o] = x + u.x * h + (x - c.x) * (-0.5 * u.z);
    out[o + 1] = y + (y - c.y) * u.z;
    out[o + 2] = z + u.y * h + (z - c.z) * (-0.5 * u.z);
  }

  /**
   * Round 3 (MERGE_PC doubt 1): the posed twin of a PLANE n . p = d (n unit), so a bead clipped at a cut face stays flush with the face the
   * vertex stage poses. The pose is affine where 0 <= h <= 1.6 (a shear by (sx, sz) / H per metre of height and a scale about the ground
   * point), so a plane maps to a plane: normal A^-T n, through the posed foot of `ref` on the plane (ref = the bead's unposed anchor: the
   * clamp of h is taken at that point, so the plane is exact where it clips the bead). Writes (nx, ny, nz, d) of the posed plane into out[0..3].
   */
  applyPlane(nx: number, ny: number, nz: number, d: number, rx: number, ry: number, rz: number, out: { [i: number]: number }): void {
    const u = this.u, c = this.c;
    const k = rx * nx + ry * ny + rz * nz - d, px = rx - k * nx, py = ry - k * ny, pz = rz - k * nz;   // the foot of ref on the plane
    const hh = (py - c.y) * c.w, inside = hh > 0 && hh < 1.6;
    const a = 1 - 0.5 * u.z, cc = 1 + u.z, sp = inside ? u.x * c.w : 0, sq = inside ? u.y * c.w : 0;
    let mx = nx / a, my = ny / cc - (sp * nx + sq * nz) / (a * cc), mz = nz / a;
    const l = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
    mx /= l; my /= l; mz /= l;
    this.apply(px, py, pz, out, 0);
    const d2 = mx * out[0] + my * out[1] + mz * out[2];
    out[0] = mx; out[1] = my; out[2] = mz; out[3] = d2;
  }
}

/** The vertex-stage twin of RenderPose.apply (inserted after three's begin_vertex: `transformed` is the world position, the mesh sits at the origin). */
export const POSE_VERT = /* glsl */`
{
  float jPh = clamp((transformed.y - uPoseC.y) * uPoseC.w, 0.0, 1.6);
  transformed.x += uPose.x * jPh + (transformed.x - uPoseC.x) * (-0.5 * uPose.z);
  transformed.z += uPose.y * jPh + (transformed.z - uPoseC.z) * (-0.5 * uPose.z);
  transformed.y += (transformed.y - uPoseC.y) * uPose.z;
}
`;
