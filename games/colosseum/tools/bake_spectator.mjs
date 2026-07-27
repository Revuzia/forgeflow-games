// Bake the Blender-generated spectator LODs into a plain JS module.
//
// The crowd is built during boot, synchronously, before the first frame. A
// runtime fetch for three small GLBs would make an 18,000-seat amphitheatre
// populate late on a slow connection — the player would watch the stands fill
// in, which is worse than a slightly cruder figure that is simply there.
//
// These meshes total under 900 vertices across all three LODs, so inlining
// them as Float32Array literals costs a few KB of JS and removes an entire
// class of loading failure.
//
// run: node games/colosseum/tools/bake_spectator.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGLB } from "./ingest_assets.mjs";

// fileURLToPath, not a hand-rolled regex on .pathname — the repo lives under
// "Claude Claw" and the raw pathname arrives percent-encoded as "Claude%20Claw".
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "_spectator");
const OUT = path.join(HERE, "..", "runtime", "view", "spectator_geo.js");

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function read(json, bin, i) {
  const a = json.accessors[i];
  const TA = COMP[a.componentType];
  const n = N[a.type];
  const out = new TA(a.count * n);
  if (a.bufferView === undefined) return out;
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || n * TA.BYTES_PER_ELEMENT;
  for (let k = 0; k < a.count; k++) {
    out.set(new TA(bin.buffer, bin.byteOffset + base + k * stride, n), k * n);
  }
  return out;
}

/** Flatten a GLB's single mesh to a non-indexed position/normal pair. */
function flatten(file) {
  const { json, bin } = parseGLB(file);
  const prim = json.meshes[0].primitives[0];
  const pos = read(json, bin, prim.attributes.POSITION);
  const nor = prim.attributes.NORMAL !== undefined ? read(json, bin, prim.attributes.NORMAL) : null;
  const idx = prim.indices !== undefined ? read(json, bin, prim.indices) : null;

  const count = idx ? idx.length : pos.length / 3;
  const P = new Float32Array(count * 3);
  const Nn = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = (idx ? idx[i] : i) * 3;
    P[i * 3] = pos[s]; P[i * 3 + 1] = pos[s + 1]; P[i * 3 + 2] = pos[s + 2];
    if (nor) { Nn[i * 3] = nor[s]; Nn[i * 3 + 1] = nor[s + 1]; Nn[i * 3 + 2] = nor[s + 2]; }
  }
  return { P, N: Nn, tris: count / 3 };
}

const r = (a) => "[" + Array.from(a, (v) => Math.round(v * 1e4) / 1e4).join(",") + "]";

const lods = [0, 1, 2].map((i) => {
  const f = path.join(SRC, `spectator_lod${i}.glb`);
  if (!fs.existsSync(f)) throw new Error(`missing ${f} — run gen_spectator.py first`);
  const d = flatten(f);
  console.log(`  LOD${i}: ${d.tris} tris, ${d.P.length / 3} verts`);
  return d;
});

const body = `// GENERATED — do not edit by hand.
//
// Seated-spectator LOD meshes, authored in Blender by tools/gen_spectator.py
// and baked here by tools/bake_spectator.mjs so the crowd can be built
// synchronously during boot with no fetch.
//
// Y-up, origin at the seat surface, ~1.24 m tall seated. Flat-shaded on
// purpose: these are lit by an instanced vertex-colour material where smooth
// normals buy nothing at the distances involved.
//
//   LOD0 ${lods[0].tris} tris — nearest rows
//   LOD1 ${lods[1].tris} tris — mid cavea
//   LOD2 ${lods[2].tris} tris — far cavea and the attic
//
// The point of LOD2 is that it still has a head break and a shoulder line.
// The prism it replaces had neither, which is why the far crowd read as
// coloured confetti rather than people.

${lods.map((d, i) => `export const SPECTATOR_LOD${i} = {
  tris: ${d.tris},
  position: new Float32Array(${r(d.P)}),
  normal: new Float32Array(${r(d.N)}),
};`).join("\n\n")}

export const SPECTATOR_LODS = [SPECTATOR_LOD0, SPECTATOR_LOD1, SPECTATOR_LOD2];
`;

fs.writeFileSync(OUT, body, "utf8");
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}  (${(body.length / 1024).toFixed(1)} KB)`);
