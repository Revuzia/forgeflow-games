// art_b_pack.cjs - compress ONE clean GLB with gltf-transform's own libraries (dev-only; _tools/ never ships).
//
//   node art_b_pack.cjs <cliDir> <in.glb> <out.glb> [--uvq 1|0] [--pos float|quant14] [--keep-mats]
//
// <cliDir> is the gltf-transform CLI install dir (so the exact installed meshoptimizer / @gltf-transform/*
// versions are used, as char_lod.py does): .../npm/node_modules/@gltf-transform/cli
//
// Chain:  prune -> weld -> reorder (size) -> [quantize TEXCOORD_0 to 12 bits, only when --uvq 1]
//         -> EXT_meshopt_compression, method FILTER  (NORMAL -> octahedral int8 filter, everything else lossless).
// POSITION stays FLOAT32 on purpose (--pos float, the default): KHR_mesh_quantization positions need a dequantisation
// transform on the node, which breaks `InstancedMesh(geometry, ...)` and any applyMatrix4 bake (normalised int16
// positions clamp at +-1). The cost is measured by art_b_city.py --measure (it also reports quant14).
//
// stdout: one JSON line {in, out, bytesIn, bytesOut}.
"use strict";
const fs = require("fs");
const path = require("path");

async function main() {
  const [cliDir, inPath, outPath, ...rest] = process.argv.slice(2);
  const opt = { uvq: "1", pos: "float" };
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
  const req = (m) => require(require.resolve(m, { paths: [cliDir] }));
  const core = req("@gltf-transform/core");
  const ext = req("@gltf-transform/extensions");
  const fn = req("@gltf-transform/functions");
  const { MeshoptEncoder, MeshoptDecoder } = req("meshoptimizer");
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new core.NodeIO()
    .registerExtensions(ext.ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(inPath);
  const steps = [fn.prune({ keepAttributes: true, keepIndices: true }), fn.weld(), fn.reorder({ encoder: MeshoptEncoder, target: "size" })];
  if (opt.pos === "quant14") {
    steps.push(fn.quantize({ pattern: /^(POSITION|TEXCOORD_0)$/, quantizePosition: 14, quantizeTexcoord: 12 }));
  } else if (opt.uvq === "1") {
    steps.push(fn.quantize({ pattern: /^TEXCOORD_0$/, quantizeTexcoord: 12 }));
  }
  await doc.transform(...steps);
  doc.createExtension(ext.EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: ext.EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(outPath, doc);
  console.log(JSON.stringify({ in: inPath, out: outPath, bytesIn: fs.statSync(inPath).size, bytesOut: fs.statSync(outPath).size }));
}
main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
