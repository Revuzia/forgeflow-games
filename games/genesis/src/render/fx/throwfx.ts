// GENESIS — what the Touch hurls, made readable (CONTRACT.md §11.4, §15.7; the art review: "a thrown rock in flight
// could not be captured"). The flights themselves are flown by render/fx/flights.ts (the sim integrates a whole minute
// of flight in one tick, so the renderer flies each throw in FX time); this adds, for every flight in the air:
//   * its presentation size (render/fx/present.ts): drawn at least 0.35 × the Touch that threw it, never under ~12 px,
//     easing back to its true size over the last third of the flight so the landing matches the sim's crater;
//   * a bright streak of displaced air behind it (a camera-facing ribbon over the last half second of its path, a few
//     pixels wide at any distance), in the god's light;
//   * the ground ring where it will come down (the arc integrated ahead under the planet's gravity), converging as it
//     falls, so the eye knows where to look.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { groundHeight } from '../../sim/grid/surface.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fxcommon.ts';
import { DECAL, decal, type DecalPass } from './decals.ts';
import { FLIGHT_MIN_PX, flightDrawSize, sizeForPixels, touchSize } from './present.ts';

const STREAK_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const STREAK_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uCol;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 1.0);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // hot at the head, a long fading tail: a white core in a coloured halo
  float core = exp(-x * x * 10.0), halo = exp(-x * x * 2.2) * (1.0 - smoothstep(0.85, 1.0, x));
  float along = pow(1.0 - vT, 1.8);
  vec3 c = mix(uCol, vec3(1.0), 0.55 * core) * (core * 0.9 + halo * 0.35) * along;
  gl_FragColor = vec4(c * vis * fxDisplay(0.75), 0.0);
}
`;

const SAMPLES = 40;
const MAX_FLIGHTS = 8;

interface Track {
  id: number;
  /** where it is now, how fast, how long it has flown (FX s): the streak is its own path traced back from here */
  p: Vector3;
  v: Vector3;
  age: number;
  /** the predicted landing point (body m), the predicted flight time (s), the Touch's size at release (m) */
  land: Vector3;
  T: number;
  touch: number;
  /** FX time of the last prediction */
  predAt: number;
  seen: boolean;
  slot: number;
}

/** the minimal view of render/fx/flights.ts this needs (its additive hook) */
export interface FlightSource {
  forEach(f: (id: number, kind: string, p: Vector3, v: Vector3, age: number) => void, now: number): void;
  sizeOf: ((kind: string, trueSize: number, age: number, p: Vector3, v: Vector3, id: number) => number) | null;
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();

export class ThrowFx {
  readonly group: Mesh;
  private geo = new BufferGeometry();
  private tracks = new Map<number, Track>();
  private freeSlots: number[] = [];
  private readonly col = new Color(1, 0.88, 0.62);
  private camB = new Vector3();
  private fov = 55;
  private viewH = 720;
  private pv: PlanetView | null = null;
  private now = 0;
  private readonly path: Vector3[] = Array.from({ length: SAMPLES }, () => new Vector3());

  constructor(fx: Record<string, IUniform>) {
    const n = MAX_FLIGHTS * SAMPLES * 2;
    const t = new Float32Array(n), side = new Float32Array(n);
    const idx: number[] = [];
    for (let s = 0; s < MAX_FLIGHTS; s++) for (let i = 0; i < SAMPLES; i++) {
      const k = (s * SAMPLES + i) * 2;
      t[k] = t[k + 1] = i / (SAMPLES - 1); side[k] = 1; side[k + 1] = -1;
      if (i < SAMPLES - 1) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('aT', new BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    this.group = new Mesh(this.geo, new ShaderMaterial({
      vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, uniforms: { ...fx, uCol: { value: this.col } },
      transparent: true, depthTest: false, depthWrite: false, side: DoubleSide, ...ADD_LIGHT,
    }));
    this.group.name = 'throws';
    this.group.frustumCulled = false;
    this.group.matrixAutoUpdate = false;
    this.group.layers.set(FX_LAYER);
    this.group.renderOrder = 19;
    for (let s = MAX_FLIGHTS - 1; s >= 0; s--) this.freeSlots.push(s);
  }

  /**
   * Hook the flights (their drawn size goes through `present.ts`) and draw this frame's streaks and landing rings.
   * `col` is the Touch's light colour (its regard).
   */
  update(src: FlightSource, pv: PlanetView, now: number, camB: Vector3, fov: number, viewH: number, decals: DecalPass, col: Color): void {
    this.pv = pv; this.now = now; this.camB.copy(camB); this.fov = fov; this.viewH = viewH;
    this.col.copy(col);
    if (!src.sizeOf) src.sizeOf = (kind, trueSize, age, p, _v, id) => this.sizeOf(kind, trueSize, age, p, id);
    for (const tr of this.tracks.values()) tr.seen = false;
    src.forEach((id, kind, p, v, age) => {
      let tr = this.tracks.get(id);
      if (!tr) {
        const slot = this.freeSlots.pop();
        if (slot === undefined) return;
        tr = { id, p: new Vector3(), v: new Vector3(), age: 0, land: new Vector3(), T: 1, touch: touchSize(p.distanceTo(camB)), predAt: -1e9, seen: true, slot };
        this.tracks.set(id, tr);
      }
      tr.seen = true;
      // the arc ahead, refined a few times a second (the ground under a small world curves away)
      if (now - tr.predAt > 0.25) { tr.predAt = now; tr.T = age + this.predict(p, v, tr.land); }
      tr.p.copy(p); tr.v.copy(v); tr.age = age;
      // where it comes down: a ring converging as it falls (bright enough to find from the god's height)
      const prog = clamp01(age / Math.max(0.2, tr.T));
      const dLand = tr.land.distanceTo(camB);
      const ringR = Math.max(4, sizeForPixels(26, dLand, viewH, fov));
      const d = decal(DECAL.reticle, [tr.land.x, tr.land.y, tr.land.z], ringR * 1.25);
      d.cr = col.r * 1.3; d.cg = col.g * 1.1; d.cb = col.b; d.ca = smooth(0, 0.15, age) * (1 - smooth(0.96, 1.0, prog));
      d.p0 = ringR; d.p1 = 1 - prog; d.p2 = 1.6; d.p3 = prog;
      d.q0 = Math.max(4, ringR * 0.6);
      decals.add(d);
      void kind;
    }, now);
    for (const [id, tr] of this.tracks) if (!tr.seen) { this.freeSlots.push(tr.slot); this.tracks.delete(id); }
    this.build();
  }

  /** a flight's drawn scale factor for its mesh (flights.ts multiplies its own true size by nothing else) */
  private sizeOf(kind: string, trueSize: number, age: number, p: Vector3, id: number): number {
    const tr = this.tracks.get(id);
    const touch = tr ? tr.touch : touchSize(p.distanceTo(this.camB));
    const prog = tr ? clamp01(age / Math.max(0.2, tr.T)) : 0;
    // (flights' sizes are a mesh scale on a unit boulder ~2 across: a diameter of 2 × trueSize)
    const drawn = flightDrawSize(trueSize * 2, touch, prog, p.distanceTo(this.camB), this.viewH, this.fov);
    void kind;
    return drawn / 2;
  }

  /** integrate a ballistic arc from p with velocity v to the ground; writes the landing point, returns seconds */
  private predict(p: Vector3, v: Vector3, out: Vector3): number {
    const pv = this.pv!;
    const R = pv.params.radius, gr = pv.params.gravity || 9.8;
    const q = _a.copy(p), w = _b.copy(v);
    let t = 0;
    const h = 1 / 20;
    while (t < 30) {
      const r = q.length();
      const gk = gr * (R / r) * (R / r);
      w.addScaledVector(q, (-gk * h) / r);
      q.addScaledVector(w, h);
      t += h;
      const u = _c.copy(q).normalize();
      const g = groundHeight(pv.ground, u.x, u.y, u.z);
      if (q.length() <= g && t > 0.1) { out.copy(u).multiplyScalar(g); return t; }
    }
    const u = _c.copy(q).normalize();
    out.copy(u).multiplyScalar(groundHeight(pv.ground, u.x, u.y, u.z));
    return t;
  }

  /**
   * the streak ribbons of every tracked flight: its own ballistic path traced BACK from where it is now over the last
   * half second (or its whole flight, if shorter) — the same streak at 60 fps and at 5, and in a held capture
   */
  private build(): void {
    const pos = this.geo.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    arr.fill(0);
    const cam = this.camB;
    const pxk = (2 * Math.tan((this.fov * Math.PI) / 360)) / Math.max(1, this.viewH);
    const pv = this.pv;
    const R = pv?.params.radius ?? 1, gr = pv?.params.gravity || 9.8;
    let any = false;
    for (const tr of this.tracks.values()) {
      const span = Math.min(0.5, tr.age);
      if (span < 0.02) continue;
      any = true;
      // the path back: sample 0 the head (now), the last the tail (span seconds ago)
      const h = span / (SAMPLES - 1);
      const path = this.path;
      path[0].copy(tr.p);
      const q = _a.copy(tr.p), w = _b.copy(tr.v);
      for (let i = 1; i < SAMPLES; i++) {
        // (gravity reversed: a step back undoes the step forward flights.ts took)
        q.addScaledVector(w, -h);
        const r = q.length();
        w.addScaledVector(q, (gr * (R / r) * (R / r) * h) / r);
        path[i].copy(q);
      }
      for (let i = 0; i < SAMPLES; i++) {
        const p = path[i];
        const o = path[Math.max(0, i - 1)], qn = path[Math.min(SAMPLES - 1, i + 1)];
        const tx = qn.x - o.x, ty = qn.y - o.y, tz = qn.z - o.z;
        const vx = cam.x - p.x, vy = cam.y - p.y, vz = cam.z - p.z;
        let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const dist = Math.hypot(vx, vy, vz);
        // a few pixels across at any distance, at least a fraction of what it carries
        const w = Math.max(dist * pxk * (FLIGHT_MIN_PX * 0.45), tr.touch * 0.05) * (1 - 0.6 * (i / (SAMPLES - 1)));
        sx *= w / sl; sy *= w / sl; sz *= w / sl;
        const k = ((tr.slot * SAMPLES + i) * 2) * 3;
        arr[k] = p.x + sx; arr[k + 1] = p.y + sy; arr[k + 2] = p.z + sz;
        arr[k + 3] = p.x - sx; arr[k + 4] = p.y - sy; arr[k + 5] = p.z - sz;
      }
    }
    pos.needsUpdate = true;
    this.group.visible = any;
    void this.now;
  }

  dispose(): void { this.geo.dispose(); (this.group.material as ShaderMaterial).dispose(); }
}
