// HIT PARADE asset pipeline (lane ASSETS): post-process a Blender-exported fighter GLB.
//   node tools/glb_post.mjs strip <in.glb> <out.glb>     keep rotation tracks + Hips translation only
//   node tools/glb_post.mjs facts <a.glb> [<b.glb> ...]   one JSON line of structural facts per file
// strip: drops every `scale` channel and every `translation` channel whose target is not the Hips
// (CONTRACT 6.1: "export rotation tracks + hips translation only"; rig_compat.md: the 64 constant
// X Bot location tracks would impose X Bot bone lengths on other bodies), prunes the orphans, drops
// KHR_materials_specular, removes unused TEXCOORD_n>0, and sets alphaMode MASK (cutoff 0.5) on every
// material whose name ends in `_cutout` (CONTRACT 6.1). Uses the glTF Transform SDK that ships inside
// the global @gltf-transform/cli 4.4.2 install (TECH_REUSE F). ASCII only.
import { pathToFileURL } from 'node:url';
import { statSync } from 'node:fs';

const G = 'C:/Users/TestRun/AppData/Roaming/npm/node_modules/@gltf-transform/cli/node_modules/';
const core = await import(pathToFileURL(G + '@gltf-transform/core/dist/index.js').href);
const exts = await import(pathToFileURL(G + '@gltf-transform/extensions/dist/index.js').href);
const fns = await import(pathToFileURL(G + '@gltf-transform/functions/dist/index.js').href);
const mo = await import(pathToFileURL(G + 'meshoptimizer/index.js').href);
const { NodeIO } = core;
await mo.MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(exts.ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder });

const HIPS = /(^|:)Hips$/;

async function strip(inp, out) {
  const doc = await io.read(inp);
  const root = doc.getRoot();
  let dropped = { scale: 0, translation: 0 }, kept = { rotation: 0, translation: 0 }, orphans = 0;
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const path = ch.getTargetPath();
      const node = ch.getTargetNode();
      const name = node ? node.getName() : '';
      let drop = false;
      if (path === 'scale') drop = true;
      else if (path === 'translation' && !HIPS.test(name)) drop = true;
      if (drop) {
        dropped[path]++;
        ch.dispose();
      } else if (path === 'rotation' || path === 'translation') {
        kept[path]++;
      }
    }
    // dispose every sampler no channel uses any more. (Part-1 bug: the old test counted the owning
    // Animation as a parent, so the samplers of the dropped scale / translation channels survived with
    // their accessors - ricky: 11505 samplers for 3894 channels, a 1.9 MB glTF JSON chunk.)
    const live = new Set(anim.listChannels().map((c) => c.getSampler()));
    for (const s of anim.listSamplers()) {
      if (!live.has(s)) { s.dispose(); orphans++; }
    }
  }
  for (const m of root.listMaterials()) {
    if (/_cutout$/.test(m.getName())) { m.setAlphaMode('MASK'); m.setAlphaCutoff(0.5); }
    else if (m.getAlphaMode() !== 'OPAQUE') { m.setAlphaMode('OPAQUE'); }
    const spec = m.getExtension('KHR_materials_specular');
    if (spec) m.setExtension('KHR_materials_specular', null);
  }
  for (const e of root.listExtensionsUsed()) {
    if (e.extensionName === 'KHR_materials_specular') e.dispose();
  }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) {
        if (/^TEXCOORD_[1-9]/.test(sem)) prim.setAttribute(sem, null);
        if (/^COLOR_/.test(sem)) prim.setAttribute(sem, null);
      }
    }
  }
  await doc.transform(fns.prune());
  await io.write(out, doc);
  console.log(JSON.stringify({ strip: out, bytes: statSync(out).size, dropped, kept, samplersDisposed: orphans }));
}

