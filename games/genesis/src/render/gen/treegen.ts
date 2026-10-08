// GENESIS — procedural tree / shrub meshes (CONTRACT.md §15.6). No artist assets: every form is grown from code,
// deterministic per (kind, variant), unit height (scaled per instance), three LODs pruned from ONE skeleton so the
// silhouette never changes between levels (no popping).
//
//   broadleaf — a flared, leaning trunk forking into 3–4 limbs that branch twice more (oak / beech / kapok / willow):
//               the crown is many separate leaf sprays at the twig tips, grouped per limb, with sky between them
//   birch     — slender white trunk, steep limbs, a narrow airy crown of small-leaf sprays
//   tropical  — a high fork and wide, nearly flat limbs: the umbrella crown of acacias and rainforest emergents
//   conifer   — straight tapering trunk with whorls of drooping branches, each carrying needle-spray cards (a horizontal
//               fan plus a tilted one), around a dark inner core so the cone reads dense (pine / spruce)
//   palm      — a curved ringed trunk and a crown of arching fronds
//   dead      — the broadleaf skeleton without leaves, grey bark (burnt / drowned land)
//   shrub     — several stems from the ground with leaf sprays
// Foliage cards are alpha-tested sprays from the atlas (render/gen/leaftex.ts): each spray is attached at its twig and
// points along it, three crossed per cluster. Card normals are bent away from the crown centre (soft, volumetric
// light) and kept on both faces by the shader. Vertex colours carry bark colour / leaf brightness × ambient occlusion;
// `aWind` (0 at the root → 1 at the tips) drives sway; `aCard` marks foliage; position.y (0..1) lets the shader
// blend the trunk base into the ground.

import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { Rng } from '../../sim/core/rng.ts';
import { atlasUV, LEAF_TILE } from './leaftex.ts';

export type TreeKind = 'conifer' | 'broadleaf' | 'birch' | 'tropical' | 'palm' | 'dead' | 'shrub';
export const TREE_KINDS: TreeKind[] = ['conifer', 'broadleaf', 'birch', 'tropical', 'palm', 'dead', 'shrub'];

