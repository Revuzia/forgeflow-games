// DYEFIELD — match FX (CONTRACT §11 view/fx.ts). Fixed pools, no per-event allocation.
//
//   * Projectile droplets: ONE InstancedMesh (capacity = the sim's ProjectilePool, 512) of glossy
//     team-coloured drops, stretched along their flight, interpolated between ticks. One draw call.
//   * Particles: ONE GPU ring buffer (InstancedBufferGeometry of quads, 4096 slots, one draw call).
//     An emitter only writes a slot (start position, velocity, start time, life, sizes, colour, kind,
//     gravity, drag); the vertex shader integrates the motion from uTime, so nothing is touched per
//     frame on the CPU except the slots written since the last upload (addUpdateRange).
//     A slot may start in the future (t0 > now): delayed particles are how the tide-spout column and
//     the staggered washed burst are scheduled without timers.
//     kinds: 0 glossy droplet (sphere-shaded billboard) · 1 soft mist puff · 2 ring (oriented to a
//            normal) · 3 spark streak (stretched along its velocity) · 4 flat glossy splash (oriented)
//   * Emitters: splat (impact / drip, oriented to the hit normal), muzzle mist, dry-click puff, hit
//     sparks, slick splash rings, wakes, faint ripples (hidden slickers), the WASHED burst and the
//     tide-spout respawn.
// Colours are the teams.json dyes (linear). Math.random is fine here (view only, never core).

import * as THREE from 'three';
import { teamById } from '../core/data.ts';
import type { TeamId } from '../core/types.ts';

/** the slice of core/combat/projectiles.ts ProjectilePool the view reads (CONTRACT §10.2) */
export interface ProjectileLike {
  count: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  team: Uint8Array;
}

