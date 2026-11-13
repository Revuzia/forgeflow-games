/**
 * ASCENDANT — runtime/fx/particles.js
 * CONTRACT §19.
 *
 * ONE camera-facing quad instanced into (at most) TWO InstancedMeshes:
 *   - layer 0: additive   (sparks, embers, shards, rings, flares)
 *   - layer 1: alpha      (smoke, dust, snow, pollen)
 * => two draw calls total for every particle in the game, and the additive layer
 *    alone covers the vast majority of bursts.
 *
 * Everything is a fixed-capacity Float32Array. Simulation runs on the CPU into the
 * SAME arrays that back the InstancedBufferAttributes, so an "upload" is a single
 * bufferSubData over the live prefix. No object churn, no per-frame allocation.
 *
 * Billboarding, atlas UV selection, streak stretching, aspect and fog are all done
 * in the vertex shader from instanced attributes.
 */

import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from '../core/util.js';
import { QUALITY } from '../core/settings.js';

/* ------------------------------------------------------------------ *
 *  constants
 * ------------------------------------------------------------------ */

const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
const ATLAS_CELL = 128;

/** sprite atlas slots (index into the 4x2 procedural atlas) */
export const SPRITE = {
  SMOKE: 0,
  STREAK: 1,
  EMBER: 2,
  SNOW: 3,
  SHARD: 4,
  RING: 5,
  DOT: 6,
  DUST: 7,
};

/** per-particle behaviour flags */
const F_GROUND = 1;   // collide with a horizontal plane at cGround
const F_FLICKER = 2;  // high-frequency alpha flicker (embers, fire)
const F_SWAY = 4;     // horizontal positional sway (snow, pollen)
const F_TURB = 8;     // velocity turbulence (rising embers)

/** alpha envelopes */
const FADE_SMOOTH = 0; // soft in, quadratic out            (smoke / dust)
const FADE_FLASH = 1;  // instant in, cubic out             (sparks / shards)
const FADE_LINEAR = 2; // quick in, linear out              (motes)
const FADE_HOLD = 3;   // instant in, hold, late fade       (rings / flares)

const BASE_CAPACITY = 2000;
const ADDITIVE_SHARE = 0.62;

const QUALITY_FALLBACK = {
  low: { particles: 0.35 },
  medium: { particles: 0.6 },
  high: { particles: 1.0 },
  ultra: { particles: 1.3 },
};

const EMPTY_OPTS = Object.freeze({});

/* ------------------------------------------------------------------ *
 *  module-scope scratch — ZERO per-frame allocation below this line
 * ------------------------------------------------------------------ */

const _col = new THREE.Color();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();

let RNG = mulberry32(0x5eed1a7);
function rnd() { return RNG(); }
function rrange(a, b) { return a + (b - a) * RNG(); }
function rsym() { return RNG() * 2 - 1; }

/* fast sin via LUT — turbulence/flicker call this thousands of times a frame */
const SIN_N = 1024;
const SIN_LUT = new Float32Array(SIN_N);
for (let i = 0; i < SIN_N; i++) SIN_LUT[i] = Math.sin((i / SIN_N) * Math.PI * 2);
const SIN_K = SIN_N / (Math.PI * 2);
function fsin(x) { return SIN_LUT[((x * SIN_K) | 0) & (SIN_N - 1)]; }

/**
 * Shared spawn descriptor. Presets fill this, then call pushParticle().
 * Reused for every single particle in the game — never allocated.
 */
const S = {
  life: 1, size0: 0.2, size1: 0.2, sprite: SPRITE.DOT,
  stretch: 0, aspect: 1, rot: 0, spin: 0,
  r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1,
  alpha: 1, grav: 0, drag: 0, turb: 0,
  flags: 0, ground: -1e9, fade: FADE_SMOOTH,
};

function sReset() {
  S.life = 1; S.size0 = 0.2; S.size1 = 0.2; S.sprite = SPRITE.DOT;
  S.stretch = 0; S.aspect = 1; S.rot = 0; S.spin = 0;
  S.r0 = 1; S.g0 = 1; S.b0 = 1; S.r1 = 1; S.g1 = 1; S.b1 = 1;
  S.alpha = 1; S.grav = 0; S.drag = 0; S.turb = 0;
  S.flags = 0; S.ground = -1e9; S.fade = FADE_SMOOTH;
}

/** set the start colour (accepts hex number, css string, or THREE.Color) */
function col0(c) { _col.set(c); S.r0 = _col.r; S.g0 = _col.g; S.b0 = _col.b; }
/** set the end colour */
function col1(c) { _col.set(c); S.r1 = _col.r; S.g1 = _col.g; S.b1 = _col.b; }
/** both ends the same */
function colBoth(c) { _col.set(c); S.r0 = S.r1 = _col.r; S.g0 = S.g1 = _col.g; S.b0 = S.b1 = _col.b; }
/** scale the start colour (hot-core boosting) */
function col0Scale(k) { S.r0 *= k; S.g0 *= k; S.b0 *= k; }
/** push the start colour toward white by t (white-hot) */
function col0White(t) {
  S.r0 = S.r0 + (1 - S.r0) * t;
  S.g0 = S.g0 + (1 - S.g0) * t;
  S.b0 = S.b0 + (1 - S.b0) * t;
}

/** read a Vector3 | [x,y,z] | {x,y,z} into out; returns false if unusable */
function readVec(v, out) {
  if (!v) return false;
  if (typeof v.x === 'number') { out.set(v.x, v.y || 0, v.z || 0); return true; }
  if (Array.isArray(v) && v.length >= 3) { out.set(v[0], v[1], v[2]); return true; }
  return false;
}

/** build an orthonormal basis around n (already normalised) into ta/tb */
function basisFrom(n, ta, tb) {
  if (Math.abs(n.y) < 0.94) ta.set(0, 1, 0); else ta.set(1, 0, 0);
  tb.crossVectors(n, ta).normalize();
  ta.crossVectors(tb, n).normalize();
}

/* ------------------------------------------------------------------ *
 *  procedural sprite atlas
 * ------------------------------------------------------------------ */

/**
 * Generates the 4x2 sprite atlas on a canvas. Every sprite is pure white RGB with
 * a shaped ALPHA channel — the shader only samples .a, so there is zero colour
 * fringing and zero colour-space ambiguity; the tint comes entirely from the
 * instance colour, and a white-hot core is derived from the alpha itself.
 * Content is inset inside each cell so mip levels bleed transparency, not neighbours.
 */
