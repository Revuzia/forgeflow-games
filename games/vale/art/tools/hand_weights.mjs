#!/usr/bin/env node
// VALE art: wrist weights on a shipped fighter GLB (orch1 W2-C, FU-10).
//
// Bone-heat weights leave the palm of Kemdo, Lisvel, Marund, Ulkro and Vashil (and their skins) split between hand and
// forearm, so a bent wrist folds the palm itself (the hand-integrity probe read edges down to 0.15x rest). The fighters
// whose hands were already rigid (Odrum, Rishal, Sukri, Tunlan) read exactly 1.0x in every clip. This remaps the hand
// share h of every vertex weighted only to one side's forearm + hand bones to smoothstep(--lo, --hi, h): the palm
// (h >= hi) goes rigid and the wrist blend is re-spread over the band below it instead of ending in a one-ring seam.
// Props (weapons, staffs) keep their weights. mesh.wrist_remap does the same at rig time, so a rebuilt GLB matches.
//
//   node art/tools/hand_weights.mjs in.glb [out.glb] [--lo 0.1] [--hi 0.5] [--dry]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2);
const VAL = new Set(['--lo', '--hi']);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !VAL.has(args[i - 1]));
const [input, output = input] = files;
const LO = Number(opt('--lo', 0.1)), HI = Number(opt('--hi', 0.5));
const DRY = args.includes('--dry');
if (!input) {
  console.error('usage: node art/tools/hand_weights.mjs in.glb [out.glb] [--lo 0.1] [--hi 0.5] [--dry]');
  process.exit(2);
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
let changed = 0, total = 0;
const seen = new Set();
for (const n of root.listNodes().filter((x) => x.getSkin() && x.getMesh())) {
  const name = n.getSkin().listJoints().map((j) => j.getName());
  const role = name.map((x) => { const m = /^(forearm|hand|prop)\.([LR])$/.exec(x); return m ? { part: m[1], side: m[2] } : null; });
  for (const prim of n.getMesh().listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W || seen.has(W)) continue;
    seen.add(W);
    const quant = W.getNormalized() ? (W.getComponentType() === 5121 ? 255 : 65535) : 0;
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let v = 0; v < W.getCount(); v++) {
      total++;
      J.getElement(v, j); W.getElement(v, w);
      const sum = w.reduce((a, b) => a + b, 0) || 1;
      const s = ['L', 'R'].find((x) => w.reduce((a, y, k) => a + (y > 0 && role[j[k]]?.side === x && role[j[k]].part !== 'prop' ? y : 0), 0) / sum >= 0.999);
      if (!s) continue;
      const old = w.map((x) => x / sum);
      const hOld = old.reduce((a, x, k) => a + (role[j[k]]?.part === 'hand' ? x : 0), 0);
      if (hOld <= 0 || hOld >= 1) continue;
      const hNew = smooth(LO, HI, hOld);
      if (Math.abs(hNew - hOld) < 0.5 / 255) continue;
      const fOld = 1 - hOld;
      let out = old.map((x, k) => (role[j[k]]?.part === 'hand' ? (x / hOld) * hNew : (x / fOld) * (1 - hNew)));
      if (quant) {
        out = out.map((x) => Math.round(x * quant));
        const err = quant - out.reduce((a, b) => a + b, 0);
        out[out.indexOf(Math.max(...out))] += err;
        out = out.map((x) => x / quant);
      }
      W.setElement(v, out);
      changed++;
    }
  }
}
console.log(`${input}: ${changed} of ${total} skinned vertices re-weighted at the wrist (smoothstep ${LO}-${HI})${DRY ? ' [dry]' : ''}`);
if (!DRY && changed) await io.write(output, doc);
