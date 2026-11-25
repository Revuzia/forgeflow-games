#!/usr/bin/env node
// VALE art (W3-B, ruling 68): copy named animations from an animation-only GLB (art/blender/fighters/_motion_pass.py) into a
// shipped fighter GLB, in place, by node name. Nothing else in the shipped file changes: no texture re-encode, no mesh
// re-quantize, the other clips untouched. The copied clips get the build's own animation treatment (art/tools/optimize.mjs:
// rest-track drop, resample at 1e-4, rotations as normalized int16), and optionally every Nth key (--every clip=n, for
// slow loops; art/tools/decimate_chains.mjs does the same to chain tracks).
//
//   node art/blender/fighters/_motion_merge.mjs <shipped.glb> <anim.glb> walk,sprint,airborne,sleep [--every sleep=3,walk=1]
//        [--budget-kb 1172] [--fill-from run]
// A clip of the same name in the shipped GLB is replaced. Exit 1 when the result is over --budget-kb (the file is then
// left as it was).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample } from '@gltf-transform/functions';
import { statSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [target, source, list] = args;
const names = list.split(',');
const every = Object.fromEntries((opt('--every', '') || '').split(',').filter(Boolean).map((s) => { const [k, v] = s.split('='); return [k, Number(v)]; }));
const budget = Number(opt('--budget-kb', '0'));
const EPS = 1e-5;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before = statSync(target).size;
const src = await io.read(source);
// the build's treatment on the float source: drop channels that hold a node at its rest TRS, then the linear resample
for (const anim of src.getRoot().listAnimations()) {
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath(), s = ch.getSampler();
    if (!node || !s || path === 'weights') continue;
    const out = s.getOutput();
    const rest = path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale();
    const el = [];
    let constant = true;
    for (let i = 0; i < out.getCount() && constant; i++) {
      out.getElement(i, el);
      const same = (sg) => rest.every((r, k) => Math.abs(sg * el[k] - r) <= EPS);
      if (!same(1) && !(path === 'rotation' && same(-1))) constant = false;
    }
    if (constant) ch.dispose();
  }
}
if (args.includes('--resample')) await src.transform(resample({ tolerance: 1e-4 }));

const doc = await io.read(target);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const report = {};
for (const name of names) {
  const a = src.getRoot().listAnimations().find((x) => x.getName() === name);
  if (!a) throw new Error(`${source}: no clip ${name}`);
  for (const old of root.listAnimations().filter((x) => x.getName() === name)) {
    for (const s of old.listSamplers()) { const i = s.getInput(), o = s.getOutput(); s.dispose(); if (o && o.listParents().length <= 1) o.dispose(); if (i && i.listParents().length <= 1) i.dispose(); }
    old.dispose();
  }
  const anim = doc.createAnimation(name);
  const step = every[name] ?? 1;
  const times = new Map();
  let bytes = 0, chans = 0;
  for (const ch of a.listChannels()) {
    const n = ch.getTargetNode();
    const tn = n && nodes.get(n.getName());
    if (!tn) { if (n) throw new Error(`${target}: no node ${n.getName()}`); continue; }
    const s = ch.getSampler(), inp = s.getInput(), out = s.getOutput();
    const N = inp.getCount();
    const idx = [];
    for (let i = 0; i < N; i += step) idx.push(i);
    if (idx[idx.length - 1] !== N - 1) idx.push(N - 1);
    let ti = times.get(inp);
    if (!ti) {
      const t = inp.getArray(), arr = new Float32Array(idx.length);
      idx.forEach((k, j) => { arr[j] = t[k]; });
      ti = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer);
      times.set(inp, ti); bytes += arr.byteLength;
    }
    const o = out.getArray(), w = out.getElementSize();
    let arr;
    if (ch.getTargetPath() === 'rotation') {
      // successive quaternions in one hemisphere, then normalized int16 (optimize.mjs rotations16)
      const f = new Float32Array(idx.length * 4);
      idx.forEach((k, j) => { for (let c = 0; c < 4; c++) f[j * 4 + c] = o[k * 4 + c]; });
      for (let i = 4; i < f.length; i += 4) {
        const d = f[i] * f[i - 4] + f[i + 1] * f[i - 3] + f[i + 2] * f[i - 2] + f[i + 3] * f[i - 1];
        if (d < 0) for (let c = 0; c < 4; c++) f[i + c] = -f[i + c];
      }
      arr = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) arr[i] = Math.max(-32767, Math.min(32767, Math.round(f[i] * 32767)));
    } else {
      arr = new Float32Array(idx.length * w);
      idx.forEach((k, j) => { for (let c = 0; c < w; c++) arr[j * w + c] = o[k * w + c]; });
    }
    const acc = doc.createAccessor().setType(out.getType()).setArray(arr).setNormalized(arr instanceof Int16Array).setBuffer(buffer);
    bytes += arr.byteLength;
    const sampler = doc.createAnimationSampler().setInput(ti).setOutput(acc).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(tn).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    chans++;
  }
  // --fill-from <clip>: a node the shipped <clip> animates and the new clip does not (a prop socket a fighter script or a
  // later GLB fix set in every clip; a channel the rest-track drop removed from the new one) would fall back to its rest
  // pose while the new clip plays: it gets <clip>'s channel, its keys time-scaled to the new clip's length (the output
  // accessor shared, so only the times cost bytes)
  let filled = 0;
  const fillFrom = opt('--fill-from', '');
  const ref = fillFrom && root.listAnimations().find((x) => x.getName() === fillFrom);
  if (ref) {
    const have = new Set(anim.listChannels().map((c) => `${c.getTargetNode().getName()}:${c.getTargetPath()}`));
    const dur = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]));
    const rdur = Math.max(...ref.listSamplers().map((s) => s.getInput().getMax([])[0]));
    const scaled = new Map();
    for (const ch of ref.listChannels()) {
      const key = `${ch.getTargetNode().getName()}:${ch.getTargetPath()}`;
      if (have.has(key)) continue;
      const s = ch.getSampler(), inp = s.getInput();
      let ti = scaled.get(inp);
      if (!ti) {
        const t = inp.getArray(), arr = new Float32Array(t.length);
        for (let i = 0; i < t.length; i++) arr[i] = (t[i] / rdur) * dur;
        ti = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer);
        scaled.set(inp, ti); bytes += arr.byteLength;
      }
      const sampler = doc.createAnimationSampler().setInput(ti).setOutput(s.getOutput()).setInterpolation(s.getInterpolation());
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(sampler));
      filled++;
    }
  }
  report[name] = { channels: chans, filled, bytes, every: step };
}
const tmp = `${target}.merge.tmp`;
writeFileSync(tmp, await io.writeBinary(doc));
const after = statSync(tmp).size;
const over = budget > 0 && after > budget * 1024;
if (over) { console.error(`over budget: ${(after / 1024).toFixed(1)} KiB > ${budget} KiB; ${target} left as it was`); }
else renameSync(tmp, target);
console.log(JSON.stringify({ target, before, after, deltaBytes: after - before, clips: report, over }));
if (over) { try { unlinkSync(tmp); } catch { /* */ } process.exit(1); }
