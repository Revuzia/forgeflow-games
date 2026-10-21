// VALE render — screen-level VFX state shared by the VFX system, the director and the post chain:
//
//   exposure  the ultimate impact envelope (M13): a local, eased light lift centred on the impact,
//             applied by post.ts as a multiply BEFORE tone mapping (so it shapes HDR light, never the
//             overlay). Default shape (tokens: T4 "never full-screen white"):
//               dip    ×0.92 for 66 ms over the whole frame (the held breath before the light)
//               peak   one beat (≈ 2 frames) at `peak` × scene light inside the area radius, saturation
//                      dropping toward the stopped-sun white
//               hold   ≥ 1.4× for `hold` s (default 0.28)
//               fade   exponential, half-life `fade` s (default 0.12), until it is below 1 %
//             The lift falls off smoothly outside 0.55–1.35 × the area radius; a small share (8 %) breathes
//             the rest of the frame. Up to 4 envelopes overlap (the most recent win). reduceMotion halves
//             the peak and drops the dip.
//   grade     the dead player's world: saturation → 0 and value × 0.85 over 400 ms (eased), back over
//             300 ms on respawn; reduceMotion cuts in 120 ms. Applied by post.ts after the LUT and before
//             the overlay, so bars, rings and telegraphs keep their colour.
//   distort   the heat-haze / lensing offset map the VFX system renders (distort layers, T3/T4 only, off
//             on Low): post.ts offsets the HDR lookup by it (≤ 0.015 UV).
//
// Presentation only: nothing here reads or changes the sim.

import { type Camera, type Texture, Uniform, Vector3, Vector4 } from 'three';

export const MAX_LIFTS = 4;

/** uniforms shared by reference with the post chain's effects (post.ts) */
export const screenUniforms = {
  /** per envelope: centre uv.x, uv.y, radius (fraction of screen height), lift (× − 1) */
  uLiftA: new Uniform(Array.from({ length: MAX_LIFTS }, () => new Vector4())),
  /** per envelope: saturation drop (0..1), −, −, − */
  uLiftB: new Uniform(Array.from({ length: MAX_LIFTS }, () => new Vector4())),
  /** global exposure multiplier (the dip) */
  uExpo: new Uniform(1),
  /** share of each envelope's lift that reaches the whole frame */
  uBreath: new Uniform(0),
  uAspect: new Uniform(16 / 9),
  /** the grade: saturation and value multipliers (1 = untouched) */
  uSat: new Uniform(1),
  uVal: new Uniform(1),
  /** distort offset map (rg = uv offset) and whether it holds anything this frame */
  uDistort: new Uniform<Texture | null>(null),
  uDistortOn: new Uniform(0),
};

export interface PulseOpts {
  /** peak lift (× scene light inside the radius) */
  peak?: number;
  hold?: number;
  /** fade half-life (s) */
  fade?: number;
  dip?: number;
  desat?: number;
  /** start after this many seconds */
  delay?: number;
}

interface Pulse { pos: Vector3; radius: number; t: number; peak: number; hold: number; half: number; dip: number; desat: number }

const DIP_S = 0.066;
const PEAK_S = 0.05;
const SETTLE_S = 0.06;
const HOLD_LEVEL = 1.45;
const _a = new Vector3();
const _b = new Vector3();
const _r = new Vector3();

/** the envelope at time t (s since the pulse fired): lift (× − 1), global multiplier, saturation drop */
export function envelope(p: { peak: number; hold: number; half: number; dip: number; desat: number }, t: number, out: { lift: number; global: number; desat: number }): boolean {
  out.lift = 0; out.global = 1; out.desat = 0;
  if (t < 0) return true;
  const hold = Math.min(p.peak, HOLD_LEVEL) - 1;
  const peak = p.peak - 1;
  if (t < DIP_S) { out.global = p.dip; return true; }
  let u = t - DIP_S;
  if (u < PEAK_S) { out.lift = peak; out.desat = p.desat; return true; }
  u -= PEAK_S;
  if (u < SETTLE_S) {
    const k = u / SETTLE_S, e = k * k * (3 - 2 * k);
    out.lift = peak + (hold - peak) * e;
    out.desat = p.desat * (1 - e);
    return true;
  }
  u -= SETTLE_S;
  if (u < p.hold) { out.lift = hold; return true; }
  u -= p.hold;
  out.lift = hold * Math.pow(0.5, u / Math.max(0.03, p.half));
  return out.lift > 0.01;
}

