// GENESIS — a small articulated rig for the hero meshes (the god hand, the creatures): bones with a bind frame, local
// euler rotations posed on the CPU each frame (a few dozen bones, no allocation), and skinning matrices uploaded as a
// flat mat4 uniform array. The vertex shaders skin with RIG_SKIN_GLSL (four bones per vertex), so the skin, its shadow
// caster, its glow shell and fur shells all share one routine and one upload.
//
// Bind pose: every bone's local rotation is zero. A bone's frame has x lateral, y "dorsal" (up / the back of the
// hand), z along the bone (head → tail). Local rotation L = Ry(spread) · Rx(flex) · Rz(twist): positive flex turns the
// bone's z toward −y (fingers curl toward the palm, legs swing back under the body).

export type V3 = [number, number, number];

export interface RigBone {
  name: string;
  parent: number;
  head: V3;
  tail: V3;
  /** bind frame axes (orthonormal): x lateral, y dorsal, z along the bone */
  x: V3;
  y: V3;
  z: V3;
  /** typical flesh radius (skin weights) */
  r: number;
}

/** a bone along head → tail, its dorsal axis as near `up` as the bone allows */
export function bone(name: string, parent: number, head: V3, tail: V3, up: V3, r: number): RigBone {
  let zx = tail[0] - head[0], zy = tail[1] - head[1], zz = tail[2] - head[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  // y = up made perpendicular to z; x = y × z
  const d = up[0] * zx + up[1] * zy + up[2] * zz;
  let yx = up[0] - zx * d, yy = up[1] - zy * d, yz = up[2] - zz * d;
  let yl = Math.hypot(yx, yy, yz);
  if (yl < 1e-6) { yx = 0; yy = 0; yz = 1; yl = 1; }
  yx /= yl; yy /= yl; yz /= yl;
  const x: V3 = [yy * zz - yz * zy, yz * zx - yx * zz, yx * zy - yy * zx];
  return { name, parent, head: [...head], tail: [...tail], x, y: [yx, yy, yz], z: [zx, zy, zz], r };
}

export const RIG_SKIN_GLSL = /* glsl */ `
attribute vec4 aBoneIdx;
attribute vec4 aBoneW;
mat4 rigSkin() {
  return uBones[int(aBoneIdx.x)] * aBoneW.x + uBones[int(aBoneIdx.y)] * aBoneW.y
       + uBones[int(aBoneIdx.z)] * aBoneW.z + uBones[int(aBoneIdx.w)] * aBoneW.w;
}
`;

export class Rig {
  readonly bones: RigBone[];
  /** local eulers per bone: [flex (x), spread (y), twist (z)] */
  readonly rot: Float32Array;
  /** posed frames (3×3 column vectors x, y, z per bone) and heads, in mesh space */
  readonly frames: Float32Array;
  readonly heads: Float32Array;
  /** skinning matrices, 16 floats per bone, column-major (uniform upload) */
  readonly skin: Float32Array;
  /** root translation and rotation applied before everything (mesh space): a lift / tilt of the whole body */
  readonly rootT: V3 = [0, 0, 0];
  readonly rootR: V3 = [0, 0, 0];
  /** extra per-bone translation along its parent frame (stretch, squash, a lunging neck), mesh units */
  readonly shift: Float32Array;

  constructor(bones: RigBone[]) {
    this.bones = bones;
    const n = bones.length;
    this.rot = new Float32Array(n * 3);
    this.frames = new Float32Array(n * 9);
    this.heads = new Float32Array(n * 3);
    this.skin = new Float32Array(n * 16);
    this.shift = new Float32Array(n * 3);
    this.update();
  }

  get count(): number { return this.bones.length; }

  index(name: string): number {
    const i = this.bones.findIndex((b) => b.name === name);
    if (i < 0) throw new Error(`rig: no bone '${name}'`);
    return i;
  }

  set(i: number, flex: number, spread = 0, twist = 0): void {
    this.rot[i * 3] = flex; this.rot[i * 3 + 1] = spread; this.rot[i * 3 + 2] = twist;
  }

  reset(): void { this.rot.fill(0); this.shift.fill(0); this.rootT[0] = this.rootT[1] = this.rootT[2] = 0; this.rootR[0] = this.rootR[1] = this.rootR[2] = 0; }

  /** pose every bone (parents come before children in the list) and rebuild the skinning matrices */
  update(): void {
    const B = this.bones, F = this.frames, H = this.heads, S = this.skin;
    // the root rotation (mesh space): R = Ry · Rx · Rz of rootR
    const RR = _rr;
    eulerMat(this.rootR[0], this.rootR[1], this.rootR[2], RR);
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      // L in the bone's bind frame, then into mesh space: Rw = Fparent · Bparentᵀ · Bi · L (root: RR · Bi · L)
      eulerMat(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2], _l);
      // Bi as columns
      _b[0] = b.x[0]; _b[1] = b.x[1]; _b[2] = b.x[2];
      _b[3] = b.y[0]; _b[4] = b.y[1]; _b[5] = b.y[2];
      _b[6] = b.z[0]; _b[7] = b.z[1]; _b[8] = b.z[2];
      mul3(_b, _l, _bl);
      if (b.parent < 0) {
        mul3(RR, _bl, _rw);
        // head: the root's own head, moved by the root transform about the origin
        mulv3(RR, b.head[0], b.head[1], b.head[2], _v);
        H[i * 3] = _v[0] + this.rootT[0] + this.shift[i * 3];
        H[i * 3 + 1] = _v[1] + this.rootT[1] + this.shift[i * 3 + 1];
        H[i * 3 + 2] = _v[2] + this.rootT[2] + this.shift[i * 3 + 2];
      } else {
        const p = b.parent;
        const pb = B[p];
        // relative bind rotation Bpᵀ · Bi
        _bp[0] = pb.x[0]; _bp[1] = pb.x[1]; _bp[2] = pb.x[2];
        _bp[3] = pb.y[0]; _bp[4] = pb.y[1]; _bp[5] = pb.y[2];
        _bp[6] = pb.z[0]; _bp[7] = pb.z[1]; _bp[8] = pb.z[2];
        for (let k = 0; k < 9; k++) _fp[k] = F[p * 9 + k];
        // Fp · Bpᵀ
        mul3T(_fp, _bp, _t);
        mul3(_t, _bl, _rw);
        // head: parent head + (Fp · Bpᵀ) · (head − parent head) + shift (in the parent's posed frame)
        const dx = b.head[0] - pb.head[0] + this.shift[i * 3], dy = b.head[1] - pb.head[1] + this.shift[i * 3 + 1], dz = b.head[2] - pb.head[2] + this.shift[i * 3 + 2];
        mulv3(_t, dx, dy, dz, _v);
        H[i * 3] = H[p * 3] + _v[0]; H[i * 3 + 1] = H[p * 3 + 1] + _v[1]; H[i * 3 + 2] = H[p * 3 + 2] + _v[2];
      }
      for (let k = 0; k < 9; k++) F[i * 9 + k] = _rw[k];
      // skin = [Rw·Biᵀ | Hposed − Rw·Biᵀ·Hbind]
      mul3T(_rw, _b, _t);
      mulv3(_t, b.head[0], b.head[1], b.head[2], _v);
      const o = i * 16;
      S[o] = _t[0]; S[o + 1] = _t[1]; S[o + 2] = _t[2]; S[o + 3] = 0;
      S[o + 4] = _t[3]; S[o + 5] = _t[4]; S[o + 6] = _t[5]; S[o + 7] = 0;
      S[o + 8] = _t[6]; S[o + 9] = _t[7]; S[o + 10] = _t[8]; S[o + 11] = 0;
      S[o + 12] = H[i * 3] - _v[0]; S[o + 13] = H[i * 3 + 1] - _v[1]; S[o + 14] = H[i * 3 + 2] - _v[2]; S[o + 15] = 1;
    }
  }

  /** a bind-pose point carried by bone i to its posed place (mesh space) */
  carry(i: number, p: ArrayLike<number>, out: V3): V3 {
    const S = this.skin, o = i * 16;
    out[0] = S[o] * p[0] + S[o + 4] * p[1] + S[o + 8] * p[2] + S[o + 12];
    out[1] = S[o + 1] * p[0] + S[o + 5] * p[1] + S[o + 9] * p[2] + S[o + 13];
    out[2] = S[o + 2] * p[0] + S[o + 6] * p[1] + S[o + 10] * p[2] + S[o + 14];
    return out;
  }

  /** posed tail of bone i */
  tail(i: number, out: V3): V3 { return this.carry(i, this.bones[i].tail, out); }
  head(i: number, out: V3): V3 { out[0] = this.heads[i * 3]; out[1] = this.heads[i * 3 + 1]; out[2] = this.heads[i * 3 + 2]; return out; }
  /** posed axis k (0 x, 1 y, 2 z) of bone i */
  axis(i: number, k: number, out: V3): V3 { const F = this.frames, o = i * 9 + k * 3; out[0] = F[o]; out[1] = F[o + 1]; out[2] = F[o + 2]; return out; }
}

