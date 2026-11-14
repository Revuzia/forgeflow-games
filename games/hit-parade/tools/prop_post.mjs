// HIT PARADE asset pipeline (lane ASSETS): finish a Blender-exported prop GLB.
//   node tools/prop_post.mjs extras <in.glb> <out.glb> <extras.json>   merge {attach, ...} into the ROOT node extras
//   node tools/prop_post.mjs facts <a.glb> [...]                       one JSON line of facts per file
// CONTRACT 17.1: the view reads `userData.attach = {bone, pos [m, bone space], rotDeg [XYZ euler]}` from the prop's
// root node (three's GLTFLoader copies node extras into userData). `attach: null` = a world prop (no hand).
// Uses the glTF Transform SDK inside the global @gltf-transform/cli install (as tools/glb_post.mjs). ASCII only.
import { pathToFileURL } from 'node:url';
import { readFileSync, statSync } from 'node:fs';

const G = 'C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/node_modules/';
const core = await import(pathToFileURL(G + '@gltf-transform/core/dist/index.js').href);
const exts = await import(pathToFileURL(G + '@gltf-transform/extensions/dist/index.js').href);
const mo = await import(pathToFileURL(G + 'meshoptimizer/index.js').href);
await mo.MeshoptDecoder.ready;
const io = new core.NodeIO().registerExtensions(exts.ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder });

async function extras(inp, out, jsonPath) {
  const add = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const doc = await io.read(inp);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const roots = scene.listChildren();
  if (roots.length !== 1) throw new Error(`expected one root node, found ${roots.length}`);
  const n = roots[0];
  n.setExtras({ ...(n.getExtras() || {}), ...add });
  await io.write(out, doc);
  console.log(JSON.stringify({ ok: true, node: n.getName(), extras: Object.keys(n.getExtras()) }));
}

async function facts(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    tris += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  }
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const top = scene.listChildren().map((n) => ({ name: n.getName(), extras: n.getExtras() }));
  return {
    file, bytes: statSync(file).size, tris, nodes: root.listNodes().length, meshes: root.listMeshes().length,
    materials: root.listMaterials().map((m) => ({ name: m.getName(), baseColor: !!m.getBaseColorTexture(),
      normal: !!m.getNormalTexture(), metalRough: !!m.getMetallicRoughnessTexture(), occlusion: !!m.getOcclusionTexture(),
      emissive: !!m.getEmissiveTexture(), emissiveFactor: m.getEmissiveFactor(), alphaMode: m.getAlphaMode() })),
    textures: root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize() })),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName), top,
  };
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'extras') await extras(args[0], args[1], args[2]);
else if (cmd === 'facts') for (const f of args) console.log(JSON.stringify(await facts(f)));
else { console.error('usage: prop_post.mjs extras <in> <out> <json> | facts <glb...>'); process.exit(2); }
