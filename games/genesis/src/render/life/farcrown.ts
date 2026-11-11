// GENESIS — PERF P2 (session 6): the FAR-TREE crowns. Beyond the instanced trees' full-detail range every tree of the
// forest is still drawn — the same plants (vegetation.ts cellPlants: same positions, species, sizes, lean, yaw,
// colours, snow, char, leaf fall) — as a cheap hull fitted to the tree's own LOD-2 mesh: a lathe through the crown's
// silhouette (5 sides, 2 rings; 4 sides, 1 ring for the smallest on screen) plus a 3-sided trunk. The hull carries the
// vegetation material's attributes (aCard 0.5 = solid foliage, lit and tinted like leaves; aCard 0 = bark), so the
// same shader lights, tints, snows and shadows it, and the cross-fades share its object-space chunks.
import { BufferGeometry, Float32BufferAttribute, type Texture } from 'three';
import { treeGeometry, type TreeKind } from '../gen/treegen.ts';

/** linear-RGB mean of each leaf-atlas tile over its opaque texels (alpha >= the test threshold), or null off-DOM */
let tileMeans: [number, number, number][] | null | undefined;
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function leafTileMeans(tex: Texture | null): [number, number, number][] | null {
  if (tileMeans !== undefined) return tileMeans;
  tileMeans = null;
  try {
    const cv = tex?.image as HTMLCanvasElement | undefined;
    const g = cv?.getContext?.('2d');
    if (!cv || !g) return null;
    const W = cv.width, H = cv.height, T = W >> 1;
    const px = g.getImageData(0, 0, W, H).data;
    const out: [number, number, number][] = [];
    for (let t = 0; t < 4; t++) {
      const x0 = (t & 1) * T, y0 = (t >> 1) * T;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = y0; y < y0 + T; y += 2) for (let x = x0; x < x0 + T; x += 2) {
        const o = (y * W + x) * 4;
        if (px[o + 3] < 115) continue;
        r += toLin(px[o] / 255); gg += toLin(px[o + 1] / 255); b += toLin(px[o + 2] / 255); n++;
      }
      out.push(n ? [r / n, gg / n, b / n] : [0.1, 0.15, 0.05]);
    }
    tileMeans = out;
  } catch { tileMeans = null; }
  return tileMeans;
}

/** tile of an atlas UV (atlasUV: column = u half, row 0 in the top half of v) */
const tileOf = (u: number, v: number) => (u >= 0.5 ? 1 : 0) + (v >= 0.5 ? 0 : 2);

const pct = (a: number[], q: number) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/**
 * The far hull of a tree kind / variant: lod 0 (5 sides, a bottom ring, two crown rings and a top point, plus a trunk
 * when the crown stands clear of the ground) or lod 1 (4 sides, bottom ring, widest ring, top). Unit height like the
 * tree meshes; the instance matrix scales it exactly as it scales the tree.
 */
