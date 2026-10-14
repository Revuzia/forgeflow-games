// GENESIS — lightning (CONTRACT.md §15.7 "lightning bolts (branching, with flash light)").
//
// A strike is a jagged channel from inside the cloud deck down to the ground, built by midpoint displacement (128
// segments), with forks that leave it at random points and wander down, tapering to nothing at their tips. It lives
// most of a second: a leader growing down (40 ms), the return stroke at full brightness, then two or three re-strikes
// flickering down the same channel, then a faint afterglow. Every channel is a camera-facing ribbon — a white-hot core,
// a violet inner glow and a wide blue bloom halo — built on the CPU each frame a bolt is alive (a few hundred quads).
// The channel's top fades out where it enters the cloud (it comes OUT of the deck rather than hanging below it). The
// light it gives is not a sprite: GodFx lights the cloud from inside (sky/clouds.ts `flashes`, in the cloud's own
// shape), the ground and everything standing there (an FX light decal) and, briefly and near, the whole view.

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01 } from './fxcommon.ts';

const VERT = /* glsl */ `
attribute float aK;
attribute float aSide;
varying float vK;
varying float vSide;
varying float vZ;
void main() {
  vK = aK; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
varying float vK;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 1.0);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a white-hot core, a violet inner glow, a wide blue bloom halo
  float core = exp(-x * x * 90.0);
  float glow = exp(-x * x * 14.0);
  float halo = exp(-x * x * 2.6) * (1.0 - smoothstep(0.8, 1.0, x));
  vec3 c = vec3(0.95, 0.94, 1.0) * core * 110.0 + vec3(0.7, 0.68, 1.0) * glow * 9.0 + vec3(0.42, 0.52, 1.0) * halo * 1.3;
  gl_FragColor = vec4(c * vK * vis * fxDisplay(0.15), 0.0);
}
`;

interface Channel { pts: Vector3[]; w: number; k: number; taper: number }
interface Bolt { ch: Channel[]; t0: number; strokes: number[]; ground: Vector3; top: Vector3; power: number; grown: number; fadeTop: boolean; rG: number; rT: number }

const MAX_Q = 6000;
/** at most this many bolts alive at once (the oldest gives way) */
const MAX_BOLTS = 12;

export class Lightning {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private pos = new Float32Array(MAX_Q * 4 * 3);
  private k = new Float32Array(MAX_Q * 4);
  private side = new Float32Array(MAX_Q * 4);
  /** per-point ribbon sides of the channel being built (reused) */
  private sideBuf: Vector3[] = [];
  private bolts: Bolt[] = [];

