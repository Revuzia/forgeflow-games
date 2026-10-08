// GENESIS — procedural tree / shrub meshes (CONTRACT.md §15.6). No artist assets: every species is built from code,
// deterministic per (kind, variant, LOD). Unit height (scaled per instance).
//
//   conifer   — tapered trunk + 5–8 star-shaped, drooping foliage tiers (spruce / fir silhouette)
//   broadleaf — trunk splitting into limbs + a canopy of noise-displaced leaf clusters (oak / beech mass)
//   tropical  — tall slender trunk + a wide, flattened umbrella canopy
//   dead      — bare trunk and limbs (burnt / drowned land)
//   shrub     — a low clump of leaf clusters
// Each has three LODs (a few hundred triangles near, under a hundred far). Vertex colours carry albedo × baked ambient occlusion; foliage
// normals are bent away from the crown centre (soft, volumetric canopy shading); `aWind` (0 at the root → 1 at the
// tips) drives sway in the vertex shader.

import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three';
import { Rng } from '../../sim/core/rng.ts';
import { Noise3 } from '../../sim/grid/noise.ts';

export type TreeKind = 'conifer' | 'broadleaf' | 'tropical' | 'dead' | 'shrub';
export const TREE_KINDS: TreeKind[] = ['conifer', 'broadleaf', 'tropical', 'dead', 'shrub'];

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
  build(): BufferGeometry {
    const g = new BufferGeometry();
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

/** tapered tube along a (possibly bent) path; colours bark with AO toward the base */
function tube(m: MeshBuilder, pts: Vector3[], radii: number[], sides: number, bark: [number, number, number], windAt: (t: number) => number): void {
  const rings: number[][] = [];
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    const side = Math.abs(dir.dot(up)) > 0.95 ? new Vector3(1, 0, 0) : up.clone();
    const u = new Vector3().crossVectors(dir, side).normalize();
    const v = new Vector3().crossVectors(dir, u).normalize();
    const ring: number[] = [];
    const t = i / (pts.length - 1);
    const ao = 0.55 + 0.45 * Math.min(1, t * 2 + 0.2);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = u.x * Math.cos(a) + v.x * Math.sin(a), ny = u.y * Math.cos(a) + v.y * Math.sin(a), nz = u.z * Math.cos(a) + v.z * Math.sin(a);
      const r = radii[i];
      ring.push(m.vert(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, bark[0] * ao, bark[1] * ao, bark[2] * ao, windAt(t)));
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

/** a noise-displaced leaf cluster (never a plain sphere): lumpy, flattened underside, normals bent from `centre` */
/** alpha-tested leaf cards scattered over a cluster's surface, facing outward from the crown (leafy silhouette) */
function leafCards(m: MeshBuilder, c: Vector3, r: number, count: number, crown: Vector3, crownR: number, windBase: number, rng: Rng): void {
  const ico = [[0, 1, 0], [0, -0.6, 0], [0.89, 0.45, 0], [-0.89, 0.45, 0], [0, 0.45, 0.89], [0, 0.45, -0.89],
    [0.63, -0.3, 0.63], [-0.63, -0.3, 0.63], [0.63, -0.3, -0.63], [-0.63, -0.3, -0.63], [0.6, 0.75, 0.3], [-0.5, 0.8, -0.4],
    [0.9, 0.1, -0.4], [-0.9, 0.05, 0.4]];
  for (let k = 0; k < count; k++) {
    const d = ico[k % ico.length];
    const j = new Vector3(d[0] + (rng.float() - 0.5) * 0.5, d[1] + (rng.float() - 0.5) * 0.5, d[2] + (rng.float() - 0.5) * 0.5).normalize();
    const p = c.clone().addScaledVector(j, r * (0.7 + rng.float() * 0.3));
    // facing: outward from the crown centre, with some scatter
    const n = p.clone().sub(crown).normalize().addScaledVector(j, 0.6).normalize();
    const t0 = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tu = new Vector3().crossVectors(t0, n).normalize();
    const tv = new Vector3().crossVectors(n, tu).normalize();
    const rot = rng.float() * Math.PI * 2;
    const cu = tu.clone().multiplyScalar(Math.cos(rot)).addScaledVector(tv, Math.sin(rot));
    const cv = tv.clone().multiplyScalar(Math.cos(rot)).addScaledVector(tu, -Math.sin(rot));
    const h = r * (1.05 + rng.float() * 0.35);
    const dIn = p.distanceTo(crown) / crownR;
    const ao = Math.min(1, 0.45 + 0.5 * dIn + 0.2 * Math.max(0, j.y));
    const w = windBase + 0.3;
    const corner = (su: number, sv: number, u: number, v: number) => m.vert(
      p.x + (cu.x * su + cv.x * sv) * h, p.y + (cu.y * su + cv.y * sv) * h, p.z + (cu.z * su + cv.z * sv) * h,
      n.x, n.y, n.z, ao, ao, ao, w, u, v, 1);
    const a = corner(-1, -1, 0, 0), b = corner(1, -1, 1, 0), cc = corner(1, 1, 1, 1), dd = corner(-1, 1, 0, 1);
    m.tri(a, b, cc); m.tri(a, cc, dd);
  }
}

function cluster(m: MeshBuilder, nz: Noise3, c: Vector3, r: number, detail: number, leaf: [number, number, number], crown: Vector3, crownR: number, windBase: number, rng: Rng, flatten = 0.75): void {
  const ico = new IcosahedronGeometry(1, detail);
  const p = ico.getAttribute('position');
  // merge duplicate vertices of the non-indexed icosahedron so displacement keeps the surface closed
  const map = new Map<string, number>();
  const tint = 0.85 + rng.float() * 0.3;
  const hueShift = (rng.float() - 0.5) * 0.08;
  const local: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) {
      const n = nz.noise(x * 1.7 + c.x * 3, y * 1.7 + c.y * 3, z * 1.7 + c.z * 3);
      const n2 = nz.noise(x * 4.1 + 9, y * 4.1, z * 4.1 + c.x);
      let k = 1 + n * 0.28 + n2 * 0.1;
      const yy = y < 0 ? y * flatten : y;
      const vx = c.x + x * r * k, vy = c.y + yy * r * k, vz = c.z + z * r * k;
      // bent normal: mostly away from the whole crown's centre, a little from the cluster's
      const bx = (vx - crown.x) / crownR + x * 0.6, by = (vy - crown.y) / crownR + y * 0.6, bz = (vz - crown.z) / crownR + z * 0.6;
      // ambient occlusion: darker toward the crown's interior and underside
      const dIn = Math.hypot(vx - crown.x, vy - crown.y, vz - crown.z) / crownR;
      const ao = Math.min(1, 0.38 + 0.5 * dIn + 0.25 * Math.max(0, y)) * tint;
      id = m.vert(vx, vy, vz, bx, by, bz, leaf[0] * ao * (1 + hueShift), leaf[1] * ao, leaf[2] * ao * (1 - hueShift), windBase + 0.25 * Math.max(0, dIn));
      map.set(key, id);
    }
    local.push(id);
  }
  for (let i = 0; i < local.length; i += 3) m.tri(local[i], local[i + 1], local[i + 2]);
  ico.dispose();
}

