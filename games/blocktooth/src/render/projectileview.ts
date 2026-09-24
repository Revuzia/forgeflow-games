// BLOCKTOOTH — projectile view (CONTRACT §6, §6.1, §9, §10). combat-view lane.
//
// Every ProjectileKind is an InstancedMesh of a faceted, vertex-coloured low-poly body (ink
// outline on the solid ones), interpolated from px/py/pz → x/y/z with FrameInfo.alpha and
// oriented along its flight (lobbed shots pitch along their arc):
//   pellet      glowing orange orb + short streak            (CROSSING WARDEN / BULWARK)
//   volley      smaller yellow-orange rounds + longer streak (PICKET SQUAD 3-round volleys)
//   rocket      cream body, red nose, fins + tail flame + puffy smoke trail (HOPPER)
//   shell       brass slug + long tracer                      (TORTOISE)
//   mortar      olive finned round on its arc + thin smoke    (STILT MORTAR)
//   plate       riveted scrap plate tumbling on its arc       (IRON GULLY)
//   hookDrop    hazard-striped crane hook on a cable          (CAISSON-4)
//   seed        green spinning pods with a blossom tip        (BRIARWICK bloom turrets)
//   rubbleShot  tumbling faceted concrete chunks              (upgrades)
//   spark       twinkling pale star + streak                  (upgrades)
// Every projectile also casts a soft ground shadow blob (lobbed ones: it tightens and darkens as
// the round comes down, so the landing spot reads even without the painted telegraph).
//
// Glow is glare-bar safe (CONTRACT §6.1): unlit bodies at palette values ≤ 1, soft alpha-blended
// halos (alpha ≤ 0.55), NO bloom and no additive stacking. Readability at every rank: each kind
// has a minimum on-screen size (px) — the visual never shrinks below it as the camera pulls back
// from 17 m to 533 m (uPx = metres per CSS pixel at the look target, ∝ f.camDist).
//
// Performance: one InstancedMesh per kind (+ ink hull), one instanced draw each for streaks,
// halos, shadow blobs and smoke puffs; hidden when empty; no per-frame allocation.

import * as THREE from 'three';
import type { Projectile, ProjectileKind, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { CAMERA, CITY } from '../core/config.ts';
import { addOutline, bakeOutlineNormals, INK, makeToon } from './materials.ts';

// ─────────────────────────────── constants ───────────────────────────────
const K_VIEW = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
const KINDS: readonly ProjectileKind[] = [
  'pellet', 'volley', 'rocket', 'shell', 'mortar', 'plate', 'hookDrop',
  'seed', 'rubbleShot', 'spark',
];
const SHADOW_Y0 = 0.035;
const SHADOW_PULL0 = 0.28;
const SHADOW_PULL_PER_M = 0.002;

// ─────────────────────────────── faceted geometry builder ───────────────────────────────
// Winding is fixed BY CONSTRUCTION (doctrine §3): every triangle is flipped, if needed, so its
// face normal points away from the reference point of the convex part it belongs to.
const _c = new THREE.Color();
class Geo {
  pos: number[] = [];
  col: number[] = [];

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    color: THREE.Color, ox: number, oy: number, oz: number): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;          // degenerate
    const gx = (ax + bx + cx) / 3 - ox, gy = (ay + by + cy) / 3 - oy, gz = (az + bz + cz) / 3 - oz;
    const P = this.pos, C = this.col;
    if (nx * gx + ny * gy + nz * gz >= 0) P.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    else P.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    for (let i = 0; i < 3; i++) C.push(color.r, color.g, color.b);
  }

  /** surface of revolution around +Z. profile = [r, z] pairs from tail to nose. */
  lathe(profile: readonly number[], segs: number, color: (ring: number, seg: number) => string, roll = 0): void {
    for (let i = 0; i + 3 < profile.length; i += 2) {
      const r0 = profile[i], z0 = profile[i + 1], r1 = profile[i + 2], z1 = profile[i + 3];
      const zm = (z0 + z1) / 2;
      for (let j = 0; j < segs; j++) {
        const a0 = roll + (j / segs) * Math.PI * 2, a1 = roll + ((j + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        _c.set(color(i / 2, j));
        const col = _c.clone();
        if (r0 > 1e-6) this.tri(r0 * c0, r0 * s0, z0, r0 * c1, r0 * s1, z0, r1 * c1, r1 * s1, z1, col, 0, 0, zm);
        if (r1 > 1e-6) this.tri(r0 * c0, r0 * s0, z0, r1 * c1, r1 * s1, z1, r1 * c0, r1 * s0, z1, col, 0, 0, zm);
      }
    }
  }

  /** axis-aligned box (centre + half extents) */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: string): void {
    _c.set(color);
    const col = _c.clone();
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const q = (a: number[], b: number[], c: number[], d: number[]) => {
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col, cx, cy, cz);
      this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col, cx, cy, cz);
    };
    q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    q([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]);
    q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  }

  /** convex prism from 8 corners (bottom quad a0..a3, top quad b0..b3) around its own centre */
  hexa(v: readonly number[], color: string): void {
    _c.set(color);
    const col = _c.clone();
    let ox = 0, oy = 0, oz = 0;
    for (let i = 0; i < 8; i++) { ox += v[i * 3]; oy += v[i * 3 + 1]; oz += v[i * 3 + 2]; }
    ox /= 8; oy /= 8; oz /= 8;
    const P = (i: number) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    const q = (a: number, b: number, c: number, d: number) => {
      const A = P(a), B = P(b), C2 = P(c), D = P(d);
      this.tri(A[0], A[1], A[2], B[0], B[1], B[2], C2[0], C2[1], C2[2], col, ox, oy, oz);
      this.tri(A[0], A[1], A[2], C2[0], C2[1], C2[2], D[0], D[1], D[2], col, ox, oy, oz);
    };
    q(0, 1, 2, 3); q(4, 5, 6, 7); q(0, 1, 5, 4); q(1, 2, 6, 5); q(2, 3, 7, 6); q(3, 0, 4, 7);
  }

  /** jittered icosahedron around the origin (watertight: jitter keyed by vertex position) */
  rock(radius: number, detail: number, jitter: number, seed: number, color: (nx: number, ny: number, nz: number, i: number) => string): void {
    const src = new THREE.IcosahedronGeometry(1, detail);
    const p = src.getAttribute('position');
    const idx = src.index;
    const n = idx ? idx.count : p.count;
    const jit = new Map<string, number>();
    const V = (k: number, out: number[]) => {
      const vi = idx ? idx.getX(k) : k;
      const x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi);
      const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
      let s = jit.get(key);
      if (s === undefined) {
        const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
        s = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
        jit.set(key, s);
      }
      out[0] = x * s * radius; out[1] = y * s * radius; out[2] = z * s * radius;
    };
    const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0], c: number[] = [0, 0, 0];
    for (let k = 0; k + 2 < n; k += 3) {
      V(k, a); V(k + 1, b); V(k + 2, c);
      const gx = a[0] + b[0] + c[0], gy = a[1] + b[1] + c[1], gz = a[2] + b[2] + c[2];
      const gl = Math.hypot(gx, gy, gz) || 1;
      _c.set(color(gx / gl, gy / gl, gz / gl, k / 3));
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], _c.clone(), 0, 0, 0);
    }
    src.dispose();
  }

  build(outline: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();               // non-indexed → one normal per face (faceted)
    g.computeBoundingSphere();
    if (outline) bakeOutlineNormals(g);
    return g;
  }
}

