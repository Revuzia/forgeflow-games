// GENESIS — lightning (CONTRACT.md §15.7 "lightning bolts (branching, with flash light)").
//
// A strike is a jagged channel from the cloud base to the ground, built by midpoint displacement (128 segments), with
// forks that leave it at random points and wander down, shorter and fainter. It lives a third of a second: a leader,
// the return stroke at full brightness, then one to three re-strikes flickering down the same channel, then an
// afterglow. Every channel is a camera-facing ribbon (a white-violet core in a wide blue halo) built on the CPU each
// frame a bolt is alive (a few hundred quads). Each strike also lights the ground and everything standing there (an FX
// light), lights its cloud from inside (a flash), and is heard (the sim's lightning event; bolts the renderer adds on
// its own — in thunderstorm cells, in an ash plume, over a glass storm — post a thunder event for the audio).

import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { FX_DEPTH_GLSL, FX_LAYER, clamp01 } from './fxcommon.ts';

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
  float core = exp(-x * x * 60.0);
  float halo = exp(-x * x * 5.0);
  vec3 c = vec3(0.92, 0.9, 1.0) * core * 90.0 + vec3(0.45, 0.55, 1.0) * halo * 6.0;
  gl_FragColor = vec4(c * vK * vis * fxDisplay(0.15), 0.0);
}
`;

interface Channel { pts: Vector3[]; w: number; k: number }
interface Bolt { ch: Channel[]; t0: number; strokes: number[]; ground: Vector3; top: Vector3; power: number }

const MAX_Q = 6000;

export class Lightning {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private pos = new Float32Array(MAX_Q * 4 * 3);
  private k = new Float32Array(MAX_Q * 4);
  private side = new Float32Array(MAX_Q * 4);
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
      blending: AdditiveBlending, side: DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 12;
  }

  /** a strike from `top` (body m, in the cloud) to `ground` at FX time t; returns the stroke times */
  strike(top: Vector3, ground: Vector3, t: number, power = 1, branches = 6): void {
    const len = top.distanceTo(ground);
    const main = jag(top, ground, len * 0.11, 7);
    const ch: Channel[] = [{ pts: main, w: Math.max(0.6, len * 0.004) * (0.7 + 0.3 * power), k: 1 }];
    for (let b = 0; b < branches; b++) {
      const i = 4 + Math.floor(Math.random() * (main.length * 0.7));
      const from = main[i];
      const down = _d.copy(ground).sub(top).normalize();
      const lat = _l.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).sub(_tmp.copy(down).multiplyScalar(0)).normalize();
      const bl = len * (0.12 + 0.25 * Math.random()) * (1 - i / main.length);
      const to = from.clone().addScaledVector(down, bl * 0.75).addScaledVector(lat, bl * 0.6);
      const pts = jag(from, to, bl * 0.14, 5);
      ch.push({ pts, w: ch[0].w * 0.45, k: 0.35 + 0.3 * Math.random() });
      // a fork off the fork
      if (Math.random() < 0.5) {
        const j = 2 + Math.floor(Math.random() * (pts.length - 3));
        const to2 = pts[j].clone().addScaledVector(down, bl * 0.35).addScaledVector(lat.clone().negate().add(_tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5)).normalize(), bl * 0.3);
        ch.push({ pts: jag(pts[j], to2, bl * 0.1, 4), w: ch[0].w * 0.25, k: 0.25 });
      }
    }
    const n = 1 + Math.floor(Math.random() * 3);
    const strokes = [0];
    for (let s = 0; s < n; s++) strokes.push(0.06 + s * 0.07 + Math.random() * 0.04);
    this.bolts.push({ ch, t0: t, strokes, ground: ground.clone(), top: top.clone(), power });
    if (this.bolts.length > 24) this.bolts.shift();
  }

  /** the brightness of live bolts at time t (for the flash lights), with their ground points */
  forEachLive(t: number, f: (ground: Vector3, top: Vector3, k: number, power: number) => void): void {
    for (const b of this.bolts) { const k = brightness(b, t); if (k > 0.01) f(b.ground, b.top, k, b.power); }
  }

  /** rebuild the ribbons for this frame (camera at camB, body frame) */
  update(t: number, camB: Vector3): void {
    this.bolts = this.bolts.filter((b) => t - b.t0 < 0.9);
    let q = 0;
    for (const b of this.bolts) {
      const kb = brightness(b, t);
      if (kb <= 0.005) continue;
      for (const c of b.ch) {
        const pts = c.pts;
        // the leader grows down first (the first 40 ms)
        const grow = clamp01((t - b.t0) / 0.04);
        const nShow = Math.max(2, Math.floor(pts.length * grow));
        for (let i = 0; i < nShow - 1 && q < MAX_Q; i++, q++) {
          const a = pts[i], e = pts[i + 1];
          const dir = _d.copy(e).sub(a);
          const view = _l.copy(camB).sub(a);
          const sd = _tmp.crossVectors(dir, view);
          const sl = sd.length() || 1;
          // ribbon width: a little wider far away so a distant bolt still reads (at least ~1.5 px at 1 km)
          const dist = view.length();
          const w = Math.max(c.w, dist * 0.0012) * (1 + 6 * (1 - c.k) * 0);
          sd.multiplyScalar((w * 6) / sl);
          const o = q * 12;
          this.pos[o] = a.x + sd.x; this.pos[o + 1] = a.y + sd.y; this.pos[o + 2] = a.z + sd.z;
          this.pos[o + 3] = a.x - sd.x; this.pos[o + 4] = a.y - sd.y; this.pos[o + 5] = a.z - sd.z;
          this.pos[o + 6] = e.x + sd.x; this.pos[o + 7] = e.y + sd.y; this.pos[o + 8] = e.z + sd.z;
          this.pos[o + 9] = e.x - sd.x; this.pos[o + 10] = e.y - sd.y; this.pos[o + 11] = e.z - sd.z;
          const kk = kb * c.k;
          this.k[q * 4] = kk; this.k[q * 4 + 1] = kk; this.k[q * 4 + 2] = kk; this.k[q * 4 + 3] = kk;
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
function brightness(b: Bolt, t: number): number {
  const dt = t - b.t0;
  let k = 0;
  for (const s of b.strokes) {
    const x = dt - s;
    if (x < 0) continue;
    k = Math.max(k, Math.exp(-x * 28) * (s === 0 ? 1 : 0.8));
  }
  return Math.min(1.2, k + Math.max(0, 0.15 * (1 - dt / 0.9))) * b.power;
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
