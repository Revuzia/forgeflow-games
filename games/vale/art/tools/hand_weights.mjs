#!/usr/bin/env node
// VALE art: wrist weights on a shipped fighter GLB (orch1 W2-C, FU-10).
//
// Bone-heat weights leave the wrist band of Kemdo, Lisvel, Marund, Ulkro and Vashil (and their skins) with steps between
// neighbouring vertices (Lisvel: 0.94 next to 0.51 hand on a 16 mm edge), so a bent wrist folds the band (the
// hand-integrity probe read edges down to 0.10x rest). The fighters whose hands are rigid (Odrum, Rishal, Sukri, Tunlan)
// read exactly 1.0x and are untouched (no vertex has a hand share strictly between 0 and 1).
// This smooths the hand share h of every vertex weighted only to one side's forearm + hand bones (no prop: weapons keep
// their weights) over the mesh: the band (0 < h < 1, grown by --ring rings) gets --iter Jacobi passes of
// h += lambda * (mean of h over the one-ring - h), on positions welded across UV seams so a seam never opens.
// Measured on the 15 GLBs: sharpening the blend (rigid palm, smoothstep remaps, a distance blend along the forearm) made
// the hand band 9-60x worse; smoothing 10 x 0.5 on 2 rings took it 3570 -> 2005 and the forearm + hand band 63.9k ->
// 46.9k edges. The rest is the wrist's range (art/tools/wrist_swing.mjs). pipeline.build runs this on every export.
//
//   node art/tools/hand_weights.mjs in.glb [out.glb] [--iter 10] [--lambda 0.5] [--ring 2] [--dry]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2);
const VAL = new Set(['--iter', '--lambda', '--ring']);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !VAL.has(args[i - 1]));
const [input, output = input] = files;
const ITER = Number(opt('--iter', 10)), LAMBDA = Number(opt('--lambda', 0.5)), RING = Number(opt('--ring', 2));
const DRY = args.includes('--dry');
if (!input) {
  console.error('usage: node art/tools/hand_weights.mjs in.glb [out.glb] [--iter 10] [--lambda 0.5] [--ring 2] [--dry]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
let changed = 0, total = 0;
const seen = new Set();
for (const n of root.listNodes().filter((x) => x.getSkin() && x.getMesh())) {
  const name = n.getSkin().listJoints().map((j) => j.getName());
  const role = name.map((x) => { const m = /^(forearm|hand|prop)\.([LR])$/.exec(x); return m ? { part: m[1], side: m[2] } : null; });
  for (const prim of n.getMesh().listPrimitives()) {
    const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!P || !J || !W || seen.has(W)) continue;
    seen.add(W);
    const quant = W.getNormalized() ? (W.getComponentType() === 5121 ? 255 : 65535) : 0;
    const nv = W.getCount();
    total += nv;
    // welded vertices (UV seams split a position): one weight per position, so a seam never opens
    const key = new Map(), weld = new Int32Array(nv), pp = [0, 0, 0];
    for (let v = 0; v < nv; v++) {
      P.getElement(v, pp);
      const k = pp.map((x) => Math.round(x * 1e4)).join(',');
      if (!key.has(k)) key.set(k, key.size);
      weld[v] = key.get(k);
    }
    const nw = key.size;
    // per vertex: the side it belongs to (only that side's forearm + hand, no prop), its hand share
    const side = new Array(nv).fill(null), h = new Float64Array(nw).fill(-1), Jv = [], Wv = [];
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let v = 0; v < nv; v++) {
      J.getElement(v, j); W.getElement(v, w);
      Jv.push(j.slice()); Wv.push(w.slice());
      const sum = w.reduce((a, b) => a + b, 0) || 1;
      const s = ['L', 'R'].find((x) => w.reduce((a, y, k) => a + (y > 0 && role[j[k]]?.side === x && role[j[k]].part !== 'prop' ? y : 0), 0) / sum >= 0.999);
      if (!s) continue;
      side[v] = s;
      h[weld[v]] = w.reduce((a, y, k) => a + (role[j[k]]?.part === 'hand' ? y : 0), 0) / sum;
    }
    // adjacency over welded positions, forearm + hand vertices only
    const adj = Array.from({ length: nw }, () => new Set());
    const ind = prim.getIndices();
    const nt = ind ? ind.getCount() / 3 : nv / 3;
    for (let t = 0; t < nt; t++) {
      const c = [0, 1, 2].map((q) => (ind ? ind.getScalar(3 * t + q) : 3 * t + q));
      if (c.some((v) => !side[v])) continue;
      for (const a of c) for (const b of c) if (a !== b) adj[weld[a]].add(weld[b]);
    }
    // the band: welded vertices with a hand share strictly between 0 and 1, grown by RING rings
    let band = new Set();
    for (let q = 0; q < nw; q++) if (h[q] > 0 && h[q] < 1) band.add(q);
    for (let r = 0; r < RING; r++) { const g = new Set(band); for (const q of band) for (const x of adj[q]) g.add(x); band = g; }
    // Jacobi smoothing of the hand share inside the band
    let cur = Float64Array.from(h);
    for (let it = 0; it < ITER; it++) {
      const nx = Float64Array.from(cur);
      for (const q of band) {
        if (!adj[q].size) continue;
        let a = cur[q], c = 1;
        for (const x of adj[q]) { a += cur[x]; c++; }
        nx[q] = cur[q] + LAMBDA * (a / c - cur[q]);
      }
      cur = nx;
    }
    for (let v = 0; v < nv; v++) {
      if (!side[v]) continue;
      const q = weld[v], hOld = h[q], hNew = Math.min(1, Math.max(0, cur[q]));
      if (Math.abs(hNew - hOld) < 0.5 / 255) continue;
      const jj = Jv[v], ww = Wv[v];
      const sum = ww.reduce((a, b) => a + b, 0) || 1;
      const s = side[v];
      let out = ww.map((x) => x / sum);
      const free = () => out.findIndex((x) => x === 0);
      if (hOld > 0 && 1 - hOld > 0) {
        out = out.map((x, k) => (role[jj[k]]?.part === 'hand' ? (x / hOld) * hNew : (x / (1 - hOld)) * (1 - hNew)));
      } else if (hOld === 0) {       // pure forearm: a hand slot joins
        const k = free(); if (k < 0) continue;
        out = out.map((x) => x * (1 - hNew)); jj[k] = name.indexOf(`hand.${s}`); out[k] = hNew;
      } else {                       // pure hand: a forearm slot joins
        const k = free(); if (k < 0) continue;
        out = out.map((x) => x * hNew); jj[k] = name.indexOf(`forearm.${s}`); out[k] = 1 - hNew;
      }
      if (quant) {
        out = out.map((x) => Math.round(x * quant));
        const err = quant - out.reduce((a, b) => a + b, 0);
        out[out.indexOf(Math.max(...out))] += err;
        out = out.map((x) => x / quant);
      }
      J.setElement(v, jj);
      W.setElement(v, out);
      changed++;
    }
  }
}
console.log(`${input}: ${changed} of ${total} skinned vertices re-weighted at the wrist (smooth ${ITER} x ${LAMBDA}, ring ${RING})${DRY ? ' [dry]' : ''}`);
if (!DRY && changed) await io.write(output, doc);