class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  uv: number[] = [];
  card: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, w: number, u = 0, v = 0, card = 0): number {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(r, g, b);
    this.wind.push(w);
    this.uv.push(u, v);
    this.card.push(card);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  /** uniformly rescale so the highest vertex sits at y = 1 (unit-height convention) */
  normalize(): void {
    let top = 0;
    for (let i = 1; i < this.pos.length; i += 3) top = Math.max(top, this.pos[i]);
    const k = top > 0 ? 1 / top : 1;
    for (let i = 0; i < this.pos.length; i++) this.pos[i] *= k;
  }
  /**
   * Crown depth per vertex (attribute aCrown): the normalised distance from the centre of the foliage's bounding
   * ellipsoid (0 at the heart of the crown, 1 at its hull, > 1 outside — the trunk below it). The shader darkens
   * deep foliage and the bark inside the crown with it: a cheap volumetric occlusion, so a crown has an inside.
   */
  crownDepth(): number[] {
    const n = this.pos.length / 3;
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < n; i++) if (this.card[i] >= 0.25) { cx += this.pos[i * 3]; cy += this.pos[i * 3 + 1]; cz += this.pos[i * 3 + 2]; k++; }
    const out = new Array<number>(n).fill(1);
    if (k === 0) return out;
    cx /= k; cy /= k; cz /= k;
    let rh = 1e-4, ry = 1e-4;
    for (let i = 0; i < n; i++) {
      if (this.card[i] < 0.25) continue;
      rh = Math.max(rh, Math.hypot(this.pos[i * 3] - cx, this.pos[i * 3 + 2] - cz));
      ry = Math.max(ry, Math.abs(this.pos[i * 3 + 1] - cy));
    }
    for (let i = 0; i < n; i++) {
      const dh = Math.hypot(this.pos[i * 3] - cx, this.pos[i * 3 + 2] - cz) / rh;
      const dy = (this.pos[i * 3 + 1] - cy) / ry;
      out[i] = Math.min(1.5, Math.hypot(dh, dy));
    }
    return out;
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('aCrown', new Float32BufferAttribute(this.crownDepth(), 1));
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new Float32BufferAttribute(this.wind, 1));
    g.setAttribute('aLeafUv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCard', new Float32BufferAttribute(this.card, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type RGB = [number, number, number];

// ───────────────────────────── skeleton ─────────────────────────────

/** one branch of a skeleton: a bent tapered tube, its children and where its subtree's foliage hangs */
interface Limb {
  pts: Vector3[];
  radii: number[];
  depth: number;
  children: Limb[];
  /** wind weight at the base and the tip */
  w0: number;
  w1: number;
}

interface Skeleton {
  root: Limb;
  /** foliage anchors: twig tip, twig direction, depth of the twig, and its owner chain (for LOD regrouping) */
  tips: Tip[];
  crown: Vector3;
  crownR: number;
}

interface Tip { pos: Vector3; dir: Vector3; depth: number; chain: Limb[] }

interface GrowParams {
  forkH: number;          // trunk length (fraction of the final height before normalisation)
  trunkR: number;
  limbs: [number, number];
  limbAngle: [number, number];   // degrees from vertical
  limbLen: number;
  childCount: [number, number];
  childAngle: [number, number];
  lenRatio: number;
  radiusRatio: number;
  tropism: number;        // + bends branches up, − droops
  maxDepth: number;
  lateral: number;        // chance of an extra side branch half-way along
  lean: number;
  leader: number;         // chance the trunk continues as a leader above the fork
}

const UP = new Vector3(0, 1, 0);

function perpendicular(d: Vector3, out: Vector3): Vector3 {
  const a = Math.abs(d.y) < 0.9 ? UP : new Vector3(1, 0, 0);
  return out.crossVectors(d, a).normalize();
}

/** rotate `d` away from itself by `angle` toward azimuth `az` around it */
function deviate(d: Vector3, angle: number, az: number): Vector3 {
  const p = perpendicular(d, new Vector3());
  const q = new Vector3().crossVectors(d, p).normalize();
  const side = p.multiplyScalar(Math.cos(az)).addScaledVector(q, Math.sin(az));
  return d.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle)).normalize();
}

function bentPath(rng: Rng, start: Vector3, dir: Vector3, len: number, tropism: number, segs: number): Vector3[] {
  const pts = [start.clone()];
  const d = dir.clone();
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    d.addScaledVector(UP, tropism * 0.35).add(new Vector3((rng.float() - 0.5) * 0.25, (rng.float() - 0.5) * 0.12, (rng.float() - 0.5) * 0.25)).normalize();
    pts.push(pts[i].clone().addScaledVector(d, step));
  }
  return pts;
}

