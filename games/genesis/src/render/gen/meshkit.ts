// GENESIS — the procedural mesh kit (CONTRACT.md §15.6, §20): a small geometry builder shared by the building,
// prop and body generators. No assets: every mesh is assembled from code out of boxes, slabs, tubes, cones, domes,
// lathes and free quads, each tagged with what the shaders need to draw a real surface on it.
//
// Vertex layout (KitBuilder.build):
//   position, normal  — local space, metres
//   color             — base albedo (linear)
//   uv                — metres in the face's own plane: walls (u along the wall, v = height, so courses line up across
//                       faces), slopes (u along the ridge, v up the slope), flats (x, z) — procedural bricks, tiles,
//                       planks, thatch and stones are laid out in it
//   aKit (vec4)       — x: surface code (catalog SURF), y: part (PART below), z: per-element seed 0..1 (each window,
//                       stone, plank run differs), w: baked ambient occlusion 0..1
// A transform stack (yaw about +Y, translation, uniform scale) places sub-assemblies.

import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';

/** what a face is, for the shaders: roofs hide during construction, glass glows at night, hot mouths emit */
export const PART = { wall: 0, roof: 1, glass: 2, door: 3, plinth: 4, hot: 5, trim: 6, frame: 7, lamp: 8, sail: 9, beacon: 10, prop: 11, lantern: 12 } as const;

export type V3 = [number, number, number];
type RGB = [number, number, number];

interface Xf { c: number; s: number; tx: number; ty: number; tz: number; k: number }

