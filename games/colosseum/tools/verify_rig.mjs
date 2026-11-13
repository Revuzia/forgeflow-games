// Load a GLB through the REAL three.js GLTFLoader and prove the rig animates.
//
// ingest_assets.mjs reads the container with its own parser, which is exactly
// why it cannot be the last word on a file it just rewrote: a GLB that its
// parser round-trips happily can still fail in GLTFLoader, or load as a
// statue whose bones never move. Both failures are silent in-game — you get
// no exception, just a horse standing rigidly still in the middle of a charge.
//
// run: node games/colosseum/tools/verify_rig.mjs <glb> [--bone Back] [--clip Gallop]

import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const args = process.argv.slice(2);
const file = args[0];
const argOf = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const wantBone = argOf("--bone");
const wantClip = argOf("--clip");

if (!file) { console.log("usage: verify_rig.mjs <glb> [--bone <name>] [--clip <name>]"); process.exit(2); }

const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log("  FAIL: " + msg); } else console.log("  ok   " + msg); };

new GLTFLoader().parse(ab, "", (gltf) => {
  const skinned = [];
  let draws = 0, tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o);
    if (o.isMesh) {
      draws++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });

  console.log(`\nverify_rig ${file}`);
  ok(draws === 1, `one draw call (found ${draws})`);
  ok(skinned.length > 0, `has a skinned mesh (${skinned.length})`);
  if (!skinned.length) { process.exit(1); }

  const skel = skinned[0].skeleton;
  ok(skel.bones.length > 0, `skeleton has bones (${skel.bones.length})`);
  ok(!!skinned[0].geometry.attributes.color, "COLOR_0 present (materials were baked to vertex colour)");
  ok(gltf.animations.length > 0, `carries clips (${gltf.animations.length})`);
  console.log(`       clips: ${gltf.animations.map((a) => a.name).join(", ")}`);

  if (wantBone) ok(!!skel.bones.find((b) => b.name === wantBone), `bone "${wantBone}" present`);

  // The real test: drive a clip and measure that a bone actually moved.
  const clip = wantClip
    ? gltf.animations.find((a) => a.name.toLowerCase().includes(wantClip.toLowerCase()))
    : gltf.animations[0];
  ok(!!clip, `clip ${wantClip ? `"${wantClip}"` : "(first)"} found`);
  if (clip) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    const probe = (wantBone && skel.bones.find((b) => b.name === wantBone)) || skel.bones[0];
    gltf.scene.updateMatrixWorld(true);
    const a = new THREE.Vector3().setFromMatrixPosition(probe.matrixWorld);
    mixer.update(0.4);
    gltf.scene.updateMatrixWorld(true);
    const b = new THREE.Vector3().setFromMatrixPosition(probe.matrixWorld);
    const moved = a.distanceTo(b);
    ok(moved > 1e-4, `clip "${clip.name}" deforms bone "${probe.name}" (moved ${moved.toFixed(4)})`);
  }

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const s = box.getSize(new THREE.Vector3());
  console.log(`       span: ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m, ${tris} tris`);

  console.log(failed ? `\nVERIFY_RIG: FAIL (${failed})` : "\nVERIFY_RIG: PASS");
  process.exit(failed ? 1 : 0);
}, (e) => { console.log("GLTFLoader PARSE FAILED:", (e && e.message) || e); process.exit(1); });
