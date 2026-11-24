// Cheap "baked" lighting and volume effects, each family merged into ONE draw call per level area:
//   FxBuilder   - light pools painted onto nearby floors and walls (instead of real point lights),
//                 beacon beams, light shafts, heat haze, zone volumes and fan airflow. Per-element
//                 brightness is driven from JS through a small uniform array.
//                 Drawn with premultiplied alpha: by night these ADD light, by day (uDay 1) the
//                 ones that tell the player something - airflow, zone volumes, beacons - are painted
//                 as translucent colour instead, because added light does not show on a bright floor.
//   buildContactShadows - soft tinted strips where walls meet floors and under low overhangs.
// Neither touches the lit materials, so the cost is fill rate on a few transparent quads only.
// The quads are stored in three bands of importance so a quality tier can simply draw fewer of them
// (geometry.setDrawRange): [0] things that tell the player something (beacons, zone volumes, airflow),
// [1] light pools, [2] pure atmosphere (moonlight shafts, haze).

import * as THREE from '../../vendor/three.module.min.js';

export const FX = { SHAFT: 0, BEACON: 1, HAZE: 2, HEAT: 3, COLD: 4, WIND: 5, POOL: 6, CONTACT: 7 };
const MAX_DYN = 64;

const FX_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute vec4 aParam;      // kind, dyn index, p0, p1
  attribute vec3 aVec;        // pool: centre | wind: direction-free params
  attribute vec2 aUv;
  uniform float uDyn[${MAX_DYN}];
  varying vec3 vColor;
  varying vec4 vParam;
  varying vec3 vVec;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDepth;
  varying float vDyn;
  void main() {
    vColor = aColor; vParam = aParam; vVec = aVec; vUv = aUv;
    vDyn = uDyn[int(aParam.y + 0.5)];
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - w.xyz);
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FX_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec2 uFogNF;
  uniform float uDay;
  varying vec3 vColor;
  varying vec4 vParam;
  varying vec3 vVec;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDepth;
  varying float vDyn;
  void main() {
    if (vDyn <= 0.001) discard;
    float kind = vParam.x;
    // Pillars of light (moonlight shafts, beacons) are open tubes seen from outside: the far wall of the
    // tube is the near wall's mirror image, so draw the near one at double strength and skip the rest.
    if (kind < 1.5 && !gl_FrontFacing) discard;
    float a = 0.0;
    float soft = abs(dot(normalize(vNormal), vViewDir));
    if (kind < 0.5) {                       // moonlight shaft: soft edges, fades toward the floor, dust shimmer
      float edge = pow(soft, 1.6);
      float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
      float dust = 0.75 + 0.25 * sin(vWorld.x * 3.1 + uTime * 0.7) * sin(vWorld.y * 2.3 - uTime * 0.5 + vWorld.z * 1.7);
      a = edge * along * dust * 2.0;
    } else if (kind < 1.5) {                // beacon pillar: bright at the base, fades upward, slow pulse
      float edge = pow(soft, 2.2);
      float up = pow(1.0 - vUv.y, 1.7);
      float pulse = 0.8 + 0.2 * sin(uTime * 2.4 + vParam.z);
      float rings = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0);
      a = edge * up * pulse * rings * 2.0;
    } else if (kind < 2.5) {                // heat haze: wavy rising bands
      float x = vUv.x - 0.5;
      float side = 1.0 - smoothstep(0.2, 0.5, abs(x));
      float bands = 0.5 + 0.5 * sin(vUv.y * 18.0 - uTime * 4.0 + sin(vUv.x * 9.0 + uTime * 1.3) * 2.0);
      a = side * bands * smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
    } else if (kind < 4.5) {                // forced-state zone volume: strong at the floor, bands rise (heat) or fall (cold)
      float edge = 0.35 + 0.65 * pow(1.0 - soft, 1.5);
      float base = pow(1.0 - vUv.y, 2.0);
      float dir = kind < 3.5 ? -1.0 : 1.0;
      float bands = 0.55 + 0.45 * sin(vWorld.y * 5.0 + dir * uTime * 2.2 + sin(vWorld.x * 2.0 + vWorld.z * 1.7) * 1.2);
      a = edge * (0.25 + 0.75 * base) * bands;
    } else if (kind < 5.5) {                // fan airflow: chevrons marching downstream
      float x = vUv.x - 0.5;
      float side = 1.0 - smoothstep(0.25, 0.5, abs(x));
      float len = vParam.z, speed = vParam.w;
      float ch = fract(vUv.y * len * 0.8 - abs(x) * 0.9 - uTime * speed * 0.35);
      float mark = smoothstep(0.0, 0.05, ch) * (1.0 - smoothstep(0.2, 0.26, ch));       // drawn chevrons, crisp
      float ends = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
      a = side * mark * ends;
    } else if (kind < 6.5) {                // light pool: radial falloff, lambert toward the light
      vec3 L = vVec - vWorld;
      float d = length(L);
      float k = clamp(1.0 - d / vParam.z, 0.0, 1.0);
      float ndl = clamp(dot(normalize(vNormal), L / max(d, 1e-3)), 0.0, 1.0);
      a = k * k * (0.3 + 0.7 * ndl);
    } else {                                // contact shade (uv.x carries its strength): two flat tones, a painted shade and not a blur
      a = (smoothstep(0.0, 0.16, vUv.x) * 0.5 + smoothstep(0.42, 0.58, vUv.x) * 0.5) * 0.4;
      a *= 1.0 - smoothstep(uFogNF.x, uFogNF.y, vDepth);
      if (a < 0.004) discard;
      gl_FragColor = vec4(vColor * a, a);
      #include <colorspace_fragment>
      return;
    }
    float fogF = 1.0 - smoothstep(uFogNF.x, uFogNF.y, vDepth);
    // airflow chevrons, light shafts, zone volumes and haze right in front of the lens would be broad bands across
    // the picture (a gale tunnel, a frost shaft the camera stands in): they thin out within a few metres of it
    a *= vDyn * fogF * smoothstep(0.8, 4.5, vDepth);
    if (a < 0.002) discard;
    // how much of this is paint rather than light: airflow and zone volumes most, beacons some, pools and haze none
    float solid = (kind > 2.5 && kind < 5.5) ? 1.0 : (kind > 0.5 && kind < 1.5 ? 0.55 : 0.0);
    solid *= uDay;
    // callers give colours dimmed for adding; as paint, show the hue at full strength and let alpha carry the amount
    float inten = max(max(vColor.r, vColor.g), max(vColor.b, 1e-3));
    vec3 hue = vColor / inten;
    // (a volume is a veil, never a wall: what is inside it must stay in view)
    float al = min(clamp(a * inten * mix(1.0, 2.6, solid), 0.0, 1.0), (kind > 2.5 && kind < 4.5) ? 0.42 : 1.0);
    gl_FragColor = vec4(mix(vColor * a, hue * al, solid), al * solid);
    #include <colorspace_fragment>
  }`;

export class FxBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.par = []; this.vec = []; this.uv = []; this.idx = []; this.n = 0;
    this.dyn = new Float32Array(MAX_DYN).fill(1);
    this.nextDyn = 1;           // 0 = always on
  }

  /**
   * Reserve a brightness slot and return its index. Slot 0 is "always on". If a huge level runs
   * out, the last slot is shared by every latecomer (they then flicker together, nothing breaks).
   */
  slot(v = 1) { if (this.nextDyn >= MAX_DYN - 1) return MAX_DYN - 1; const i = this.nextDyn++; this.dyn[i] = v; return i; }

  _v(p, n, col, kind, dyn, p0, p1, vec, uv) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(col[0], col[1], col[2]);
    this.par.push(kind, dyn, p0, p1); this.vec.push(vec[0], vec[1], vec[2]); this.uv.push(uv[0], uv[1]);
    return this.n++;
  }

  quad(a, b, c, d, n, col, kind, dyn = 0, p0 = 0, p1 = 0, vec = ZERO, uvs = UV4) {
    const i = this._v(a, n, col, kind, dyn, p0, p1, vec, uvs[0]); this._v(b, n, col, kind, dyn, p0, p1, vec, uvs[1]);
    this._v(c, n, col, kind, dyn, p0, p1, vec, uvs[2]); this._v(d, n, col, kind, dyn, p0, p1, vec, uvs[3]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Open cylinder/frustum from base point along `axis` (unit) with radii r0 -> r1; uv.y 0 at base, 1 at top. */
  tube(base, axis, len, r0, r1, col, kind, dyn = 0, p0 = 0, seg = 10) {
    // build an orthonormal frame around the axis
    const ax = axis, t = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = ax[1] * t[2] - ax[2] * t[1], uy = ax[2] * t[0] - ax[0] * t[2], uz = ax[0] * t[1] - ax[1] * t[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ax[1] * uz - ax[2] * uy, vy = ax[2] * ux - ax[0] * uz, vz = ax[0] * uy - ax[1] * ux;
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      const b = [base[0] + nx * r0, base[1] + ny * r0, base[2] + nz * r0];
      const e = [base[0] + ax[0] * len + nx * r1, base[1] + ax[1] * len + ny * r1, base[2] + ax[2] * len + nz * r1];
      ring.push([b, e, [nx, ny, nz], i / seg]);
    }
    for (let i = 0; i < seg; i++) {
      const A = ring[i], B = ring[i + 1];
      const i0 = this._v(A[0], A[2], col, kind, dyn, p0, 0, ZERO, [A[3], 0]);
      this._v(B[0], B[2], col, kind, dyn, p0, 0, ZERO, [B[3], 0]);
      this._v(B[1], B[2], col, kind, dyn, p0, 0, ZERO, [B[3], 1]);
      this._v(A[1], A[2], col, kind, dyn, p0, 0, ZERO, [A[3], 1]);
      this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  }

  /** Two crossed vertical quads centred on (x, z) from y0 up `h` (haze), uv.x across, uv.y up. */
  crossed(x, y0, z, w, h, col, kind, dyn = 0, p0 = 0, p1 = 0) {
    const hw = w / 2;
    this.quad([x - hw, y0, z], [x + hw, y0, z], [x + hw, y0 + h, z], [x - hw, y0 + h, z], [0, 0, 1], col, kind, dyn, p0, p1, ZERO, UV4);
    this.quad([x, y0, z - hw], [x, y0, z + hw], [x, y0 + h, z + hw], [x, y0 + h, z - hw], [1, 0, 0], col, kind, dyn, p0, p1, ZERO, UV4);
  }

  /** Box volume (all six faces, normals outward). uv.y = height fraction. */
  volume(b, col, kind, dyn = 0) {
    const [x0, y0, z0, x1, y1, z1] = b, H = Math.max(1e-3, y1 - y0);
    const f = (y) => (y - y0) / H;
    const Q = (a, bb, c, d, n) => this.quad(a, bb, c, d, n, col, kind, dyn, 0, 0, ZERO, [[0, f(a[1])], [1, f(bb[1])], [1, f(c[1])], [0, f(d[1])]]);
    Q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    Q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    Q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    Q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    Q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  }

  /**
   * A light pool at `c` with radius `r`: copies the parts of nearby static faces that fall inside
   * its reach (clipped rectangles, lifted a hair off the surface). `blocks`: level block pieces.
   * `visible(x,y,z)` optionally rejects faces the light cannot see (a wall in between).
   */
  pool(c, r, col, blocks, dyn = 0, visible = null) {
    const [cx, cy, cz] = c, e = 0.012;
    const lo = [cx - r, cy - r, cz - r], hi = [cx + r, cy + r, cz + r];
    const clip = (a0, a1, l, h) => [Math.max(a0, l), Math.min(a1, h)];
    let faces = 0;
    for (const p of blocks) {
      const b = p.box;
      if (b[3] < lo[0] || b[0] > hi[0] || b[4] < lo[1] || b[1] > hi[1] || b[5] < lo[2] || b[2] > hi[2]) continue;
      // top face
      if (cy > b[4] + 0.05) {
        const [x0, x1] = clip(b[0], b[3], lo[0], hi[0]), [z0, z1] = clip(b[2], b[5], lo[2], hi[2]);
        if (x1 - x0 > 0.05 && z1 - z0 > 0.05) {
          const px = Math.max(x0, Math.min(x1, cx)), pz = Math.max(z0, Math.min(z1, cz)), y = b[4] + e;
          if (!visible || visible(px, y, pz)) {
            this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col, FX.POOL, dyn, r, 0, c);
            faces++;
          }
        }
      }
      // side faces that face the light
      const sides = [
        [0, b[0], -1], [0, b[3], 1], [2, b[2], -1], [2, b[5], 1],
      ];
      for (const [ax, at, sg] of sides) {
        if ((sg > 0 && c[ax] < at + 0.05) || (sg < 0 && c[ax] > at - 0.05)) continue;
        if (Math.abs(c[ax] - at) > r) continue;
        const o = ax === 0 ? 2 : 0;
        const [u0, u1] = clip(b[o], b[o + 3], lo[o], hi[o]), [y0, y1] = clip(b[1], b[4], lo[1], hi[1]);
        if (u1 - u0 < 0.05 || y1 - y0 < 0.05) continue;
        const pu = Math.max(u0, Math.min(u1, c[o])), py = Math.max(y0, Math.min(y1, cy)), w = at + sg * e;
        const P = (u, y) => (ax === 0 ? [w, y, u] : [u, y, w]);
        const pp = P(pu, py);
        if (visible && !visible(pp[0], pp[1], pp[2])) continue;
        const n = ax === 0 ? [sg, 0, 0] : [0, 0, sg];
        // wind so the face points along n
        const flip = (ax === 0) === (sg > 0);
        if (flip) this.quad(P(u1, y0), P(u0, y0), P(u0, y1), P(u1, y1), n, col, FX.POOL, dyn, r, 0, c);
        else this.quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1), n, col, FX.POOL, dyn, r, 0, c);
        faces++;
      }
    }
    return faces;
  }

  /**
   * Contact shades on the top of floor block F from the blocks in `near` that stand on it or hang low
   * over it (the film gaps): soft-stepped strips in `tint`, so contact and "you can squeeze under
   * here" both read. They ride in the pool band, so the low tier leaves them out.
   */
  contact(F, near, tint, width = 0.6) {
    const f = F.box, fy = f[4];
    if (f[3] - f[0] < 0.3 || f[5] - f[2] < 0.3) return;      // too thin to be a floor
    for (const B of near) {
      if (B === F) continue;
      const b = B.box, gap = b[1] - fy;
      const standing = Math.abs(gap) < 0.03 && b[4] - b[1] > 0.12;
      const overhang = gap >= 0.03 && gap < 0.75;
      if (!standing && !overhang) continue;
      if (b[0] - width > f[3] || b[3] + width < f[0] || b[2] - width > f[5] || b[5] + width < f[2]) continue;
      const a = overhang ? 0.75 * (1 - gap / 0.75) + 0.25 : 1;
      const dist = (x, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[2] - z, 0, z - b[5]));
      const al = (x, z) => a * Math.max(0, 1 - dist(x, z) / width);
      const xs = [b[0] - width, b[0], b[3], b[3] + width], zs = [b[2] - width, b[2], b[5], b[5] + width];
      const y = fy + 0.006;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === 1 && j === 1 && !overhang) continue;           // under the wall: hidden anyway
          const x0 = Math.max(xs[i], f[0]), x1 = Math.min(xs[i + 1], f[3]);
          const z0 = Math.max(zs[j], f[2]), z1 = Math.min(zs[j + 1], f[5]);
          if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
          const pts = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
          const cen = i === 1 && j === 1;
          this.quad(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], tint, FX.CONTACT, 0, 0, 0, ZERO, pts.map((q) => [cen ? a : al(q[0], q[2]), 0]));
        }
      }
    }
  }

  get empty() { return this.n === 0; }

  /** fog: [near, far] of the level's haze; day: 0..1, how much of the mesh is paint rather than added light. */
  build(fog = [30, 96], day = 0) {
    if (typeof fog === 'number') fog = [30, 96];
    const g = new THREE.BufferGeometry();
    // reorder the quads (6 indices each) by band
    const band = (k) => (k === FX.POOL || k === FX.CONTACT ? 1 : (k === FX.SHAFT || k === FX.HAZE) ? 2 : 0);
    const bands = [[], [], []];
    for (let q = 0; q < this.idx.length; q += 6) bands[band(this.par[this.idx[q] * 4])].push(...this.idx.slice(q, q + 6));
    const ordered = [...bands[0], ...bands[1], ...bands[2]];
    const ranges = [bands[0].length, bands[0].length + bands[1].length, ordered.length];     // index counts to draw: essential / + pools / all
    this.idx = ordered;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aParam', new THREE.Float32BufferAttribute(this.par, 4));
    g.setAttribute('aVec', new THREE.Float32BufferAttribute(this.vec, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFogNF: { value: new THREE.Vector2(fog[0], fog[1]) }, uDay: { value: day }, uDyn: { value: this.dyn } },
      vertexShader: FX_VERT, fragmentShader: FX_FRAG,
      transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      toneMapped: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 18;
    mesh.userData.fxRanges = ranges;
    return mesh;
  }
}

const ZERO = [0, 0, 0];
const UV4 = [[0, 0], [1, 0], [1, 1], [0, 1]];

// ---------------------------------------------------------------------------- contact shadows

const AO_VERT = /* glsl */`
  attribute float aShade;
  varying float vShade;
  varying float vDepth;
  void main() {
    vShade = aShade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const AO_FRAG = /* glsl */`
  precision mediump float;
  uniform vec2 uFogNF;
  uniform vec3 uTint;
  varying float vShade;
  varying float vDepth;
  void main() {
    // two flat tones with a soft step between them: a painted contact shade, not a blur
    float a = (smoothstep(0.0, 0.16, vShade) * 0.5 + smoothstep(0.42, 0.58, vShade) * 0.5) * (1.0 - smoothstep(uFogNF.x, uFogNF.y, vDepth));
    if (a < 0.004) discard;
    gl_FragColor = vec4(uTint, a * 0.42);
    #include <colorspace_fragment>
  }`;

/**
 * Soft darkening on floors where walls stand on them, and under low overhangs (the film gaps),
 * so contact and "you can squeeze under here" both read. One mesh, normal alpha blending.
 */
export function buildContactShadows(blocks, strength = 0.6, fog = [30, 96], tint = 0x143244, width = 0.6) {
  const pos = [], sh = [], idx = [];
  let n = 0;
  const quad = (pts, al) => {
    for (let k = 0; k < 4; k++) { pos.push(pts[k][0], pts[k][1], pts[k][2]); sh.push(al[k]); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  for (const F of blocks) {
    const f = F.box, fy = f[4];
    if (f[3] - f[0] < 0.3 || f[5] - f[2] < 0.3) continue;      // too thin to be a floor
    for (const B of blocks) {
      if (B === F) continue;
      const b = B.box;
      const gap = b[1] - fy;
      const standing = Math.abs(gap) < 0.03 && b[4] - b[1] > 0.12;
      const overhang = gap >= 0.03 && gap < 0.75;
      if (!standing && !overhang) continue;
      // footprint (expanded by the strip width) must touch the floor's top
      if (b[0] - width > f[3] || b[3] + width < f[0] || b[2] - width > f[5] || b[5] + width < f[2]) continue;
      const a = (overhang ? 0.75 * (1 - gap / 0.75) + 0.25 : 1);
      void strength;
      const dist = (x, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[2] - z, 0, z - b[5]));
      const al = (x, z) => a * Math.max(0, 1 - dist(x, z) / width);
      const xs = [b[0] - width, b[0], b[3], b[3] + width], zs = [b[2] - width, b[2], b[5], b[5] + width];
      const y = fy + 0.006;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === 1 && j === 1 && !overhang) continue;           // under the wall: hidden anyway
          const x0 = Math.max(xs[i], f[0]), x1 = Math.min(xs[i + 1], f[3]);
          const z0 = Math.max(zs[j], f[2]), z1 = Math.min(zs[j + 1], f[5]);
          if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
          const pts = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
          const cen = i === 1 && j === 1;
          quad(pts, pts.map((p) => (cen ? a : al(p[0], p[2]))));
        }
      }
    }
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(sh, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFogNF: { value: new THREE.Vector2(fog[0], fog[1]) }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: AO_VERT, fragmentShader: AO_FRAG,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    toneMapped: false, fog: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 3;
  return m;
}
