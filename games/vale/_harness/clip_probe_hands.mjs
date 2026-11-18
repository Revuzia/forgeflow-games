#!/usr/bin/env node
// VALE hand-integrity probe (orch1 W2-C, FU-10). Samples every clip of every shipped fighter GLB (base + skins)
// at 30 frames (plus each clip's last frame) with the GLB's own skin (the 4-influence weights the game uses), and
// measures every HAND triangle's edges against the bind pose. A hand vertex carries >= --min-w (default 0.5) of
// its weight on hand.L / hand.R / prop.L / prop.R; a hand triangle has all three corners hand vertices. Gate: 0 edges
// outside [0.4, 1.6] x rest over every clip, fighter and skin (the lane's Done-when).
//
//   node _harness/clip_probe_hands.mjs [art/out/fighters] [--only burdam,dunsom] [--frames 30] [--min-w 0.5]
//        [--json out.json] [--worst 5] [--bones hand.L,hand.R,prop.L,prop.R]
//
// Exit 1 when any edge is outside the band. Pure Node (gltf-transform + three math), no browser, no Blender.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const flagged = new Set(['--bones', '--only', '--frames', '--min-w', '--json', '--worst', '--lo', '--hi']);
const pos = args.filter((a, i) => !a.startsWith('--') && !flagged.has(args[i - 1]));
const ROOT = pos[0] || 'art/out/fighters';
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const FRAMES = Number(opt('--frames', 30));
const MIN_W = Number(opt('--min-w', 0.5));
const LO = Number(opt('--lo', 0.4));
const HI = Number(opt('--hi', 1.6));
const WORST = Number(opt('--worst', 5));
const HAND_BONES = new Set(opt('--bones', 'hand.L,hand.R,prop.L,prop.R').split(','));   // --bones forearm.L,forearm.R: the elbow band

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function sampler(s, t) {
  const inp = s.getInput().getArray();
  const out = s.getOutput();
  const n = out.getElementSize();
  const interp = s.getInterpolation();
  const cubic = interp === 'CUBICSPLINE';
  const get = (k) => out.getElement(cubic ? k * 3 + 1 : k, new Array(n));
  if (t <= inp[0]) return get(0);
  const last = inp.length - 1;
  if (t >= inp[last]) return get(last);
  let k = 0;
  while (k < last && inp[k + 1] < t) k++;
  const a = get(k);
  if (interp === 'STEP') return a;
  const b = get(k + 1);
  const u = (t - inp[k]) / (inp[k + 1] - inp[k] || 1);
  if (n === 4) {
    const q = new Quaternion(...a).slerp(new Quaternion(...b), u);
    return [q.x, q.y, q.z, q.w];
  }
  return a.map((v, i) => v + (b[i] - v) * u);
}

