/**
 * CRESTBOUND — runtime/fx/decals.js
 * CONTRACT §8 (fx package: particles + impacts + decals).
 *
 * A pooled, SINGLE-DRAW-CALL decal system: one InstancedMesh of a unit quad,
 * oriented onto the contact normal through `instanceMatrix`, lifted a hair off
 * the surface and pushed forward with `polygonOffset` so it can never z-fight the
 * platform it sits on.
 *
 * Ported from `games/ascendant/runtime/fx/decals.js` (same studio, proven) and
 * extended for the third-person game:
 *
 *   - a 3×2 procedural atlas instead of 2×2 — SCORCH / SCUFF / SPLAT / CRACK are
 *     Ascendant's; FOOTPRINT and WET are new, because in third person the player
 *     is looking AT the ground the hero is standing on, and a trail of boot prints
 *     across fresh snow is the cheapest possible "I have been here" storytelling.
 *   - `footprint()` — surface-aware (snow / sand / mud / wet / dust), mirrored per
 *     foot by a negative X scale, rolled to the hero's facing.
 *   - `poundCrack()` — the ground-pound signature: a radial fracture plus a soot
 *     wash, placed by `fx/impacts.js` the frame the pound lands.
 *
 * ART-DIRECTION LAW (inherited, non-negotiable): marks are SUBTLE and they are
 * memory, not decoration. A decal must never read as a landable surface and must
 * never compete with the bright leading-edge stripes that tell the player where to
 * jump (CONTRACT hard rule 2, "readability beats beauty"). Everything here is low
 * alpha, low saturation, dark-on-light or light-on-dark — never a coloured shape a
 * player could mistake for a collectible.
 *
 * PERFORMANCE LAW: zero allocation after construction. Every vector, quaternion,
 * matrix and colour used by `add()` and `update()` is a module-scope scratch; the
 * instance matrix array is written in place; dead slots are swap-removed. One
 * InstancedMesh, one material, one texture, one draw call, capacity ≤ 96.
 */

import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from '../core/util.js';
import { QUALITY } from '../core/settings.js';

/* ------------------------------------------------------------------ *
 *  constants + scratch (zero per-frame allocation below this line)
 * ------------------------------------------------------------------ */

const ATLAS_COLS = 3;
const ATLAS_ROWS = 2;
const ATLAS_CELL = 256;

/** Hard ceiling on live decals. One draw call either way; this bounds fill. */
const HARD_CAP = 96;
const DEFAULT_LIFE = 20;      // seconds — a lasting mark (scorch, crack)
const PRINT_LIFE = 9;         // seconds — a transient mark (footprints)
const FADE_TAIL = 0.26;       // fraction of life spent fading out
const FADE_HEAD = 0.10;       // seconds of fade-in (a decal never "pops" in)
const LIFT = 0.016;           // metres off the surface, on top of polygonOffset

/** atlas slots */
export const DECAL_SPRITE = {
  SCORCH: 0,
  SCUFF: 1,
  SPLAT: 2,
  CRACK: 3,
  FOOTPRINT: 4,
  WET: 5,
};

const QUALITY_FALLBACK = {
  low: { decor: 0.3 },
  medium: { decor: 0.6 },
  high: { decor: 1 },
  ultra: { decor: 1 },
};

const EMPTY_OPTS = Object.freeze({});

const _pos = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();
const _side = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _quat = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();
const _up = new THREE.Vector3(0, 0, 1);   // PlaneGeometry faces +Z
const _worldUp = new THREE.Vector3(0, 1, 0);

let RNG = mulberry32(0x2f6b1c33);
function rnd() { return RNG(); }
function rsym() { return RNG() * 2 - 1; }

/* ------------------------------------------------------------------ *
 *  decal type table
 * ------------------------------------------------------------------ *
 *  cell    — atlas slot
 *  color   — default tint (overridable per call)
 *  size    — default world RADIUS in metres (the quad is 2×size wide)
 *  aspect  — vertical stretch of the quad (skids elongate along the slide)
 *  alpha   — peak opacity (kept LOW on purpose)
 *  life    — seconds
 *  roll    — 'random' | 'aligned'  (aligned uses opts.angle / opts.dir)
 */
