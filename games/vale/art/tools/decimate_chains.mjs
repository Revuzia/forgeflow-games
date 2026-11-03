#!/usr/bin/env node
// VALE art: thin the baked secondary-motion chain tracks (x_<chain>_<n> rotation channels) of a shipped GLB to every
// `--every`th key (the first and last kept), in place, without touching anything else (no texture re-encode, no
// re-quantize: the rotation outputs keep their component type and normalized flag; the decimated time accessors are
// shared per source accessor). Spring chains are smooth, so linear interpolation over 2 frames holds them; the
// bytes go back to the GLB budget (closing CW5: Burdam's four skirt panels pushed the GLB past 1172 KiB).
//
// --orm-q N also re-encodes the occlusion/roughness/metal texture (low-frequency data, WebP) at quality N.
//
//   node art/tools/decimate_chains.mjs art/out/fighters/burdam/burdam.glb [out.glb] [--every 2] [--prefix x_skirt]
//        [--orm-q 40]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--every', '--prefix', '--orm-q'].includes(args[i - 1])));
if (!files.length) {
  console.error('usage: node art/tools/decimate_chains.mjs in.glb [out.glb] [--every 2] [--prefix x_]');
  process.exit(2);
}
const [input, output = input] = files;
const every = Math.max(2, Number(opt('--every', 2)));
const prefix = opt('--prefix', 'x_');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const before = statSync(input).size;
const timeCache = new Map();
let tracks = 0;
let keysBefore = 0;
let keysAfter = 0;
const pick = (n) => {
  const idx = [];
  for (let i = 0; i < n; i += every) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
};
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node || !node.getName().startsWith(prefix) || ch.getTargetPath() !== 'rotation') continue;
    const s = ch.getSampler();
    if (s.getInterpolation() !== 'LINEAR') continue;
    const inp = s.getInput();
    const out = s.getOutput();
    const n = inp.getCount();
    if (n < 4) continue;
    const idx = pick(n);
    let ni = timeCache.get(inp);
    if (!ni) {
      const a = inp.getArray();
      const arr = new a.constructor(idx.length);
      idx.forEach((k, j) => { arr[j] = a[k]; });
      ni = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer);
      timeCache.set(inp, ni);
    }
    const o = out.getArray();
    const w = out.getElementSize();
    const arr = new o.constructor(idx.length * w);
    idx.forEach((k, j) => { for (let c = 0; c < w; c++) arr[j * w + c] = o[k * w + c]; });
    const no = doc.createAccessor().setType(out.getType()).setArray(arr).setNormalized(out.getNormalized())
      .setBuffer(buffer);
    s.setInput(ni).setOutput(no);
    tracks++;
    keysBefore += n;
    keysAfter += idx.length;
  }
}
const ormQ = opt('--orm-q', null);
if (ormQ) {
  const seen = new Set();
  for (const m of root.listMaterials()) {
    for (const t of [m.getOcclusionTexture(), m.getMetallicRoughnessTexture()]) {
      if (!t || seen.has(t) || t.getMimeType() !== 'image/webp') continue;
      seen.add(t);
      const b0 = t.getImage().byteLength;
      const img = await sharp(Buffer.from(t.getImage())).webp({ quality: Number(ormQ) }).toBuffer();
      t.setImage(new Uint8Array(img));
      console.log(`[decimate] ${t.getName()}: webp q${ormQ} ${(b0 / 1024).toFixed(1)} -> ${(img.byteLength / 1024).toFixed(1)} KiB`);
    }
  }
}
for (const a of root.listAccessors()) {           // drop the accessors nothing references any more
  if (a.listParents().every((p) => p === root)) a.dispose();
}
await io.write(output, doc);
const after = statSync(output).size;
console.log(`[decimate] ${tracks} ${prefix}* rotation tracks, keys ${keysBefore} -> ${keysAfter} (every ${every}); ` +
  `${(before / 1024).toFixed(1)} -> ${(after / 1024).toFixed(1)} KiB`);
