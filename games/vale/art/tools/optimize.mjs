#!/usr/bin/env node
// VALE art: post-process a Blender-exported GLB with gltf-transform (CONTRACT §12).
//
//   node art/tools/optimize.mjs in.glb [out.glb] [--quantize] [--webp] [--anim16] [--fighter]
//                                               [--normal-bits 10] [--q-base 80] [--q-normal 88] [--q-orm 72]
//
// Passes (everything three.js r186 GLTFLoader reads natively: no Draco/Meshopt/KTX2 decoders needed):
//   dedup      merge identical accessors / textures / materials
//   dropRest   remove animation channels that hold a node at its rest TRS for the whole clip
//              (three's AnimationMixer blends missing tracks toward the bind pose)
//   resample   drop redundant linear keyframes (tolerance 1e-4)
//   prune      remove anything left unreferenced
//   --quantize KHR_mesh_quantization (positions 14 bit, normals --normal-bits, uvs 12, weights 8)
//   --webp     EXT_texture_webp: every texture re-encoded as WebP with sharp (lossy; per-slot quality:
//              base colour --q-base, normal --q-normal, occlusion/roughness/metal --q-orm)
//   --anim16   rotation tracks stored as normalized SHORT (core glTF 2.0 allows it for rotations;
//              GLTFLoader de-normalizes) -> half the rotation bytes, error < 3e-5
//   --fighter  = --quantize --webp --anim16 (the fighter/skin default: budget <= 1.2 MB per GLB)
// EXT_mesh_gpu_instancing (maps) is preserved: every official extension is registered.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, textureCompress } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const valued = ['--normal-bits', '--q-base', '--q-normal', '--q-orm'];
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.includes(args[i - 1])));
const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
if (files.length < 1) {
  console.error('usage: node art/tools/optimize.mjs in.glb [out.glb] [--quantize] [--webp] [--anim16] [--fighter]');
  process.exit(2);
}
const [input, output = input] = files;
const fighter = flags.has('--fighter');
const doQuant = fighter || flags.has('--quantize');
const doWebp = fighter || flags.has('--webp');
const doAnim16 = fighter || flags.has('--anim16');

const EPS = 1e-5;
function dropRestTracks() {
  return (doc) => {
    let dropped = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        const node = ch.getTargetNode();
        const path = ch.getTargetPath();
        const sampler = ch.getSampler();
        if (!node || !sampler || path === 'weights') continue;
        const out = sampler.getOutput();
        if (!out) continue;
        const rest = path === 'translation' ? node.getTranslation()
          : path === 'rotation' ? node.getRotation() : node.getScale();
        const n = out.getCount();
        const el = [];
        let constant = true;
        for (let i = 0; i < n && constant; i++) {
          out.getElement(i, el);
          for (let k = 0; k < rest.length; k++) {
            // quaternions q and -q are the same rotation
            if (Math.abs(el[k] - rest[k]) > EPS) {
              if (path === 'rotation') {
                let same = true;
                for (let j = 0; j < 4; j++) if (Math.abs(-el[j] - rest[j]) > EPS) same = false;
                if (same) continue;
              }
              constant = false;
              break;
            }
          }
        }
        if (constant) {
          ch.dispose();
          if (sampler.listParents().filter((p) => p.propertyType !== 'Root').length <= 1) sampler.dispose();
          dropped++;
        }
      }
    }
    doc.getLogger().info(`dropRest: removed ${dropped} constant rest channels`);
    globalThis.__dropped = dropped;
  };
}

// rotation outputs -> normalized int16 (glTF 2.0 §3.11: rotation samplers may use normalized SHORT)
function rotations16() {
  return (doc) => {
    const done = new Set();
    let n = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        if (ch.getTargetPath() !== 'rotation') continue;
        const out = ch.getSampler()?.getOutput();
        if (!out || done.has(out) || out.getNormalized()) continue;
        const src = out.getArray();
        if (!(src instanceof Float32Array)) continue;
        // keep successive quaternions in one hemisphere, then quantize
        const q = new Int16Array(src.length);
        for (let i = 0; i < src.length; i += 4) {
          if (i >= 4) {
            const d = src[i] * src[i - 4] + src[i + 1] * src[i - 3] + src[i + 2] * src[i - 2] + src[i + 3] * src[i - 1];
            if (d < 0) { for (let k = 0; k < 4; k++) src[i + k] = -src[i + k]; }
          }
          for (let k = 0; k < 4; k++) q[i + k] = Math.max(-32767, Math.min(32767, Math.round(src[i + k] * 32767)));
        }
        out.setArray(q).setNormalized(true);
        done.add(out);
        n++;
      }
    }
    globalThis.__anim16 = n;
  };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before = statSync(input).size;
const doc = await io.read(input);
const transforms = [dedup(), dropRestTracks(), resample({ tolerance: 1e-4 })];
if (doWebp) {
  const { default: sharp } = await import('sharp');
  transforms.push(
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, quality: opt('--q-base', 80) }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, quality: opt('--q-normal', 88) }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(occlusionTexture|metallicRoughnessTexture|emissiveTexture)$/,
      quality: opt('--q-orm', 72) }),
  );
}
if (doAnim16) transforms.push(rotations16());
transforms.push(prune({ keepAttributes: true }));
if (doQuant) {
  transforms.push(quantize({ quantizePosition: 14, quantizeNormal: opt('--normal-bits', 10), quantizeTexcoord: 12,
    quantizeWeight: 8 }));
}
await doc.transform(...transforms);
await io.write(output, doc);
const after = statSync(output).size;
const root = doc.getRoot();
let tris = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += idx ? idx.getCount() / 3 : (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  }
}
const tex = root.listTextures().map((t) => `${t.getName()}:${t.getMimeType().split('/')[1]}:${(t.getImage().byteLength / 1024).toFixed(0)}K`);
console.log(
  `[optimize] ${input} -> ${output}: ${(before / 1024).toFixed(1)} KiB -> ${(after / 1024).toFixed(1)} KiB, ` +
    `${root.listAnimations().length} animations, ${tris} tris, dropped ${globalThis.__dropped ?? 0} rest channels` +
    (doQuant ? ', quantized' : '') + (doAnim16 ? `, ${globalThis.__anim16 ?? 0} rotation tracks int16` : '') +
    (doWebp ? `, webp [${tex.join(' ')}]` : '') +
    ` extensions=${root.listExtensionsUsed().map((e) => e.extensionName).join(',')}`,
);