async function probeFile(file, animFile) {
  const animDoc = animFile ? await io.read(animFile) : null;
  return io.read(file).then((doc) => {
    const root = doc.getRoot();
    const nodes = root.listNodes();
    const idx = new Map(nodes.map((n, i) => [n, i]));
    const parent = new Array(nodes.length).fill(-1);
    nodes.forEach((n, i) => n.listChildren().forEach((c) => (parent[idx.get(c)] = i)));
    const restTRS = nodes.map((n) => ({ t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }));
    // one skin per skinned mesh (quantization folds each mesh's own scale into its inverse bind matrices)
    const skinInfo = (skin) => {
      const joints = skin.listJoints();
      const ibmAcc = skin.getInverseBindMatrices();
      return {
        jIdx: joints.map((j) => idx.get(j)),
        ibm: joints.map((_, j) => new Matrix4().fromArray(ibmAcc.getElement(j, new Array(16)))),
        handJ: new Set(joints.map((j, k) => (HAND_BONES.has(j.getName()) ? k : -1)).filter((k) => k >= 0)),
        jName: joints.map((j) => j.getName()),
      };
    };

    // hand vertices and triangles per skinned primitive
    const prims = [];
    for (const n of nodes) {
      if (!n.getMesh() || !n.getSkin()) continue;
      const { jIdx, ibm, handJ, jName } = skinInfo(n.getSkin());
      for (const p of n.getMesh().listPrimitives()) {
        const P = p.getAttribute('POSITION');
        const J = p.getAttribute('JOINTS_0');
        const W = p.getAttribute('WEIGHTS_0');
        if (!P || !J || !W) continue;
        const nv = P.getCount();
        const hv = new Map();
        const jv = [0, 0, 0, 0];
        const wv = [0, 0, 0, 0];
        for (let v = 0; v < nv; v++) {
          J.getElement(v, jv);
          W.getElement(v, wv);
          let hw = 0;
          let ws = 0;
          for (let k = 0; k < 4; k++) {
            ws += wv[k];
            if (handJ.has(jv[k])) hw += wv[k];
          }
          if (ws > 0 && hw / ws >= MIN_W) hv.set(v, { p: P.getElement(v, [0, 0, 0]), j: jv.slice(), w: wv.map((x) => x / ws) });
        }
        const ind = p.getIndices();
        const tris = [];
        const nt = ind ? ind.getCount() / 3 : nv / 3;
        for (let t = 0; t < nt; t++) {
          const a = ind ? ind.getScalar(3 * t) : 3 * t;
          const b = ind ? ind.getScalar(3 * t + 1) : 3 * t + 1;
          const c = ind ? ind.getScalar(3 * t + 2) : 3 * t + 2;
          if (hv.has(a) && hv.has(b) && hv.has(c)) tris.push([a, b, c]);
        }
        if (tris.length) prims.push({ mesh: n.getMesh().getName(), hv, tris, jIdx, ibm, jName });
      }
    }

    const world = (trs) => {
      const local = trs.map((x) => new Matrix4().compose(new Vector3(...x.t), new Quaternion(...x.r), new Vector3(...x.s)));
      const W = new Array(nodes.length);
      const done = new Array(nodes.length).fill(false);
      const f = (i) => {
        if (done[i]) return W[i];
        W[i] = parent[i] < 0 ? local[i].clone() : f(parent[i]).clone().multiply(local[i]);
        done[i] = true;
        return W[i];
      };
      nodes.forEach((_, i) => f(i));
      return W;
    };
    const skinPositions = (W) => {
      return prims.map((pr) => {
        const S = pr.jIdx.map((ni, k) => W[ni].clone().multiply(pr.ibm[k]));
        const out = new Map();
        const tmp = new Vector3();
        for (const [v, d] of pr.hv) {
          const acc = new Vector3();
          for (let k = 0; k < 4; k++) {
            if (!d.w[k]) continue;
            tmp.set(...d.p).applyMatrix4(S[d.j[k]]);
            acc.addScaledVector(tmp, d.w[k]);
          }
          out.set(v, acc);
        }
        return out;
      });
    };
    const edgeLens = (posMaps) =>
      prims.map((pr, pi) => pr.tris.map(([a, b, c]) => {
        const m = posMaps[pi];
        return [m.get(a).distanceTo(m.get(b)), m.get(b).distanceTo(m.get(c)), m.get(c).distanceTo(m.get(a))];
      }));
    const rest = edgeLens(skinPositions(world(restTRS)));

    const res = { file, handTris: prims.reduce((s, p) => s + p.tris.length, 0), clips: {}, out: 0, edges: 0, min: Infinity, max: 0, worst: [] };
    const byName = new Map(nodes.map((n, i) => [n.getName(), i]));
    const anims = (root.listAnimations().length || !animDoc ? root : animDoc.getRoot()).listAnimations();
    const target = (ch) => (animDoc && !root.listAnimations().length ? byName.get(ch.getTargetNode().getName()) : idx.get(ch.getTargetNode()));
    res.animFrom = root.listAnimations().length || !animDoc ? 'own' : basename(animFile);
    for (const anim of anims) {
      let dur = 0;
      for (const s of anim.listSamplers()) dur = Math.max(dur, s.getInput().getMax([0])[0]);
      const c = { out: 0, min: Infinity, max: 0 };
      const fr = FRAMES;
      for (let f = 0; f <= fr; f++) {
        const t = (dur * f) / fr;
        const trs = restTRS.map((x) => ({ t: x.t.slice(), r: x.r.slice(), s: x.s.slice() }));
        for (const ch of anim.listChannels()) {
          const ni = target(ch);
          if (ni === undefined) continue;
          const path = ch.getTargetPath();
          const v = sampler(ch.getSampler(), t);
          if (path === 'translation') trs[ni].t = v;
          else if (path === 'rotation') trs[ni].r = v;
          else if (path === 'scale') trs[ni].s = v;
        }
        const now = edgeLens(skinPositions(world(trs)));
        now.forEach((tl, pi) => tl.forEach((e, ti) => e.forEach((L, k) => {
          const R = rest[pi][ti][k];
          if (R < 1e-5) return;
          const r = L / R;
          res.edges++;
          if (r < c.min) c.min = r;
          if (r > c.max) c.max = r;
          if (r < LO || r > HI) {
            c.out++;
            const tri = prims[pi].tris[ti];
            const d = prims[pi].hv.get(tri[k]);
            res.worst.push({ clip: anim.getName(), frame: f, mesh: prims[pi].mesh, tri: ti, ratio: +r.toFixed(3), restMm: +(R * 1000).toFixed(2),
              bones: d.j.map((j, q) => (d.w[q] > 0.01 ? `${prims[pi].jName[j]}:${d.w[q].toFixed(2)}` : null)).filter(Boolean).join(' ') });
          }
        })));
      }
      res.clips[anim.getName()] = { out: c.out, min: +c.min.toFixed(3), max: +c.max.toFixed(3) };
      res.out += c.out;
      res.min = Math.min(res.min, c.min);
      res.max = Math.max(res.max, c.max);
    }
    res.worst.sort((a, b) => Math.max(b.ratio, 1 / b.ratio) - Math.max(a.ratio, 1 / a.ratio));
    res.worstAll = res.worst.length;
    res.worst = res.worst.slice(0, WORST);
    res.min = +res.min.toFixed(3);
    res.max = +res.max.toFixed(3);
    return res;
  });
}

