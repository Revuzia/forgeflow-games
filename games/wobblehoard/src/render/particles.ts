// Particles: ONE instanced-billboard draw call for every short-lived or orbiting light speck of the rarity and ceremony FX.
// Kinds: 0 = soft round mote, 1 = four-point star (constellation point), 2 = streak stretched along its velocity (trail,
// spiral, ribbon segment), 3 = small glowing satellite sphere. Additive, depth-tested, tonemapped like everything else.
// Zero per-frame allocation; deterministic (the caller owns the RNG). Counts are capped by `cap`.
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec4 aPos;     // xyz, half size
attribute vec4 aVel;     // xyz velocity (streaks), w = kind
attribute vec4 aCol;     // rgb, alpha (already includes the life fade)
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
void main() {
  vUv = position.xy;
  vCol = aCol;
  vKind = aVel.w;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  if (aVel.w > 1.5 && aVel.w < 2.5) {
    vec4 mv2 = viewMatrix * vec4(aPos.xyz + aVel.xyz * 0.07, 1.0);
    vec2 dir = mv2.xy - mv.xy;
    float L = length(dir);
    vec2 d = L > 1e-5 ? dir / L : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    mv.xy -= d * (L * 0.5);
    mv.xy += d * position.x * (aPos.w + L * 0.5) + n * position.y * aPos.w * 0.55;
  } else {
    mv.xy += position.xy * aPos.w;
  }
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
uniform float uTime;
uniform float uTwinkle;   // 1 = star points twinkle, 0 = steady (calm effects: no pulses)
void main() {
  vec2 p = vUv;
  float r = length(p);
  float a;
  vec3 tint = vCol.rgb;
  if (vKind < 0.5) {                       // mote
    if (r > 1.0) discard;
    a = exp(-r * r * 5.5) + 0.9 * exp(-r * r * 28.0);
  } else if (vKind < 1.5) {                // star
    if (r > 1.0) discard;
    float star = max(0.0, 1.0 - 7.0 * abs(p.x * p.y)) * (1.0 - smoothstep(0.5, 1.0, r));
    a = star * 0.9 + 1.1 * exp(-r * r * 14.0);
    a *= 0.8 + 0.2 * uTwinkle * sin(uTime * 2.0 + vCol.r * 20.0);
  } else if (vKind < 2.5) {                // streak
    float along = clamp(1.0 - abs(p.x), 0.0, 1.0);
    a = pow(along, 1.5) * exp(-p.y * p.y * 7.0);
    a *= 0.35 + 0.65 * smoothstep(-1.0, 1.0, p.x);          // bright head, faded tail
  } else {                                 // satellite sphere
    if (r > 1.0) discard;
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    float dif = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0), 24.0);
    float rim = pow(1.0 - n.z, 2.5);
    a = 0.35 + 0.8 * dif + rim * 0.7;
    tint = tint * a + vec3(1.0) * spec * 1.2;
    a = 1.0;
    a *= 1.0 - smoothstep(0.92, 1.0, r);
  }
  gl_FragColor = vec4(tint * a * vCol.a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface EmitSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number; size: number;
  kind?: 0 | 1 | 2 | 3;
  r?: number; g?: number; b?: number; a?: number;
  /** 0..1: how strongly the global attractor pulls this particle (merge charge, constellation convergence). */
  attract?: number;
  /** tangential acceleration around the attractor (spiral inward). */
  spin?: number;
  drag?: number;
  grav?: number;
  /** fade shape: 0 = linear out, 1 = in and out (default), 2 = hold then out */
  fade?: 0 | 1 | 2;
}

export class Particles {
  readonly mesh: THREE.Mesh;
  readonly cap: number;
  private n = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array; private readonly size: Float32Array;
  private readonly kind: Float32Array; private readonly cr: Float32Array; private readonly cg: Float32Array; private readonly cb: Float32Array;
  private readonly ca: Float32Array; private readonly attract: Float32Array; private readonly spin: Float32Array;
  private readonly drag: Float32Array; private readonly grav: Float32Array; private readonly fade: Float32Array;
  private readonly aPos: Float32Array; private readonly aVel: Float32Array; private readonly aCol: Float32Array;
  private readonly aPosA: THREE.InstancedBufferAttribute; private readonly aVelA: THREE.InstancedBufferAttribute; private readonly aColA: THREE.InstancedBufferAttribute;
  /** Global attractor (world point + strength 1/s^2). strength 0 = off. */
  ax = 0; ay = 0; az = 0; attractK = 0;
  /** Running totals (probe): particles emitted, and emits refused because the pool was full. */
  emitted = 0; dropped = 0;

