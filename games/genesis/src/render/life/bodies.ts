// GENESIS — instanced animated bodies (shared by render/life/crowds.ts and render/life/animals.ts): one InstancedMesh
// per (body mesh, LOD) with the per-instance attributes the body material poses and paints from (bodymat.ts):
//   instanceMatrix (body frame: radial up, heading, size), iAnim (state A, state B, blend, phase), iColA / iColB /
//   iColC (cloth or wool, skin or coat, hair or belly — linear RGB), iStyle (style bits, tool, cadence, flags).
// Buckets grow by doubling; the CPU writes only what moved.

import {
  DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, type IUniform, type ShaderMaterial,
  type MeshStandardMaterial,
} from 'three';
import type { BodyMesh } from '../gen/bodygen.ts';
import { makeBodyDepthMaterial, makeBodyMaterial, type BodyMaterialOpts } from './bodymat.ts';

export interface BodyBucket {
  key: string;
  mesh: InstancedMesh;
  material: MeshStandardMaterial;
  depth: ShaderMaterial;
  anim: InstancedBufferAttribute;
  colA: InstancedBufferAttribute;
  colB: InstancedBufferAttribute;
  colC: InstancedBufferAttribute;
  style: InstancedBufferAttribute;
  /** LOD cross-fade (bodymat.ts iFade), stored as 1 − f (0 = whole); f ≥ 0 keeps the dither below f, f < 0 the dither at or above 1 + f */
  fade: InstancedBufferAttribute;
  count: number;
  cap: number;
  /** cast shadows from this bucket (near LODs) */
  shadows: boolean;
}

const _m = new Matrix4();

export class BodyBuckets {
  readonly group = new Group();
  private buckets = new Map<string, BodyBucket>();
  private shared: Record<string, IUniform>;
  readonly animTime: IUniform<number> = { value: 0 };
  private castShadows = false;

  constructor(shared: Record<string, IUniform>, name: string) {
    this.shared = shared;
    this.group.name = name;
    this.group.matrixAutoUpdate = false;
  }

  /** the bucket for a mesh key (built on first use by `make`) */
  get(key: string, make: () => { body: BodyMesh; opts: BodyMaterialOpts; shadows: boolean }): BodyBucket {
    let b = this.buckets.get(key);
    if (b) return b;
    const { body, opts, shadows } = make();
    const material = makeBodyMaterial(this.shared, this.animTime, opts);
    const depth = makeBodyDepthMaterial(this.animTime, opts);
    b = this.alloc(key, body, material, depth, 32, shadows);
    this.buckets.set(key, b);
    return b;
  }

