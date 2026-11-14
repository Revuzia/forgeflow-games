/**
 * CRESTBOUND — runtime/fx/particles.js
 * CONTRACT §8.
 *
 * ONE camera-facing quad instanced into ONE InstancedMesh => ONE draw call for
 * every particle in the game (contract hard rule 4: "one particle draw call").
 *
 * Ascendant split additive (sparks) and alpha (dust) into two meshes because a
 * three Material carries one blend mode. Here both live in one buffer: the
 * material uses CUSTOM PREMULTIPLIED blending
 *
 *     out = src.rgb * 1 + dst.rgb * (1 - src.a)
 *
 * and the fragment shader writes premultiplied colour with a per-instance
 * blend flag (aParams.w): an ALPHA particle emits (c*a, a) — classic "over";
 * an ADDITIVE particle emits (c*a, 0) — the destination is kept whole and the
 * colour is added. Same equation, two behaviours, one draw. Fog follows suit:
 * alpha particles mix toward the fog colour, additive ones fade out.
 *
 * Draw order inside the buffer is spawn order (no sort, no depth write); dust
 * spawned after a spark will partially cover it for a few frames. That is
 * invisible in practice and the cost of sorting 2500 instances per frame is
 * not.
 *
 * Everything is a fixed-capacity Float32Array. Simulation runs on the CPU into
 * the SAME arrays that back the InstancedBufferAttributes, so an "upload" is a
 * single bufferSubData over the live prefix. No object churn, no per-frame
 * allocation: every scratch vector is module-scope and the shared spawn
 * descriptor `S` is reused for every particle ever spawned.
 *
 * Billboarding, atlas UV selection, streak stretching, aspect and fog are all
 * done in the vertex shader from instanced attributes.
 *
 * update(dt, camPos): ambient emitters only spawn inside a radius around the
 * camera (per-preset), so a course-wide snow volume costs the same as a room.
 *
 * Capacity: 2500 live at `high` (contract), scaled by QUALITY.particles.
 *
 * Art-direction law (inherited, non-negotiable):
 *   - nothing lives longer than it needs to
 *   - nothing large ever spawns between the hero and the next platform
 *   - smoke is small, dark and low; brightness is reserved for information
 *   - dust is surface-tinted (SURFACE_TINT) so a landing on grass reads green-
 *     grey and one on snow reads white without anyone choosing a colour
 */

import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from '../core/util.js';
import { QUALITY } from '../core/settings.js';

/* ------------------------------------------------------------------ *
 *  constants
 * ------------------------------------------------------------------ */

const ATLAS_COLS = 4;
const ATLAS_ROWS = 3;
const ATLAS_CELL = 128;

/** sprite atlas slots (index into the 4x3 procedural atlas) */
export const SPRITE = {
  SMOKE: 0,
  STREAK: 1,
  EMBER: 2,
  SNOW: 3,
  SHARD: 4,
  RING: 5,
  DOT: 6,
  DUST: 7,
  DROP: 8,      // water droplet: bright rim, dark centre highlight
  BUBBLE: 9,    // thin ring with a specular dot
  LEAF: 10,     // lobed leaf silhouette
  CONFETTI: 11, // small rounded rectangle
};

/** per-particle behaviour flags */
const F_GROUND = 1;   // collide with a horizontal plane at cGround
const F_FLICKER = 2;  // high-frequency alpha flicker (embers, fire)
const F_SWAY = 4;     // horizontal positional sway (snow, pollen, leaves)
const F_TURB = 8;     // velocity turbulence (rising embers)
const F_FLUTTER = 16; // confetti/leaf tumble: size oscillates (flat card turning)

/** alpha envelopes */
const FADE_SMOOTH = 0; // soft in, quadratic out            (smoke / dust)
const FADE_FLASH = 1;  // instant in, cubic out             (sparks / shards)
const FADE_LINEAR = 2; // quick in, linear out              (motes)
const FADE_HOLD = 3;   // instant in, hold, late fade       (rings / flares)

/** contract: ≤ 2500 live at high */
const BASE_CAPACITY = 2500;
const MAX_CAPACITY = 3600;
const MIN_CAPACITY = 300;

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
const _vD = new THREE.Vector3();
const _camPos = new THREE.Vector3(0, 0, 0);

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
 * Shared spawn descriptor. Presets fill this, then call push(). Reused for
 * every single particle in the game — never allocated.
 */
const S = {
  life: 1, size0: 0.2, size1: 0.2, sprite: SPRITE.DOT,
  stretch: 0, aspect: 1, rot: 0, spin: 0,
  r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1,
  alpha: 1, grav: 0, drag: 0, turb: 0,
  flags: 0, ground: -1e9, fade: FADE_SMOOTH, add: 0,
};

function sReset() {
  S.life = 1; S.size0 = 0.2; S.size1 = 0.2; S.sprite = SPRITE.DOT;
  S.stretch = 0; S.aspect = 1; S.rot = 0; S.spin = 0;
  S.r0 = 1; S.g0 = 1; S.b0 = 1; S.r1 = 1; S.g1 = 1; S.b1 = 1;
  S.alpha = 1; S.grav = 0; S.drag = 0; S.turb = 0;
  S.flags = 0; S.ground = -1e9; S.fade = FADE_SMOOTH; S.add = 0;
}

/** set the start colour (accepts hex number, css string, or THREE.Color) */
function col0(c) { _col.set(c); S.r0 = _col.r; S.g0 = _col.g; S.b0 = _col.b; }
/** set the end colour */
function col1(c) { _col.set(c); S.r1 = _col.r; S.g1 = _col.g; S.b1 = _col.b; }
/** both ends the same */
function colBoth(c) { _col.set(c); S.r0 = S.r1 = _col.r; S.g0 = S.g1 = _col.g; S.b0 = S.b1 = _col.b; }
/** scale the start colour (hot-core boosting) */
function col0Scale(k) { S.r0 *= k; S.g0 *= k; S.b0 *= k; }
/** scale the end colour */
function col1Scale(k) { S.r1 *= k; S.g1 *= k; S.b1 *= k; }
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

/** read opts.dir (or opts.normal) into _vA as a unit vector, defaulting to `dx,dy,dz` */
function readDir(o, key, dx, dy, dz) {
  if (!readVec(o[key], _vA) || _vA.lengthSq() < 1e-8) _vA.set(dx, dy, dz);
  _vA.normalize();
  return _vA;
}

/* ------------------------------------------------------------------ *
 *  procedural sprite atlas
 * ------------------------------------------------------------------ */

/**
 * Generates the 4x3 sprite atlas on a canvas. Every sprite is pure white RGB
 * with a shaped ALPHA channel — the shader only samples .a, so there is zero
 * colour fringing and zero colour-space ambiguity; the tint comes entirely
 * from the instance colour, and a white-hot core is derived from the alpha
 * itself. Content is inset inside each cell so mip levels bleed transparency,
 * not neighbours.
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
      softDisc(c + Math.cos(ang) * rad, c + Math.sin(ang) * rad, cell * (0.14 + R() * 0.13), 0.20 + R() * 0.16, 0.30);
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
      softDisc(c + Math.cos(ang) * rad, c + Math.sin(ang) * rad, cell * (0.035 + R() * 0.085), 0.14 + R() * 0.22, 0.45);
    }
    g.restore();
  }

  // ---- 8 : DROP — teardrop with a bright rim and a highlight, reads as water
  {
    const [ox, oy] = cellOrigin(SPRITE.DROP);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createRadialGradient(0, cell * 0.04, cell * 0.02, 0, cell * 0.04, cell * 0.30);
    grd.addColorStop(0.00, white(0.40));
    grd.addColorStop(0.62, white(0.55));
    grd.addColorStop(0.86, white(1.0));
    grd.addColorStop(1.00, white(0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -cell * 0.40);
    g.bezierCurveTo(cell * 0.30, -cell * 0.02, cell * 0.30, cell * 0.30, 0, cell * 0.32);
    g.bezierCurveTo(-cell * 0.30, cell * 0.30, -cell * 0.30, -cell * 0.02, 0, -cell * 0.40);
    g.closePath();
    g.fill();
    softDisc(-cell * 0.08, -cell * 0.04, cell * 0.07, 1.0, 0.5);   // specular
    g.restore();
  }

  // ---- 9 : BUBBLE — thin bright ring, faint fill, one specular dot
  {
    const [ox, oy] = cellOrigin(SPRITE.BUBBLE);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, cell * 0.42);
    grd.addColorStop(0.00, white(0.05));
    grd.addColorStop(0.80, white(0.10));
    grd.addColorStop(0.90, white(0.95));
    grd.addColorStop(1.00, white(0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, cell * 0.42, 0, Math.PI * 2); g.fill();
    softDisc(-cell * 0.14, -cell * 0.14, cell * 0.09, 1.0, 0.5);
    g.restore();
  }

  // ---- 10 : LEAF — pointed lobed silhouette with a mid-rib
  {
    const [ox, oy] = cellOrigin(SPRITE.LEAF);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createLinearGradient(0, -cell * 0.42, 0, cell * 0.42);
    grd.addColorStop(0.00, white(0.95));
    grd.addColorStop(0.50, white(0.85));
    grd.addColorStop(1.00, white(0.70));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -cell * 0.42);
    g.bezierCurveTo(cell * 0.32, -cell * 0.22, cell * 0.30, cell * 0.20, 0, cell * 0.40);
    g.bezierCurveTo(-cell * 0.30, cell * 0.20, -cell * 0.32, -cell * 0.22, 0, -cell * 0.42);
    g.closePath();
    g.fill();
    g.strokeStyle = white(0.35);
    g.lineWidth = cell * 0.02;
    g.beginPath(); g.moveTo(0, -cell * 0.36); g.lineTo(0, cell * 0.34); g.stroke();
    g.restore();
  }

  // ---- 11 : CONFETTI — rounded rectangle, slight gradient so it catches light
  {
    const [ox, oy] = cellOrigin(SPRITE.CONFETTI);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    const grd = g.createLinearGradient(-cell * 0.2, -cell * 0.3, cell * 0.2, cell * 0.3);
    grd.addColorStop(0.00, white(1.0));
    grd.addColorStop(1.00, white(0.72));
    g.fillStyle = grd;
    const w = cell * 0.24, h = cell * 0.36, r = cell * 0.05;
    g.beginPath();
    g.moveTo(-w + r, -h);
    g.lineTo(w - r, -h); g.quadraticCurveTo(w, -h, w, -h + r);
    g.lineTo(w, h - r); g.quadraticCurveTo(w, h, w - r, h);
    g.lineTo(-w + r, h); g.quadraticCurveTo(-w, h, -w, h - r);
    g.lineTo(-w, -h + r); g.quadraticCurveTo(-w, -h, -w + r, -h);
    g.closePath();
    g.fill();
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
  attribute vec4 aParams;  // spriteIndex, stretch, aspect, blend (0 alpha / 1 additive)

  uniform vec2  uAtlasScale;
  uniform float uAtlasCols;
  uniform vec2  uFogRange;
  uniform float uFogAmount;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;
  varying float vBlend;

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
    vBlend = aParams.w;

    float dist = -mv.z;
    vFog = uFogAmount * clamp(
      ( dist - uFogRange.x ) / max( uFogRange.y - uFogRange.x, 1e-3 ), 0.0, 1.0 );
  }
`;

const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uCoreAlpha;
  uniform float uCoreAdd;
  uniform vec3  uFogColor;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;
  varying float vBlend;

  void main() {
    float m = texture2D( uMap, vUv ).a;
    float a = m * vColor.a * uOpacity;

    // white-hot core derived from coverage — no colour data needed in the atlas
    float core = smoothstep( 0.55, 0.97, m );
    float add  = vBlend;
    vec3  c    = vColor.rgb * ( 1.0 + core * mix( uCoreAlpha, uCoreAdd, add ) );

    // fog: additive particles fade OUT with distance (adding fog-coloured light
    // to fog looks like a glow bug); alpha particles mix TOWARD the fog colour.
    a *= mix( 1.0, 1.0 - vFog, add );
    c  = mix( mix( c, uFogColor, vFog ), c, add );

    if ( a < 0.0035 ) discard;

    // PREMULTIPLIED output. Blend is ONE / ONE_MINUS_SRC_ALPHA:
    //   alpha    -> (c*a, a): classic "over"
    //   additive -> (c*a, 0): destination kept whole, colour added
    gl_FragColor = vec4( c * a, a * ( 1.0 - add ) );
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ *
 *  Layer — the one InstancedMesh + all of its parallel state
 * ------------------------------------------------------------------ */

