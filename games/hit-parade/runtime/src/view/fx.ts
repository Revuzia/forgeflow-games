// HIT PARADE - impact FX (CONTRACT §7 "FX"; DESIGN pillar 1 "every hit is a show"; owner rule: comic red splatter with a
// settings toggle to sparks / confetti, NO realistic gore).
//
// Everything is pooled and allocated at construction (no program links or buffer growth mid-bout):
//   * Particles: two GPU-animated InstancedMeshes (additive light: sparks, flashes, rings / alpha: splatter, confetti,
//     dust). A spawn writes one instance's start state (position, velocity, birth time, life, sizes, spin, colour,
//     atlas cell, gravity, drag, velocity-stretch); the vertex shader integrates the ballistic path and billboards the
//     quad (or stretches it along its screen-space velocity), so the CPU cost is the spawn only. Dead instances
//     collapse to zero size. FX time runs at the slow-mo rate (KO x0.25).
//   * Decals: one InstancedMesh of oriented quads (wall-splat splats on the set walls at x = +-8 m, floor splats) that
//     fade out; polygon offset against z-fighting.
//   * Screen layer (view/post.ts GradePass): flash, speed lines / finish-zoom lines around the impact's screen point.
//   * Background dim for super freezes: a camera-facing black plane parked just behind the fighters' depth, so the
//     set darkens and the fighters stay lit (no mask pass needed).
//   * Projectiles: per-slot additive core sprites + trail particles (a per-fighter style hook, `projectileStyle`).
// The sprite atlas is procedural (canvas, 4 x 4 cells): FX sprites are not hero assets.

import * as THREE from 'three';
import type { Post } from './post.ts';
import type { FightCamera } from './camera.ts';

export type GoreMode = 'splatter' | 'sparks' | 'confetti';
export type HitKind = 'hit' | 'counter' | 'punish' | 'block' | 'parry' | 'perfect' | 'armor' | 'throw' | 'clash';

/** atlas cells */
const C = {
  STAR: 0, GLOW: 1, STREAK: 2, BLOB_A: 3, BLOB_B: 4, DROP: 5, RING: 6, CHEVRON: 7,
  CONF_RECT: 8, CONF_RIB: 9, DUST: 10, POW: 11, RING_THICK: 12, TWINKLE: 13, WALL_SPLAT: 14, SCORCH: 15,
} as const;

// ───────────────────────────────────────── procedural sprite atlas ─────────────────────────────────────────