function conifer(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(1000 + variant);
  const m = new MeshBuilder();
  const bark: [number, number, number] = [0.07, 0.048, 0.035];
  const sides = lod === 0 ? 7 : lod === 1 ? 5 : 4;
  const trunkTop = 0.92;
  tube(m, [new Vector3(0, -0.05, 0), new Vector3(0, 0.3, 0), new Vector3(0, trunkTop, 0)], [0.035, 0.024, 0.006], sides, bark, (t) => t * 0.6);
  const tiers = lod === 0 ? 7 : lod === 1 ? 5 : 3;
  const spikes = lod === 0 ? 11 : lod === 1 ? 8 : 6;
  const leafA: [number, number, number] = [0.022, 0.045, 0.03];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y0 = 0.16 + t * 0.72;
    const r = (0.3 - 0.25 * t) * (0.9 + rng.float() * 0.2);
    const h = 0.18 - 0.07 * t;
    const droop = 0.07 + 0.05 * (1 - t);
    const apex = m.vert(0, y0 + h, 0, 0, 1, 0, leafA[0] * 1.15, leafA[1] * 1.15, leafA[2] * 1.15, 0.4 + t * 0.4);
    const rot = rng.float() * Math.PI * 2;
    const outer: number[] = [];
    const inner: number[] = [];
    for (let s = 0; s < spikes * 2; s++) {
      const a = rot + (s / (spikes * 2)) * Math.PI * 2;
      const rr = s % 2 === 0 ? r : r * 0.62;
      const yy = y0 - (s % 2 === 0 ? droop : droop * 0.4);
      const ca = Math.cos(a), sa = Math.sin(a);
      const shade = (s % 2 === 0 ? 1.05 : 0.8) * (0.85 + 0.3 * t);
      outer.push(m.vert(ca * rr, yy, sa * rr, ca * 0.7, 0.75, sa * 0.7, leafA[0] * shade, leafA[1] * shade, leafA[2] * shade, 0.55 + t * 0.4));
      // underside: darker, pulled in toward the trunk
      inner.push(m.vert(ca * rr * 0.3, yy + h * 0.15, sa * rr * 0.3, ca * 0.2, -1, sa * 0.2, leafA[0] * 0.35, leafA[1] * 0.35, leafA[2] * 0.35, 0.3 + t * 0.3));
    }
    const n = spikes * 2;
    for (let s = 0; s < n; s++) {
      const a = outer[s], b = outer[(s + 1) % n];
      m.tri(apex, b, a);
      if (lod < 2) { m.tri(a, b, inner[(s + 1) % n]); m.tri(a, inner[(s + 1) % n], inner[s]); }
    }
  }
  return m.build();
}

