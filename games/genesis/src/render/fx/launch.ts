// GENESIS — launch and flight VFX (CONTRACT.md §15.7: "rocket exhaust (Mach diamonds, plume, smoke column, light)").
//
// Driven every frame by render/life/ships.ts, which reports what each ship is doing (engines firing, vents, landing,
// a failure); drawn by the Renderer after the atmosphere composite (like the fire particles), with soft depth from
// the linear depth copy:
//   * PLUMES — one per firing engine cluster: an additive volumetric shell (density from the view angle, so the
//     middle of the plume is dense and its edge fades) with a white-hot core, Mach diamonds near the nozzle at sea level,
//     widening and dimming as the air thins (a vacuum plume is a wide pale bloom), turbulent flicker, HDR bright
//     enough to bloom; tinted by the propellant (kerosene gold, hydrogen pale blue-violet, gunpowder orange).
//   * PUFFS — CPU-emitted, GPU-evolved particles (each particle's birth, velocity and kind are written once into a ring
//     of instanced attributes; the vertex shader evolves it analytically: drag, buoyancy, wind, growth), so a camera
//     cut, a step of 20 ticks or a slow software frame never leaves a gap in a trail — births are spread over the
//     path the engine actually flew (ships.ts passes the analytic path). Kinds: exhaust smoke, the pad's ground cloud
//     rolling out of the flame trench, cold vapour venting from the tanks, fireball, debris sparks, landing dust,
//     high-air condensation trail, the ignition flash. Smoke is LIT (sun through the transmittance LUT, sky, the
//     plume's own orange glow on its underside).
//   * LIGHT — the exhaust is a light: a screen-space deferred point light per firing ship (reconstructs each pixel's
//     surface from the linear depth, Lambert with derivative normals), so the pad, the gantry, the town and the rocket's
//     own flanks glow orange-white; an explosion flashes the same way.
//   * SHAKE — the camera trembles near a firing engine or an explosion (SHAKE.amp, read by camera/rig.ts).
// Time is the render tick in "fx seconds" (ticks / 10: one second at 1×), so pausing freezes the smoke and stepping
// moves it on exactly.

import {
  AdditiveBlending, CustomBlending, CylinderGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, Quaternion, ShaderMaterial, Vector2, Vector3,
  Vector4, type Camera, type IUniform, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_EXPOSURE } from './particles.ts';
import { hashFloat } from '../../sim/core/rng.ts';

/** the camera's tremble (0..1), set every frame from the engines and explosions near the camera */
export const SHAKE = { amp: 0 };

/**
 * Shake the three.js camera (not the pose: picking and the sim's focus stay steady) by SHAKE.amp: a rumble of a few
 * tenths of a degree at full amplitude, layered frequencies so it reads as a roar, not a wobble.
 */
export function applyLaunchShake(cam: { rotateX(a: number): unknown; rotateY(a: number): unknown; rotateZ(a: number): unknown }, time: number): void {
  const a = SHAKE.amp;
  if (a < 0.002) return;
  const k = a * a * 0.006;
  cam.rotateX(k * (Math.sin(time * 31.0) * 0.6 + Math.sin(time * 57.3 + 1.3) * 0.4));
  cam.rotateY(k * (Math.sin(time * 27.1 + 2.1) * 0.6 + Math.sin(time * 61.7 + 0.4) * 0.4));
  cam.rotateZ(k * 0.5 * Math.sin(time * 19.3 + 0.7));
}

/** render layer of the launch / world FX (drawn after the atmosphere composite, never in the opaque pass) */
export const FX_LAYER = 5;

export type Propellant = 'kerolox' | 'hydrolox' | 'methalox' | 'powder';

export interface EngineFire {
  /** a stable id for this cluster (trail continuity) */
  key: string;
  /** planet whose body frame pos / dir are in; −1: system frame (deep space) */
  planet: number;
  pos: Vector3;
  dir: Vector3;
  /** nozzle exit radius (m) and number of engines in the cluster */
  radius: number;
  count: number;
  thrust: number;
  vacuum: boolean;
  fuel: Propellant;
  /** height above the ground (m); ≥ the air's thickness in space */
  alt: number;
  /** the nozzle's exact position at a (fractional) tick, for trail births between frames */
  path?: (tick: number, out: Vector3) => void;
  /** the ship is in the air and leaves a smoke trail (a launcher climbing; not a lander hovering) */
  trail: boolean;
}

/** particle kinds (vertex shader branches) */
export const PUFF = { smoke: 0, padCloud: 1, vent: 2, fireball: 3, spark: 4, dust: 5, trail: 6, flash: 7, debris: 8 } as const;

const SEC_PER_TICK = 0.1;

// ───────────────────────────── puffs ─────────────────────────────