const CAP = 4096;
const DROPS = 512;
const KIND_BLOB = 0, KIND_PUFF = 1, KIND_RING = 2, KIND_SPARK = 3, KIND_SPLASH = 4;

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iNrm;   // normal xyz (oriented kinds), kind
attribute vec4 iT;     // t0, life, size0, size1
attribute vec4 iCol;   // linear rgb, alpha
attribute vec2 iPhys;  // gravity (m/s^2), drag (1/s)
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vK;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  float age = uTime - iT.x;
  float k = age / max(iT.y, 1e-3);
  if (age < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vK = 1.0; return; }
  float drag = iPhys.y;
  float te = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = iPos + iVel * te - vec3(0.0, 0.5 * iPhys.x * age * age, 0.0);
  float size = mix(iT.z, iT.w, k);
  float kind = iNrm.w;
  // per-instance rotation of the quad (variety for splashes / puffs)
  float ang = fract(sin(dot(iPos, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  vec2 c = kind > 2.5 && kind < 3.5 ? corner : vec2(ca * corner.x - sa * corner.y, sa * corner.x + ca * corner.y);
  vec4 mv;
  if ((kind > 1.5 && kind < 2.5) || kind > 3.5) {
    vec3 n = normalize(iNrm.xyz);
    vec3 t = normalize(cross(abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
    vec3 b = cross(n, t);
    p += (t * c.x + b * c.y) * size + n * 0.018;
    mv = viewMatrix * vec4(p, 1.0);
  } else if (kind > 2.5) {
    vec3 vel = iVel * (drag > 0.0 ? exp(-drag * age) : 1.0) - vec3(0.0, iPhys.x * age, 0.0);
    mv = viewMatrix * vec4(p, 1.0);
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
    vec2 side = vec2(-d.y, d.x);
    mv.xy += d * c.x * size * 3.0 + side * c.y * size * 0.45;
  } else {
    mv = viewMatrix * vec4(p, 1.0);
    mv.xy += c * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  vCol = iCol;
  vK = k;
  vKind = kind;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunV;
varying vec2 vUv;
varying vec4 vCol;
varying float vK;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vK >= 1.0) discard;
  vec3 col = vCol.rgb;
  float a = vCol.a;
  float fade = 1.0 - smoothstep(0.6, 1.0, vK);
  if (vKind < 0.5) {
    // glossy droplet: a lit sphere impostor
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - r2)));
    float dif = 0.5 + 0.5 * max(dot(n, uSunV), 0.0);
    float spec = pow(max(dot(reflect(-uSunV, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float rim = pow(1.0 - n.z, 3.0);
    col = col * dif * (1.0 - 0.35 * rim) + vec3(0.9) * spec;
    a *= smoothstep(1.0, 0.82, r2);
    fade = 1.0 - smoothstep(0.85, 1.0, vK);
  } else if (vKind < 1.5) {
    float s = 1.0 - r2;
    a *= s * s;
  } else if (vKind < 2.5) {
    float r = sqrt(r2);
    a *= smoothstep(0.58, 0.8, r) * (1.0 - smoothstep(0.9, 1.0, r));
    fade = 1.0 - vK;
  } else if (vKind < 3.5) {
    a *= 1.0 - r2;
    col = mix(col, vec3(1.0), 0.45);
  } else {
    // flat glossy splash with a lobed, organic edge
    float r = sqrt(r2);
    float ang = atan(vUv.y, vUv.x);
    float edge = 0.8 + 0.1 * sin(ang * 5.0) + 0.07 * sin(ang * 11.0 + 1.7);
    a *= 1.0 - smoothstep(edge - 0.08, edge, r);
    vec3 n = normalize(vec3(vUv * 0.9, 1.0));
    float spec = pow(max(dot(reflect(-uSunV, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);
    col = col * (0.8 + 0.2 * (1.0 - r)) + vec3(0.6) * spec;
  }
  gl_FragColor = vec4(col, a * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface Attr { a: THREE.InstancedBufferAttribute; arr: Float32Array; n: number }

export class Fx {
  readonly root = new THREE.Group();
  readonly drops: THREE.InstancedMesh;
  readonly particles: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly aPos: Attr; private readonly aVel: Attr; private readonly aNrm: Attr;
  private readonly aT: Attr; private readonly aCol: Attr; private readonly aPhys: Attr;
  private head = 0;
  private dirtyLo = -1;
  private dirtyN = 0;
  private time = 0;
  private readonly sunDir: THREE.Vector3;
  private readonly teamCol: Record<number, THREE.Color>;
  private readonly teamLight: Record<number, THREE.Color>;
  private readonly white = new THREE.Color(0xf4fbff);
  private readonly mist = new THREE.Color(0xe8f6ff);
  private readonly grey = new THREE.Color(0x9aa3ad);
  // drops scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  private lastDropTeams = new Uint8Array(DROPS);
  private wakeN = 0;
  /** emitted particle count (stats) */
  emitted = 0;
  /** skipped emissions (beyond the FX range) */
  culled = 0;
  /** camera position of the last update (emitters cull by distance: no fill spent on far FX) */
  private readonly eye = new THREE.Vector3(0, 1e6, 0);

  constructor(sunDir: THREE.Vector3) {
    this.sunDir = sunDir;
    this.root.name = 'fx';
    const c1 = new THREE.Color(teamById(1).dye), c2 = new THREE.Color(teamById(2).dye);
    const n = new THREE.Color(0xdfe6ee);
    this.teamCol = { 0: n, 1: c1, 2: c2 };
    this.teamLight = { 0: n, 1: c1.clone().lerp(new THREE.Color(teamById(1).dyeGloss), 0.35), 2: c2.clone().lerp(new THREE.Color(teamById(2).dyeGloss), 0.35) };

    // ── projectile droplets
    const dropGeo = new THREE.IcosahedronGeometry(1, 1);
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0 });
    dropMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor * 0.35;\n#endif');
    };
    dropMat.customProgramCacheKey = () => 'df-drop-v1';
    this.drops = new THREE.InstancedMesh(dropGeo, dropMat, DROPS);
    this.drops.name = 'fx_drops';
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.castShadow = false;
    this.drops.receiveShadow = false;
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < DROPS; i++) { this.drops.setColorAt(i, this.teamLight[1]); this.lastDropTeams[i] = 1; }
    this.drops.instanceColor!.setUsage(THREE.DynamicDrawUsage);

    // ── particle ring buffer
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name: string, n: number): Attr => {
      const arr = new Float32Array(CAP * n);
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return { a, arr, n };
    };
    this.aPos = mk('iPos', 3); this.aVel = mk('iVel', 3); this.aNrm = mk('iNrm', 4);
    this.aT = mk('iT', 4); this.aCol = mk('iCol', 4); this.aPhys = mk('iPhys', 2);
    // every slot starts dead (t0 far in the past, life tiny)
    for (let i = 0; i < CAP; i++) { this.aT.arr[i * 4] = -1e6; this.aT.arr[i * 4 + 1] = 0.001; }
    g.instanceCount = CAP;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSunV: { value: new THREE.Vector3(0, 1, 0) } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mat.name = 'fx_particles';
    this.particles = new THREE.Mesh(g, this.mat);
    this.particles.name = 'fx_particles';
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
    this.root.add(this.drops, this.particles);
  }

  // ───────────────────────────── low level ─────────────────────────────
  private slot(px: number, py: number, pz: number, vx: number, vy: number, vz: number,
    kind: number, life: number, s0: number, s1: number, col: THREE.Color, alpha: number,
    grav: number, drag: number, nx = 0, ny = 0, nz = 0, delay = 0): void {
    const i = this.head;
    this.head = (this.head + 1) % CAP;
    this.aPos.arr[i * 3] = px; this.aPos.arr[i * 3 + 1] = py; this.aPos.arr[i * 3 + 2] = pz;
    this.aVel.arr[i * 3] = vx; this.aVel.arr[i * 3 + 1] = vy; this.aVel.arr[i * 3 + 2] = vz;
    this.aNrm.arr[i * 4] = nx; this.aNrm.arr[i * 4 + 1] = ny; this.aNrm.arr[i * 4 + 2] = nz; this.aNrm.arr[i * 4 + 3] = kind;
    this.aT.arr[i * 4] = this.time + delay; this.aT.arr[i * 4 + 1] = life; this.aT.arr[i * 4 + 2] = s0; this.aT.arr[i * 4 + 3] = s1;
    this.aCol.arr[i * 4] = col.r; this.aCol.arr[i * 4 + 1] = col.g; this.aCol.arr[i * 4 + 2] = col.b; this.aCol.arr[i * 4 + 3] = alpha;
    this.aPhys.arr[i * 2] = grav; this.aPhys.arr[i * 2 + 1] = drag;
    if (this.dirtyN === 0) this.dirtyLo = i;
    this.dirtyN = Math.min(CAP, this.dirtyN + 1);
    this.emitted++;
  }

  private col(team: number): THREE.Color { return this.teamCol[team] ?? this.teamCol[0]; }

  /** squared distance from the camera (last frame) */
  private d2(x: number, y: number, z: number): number {
    const dx = x - this.eye.x, dy = y - this.eye.y, dz = z - this.eye.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** random unit vector in the hemisphere around n, biased toward it (k = spread 0..1) */
  private hemi(nx: number, ny: number, nz: number, k: number): void {
    for (let t = 0; t < 6; t++) {
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = x * x + y * y + z * z;
      if (l > 1 || l < 1e-4) continue;
      const il = 1 / Math.sqrt(l);
      let dx = nx * (1 - k) + x * il * k, dy = ny * (1 - k) + y * il * k, dz = nz * (1 - k) + z * il * k;
      if (dx * nx + dy * ny + dz * nz < 0) { dx = -dx + 2 * nx; dy = -dy + 2 * ny; dz = -dz + 2 * nz; }
      const dl = Math.hypot(dx, dy, dz) || 1;
      this.d.set(dx / dl, dy / dl, dz / dl);
      return;
    }
    this.d.set(nx, ny, nz);
  }

  // ───────────────────────────── emitters ─────────────────────────────
  /** impact (r ≥ 0.7) or drip splat on a surface: a flat glossy splash + flying droplets */
  splat(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, team: TeamId): void {
    const d2 = this.d2(x, y, z);
    const big = r >= 0.7;
    // beyond 55 m nothing reads; beyond 30 m only an impact's splash; drips only within 22 m
    if (d2 > 55 * 55 || (!big && d2 > 22 * 22)) { this.culled++; return; }
    const c = this.col(team);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { nx = 0; ny = 1; nz = 0; } else { nx /= nl; ny /= nl; nz /= nl; }
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, big ? 0.3 : 0.22, r * 0.35, r * (big ? 0.9 : 0.7), c, 0.9, 0, 0, nx, ny, nz);
    if (d2 > 30 * 30) return;
    const drops = big ? (d2 < 12 * 12 ? 6 : 4) : 1;
    for (let i = 0; i < drops; i++) {
      this.hemi(nx, ny, nz, 0.75);
      const sp = (big ? 2.2 : 1.2) + Math.random() * (big ? 3.2 : 1.4);
      const sz = (big ? 0.05 : 0.035) + Math.random() * 0.045;
      this.slot(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, this.d.x * sp, this.d.y * sp, this.d.z * sp,
        KIND_BLOB, 0.35 + Math.random() * 0.3, sz, sz * 0.5, c, 1, 14, 0.6);
    }
    if (big && d2 < 18 * 18) this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.26, r * 0.3, r * 1.1, this.teamLight[team] ?? c, 0.5, 0, 0, nx, ny, nz);
  }

  /** muzzle mist along the shot direction */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, team: TeamId): void {
    if (this.d2(x, y, z) > 35 * 35) { this.culled++; return; }
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const c = this.teamLight[team] ?? this.col(team);
    for (let i = 0; i < 2; i++) {
      const sp = 1.6 + Math.random() * 1.8;
      const jx = (Math.random() - 0.5) * 0.8, jy = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8;
      this.slot(x, y, z, (dx + jx * 0.3) * sp, (dy + jy * 0.3) * sp + 0.2, (dz + jz * 0.3) * sp, KIND_PUFF,
        0.22 + Math.random() * 0.1, 0.05, 0.24, this.mist, 0.4, -0.5, 4);
    }
    this.slot(x, y, z, dx * 3, dy * 3, dz * 3, KIND_BLOB, 0.12, 0.06, 0.03, c, 1, 0, 6);
  }

  /** empty-tank click: a small grey puff + two dull drips at the muzzle */
  dryPuff(x: number, y: number, z: number): void {
    this.slot(x, y, z, 0, 0.35, 0, KIND_PUFF, 0.35, 0.05, 0.2, this.grey, 0.55, -0.4, 3);
    for (let i = 0; i < 2; i++) {
      this.slot(x, y, z, (Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6, KIND_BLOB, 0.4, 0.025, 0.015, this.grey, 1, 9, 1);
    }
  }

  /** a hit on a runner: sparks + a burst of the attacker's dye */
  hitSparks(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    for (let i = 0; i < 7; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 3 + Math.random() * 3.5;
      this.slot(x, y, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_SPARK, 0.18 + Math.random() * 0.1, 0.035, 0.012, this.white, 0.95, 8, 3);
    }
    for (let i = 0; i < 4; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 2 + Math.random() * 2.5;
      this.slot(x, y, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_BLOB, 0.4, 0.06, 0.03, c, 1, 14, 0.5);
    }
  }

  /** slick in / out (big = the respawn landing): a ring on the floor + a splash of droplets */
  slickRing(x: number, y: number, z: number, team: TeamId, big: boolean): void {
    const c = this.col(team);
    this.slot(x, y, z, 0, 0, 0, KIND_RING, big ? 0.55 : 0.4, 0.15, big ? 1.8 : 1.05, this.teamLight[team] ?? c, 0.85, 0, 0, 0, 1, 0);
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, big ? 0.5 : 0.3, 0.2, big ? 1.1 : 0.6, c, 0.85, 0, 0, 0, 1, 0);
    const n = big ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (big ? 2.4 : 1.5) + Math.random() * 1.5;
      this.slot(x, y + 0.05, z, Math.cos(a) * sp, 2 + Math.random() * 2.5, Math.sin(a) * sp, KIND_BLOB, 0.45, 0.05, 0.025, c, 1, 16, 0.4);
    }
  }

  /** a moving slicker's wake: a flat splash in its dye + a kicked droplet (vertical = wall-slick) */
  wake(x: number, y: number, z: number, vx: number, vz: number, team: TeamId, strength: number, wall: boolean): void {
    const c = this.col(team);
    const l = Math.hypot(vx, vz) || 1;
    if (wall) {
      this.slot(x, y, z, 0, -0.2, 0, KIND_SPLASH, 0.35, 0.12, 0.3, c, 0.75, 0, 0, -vx / l, 0, -vz / l);
      this.slot(x, y, z, (Math.random() - 0.5) * 0.8, -0.5, (Math.random() - 0.5) * 0.8, KIND_BLOB, 0.4, 0.04, 0.02, c, 1, 12, 0.5);
      return;
    }
    const d2 = this.d2(x, y, z);
    if (d2 > 60 * 60) { this.culled++; return; }
    this.slot(x, y, z, 0, 0, 0, KIND_SPLASH, 0.45, 0.12 + 0.1 * strength, 0.32 + 0.18 * strength, c, 0.7, 0, 0, 0, 1, 0);
    this.wakeN++;
    if ((this.wakeN & 1) === 0 && d2 < 30 * 30) this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.5, 0.16, 0.45 + 0.25 * strength, this.teamLight[team] ?? c, 0.28 * strength + 0.12, 0, 0, 0, 1, 0);
    if (d2 < 25 * 25 && Math.random() < 0.5) {
      const sx = -vx / l, sz = -vz / l;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.slot(x, y + 0.05, z, (sx * 0.8 + sz * side * 0.9) * 1.6, 1.4 + Math.random() * 1.4, (sz * 0.8 - sx * side * 0.9) * 1.6,
        KIND_BLOB, 0.4, 0.045, 0.02, c, 1, 14, 0.4);
    }
  }

  /** the faint ripple of a still (or hidden) slicker */
  ripple(x: number, y: number, z: number, team: TeamId, alpha: number): void {
    this.slot(x, y, z, 0, 0, 0, KIND_RING, 0.9, 0.12, 0.7, this.teamLight[team] ?? this.col(team), alpha, 0, 0, 0, 1, 0);
  }

  /** WASHED: a big burst of the attacker's dye (team = the attacker's crew) */
  washedBurst(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    const cy = y + 0.6;
    for (let i = 0; i < 34; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 2.5 + Math.random() * 5.5;
      const sz = 0.04 + Math.random() * 0.06;
      this.slot(x, cy, z, this.d.x * sp, this.d.y * sp + 1.2, this.d.z * sp, KIND_BLOB, 0.55 + Math.random() * 0.45, sz, sz * 0.4, c, 1, 15, 0.5, 0, 0, 0, i < 12 ? 0 : Math.random() * 0.06);
    }
    for (let i = 0; i < 6; i++) {
      this.hemi(0, 1, 0, 1);
      this.slot(x, cy, z, this.d.x * 1.5, this.d.y * 1.5, this.d.z * 1.5, KIND_PUFF, 0.5, 0.25, 0.9, this.teamLight[team] ?? c, 0.55, -0.3, 2.5);
    }
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_RING, 0.5, 0.3, 2.6, this.teamLight[team] ?? c, 0.9, 0, 0, 0, 1, 0);
    this.slot(x, y + 0.02, z, 0, 0, 0, KIND_SPLASH, 0.7, 0.4, 1.9, c, 0.9, 0, 0, 0, 1, 0);
    for (let i = 0; i < 10; i++) {
      this.hemi(0, 1, 0, 1);
      const sp = 5 + Math.random() * 4;
      this.slot(x, cy, z, this.d.x * sp, this.d.y * sp, this.d.z * sp, KIND_SPARK, 0.22, 0.05, 0.015, this.white, 1, 6, 2.5);
    }
  }

  /** the tide-spout respawn: a rising column of dye + sea spray over ~0.6 s, then a splash */
  spout(x: number, y: number, z: number, team: TeamId): void {
    const c = this.col(team);
    for (let i = 0; i < 26; i++) {
      const delay = (i / 26) * 0.5;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.35;
      this.slot(x + Math.cos(a) * rr, y + 0.05, z + Math.sin(a) * rr, Math.cos(a) * 0.4, 5 + Math.random() * 4, Math.sin(a) * 0.4,
        KIND_BLOB, 0.5 + Math.random() * 0.2, 0.07 + Math.random() * 0.06, 0.03, i % 3 === 0 ? this.white : c, 1, 12, 0.3, 0, 0, 0, delay);
    }
    for (let i = 0; i < 6; i++) {
      this.slot(x, y + 0.2 + i * 0.4, z, 0, 1.5, 0, KIND_PUFF, 0.6, 0.3, 0.7, this.mist, 0.35, -0.2, 2, 0, 0, 0, i * 0.06);
    }
    this.slot(x, y + 0.03, z, 0, 0, 0, KIND_RING, 0.7, 0.3, 1.6, this.teamLight[team] ?? c, 0.8, 0, 0, 0, 1, 0);
  }

  // ───────────────────────────── per frame ─────────────────────────────
  /** advance the particle clock, upload the written slots, place the projectile droplets */
  update(dt: number, camera: THREE.Camera, drops: ProjectileLike | null, alpha: number): void {
    this.time += dt;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.mat.uniforms.uTime.value = this.time;
    (this.mat.uniforms.uSunV.value as THREE.Vector3).copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    if (this.dirtyN > 0) {
      const lo = this.dirtyLo, n = this.dirtyN;
      for (const at of [this.aPos, this.aVel, this.aNrm, this.aT, this.aCol, this.aPhys]) {
        at.a.clearUpdateRanges();
        if (lo + n <= CAP) at.a.addUpdateRange(lo * at.n, n * at.n);
        else { at.a.addUpdateRange(lo * at.n, (CAP - lo) * at.n); at.a.addUpdateRange(0, (lo + n - CAP) * at.n); }
        at.a.needsUpdate = true;
      }
      this.dirtyN = 0;
    }
    this.placeDrops(drops, alpha);
  }

  private placeDrops(pool: ProjectileLike | null, alpha: number): void {
    const dm = this.drops;
    const n = pool ? Math.min(pool.count, DROPS) : 0;
    let colorDirty = false;
    for (let i = 0; i < n; i++) {
      const p = pool!;
      const x0 = p.px[i], y0 = p.py[i], z0 = p.pz[i];
      this.p.set(x0 + (p.x[i] - x0) * alpha, y0 + (p.y[i] - y0) * alpha, z0 + (p.z[i] - z0) * alpha);
      this.d.set(p.x[i] - x0, p.y[i] - y0, p.z[i] - z0);
      const len = this.d.length();
      const r = 0.075;
      if (len > 1e-5) {
        this.d.multiplyScalar(1 / len);
        this.q.setFromUnitVectors(Fx.Z, this.d);
        this.s.set(r * 0.85, r * 0.85, r * Math.min(2.6, 1 + len * 3));
      } else {
        this.q.identity();
        this.s.set(r, r, r);
      }
      this.m4.compose(this.p, this.q, this.s);
      dm.setMatrixAt(i, this.m4);
      const t = p.team[i];
      if (t !== this.lastDropTeams[i]) {
        this.lastDropTeams[i] = t;
        dm.setColorAt(i, this.teamLight[t] ?? this.col(t));
        colorDirty = true;
      }
    }
    dm.count = n;
    if (n > 0) {
      dm.instanceMatrix.clearUpdateRanges();
      dm.instanceMatrix.addUpdateRange(0, n * 16);
      dm.instanceMatrix.needsUpdate = true;
    }
    if (colorDirty && dm.instanceColor) dm.instanceColor.needsUpdate = true;
  }

  /** kill every live particle (match restart) */
  clear(): void {
    for (let i = 0; i < CAP; i++) { this.aT.arr[i * 4] = -1e6; this.aT.arr[i * 4 + 1] = 0.001; }
    this.aT.a.clearUpdateRanges();
    this.aT.a.needsUpdate = true;
    this.dirtyN = 0;
    this.drops.count = 0;
  }

  dispose(): void {
    this.drops.geometry.dispose();
    (this.drops.material as THREE.Material).dispose();
    this.particles.geometry.dispose();
    this.mat.dispose();
    this.root.removeFromParent();
  }
}