function buildAtlasCanvas(cell = ATLAS_CELL) {
  const cvs = document.createElement('canvas');
  cvs.width = cell * ATLAS_COLS;
  cvs.height = cell * ATLAS_ROWS;
  const g = cvs.getContext('2d');
  g.clearRect(0, 0, cvs.width, cvs.height);

  const R = mulberry32(0x9e3779b9);
  const cellOrigin = (i) => [(i % ATLAS_COLS) * cell, Math.floor(i / ATLAS_COLS) * cell];
  const white = (a) => `rgba(255,255,255,${a.toFixed(4)})`;

  const softDisc = (cx, cy, r, a, hardness) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, white(a));
    grd.addColorStop(clamp(hardness, 0.01, 0.95), white(a * 0.62));
    grd.addColorStop(1, white(0));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };

  // ---- 0 : SMOKE PUFF — clumped overlapping lobes, soft, slightly mottled
  {
    const [ox, oy] = cellOrigin(SPRITE.SMOKE);
    g.save(); g.translate(ox, oy);
    const c = cell * 0.5;
    for (let i = 0; i < 11; i++) {
      const ang = (i / 11) * Math.PI * 2 + R() * 0.7;
      const rad = cell * (0.06 + R() * 0.15);
      const px = c + Math.cos(ang) * rad;
      const py = c + Math.sin(ang) * rad;
      softDisc(px, py, cell * (0.14 + R() * 0.13), 0.20 + R() * 0.16, 0.30);
    }
    softDisc(c, c, cell * 0.36, 0.34, 0.24);
    g.restore();
  }

  // ---- 1 : SPARK STREAK — bright vertical capsule, tapered at both ends
  {
    const [ox, oy] = cellOrigin(SPRITE.STREAK);
    g.save(); g.translate(ox, oy);
    const c = cell * 0.5;
    const lin = g.createLinearGradient(0, cell * 0.10, 0, cell * 0.90);
    lin.addColorStop(0.00, white(0));
    lin.addColorStop(0.22, white(0.55));
    lin.addColorStop(0.50, white(1.0));
    lin.addColorStop(0.78, white(0.55));
    lin.addColorStop(1.00, white(0));
    const rad = g.createRadialGradient(c, c, 0, c, c, cell * 0.16);
    rad.addColorStop(0, white(1));
    rad.addColorStop(1, white(0));
    // vertical body, horizontally feathered by drawing progressively narrower bands
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const w = cell * 0.14 * (1 - t) + cell * 0.012;
      g.globalAlpha = 0.14 + 0.16 * (1 - t);
      g.fillStyle = lin;
      g.fillRect(c - w * 0.5, cell * 0.10, w, cell * 0.80);
    }
    g.globalAlpha = 1;
    g.fillStyle = rad;
    g.fillRect(0, 0, cell, cell);
    g.restore();
  }

  // ---- 2 : EMBER — tight core with a warm halo
  {
    const [ox, oy] = cellOrigin(SPRITE.EMBER);
    g.save(); g.translate(ox, oy);
    const c = cell * 0.5;
    softDisc(c, c, cell * 0.42, 0.30, 0.10);
    softDisc(c, c, cell * 0.20, 0.90, 0.35);
    softDisc(c, c, cell * 0.085, 1.0, 0.70);
    g.restore();
  }

  // ---- 3 : SNOWFLAKE — 6 arms with barbs, softly glowing
  {
    const [ox, oy] = cellOrigin(SPRITE.SNOW);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    softDisc(0, 0, cell * 0.30, 0.16, 0.2);
    g.lineCap = 'round';
    for (let a = 0; a < 6; a++) {
      g.save();
      g.rotate((a / 6) * Math.PI * 2);
      g.strokeStyle = white(0.92);
      g.lineWidth = cell * 0.045;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -cell * 0.38); g.stroke();
      g.lineWidth = cell * 0.030;
      g.strokeStyle = white(0.78);
      for (const [at, len] of [[0.46, 0.13], [0.68, 0.10], [0.86, 0.065]]) {
        const y = -cell * 0.38 * at;
        g.beginPath(); g.moveTo(0, y); g.lineTo(cell * len, y - cell * len * 0.85); g.stroke();
        g.beginPath(); g.moveTo(0, y); g.lineTo(-cell * len, y - cell * len * 0.85); g.stroke();
      }
      g.restore();
    }
    softDisc(0, 0, cell * 0.10, 0.85, 0.4);
    g.restore();
  }

  // ---- 4 : SHARD — angular sliver, bright leading edge
  {
    const [ox, oy] = cellOrigin(SPRITE.SHARD);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createLinearGradient(0, -cell * 0.40, 0, cell * 0.40);
    grd.addColorStop(0.00, white(1.0));
    grd.addColorStop(0.42, white(0.80));
    grd.addColorStop(1.00, white(0.05));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -cell * 0.40);
    g.lineTo(cell * 0.155, cell * 0.06);
    g.lineTo(0, cell * 0.40);
    g.lineTo(-cell * 0.115, cell * 0.02);
    g.closePath();
    g.fill();
    g.globalAlpha = 0.55;
    softDisc(0, -cell * 0.22, cell * 0.16, 0.9, 0.4);
    g.globalAlpha = 1;
    g.restore();
  }

  // ---- 5 : RING — annulus, soft on both edges, brightest on the band
  {
    const [ox, oy] = cellOrigin(SPRITE.RING);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, cell * 0.46);
    grd.addColorStop(0.00, white(0));
    grd.addColorStop(0.56, white(0));
    grd.addColorStop(0.74, white(0.30));
    grd.addColorStop(0.86, white(1.0));
    grd.addColorStop(0.95, white(0.28));
    grd.addColorStop(1.00, white(0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, cell * 0.46, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ---- 6 : DOT — clean gaussian point
  {
    const [ox, oy] = cellOrigin(SPRITE.DOT);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, cell * 0.44);
    grd.addColorStop(0.00, white(1.0));
    grd.addColorStop(0.22, white(0.86));
    grd.addColorStop(0.50, white(0.34));
    grd.addColorStop(0.78, white(0.07));
    grd.addColorStop(1.00, white(0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, cell * 0.44, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ---- 7 : DUST — irregular low-contrast speckled cloud
  {
    const [ox, oy] = cellOrigin(SPRITE.DUST);
    g.save(); g.translate(ox, oy);
    const c = cell * 0.5;
    softDisc(c, c, cell * 0.40, 0.20, 0.15);
    for (let i = 0; i < 26; i++) {
      const ang = R() * Math.PI * 2;
      const rad = Math.pow(R(), 0.6) * cell * 0.34;
      softDisc(
        c + Math.cos(ang) * rad,
        c + Math.sin(ang) * rad,
        cell * (0.035 + R() * 0.085),
        0.14 + R() * 0.22,
        0.45,
      );
    }
    g.restore();
  }

  return cvs;
}

function buildAtlasTexture() {
  const tex = new THREE.CanvasTexture(buildAtlasCanvas());
  tex.flipY = false;                 // cell row 0 == top canvas row
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // only .a is sampled
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ *
 *  shaders
 * ------------------------------------------------------------------ */

const PARTICLE_VERT = /* glsl */`
  attribute vec3 aPosition;
  attribute vec3 aVelocity;
  attribute vec4 aMisc;    // age, life, size, rotation
  attribute vec4 aColor;   // rgb, alpha
  attribute vec4 aParams;  // spriteIndex, stretch, aspect, spare

  uniform vec2  uAtlasScale;
  uniform float uAtlasCols;
  uniform vec2  uFogRange;
  uniform float uFogAmount;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;

  void main() {
    vec4 mv = modelViewMatrix * vec4( aPosition, 1.0 );

    float size    = aMisc.z;
    float rot     = aMisc.w;
    float stretch = aParams.y;
    float aspect  = aParams.z;

    // The quad corner is taken from position.xy (-0.5..0.5), NOT from the uv
    // attribute: that makes the atlas mapping independent of PlaneGeometry's uv
    // winding. cuv.y == 1 is the top of the quad; with texture.flipY = false the
    // top of a canvas cell is v == 0, hence the 1.0 - cuv.y below.
    vec2  q   = position.xy;
    vec2  cuv = q + 0.5;

    vec2 offs;
    if ( stretch > 0.001 ) {
      // stretch the quad along the screen-space velocity: spark streaks
      vec3 vv = ( modelViewMatrix * vec4( aVelocity, 0.0 ) ).xyz;
      vec2 d  = vv.xy;
      float L = length( d );
      vec2 dir  = ( L > 1e-4 ) ? d / L : vec2( 0.0, 1.0 );
      vec2 perp = vec2( -dir.y, dir.x );
      float len = size * aspect * ( 1.0 + stretch * min( L * 0.16, 7.0 ) );
      offs = dir * ( q.y * len ) + perp * ( q.x * size );
    } else {
      float c = cos( rot ), s = sin( rot );
      vec2 p = vec2( q.x * size, q.y * size * aspect );
      offs = vec2( p.x * c - p.y * s, p.x * s + p.y * c );
    }

    mv.xy += offs;
    gl_Position = projectionMatrix * mv;

    float idx  = floor( aParams.x + 0.5 );
    vec2  cell = vec2( mod( idx, uAtlasCols ), floor( idx / uAtlasCols ) );
    vUv    = ( cell + vec2( cuv.x, 1.0 - cuv.y ) ) * uAtlasScale;
    vColor = aColor;

    float dist = -mv.z;
    vFog = uFogAmount * clamp(
      ( dist - uFogRange.x ) / max( uFogRange.y - uFogRange.x, 1e-3 ), 0.0, 1.0 );
  }
`;

const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uCore;
  uniform vec3  uFogColor;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;

  void main() {
    float m = texture2D( uMap, vUv ).a;
    float a = m * vColor.a * uOpacity;

    // white-hot core derived from coverage — no colour data needed in the atlas
    float core = smoothstep( 0.55, 0.97, m );
    vec3  c    = vColor.rgb * ( 1.0 + core * uCore );

    #ifdef PARTICLE_ADDITIVE
      a *= ( 1.0 - vFog );
    #else
      c = mix( c, uFogColor, vFog );
    #endif

    if ( a < 0.0035 ) discard;

    gl_FragColor = vec4( c, a );
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ *
 *  Layer — one InstancedMesh + all of its parallel state
 * ------------------------------------------------------------------ */

class Layer {
  constructor(cap, texture, additive) {
    this.cap = cap | 0;
    this.count = 0;
    this.cursor = 0;
    this.additive = !!additive;

    const n = this.cap;

    // ---- GPU-visible state (these arrays ARE the instanced attributes)
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.misc = new Float32Array(n * 4);
    this.col = new Float32Array(n * 4);
    this.par = new Float32Array(n * 4);

    // ---- CPU-only simulation state
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.turb = new Float32Array(n);
    this.sz0 = new Float32Array(n);
    this.sz1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.ground = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.flags = new Uint8Array(n);
    this.fade = new Uint8Array(n);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3);
    this.aMisc = new THREE.InstancedBufferAttribute(this.misc, 4);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4);
    this.aPar = new THREE.InstancedBufferAttribute(this.par, 4);
    for (const a of [this.aPos, this.aVel, this.aMisc, this.aCol, this.aPar]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute('aPosition', this.aPos);
    geo.setAttribute('aVelocity', this.aVel);
    geo.setAttribute('aMisc', this.aMisc);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aParams', this.aPar);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uOpacity: { value: 1 },
        uCore: { value: additive ? 0.85 : 0.14 },
        uAtlasScale: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
        uAtlasCols: { value: ATLAS_COLS },
        uFogColor: { value: new THREE.Color(0x05070d) },
        uFogRange: { value: new THREE.Vector2(30, 220) },
        uFogAmount: { value: 0 },
      },
      defines: additive ? { PARTICLE_ADDITIVE: '' } : {},
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    this.geometry = geo;
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.renderOrder = additive ? 9 : 8;
    this.mesh.name = additive ? 'fx.particles.additive' : 'fx.particles.alpha';
    // instanceMatrix is unused (billboarding happens from aPosition) — never uploaded.
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.count = 0;
  }
}

function removeAt(L, i) {
  const j = --L.count;
  if (i === j) return;
  const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
  const { pos, vel, misc, col, par, c0, c1 } = L;
  pos[i3] = pos[j3]; pos[i3 + 1] = pos[j3 + 1]; pos[i3 + 2] = pos[j3 + 2];
  vel[i3] = vel[j3]; vel[i3 + 1] = vel[j3 + 1]; vel[i3 + 2] = vel[j3 + 2];
  c0[i3] = c0[j3]; c0[i3 + 1] = c0[j3 + 1]; c0[i3 + 2] = c0[j3 + 2];
  c1[i3] = c1[j3]; c1[i3 + 1] = c1[j3 + 1]; c1[i3 + 2] = c1[j3 + 2];
  misc[i4] = misc[j4]; misc[i4 + 1] = misc[j4 + 1]; misc[i4 + 2] = misc[j4 + 2]; misc[i4 + 3] = misc[j4 + 3];
  col[i4] = col[j4]; col[i4 + 1] = col[j4 + 1]; col[i4 + 2] = col[j4 + 2]; col[i4 + 3] = col[j4 + 3];
  par[i4] = par[j4]; par[i4 + 1] = par[j4 + 1]; par[i4 + 2] = par[j4 + 2]; par[i4 + 3] = par[j4 + 3];
  L.grav[i] = L.grav[j]; L.drag[i] = L.drag[j]; L.spin[i] = L.spin[j]; L.turb[i] = L.turb[j];
  L.sz0[i] = L.sz0[j]; L.sz1[i] = L.sz1[j]; L.alpha[i] = L.alpha[j];
  L.ground[i] = L.ground[j]; L.seed[i] = L.seed[j];
  L.flags[i] = L.flags[j]; L.fade[i] = L.fade[j];
}

/** commit the shared descriptor S into layer L at a free (or recycled) slot */
function pushParticle(L, x, y, z, vx, vy, vz) {
  let i;
  if (L.count < L.cap) i = L.count++;
  else { i = L.cursor; L.cursor = (i + 1) % L.cap; }

  const i3 = i * 3, i4 = i * 4;
  L.pos[i3] = x; L.pos[i3 + 1] = y; L.pos[i3 + 2] = z;
  L.vel[i3] = vx; L.vel[i3 + 1] = vy; L.vel[i3 + 2] = vz;

  L.misc[i4] = 0; L.misc[i4 + 1] = S.life; L.misc[i4 + 2] = S.size0; L.misc[i4 + 3] = S.rot;
  L.col[i4] = S.r0; L.col[i4 + 1] = S.g0; L.col[i4 + 2] = S.b0; L.col[i4 + 3] = 0;
  L.par[i4] = S.sprite; L.par[i4 + 1] = S.stretch; L.par[i4 + 2] = S.aspect; L.par[i4 + 3] = 0;

  L.c0[i3] = S.r0; L.c0[i3 + 1] = S.g0; L.c0[i3 + 2] = S.b0;
  L.c1[i3] = S.r1; L.c1[i3 + 1] = S.g1; L.c1[i3 + 2] = S.b1;

  L.grav[i] = S.grav; L.drag[i] = S.drag; L.spin[i] = S.spin; L.turb[i] = S.turb;
  L.sz0[i] = S.size0; L.sz1[i] = S.size1; L.alpha[i] = S.alpha;
  L.ground[i] = S.ground; L.seed[i] = RNG() * 64;
  L.flags[i] = S.flags; L.fade[i] = S.fade;
  return i;
}

function simulateLayer(L, dt, time) {
  const { pos, vel, misc, col, c0, c1 } = L;
  let i = 0;
  while (i < L.count) {
    const i3 = i * 3, i4 = i * 4;

    const life = misc[i4 + 1];
    const age = misc[i4] + dt;
    if (age >= life) { removeAt(L, i); continue; }
    misc[i4] = age;

    const t = age / life;
    const fl = L.flags[i];
    const seed = L.seed[i];

    let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];

    const gr = L.grav[i];
    if (gr !== 0) vy -= gr * dt;

    const dg = L.drag[i];
    if (dg > 0) { const f = 1 / (1 + dg * dt); vx *= f; vy *= f; vz *= f; }

    const tb = L.turb[i];
    if (tb > 0 && (fl & F_TURB) !== 0) {
      vx += fsin(time * 2.7 + seed * 13.1) * tb * dt;
      vz += fsin(time * 2.3 + seed * 7.7 + 1.7) * tb * dt;
      vy += fsin(time * 3.6 + seed * 4.3 + 3.1) * tb * 0.45 * dt;
    }

    let px = pos[i3] + vx * dt;
    let py = pos[i3 + 1] + vy * dt;
    let pz = pos[i3 + 2] + vz * dt;

    if (tb > 0 && (fl & F_SWAY) !== 0) {
      px += fsin(time * 1.5 + seed * 6.283) * tb * dt;
      pz += fsin(time * 1.17 + seed * 3.141 + 2.0) * tb * dt;
    }

    if ((fl & F_GROUND) !== 0) {
      const gy = L.ground[i];
      if (py < gy) { py = gy; vy = -vy * 0.22; vx *= 0.55; vz *= 0.55; }
    }

    pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;

    const inv = 1 - t;
    const eased = 1 - inv * inv * inv;
    misc[i4 + 2] = L.sz0[i] + (L.sz1[i] - L.sz0[i]) * eased;
    misc[i4 + 3] += L.spin[i] * dt;

    col[i4] = c0[i3] + (c1[i3] - c0[i3]) * t;
    col[i4 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * t;
    col[i4 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * t;

    let a = L.alpha[i];
    switch (L.fade[i]) {
      case FADE_FLASH:
        a *= (t < 0.038 ? t * 26 : 1) * inv * inv * inv;
        break;
      case FADE_LINEAR:
        a *= (t < 0.083 ? t * 12 : 1) * inv;
        break;
      case FADE_HOLD:
        a *= (t < 0.05 ? t * 20 : 1) * (1 - smoothstep(0.42, 1, t));
        break;
      default: {
        const u = t < 0.15 ? t / 0.15 : 1;
        a *= u * u * (3 - 2 * u) * inv * inv;
        break;
      }
    }
    if ((fl & F_FLICKER) !== 0) a *= 0.66 + 0.34 * fsin(time * 23.5 + seed * 57.3);
    col[i4 + 3] = a;

    i++;
  }
}

function markRange(attr, count) {
  attr.needsUpdate = true;
  if (typeof attr.addUpdateRange === 'function') {
    if (attr.updateRanges && attr.updateRanges.length > 3) attr.updateRanges.length = 0;
    attr.addUpdateRange(0, count);
  }
}

function uploadLayer(L) {
  const n = L.count;
  L.mesh.count = n;
  if (n === 0) return;
  markRange(L.aPos, n * 3);
  markRange(L.aVel, n * 3);
  markRange(L.aMisc, n * 4);
  markRange(L.aCol, n * 4);
  markRange(L.aPar, n * 4);
}

/* ------------------------------------------------------------------ *
 *  surface + cause palettes
 * ------------------------------------------------------------------ */

const SURFACE_TINT = {
  normal: 0x9d998f,
  stone: 0x9d998f,
  metal: 0xb6c2cf,
  panel: 0xa9b3c0,
  grate: 0x8d97a3,
  ice: 0xc9e6ff,
  glass: 0xcfe4f2,
  bounce: 0xffcf82,
  speed: 0x8ef0ff,
  conveyor: 0xc7b189,
  sticky: 0xa9d492,
  nostick: 0xc4ccd7,
  sand: 0xd9c396,
  wood: 0xc39c6a,
  rubber: 0x7f838a,
  lava: 0xff8a30,
  snow: 0xe6f2ff,
};

export const CAUSE_COLOR = {
  lava: 0xff7a1a,
  laser: 0x35f0ff,
  saw: 0xfff2d2,
  void: 0xa86bff,
  crush: 0xff4a4a,
  spike: 0xff5c3a,
  manual: 0x9fb6cc,
  fall: 0x8fa6c0,
};

function surfaceTint(surface, fallback) {
  if (surface == null) return fallback;
  const c = SURFACE_TINT[surface];
  return c === undefined ? fallback : c;
}

/* ------------------------------------------------------------------ *
 *  burst presets
 * ------------------------------------------------------------------ */

function optNum(o, k, d) { const v = o[k]; return typeof v === 'number' ? v : d; }

/**
 * Each preset is (sys, x, y, z, opts). All counts are scaled by sys.scale.
 * Rules of engagement, non-negotiable for readability:
 *   - nothing lives longer than it needs to
 *   - nothing large ever spawns ABOVE eye level in front of the player
 *   - smoke is small, dark, and low; brightness is reserved for information
 */
const BURSTS = {

  /* ---- landing: radial dust ring hugging the floor, surface-tinted -------- */
  land(sys, x, y, z, o) {
    const s = clamp(optNum(o, 'strength', 0.5), 0, 1);
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const A = sys.alphaLayer, D = sys.addLayer;
    const q = sys.scale;

    const nDust = Math.max(3, Math.round((5 + 15 * s) * q));
    for (let i = 0; i < nDust; i++) {
      sReset();
      const ang = (i / nDust) * Math.PI * 2 + rsym() * 0.35;
      const sp = (1.3 + 2.8 * s) * (0.65 + rnd() * 0.7);
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.36, 0.52) + s * 0.3;
      S.size0 = 0.13 + 0.18 * s;
      S.size1 = S.size0 * (2.6 + 1.6 * s);
      colBoth(tint);
      col0Scale(1.15);
      S.r1 *= 0.55; S.g1 *= 0.55; S.b1 *= 0.55;
      S.alpha = 0.16 + 0.30 * s;
      S.grav = 3.0;
      S.drag = 3.2;
      S.spin = rsym() * 1.4;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_SMOOTH;
      pushParticle(A, x + Math.cos(ang) * 0.12, y + 0.04, z + Math.sin(ang) * 0.12,
        Math.cos(ang) * sp, 0.5 + 1.1 * s * rnd(), Math.sin(ang) * sp);
    }

    const nPuff = Math.max(1, Math.round((1 + 3 * s) * q));
    for (let i = 0; i < nPuff; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.5, 0.85);
      S.size0 = 0.22 + 0.2 * s;
      S.size1 = S.size0 * 3.1;
      colBoth(tint);
      S.r0 *= 0.7; S.g0 *= 0.7; S.b0 *= 0.7;
      S.r1 *= 0.4; S.g1 *= 0.4; S.b1 *= 0.4;
      S.alpha = 0.10 + 0.16 * s;
      S.grav = 0.6;
      S.drag = 2.4;
      S.spin = rsym() * 0.7;
      S.rot = rnd() * 6.283;
      pushParticle(A, x + rsym() * 0.2, y + 0.05, z + rsym() * 0.2,
        Math.cos(ang) * 0.8 * (0.5 + s), 0.35, Math.sin(ang) * 0.8 * (0.5 + s));
    }

    if (s > 0.5) {
      sReset();
      S.sprite = SPRITE.RING;
      S.life = 0.24 + 0.1 * s;
      S.size0 = 0.5;
      S.size1 = 1.9 + 2.4 * s;
      S.aspect = 0.42;                 // squashed: reads as a floor ring, not a halo
      colBoth(tint);
      col0White(0.45);
      S.alpha = 0.20 + 0.30 * s;
      S.fade = FADE_HOLD;
      pushParticle(D, x, y + 0.05, z, 0, 0, 0);
    }
  },

  /* ---- jump: a small, tight foot-level puff ------------------------------ */
  jump(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const A = sys.alphaLayer;
    const n = Math.max(2, Math.round(5 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.5;
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.24, 0.38);
      S.size0 = 0.10;
      S.size1 = 0.42;
      colBoth(tint);
      S.r1 *= 0.5; S.g1 *= 0.5; S.b1 *= 0.5;
      S.alpha = 0.16;
      S.grav = 2.2;
      S.drag = 3.6;
      S.spin = rsym() * 1.2;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushParticle(A, x + Math.cos(ang) * 0.1, y + 0.03, z + Math.sin(ang) * 0.1,
        Math.cos(ang) * 1.5, 0.25, Math.sin(ang) * 1.5);
    }
  },

  /* ---- death: hot shards + shock ring + dark smoke, colour by cause ------ */
  death(sys, x, y, z, o) {
    const cause = o.cause || 'manual';
    const base = o.color !== undefined ? o.color : (CAUSE_COLOR[cause] || CAUSE_COLOR.manual);
    const A = sys.alphaLayer, D = sys.addLayer;
    const q = sys.scale;
    const hasDir = readVec(o.dir, _vA);
    if (hasDir && _vA.lengthSq() > 1e-6) _vA.normalize(); else _vA.set(0, 1, 0);

    // shock ring — the single most readable "you died HERE" cue
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.34;
    S.size0 = 0.35;
    S.size1 = 5.4;
    colBoth(base);
    col0White(0.55);
    S.alpha = 0.85;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y, z, 0, 0, 0);

    // inner flash
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.20;
    S.size0 = 1.9;
    S.size1 = 0.5;
    colBoth(base);
    col0White(0.7);
    S.alpha = 0.9;
    S.fade = FADE_FLASH;
    pushParticle(D, x, y, z, 0, 0, 0);

    // hot shards
    const nSh = Math.max(8, Math.round(24 * q));
    for (let i = 0; i < nSh; i++) {
      sReset();
      const th = rnd() * 6.283;
      const ph = Math.acos(clamp(rsym() * 0.85, -1, 1));
      const sp = rrange(5.5, 14.5);
      const dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph) * 0.8 + 0.45, dz = Math.sin(ph) * Math.sin(th);
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.45, 0.95);
      S.size0 = rrange(0.12, 0.30);
      S.size1 = S.size0 * 0.55;
      S.aspect = 1.9;
      colBoth(base);
      col0White(0.62);
      S.r1 *= 0.45; S.g1 *= 0.45; S.b1 *= 0.45;
      S.alpha = 1;
      S.grav = 17;
      S.drag = 0.9;
      S.spin = rsym() * 12;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushParticle(D, x + dx * 0.15, y + dy * 0.1, z + dz * 0.15,
        dx * sp + _vA.x * 2.5, dy * sp * 0.85 + _vA.y * 2.5, dz * sp + _vA.z * 2.5);
    }

    // streaked sparks
    const nSp = Math.max(6, Math.round(16 * q));
    for (let i = 0; i < nSp; i++) {
      sReset();
      const th = rnd() * 6.283;
      const ph = Math.acos(clamp(rsym(), -1, 1));
      const sp = rrange(9, 22);
      const dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.22, 0.5);
      S.size0 = rrange(0.06, 0.12);
      S.size1 = S.size0 * 0.35;
      S.stretch = 1;
      S.aspect = 1.4;
      colBoth(base);
      col0White(0.8);
      S.alpha = 1;
      S.grav = 20;
      S.drag = 1.6;
      S.fade = FADE_FLASH;
      pushParticle(D, x, y, z, dx * sp, dy * sp + 3, dz * sp);
    }

    // dark smoke, low and small — never obscures the next platform
    const nSm = Math.max(3, Math.round(8 * q));
    for (let i = 0; i < nSm; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.8, 1.35);
      S.size0 = rrange(0.26, 0.44);
      S.size1 = S.size0 * 2.7;
      col0(0x181a20); col1(0x090a0d);
      S.alpha = 0.34;
      S.grav = -0.5;
      S.drag = 1.7;
      S.spin = rsym() * 0.9;
      S.rot = rnd() * 6.283;
      pushParticle(A, x + rsym() * 0.3, y + rsym() * 0.25, z + rsym() * 0.3,
        Math.cos(ang) * 1.5, 0.7 + rnd(), Math.sin(ang) * 1.5);
    }
  },

  /* ---- checkpoint: expanding ring of rising motes + a ground flare ------- */
  checkpoint(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.checkpoint;
    const D = sys.addLayer;
    const q = sys.scale;

    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.55;
    S.size0 = 0.6;
    S.size1 = 4.4;
    S.aspect = 0.45;
    colBoth(c); col0White(0.4);
    S.alpha = 0.8;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y + 0.06, z, 0, 0, 0);

    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.5;
    S.size0 = 1.6;
    S.size1 = 3.0;
    S.aspect = 0.34;
    colBoth(c);
    S.alpha = 0.5;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y + 0.05, z, 0, 0, 0);

    const n = Math.max(8, Math.round(22 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.2;
      const r = 0.42 + rnd() * 0.28;
      S.sprite = rnd() < 0.35 ? SPRITE.EMBER : SPRITE.DOT;
      S.life = rrange(0.85, 1.35);
      S.size0 = rrange(0.07, 0.15);
      S.size1 = S.size0 * 0.35;
      colBoth(c); col0White(0.35);
      S.alpha = 1;
      S.grav = -1.4;                  // floats upward
      S.drag = 1.1;
      S.turb = 0.5;
      S.flags = F_TURB;
      S.fade = FADE_LINEAR;
      pushParticle(D, x + Math.cos(ang) * r, y + 0.1 + rnd() * 0.3, z + Math.sin(ang) * r,
        Math.cos(ang) * 1.1, 1.6 + rnd() * 1.9, Math.sin(ang) * 1.1);
    }
  },

  /* ---- finish: fountain + shards + a light-shaft pulse ------------------- */
  finish(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.finish;
    const D = sys.addLayer;
    const A = sys.alphaLayer;
    const q = sys.scale;

    // vertical light shaft (a tall stretched soft quad)
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.85;
    S.size0 = 1.5;
    S.size1 = 2.6;
    S.aspect = 7.5;
    colBoth(c); col0White(0.5);
    S.alpha = 0.55;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y + 3.4, z, 0, 0.6, 0);

    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.6;
    S.size0 = 0.6;
    S.size1 = 6.5;
    S.aspect = 0.4;
    colBoth(c); col0White(0.5);
    S.alpha = 0.9;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y + 0.08, z, 0, 0, 0);

    const nF = Math.max(14, Math.round(42 * q));
    for (let i = 0; i < nF; i++) {
      sReset();
      const ang = rnd() * 6.283;
      const rad = rnd() * 0.55;
      const up = rrange(6.5, 12.5);
      S.sprite = rnd() < 0.4 ? SPRITE.EMBER : SPRITE.DOT;
      S.life = rrange(1.1, 1.9);
      S.size0 = rrange(0.06, 0.16);
      S.size1 = S.size0 * 0.4;
      colBoth(c); col0White(0.45);
      S.r1 *= 0.6; S.g1 *= 0.6; S.b1 *= 0.6;
      S.alpha = 1;
      S.grav = 11;
      S.drag = 0.5;
      S.turb = 0.7;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushParticle(D, x + Math.cos(ang) * rad, y + 0.15, z + Math.sin(ang) * rad,
        Math.cos(ang) * rrange(0.8, 3.2), up, Math.sin(ang) * rrange(0.8, 3.2));
    }

    const nS = Math.max(8, Math.round(24 * q));
    for (let i = 0; i < nS; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(4, 11);
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.6, 1.2);
      S.size0 = rrange(0.10, 0.22);
      S.size1 = S.size0 * 0.5;
      S.aspect = 1.8;
      colBoth(c); col0White(0.7);
      S.alpha = 1;
      S.grav = 15;
      S.drag = 0.7;
      S.spin = rsym() * 9;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushParticle(D, x, y + 0.4, z, Math.cos(th) * sp, rrange(3, 9), Math.sin(th) * sp);
    }

    const nP = Math.max(2, Math.round(6 * q));
    for (let i = 0; i < nP; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.7, 1.1);
      S.size0 = 0.35;
      S.size1 = 1.5;
      colBoth(c);
      S.r0 *= 0.35; S.g0 *= 0.35; S.b0 *= 0.35;
      S.r1 *= 0.12; S.g1 *= 0.12; S.b1 *= 0.12;
      S.alpha = 0.18;
      S.grav = -0.4;
      S.drag = 2;
      S.spin = rsym() * 0.8;
      S.rot = rnd() * 6.283;
      pushParticle(A, x + rsym() * 0.4, y + 0.15, z + rsym() * 0.4,
        Math.cos(ang) * 1.6, 1.1, Math.sin(ang) * 1.6);
    }
  },

  /* ---- coin: quick gold sparkle ------------------------------------------ */
  coin(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.coin;
    const D = sys.addLayer;
    const q = sys.scale;

    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.30;
    S.size0 = 0.25;
    S.size1 = 1.65;
    colBoth(c); col0White(0.5);
    S.alpha = 0.9;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y, z, 0, 0, 0);

    const n = Math.max(5, Math.round(12 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const ph = Math.acos(clamp(rsym(), -1, 1));
      const sp = rrange(2.2, 5.5);
      S.sprite = rnd() < 0.5 ? SPRITE.STREAK : SPRITE.EMBER;
      S.life = rrange(0.3, 0.55);
      S.size0 = rrange(0.05, 0.11);
      S.size1 = S.size0 * 0.3;
      S.stretch = S.sprite === SPRITE.STREAK ? 0.8 : 0;
      S.aspect = S.sprite === SPRITE.STREAK ? 1.5 : 1;
      colBoth(c); col0White(0.6);
      S.alpha = 1;
      S.grav = 6;
      S.drag = 2.2;
      S.fade = FADE_FLASH;
      pushParticle(D, x, y, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.7 + 1.8, Math.sin(ph) * Math.sin(th) * sp);
    }
  },

  /* ---- generic sparks along a direction ---------------------------------- */
  spark(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xffd39a;
    const D = sys.addLayer;
    const q = sys.scale;
    const spread = optNum(o, 'spread', 0.55);
    const power = optNum(o, 'power', 1);
    const hasDir = readVec(o.dir, _vA);
    if (!hasDir || _vA.lengthSq() < 1e-8) _vA.set(0, 1, 0);
    _vA.normalize();
    basisFrom(_vA, _vB, _vC);

    const n = Math.max(3, Math.round(optNum(o, 'count', 12) * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const a = rnd() * 6.283;
      const r = Math.sqrt(rnd()) * spread;
      const sp = rrange(4, 13) * power;
      const dx = _vA.x + (_vB.x * Math.cos(a) + _vC.x * Math.sin(a)) * r;
      const dy = _vA.y + (_vB.y * Math.cos(a) + _vC.y * Math.sin(a)) * r;
      const dz = _vA.z + (_vB.z * Math.cos(a) + _vC.z * Math.sin(a)) * r;
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.16, 0.42);
      S.size0 = rrange(0.045, 0.10);
      S.size1 = S.size0 * 0.3;
      S.stretch = 1;
      S.aspect = 1.5;
      colBoth(c); col0White(0.75);
      S.alpha = 1;
      S.grav = 22;
      S.drag = 1.4;
      S.fade = FADE_FLASH;
      pushParticle(D, x, y, z, dx * sp, dy * sp, dz * sp);
    }
  },

  /* ---- lava pop: rising blob, hot droplets, sooty puff -------------------- */
  lavaPop(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xff7a1a;
    const D = sys.addLayer, A = sys.alphaLayer;
    const q = sys.scale;
    const power = optNum(o, 'power', 1);

    sReset();
    S.sprite = SPRITE.EMBER;
    S.life = rrange(0.5, 0.85);
    S.size0 = 0.4 * power;
    S.size1 = 0.12 * power;
    colBoth(c); col0White(0.45); col1(0x8a1c05);
    S.alpha = 1;
    S.grav = 9;
    S.drag = 1.1;
    S.flags = F_FLICKER;
    S.fade = FADE_LINEAR;
    pushParticle(D, x, y + 0.1, z, rsym() * 0.6, rrange(2.5, 5) * power, rsym() * 0.6);

    const n = Math.max(3, Math.round(7 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(1.4, 4.2) * power;
      S.sprite = SPRITE.EMBER;
      S.life = rrange(0.55, 1.0);
      S.size0 = rrange(0.06, 0.16) * power;
      S.size1 = S.size0 * 0.4;
      colBoth(c); col0White(0.55); col1(0x6d1403);
      S.alpha = 1;
      S.grav = 13;
      S.drag = 0.7;
      S.flags = F_FLICKER;
      S.fade = FADE_LINEAR;
      pushParticle(D, x, y + 0.08, z, Math.cos(th) * sp, rrange(3, 7) * power, Math.sin(th) * sp);
    }

    sReset();
    S.sprite = SPRITE.SMOKE;
    S.life = rrange(1.0, 1.7);
    S.size0 = 0.3 * power;
    S.size1 = 1.5 * power;
    col0(0x241812); col1(0x0d0a09);
    S.alpha = 0.24;
    S.grav = -0.8;
    S.drag = 1.4;
    S.spin = rsym() * 0.6;
    S.rot = rnd() * 6.283;
    pushParticle(A, x, y + 0.2, z, rsym() * 0.4, 1.1, rsym() * 0.4);
  },

  /* ---- ice shard burst ---------------------------------------------------- */
  iceShard(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xbfe6ff;
    const D = sys.addLayer;
    const q = sys.scale;
    const n = Math.max(4, Math.round(11 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(2.5, 7.5);
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.45, 0.9);
      S.size0 = rrange(0.07, 0.17);
      S.size1 = S.size0 * 0.7;
      S.aspect = 1.7;
      colBoth(c); col0White(0.65); col1(0x4a86b8);
      S.alpha = 1;
      S.grav = 16;
      S.drag = 0.8;
      S.spin = rsym() * 10;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushParticle(D, x, y, z, Math.cos(th) * sp, rrange(1.5, 5.5), Math.sin(th) * sp);
    }
    const m = Math.max(2, Math.round(5 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = SPRITE.SNOW;
      S.life = rrange(0.9, 1.6);
      S.size0 = rrange(0.05, 0.10);
      S.size1 = S.size0;
      colBoth(0xe8f6ff);
      S.alpha = 0.75;
      S.grav = 2.6;
      S.drag = 1.6;
      S.spin = rsym() * 3;
      S.turb = 0.5;
      S.flags = F_SWAY;
      S.fade = FADE_LINEAR;
      pushParticle(D, x, y, z, Math.cos(th) * 1.4, rrange(1, 3), Math.sin(th) * 1.4);
    }
  },

  /* ---- generic dust puff -------------------------------------------------- */
  dust(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const A = sys.alphaLayer;
    const q = sys.scale;
    const scale = optNum(o, 'scale', 1);
    const n = Math.max(2, Math.round(optNum(o, 'count', 7) * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = rnd() < 0.5 ? SPRITE.DUST : SPRITE.SMOKE;
      S.life = rrange(0.45, 0.95);
      S.size0 = rrange(0.12, 0.28) * scale;
      S.size1 = S.size0 * 2.8;
      colBoth(tint);
      S.r1 *= 0.5; S.g1 *= 0.5; S.b1 *= 0.5;
      S.alpha = 0.16;
      S.grav = 1.1;
      S.drag = 2.6;
      S.spin = rsym() * 1.1;
      S.rot = rnd() * 6.283;
      pushParticle(A, x + rsym() * 0.15 * scale, y + rsym() * 0.1 * scale, z + rsym() * 0.15 * scale,
        Math.cos(th) * 1.1 * scale, rrange(0.2, 1.0), Math.sin(th) * 1.1 * scale);
    }
  },

  /* ---- wall scrape: sparks shed off a wall while wall-sliding ------------- */
  wallScrape(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : surfaceTint(o.surface, 0xffc98a);
    const D = sys.addLayer, A = sys.alphaLayer;
    const q = sys.scale;
    const speed = clamp(optNum(o, 'speed', 4) / 8, 0.15, 1.6);
    const hasN = readVec(o.normal, _vA);
    if (!hasN || _vA.lengthSq() < 1e-8) _vA.set(0, 0, 1);
    _vA.normalize();

    const n = Math.max(2, Math.round(6 * q * speed));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.14, 0.34);
      S.size0 = rrange(0.035, 0.075);
      S.size1 = S.size0 * 0.3;
      S.stretch = 1;
      S.aspect = 1.4;
      colBoth(c); col0White(0.8);
      S.alpha = 1;
      S.grav = 24;
      S.drag = 1.2;
      S.fade = FADE_FLASH;
      pushParticle(D,
        x + _vA.x * 0.06 + rsym() * 0.08,
        y + rsym() * 0.28,
        z + _vA.z * 0.06 + rsym() * 0.08,
        _vA.x * rrange(1.2, 3.4) + rsym() * 1.4,
        rrange(-1.5, 1.2),
        _vA.z * rrange(1.2, 3.4) + rsym() * 1.4);
    }

    if (rnd() < 0.5 * q) {
      sReset();
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.35, 0.6);
      S.size0 = 0.10;
      S.size1 = 0.45;
      colBoth(c);
      S.r0 *= 0.6; S.g0 *= 0.6; S.b0 *= 0.6;
      S.r1 *= 0.3; S.g1 *= 0.3; S.b1 *= 0.3;
      S.alpha = 0.12;
      S.grav = 1.4;
      S.drag = 2.4;
      S.spin = rsym();
      S.rot = rnd() * 6.283;
      pushParticle(A, x + _vA.x * 0.08, y + rsym() * 0.2, z + _vA.z * 0.08,
        _vA.x * 0.8, -0.4, _vA.z * 0.8);
    }
  },

  /* ---- bounce pad launch -------------------------------------------------- */
  bounce(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.bounce;
    const D = sys.addLayer;
    const q = sys.scale;
    const power = clamp(optNum(o, 'power', 4) / 6, 0.4, 2.2);

    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.34;
    S.size0 = 0.55;
    S.size1 = 2.4 + 1.4 * power;
    S.aspect = 0.45;
    colBoth(c); col0White(0.5);
    S.alpha = 0.9;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y + 0.08, z, 0, 0, 0);

    const n = Math.max(6, Math.round(16 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.3;
      const r = 0.25 + rnd() * 0.35;
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.3, 0.6);
      S.size0 = rrange(0.06, 0.13);
      S.size1 = S.size0 * 0.35;
      S.stretch = 1;
      S.aspect = 1.7;
      colBoth(c); col0White(0.6);
      S.alpha = 1;
      S.grav = 10;
      S.drag = 1.0;
      S.fade = FADE_FLASH;
      pushParticle(D, x + Math.cos(ang) * r, y + 0.1, z + Math.sin(ang) * r,
        Math.cos(ang) * 1.6, rrange(5, 10) * power, Math.sin(ang) * 1.6);
    }
  },

  /* ---- crusher / heavy impact -------------------------------------------- */
  crush(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xd8dee8;
    BURSTS.dust(sys, x, y, z, { color: c, count: 12, scale: 1.6 });
    BURSTS.spark(sys, x, y, z, { color: 0xffd0a0, count: 10, dir: [0, 1, 0], spread: 1.3, power: 0.8 });
    const D = sys.addLayer;
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.3;
    S.size0 = 0.7;
    S.size1 = 4.6;
    S.aspect = 0.5;
    colBoth(c);
    S.alpha = 0.45;
    S.fade = FADE_HOLD;
    pushParticle(D, x, y, z, 0, 0, 0);
  },

  /* ---- laser contact sizzle ---------------------------------------------- */
  laserHit(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : CAUSE_COLOR.laser;
    const D = sys.addLayer;
    const q = sys.scale;
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.18;
    S.size0 = 0.85;
    S.size1 = 0.2;
    colBoth(c); col0White(0.7);
    S.alpha = 0.95;
    S.fade = FADE_FLASH;
    pushParticle(D, x, y, z, 0, 0, 0);
    BURSTS.spark(sys, x, y, z, { color: c, count: 9, dir: o.dir || [0, 1, 0], spread: 1.1, power: 0.7 });
    const n = Math.max(2, Math.round(5 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.EMBER;
      S.life = rrange(0.4, 0.8);
      S.size0 = rrange(0.04, 0.09);
      S.size1 = S.size0 * 0.4;
      colBoth(c);
      S.alpha = 1;
      S.grav = -1.2;
      S.drag = 1.4;
      S.turb = 0.7;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushParticle(D, x + rsym() * 0.1, y + rsym() * 0.1, z + rsym() * 0.1,
        rsym() * 0.8, rrange(0.5, 1.6), rsym() * 0.8);
    }
  },

  /* ---- vanish platform blink-out ----------------------------------------- */
  vanish(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0x9fd0ff;
    const D = sys.addLayer;
    const q = sys.scale;
    const sx = optNum(o, 'sx', 1.4), sz = optNum(o, 'sz', 1.4);
    const n = Math.max(4, Math.round(14 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.35, 0.7);
      S.size0 = rrange(0.06, 0.14);
      S.size1 = S.size0 * 0.3;
      S.aspect = 1.6;
      colBoth(c); col0White(0.5);
      S.alpha = 1;
      S.grav = 6;
      S.drag = 1.2;
      S.spin = rsym() * 7;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushParticle(D, x + rsym() * sx, y, z + rsym() * sz, rsym() * 1.2, rrange(0.5, 2.4), rsym() * 1.2);
    }
  },
};

