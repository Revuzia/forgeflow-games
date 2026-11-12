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
if (args.includes('--mask-out')) {
  if (!mask) throw new Error('--mask-out needs --box');
  const g = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) g[p] = mask[p] ? 255 : 0;
  await sharp(g, { raw: { width: W, height: H, channels: 1 } }).png().toFile(opt('--mask-out'));
  console.log(`${opt('--mask-out')}: ${g.reduce((a, v) => a + (v ? 1 : 0), 0)} of ${W * H} texels in the box mask`);
  process.exit(0);
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
for (const spec of args.flatMap((a, i) => (a === '--part-contrast' ? [args[i + 1]] : []))) {
  const k = spec.lastIndexOf(':');
  const g = Number(spec.slice(k + 1));
  const m = await sharp(spec.slice(0, k)).resize(W, H, { kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const under = [];
  for (let p = 0; p < W * H; p++) if (m.data[p * m.info.channels] >= 128) under.push(lum(p * C));
  under.sort((a, b) => a - b);
  const mid = under[Math.floor(under.length / 2)] ?? 0.5;
  for (let p = 0; p < W * H; p++) {
    if (m.data[p * m.info.channels] < 128) continue;
    const v = lum(p * C);
    const r = v > 1e-4 ? (mid + (v - mid) * g) / v : 1;
    for (let c = 0; c < 3; c++) data[p * C + c] = Math.max(0, Math.min(255, Math.round(data[p * C + c] * r)));
  }
}
for (const spec of args.flatMap((a, i) => (a === '--part-lift' ? [args[i + 1]] : []))) {
  const [path, pivot, gamma] = spec.split(':');
  const t = Number(pivot);
  const m = await sharp(path).resize(W, H, { kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let p = 0; p < W * H; p++) {
    if (m.data[p * m.info.channels] < 128) continue;
    const v = lum(p * C);
    if (v >= t || v < 1e-4) continue;
    const r = (t * (v / t) ** Number(gamma)) / v;
    for (let c = 0; c < 3; c++) data[p * C + c] = Math.max(0, Math.min(255, Math.round(data[p * C + c] * r)));
  }
}
// sRGB <-> CIELAB (D65), for --part-tint
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const fL = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t) => (t > 6 / 29 ? t * t * t : (116 * t - 16) / (24389 / 27));
const toLab = (r, g, b) => {
  const R = lin(r), G = lin(g), B2 = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B2) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B2, z = (0.0193 * R + 0.1192 * G + 0.9505 * B2) / 1.08883;
  return [116 * fL(y) - 16, 500 * (fL(x) - fL(y)), 200 * (fL(y) - fL(z))];
};
const fromLab = (L, a, b) => {
  const fy = (L + 16) / 116, x = fi(fy + a / 500) * 0.95047, y = fi(fy), z = fi(fy - b / 200) * 1.08883;
  return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z].map((v) => gam(Math.max(0, Math.min(1, v))));
};
for (const spec of args.flatMap((a, i) => (a === '--part-tint' ? [args[i + 1]] : []))) {
  const [path, hex, Lt, Ct, kk] = spec.split(':');
  const k = kk === undefined ? 1 : Number(kk);
  const h = hex.replace('#', '');
  const sig = toLab(...[0, 2, 4].map((o) => parseInt(h.slice(o, o + 2), 16) / 255));
  const ang = Math.atan2(sig[2], sig[1]);
  const m = await sharp(path).resize(W, H, { kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const idx = [];
  for (let p = 0; p < W * H; p++) if (m.data[p * m.info.channels] >= 128) idx.push(p);
  if (!idx.length) { console.log(`${path}: empty mask`); continue; }
  const labs = idx.map((p) => toLab(data[p * C] / 255, data[p * C + 1] / 255, data[p * C + 2] / 255));
  const mL = labs.reduce((a, l) => a + l[0], 0) / labs.length;
  const mC = labs.reduce((a, l) => a + Math.hypot(l[1], l[2]), 0) / labs.length || 1;
  idx.forEach((p, j) => {
    const [L0, a0, b0] = labs[j];
    const L1 = Math.max(2, Math.min(95, Number(Lt) + (L0 - mL) * k));
    const C1 = Number(Ct) * (0.75 + 0.25 * Math.min(2, Math.hypot(a0, b0) / mC)) * Math.min(1, (L1 / Number(Lt)) ** 0.5);
    const rgb = fromLab(L1, C1 * Math.cos(ang), C1 * Math.sin(ang));
    for (let c = 0; c < 3; c++) data[p * C + c] = Math.round(rgb[c] * 255);
  });
  console.log(`${path}: ${idx.length} texels tinted ${hex} (mean L* ${mL.toFixed(1)} -> ${Lt}, chroma ${mC.toFixed(1)} -> ${Ct})`);
}
// --reserve-cap pct (MAX2 round 2, ruling 32): after the rest, bring every reserved hue band (tokens vfx.reservedHuesHSV,
// measured as art/tools/zone_grade.py reserved_pct: HSV hue in the band, saturation > 0.4, of the painted texels) to at
// most pct % of the albedo. The cheapest texels move first (those nearest the 0.4 line), so the visible change is the
// smallest that meets the cap. Per band, --reserve-mode band=edge|sat (default: every band edge):
//   edge  hue-shifted just outside the band's nearer edge (by --reserve-margin deg, default 4), saturation and value
//         kept (a harm-band brown turns a little redder or yellower and stays a brown of the same strength)
//   lo/hi as edge, always past the band's low (or high) edge (a harm brown turns redder, never gold)
//   sat   desaturated to --reserve-sat (default 0.30), hue and value kept
// The lossy WebP encode pulls some moved texels back, so zone_grade.py aims a few points under the cap and checks.
if (args.includes('--reserve-cap')) {
  const cap = Number(opt('--reserve-cap', 8)) / 100;
  const margin = Number(opt('--reserve-margin', 4));
  const modes = Object.fromEntries(args.flatMap((a, i) => (a === '--reserve-mode' ? [args[i + 1].split('=')] : [])));
  const bands = { harm: [28, 50], ally: [200, 225], heal: [125, 150], tritanAltRose: [340, 350] };
  const hsv = (p) => {
    const r = data[p * C], g = data[p * C + 1], b = data[p * C + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    // PIL quantises hue to 0-255 before zone_grade.py scales it to degrees: measure the same way
    return [Math.round((h / 360) * 255) / 255 * 360, mx ? d / mx : 0, mx];
  };
  let used = 0;
  for (let p = 0; p < W * H; p++) if (Math.max(data[p * C], data[p * C + 1], data[p * C + 2]) > 2) used++;
  for (const [name, [a, b]] of Object.entries(bands)) {
    const how = modes[name] ?? 'edge';
    const hit = [];
    for (let p = 0; p < W * H; p++) {
      const [h, s] = hsv(p);
      if (h >= a && h <= b && s > 0.4 && Math.max(data[p * C], data[p * C + 1], data[p * C + 2]) > 2) hit.push([p, s]);
    }
    const excess = hit.length - Math.floor(cap * used);
    if (excess <= 0) { console.log(`reserve-cap ${name}: ${(100 * hit.length / used).toFixed(2)} % (aim ${(100 * cap).toFixed(1)} %) kept`); continue; }
    hit.sort((x, y) => x[1] - y[1]);
    for (const [p] of hit.slice(0, excess)) {
      const [h, s, v] = hsv(p);
      const ns = how === 'sat' ? Number(opt('--reserve-sat', 0.3)) : s;
      const nh = how === 'sat' ? h : how === 'lo' ? (a - margin + 360) % 360 : how === 'hi' ? b + margin : (h < (a + b) / 2 ? a - margin + 360 : b + margin) % 360;
      // HSV -> RGB at the new hue / saturation, the value kept
      const c = v * ns, x = c * (1 - Math.abs(((nh / 60) % 2) - 1)), m = v - c;
      const [r1, g1, b1] = nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x];
      data[p * C] = Math.round(r1 + m); data[p * C + 1] = Math.round(g1 + m); data[p * C + 2] = Math.round(b1 + m);
    }
    console.log(`reserve-cap ${name}: ${(100 * hit.length / used).toFixed(2)} % -> ${(100 * (hit.length - excess) / used).toFixed(2)} % (${excess} texels, ${how})`);
  }
}
const old = tex.getImage().byteLength;
const webp =await sharp(data, { raw: { width: W, height: H, channels: C } }).webp({ quality }).toBuffer();
tex.setImage(new Uint8Array(webp));
tex.setMimeType('image/webp');
await io.write(input, doc);
console.log(`${input}: ${vals.length} of ${W * H} texels graded (reference luma ${med.toFixed(3)}), base colour ${(old / 1024).toFixed(1)} -> ${(webp.length / 1024).toFixed(1)} KiB, GLB ${(before / 1024).toFixed(1)} -> ${(statSync(input).size / 1024).toFixed(1)} KiB`);