class Layer {
  constructor(cap, texture) {
    this.cap = cap | 0;
    this.count = 0;
    this.cursor = 0;

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
        uCoreAlpha: { value: 0.14 },
        uCoreAdd: { value: 0.85 },
        uAtlasScale: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
        uAtlasCols: { value: ATLAS_COLS },
        uFogColor: { value: new THREE.Color(0x05070d) },
        uFogRange: { value: new THREE.Vector2(30, 220) },
        uFogAmount: { value: 0 },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // premultiplied alpha: src * 1 + dst * (1 - src.a) — see the header
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
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
    this.mesh.renderOrder = 9;
    this.mesh.name = 'fx.particles';
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

/** commit the shared descriptor S into the layer at a free (or recycled) slot */
function pushParticle(L, x, y, z, vx, vy, vz) {
  let i;
  if (L.count < L.cap) i = L.count++;
  else { i = L.cursor; L.cursor = (i + 1) % L.cap; }

  const i3 = i * 3, i4 = i * 4;
  L.pos[i3] = x; L.pos[i3 + 1] = y; L.pos[i3 + 2] = z;
  L.vel[i3] = vx; L.vel[i3 + 1] = vy; L.vel[i3 + 2] = vz;

  L.misc[i4] = 0; L.misc[i4 + 1] = S.life; L.misc[i4 + 2] = S.size0; L.misc[i4 + 3] = S.rot;
  L.col[i4] = S.r0; L.col[i4 + 1] = S.g0; L.col[i4 + 2] = S.b0; L.col[i4 + 3] = 0;
  L.par[i4] = S.sprite; L.par[i4 + 1] = S.stretch; L.par[i4 + 2] = S.aspect; L.par[i4 + 3] = S.add;

  L.c0[i3] = S.r0; L.c0[i3 + 1] = S.g0; L.c0[i3 + 2] = S.b0;
  L.c1[i3] = S.r1; L.c1[i3 + 1] = S.g1; L.c1[i3 + 2] = S.b1;

  L.grav[i] = S.grav; L.drag[i] = S.drag; L.spin[i] = S.spin; L.turb[i] = S.turb;
  L.sz0[i] = S.size0; L.sz1[i] = S.size1; L.alpha[i] = S.alpha;
  L.ground[i] = S.ground; L.seed[i] = RNG() * 64;
  L.flags[i] = S.flags; L.fade[i] = S.fade;
  return i;
}

/** additive push — the "D" layer in preset prose */
function pushAdd(sys, x, y, z, vx, vy, vz) { S.add = 1; return pushParticle(sys.layer, x, y, z, vx, vy, vz); }
/** alpha push — the "A" layer in preset prose */
function pushAlpha(sys, x, y, z, vx, vy, vz) { S.add = 0; return pushParticle(sys.layer, x, y, z, vx, vy, vz); }

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
    let sz = L.sz0[i] + (L.sz1[i] - L.sz0[i]) * eased;
    // a flat card turning over: apparent width oscillates with the spin phase
    if ((fl & F_FLUTTER) !== 0) sz *= 0.45 + 0.55 * Math.abs(fsin(time * 4.1 + seed * 9.7));
    misc[i4 + 2] = sz;
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

/**
 * Dust tint per Collider.surface (materials.js keys, contract §14). A landing
 * on grass kicks up green-grey, on snow white, on sand tan, on metal a cool
 * steel grey — the preset never chooses; the surface does.
 */
const SURFACE_TINT = {
  normal: 0x9d998f,
  stone: 0x9d998f,
  marble: 0xc9c6c0,
  brick: 0xa8877a,
  plaster: 0xc4bdb0,
  obsidian: 0x5a5866,
  crystal: 0xb7d7ee,
  metal: 0xb6c2cf,
  copper: 0xb98a6a,
  gold: 0xd9b866,
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
  bark: 0x8c6a4a,
  rope: 0xb59a6c,
  cloth: 0xb08a8a,
  painting: 0xb8a6c8,
  rubber: 0x7f838a,
  lava: 0xff8a30,
  snow: 0xe6f2ff,
  grass: 0x8fa86a,
  moss: 0x7c9a5a,
  leaves: 0x88a45c,
  dirt: 0x9b7c5a,
  water: 0x9fd6e8,
  cloud: 0xe8eef6,
};

/** death-cause colour: violet = void, orange = lava, red = crush, ... */
export const CAUSE_COLOR = {
  lava: 0xff7a1a,
  void: 0xa86bff,
  spike: 0xff5c3a,
  crush: 0xff4a4a,
  saw: 0xfff2d2,
  toxic: 0x8cf05a,
  gnasher: 0xffb35a,
  warden: 0xff6a8a,
  water: 0x5ec8ff,
  fall: 0x8fa6c0,
  manual: 0x9fb6cc,
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
 * Shared primitive: a low, surface-tinted dust ring hugging the floor.
 * Every ground contact (land, jump, pivot, pound, step) builds on it.
 */
function dustRing(sys, x, y, z, tint, s, count, speed, size, life) {
  const q = sys.scale;
  const n = Math.max(2, Math.round(count * q));
  for (let i = 0; i < n; i++) {
    sReset();
    const ang = (i / n) * Math.PI * 2 + rsym() * 0.35;
    const sp = speed * (0.65 + rnd() * 0.7);
    S.sprite = SPRITE.DUST;
    S.life = life + rnd() * life * 0.45;
    S.size0 = size;
    S.size1 = size * (2.6 + 1.6 * s);
    colBoth(tint);
    col0Scale(1.15);
    col1Scale(0.55);
    S.alpha = 0.16 + 0.30 * s;
    S.grav = 3.0;
    S.drag = 3.2;
    S.spin = rsym() * 1.4;
    S.rot = rnd() * 6.283;
    S.flags = F_GROUND;
    S.ground = y - 0.02;
    S.fade = FADE_SMOOTH;
    pushAlpha(sys, x + Math.cos(ang) * 0.12, y + 0.04, z + Math.sin(ang) * 0.12,
      Math.cos(ang) * sp, 0.5 + 1.1 * s * rnd(), Math.sin(ang) * sp);
  }
}

/** shared primitive: a flat floor ring sprite (squashed so it reads as a ring on the ground) */
function floorRing(sys, x, y, z, color, size1, life, alpha, white) {
  sReset();
  S.sprite = SPRITE.RING;
  S.life = life;
  S.size0 = 0.4;
  S.size1 = size1;
  S.aspect = 0.42;
  colBoth(color);
  col0White(white);
  S.alpha = alpha;
  S.fade = FADE_HOLD;
  pushAdd(sys, x, y + 0.05, z, 0, 0, 0);
}

/** shared primitive: a hemispherical spray of streaked sparks */
function sparkSpray(sys, x, y, z, color, count, spMin, spMax, up, grav) {
  const n = Math.max(3, Math.round(count * sys.scale));
  for (let i = 0; i < n; i++) {
    sReset();
    const th = rnd() * 6.283;
    const ph = Math.acos(clamp(rsym(), -1, 1));
    const sp = rrange(spMin, spMax);
    S.sprite = SPRITE.STREAK;
    S.life = rrange(0.2, 0.45);
    S.size0 = rrange(0.05, 0.11);
    S.size1 = S.size0 * 0.35;
    S.stretch = 1;
    S.aspect = 1.5;
    colBoth(color); col0White(0.75);
    S.alpha = 1;
    S.grav = grav;
    S.drag = 1.5;
    S.fade = FADE_FLASH;
    pushAdd(sys, x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.8 + up, Math.sin(ph) * Math.sin(th) * sp);
  }
}

/** shared primitive: a fountain of motes + embers rising and falling back */
function fountain(sys, x, y, z, color, count, upMin, upMax, radius, life0, life1) {
  const n = Math.max(6, Math.round(count * sys.scale));
  for (let i = 0; i < n; i++) {
    sReset();
    const ang = rnd() * 6.283;
    const rad = rnd() * radius;
    S.sprite = rnd() < 0.4 ? SPRITE.EMBER : SPRITE.DOT;
    S.life = rrange(life0, life1);
    S.size0 = rrange(0.06, 0.16);
    S.size1 = S.size0 * 0.4;
    colBoth(color); col0White(0.45); col1Scale(0.6);
    S.alpha = 1;
    S.grav = 11;
    S.drag = 0.5;
    S.turb = 0.7;
    S.flags = F_TURB | F_FLICKER;
    S.fade = FADE_LINEAR;
    pushAdd(sys, x + Math.cos(ang) * rad, y + 0.15, z + Math.sin(ang) * rad,
      Math.cos(ang) * rrange(0.8, 3.2), rrange(upMin, upMax), Math.sin(ang) * rrange(0.8, 3.2));
  }
}

const CONFETTI_COLORS = [0xff5f7a, 0xffd23f, 0x4fd6ff, 0x7dff7a, 0xff9a3c, 0xc07bff, 0xfff6d8];

/** shared primitive: confetti cards that flutter down */
function confetti(sys, x, y, z, count, up, spread, life) {
  const n = Math.max(6, Math.round(count * sys.scale));
  for (let i = 0; i < n; i++) {
    sReset();
    const th = rnd() * 6.283;
    const sp = rrange(0.3, 1.0) * spread;
    S.sprite = SPRITE.CONFETTI;
    S.life = rrange(life * 0.7, life * 1.3);
    S.size0 = rrange(0.07, 0.13);
    S.size1 = S.size0;
    S.aspect = rrange(0.8, 1.6);
    colBoth(CONFETTI_COLORS[(RNG() * CONFETTI_COLORS.length) | 0]);
    S.alpha = 0.95;
    S.grav = 1.6;
    S.drag = 2.4;
    S.spin = rsym() * 6;
    S.rot = rnd() * 6.283;
    S.turb = 0.9;
    S.flags = F_SWAY | F_FLUTTER;
    S.fade = FADE_HOLD;
    pushAlpha(sys, x + rsym() * 0.3, y + 0.2, z + rsym() * 0.3,
      Math.cos(th) * sp, rrange(up * 0.6, up), Math.sin(th) * sp);
  }
}

/**
 * Each preset is (sys, x, y, z, opts). All counts are scaled by sys.scale.
 */
const BURSTS = {

  /* ---- landing: radial dust ring hugging the floor, surface-tinted -------- */
  land(sys, x, y, z, o) {
    const s = clamp(optNum(o, 'strength', 0.5), 0, 1);
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const q = sys.scale;

    dustRing(sys, x, y, z, tint, s, 5 + 15 * s, 1.3 + 2.8 * s, 0.13 + 0.18 * s, 0.36 + s * 0.3);

    const nPuff = Math.max(1, Math.round((1 + 3 * s) * q));
    for (let i = 0; i < nPuff; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.5, 0.85);
      S.size0 = 0.22 + 0.2 * s;
      S.size1 = S.size0 * 3.1;
      colBoth(tint);
      col0Scale(0.7); col1Scale(0.4);
      S.alpha = 0.10 + 0.16 * s;
      S.grav = 0.6;
      S.drag = 2.4;
      S.spin = rsym() * 0.7;
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + rsym() * 0.2, y + 0.05, z + rsym() * 0.2,
        Math.cos(ang) * 0.8 * (0.5 + s), 0.35, Math.sin(ang) * 0.8 * (0.5 + s));
    }

    if (s > 0.5) floorRing(sys, x, y, z, tint, 1.9 + 2.4 * s, 0.24 + 0.1 * s, 0.20 + 0.30 * s, 0.45);

    // surface flavour on top: snow and sand throw flakes/grains, grass a few leaves
    if (o.surface === 'snow') BURSTS.snowPuff(sys, x, y, z, { scale: 0.5 + s, count: 4 + 6 * s });
    else if (o.surface === 'sand') BURSTS.sandPuff(sys, x, y, z, { scale: 0.5 + s, count: 4 + 6 * s });
    else if ((o.surface === 'grass' || o.surface === 'leaves') && s > 0.35) BURSTS.leafKick(sys, x, y, z, { count: 2 + 3 * s });
  },

  /* ---- hard landing: everything land does, plus a shock ring + shards ------ */
  hardLand(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    BURSTS.land(sys, x, y, z, { strength: 1, surface: o.surface, color: o.color });
    floorRing(sys, x, y, z, tint, 5.2, 0.32, 0.6, 0.7);
    // grit thrown up from the impact point — small, dark, falls fast
    const n = Math.max(4, Math.round(12 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(2, 5.5);
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.35, 0.7);
      S.size0 = rrange(0.05, 0.11);
      S.size1 = S.size0 * 0.6;
      S.aspect = 1.6;
      colBoth(tint); col0Scale(0.8); col1Scale(0.4);
      S.alpha = 0.9;
      S.grav = 18;
      S.drag = 0.8;
      S.spin = rsym() * 12;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_FLASH;
      pushAlpha(sys, x, y + 0.05, z, Math.cos(th) * sp, rrange(2.5, 6), Math.sin(th) * sp);
    }
  },

  /* ---- jump: a small, tight foot-level puff ------------------------------ */
  jump(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const n = Math.max(2, Math.round(5 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.5;
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.24, 0.38);
      S.size0 = 0.10;
      S.size1 = 0.42;
      colBoth(tint); col1Scale(0.5);
      S.alpha = 0.16;
      S.grav = 2.2;
      S.drag = 3.6;
      S.spin = rsym() * 1.2;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushAlpha(sys, x + Math.cos(ang) * 0.1, y + 0.03, z + Math.sin(ang) * 0.1,
        Math.cos(ang) * 1.5, 0.25, Math.sin(ang) * 1.5);
    }
  },

  /* ---- triple jump: the jump puff plus a bright spiral flourish ----------- */
  jump3(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.accent;
    BURSTS.jump(sys, x, y, z, { surface: o.surface });
    floorRing(sys, x, y, z, c, 2.4, 0.28, 0.55, 0.5);
    // a rising helix of motes — reads as "that was the big one"
    const n = Math.max(8, Math.round(18 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const f = i / n;
      const ang = f * 6.283 * 2.0;
      const r = 0.35;
      S.sprite = SPRITE.DOT;
      S.life = rrange(0.35, 0.6);
      S.size0 = rrange(0.06, 0.12);
      S.size1 = S.size0 * 0.3;
      colBoth(c); col0White(0.6);
      S.alpha = 1;
      S.grav = -2;
      S.drag = 1.2;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + Math.cos(ang) * r, y + 0.1 + f * 1.0, z + Math.sin(ang) * r,
        Math.cos(ang) * 1.2, 2.5 + f * 4, Math.sin(ang) * 1.2);
    }
  },

  /* ---- long jump: dust kicked BACKWARD + forward streaks ------------------ */
  longjump(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const d = readDir(o, 'dir', 0, 0, -1);
    const dx = d.x, dz = d.z;
    const q = sys.scale;
    // dust thrown backward off the take-off foot
    const n = Math.max(3, Math.round(9 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.35, 0.6);
      S.size0 = 0.14;
      S.size1 = 0.55;
      colBoth(tint); col1Scale(0.5);
      S.alpha = 0.2;
      S.grav = 2.4;
      S.drag = 3.2;
      S.spin = rsym() * 1.4;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushAlpha(sys, x - dx * 0.2 + rsym() * 0.15, y + 0.05, z - dz * 0.2 + rsym() * 0.15,
        -dx * rrange(1.5, 3.5) + rsym() * 0.8, rrange(0.4, 1.2), -dz * rrange(1.5, 3.5) + rsym() * 0.8);
    }
    // forward streaks: speed made visible
    const m = Math.max(3, Math.round(8 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.18, 0.32);
      S.size0 = rrange(0.04, 0.08);
      S.size1 = S.size0 * 0.4;
      S.stretch = 1;
      S.aspect = 2.2;
      colBoth(0xffffff);
      S.alpha = 0.7;
      S.drag = 3;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + rsym() * 0.3, y + 0.4 + rnd() * 0.8, z + rsym() * 0.3,
        dx * rrange(5, 9), rrange(-0.5, 1), dz * rrange(5, 9));
    }
  },