/** every burst preset name, in the order the contract lists them */
export const BURST_PRESETS = Object.freeze([
  'land', 'death', 'checkpoint', 'finish', 'coin', 'spark',
  'lavaPop', 'iceShard', 'dust', 'wallScrape', 'jump', 'bounce',
  'crush', 'laserHit', 'vanish',
]);

/* ------------------------------------------------------------------ *
 *  ambient emitters
 * ------------------------------------------------------------------ */

const AMBIENT = {
  ember: {
    rate: 14, radius: 26, yBias: 'bottom', color: 0xff8a2e, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.EMBER;
      S.life = rrange(2.4, 4.4);
      S.size0 = rrange(0.045, 0.095);
      S.size1 = S.size0 * 0.45;
      colBoth(color); col0White(0.3); col1(0xb0300a);
      S.alpha = 0.95;
      S.grav = -0.26;
      S.drag = 0.55;
      S.turb = 0.6;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushParticle(sys.addLayer, x, y, z, rsym() * 0.35, rrange(0.5, 1.3), rsym() * 0.35);
    },
  },
  snow: {
    rate: 26, radius: 30, yBias: 'top', color: 0xdceeff, themed: false,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.SNOW;
      S.life = rrange(4.5, 8.0);
      S.size0 = rrange(0.05, 0.115);
      S.size1 = S.size0;
      colBoth(color);
      S.alpha = 0.55;
      S.grav = 0.16;
      S.drag = 0.62;
      S.spin = rsym() * 0.8;
      S.turb = 0.75;
      S.flags = F_SWAY;
      S.rot = rnd() * 6.283;
      S.fade = FADE_LINEAR;
      pushParticle(sys.alphaLayer, x, y, z,
        sys.wind.x + rsym() * 0.25, -rrange(1.1, 1.9), sys.wind.z + rsym() * 0.25);
    },
  },
  mote: {
    rate: 16, radius: 20, yBias: 'any', color: 0xcfe6ff, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.DOT;
      S.life = rrange(4, 8.5);
      S.size0 = rrange(0.028, 0.07);
      S.size1 = S.size0 * 0.8;
      colBoth(color);
      S.alpha = 0.36;
      S.grav = -0.025;
      S.drag = 0.5;
      S.turb = 0.16;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushParticle(sys.addLayer, x, y, z, rsym() * 0.12, rrange(-0.05, 0.14), rsym() * 0.12);
    },
  },
  spark: {
    rate: 9, radius: 26, yBias: 'any', color: 0xffd08a, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.35, 0.85);
      S.size0 = rrange(0.04, 0.085);
      S.size1 = S.size0 * 0.3;
      S.stretch = 1;
      S.aspect = 1.4;
      colBoth(color); col0White(0.6);
      S.alpha = 1;
      S.grav = 9;
      S.drag = 0.9;
      S.fade = FADE_FLASH;
      pushParticle(sys.addLayer, x, y, z, rsym() * 1.6, rrange(-1.5, 1.5), rsym() * 1.6);
    },
  },
  pollen: {
    rate: 12, radius: 22, yBias: 'any', color: 0xe8dfae, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.DUST;
      S.life = rrange(6, 11);
      S.size0 = rrange(0.055, 0.14);
      S.size1 = S.size0 * 0.9;
      colBoth(color);
      S.alpha = 0.3;
      S.grav = 0.05;
      S.drag = 0.7;
      S.spin = rsym() * 0.4;
      S.turb = 0.28;
      S.flags = F_SWAY;
      S.rot = rnd() * 6.283;
      S.fade = FADE_LINEAR;
      pushParticle(sys.alphaLayer, x, y, z, sys.wind.x * 0.5, rrange(-0.15, 0.2), sys.wind.z * 0.5);
    },
  },
  haze: {
    rate: 3, radius: 26, yBias: 'any', color: 0x8fa4bd, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(8, 15);
      S.size0 = rrange(1.4, 3.2);
      S.size1 = S.size0 * 1.6;
      colBoth(color);
      S.alpha = 0.055;
      S.grav = -0.01;
      S.drag = 0.9;
      S.spin = rsym() * 0.06;
      S.rot = rnd() * 6.283;
      pushParticle(sys.alphaLayer, x, y, z, sys.wind.x * 0.3, 0.03, sys.wind.z * 0.3);
    },
  },
};

