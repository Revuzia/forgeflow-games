#!/usr/bin/env node
// VALE art: a surgical grade of the painted base colour of a shipped fighter GLB, in place, without a rebuild (closing
// CW5 refix 2). Geometry and clips stay untouched, only the base colour's WebP is re-encoded.
//
//   --box x0,y0,z0,x1,y1,z1   limit to texels whose rest position (Blender axes, m: +x his left, -y front, +z up) lies in
//                             the box (repeatable; none = every texel)
//   --recess g                inside the mask, texels below a reference luma (the mask's --ref-q percentile, default 50)
//                             darken by g x their distance under it (a recess stain, hue kept); the lit tops above stay
//   --dark-gain k --dark-l v  inside the mask, texels under display luma v (0-1) multiply toward k (smoothly, a value at
//                             v unchanged)
//   --q N                     the WebP quality of the new base colour (default 88)
//   --part-gain mask.png:g    multiply the texels under a part mask by g (repeatable; applied after the rest; masks from
//                             art/tools/partmap_mask.py, closing CW5 r2 refix: id-masked material steps)
//
//   node art/tools/glb_paint_grade.mjs art/out/fighters/burdam/burdam.glb --box 0.25,-0.4,1.45,0.8,0.4,2.15 --recess 0.6
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const input = args[0];
const boxes = args.flatMap((a, i) => (a === '--box' ? [args[i + 1].split(',').map(Number)] : []));
const recess = Number(opt('--recess', 0));
const darkK = Number(opt('--dark-gain', 1));
const darkL = Number(opt('--dark-l', 0));
const quality = Number(opt('--q', 88));
const refQ = Number(opt('--ref-q', 50)) / 100;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const before = statSync(input).size;

// the largest base colour texture: the body
let tex = null;
for (const m of root.listMaterials()) {
  const t = m.getBaseColorTexture();
  if (t && (!tex || t.getImage().byteLength > tex.getImage().byteLength)) tex = t;
}
if (!tex) throw new Error('no base colour texture');
const { data, info } = await sharp(tex.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const C = info.channels;

// the mask: rasterise each triangle of the primitives using this texture, testing its rest position
let mask = null;
if (boxes.length) {
  mask = new Uint8Array(W * H);
  const inBox = (x, y, z) => boxes.some((b) => x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5]);
  const skin = root.listSkins()[0];
  const joints = skin ? skin.listJoints() : [];
  const ibm = skin ? skin.getInverseBindMatrices() : null;
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  // at the bind pose world(joint) x IBM(joint) is one matrix for all joints: mesh space -> rest world
  const bindW = skin ? mul(joints[0].getWorldMatrix(), ibm.getElement(0, new Array(16).fill(0))) : null;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = bindW ?? node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getBaseColorTexture() !== tex) continue;
      const pos = prim.getAttribute('POSITION');
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const P = [];
      const T = [];
      for (let i = 0; i < pos.getCount(); i++) {
        const p = pos.getElement(i, [0, 0, 0]);
        // glTF is Y up, -Z forward of the Blender export: blender (x, y, z) = (x, -z, y)
        const wx = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12];
        const wy = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13];
        const wz = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14];
        P.push([wx, -wz, wy]);
        const t = uv.getElement(i, [0, 0]);
        T.push([t[0] * W, t[1] * H]);
      }
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        const [a, b, c] = idx ? [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)] : [i, i + 1, i + 2];
        const [ta, tb, tc] = [T[a], T[b], T[c]];
        const x0 = Math.max(0, Math.floor(Math.min(ta[0], tb[0], tc[0])));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(ta[0], tb[0], tc[0])));
        const y0 = Math.max(0, Math.floor(Math.min(ta[1], tb[1], tc[1])));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(ta[1], tb[1], tc[1])));
        const den = (tb[1] - tc[1]) * (ta[0] - tc[0]) + (tc[0] - tb[0]) * (ta[1] - tc[1]);
        if (Math.abs(den) < 1e-9) continue;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const gx = x + 0.5;
            const gy = y + 0.5;
            const w0 = ((tb[1] - tc[1]) * (gx - tc[0]) + (tc[0] - tb[0]) * (gy - tc[1])) / den;
            const w1 = ((tc[1] - ta[1]) * (gx - tc[0]) + (ta[0] - tc[0]) * (gy - tc[1])) / den;
            const w2 = 1 - w0 - w1;
            if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
            const X = w0 * P[a][0] + w1 * P[b][0] + w2 * P[c][0];
            const Y = w0 * P[a][1] + w1 * P[b][1] + w2 * P[c][1];
            const Z = w0 * P[a][2] + w1 * P[b][2] + w2 * P[c][2];
            if (inBox(X, Y, Z)) mask[y * W + x] = 1;
          }
        }
      }
    }
  }
}
const lum = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
const vals = [];
for (let p = 0; p < W * H; p++) if (!mask || mask[p]) vals.push(lum(p * C));
vals.sort((a, b) => a - b);
const med = vals[Math.min(vals.length - 1, Math.floor(vals.length * refQ))] ?? 0.5;
for (let p = 0; p < W * H; p++) {
  if (mask && !mask[p]) continue;
  const i = p * C;
  const v = lum(i);
  let g = 1;
  if (recess > 0 && v < med) g *= 1 - recess * (1 - v / med);
  if (darkL > 0 && v < darkL) g *= 1 - (1 - darkK) * (1 - v / darkL) ** 0.5;
  for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(data[i + c] * g)));
}
for (const spec of args.flatMap((a, i) => (a === '--part-gain' ? [args[i + 1]] : []))) {
  const k = spec.lastIndexOf(':');
  const g = Number(spec.slice(k + 1));
  const m = await sharp(spec.slice(0, k)).resize(W, H, { kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let p = 0; p < W * H; p++) {
    if (m.data[p * m.info.channels] < 128) continue;
    for (let c = 0; c < 3; c++) data[p * C + c] = Math.max(0, Math.min(255, Math.round(data[p * C + c] * g)));
  }
}
const old = tex.getImage().byteLength;
const webp = await sharp(data, { raw: { width: W, height: H, channels: C } }).webp({ quality }).toBuffer();
tex.setImage(new Uint8Array(webp));
tex.setMimeType('image/webp');
await io.write(input, doc);
console.log(`${input}: ${vals.length} of ${W * H} texels graded (reference luma ${med.toFixed(3)}), base colour ${(old / 1024).toFixed(1)} -> ${(webp.length / 1024).toFixed(1)} KiB, GLB ${(before / 1024).toFixed(1)} -> ${(statSync(input).size / 1024).toFixed(1)} KiB`);
