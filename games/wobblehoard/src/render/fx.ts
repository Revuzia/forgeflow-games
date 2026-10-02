// Cheap FX, three draw calls in total, all instanced billboards with procedural shading:
//   * bubbles  - trapped air that rises, wobbles and pops (spawnFx 'bubbles')
//   * glitter  - specks suspended INSIDE the body, each stored as sim triangle + barycentric weights + depth fraction toward
//                the centre so it rides every deformation; they twinkle in the shader. spawnFx 'glitter' adds a short burst
//                of free sparks into spare slots of the same instance buffer.
//   * puffs    - landing dust (soft billboards) and the expanding ring on the table (spawnFx 'dust' / 'ring')
// All randomness is seeded (mulberry32): same genome + same call sequence = same pixels. Zero per-frame allocation.
import * as THREE from 'three';
import type { FxKind, SoftBodyLike, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { mulberry32 } from '../core/rng.ts';
import type { JellyPalette } from './oklch.ts';
import { TIERS, type TierSpec } from './quality.ts';
import type { RestMapper, SurfaceHit } from './jelly.ts';
import { NOISE_GLSL } from './shaderlib.ts';

function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  g.instanceCount = 0;
  return g;
}

const lin = (c: [number, number, number]): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

/* ───────────────────────────── bubbles ───────────────────────────── */