/** every ambient preset name */
export const AMBIENT_PRESETS = Object.freeze(Object.keys(AMBIENT));

/* ------------------------------------------------------------------ *
 *  quality
 * ------------------------------------------------------------------ */

function resolveQuality(q) {
  if (q == null) return { key: 'high', particles: 1 };
  if (typeof q === 'string') {
    const src = (QUALITY && QUALITY[q]) || QUALITY_FALLBACK[q] || QUALITY_FALLBACK.high;
    const p = typeof src.particles === 'number' ? src.particles : 1;
    return { key: q, particles: p };
  }
  if (typeof q === 'object') {
    const p = typeof q.particles === 'number' ? q.particles : 1;
    return { key: q.id || q.name || 'custom', particles: p };
  }
  return { key: 'high', particles: 1 };
}

/* ------------------------------------------------------------------ *
 *  ParticleSystem
 * ------------------------------------------------------------------ */

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {string|object} quality  'low'|'medium'|'high'|'ultra' or a QUALITY entry
   * @param {object} [opts] {capacity, camera, seed}
   */
  constructor(scene, quality = 'high', opts = EMPTY_OPTS) {
    this.scene = scene || null;
    this.enabled = true;
    this.camera = opts.camera || null;
    this.baseCapacity = Math.max(200, opts.capacity || BASE_CAPACITY);

    if (typeof opts.seed === 'number') RNG = mulberry32(opts.seed >>> 0);

    const q = resolveQuality(quality);
    this.qualityKey = q.key;
    this.scale = clamp(q.particles, 0.15, 2);

    this.texture = buildAtlasTexture();

    this.addLayer = null;
    this.alphaLayer = null;
    this._buildLayers();

    /** ambient emitters bound to stage volumes */
    this.emitters = [];
    this._ambientId = 0;

    /** theme-driven tints, overridden by setTheme() */
    this.tint = {
      checkpoint: 0x7ef0ff,
      finish: 0xffd76a,
      coin: 0xffcf4d,
      bounce: 0xffd27a,
      accent: 0x7ec8ff,
      ambient: null,
    };

    this.wind = new THREE.Vector3(0.25, 0, 0.1);
    this.time = 0;
    this.theme = null;
    this._fogNear = 30;
    this._fogFar = 220;
  }

  /* ---- layer lifecycle -------------------------------------------------- */

  _buildLayers() {
    const total = clamp(Math.round(this.baseCapacity * this.scale), 240, 6000);
    const addCap = Math.max(120, Math.round(total * ADDITIVE_SHARE));
    const alphaCap = Math.max(80, total - addCap);

    this.capacity = addCap + alphaCap;
    this.addLayer = new Layer(addCap, this.texture, true);
    this.alphaLayer = new Layer(alphaCap, this.texture, false);

    if (this.scene && this.scene.add) {
      this.scene.add(this.alphaLayer.mesh);
      this.scene.add(this.addLayer.mesh);
    }
  }

  _destroyLayers() {
    if (this.addLayer) this.addLayer.dispose();
    if (this.alphaLayer) this.alphaLayer.dispose();
    this.addLayer = null;
    this.alphaLayer = null;
  }

  /* ---- configuration ---------------------------------------------------- */

  setQuality(q) {
    const r = resolveQuality(q);
    const next = clamp(r.particles, 0.15, 2);
    this.qualityKey = r.key;
    if (Math.abs(next - this.scale) < 1e-4) return;
    this.scale = next;
    this._destroyLayers();
    this._buildLayers();
  }

  setCamera(camera) {
    this.camera = camera || null;
  }

  setWind(x, y, z) {
    this.wind.set(x || 0, y || 0, z || 0);
  }

  /** pull ambient colour + accent tints out of a ThemeDef (themes.js §9) */
  setTheme(theme) {
    this.theme = theme || null;
    if (!theme) return;
    const pal = theme.palette;
    if (pal) {
      if (pal.checkpointOn !== undefined) this.tint.checkpoint = pal.checkpointOn;
      else if (pal.checkpoint !== undefined) this.tint.checkpoint = pal.checkpoint;
      if (pal.finish !== undefined) this.tint.finish = pal.finish;
      if (pal.accent !== undefined) this.tint.accent = pal.accent;
      if (pal.safeEdge !== undefined) this.tint.bounce = pal.safeEdge;
    }
    const tp = theme.particles;
    this.tint.ambient = tp && tp.color !== undefined ? tp.color : null;
  }

  /* ---- bursts ----------------------------------------------------------- */

  /**
   * @param {string} preset  see BURST_PRESETS
   * @param {THREE.Vector3|number[]} pos
   * @param {object} [opts] {strength, color, surface, cause, dir, normal, count, power, scale, speed}
   */
  burst(preset, pos, opts) {
    if (!this.enabled || !this.addLayer) return;
    const fn = BURSTS[preset];
    if (!fn) return;
    if (!readVec(pos, _vA)) return;
    fn(this, _vA.x, _vA.y, _vA.z, opts || EMPTY_OPTS);
  }

  /* ---- ambience --------------------------------------------------------- */

  /**
   * Bind a continuous emitter to a stage volume.
   * @param {string} preset 'ember'|'snow'|'mote'|'spark'|'pollen'|'haze'
   * @param {THREE.Box3|number[]} box  volume (Box3 or [minx,miny,minz,maxx,maxy,maxz])
   * @param {number} rate particles/second before quality scaling
   * @param {object} [opts] {color}
   * @returns {object|null} handle for removeAmbient()
   */
  ambient(preset, box, rate, opts = EMPTY_OPTS) {
    const def = AMBIENT[preset];
    if (!def) return null;
    const e = {
      id: ++this._ambientId,
      preset,
      rate: typeof rate === 'number' && rate > 0 ? rate : def.rate,
      acc: 0,
      enabled: true,
      color: opts.color !== undefined ? opts.color
        : (def.themed && this.tint.ambient != null ? this.tint.ambient : def.color),
      min: new THREE.Vector3(-40, -10, -40),
      max: new THREE.Vector3(40, 40, 40),
    };
    if (box && box.min && box.max) { e.min.copy(box.min); e.max.copy(box.max); }
    else if (Array.isArray(box) && box.length >= 6) {
      e.min.set(box[0], box[1], box[2]);
      e.max.set(box[3], box[4], box[5]);
    }
    // guarantee a non-degenerate volume
    if (e.max.x - e.min.x < 0.5) { e.min.x -= 0.5; e.max.x += 0.5; }
    if (e.max.y - e.min.y < 0.5) { e.min.y -= 0.5; e.max.y += 0.5; }
    if (e.max.z - e.min.z < 0.5) { e.min.z -= 0.5; e.max.z += 0.5; }
    this.emitters.push(e);
    return e;
  }

  removeAmbient(handle) {
    if (!handle) return;
    const i = this.emitters.indexOf(handle);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  clearAmbient() {
    this.emitters.length = 0;
  }

  /** kill every live particle (stage change / respawn) */
  clear() {
    if (this.addLayer) { this.addLayer.count = 0; this.addLayer.cursor = 0; this.addLayer.mesh.count = 0; }
    if (this.alphaLayer) { this.alphaLayer.count = 0; this.alphaLayer.cursor = 0; this.alphaLayer.mesh.count = 0; }
  }

  _spawnAmbient(e, dt) {
    const def = AMBIENT[e.preset];
    if (!def || !e.enabled) return;

    e.acc += e.rate * this.scale * dt;
    let n = e.acc | 0;
    if (n <= 0) return;
    e.acc -= n;
    if (n > 14) n = 14;

    let minx = e.min.x, miny = e.min.y, minz = e.min.z;
    let maxx = e.max.x, maxy = e.max.y, maxz = e.max.z;

    const cam = this.camera;
    if (cam && cam.position) {
      const R = def.radius;
      const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      if (minx < cx - R) minx = cx - R;
      if (maxx > cx + R) maxx = cx + R;
      if (minz < cz - R) minz = cz - R;
      if (maxz > cz + R) maxz = cz + R;
      const ry = R * 0.75;
      if (miny < cy - ry) miny = cy - ry;
      if (maxy > cy + ry) maxy = cy + ry;
      if (minx > maxx || miny > maxy || minz > maxz) { e.acc = 0; return; }
    }

    const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz;
    for (let i = 0; i < n; i++) {
      const x = minx + dx * rnd();
      const z = minz + dz * rnd();
      let y;
      if (def.yBias === 'top') y = maxy - dy * rnd() * 0.22;
      else if (def.yBias === 'bottom') y = miny + dy * rnd() * 0.3;
      else y = miny + dy * rnd();
      def.spawn(this, x, y, z, e.color);
    }
  }

  /* ---- fog ------------------------------------------------------------- */

  _syncFog() {
    const fog = this.scene && this.scene.fog;
    const layers = [this.addLayer, this.alphaLayer];
    if (!fog) {
      for (const L of layers) if (L) L.material.uniforms.uFogAmount.value = 0;
      return;
    }
    let near, far;
    if (typeof fog.density === 'number') {
      const d = Math.max(fog.density, 1e-5);
      near = 0.35 / d;
      far = 1.9 / d;
    } else {
      near = fog.near;
      far = fog.far;
    }
    this._fogNear = near;
    this._fogFar = far;
    for (const L of layers) {
      if (!L) continue;
      const u = L.material.uniforms;
      u.uFogAmount.value = 1;
      u.uFogRange.value.set(near, far);
      if (fog.color) u.uFogColor.value.copy(fog.color);
    }
  }

  /* ---- frame ------------------------------------------------------------ */

  update(dt) {
    if (!this.addLayer || !this.alphaLayer) return;
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    if (d <= 0) return;
    this.time += d;

    if (this.enabled) {
      for (let i = 0; i < this.emitters.length; i++) this._spawnAmbient(this.emitters[i], d);
    }

    simulateLayer(this.addLayer, d, this.time);
    simulateLayer(this.alphaLayer, d, this.time);

    this._syncFog();

    uploadLayer(this.addLayer);
    uploadLayer(this.alphaLayer);
  }

  /* ---- introspection (used by the perf HUD and the harness) ------------- */

  get liveCount() {
    return (this.addLayer ? this.addLayer.count : 0) + (this.alphaLayer ? this.alphaLayer.count : 0);
  }

  get drawCalls() {
    let n = 0;
    if (this.addLayer && this.addLayer.count > 0) n++;
    if (this.alphaLayer && this.alphaLayer.count > 0) n++;
    return n;
  }

  setVisible(v) {
    if (this.addLayer) this.addLayer.mesh.visible = !!v;
    if (this.alphaLayer) this.alphaLayer.mesh.visible = !!v;
  }

  dispose() {
    this.clearAmbient();
    this._destroyLayers();
    if (this.texture) { this.texture.dispose(); this.texture = null; }
    this.scene = null;
    this.camera = null;
  }
}

