// Builds the stormfx_fx meshopt fixture: a 4-vertex quad (positions [0,0,0, 1,0,0, 1,1,0, 0,1,0.5], indices [0,1,2,0,2,3]) as a GLB
// whose buffer views are EXT_meshopt_compression-encoded with meshoptimizer (MIT, npm 'meshoptimizer'). The vertex codec is VERSION 0:
// the vendored three r172 decoder is meshoptimizer 0.18, which reads only v0. The extension is REQUIRED, so a loader without the meshopt
// decoder cannot fall back to raw data (the fallback buffer carries no bytes).
//   node _harness/new/fixtures/make_meshopt_glb.mjs <out.glb> [--plant-geometry]
// --plant-geometry encodes a DIFFERENT quad (vertex 3 z = 0.25): the round-trip row must FAIL on it (planted-fault control).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadEncoder() {
  try { return (await import('meshoptimizer')).MeshoptEncoder; } catch (e) { /* not on this script's resolution path */ }
  const roots = [process.env.MESHOPT_DIR, process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'node_modules', 'meshoptimizer')].filter(Boolean);
  for (const r of roots) { const f = path.join(r, 'index.js'); if (fs.existsSync(f)) return (await import(pathToFileURL(f).href)).MeshoptEncoder; }
  throw new Error('meshoptimizer not found (npm i meshoptimizer, or set MESHOPT_DIR)');
}

const out = process.argv[2];
if (!out) { console.error('usage: make_meshopt_glb.mjs <out.glb> [--plant-geometry]'); process.exit(2); }
const plant = process.argv.includes('--plant-geometry');
const E = await loadEncoder(); await E.ready;

const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, plant ? 0.25 : 0.5]);
const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
const vEnc = E.encodeGltfBuffer(new Uint8Array(pos.buffer), 4, 12, 'ATTRIBUTES', 0);
const iEnc = E.encodeGltfBuffer(new Uint8Array(idx.buffer), 6, 2, 'TRIANGLES');
const pad4 = (n) => (n + 3) & ~3;
const vOff = 0, iOff = pad4(vEnc.length), binLen = pad4(iOff + iEnc.length);
const bin = new Uint8Array(binLen); bin.set(vEnc, vOff); bin.set(iEnc, iOff);
const ext = 'EXT_meshopt_compression';
const gltf = {
  asset: { version: '2.0', generator: 'last-circle _harness make_meshopt_glb.mjs' },
  extensionsUsed: [ext], extensionsRequired: [ext],
  buffers: [{ byteLength: binLen }, { byteLength: 48 + 12, extensions: { [ext]: { fallback: true } } }],
  bufferViews: [
    { buffer: 1, byteOffset: 0, byteLength: 48, byteStride: 12, target: 34962,
      extensions: { [ext]: { buffer: 0, byteOffset: vOff, byteLength: vEnc.length, byteStride: 12, count: 4, mode: 'ATTRIBUTES' } } },
    { buffer: 1, byteOffset: 48, byteLength: 12, target: 34963,
      extensions: { [ext]: { buffer: 0, byteOffset: iOff, byteLength: iEnc.length, byteStride: 2, count: 6, mode: 'TRIANGLES' } } },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, plant ? 0.25 : 0.5] },
    { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  nodes: [{ mesh: 0, name: 'meshopt_quad' }], scenes: [{ nodes: [0] }], scene: 0,
};
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
const jl = pad4(json.length); json = Buffer.concat([json, Buffer.alloc(jl - json.length, 0x20)]);
const total = 12 + 8 + jl + 8 + binLen;
const glb = Buffer.alloc(total); let o = 0;
glb.writeUInt32LE(0x46546c67, o); glb.writeUInt32LE(2, o + 4); glb.writeUInt32LE(total, o + 8); o = 12;
glb.writeUInt32LE(jl, o); glb.writeUInt32LE(0x4e4f534a, o + 4); json.copy(glb, o + 8); o += 8 + jl;
glb.writeUInt32LE(binLen, o); glb.writeUInt32LE(0x004e4942, o + 4); Buffer.from(bin).copy(glb, o + 8);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, glb);
console.log('wrote', out, total, 'bytes', plant ? '(PLANT geometry)' : '');
