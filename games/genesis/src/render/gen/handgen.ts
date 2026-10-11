// GENESIS — the god hand's body (CONTRACT.md §15.6: "the hand has articulated fingers ... and a skin shader with SSS").
//
// A right hand modelled as one implicit surface (gen/sdfmesh.ts) and polygonised once: a palm with its transverse arch,
// thenar and hypothenar pads and the pads under the knuckles; four fingers of three phalanges each, tapering, wider at
// the joints, with fingertip pads and NAILS (a raised plate on each distal phalanx); a thumb that swings out of the
// thenar mass; knuckle bumps over the metacarpal heads; webbing between the fingers (each finger blends into the palm,
// never into its neighbour); a wrist with its ulnar bump; and a short forearm that the material dissolves into light.
//
// Units: hand length 1 (wrist crease → middle fingertip). Hand space: +z toward the fingers, +y the back of the hand,
// +x the thumb side (a right hand, palm down). The rig (gen/rig.ts) has 21 bones: forearm, hand, five metacarpals,
// three phalanges per finger and two for the thumb. Per-vertex data for the shader:
//   aRest  — the bind position (procedural detail stays on the skin as it bends)
//   aMark  — x nail (0..1), y dorsal (−1 palm .. +1 back), z signed distance to the nearest flexion joint along its
//            bone (creases, knuckle wrinkles), w thinness (light through the fingers)
//   aPart  — x finger (0 thumb, 1 index … 4 little, 5 palm, 6 wrist / forearm), y 0..1 along the finger (0 at its root)

import { BufferAttribute, BufferGeometry } from 'three';
import { Rig, bone, type RigBone, type V3 } from './rig.ts';
import { frame, meshSdf, sdCapsule, sdEllipsoid, sdRoundCone, segDist, skinWeights, smin, smoothAttribute, type Frame } from './sdfmesh.ts';

export const HAND_FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;

interface FingerDef {
  /** metacarpal base and head (MCP joint) */
  base: V3;
  mcp: V3;
  /** phalanx lengths, joint radii (proximal end of each phalanx, then the tip), spread angle (rad, + toward the thumb) */
  len: [number, number, number];
  rad: [number, number, number, number];
  spread: number;
  /** initial droop per joint (rad): the relaxed arc the hand is bound in */
  droop: number;
}

const FINGERS: FingerDef[] = [
  // index, middle, ring, little (the thumb is built apart)
  { base: [0.064, 0.0, 0.1], mcp: [0.136, 0.0, 0.548], len: [0.205, 0.124, 0.096], rad: [0.0485, 0.0435, 0.039, 0.0325], spread: 0.07, droop: 0.06 },
  { base: [0.018, 0.0, 0.1], mcp: [0.041, 0.006, 0.565], len: [0.226, 0.14, 0.101], rad: [0.0505, 0.0455, 0.0405, 0.0335], spread: 0.0, droop: 0.06 },
  { base: [-0.03, 0.0, 0.1], mcp: [-0.052, 0.0, 0.546], len: [0.21, 0.134, 0.097], rad: [0.0475, 0.0425, 0.038, 0.0315], spread: -0.075, droop: 0.065 },
  { base: [-0.072, -0.004, 0.11], mcp: [-0.134, -0.012, 0.495], len: [0.165, 0.1, 0.086], rad: [0.0415, 0.037, 0.0335, 0.028], spread: -0.18, droop: 0.075 },
];

/** cross-section flattening of fingers (y over x) */
const FLAT = 0.86;

export interface HandMesh {
  geo: BufferGeometry;
  bones: RigBone[];
  /** bone indices */
  idx: {
    forearm: number; hand: number;
    meta: number[];            // [thumb, index, middle, ring, little]
    /** phalanges per finger: thumb has 2 (proximal, distal), the others 3 */
    phal: number[][];
  };
  /** bind-pose fingertip points (pad side), per finger, and the palm centre (palmar surface) */
  tips: V3[];
  palm: V3;
}

let cached: HandMesh | null = null;

/** the hand mesh (built once; ~15–20 k vertices) */
export function handMesh(): HandMesh {
  if (cached) return cached;
  cached = buildHand();
  return cached;
}