/* ------------------------------------------------------------------ *
 *  Trail — fixed-length camera-facing ribbon
 * ------------------------------------------------------------------ */

const TRAIL_VERT = /* glsl */`
  attribute float aSide;
  attribute float aT;
  attribute vec3  aTangent;

  uniform float uWidth;
  uniform float uTaper;

  varying float vSide;
  varying float vT;

  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vec3 tv = ( modelViewMatrix * vec4( aTangent, 0.0 ) ).xyz;
    float tl = length( tv );
    tv = ( tl > 1e-5 ) ? tv / tl : vec3( 0.0, 1.0, 0.0 );

    vec3 vd = -mv.xyz;                       // toward the camera, in view space
    float vl = length( vd );
    vd = ( vl > 1e-5 ) ? vd / vl : vec3( 0.0, 0.0, 1.0 );
    vec3 perp = cross( tv, vd );
    float pl = length( perp );
    perp = ( pl > 1e-5 ) ? perp / pl : vec3( 1.0, 0.0, 0.0 );

    float w = uWidth * mix( 1.0, aT, uTaper );
    mv.xyz += perp * ( aSide * w );

    gl_Position = projectionMatrix * mv;
    vSide = aSide;
    vT = aT;
  }
`;

const TRAIL_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;

  varying float vSide;
  varying float vT;

  void main() {
    float e     = 1.0 - abs( vSide );   // 1 at the ribbon spine, 0 at its edges
    float body  = e * e;                // soft feathered edges
    float along = vT * vT;              // bright at the head, gone at the tail
    float a     = body * along * uOpacity;
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( uColor * ( 0.55 + 0.65 * e ), a );
    #include <colorspace_fragment>
  }