function growBranching(rng: Rng, P: GrowParams): Skeleton {
  const tips: Tip[] = [];
  const leanDir = deviate(UP, P.lean * (0.4 + rng.float() * 0.6), rng.float() * Math.PI * 2);
  // trunk: flared base, gentle S-curve to the fork
  const trunkPts = [new Vector3(0, -0.06, 0), new Vector3(0, 0.02, 0)];
  const tSegs = 4;
  const d = leanDir.clone();
  for (let i = 1; i <= tSegs; i++) {
    d.add(new Vector3((rng.float() - 0.5) * 0.12, 0, (rng.float() - 0.5) * 0.12)).normalize();
    trunkPts.push(trunkPts[trunkPts.length - 1].clone().addScaledVector(d, (P.forkH - 0.02) / tSegs));
  }
  const trunkRadii = trunkPts.map((p, i) => {
    const t = i / (trunkPts.length - 1);
    const flare = 1 + 0.75 * Math.max(0, 1 - (p.y + 0.06) / 0.12);
    return P.trunkR * (1 - 0.35 * t) * flare;
  });
  const root: Limb = { pts: trunkPts, radii: trunkRadii, depth: 0, children: [], w0: 0, w1: 0.12 };
  const fork = trunkPts[trunkPts.length - 1];
  const forkDir = d.clone();

  const grow = (parent: Limb, start: Vector3, dir: Vector3, len: number, r0: number, depth: number, chain: Limb[]): void => {
    const segs = depth <= 1 ? 3 : 2;
    const pts = bentPath(rng, start, dir, len, P.tropism * (0.6 + 0.4 * depth / P.maxDepth), segs);
    const radii = pts.map((_, i) => r0 * (1 - 0.45 * (i / segs)));
    const w0 = 0.12 + 0.22 * (depth - 1), w1 = w0 + 0.22;
    const limb: Limb = { pts, radii, depth, children: [], w0, w1 };
    parent.children.push(limb);
    const ch = [...chain, limb];
    const end = pts[pts.length - 1];
    const endDir = end.clone().sub(pts[pts.length - 2]).normalize();
    if (depth >= P.maxDepth) {
      tips.push({ pos: end.clone(), dir: endDir, depth, chain: ch });
      // a second spray part-way along the twig thickens the crown without more wood
      const mid = pts[Math.max(1, segs - 1)];
      tips.push({ pos: mid.clone(), dir: deviate(endDir, 0.6, rng.float() * 6.28), depth, chain: ch });
      return;
    }
    const n = P.childCount[0] + Math.floor(rng.float() * (P.childCount[1] - P.childCount[0] + 1));
    const az0 = rng.float() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = ((P.childAngle[0] + rng.float() * (P.childAngle[1] - P.childAngle[0])) * Math.PI) / 180;
      const az = az0 + (i / n) * Math.PI * 2 + (rng.float() - 0.5) * 0.8;
      grow(limb, end, deviate(endDir, ang, az), len * P.lenRatio * (0.85 + rng.float() * 0.3), radii[radii.length - 1] * P.radiusRatio, depth + 1, ch);
    }
    if (rng.float() < P.lateral) {
      const at = pts[1];
      const ang = ((P.childAngle[1] + 10) * Math.PI) / 180;
      grow(limb, at, deviate(dir, ang, rng.float() * 6.28), len * P.lenRatio * 0.7, radii[1] * P.radiusRatio * 0.8, depth + 1, ch);
    }
  };

  const nl = P.limbs[0] + Math.floor(rng.float() * (P.limbs[1] - P.limbs[0] + 1));
  const az0 = rng.float() * Math.PI * 2;
  for (let i = 0; i < nl; i++) {
    const ang = ((P.limbAngle[0] + rng.float() * (P.limbAngle[1] - P.limbAngle[0])) * Math.PI) / 180;
    const az = az0 + (i / nl) * Math.PI * 2 + (rng.float() - 0.5) * 0.7;
    const start = fork.clone().addScaledVector(forkDir, -rng.float() * 0.05);
    grow(root, start, deviate(forkDir, ang, az), P.limbLen * (0.8 + rng.float() * 0.4), trunkRadii[trunkRadii.length - 1] * 0.7, 1, []);
  }
  if (rng.float() < P.leader) grow(root, fork, deviate(forkDir, 0.12, rng.float() * 6.28), P.limbLen * 0.9, trunkRadii[trunkRadii.length - 1] * 0.75, 1, []);
  const crown = new Vector3();
  for (const t of tips) crown.add(t.pos);
  crown.multiplyScalar(1 / Math.max(1, tips.length));
  let crownR = 0;
  for (const t of tips) crownR = Math.max(crownR, t.pos.distanceTo(crown));
  return { root, tips, crown, crownR: Math.max(crownR, 0.05) };
}

// ───────────────────────────── mesh parts ─────────────────────────────

/** a tapered tube along a path, with a rotation-minimising frame (no twisting at bends) */
function tube(m: MeshBuilder, pts: Vector3[], radii: number[], sides: number, bark: RGB, w0: number, w1: number, aoBase = 0.6): void {
  const rings: number[][] = [];
  let u = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    if (i === 0) perpendicular(dir, u);
    else u = u.clone().addScaledVector(dir, -u.dot(dir)).normalize();
    const v = new Vector3().crossVectors(dir, u).normalize();
    const t = i / (pts.length - 1);
    // ambient occlusion: dark low on the trunk and where the limbs leave it
    const ao = Math.min(1, aoBase + 0.4 * Math.min(1, (p.y + 0.06) * 3));
    const ring: number[] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = u.x * Math.cos(a) + v.x * Math.sin(a), ny = u.y * Math.cos(a) + v.y * Math.sin(a), nz = u.z * Math.cos(a) + v.z * Math.sin(a);
      // bark streaks: a little per-side variation so trunks are not flat-coloured cylinders
      const streak = 0.88 + 0.24 * (((s * 7 + i * 3) % 5) / 4);
      const r = radii[i];
      ring.push(m.vert(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, bark[0] * ao * streak, bark[1] * ao * streak, bark[2] * ao * streak, w0 + (w1 - w0) * t));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = rings[i][s], b = rings[i][(s + 1) % sides], c = rings[i + 1][s], d = rings[i + 1][(s + 1) % sides];
      m.tri(a, b, d); m.tri(a, d, c);
    }
  }
}

