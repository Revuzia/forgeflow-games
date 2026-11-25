#!/usr/bin/env node
// VALE art (orch1 W3-B FU-8, ruling 69): the line-of-action re-key on a SHIPPED fighter GLB's own clip data, in place (no
// texture re-encode, no mesh re-quantize, the other clips untouched). The same re-key as anim.py line_of_action (which a
// rebuild applies through LOA_REKEY), done on the shipped keys because a clip regenerated from the cached rig does not
// match the shipped one for seven fighters (hand and wrist fixes made on their GLBs after the build):
//   * counter-twist: spine and chest turn AWAY from the strike's own turn (read from the clip: the shoulder line's yaw at the
//     impact against frame 0) by up to `twist` deg, half each, about each bone's own axis; the head counter-turns 30 % to
//     hold its gaze; wound up over 0.05-0.27 of the clip, held to 0.30, unwound on an accelerating ease into the impact
//     (IMPACT 0.4, unchanged). The hips and the planted feet stay as keyed.
//   * impact hold: the impact pose held `hold` frames (30 fps), the follow-through after it compressed into what is left.
// Every channel of the clip is re-sampled at 30 fps through the hold's time map, thinned back to the build's linear
// tolerance (1e-4) and written as the build writes rotations (normalized int16).
//
//   node art/blender/fighters/_loa_rekey.mjs <shipped.glb> clip:twist:hold[:side -1][,...] [--budget-kb 1172] [--tol 1e-4]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { AnimationMixer, PropertyBinding, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [file, spec] = args;
const budget = Number(opt('--budget-kb', '1172'));
const jobs = spec.split(',').map((s) => { const [clip, tw, hold, side] = s.split(':'); return { clip, tw: Number(tw), hold: Number(hold), side: side ? Number(side) : 0 }; });
const IMPACT = 0.4, FPS = 30, TOL = Number(opt('--tol', '1e-4'));
const SHARE = { spine: 0.5, chest: 0.5, head: -0.3 };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before = statSync(file).size;
const doc = await io.read(file);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

// three, for the strike's turn and which way a +Y twist of the chest turns the shoulder line (textures stripped)
const probeDoc = await io.read(file);
for (const t of probeDoc.getRoot().listTextures()) t.dispose();
const glb = await io.writeBinary(probeDoc);
const g = await new Promise((res, rej) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res, rej));
const tn = (n) => g.scene.getObjectByName(PropertyBinding.sanitizeNodeName(n)) ?? g.scene.getObjectByName(n);
const shoulderYaw = () => { g.scene.updateMatrixWorld(true); const a = tn('upper_arm.L').getWorldPosition(new Vector3()), b = tn('upper_arm.R').getWorldPosition(new Vector3()); return Math.atan2(b.z - a.z, b.x - a.x); };
const wrap = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t), easeIn = (t) => t * t * t;
const env = (t) => {
  if (t < 0.05) return 0;
  if (t < 0.27) return sine((t - 0.05) / 0.22);
  if (t < 0.3) return 1;
  if (t < IMPACT) return 1 - easeIn((t - 0.3) / (IMPACT - 0.3));
  return 0;
};

/** a sampler's value at time t (linear; quaternions nlerp'd in one hemisphere), de-normalized */
function sampleAt(s, t, size) {
  const tin = s.getInput().getArray(), out = s.getOutput(), n = tin.length;
  const a = [], b = [];
  let i = 0;
  while (i < n - 1 && tin[i + 1] <= t + 1e-6) i++;
  if (s.getInterpolation() === 'STEP') { out.getElement(i, a); return a; }
  const j = Math.min(n - 1, i + 1);
  const u = tin[j] > tin[i] ? Math.min(1, Math.max(0, (t - tin[i]) / (tin[j] - tin[i]))) : 0;
  out.getElement(i, a); out.getElement(j, b);
  if (size === 4 && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) for (let k = 0; k < 4; k++) b[k] = -b[k];
  const v = a.map((x, k) => x + (b[k] - x) * u);
  if (size === 4) { const l = Math.hypot(...v); return v.map((x) => x / l); }
  return v;
}

/** greedy linear thinning: keep the keys a straight line between kept keys cannot reproduce within TOL */
function thin(times, vals, size, step = false) {
  if (step) {           // a STEP track keeps the keys where its value changes
    const keep = [0];
    for (let i = 1; i < times.length; i++) for (let c = 0; c < size; c++) if (vals[i * size + c] !== vals[(i - 1) * size + c]) { keep.push(i); break; }
    return keep;
  }
  const keep = [0];
  let last = 0;
  for (let i = 2; i < times.length; i++) {
    let ok = true;
    for (let k = last + 1; k < i && ok; k++) {
      const u = (times[k] - times[last]) / (times[i] - times[last]);
      for (let c = 0; c < size; c++) {
        const lin = vals[last * size + c] + (vals[i * size + c] - vals[last * size + c]) * u;
        if (Math.abs(lin - vals[k * size + c]) > TOL) { ok = false; break; }
      }
    }
    if (!ok) { keep.push(i - 1); last = i - 1; }
  }
  keep.push(times.length - 1);
  return [...new Set(keep)];
}