  private alloc(key: string, body: BodyMesh, material: MeshStandardMaterial, depth: ShaderMaterial, cap: number, shadows: boolean): BodyBucket {
    const g = body.geo;
    const mk = (n: number, name: string) => {
      const a = new InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    const anim = mk(4, 'iAnim'), colA = mk(3, 'iColA'), colB = mk(3, 'iColB'), colC = mk(3, 'iColC'), style = mk(4, 'iStyle'), fade = mk(1, 'iFade');
    const mesh = new InstancedMesh(g, material, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    if (shadows && this.castShadows) mesh.layers.enable(1);
    this.group.add(mesh);
    return { key, mesh, material, depth, anim, colA, colB, colC, style, fade, count: 0, cap, shadows };
  }

  /** make room for one more instance; returns its index */
  push(b: BodyBucket): number {
    if (b.count >= b.cap) {
      const cap = b.cap * 2;
      this.group.remove(b.mesh);
      const old = b;
      const nb = this.alloc(b.key, { geo: b.mesh.geometry, rig: { plan: 0, pivots: [], parents: [] }, height: 1, verts: 0 }, b.material, b.depth, cap, b.shadows);
      // keep what was written this frame
      (nb.mesh.instanceMatrix.array as Float32Array).set(old.mesh.instanceMatrix.array as Float32Array);
      (nb.anim.array as Float32Array).set(old.anim.array as Float32Array);
      (nb.colA.array as Float32Array).set(old.colA.array as Float32Array);
      (nb.colB.array as Float32Array).set(old.colB.array as Float32Array);
      (nb.colC.array as Float32Array).set(old.colC.array as Float32Array);
      (nb.style.array as Float32Array).set(old.style.array as Float32Array);
      (nb.fade.array as Float32Array).set(old.fade.array as Float32Array);
      old.mesh.dispose();
      b.mesh = nb.mesh; b.anim = nb.anim; b.colA = nb.colA; b.colB = nb.colB; b.colC = nb.colC; b.style = nb.style; b.fade = nb.fade; b.cap = cap;
    }
    return b.count++;
  }

  /** write one instance */
  set(b: BodyBucket, i: number, m: ArrayLike<number>, anim: [number, number, number, number], a: ArrayLike<number>, bb: ArrayLike<number>, c: ArrayLike<number>, style: [number, number, number, number], fade = 1): void {
    b.fade.setX(i, 1 - fade);
    _m.fromArray(m as number[]);
    b.mesh.setMatrixAt(i, _m);
    b.anim.setXYZW(i, anim[0], anim[1], anim[2], anim[3]);
    b.colA.setXYZ(i, a[0], a[1], a[2]);
    b.colB.setXYZ(i, bb[0], bb[1], bb[2]);
    b.colC.setXYZ(i, c[0], c[1], c[2]);
    b.style.setXYZW(i, style[0], style[1], style[2], style[3]);
  }

  begin(): void { for (const b of this.buckets.values()) b.count = 0; }

  end(): number {
    let n = 0;
    for (const b of this.buckets.values()) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      n += b.count;
      if (!b.count) continue;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.anim.needsUpdate = true; b.colA.needsUpdate = true; b.colB.needsUpdate = true; b.colC.needsUpdate = true; b.style.needsUpdate = true; b.fade.needsUpdate = true;
    }
    return n;
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.buckets.values()) if (b.shadows) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.buckets.values()) b.mesh.material = depth ? b.depth : b.material;
  }

  dispose(): void {
    for (const b of this.buckets.values()) { b.mesh.geometry.dispose(); b.mesh.dispose(); b.material.dispose(); b.depth.dispose(); }
    this.buckets.clear();
  }
}

/**
 * Column-major body-frame matrix for a body at unit direction (ux, uy, uz), standing `r` metres from the centre,
 * facing `heading` (rad from north toward east), uniformly scaled by `s`. Local +Z = forward, +Y = up, +X = left.
 */
export function bodyMatrix(out: Float32Array, ux: number, uy: number, uz: number, r: number, heading: number, s: number, pitch = 0): Float32Array {
  let ex = uz, ez = -ux;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
  const c = Math.cos(heading), sn = Math.sin(heading);
  let zx = nx * c + ex * sn, zy = ny * c, zz = nz * c + ez * sn;
  let yx = ux, yy = uy, yz = uz;
  if (pitch !== 0) {
    // nose up / down about the left axis (flyers climbing, divers)
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const nzx = zx * cp + ux * sp, nzy = zy * cp + uy * sp, nzz = zz * cp + uz * sp;
    yx = ux * cp - zx * sp; yy = uy * cp - zy * sp; yz = uz * cp - zz * sp;
    zx = nzx; zy = nzy; zz = nzz;
  }
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  out[0] = xx * s; out[1] = xy * s; out[2] = xz * s; out[3] = 0;
  out[4] = yx * s; out[5] = yy * s; out[6] = yz * s; out[7] = 0;
  out[8] = zx * s; out[9] = zy * s; out[10] = zz * s; out[11] = 0;
  out[12] = ux * r; out[13] = uy * r; out[14] = uz * r; out[15] = 1;
  return out;
}

/** packed 0xRRGGBB sRGB → linear into out */
export function unpackLinear(n: number, out: Float32Array | number[]): void {
  const f = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  out[0] = f((n >> 16) & 255); out[1] = f((n >> 8) & 255); out[2] = f(n & 255);
}