/**
 * One foliage card: a spray from the atlas attached at `base`, pointing along `along`, `width` × `len`, rotated
 * `roll` around its axis. Normals are bent from the crown centre for soft volume.
 */
function card(m: MeshBuilder, tile: number, base: Vector3, along: Vector3, roll: number, width: number, len: number, crown: Vector3, crownR: number, bright: number, wind: number, hue = 0): void {
  const a = along.clone().normalize();
  const p = perpendicular(a, new Vector3());
  const q = new Vector3().crossVectors(a, p).normalize();
  const side = p.multiplyScalar(Math.cos(roll)).addScaledVector(q, Math.sin(roll));
  const faceN = new Vector3().crossVectors(side, a).normalize();
  const corner = (su: number, sv: number): number => {
    const x = base.x + side.x * su * width * 0.5 + a.x * sv * len;
    const y = base.y + side.y * su * width * 0.5 + a.y * sv * len;
    const z = base.z + side.z * su * width * 0.5 + a.z * sv * len;
    const rx = x - crown.x, ry = y - crown.y + crownR * 0.25, rz = z - crown.z;
    const rl = Math.hypot(rx, ry, rz) || 1;
    // radial with a bit of the card's own facing (both faces get the same outward normal in the shader)
    const sgn = faceN.x * rx + faceN.y * ry + faceN.z * rz >= 0 ? 1 : -1;
    const nx = (rx / rl) * 0.7 + faceN.x * sgn * 0.3, ny = (ry / rl) * 0.7 + faceN.y * sgn * 0.3, nz = (rz / rl) * 0.7 + faceN.z * sgn * 0.3;
    const depthIn = Math.min(1, rl / crownR);
    const ao = (0.5 + 0.5 * depthIn) * bright;
    const [u, v] = atlasUV(tile, (su + 1) * 0.5, sv);
    return m.vert(x, y, z, nx, ny, nz, ao * (1 + hue), ao, ao * (1 - hue), wind + 0.25 * sv, u, v, 1);
  };
  const v0 = corner(-1, 0), v1 = corner(1, 0), v2 = corner(1, 1), v3 = corner(-1, 1);
  m.tri(v0, v1, v2); m.tri(v0, v2, v3);
}

/** a cluster of `n` crossed sprays at a twig tip */
function cluster(m: MeshBuilder, rng: Rng, tile: number, at: Vector3, dir: Vector3, n: number, size: number, crown: Vector3, crownR: number, wind: number, outward = 0.55, flat = 0): void {
  const out = at.clone().sub(crown);
  out.y *= 0.6;
  out.normalize();
  const bright = 0.85 + rng.float() * 0.3;
  const hue = (rng.float() - 0.5) * 0.1;
  for (let k = 0; k < n; k++) {
    // sprays point outward along the twig, fanned around it, drooping a little; `flat` lays them toward horizontal
    let along = dir.clone().multiplyScalar(1 - outward).addScaledVector(out, outward);
    along = deviate(along.normalize(), 0.35 + rng.float() * 0.45, (k / n) * Math.PI * 2 + rng.float());
    // leaves turn to the light: sprays may droop a little but never hang straight down
    along.y = Math.max(along.y, -0.25);
    along.y = along.y * (1 - flat) - 0.12 * flat;
    along.normalize();
    const roll = (k / n) * Math.PI + rng.float() * 0.6 + (flat > 0 ? Math.PI / 2 : 0);
    const s = size * (0.75 + rng.float() * 0.5);
    const base = at.clone().addScaledVector(along, -s * 0.12);
    card(m, tile, base, along, roll, s * 0.85, s, crown, crownR, bright, wind, hue);
  }
}

