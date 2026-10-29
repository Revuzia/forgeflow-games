#!/usr/bin/env node
// VALE fighters: the face-locked LOD1 run on the three.js objects GLTFLoader builds, as src/render would run it
// (integration lead:fighter-tris; the renderer half is the engine stitch lead:fighter-lod-render).
//
//   node art/blender/fighters/_lod1_three.mjs [glb ...] [--json out.json]
//
// _lod1.mjs is the art-side recipe over glTF-Transform's view of a GLB. The renderer sees the same body differently:
// GLTFLoader keeps KHR_mesh_quantization's normalized int16 positions (getX() reads them back in -1..1) and folds
// nothing, so the dequantization (metres per position unit) lives only in the skeleton: at rest,
// bone.matrixWorld x boneInverse x bindMatrix carries a position unit into the mesh. It is PER MESH (each body is
// quantized in its own box), 0.82-1.24 m per unit over the 48 GLBs, so the 10 mm bound cannot be one constant.
//
// faceLockedLodIndex(mesh, simplifier) below is the drop-in for the renderer (it imports nothing but three's math):
// call it on the template's textured body SkinnedMesh, after template.updateMatrixWorld(true) and before any
// animation pose, with lod.ts's MeshoptSimplifier once `lodReady` resolved. It returns the LOD1 index (Uint16Array
// under 65,536 vertices) or null. It reads the dequantization from the mesh's own skeleton, hands the simplifier the
// int16 positions as they are with the bound made relative (0.010 m / (unit x extent)), locks every vertex skinned
// >= 0.5 to the `head` bone and weights the normals 0.5: the same simplification as _lod1.mjs (the simplifier rescales
// positions to their own box first, so dequantized or not gives the same collapses).
//
// What it buys (perf_1080 --prod --match-only, one build, seed 7, the LOD1 GLBs served in place of the 10 base GLBs,
// so body, hull, flash and x-ray all draw it; _harness/_reports/integ_chars_r1_lod1_ab.txt): match peak 1,045,468 ->
// 906,950 triangles, seconds over 500k 43 -> 22, the peak frame's fighters 346,453 -> 232,288. The 500k gate still
// needs the crowd (334k at that frame) and more cut on the engine side.
//
// main() is the check: for every fighter/skin GLB (textures dropped in memory, which leaves the geometry untouched),
// GLTFLoader.parse in Node, faceLockedLodIndex on the body, and the result compared with _lod1.mjs's faceLockedLod on
// the same file: the unit, the body and LOD1 triangle counts, and every head-locked triangle kept.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceLockedLod, bodyOf } from './_lod1.mjs';

/** metres per position unit of a skinned mesh as GLTFLoader built it (at rest, world matrices current) */
export function dequantUnit(mesh) {
  const sk = mesh.skeleton;
  const m = new Matrix4().copy(mesh.matrixWorld).invert()
    .multiply(sk.bones[0].matrixWorld).multiply(sk.boneInverses[0]).multiply(mesh.bindMatrix);
  return new Vector3().setFromMatrixColumn(m, 0).length();
}

/**
 * The face-locked LOD1 index of a fighter's textured body (a SkinnedMesh with one material and an index), or null.
 * opts: ratio 0.5 (target share of the triangles), errorM 0.010 (largest shape error, metres), normalW 0.5,
 * lockBone 'head', lockW 0.5. Returns { index, tris, lodTris, unitM, errorRel } so the caller can log the swap.
 */
export function faceLockedLodIndex(mesh, simplifier, { ratio = 0.5, errorM = 0.010, normalW = 0.5, lockBone = 'head', lockW = 0.5 } = {}) {
  const g = mesh.geometry;
  const P = g.getAttribute('position'), N = g.getAttribute('normal');
  const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight');
  if (!mesh.isSkinnedMesh || !g.index || !P || !N || !SI || !SW || g.groups.length > 1) return null;
  const head = mesh.skeleton.bones.findIndex((b) => b.name === lockBone);
  if (head < 0) return null;
  const n = P.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), lock = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i);
    nrm[i * 3] = N.getX(i); nrm[i * 3 + 1] = N.getY(i); nrm[i * 3 + 2] = N.getZ(i);
    let hw = 0;
    for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === head) hw += SW.getComponent(i, k);
    if (hw >= lockW) lock[i] = 1;
  }
  const src = g.index.array instanceof Uint32Array ? g.index.array : Uint32Array.from(g.index.array);
  const tris = src.length / 3;
  const unitM = dequantUnit(mesh);
  const extent = simplifier.getScale(pos, 3);
  if (!(unitM > 0) || !(extent > 0)) return null;
  const errorRel = errorM / (unitM * extent);
  const target = Math.max(3, Math.floor(tris * ratio) * 3);
  const [lod] = simplifier.simplifyWithAttributes(src, pos, 3, nrm, 3, [normalW, normalW, normalW], lock, target, errorRel, []);
  if (!lod.length || lod.length >= src.length) return null;
  return { index: n < 65536 ? Uint16Array.from(lod) : lod, tris, lodTris: lod.length / 3, unitM, errorRel, lock };
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', '..', 'out', 'fighters');