function broadleaf(lod: number, variant: number, tropical: boolean): BufferGeometry {
  const rng = new Rng(2000 + variant * 7 + (tropical ? 99 : 0));
  const nz = new Noise3(77 + variant);
  const m = new MeshBuilder();
  const bark: [number, number, number] = tropical ? [0.11, 0.09, 0.07] : [0.075, 0.06, 0.045];
  const sides = lod === 0 ? 7 : lod === 1 ? 5 : 4;
  const fork = tropical ? 0.62 : 0.4 + rng.float() * 0.08;
  const lean = new Vector3((rng.float() - 0.5) * 0.06, 0, (rng.float() - 0.5) * 0.06);
  tube(m, [new Vector3(0, -0.05, 0), new Vector3(lean.x * 0.5, fork * 0.5, lean.z * 0.5), new Vector3(lean.x, fork, lean.z)], [tropical ? 0.03 : 0.05, tropical ? 0.025 : 0.04, 0.032], sides, bark, (t) => t * 0.3);
  const crown = new Vector3(lean.x, tropical ? 0.8 : 0.66, lean.z);
  const crownR = tropical ? 0.32 : 0.3;
  const limbs = lod === 2 ? 0 : 3 + (variant % 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rng.float() * 0.6;
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const p0 = new Vector3(lean.x, fork, lean.z);
    const p1 = p0.clone().addScaledVector(out, 0.12).add(new Vector3(0, 0.14, 0));
    const p2 = p0.clone().addScaledVector(out, 0.22).add(new Vector3(0, tropical ? 0.18 : 0.26, 0));
    tube(m, [p0, p1, p2], [0.024, 0.016, 0.006], Math.max(3, sides - 2), bark, (t) => 0.3 + t * 0.4);
  }
  const leaf: [number, number, number] = tropical ? [0.03, 0.068, 0.022] : [0.038, 0.062, 0.02];
  // budget per LOD: 11 / 6 / 3 clusters, each a 20-face core + 12 / 6 / 4 leaf cards (≈ 500 / 200 / 90 triangles)
  const n = lod === 0 ? 11 : lod === 1 ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.39 + rng.float();
    const spread = i === 0 ? 0 : (tropical ? 0.26 : 0.2) * (0.55 + rng.float() * 0.6);
    const c = new Vector3(crown.x + Math.cos(a) * spread, crown.y + (rng.float() - 0.45) * (tropical ? 0.06 : 0.2) + (i === 0 ? 0.06 : 0), crown.z + Math.sin(a) * spread);
    const r = (i === 0 ? 0.17 : 0.1 + rng.float() * 0.08) * (lod === 2 ? 1.6 : lod === 1 ? 1.2 : 1);
    // a darker core fills the volume; leafy cards make the silhouette and the surface (fewer, larger far away)
    const core: [number, number, number] = [leaf[0] * 0.6, leaf[1] * 0.6, leaf[2] * 0.6];
    cluster(m, nz, c, r * 0.82, 0, core, crown, crownR, 0.5, rng, tropical ? 0.35 : 0.7);
    leafCards(m, c, r * (lod === 2 ? 1.1 : 1), lod === 0 ? 12 : lod === 1 ? 6 : 4, crown, crownR, 0.5, rng);
  }
  return m.build();
}