  /* ---- dive: a forward whoosh of streaks + a small puff at the launch ------ */
  dive(sys, x, y, z, o) {
    const d = readDir(o, 'dir', 0, 0, -1);
    const dx = d.x, dz = d.z;
    const q = sys.scale;
    const m = Math.max(4, Math.round(12 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.16, 0.3);
      S.size0 = rrange(0.035, 0.07);
      S.size1 = S.size0 * 0.4;
      S.stretch = 1;
      S.aspect = 2.6;
      colBoth(0xf4f8ff);
      S.alpha = 0.65;
      S.drag = 2.5;
      S.fade = FADE_FLASH;
      pushAdd(sys, x - dx * 0.4 + rsym() * 0.35, y + 0.3 + rnd() * 0.9, z - dz * 0.4 + rsym() * 0.35,
        dx * rrange(4, 8) + rsym() * 0.6, rrange(-0.3, 0.6), dz * rrange(4, 8) + rsym() * 0.6);
    }
    sReset();
    S.sprite = SPRITE.SMOKE;
    S.life = 0.4;
    S.size0 = 0.25;
    S.size1 = 0.9;
    colBoth(0xdfe6ee); col1Scale(0.6);
    S.alpha = 0.12;
    S.drag = 3;
    S.spin = rsym();
    S.rot = rnd() * 6.283;
    pushAlpha(sys, x - dx * 0.3, y + 0.5, z - dz * 0.3, -dx * 0.6, 0.2, -dz * 0.6);
  },