const PUFF_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
${SKY_LOOKUP}
attribute vec2 corner;
attribute vec4 aA;   // birth position xyz (body frame), birth time (fx s, relative to the epoch)
attribute vec4 aB;   // velocity xyz (m/s), kind
attribute vec4 aC;   // size at birth, size at death (m), life (s), seed
uniform float uT;
uniform vec3 uSunDirBody;
uniform vec3 uWind;
uniform vec4 uGlowP[4];
uniform vec3 uGlowC[4];
uniform float uSpace;
uniform vec3 uMoonE;
varying vec2 vCorner;
varying vec4 vColor;
varying vec3 vLight;
varying vec3 vGlow;
varying float vViewZ;
varying float vSoft;
varying float vKind;
varying vec2 vSunS;
varying float vSeed;
varying float vAge;
void main() {
  float kind = aB.w;
  float age = uT - aA.w;
  float life = aC.z;
  if (age < 0.0 || age > life) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float a = age / life;
  vec3 p0 = aA.xyz;
  vec3 up = normalize(p0);
  vec3 v0 = aB.xyz;
  float seed = aC.w;
  float drag = kind < 0.5 ? 0.9 : kind < 1.5 ? 0.55 : kind < 2.5 ? 1.6 : kind < 3.5 ? 1.8 : kind < 4.5 ? 0.15 : kind < 5.5 ? 1.3 : kind < 6.5 ? 0.25 : kind < 7.5 ? 0.0 : 0.05;
  if (uSpace > 0.5) drag = 0.0;
  // drag: the velocity decays exponentially, the distance saturates
  float travel = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = p0 + v0 * travel;
  float rise = 0.0;
  if (uSpace < 0.5) {
    // buoyancy: hot smoke climbs, cold vapour sinks, dust settles; sparks and debris fall
    rise = kind < 0.5 ? 2.8 * age : kind < 1.5 ? 1.6 * max(0.0, age - 2.0) : kind < 2.5 ? -0.9 * age : kind < 3.5 ? 5.0 * age : kind < 4.5 ? -4.9 * age * age : kind < 5.5 ? 0.35 * age : kind < 6.5 ? 0.2 * age : kind < 7.5 ? 0.0 : -4.9 * age * age;
    p += up * rise;
    // the wind carries the smoke (more as it rises out of the ground's shelter)
    float wk = kind < 2.5 || kind > 4.5 && kind < 6.5 ? 1.0 : kind < 3.5 ? 0.6 : 0.2;
    p += uWind * age * wk * (0.6 + 0.4 * a);
  }
  // growth: puffs swell fast at first then slowly
  float s0 = aC.x, s1 = aC.y;
  float sz = s0 + (s1 - s0) * (kind > 3.5 && kind < 4.5 || kind > 7.5 ? a : sqrt(a));
  vKind = kind;
  vSeed = seed;
  vAge = a;
  vec4 col = vec4(1.0);
  vGlow = vec3(0.0);
  vLight = vec3(0.0);
  float soft = 0.5 * sz;
  if (kind < 0.5 || kind > 0.5 && kind < 1.5 || kind > 1.5 && kind < 2.5 || kind > 4.5 && kind < 6.5 || kind > 2.5 && kind < 3.5) {
    float alpha;
    vec3 c;
    if (kind < 0.5) { c = mix(vec3(0.62, 0.6, 0.57), vec3(0.78, 0.77, 0.75), seed); alpha = smoothstep(0.0, 0.06, a) * (1.0 - smoothstep(0.35, 1.0, a)) * 0.82; }
    else if (kind < 1.5) { c = mix(vec3(0.74, 0.73, 0.71), vec3(0.86, 0.86, 0.85), seed); alpha = smoothstep(0.0, 0.05, a) * (1.0 - smoothstep(0.4, 1.0, a)) * 0.9; }
    else if (kind < 2.5) { c = vec3(0.9, 0.92, 0.95); alpha = smoothstep(0.0, 0.15, a) * (1.0 - smoothstep(0.3, 1.0, a)) * 0.42; }
    else if (kind < 3.5) {
      // fireball → dark smoke: the glow fades within the first fifth of its life
      c = mix(vec3(0.08, 0.07, 0.06), vec3(0.22, 0.2, 0.18), smoothstep(0.2, 1.0, a));
      alpha = smoothstep(0.0, 0.03, a) * (1.0 - smoothstep(0.5, 1.0, a)) * 0.92;
      vGlow = vec3(1.0, 0.42, 0.1) * 40.0 * pow(1.0 - smoothstep(0.0, 0.22, a), 2.0) * (0.6 + 0.4 * seed);
      if (uSpace > 0.5) { alpha *= 1.0 - smoothstep(0.1, 0.5, a); c *= 0.5; }
    }
    else if (kind < 5.5) { c = mix(vec3(0.32, 0.26, 0.19), vec3(0.45, 0.38, 0.29), seed); alpha = smoothstep(0.0, 0.08, a) * (1.0 - smoothstep(0.3, 1.0, a)) * 0.75; }
    else { c = vec3(0.92, 0.93, 0.95); alpha = smoothstep(0.0, 0.1, a) * (1.0 - smoothstep(0.25, 1.0, a)) * 0.45; }
    col = vec4(c, alpha);
    // light: the sun through the air at this height, the sky, a little night ambient
    float rP = length(p);
    vec3 upP = p / rP;
    if (uSpace > 0.5) { vLight = uSunE * 0.3; }
    else {
      vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody));
      vLight = sun * 0.26 + skyIrradiance(upP, upP, uSunDirBody) * 0.32 + vec3(0.002, 0.003, 0.005) + uMoonE * 0.15;
    }
    // the plumes light the smoke from inside (orange-white, strongest close to the flame)
    for (int i = 0; i < 4; i++) {
      vec4 g = uGlowP[i];
      if (g.w <= 0.0) continue;
      vec3 d = p - g.xyz;
      float r2 = dot(d, d);
      float reach = 40.0 + 25.0 * g.w;
      vGlow += uGlowC[i] * g.w * 26.0 / (1.0 + r2 / (reach * reach * 0.12)) * exp(-r2 / (reach * reach * 4.0));
    }
    vec3 sV = (modelViewMatrix * vec4(uSunDirBody, 0.0)).xyz;
    vSunS = length(sV.xy) > 1e-4 ? normalize(sV.xy) * (0.4 + 0.6 * length(sV.xy)) : vec2(0.0);
  } else if (kind < 4.5 || kind > 7.5) {
    // sparks / debris: hot streaks cooling as they fly
    float heat = 1.0 - smoothstep(0.0, kind > 7.5 ? 0.35 : 0.8, a);
    col = vec4(mix(vec3(0.9, 0.18, 0.03), vec3(1.0, 0.62, 0.22), heat) * (kind > 7.5 ? 30.0 : 60.0) * heat, (1.0 - smoothstep(0.7, 1.0, a)));
    if (kind > 7.5) col.rgb += vec3(0.05);
    soft = 0.05;
    vec3 vel = v0 * exp(-drag * age) - up * (uSpace > 0.5 ? 0.0 : 9.8 * age);
    vec3 velV = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vGlow = vec3(length(velV.xy) > 1e-4 ? normalize(velV.xy) : vec2(0.0, 1.0), clamp(length(velV.xy) * 0.02, 0.0, 1.0));
  } else {
    // the ignition flash
    col = vec4(vec3(1.0, 0.78, 0.5) * 80.0 * (1.0 - a) * (1.0 - a), 0.0);
    soft = 0.5 * sz;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  if ((kind > 3.5 && kind < 4.5) || kind > 7.5) {
    vec2 dir = vGlow.xy;
    vec2 nrm = vec2(dir.y, -dir.x);
    mv.xy += nrm * corner.x * sz + dir * corner.y * sz * (1.0 + 6.0 * vGlow.z);
  } else {
    float rot = seed * 6.2831853 + age * (seed - 0.5) * 0.4;
    vec2 c = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
    mv.xy += c * sz;
  }
  gl_Position = projectionMatrix * mv;
  vCorner = corner;
  vColor = col;
  vViewZ = -mv.z;
  vSoft = soft;
#include <logdepthbuf_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform sampler2D tSceneDepth;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform vec2 uResolution;
varying vec2 vCorner;
varying vec4 vColor;
varying vec3 vLight;
varying vec3 vGlow;
varying float vViewZ;
varying float vSoft;
varying float vKind;
varying vec2 vSunS;
varying float vSeed;
varying float vAge;
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ + 0.05) discard;
  float fade = clamp((sceneZ - vViewZ) / max(0.05, vSoft), 0.0, 1.0) * smoothstep(0.5, 4.0, vViewZ);
  float r = length(vCorner);
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  if ((vKind > 3.5 && vKind < 4.5) || vKind > 7.5) {
    if (r > 1.0) discard;
    float core = pow(1.0 - r, 1.5);
    float a = vColor.a * core * fade;
    gl_FragColor = vec4(vColor.rgb * a * mix(1.0, 1.0 / ex, 0.5), 0.0);
    return;
  }
  if (vKind > 6.5) {
    if (r > 1.0) discard;
    float g = exp(-r * r * 5.0);
    gl_FragColor = vec4(vColor.rgb * g * fade * mix(1.0, 1.0 / ex, 0.5), 0.0);
    return;
  }
  // a billowing puff: a lumpy cauliflower outline, a fake normal so the sunward side is lit, the glow from below
  float sd = vSeed * 37.0;
  float n1 = snoise(vec3(vCorner * 1.6, sd));
  float n2 = snoise(vec3(vCorner * 3.9 + 2.3, sd + vAge * 1.5));
  float rr = r * (1.0 - 0.24 * n1 - 0.09 * n2);
  float puff = smoothstep(1.0, 0.3, rr) * (0.78 + 0.22 * n2);
  if (puff <= 0.001) discard;
  vec3 nrm = normalize(vec3(vCorner * 0.9 + vec2(n1, n2) * 0.25, sqrt(max(0.05, 1.0 - min(r * r, 1.0)))));
  float lit = clamp(0.55 + 0.55 * dot(nrm.xy, vSunS) + 0.15 * nrm.z, 0.15, 1.25);
  float under = smoothstep(0.5, -0.8, nrm.y);
  float a = vColor.a * puff * fade;
  vec3 glow = vGlow * (0.35 + 0.65 * under);
  // (a glowing fireball is display-referred like the fire particles: bright orange at any exposure, never cream)
  if (vKind > 2.5 && vKind < 3.5) glow *= mix(1.0, 1.0 / ex, 0.6);
  vec3 c = vColor.rgb * (vLight * lit) + glow * vColor.rgb * 1.6 + glow * 0.05;
  gl_FragColor = vec4(c * a, a);
}
`;

class PuffSystem {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private geo = new InstancedBufferGeometry();
  private aA: InstancedBufferAttribute;
  private aB: InstancedBufferAttribute;
  private aC: InstancedBufferAttribute;
  readonly cap: number;
  private head = 0;
  private lo = Infinity;
  private hi = -1;
  /** fx seconds of the newest birth (to know when the ring is idle) */
  lastBirth = -1e9;
  readonly uniforms: Record<string, IUniform>;

  constructor(cap: number, shared: Record<string, IUniform> | null, space: boolean) {
    this.cap = cap;
    this.group.name = space ? 'launch-puffs-space' : 'launch-puffs';
    this.group.matrixAutoUpdate = false;
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => { const a = new InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(DynamicDrawUsage); return a; };
    this.aA = mk(4); this.aB = mk(4); this.aC = mk(4);
    // a far-future birth: every slot starts dead
    for (let i = 0; i < cap; i++) this.aA.array[i * 4 + 3] = 1e9;
    this.geo.setAttribute('aA', this.aA);
    this.geo.setAttribute('aB', this.aB);
    this.geo.setAttribute('aC', this.aC);
    this.geo.instanceCount = cap;
    const glowP: Vector4[] = [], glowC: Vector3[] = [];
    for (let i = 0; i < 4; i++) { glowP.push(new Vector4(0, 0, 0, 0)); glowC.push(new Vector3(1, 0.5, 0.15)); }
    this.uniforms = {
      uT: { value: 0 }, uWind: { value: new Vector3() }, uGlowP: { value: glowP }, uGlowC: { value: glowC }, uSpace: { value: space ? 1 : 0 },
      tSceneDepth: { value: null }, tExposure: FX_EXPOSURE, uHasExposure: { value: 0 }, uResolution: { value: new Vector2(1, 1) },
    };
    const u: Record<string, IUniform> = { ...this.uniforms };
    if (shared) { for (const k of Object.keys(shared)) if (!(k in u)) u[k] = shared[k]; }
    else {
      // deep space: no air (sunTransmittance and the sky read uHasAtmo), the star's light set by the owner
      Object.assign(u, { uHasAtmo: { value: 0 }, uRg: { value: 1 }, uRt: { value: 2 }, uSunE: { value: new Vector3(4, 4, 4) }, uSunDirBody: { value: new Vector3(1, 0, 0) }, uMoonE: { value: new Vector3() } });
    }
    this.material = new ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.group.add(this.mesh);
  }

  /** one particle */
  spawn(x: number, y: number, z: number, t: number, vx: number, vy: number, vz: number, kind: number, s0: number, s1: number, life: number, seed: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, C = this.aC.array as Float32Array;
    A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = z; A[i * 4 + 3] = t;
    B[i * 4] = vx; B[i * 4 + 1] = vy; B[i * 4 + 2] = vz; B[i * 4 + 3] = kind;
    C[i * 4] = s0; C[i * 4 + 1] = s1; C[i * 4 + 2] = life; C[i * 4 + 3] = seed;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    if (t > this.lastBirth) this.lastBirth = t;
  }

  flush(): void {
    if (this.hi < 0) return;
    for (const a of [this.aA, this.aB, this.aC]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.lo * 4, (this.hi - this.lo + 1) * 4);
      a.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }

  /** kill everything (time ran backwards: a rewind) */
  clear(): void {
    const A = this.aA.array as Float32Array;
    for (let i = 0; i < this.cap; i++) A[i * 4 + 3] = 1e9;
    this.lo = 0; this.hi = this.cap - 1;
    this.lastBirth = -1e9;
    this.flush();
  }

  dispose(): void { this.geo.dispose(); this.material.dispose(); }
}

// ───────────────────────────── plumes ─────────────────────────────

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLen;
uniform float uR0;
uniform float uExp;
uniform float uTime;
uniform float uCore;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vViewZ;
varying float vAng;
void main() {
  // the template is a unit cylinder along +Y (y 0..1): the plume's radius grows from the nozzle (uR0) and swells with
  // the expansion (thin air: a wide bloom), pinching slightly at the Mach nodes near the nozzle
  float y = position.y + 0.5;
  float r0 = uR0 * (uCore > 0.5 ? 0.55 : 1.0);
  float shock = uExp < 1.6 ? 0.08 * sin(y * uLen / max(r0 * 2.2, 0.2) * 6.2831853) * (1.0 - smoothstep(0.0, 0.35, y)) : 0.0;
  float swell = 1.0 + (uExp - 1.0) * sqrt(y) + 0.9 * y * uExp;
  float tip = 1.0 - smoothstep(0.75, 1.0, y) * 0.6;
  float r = r0 * (swell + shock) * tip * (uCore > 0.5 ? (1.0 - 0.75 * y) : 1.0);
  vec3 p = vec3(position.x / 0.5 * r, y * uLen, position.z / 0.5 * r);
  // a slow wobble down the length (turbulent shear)
  p.xz += vec2(sin(uTime * 7.0 + y * 6.0), cos(uTime * 5.3 + y * 5.0)) * 0.04 * r * y * 3.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normalize(vec3(position.x, 0.0, position.z)));
  vV = -mv.xyz;
  vY = y;
  vAng = atan(position.z, position.x);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const PLUME_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uLen;
uniform float uR0;
uniform float uExp;
uniform float uThrust;
uniform float uTime;
uniform float uCore;
uniform float uDiamonds;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uSeed;
uniform sampler2D tSceneDepth;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform vec2 uResolution;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vViewZ;
varying float vAng;
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ + 0.1) discard;
  float soft = clamp((sceneZ - vViewZ) / max(0.5, uR0 * 2.0), 0.0, 1.0);
  // volumetric density from the view angle through the shell: dense down the middle, fading at the rim
  vec3 V = normalize(vV);
  float facing = abs(dot(normalize(vN), V));
  float dens = pow(facing, uCore > 0.5 ? 1.2 : 2.2);
  // brightness along the plume: hot at the nozzle, falling off; thin air spreads and dims it
  float y = vY;
  float fall = exp(-y * (uCore > 0.5 ? 4.5 : 2.2)) * (1.0 - smoothstep(0.7, 1.0, y));
  // turbulence scrolling down the plume
  float tn = snoise(vec3(vAng * 1.3, y * uLen * 0.12 - uTime * 18.0, uSeed)) * 0.5 + 0.5;
  float tn2 = snoise(vec3(vAng * 3.1, y * uLen * 0.35 - uTime * 31.0, uSeed + 7.0)) * 0.5 + 0.5;
  float flick = 0.75 + 0.25 * sin(uTime * 53.0 + uSeed * 9.0) * sin(uTime * 37.0);
  float body = dens * fall * mix(0.55, 1.0, tn) * mix(0.8, 1.0, tn2) * flick;
  // Mach diamonds: bright knots where the shocks cross, a few nozzle-diameters apart (sea level only)
  float spacing = max(uR0 * 2.6, 0.25) / uLen;
  float ph = y / spacing;
  float knot = pow(0.5 + 0.5 * cos(ph * 6.2831853), 10.0) * (1.0 - smoothstep(0.0, 6.0 * spacing, y)) * smoothstep(0.0, 0.5 * spacing, y);
  float diamonds = knot * uDiamonds * pow(facing, 3.0) * 2.4;
  vec3 col = mix(uCool, uHot, clamp(fall * 1.3 + diamonds, 0.0, 1.0));
  // display-referred like the flames: bright at any exposure, never a flat white
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  float I = (uCore > 0.5 ? 24.0 : 10.0) * uThrust * mix(1.0, 1.0 / ex, 0.55) / mix(1.0, uExp, 0.7);
  vec3 c = col * (body + diamonds) * I * soft;
  gl_FragColor = vec4(c, 0.0);
}
`;