  constructor(fx: Record<string, IUniform>) {
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aK', new BufferAttribute(this.k, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(this.side, 1));
    const idx = new Uint32Array(MAX_Q * 6);
    for (let q = 0; q < MAX_Q; q++) { const b = q * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6); }
    this.geo.setIndex(new BufferAttribute(idx, 1));
    this.mesh = new Mesh(this.geo, new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...fx }, transparent: true, depthTest: false, depthWrite: false,
      ...ADD_LIGHT, side: DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 12;
  }

  /**
   * a strike from `top` (body m, inside the cloud) to `ground` at FX time t. `fadeTop`: the channel fades out over its
   * top fifth (it comes out of a cloud deck); a bolt inside an ash plume or a funnel's wall cloud keeps its whole length
   */
  strike(top: Vector3, ground: Vector3, t: number, power = 1, branches = 6, fadeTop = true): void {
    const len = top.distanceTo(ground);
    const main = jag(top, ground, len * 0.16, 7);
    const ch: Channel[] = [{ pts: main, w: Math.max(0.6, len * 0.0035) * (0.7 + 0.3 * power), k: 1, taper: 0.25 }];
    const down = _d.copy(ground).sub(top).normalize().clone();
    for (let b = 0; b < branches; b++) {
      const i = 6 + Math.floor(Math.random() * (main.length * 0.65));
      const from = main[i];
      const lat = _l.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      lat.addScaledVector(down, -lat.dot(down)).normalize();
      const bl = len * (0.1 + 0.25 * Math.random()) * (1 - i / main.length);
      const to = from.clone().addScaledVector(down, bl * 0.75).addScaledVector(lat, bl * 0.6);
      const pts = jag(from, to, bl * 0.14, 5);
      ch.push({ pts, w: ch[0].w * 0.5, k: 0.35 + 0.3 * Math.random(), taper: 0.9 });
      // a fork off the fork
      if (Math.random() < 0.5) {
        const j = 2 + Math.floor(Math.random() * (pts.length - 3));
        const to2 = pts[j].clone().addScaledVector(down, bl * 0.35).addScaledVector(lat.clone().negate().add(_tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5)).normalize(), bl * 0.3);
        ch.push({ pts: jag(pts[j], to2, bl * 0.1, 4), w: ch[0].w * 0.28, k: 0.25, taper: 0.95 });
      }
    }
    // the return stroke, then two or three re-strikes down the same channel
    const n = 2 + Math.floor(Math.random() * 2);
    const strokes = [0];
    for (let s = 0; s < n; s++) strokes.push(0.07 + s * 0.075 + Math.random() * 0.05);
    this.bolts.push({ ch, t0: t, strokes, ground: ground.clone(), top: top.clone(), power, grown: 0, fadeTop, rG: ground.length(), rT: top.length() });
    if (this.bolts.length > MAX_BOLTS) this.bolts.shift();
  }

  /** the brightness of live bolts at time t (for the lights they throw), with their ground and top points */
  forEachLive(t: number, f: (ground: Vector3, top: Vector3, k: number, power: number) => void): void {
    for (const b of this.bolts) { const k = brightness(b, t); if (k > 0.01) f(b.ground, b.top, k, b.power); }
  }

  /** how many bolts are alive */
  get live(): number { return this.bolts.length; }

  /**
   * rebuild the ribbons for this frame (camera at camB, body frame); `ease` is the frame's real-or-FX step: the leader
   * grows by it, so a bolt struck on a paused world (its FX clock frozen at the stroke) still reaches the ground
   */
  update(t: number, camB: Vector3, ease = 0): void {
    this.bolts = this.bolts.filter((b) => t - b.t0 < 0.9);
    for (const b of this.bolts) b.grown = Math.max(b.grown + ease, t - b.t0);
    let q = 0;
    for (const b of this.bolts) {
      const kb = brightness(b, t);
      if (kb <= 0.005) continue;
      const span = Math.max(1, b.rT - b.rG);
      for (const c of b.ch) {
        const pts = c.pts;
        // the leader grows down first (the first 40 ms)
        const grow = clamp01(b.grown / 0.04);
        const nShow = Math.max(2, Math.floor(pts.length * grow));
        const last = pts.length - 1;
        // the ribbon's side at each point, shared by the two segments that meet there (joined, not butted: separate
        // quads left a dark notch on the outside of every kink and a bright overlap inside it — a hairy halo)
        const sides = this.sideBuf;
        for (let i = 0; i < nShow; i++) {
          const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(nShow - 1, i + 1)];
          _d.copy(p1).sub(p0);
          _l.copy(camB).sub(pts[i]);
          const sv = sides[i] ?? (sides[i] = new Vector3());
          sv.crossVectors(_d, _l);
          const sl = sv.length();
          if (sl > 1e-9) sv.multiplyScalar(1 / sl); else sv.set(0, 0, 0);
        }
        for (let i = 0; i < nShow - 1 && q < MAX_Q; i++, q++) {
          const a = pts[i], e = pts[i + 1];
          // ribbon width: a little wider far away so a distant bolt still reads (at least ~1.5 px at 1 km); tapering
          // toward the channel's end (a fork thins to nothing)
          const da = _l.copy(camB).sub(a).length(), de = _tmp.copy(camB).sub(e).length();
          const wa = Math.max(c.w, da * 0.0011) * (1 - c.taper * (i / last));
          const we = Math.max(c.w, de * 0.0011) * (1 - c.taper * ((i + 1) / last));
          // brightness: the channel fades out where it enters the cloud above
          const ka = kb * c.k * (b.fadeTop ? 1 - smooth01(0.78, 0.98, (a.length() - b.rG) / span) : 1);
          const ke = kb * c.k * (b.fadeTop ? 1 - smooth01(0.78, 0.98, (e.length() - b.rG) / span) : 1);
          const sA = sides[i], sE = sides[i + 1];
          const sa = wa * 6, se = we * 6;
          const o = q * 12;
          this.pos[o] = a.x + sA.x * sa; this.pos[o + 1] = a.y + sA.y * sa; this.pos[o + 2] = a.z + sA.z * sa;
          this.pos[o + 3] = a.x - sA.x * sa; this.pos[o + 4] = a.y - sA.y * sa; this.pos[o + 5] = a.z - sA.z * sa;
          this.pos[o + 6] = e.x + sE.x * se; this.pos[o + 7] = e.y + sE.y * se; this.pos[o + 8] = e.z + sE.z * se;
          this.pos[o + 9] = e.x - sE.x * se; this.pos[o + 10] = e.y - sE.y * se; this.pos[o + 11] = e.z - sE.z * se;
          this.k[q * 4] = ka; this.k[q * 4 + 1] = ka; this.k[q * 4 + 2] = ke; this.k[q * 4 + 3] = ke;
          this.side[q * 4] = 1; this.side[q * 4 + 1] = -1; this.side[q * 4 + 2] = 1; this.side[q * 4 + 3] = -1;
        }
      }
    }
    this.geo.setDrawRange(0, q * 6);
    this.mesh.visible = q > 0;
    if (q > 0) {
      for (const n of ['position', 'aK', 'aSide']) { const a = this.geo.getAttribute(n) as BufferAttribute; a.clearUpdateRanges(); a.addUpdateRange(0, q * 4 * a.itemSize); a.needsUpdate = true; }
    }
  }

  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

/** a bolt's brightness at time t: the strokes flash and decay; an afterglow */
export function brightness(b: { t0: number; strokes: number[]; power: number }, t: number): number {
  const dt = t - b.t0;
  let k = 0;
  for (const s of b.strokes) {
    const x = dt - s;
    if (x < 0) continue;
    k = Math.max(k, Math.exp(-x * 28) * (s === 0 ? 1 : 0.8));
  }
  return Math.min(1.2, k + Math.max(0, 0.15 * (1 - dt / 0.9))) * b.power;
}

function smooth01(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const _d = new Vector3(), _l = new Vector3(), _tmp = new Vector3();

/** a jagged polyline from a to b by midpoint displacement (2^depth segments), displacement `amp` (m) halving */
function jag(a: Vector3, b: Vector3, amp: number, depth: number): Vector3[] {
  let pts = [a.clone(), b.clone()];
  let s = amp;
  for (let d = 0; d < depth; d++) {
    const next: Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const m = p.clone().add(q).multiplyScalar(0.5);
      const dir = _d.copy(q).sub(p);
      const r = _l.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      r.addScaledVector(dir, -r.dot(dir) / Math.max(1e-9, dir.lengthSq()));
      m.addScaledVector(r.normalize(), (Math.random() * 2 - 1) * s);
      next.push(m, q);
    }
    pts = next;
    s *= 0.55;
  }
  return pts;
}