// ───────────────────────────── forms ─────────────────────────────

interface BroadSpec {
  grow: GrowParams;
  bark: RGB;
  tile: number;
  size: [number, number, number];   // spray size per LOD (relative, before normalisation)
  per: [number, number, number];    // sprays per cluster per LOD
  flat: number;
  leafless?: boolean;
}

function broadSpec(kind: TreeKind): BroadSpec {
  switch (kind) {
    case 'birch':
      return {
        grow: { forkH: 0.42, trunkR: 0.018, limbs: [3, 4], limbAngle: [16, 30], limbLen: 0.36, childCount: [2, 3], childAngle: [22, 40], lenRatio: 0.66, radiusRatio: 0.6, tropism: 0.5, maxDepth: 3, lateral: 0.6, lean: 0.07, leader: 0.9 },
        bark: [0.62, 0.6, 0.56], tile: LEAF_TILE.smallSpray, size: [0.11, 0.25, 0.36], per: [7, 4, 4], flat: 0,
      };
    case 'tropical':
      return {
        grow: { forkH: 0.58, trunkR: 0.022, limbs: [3, 5], limbAngle: [48, 66], limbLen: 0.34, childCount: [2, 3], childAngle: [25, 45], lenRatio: 0.7, radiusRatio: 0.62, tropism: 0.18, maxDepth: 3, lateral: 0.5, lean: 0.06, leader: 0.1 },
        bark: [0.13, 0.11, 0.085], tile: LEAF_TILE.smallSpray, size: [0.12, 0.28, 0.4], per: [7, 4, 4], flat: 0.65,
      };
    case 'dead':
      return {
        grow: { forkH: 0.38, trunkR: 0.026, limbs: [3, 4], limbAngle: [25, 45], limbLen: 0.38, childCount: [2, 3], childAngle: [25, 45], lenRatio: 0.66, radiusRatio: 0.6, tropism: 0.15, maxDepth: 3, lateral: 0.5, lean: 0.12, leader: 0.4 },
        bark: [0.1, 0.095, 0.088], tile: LEAF_TILE.spray, size: [0, 0, 0], per: [0, 0, 0], flat: 0, leafless: true,
      };
    default: // broadleaf: oak / beech / kapok / willow / baobab / mangrove
      return {
        grow: { forkH: 0.34, trunkR: 0.03, limbs: [3, 4], limbAngle: [26, 48], limbLen: 0.38, childCount: [2, 3], childAngle: [25, 48], lenRatio: 0.68, radiusRatio: 0.6, tropism: 0.3, maxDepth: 3, lateral: 0.55, lean: 0.08, leader: 0.35 },
        bark: [0.085, 0.068, 0.05], tile: LEAF_TILE.spray, size: [0.13, 0.29, 0.4], per: [7, 4, 4], flat: 0,
      };
  }
}

const skeletons = new Map<string, Skeleton>();
function skeletonFor(kind: TreeKind, variant: number): Skeleton {
  const key = `${kind}|${variant}`;
  let s = skeletons.get(key);
  if (!s) {
    s = growBranching(new Rng(5000 + variant * 31 + kind.length * 977), broadSpec(kind).grow);
    skeletons.set(key, s);
  }
  return s;
}

/**
 * broadleaf-type trees from one skeleton per variant:
 *   LOD0 — every limb down to the twigs (depth 3), a cluster of sprays at each twig
 *   LOD1 — limbs to depth 2; each depth-2 branch carries one larger cluster over the centroid of its twigs
 *   LOD2 — trunk + main limbs (3-sided); each limb carries a few big sprays over its whole sub-crown
 */
