// art_a_fbx_dump.mjs - parse a Mixamo FBX with three r172's FBXLoader in plain node and dump the
// skeleton rest pose + the first animation's tracks as JSON.
//   node art_a_fbx_dump.mjs "<file.fbx>" out.json
// Output: { bones:[{name,parent,t,q,s}], root:{...scene root chain}, clip:{name,duration,tracks:[{name,times,values}]} }
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const THREE_ROOT = "C:/Users/TestRun/Claude Claw/forgeflow-games/node_modules/three/";
const THREE = await import(pathToFileURL(THREE_ROOT + "build/three.module.js").href);
const { FBXLoader } = await import(pathToFileURL(THREE_ROOT + "examples/jsm/loaders/FBXLoader.js").href);
const [,, inp, outp] = process.argv;
const buf = readFileSync(inp);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fbx = new FBXLoader().parse(ab, "");
fbx.updateMatrixWorld(true);
const bones = [];
fbx.traverse((o) => {
  if (o.isBone || o.isGroup || o.isObject3D) {
    const p = o.parent;
    bones.push({ name: o.name, type: o.type, parent: p ? p.name : null, t: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() });
  }
});
const clip = fbx.animations[0];
const out = { file: inp, nanim: fbx.animations.length, bones,
  clip: clip ? { name: clip.name, duration: clip.duration, tracks: clip.tracks.map((t) => ({ name: t.name, type: t.constructor.name, times: Array.from(t.times), values: Array.from(t.values) })) } : null };
writeFileSync(outp, JSON.stringify(out));
console.log("ok", inp, "bones", bones.length, "tracks", clip ? clip.tracks.length : 0, "dur", clip && clip.duration);
