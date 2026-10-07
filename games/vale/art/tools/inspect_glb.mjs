#!/usr/bin/env node
// VALE art: print what a GLB contains — nodes, skins/bones, clips (+durations), materials,
// textures (format + size), triangle count, file size.
//
//   node art/tools/inspect_glb.mjs art/out/_proof/_proof_mannequin.glb [--json] [--nodes]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node art/tools/inspect_glb.mjs file.glb [--json] [--nodes]');
  process.exit(2);
}
const asJson = args.includes('--json');
const showNodes = args.includes('--nodes');

function imageSize(bytes, mime) {
  if (!bytes) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50)) return [dv.getUint32(16), dv.getUint32(20)];
  if (mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      const len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();
const out = { file, bytes: statSync(file).size, nodes: [], skins: [], animations: [], materials: [], textures: [], meshes: [], tris: 0,
  extensions: root.listExtensionsUsed().map((e) => e.extensionName) };

for (const n of root.listNodes()) {
  out.nodes.push({ name: n.getName(), mesh: n.getMesh()?.getName() ?? null, skin: !!n.getSkin(), children: n.listChildren().length,
    extras: Object.keys(n.getExtras() || {}).length ? n.getExtras() : undefined });
}
for (const s of root.listSkins()) out.skins.push({ name: s.getName(), joints: s.listJoints().map((j) => j.getName()) });
for (const a of root.listAnimations()) {
  let dur = 0;
  const targets = new Set();
  for (const smp of a.listSamplers()) {
    const inp = smp.getInput();
    if (inp) dur = Math.max(dur, inp.getMax([])[0] ?? 0);
  }
  for (const ch of a.listChannels()) targets.add(`${ch.getTargetNode()?.getName()}.${ch.getTargetPath()}`);
  out.animations.push({ name: a.getName(), duration: +dur.toFixed(4), frames30: Math.round(dur * 30), channels: a.listChannels().length,
    bones: new Set([...targets].map((t) => t.split('.').slice(0, -1).join('.'))).size });
}
for (const m of root.listMaterials()) {
  out.materials.push({ name: m.getName(), baseColorTexture: !!m.getBaseColorTexture(), metallicRoughnessTexture: !!m.getMetallicRoughnessTexture(),
    normalTexture: !!m.getNormalTexture(), occlusionTexture: !!m.getOcclusionTexture(), emissive: m.getEmissiveFactor(),
    baseColorFactor: m.getBaseColorFactor().map((v) => +v.toFixed(3)), roughness: m.getRoughnessFactor(), metallic: m.getMetallicFactor() });
}
for (const t of root.listTextures()) {
  const img = t.getImage();
  out.textures.push({ name: t.getName() || t.getURI(), mime: t.getMimeType(), size: imageSize(img, t.getMimeType()), bytes: img?.byteLength ?? 0 });
}
for (const mesh of root.listMeshes()) {
  let tris = 0;
  const prims = [];
  for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    const t = idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    tris += t;
    prims.push({ material: p.getMaterial()?.getName() ?? null, tris: t, verts: p.getAttribute('POSITION').getCount(),
      attributes: p.listSemantics() });
  }
  out.tris += tris;
  out.meshes.push({ name: mesh.getName(), tris, primitives: prims });
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`${file}  ${(out.bytes / 1024).toFixed(1)} KiB  ${out.tris} tris  extensions: ${out.extensions.join(', ') || '-'}`);
  if (showNodes) for (const n of out.nodes) console.log(`  node ${n.name}${n.mesh ? ` mesh=${n.mesh}` : ''}${n.skin ? ' (skinned)' : ''}`);
  for (const s of out.skins) console.log(`  skin ${s.name}: ${s.joints.length} joints: ${s.joints.join(' ')}`);
  for (const m of out.meshes) {
    console.log(`  mesh ${m.name}: ${m.tris} tris`);
    for (const p of m.primitives) console.log(`    prim material=${p.material} tris=${p.tris} verts=${p.verts} [${p.attributes.join(',')}]`);
  }
  for (const m of out.materials) {
    const maps = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture'].filter((k) => m[k]).join(',');
    console.log(`  material ${m.name}: maps=[${maps}] emissive=${m.emissive.map((v) => v.toFixed(2))} base=${m.baseColorFactor}`);
  }
  for (const t of out.textures) console.log(`  texture ${t.name}: ${t.mime} ${t.size ? t.size.join('x') : '?'} ${(t.bytes / 1024).toFixed(1)} KiB`);
  for (const a of out.animations) console.log(`  clip ${a.name.padEnd(12)} ${a.duration.toFixed(3)} s (${a.frames30} f) channels=${a.channels} bones=${a.bones}`);
}