function broadleafTree(kind: TreeKind, lod: number, variant: number): BufferGeometry {
  const spec = broadSpec(kind);
  const sk = skeletonFor(kind, variant);
  const rng = new Rng(9000 + variant * 13 + lod * 101 + kind.length);
  const m = new MeshBuilder();
  const sides = [7, 5, 3][lod];
  // bare trees are all wood: they keep their twigs one level longer (the silhouette IS the branches)
  const maxWood = spec.leafless ? [3, 3, 2][lod] : [3, 2, 1][lod];
  const walk = (l: Limb): void => {
    if (l.depth > maxWood) return;
    const s = l.depth === 0 ? sides + (lod === 0 ? 2 : 0) : Math.max(3, sides - l.depth);
    tube(m, l.pts, l.radii, s, spec.bark, l.w0, l.w1, l.depth === 0 ? 0.55 : 0.75);
    for (const c of l.children) walk(c);
  };
  walk(sk.root);
  if (!spec.leafless) {
    const tile = spec.tile;
    const size = spec.size[lod];
    const per = spec.per[lod];
    if (lod === 0) {
      for (const t of sk.tips) cluster(m, rng, tile, t.pos, t.dir, per, size, sk.crown, sk.crownR, 0.55, 0.55, spec.flat);
    } else {
      // regroup the twig tips by their ancestor at the LOD's deepest drawn level (same crown envelope)
      const groups = new Map<Limb, Tip[]>();
      for (const t of sk.tips) {
        const owner = t.chain[Math.min(t.chain.length - 1, lod === 1 ? 1 : 0)];
        let gl = groups.get(owner);
        if (!gl) { gl = []; groups.set(owner, gl); }
        gl.push(t);
      }
      for (const [, list] of groups) {
        const c = new Vector3(), d = new Vector3();
        for (const t of list) { c.add(t.pos); d.add(t.dir); }
        c.multiplyScalar(1 / list.length);
        d.normalize();
        let spread = 0;
        for (const t of list) spread = Math.max(spread, t.pos.distanceTo(c));
        // the cluster covers the region its twigs spanned: a few sprays spread over it
        const n = lod === 1 ? Math.min(6, 2 + Math.ceil(list.length / 2)) : Math.min(7, 3 + Math.ceil(list.length / 5));
        for (let k = 0; k < n; k++) {
          const t = list[Math.floor(rng.float() * list.length)];
          const at = c.clone().lerp(t.pos, 0.55 + rng.float() * 0.4);
          cluster(m, rng, tile, at, t.dir.clone().lerp(d, 0.5).normalize(), Math.max(1, per - 1), size * (0.8 + spread * 1.2), sk.crown, sk.crownR, 0.55, 0.6, spec.flat);
        }
      }
    }
  }
  m.normalize();
  return m.build();
}