  /* ---- slide dust: a continuous trickle behind a belly slide / pivot ------ */
  slideDust(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const d = readDir(o, 'dir', 0, 0, -1);
    const dx = d.x, dz = d.z;
    const speed = clamp(optNum(o, 'speed', 6) / 10, 0.2, 1.5);
    const n = Math.max(1, Math.round(optNum(o, 'count', 3) * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = rnd() < 0.6 ? SPRITE.DUST : SPRITE.SMOKE;
      S.life = rrange(0.35, 0.65);
      S.size0 = 0.12 * (0.7 + speed * 0.5);
      S.size1 = S.size0 * 3.2;
      colBoth(tint); col1Scale(0.55);
      S.alpha = 0.14 + 0.1 * speed;
      S.grav = 1.4;
      S.drag = 2.6;
      S.spin = rsym() * 1.3;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushAlpha(sys, x - dx * 0.35 + rsym() * 0.18, y + 0.04, z - dz * 0.35 + rsym() * 0.18,
        -dx * rrange(0.6, 1.6) * speed + rsym() * 0.5, rrange(0.3, 0.9), -dz * rrange(0.6, 1.6) * speed + rsym() * 0.5);
    }
    if (o.surface === 'snow' && rnd() < 0.5) BURSTS.snowPuff(sys, x - dx * 0.3, y, z - dz * 0.3, { scale: 0.4, count: 2 });
    if (o.surface === 'sand' && rnd() < 0.5) BURSTS.sandPuff(sys, x - dx * 0.3, y, z - dz * 0.3, { scale: 0.4, count: 2 });
  },

  /* ---- pound launch: energy gathers at the hang, then a downward streak ---- */
  pound(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.accent;
    const q = sys.scale;
    // ring contracting around the hero (size1 < size0 reads as a pull-in)
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.2;
    S.size0 = 2.2;
    S.size1 = 0.5;
    colBoth(c); col0White(0.5);
    S.alpha = 0.7;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y + 0.7, z, 0, 0, 0);
    // downward streaks: the fall is about to be fast
    const n = Math.max(4, Math.round(10 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283;
      const r = 0.3 + rnd() * 0.2;
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.2, 0.35);
      S.size0 = rrange(0.04, 0.08);
      S.size1 = S.size0 * 0.4;
      S.stretch = 1;
      S.aspect = 2.4;
      colBoth(c); col0White(0.6);
      S.alpha = 0.9;
      S.drag = 1;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + Math.cos(ang) * r, y + 1.4, z + Math.sin(ang) * r, 0, -rrange(6, 11), 0);
    }
  },

  /* ---- pound shock: a ring of dust + a shock-ring sprite + shards --------- */
  poundShock(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
    const radius = optNum(o, 'radius', 2.2);
    const q = sys.scale;

    // the shock ring — the single most readable cue; expands to the shockRadius
    floorRing(sys, x, y, z, 0xffffff, radius * 2.6, 0.30, 0.85, 1);
    floorRing(sys, x, y, z, tint, radius * 1.8, 0.42, 0.55, 0.5);

    // ring of dust that travels OUTWARD to the shock radius
    const n = Math.max(10, Math.round(28 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.15;
      const sp = rrange(4.5, 7.5);
      S.sprite = rnd() < 0.5 ? SPRITE.DUST : SPRITE.SMOKE;
      S.life = rrange(0.45, 0.75);
      S.size0 = 0.22;
      S.size1 = 0.95;
      colBoth(tint); col0Scale(1.1); col1Scale(0.5);
      S.alpha = 0.34;
      S.grav = 3.5;
      S.drag = 3.0;
      S.spin = rsym() * 2;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushAlpha(sys, x + Math.cos(ang) * 0.3, y + 0.06, z + Math.sin(ang) * 0.3,
        Math.cos(ang) * sp, rrange(0.8, 2.2), Math.sin(ang) * sp);
    }

    // shards of the surface thrown up
    const m = Math.max(6, Math.round(16 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(2, 6);
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.45, 0.9);
      S.size0 = rrange(0.07, 0.15);
      S.size1 = S.size0 * 0.6;
      S.aspect = 1.7;
      colBoth(tint); col0Scale(0.9); col1Scale(0.45);
      S.alpha = 0.95;
      S.grav = 18;
      S.drag = 0.7;
      S.spin = rsym() * 12;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_FLASH;
      pushAlpha(sys, x, y + 0.08, z, Math.cos(th) * sp, rrange(4, 9), Math.sin(th) * sp);
    }

    // a flash at the impact point
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.16;
    S.size0 = 1.4;
    S.size1 = 0.3;
    S.aspect = 0.4;
    colBoth(0xffffff);
    S.alpha = 0.7;
    S.fade = FADE_FLASH;
    pushAdd(sys, x, y + 0.08, z, 0, 0, 0);

    if (o.surface === 'snow') BURSTS.snowPuff(sys, x, y, z, { scale: 1.6, count: 14 });
    else if (o.surface === 'sand') BURSTS.sandPuff(sys, x, y, z, { scale: 1.6, count: 14 });
  },

  /* ---- wall kick: sparks shed off the wall along its normal + a scuff puff - */
  wallkick(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xffd39a;
    const nrm = readDir(o, 'normal', 0, 0, 1);
    const nx = nrm.x, ny = nrm.y, nz = nrm.z;
    basisFrom(nrm, _vB, _vC);
    const q = sys.scale;

    const n = Math.max(5, Math.round(14 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const a = rnd() * 6.283;
      const r = Math.sqrt(rnd()) * 0.9;
      const sp = rrange(3, 8);
      const dx = nx + (_vB.x * Math.cos(a) + _vC.x * Math.sin(a)) * r;
      const dy = ny + (_vB.y * Math.cos(a) + _vC.y * Math.sin(a)) * r;
      const dz = nz + (_vB.z * Math.cos(a) + _vC.z * Math.sin(a)) * r;
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.16, 0.38);
      S.size0 = rrange(0.04, 0.09);
      S.size1 = S.size0 * 0.3;
      S.stretch = 1;
      S.aspect = 1.5;
      colBoth(c); col0White(0.75);
      S.alpha = 1;
      S.grav = 20;
      S.drag = 1.4;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + nx * 0.08, y + rsym() * 0.3, z + nz * 0.08, dx * sp, dy * sp + 1, dz * sp);
    }

    // a flat flash pressed against the wall
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.22;
    S.size0 = 0.3;
    S.size1 = 1.6;
    colBoth(c); col0White(0.6);
    S.alpha = 0.7;
    S.fade = FADE_HOLD;
    pushAdd(sys, x + nx * 0.1, y, z + nz * 0.1, nx * 0.4, 0, nz * 0.4);

    const m = Math.max(2, Math.round(5 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.35, 0.6);
      S.size0 = 0.12;
      S.size1 = 0.5;
      colBoth(surfaceTint(o.surface, SURFACE_TINT.normal)); col1Scale(0.4);
      S.alpha = 0.16;
      S.grav = 1.4;
      S.drag = 2.4;
      S.spin = rsym();
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + nx * 0.1, y + rsym() * 0.3, z + nz * 0.1, nx * rrange(0.6, 1.6) + rsym() * 0.5, rrange(-0.3, 0.5), nz * rrange(0.6, 1.6) + rsym() * 0.5);
    }
  },

  /* ---- death: hot shards + shock ring + dark smoke, colour by cause ------ */
  death(sys, x, y, z, o) {
    const cause = o.cause || 'manual';
    const base = o.color !== undefined ? o.color : (CAUSE_COLOR[cause] || CAUSE_COLOR.manual);
    const q = sys.scale;
    const hasDir = readVec(o.dir, _vD);
    if (hasDir && _vD.lengthSq() > 1e-6) _vD.normalize(); else _vD.set(0, 1, 0);

    // shock ring — the single most readable "you died HERE" cue
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.34;
    S.size0 = 0.35;
    S.size1 = 5.4;
    colBoth(base); col0White(0.55);
    S.alpha = 0.85;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y + 0.6, z, 0, 0, 0);

    // inner flash
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.20;
    S.size0 = 1.9;
    S.size1 = 0.5;
    colBoth(base); col0White(0.7);
    S.alpha = 0.9;
    S.fade = FADE_FLASH;
    pushAdd(sys, x, y + 0.6, z, 0, 0, 0);

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
      colBoth(base); col0White(0.62); col1Scale(0.45);
      S.alpha = 1;
      S.grav = 17;
      S.drag = 0.9;
      S.spin = rsym() * 12;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + dx * 0.15, y + 0.6 + dy * 0.1, z + dz * 0.15,
        dx * sp + _vD.x * 2.5, dy * sp * 0.85 + _vD.y * 2.5, dz * sp + _vD.z * 2.5);
    }

    // streaked sparks
    sparkSpray(sys, x, y + 0.6, z, base, 16, 9, 22, 3, 20);

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
      pushAlpha(sys, x + rsym() * 0.3, y + 0.4 + rsym() * 0.25, z + rsym() * 0.3,
        Math.cos(ang) * 1.5, 0.7 + rnd(), Math.sin(ang) * 1.5);
    }
  },

  /* ---- death rewind: a sparkle trail shed by the ghost as it plays back --- */
  deathRewind(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xdff4ff;
    const n = Math.max(2, Math.round(optNum(o, 'count', 5) * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = rnd() < 0.5 ? SPRITE.DOT : SPRITE.SNOW;
      S.life = rrange(0.35, 0.7);
      S.size0 = rrange(0.04, 0.10);
      S.size1 = S.size0 * 0.3;
      colBoth(c); col0White(0.5);
      S.alpha = 0.9;
      S.grav = -0.8;
      S.drag = 1.6;
      S.spin = rsym() * 4;
      S.turb = 0.5;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x + rsym() * 0.3, y + 0.2 + rnd() * 1.2, z + rsym() * 0.3, rsym() * 0.6, rrange(0.2, 0.9), rsym() * 0.6);
    }
  },

  /* ---- checkpoint: expanding ring of rising motes + a ground flare ------- */
  checkpoint(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.checkpoint;
    const q = sys.scale;

    floorRing(sys, x, y, z, c, 4.4, 0.55, 0.8, 0.4);

    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.5;
    S.size0 = 1.6;
    S.size1 = 3.0;
    S.aspect = 0.34;
    colBoth(c);
    S.alpha = 0.5;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y + 0.05, z, 0, 0, 0);

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
      pushAdd(sys, x + Math.cos(ang) * r, y + 0.1 + rnd() * 0.3, z + Math.sin(ang) * r,
        Math.cos(ang) * 1.1, 1.6 + rnd() * 1.9, Math.sin(ang) * 1.1);
    }
  },

  /* ---- coin: quick gold sparkle ------------------------------------------ */
  coin(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.coin;
    const q = sys.scale;

    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.30;
    S.size0 = 0.25;
    S.size1 = 1.65;
    colBoth(c); col0White(0.5);
    S.alpha = 0.9;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y, z, 0, 0, 0);

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
      pushAdd(sys, x, y, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.7 + 1.8, Math.sin(ph) * Math.sin(th) * sp);
    }
  },

  /* ---- sigil: the marked coin — a coin burst with a slow-rising glyph halo - */
  sigil(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.sigil;
    BURSTS.coin(sys, x, y, z, { color: c });
    const q = sys.scale;
    // two concentric halos rising slowly
    for (let k = 0; k < 2; k++) {
      sReset();
      S.sprite = SPRITE.RING;
      S.life = 0.55 + k * 0.15;
      S.size0 = 0.3;
      S.size1 = 2.2 + k * 0.8;
      colBoth(c); col0White(0.4);
      S.alpha = 0.6;
      S.fade = FADE_HOLD;
      pushAdd(sys, x, y, z, 0, 0.9, 0);
    }
    // a spiral of motes lifting off — distinct from a coin at a glance
    const n = Math.max(6, Math.round(14 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const f = i / n;
      const ang = f * 6.283 * 1.5;
      S.sprite = SPRITE.DOT;
      S.life = rrange(0.6, 1.0);
      S.size0 = rrange(0.05, 0.1);
      S.size1 = S.size0 * 0.3;
      colBoth(c); col0White(0.5);
      S.alpha = 1;
      S.grav = -2.2;
      S.drag = 1.3;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x + Math.cos(ang) * 0.3, y - 0.2 + f * 0.6, z + Math.sin(ang) * 0.3, Math.cos(ang) * 0.8, 1.2, Math.sin(ang) * 0.8);
    }
  },

  /* ---- crest: golden fountain + light shaft + shards ---------------------- */
  crest(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.crest;
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
    pushAdd(sys, x, y + 3.4, z, 0, 0.6, 0);

    floorRing(sys, x, y, z, c, 6.5, 0.6, 0.9, 0.5);
    fountain(sys, x, y, z, c, 42, 6.5, 12.5, 0.55, 1.1, 1.9);

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
      pushAdd(sys, x, y + 0.4, z, Math.cos(th) * sp, rrange(3, 9), Math.sin(th) * sp);
    }

    const nP = Math.max(2, Math.round(6 * q));
    for (let i = 0; i < nP; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.7, 1.1);
      S.size0 = 0.35;
      S.size1 = 1.5;
      colBoth(c); col0Scale(0.35); col1Scale(0.12);
      S.alpha = 0.18;
      S.grav = -0.4;
      S.drag = 2;
      S.spin = rsym() * 0.8;
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + rsym() * 0.4, y + 0.15, z + rsym() * 0.4, Math.cos(ang) * 1.6, 1.1, Math.sin(ang) * 1.6);
    }
  },

  /* ---- crest grand: the pedestal celebration — huge fountain + confetti --- */
  crestGrand(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.crest;
    BURSTS.crest(sys, x, y, z, { color: c });
    // a second, taller fountain and two more rings
    fountain(sys, x, y, z, c, 60, 10, 16, 0.8, 1.6, 2.6);
    /* GRAND is bigger and GOLDER, not whiter. These two rings fire on the same
       frame as crest()'s own 6.5 m ring, and the clear camera orbits at 4.6 m —
       inside all three. A pure-white 9.5 m additive disc at alpha .7 therefore
       filled the lens: MEASURED, with bloom off entirely, the celebration frame
       still read mean luminance 143 / 36 % of pixels over 200 against 83 / 5 %
       in normal play. Same sweep, same size, crest gold, a third of the load. */
    floorRing(sys, x, y, z, c, 9.5, 0.8, 0.30, 0.34);
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.9;
    S.size0 = 0.6;
    S.size1 = 6.2;
    colBoth(c); col0White(0.25);
    S.alpha = 0.40;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y + 1.2, z, 0, 1.5, 0);
    // confetti — the one place in the game where colour is allowed to be loud
    confetti(sys, x, y + 0.5, z, 70, 9, 3.5, 2.4);
    // golden glitter that hangs in the air
    const n = Math.max(12, Math.round(36 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.SNOW;
      S.life = rrange(1.4, 2.6);
      S.size0 = rrange(0.05, 0.11);
      S.size1 = S.size0 * 0.5;
      colBoth(c); col0White(0.7);
      S.alpha = 1;
      S.grav = 0.9;
      S.drag = 1.8;
      S.spin = rsym() * 5;
      S.turb = 0.6;
      S.flags = F_SWAY | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x + rsym() * 0.5, y + 0.3, z + rsym() * 0.5, rsym() * 2.5, rrange(5, 10), rsym() * 2.5);
    }
  },

  /* ---- course clear: crest grand with the confetti turned up -------------- */
  courseClear(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.crest;
    BURSTS.crestGrand(sys, x, y, z, { color: c });
    confetti(sys, x, y + 1.0, z, 60, 11, 5, 3.2);
    sparkSpray(sys, x, y + 0.8, z, 0xffffff, 20, 6, 14, 6, 14);
  },

  /* ---- splash: droplets + a ring on the water plane ----------------------- */
  splash(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.water;
    const s = clamp(optNum(o, 'strength', 0.6), 0.1, 1.5);
    const q = sys.scale;

    // ring on the surface
    floorRing(sys, x, y, z, c, 1.8 + 2.6 * s, 0.4, 0.6, 0.6);
    // white foam ring, slower
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.7;
    S.size0 = 0.5;
    S.size1 = 2.6 + 2 * s;
    S.aspect = 0.4;
    colBoth(0xf2fbff);
    S.alpha = 0.35;
    S.fade = FADE_HOLD;
    pushAlpha(sys, x, y + 0.03, z, 0, 0, 0);

    // droplets: a crown that rises and falls back to the surface
    const n = Math.max(8, Math.round((14 + 18 * s) * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.3;
      const r = 0.15 + rnd() * 0.35;
      const sp = rrange(1.0, 2.6) * s;
      S.sprite = SPRITE.DROP;
      S.life = rrange(0.45, 0.85);
      S.size0 = rrange(0.06, 0.13) * (0.7 + 0.5 * s);
      S.size1 = S.size0 * 0.7;
      S.aspect = 1.3;
      colBoth(c); col0White(0.75); col1White(0.4);
      S.alpha = 0.9;
      S.grav = 12;
      S.drag = 0.6;
      S.flags = F_GROUND;
      S.ground = y;
      S.fade = FADE_LINEAR;
      pushAlpha(sys, x + Math.cos(ang) * r, y + 0.05, z + Math.sin(ang) * r,
        Math.cos(ang) * sp, rrange(3.5, 7.5) * s, Math.sin(ang) * sp);
    }

    // mist
    const m = Math.max(2, Math.round(5 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.5, 0.9);
      S.size0 = 0.3 * s;
      S.size1 = 1.2 * s;
      colBoth(0xeaf7ff);
      S.alpha = 0.16;
      S.grav = 0.8;
      S.drag = 2.5;
      S.spin = rsym() * 0.8;
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + rsym() * 0.3, y + 0.1, z + rsym() * 0.3, rsym() * 0.8, rrange(0.8, 1.8), rsym() * 0.8);
    }
  },

  /* ---- bubbles: rising from a submerged hero ------------------------------ */
  bubbles(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xdff6ff;
    const top = optNum(o, 'surfaceY', y + 50);
    const n = Math.max(1, Math.round(optNum(o, 'count', 4) * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      S.sprite = SPRITE.BUBBLE;
      const rise = rrange(0.9, 1.8);
      S.life = Math.min(rrange(1.2, 2.4), Math.max(0.15, (top - y) / rise));
      S.size0 = rrange(0.04, 0.10);
      S.size1 = S.size0 * 1.4;
      colBoth(c);
      S.alpha = 0.75;
      S.grav = -0.9;
      S.drag = 1.8;
      S.turb = 0.35;
      S.flags = F_SWAY;
      S.fade = FADE_HOLD;
      pushAlpha(sys, x + rsym() * 0.25, y + rsym() * 0.25, z + rsym() * 0.25, rsym() * 0.2, rise, rsym() * 0.2);
    }
  },

  /* ---- lava pop: rising blob, hot droplets, sooty puff -------------------- */
  lavaPop(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xff7a1a;
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
    pushAdd(sys, x, y + 0.1, z, rsym() * 0.6, rrange(2.5, 5) * power, rsym() * 0.6);

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
      pushAdd(sys, x, y + 0.08, z, Math.cos(th) * sp, rrange(3, 7) * power, Math.sin(th) * sp);
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
    pushAlpha(sys, x, y + 0.2, z, rsym() * 0.4, 1.1, rsym() * 0.4);
  },

  /* ---- ice shard burst ---------------------------------------------------- */
  iceShard(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xbfe6ff;
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
      pushAdd(sys, x, y, z, Math.cos(th) * sp, rrange(1.5, 5.5), Math.sin(th) * sp);
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
      pushAdd(sys, x, y, z, Math.cos(th) * 1.4, rrange(1, 3), Math.sin(th) * 1.4);
    }
  },

  /* ---- generic dust puff -------------------------------------------------- */
  dust(sys, x, y, z, o) {
    const tint = o.color !== undefined ? o.color : surfaceTint(o.surface, SURFACE_TINT.normal);
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
      colBoth(tint); col1Scale(0.5);
      S.alpha = 0.16;
      S.grav = 1.1;
      S.drag = 2.6;
      S.spin = rsym() * 1.1;
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + rsym() * 0.15 * scale, y + rsym() * 0.1 * scale, z + rsym() * 0.15 * scale,
        Math.cos(th) * 1.1 * scale, rrange(0.2, 1.0), Math.sin(th) * 1.1 * scale);
    }
  },

  /* ---- snow puff: white powder + a few flakes ----------------------------- */
  snowPuff(sys, x, y, z, o) {
    const q = sys.scale;
    const scale = optNum(o, 'scale', 1);
    const n = Math.max(2, Math.round(optNum(o, 'count', 8) * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(0.8, 2.4) * scale;
      S.sprite = SPRITE.DUST;
      S.life = rrange(0.5, 0.9);
      S.size0 = rrange(0.10, 0.22) * scale;
      S.size1 = S.size0 * 2.6;
      colBoth(0xf4f9ff); col1(0xc8d8ea);
      S.alpha = 0.28;
      S.grav = 2.2;
      S.drag = 2.8;
      S.spin = rsym() * 1.2;
      S.rot = rnd() * 6.283;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      pushAlpha(sys, x + rsym() * 0.12, y + 0.04, z + rsym() * 0.12, Math.cos(th) * sp, rrange(0.6, 1.8) * scale, Math.sin(th) * sp);
    }
    const m = Math.max(1, Math.round(n * 0.45));
    for (let i = 0; i < m; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = SPRITE.SNOW;
      S.life = rrange(0.7, 1.3);
      S.size0 = rrange(0.04, 0.09);
      S.size1 = S.size0;
      colBoth(0xffffff);
      S.alpha = 0.85;
      S.grav = 3.5;
      S.drag = 2.0;
      S.spin = rsym() * 4;
      S.turb = 0.4;
      S.flags = F_SWAY | F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x, y + 0.05, z, Math.cos(th) * rrange(0.5, 1.6) * scale, rrange(1.5, 3.5) * scale, Math.sin(th) * rrange(0.5, 1.6) * scale);
    }
  },

  /* ---- sand puff: tan grains that hang, drift and settle ------------------ */
  sandPuff(sys, x, y, z, o) {
    const q = sys.scale;
    const scale = optNum(o, 'scale', 1);
    const n = Math.max(2, Math.round(optNum(o, 'count', 8) * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      const sp = rrange(0.7, 2.0) * scale;
      S.sprite = rnd() < 0.7 ? SPRITE.DUST : SPRITE.SMOKE;
      S.life = rrange(0.7, 1.4);
      S.size0 = rrange(0.12, 0.26) * scale;
      S.size1 = S.size0 * 3.0;
      colBoth(0xdcc49a); col1(0xa78d64);
      S.alpha = 0.26;
      S.grav = 1.2;
      S.drag = 2.2;
      S.spin = rsym() * 0.9;
      S.rot = rnd() * 6.283;
      S.turb = 0.3;
      S.flags = F_GROUND | F_SWAY;
      S.ground = y - 0.02;
      pushAlpha(sys, x + rsym() * 0.12, y + 0.04, z + rsym() * 0.12,
        Math.cos(th) * sp + sys.wind.x * 0.5, rrange(0.4, 1.4) * scale, Math.sin(th) * sp + sys.wind.z * 0.5);
    }
    const m = Math.max(1, Math.round(n * 0.5));
    for (let i = 0; i < m; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = SPRITE.DOT;
      S.life = rrange(0.4, 0.7);
      S.size0 = rrange(0.02, 0.045);
      S.size1 = S.size0;
      colBoth(0xe8d3a6);
      S.alpha = 0.9;
      S.grav = 9;
      S.drag = 1.2;
      S.flags = F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_LINEAR;
      pushAlpha(sys, x, y + 0.05, z, Math.cos(th) * rrange(0.8, 2.2) * scale, rrange(1.5, 3.2) * scale, Math.sin(th) * rrange(0.8, 2.2) * scale);
    }
  },

  /* ---- leaf kick: a few leaves flung up from grass (used by land/step) ---- */
  leafKick(sys, x, y, z, o) {
    const n = Math.max(1, Math.round(optNum(o, 'count', 3) * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = SPRITE.LEAF;
      S.life = rrange(0.7, 1.3);
      S.size0 = rrange(0.06, 0.11);
      S.size1 = S.size0;
      S.aspect = 1.4;
      colBoth(rnd() < 0.7 ? 0x8fb35a : 0xc9a24a); col1Scale(0.7);
      S.alpha = 0.95;
      S.grav = 2.0;
      S.drag = 2.6;
      S.spin = rsym() * 5;
      S.rot = rnd() * 6.283;
      S.turb = 0.6;
      S.flags = F_SWAY | F_FLUTTER | F_GROUND;
      S.ground = y - 0.02;
      S.fade = FADE_HOLD;
      pushAlpha(sys, x + rsym() * 0.15, y + 0.05, z + rsym() * 0.15, Math.cos(th) * rrange(0.6, 1.6), rrange(1.5, 3.2), Math.sin(th) * rrange(0.6, 1.6));
    }
  },

  /* ---- generic sparks along a direction ---------------------------------- */
  spark(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xffd39a;
    const q = sys.scale;
    const spread = optNum(o, 'spread', 0.55);
    const power = optNum(o, 'power', 1);
    readDir(o, 'dir', 0, 1, 0);
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
      pushAdd(sys, x, y, z, dx * sp, dy * sp, dz * sp);
    }
  },

  /* ---- gate open: a curtain of motes rising through the doorway ----------- */
  gateOpen(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.crest;
    const w = optNum(o, 'w', 2.4), h = optNum(o, 'h', 3.2);
    const nrm = readDir(o, 'normal', 0, 0, 1);
    basisFrom(nrm, _vB, _vC);       // _vC is the doorway's horizontal axis
    const q = sys.scale;
    // the frame flashes as a tall soft quad
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.7;
    S.size0 = w * 0.6;
    S.size1 = w * 0.9;
    S.aspect = h / Math.max(w * 0.6, 0.1);
    colBoth(c); col0White(0.6);
    S.alpha = 0.4;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y + h * 0.5, z, 0, 0.2, 0);
    // motes rising across the width
    const n = Math.max(14, Math.round(48 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const u = rsym() * w * 0.5;
      S.sprite = rnd() < 0.4 ? SPRITE.EMBER : SPRITE.DOT;
      S.life = rrange(1.2, 2.2);
      S.size0 = rrange(0.05, 0.12);
      S.size1 = S.size0 * 0.35;
      colBoth(c); col0White(0.45);
      S.alpha = 1;
      S.grav = -1.6;
      S.drag = 1.0;
      S.turb = 0.5;
      S.flags = F_TURB | F_FLICKER;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x + _vC.x * u, y + rnd() * 0.4, z + _vC.z * u, _vC.x * rsym() * 0.3, rrange(1.2, 2.6), _vC.z * rsym() * 0.3);
    }
    // shards popping off the two door edges
    for (let side = -1; side <= 1; side += 2) {
      const ex = x + _vC.x * side * w * 0.5, ez = z + _vC.z * side * w * 0.5;
      const m = Math.max(3, Math.round(8 * q));
      for (let i = 0; i < m; i++) {
        sReset();
        S.sprite = SPRITE.SHARD;
        S.life = rrange(0.4, 0.8);
        S.size0 = rrange(0.06, 0.13);
        S.size1 = S.size0 * 0.4;
        S.aspect = 1.7;
        colBoth(c); col0White(0.6);
        S.alpha = 1;
        S.grav = 9;
        S.drag = 1.0;
        S.spin = rsym() * 8;
        S.rot = rnd() * 6.283;
        S.fade = FADE_FLASH;
        pushAdd(sys, ex, y + rnd() * h, ez, _vC.x * -side * rrange(1, 3) + nrm.x * rsym() * 1.5, rrange(0.5, 2.5), _vC.z * -side * rrange(1, 3) + nrm.z * rsym() * 1.5);
      }
    }
  },

  /* ---- painting ripple: concentric wave in the painting's plane ----------- */
  paintingRipple(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xcfe0ff;
    const nrm = readDir(o, 'normal', 0, 0, 1);
    basisFrom(nrm, _vB, _vC);
    const q = sys.scale;
    const radius = optNum(o, 'radius', 1.2);
    // three expanding rings of motes travelling outward IN the plane
    for (let ring = 0; ring < 3; ring++) {
      const n = Math.max(10, Math.round(22 * q));
      const delayLife = 0.55 + ring * 0.2;
      const sp = (radius / delayLife) * 1.15;
      for (let i = 0; i < n; i++) {
        sReset();
        const a = (i / n) * 6.283 + rsym() * 0.12;
        const dx = _vB.x * Math.cos(a) + _vC.x * Math.sin(a);
        const dy = _vB.y * Math.cos(a) + _vC.y * Math.sin(a);
        const dz = _vB.z * Math.cos(a) + _vC.z * Math.sin(a);
        S.sprite = SPRITE.DOT;
        S.life = delayLife;
        S.size0 = 0.05 + ring * 0.015;
        S.size1 = 0.11;
        colBoth(c); col0White(0.6 - ring * 0.15);
        S.alpha = 0.9 - ring * 0.2;
        S.drag = 0.6;
        S.fade = FADE_LINEAR;
        pushAdd(sys, x + nrm.x * 0.04 + dx * 0.08 * ring, y + nrm.y * 0.04 + dy * 0.08 * ring, z + nrm.z * 0.04 + dz * 0.08 * ring,
          dx * sp, dy * sp, dz * sp);
      }
    }
    // a soft glow on the surface
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.5;
    S.size0 = radius * 0.8;
    S.size1 = radius * 1.6;
    colBoth(c); col0White(0.5);
    S.alpha = 0.35;
    S.fade = FADE_HOLD;
    pushAdd(sys, x + nrm.x * 0.05, y + nrm.y * 0.05, z + nrm.z * 0.05, 0, 0, 0);
  },

  /* ---- gnasher bite: a snap of dust + tooth-white shards + hot sparks ----- */
  gnasherBite(sys, x, y, z, o) {
    const d = readDir(o, 'dir', 0, 0, -1);
    const dx = d.x, dz = d.z;
    BURSTS.dust(sys, x, y, z, { color: 0x7d7770, count: 8, scale: 1.2 });
    const q = sys.scale;
    const n = Math.max(4, Math.round(10 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const th = rnd() * 6.283;
      S.sprite = SPRITE.SHARD;
      S.life = rrange(0.3, 0.6);
      S.size0 = rrange(0.06, 0.12);
      S.size1 = S.size0 * 0.5;
      S.aspect = 1.8;
      colBoth(0xfff5e0);
      S.alpha = 1;
      S.grav = 16;
      S.drag = 1;
      S.spin = rsym() * 10;
      S.rot = rnd() * 6.283;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + dx * 0.3, y + 0.4, z + dz * 0.3, Math.cos(th) * rrange(2, 5) + dx * 2, rrange(2, 5), Math.sin(th) * rrange(2, 5) + dz * 2);
    }
    sparkSpray(sys, x + dx * 0.3, y + 0.4, z + dz * 0.3, 0xffb35a, 8, 4, 9, 1, 18);
    // the impact flash where the jaws met
    sReset();
    S.sprite = SPRITE.DOT;
    S.life = 0.14;
    S.size0 = 1.0;
    S.size1 = 0.2;
    colBoth(0xffe2b0);
    S.alpha = 0.8;
    S.fade = FADE_FLASH;
    pushAdd(sys, x + dx * 0.3, y + 0.5, z + dz * 0.3, 0, 0, 0);
  },

  /* ---- squish: a bumbler flattened — puff + comedic stars in a rising ring - */
  squish(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xffe36a;
    BURSTS.dust(sys, x, y, z, { surface: o.surface, count: 9, scale: 1.3 });
    floorRing(sys, x, y, z, c, 2.4, 0.3, 0.55, 0.5);
    const n = Math.max(5, Math.round(8 * sys.scale));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283;
      S.sprite = SPRITE.SNOW;      // the 6-arm sprite reads as a cartoon star at this size
      S.life = rrange(0.55, 0.8);
      S.size0 = rrange(0.10, 0.16);
      S.size1 = S.size0 * 0.6;
      colBoth(c); col0White(0.4);
      S.alpha = 1;
      S.grav = 5;
      S.drag = 1.2;
      S.spin = rsym() * 6;
      S.fade = FADE_LINEAR;
      pushAdd(sys, x + Math.cos(ang) * 0.3, y + 0.3, z + Math.sin(ang) * 0.3, Math.cos(ang) * 1.8, rrange(2.5, 4.5), Math.sin(ang) * 1.8);
    }
  },

  /* ---- ring pass: flying through a wing ring — the ring flares + tangent motes */
  ringPass(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.accent;
    const nrm = readDir(o, 'normal', 0, 0, 1);
    basisFrom(nrm, _vB, _vC);
    const radius = optNum(o, 'radius', 1.5);
    const q = sys.scale;
    // a flare at the centre
    sReset();
    S.sprite = SPRITE.RING;
    S.life = 0.3;
    S.size0 = radius * 1.6;
    S.size1 = radius * 3.2;
    colBoth(c); col0White(0.6);
    S.alpha = 0.7;
    S.fade = FADE_HOLD;
    pushAdd(sys, x, y, z, 0, 0, 0);
    // motes on the ring's circumference streaming along the flight normal
    const n = Math.max(10, Math.round(26 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const a = (i / n) * 6.283;
      const px = _vB.x * Math.cos(a) + _vC.x * Math.sin(a);
      const py = _vB.y * Math.cos(a) + _vC.y * Math.sin(a);
      const pz = _vB.z * Math.cos(a) + _vC.z * Math.sin(a);
      S.sprite = SPRITE.STREAK;
      S.life = rrange(0.3, 0.55);
      S.size0 = rrange(0.05, 0.1);
      S.size1 = S.size0 * 0.4;
      S.stretch = 1;
      S.aspect = 1.8;
      colBoth(c); col0White(0.6);
      S.alpha = 1;
      S.drag = 1.8;
      S.fade = FADE_FLASH;
      pushAdd(sys, x + px * radius, y + py * radius, z + pz * radius, nrm.x * rrange(3, 6) + px * 0.8, nrm.y * rrange(3, 6) + py * 0.8, nrm.z * rrange(3, 6) + pz * 0.8);
    }
  },

  /* ---- wing gust: a downward puff + a swirl (the wing power's flap) ------- */
  wingGust(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xf2f6ff;
    const q = sys.scale;
    const n = Math.max(6, Math.round(16 * q));
    for (let i = 0; i < n; i++) {
      sReset();
      const ang = (i / n) * 6.283 + rsym() * 0.3;
      S.sprite = SPRITE.SMOKE;
      S.life = rrange(0.35, 0.6);
      S.size0 = 0.18;
      S.size1 = 0.7;
      colBoth(c); col1Scale(0.7);
      S.alpha = 0.12;
      S.drag = 2.4;
      S.spin = rsym() * 2;
      S.rot = rnd() * 6.283;
      pushAlpha(sys, x + Math.cos(ang) * 0.5, y - 0.2, z + Math.sin(ang) * 0.5, Math.cos(ang) * 2.2, -rrange(1.5, 3), Math.sin(ang) * 2.2);
    }
    // a few soft feather-like motes swirling
    const m = Math.max(3, Math.round(8 * q));
    for (let i = 0; i < m; i++) {
      sReset();
      const ang = rnd() * 6.283;
      S.sprite = SPRITE.LEAF;
      S.life = rrange(0.8, 1.4);
      S.size0 = rrange(0.05, 0.09);
      S.size1 = S.size0;
      S.aspect = 1.6;
      colBoth(0xffffff);
      S.alpha = 0.8;
      S.grav = 1.0;
      S.drag = 2.0;
      S.spin = rsym() * 5;
      S.rot = rnd() * 6.283;
      S.turb = 0.8;
      S.flags = F_SWAY | F_FLUTTER;
      S.fade = FADE_LINEAR;
      pushAlpha(sys, x + Math.cos(ang) * 0.4, y + 0.2, z + Math.sin(ang) * 0.4, Math.cos(ang) * 1.2, rrange(-0.5, 1.0), Math.sin(ang) * 1.2);
    }
  },

  /* ---- crusher / heavy impact (kept from Ascendant — the crusher hazard uses it) */
  crush(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0xd8dee8;
    BURSTS.dust(sys, x, y, z, { color: c, count: 12, scale: 1.6 });
    BURSTS.spark(sys, x, y, z, { color: 0xffd0a0, count: 10, dir: [0, 1, 0], spread: 1.3, power: 0.8 });
    floorRing(sys, x, y, z, c, 4.6, 0.3, 0.45, 0);
  },

  /* ---- vanish platform blink-out ------------------------------------------ */
  vanish(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : 0x9fd0ff;
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
      pushAdd(sys, x + rsym() * sx, y, z + rsym() * sz, rsym() * 1.2, rrange(0.5, 2.4), rsym() * 1.2);
    }
  },

  /* ---- bounce pad launch -------------------------------------------------- */
  bounce(sys, x, y, z, o) {
    const c = o.color !== undefined ? o.color : sys.tint.bounce;
    const q = sys.scale;
    const power = clamp(optNum(o, 'power', 4) / 6, 0.4, 2.2);
    floorRing(sys, x, y, z, c, 2.4 + 1.4 * power, 0.34, 0.9, 0.5);
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
      pushAdd(sys, x + Math.cos(ang) * r, y + 0.1, z + Math.sin(ang) * r, Math.cos(ang) * 1.6, rrange(5, 10) * power, Math.sin(ang) * 1.6);
    }
  },
};

