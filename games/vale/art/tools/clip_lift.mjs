#!/usr/bin/env node
// VALE art: raise a bone's translation track inside one clip of a shipped GLB, in place, by a world-space amount eased
// in over a time window (nothing else changes: no texture re-encode, no re-quantize). For a corpse hold a few cm through
// the floor when the rebuild budget is spent (closing CW5 r2, Ardit's death: left pauldron -0.11 m in the hold).
//
//   node art/tools/clip_lift.mjs art/out/fighters/ardit/ardit.glb --clip death --bone hips --dy 0.125 --from 0.60 --to 0.80
//
// --from / --to are fractions of the clip's duration: 0 before, full --dy after, smoothstep between. Measure with
// art/tools/clip_floor.py afterwards.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const file = args[0];
const clipName = opt('--clip');
const boneName = opt('--bone', 'hips');
const dy = Number(opt('--dy', '0'));
const from = Number(opt('--from', '0'));
const to = Number(opt('--to', '1'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before = statSync(file).size;
const doc = await io.read(file);
const root = doc.getRoot();
const anim = root.listAnimations().find((a) => a.getName() === clipName);
if (!anim) throw new Error(`no clip ${clipName}`);
const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === boneName && c.getTargetPath() === 'translation');
if (!ch) throw new Error(`no translation track on ${boneName} in ${clipName}`);
const node = ch.getTargetNode();
const parent = node.getParentNode();
const local = new THREE.Vector3(0, dy, 0);
if (parent) {
  const m = new THREE.Matrix4().fromArray(parent.getWorldMatrix());
  local.applyMatrix4(m.clone().setPosition(0, 0, 0).invert());
}
const s = ch.getSampler();
const times = s.getInput().getArray();
const src = s.getOutput();
const dur = Math.max(...times);
// a private float copy: the output accessor may be shared with another clip, and may be quantized
const n = src.getCount();
const out = new Float32Array(n * 3);
const v = [0, 0, 0];
for (let i = 0; i < n; i++) {
  src.getElement(i, v);
  const u = Math.min(1, Math.max(0, (times[i] / dur - from) / (to - from)));
  const k = u * u * (3 - 2 * u);
  out[i * 3] = v[0] + local.x * k;
  out[i * 3 + 1] = v[1] + local.y * k;
  out[i * 3 + 2] = v[2] + local.z * k;
}
const acc = doc.createAccessor(`${clipName}_${boneName}_lift`).setType('VEC3').setArray(out).setBuffer(src.getBuffer() ?? root.listBuffers()[0]);
s.setOutput(acc);
await io.write(file, doc);
console.log(`[clip_lift] ${clipName}/${boneName} dy ${dy} m over ${from}..${to} (${n} keys, local ${local.toArray().map((x) => x.toFixed(4))}); ${(before / 1024).toFixed(1)} -> ${(statSync(file).size / 1024).toFixed(1)} KiB`);
