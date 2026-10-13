// art_a_canopy_pack.mjs - ART-A / P2.6: finish the Blender canopy export.
//   node art_a_canopy_pack.mjs <raw.glb> <meta.json> [--out ../assets/props]
// * COLOR_0 -> VEC3 float (the dome code uses a 3-float colour attribute; the Blender exporter writes VEC4 normalised ushort)
// * Draco (KHR_draco_mesh_compression) - the kernel already ships the wasm decoder for the character bases, so no new fetch
// * writes <out>/canopy.glb and <out>/canopy.json (the Blender meta + measured facts of the packed file)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = "C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/";
const req = createRequire(CLI + "package.json");
const { NodeIO } = req("@gltf-transform/core");
const { KHRDracoMeshCompression } = req("@gltf-transform/extensions");
const { dedup, prune } = req("@gltf-transform/functions");
const draco3d = req("draco3dgltf");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [RAW, META] = args;
const oi = args.indexOf("--out");
const OUT = path.resolve(HERE, oi >= 0 ? args[oi + 1] : "../assets/props");

const enc = await draco3d.createEncoderModule(), dec = await draco3d.createDecoderModule();
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ "draco3d.encoder": enc, "draco3d.decoder": dec });
const doc = await io.read(RAW);
const root = doc.getRoot();
const meshes = root.listMeshes();
if (meshes.length !== 1 || meshes[0].getName() !== "Canopy") { console.error("expected exactly one mesh named Canopy"); process.exit(1); }
const prim = meshes[0].listPrimitives()[0];
const c4 = prim.getAttribute("COLOR_0");
if (c4 && c4.getType() === "VEC4") {
  const n = c4.getCount(), out = new Float32Array(n * 3), tmp = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { c4.getElement(i, tmp); out[i * 3] = tmp[0]; out[i * 3 + 1] = tmp[1]; out[i * 3 + 2] = tmp[2]; }   // getElement de-normalises
  const c3 = doc.createAccessor("COLOR_0").setType("VEC3").setArray(out).setBuffer(root.listBuffers()[0]);
  prim.setAttribute("COLOR_0", c3);
  c4.dispose();
}
await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
  method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 3, decodeSpeed: 5,
  quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12, quantizeGeneric: 12,
});
const outGlb = path.join(OUT, "canopy.glb");
await io.write(outGlb, doc);

// ---- read back what was written and measure it
const back = await new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ "draco3d.decoder": dec }).read(outGlb);
const p2 = back.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = p2.getAttribute("POSITION"), idx = p2.getIndices();
const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9], v = [0, 0, 0];
for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], v[k]); bmax[k] = Math.max(bmax[k], v[k]); } }
const col = p2.getAttribute("COLOR_0");
const meta = JSON.parse(readFileSync(META, "utf8"));
meta.spanCentreLines = meta.span;
meta.span = +(bmax[0] - bmin[0]).toFixed(3);          // the real X extent of the mesh (tip skins tilt outward)
meta.chord = +(bmax[2] - bmin[2]).toFixed(3);
meta.top = +bmax[1].toFixed(3); meta.bottom = +bmin[1].toFixed(3);
meta.file = { bytes: statSync(outGlb).size, compression: "KHR_draco_mesh_compression (14-bit position, 10-bit normal, 8-bit colour, 12-bit uv)",
  meshNode: "Canopy", attributes: p2.listSemantics(), colorType: col ? col.getType() : null, verts: pos.getCount(), tris: idx.getCount() / 3,
  bboxMin: bmin.map((x) => +x.toFixed(4)), bboxMax: bmax.map((x) => +x.toFixed(4)) };
meta.tris = meta.file.tris; meta.verts = meta.file.verts;      // the numbers of the file as shipped (Draco drops 2 degenerate triangles)
writeFileSync(path.join(OUT, "canopy.json"), JSON.stringify(meta, null, 1));
console.log("canopy.glb", meta.file.bytes, "B | verts", meta.file.verts, "tris", meta.file.tris, "| attrs", meta.file.attributes.join(","), "color", meta.file.colorType, "| bbox", meta.file.bboxMin, meta.file.bboxMax);