interface PlumeSlot { group: Group; shell: Mesh; core: Mesh; mats: ShaderMaterial[]; used: boolean }

// ───────────────────────────── light ─────────────────────────────

const LIGHT_VERT = /* glsl */ `
#include <common>
attribute vec2 corner;
attribute vec4 iL;     // position (frame of the group), reach (m)
attribute vec3 iC;     // colour × intensity
varying vec3 vPosV;
varying vec3 vCenterV;
varying float vReach;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(iL.xyz, 1.0);
  float reach = iL.w;
  float z = -mv.z;
  vCenterV = mv.xyz;
  if (z - reach < 1.0) {
    mv = vec4(0.0, 0.0, -1.0, 1.0);
    mv.xy += corner * 4.0;
  } else {
    float zq = z - reach;
    mv.xyz *= zq / z;
    mv.xy += corner * reach * 1.25;
  }
  vPosV = mv.xyz;
  vReach = reach;
  vC = iC;
  gl_Position = projectionMatrix * mv;
  // the quad sits at the front of the light's reach: always in front of what it lights
  gl_Position.z = -gl_Position.w * 0.999;
}
`;

const LIGHT_FRAG = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec3 vPosV;
varying vec3 vCenterV;
varying float vReach;
varying vec3 vC;
void main() {
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (sceneZ > 1e6) discard;
  vec3 S = vPosV * (sceneZ / max(-vPosV.z, 1e-4));
  vec3 Lv = vCenterV - S;
  float d = length(Lv);
  if (d > vReach) discard;
  vec3 N = cross(dFdx(S), dFdy(S));
  float nl = length(N);
  N = nl > 1e-12 ? N / nl : vec3(0.0, 0.0, 1.0);
  if (dot(N, S) > 0.0) N = -N;
  float lam = 0.15 + 0.85 * clamp(dot(N, Lv / max(d, 1e-3)), 0.0, 1.0);
  float win = 1.0 - (d * d) / (vReach * vReach);
  // a volume of flame metres across: the irradiance flattens inside it
  float E = 1.0 / (d * d + 36.0) * win * win;
  gl_FragColor = vec4(vC * E * lam * (0.2 / 3.14159), 0.0);
}
`;

class LightQuads {
  readonly mesh: Mesh;
  private geo = new InstancedBufferGeometry();
  private iL: InstancedBufferAttribute;
  private iC: InstancedBufferAttribute;
  readonly uniforms: Record<string, IUniform>;
  count = 0;
  constructor(cap: number) {
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iL = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iC = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.iL.setUsage(DynamicDrawUsage); this.iC.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('iL', this.iL);
    this.geo.setAttribute('iC', this.iC);
    this.geo.instanceCount = 0;
    this.uniforms = { tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) } };
    const mat = new ShaderMaterial({ vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = -1;
  }
  begin(): void { this.count = 0; }
  add(x: number, y: number, z: number, reach: number, r: number, g: number, b: number): void {
    const cap = this.iL.count;
    if (this.count >= cap) return;
    const i = this.count++;
    this.iL.setXYZW(i, x, y, z, reach);
    this.iC.setXYZ(i, r, g, b);
  }
  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count) { this.iL.needsUpdate = true; this.iC.needsUpdate = true; }
  }
  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

// ───────────────────────────── per-planet state ─────────────────────────────

interface PlanetFx {
  planet: number;
  puffs: PuffSystem;
  lights: LightQuads;
  plumeGroup: Group;
  /** the group (planet body group, or the space group) the FX hang in */
  parent: Group | null;
}

/** the colour of an exhaust (hot core, cool edge) */
function fuelColours(f: Propellant, vacuum: boolean): [Vector3, Vector3] {
  switch (f) {
    case 'hydrolox': return [new Vector3(1.0, 0.86, 0.95), vacuum ? new Vector3(0.35, 0.45, 1.0) : new Vector3(0.75, 0.42, 0.9)];
    case 'methalox': return [new Vector3(1.0, 0.92, 0.8), new Vector3(0.45, 0.4, 1.0)];
    case 'powder': return [new Vector3(1.0, 0.75, 0.35), new Vector3(1.0, 0.32, 0.06)];
    default: return [new Vector3(1.0, 0.92, 0.7), vacuum ? new Vector3(0.9, 0.55, 0.3) : new Vector3(1.0, 0.45, 0.1)];
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _up = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();

export interface LaunchPlanetCtx {
  /** the planet's body-frame group and shared uniforms (PlanetVisual) */
  group: Group;
  uniforms: Record<string, IUniform>;
  /** camera position in the body frame */
  camBody: Vector3;
  /** body-frame wind at the camera's focus (m/s) */
  wind: Vector3;
  /** atmosphere thickness (m) above the datum */
  airTop: number;
  radius: number;
  hasAir: boolean;
}

export class LaunchFx {
  /** deep-space FX (the system frame; positioned each frame relative to the camera) */
  readonly spaceGroup = new Group();
  private planets = new Map<number, PlanetFx>();
  private plumes: PlumeSlot[] = [];
  private fires: EngineFire[] = [];
  private lastPos = new Map<string, { x: number; y: number; z: number; t: number }>();
  private spaceAnchor: [number, number, number] = [0, 0, 0];
  private time = 0;
  private lastT = -1;
  private epoch = 0;
  /** puff budget (quality) */
  capacity = 9000;
  private shakeKick = 0;
  /** plume / explosion light sources this frame per planet */
  private lightList: { planet: number; x: number; y: number; z: number; reach: number; r: number; g: number; b: number }[] = [];
  private glowList = new Map<number, { x: number; y: number; z: number; w: number; c: Vector3 }[]>();

  constructor() {
    this.spaceGroup.name = 'launch-space';
    this.spaceGroup.matrixAutoUpdate = true;
  }

  /** fx seconds now (the render tick at 1× seconds), relative to the epoch */
  get now(): number { return this.time - this.epoch; }
  private tSec(tick: number): number { return tick * SEC_PER_TICK - this.epoch; }

  /** the start of a frame: the clock (render tick) */
  begin(renderTick: number): void {
    const t = renderTick * SEC_PER_TICK;
    if (this.lastT >= 0 && t < this.lastT - 0.5) {
      // time ran backwards (a rewind, a load): the smoke of the future is gone
      for (const p of this.planets.values()) p.puffs.clear();
      this.lastPos.clear();
    }
    // keep birth times small for float32: a new epoch when idle and far from it
    if (t - this.epoch > 20000) {
      let idle = true;
      for (const p of this.planets.values()) if (p.puffs.lastBirth > this.now - 120) idle = false;
      if (idle) { this.epoch = Math.floor(t / 1000) * 1000; for (const p of this.planets.values()) p.puffs.clear(); }
    }
    this.lastT = t;
    this.time = t;
    this.fires.length = 0;
    this.lightList.length = 0;
    this.glowList.clear();
  }

  private planetFx(planet: number, ctx: LaunchPlanetCtx | null): PlanetFx | null {
    let p = this.planets.get(planet);
    if (!p) {
      if (planet >= 0 && !ctx) return null;
      const puffs = new PuffSystem(planet < 0 ? Math.min(3000, this.capacity) : this.capacity, ctx ? ctx.uniforms : null, planet < 0);
      const lights = new LightQuads(16);
      const plumeGroup = new Group();
      plumeGroup.name = 'plumes';
      p = { planet, puffs, lights, plumeGroup, parent: null };
      this.planets.set(planet, p);
    }
    const parent = planet < 0 ? this.spaceGroup : ctx ? ctx.group : null;
    if (parent && p.parent !== parent) {
      if (p.parent) { p.parent.remove(p.puffs.group); p.parent.remove(p.lights.mesh); p.parent.remove(p.plumeGroup); }
      parent.add(p.puffs.group, p.lights.mesh, p.plumeGroup);
      p.parent = parent;
    }
    return p;
  }

  /** a firing engine cluster this frame (ships.ts) */
  engine(e: EngineFire): void { this.fires.push(e); }

  /**
   * Emit smoke for an engine between its last reported position and now, along its path (births spread over the
   * interval), plus the pad cloud while it is low over the ground.
   */
  private emitEngine(e: EngineFire, P: PlanetFx, ctx: LaunchPlanetCtx | null, tickNow: number): void {
    const t1 = this.now;
    const last = this.lastPos.get(e.key);
    const t0 = last && t1 - last.t < 30 && t1 >= last.t ? last.t : t1 - 0.05;
    this.lastPos.set(e.key, { x: e.pos.x, y: e.pos.y, z: e.pos.z, t: t1 });
    if (t1 <= t0) return;
    const space = !ctx || !ctx.hasAir || e.alt > ctx.airTop * 1.05;
    const scale = Math.max(0.6, e.radius * Math.sqrt(e.count));
    // smoke rate (puffs per fx second): thick at the pad, thinning with height, none in vacuum
    const airK = ctx ? 1 - Math.min(1, Math.max(0, (e.alt - ctx.airTop * 0.25) / (ctx.airTop * 0.8))) : 0;
    const low = Math.max(0, 1 - e.alt / 140);
    const rate = space ? 0 : (e.trail ? 70 : 22) * e.thrust * (0.35 + 0.65 * airK) * Math.min(2.5, scale);
    const dt = t1 - t0;
    const n = Math.min(Math.round(rate * dt), 900);
    const tickPerSec = 1 / SEC_PER_TICK;
    for (let i = 0; i < n; i++) {
      const f = (i + hashFloat(i, Math.floor(t1 * 7))) / Math.max(1, n);
      const tb = t0 + (t1 - t0) * f;
      if (e.path) e.path((tb + this.epoch) * tickPerSec, _a);
      else _a.set(last ? last.x + (e.pos.x - last.x) * f : e.pos.x, last ? last.y + (e.pos.y - last.y) * f : e.pos.y, last ? last.z + (e.pos.z - last.z) * f : e.pos.z);
      const s = hashFloat(i, t1 * 13, 3);
      // the smoke leaves the plume's tail: a few nozzle-lengths down the exhaust
      const back = scale * (6 + 10 * hashFloat(i, t1, 4));
      _b.copy(e.dir).multiplyScalar(back);
      const spread = 3 + 5 * scale;
      const jx = (hashFloat(i, t1, 5) - 0.5) * spread, jy = (hashFloat(i, t1, 6) - 0.5) * spread, jz = (hashFloat(i, t1, 7) - 0.5) * spread;
      const kind = e.alt > (ctx ? ctx.airTop * 0.45 : 300) ? PUFF.trail : PUFF.smoke;
      const life = kind === PUFF.trail ? 45 + 30 * s : 22 + 18 * s;
      const sz0 = (kind === PUFF.trail ? 2.5 : 3.5) * scale;
      const sz1 = (kind === PUFF.trail ? 16 : 26 + 22 * s) * scale * (0.7 + 0.3 * airK);
      P.puffs.spawn(_a.x + _b.x + jx, _a.y + _b.y + jy, _a.z + _b.z + jz, tb,
        e.dir.x * 8 + jx * 0.6, e.dir.y * 8 + jy * 0.6, e.dir.z * 8 + jz * 0.6, kind, sz0, sz1, life, s);
    }
    // the pad's ground cloud: steam and smoke shot out sideways along the flame trench and rolling over the ground
    if (low > 0.02 && !space && ctx) {
      const up = _w.copy(e.pos).normalize();
      const nc = Math.min(Math.round(55 * low * e.thrust * dt * Math.min(2.5, scale)), 400);
      const ground = e.pos.length() - e.alt;
      for (let i = 0; i < nc; i++) {
        const tb = t0 + (t1 - t0) * ((i + 0.5) / Math.max(1, nc));
        const s = hashFloat(i, t1 * 17, 11);
        // radial direction in the tangent plane (biased to two trench exits)
        const ang = hashFloat(i, t1, 12) < 0.6 ? (hashFloat(i, t1, 13) < 0.5 ? 0 : Math.PI) + (hashFloat(i, t1, 14) - 0.5) * 0.9 : hashFloat(i, t1, 15) * Math.PI * 2;
        const e1 = _a.set(0, 1, 0).cross(up);
        if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0);
        e1.normalize();
        const e2 = _b.copy(up).cross(e1);
        const dx = e1.x * Math.cos(ang) + e2.x * Math.sin(ang), dy = e1.y * Math.cos(ang) + e2.y * Math.sin(ang), dz = e1.z * Math.cos(ang) + e2.z * Math.sin(ang);
        const sp = (22 + 26 * s) * Math.min(1.6, scale * 0.8);
        const gx = up.x * (ground + 2.5), gy = up.y * (ground + 2.5), gz = up.z * (ground + 2.5);
        P.puffs.spawn(gx + dx * 3, gy + dy * 3, gz + dz * 3, tb, dx * sp + up.x * 2, dy * sp + up.y * 2, dz * sp + up.z * 2, PUFF.padCloud,
          5 * scale, (34 + 26 * s) * Math.min(1.8, scale), 30 + 20 * s, s);
      }
    }
    void tickNow;
  }

  /** cold vapour boiling off the tanks (fuelling, the countdown) */
  vent(planet: number, ctx: LaunchPlanetCtx, pos: Vector3, dir: Vector3, rate: number, size: number): void {
    const P = this.planetFx(planet, ctx);
    if (!P) return;
    const t1 = this.now;
    const key = `vent:${pos.x.toFixed(1)}:${pos.z.toFixed(1)}`;
    const last = this.lastPos.get(key);
    const t0 = last && t1 - last.t < 5 && t1 >= last.t ? last.t : t1 - 0.05;
    this.lastPos.set(key, { x: pos.x, y: pos.y, z: pos.z, t: t1 });
    const n = Math.min(Math.round(rate * (t1 - t0)), 60);
    for (let i = 0; i < n; i++) {
      const s = hashFloat(i, t1 * 31, pos.x);
      const tb = t0 + (t1 - t0) * ((i + s) / Math.max(1, n));
      P.puffs.spawn(pos.x, pos.y, pos.z, tb, dir.x * (1.2 + s) + (s - 0.5) * 0.6, dir.y * (1.2 + s), dir.z * (1.2 + s) + (0.5 - s) * 0.6, PUFF.vent, size * 0.4, size * (2.5 + 2 * s), 3.5 + 2.5 * s, s);
    }
  }

  /** landing dust: a radial sheet blown off the ground under a descent engine */
  dust(planet: number, ctx: LaunchPlanetCtx, ground: Vector3, intensity: number, scale: number): void {
    const P = this.planetFx(planet, ctx);
    if (!P || intensity <= 0.01) return;
    const t1 = this.now;
    const key = `dust:${planet}`;
    const last = this.lastPos.get(key);
    const t0 = last && t1 - last.t < 5 && t1 >= last.t ? last.t : t1 - 0.05;
    this.lastPos.set(key, { x: ground.x, y: ground.y, z: ground.z, t: t1 });
    const n = Math.min(Math.round(80 * intensity * (t1 - t0) * scale), 300);
    const up = _w.copy(ground).normalize();
    const e1 = _a.set(0, 1, 0).cross(up);
    if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = _b.copy(up).cross(e1);
    for (let i = 0; i < n; i++) {
      const s = hashFloat(i, t1 * 23, 5);
      const ang = hashFloat(i, t1, 19) * Math.PI * 2;
      const dx = e1.x * Math.cos(ang) + e2.x * Math.sin(ang), dy = e1.y * Math.cos(ang) + e2.y * Math.sin(ang), dz = e1.z * Math.cos(ang) + e2.z * Math.sin(ang);
      const sp = (14 + 22 * s) * scale;
      const tb = t0 + (t1 - t0) * ((i + 0.5) / Math.max(1, n));
      P.puffs.spawn(ground.x + dx * 2 + up.x, ground.y + dy * 2 + up.y, ground.z + dz * 2 + up.z, tb, dx * sp + up.x * 1.5, dy * sp + up.y * 1.5, dz * sp + up.z * 1.5,
        PUFF.dust, 2 * scale, (12 + 10 * s) * scale, 7 + 6 * s, s);
    }
  }

  /** a failure: fireball, smoke, sparks and tumbling debris, a flash of light, a kick to the camera */
  explode(planet: number, ctx: LaunchPlanetCtx | null, pos: Vector3, scale: number, space: boolean, sys?: ArrayLike<number>): void {
    const P = this.planetFx(planet < 0 || space ? -1 : planet, ctx);
    if (!P) return;
    const t = this.now;
    let x = pos.x, y = pos.y, z = pos.z;
    if (planet < 0 || space) {
      // the space system's anchor: explosions far from it re-anchor (positions relative to it stay small)
      if (sys) {
        if (Math.hypot(sys[0] - this.spaceAnchor[0], sys[1] - this.spaceAnchor[1], sys[2] - this.spaceAnchor[2]) > 5e4) this.spaceAnchor = [sys[0], sys[1], sys[2]];
        x = sys[0] - this.spaceAnchor[0]; y = sys[1] - this.spaceAnchor[1]; z = sys[2] - this.spaceAnchor[2];
      }
    }
    const up = _w.set(x, y, z).normalize();
    const nF = Math.round(70 * Math.min(2, scale));
    for (let i = 0; i < nF; i++) {
      const s = hashFloat(i, t * 3, 41);
      const d = _a.set(hashFloat(i, t, 42) - 0.5, hashFloat(i, t, 43) - 0.5, hashFloat(i, t, 44) - 0.5).normalize();
      const sp = (8 + 30 * s) * scale;
      P.puffs.spawn(x + d.x * scale * 2, y + d.y * scale * 2, z + d.z * scale * 2, t + 0.05 * s, d.x * sp + up.x * 6, d.y * sp + up.y * 6, d.z * sp + up.z * 6, PUFF.fireball,
        (4 + 3 * s) * scale, (24 + 26 * s) * scale, 9 + 9 * s, s);
    }
    const nS = Math.round(90 * Math.min(2, scale));
    for (let i = 0; i < nS; i++) {
      const s = hashFloat(i, t * 5, 51);
      const d = _a.set(hashFloat(i, t, 52) - 0.5, hashFloat(i, t, 53) - 0.5 + (space ? 0 : 0.35), hashFloat(i, t, 54) - 0.5).normalize();
      const sp = (25 + 70 * s) * Math.sqrt(scale);
      P.puffs.spawn(x, y, z, t, d.x * sp, d.y * sp, d.z * sp, i % 3 === 0 ? PUFF.debris : PUFF.spark, 0.25 + 0.4 * s, 0.25 + 0.4 * s, 2.5 + 3 * s, s);
    }
    P.puffs.spawn(x, y, z, t, 0, 0, 0, PUFF.flash, 30 * scale, 140 * scale, 0.9, 0.5);
    this.flashes.push({ planet: P.planet, x, y, z, t, scale });
    this.shakeKick = Math.max(this.shakeKick, Math.min(1, 0.5 * scale));
  }
  private flashes: { planet: number; x: number; y: number; z: number; t: number; scale: number }[] = [];

  /** a burning wreck: dark smoke and a few flames rising for a while after a failure on the ground */
  smolder(planet: number, ctx: LaunchPlanetCtx, pos: Vector3, k: number, scale: number): void {
    const P = this.planetFx(planet, ctx);
    if (!P || k <= 0) return;
    const t1 = this.now;
    const key = `smolder:${planet}:${pos.x.toFixed(0)}`;
    const last = this.lastPos.get(key);
    const t0 = last && t1 - last.t < 5 && t1 >= last.t ? last.t : t1 - 0.05;
    this.lastPos.set(key, { x: pos.x, y: pos.y, z: pos.z, t: t1 });
    const up = _w.copy(pos).normalize();
    const n = Math.min(Math.round(9 * k * (t1 - t0) * scale), 60);
    for (let i = 0; i < n; i++) {
      const s = hashFloat(i, t1 * 29, 77);
      const tb = t0 + (t1 - t0) * ((i + 0.5) / Math.max(1, n));
      const jx = (hashFloat(i, t1, 78) - 0.5) * 6 * scale, jz = (hashFloat(i, t1, 79) - 0.5) * 6 * scale;
      P.puffs.spawn(pos.x + jx, pos.y, pos.z + jz, tb, up.x * 3, up.y * 3, up.z * 3, i % 4 === 0 ? PUFF.fireball : PUFF.smoke, 2 * scale, (14 + 10 * s) * scale, 10 + 8 * s, s);
    }
    this.lightList.push({ planet, x: pos.x, y: pos.y, z: pos.z, reach: 40 * scale, r: 4e4 * k * scale, g: 1.8e4 * k * scale, b: 5e3 * k * scale });
  }

  /** an ignition flash at the base of a launcher (once, as the engines light) */
  ignite(planet: number, ctx: LaunchPlanetCtx, pos: Vector3, scale: number): void {
    const P = this.planetFx(planet, ctx);
    if (!P) return;
    P.puffs.spawn(pos.x, pos.y, pos.z, this.now, 0, 0, 0, PUFF.flash, 10 * scale, 60 * scale, 0.6, 0.3);
    this.shakeKick = Math.max(this.shakeKick, 0.35);
  }

  private plumeSlot(): PlumeSlot {
    for (const s of this.plumes) if (!s.used) { s.used = true; return s; }
    const geo = new CylinderGeometry(0.5, 0.5, 1, 20, 28, true);
    const mk = (core: boolean) => new ShaderMaterial({
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide,
      uniforms: {
        uLen: { value: 30 }, uR0: { value: 1 }, uExp: { value: 1 }, uThrust: { value: 1 }, uTime: { value: 0 }, uCore: { value: core ? 1 : 0 },
        uDiamonds: { value: 1 }, uHot: { value: new Vector3(1, 0.9, 0.7) }, uCool: { value: new Vector3(1, 0.45, 0.1) }, uSeed: { value: 0 },
        tSceneDepth: { value: null }, tExposure: FX_EXPOSURE, uHasExposure: { value: 0 }, uResolution: { value: new Vector2(1, 1) },
      },
    });
    const mats = [mk(false), mk(true)];
    const shell = new Mesh(geo, mats[0]);
    const core = new Mesh(geo, mats[1]);
    const g = new Group();
    for (const m of [shell, core]) { m.frustumCulled = false; m.layers.set(FX_LAYER); g.add(m); }
    shell.renderOrder = 2; core.renderOrder = 3;
    const s: PlumeSlot = { group: g, shell, core, mats, used: true };
    this.plumes.push(s);
    return s;
  }

  /**
   * The end of the reports: emit, place the plumes and lights, the camera's shake. `ctxOf` gives the planet context
   * (null for planets not drawn); `cam` is the camera's system position for the space frame.
   */
  update(ctxOf: (planet: number) => LaunchPlanetCtx | null, camSys: ArrayLike<number>, primary: number, realTime: number, dt: number): void {
    for (const s of this.plumes) s.used = false;
    let shake = 0;
    for (const e of this.fires) {
      const space = e.planet < 0;
      const ctx = space ? null : ctxOf(e.planet);
      if (!space && !ctx) continue;
      const P = this.planetFx(space ? -1 : e.planet, ctx);
      if (!P) continue;
      if (!space) this.emitEngine(e, P, ctx, 0);
      // the plume
      const slot = this.plumeSlot();
      const airK = ctx && ctx.hasAir ? 1 - Math.min(1, Math.max(0, (e.alt - ctx.airTop * 0.15) / (ctx.airTop * 1.1))) : 0;
      const exp = e.vacuum ? 2.6 + 1.6 * (1 - airK) : 1 + 3.2 * (1 - airK);
      const cluster = e.radius * Math.sqrt(e.count) * (e.count > 1 ? 1.35 : 1);
      const len = (e.fuel === 'powder' ? 5 : e.vacuum ? 14 : 24) * cluster * (0.55 + 0.45 * e.thrust) * (1 + 0.6 * (1 - airK));
      const [hot, cool] = fuelColours(e.fuel, e.vacuum || airK < 0.3);
      for (const m of slot.mats) {
        const u = m.uniforms;
        u.uLen.value = len; u.uR0.value = cluster; u.uExp.value = exp; u.uThrust.value = e.thrust * (e.vacuum && airK < 0.3 ? 0.55 : 1);
        u.uTime.value = realTime % 1000; u.uDiamonds.value = e.vacuum || e.fuel === 'powder' ? 0 : airK;
        (u.uHot.value as Vector3).copy(hot); (u.uCool.value as Vector3).copy(cool);
        u.uSeed.value = (e.key.length * 7.13) % 10;
      }
      // orient +Y along the exhaust
      _q.setFromUnitVectors(_up, _v.copy(e.dir).normalize());
      if (space) {
        slot.group.position.set(e.pos.x - camSys[0], e.pos.y - camSys[1], e.pos.z - camSys[2]);
        if (slot.group.parent !== this.spaceGroup) this.spaceGroup.add(slot.group);
      } else {
        slot.group.position.copy(e.pos);
        if (slot.group.parent !== P.plumeGroup) P.plumeGroup.add(slot.group);
      }
      slot.group.quaternion.copy(_q);
      slot.group.visible = true;
      // light: a few metres down the plume; the glow on the smoke
      const lp = _a.copy(e.dir).multiplyScalar(len * 0.12).add(e.pos);
      const I = e.thrust * Math.min(3, cluster) * (e.fuel === 'powder' ? 0.2 : 1);
      if (!space) {
        this.lightList.push({ planet: e.planet, x: lp.x, y: lp.y, z: lp.z, reach: Math.min(420, 90 + 70 * cluster) * (0.6 + 0.4 * airK), r: 2.6e5 * I, g: 1.7e5 * I, b: 0.9e5 * I });
        let gl = this.glowList.get(e.planet);
        if (!gl) { gl = []; this.glowList.set(e.planet, gl); }
        gl.push({ x: lp.x, y: lp.y, z: lp.z, w: I, c: hot });
        if (e.planet === primary && ctx) {
          const d = _b.copy(ctx.camBody).sub(e.pos).length();
          shake += e.thrust * Math.min(2, cluster) * 0.45 / (1 + (d / (60 + 40 * cluster)) ** 2) * (0.4 + 0.6 * airK);
        }
      }
    }
    for (const s of this.plumes) if (!s.used) s.group.visible = false;
    // explosion flashes: a light for a second or so
    const now = this.now;
    this.flashes = this.flashes.filter((f) => now - f.t < 1.6 && now >= f.t - 0.1);
    for (const f of this.flashes) {
      const k = Math.max(0, 1 - (now - f.t) / 1.6);
      const I = k * k * 8e5 * f.scale;
      if (f.planet >= 0) this.lightList.push({ planet: f.planet, x: f.x, y: f.y, z: f.z, reach: 260 * Math.min(2, f.scale), r: I, g: I * 0.55, b: I * 0.22 });
    }
    // lights, glow on the smoke, wind
    for (const P of this.planets.values()) {
      const ctx = P.planet >= 0 ? ctxOf(P.planet) : null;
      P.lights.begin();
      for (const l of this.lightList) if (l.planet === P.planet) P.lights.add(l.x, l.y, l.z, l.reach, l.r, l.g, l.b);
      P.lights.end();
      const gl = this.glowList.get(P.planet) ?? [];
      const U = P.puffs.uniforms;
      const gp = U.uGlowP.value as Vector4[], gc = U.uGlowC.value as Vector3[];
      for (let i = 0; i < 4; i++) {
        const g = gl[i];
        if (g) { gp[i].set(g.x, g.y, g.z, g.w); gc[i].copy(g.c); } else gp[i].w = 0;
      }
      if (ctx) (U.uWind.value as Vector3).copy(ctx.wind);
      U.uT.value = now;
      P.puffs.flush();
      // the space frame: puffs are relative to the anchor
      if (P.planet < 0) {
        P.puffs.group.position.set(this.spaceAnchor[0] - camSys[0], this.spaceAnchor[1] - camSys[1], this.spaceAnchor[2] - camSys[2]);
        P.puffs.group.updateMatrix();
        P.puffs.group.matrixAutoUpdate = false;
      }
      P.puffs.group.visible = now - P.puffs.lastBirth < 130;
    }
    this.shakeKick = Math.max(0, this.shakeKick - dt * 0.6);
    const target = Math.min(1, shake + this.shakeKick);
    SHAKE.amp += (target - SHAKE.amp) * Math.min(1, dt * 8);
  }

  /** draw every FX group into the composited HDR image (after the atmosphere), soft against the linear depth */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget | null, depth: Texture, w: number, h: number): void {
    let any = false;
    for (const P of this.planets.values()) {
      if (P.puffs.group.visible || P.lights.mesh.visible) any = true;
      for (const u of [P.puffs.uniforms, P.lights.uniforms]) { u.tSceneDepth.value = depth; (u.uResolution.value as Vector2).set(w, h); }
      P.puffs.uniforms.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    }
    for (const s of this.plumes) {
      if (!s.group.visible) continue;
      any = true;
      for (const m of s.mats) { m.uniforms.tSceneDepth.value = depth; (m.uniforms.uResolution.value as Vector2).set(w, h); m.uniforms.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0; }
    }
    if (!any) return;
    const prevAuto = renderer.autoClear;
    const prevMask = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    camera.layers.set(FX_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    renderer.autoClear = prevAuto;
  }

  /** puff and plume budget from the quality preset (particles per planet) */
  setBudget(particleBudget: number): void {
    this.capacity = Math.max(3000, Math.min(24000, Math.round(particleBudget * 0.45)));
  }

  stats(): { planets: number; plumes: number } {
    return { planets: this.planets.size, plumes: this.plumes.filter((p) => p.group.visible).length };
  }

  dispose(): void {
    for (const p of this.planets.values()) { p.puffs.dispose(); p.lights.dispose(); }
    for (const s of this.plumes) { s.shell.geometry.dispose(); for (const m of s.mats) m.dispose(); }
  }
}

export type { Vector3 };
void _m;
