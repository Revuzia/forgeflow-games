#!/usr/bin/env node
// VALE fighters: the face-locked LOD1 (perf PERF-m5, integration lead:fighter-tris / chars-03 / chars-04).
//
//   node art/blender/fighters/_lod1.mjs [glb ...] [--ratio 0.5] [--error-mm 10] [--normal-weight 0.5]
//                                       [--lock-weight 0.5] [--json out.json] [--write dir]
//
// Every fighter and skin GLB already sits inside CONTRACT §12's 10-25k triangles and next to its 1.2 MB byte budget,
// so a second index buffer does not fit in the file (an LOD1 index of ~13k triangles is ~80 KB; the base GLBs have
// 5-60 KB of headroom). The LOD1 is therefore a RECIPE the renderer runs at load, over the mesh's own vertices
// (meshoptimizer, the same simplifier as src/render/lod.ts), and this script is its art-side reference and check:
//
//   face lock   every vertex skinned to the `head` joint with weight >= --lock-weight never moves and is never removed,
//               so the face, mask, eyes and everything else riding the head stay exactly as authored (the reason W1
//               kept fighter bodies whole in the main pass);
//   attributes  simplifyWithAttributes with the vertex normals weighted --normal-weight, so a collapse that would
//               bend the shading under the baked normal map is refused before one that only moves a flat panel;
//   bound       --error-mm in metres (positions dequantized through the skin's bind matrices: KHR_mesh_quantization
//               folds the dequantization into the inverse bind matrices of a skinned mesh; it is PER MESH, a uniform
//               0.82-1.24 m per unit over the 48 GLBs, never one constant), target --ratio of the body's triangles;
//               UV seams stay borders (a collapse never crosses a UV island);
//   scope       the textured body primitive only (accent and form meshes are small and stay whole).
//
// The recipe (defaults): ratio 0.5, 10 mm, normals 0.5, `head` >= 0.5 locked. 10 mm is 0.6 px of a fighter at the
// gameplay camera at 1080p (~117 px for 2 m: 17 mm a pixel), so the match's main pass and its outline hull can draw
// the LOD1; the menu showcase (4-5x larger on screen) keeps the full body. Measured over the 48 GLBs
// (_harness/_reports/integ_chars_r1_lod1.json): 955,762 -> 580,849 body triangles (0.608), worst error 10 mm, every
// non-degenerate head-locked triangle kept (152,516). _lod1_three.mjs is the same recipe on the objects GLTFLoader
// builds (the renderer's drop-in, faceLockedLodIndex) and checks it against this one.
//
// Prints per GLB: body triangles, LOD1 triangles, the achieved error (mm), head-locked vertices / triangles, the
// dequantization (m per position unit), and a total; --json writes the same rows (plus extentM and errorRel, the
// relative bound the simplifier is handed); --write <dir> writes a copy of each GLB with the body's index replaced by its
// LOD1 (for three_snapshot A/B shots: art/tools/three_snapshot.mjs <dir>/<id>.glb). The shipped GLBs are never edited.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', '..', 'out', 'fighters');
const args = process.argv.slice(2);
const valued = ['--ratio', '--error-mm', '--normal-weight', '--lock-weight', '--json', '--write'];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RATIO = Number(opt('--ratio', 0.5));
const ERROR_M = Number(opt('--error-mm', 10)) / 1000;
const NORMAL_W = Number(opt('--normal-weight', 0.5));
const LOCK_W = Number(opt('--lock-weight', 0.5));
const jsonOut = opt('--json', '');
const writeDir = opt('--write', '');
let files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && valued.includes(args[i - 1])));
if (!files.length) {
  files = readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => readdirSync(join(OUT, d.name)).filter((f) => f.endsWith('.glb')).sort().map((f) => join(OUT, d.name, f)));
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** the face-locked LOD1 of one skinned, textured primitive: { lod, tris, lodTris, errorMm, lockedVerts, lockedTris } */
export function faceLockedLod(prim, skin, { ratio = RATIO, errorM = ERROR_M, normalW = NORMAL_W, lockW = LOCK_W } = {}) {
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const n = P.getCount();
  // bind pose: joint world x inverse bind = the dequantization (the same matrix for every joint at rest)
  const M = mul(skin.listJoints()[0].getWorldMatrix(), skin.getInverseBindMatrices().getElement(0, []));
  const pos = new Float32Array(n * 3), att = new Float32Array(n * 3), e = [];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e);
    pos[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
    pos[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
    pos[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
    N.getElement(i, e);
    att[i * 3] = e[0]; att[i * 3 + 1] = e[1]; att[i * 3 + 2] = e[2];
  }
  const head = skin.listJoints().map((j) => j.getName()).indexOf('head');
  const lock = new Uint8Array(n), ej = [], ew = [];
  let lockedVerts = 0;
  for (let i = 0; i < n; i++) {
    J.getElement(i, ej); W.getElement(i, ew);
    let hw = 0;
    for (let k = 0; k < 4; k++) if (ej[k] === head) hw += ew[k];
    if (hw >= lockW) { lock[i] = 1; lockedVerts++; }
  }
  const src = Uint32Array.from(prim.getIndices().getArray());
  const tris = src.length / 3;
  // zero-area triangles (quantization folds a few sliver faces flat) are dropped by any simplifier: not counted
  const area2 = (a, b, c) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  const lockedTri = (t) => lock[src[t * 3]] && lock[src[t * 3 + 1]] && lock[src[t * 3 + 2]]
    && area2(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]) > 1e-12;
  let lockedTris = 0;
  for (let t = 0; t < tris; t++) if (lockedTri(t)) lockedTris++;
  const scale = MeshoptSimplifier.getScale(pos, 3);
  const target = Math.max(3, Math.floor(tris * ratio) * 3);
  const [lod, err] = MeshoptSimplifier.simplifyWithAttributes(src, pos, 3, att, 3, [normalW, normalW, normalW], lock, target,
    errorM / scale, []);
  // the locked triangles survive untouched (checked: every one of them is still in the LOD1)
  const key = (a, b, c) => { const s = [a, b, c].sort((x, y) => x - y); return `${s[0]},${s[1]},${s[2]}`; };
  const kept = new Set();
  for (let t = 0; t < lod.length / 3; t++) kept.add(key(lod[t * 3], lod[t * 3 + 1], lod[t * 3 + 2]));
  let lockedKept = 0;
  for (let t = 0; t < tris; t++) {
    if (lockedTri(t) && kept.has(key(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]))) lockedKept++;
  }
  // the dequantization is per mesh (KHR_mesh_quantization fits each body's own box): metres per position unit, a
  // uniform scale (the three column norms agree), and the relative error the simplifier is handed
  const cols = [0, 4, 8].map((c) => Math.hypot(M[c], M[c + 1], M[c + 2]));
  const unitM = cols[0], uniform = Math.max(...cols) - Math.min(...cols) < 1e-6 * unitM;
  return { lod, tris, lodTris: lod.length / 3, errorMm: +(err * scale * 1000).toFixed(2), lockedVerts, lockedTris, lockedKept,
    unitM: +unitM.toFixed(5), uniform, extentM: +scale.toFixed(4), errorRel: +(errorM / scale).toExponential(4) };
}

