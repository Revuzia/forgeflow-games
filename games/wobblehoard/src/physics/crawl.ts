// R10 LOCOMOTION (owner, 2026-11-19, D-100): a squishy that travels by itself CRAWLS like a slug or a snail instead of gliding as a rigid blob.
// In the props chunk (later-props: softbody.ts's first load is at its cap); a prop world gives each body it tracks one Crawl (props.ts trk) and steps it once
// a frame in beginFrame, before the bodies step. The soft body itself does the crawling, so squishing, grabbing and collisions behave as before:
//   1. the GOAL: a travelling wave of axial strain along the travel direction, in the body's rest frame (SoftBody.crawlD, added to the goal shape in
//      frameUpdate while SoftBody.crawlOn; the rotation is fitted against the rest shape + the wave, SoftBody.crawlF): the front stretches forward and plants, the middle bunches up into an arch as the body shortens (and a little
//      bulge rides with each bunched part), the rear pulls in; the front's upper part lifts a little while it reaches; the body leans into a turn. The phase advances with the distance glided (one cycle per stride),
//      the front leads the rear by 2 kappa, and the field's mass-weighted mean is 0 (the goal stays centred: no drift).
//   2. the GRIP: scootTo's rigid glide stays as it was (its speed, ease, touch gate and target: WHERE and WHEN a squishy goes do not change); once a frame each
//      particle is moved by w x the frame's glide along the travel direction, w = the wave's speed share (-1 planted: the base stays where it is on the ground,
//      +1 reaching: twice the glide). It is a move of X before the frame's substeps (like the glide), so friction never sees it and nothing gains momentum; the
//      wave of the goal is its integral, so the shape matching agrees with it. Averaged over a cycle w is 0: the travel speed is the glide's. CRAWL.beta of the
//      wave's mean over the body at the moment is taken out of the move (the centre surges less; the planted base then slips at about a quarter of the glide).
//   3. the FADE: off under a touch (the touch gate), while held, carried, in a ceremony, floating, in the air for long, in Calm (the shell's world.calm: today's
//      glide) and once the glide stops: the wave eases out and the shape matching brings the body back to its rest shape.
// Per family (CRAWL_FAMILY): stride (body half-lengths per cycle), the phase lead, the grip's sharpness (a square wave plants hard), the bunch's height
// share, the head lift and the arch. Less grip (ice) scales the wave: the base slips. Zero allocation after construction.
import type { SoftBody } from './softbody.ts';

/** per family: stride (half-lengths per cycle), kappa (pi units: the front leads the rear by 2 kappa), sharpness of the grip, the local bunch's height share,
 *  the head lift (half-lengths), the hump (the middle rises as the body shortens: x the length deficit; 1.5 gives the deficit's volume back in height) */
export const CRAWL_FAMILY: Record<string, [number, number, number, number, number, number]> = {
  slowrise: [0.5, 0.6, 2, 0.35, 0.06, 1.6], marshmallow: [0.45, 0.6, 2, 0.4, 0.08, 1.7], mochidough: [0.6, 0.55, 3, 0.3, 0.04, 1.8],
  jellygel: [0.46, 0.65, 1.8, 0.4, 0.08, 1.5], waterfill: [0.48, 0.65, 1.8, 0.4, 0.06, 1.5], putty: [0.75, 0.55, 3, 0.3, 0.04, 1.9],
  stickystretch: [0.45, 0.6, 3.5, 0.35, 0.1, 1.6], slimegoo: [0.5, 0.7, 1.5, 0.4, 0.05, 1.4], firmsilicone: [0.42, 0.55, 2.5, 0.4, 0.08, 1.6],
  popdome: [0.42, 0.55, 2.5, 0.4, 0.08, 1.6], gummy: [0.4, 0.55, 2.5, 0.4, 0.08, 1.6], beadsqueeze: [0.55, 0.55, 3, 0.3, 0.05, 1.8],
};
/** tuning shared by every family (PROBES may set them) */
export const CRAWL = { vMin: 0.045, vFull: 0.09, tauIn: 0.25, tauOut: 0.15, tauHeld: 0.04, yawTau: 0.12, yawMax: 8, bend: 0.14, leanK: 0.5, leanMax: 0.12, airS: 0.25, gripMin: 0.35, beta: 0.35, on: true };
const NT = 256, TAU = Math.PI * 2;