const files = [];
for (const d of readdirSync(ROOT).sort()) {
  if (d.startsWith('_') || (ONLY && !ONLY.has(d))) continue;
  const dir = join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) if (f.endsWith('.glb')) files.push([join(dir, f), f === `${d}.glb` ? null : join(dir, `${d}.glb`)]);
}
const results = [];
let bad = 0;
for (const [f, base] of files) {
  const r = await probeFile(f, base && existsSync(base) ? base : null);
  results.push(r);
  bad += r.out;
  const clipsBad = Object.entries(r.clips).filter(([, c]) => c.out).map(([k, c]) => `${k}:${c.out}`).join(' ');
  console.log(`${r.out ? 'FAIL' : 'ok  '} ${basename(f).padEnd(28)} handTris=${String(r.handTris).padStart(5)} edges=${r.edges} ratio ${r.min}..${r.max} out=${r.out}${clipsBad ? '  [' + clipsBad + ']' : ''}`);
  for (const w of r.worst) console.log(`       ${w.clip}@${w.frame} ${w.mesh} tri ${w.tri} x${w.ratio} rest ${w.restMm} mm  ${w.bones}`);
}
console.log(`hand-integrity: ${files.length} GLBs, ${bad} hand edges outside ${LO}-${HI}x rest -> ${bad ? 'FAIL' : 'PASS'}`);
if (opt('--json', '')) writeFileSync(opt('--json', ''), JSON.stringify({ lo: LO, hi: HI, minW: MIN_W, frames: FRAMES, bad, results }, null, 1));
process.exit(bad ? 1 : 0);