function dead(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(3000 + variant);
  const m = new MeshBuilder();
  const bark: [number, number, number] = [0.07, 0.065, 0.06];
  const sides = lod === 0 ? 6 : 4;
  tube(m, [new Vector3(0, -0.05, 0), new Vector3(0.02, 0.45, 0), new Vector3(-0.02, 0.85, 0.01)], [0.04, 0.028, 0.006], sides, bark, (t) => t * 0.2);
  const limbs = lod === 2 ? 2 : 5;
  for (let i = 0; i < limbs; i++) {
    const a = rng.float() * Math.PI * 2;
    const y = 0.35 + rng.float() * 0.4;
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const p0 = new Vector3(0, y, 0);
    const p1 = p0.clone().addScaledVector(out, 0.1).add(new Vector3(0, 0.08, 0));
    const p2 = p0.clone().addScaledVector(out, 0.2).add(new Vector3(0, 0.1 + rng.float() * 0.1, 0));
    tube(m, [p0, p1, p2], [0.014, 0.009, 0.003], 3, bark, () => 0.2);
  }
  return m.build();
}

function shrub(lod: number, variant: number): BufferGeometry {
  const rng = new Rng(4000 + variant);
  const nz = new Noise3(400 + variant);
  const m = new MeshBuilder();
  const leaf: [number, number, number] = [0.05, 0.075, 0.03];
  const crown = new Vector3(0, 0.38, 0);
  const n = lod === 0 ? 4 : lod === 1 ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float();
    const c = new Vector3(Math.cos(a) * (i ? 0.22 : 0), 0.3 + rng.float() * 0.15, Math.sin(a) * (i ? 0.22 : 0));
    const r = 0.3 + rng.float() * 0.1;
    if (lod === 0) {
      cluster(m, nz, c, r * 0.8, 0, [leaf[0] * 0.6, leaf[1] * 0.6, leaf[2] * 0.6], crown, 0.5, 0.2, rng, 0.5);
      leafCards(m, c, r, 7, crown, 0.5, 0.2, rng);
    } else cluster(m, nz, c, r, 0, leaf, crown, 0.5, 0.2, rng, 0.5);
  }
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
    case 'broadleaf': g = broadleaf(lod, variant, false); break;
    case 'tropical': g = broadleaf(lod, variant, true); break;
    case 'dead': g = dead(lod, variant); break;
    default: g = shrub(lod, variant); break;
  }
  cache.set(key, g);
  return g;
}