const DECAL_TYPES = {
  /* --- lasting marks ------------------------------------------------ */
  scorch: { cell: DECAL_SPRITE.SCORCH, color: 0x120e0c, size: 1.15, aspect: 1, alpha: 0.52, life: DEFAULT_LIFE, roll: 'random' },
  burn: { cell: DECAL_SPRITE.SCORCH, color: 0x1c1210, size: 0.95, aspect: 1, alpha: 0.46, life: DEFAULT_LIFE, roll: 'random' },
  soot: { cell: DECAL_SPRITE.SCORCH, color: 0x241c18, size: 1.45, aspect: 1, alpha: 0.30, life: DEFAULT_LIFE, roll: 'random' },
  crack: { cell: DECAL_SPRITE.CRACK, color: 0x15171c, size: 1.0, aspect: 1, alpha: 0.34, life: DEFAULT_LIFE, roll: 'random' },
  frost: { cell: DECAL_SPRITE.CRACK, color: 0xdff2ff, size: 1.05, aspect: 1, alpha: 0.30, life: 16, roll: 'random' },

  /* --- skids + scuffs ----------------------------------------------- */
  scuff: { cell: DECAL_SPRITE.SCUFF, color: 0x2b2c31, size: 0.85, aspect: 1.35, alpha: 0.26, life: DEFAULT_LIFE, roll: 'aligned' },
  skid: { cell: DECAL_SPRITE.SCUFF, color: 0x26272b, size: 1.1, aspect: 1.9, alpha: 0.22, life: DEFAULT_LIFE, roll: 'aligned' },
  slideMark: { cell: DECAL_SPRITE.SCUFF, color: 0x6d6046, size: 1.25, aspect: 2.4, alpha: 0.18, life: 12, roll: 'aligned' },

  /* --- splatters ----------------------------------------------------- */
  splat: { cell: DECAL_SPRITE.SPLAT, color: 0xff6a14, size: 0.7, aspect: 1, alpha: 0.7, life: 14, roll: 'random' },
  slush: { cell: DECAL_SPRITE.SPLAT, color: 0xbfe3ff, size: 0.6, aspect: 1, alpha: 0.38, life: 12, roll: 'random' },
  wet: { cell: DECAL_SPRITE.WET, color: 0x2c4a58, size: 0.85, aspect: 1, alpha: 0.30, life: 8, roll: 'random' },
  puddle: { cell: DECAL_SPRITE.WET, color: 0x3a5f70, size: 1.3, aspect: 1, alpha: 0.24, life: 10, roll: 'random' },

  /* --- footprints (the third-person addition) ------------------------ */
  footprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0x3a352e, size: 0.135, aspect: 2.15, alpha: 0.24, life: PRINT_LIFE, roll: 'aligned' },
  snowprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0x9fbdd8, size: 0.145, aspect: 2.15, alpha: 0.50, life: 16, roll: 'aligned' },
  sandprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0xa78c5e, size: 0.145, aspect: 2.15, alpha: 0.38, life: 12, roll: 'aligned' },
  mudprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0x4a3a28, size: 0.14, aspect: 2.15, alpha: 0.42, life: 12, roll: 'aligned' },
  wetprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0x35505e, size: 0.14, aspect: 2.15, alpha: 0.34, life: 6, roll: 'aligned' },
  ashprint: { cell: DECAL_SPRITE.FOOTPRINT, color: 0x8a8175, size: 0.14, aspect: 2.15, alpha: 0.26, life: 10, roll: 'aligned' },
};

export const DECAL_TYPE_NAMES = Object.freeze(Object.keys(DECAL_TYPES));

/**
 * Which print a surface leaves. Read by `footprint()` and by
 * `fx/impacts.js#stepDust`, so "what the ground remembers" is decided in exactly
 * one place. Surfaces absent from this table leave nothing at all — a metal
 * catwalk does not hold a boot print, and faking one is worse than none.
 */
export const PRINT_FOR_SURFACE = Object.freeze({
  snow: 'snowprint',
  sand: 'sandprint',
  dirt: 'mudprint',
  moss: 'mudprint',
  grass: 'footprint',
  water: 'wetprint',
  lava: 'ashprint',
  obsidian: 'ashprint',
  cloud: null,
  ice: null,
  glass: null,
  metal: null,
  panel: null,
  grate: null,
  rubber: null,
  conveyor: null,
});

/* ------------------------------------------------------------------ *
 *  procedural atlas
 * ------------------------------------------------------------------ *
 *  RGB carries a BRIGHTNESS mask (dark core / lighter rim), alpha carries
 *  coverage. The shader multiplies the instance tint by the brightness mask, so a
 *  single greyscale atlas gives every decal an ashy rim for free — and lets a
 *  bright tint (snow print, frost) read as a raised rim rather than a stain.
 * ------------------------------------------------------------------ */