const _rr = new Float64Array(9), _l = new Float64Array(9), _b = new Float64Array(9), _bl = new Float64Array(9), _rw = new Float64Array(9);
const _bp = new Float64Array(9), _fp = new Float64Array(9), _t = new Float64Array(9);
const _v: V3 = [0, 0, 0];

/** column-major 3×3: Ry(y) · Rx(x) · Rz(z) */
function eulerMat(x: number, y: number, z: number, o: Float64Array): void {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // Rx · Rz
  // Rz = [cz -sz 0; sz cz 0; 0 0 1], Rx = [1 0 0; 0 cx -sx; 0 sx cx]
  const a00 = cz, a01 = -sz, a02 = 0;
  const a10 = cx * sz, a11 = cx * cz, a12 = -sx;
  const a20 = sx * sz, a21 = sx * cz, a22 = cx;
  // Ry · (Rx Rz), Ry = [cy 0 sy; 0 1 0; -sy 0 cy]
  const m00 = cy * a00 + sy * a20, m01 = cy * a01 + sy * a21, m02 = cy * a02 + sy * a22;
  const m10 = a10, m11 = a11, m12 = a12;
  const m20 = -sy * a00 + cy * a20, m21 = -sy * a01 + cy * a21, m22 = -sy * a02 + cy * a22;
  // column-major
  o[0] = m00; o[1] = m10; o[2] = m20;
  o[3] = m01; o[4] = m11; o[5] = m21;
  o[6] = m02; o[7] = m12; o[8] = m22;
}

/** o = a · b (column-major 3×3) */
function mul3(a: Float64Array, b: Float64Array, o: Float64Array): void {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  }
}
/** o = a · bᵀ */
function mul3T(a: Float64Array, b: Float64Array, o: Float64Array): void {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    o[c * 3 + r] = a[r] * b[c] + a[3 + r] * b[3 + c] + a[6 + r] * b[6 + c];
  }
}
function mulv3(m: Float64Array, x: number, y: number, z: number, o: V3): void {
  o[0] = m[0] * x + m[3] * y + m[6] * z;
  o[1] = m[1] * x + m[4] * y + m[7] * z;
  o[2] = m[2] * x + m[5] * y + m[8] * z;
}