  constructor(cap: number, renderOrder = 32) {
    this.cap = cap;
    const mk = (): Float32Array => new Float32Array(cap);
    this.px = mk(); this.py = mk(); this.pz = mk(); this.vx = mk(); this.vy = mk(); this.vz = mk();
    this.age = mk(); this.life = mk(); this.size = mk(); this.kind = mk();
    this.cr = mk(); this.cg = mk(); this.cb = mk(); this.ca = mk();
    this.attract = mk(); this.spin = mk(); this.drag = mk(); this.grav = mk(); this.fade = mk();
    this.aPos = new Float32Array(cap * 4); this.aVel = new Float32Array(cap * 4); this.aCol = new Float32Array(cap * 4);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.geo.instanceCount = 0;
    this.aPosA = new THREE.InstancedBufferAttribute(this.aPos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aVelA = new THREE.InstancedBufferAttribute(this.aVel, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColA = new THREE.InstancedBufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', this.aPosA); this.geo.setAttribute('aVel', this.aVelA); this.geo.setAttribute('aCol', this.aColA);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 }, uTwinkle: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  get count(): number { return this.n; }

  /** Star points twinkle (true) or hold steady (calm effects). */
  setTwinkle(on: boolean): void { this.mat.uniforms.uTwinkle.value = on ? 1 : 0; }

  clear(): void { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }

  emit(s: EmitSpec): boolean {
    if (this.n >= this.cap) { this.dropped++; return false; }
    const i = this.n++;
    this.emitted++;
    this.px[i] = s.x; this.py[i] = s.y; this.pz[i] = s.z;
    this.vx[i] = s.vx ?? 0; this.vy[i] = s.vy ?? 0; this.vz[i] = s.vz ?? 0;
    this.age[i] = 0; this.life[i] = s.life; this.size[i] = s.size; this.kind[i] = s.kind ?? 0;
    this.cr[i] = s.r ?? 1; this.cg[i] = s.g ?? 1; this.cb[i] = s.b ?? 1; this.ca[i] = s.a ?? 1;
    this.attract[i] = s.attract ?? 0; this.spin[i] = s.spin ?? 0; this.drag[i] = s.drag ?? 0; this.grav[i] = s.grav ?? 0; this.fade[i] = s.fade ?? 1;
    return true;
  }

  /** Re-write a persistent particle (orbiters): same slot, new position / velocity, no ageing. Returns the slot. */
  set(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, alpha: number): void {
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.ca[i] = alpha;
  }

  /** Set the look of a persistent slot (kind, half size, colour, alpha). */
  configure(i: number, kind: number, size: number, r: number, g: number, b: number, a: number): void {
    this.kind[i] = kind; this.size[i] = size; this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
  }

  update(dt: number, time: number): void {
    let i = 0;
    const kk = this.attractK;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.n;
        this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
        this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
        this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.size[i] = this.size[l]; this.kind[i] = this.kind[l];
        this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l]; this.ca[i] = this.ca[l];
        this.attract[i] = this.attract[l]; this.spin[i] = this.spin[l]; this.drag[i] = this.drag[l]; this.grav[i] = this.grav[l]; this.fade[i] = this.fade[l];
        continue;
      }
      const at = this.attract[i];
      if (kk > 0 && at > 0) {
        const dx = this.ax - this.px[i], dy = this.ay - this.py[i], dz = this.az - this.pz[i];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
        const a = kk * at * dt;
        this.vx[i] += dx / d * a * Math.min(1, d * 2 + 0.2); this.vy[i] += dy / d * a * Math.min(1, d * 2 + 0.2); this.vz[i] += dz / d * a * Math.min(1, d * 2 + 0.2);
        const sp = this.spin[i] * dt;
        // tangential direction: up x radial (horizontal swirl around the attractor)
        this.vx[i] += (-dz / d) * sp; this.vz[i] += (dx / d) * sp;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.grav[i] > 0 && this.py[i] < 0.01) { this.py[i] = 0.01; this.vy[i] = Math.abs(this.vy[i]) * 0.3; }
      i++;
    }
    for (let k = 0; k < this.n; k++) {
      const t = this.age[k] / this.life[k];
      const f = this.fade[k];
      const env = f === 0 ? 1 - t : f === 2 ? (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4) : Math.min(1, t * 6) * (1 - t) * (1 - t) * 1.0 + 0.0;
      this.aPos[k * 4] = this.px[k]; this.aPos[k * 4 + 1] = this.py[k]; this.aPos[k * 4 + 2] = this.pz[k]; this.aPos[k * 4 + 3] = this.size[k];
      this.aVel[k * 4] = this.vx[k]; this.aVel[k * 4 + 1] = this.vy[k]; this.aVel[k * 4 + 2] = this.vz[k]; this.aVel[k * 4 + 3] = this.kind[k];
      this.aCol[k * 4] = this.cr[k]; this.aCol[k * 4 + 1] = this.cg[k]; this.aCol[k * 4 + 2] = this.cb[k]; this.aCol[k * 4 + 3] = this.ca[k] * env;
    }
    this.mat.uniforms.uTime.value = time;
    this.aPosA.needsUpdate = true; this.aVelA.needsUpdate = true; this.aColA.needsUpdate = true;
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