export class KitBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  kit: number[] = [];
  idx: number[] = [];
  private stack: Xf[] = [];
  private xf: Xf = { c: 1, s: 0, tx: 0, ty: 0, tz: 0, k: 1 };
  /** default seed for elements emitted without one */
  seed = 0;
  /** a vertex budget guard (LOD meshes stay small) */
  get vertexCount(): number { return this.pos.length / 3; }

  /** push a transform: rotate `yaw` about +Y, then scale `k`, then translate (in the current frame) */
  push(tx: number, ty: number, tz: number, yaw = 0, k = 1): void {
    this.stack.push(this.xf);
    const p = this.xf;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // compose: world = parent(rot_p(k_p * (t + rot(k * local))))
    const wx = p.tx + p.k * (p.c * tx + p.s * tz), wz = p.tz + p.k * (-p.s * tx + p.c * tz), wy = p.ty + p.k * ty;
    this.xf = { c: p.c * c - p.s * s, s: p.s * c + p.c * s, tx: wx, ty: wy, tz: wz, k: p.k * k };
  }
  pop(): void { this.xf = this.stack.pop() ?? { c: 1, s: 0, tx: 0, ty: 0, tz: 0, k: 1 }; }

  private tp(x: number, y: number, z: number): V3 {
    const f = this.xf;
    return [f.tx + f.k * (f.c * x + f.s * z), f.ty + f.k * y, f.tz + f.k * (-f.s * x + f.c * z)];
  }
  private tn(x: number, y: number, z: number): V3 {
    const f = this.xf;
    return [f.c * x + f.s * z, y, -f.s * x + f.c * z];
  }

  /** emit one vertex (local coordinates, transformed by the stack); uv derives from the face normal */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, surf: number, part: number, col: RGB, ao = 1, seed = this.seed, uvOverride?: [number, number]): number {
    const p = this.tp(x, y, z);
    const n = this.tn(nx, ny, nz);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(col[0], col[1], col[2]);
    let u: number, v: number;
    if (uvOverride) { u = uvOverride[0]; v = uvOverride[1]; }
    else if (Math.abs(n[1]) < 0.3) {
      // wall: u along the horizontal tangent, v = height
      const tl = Math.hypot(n[0], n[2]) || 1;
      u = (p[0] * -n[2] + p[2] * n[0]) / tl;
      v = p[1];
    } else if (Math.abs(n[1]) < 0.96) {
      // slope: u along the ridge (the horizontal tangent t), v up the slope (b = n × t points down-slope for an
      // upward-facing plane, so v = −p·b)
      let tx = -n[2], tz = n[0];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const bx = n[1] * tz, by = n[2] * tx - n[0] * tz, bz = -n[1] * tx;
      const bl = Math.hypot(bx, by, bz) || 1;
      u = p[0] * tx + p[2] * tz;
      v = -(p[0] * bx + p[1] * by + p[2] * bz) / bl;
    } else {
      u = p[0];
      v = p[2];
    }
    this.uv.push(u, v);
    this.kit.push(surf, part, seed, ao);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  /**
   * A flat quad a→b→c→d (counter-clockwise seen from the front). The normal is computed from the corners (flipped
   * when `flip`); `ao` per corner (or one value).
   */
  quad(a: V3, b: V3, c: V3, d: V3, surf: number, part: number, col: RGB, ao: number | [number, number, number, number] = 1, seed = this.seed): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    const A = typeof ao === 'number' ? [ao, ao, ao, ao] : ao;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, surf, part, col, A[0], seed);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, surf, part, col, A[1], seed);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, surf, part, col, A[2], seed);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, surf, part, col, A[3], seed);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** a flat triangle (CCW from the front) */
  triangle(a: V3, b: V3, c: V3, surf: number, part: number, col: RGB, ao = 1, seed = this.seed): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, surf, part, col, ao, seed);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, surf, part, col, ao, seed);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, surf, part, col, ao, seed);
    this.idx.push(i0, i1, i2);
  }

  /**
   * Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1]. `skip` names faces left out ('top','bottom','px','nx','pz','nz').
   * Ambient occlusion darkens the lower part of the sides (aoLow at y0 → aoHigh at y1).
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surf: number, part: number, col: RGB,
    opt: { skip?: string[]; aoLow?: number; aoHigh?: number; seed?: number; topSurf?: number; topCol?: RGB } = {}): void {
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
    const sk = opt.skip ?? [];
    const lo = opt.aoLow ?? 1, hi = opt.aoHigh ?? 1;
    const sd = opt.seed ?? this.seed;
    if (!sk.includes('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], surf, part, col, [lo, lo, hi, hi], sd);
    if (!sk.includes('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], surf, part, col, [lo, lo, hi, hi], sd);
    if (!sk.includes('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], surf, part, col, [lo, lo, hi, hi], sd);
    if (!sk.includes('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], surf, part, col, [lo, lo, hi, hi], sd);
    if (!sk.includes('top')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], opt.topSurf ?? surf, part, opt.topCol ?? col, hi, sd);
    if (!sk.includes('bottom')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], surf, part, col, lo * 0.6, sd);
  }

  /**
   * An oriented box between two points (a beam, a post, a rafter): square section `w`×`h` (w across, h "up" in the
   * plane containing the axis and +Y, or +X for vertical beams).
   */
  beam(a: V3, b: V3, w: number, h: number, surf: number, part: number, col: RGB, ao = 1, seed = this.seed): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return;
    const ax = dx / L, ay = dy / L, az = dz / L;
    // side = axis × up (or × X for vertical beams), up' = side × axis
    let sx = ay * 0 - az * 1, sy = az * 0 - ax * 0, sz = ax * 1 - ay * 0;
    if (Math.abs(ay) > 0.95) { sx = 0; sy = az; sz = -ay; }
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * az - sz * ay, uy = sz * ax - sx * az, uz = sx * ay - sy * ax;
    const hw = w / 2, hh = h / 2;
    const c = (p: V3, i: number, j: number): V3 => [p[0] + sx * hw * i + ux * hh * j, p[1] + sy * hw * i + uy * hh * j, p[2] + sz * hw * i + uz * hh * j];
    const a00 = c(a, -1, -1), a10 = c(a, 1, -1), a11 = c(a, 1, 1), a01 = c(a, -1, 1);
    const b00 = c(b, -1, -1), b10 = c(b, 1, -1), b11 = c(b, 1, 1), b01 = c(b, -1, 1);
    this.quad(a01, a11, b11, b01, surf, part, col, ao, seed); // top
    this.quad(a10, a00, b00, b10, surf, part, col, ao * 0.8, seed); // bottom
    this.quad(a11, a10, b10, b11, surf, part, col, ao, seed); // +side
    this.quad(a00, a01, b01, b00, surf, part, col, ao, seed); // -side
    this.quad(a00, a10, a11, a01, surf, part, col, ao, seed);
    this.quad(b10, b00, b01, b11, surf, part, col, ao, seed);
  }

  /**
   * A tapered tube / post along a polyline (rotation-minimising frame), `sides` around, radius per point. Caps the top
   * when `cap`. v of the uv runs along the length (bark, rope, poles).
   */
  tube(pts: V3[], radii: number[], sides: number, surf: number, part: number, col: RGB, opt: { cap?: boolean; ao0?: number; ao1?: number; seed?: number } = {}): void {
    const n = pts.length;
    if (n < 2) return;
    const sd = opt.seed ?? this.seed;
    const rings: number[][] = [];
    let ux = 0, uy = 0, uz = 0;
    let len = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = i < n - 1 ? pts[i + 1] : p, o = i > 0 ? pts[i - 1] : p;
      let dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      if (i === 0) {
        // any perpendicular
        if (Math.abs(dy) < 0.9) { ux = -dz; uy = 0; uz = dx; } else { ux = 1; uy = 0; uz = 0; }
      }
      const d0 = ux * dx + uy * dy + uz * dz;
      ux -= dx * d0; uy -= dy * d0; uz -= dz * d0;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
      if (i > 0) len += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
      const t = i / (n - 1);
      const ao = (opt.ao0 ?? 1) + ((opt.ao1 ?? 1) - (opt.ao0 ?? 1)) * t;
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
        const r = radii[i];
        ring.push(this.vert(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, surf, part, col, ao, sd, [(s / sides) * Math.PI * 2 * Math.max(r, 0.05), len]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s], d = rings[i + 1][s + 1];
        this.idx.push(a, b, d, a, d, c);
      }
    }
    if (opt.cap) {
      const p = pts[n - 1];
      const dx = p[0] - pts[n - 2][0], dy = p[1] - pts[n - 2][1], dz = p[2] - pts[n - 2][2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      const ci = this.vert(p[0], p[1], p[2], dx / dl, dy / dl, dz / dl, surf, part, col, opt.ao1 ?? 1, sd);
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const q = this.pos.slice(rings[n - 1][s] * 3, rings[n - 1][s] * 3 + 3);
        const lq = this.untransform(q);
        ring.push(this.vert(lq[0], lq[1], lq[2], dx / dl, dy / dl, dz / dl, surf, part, col, opt.ao1 ?? 1, sd));
      }
      for (let s = 0; s < sides; s++) this.idx.push(ci, ring[s], ring[s + 1]);
    }
  }

  /** inverse of the current transform for a point already emitted (used by caps that re-emit ring positions) */
  private untransform(p: number[]): V3 {
    const f = this.xf;
    const x = (p[0] - f.tx) / f.k, y = (p[1] - f.ty) / f.k, z = (p[2] - f.tz) / f.k;
    return [f.c * x - f.s * z, y, f.s * x + f.c * z];
  }

  /** vertical cylinder / frustum about (cx, cz) from y0 (radius r0) to y1 (radius r1); caps by flags */
  cylinder(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, surf: number, part: number, col: RGB,
    opt: { top?: boolean; bottom?: boolean; aoLow?: number; aoHigh?: number; seed?: number; topSurf?: number; topCol?: RGB; topPart?: number; arc?: [number, number] } = {}): void {
    const sd = opt.seed ?? this.seed;
    const lo = opt.aoLow ?? 1, hi = opt.aoHigh ?? 1;
    const a0 = opt.arc ? opt.arc[0] : 0, a1 = opt.arc ? opt.arc[1] : Math.PI * 2;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const base: number[] = [], top: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = a0 + ((a1 - a0) * s) / sides;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nl = Math.hypot(1, slope);
      const uvb: [number, number] = [a * Math.max(r0, 0.05), y0];
      const uvt: [number, number] = [a * Math.max(r0, 0.05), y1];
      base.push(this.vert(cx + ca * r0, y0, cz + sa * r0, ca / nl, slope / nl, sa / nl, surf, part, col, lo, sd, uvb));
      top.push(this.vert(cx + ca * r1, y1, cz + sa * r1, ca / nl, slope / nl, sa / nl, surf, part, col, hi, sd, uvt));
    }
    for (let s = 0; s < sides; s++) this.idx.push(base[s], top[s + 1], base[s + 1], base[s], top[s], top[s + 1]);
    if (opt.top && r1 > 1e-4) {
      const tc = opt.topCol ?? col, ts = opt.topSurf ?? surf, tp = opt.topPart ?? part;
      const c = this.vert(cx, y1, cz, 0, 1, 0, ts, tp, tc, hi, sd);
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = a0 + ((a1 - a0) * s) / sides;
        ring.push(this.vert(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, ts, tp, tc, hi, sd));
      }
      for (let s = 0; s < sides; s++) this.idx.push(c, ring[s + 1], ring[s]);
    }
    if (opt.bottom && r0 > 1e-4) {
      const c = this.vert(cx, y0, cz, 0, -1, 0, surf, part, col, lo * 0.6, sd);
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = a0 + ((a1 - a0) * s) / sides;
        ring.push(this.vert(cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0, 0, -1, 0, surf, part, col, lo * 0.6, sd));
      }
      for (let s = 0; s < sides; s++) this.idx.push(c, ring[s], ring[s + 1]);
    }
  }

  /**
   * A surface of revolution about the local +Y axis through (cx, cz): `prof` is a list of [radius, y] from bottom to
   * top (domes, onion domes, beehive kilns, bells, urns). Normals from the profile slope.
   */
  lathe(cx: number, cz: number, prof: [number, number][], sides: number, surf: number, part: number, col: RGB, aoLow = 1, aoHigh = 1, seed = this.seed): void {
    const rows: number[][] = [];
    const n = prof.length;
    let arc = 0;
    for (let i = 0; i < n; i++) {
      const [r, y] = prof[i];
      const p0 = prof[Math.max(0, i - 1)], p1 = prof[Math.min(n - 1, i + 1)];
      const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      // outward normal of the profile curve (dy, -dr) normalised
      let nr = dy, ny = -dr;
      const nl = Math.hypot(nr, ny) || 1;
      nr /= nl; ny /= nl;
      if (i > 0) arc += Math.hypot(r - prof[i - 1][0], y - prof[i - 1][1]);
      const ao = aoLow + (aoHigh - aoLow) * (i / Math.max(1, n - 1));
      const row: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        row.push(this.vert(cx + ca * r, y, cz + sa * r, ca * nr, ny, sa * nr, surf, part, col, ao, seed, [a * Math.max(prof[0][0], 0.3), arc]));
      }
      rows.push(row);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = rows[i][s], b = rows[i][s + 1], c = rows[i + 1][s], d = rows[i + 1][s + 1];
        this.idx.push(a, d, b, a, c, d);
      }
    }
  }

  /** a solid sloped slab (a roof plane with thickness): corners of the TOP face a→b→c→d (CCW from above) */
  slab(a: V3, b: V3, c: V3, d: V3, thick: number, surf: number, part: number, col: RGB, edgeSurf: number, edgeCol: RGB, ao = 1, seed = this.seed): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const off = (p: V3): V3 => [p[0] - nx * thick, p[1] - ny * thick, p[2] - nz * thick];
    const a2 = off(a), b2 = off(b), c2 = off(c), d2 = off(d);
    this.quad(a, b, c, d, surf, part, col, ao, seed);
    // underside (eaves seen from below: darker, plain boards)
    this.quad(b2, a2, d2, c2, edgeSurf, part, edgeCol, ao * 0.55, seed);
    // edges
    this.quad(a2, b2, b, a, edgeSurf, part, edgeCol, ao * 0.8, seed);
    this.quad(b2, c2, c, b, edgeSurf, part, edgeCol, ao * 0.8, seed);
    this.quad(c2, d2, d, c, edgeSurf, part, edgeCol, ao * 0.8, seed);
    this.quad(d2, a2, a, d, edgeSurf, part, edgeCol, ao * 0.8, seed);
  }

  /**
   * Push every vertex emitted since `from` out from the local +Y axis through (cx, cz) by `dr(angle, y)` metres (in the
   * current frame): hand-made irregularity on a lathe (a thatched cone's lumpy outline). dr must be periodic in angle.
   */
  jitterRadial(from: number, cx: number, cz: number, dr: (a: number, y: number) => number): void {
    const f = this.xf;
    for (let i = from; i < this.pos.length / 3; i++) {
      const l = this.untransform([this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]);
      const dx = l[0] - cx, dz = l[2] - cz;
      const r = Math.hypot(dx, dz);
      if (r < 1e-4) continue;
      const d = dr(Math.atan2(dz, dx), l[1]);
      const x = l[0] + (dx / r) * d, z = l[2] + (dz / r) * d;
      this.pos[i * 3] = f.tx + f.k * (f.c * x + f.s * z);
      this.pos[i * 3 + 2] = f.tz + f.k * (-f.s * x + f.c * z);
    }
  }

  /** overwrite the uv of every vertex of `part` emitted since `from` (pivots for animated parts: windmill sails) */
  setPartUv(part: number, u: number, v: number, from = 0): void {
    for (let i = from; i < this.pos.length / 3; i++) if (this.kit[i * 4 + 1] === part) { this.uv[i * 2] = u; this.uv[i * 2 + 1] = v; }
  }

  /** append another builder's geometry (already in final local coordinates) */
  merge(o: KitBuilder): void {
    const base = this.pos.length / 3;
    this.pos.push(...o.pos); this.nrm.push(...o.nrm); this.col.push(...o.col); this.uv.push(...o.uv); this.kit.push(...o.kit);
    for (const i of o.idx) this.idx.push(i + base);
  }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], this.pos[i + k]); max[k] = Math.max(max[k], this.pos[i + k]); }
    }
    return { min, max };
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aKit', new Float32BufferAttribute(this.kit, 4));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** linear RGB helpers */
export const rgb = (r: number, g: number, b: number): RGB => [r, g, b];
export const mulc = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