function rsymR(R) { return R() * 2 - 1; }

function buildDecalCanvas(cell = ATLAS_CELL) {
  const cvs = document.createElement('canvas');
  cvs.width = cell * ATLAS_COLS;
  cvs.height = cell * ATLAS_ROWS;
  const g = cvs.getContext('2d');
  g.clearRect(0, 0, cvs.width, cvs.height);

  const R = mulberry32(0xc0ffee11);
  const origin = (i) => [(i % ATLAS_COLS) * cell, Math.floor(i / ATLAS_COLS) * cell];
  const shade = (v, a) => {
    const c = Math.round(clamp(v, 0, 1) * 255);
    return `rgba(${c},${c},${c},${a.toFixed(4)})`;
  };

  const blob = (cx, cy, r, bright, a) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, shade(bright, a));
    grd.addColorStop(0.55, shade(bright + 0.12, a * 0.72));
    grd.addColorStop(1, shade(bright + 0.3, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };

  // ---- 0 : SCORCH — irregular soot bloom, dark core, ashy feathered rim
  {
    const [ox, oy] = origin(DECAL_SPRITE.SCORCH);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    blob(0, 0, cell * 0.42, 0.05, 0.80);
    for (let i = 0; i < 16; i++) {
      const ang = R() * Math.PI * 2;
      const rad = Math.pow(R(), 0.55) * cell * 0.30;
      blob(Math.cos(ang) * rad, Math.sin(ang) * rad, cell * (0.07 + R() * 0.16), 0.02 + R() * 0.12, 0.28 + R() * 0.34);
    }
    // ashy speckle rim
    for (let i = 0; i < 40; i++) {
      const ang = R() * Math.PI * 2;
      const rad = cell * (0.24 + R() * 0.18);
      blob(Math.cos(ang) * rad, Math.sin(ang) * rad, cell * (0.012 + R() * 0.03), 0.55 + R() * 0.4, 0.16 + R() * 0.22);
    }
    g.restore();
  }

  // ---- 1 : SCUFF — directional skid smears, tapered at both ends
  {
    const [ox, oy] = origin(DECAL_SPRITE.SCUFF);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    for (let s = 0; s < 7; s++) {
      const x = (s / 6 - 0.5) * cell * 0.46 + rsymR(R) * cell * 0.03;
      const half = cell * (0.20 + R() * 0.16);
      const w = cell * (0.016 + R() * 0.032);
      const lin = g.createLinearGradient(0, -half, 0, half);
      const b = 0.16 + R() * 0.22;
      lin.addColorStop(0.00, shade(b + 0.4, 0));
      lin.addColorStop(0.20, shade(b, 0.45 + R() * 0.3));
      lin.addColorStop(0.52, shade(b - 0.08, 0.62 + R() * 0.3));
      lin.addColorStop(0.85, shade(b, 0.22));
      lin.addColorStop(1.00, shade(b + 0.4, 0));
      g.fillStyle = lin;
      g.beginPath();
      g.moveTo(x - w, -half);
      g.lineTo(x + w, -half);
      g.lineTo(x + w * 1.7, half);
      g.lineTo(x - w * 1.7, half);
      g.closePath();
      g.fill();
    }
    // soft dirt wash underneath so the streaks sit in something
    blob(0, 0, cell * 0.34, 0.30, 0.18);
    g.restore();
  }

  // ---- 2 : SPLAT — central pool with satellite droplets and a thin rim
  {
    const [ox, oy] = origin(DECAL_SPRITE.SPLAT);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    g.fillStyle = shade(0.85, 0.95);
    g.beginPath();
    const lobes = 11;
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const r = cell * (0.20 + R() * 0.075);
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2;
      const rad = cell * (0.24 + Math.pow(R(), 0.7) * 0.20);
      const rr = cell * (0.008 + R() * 0.035);
      g.fillStyle = shade(0.9, 0.62 + R() * 0.3);
      g.beginPath();
      g.ellipse(Math.cos(a) * rad, Math.sin(a) * rad, rr, rr * (0.6 + R() * 0.9), a, 0, Math.PI * 2);
      g.fill();
    }
    blob(0, 0, cell * 0.30, 0.62, 0.28);
    g.restore();
  }

  // ---- 3 : CRACK — radial fracture from a bright impact point
  {
    const [ox, oy] = origin(DECAL_SPRITE.CRACK);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const arms = 9;
    for (let i = 0; i < arms; i++) {
      const a0 = (i / arms) * Math.PI * 2 + rsymR(R) * 0.22;
      let x = 0, y = 0, a = a0;
      g.strokeStyle = shade(0.10, 0.85);
      g.lineWidth = cell * 0.016;
      g.beginPath();
      g.moveTo(0, 0);
      const segs = 4 + ((R() * 3) | 0);
      for (let s = 0; s < segs; s++) {
        const step = cell * (0.045 + R() * 0.055);
        a += rsymR(R) * 0.5;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        if (Math.hypot(x, y) > cell * 0.45) break;
        g.lineTo(x, y);
      }
      g.stroke();
      // a shorter branch off the arm
      if (R() < 0.6) {
        g.lineWidth = cell * 0.009;
        g.strokeStyle = shade(0.14, 0.6);
        g.beginPath();
        g.moveTo(x * 0.55, y * 0.55);
        g.lineTo(x * 0.55 + Math.cos(a0 + 0.8) * cell * 0.09, y * 0.55 + Math.sin(a0 + 0.8) * cell * 0.09);
        g.stroke();
      }
    }
    blob(0, 0, cell * 0.13, 0.04, 0.7);
    blob(0, 0, cell * 0.36, 0.35, 0.12);
    g.restore();
  }

  // ---- 4 : FOOTPRINT — Nim's chunky boot: heel pad, forefoot pad, tread bars
  //
  // Drawn pointing "up" in cell space (local +Y of the quad), because the
  // 'aligned' roll points local +Y along the hero's facing. Bright rim + darker
  // interior: with a light tint (snow) the rim reads as displaced powder, with a
  // dark tint (mud) the interior reads as a pressed hollow.
  {
    const [ox, oy] = origin(DECAL_SPRITE.FOOTPRINT);
    g.save();
    g.translate(ox + cell * 0.5, oy + cell * 0.5);
    // cell space: the boot is ~0.30 cell wide, ~0.78 cell long
    const W = cell * 0.15;      // half width
    const L = cell * 0.39;      // half length

    const roundedPad = (cy, halfW, halfH, r, bright, a) => {
      g.fillStyle = shade(bright, a);
      g.beginPath();
      const x0 = -halfW, x1 = halfW, y0 = cy - halfH, y1 = cy + halfH;
      g.moveTo(x0 + r, y0);
      g.lineTo(x1 - r, y0);
      g.quadraticCurveTo(x1, y0, x1, y0 + r);
      g.lineTo(x1, y1 - r);
      g.quadraticCurveTo(x1, y1, x1 - r, y1);
      g.lineTo(x0 + r, y1);
      g.quadraticCurveTo(x0, y1, x0, y1 - r);
      g.lineTo(x0, y0 + r);
      g.quadraticCurveTo(x0, y0, x0 + r, y0);
      g.closePath();
      g.fill();
    };

    // soft displaced halo under the whole boot (reads as pushed-aside material)
    g.save();
    g.scale(1, L / W);
    blob(0, 0, W * 1.5, 0.78, 0.30);
    g.restore();

    // forefoot: wide rounded pad, toe end rounded harder
    roundedPad(-L * 0.52, W, L * 0.40, W * 0.62, 0.30, 0.92);
    // heel: smaller pad, separated by the arch gap
    roundedPad(L * 0.63, W * 0.80, L * 0.30, W * 0.55, 0.30, 0.92);

    // tread bars across the forefoot — the detail that makes it a BOOT
    g.fillStyle = shade(0.72, 0.55);
    for (let i = 0; i < 4; i++) {
      const y = -L * 0.82 + i * L * 0.19;
      g.fillRect(-W * 0.76, y, W * 1.52, L * 0.055);
    }
    // heel bar + a small maker's lug
    g.fillRect(-W * 0.56, L * 0.55, W * 1.12, L * 0.05);
    g.fillStyle = shade(0.70, 0.42);
    g.beginPath();
    g.arc(0, L * 0.74, W * 0.22, 0, Math.PI * 2);
    g.fill();

    // rim: a light lip around the whole print
    g.strokeStyle = shade(0.98, 0.34);
    g.lineWidth = cell * 0.008;
    g.beginPath();
    g.ellipse(0, -L * 0.52, W * 1.02, L * 0.42, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(0, L * 0.63, W * 0.82, L * 0.32, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  // ---- 5 : WET — a damp irregular patch: dark body, one bright specular lip
  {
    const [ox, oy] = origin(DECAL_SPRITE.WET);
    g.save(); g.translate(ox + cell * 0.5, oy + cell * 0.5);
    // irregular body from overlapping blobs
    blob(0, 0, cell * 0.34, 0.22, 0.72);
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2;
      const rad = Math.pow(R(), 0.6) * cell * 0.24;
      blob(Math.cos(a) * rad, Math.sin(a) * rad, cell * (0.09 + R() * 0.14), 0.18 + R() * 0.14, 0.30 + R() * 0.3);
    }
    // bright meniscus arc — the tell that reads as "wet" and not "burnt"
    g.strokeStyle = shade(0.96, 0.5);
    g.lineWidth = cell * 0.012;
    g.beginPath();
    g.arc(0, 0, cell * 0.29, Math.PI * 0.15, Math.PI * 1.05);
    g.stroke();
    // a few outlying droplets
    for (let i = 0; i < 12; i++) {
      const a = R() * Math.PI * 2;
      const rad = cell * (0.30 + R() * 0.14);
      blob(Math.cos(a) * rad, Math.sin(a) * rad, cell * (0.012 + R() * 0.026), 0.5 + R() * 0.4, 0.3 + R() * 0.35);
    }
    g.restore();
  }

  return cvs;
}

function buildDecalTexture() {
  const tex = new THREE.CanvasTexture(buildDecalCanvas());
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ *
 *  shaders
 * ------------------------------------------------------------------ */

const DECAL_VERT = /* glsl */`
  attribute vec2 aCell;
  attribute vec4 aColor;

  uniform vec2  uAtlasScale;
  uniform vec2  uFogRange;
  uniform float uFogAmount;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;

  void main() {
    vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;

    // corner from position.xy (-0.5..0.5), so the atlas mapping does not depend on
    // PlaneGeometry's uv winding. texture.flipY = false => canvas top is v == 0.
    vec2 cuv = position.xy + 0.5;
    vUv    = ( aCell + vec2( cuv.x, 1.0 - cuv.y ) ) * uAtlasScale;
    vColor = aColor;

    float dist = -mv.z;
    vFog = uFogAmount * clamp(
      ( dist - uFogRange.x ) / max( uFogRange.y - uFogRange.x, 1e-3 ), 0.0, 1.0 );
  }
`;

const DECAL_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3  uFogColor;

  varying vec2  vUv;
  varying vec4  vColor;
  varying float vFog;

  void main() {
    vec4 t = texture2D( uMap, vUv );
    float a = t.a * vColor.a * uOpacity;
    if ( a < 0.004 ) discard;

    // t.r is a brightness mask: dark core, ashy/snowy rim
    vec3 c = vColor.rgb * ( 0.55 + 0.85 * t.r );
    c = mix( c, uFogColor, vFog );

    gl_FragColor = vec4( c, a );
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ *
 *  quality
 * ------------------------------------------------------------------ */

function resolveDecor(q) {
  if (q == null) return 1;
  if (typeof q === 'string') {
    const src = (QUALITY && QUALITY[q]) || QUALITY_FALLBACK[q] || QUALITY_FALLBACK.high;
    if (typeof src.decor === 'number') return src.decor;
    if (typeof src.particles === 'number') return src.particles;
    return 1;
  }
  if (typeof q === 'object') {
    if (typeof q.decor === 'number') return q.decor;
    if (typeof q.particles === 'number') return q.particles;
  }
  return 1;
}

/* ------------------------------------------------------------------ *
 *  Decals
 * ------------------------------------------------------------------ */

export class Decals {
  /**
   * @param {THREE.Scene} scene
   * @param {string|object} [quality] 'low'|'medium'|'high'|'ultra' or a QUALITY entry
   * @param {object} [opts] {cap, lift, seed}
   */
  constructor(scene, quality = 'high', opts = EMPTY_OPTS) {
    this.scene = scene || null;
    this.enabled = true;
    this.lift = typeof opts.lift === 'number' ? opts.lift : LIFT;
    if (typeof opts.seed === 'number') RNG = mulberry32(opts.seed >>> 0);

    this._decor = clamp(resolveDecor(quality), 0.1, 1);
    this._requestedCap = Math.min(HARD_CAP, Math.max(6, opts.cap || HARD_CAP));

    this.texture = buildDecalTexture();

    this.mesh = null;
    this.count = 0;

    /** alternating foot for `footprint()` when the caller does not pass one */
    this._foot = 1;

    this._build();
  }

  /* ---- pool lifecycle --------------------------------------------------- */

  _capacity() {
    return clamp(Math.round(this._requestedCap * this._decor), 6, HARD_CAP);
  }

  _build() {
    const cap = this._capacity();
    this.cap = cap;
    this.count = 0;
    this._dirty = false;

    const geo = new THREE.PlaneGeometry(1, 1);

    this._cell = new Float32Array(cap * 2);
    this._colr = new Float32Array(cap * 4);
    this._aCell = new THREE.InstancedBufferAttribute(this._cell, 2);
    this._aColr = new THREE.InstancedBufferAttribute(this._colr, 4);
    this._aCell.setUsage(THREE.DynamicDrawUsage);
    this._aColr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this._aCell);
    geo.setAttribute('aColor', this._aColr);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uOpacity: { value: 1 },
        uAtlasScale: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
        uFogColor: { value: new THREE.Color(0x05070d) },
        uFogRange: { value: new THREE.Vector2(30, 220) },
        uFogAmount: { value: 0 },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      toneMapped: false,
      fog: false,
    });

    this.geometry = geo;
    this.material = mat;

    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = 5;          // after opaque world, before particles (8/9)
    mesh.name = 'fx.decals';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh = mesh;
    this._imat = mesh.instanceMatrix.array;

    // per-decal CPU state
    this._age = new Float32Array(cap);
    this._life = new Float32Array(cap);
    this._alpha = new Float32Array(cap);

    if (this.scene && this.scene.add) this.scene.add(mesh);
  }

  _destroy() {
    if (!this.mesh) return;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
  }

  /* ---- placement -------------------------------------------------------- */

  /**
   * Place a decal.
   * @param {string} type  see DECAL_TYPE_NAMES
   * @param {THREE.Vector3|number[]} pos  contact point in world space
   * @param {THREE.Vector3|number[]} [normal]  surface normal (defaults to +Y)
   * @param {object} [opts] {size, scale, alpha, color, life, angle, dir, aspect,
   *                         jitter, mirror, offset}
   * @returns {number} slot index, or -1 if nothing was placed
   */
  add(type, pos, normal, opts = EMPTY_OPTS) {
    if (!this.enabled || !this.mesh) return -1;
    const def = DECAL_TYPES[type] || DECAL_TYPES.scorch;

    if (!readVec3(pos, _pos)) return -1;
    if (!readVec3(normal, _nrm) || _nrm.lengthSq() < 1e-8) _nrm.set(0, 1, 0);
    _nrm.normalize();

    const i = this._acquire();
    if (i < 0) return -1;

    const size = (typeof opts.size === 'number' ? opts.size : def.size)
      * (typeof opts.scale === 'number' ? opts.scale : 1);
    const aspect = typeof opts.aspect === 'number' ? opts.aspect : def.aspect;
    const life = typeof opts.life === 'number' ? opts.life : def.life;
    const alpha = clamp(typeof opts.alpha === 'number' ? opts.alpha : def.alpha, 0, 1);

    // orientation: the quad faces +Z, so align +Z to the surface normal, then roll
    // about that normal. For 'aligned' types the quad's local +Y (the axis `aspect`
    // stretches, the axis skid streaks and boot prints run along) is pointed at `dir`.
    _quat.setFromUnitVectors(_up, _nrm);
    let roll;
    let aligned = false;
    if (def.roll === 'aligned' && typeof opts.angle === 'number') {
      roll = opts.angle;
      aligned = true;
    } else if (def.roll === 'aligned' && readVec3(opts.dir, _dir)) {
      _dir.addScaledVector(_nrm, -_dir.dot(_nrm));   // project onto the surface plane
      if (_dir.lengthSq() < 1e-8) {
        roll = rnd() * Math.PI * 2;
      } else {
        _dir.normalize();
        _lx.set(1, 0, 0).applyQuaternion(_quat);
        _ly.set(0, 1, 0).applyQuaternion(_quat);
        // rotating by t about local +Z sends local +Y to (-sin t)·X + (cos t)·Y
        roll = Math.atan2(-_dir.dot(_lx), _dir.dot(_ly));
        aligned = true;
      }
    } else {
      roll = rnd() * Math.PI * 2;
    }
    _roll.setFromAxisAngle(_up, roll);
    _quat.multiply(_roll);

    // lateral offset along the decal's own local +X (used to place a boot print
    // to the left/right of the hero's centre line without a second basis).
    const offset = typeof opts.offset === 'number' ? opts.offset : 0;
    _pos.addScaledVector(_nrm, this.lift);
    if (offset !== 0 && aligned) {
      _side.set(1, 0, 0).applyQuaternion(_quat);
      _pos.addScaledVector(_side, offset);
    }

    const jitter = typeof opts.jitter === 'number' ? opts.jitter : 0;
    if (jitter > 0) {
      _pos.x += rsym() * jitter;
      _pos.z += rsym() * jitter;
    }

    // mirror = -1 flips the sprite across its own long axis (left vs right boot)
    const mirror = opts.mirror === -1 || opts.mirror === true ? -1 : 1;
    _scl.set(size * 2 * mirror, size * 2 * aspect, 1);
    _mat.compose(_pos, _quat, _scl);
    _mat.toArray(this._imat, i * 16);

    const cell = def.cell;
    this._cell[i * 2] = cell % ATLAS_COLS;
    this._cell[i * 2 + 1] = Math.floor(cell / ATLAS_COLS);

    _col.set(opts.color !== undefined ? opts.color : def.color);
    this._colr[i * 4] = _col.r;
    this._colr[i * 4 + 1] = _col.g;
    this._colr[i * 4 + 2] = _col.b;
    this._colr[i * 4 + 3] = 0;

    this._age[i] = 0;
    this._life[i] = Math.max(0.5, life);
    this._alpha[i] = alpha;

    this._dirty = true;
    return i;
  }

  /* ---- named helpers ---------------------------------------------------- */

  scorch(pos, normal, opts) { return this.add('scorch', pos, normal, opts); }
  scuff(pos, normal, opts) { return this.add('scuff', pos, normal, opts); }
  skid(pos, normal, opts) { return this.add('skid', pos, normal, opts); }
  splat(pos, normal, opts) { return this.add('splat', pos, normal, opts); }
  crack(pos, normal, opts) { return this.add('crack', pos, normal, opts); }
  wet(pos, normal, opts) { return this.add('wet', pos, normal, opts); }

  /**
   * The ground-pound signature mark: a radial fracture with a soot wash under it,
   * scaled by the pound's shock radius. Called by `fx/impacts.js#pound` on the
   * frame the hero lands, so it is already on the ground when the dust ring
   * expands past it.
   * @param {THREE.Vector3|number[]} pos  contact point
   * @param {THREE.Vector3|number[]} [normal]
   * @param {object} [opts] {radius, color, sootColor, alpha}
   * @returns {number} slot of the crack, or -1
   */
  poundCrack(pos, normal, opts = EMPTY_OPTS) {
    if (!this.enabled || !this.mesh) return -1;
    const r = typeof opts.radius === 'number' ? opts.radius : 1.0;
    // wash first so the fracture always draws on top of it (later slot = later draw)
    this.add('soot', pos, normal, {
      size: r * 0.95,
      alpha: typeof opts.alpha === 'number' ? opts.alpha * 0.6 : 0.22,
      color: opts.sootColor,
      jitter: 0.05,
    });
    return this.add('crack', pos, normal, {
      size: r * 0.78,
      alpha: typeof opts.alpha === 'number' ? opts.alpha : 0.40,
      color: opts.color,
    });
  }

  /**
   * A boot print. Surface decides the look (snow holds a bright rim, sand a soft
   * hollow, metal holds nothing at all and this returns -1).
   * @param {THREE.Vector3|number[]} pos ground contact point (the FOOT, not the hips)
   * @param {THREE.Vector3|number[]} [normal] ground normal
   * @param {object} [opts] {surface, dir, angle, side:-1|1, offset, scale, alpha, color, life, type}
   * @returns {number} slot index, or -1 when this surface holds no print
   */
  footprint(pos, normal, opts = EMPTY_OPTS) {
    if (!this.enabled || !this.mesh) return -1;
    let type = opts.type;
    if (!type) {
      const s = opts.surface;
      if (s === undefined || s === null) type = 'footprint';
      else if (Object.prototype.hasOwnProperty.call(PRINT_FOR_SURFACE, s)) type = PRINT_FOR_SURFACE[s];
      else type = 'footprint';
    }
    if (!type || !DECAL_TYPES[type]) return -1;

    // alternate feet automatically when the caller does not care
    let side = opts.side === -1 || opts.side === 1 ? opts.side : (this._foot = -this._foot);
    const spread = typeof opts.offset === 'number' ? opts.offset : 0.13;

    return this.add(type, pos, normal, {
      dir: opts.dir,
      angle: opts.angle,
      offset: side * spread,
      mirror: side < 0 ? -1 : 1,
      scale: typeof opts.scale === 'number' ? opts.scale : 1,
      alpha: opts.alpha,
      color: opts.color,
      life: opts.life,
      jitter: 0.012,
    });
  }

  /** find a free slot, evicting the oldest live decal when full */
  _acquire() {
    if (this.count < this.cap) return this.count++;
    let worst = 0;
    let worstT = -1;
    for (let i = 0; i < this.count; i++) {
      const t = this._age[i] / this._life[i];
      if (t > worstT) { worstT = t; worst = i; }
    }
    return worst;
  }

  _removeAt(i) {
    const j = --this.count;
    if (i !== j) {
      const src = j * 16, dst = i * 16;
      const m = this._imat;
      for (let k = 0; k < 16; k++) m[dst + k] = m[src + k];
      this._cell[i * 2] = this._cell[j * 2];
      this._cell[i * 2 + 1] = this._cell[j * 2 + 1];
      this._colr[i * 4] = this._colr[j * 4];
      this._colr[i * 4 + 1] = this._colr[j * 4 + 1];
      this._colr[i * 4 + 2] = this._colr[j * 4 + 2];
      this._colr[i * 4 + 3] = this._colr[j * 4 + 3];
      this._age[i] = this._age[j];
      this._life[i] = this._life[j];
      this._alpha[i] = this._alpha[j];
    }
  }

  /* ---- frame ------------------------------------------------------------ */

  /** @param {number} dt seconds (gameplay dt — a death hit-stop slows the fade too) */
  update(dt) {
    if (!this.mesh) return;
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);

    let i = 0;
    while (i < this.count) {
      const life = this._life[i];
      const age = this._age[i] + d;
      if (age >= life) { this._removeAt(i); this._dirty = true; continue; }
      this._age[i] = age;

      const t = age / life;
      const fin = age < FADE_HEAD ? age / FADE_HEAD : 1;
      const fout = 1 - smoothstep(1 - FADE_TAIL, 1, t);
      this._colr[i * 4 + 3] = this._alpha[i] * fin * fout;
      i++;
    }

    this.mesh.count = this.count;
    if (this.count > 0) {
      this._aColr.needsUpdate = true;
      if (this._dirty) {
        this._aCell.needsUpdate = true;
        this.mesh.instanceMatrix.needsUpdate = true;
        this._dirty = false;
      }
    }

    this._syncFog();
  }

  _syncFog() {
    const fog = this.scene && this.scene.fog;
    const u = this.material.uniforms;
    if (!fog) { u.uFogAmount.value = 0; return; }
    let near, far;
    if (typeof fog.density === 'number') {
      const dd = Math.max(fog.density, 1e-5);
      near = 0.35 / dd;
      far = 1.9 / dd;
    } else {
      near = fog.near;
      far = fog.far;
    }
    u.uFogAmount.value = 1;
    u.uFogRange.value.set(near, far);
    if (fog.color) u.uFogColor.value.copy(fog.color);
  }

  /* ---- configuration ---------------------------------------------------- */

  setQuality(q) {
    const next = clamp(resolveDecor(q), 0.1, 1);
    if (Math.abs(next - this._decor) < 1e-4) return;
    this._decor = next;
    this._destroy();
    this._build();
  }

  /** Re-parent into a new scene (course load). Live decals are dropped. */
  setScene(scene) {
    if (scene === this.scene) return;
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.scene = scene || null;
    this.clear();
    if (this.scene && this.scene.add && this.mesh) this.scene.add(this.mesh);
  }

  setOpacity(a) { if (this.material) this.material.uniforms.uOpacity.value = clamp(a, 0, 1); }
  setVisible(v) { if (this.mesh) this.mesh.visible = !!v; }
  setEnabled(v) { this.enabled = !!v; }

  /** wipe every decal (course change, respawn from a checkpoint) */
  clear() {
    this.count = 0;
    this._dirty = true;
    if (this.mesh) this.mesh.count = 0;
  }

  get live() { return this.count; }

  /** always 0 or 1 — decals are one draw call or none */
  get drawCalls() { return this.mesh && this.count > 0 ? 1 : 0; }

  dispose() {
    this._destroy();
    if (this.texture) { this.texture.dispose(); this.texture = null; }
    this.scene = null;
  }
}

/* ------------------------------------------------------------------ *
 *  tiny helpers (module scope, allocation-free)
 * ------------------------------------------------------------------ */

function readVec3(v, out) {
  if (!v) return false;
  if (typeof v.x === 'number') { out.set(v.x, v.y || 0, v.z || 0); return true; }
  if (Array.isArray(v) && v.length >= 3) { out.set(v[0], v[1], v[2]); return true; }
  return false;
}

/** Exported for harnesses that want to assert the world-up convention. */
export const DECAL_UP = _worldUp;

export default Decals;
