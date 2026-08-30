/**
 * ASCENDANT — runtime/fx/decals.js
 * CONTRACT §19 (fx package).
 *
 * A pooled, single-draw-call decal system: ONE InstancedMesh of a unit quad,
 * oriented onto the surface normal via instanceMatrix, lifted a hair and pushed
 * forward with polygonOffset so it never z-fights the platform it sits on.
 *
 * Marks are deliberately SUBTLE. A death scorch, a hard-landing scuff and a lava
 * splatter are memory aids — "you have been here, you died here" — not decoration.
 * They must never read as a landable surface and never fight the edge stripes that
 * tell the player where to jump. 48 live decals max, 20 s life, fade over the last
 * quarter of it.
 */

import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from '../core/util.js';
import { QUALITY } from '../core/settings.js';

/* ------------------------------------------------------------------ *
 *  constants + scratch (zero per-frame allocation below this line)
 * ------------------------------------------------------------------ */

const ATLAS_COLS = 2;
const ATLAS_ROWS = 2;
const ATLAS_CELL = 256;

const HARD_CAP = 48;          // contract: never more than 48 live decals
const DEFAULT_LIFE = 20;      // seconds
const FADE_TAIL = 0.26;       // fraction of life spent fading out
const FADE_HEAD = 0.10;       // seconds of fade-in (a decal never "pops" in)
const LIFT = 0.016;           // metres off the surface, on top of polygonOffset

/** atlas slots */
export const DECAL_SPRITE = {
  SCORCH: 0,
  SCUFF: 1,
  SPLAT: 2,
  CRACK: 3,
};

const QUALITY_FALLBACK = {
  low: { decor: 0.35 },
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
const _scl = new THREE.Vector3(1, 1, 1);
const _quat = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();
const _up = new THREE.Vector3(0, 0, 1);   // PlaneGeometry faces +Z

let RNG = mulberry32(0x2f6b1c33);
function rnd() { return RNG(); }
function rsym() { return RNG() * 2 - 1; }

/* ------------------------------------------------------------------ *
 *  decal type table
 * ------------------------------------------------------------------ */

/**
 * cell    — atlas slot
 * color   — default tint (overridable per call)
 * size    — default world radius in metres
 * aspect  — vertical stretch of the quad (scuffs are elongated along the skid)
 * alpha   — peak opacity (kept LOW on purpose)
 * life    — seconds
 * roll    — 'random' | 'aligned' (aligned uses opts.angle / opts.dir)
 */
const DECAL_TYPES = {
  scorch: { cell: DECAL_SPRITE.SCORCH, color: 0x120e0c, size: 1.15, aspect: 1, alpha: 0.52, life: DEFAULT_LIFE, roll: 'random' },
  burn: { cell: DECAL_SPRITE.SCORCH, color: 0x1c1210, size: 0.95, aspect: 1, alpha: 0.46, life: DEFAULT_LIFE, roll: 'random' },
  scuff: { cell: DECAL_SPRITE.SCUFF, color: 0x2b2c31, size: 0.85, aspect: 1.35, alpha: 0.26, life: DEFAULT_LIFE, roll: 'aligned' },
  skid: { cell: DECAL_SPRITE.SCUFF, color: 0x26272b, size: 1.1, aspect: 1.9, alpha: 0.22, life: DEFAULT_LIFE, roll: 'aligned' },
  splat: { cell: DECAL_SPRITE.SPLAT, color: 0xff6a14, size: 0.7, aspect: 1, alpha: 0.7, life: 14, roll: 'random' },
  slush: { cell: DECAL_SPRITE.SPLAT, color: 0xbfe3ff, size: 0.6, aspect: 1, alpha: 0.38, life: 12, roll: 'random' },
  crack: { cell: DECAL_SPRITE.CRACK, color: 0x15171c, size: 1.0, aspect: 1, alpha: 0.34, life: DEFAULT_LIFE, roll: 'random' },
};

export const DECAL_TYPE_NAMES = Object.freeze(Object.keys(DECAL_TYPES));

/* ------------------------------------------------------------------ *
 *  procedural atlas
 * ------------------------------------------------------------------ *
 *  RGB carries a BRIGHTNESS mask (dark core / lighter rim), alpha carries
 *  coverage. The shader multiplies the instance tint by the brightness mask, so a
 *  single greyscale atlas gives every decal an ashy rim for free.
 */

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

  return cvs;
}

function rsymR(R) { return R() * 2 - 1; }

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

    // t.r is a brightness mask: dark core, ashy rim
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
   * @param {object} [opts] {size, alpha, color, life, angle, dir, aspect, jitter}
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
    // stretches, and the axis the skid streaks run along) is pointed at `dir`.
    _quat.setFromUnitVectors(_up, _nrm);
    let roll;
    if (def.roll === 'aligned' && typeof opts.angle === 'number') {
      roll = opts.angle;
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
      }
    } else {
      roll = rnd() * Math.PI * 2;
    }
    _roll.setFromAxisAngle(_up, roll);
    _quat.multiply(_roll);

    const jitter = typeof opts.jitter === 'number' ? opts.jitter : 0;
    _pos.addScaledVector(_nrm, this.lift);
    if (jitter > 0) {
      _pos.x += rsym() * jitter;
      _pos.z += rsym() * jitter;
    }

    _scl.set(size * 2, size * 2 * aspect, 1);
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

  scorch(pos, normal, opts) { return this.add('scorch', pos, normal, opts); }
  scuff(pos, normal, opts) { return this.add('scuff', pos, normal, opts); }
  splat(pos, normal, opts) { return this.add('splat', pos, normal, opts); }
  crack(pos, normal, opts) { return this.add('crack', pos, normal, opts); }

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

  setOpacity(a) { if (this.material) this.material.uniforms.uOpacity.value = clamp(a, 0, 1); }
  setVisible(v) { if (this.mesh) this.mesh.visible = !!v; }

  /** wipe every decal (stage change) */
  clear() {
    this.count = 0;
    if (this.mesh) this.mesh.count = 0;
  }

  get live() { return this.count; }

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

export default Decals;