// ─────────────────────────────── body geometries (unit scale, facing +Z) ───────────────────────────────
function orbGeo(hi: string, lo: string): THREE.BufferGeometry {
  const g = new Geo();
  g.rock(1, 1, 0, 1, (nx, ny) => (ny > 0.25 ? hi : lo));
  return g.build(true);
}

function rocketGeo(): THREE.BufferGeometry {
  const g = new Geo();
  // length 1 (z −0.5 … 0.5), radius 0.12
  g.lathe([0, -0.5, 0.09, -0.5, 0.12, -0.44, 0.12, -0.3, 0.12, 0.2, 0.1, 0.3, 0.055, 0.42, 0, 0.5], 8,
    (ring) => (ring <= 1 ? '#3f454c' : ring === 2 ? '#ffd166' : ring === 3 ? '#e8e2d0' : '#e84a3c'));
  for (let k = 0; k < 4; k++) {
    const ax = k % 2 === 0 ? 1 : 0, ay = k % 2 === 0 ? 0 : 1, sg = k < 2 ? 1 : -1;
    g.box(ax * sg * 0.19, ay * sg * 0.19, -0.38, ax ? 0.075 : 0.012, ay ? 0.075 : 0.012, 0.11, '#3f454c');
  }
  return g.build(true);
}

function flameGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.lathe([0, -0.95, 0.07, -0.72, 0.09, -0.56, 0, -0.5], 6, (ring) => (ring === 0 ? '#ff7a2e' : ring === 1 ? '#ffb347' : '#fff1a8'));
  return g.build(false);
}

function shellGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.lathe([0, -0.5, 0.15, -0.5, 0.16, -0.38, 0.16, 0.1, 0.12, 0.3, 0.06, 0.43, 0, 0.5], 8,
    (ring) => (ring <= 1 ? '#b8753a' : ring === 2 ? '#e0b050' : '#f0d27a'));
  return g.build(true);
}

function mortarGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.lathe([0, -0.5, 0.1, -0.5, 0.17, -0.38, 0.25, -0.15, 0.27, 0.05, 0.24, 0.22, 0.15, 0.38, 0, 0.5], 8,
    (ring) => (ring <= 1 ? '#2f3a28' : ring === 3 ? '#ffd166' : '#56673f'));
  for (let k = 0; k < 4; k++) {
    const ax = k % 2 === 0 ? 1 : 0, ay = k % 2 === 0 ? 0 : 1, sg = k < 2 ? 1 : -1;
    g.box(ax * sg * 0.2, ay * sg * 0.2, -0.4, ax ? 0.09 : 0.015, ay ? 0.09 : 0.015, 0.1, '#2f3a28');
  }
  return g.build(true);
}

