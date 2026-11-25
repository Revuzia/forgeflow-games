#!/usr/bin/env node
// VALE art: thin the baked secondary-motion chain tracks (x_<chain>_<n> rotation channels) of a shipped GLB to every
// `--every`th key (the first and last kept), in place, without touching anything else (no texture re-encode, no
// re-quantize: the rotation outputs keep their component type and normalized flag; the decimated time accessors are
// shared per source accessor). Spring chains are smooth, so linear interpolation over 2 frames holds them; the
// bytes go back to the GLB budget (closing CW5: Burdam's four skirt panels pushed the GLB past 1172 KiB).
//
// --clip a,b limits the thinning to those animations (with --prefix '' every bone's rotation in them: a long,
// slow one-shot such as a 7 s recall holds under linear interpolation over 2 frames too).
//
// --orm-q N also re-encodes the occlusion/roughness/metal texture (low-frequency data, WebP) at quality N.
// --normal-q N likewise the normal map (Ulkro, closing ULK-M2: the skirt and tail chains pushed the GLB past budget).
//
//   node art/tools/decimate_chains.mjs art/out/fighters/burdam/burdam.glb [out.glb] [--every 2] [--prefix x_skirt]
//        [--orm-q 40]
//
// The inverse (W3-B fix round 2, ruling 70): --restore-from <live.glb> --clip a,b puts back, in those clips, every rotation
// track that differs from the live GLB's by more than --restore-deg (default 0.5) at any of either file's keys, copied
// key for key (its time accessor shared per live accessor). --drop-clip walk removes clips (a body that does not play
// them, ruling 70) to pay for it. With either option no thinning runs.
//
//   node art/tools/decimate_chains.mjs burdam.glb --restore-from live/burdam.glb --clip idle_lobby,victory,recall
//        --drop-clip walk
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--every', '--prefix', '--orm-q', '--normal-q', '--clip', '--restore-from', '--restore-deg', '--drop-clip'].includes(args[i - 1])));
if (!files.length) {
  console.error('usage: node art/tools/decimate_chains.mjs in.glb [out.glb] [--every 2] [--prefix x_]');
  process.exit(2);
}
const [input, output = input] = files;
const every = Math.max(2, Number(opt('--every', 2)));
const prefix = opt('--prefix', 'x_');
const clipArg = opt('--clip', null);
const clips = clipArg ? new Set(clipArg.split(',')) : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const before = statSync(input).size;
const timeCache = new Map();
let tracks = 0;
let keysBefore = 0;
let keysAfter = 0;
const pick = (n) => {
  const idx = [];
  for (let i = 0; i < n; i += every) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
};
const restoreFrom = opt('--restore-from', null);
for (const anim of restoreFrom || args.includes('--drop-clip') ? [] : root.listAnimations()) {
  if (clips && !clips.has(anim.getName())) continue;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node || !node.getName().startsWith(prefix) || ch.getTargetPath() !== 'rotation') continue;
    const s = ch.getSampler();
    if (s.getInterpolation() !== 'LINEAR') continue;
    const inp = s.getInput();
    const out = s.getOutput();
    const n = inp.getCount();
    if (n < 4) continue;
    const idx = pick(n);
    let ni = timeCache.get(inp);
    if (!ni) {
      const a = inp.getArray();
      const arr = new a.constructor(idx.length);
      idx.forEach((k, j) => { arr[j] = a[k]; });
      ni = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer);
      timeCache.set(inp, ni);
    }
    const o = out.getArray();
    const w = out.getElementSize();
    const arr = new o.constructor(idx.length * w);
    idx.forEach((k, j) => { for (let c = 0; c < w; c++) arr[j * w + c] = o[k * w + c]; });
    const no = doc.createAccessor().setType(out.getType()).setArray(arr).setNormalized(out.getNormalized())
      .setBuffer(buffer);
    s.setInput(ni).setOutput(no);
    tracks++;
    keysBefore += n;
    keysAfter += idx.length;
  }
}
let restored = 0;
if (restoreFrom) {
  if (!clips) throw new Error('--restore-from needs --clip');
  const tol = Number(opt('--restore-deg', 0.5));
  const live = await io.read(restoreFrom);
  const liveTimes = new Map();
  const quat = (acc, i) => { const e = []; acc.getElement(i, e); const l = Math.hypot(...e) || 1; return e.map((x) => x / l); };
  const at = (s, t) => {           // the track's rotation at time t (linear, normalized lerp: enough to compare)
    const ti = s.getInput().getArray(), n = ti.length;
    if (t <= ti[0]) return quat(s.getOutput(), 0);
    if (t >= ti[n - 1]) return quat(s.getOutput(), n - 1);
    let i = 0; while (ti[i + 1] < t) i++;
    const a = quat(s.getOutput(), i), b = quat(s.getOutput(), i + 1);
    if (s.getInterpolation() === 'STEP') return a;
    const u = (t - ti[i]) / (ti[i + 1] - ti[i]);
    const sg = a.reduce((d, x, k) => d + x * b[k], 0) < 0 ? -1 : 1;
    const q = a.map((x, k) => x + (sg * b[k] - x) * u); const l = Math.hypot(...q); return q.map((x) => x / l);
  };
  const deg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((d, x, k) => d + x * b[k], 0)))) * 180 / Math.PI;
  for (const name of clips) {
    const la = live.getRoot().listAnimations().find((a) => a.getName() === name);
    const ha = root.listAnimations().find((a) => a.getName() === name);
    if (!la || !ha) { console.log(`[restore] ${name}: not in ${la ? input : restoreFrom}`); continue; }
    for (const lc of la.listChannels()) {
      if (lc.getTargetPath() !== 'rotation' || !lc.getTargetNode()) continue;
      const nodeName = lc.getTargetNode().getName();
      const node = root.listNodes().find((n) => n.getName() === nodeName);
      if (!node) continue;
      const ls = lc.getSampler();
      let hc = ha.listChannels().find((c) => c.getTargetPath() === 'rotation' && c.getTargetNode() === node);
      if (hc) {
        const hs = hc.getSampler();
        const times = new Set([...ls.getInput().getArray(), ...hs.getInput().getArray()]);
        let worst = 0;
        for (const t of times) worst = Math.max(worst, deg(at(ls, t), at(hs, t)));
        if (worst <= tol) continue;
      }
      let ti = liveTimes.get(ls.getInput());
      if (!ti) {
        const a = ls.getInput().getArray();
        ti = doc.createAccessor().setType('SCALAR').setArray(new a.constructor(a)).setBuffer(buffer);
        liveTimes.set(ls.getInput(), ti);
      }
      const lo = ls.getOutput(), oa = lo.getArray();
      const to = doc.createAccessor().setType(lo.getType()).setArray(new oa.constructor(oa)).setNormalized(lo.getNormalized())
        .setBuffer(buffer);
      if (hc) hc.getSampler().setInput(ti).setOutput(to).setInterpolation(ls.getInterpolation());
      else {
        const s = doc.createAnimationSampler().setInput(ti).setOutput(to).setInterpolation(ls.getInterpolation());
        ha.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(s));
      }
      restored++;
      keysAfter += ls.getInput().getCount();
    }
  }
}
const drop = (opt('--drop-clip', '') || '').split(',').filter(Boolean);
for (const a of root.listAnimations().filter((x) => drop.includes(x.getName()))) {
  console.log(`[decimate] dropped clip ${a.getName()}`);
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
const ormQ = opt('--orm-q', null);
if (ormQ) {
  const seen = new Set();
  for (const m of root.listMaterials()) {
    for (const t of [m.getOcclusionTexture(), m.getMetallicRoughnessTexture()]) {
      if (!t || seen.has(t) || t.getMimeType() !== 'image/webp') continue;
      seen.add(t);
      const b0 = t.getImage().byteLength;
      const img = await sharp(Buffer.from(t.getImage())).webp({ quality: Number(ormQ) }).toBuffer();
      t.setImage(new Uint8Array(img));
      console.log(`[decimate] ${t.getName()}: webp q${ormQ} ${(b0 / 1024).toFixed(1)} -> ${(img.byteLength / 1024).toFixed(1)} KiB`);
    }
  }
}
const normalQ = opt('--normal-q', null);
if (normalQ) {
  const seen = new Set();
  for (const m of root.listMaterials()) {
    const t = m.getNormalTexture();
    if (!t || seen.has(t) || t.getMimeType() !== 'image/webp') continue;
    seen.add(t);
    const b0 = t.getImage().byteLength;
    const img = await sharp(Buffer.from(t.getImage())).webp({ quality: Number(normalQ) }).toBuffer();
    t.setImage(new Uint8Array(img));
    console.log(`[decimate] ${t.getName()}: webp q${normalQ} ${(b0 / 1024).toFixed(1)} -> ${(img.byteLength / 1024).toFixed(1)} KiB`);
  }
}
for (const a of root.listAccessors()) {           // drop the accessors nothing references any more
  if (a.listParents().every((p) => p === root)) a.dispose();
}
await io.write(output, doc);
const after = statSync(output).size;
if (restoreFrom) console.log(`[restore] ${restored} rotation tracks put back from ${restoreFrom} (${keysAfter} keys)`);
else console.log(`[decimate] ${tracks} ${prefix}* rotation tracks, keys ${keysBefore} -> ${keysAfter} (every ${every}); ` +
  `${(before / 1024).toFixed(1)} -> ${(after / 1024).toFixed(1)} KiB`);
