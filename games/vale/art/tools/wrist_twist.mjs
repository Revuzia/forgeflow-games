#!/usr/bin/env node
// VALE art: spread the wrist twist of a shipped fighter GLB's clips onto the forearm (orch1 W2-C, FU-10).
//
// The rig has no twist bones and three.js skins linearly, so a hand that turns ~180 degrees about the arm axis
// relative to the forearm pinches the 50/50 wrist band to a point (the "candy wrapper"): _harness/clip_probe_hands.mjs
// measured hand-band edges down to 0.06x rest on Kemdo, Lisvel, Marund, Ulkro and Vashil. Anatomically the forearm
// does that turning (pronation / supination), so this moves a share `--k` (default 0.5) of the hand's twist about
// the forearm axis onto the forearm bone itself:
//
//     D  = q_hand * r_hand^-1          (the hand's turn from rest, in the forearm frame)
//     t  = twist of D about +Y         (the forearm's long axis; the wrist joint sits on it)
//     Q  = t^k
//     forearm' = forearm * Q,  hand' = Q^-1 * hand
//
// Q is a rotation about the forearm's own +Y and the wrist sits on +Y, so the hand's world transform (and the prop
// and anything else under it) is exactly unchanged; only the forearm mesh rolls about its own axis and the elbow
// band takes the other share of the turn. Idempotent in practice: a second pass moves at most k of what is left.
// anim.spread_wrist_twist does the same at clip-bake time, so a rebuilt GLB matches.
//
//   node art/tools/wrist_twist.mjs in.glb [out.glb] [--k 0.5] [--dry]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion } from 'three';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--k');
const [input, output = input] = files;
const K = Number(opt('--k', 0.5));
const DRY = args.includes('--dry');
if (!input) {
  console.error('usage: node art/tools/wrist_twist.mjs in.glb [out.glb] [--k 0.5] [--dry]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const node = (n) => root.listNodes().find((x) => x.getName() === n);

function sample(s, t) {
  const inp = s.getInput().getArray();
  const out = s.getOutput();
  const get = (k) => new Quaternion(...out.getElement(k, [0, 0, 0, 0]));
  if (t <= inp[0]) return get(0);
  const last = inp.length - 1;
  if (t >= inp[last]) return get(last);
  let k = 0;
  while (k < last && inp[k + 1] < t - 1e-7) k++;
  if (Math.abs(inp[k + 1] - t) < 1e-7) return get(k + 1);
  if (s.getInterpolation() === 'STEP') return get(k);
  return get(k).slerp(get(k + 1), (t - inp[k]) / (inp[k + 1] - inp[k]));
}

function twistY(q) {
  const t = new Quaternion(0, q.y, 0, q.w);
  const n = Math.hypot(t.y, t.w);
  return n < 1e-9 ? new Quaternion() : t.set(0, t.y / n, 0, t.w / n);
}

const inputs = new Map();     // one time accessor per distinct key set (reuses the clip's own when it matches)
function timeAccessor(doc, times, buf, own) {
  const key = times.join(',');
  for (const a of own) if (a.getCount() === times.length && [...a.getArray()].map((x) => +x.toFixed(6)).join(',') === key) return a;
  if (!inputs.has(key)) inputs.set(key, doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf));
  return inputs.get(key);
}

function writeQuats(doc, s, times, quats, like, own) {
  const buf = like.getBuffer();
  const inp = timeAccessor(doc, times, buf, own);
  const ct = like.getComponentType();
  const norm = like.getNormalized();
  const arr = ct === 5122 ? new Int16Array(times.length * 4) : ct === 5120 ? new Int8Array(times.length * 4) : new Float32Array(times.length * 4);
  const out = doc.createAccessor().setType('VEC4').setArray(arr).setNormalized(norm).setBuffer(buf);
  let prev = null;
  quats.forEach((q, i) => {
    if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);      // keep the track on one hemisphere for slerp
    prev = q;
    out.setElement(i, [q.x, q.y, q.z, q.w]);                          // setElement re-encodes normalized ints
  });
  s.setInput(inp).setOutput(out).setInterpolation('LINEAR');
}

let moved = 0;
let maxBefore = 0;
let maxAfter = 0;
for (const side of ['L', 'R']) {
  const fN = node(`forearm.${side}`);
  const hN = node(`hand.${side}`);
  if (!fN || !hN) continue;
  const rH = new Quaternion(...hN.getRotation());
  const rHi = rH.clone().invert();
  for (const anim of root.listAnimations()) {
    const chs = anim.listChannels().filter((c) => c.getTargetPath() === 'rotation');
    const hc = chs.find((c) => c.getTargetNode() === hN);
    if (!hc) continue;
    let fc = chs.find((c) => c.getTargetNode() === fN);
    const hs = hc.getSampler();
    let fs = fc ? fc.getSampler() : null;
    const times = [...new Set([...hs.getInput().getArray(), ...(fs ? fs.getInput().getArray() : [])].map((x) => +x.toFixed(6)))].sort((a, b) => a - b);
    const fq = [];
    const hq = [];
    let any = false;
    for (const t of times) {
      const h = sample(hs, t);
      const f = fs ? sample(fs, t) : new Quaternion(...fN.getRotation());
      const D = h.clone().multiply(rHi);
      const tw = twistY(D);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(tw.w)));
      maxBefore = Math.max(maxBefore, ang);
      const Q = new Quaternion().slerp(tw, K);
      maxAfter = Math.max(maxAfter, ang * (1 - K));
      if (ang > 1e-3) any = true;
      fq.push(f.clone().multiply(Q));
      hq.push(Q.clone().invert().multiply(h));
    }
    if (!any) continue;
    moved++;
    const own = [...new Set(anim.listSamplers().map((x) => x.getInput()))];
    if (DRY) continue;
    writeQuats(doc, hs, times, hq, hs.getOutput(), own);
    if (!fs) {
      fs = doc.createAnimationSampler();
      anim.addSampler(fs);
      fc = doc.createAnimationChannel().setTargetNode(fN).setTargetPath('rotation').setSampler(fs);
      anim.addChannel(fc);
      writeQuats(doc, fs, times, fq, hs.getOutput(), own);
    } else {
      // a sampler shared by another channel would move that channel too: give the forearm its own
      writeQuats(doc, fs, times, fq, fs.getOutput(), own);
    }
  }
}
const deg = (r) => ((r * 180) / Math.PI).toFixed(0);
console.log(`wrist_twist: ${input}: ${moved} hand tracks, wrist twist max ${deg(maxBefore)} -> ${deg(maxAfter)} deg (k ${K})${DRY ? ' (dry run)' : ''}`);
if (!DRY) {
  // drop accessors the rewrite orphaned
  for (const a of root.listAccessors()) if (!a.listParents().some((p) => p !== root)) a.dispose();
  await io.write(output, doc);
}