const BUBBLE_VERT = /* glsl */`
attribute vec4 aPos;
attribute vec4 aState;
varying vec2 vUv;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vState = aState;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  mv.xy += position.xy * aPos.w * (1.0 + 0.8 * aState.x);
  gl_Position = projectionMatrix * mv;
}
`;
const BUBBLE_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vState;
uniform vec3 uTint;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float pop = vState.x;
  float shell = smoothstep(0.6, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float body = 0.07 * (1.0 - r);
  float hl = smoothstep(0.28, 0.0, length(vUv - vec2(-0.36, 0.4)));
  float cres = pow(max(0.0, dot(normalize(vUv + 1e-5), normalize(vec2(0.7, -0.7)))), 3.0) * smoothstep(0.5, 0.95, r);
  vec3 col = vec3(1.0, 0.94, 0.84) * (shell * 0.5 + hl * 1.7) + vec3(0.3, 0.85, 1.0) * cres * 0.8 + uTint * body;
  float spokes = pow(abs(sin(atan(vUv.y, vUv.x) * 4.5 + vState.y * 10.0)), 6.0) * smoothstep(0.25, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r));
  col = mix(col, vec3(1.0, 0.96, 0.88) * (spokes * 1.1 + shell * 0.6), pop);
  gl_FragColor = vec4(col * vState.z, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Bubbles {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cap: number;
  /** Live-bubble limit of the current tier (<= cap, the allocated size). */
  limit: number;
  private count = 0;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array; private readonly size: Float32Array;
  private readonly seed: Float32Array; private readonly pop: Float32Array; // pop < 0: alive, else seconds since popping
  private readonly aPos: Float32Array; private readonly aState: Float32Array;
  private readonly aPosA: THREE.InstancedBufferAttribute; private readonly aStateA: THREE.InstancedBufferAttribute;

  constructor(cap: number, tint: THREE.Color) {
    this.cap = cap; this.limit = cap;
    const mk = (): Float32Array => new Float32Array(cap);
    this.px = mk(); this.py = mk(); this.pz = mk(); this.vx = mk(); this.vy = mk(); this.vz = mk();
    this.age = mk(); this.life = mk(); this.size = mk(); this.seed = mk(); this.pop = mk();
    this.aPos = new Float32Array(cap * 4); this.aState = new Float32Array(cap * 4);
    this.geo = quadGeometry();
    this.aPosA = new THREE.InstancedBufferAttribute(this.aPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aStateA = new THREE.InstancedBufferAttribute(this.aState, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.aPosA);
    this.geo.setAttribute('aState', this.aStateA);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, uniforms: { uTint: { value: tint } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  spawn(at: V3, intensity: number, rng: () => number, scale: number): void {
    const n = Math.round(4 + 12 * Math.min(1, Math.max(0, intensity)));
    for (let k = 0; k < n && this.count < this.limit; k++) {
      const i = this.count++;
      const a = rng() * Math.PI * 2, rad = (0.05 + 0.3 * rng()) * scale;
      this.px[i] = at.x + Math.cos(a) * rad; this.py[i] = Math.max(0.02, at.y) + rng() * 0.12 * scale; this.pz[i] = at.z + Math.sin(a) * rad;
      this.vx[i] = Math.cos(a) * 0.1 * rng(); this.vz[i] = Math.sin(a) * 0.1 * rng();
      this.vy[i] = 0.22 + 0.4 * rng() + 0.25 * intensity;
      this.age[i] = 0; this.life[i] = 0.8 + rng() * 1.4;
      this.size[i] = (0.022 + 0.05 * rng() * rng() + 0.012 * intensity) * scale;
      this.seed[i] = rng(); this.pop[i] = -1;
    }
  }

  update(dt: number, time: number): void {
    let i = 0;
    while (i < this.count) {
      let dead = false;
      if (this.pop[i] < 0) {
        this.age[i] += dt;
        const drag = Math.exp(-dt * 1.4);
        this.vx[i] *= drag; this.vz[i] *= drag; this.vy[i] = this.vy[i] * drag + 0.35 * dt;
        const s = this.seed[i] * 40;
        this.px[i] += (this.vx[i] + Math.sin(time * 5 + s) * 0.07) * dt;
        this.pz[i] += (this.vz[i] + Math.cos(time * 4.3 + s) * 0.07) * dt;
        this.py[i] += this.vy[i] * dt;
        if (this.age[i] >= this.life[i]) this.pop[i] = 0;
      } else {
        this.pop[i] += dt;
        if (this.pop[i] > 0.16) dead = true;
      }
      if (dead) {
        const l = --this.count;
        this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
        this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.size[i] = this.size[l]; this.seed[i] = this.seed[l]; this.pop[i] = this.pop[l];
        continue;
      }
      i++;
    }
    for (let k = 0; k < this.count; k++) {
      const popP = this.pop[k] < 0 ? 0 : Math.min(1, this.pop[k] / 0.16);
      const fadeIn = Math.min(1, this.age[k] / 0.12);
      this.aPos[k * 4] = this.px[k]; this.aPos[k * 4 + 1] = this.py[k]; this.aPos[k * 4 + 2] = this.pz[k]; this.aPos[k * 4 + 3] = this.size[k];
      this.aState[k * 4] = popP; this.aState[k * 4 + 1] = this.seed[k]; this.aState[k * 4 + 2] = fadeIn * (1 - popP * popP) * 0.9;
    }
    this.aPosA.needsUpdate = true; this.aStateA.needsUpdate = true;
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  get active(): number { return this.count; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/* ───────────────────────────── glitter ───────────────────────────── */

const GLITTER_VERT = /* glsl */`
attribute vec4 aPos;     // xyz, half size
attribute vec4 aTw;      // phase, speed, brightness, 0
varying vec2 vUv;
varying vec3 vTw;
void main() {
  vUv = position.xy;
  vTw = aTw.xyz;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  mv.xy += position.xy * aPos.w;
  gl_Position = projectionMatrix * mv;
}
`;
const GLITTER_FRAG = /* glsl */`
varying vec2 vUv;
varying vec3 vTw;
uniform float uTime;
uniform vec3 uColor;
void main() {
  vec2 p = vUv;
  float r = length(p);
  if (r > 1.0) discard;
  float tw = pow(0.5 + 0.5 * sin(uTime * vTw.y + vTw.x * 6.2832), 5.0);
  float star = max(0.0, 1.0 - 7.0 * abs(p.x * p.y)) * (1.0 - smoothstep(0.55, 1.0, r));
  float core = exp(-r * r * 12.0);
  float a = (star * 0.85 + core * 1.1) * (0.18 + 1.7 * tw) * vTw.z;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Glitter {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cap: number;
  private readonly burstCap = 48;
  private n = 0;                                   // suspended specks in use
  private tri: Uint32Array; private bw: Float32Array; private rf: Float32Array; private sz: Float32Array; private ph: Float32Array; private sp: Float32Array;
  // burst particles
  private bx = new Float32Array(48); private by = new Float32Array(48); private bz = new Float32Array(48);
  private bvx = new Float32Array(48); private bvy = new Float32Array(48); private bvz = new Float32Array(48);
  private bage = new Float32Array(48); private blife = new Float32Array(48); private bph = new Float32Array(48);
  private bn = 0;
  private readonly aPos: Float32Array; private readonly aTw: Float32Array;
  private readonly aPosA: THREE.InstancedBufferAttribute; private readonly aTwA: THREE.InstancedBufferAttribute;

  constructor(cap: number, color: THREE.Color) {
    this.cap = cap;
    this.tri = new Uint32Array(cap); this.bw = new Float32Array(cap * 3); this.rf = new Float32Array(cap);
    this.sz = new Float32Array(cap); this.ph = new Float32Array(cap); this.sp = new Float32Array(cap);
    const total = cap + this.burstCap;
    this.aPos = new Float32Array(total * 4); this.aTw = new Float32Array(total * 4);
    this.geo = quadGeometry();
    this.aPosA = new THREE.InstancedBufferAttribute(this.aPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aTwA = new THREE.InstancedBufferAttribute(this.aTw, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.aPosA);
    this.geo.setAttribute('aTw', this.aTwA);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GLITTER_VERT, fragmentShader: GLITTER_FRAG, uniforms: { uTime: { value: 0 }, uColor: { value: color } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.mesh.visible = false;
  }

  /** Lay out `count` suspended specks: uniform random rest directions -> sim triangle + barycentric + radius fraction. */
  layout(count: number, mapper: RestMapper, seed: number, scale: number): void {
    this.n = Math.min(this.cap, count);
    const rng = mulberry32(seed ^ 0x6117e7);
    const hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
    for (let i = 0; i < this.n; i++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
      mapper.locate(rr * Math.cos(a), z, rr * Math.sin(a), hit);
      this.tri[i] = hit.tri; this.bw[i * 3] = hit.u; this.bw[i * 3 + 1] = hit.v; this.bw[i * 3 + 2] = hit.w;
      this.rf[i] = 0.22 + 0.68 * Math.cbrt(rng());        // radius fraction toward the surface: 1 = at the surface
      this.sz[i] = (0.005 + 0.008 * rng() * rng() + 0.003) * scale;
      this.ph[i] = rng(); this.sp[i] = 2.5 + 6 * rng();
    }
  }

  burst(at: V3, intensity: number, rng: () => number, scale: number): void {
    const n = Math.round(10 + 28 * Math.min(1, Math.max(0, intensity)));
    for (let k = 0; k < n && this.bn < this.burstCap; k++) {
      const i = this.bn++;
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z), sp = (0.4 + 1.1 * rng()) * (0.6 + 0.7 * intensity) * scale;
      this.bx[i] = at.x; this.by[i] = Math.max(0.03, at.y); this.bz[i] = at.z;
      this.bvx[i] = rr * Math.cos(a) * sp; this.bvy[i] = (Math.abs(z) * 0.9 + 0.35) * sp; this.bvz[i] = rr * Math.sin(a) * sp;
      this.bage[i] = 0; this.blife[i] = 0.55 + 0.8 * rng(); this.bph[i] = rng();
    }
  }

  update(dt: number, time: number, body: SoftBodyLike | null, glow: number): void {
    let o = 0;
    if (body) {
      const P = body.positions, idx = body.indices, c = body.center;
      const cx = c.x, cy = c.y, cz = c.z;
      for (let i = 0; i < this.n; i++) {
        const t = this.tri[i] * 3;
        const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
        const u = this.bw[i * 3], v = this.bw[i * 3 + 1], w = this.bw[i * 3 + 2];
        const f = this.rf[i];
        this.aPos[o * 4] = cx + (u * P[a] + v * P[b] + w * P[d] - cx) * f;
        this.aPos[o * 4 + 1] = cy + (u * P[a + 1] + v * P[b + 1] + w * P[d + 1] - cy) * f;
        this.aPos[o * 4 + 2] = cz + (u * P[a + 2] + v * P[b + 2] + w * P[d + 2] - cz) * f;
        this.aPos[o * 4 + 3] = this.sz[i];
        this.aTw[o * 4] = this.ph[i]; this.aTw[o * 4 + 1] = this.sp[i]; this.aTw[o * 4 + 2] = glow * (0.3 + 0.9 * f * f); this.aTw[o * 4 + 3] = 0;
        o++;
      }
    }
    // bursts
    let i = 0;
    while (i < this.bn) {
      this.bage[i] += dt;
      if (this.bage[i] >= this.blife[i]) {
        const l = --this.bn;
        this.bx[i] = this.bx[l]; this.by[i] = this.by[l]; this.bz[i] = this.bz[l];
        this.bvx[i] = this.bvx[l]; this.bvy[i] = this.bvy[l]; this.bvz[i] = this.bvz[l];
        this.bage[i] = this.bage[l]; this.blife[i] = this.blife[l]; this.bph[i] = this.bph[l];
        continue;
      }
      const drag = Math.exp(-dt * 2.2);
      this.bvx[i] *= drag; this.bvz[i] *= drag; this.bvy[i] = this.bvy[i] * drag - 1.5 * dt;
      this.bx[i] += this.bvx[i] * dt; this.by[i] += this.bvy[i] * dt; this.bz[i] += this.bvz[i] * dt;
      if (this.by[i] < 0.01) { this.by[i] = 0.01; this.bvy[i] = -this.bvy[i] * 0.3; }
      i++;
    }
    for (let k = 0; k < this.bn; k++) {
      const life = 1 - this.bage[k] / this.blife[k];
      this.aPos[o * 4] = this.bx[k]; this.aPos[o * 4 + 1] = this.by[k]; this.aPos[o * 4 + 2] = this.bz[k]; this.aPos[o * 4 + 3] = 0.016 + 0.01 * life;
      this.aTw[o * 4] = this.bph[k]; this.aTw[o * 4 + 1] = 14; this.aTw[o * 4 + 2] = life * 1.5; this.aTw[o * 4 + 3] = 1;
      o++;
    }
    this.mat.uniforms.uTime.value = time;
    this.aPosA.needsUpdate = true; this.aTwA.needsUpdate = true;
    this.geo.instanceCount = o;
    this.mesh.visible = o > 0;
  }

  get suspended(): number { return this.n; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/* ───────────────────────────── dust + ring ───────────────────────────── */

const PUFF_VERT = /* glsl */`
attribute vec4 aPos;     // xyz, size
attribute vec4 aState;   // age01, kind (0 dust, 1 ring), seed, alpha
varying vec2 vUv;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vState = aState;
  if (aState.y > 0.5) {
    vec3 wp = aPos.xyz + vec3(position.x, 0.0, position.y) * aPos.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  } else {
    vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
    mv.xy += position.xy * aPos.w;
    gl_Position = projectionMatrix * mv;
  }
}
`;
const PUFF_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vState;
uniform vec3 uColor;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a;
  if (vState.y > 0.5) {
    float w = mix(0.2, 0.07, vState.x);
    a = smoothstep(1.0 - w * 2.0, 1.0 - w, r) * (1.0 - smoothstep(1.0 - w, 1.0, r));
    a *= 0.85;
  } else {
    float n = whNoise2(vUv * 2.6 + vState.z * 31.0);
    a = (1.0 - smoothstep(0.15, 1.0, r)) * (0.55 + 0.7 * n);
    a = a * a;
  }
  gl_FragColor = vec4(uColor, a * vState.w);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Puffs {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cap = 36;
  private count = 0;
  private readonly px = new Float32Array(36); private readonly py = new Float32Array(36); private readonly pz = new Float32Array(36);
  private readonly vx = new Float32Array(36); private readonly vz = new Float32Array(36);
  private readonly age = new Float32Array(36); private readonly life = new Float32Array(36); private readonly size = new Float32Array(36);
  private readonly kind = new Float32Array(36); private readonly seed = new Float32Array(36); private readonly str = new Float32Array(36);
  private readonly aPos = new Float32Array(36 * 4); private readonly aState = new Float32Array(36 * 4);
  private readonly aPosA: THREE.InstancedBufferAttribute; private readonly aStateA: THREE.InstancedBufferAttribute;

  constructor(color: THREE.Color) {
    this.geo = quadGeometry();
    this.aPosA = new THREE.InstancedBufferAttribute(this.aPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aStateA = new THREE.InstancedBufferAttribute(this.aState, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.aPosA);
    this.geo.setAttribute('aState', this.aStateA);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uColor: { value: color } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 28;
    this.mesh.visible = false;
  }

  private add(x: number, y: number, z: number, vx: number, vz: number, life: number, size: number, kind: number, seed: number, str: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.kind[i] = kind; this.seed[i] = seed; this.str[i] = str;
  }

  dust(at: V3, intensity: number, rng: () => number, scale: number): void {
    const n = 4 + Math.round(5 * intensity);
    const k = Math.min(1, Math.max(0.15, intensity));
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + rng() * 0.8, rad = (0.32 + 0.2 * rng()) * scale;
      this.add(at.x + Math.cos(a) * rad, 0.04 * scale + rng() * 0.03, at.z + Math.sin(a) * rad,
        Math.cos(a) * (0.25 + 0.3 * rng()) * scale, Math.sin(a) * (0.25 + 0.3 * rng()) * scale,
        0.55 + 0.4 * rng(), (0.07 + 0.06 * rng()) * scale * (0.7 + 0.5 * k), 0, rng(), 0.22 + 0.28 * k);
    }
  }

  ring(at: V3, intensity: number, _rng: () => number, scale: number): void {
    const k = Math.min(1, Math.max(0.2, intensity));
    this.add(at.x, 0.012, at.z, 0, 0, 0.55 + 0.2 * k, (0.75 + 0.6 * k) * scale, 1, 0, 0.5 + 0.4 * k);
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.count;
        this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l]; this.vx[i] = this.vx[l]; this.vz[i] = this.vz[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.size[i] = this.size[l]; this.kind[i] = this.kind[l]; this.seed[i] = this.seed[l]; this.str[i] = this.str[l];
        continue;
      }
      const drag = Math.exp(-dt * 3.2);
      this.vx[i] *= drag; this.vz[i] *= drag;
      this.px[i] += this.vx[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.kind[i] < 0.5) this.py[i] += 0.07 * dt;
      i++;
    }
    for (let k = 0; k < this.count; k++) {
      const t = this.age[k] / this.life[k];
      const isRing = this.kind[k] > 0.5;
      const grow = isRing ? 0.25 + 1.75 * (1 - (1 - t) * (1 - t)) : 0.55 + 0.9 * t;
      const fade = isRing ? (1 - t) * (1 - t) : Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.aPos[k * 4] = this.px[k]; this.aPos[k * 4 + 1] = this.py[k]; this.aPos[k * 4 + 2] = this.pz[k]; this.aPos[k * 4 + 3] = this.size[k] * grow;
      this.aState[k * 4] = t; this.aState[k * 4 + 1] = this.kind[k]; this.aState[k * 4 + 2] = this.seed[k]; this.aState[k * 4 + 3] = fade * this.str[k];
    }
    this.aPosA.needsUpdate = true; this.aStateA.needsUpdate = true;
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  get active(): number { return this.count; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/* ───────────────────────────── the façade ───────────────────────────── */

export class Fx {
  readonly group = new THREE.Group();
  private readonly bubbles: Bubbles;
  private readonly glitter: Glitter;
  private readonly puffs: Puffs;
  private readonly rng: () => number;
  private readonly genome: Genome;
  private readonly mapper: RestMapper;
  private readonly scale: number;
  private glow = 1;

  constructor(genome: Genome, palette: JellyPalette, mapper: RestMapper, tier: TierSpec, scale: number) {
    this.genome = genome; this.mapper = mapper; this.scale = scale;
    this.rng = mulberry32(genome.seed ^ 0xf0f0f0);
    // buffers are sized for the biggest tier so a mid-session switch up never truncates; setTier() applies the tier's counts
    this.bubbles = new Bubbles(TIERS.high.bubbleMax, lin(palette.glow));
    this.glitter = new Glitter(TIERS.high.glitterMax, lin(palette.glitter));
    this.puffs = new Puffs(lin(palette.dust));
    this.group.add(this.puffs.mesh, this.glitter.mesh, this.bubbles.mesh);
    this.setTier(tier);
  }

  /** Re-lay the suspended glitter for a tier (count = genome.glitter x the tier's cap). */
  setTier(tier: TierSpec): void {
    this.bubbles.limit = tier.bubbleMax;
    const g = this.genome.glitter;
    const count = g <= 0.02 ? 0 : Math.max(10, Math.round(tier.glitterMax * g));
    this.glitter.layout(count, this.mapper, this.genome.seed, this.scale);
  }

  spawn(kind: FxKind, at: V3, intensity: number): void {
    const k = Number.isFinite(intensity) ? intensity : 0.5;
    switch (kind) {
      case 'bubbles': this.bubbles.spawn(at, k, this.rng, this.scale); break;
      case 'glitter': this.glitter.burst(at, k, this.rng, this.scale); break;
      case 'dust': this.puffs.dust(at, k, this.rng, this.scale); break;
      case 'ring': this.puffs.ring(at, k, this.rng, this.scale); break;
    }
  }

  update(dt: number, time: number, body: SoftBodyLike | null): void {
    // glitter flashes harder while the body jiggles
    this.glow = 0.85 + 0.9 * (body ? body.metrics.kinetic : 0);
    this.bubbles.update(dt, time);
    this.glitter.update(dt, time, body, this.glow);
    this.puffs.update(dt);
  }

  get counts(): { bubbles: number; glitter: number; puffs: number } { return { bubbles: this.bubbles.active, glitter: this.glitter.suspended, puffs: this.puffs.active }; }

  dispose(): void {
    this.bubbles.dispose(); this.glitter.dispose(); this.puffs.dispose();
  }
}