/** the private PropWorld state a crawl reads (props.ts: BF = 12 floats per tracked body, [4] the eased grip multiplier) */
interface World { hNow: number; bsf: Float64Array }
/** the private SoftBody state a crawl reads and moves (as props.ts's zone physics does) */
interface Body {
  n: number; X: Float64Array; Q: Float64Array; M: Float64Array; Mtot: number; qr: Float64Array; cx: number; cz: number;
  scootOn: boolean; sV: number; stx: number; stz: number; heldF: boolean; moveOn: boolean; cyOn: boolean; carried: boolean; gravityOn: boolean; nearCount: number;
  asleep: boolean; crawlOn: boolean; crawlD: Float64Array; crawlF: Float64Array; V: Float64Array; center: { x: number; z: number }; chunk: boolean; capFlat: boolean;
}

export class Crawl {
  on = false;
  /** after a walk the body turns back to face +Z (the camera's side: as it faces at rest, today) until it does, unless something holds it */
  private turn = false;
  private ext = 0;   // (frames since the extents were measured)
  readonly d: Float64Array;
  /** the rest shape + d (centred): what the body's rotation is fitted against while the crawl is on */
  private readonly f: Float64Array;
  private readonly w: Float64Array;
  /** the rest shape's volume gradient (3 per particle: dV/dq, from the skin's triangles) and 1 / (3 V0): the wave's first-order volume change is taken back
   *  by a uniform scale of the rest shape (the foams' and the beads' volume follows the goal: an uncorrected wave breathed them 10 % in and out) */
  private readonly vg: Float64Array;
  private readonly iv3: number;
  /** the grip wave g(theta) (-1 planted .. 1 reaching) and its integral G (zero mean), interleaved: [g0, G0, g1, G1, ...] over a cycle in NT steps */
  private readonly T = new Float64Array((NT + 1) * 2);
  /** [0] phase, [1] amplitude, [2] ux, [3] uz (the wave's axis: the facing), [4] lean, [5] time in the air, [6..9] the body's extent along the axis and up (rest
   *  frame, every 8th frame: s0, s1, y0, y1) */
  readonly s = new Float64Array(10);
  private readonly pf: [number, number, number, number, number, number];
  private readonly body: SoftBody;
  constructor(body: SoftBody) {
    this.body = body;
    const b = body as unknown as Body;
    this.d = new Float64Array(b.n * 3); this.w = new Float64Array(b.n);
    this.f = Float64Array.from(b.Q);
    b.crawlD = this.d; b.crawlF = this.f; b.crawlOn = false;
    const vg = (this.vg = new Float64Array(b.n * 3)), I = body.indices, Q = b.Q;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, c = I[t + 1] * 3, e = I[t + 2] * 3;
      // dV/dqa = (qc x qe) / 6 for each triangle (a, c, e), and its turns
      vg[a] += (Q[c + 1] * Q[e + 2] - Q[c + 2] * Q[e + 1]) / 6; vg[a + 1] += (Q[c + 2] * Q[e] - Q[c] * Q[e + 2]) / 6; vg[a + 2] += (Q[c] * Q[e + 1] - Q[c + 1] * Q[e]) / 6;
      vg[c] += (Q[e + 1] * Q[a + 2] - Q[e + 2] * Q[a + 1]) / 6; vg[c + 1] += (Q[e + 2] * Q[a] - Q[e] * Q[a + 2]) / 6; vg[c + 2] += (Q[e] * Q[a + 1] - Q[e + 1] * Q[a]) / 6;
      vg[e] += (Q[a + 1] * Q[c + 2] - Q[a + 2] * Q[c + 1]) / 6; vg[e + 1] += (Q[a + 2] * Q[c] - Q[a] * Q[c + 2]) / 6; vg[e + 2] += (Q[a] * Q[c + 1] - Q[a + 1] * Q[c]) / 6;
    }
    let v3 = 0;
    for (let i = 0; i < b.n * 3; i++) v3 += vg[i] * Q[i];   // = 3 V0 (Euler: the volume is homogeneous of degree 3)
    this.iv3 = Math.abs(v3) > 1e-12 ? 1 / v3 : 0;
    this.pf = CRAWL_FAMILY[body.family] ?? CRAWL_FAMILY.jellygel;
    const k = this.pf[2], tk = Math.tanh(k), T = this.T;
    for (let i = 0; i <= NT; i++) T[i * 2] = Math.tanh(k * Math.sin((i / NT) * TAU)) / tk;
    let acc = 0, mean = 0;
    for (let i = 0; i <= NT; i++) { if (i > 0) acc += 0.5 * (T[i * 2 - 2] + T[i * 2]) * (TAU / NT); T[i * 2 + 1] = acc; if (i < NT) mean += acc / NT; }
    for (let i = 0; i <= NT; i++) T[i * 2 + 1] -= mean;
  }
  /** once a frame (props.ts beginFrame), before the body steps: w the world (its frame step hNow, and tracked body i's eased grip multiplier bsf[i x 12 + 4], 1 = the
   *  felt), calm = today's glide. (No double is passed in: doubles passed to a call that is not inlined are boxed, a HeapNumber a call; and an idle crawl returns
   *  before any arithmetic on doubles, so the call costs nothing while this method is not yet optimised: a body that does not walk calls it every frame.) */
  step(w: World, i: number, calm: boolean): void {
    const b = this.body as unknown as Body, S = this.s;
    if (b.asleep || (!this.on && !this.turn && (!b.scootOn || calm || !CRAWL.on || b.heldF))) { S[5] = 0; return; }   // (`on` mirrors s[1] > 0: an element of a Float64Array read by code not yet optimised is a HeapNumber)
    const n = b.n, dt = w.hNow, grip = w.bsf[i * 12 + 4];
    if (!(dt > 0)) return;
    const tx = b.stx - b.cx, tz = b.stz - b.cz, tl = Math.sqrt(tx * tx + tz * tz);
    const go = b.scootOn && tl > 0.03, v = go ? b.sV : 0;   // (a glide that has arrived keeps a creep of speed at its target: no crawl there)
    const free = CRAWL.on && !calm && !b.heldF && !b.moveOn && !b.cyOn && !b.carried && b.gravityOn;
    S[5] = b.nearCount > 0 ? 0 : S[5] + dt;
    const ground = S[5] < CRAWL.airS;
    // ---- FACING: a slug leads with its head. The body's front is its rest +Z (where the face is: render/wholeRef.ts); while it walks it turns toward the
    // heading (the glide's target), after the walk back to +Z (as it faces at rest), by a smooth yaw of the whole body about its centre (a move of X and V
    // like the glide: no momentum; the rotation the shape matching fits turns with it). Its front bends toward the turn first (the goal's `bend`, below).
    // A cut piece (a cut face, or the legacy eyeless chunk) does not turn: its wave runs along a facing of its own that turns the same way (the piece keeps its
    // orientation, as it does today: a half turned 90 degrees put its cut face along the wave, and its foot creased past 120 degrees once a cycle).
    const q = b.qr, real = !b.chunk && !b.capFlat;
    let qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    let fx = real ? 2 * (qx * qz + qw * qy) : S[2], fz = real ? 1 - 2 * (qx * qx + qy * qy) : S[3];   // R (0, 0, 1) on the floor: the facing
    const hx = go ? tx / tl : 0, hz = go ? tz / tl : 1;
    if (!real && fx * fx + fz * fz < 0.25) { fx = hx; fz = hz; }
    const fl = Math.sqrt(fx * fx + fz * fz);
    let e = 0, rate = 0;
    if (go && free && real) this.turn = true;
    if (fl > 0.5) {   // (upright enough to have a facing: a body on its side is not turned)
      fx /= fl; fz /= fl;
      e = Math.atan2(fx * hz - fz * hx, fx * hx + fz * hz);   // the heading's angle from the facing (+: toward the facing's left, (-fz, fx))
      if (free && ground && (go || this.turn)) {
        const mx = CRAWL.yawMax * dt, k = e * (1 - Math.exp(-dt / CRAWL.yawTau)), dl = k > mx ? mx : k < -mx ? -mx : k;
        if (!go && e < 0.03 && e > -0.03) this.turn = false;
        const c = Math.cos(dl), sn = Math.sin(dl);
        if (real && (e > 0.009 || e < -0.009)) {   // (within half a degree of its way it is not turned: a pass over the particles each frame for nothing)
          const ox = b.center.x, oz = b.center.z, X = b.X, V = b.V;
          for (let j = 0; j < n * 3; j += 3) {
            const x = X[j] - ox, z = X[j + 2] - oz, vx = V[j], vz = V[j + 2];
            X[j] = ox + x * c - z * sn; X[j + 2] = oz + x * sn + z * c; V[j] = vx * c - vz * sn; V[j + 2] = vx * sn + vz * c;
          }
          // (the fitted rotation turns by the same yaw, about -y in this sense: its next fit starts there)
          const c2 = Math.cos(0.5 * dl), s2 = Math.sin(0.5 * dl);
          const nx = c2 * qx - s2 * qz, ny = c2 * qy - s2 * qw, nz = c2 * qz + s2 * qx, nw = c2 * qw + s2 * qy;
          q[0] = nx; q[1] = ny; q[2] = nz; q[3] = nw; qx = nx; qy = ny; qz = nz; qw = nw;
        }
        const gx = fx * c - fz * sn, gz = fx * sn + fz * c;
        fx = gx; fz = gz; e -= dl; rate = dl / dt;
      } else if (!free) this.turn = false;   // (a hand took it: it stays as it is left)
    } else if (!go) this.turn = false;
    // (no crawl under vMin: LIFE's contact approach, the last centimetres at 0.04 m/s, glides as before; full from vFull; and none while it still faces
    // more than about 50 degrees away from its way, full within 18: it turns first)
    const u0 = (v - CRAWL.vMin) / (CRAWL.vFull - CRAWL.vMin), ce = (Math.cos(e) - 0.6) / 0.35, al = fl > 0.5 ? (ce >= 1 ? 1 : ce <= 0 ? 0 : ce * ce * (3 - 2 * ce)) : 1;
    const want = free && ground && u0 > 0 ? (u0 >= 1 ? 1 : u0 * u0 * (3 - 2 * u0)) * al : 0;
    let a = S[1];
    const fresh = a === 0;
    a += (want - a) * (1 - Math.exp(-dt / (!free ? CRAWL.tauHeld : want > a ? CRAWL.tauIn : CRAWL.tauOut)));
    if (want === 0 && a < (free ? 0.03 : 0.08)) a = 0;   // (the last few per cent of the wave are millimetres: let go)
    S[1] = a;
    if (a === 0) { if (this.on) { this.on = false; b.crawlOn = false; this.d.fill(0); S[4] = 0; } return; }
    this.on = true; b.crawlOn = true;
    if (fresh) S[0] = 0;
    // ---- the wave's axis: the facing (the face end is the front that stretches and plants); the lean follows the yaw rate while it crawls (x a: the turn on the spot
    // at the start of a walk does not lean: leaning there rolled the body and drifted it 20 degrees off its way)
    const ux = fl > 0.5 ? fx : hx, uz = fl > 0.5 ? fz : hz;
    S[2] = ux; S[3] = uz;
    const lw = CRAWL.leanK * rate * v * a, lt = lw > CRAWL.leanMax ? CRAWL.leanMax : lw < -CRAWL.leanMax ? -CRAWL.leanMax : lw;
    S[4] += (lt - S[4]) * (1 - Math.exp(-dt / 0.2));
    const bend = CRAWL.bend * (e > 1 ? 1 : e < -1 ? -1 : e);   // (the front swings toward the heading first: x the remaining yaw, saturating at a radian)
    // ---- the rest frame (the body's rotation from the last substep): travel u, up and lateral (u x up) in rest coordinates
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const sux = r00 * ux + r20 * uz, suy = r01 * ux + r21 * uz, suz = r02 * ux + r22 * uz;     // R^T (ux, 0, uz)
    const yx = r10, yy = r11, yz = r12;                                                       // R^T (0, 1, 0)
    const lx = -r00 * uz + r20 * ux, ly = -r01 * uz + r21 * ux, lz = -r02 * uz + r22 * ux;   // R^T (-uz, 0, ux)
    const Q = b.Q, M = b.M, X = b.X, D = this.d, W = this.w, T = this.T;
    if (fresh || (++this.ext & 7) === 0) {   // (the body's extents along the axis and up: on the first frame and every 8th (they move only as it turns or bends))
      let s0 = 1e9, s1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n * 3; i += 3) {
        const s = Q[i] * sux + Q[i + 1] * suy + Q[i + 2] * suz, y = Q[i] * yx + Q[i + 1] * yy + Q[i + 2] * yz;
        if (s < s0) s0 = s; if (s > s1) s1 = s; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      S[6] = s0; S[7] = s1; S[8] = y0; S[9] = y1;
    }
    const sh = 0.5 * (S[7] - S[6]) > 1e-4 ? 0.5 * (S[7] - S[6]) : 1e-4, sm = 0.5 * (S[6] + S[7]), y0 = S[8], ht = S[9] - y0 > 1e-4 ? S[9] - y0 : 1e-4;
    const pf = this.pf, stride = pf[0] * sh, kap = pf[1] * Math.PI, bul = pf[3];
    const gr = grip >= 1 ? 1 : grip <= 0 ? CRAWL.gripMin : CRAWL.gripMin + (1 - CRAWL.gripMin) * grip;
    // ---- the phase: one cycle per stride of glide (frozen in the air: nothing is planted there)
    const ds = ground ? v * dt : 0;
    let th = S[0] + (TAU * ds) / stride;
    if (th > TAU) th -= TAU;
    S[0] = th;
    const amp = a * gr, aD = (amp * stride) / TAU, aE = (aD * kap) / sh;   // axial offset per unit of G; strain per unit of g
    const ti = NT / TAU, ish = 1 / sh, iht = 1 / ht, lift = a * pf[4] * sh, lean = S[4], pB = kap * ish * ti, pA = th * ti - pB * sm, bl = 1 - bul;
    // (the hump: the middle rises while the body is short, the inchworm's arch, and flattens while it reaches)
    const lenRel = (tab(T, (th + kap) * ti, 1) - tab(T, (th - kap) * ti, 1)) * aD * 0.5 * ish, hump = -pf[5] * lenRel;
    const VG = this.vg;
    let mx = 0, my = 0, mz = 0, wm = 0, dv = 0;
    for (let i = 0, j = 0; i < n * 3; i += 3, j++) {
      const qx_ = Q[i], qy_ = Q[i + 1], qz_ = Q[i + 2];
      const sr = qx_ * sux + qy_ * suy + qz_ * suz, yw = qx_ * yx + qy_ * yy + qz_ * yz, la = qx_ * lx + qy_ * ly + qz_ * lz;
      const sg = (sr - sm) * ish, yr = yw - y0;
      // (the wave tables at this particle's phase (th + kappa sg) in table steps, wrapped into one cycle: th is in [0, 2 pi) and kappa under pi)
      const p0 = pA + pB * sr, p = p0 < 0 ? p0 + NT : p0 >= NT ? p0 - NT : p0, k0 = p | 0, fk = p - k0, t2 = k0 * 2;
      const gi = T[t2] + (T[t2 + 2] - T[t2]) * fk, ax = aD * (T[t2 + 1] + (T[t2 + 3] - T[t2 + 1]) * fk), ep = aE * gi;
      let dy = (hump * (1 - sg * sg) - ep * bul) * yr;
      if (sg > 0.2 && gi > 0) { const fr = (sg - 0.2) * 1.25, hh = yr * iht; dy += lift * fr * fr * gi * hh * hh; }   // (the head lift: the front's upper part, while it reaches)
      const dl = lean * yr - ep * bl * la + (sg > 0 ? bend * sg * sg * sh : 0);
      const ox = ax * sux + dy * yx + dl * lx, oy = ax * suy + dy * yy + dl * ly, oz = ax * suz + dy * yz + dl * lz;
      D[i] = ox; D[i + 1] = oy; D[i + 2] = oz;
      dv += VG[i] * ox + VG[i + 1] * oy + VG[i + 2] * oz;
      const m = M[j], wi = amp * gi;
      mx += m * ox; my += m * oy; mz += m * oz;
      W[j] = wi; wm += m * wi;
    }
    const iM = 1 / b.Mtot;
    mx *= iM; my *= iM; mz *= iM; wm *= iM;
    // ---- the goal's wave about the centre (mean 0), and the grip: this frame's share of the wave, moved like the glide (before the substeps: friction never sees it)
    const ex = ux * ds, ez = uz * ds, wb = CRAWL.beta * wm;
    const vs = -dv * this.iv3;   // (the uniform scale that gives the wave's volume change back; the scaled rest shape has mean 0)
    const F = this.f;
    for (let i = 0, j = 0; i < n * 3; i += 3, j++) {
      D[i] += vs * Q[i] - mx; D[i + 1] += vs * Q[i + 1] - my; D[i + 2] += vs * Q[i + 2] - mz;
      F[i] = Q[i] + D[i]; F[i + 1] = Q[i + 1] + D[i + 1]; F[i + 2] = Q[i + 2] + D[i + 2];
      const k = W[j] - wb; X[i] += k * ex; X[i + 2] += k * ez;
    }
    b.cx += (wm - wb) * ex; b.cz += (wm - wb) * ez;
  }
}
/** table T at p (cycle steps, any real), column c (0 g, 1 G) */
function tab(T: Float64Array, p: number, c: number): number {
  let x = p % NT;
  if (x < 0) x += NT;
  const i = x | 0, f = x - i, o = i * 2 + c;
  return T[o] + (T[o + 2] - T[o]) * f;
}