function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scl(a: V3, k: number): V3 { return [a[0] * k, a[1] * k, a[2] * k]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function rotY(v: V3, a: number): V3 { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; }
function rotX(v: V3, a: number): V3 { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; }

interface Segment { a: V3; b: V3; ra: number; rb: number; f: Frame }

function buildHand(): HandMesh {
  const bones: RigBone[] = [];
  const up: V3 = [0, 1, 0];
  // 0 forearm, 1 hand
  bones.push(bone('forearm', -1, [0, 0.012, -0.62], [0, 0.004, -0.02], up, 0.13));
  bones.push(bone('hand', 0, [0, 0.004, -0.02], [0, 0.0, 0.24], up, 0.11));
  // thumb geometry: CMC → MCP → IP → tip; it swings out and turns its pad toward the fingers
  const tCmc: V3 = [0.078, -0.03, 0.075];
  const tMcp: V3 = [0.212, -0.058, 0.262];
  const tDir1 = norm([0.42, -0.2, 0.885]);
  const tIp = add(tMcp, scl(tDir1, 0.152));
  const tDir2 = norm([0.3, -0.24, 0.92]);
  const tTip = add(tIp, scl(tDir2, 0.118));
  // the thumb's dorsal (nail) direction: rolled outward ~70° from the back of the hand
  const tUp = norm([0.86, 0.5, -0.12]);
  const meta: number[] = [];
  const phal: number[][] = [];
  meta.push(bones.length); bones.push(bone('thumb.meta', 1, tCmc, tMcp, tUp, 0.058));
  const thumbP = bones.length; bones.push(bone('thumb.p', meta[0], tMcp, tIp, tUp, 0.048));
  const thumbD = bones.length; bones.push(bone('thumb.d', thumbP, tIp, tTip, tUp, 0.042));
  phal.push([thumbP, thumbD]);
  // fingers
  const fingerSegs: Segment[][] = [];
  const tips: V3[] = [];
  for (let fi = 0; fi < 4; fi++) {
    const F = FINGERS[fi];
    const m = bones.length;
    meta.push(m);
    bones.push(bone(`${HAND_FINGERS[fi + 1]}.meta`, 1, F.base, F.mcp, up, 0.05));
    let dir: V3 = rotY([0, 0, 1], F.spread);
    let p = F.mcp;
    const segs: Segment[] = [];
    const ph: number[] = [];
    let parent = m;
    for (let k = 0; k < 3; k++) {
      dir = norm(rotX(dir, F.droop * (k === 0 ? 0.6 : 1)));
      const q = add(p, scl(dir, F.len[k]));
      const bi = bones.length;
      bones.push(bone(`${HAND_FINGERS[fi + 1]}.${'pmd'[k]}`, parent, p, q, up, F.rad[k] * 0.95));
      ph.push(bi);
      segs.push({ a: p, b: q, ra: F.rad[k], rb: F.rad[k + 1] * (k < 2 ? 0.97 : 1), f: frame(p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]], up) });
      parent = bi;
      p = q;
    }
    phal.push(ph);
    fingerSegs.push(segs);
    // the tip pad: just short of the end, on the palm side
    const last = segs[2];
    tips.push(add(last.b, add(scl(last.f.w, -last.rb * 0.6), scl(last.f.v, -last.rb * 0.7))));
  }
  // thumb tip pad (its palm side faces −tUp-ish toward the index)
  const tF = frame(tIp, [tTip[0] - tIp[0], tTip[1] - tIp[1], tTip[2] - tIp[2]], tUp);
  tips.unshift(add(tTip, add(scl(tF.w, -0.02), scl(tF.v, -0.03))));
  const thumbSegs: Segment[] = [
    { a: tCmc, b: tMcp, ra: 0.062, rb: 0.05, f: frame(tCmc, [tMcp[0] - tCmc[0], tMcp[1] - tCmc[1], tMcp[2] - tCmc[2]], tUp) },
    { a: tMcp, b: tIp, ra: 0.05, rb: 0.0445, f: frame(tMcp, [tIp[0] - tMcp[0], tIp[1] - tMcp[1], tIp[2] - tMcp[2]], tUp) },
    { a: tIp, b: tTip, ra: 0.0445, rb: 0.036, f: tF },
  ];

  // ── the field (every part precomputed: it is evaluated a few hundred thousand times) ──
  const palmBox = frame([0.0, -0.006, 0.31], [0, 0, 1], up);
  const thenar = frame([0.108, -0.05, 0.2], [0.55, -0.1, 0.83], up);
  const hypothenar = frame([-0.105, -0.038, 0.28], [-0.1, 0, 1], up);
  const fingerAll = [thumbSegs, ...fingerSegs];
  const knuckles: V3[] = FINGERS.map((F) => add(F.mcp, [0, 0.03, -0.006]));
  const padsUnder: V3[] = FINGERS.map((F) => add(F.mcp, [0, -0.045, -0.035]));
  const metaSegs: Segment[] = FINGERS.map((F) => ({ a: F.base, b: F.mcp, ra: 0.052, rb: 0.049, f: frame(F.base, [F.mcp[0] - F.base[0], F.mcp[1] - F.base[1], F.mcp[2] - F.base[2]], up) }));
  const wrist: Segment = { a: [0, 0.004, -0.09], b: [0, -0.002, 0.07], ra: 0.106, rb: 0.112, f: frame([0, 0, -0.09], [0, 0, 1], up) };
  const fore: Segment = { a: [0, 0.012, -0.66], b: [0, 0.004, -0.08], ra: 0.138, rb: 0.104, f: frame([0, 0, -0.66], [0, 0, 1], up) };
  // per finger: its tip pad and nail plate, and a bounding capsule (root → tip) for culling
  interface FingerParts { segs: Segment[]; flat: number[]; pad: V3; padR: V3; nail: V3; nailR: V3; f: Frame; ca: V3; cb: V3; cr: number; web: number }
  const parts: FingerParts[] = fingerAll.map((segs, fi) => {
    const s = segs[segs.length - 1];
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
    const mid = add(s.a, scl(s.f.w, L * 0.55));
    return {
      segs, flat: segs.map((_, k) => (fi === 0 && k === 0 ? 0.92 : FLAT)),
      pad: add(mid, scl(s.f.v, -s.rb * 0.42)), padR: [s.rb * 0.92, s.rb * 0.62, L * 0.42],
      nail: add(add(s.a, scl(s.f.w, L * 0.62)), scl(s.f.v, s.rb * 0.6)), nailR: [s.rb * 0.74, s.rb * 0.3, L * 0.42], f: s.f,
      ca: segs[0].a, cb: s.b, cr: Math.max(...segs.map((q) => q.ra)) + 0.02, web: fi === 0 ? 0.06 : 0.034,
    };
  });

  // a flattened round cone: squash the segment's local v (dorsal) axis
  const flatCone = (x: number, y: number, z: number, s: Segment, flat: number): number => {
    const cx = x - s.a[0], cy = y - s.a[1], cz = z - s.a[2];
    const lv = cx * s.f.v[0] + cy * s.f.v[1] + cz * s.f.v[2];
    const k = (1 / flat - 1) * lv;
    return sdRoundCone(x + s.f.v[0] * k, y + s.f.v[1] * k, z + s.f.v[2] * k, s.a, s.b, s.ra, s.rb) * flat;
  };

  const palmField = (x: number, y: number, z: number): number => {
    // (parts are skipped where they are certainly farther than their blend radius from the running value: smin of a
    // farther primitive leaves it unchanged, so the field is exact where it matters)
    let d = 1e9;
    if (z > -0.16) {
      // the metacarpal body: four flattened cones fused, with the transverse arch (higher in the middle)
      for (let fi = 0; fi < 4; fi++) d = smin(d, flatCone(x, y, z, metaSegs[fi], 0.74), 0.065);
      // the palm's mass (a flattened ellipsoid), its pads
      if (z > -0.02 && z < 0.66) {
        d = smin(d, sdEllipsoid(x, y, z, palmBox.c, [0.16, 0.062, 0.25], palmBox), 0.05);
        d = smin(d, sdEllipsoid(x, y, z, thenar.c, [0.068, 0.056, 0.13], thenar), 0.05);
        d = smin(d, sdEllipsoid(x, y, z, hypothenar.c, [0.05, 0.045, 0.165], hypothenar), 0.04);
      }
      if (z > 0.36 && z < 0.7) for (let i = 0; i < 4; i++) {
        d = smin(d, sdEllipsoid(x, y, z, padsUnder[i], [0.044, 0.026, 0.05]), 0.03);
        d = smin(d, sdEllipsoid(x, y, z, knuckles[i], [0.032, 0.026, 0.034]), 0.03);
      }
    }
    // the wrist: a flattened round cone, its ulnar bump, then the forearm with its muscle bellies
    if (z < 0.3) {
      d = smin(d, flatCone(x, y, z, wrist, 0.68), 0.07);
      if (z < 0.08) d = smin(d, sdEllipsoid(x, y, z, [-0.098, 0.03, -0.035], [0.026, 0.024, 0.03]), 0.03);
    }
    if (z < 0.12) {
      d = smin(d, flatCone(x, y, z, fore, 0.76), 0.08);
      d = smin(d, sdEllipsoid(x, y, z, [0.01, -0.02, -0.5], [0.14, 0.1, 0.2]), 0.08);
    }
    return d;
  };

  const fingerField = (x: number, y: number, z: number, F: FingerParts): number => {
    let d = 1e9;
    for (let k = 0; k < F.segs.length; k++) d = smin(d, flatCone(x, y, z, F.segs[k], F.flat[k]), 0.012);
    d = smin(d, sdEllipsoid(x, y, z, F.pad, F.padR, F.f), 0.016);
    d = smin(d, sdEllipsoid(x, y, z, F.nail, F.nailR, F.f), 0.008);
    return d;
  };

  const field = (x: number, y: number, z: number): number => {
    const pd = palmField(x, y, z);
    let d = pd;
    for (let fi = 0; fi < 5; fi++) {
      const F = parts[fi];
      // a finger farther than its web from the palm's surface cannot change the result
      if (sdCapsule(x, y, z, F.ca, F.cb, F.cr) > pd + F.web) continue;
      // each finger webs into the palm (the thumb's web is broad), never into its neighbour
      d = Math.min(d, smin(pd, fingerField(x, y, z, F), F.web));
    }
    return d;
  };

  const h = 0.0085;
  const m = meshSdf(field, [-0.26, -0.2, -0.72], [0.46, 0.17, 1.08], h, 1);
  const n = m.vertexCount;
  // ── skinning ──
  const segs = bones.map((b) => ({ a: b.head, b: b.tail, r: b.r }));
  const fingerOf = (bi: number): number => {
    if (bi === meta[0] || phal[0].includes(bi)) return 0;
    for (let f = 1; f < 5; f++) if (bi === meta[f] || phal[f].includes(bi)) return f;
    return bi === 0 ? 6 : 5;
  };
  const isPhal = (bi: number): boolean => phal.some((p) => p.includes(bi));
  const sk = skinWeights(m.pos, segs, 8, (best, other) => {
    // a finger's flesh follows its own chain (and its metacarpal); the palm blends across metacarpals; the wrist
    // between hand and forearm
    if (isPhal(best)) {
      const f = fingerOf(best);
      return fingerOf(other) === f || (f === 0 && (other === meta[1] || other === 1)) || (other === meta[f]);
    }
    if (best === 0) return other === 1 || meta.includes(other);
    return !isPhal(other) || phal.some((p) => p[0] === other);
  });
  // soften the weight seams a little (two passes; renormalised after)
  const wt = sk.weight;
  const full = new Float32Array(n * bones.length);
  for (let v = 0; v < n; v++) for (let s = 0; s < 4; s++) full[v * bones.length + sk.index[v * 4 + s]] += wt[v * 4 + s];
  smoothAttribute(m.index, n, full, bones.length, 2, 0.5);
  const bIdx = new Float32Array(n * 4), bW = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const row = full.subarray(v * bones.length, (v + 1) * bones.length);
    const top = [-1, -1, -1, -1];
    for (let b = 0; b < bones.length; b++) {
      if (row[b] < 1e-3) continue;
      for (let s = 0; s < 4; s++) if (top[s] < 0 || row[b] > row[top[s]]) { for (let q = 3; q > s; q--) top[q] = top[q - 1]; top[s] = b; break; }
    }
    let sum = 0;
    for (let s = 0; s < 4; s++) if (top[s] >= 0) sum += row[top[s]];
    for (let s = 0; s < 4; s++) { bIdx[v * 4 + s] = top[s] >= 0 ? top[s] : 0; bW[v * 4 + s] = top[s] >= 0 ? row[top[s]] / sum : 0; }
  }

  // ── surface marks ──
  const mark = new Float32Array(n * 4), part = new Float32Array(n * 2);
  const tmp = { t: 0 };
  for (let v = 0; v < n; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    const nx = m.nrm[v * 3], ny = m.nrm[v * 3 + 1], nz = m.nrm[v * 3 + 2];
    // nearest bone (by radius-normalised distance)
    let best = 0, bd = Infinity;
    for (let b = 0; b < bones.length; b++) { const d = segDist(x, y, z, bones[b].head, bones[b].tail) / bones[b].r; if (d < bd) { bd = d; best = b; } }
    const B = bones[best];
    const f = fingerOf(best);
    // dorsal: the normal against the bone's dorsal axis
    const dors = nx * B.y[0] + ny * B.y[1] + nz * B.y[2];
    // nail: on the last phalanx, dorsal, in the plate's footprint
    let nail = 0;
    const last = f === 0 ? phal[0][1] : f >= 1 && f <= 4 ? phal[f][2] : -1;
    if (best === last) {
      segDist(x, y, z, B.head, B.tail, tmp);
      const L = Math.hypot(B.tail[0] - B.head[0], B.tail[1] - B.head[1], B.tail[2] - B.head[2]);
      const lx = (x - B.head[0]) * B.x[0] + (y - B.head[1]) * B.x[1] + (z - B.head[2]) * B.x[2];
      const along = tmp.t * L;
      const r = B.r;
      const u = lx / (r * 0.72), w = (along - L * 0.64) / (L * 0.44);
      nail = Math.max(0, Math.min(1, (1 - Math.hypot(u, w)) * 6)) * Math.max(0, Math.min(1, (dors - 0.3) * 4));
    }
    // crease coordinate: signed distance (along the bone) to the nearest flexion joint (this bone's head or tail)
    segDist(x, y, z, B.head, B.tail, tmp);
    const L = Math.hypot(B.tail[0] - B.head[0], B.tail[1] - B.head[1], B.tail[2] - B.head[2]);
    const s0 = tmp.t * L, s1 = (tmp.t - 1) * L;
    const crease = Math.abs(s0) < Math.abs(s1) ? s0 : s1;
    const thin = f <= 4 && isPhal(best) ? 1 : f <= 4 ? 0.55 : best === 1 ? 0.35 : 0.15;
    mark[v * 4] = nail; mark[v * 4 + 1] = dors; mark[v * 4 + 2] = crease; mark[v * 4 + 3] = thin;
    part[v * 2] = f;
    // along the finger: 0 at the knuckle, 1 at the tip
    if (f <= 4 && isPhal(best)) {
      const chain = phal[f];
      const k = chain.indexOf(best);
      part[v * 2 + 1] = (k + Math.max(0, Math.min(1, tmp.t))) / chain.length;
    } else part[v * 2 + 1] = 0;
  }
  smoothAttribute(m.index, n, mark, 4, 1, 0.5);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(m.pos, 3));
  geo.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  geo.setAttribute('aRest', new BufferAttribute(m.pos.slice(), 3));
  geo.setAttribute('aBoneIdx', new BufferAttribute(bIdx, 4));
  geo.setAttribute('aBoneW', new BufferAttribute(bW, 4));
  geo.setAttribute('aMark', new BufferAttribute(mark, 4));
  geo.setAttribute('aPart', new BufferAttribute(part, 2));
  geo.setIndex(new BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  // the palm centre on the palmar surface
  const palm: V3 = [0.02, -0.075, 0.34];
  return { geo, bones, idx: { forearm: 0, hand: 1, meta, phal }, tips, palm };
}

/** a rig for the hand mesh (one per hand visual) */
export function handRig(h: HandMesh): Rig { return new Rig(h.bones); }