function drawAtlas(): HTMLCanvasElement {
  const N = 4, S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N * S;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cell = (i: number, fn: (cx: number, cy: number) => void) => {
    const x = (i % N) * S, y = Math.floor(i / N) * S;
    g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
    fn(x + S / 2, y + S / 2);
    g.restore();
  };
  const star = (cx: number, cy: number, spikes: number, r0: number, r1: number, jitter: number) => {
    g.beginPath();
    for (let k = 0; k < spikes * 2; k++) {
      const a = (k / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = (k % 2 === 0 ? r1 * (1 - jitter * rnd()) : r0);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  };
  const blob = (cx: number, cy: number, r: number, lobes: number, amp: number) => {
    g.beginPath();
    const n = 64;
    const ph = rnd() * 6.28, ph2 = rnd() * 6.28;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (1 + amp * Math.sin(a * lobes + ph) * 0.6 + amp * 0.4 * Math.sin(a * (lobes + 3) + ph2));
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  };
  g.clearRect(0, 0, cv.width, cv.height);
  // 0 STAR: sharp comic hit star, white with soft core
  cell(C.STAR, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 120);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    star(cx, cy, 12, 26, 122, 0.45); g.fillStyle = gr; g.fill();
  });
  // 1 GLOW
  cell(C.GLOW, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 124);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(cx - 128, cy - 128, 256, 256);
  });
  // 2 STREAK: horizontal spark line (stretched along velocity in the shader)
  cell(C.STREAK, (cx, cy) => {
    const gr = g.createLinearGradient(cx - 120, cy, cx + 120, cy);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(cx, cy, 120, 14, 0, 0, Math.PI * 2); g.fill();
  });
  // 3/4 BLOB: comic paint splat blobs (flat colour; the shader tints)
  cell(C.BLOB_A, (cx, cy) => { blob(cx, cy, 78, 7, 0.28); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(cx + 70, cy - 60, 16, 0, 7); g.arc(cx - 84, cy + 40, 11, 0, 7); g.fill(); });
  cell(C.BLOB_B, (cx, cy) => { blob(cx, cy, 70, 5, 0.38); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(cx - 60, cy - 72, 13, 0, 7); g.arc(cx + 88, cy + 20, 9, 0, 7); g.arc(cx + 30, cy + 92, 12, 0, 7); g.fill(); });
  // 5 DROP: teardrop pointing +x (velocity-stretched)
  cell(C.DROP, (cx, cy) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + 40, cy, 46, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - 110, cy); g.quadraticCurveTo(cx - 10, cy - 46, cx + 40, cy - 46); g.lineTo(cx + 40, cy + 46);
    g.quadraticCurveTo(cx - 10, cy + 46, cx - 110, cy); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.0)';
  });
  // 6 RING thin
  cell(C.RING, (cx, cy) => { g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 110, 0, Math.PI * 2); g.stroke(); });
  // 7 CHEVRON: block spark (a bright arc)
  cell(C.CHEVRON, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { g.lineWidth = 16 - k * 4; g.beginPath(); g.arc(cx - 40 - k * 18, cy, 90 + k * 12, -0.9, 0.9); g.stroke(); }
  });
  // 8 CONFETTI rect, 9 ribbon
  cell(C.CONF_RECT, (cx, cy) => { g.fillStyle = '#fff'; g.fillRect(cx - 70, cy - 42, 140, 84); });
  cell(C.CONF_RIB, (cx, cy) => {
    g.strokeStyle = '#fff'; g.lineWidth = 26; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 100, cy);
    g.bezierCurveTo(cx - 40, cy - 80, cx + 40, cy + 80, cx + 100, cy); g.stroke();
  });
  // 10 DUST: noisy soft puff
  cell(C.DUST, (cx, cy) => {
    for (let k = 0; k < 26; k++) {
      const a = rnd() * 6.28, r = rnd() * 60, rr = 30 + rnd() * 40;
      const gr = g.createRadialGradient(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0, cx + Math.cos(a) * r, cy + Math.sin(a) * r, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(cx - 128, cy - 128, 256, 256);
    }
  });
  // 11 POW: chunky comic starburst with a dark outline ring baked as alpha edge
  cell(C.POW, (cx, cy) => {
    star(cx, cy, 11, 60, 124, 0.3); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
  });
  // 12 RING thick (shock wave)
  cell(C.RING_THICK, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 70, cx, cy, 124);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(cx - 128, cy - 128, 256, 256);
  });
  // 13 TWINKLE: 4-point sparkle
  cell(C.TWINKLE, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 120);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    star(cx, cy, 4, 14, 124, 0); g.fillStyle = gr; g.fill();
  });
  // 14 WALL_SPLAT: a big multi-blob comic splat with drips
  cell(C.WALL_SPLAT, (cx, cy) => {
    g.fillStyle = '#fff';
    blob(cx, cy - 10, 62, 9, 0.35); g.fill();
    for (let k = 0; k < 9; k++) {
      const a = rnd() * 6.28, d = 70 + rnd() * 40, r = 6 + rnd() * 14;
      g.beginPath(); g.arc(cx + Math.cos(a) * d, cy - 10 + Math.sin(a) * d * 0.9, r, 0, 7); g.fill();
    }
    for (let k = 0; k < 4; k++) {                       // drips
      const x = cx - 40 + k * 26 + rnd() * 10, len = 40 + rnd() * 60;
      g.fillRect(x - 5, cy + 20, 10, len); g.beginPath(); g.arc(x, cy + 20 + len, 8, 0, 7); g.fill();
    }
  });
  // 15 SCORCH: dark star burst (sparks-mode wall mark)
  cell(C.SCORCH, (cx, cy) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 120);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    star(cx, cy, 16, 40, 122, 0.5); g.fillStyle = gr; g.fill();
  });
  return cv;
}

// ───────────────────────────────────────── GPU particles ─────────────────────────────────────────