async function facts(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const f = { file: file.split(/[\\/]/).pop(), bytes: statSync(file).size };
  f.extensionsUsed = root.listExtensionsUsed().map((e) => e.extensionName);
  f.skins = root.listSkins().map((s) => ({ joints: s.listJoints().length }));
  f.meshes = root.listMeshes().map((m) => ({ name: m.getName(), prims: m.listPrimitives().map((p) => ({
    verts: p.getAttribute('POSITION') ? p.getAttribute('POSITION').getCount() : 0,
    attrs: p.listSemantics(), material: p.getMaterial() ? p.getMaterial().getName() : null })) }));
  f.materials = root.listMaterials().map((m) => ({ name: m.getName(), alphaMode: m.getAlphaMode(),
    alphaCutoff: m.getAlphaCutoff(), baseColorTexture: m.getBaseColorTexture() ? m.getBaseColorTexture().getName() : null }));
  f.textures = root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(),
    size: t.getSize(), bytes: t.getImage() ? t.getImage().byteLength : 0 }));
  f.animations = root.listAnimations().map((a) => {
    const ch = a.listChannels();
    let dur = 0, keys = 0;
    const paths = {};
    for (const c of ch) {
      paths[c.getTargetPath()] = (paths[c.getTargetPath()] || 0) + 1;
      const inp = c.getSampler().getInput();
      if (inp) { dur = Math.max(dur, inp.getMax([])[0]); keys += inp.getCount(); }
    }
    const tnames = ch.filter((c) => c.getTargetPath() === 'translation').map((c) => c.getTargetNode().getName());
    return { name: a.getName(), channels: ch.length, paths, dur: Math.round(dur * 10000) / 10000, keys, translationNodes: tnames };
  });
  console.log(JSON.stringify(f));
}

// decimate <in> <out> <step> [nodeRegex] [animRegex]: BUDGET FALLBACK (compress_glb.py). For every animation channel whose
// target node name matches regex (default: the finger joints), keep keys 0, step, 2*step, ... and the last one;
// three.js slerps between them. Fingers carry ~39% of the keyframe bytes (ricky: 439 KB of 1121 KB) while
// moving slowly (fists, open hands), so this is the cheapest budget saving that keeps every joint's track.
async function decimate(inp, out, step, rx, arx) {
  const doc = await io.read(inp);
  const root = doc.getRoot();
  const re = new RegExp(rx || 'Hand(Thumb|Index|Middle|Ring|Pinky)\\d');
  const are = new RegExp(arx || '.*');
  const cache = new Map();
  let chans = 0, before = 0, after = 0;
  for (const anim of root.listAnimations()) {
    if (!are.test(anim.getName())) continue;
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      if (!node || !re.test(node.getName())) continue;
      const s = ch.getSampler();
      const inA = s.getInput(), outA = s.getOutput();
      const n = inA.getCount();
      if (n <= 2) continue;
      const keep = [];
      for (let i = 0; i < n; i += step) keep.push(i);
      if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
      const t = inA.getArray();
      let newIn = cache.get(inA);
      if (!newIn) {
        newIn = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(keep.map((i) => t[i])))
          .setBuffer(inA.getBuffer());
        cache.set(inA, newIn);
      }
      const e = outA.getElementSize();
      const v = outA.getArray();
      const nv = new Float32Array(keep.length * e);
      keep.forEach((i, j) => { for (let k = 0; k < e; k++) nv[j * e + k] = v[i * e + k]; });
      const newOut = doc.createAccessor().setType(outA.getType()).setArray(nv).setBuffer(outA.getBuffer());
      s.setInput(newIn).setOutput(newOut);
      chans++; before += n; after += keep.length;
    }
  }
  await doc.transform(fns.prune());
  await io.write(out, doc);
  console.log(JSON.stringify({ decimate: out, bytes: statSync(out).size, step, channels: chans, keysBefore: before, keysAfter: after }));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'strip') await strip(args[0], args[1]);
else if (cmd === 'decimate') await decimate(args[0], args[1], parseInt(args[2] || '3', 10), args[3], args[4]);
else if (cmd === 'facts') { for (const a of args) await facts(a); }
else { console.error('usage: glb_post.mjs strip <in> <out> | facts <glb...> | decimate <in> <out> <step> [nodeRegex] [animRegex]'); process.exit(2); }