`;

/**
 * A fixed-length ribbon strip. Used by saw sparks, coin pickups and the finish
 * vortex. Points are stored head-first in a Float32Array ring that is shifted with
 * copyWithin — no allocation, ever.
 */
export class Trail {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] {length, width, color, blending:'additive'|'alpha',
   *                         taper, minDist, opacity, renderOrder}
   */
  constructor(scene, opts = EMPTY_OPTS) {
    this.scene = scene || null;
    this.length = Math.max(4, Math.min(96, opts.length || 22));
    this.width = typeof opts.width === 'number' ? opts.width : 0.12;
    this.minDist = typeof opts.minDist === 'number' ? opts.minDist : 0.03;
    this.taper = opts.taper === false ? 0 : 1;
    this.additive = opts.blending !== 'alpha';

    const L = this.length;
    const V = L * 2;

    this._pts = new Float32Array(L * 3);
    this._seeded = false;
    this._head = new THREE.Vector3();

    const position = new Float32Array(V * 3);
    const tangent = new Float32Array(V * 3);
    const side = new Float32Array(V);
    const tt = new Float32Array(V);

    for (let i = 0; i < L; i++) {
      const t = 1 - i / (L - 1);      // 1 at the head, 0 at the tail
      side[i * 2] = -1; side[i * 2 + 1] = 1;
      tt[i * 2] = t; tt[i * 2 + 1] = t;
    }

    const idx = new Uint16Array((L - 1) * 6);
    for (let i = 0; i < L - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      const o = i * 6;
      idx[o] = a; idx[o + 1] = b; idx[o + 2] = c;
      idx[o + 3] = b; idx[o + 4] = d; idx[o + 5] = c;
    }

    const geo = new THREE.BufferGeometry();
    this._aPos = new THREE.BufferAttribute(position, 3);
    this._aTan = new THREE.BufferAttribute(tangent, 3);
    this._aPos.setUsage(THREE.DynamicDrawUsage);
    this._aTan.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._aPos);
    geo.setAttribute('aTangent', this._aTan);
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(opts.color !== undefined ? opts.color : 0xffffff) },
        uOpacity: { value: typeof opts.opacity === 'number' ? opts.opacity : 1 },
        uWidth: { value: this.width },
        uTaper: { value: this.taper },
      },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
      fog: false,
    });

    this.geometry = geo;
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.renderOrder = typeof opts.renderOrder === 'number' ? opts.renderOrder : 9;
    this.mesh.name = 'fx.trail';
    if (this.scene && this.scene.add) this.scene.add(this.mesh);
  }

  /** snap the whole ribbon to a single point (spawn / teleport) */
  reset(p) {
    if (!readVec(p, _vA)) return;
    const L = this.length;
    for (let i = 0; i < L; i++) {
      this._pts[i * 3] = _vA.x;
      this._pts[i * 3 + 1] = _vA.y;
      this._pts[i * 3 + 2] = _vA.z;
    }
    this._seeded = true;
    this._head.copy(_vA);
    this._rebuild();
  }

  /**
   * Advance the ribbon. Call once per frame with the current head position.
   * @param {number} dt
   * @param {THREE.Vector3|number[]} p
   */
  update(dt, p) {
    if (!readVec(p, _vA)) return;
    if (!this._seeded) { this.reset(_vA); return; }

    const dx = _vA.x - this._pts[0];
    const dy = _vA.y - this._pts[1];
    const dz = _vA.z - this._pts[2];
    const d2 = dx * dx + dy * dy + dz * dz;

    if (d2 >= this.minDist * this.minDist) {
      this._pts.copyWithin(3, 0, (this.length - 1) * 3);
      this._pts[0] = _vA.x; this._pts[1] = _vA.y; this._pts[2] = _vA.z;
    } else {
      this._pts[0] = _vA.x; this._pts[1] = _vA.y; this._pts[2] = _vA.z;
    }
    this._head.copy(_vA);
    this._rebuild();
  }

  _rebuild() {
    const L = this.length;
    const pts = this._pts;
    const pos = this._aPos.array;
    const tan = this._aTan.array;

    for (let i = 0; i < L; i++) {
      const i3 = i * 3;
      const px = pts[i3], py = pts[i3 + 1], pz = pts[i3 + 2];

      const a = i === 0 ? 0 : (i - 1) * 3;
      const b = i === L - 1 ? i3 : (i + 1) * 3;
      let tx = pts[a] - pts[b];
      let ty = pts[a + 1] - pts[b + 1];
      let tz = pts[a + 2] - pts[b + 2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-6) { tx /= tl; ty /= tl; tz /= tl; } else { tx = 0; ty = 1; tz = 0; }

      const v0 = i * 6;
      pos[v0] = px; pos[v0 + 1] = py; pos[v0 + 2] = pz;
      pos[v0 + 3] = px; pos[v0 + 4] = py; pos[v0 + 5] = pz;
      tan[v0] = tx; tan[v0 + 1] = ty; tan[v0 + 2] = tz;
      tan[v0 + 3] = tx; tan[v0 + 4] = ty; tan[v0 + 5] = tz;
    }
    this._aPos.needsUpdate = true;
    this._aTan.needsUpdate = true;
  }

  setColor(c) { this.material.uniforms.uColor.value.set(c); }
  setWidth(w) { this.width = w; this.material.uniforms.uWidth.value = w; }
  setOpacity(a) { this.material.uniforms.uOpacity.value = clamp(a, 0, 1); }
  setVisible(v) { this.mesh.visible = !!v; }

  /** fade the ribbon out over `sec` seconds; returns the current opacity */
  fade(dt, sec = 0.35) {
    const u = this.material.uniforms.uOpacity;
    u.value = clamp(u.value - dt / Math.max(sec, 1e-3), 0, 1);
    if (u.value <= 0.001) this.mesh.visible = false;
    return u.value;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.scene = null;
  }
}

/* re-export a couple of helpers the rest of the FX layer shares */
export { SURFACE_TINT };
export default ParticleSystem;