function plateGeo(): THREE.BufferGeometry {
  const g = new Geo();
  // irregular riveted plate in XZ (≈ 2 m across at unit scale), thickness 0.12 along Y
  const N = 7;
  const rad = [1.0, 0.86, 0.97, 0.8, 0.93, 0.84, 0.95];
  const top: number[] = [], bot: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.2;
    top.push(Math.sin(a) * rad[i], 0.06, Math.cos(a) * rad[i]);
    bot.push(Math.sin(a) * rad[i], -0.06, Math.cos(a) * rad[i]);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const rust = i === 2 || i === 3;
    _c.set(rust ? '#9c5a3c' : '#c7ccd1'); const ct = _c.clone();
    _c.set('#8e969e'); const cb = _c.clone();
    _c.set(i % 2 ? '#eef2f6' : '#a9b1b8'); const ce = _c.clone();
    g.tri(0, 0.06, 0, top[i * 3], top[i * 3 + 1], top[i * 3 + 2], top[j * 3], top[j * 3 + 1], top[j * 3 + 2], ct, 0, 0, 0);
    g.tri(0, -0.06, 0, bot[i * 3], bot[i * 3 + 1], bot[i * 3 + 2], bot[j * 3], bot[j * 3 + 1], bot[j * 3 + 2], cb, 0, 0, 0);
    g.tri(top[i * 3], top[i * 3 + 1], top[i * 3 + 2], bot[i * 3], bot[i * 3 + 1], bot[i * 3 + 2], bot[j * 3], bot[j * 3 + 1], bot[j * 3 + 2], ce, 0, 0, 0);
    g.tri(top[i * 3], top[i * 3 + 1], top[i * 3 + 2], bot[j * 3], bot[j * 3 + 1], bot[j * 3 + 2], top[j * 3], top[j * 3 + 1], top[j * 3 + 2], ce, 0, 0, 0);
  }
  // rivets + a weld seam
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.2 + 0.45;
    g.box(Math.sin(a) * 0.68, 0.085, Math.cos(a) * 0.68, 0.05, 0.03, 0.05, '#5d6670');
  }
  g.box(0, 0.075, 0.05, 0.6, 0.018, 0.035, '#7d858d');
  return g.build(true);
}

function hookGeo(): THREE.BufferGeometry {
  const g = new Geo();
  // unit height, tip at y ≈ 0, hook plane = XY (faces +Z; the view turns it toward the camera)
  // pulley block: hazard-striped yellow / ink bands with steel cheek plates
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const y0 = 0.66 + (i / bands) * 0.34, y1 = 0.66 + ((i + 1) / bands) * 0.34;
    g.box(0, (y0 + y1) / 2, 0, 0.26, (y1 - y0) / 2, 0.15, i % 2 ? '#1e242e' : '#ffc83d');
  }
  g.box(0.285, 0.83, 0, 0.025, 0.15, 0.12, '#7d858d');
  g.box(-0.285, 0.83, 0, 0.025, 0.15, 0.12, '#7d858d');
  g.box(0, 0.83, 0.165, 0.07, 0.07, 0.02, '#aab4bc');
  // shank
  g.box(0, 0.44, 0, 0.055, 0.23, 0.055, '#aab4bc');
  // the C: square section swept round a circle (centre (0.16, 0.2), radius 0.16) from the shank foot
  const cx = 0.16, cy = 0.2, R = 0.16, th = 0.062;
  const a0 = Math.PI, a1 = Math.PI * 2 + 0.6;
  const segs = 8;
  const pt = (t: number, rOff: number, z: number) => [cx + Math.cos(t) * (R + rOff), cy + Math.sin(t) * (R + rOff), z];
  for (let s = 0; s < segs; s++) {
    const t0 = a0 + (a1 - a0) * (s / segs), t1 = a0 + (a1 - a0) * ((s + 1) / segs);
    const v: number[] = [];
    for (const c of [pt(t0, -th, -th), pt(t1, -th, -th), pt(t1, th, -th), pt(t0, th, -th),
      pt(t0, -th, th), pt(t1, -th, th), pt(t1, th, th), pt(t0, th, th)]) v.push(c[0], c[1], c[2]);
    g.hexa(v, s === segs - 1 ? '#ffc83d' : s % 2 ? '#9aa4ad' : '#b9c1c8');
  }
  // yellow safety latch from the tip back to the shank
  const tip = pt(a1, 0, 0);
  const lx0 = tip[0], ly0 = tip[1], lx1 = 0.05, ly1 = 0.36, lw = 0.018;
  const dx = lx1 - lx0, dy = ly1 - ly0, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl * lw, ny = dx / dl * lw;
  g.hexa([lx0 - nx, ly0 - ny, -0.03, lx1 - nx, ly1 - ny, -0.03, lx1 + nx, ly1 + ny, -0.03, lx0 + nx, ly0 + ny, -0.03,
    lx0 - nx, ly0 - ny, 0.03, lx1 - nx, ly1 - ny, 0.03, lx1 + nx, ly1 + ny, 0.03, lx0 + nx, ly0 + ny, 0.03], '#ffc83d');
  return g.build(true);
}

function seedGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.lathe([0, -0.5, 0.13, -0.4, 0.28, -0.12, 0.3, 0.05, 0.24, 0.25, 0.12, 0.4, 0, 0.5], 6,
    (ring, seg) => (ring >= 5 ? '#ff9ec7' : ring === 4 ? '#f7a8c4' : seg % 2 ? '#6fbf3a' : '#a8e05a'));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const v: number[] = [];
    const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(a + 0.25), sp = Math.sin(a + 0.25);
    const pts = [[0.1 * ca, 0.1 * sa, -0.45], [0.36 * ca, 0.36 * sa, -0.52], [0.36 * cp, 0.36 * sp, -0.5], [0.1 * cp, 0.1 * sp, -0.42],
      [0.1 * ca, 0.1 * sa, -0.3], [0.3 * ca, 0.3 * sa, -0.38], [0.3 * cp, 0.3 * sp, -0.36], [0.1 * cp, 0.1 * sp, -0.28]];
    for (const p of pts) v.push(p[0], p[1], p[2]);
    g.hexa(v, '#3f7a2a');
  }
  return g.build(true);
}

function rubbleGeo(): THREE.BufferGeometry {
  const g = new Geo();
  const cols = ['#b9b2a3', '#9aa4ad', '#d9d2c3', '#8f8779', '#c9b79a'];
  g.rock(1, 0, 0.28, 7, (nx, ny, nz, i) => cols[(i * 7 + (ny > 0.3 ? 2 : 0)) % cols.length]);
  return g.build(true);
}

function sparkGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.lathe([0, -0.5, 0.2, 0, 0, 0.5], 4, (ring) => (ring === 0 ? '#fff6b0' : '#ffffff'));
  g.lathe([0, -0.28, 0.5, 0, 0, 0.28], 4, () => '#9ff6ff', Math.PI / 4);
  return g.build(false);
}

function puffGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.rock(1, 1, 0.12, 11, () => '#ffffff');
  return g.build(true);
}

function cableGeo(): THREE.BufferGeometry {
  const g = new Geo();
  // unit cylinder y 0..1, radius 1, 6 sides (lathe is around Z → build directly)
  const segs = 6;
  _c.set('#2a2f3a'); const col = _c.clone();
  for (let j = 0; j < segs; j++) {
    const a0 = (j / segs) * Math.PI * 2, a1 = ((j + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
    g.tri(x0, 0, z0, x1, 0, z1, x1, 1, z1, col, 0, 0.5, 0);
    g.tri(x0, 0, z0, x1, 1, z1, x0, 1, z0, col, 0, 0.5, 0);
  }
  return g.build(false);
}

// ─────────────────────────────── instanced quad batches (streaks / halos / shadows) ───────────────────────────────
class QuadBatch {
  readonly geo = new THREE.InstancedBufferGeometry();
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private readonly stride: number;
  private readonly names: readonly string[];
  cap: number;
  n = 0;

  constructor(mat: THREE.Material, names: readonly string[], cap: number, name: string, renderOrder: number) {
    this.names = names;
    this.stride = names.length * 4;
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
    this.geo.setIndex([0, 2, 1, 1, 2, 3]);
    this.geo.instanceCount = 0;
    this.cap = cap;
    this.data = new Float32Array(cap * this.stride);
    this.buf = this.bind(this.data);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  private bind(data: Float32Array): THREE.InstancedInterleavedBuffer {
    const ib = new THREE.InstancedInterleavedBuffer(data, this.stride, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.names.length; i++) this.geo.setAttribute(this.names[i], new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
    return ib;
  }

  begin(): void { this.n = 0; }
  /** float offset of a fresh instance, or −1 when full (the batch grows once per frame at most) */
  slot(): number {
    if (this.n >= this.cap) {
      const cap = this.cap * 2;
      const d = new Float32Array(cap * this.stride);
      d.set(this.data);
      this.geo.dispose();
      this.data = d;
      this.cap = cap;
      this.buf = this.bind(d);
    }
    return (this.n++) * this.stride;
  }
  get f(): Float32Array { return this.data; }
  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.n * this.stride);
      this.buf.needsUpdate = true;
    }
  }
  dispose(): void { this.geo.dispose(); }
}

const STREAK_VERT = /* glsl */ `
attribute vec4 iH;   // head xyz, head half-width (m)
attribute vec4 iT;   // tail xyz, tail half-width (m)
attribute vec4 iC;   // rgb, alpha
varying vec2 vQ;
varying vec4 vC;
void main() {
  vec4 h = viewMatrix * vec4(iH.xyz, 1.0);
  vec4 t = viewMatrix * vec4(iT.xyz, 1.0);
  vec2 d = t.xy - h.xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float a = position.x;
  float side = position.z * 2.0 - 1.0;
  vec4 p = mix(h, t, a);
  float wdt = mix(iH.w, iT.w, a);
  p.xy += n * wdt * side - d * iH.w * (1.0 - a) * 0.8;
  vQ = vec2(a, side);
  vC = iC;
  gl_Position = projectionMatrix * p;
}
`;
const STREAK_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vC;
void main() {
  float along = 1.0 - vQ.x;
  float across = 1.0 - vQ.y * vQ.y;
  float a = vC.a * pow(along, 1.4) * smoothstep(0.0, 0.35, across);
  if (a < 0.004) discard;
  vec3 col = mix(vC.rgb, vec3(1.0), 0.45 * along * along * across);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const HALO_VERT = /* glsl */ `
attribute vec4 iP;   // xyz, radius (m)
attribute vec4 iC;   // rgb, alpha
varying vec2 vQ;
varying vec4 vC;
void main() {
  vec4 v = viewMatrix * vec4(iP.xyz, 1.0);
  vQ = position.xz * 2.0 - 1.0;
  v.xy += vQ * iP.w;
  vC = iC;
  gl_Position = projectionMatrix * v;
}
`;
const HALO_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vC;
void main() {
  float r = length(vQ);
  if (r >= 1.0) discard;
  float k = 1.0 - r;
  float a = vC.a * k * k * (0.6 + 0.4 * k);
  vec3 col = mix(vC.rgb, vec3(1.0), 0.3 * k * k * k);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SHADOW_VERT = /* glsl */ `
attribute vec4 iS;   // x, z, radius, alpha
uniform float uY;
uniform float uPull;
varying vec2 vQ;
varying float vA;
void main() {
  vQ = position.xz * 2.0 - 1.0;
  vA = iS.w;
  // view-ray pull: same pixels, nearer depth (lies on curbs / sidewalks / water like the decals)
  vec4 mv = viewMatrix * vec4(iS.x + vQ.x * iS.z, uY, iS.y + vQ.y * iS.z, 1.0);
  float dl = max(length(mv.xyz), 1e-4);
  mv.xyz *= max(0.05, (dl - uPull) / dl);
  gl_Position = projectionMatrix * mv;
}
`;
const SHADOW_FRAG = /* glsl */ `
uniform vec3 uInk;
varying vec2 vQ;
varying float vA;
void main() {
  float r = length(vQ);
  if (r >= 1.0) discard;
  float a = vA * (1.0 - smoothstep(0.45, 1.0, r));
  gl_FragColor = vec4(uInk, a);
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────── per-kind look ───────────────────────────────
interface Look {
  /** physical body length (m) — elongated kinds; round kinds use it as diameter */
  len: number;
  /** minimum on-screen body length (CSS px) */
  minPx: number;
  /** body scale from Projectile.r (titan-owned kinds grow with the titan): len = max(len, r × this) */
  rMul: number;
  halo: string | null; haloK: number; haloA: number;
  streak: string | null; streakK: number; streakW: number; streakA: number;
  puff: 0 | 1 | 2;              // 0 none · 1 rocket smoke · 2 thin mortar smoke
  orient: 'vel' | 'upright' | 'tumble' | 'spin';
}
const LOOK: Record<ProjectileKind, Look> = {
  pellet:     { len: 0.6, minPx: 9, rMul: 0, halo: '#ffb347', haloK: 1.5, haloA: 0.5, streak: '#ff8a3d', streakK: 4.5, streakW: 0.36, streakA: 0.75, puff: 0, orient: 'vel' },
  volley:     { len: 0.5, minPx: 7, rMul: 0, halo: '#ffd166', haloK: 1.35, haloA: 0.45, streak: '#ffc84a', streakK: 6.5, streakW: 0.3, streakA: 0.8, puff: 0, orient: 'vel' },
  rocket:     { len: 1.4, minPx: 18, rMul: 0, halo: '#ffc86a', haloK: 0.32, haloA: 0.5, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 1, orient: 'vel' },
  shell:      { len: 0.9, minPx: 11, rMul: 0, halo: '#fff1a8', haloK: 0.55, haloA: 0.45, streak: '#fff1a8', streakK: 11, streakW: 0.12, streakA: 0.85, puff: 0, orient: 'vel' },
  mortar:     { len: 1.6, minPx: 15, rMul: 0, halo: null, haloK: 0, haloA: 0, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 2, orient: 'vel' },
  plate:      { len: 6.0, minPx: 20, rMul: 0, halo: null, haloK: 0, haloA: 0, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 0, orient: 'tumble' },
  hookDrop:   { len: 12, minPx: 26, rMul: 0, halo: null, haloK: 0, haloA: 0, streak: null, streakK: 0, streakW: 0, streakA: 0, puff: 0, orient: 'upright' },
  seed:       { len: 0.8, minPx: 10, rMul: 2.6, halo: '#d8ff7a', haloK: 0.6, haloA: 0.28, streak: '#a8e05a', streakK: 3, streakW: 0.22, streakA: 0.5, puff: 0, orient: 'spin' },
  rubbleShot: { len: 1.2, minPx: 11, rMul: 2.0, halo: null, haloK: 0, haloA: 0, streak: '#d9d2c3', streakK: 2.2, streakW: 0.3, streakA: 0.35, puff: 0, orient: 'tumble' },
  spark:      { len: 0.7, minPx: 9, rMul: 1.2, halo: '#9ff6ff', haloK: 1.3, haloA: 0.5, streak: '#dffcff', streakK: 5, streakW: 0.18, streakA: 0.75, puff: 0, orient: 'tumble' },
};

interface KindMesh { mesh: THREE.InstancedMesh; cap: number; n: number; }

interface TrailRec { x: number; y: number; z: number; seen: boolean; }

// ─────────────────────────────── the view ───────────────────────────────
export class ProjectileView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly kinds = new Map<ProjectileKind, KindMesh>();
  private readonly flame: KindMesh;
  private readonly cable: KindMesh;
  private readonly puffs: KindMesh;
  private readonly streaks: QuadBatch;
  private readonly halos: QuadBatch;
  private readonly shadows: QuadBatch;
  private readonly shadowMat: THREE.ShaderMaterial;
  private readonly trails = new Map<number, TrailRec>();
  private readonly trailPool: TrailRec[] = [];
  private readonly doomed: number[] = [];
  // smoke puff particle pool (SoA)
  private readonly puffCap = 384;
  private puffN = 0;
  private readonly pX = new Float32Array(384);
  private readonly pY = new Float32Array(384);
  private readonly pZ = new Float32Array(384);
  private readonly pBorn = new Float32Array(384);
  private readonly pLife = new Float32Array(384);
  private readonly pSize = new Float32Array(384);
  private readonly pRot = new Float32Array(384);
  private readonly pTint = new Uint8Array(384);
  private readonly puffTints: THREE.Color[] = [
    new THREE.Color('#f4f1ea'), new THREE.Color('#d8d4cc'),
  ];
  private mounted = false;
  private now = 0;

  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly col = new THREE.Color();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'view:projectiles';
    this.root.matrixAutoUpdate = false;

    const toon = makeToon({ vertexColors: true });
    const basic = new THREE.MeshBasicMaterial({ vertexColors: true });
    const puffMat = makeToon({ color: '#ffffff' });
    this.mats.push(toon, basic, puffMat);

    const big = CITY.maxProjectiles;
    const mk = (kind: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, outlinePx: number): KindMesh => {
      this.geos.push(geo);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.name = 'proj:' + kind;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.renderOrder = 2;
      if (outlinePx > 0) addOutline(mesh, outlinePx);
      this.root.add(mesh);
      return { mesh, cap, n: 0 };
    };
    this.kinds.set('pellet', mk('pellet', orbGeo('#ffb347', '#ff6a2e'), basic, big, 1.6));
    this.kinds.set('volley', mk('volley', orbGeo('#ffd166', '#ffa03a'), basic, big, 1.4));
    this.kinds.set('rocket', mk('rocket', rocketGeo(), toon, 160, 1.8));
    this.kinds.set('shell', mk('shell', shellGeo(), toon, 160, 1.6));
    this.kinds.set('mortar', mk('mortar', mortarGeo(), toon, 160, 1.8));
    this.kinds.set('plate', mk('plate', plateGeo(), toon, 64, 2.0));
    this.kinds.set('hookDrop', mk('hookDrop', hookGeo(), toon, 16, 2.2));
    this.kinds.set('seed', mk('seed', seedGeo(), toon, 200, 1.5));
    this.kinds.set('rubbleShot', mk('rubbleShot', rubbleGeo(), toon, 200, 1.6));
    this.kinds.set('spark', mk('spark', sparkGeo(), basic, 200, 0));
    this.flame = mk('flame', flameGeo(), basic, 160, 0);
    this.cable = mk('cable', cableGeo(), toon, 16, 0);
    const pm = mk('puff', puffGeo(), puffMat, this.puffCap, 1.3);
    pm.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.puffCap * 3), 3);
    pm.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.puffs = pm;

    const streakMat = new THREE.ShaderMaterial({
      name: 'projStreak', vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: true,
    });
    const haloMat = new THREE.ShaderMaterial({
      name: 'projHalo', vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: true,
    });
    this.shadowMat = new THREE.ShaderMaterial({
      name: 'projShadow', vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG,
      uniforms: { uY: { value: SHADOW_Y0 }, uPull: { value: SHADOW_PULL0 }, uInk: { value: new THREE.Color(INK) } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.mats.push(streakMat, haloMat, this.shadowMat);
    this.streaks = new QuadBatch(streakMat, ['iH', 'iT', 'iC'], 256, 'proj:streaks', 5);
    this.halos = new QuadBatch(haloMat, ['iP', 'iC'], 256, 'proj:halos', 6);
    this.shadows = new QuadBatch(this.shadowMat, ['iS'], 256, 'proj:shadows', 4);
    this.root.add(this.streaks.mesh, this.halos.mesh, this.shadows.mesh);
  }

  mount(_world: World): void {
    this.reset();
    if (!this.mounted) { this.ctx.scene.add(this.root); this.mounted = true; }
  }

  unmount(): void {
    this.reset();
    if (this.mounted) { this.ctx.scene.remove(this.root); this.mounted = false; }
  }

  /** release GPU resources (page teardown) */
  dispose(): void {
    this.unmount();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.streaks.dispose(); this.halos.dispose(); this.shadows.dispose();
  }

  private reset(): void {
    for (const r of this.trails.values()) this.trailPool.push(r);
    this.trails.clear();
    this.puffN = 0;
    for (const k of this.kinds.values()) { k.n = 0; k.mesh.count = 0; k.mesh.visible = false; }
    for (const k of [this.flame, this.cable, this.puffs]) { k.n = 0; k.mesh.count = 0; k.mesh.visible = false; }
    this.streaks.begin(); this.streaks.end();
    this.halos.begin(); this.halos.end();
    this.shadows.begin(); this.shadows.end();
  }

  update(w: World, f: FrameInfo): void {
    this.now = f.time;
    const cssH = Math.max(1, this.ctx.renderer.domElement.clientHeight || 720);
    const px = Math.max(1e-4, (f.camDist * K_VIEW) / cssH);
    const alpha = f.frozen ? 1 : Math.min(1, Math.max(0, f.alpha));
    this.shadowMat.uniforms.uY.value = SHADOW_Y0 + f.camDist * 0.00005;
    this.shadowMat.uniforms.uPull.value = SHADOW_PULL0 + f.camDist * SHADOW_PULL_PER_M;

    for (const k of this.kinds.values()) k.n = 0;
    this.flame.n = 0; this.cable.n = 0;
    this.streaks.begin(); this.halos.begin(); this.shadows.begin();
    for (const r of this.trails.values()) r.seen = false;

    const list = w.projectiles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive) continue;
      this.drawOne(p, alpha, px, f.time);
    }

    // retire trail records of vanished projectiles
    this.doomed.length = 0;
    for (const [id, r] of this.trails) if (!r.seen) this.doomed.push(id);
    for (let i = 0; i < this.doomed.length; i++) {
      const r = this.trails.get(this.doomed[i]);
      if (r) { this.trailPool.push(r); this.trails.delete(this.doomed[i]); }
    }

    this.stepPuffs(f.dt, px);

    for (const k of this.kinds.values()) this.commit(k);
    this.commit(this.flame); this.commit(this.cable);
    this.streaks.end(); this.halos.end(); this.shadows.end();
  }

  private commit(k: KindMesh): void {
    k.mesh.count = k.n;
    k.mesh.visible = k.n > 0;
    if (k.n > 0) {
      k.mesh.instanceMatrix.clearUpdateRanges();
      k.mesh.instanceMatrix.addUpdateRange(0, k.n * 16);
      k.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private drawOne(p: Projectile, alpha: number, px: number, time: number): void {
    const L = LOOK[p.kind];
    const km = this.kinds.get(p.kind);
    if (!L || !km) return;
    // interpolated position
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    const z = p.pz + (p.z - p.pz) * alpha;
    // flight direction: this tick's displacement (lobs pitch along the arc), else the velocity
    let dx = p.x - p.px, dy = p.y - p.py, dz = p.z - p.pz;
    let dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-5) { dx = p.vx; dy = p.vy; dz = p.vz; dl = Math.hypot(dx, dy, dz); }
    if (dl < 1e-5) { dx = 0; dy = -1; dz = 0; dl = 1; }
    dx /= dl; dy /= dl; dz /= dl;

    const phys = Math.max(L.len, L.rMul > 0 ? p.r * L.rMul : 0);
    const len = Math.max(phys, L.minPx * px);
    const seed = ((p.id * 2654435761) >>> 0) / 4294967296;

    // orientation
    this.dir.set(dx, dy, dz);
    switch (L.orient) {
      case 'vel':
        this.q.setFromUnitVectors(ProjectileView.Z, this.dir);
        if (p.kind === 'rocket' || p.kind === 'mortar') {
          this.q2.setFromAxisAngle(ProjectileView.Z, time * (p.kind === 'rocket' ? 5 : 2) + seed * 6.28);
          this.q.multiply(this.q2);
        }
        break;
      case 'spin':
        this.q.setFromUnitVectors(ProjectileView.Z, this.dir);
        this.q2.setFromAxisAngle(ProjectileView.Z, time * 14 + seed * 6.28);
        this.q.multiply(this.q2);
        break;
      case 'tumble': {
        const sp = p.kind === 'plate' ? 2.2 : 6;
        this.e.set(time * sp * (0.7 + seed) + seed * 9, time * sp * 0.6 + seed * 4, time * sp * (1.3 - seed) * 0.5);
        this.q.setFromEuler(this.e);
        if (p.kind === 'plate') {
          // mostly flat, wobbling like a thrown sheet
          this.e.set(Math.sin(time * 3 + seed * 6) * 0.5, time * 2.4 + seed * 6.28, Math.cos(time * 2.2 + seed * 5) * 0.35);
          this.q.setFromEuler(this.e);
        }
        break;
      }
      case 'upright':
        // hook plane square to the camera (yaw 45°: the view looks down −X−Z) + a pendulum swing
        this.q.setFromAxisAngle(this.s.set(0, 1, 0), (CAMERA.yawDeg * Math.PI) / 180);
        this.q2.setFromAxisAngle(ProjectileView.Z, Math.sin(time * 1.4 + seed * 6.28) * 0.09);
        this.q.multiply(this.q2);
        break;
    }

    // body transform (unit geometries: elongated ones span z −0.5…0.5; round ones radius 1)
    let sx: number, sy: number, sz: number;
    const round = p.kind === 'pellet' || p.kind === 'volley' || p.kind === 'rubbleShot';
    if (round) { sx = sy = sz = len * 0.5; }
    else if (p.kind === 'plate') { sx = sy = sz = len * 0.5; }
    else if (p.kind === 'hookDrop') { sx = sy = sz = len; }
    else if (p.kind === 'spark') { const tw = 0.8 + 0.35 * Math.sin(time * 40 + seed * 20); sx = sy = sz = len * tw; }
    else { sx = sy = sz = len; }
    // the crane hook's geometry has its tip at y = 0: it lands tip-first on the painted circle
    const by = p.kind === 'hookDrop' ? Math.max(0, y) : Math.max(0.05, y);
    this.v.set(x, by, z);
    this.s.set(sx, sy, sz);
    this.put(km, this.v, this.q, this.s);

    // rocket tail flame (same transform as the body, flickering length)
    if (p.kind === 'rocket') {
      const fl = 0.85 + 0.3 * Math.sin(time * 47 + seed * 30);
      this.s.set(len, len, len * fl);
      this.put(this.flame, this.v, this.q, this.s);
    }
    // crane hook cable up into the sky
    if (p.kind === 'hookDrop') {
      const top = this.v.y + len;
      const r = Math.max(0.35, 1.2 * px);
      this.q2.identity();
      this.v.set(x, top - len * 0.02, z);
      this.s.set(r, 400, r);
      this.put(this.cable, this.v, this.q2, this.s);
    }

    // streak behind the body
    if (L.streak) {
      const sl = Math.max(len * L.streakK, 12 * px);
      const hw = Math.max(len * L.streakW, 1.6 * px);
      const o = this.streaks.slot();
      const d = this.streaks.f;
      const hx = x + dx * len * 0.3, hy = y + dy * len * 0.3, hz = z + dz * len * 0.3;
      this.col.set(L.streak);
      d[o] = hx; d[o + 1] = hy; d[o + 2] = hz; d[o + 3] = hw;
      d[o + 4] = x - dx * sl; d[o + 5] = y - dy * sl; d[o + 6] = z - dz * sl; d[o + 7] = hw * 0.25;
      d[o + 8] = this.col.r; d[o + 9] = this.col.g; d[o + 10] = this.col.b; d[o + 11] = L.streakA;
    }
    // soft halo (glare-bar safe)
    if (L.halo) {
      const o = this.halos.slot();
      const d = this.halos.f;
      let hx = x, hy = y, hz = z;
      if (p.kind === 'rocket') { hx -= dx * len * 0.62; hy -= dy * len * 0.62; hz -= dz * len * 0.62; }
      this.col.set(L.halo);
      const flick = p.kind === 'rocket' ? 0.85 + 0.15 * Math.sin(time * 37 + seed * 11) : 1;
      d[o] = hx; d[o + 1] = hy; d[o + 2] = hz; d[o + 3] = Math.max(len * L.haloK, 4 * px) * flick;
      d[o + 4] = this.col.r; d[o + 5] = this.col.g; d[o + 6] = this.col.b; d[o + 7] = L.haloA;
    }
    // ground shadow blob: tight + dark when low, wide + faint when high
    {
      const o = this.shadows.slot();
      const d = this.shadows.f;
      const foot = p.kind === 'hookDrop' ? len * 0.35 : p.kind === 'plate' ? len * 0.5 : len * 0.42;
      const hgt = Math.max(0, p.kind === 'hookDrop' ? by : y);
      const spread = 1 + Math.min(2.5, hgt / Math.max(4, len * 6));
      d[o] = x; d[o + 1] = z; d[o + 2] = Math.max(foot * spread, 3 * px);
      d[o + 3] = 0.42 / spread;
    }
    // smoke puffs along the path (distance-spaced, so frozen shots emit nothing)
    if (L.puff !== 0) this.emitTrail(p, x, y, z, dx, dy, dz, len, L.puff);
  }

  private put(k: KindMesh, pos: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3): void {
    if (k.n >= k.cap) return;
    this.m4.compose(pos, q, s);
    this.m4.toArray(k.mesh.instanceMatrix.array as Float32Array, k.n * 16);
    k.n++;
  }

  private emitTrail(p: Projectile, x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, type: 1 | 2 | 3): void {
    let r = this.trails.get(p.id);
    // tail position
    const tx = x - dx * len * 0.55, ty = y - dy * len * 0.55, tz = z - dz * len * 0.55;
    if (!r) {
      r = this.trailPool.pop() ?? { x: 0, y: 0, z: 0, seen: false };
      r.x = tx; r.y = ty; r.z = tz;
      this.trails.set(p.id, r);
    }
    r.seen = true;
    const spacing = type === 1 ? len * 0.55 : type === 2 ? len * 0.9 : len * 0.9;
    let ddx = tx - r.x, ddy = ty - r.y, ddz = tz - r.z;
    let dist = Math.hypot(ddx, ddy, ddz);
    if (dist > spacing * 40) { r.x = tx; r.y = ty; r.z = tz; return; }   // teleport guard
    if (dist < spacing) return;
    ddx /= dist; ddy /= dist; ddz /= dist;
    const lvl = this.ctx.quality.level;
    const cap = lvl === 0 ? 128 : lvl === 1 ? 256 : this.puffCap;
    while (dist >= spacing) {
      r.x += ddx * spacing; r.y += ddy * spacing; r.z += ddz * spacing;
      dist -= spacing;
      if (this.puffN >= cap) continue;
      const i = this.puffN++;
      const j = Math.sin((p.id + this.puffN) * 91.7 + r.x) * 43758.5453;
      const rnd = j - Math.floor(j);
      const k2 = Math.sin((p.id * 7 + this.puffN) * 13.3) * 43758.5453;
      const rnd2 = k2 - Math.floor(k2);
      this.pX[i] = r.x + (rnd - 0.5) * len * 0.3;
      this.pY[i] = Math.max(0.1, r.y + (rnd2 - 0.5) * len * 0.2);
      this.pZ[i] = r.z + (rnd2 - 0.5) * len * 0.3;
      this.pBorn[i] = this.now;
      this.pLife[i] = type === 1 ? 0.8 + rnd * 0.5 : type === 2 ? 0.55 + rnd * 0.25 : 0.45 + rnd * 0.2;
      this.pSize[i] = len * (type === 1 ? 0.4 : type === 2 ? 0.26 : 0.26) * (0.65 + rnd2 * 0.7);
      this.pRot[i] = rnd * 6.28;
      this.pTint[i] = type === 2 ? 1 : (rnd < 0.5 ? 0 : 1);
    }
  }

  private stepPuffs(dt: number, px: number): void {
    const k = this.puffs;
    const now = this.now;
    let n = 0;
    const arr = k.mesh.instanceMatrix.array as Float32Array;
    const ic = k.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.puffN; i++) {
      const age = (now - this.pBorn[i]) / this.pLife[i];
      if (age >= 1 || age < 0) continue;
      // compact in place
      if (n !== i) {
        this.pX[n] = this.pX[i]; this.pY[n] = this.pY[i]; this.pZ[n] = this.pZ[i];
        this.pBorn[n] = this.pBorn[i]; this.pLife[n] = this.pLife[i]; this.pSize[n] = this.pSize[i];
        this.pRot[n] = this.pRot[i]; this.pTint[n] = this.pTint[i];
      }
      // grow fast, drift up, shrink away (comic puff: no alpha, ink-outlined)
      const grow = age < 0.25 ? 0.55 + 1.8 * age : 1 - Math.pow((age - 0.25) / 0.75, 1.6);
      const sc = Math.max(0.001, this.pSize[n] * Math.max(0.05, grow) * (1 + age * 1.5));
      const s = Math.max(sc, age < 0.8 ? 1.5 * px * (1 - age) : 0.001);
      this.pY[n] += dt * this.pSize[n] * 0.9;
      this.e.set(this.pRot[n], this.pRot[n] * 1.7 + age, 0);
      this.q.setFromEuler(this.e);
      this.v.set(this.pX[n], this.pY[n], this.pZ[n]);
      this.s.set(s, s * 0.9, s);
      this.m4.compose(this.v, this.q, this.s);
      this.m4.toArray(arr, n * 16);
      const tint = this.puffTints[this.pTint[n]];
      const shade = 1 - age * 0.25;
      ic[n * 3] = tint.r * shade; ic[n * 3 + 1] = tint.g * shade; ic[n * 3 + 2] = tint.b * shade;
      n++;
    }
    this.puffN = n;
    k.n = n;
    k.mesh.count = n;
    k.mesh.visible = n > 0;
    if (n > 0) {
      k.mesh.instanceMatrix.clearUpdateRanges();
      k.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      k.mesh.instanceMatrix.needsUpdate = true;
      const icA = k.mesh.instanceColor!;
      icA.clearUpdateRanges();
      icA.addUpdateRange(0, n * 3);
      icA.needsUpdate = true;
    }
  }

  /** instances drawn last frame per kind (debug / tests) */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of KINDS) out[k] = this.kinds.get(k)?.n ?? 0;
    out.puffs = this.puffN;
    return out;
  }
}