function conifer(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(1000 + variant * 7);
  const m = new MeshBuilder();
  const bark: RGB = [0.075, 0.052, 0.038];
  const lean = deviate(UP, 0.035 * rng.float(), rng.float() * 6.28);
  const top = lean.clone().multiplyScalar(1.0);
  // trunk
  const trunkPts: Vector3[] = [];
  for (let i = 0; i <= 5; i++) trunkPts.push(new Vector3(0, -0.06, 0).addScaledVector(lean, (i / 5) * 1.04));
  const trunkR = 0.02 + rng.float() * 0.006;
  tube(m, trunkPts, trunkPts.map((p, i) => trunkR * (1 - 0.9 * (i / 5)) * (i === 0 ? 1.5 : 1)), [7, 5, 4][lod], bark, 0, 0.5, 0.55);
  const narrow = 0.17 + 0.07 * rng.float();     // crown radius at the base of the crown (spruce narrow, pine wider)
  const base = 0.13 + rng.float() * 0.1;
  const spacing = [0.048, 0.075, 0.105][lod] * (0.9 + rng.float() * 0.2);
  const perWhorl = [6, 5, 5][lod];
  const leafCol = 0.8 + rng.float() * 0.25;
  const crown = top.clone().multiplyScalar(0.55);
  const crownR = narrow;
  // dark inner core: the dense shaded interior of the cone, so it never looks hollow between the sprays
  {
    const sides = [7, 6, 4][lod];
    const ring = (y: number, r: number, c: number, w: number) => {
      const ids: number[] = [];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const p = lean.clone().multiplyScalar(y);
        // aCard 0.5: solid foliage (tinted and lit like leaves, never alpha-tested)
        ids.push(m.vert(p.x + ca * r, p.y, p.z + sa * r, ca, 0.45, sa, 0.05 * c, 0.11 * c, 0.035 * c, w, 0, 0, 0.5));
      }
      return ids;
    };
    const coreK = [1, 0.85, 0.7][lod];
    const r0 = ring(base + 0.03, narrow * 0.3 * coreK, 0.75, 0.3), r1 = ring(0.55, narrow * 0.19 * coreK, 0.95, 0.5);
    const apex = m.vert(top.x, top.y * 0.97, top.z, 0, 1, 0, 0.05, 0.11, 0.035, 0.8, 0, 0, 0.5);
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      m.tri(r0[s], r0[s1], r1[s1]); m.tri(r0[s], r1[s1], r1[s]);
      m.tri(r1[s], r1[s1], apex);
    }
  }
  // whorls of drooping branches carrying needle sprays
  let az = rng.float() * Math.PI * 2;
  for (let y = base; y < 0.97; y += spacing * (0.85 + rng.float() * 0.3)) {
    const t = (y - base) / (1 - base);
    const L = narrow * Math.pow(1 - t, 0.85) * (0.85 + rng.float() * 0.3) + 0.025;
    const droop = 0.2 + 0.35 * (1 - t) + rng.float() * 0.1;
    const n = Math.max(3, perWhorl - (t > 0.75 ? 2 : 0));
    az += 2.39996;
    for (let k = 0; k < n; k++) {
      const a = az + (k / n) * Math.PI * 2 + (rng.float() - 0.5) * 0.5;
      const dir = new Vector3(Math.cos(a) * Math.cos(droop), -Math.sin(droop), Math.sin(a) * Math.cos(droop)).normalize();
      const start = lean.clone().multiplyScalar(y);
      if (lod === 0 && t < 0.8) {
        const end = start.clone().addScaledVector(dir, L * 0.85);
        tube(m, [start, start.clone().lerp(end, 0.5).add(new Vector3(0, 0.01, 0)), end], [0.006 * (1 - t * 0.6), 0.004, 0.0015], 3, bark, 0.3 + t * 0.3, 0.7, 0.7);
      }
      const width = L * [1.25, 1.45, 1.7][lod];
      const len = L * [1.1, 1.15, 1.22][lod];
      const wind = 0.35 + t * 0.4;
      // the main fan lies nearly flat along the branch; a second, tilted fan gives the spray thickness
      card(m, LEAF_TILE.needles, start.clone().addScaledVector(dir, L * 0.05), dir, Math.PI / 2 + (rng.float() - 0.5) * 0.3, width, len, crown, crownR, leafCol * (0.8 + 0.3 * t), wind);
      if (lod < 2) card(m, LEAF_TILE.needles, start.clone().addScaledVector(dir, L * 0.12), deviate(dir, 0.25, 1.57), 0.5 + rng.float() * 0.5, width * 0.75, len * 0.92, crown, crownR, leafCol * 0.85, wind);
      // a hanging fan under the branch: spruce sprays droop in curtains
      if (lod === 0) card(m, LEAF_TILE.needles, start.clone().addScaledVector(dir, L * 0.2), deviate(dir, 0.55, -1.57), Math.PI / 2 + 0.4, width * 0.6, len * 0.8, crown, crownR, leafCol * 0.75, wind);
    }
  }
  // the leader: a small upright spray at the tip
  card(m, LEAF_TILE.needles, top.clone().multiplyScalar(0.93), UP, rng.float() * 3, 0.07, 0.1, crown, crownR, leafCol, 0.9);
  card(m, LEAF_TILE.needles, top.clone().multiplyScalar(0.93), UP, rng.float() * 3 + 1.57, 0.07, 0.1, crown, crownR, leafCol, 0.9);
  m.normalize();
  return m.build();
}