const P_VERT = /* glsl */`
attribute vec4 aP0;   // start xyz, birth time
attribute vec4 aV;    // velocity xyz, life
attribute vec4 aS;    // size0, size1, rot0, spin
attribute vec4 aC;    // rgb, alpha
attribute vec4 aX;    // cell, gravity, drag, stretch
uniform float uTime;
varying vec2 vUv;
varying vec4 vC;
varying float vAge;
void main() {
  float t = uTime - aP0.w;
  float life = max( aV.w, 1e-3 );
  float age = t / life;
  if ( t < 0.0 || age > 1.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vC = vec4( 0.0 ); vUv = vec2( 0.0 ); vAge = 1.0; return; }
  float drag = aX.z;
  float k = drag > 0.0 ? ( 1.0 - exp( -drag * t ) ) / drag : t;
  vec3 vel = aV.xyz * ( drag > 0.0 ? exp( -drag * t ) : 1.0 ) + vec3( 0.0, -aX.y * t, 0.0 );
  vec3 wp = aP0.xyz + aV.xyz * k + vec3( 0.0, -0.5 * aX.y * t * t, 0.0 );
  float size = mix( aS.x, aS.y, age );
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  vec2 q = position.xy;
  float ang = aS.z + aS.w * t;
  vec2 axisX = vec2( cos( ang ), sin( ang ) );
  float len = 1.0;
  if ( aX.w > 0.0 ) {
    vec3 vv = ( viewMatrix * vec4( vel, 0.0 ) ).xyz;
    vec2 sv = vv.xy; float sl = length( sv );
    if ( sl > 1e-4 ) { axisX = sv / sl; len = 1.0 + aX.w * sl; }
  }
  vec2 axisY = vec2( -axisX.y, axisX.x );
  mv.xy += ( axisX * q.x * len + axisY * q.y ) * size;
  gl_Position = projectionMatrix * mv;
  float cell = aX.x;
  vUv = ( vec2( mod( cell, 4.0 ), 3.0 - floor( cell / 4.0 ) ) + uv ) * 0.25;
  vC = aC;
  vAge = age;
}
`;
const P_FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform float uAdd;
varying vec2 vUv;
varying vec4 vC;
varying float vAge;
void main() {
  vec4 tx = texture2D( uAtlas, vUv );
  float fade = 1.0 - smoothstep( 0.55, 1.0, vAge );
  float a = tx.a * vC.a * fade;
  if ( a < 0.02 ) discard;
  vec3 col = vC.rgb * tx.rgb;
  gl_FragColor = uAdd > 0.5 ? vec4( col * a, 1.0 ) : vec4( col, a );
}
`;

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private next = 0;
  private readonly aP0: THREE.InstancedBufferAttribute;
  private readonly aV: THREE.InstancedBufferAttribute;
  private readonly aS: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aX: THREE.InstancedBufferAttribute;
  private dirty = false;
  readonly uniforms: { uTime: { value: number }; uAtlas: { value: THREE.Texture }; uAdd: { value: number } };
  spawned = 0;

  constructor(cap: number, atlas: THREE.Texture, additive: boolean, name: string) {
    this.cap = cap;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aP0 = mk(); this.aV = mk(); this.aS = mk(); this.aC = mk(); this.aX = mk();
    for (let i = 0; i < cap; i++) { this.aP0.setW(i, -1e6); this.aV.setW(i, 0.001); }
    geo.setAttribute('aP0', this.aP0); geo.setAttribute('aV', this.aV); geo.setAttribute('aS', this.aS);
    geo.setAttribute('aC', this.aC); geo.setAttribute('aX', this.aX);
    geo.instanceCount = cap;
    this.uniforms = { uTime: { value: 0 }, uAtlas: { value: atlas }, uAdd: { value: additive ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      name, uniforms: this.uniforms, vertexShader: P_VERT, fragmentShader: P_FRAG,
      // additive sparks / flashes / rings draw on top (fighting-game convention: a hit spark is never hidden by the
      // victim's own head in a close cinematic shot); splatter / confetti / dust keep the depth test
      transparent: true, depthWrite: false, depthTest: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  spawn(time: number, p: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, rot: number, spin: number,
    col: THREE.Color, alpha: number, cell: number, grav: number, drag: number, stretch: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.aP0.setXYZW(i, p.x, p.y, p.z, time);
    this.aV.setXYZW(i, v.x, v.y, v.z, life);
    this.aS.setXYZW(i, s0, s1, rot, spin);
    this.aC.setXYZW(i, col.r, col.g, col.b, alpha);
    this.aX.setXYZW(i, cell, grav, drag, stretch);
    this.dirty = true;
    this.spawned++;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
    if (this.dirty) {
      this.aP0.needsUpdate = true; this.aV.needsUpdate = true; this.aS.needsUpdate = true;
      this.aC.needsUpdate = true; this.aX.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ───────────────────────────────────────── decals ─────────────────────────────────────────

const D_VERT = /* glsl */`
attribute vec4 aD;   // cell, birth, life, unused
attribute vec4 aDC;  // rgb, alpha
uniform float uTime;
varying vec2 vUv; varying vec4 vC;
void main() {
  float t = uTime - aD.y;
  float fade = ( t < 0.0 || t > aD.z ) ? 0.0 : 1.0 - smoothstep( aD.z - 1.2, aD.z, t );
  float grow = 0.55 + 0.45 * smoothstep( 0.0, 0.08, t );
  vec3 p = position * grow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( p, 1.0 );
  vUv = ( vec2( mod( aD.x, 4.0 ), 3.0 - floor( aD.x / 4.0 ) ) + uv ) * 0.25;
  vC = vec4( aDC.rgb, aDC.a * fade );
}
`;
const D_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vC;
void main() {
  vec4 tx = texture2D( uAtlas, vUv );
  float a = tx.a * vC.a;
  if ( a < 0.03 ) discard;
  gl_FragColor = vec4( vC.rgb * tx.rgb, a );
}
`;