/** the textured body SkinnedMesh of a GLTFLoader scene (the largest indexed skinned mesh with UVs) */
function threeBodyOf(scene) {
  let best = null;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry.index || !o.geometry.getAttribute('uv')) return;
    if (!best || o.geometry.index.count > best.geometry.index.count) best = o;
  });
  return best;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
  let files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
  if (!files.length) {
    files = readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((d) => readdirSync(join(OUT, d.name)).filter((f) => f.endsWith('.glb')).sort().map((f) => join(OUT, d.name, f)));
  }
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const rows = [];
  let bad = 0;
  for (const file of files) {
    if (!existsSync(file)) { console.error(`[lod1-three] missing ${file}`); bad++; continue; }
    const doc = await io.read(file);
    const b = bodyOf(doc);
    const ref = faceLockedLod(b.prim, b.skin);
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const glb = await io.writeBinary(doc);
    const gltf = await new Promise((ok, no) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, no));
    gltf.scene.updateMatrixWorld(true);
    const mesh = threeBodyOf(gltf.scene);
    const r = mesh && faceLockedLodIndex(mesh, MeshoptSimplifier);
    if (!r) { console.error(`[lod1-three] ${basename(file)}: no LOD1`); bad++; continue; }
    // every head-locked triangle of the three.js body is still in its LOD1
    const src = mesh.geometry.index.array, key = (a, c, d) => [a, c, d].sort((x, y) => x - y).join(',');
    const kept = new Set();
    for (let t = 0; t < r.index.length / 3; t++) kept.add(key(r.index[t * 3], r.index[t * 3 + 1], r.index[t * 3 + 2]));
    const P = mesh.geometry.getAttribute('position'), a = new Vector3(), c = new Vector3(), d = new Vector3();
    let locked = 0, lockedKept = 0;
    for (let t = 0; t < r.tris; t++) {
      const [i0, i1, i2] = [src[t * 3], src[t * 3 + 1], src[t * 3 + 2]];
      if (!(r.lock[i0] && r.lock[i1] && r.lock[i2])) continue;
      a.fromBufferAttribute(P, i0); c.fromBufferAttribute(P, i1).sub(a); d.fromBufferAttribute(P, i2).sub(a);
      if (c.cross(d).length() * r.unitM * r.unitM <= 1e-12) continue;     // zero-area slivers, as _lod1.mjs counts them
      locked++;
      if (kept.has(key(i0, i1, i2))) lockedKept++;
    }
    const row = { glb: basename(file), body: r.tris, lod1: r.lodTris, unitM: +r.unitM.toFixed(5), errorRel: +r.errorRel.toExponential(4),
      lockedTris: locked, lockedKept, ref: { body: ref.tris, lod1: ref.lodTris, unitM: ref.unitM, lockedTris: ref.lockedTris } };
    row.match = row.body === ref.tris && Math.abs(row.lod1 - ref.lodTris) <= Math.max(3, ref.lodTris * 0.002)
      && Math.abs(row.unitM - ref.unitM) < 1e-4 && lockedKept === locked;
    if (!row.match) bad++;
    rows.push(row);
    console.log(`[lod1-three] ${row.glb.padEnd(26)} body ${String(row.body).padStart(6)} -> ${String(row.lod1).padStart(6)} `
      + `(ref ${ref.lodTris}), ${row.unitM.toFixed(4)} m/unit (ref ${ref.unitM.toFixed(4)}), errorRel ${row.errorRel}, `
      + `head locked ${locked} (${lockedKept} kept) ${row.match ? 'ok' : 'MISMATCH'}`);
  }
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  const tot = { glbs: rows.length, body: sum('body'), lod1: sum('lod1'), refLod1: rows.reduce((s, x) => s + x.ref.lod1, 0),
    unitM: [Math.min(...rows.map((x) => x.unitM)), Math.max(...rows.map((x) => x.unitM))], lockedTris: sum('lockedTris'),
    lockedKept: sum('lockedKept'), mismatches: bad };
  console.log(`[lod1-three] ${tot.glbs} GLBs through GLTFLoader: body ${tot.body} -> LOD1 ${tot.lod1} (_lod1.mjs ${tot.refLod1}), `
    + `dequantization ${tot.unitM[0]}-${tot.unitM[1]} m/unit, head-locked kept ${tot.lockedKept}/${tot.lockedTris}, ${bad} mismatches`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total: tot, rows }, null, 1) + '\n');
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
