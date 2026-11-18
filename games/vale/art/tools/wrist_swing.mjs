#!/usr/bin/env node
// VALE art: clamp the wrist bend of a shipped fighter GLB's clips (orch1 W2-C, FU-10).
//
// Lisvel's clips bent the hand 113-119 deg off the forearm axis (a real wrist reaches ~70-80), and a linear-blend wrist
// folds well before that: after the weights smoothing (art/tools/hand_weights.mjs) the hand-integrity probe still read
// 2005 edges outside 0.4-1.6x. Per hand key: D = q_hand * r_hand^-1 = swing * twist (twist about the forearm's +Y); a swing
// over --max (default 60 deg) is slerped back to it, the twist kept. The prop under the hand takes the difference
// (prop' = hand'^-1 * hand * prop), so a held weapon keeps its world turn. anim.clamp_wrist_swing does the same at clip
// bake time, so a rebuilt GLB matches. --no-prop leaves the prop track alone.
//
//   node art/tools/wrist_swing.mjs in.glb [out.glb] [--max 60] [--no-prop] [--dry]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion } from 'three';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--max');
const [input, output = input] = files;
const MAX = Number(opt('--max', 60)) * Math.PI / 180;
const DRY = args.includes('--dry');
const PROP = !args.includes('--no-prop');
if (!input) {
  console.error('usage: node art/tools/wrist_swing.mjs in.glb [out.glb] [--max 60] [--no-prop] [--dry]');
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


let moved = 0, maxBefore = 0, maxAfter = 0, propTracks = 0;
for (const side of ['L', 'R']) {
  const hN = node(`hand.${side}`), pN = node(`prop.${side}`);
  if (!hN) continue;
  const rH = new Quaternion(...hN.getRotation());
  const rHi = rH.clone().invert();
  for (const anim of root.listAnimations()) {
    const chs = anim.listChannels().filter((c) => c.getTargetPath() === 'rotation');
    const hc = chs.find((c) => c.getTargetNode() === hN);
    if (!hc) continue;
    let pc = pN ? chs.find((c) => c.getTargetNode() === pN) : null;
    const hs = hc.getSampler();
    let ps = pc ? pc.getSampler() : null;
    const times = [...new Set([...hs.getInput().getArray(), ...(ps ? ps.getInput().getArray() : [])].map((x) => +x.toFixed(6)))].sort((a, b) => a - b);
    const hq = [], pq = [];
    let any = false;
    for (const t of times) {
      const h = sample(hs, t);
      const D = h.clone().multiply(rHi);
      const tw = twistY(D);
      const sw = D.clone().multiply(tw.clone().invert());
      const ang = 2 * Math.acos(Math.min(1, Math.abs(sw.w)));
      maxBefore = Math.max(maxBefore, ang);
      let h2 = h;
      if (ang > MAX) {
        any = true;
        const sw2 = new Quaternion().slerp(sw, MAX / ang);
        h2 = sw2.multiply(tw).multiply(rH);
      }
      maxAfter = Math.max(maxAfter, Math.min(ang, MAX));
      hq.push(h2);
      if (pN) {
        const p = ps ? sample(ps, t) : new Quaternion(...pN.getRotation());
        pq.push(PROP ? h2.clone().invert().multiply(h).multiply(p) : p);
      }
    }
    if (!any) continue;
    moved++;
    const own = [...new Set(anim.listSamplers().map((x) => x.getInput()))];
    if (DRY) continue;
    writeQuats(doc, hs, times, hq, hs.getOutput(), own);
    if (pN && PROP) {
      propTracks++;
      if (!ps) {
        ps = doc.createAnimationSampler();
        anim.addSampler(ps);
        pc = doc.createAnimationChannel().setTargetNode(pN).setTargetPath('rotation').setSampler(ps);
        anim.addChannel(pc);
        writeQuats(doc, ps, times, pq, hs.getOutput(), own);
      } else writeQuats(doc, ps, times, pq, ps.getOutput(), own);
    }
  }
}
const deg = (r) => ((r * 180) / Math.PI).toFixed(0);
console.log(`wrist_swing: ${input}: ${moved} hand tracks clamped, wrist swing max ${deg(maxBefore)} -> ${deg(maxAfter)} deg, ${propTracks} prop tracks keep their world turn${DRY ? ' (dry run)' : ''}`);
if (!DRY) {
  for (const a of root.listAccessors()) if (!a.listParents().some((p) => p !== root)) a.dispose();
  await io.write(output, doc);
}