function palm(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(7000 + variant * 5);
  const m = new MeshBuilder();
  const bark: RGB = [0.16, 0.13, 0.095];
  // a curved trunk leaning out and growing back up
  const lean = deviate(UP, 0.18 + rng.float() * 0.12, rng.float() * 6.28);
  const pts: Vector3[] = [];
  const d = lean.clone();
  pts.push(new Vector3(0, -0.06, 0));
  const segs = [8, 5, 3][lod];
  for (let i = 1; i <= segs; i++) {
    d.lerp(UP, 0.12).normalize();
    pts.push(pts[i - 1].clone().addScaledVector(d, 0.86 / segs));
  }
  tube(m, pts, pts.map((_, i) => 0.022 * (1 - 0.3 * (i / segs)) * (i === 0 ? 1.4 : 1)), [7, 5, 4][lod], bark, 0, 0.35, 0.6);
  const crown = pts[segs].clone();
  const fronds = [11, 8, 6][lod];
  const rows = [3, 2, 1][lod];
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng.float() * 0.4;
    const rise = 0.5 - rng.float() * 0.6;
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const width = 0.24 + rng.float() * 0.06;
    const len = 0.42 + rng.float() * 0.1;
    // the frond arches: out and up, then droops — a strip of `rows` quads following the arc
    const spine: Vector3[] = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const h = rise * t * 0.6 - t * t * 0.55 * len;
      spine.push(crown.clone().addScaledVector(out, t * len).add(new Vector3(0, h, 0)));
    }
    const side = new Vector3(-Math.sin(a), 0, Math.cos(a));
    // V cross-section: the leaflets hang down on both sides of the rachis, so a frond reads from the side too
    const ids: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const p = spine[r];
      const drop = width * 0.42 * Math.sin(Math.PI * (0.15 + 0.85 * t));
      for (const su of [-1, 0, 1]) {
        const x = p.x + side.x * su * width * 0.5, y = p.y - Math.abs(su) * drop, z = p.z + side.z * su * width * 0.5;
        const [u, v] = atlasUV(LEAF_TILE.frond, (su + 1) / 2, t);
        const nx = out.x * 0.3 + side.x * su * 0.5, ny = 0.85, nz = out.z * 0.3 + side.z * su * 0.5;
        ids.push(m.vert(x, y, z, nx, ny, nz, 0.95, 0.95, 0.9, 0.5 + 0.5 * t, u, v, 1));
      }
    }
    for (let r = 0; r < rows; r++) {
      const i0 = r * 3, i1 = (r + 1) * 3;
      for (let c = 0; c < 2; c++) {
        m.tri(ids[i0 + c], ids[i0 + c + 1], ids[i1 + c + 1]);
        m.tri(ids[i0 + c], ids[i1 + c + 1], ids[i1 + c]);
      }
    }
  }
  m.normalize();
  return m.build();
}

function shrub(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(4000 + variant * 3);
  const m = new MeshBuilder();
  const bark: RGB = [0.07, 0.055, 0.04];
  const crown = new Vector3(0, 0.45, 0);
  const crownR = 0.55;
  const stems = [6, 4, 3][lod];
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + rng.float() * 0.8;
    const dir = new Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
    const start = new Vector3(Math.cos(a) * 0.04, -0.04, Math.sin(a) * 0.04);
    const pts = bentPath(rng, start, dir, 0.55 + rng.float() * 0.3, 0.1, 2);
    if (lod < 2) tube(m, pts, [0.012, 0.008, 0.003], 3, bark, 0, 0.5, 0.6);
    const tip = pts[pts.length - 1];
    const tdir = tip.clone().sub(pts[pts.length - 2]).normalize();
    const n = [3, 3, 2][lod];
    cluster(m, rng, LEAF_TILE.spray, tip, tdir, n, [0.42, 0.52, 0.65][lod], crown, crownR, 0.3, 0.6);
    if (lod === 0) cluster(m, rng, LEAF_TILE.spray, pts[1], deviate(tdir, 0.8, rng.float() * 6.28), 2, 0.34, crown, crownR, 0.2, 0.7);
  }
  m.normalize();
  return m.build();
}

const cache = new Map<string, BufferGeometry>();
/** the mesh for a kind / variant / LOD (cached) */
export function treeGeometry(kind: TreeKind, lod: number, variant = 0): BufferGeometry {
  const key = `${kind}|${lod}|${variant}`;
  let g = cache.get(key);
  if (g) return g;
  switch (kind) {
    case 'conifer': g = conifer(lod, variant); break;
    case 'palm': g = palm(lod, variant); break;
    case 'shrub': g = shrub(lod, variant); break;
    default: g = broadleafTree(kind, lod, variant); break;
  }
  cache.set(key, g);
  return g;
}
