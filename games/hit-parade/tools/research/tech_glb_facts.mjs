// TECH_REUSE lane: structural facts of one or more GLBs, using the glTF Transform SDK that ships inside the
// global @gltf-transform/cli 4.4.2 install (no new install). Decodes meshopt, reads WebP sizes.
// Usage: node tech_glb_facts.mjs <a.glb> [<b.glb> ...]   -> prints one JSON object per file
// ASCII only.
import { pathToFileURL } from 'node:url';

const G = 'C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/node_modules/';
const core = await import(pathToFileURL(G + '@gltf-transform/core/dist/index.js').href);
const exts = await import(pathToFileURL(G + '@gltf-transform/extensions/dist/index.js').href);
const mo = await import(pathToFileURL(G + 'meshoptimizer/index.js').href);
const { NodeIO, ImageUtils } = core;
const MeshoptDecoder = mo.MeshoptDecoder;
await MeshoptDecoder.ready;

const io = new NodeIO().registerExtensions(exts.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function round(v, n = 5) { return Math.round(v * 10 ** n) / 10 ** n; }

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const out = { file: file.split(/[\\/]/).pop() };
  out.extensionsUsed = root.listExtensionsUsed().map((e) => e.extensionName);
  out.extensionsRequired = root.listExtensionsRequired().map((e) => e.extensionName);
  out.nodes = root.listNodes().length;
  out.skins = root.listSkins().map((s) => ({
    name: s.getName(), joints: s.listJoints().length,
    ibm: s.getInverseBindMatrices() ? s.getInverseBindMatrices().getCount() : null,
    jointNames0: s.listJoints().slice(0, 3).map((j) => j.getName()),
  }));
  out.meshes = root.listMeshes().map((m) => ({
    name: m.getName(),
    prims: m.listPrimitives().map((p) => {
      const pos = p.getAttribute('POSITION');
      const j = p.getAttribute('JOINTS_0');
      const w = p.getAttribute('WEIGHTS_0');
      let wmin = Infinity, wmax = -Infinity, jmax = -1;
      if (w) {
        const el = [];
        for (let i = 0; i < w.getCount(); i++) {
          w.getElement(i, el);
          const s = el[0] + el[1] + el[2] + el[3];
          if (s < wmin) wmin = s;
          if (s > wmax) wmax = s;
        }
      }
      if (j) {
        const el = [];
        for (let i = 0; i < j.getCount(); i++) { j.getElement(i, el); jmax = Math.max(jmax, el[0], el[1], el[2], el[3]); }
      }
      return {
        verts: pos ? pos.getCount() : 0,
        tris: p.getIndices() ? p.getIndices().getCount() / 3 : (pos ? pos.getCount() / 3 : 0),
        attrs: p.listSemantics().map((s) => s + ':' + p.getAttribute(s).getComponentType() + (p.getAttribute(s).getNormalized() ? 'n' : '')),
        posMin: pos ? pos.getMin([]).map((v) => round(v)) : null,
        posMax: pos ? pos.getMax([]).map((v) => round(v)) : null,
        weightSum: w ? [round(wmin, 4), round(wmax, 4)] : null,
        maxJointIndex: jmax,
      };
    }),
  }));
  out.skinnedNodes = root.listNodes().filter((n) => n.getSkin() && n.getMesh()).map((n) => n.getName());
  out.textures = root.listTextures().map((t) => {
    const size = ImageUtils.getSize(t.getImage(), t.getMimeType());
    return { name: t.getName(), mime: t.getMimeType(), size, bytes: t.getImage() ? t.getImage().byteLength : 0 };
  });
  out.materials = root.listMaterials().length;
  out.animations = root.listAnimations().map((a) => {
    let maxT = 0, keys = 0;
    for (const s of a.listSamplers()) { const inp = s.getInput(); if (inp) { keys += inp.getCount(); maxT = Math.max(maxT, inp.getMax([])[0]); } }
    return { name: a.getName(), channels: a.listChannels().length, samplers: a.listSamplers().length, keys, duration: round(maxT, 3) };
  });
  console.log(JSON.stringify(out));
}