export function farCrownGeometry(kind: TreeKind, variant: number, lod: 0 | 1, leafTex: Texture | null): BufferGeometry {
  const src = treeGeometry(kind, 2, variant);
  const P = src.getAttribute('position').array as ArrayLike<number>;
  const C = src.getAttribute('color').array as ArrayLike<number>;
  const card = src.getAttribute('aCard').array as ArrayLike<number>;
  const uv = src.getAttribute('aLeafUv').array as ArrayLike<number>;
  const wind = src.getAttribute('aWind').array as ArrayLike<number>;
  const n = P.length / 3;
  const means = leafTileMeans(leafTex);
  const isLeaf = (i: number) => card[i] >= 0.25 && !(card[i] > 0.3 && card[i] < 0.4);
  let leafN = 0;
  for (let i = 0; i < n; i++) if (isLeaf(i)) leafN++;
  // a leafless form (dead, burnt) is drawn as its bark: the hull of all its wood
  const leafy = leafN >= 6;
  const inCrown = (i: number) => (leafy ? isLeaf(i) : true);
  let cx = 0, cz = 0, k = 0, cr = 0, cg = 0, cb = 0, wsum = 0;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!inCrown(i)) continue;
    cx += P[i * 3]; cz += P[i * 3 + 2]; ys.push(P[i * 3 + 1]); k++;
    // the colour the shader gives this vertex at distance: vertex colour x (atlas texel x 1.7 on a spray card), and
    // the hull's own x 0.92 (the far foliage speckle) divided back out
    let r = C[i * 3], g = C[i * 3 + 1], b = C[i * 3 + 2];
    if (leafy && card[i] > 0.5) {
      const m = means ? means[tileOf(uv[i * 2], uv[i * 2 + 1])] : [0.11, 0.16, 0.05];
      r *= m[0] * 1.7 / 0.92; g *= m[1] * 1.7 / 0.92; b *= m[2] * 1.7 / 0.92;
    }
    cr += r; cg += g; cb += b; wsum += wind[i];
  }
  k = Math.max(1, k);
  cx /= k; cz /= k; cr /= k; cg /= k; cb /= k; wsum /= k;
  const y0 = pct(ys, 0.04), y1 = Math.max(y0 + 0.05, pct(ys, 0.985));
  // the silhouette radius at a height: a high percentile of the crown's radial extent in a slice around it (cards
  // reach past the visual mass; the percentile keeps the hull to what reads as the crown)
  const radAt = (y: number, half: number): number => {
    const rs: number[] = [];
    for (let i = 0; i < n; i++) if (inCrown(i) && Math.abs(P[i * 3 + 1] - y) <= half) rs.push(Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz));
    return rs.length >= 3 ? pct(rs, 0.82) : 0;
  };
  const span = y1 - y0;
  const rings: [number, number][] = [];
  if (lod === 0) {
    for (const f of [0.08, 0.38, 0.7]) rings.push([y0 + span * f, radAt(y0 + span * f, span * 0.17)]);
  } else {
    const a = radAt(y0 + span * 0.1, span * 0.2);
    let best = 0.35, bestR = 0;
    for (const f of [0.2, 0.35, 0.5, 0.65]) { const r = radAt(y0 + span * f, span * 0.17); if (r > bestR) { bestR = r; best = f; } }
    rings.push([y0 + span * 0.1, a], [y0 + span * best, bestR]);
  }
  // no ring thinner than a sliver (the hull must cover the crown's mass from every side)
  const rMax = Math.max(1e-3, ...rings.map((r) => r[1]));
  for (const r of rings) r[1] = Math.max(r[1], rMax * 0.25);
  rings[0][1] *= lod === 0 ? 0.75 : 0.8;
  const S = lod === 0 ? 5 : 4;
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], aw: number[] = [], acard: number[] = [], acrown: number[] = [];
  const yc = (y0 + y1) / 2, ry = Math.max(1e-3, span / 2);
  const leafCard = leafy ? 0.5 : 0;
  const vtx = (x: number, y: number, z: number, crown: boolean): void => {
    pos.push(x, y, z);
    if (crown) {
      // ellipsoid-gradient normals: a smooth, rounded crown (foliage normals are bent outward in the tree meshes too)
      let nx = (x - cx) / (rMax * rMax), ny = (y - yc) / (ry * ry), nz = (z - cz) / (rMax * rMax);
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nrm.push(nx, ny, nz); col.push(cr, cg, cb); aw.push(wsum); acard.push(leafCard); acrown.push(0.8);
    } else {
      const l = Math.hypot(x - cx, z - cz) || 1;
      nrm.push((x - cx) / l, 0, (z - cz) / l); col.push(barkR, barkG, barkB); aw.push(0); acard.push(0); acrown.push(1.2);
    }
  };
  // the bark colour: the mean of the wood vertices (the trunk)
  let barkR = 0.12, barkG = 0.1, barkB = 0.08, trunkR = 0, nb = 0, bx = 0, bz = 0;
  {
    let r = 0, g = 0, b = 0, m = 0;
    for (let i = 0; i < n; i++) if (card[i] < 0.25 && card[i] !== 0.1) { r += C[i * 3]; g += C[i * 3 + 1]; b += C[i * 3 + 2]; m++; if (P[i * 3 + 1] < 0.06) { bx += P[i * 3]; bz += P[i * 3 + 2]; nb++; } }
    if (m) { barkR = r / m; barkG = g / m; barkB = b / m; }
    if (nb) { bx /= nb; bz /= nb; let s = 0; for (let i = 0; i < n; i++) if (card[i] < 0.25 && P[i * 3 + 1] < 0.06) s += Math.hypot(P[i * 3] - bx, P[i * 3 + 2] - bz); trunkR = s / nb; }
  }
  const ring = (j: number, a: number) => { const [y, r] = rings[j]; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r] as const; };
  const tri = (a: readonly number[], b: readonly number[], c: readonly number[], crown = true) => { vtx(a[0], a[1], a[2], crown); vtx(b[0], b[1], b[2], crown); vtx(c[0], c[1], c[2], crown); };
  const bottom = [cx, y0, cz] as const, top = [cx, y1, cz] as const;
  for (let s = 0; s < S; s++) {
    const a0 = (s / S) * Math.PI * 2, a1 = ((s + 1) / S) * Math.PI * 2;
    // bottom cap (faces down), bands between the rings, top fan (counter-clockwise seen from outside)
    tri(bottom, ring(0, a0), ring(0, a1));
    for (let j = 0; j + 1 < rings.length; j++) {
      const p0 = ring(j, a0), p1 = ring(j, a1), q0 = ring(j + 1, a0), q1 = ring(j + 1, a1);
      tri(p0, q0, q1); tri(p0, q1, p1);
    }
    const L = rings.length - 1;
    tri(ring(L, a0), top, ring(L, a1));
  }
  // the trunk (lod 0 only, where the crown stands clear of the ground: a 3-sided prism up into the crown)
  if (lod === 0 && leafy && y0 > 0.08 && trunkR > 0) {
    const tr = trunkR * 1.1, ty = y0 + span * 0.15;
    for (let s = 0; s < 3; s++) {
      const a0 = (s / 3) * Math.PI * 2, a1 = ((s + 1) / 3) * Math.PI * 2;
      const b0 = [bx + Math.cos(a0) * tr, 0, bz + Math.sin(a0) * tr], b1 = [bx + Math.cos(a1) * tr, 0, bz + Math.sin(a1) * tr];
      const t0 = [cx + Math.cos(a0) * tr * 0.6, ty, cz + Math.sin(a0) * tr * 0.6], t1 = [cx + Math.cos(a1) * tr * 0.6, ty, cz + Math.sin(a1) * tr * 0.6];
      tri(b0, t0, t1, false); tri(b0, t1, b1, false);
    }
  }
  // indexed: the hull's vertices are shared by its faces (smooth normals: the same at every face), so a far tree
  // costs ~10-20 vertex-shader runs, not 3 per triangle
  const uniq = new Map<string, number>();
  const idx: number[] = [];
  const P2: number[] = [], N2: number[] = [], C2: number[] = [], W2: number[] = [], K2: number[] = [], R2: number[] = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)},${acard[i]}`;
    let j = uniq.get(key);
    if (j === undefined) {
      j = P2.length / 3; uniq.set(key, j);
      P2.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); N2.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      C2.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); W2.push(aw[i]); K2.push(acard[i]); R2.push(acrown[i]);
    }
    idx.push(j);
  }
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('aCrown', new Float32BufferAttribute(R2, 1));
  g.setAttribute('position', new Float32BufferAttribute(P2, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N2, 3));
  g.setAttribute('color', new Float32BufferAttribute(C2, 3));
  g.setAttribute('aWind', new Float32BufferAttribute(W2, 1));
  g.setAttribute('aLeafUv', new Float32BufferAttribute(new Float32Array(P2.length / 3 * 2), 2));
  g.setAttribute('aCard', new Float32BufferAttribute(K2, 1));
  g.computeBoundingSphere();
  return g;
}