const report = {};
for (const job of jobs) {
  const anim = root.listAnimations().find((a) => a.getName() === job.clip);
  const tclip = g.animations.find((c) => c.name === job.clip);
  if (!anim || !tclip) throw new Error(`${file}: no clip ${job.clip}`);
  const dur = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]));
  const N = Math.round(dur * FPS), h = job.hold / N;
  // the hold's time map, on the clip's normalized time u (0..1)
  const remapU = (u) => (h <= 0 || u <= IMPACT ? u : u <= IMPACT + h ? IMPACT : IMPACT + (u - IMPACT - h) * (1 - IMPACT) / (1 - IMPACT - h));
  // the strike's turn (shoulder line, impact vs frame 0) and the shoulder turn of a +Y chest twist at the impact pose
  const mixer = new AnimationMixer(g.scene), act = mixer.clipAction(tclip); act.play();
  act.time = 0; mixer.update(0); const y0 = shoulderYaw();
  act.time = IMPACT * dur; mixer.update(0); const yi = shoulderYaw();
  const chestT = tn('chest'); const q0 = chestT.quaternion.clone();
  chestT.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2)); const yt = shoulderYaw(); chestT.quaternion.copy(q0);
  act.stop(); mixer.uncacheRoot(g.scene);
  const strike = Math.sign(wrap(yi - y0)) || 1, k = Math.sign(wrap(yt - yi)) || 1;
  // local +Y turns the shoulders by k; the wind-up turns them by -strike: local sign = -strike * k
  // `side` -1 winds the other way: a clip with no strike turn of its own (a raise) has no back to wind to, and a clip
  // whose own early turn already runs toward the strike reads its wind-up best the other way (probe_clip_line decides)
  const sgn = -strike * k * (job.side || 1);
  const times = Array.from({ length: N + 1 }, (_, i) => Math.min(dur, i / FPS));
  const nodeOf = new Map(anim.listChannels().map((c) => [`${c.getTargetNode().getName()}:${c.getTargetPath()}`, c]));
  const newAnim = doc.createAnimation(job.clip);
  const timeAcc = new Map();
  let bytes = 0, chans = 0;
  const addChannel = (node, path, vals, size, interp = 'LINEAR') => {
    const idx = thin(times, vals, size, interp === 'STEP');
    const t = new Float32Array(idx.map((i) => times[i]));
    let arr;
    if (path === 'rotation') {
      const f = idx.flatMap((i) => [vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]]);
      for (let i = 4; i < f.length; i += 4) { if (f[i] * f[i - 4] + f[i + 1] * f[i - 3] + f[i + 2] * f[i - 2] + f[i + 3] * f[i - 1] < 0) for (let c = 0; c < 4; c++) f[i + c] = -f[i + c]; }
      arr = new Int16Array(f.map((x) => Math.max(-32767, Math.min(32767, Math.round(x * 32767)))));
    } else arr = new Float32Array(idx.flatMap((i) => Array.from({ length: size }, (_, c) => vals[i * size + c])));
    // channels that keep the same keys share one time accessor (as the build's resample leaves them)
    const tk = idx.join(',');
    let ti = timeAcc.get(tk);
    if (!ti) { ti = doc.createAccessor().setType('SCALAR').setArray(t).setBuffer(buffer); timeAcc.set(tk, ti); bytes += t.byteLength; }
    const out = doc.createAccessor().setType(size === 4 ? 'VEC4' : 'VEC3').setArray(arr).setNormalized(arr instanceof Int16Array).setBuffer(buffer);
    const s = doc.createAnimationSampler().setInput(ti).setOutput(out).setInterpolation(interp);
    newAnim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));
    bytes += arr.byteLength; chans++;
  };
  const twisted = new Set();
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath(), s = ch.getSampler();
    const interp = s.getInterpolation();
    if (interp !== 'LINEAR' && interp !== 'STEP') throw new Error(`${job.clip}: ${interp} sampler`);
    const size = path === 'rotation' ? 4 : 3;
    const vals = [];
    const share = path === 'rotation' ? SHARE[node.getName()] : undefined;
    for (const t of times) {
      const u = remapU(t / dur);
      let v = sampleAt(s, u * dur, size);
      if (share !== undefined && job.tw > 0) {
        const a = sgn * share * job.tw * env(u) * Math.PI / 180;
        const q = new Quaternion(v[0], v[1], v[2], v[3]).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
        v = [q.x, q.y, q.z, q.w];
      }
      vals.push(...v);
    }
    if (share !== undefined) twisted.add(node.getName());
    addChannel(node, path, vals, size, interp);
  }
  // a twisted bone the clip held at rest (its channel dropped by the build) gets one, from its rest rotation
  if (job.tw > 0) for (const name of Object.keys(SHARE)) {
    if (twisted.has(name) || nodeOf.has(`${name}:rotation`)) continue;
    const node = root.listNodes().find((n) => n.getName() === name);
    if (!node) continue;
    const r = node.getRotation(), vals = [];
    for (const t of times) { const a = sgn * SHARE[name] * job.tw * env(remapU(t / dur)) * Math.PI / 180; const q = new Quaternion(...r).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)); vals.push(q.x, q.y, q.z, q.w); }
    addChannel(node, 'rotation', vals, 4);
  }
  for (const s of anim.listSamplers()) { const i = s.getInput(), o = s.getOutput(); s.dispose(); if (o && o.listParents().length <= 1) o.dispose(); if (i && i.listParents().length <= 1) i.dispose(); }
  anim.dispose();
  report[job.clip] = { twist: job.tw, hold: job.hold, sign: sgn, channels: chans, bytes };
}
for (const a of root.listAccessors()) if (a.listParents().every((p) => p === root)) a.dispose();
const tmp = `${file}.loa.tmp`;
writeFileSync(tmp, await io.writeBinary(doc));
const after = statSync(tmp).size, over = after > budget * 1024;
if (over) { unlinkSync(tmp); console.error(`over budget: ${(after / 1024).toFixed(1)} KiB > ${budget}; ${file} left as it was`); }
else renameSync(tmp, file);
console.log(JSON.stringify({ file, before, after, delta: after - before, over, clips: report }));
process.exit(over ? 1 : 0);