class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private next = 0;
  private readonly aD: THREE.InstancedBufferAttribute;
  private readonly aDC: THREE.InstancedBufferAttribute;
  readonly uniforms: { uTime: { value: number }; uAtlas: { value: THREE.Texture } };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  count = 0;

  constructor(cap: number, atlas: THREE.Texture) {
    this.cap = cap;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aD = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aDC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.aD.setXYZW(i, 0, -1e6, 0.001, 0);
    geo.setAttribute('aD', this.aD);
    geo.setAttribute('aDC', this.aDC);
    this.uniforms = { uTime: { value: 0 }, uAtlas: { value: atlas } };
    const mat = new THREE.ShaderMaterial({
      name: 'fx-decal', uniforms: this.uniforms, vertexShader: D_VERT, fragmentShader: D_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'fx-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
  }

  add(time: number, pos: THREE.Vector3, normal: THREE.Vector3, size: number, rot: number, cell: number, col: THREE.Color,
    alpha: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot));
    this.m.compose(pos, this.q, this.s.set(size, size, size));
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aD.setXYZW(i, cell, time, life, 0);
    this.aDC.setXYZW(i, col.r, col.g, col.b, alpha);
    this.aD.needsUpdate = true;
    this.aDC.needsUpdate = true;
    this.count++;
  }

  update(time: number): void { this.uniforms.uTime.value = time; }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ───────────────────────────────────────── the system ─────────────────────────────────────────

export interface ProjectileStyle { color: THREE.ColorRepresentation; size: number; trail: THREE.ColorRepresentation; cell?: number }
export type ProjectileStyleFn = (owner: number, moveId: number) => ProjectileStyle;
export interface FxProjectile { slot: number; owner: number; x: number; y: number; vx?: number; moveId?: number; alive?: boolean | number }

const DEFAULT_PROJ: ProjectileStyle = { color: 0xffb040, size: 0.55, trail: 0xff5a1f };

/** colours per strength / kind (linear values; the post chain tone-maps) */
const COL = {
  hitCore: new THREE.Color(1.0, 0.95, 0.8),
  hitSpark: new THREE.Color(1.0, 0.62, 0.18),
  counter: new THREE.Color(1.0, 0.25, 0.08),
  punish: new THREE.Color(1.0, 0.1, 0.45),
  punishCore: new THREE.Color(1.0, 0.85, 0.1),
  block: new THREE.Color(0.35, 0.8, 1.0),
  parry: new THREE.Color(0.55, 0.9, 1.0),
  armor: new THREE.Color(1.0, 0.4, 0.05),
  red: new THREE.Color(0.78, 0.02, 0.06),
  redDark: new THREE.Color(0.42, 0.0, 0.03),
  redHi: new THREE.Color(0.95, 0.1, 0.12),
  dust: new THREE.Color(0.62, 0.56, 0.5),
  white: new THREE.Color(1, 1, 1),
};
const CONFETTI = [0xff2d55, 0xffd400, 0x00d9ff, 0x7cff4f, 0xff7a00, 0xb266ff, 0xffffff].map((c) => new THREE.Color(c));

export class FxSystem {
  readonly group = new THREE.Group();
  mode: GoreMode = 'splatter';
  reduceFlashing = false;
  time = 0;
  private readonly atlas: THREE.CanvasTexture;
  private readonly add: ParticlePool;
  private readonly alpha: ParticlePool;
  private readonly decals: DecalPool;
  private readonly dim: THREE.Mesh;
  private dimNow = 0;
  dimTarget = 0;
  /** metres along the camera's forward to park the dim plane (BoutView: just behind the farther fighter) */
  dimDepth = 0;
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private flashHold = 0;
  private lines = 0;
  private linesHold = 0;
  private linesDecay = 3;
  private linesAt = new THREE.Vector2(0.5, 0.5);
  private linesColor = new THREE.Color(1, 1, 1);
  private linesInner = 0.22;
  private linesSeed = 0;
  private readonly post: Post;
  private readonly cam: FightCamera;
  private readonly projCores: THREE.Sprite[] = [];
  private projStyle: ProjectileStyleFn = () => DEFAULT_PROJ;
  private seed = 12345;
  private readonly v0 = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly c0 = new THREE.Color();
  /** counters for the lab / harness */
  readonly stats = { hits: 0, splats: 0, wall: 0, rings: 0 };