/** push the end colour toward white by t (used by droplets) */
function col1White(t) {
  S.r1 = S.r1 + (1 - S.r1) * t;
  S.g1 = S.g1 + (1 - S.g1) * t;
  S.b1 = S.b1 + (1 - S.b1) * t;
}

/** every burst preset name, in the order the contract lists them (+ extras) */
export const BURST_PRESETS = Object.freeze([
  'land', 'hardLand', 'jump', 'jump3', 'longjump', 'dive', 'slideDust',
  'pound', 'poundShock', 'wallkick', 'death', 'deathRewind', 'checkpoint',
  'coin', 'sigil', 'crest', 'crestGrand', 'courseClear', 'splash', 'bubbles',
  'lavaPop', 'iceShard', 'dust', 'snowPuff', 'sandPuff', 'spark', 'gateOpen',
  'paintingRipple', 'gnasherBite', 'squish', 'ringPass', 'wingGust',
  // extras kept from Ascendant for the hazards that still use them
  'leafKick', 'crush', 'vanish', 'bounce',
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
      pushAdd(sys, x, y, z, rsym() * 0.35, rrange(0.5, 1.3), rsym() * 0.35);
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
      pushAlpha(sys, x, y, z, sys.wind.x + rsym() * 0.25, -rrange(1.1, 1.9), sys.wind.z + rsym() * 0.25);
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
      pushAdd(sys, x, y, z, rsym() * 0.12, rrange(-0.05, 0.14), rsym() * 0.12);
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
      pushAlpha(sys, x, y, z, sys.wind.x * 0.5, rrange(-0.15, 0.2), sys.wind.z * 0.5);
    },
  },
  /* fine water spray drifting off a waterfall / shoreline volume */
  spray: {
    rate: 18, radius: 18, yBias: 'top', color: 0xe4f6ff, themed: false,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = rnd() < 0.7 ? SPRITE.DOT : SPRITE.DROP;
      S.life = rrange(1.0, 2.2);
      S.size0 = rrange(0.025, 0.06);
      S.size1 = S.size0 * 0.7;
      colBoth(color);
      S.alpha = 0.55;
      S.grav = 2.4;
      S.drag = 1.6;
      S.turb = 0.5;
      S.flags = F_SWAY;
      S.fade = FADE_LINEAR;
      pushAlpha(sys, x, y, z, sys.wind.x * 0.8 + rsym() * 0.6, rrange(-0.4, 0.6), sys.wind.z * 0.8 + rsym() * 0.6);
    },
  },
  /* low tan haze that streams with the wind across the desert floor */
  sandDust: {
    rate: 8, radius: 28, yBias: 'bottom', color: 0xd9c096, themed: false,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = rnd() < 0.5 ? SPRITE.DUST : SPRITE.SMOKE;
      S.life = rrange(4, 8);
      S.size0 = rrange(0.6, 1.4);
      S.size1 = S.size0 * 2.2;
      colBoth(color); col1Scale(0.8);
      S.alpha = 0.07;
      S.grav = -0.02;
      S.drag = 0.4;
      S.spin = rsym() * 0.15;
      S.rot = rnd() * 6.283;
      S.turb = 0.3;
      S.flags = F_SWAY;
      pushAlpha(sys, x, y, z, sys.wind.x * 2.2 + rsym() * 0.3, rrange(0.02, 0.12), sys.wind.z * 2.2 + rsym() * 0.3);
    },
  },
  /* aurora: huge, faint, very slow vertical curtains high above the course */
  aurora: {
    rate: 1.2, radius: 60, yBias: 'top', color: 0x6cf7c8, themed: true,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.DOT;
      S.life = rrange(9, 16);
      S.size0 = rrange(3, 6);
      S.size1 = S.size0 * 1.5;
      S.aspect = rrange(3.5, 7);
      // drift between green and violet over the life
      colBoth(color);
      col1(rnd() < 0.5 ? 0x9a6cf7 : 0x4fd0ff);
      S.alpha = 0.055;
      S.grav = -0.03;
      S.drag = 0.8;
      S.turb = 0.5;
      S.flags = F_SWAY | F_FLICKER;
      S.rot = rsym() * 0.25;
      S.fade = FADE_SMOOTH;
      pushAdd(sys, x, y + rnd() * 8, z, sys.wind.x * 0.4, 0.1, sys.wind.z * 0.4);
    },
  },
  /* leaves tumbling down through the canopy */
  leaves: {
    /* ROUND 5 — THE LEAVES WERE WHITE CARDS.
     * Critic, zoom `_shots/_r3_v1_shadowblade.png`: "the ambient leaf sprites
     * read [180,177,165] in shadow vs [182,192,166] in light — i.e. identical
     * ... it renders as a flat opaque near-white card".
     * A particle is unlit by construction and that is fine; the bug is the
     * LEVEL. These spawned at alpha 0.92 in a colour that is already a lit
     * mid-green, so every card was painted at full strength over a ground that
     * the tone map then rolled off — the sprite ended up ABOVE the meadow it is
     * supposed to be falling through, in every lighting condition, which is
     * exactly what makes it read as paper. The colour now carries the shading
     * the sprite cannot receive: the spawn colour is scaled well down (a leaf
     * seen against the sun is bright, one tumbling into grass is not), the
     * alpha drops so the card takes some ground colour, and the size comes down
     * to a leaf rather than a postcard. */
    rate: 6, radius: 24, yBias: 'top', color: 0x6f8f42, themed: false,
    spawn(sys, x, y, z, color) {
      sReset();
      S.sprite = SPRITE.LEAF;
      S.life = rrange(4, 7);
      S.size0 = rrange(0.045, 0.085);
      S.size1 = S.size0;
      S.aspect = 1.4;
      colBoth(rnd() < 0.65 ? color : 0x9c7a34); col0Scale(0.55); col1Scale(0.40);
      S.alpha = 0.72;
      S.grav = 0.7;
      S.drag = 1.4;
      S.spin = rsym() * 3;
      S.rot = rnd() * 6.283;
      S.turb = 1.1;
      S.flags = F_SWAY | F_FLUTTER;
      S.fade = FADE_HOLD;
      pushAlpha(sys, x, y, z, sys.wind.x * 1.2 + rsym() * 0.4, -rrange(0.6, 1.2), sys.wind.z * 1.2 + rsym() * 0.4);
    },
  },
  /* kept from Ascendant: stray sparks in a foundry, and a soft volumetric haze */
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
      pushAdd(sys, x, y, z, rsym() * 1.6, rrange(-1.5, 1.5), rsym() * 1.6);
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
      pushAlpha(sys, x, y, z, sys.wind.x * 0.3, 0.03, sys.wind.z * 0.3);
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

    /** @type {Layer|null} THE one instanced mesh */
    this.layer = null;
    this._buildLayer();

    /** ambient emitters bound to course volumes */
    this.emitters = [];
    this._ambientId = 0;

    /** theme-driven tints, overridden by setTheme() (ThemeDef.palette, contract §15) */
    this.tint = {
      checkpoint: 0x7ef0ff,
      crest: 0xffd76a,
      sigil: 0xc07bff,
      coin: 0xffcf4d,
      bounce: 0xffd27a,
      accent: 0x7ec8ff,
      water: 0x7fd0ec,
      ambient: null,
    };

    this.wind = new THREE.Vector3(0.25, 0, 0.1);
    this.time = 0;
    this.theme = null;
    this._fogNear = 30;
    this._fogFar = 220;
    /** last camera position handed to update(); ambient culling reads this */
    this._camPos = new THREE.Vector3(0, 0, 0);
    this._hasCam = false;
  }

  /* ---- layer lifecycle -------------------------------------------------- */

  _buildLayer() {
    const cap = clamp(Math.round(this.baseCapacity * this.scale), MIN_CAPACITY, MAX_CAPACITY);
    this.capacity = cap;
    this.layer = new Layer(cap, this.texture);
    if (this.scene && this.scene.add) this.scene.add(this.layer.mesh);
  }

  _destroyLayer() {
    if (this.layer) this.layer.dispose();
    this.layer = null;
  }

  /* ---- configuration ---------------------------------------------------- */

  setQuality(q) {
    const r = resolveQuality(q);
    const next = clamp(r.particles, 0.15, 2);
    this.qualityKey = r.key;
    if (Math.abs(next - this.scale) < 1e-4) return;
    this.scale = next;
    this._destroyLayer();
    this._buildLayer();
  }

  setCamera(camera) {
    this.camera = camera || null;
  }

  setWind(x, y, z) {
    this.wind.set(x || 0, y || 0, z || 0);
  }

  /** pull accent tints + ambient colour out of a ThemeDef (themes.js, contract §15) */
  setTheme(theme) {
    this.theme = theme || null;
    if (!theme) return;
    const pal = theme.palette;
    if (pal) {
      if (pal.checkpointOn !== undefined) this.tint.checkpoint = pal.checkpointOn;
      else if (pal.checkpoint !== undefined) this.tint.checkpoint = pal.checkpoint;
      if (pal.crest !== undefined) this.tint.crest = pal.crest;
      if (pal.sigil !== undefined) this.tint.sigil = pal.sigil;
      if (pal.coin !== undefined) this.tint.coin = pal.coin;
      if (pal.accent !== undefined) this.tint.accent = pal.accent;
      if (pal.water !== undefined) this.tint.water = pal.water;
      if (pal.safeEdge !== undefined) this.tint.bounce = pal.safeEdge;
    }
    const tp = theme.particles;
    this.tint.ambient = tp && tp.color !== undefined ? tp.color : null;
  }

  /**
   * Bind every `theme.particles.ambient[{preset, rate}]` emitter to a bounds
   * box (typically the course's `bounds`). Returns the handles so the course
   * can remove them on unload. Convenience over ambient(); nothing else.
   * @param {object} theme ThemeDef
   * @param {THREE.Box3|number[]} box
   * @returns {object[]} handles
   */
  ambientFromTheme(theme, box) {
    const out = [];
    const list = theme && theme.particles && Array.isArray(theme.particles.ambient) ? theme.particles.ambient : null;
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !e.preset) continue;
      const h = this.ambient(e.preset, box, e.rate, e.color !== undefined ? e : EMPTY_OPTS);
      if (h) out.push(h);
    }
    return out;
  }

  /* ---- bursts ----------------------------------------------------------- */

  /**
   * @param {string} preset  see BURST_PRESETS
   * @param {THREE.Vector3|number[]} pos
   * @param {object} [opts] {strength, color, surface, cause, dir, normal, count, power, scale, speed, radius, w, h, surfaceY}
   */
  burst(preset, pos, opts) {
    if (!this.enabled || !this.layer) return;
    const fn = BURSTS[preset];
    if (!fn) return;
    if (!readVec(pos, _vD)) return;
    fn(this, _vD.x, _vD.y, _vD.z, opts || EMPTY_OPTS);
  }

  /** true when a preset exists — the harness checks every contract name */
  hasBurst(preset) { return typeof BURSTS[preset] === 'function'; }
  hasAmbient(preset) { return !!AMBIENT[preset]; }

  /* ---- ambience --------------------------------------------------------- */

  /**
   * Bind a continuous emitter to a course volume.
   * @param {string} preset see AMBIENT_PRESETS
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
    if (box && box.min && box.max) {
      // Box3 or a plain {min:[x,y,z], max:[x,y,z]} course bounds
      readVec(box.min, e.min);
      readVec(box.max, e.max);
    } else if (Array.isArray(box) && box.length >= 6) {
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

  /** kill every live particle (course change / respawn) */
  clear() {
    const L = this.layer;
    if (L) { L.count = 0; L.cursor = 0; L.mesh.count = 0; }
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

    // cull the spawn box to a radius around the camera: a course-wide volume
    // only ever pays for what can be seen
    if (this._hasCam) {
      const R = def.radius;
      const cx = this._camPos.x, cy = this._camPos.y, cz = this._camPos.z;
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
    const L = this.layer;
    if (!L) return;
    const u = L.material.uniforms;
    const fog = this.scene && this.scene.fog;
    if (!fog) { u.uFogAmount.value = 0; return; }
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
    u.uFogAmount.value = 1;
    u.uFogRange.value.set(near, far);
    if (fog.color) u.uFogColor.value.copy(fog.color);
  }

  /* ---- frame ------------------------------------------------------------ */

  /**
   * @param {number} dt seconds (gameplay dt — the death hit-stop slows dust too)
   * @param {THREE.Vector3|THREE.Camera|number[]} [camPos] camera position, or
   *        anything with a `.position`; falls back to the constructor camera.
   */
  update(dt, camPos) {
    if (!this.layer) return;
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    if (d <= 0) return;
    this.time += d;

    if (camPos && camPos.position && typeof camPos.position.x === 'number') {
      this._camPos.copy(camPos.position); this._hasCam = true;
    } else if (readVec(camPos, _camPos)) {
      this._camPos.copy(_camPos); this._hasCam = true;
    } else if (this.camera && this.camera.position) {
      this._camPos.copy(this.camera.position); this._hasCam = true;
    }

    if (this.enabled) {
      for (let i = 0; i < this.emitters.length; i++) this._spawnAmbient(this.emitters[i], d);
    }

    simulateLayer(this.layer, d, this.time);
    this._syncFog();
    uploadLayer(this.layer);
  }

  /* ---- introspection (used by the perf HUD and the harness) ------------- */

  get liveCount() { return this.layer ? this.layer.count : 0; }

  /** always 0 or 1 — the contract's "one particle draw call" */
  get drawCalls() { return this.layer && this.layer.count > 0 ? 1 : 0; }

  setVisible(v) {
    if (this.layer) this.layer.mesh.visible = !!v;
  }

  dispose() {
    this.clearAmbient();
    this._destroyLayer();
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
 * A fixed-length ribbon strip. Used for the long jump / dive speed streak and
 * the death-rewind ghost path. Points are stored head-first in a Float32Array
 * ring that is shifted with copyWithin — no allocation, ever.
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
