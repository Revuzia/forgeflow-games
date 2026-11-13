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
//   --part-contrast mask.png:k  stretch the texels under a part mask round the part's median luma by k, hue kept (after
//                             the rest; closing CW5 r2 refix 2)
//   --part-lift mask.png:t:y  under a part mask, lift luma below t (0-1) by t x (v / t)^y, y < 1; above t unchanged
//   --part-tint mask.png:#hex:L:C[:k]  (MAX2 U1 material zoning) under a part mask, re-colour the painted texels in
//                             CIELAB: hue = the hex colour's hue angle, mean L* = L with each texel's own deviation from
//                             the part's mean kept x k (default 1), chroma C (scaled by the texel's own relative chroma,
//                             3/4 fixed + 1/4 its own). Absolute targets, so a second run lands on the same values.
//   --cyl cx,cy,r0,r1,z0,z1   (MAX2 U7) like --box, a ring round the vertical axis through (cx, cy): plan radius r0-r1,
//                             height z0-z1 (Blender axes, m; repeatable, a texel in any box or ring is in the mask)
//   --mask-out out.png        write the --box mask (texture size) as a PNG and stop (no grade; zone_grade.py combines it
//                             with the ORM roughness class for a fighter whose bake wrote no part map)
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
const cyls = args.flatMap((a, i) => (a === '--cyl' ? [args[i + 1].split(',').map(Number)] : []));
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
const POS = new Float32Array(W*H*4);
if (true) {
  mask = new Uint8Array(W * H);
  const inBox = (x, y, z) => boxes.some((b) => x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5])
    || cyls.some((c) => { const r = Math.hypot(x - c[0], y - c[1]); return r >= c[2] && r <= c[3] && z >= c[4] && z <= c[5]; });
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
            {const q=(y*W+x)*4; POS[q]=X;POS[q+1]=Y;POS[q+2]=Z;POS[q+3]=1;}
          }
        }
      }
    }
  }
}

import { writeFileSync } from 'node:fs';
writeFileSync(opt('--pos-out'), Buffer.from(POS.buffer));
console.log('pos', W, H);