  constructor(scene: THREE.Scene, post: Post, cam: FightCamera) {
    this.post = post;
    this.cam = cam;
    this.group.name = 'fx';
    this.atlas = new THREE.CanvasTexture(drawAtlas());
    this.atlas.colorSpace = THREE.NoColorSpace;
    this.atlas.generateMipmaps = true;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.add = new ParticlePool(768, this.atlas, true, 'fx-add');
    this.alpha = new ParticlePool(768, this.atlas, false, 'fx-alpha');
    this.decals = new DecalPool(48, this.atlas);
    this.group.add(this.add.mesh, this.alpha.mesh, this.decals.mesh);
    const dm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
    dm.name = 'fx-dim';
    this.dim = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), dm);
    this.dim.name = 'fx-dim';
    this.dim.frustumCulled = false;
    this.dim.renderOrder = 2;
    this.dim.visible = true;
    this.group.add(this.dim);
    for (let i = 0; i < 12; i++) {
      const tex = this.atlas.clone();
      tex.repeat.set(0.25, 0.25);
      tex.offset.set((C.GLOW % 4) * 0.25, (3 - Math.floor(C.GLOW / 4)) * 0.25);
      const sm = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const sp = new THREE.Sprite(sm);
      sp.visible = false;
      sp.name = 'fx-proj-' + i;
      sp.renderOrder = 21;
      this.projCores.push(sp);
      this.group.add(sp);
    }
    scene.add(this.group);
  }

  setProjectileStyle(fn: ProjectileStyleFn): void { this.projStyle = fn; }

  private rnd(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  private rr(a: number, b: number): number { return a + (b - a) * this.rnd(); }

  private burst(pool: ParticlePool, at: THREE.Vector3, n: number, speed: [number, number], dirX: number, spread: number,
    life: [number, number], size: [number, number], sizeEnd: number, col: THREE.Color, alpha: number, cell: number,
    grav: number, drag: number, stretch: number, spin = 0): void {
    for (let i = 0; i < n; i++) {
      // a cone around +x*dirX (the hit's travel), with `spread` (0..1) toward a full sphere
      const a = this.rr(-Math.PI, Math.PI) * spread;
      const e = this.rr(-0.9, 0.9) * spread;
      const sp = this.rr(speed[0], speed[1]);
      this.v0.set(Math.cos(a) * Math.cos(e) * dirX, Math.sin(e) + 0.25 * spread, Math.sin(a) * Math.cos(e) * 0.6).normalize().multiplyScalar(sp);
      const s = this.rr(size[0], size[1]);
      pool.spawn(this.time, at, this.v0, this.rr(life[0], life[1]), s, s * sizeEnd, this.rr(0, 6.28), spin * this.rr(-1, 1),
        col, alpha, cell, grav, drag, stretch);
    }
  }

  private one(pool: ParticlePool, at: THREE.Vector3, life: number, s0: number, s1: number, col: THREE.Color, alpha: number,
    cell: number, rot = 0): void {
    pool.spawn(this.time, at, this.v1.set(0, 0, 0), life, s0, s1, rot, 0, col, alpha, cell, 0, 0, 0);
  }

  private screenFlash(amount: number, color: THREE.ColorRepresentation, hold = 0.03): void {
    const a = this.reduceFlashing ? Math.min(amount, 0.2) : amount;
    if (a >= this.flash) { this.flash = a; this.flashColor.set(color); this.flashHold = hold; }
  }

  private speedLines(at: THREE.Vector3, amount: number, color: THREE.ColorRepresentation, hold: number, decay: number, inner: number): void {
    if (amount < this.lines) return;
    this.cam.toScreen(at, this.linesAt);
    this.lines = amount; this.linesHold = hold; this.linesDecay = decay;
    this.linesColor.set(color); this.linesInner = inner; this.linesSeed = Math.floor(this.rnd() * 1000);
  }

  /**
   * A strike connected / was blocked / parried. `strength`: §17 rule 6 class (0 L .. 7 throw); `dir` = +1 when the
   * blow travels toward +x.
   */
  hit(kind: HitKind, strength: number, at: THREE.Vector3, dir: number): void {
    this.stats.hits++;
    const heavy = strength >= 2 && strength !== 6 && strength !== 7;
    const k = strength === 0 ? 0.6 : strength === 1 ? 0.85 : strength === 2 ? 1.1 : strength === 4 ? 1.35 : strength === 5 ? 1.25 : 1.0;
    const d = dir >= 0 ? 1 : -1;
    if (kind === 'block') {
      this.one(this.add, at, 0.16, 0.45 * k, 0.75 * k, COL.block, 1, C.CHEVRON, d > 0 ? Math.PI : 0);
      this.burst(this.add, at, Math.round(6 * k), [3, 6], -d, 0.9, [0.1, 0.22], [0.06, 0.1], 0.3, COL.block, 1, C.STREAK, 4, 3, 0.08);
      this.one(this.add, at, 0.1, 0.25, 0.55, COL.white, 0.9, C.GLOW);
      return;
    }
    if (kind === 'parry' || kind === 'perfect') {
      const big = kind === 'perfect';
      this.one(this.add, at, big ? 0.5 : 0.25, 0.2, big ? 3.2 : 1.4, COL.parry, 1, C.RING_THICK);
      this.one(this.add, at, big ? 0.35 : 0.18, 0.3, big ? 1.4 : 0.8, COL.white, 1, C.TWINKLE, 0.4);
      if (big) {
        this.one(this.add, at, 0.7, 0.4, 4.5, COL.white, 0.8, C.RING);
        this.screenFlash(0.55, 0xbfefff, 0.05);
        this.speedLines(at, 0.8, 0xffffff, 0.2, 2.2, 0.28);
        this.stats.rings++;
      } else this.screenFlash(0.18, 0xbfefff);
      this.burst(this.add, at, big ? 18 : 8, [3, 7], -d, 1, [0.15, 0.35], [0.05, 0.09], 0.3, COL.parry, 1, C.STREAK, 2, 2, 0.1);
      return;
    }
    if (kind === 'armor') {
      this.one(this.add, at, 0.2, 0.4, 0.9, COL.armor, 1, C.STAR, this.rr(0, 6));
      this.burst(this.add, at, 10, [3, 6], -d, 0.9, [0.12, 0.3], [0.05, 0.09], 0.3, COL.armor, 1, C.STREAK, 3, 2, 0.1);
      return;
    }
    // strikes that connected: hit / counter / punish / throw / clash
    const core = kind === 'punish' ? COL.punishCore : COL.hitCore;
    const spark = kind === 'counter' ? COL.counter : kind === 'punish' ? COL.punish : COL.hitSpark;
    this.one(this.add, at, 0.13 + 0.05 * k, 0.3 * k, 0.75 * k, core, 1, C.STAR, this.rr(0, 6.28));
    this.one(this.add, at, 0.09, 0.4 * k, 0.85 * k, spark, 0.9, C.GLOW);
    this.burst(this.add, at, Math.round(8 + 10 * k), [4, 9 * k], d, 0.75, [0.12, 0.3], [0.05, 0.1], 0.2, spark, 1, C.STREAK, 6, 2.5, 0.09);
    if (heavy || kind !== 'hit') {
      this.one(this.add, at, 0.16, 0.45 * k, 1.0 * k, spark, 0.85, C.POW, this.rr(0, 6.28));
      this.one(this.add, at, 0.22, 0.3, 1.2 * k, core, 0.8, C.RING);
    }
    if (kind === 'counter') { this.screenFlash(0.16, 0xff5a1f); this.speedLines(at, 0.55, 0xffffff, 0.08, 4, 0.2); }
    else if (kind === 'punish') { this.screenFlash(0.2, 0xffd400); this.speedLines(at, 0.75, 0xfff2b0, 0.12, 3.5, 0.18); }
    else if (heavy) this.speedLines(at, 0.32 + 0.08 * (strength - 2), 0xffffff, 0.05, 5, 0.3);
    if (strength >= 1 && kind !== 'clash') this.splatter(at, d, heavy ? 1 + 0.25 * (strength - 2) : 0.4);
  }

  /** comic splatter per the setting (splatter | sparks | confetti); amount ~0.4 light .. 2 KO */
  splatter(at: THREE.Vector3, dir: number, amount: number): void {
    this.stats.splats++;
    const n = Math.round(10 * amount);
    if (this.mode === 'sparks') {
      this.burst(this.add, at, n + 4, [3, 8], dir, 0.8, [0.25, 0.6], [0.04, 0.08], 0.2, COL.hitSpark, 1, C.STREAK, 9, 0.8, 0.12);
      this.burst(this.add, at, Math.round(n / 2), [1, 3], dir, 1, [0.3, 0.6], [0.05, 0.1], 0.1, COL.punishCore, 1, C.TWINKLE, 6, 1, 0, 6);
      return;
    }
    if (this.mode === 'confetti') {
      for (let i = 0; i < n + 6; i++) {
        const col = CONFETTI[Math.floor(this.rnd() * CONFETTI.length)];
        this.v0.set(dir * this.rr(0.5, 3.5), this.rr(1.5, 4.5), this.rr(-1, 1));
        const s = this.rr(0.08, 0.15);
        this.alpha.spawn(this.time, at, this.v0, this.rr(0.9, 1.6), s, s, this.rr(0, 6), this.rr(-12, 12), col, 1,
          this.rnd() < 0.7 ? C.CONF_RECT : C.CONF_RIB, 4.5, 1.6, 0);
      }
      return;
    }
    // splatter: comic red paint - blobs + stretched drops, floor stains when it lands
    for (let i = 0; i < n; i++) {
      const col = this.rnd() < 0.25 ? COL.redDark : this.rnd() < 0.2 ? COL.redHi : COL.red;
      this.v0.set(dir * this.rr(1, 4.5), this.rr(0.5, 3.5), this.rr(-0.8, 0.8));
      const s = this.rr(0.05, 0.12) * (0.8 + 0.3 * amount);
      this.alpha.spawn(this.time, at, this.v0, this.rr(0.45, 0.8), s, s * 0.8, this.rr(0, 6), 0, col, 1,
        this.rnd() < 0.5 ? C.DROP : (this.rnd() < 0.5 ? C.BLOB_A : C.BLOB_B), 9.8, 0.5, this.rnd() < 0.5 ? 0.12 : 0);
    }
    this.one(this.alpha, at, 0.18, 0.25 * amount, 0.55 * amount, COL.red, 0.95, C.BLOB_A, this.rr(0, 6.28));
    if (amount >= 0.9) {                                   // a few floor stains where the paint lands
      const m = Math.min(4, Math.round(amount * 2));
      for (let i = 0; i < m; i++) {
        this.v0.set(at.x + dir * this.rr(0.3, 1.3), 0.004, this.rr(-0.5, 0.5));
        this.decals.add(this.time + 0.25, this.v0, this.v1.set(0, 1, 0), this.rr(0.25, 0.5) * amount, this.rr(0, 6.28),
          this.rnd() < 0.5 ? C.BLOB_A : C.BLOB_B, COL.red, 0.9, 7);
      }
    }
  }

  /** a wall splat on the set wall (side 0 = x -8, 1 = x +8) at height y */
  wallSplat(side: number, y: number, z = 0): void {
    this.stats.wall++;
    const x = side === 0 ? -8 + 0.02 : 8 - 0.02;
    const nx = side === 0 ? 1 : -1;
    const at = this.v1.set(x, y, z);
    const cell = this.mode === 'sparks' ? C.SCORCH : C.WALL_SPLAT;
    const col = this.mode === 'splatter' ? COL.red : this.mode === 'sparks' ? new THREE.Color(0.08, 0.05, 0.04) : CONFETTI[Math.floor(this.rnd() * 6)];
    this.decals.add(this.time, at.clone(), new THREE.Vector3(nx, 0, 0), 1.35, this.rr(-0.4, 0.4), cell, col, 0.95, 9);
    if (this.mode === 'confetti') {
      for (let i = 0; i < 3; i++) {
        this.decals.add(this.time, new THREE.Vector3(x, y + this.rr(-0.4, 0.4), z + this.rr(-0.5, 0.5)), new THREE.Vector3(nx, 0, 0),
          0.45, this.rr(0, 6), C.CONF_RECT, CONFETTI[Math.floor(this.rnd() * CONFETTI.length)], 0.9, 9);
      }
    }
    this.dust(new THREE.Vector3(x + nx * 0.2, y, z), 1.2);
    this.splatter(new THREE.Vector3(x + nx * 0.15, y, z), nx, 1.4);
    this.one(this.add, new THREE.Vector3(x + nx * 0.1, y, z), 0.2, 0.6, 1.8, COL.hitCore, 0.9, C.POW, this.rr(0, 6));
  }

  /** dust puffs (wall hits, knockdowns, ground bounces) */
  dust(at: THREE.Vector3, amount: number): void {
    const n = Math.round(6 * amount);
    for (let i = 0; i < n; i++) {
      this.v0.set(this.rr(-1.2, 1.2), this.rr(0.2, 1.0), this.rr(-0.6, 0.6));
      const s = this.rr(0.3, 0.6) * amount;
      this.alpha.spawn(this.time, at, this.v0, this.rr(0.5, 0.9), s * 0.6, s * 1.6, this.rr(0, 6), this.rr(-1, 1), COL.dust, 0.55,
        C.DUST, -0.4, 2.5, 0);
    }
  }

  /** knockdown landing */
  land(at: THREE.Vector3): void { this.dust(at, 1); }

  /** super freeze start: flash + lines around the user + background dim (BoutView holds dimTarget) */
  superFlash(at: THREE.Vector3, level: number): void {
    this.screenFlash(level >= 3 ? 0.7 : 0.5, 0xffffff, 0.04);
    this.speedLines(at, 1.0, 0xffffff, 0.35, 2.5, 0.3);
    this.one(this.add, at, 0.5, 0.4, 3.0, COL.punishCore, 0.9, C.RING_THICK);
    this.one(this.add, at, 0.35, 1.0, 2.2, COL.hitCore, 0.8, C.STAR, this.rr(0, 6));
    this.burst(this.add, at, 24, [2, 6], 1, 1, [0.3, 0.7], [0.05, 0.1], 0.3, COL.punishCore, 1, C.TWINKLE, 1, 1.5, 0, 4);
  }

  /** IMPACT start: an orange shock ring at the fighter */
  impactStart(at: THREE.Vector3): void {
    this.one(this.add, at, 0.3, 0.3, 2.0, COL.armor, 0.9, C.RING_THICK);
  }

  /** KO: big flash; the match-deciding KO adds the finish-zoom lines */
  koFinish(at: THREE.Vector3, matchPoint: boolean): void {
    this.screenFlash(matchPoint ? 0.72 : 0.55, 0xffffff, matchPoint ? 0.06 : 0.03);
    this.speedLines(at, matchPoint ? 1.2 : 0.8, matchPoint ? 0xffe14a : 0xffffff, matchPoint ? 0.9 : 0.35, 1.5, 0.16);
    this.one(this.add, at, 0.35, 0.8, 3.2, COL.hitCore, 1, C.POW, this.rr(0, 6));
    this.one(this.add, at, 0.6, 0.3, 4.0, COL.white, 0.9, C.RING_THICK);
    this.splatter(at, 1, 1.6);
    this.splatter(at, -1, 1.0);
  }

  /** draw the live projectiles (the sim list) */
  projectiles(list: ReadonlyArray<FxProjectile> | undefined): void {
    for (const s of this.projCores) s.visible = false;
    if (!list) return;
    for (const p of list) {
      if (p.alive === false || p.alive === 0) continue;
      const sp = this.projCores[p.slot % this.projCores.length];
      const st = this.projStyle(p.owner, p.moveId ?? -1);
      sp.visible = true;
      sp.position.set(p.x, p.y, 0.05);
      const pulse = 1 + 0.12 * Math.sin(this.time * 40 + p.slot);
      sp.scale.setScalar(st.size * pulse);
      (sp.material as THREE.SpriteMaterial).color.set(st.color);
      this.c0.set(st.trail);
      const dir = (p.vx ?? 0) >= 0 ? -1 : 1;
      this.v0.set(dir * this.rr(0.3, 1.2), this.rr(-0.3, 0.3), this.rr(-0.2, 0.2));
      this.add.spawn(this.time, sp.position, this.v0, this.rr(0.15, 0.3), st.size * 0.5, st.size * 0.1, 0, 0, this.c0, 0.9,
        st.cell ?? C.GLOW, 0, 1, 0);
    }
  }

  /** per rendered frame. `timeScale` = 0.25 in the KO slow-mo. */
  update(dt: number, timeScale: number): void {
    const sdt = Math.max(0, dt) * timeScale;
    this.time += sdt;
    this.add.update(this.time);
    this.alpha.update(this.time);
    this.decals.update(this.time);
    // flash / lines decay (real time: a flash must not linger in slow-mo)
    if (this.flashHold > 0) this.flashHold -= dt; else this.flash = Math.max(0, this.flash - dt * 6);
    if (this.linesHold > 0) this.linesHold -= dt; else this.lines = Math.max(0, this.lines - dt * this.linesDecay);
    this.post.setFlash(this.flash, this.flashColor);
    this.post.setLines(Math.min(1, this.lines), this.linesAt.x, this.linesAt.y, this.linesColor, this.linesInner, this.linesSeed);
    // background dim plane: camera-facing, just behind the fighters' depth
    this.dimNow += (this.dimTarget - this.dimNow) * (1 - Math.exp(-dt * 18));
    const cam = this.cam.camera;
    const mat = this.dim.material as THREE.MeshBasicMaterial;
    mat.opacity = this.dimNow;
    this.dim.visible = this.dimNow > 0.005;
    if (this.dim.visible) {
      cam.getWorldDirection(this.v0);
      const depth = this.dimDepth > 0.5 ? this.dimDepth : Math.max(1.5, Math.abs(cam.position.z) + 1.3);
      this.dim.position.copy(cam.position).addScaledVector(this.v0, depth);
      this.dim.quaternion.copy(cam.quaternion);
    }
  }

  /** drop every live particle / decal / flash (FX are time-based: a +100 s jump expires them all) */
  reset(): void {
    this.time += 100;
    this.flash = 0; this.flashHold = 0; this.lines = 0; this.linesHold = 0; this.dimNow = 0; this.dimTarget = 0;
    this.update(0, 1);
  }

  /** warm-up helper: make every FX program draw once (spawn invisible-in-time particles) */
  primeForWarmup(): void {
    const at = new THREE.Vector3(0, 1, 0);
    this.add.spawn(this.time, at, this.v1.set(0, 0, 0), 0.01, 0.01, 0.01, 0, 0, COL.white, 0.01, C.GLOW, 0, 0, 0);
    this.alpha.spawn(this.time, at, this.v1, 0.01, 0.01, 0.01, 0, 0, COL.white, 0.01, C.GLOW, 0, 0, 0);
    this.dim.visible = true;
  }

  dispose(): void {
    this.add.dispose(); this.alpha.dispose(); this.decals.dispose();
    this.dim.geometry.dispose(); (this.dim.material as THREE.Material).dispose();
    for (const s of this.projCores) { (s.material as THREE.SpriteMaterial).map?.dispose(); (s.material as THREE.Material).dispose(); }
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}
