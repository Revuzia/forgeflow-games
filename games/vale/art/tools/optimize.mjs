#!/usr/bin/env node
// VALE art: post-process a Blender-exported GLB with gltf-transform (CONTRACT §12).
//
//   node art/tools/optimize.mjs in.glb [out.glb] [--quantize]
//
// Passes (all lossless for three.js r186 GLTFLoader, no decoders needed):
//   dedup      merge identical accessors / textures / materials
//   dropRest   remove animation channels that hold a node at its rest TRS for the whole clip
//              (three's AnimationMixer blends missing tracks toward the bind pose)
//   resample   drop redundant linear keyframes (tolerance 1e-4)
//   prune      remove anything left unreferenced
//   --quantize KHR_mesh_quantization (positions 14 bit, normals 10, uvs 12); three's
//              GLTFLoader supports it natively. Off by default (keeps raw floats).
// EXT_mesh_gpu_instancing (maps) is preserved: every official extension is registered.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const files = args.filter((a) => !a.startsWith('--'));
if (files.length < 1) {
  console.error('usage: node art/tools/optimize.mjs in.glb [out.glb] [--quantize]');
  process.exit(2);
}
const [input, output = input] = files;

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

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before = statSync(input).size;
const doc = await io.read(input);
const transforms = [dedup(), dropRestTracks(), resample({ tolerance: 1e-4 }), prune({ keepAttributes: true })];
if (flags.has('--quantize')) {
  transforms.push(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
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
console.log(
  `[optimize] ${input} -> ${output}: ${(before / 1024).toFixed(1)} KiB -> ${(after / 1024).toFixed(1)} KiB, ` +
    `${root.listAnimations().length} animations, ${tris} tris, dropped ${globalThis.__dropped ?? 0} rest channels` +
    (flags.has('--quantize') ? ', quantized' : ''),
);
