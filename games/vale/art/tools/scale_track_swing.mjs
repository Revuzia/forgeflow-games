#!/usr/bin/env node
// VALE art: widen one baked bone's rotation swing in one clip of a shipped GLB, in place: each key's quaternion moves
// away from the track's mean rotation by `--k` (a slerp past 1 about the mean). Everything else is untouched: no texture
// re-encode, no key count change; the output accessor is rewritten at its own component type. For a spring chain whose
// bake landed just short of its target (closing CW5 refix 2, Burdam's cowl_b run swing 9.5 deg, target >= 10), without
// paying a 30-minute rebuild. The chain's source constant must move too, so the next full build lands there on its own.
//
//   node art/tools/scale_track_swing.mjs art/out/fighters/burdam/burdam.glb --clip run --node x_cowl_b_1 --k 1.1
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const input = args[0];
const clipName = opt('--clip', 'run');
const nodeName = opt('--node', null);
const k = Number(opt('--k', 1.0));
if (!input || !nodeName || !(k > 0)) {
  console.error('usage: node art/tools/scale_track_swing.mjs in.glb --clip run --node x_cowl_b_1 --k 1.1');
  process.exit(2);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
if (!anim) throw new Error(`no clip ${clipName}`);
const ch = anim.listChannels().find((c) => c.getTargetPath() === 'rotation' && c.getTargetNode()?.getName() === nodeName);
if (!ch) throw new Error(`no rotation channel for ${nodeName} in ${clipName}`);
const sampler = ch.getSampler();
const out = sampler.getOutput();
const n = out.getCount();
const q = [];
for (let i = 0; i < n; i++) q.push(out.getElement(i, [0, 0, 0, 0]));

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const mean = norm(q.reduce((s, v) => { const f = dot(v, q[0]) < 0 ? -1 : 1; return s.map((x, i) => x + f * v[i]); }, [0, 0, 0, 0]));
let before = 0;
let after = 0;
const fresh = q.map((v) => {
  const a = dot(v, mean) < 0 ? v.map((x) => -x) : v;
  const d = Math.min(1, dot(a, mean));
  const th = Math.acos(d);
  before = Math.max(before, th);
  if (th < 1e-6) return a;
  const s = Math.sin(th);
  const w0 = Math.sin((1 - k) * th) / s;
  const w1 = Math.sin(k * th) / s;
  after = Math.max(after, k * th);
  return norm(a.map((x, i) => w0 * mean[i] + w1 * x));
});
// a sampler output may be shared with another channel or clip: this one gets its own copy
const copy = out.clone();
fresh.forEach((v, i) => copy.setElement(i, v));
sampler.setOutput(copy);
await io.write(input, doc);
const deg = (r) => (r * 180 / Math.PI).toFixed(2);
console.log(`${input}: ${clipName}/${nodeName} ${n} keys, max deviation from the mean ${deg(before)} -> ${deg(after)} deg (k ${k})`);