/** the textured body primitive of a fighter GLB (the largest skinned primitive with UVs) */
export function bodyOf(doc) {
  let best = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), skin = node.getSkin();
    if (!mesh || !skin) continue;
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute('TEXCOORD_0') || !prim.getIndices() || prim.getMode() !== 4) continue;
      const c = prim.getIndices().getCount();
      if (!best || c > best.count) best = { node, mesh, skin, prim, count: c };
    }
  }
  return best;
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (writeDir) mkdirSync(writeDir, { recursive: true });
  const rows = [];
  for (const file of files) {
    if (!existsSync(file)) { console.error(`[lod1] missing ${file}`); process.exitCode = 1; continue; }
    const doc = await io.read(file);
    const b = bodyOf(doc);
    if (!b) { console.error(`[lod1] ${basename(file)}: no textured skinned body`); continue; }
    const r = faceLockedLod(b.prim, b.skin);
    const row = { glb: basename(file), body: r.tris, lod1: r.lodTris, ratio: +(r.lodTris / r.tris).toFixed(3), errorMm: r.errorMm,
      lockedVerts: r.lockedVerts, lockedTris: r.lockedTris, lockedKept: r.lockedKept, unitM: r.unitM, uniform: r.uniform,
      extentM: r.extentM, errorRel: r.errorRel };
    rows.push(row);
    console.log(`[lod1] ${row.glb.padEnd(26)} body ${String(r.tris).padStart(6)} -> ${String(r.lodTris).padStart(6)} `
      + `(${row.ratio.toFixed(3)}) error ${r.errorMm.toFixed(2)} mm, head locked ${r.lockedTris} tris (${r.lockedKept} kept), `
      + `${r.unitM.toFixed(4)} m/unit${r.uniform ? '' : ' NON-UNIFORM'}`);
    if (writeDir) {
      const idx = b.prim.getIndices();
      const lodAcc = doc.createAccessor(`${b.mesh.getName()}_lod1`).setType('SCALAR')
        .setArray(idx.getArray() instanceof Uint16Array ? Uint16Array.from(r.lod) : r.lod).setBuffer(idx.getBuffer());
      b.prim.setIndices(lodAcc);
      await io.write(join(writeDir, basename(file)), doc);
    }
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const tot = { glbs: rows.length, body: sum('body'), lod1: sum('lod1'), ratio: +(sum('lod1') / Math.max(1, sum('body'))).toFixed(3),
    maxErrorMm: Math.max(0, ...rows.map((r) => r.errorMm)), lockedTris: sum('lockedTris'), lockedKept: sum('lockedKept'),
    unitM: [Math.min(...rows.map((r) => r.unitM)), Math.max(...rows.map((r) => r.unitM))], allUniform: rows.every((r) => r.uniform),
    recipe: { ratio: RATIO, errorMm: ERROR_M * 1000, normalWeight: NORMAL_W, lockJoint: 'head', lockWeight: LOCK_W } };
  console.log(`[lod1] ${tot.glbs} GLBs: body ${tot.body} -> LOD1 ${tot.lod1} (${tot.ratio}), worst error ${tot.maxErrorMm} mm, `
    + `head-locked triangles kept ${tot.lockedKept}/${tot.lockedTris}, dequantization ${tot.unitM[0]}-${tot.unitM[1]} m/unit `
    + `(per mesh${tot.allUniform ? ', uniform' : ', NOT uniform'})`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total: tot, rows }, null, 1) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