export class ScreenFx {
  reduceMotion = false;
  /** the post chain's quality gate for distort layers (off on Low) */
  distortAllowed = true;
  private readonly pulses: Pulse[] = [];
  private dead = false;
  private grade = 0;
  private readonly env = { lift: 0, global: 1, desat: 0 };

  /** start an exposure envelope at a world point; radius in metres */
  pulse(pos: Vector3, radius: number, o: PulseOpts = {}): void {
    const peak = Math.max(1, o.peak ?? 2.4);
    const p: Pulse = {
      pos: pos.clone(), radius: Math.max(0.5, radius), t: -(o.delay ?? 0),
      peak: this.reduceMotion ? 1 + (peak - 1) * 0.5 : peak, hold: o.hold ?? 0.28, half: o.fade ?? 0.12,
      dip: this.reduceMotion ? 1 : (o.dip ?? 0.92), desat: o.desat ?? 0.35,
    };
    this.pulses.push(p);
    if (this.pulses.length > MAX_LIFTS) this.pulses.shift();
  }

  /** the local player is dead (the grade eases toward grey) */
  setDead(dead: boolean): void { this.dead = dead; }

  get active(): number { return this.pulses.length; }

  update(dt: number, cam: Camera | null, aspect: number): void {
    const U = screenUniforms;
    U.uAspect.value = aspect;
    // the grade
    const target = this.dead ? 1 : 0;
    const rate = this.reduceMotion ? 1 / 0.12 : this.dead ? 1 / 0.4 : 1 / 0.3;
    this.grade = target > this.grade ? Math.min(target, this.grade + dt * rate) : Math.max(target, this.grade - dt * rate);
    const g = this.grade * this.grade * (3 - 2 * this.grade);
    U.uSat.value = 1 - g;
    U.uVal.value = 1 - 0.15 * g;
    // exposure envelopes
    let global = 1, breath = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      if (!envelope(p, p.t, this.env)) this.pulses.splice(i, 1);
    }
    for (let i = 0; i < MAX_LIFTS; i++) {
      const a = U.uLiftA.value[i], b = U.uLiftB.value[i];
      const p = this.pulses[i];
      if (!p || !cam) { a.set(0, 0, 0, 0); b.set(0, 0, 0, 0); continue; }
      envelope(p, p.t, this.env);
      global *= this.env.global;
      // screen centre and radius (height-normalised) of the area
      _a.copy(p.pos).project(cam);
      _r.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(p.radius);
      _b.copy(p.pos).add(_r).project(cam);
      const behind = _a.z > 1 || _a.z < -1;
      const ux = _a.x * 0.5 + 0.5, uy = _a.y * 0.5 + 0.5;
      const rr = Math.hypot((_b.x - _a.x) * 0.5 * aspect, (_b.y - _a.y) * 0.5);
      a.set(ux, uy, Math.max(0.02, rr), behind ? 0 : this.env.lift);
      b.set(this.env.desat, 0, 0, 0);
      breath = Math.max(breath, this.env.lift);
    }
    U.uExpo.value = global;
    U.uBreath.value = breath > 0 ? 0.08 : 0;
  }

  reset(): void {
    this.pulses.length = 0;
    this.dead = false;
    this.grade = 0;
    const U = screenUniforms;
    for (const v of U.uLiftA.value) v.set(0, 0, 0, 0);
    for (const v of U.uLiftB.value) v.set(0, 0, 0, 0);
    U.uExpo.value = 1; U.uBreath.value = 0; U.uSat.value = 1; U.uVal.value = 1; U.uDistortOn.value = 0;
  }
}

/** one per page: the renderer has one post chain */
export const screenFx = new ScreenFx();
