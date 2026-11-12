// GENESIS — PERF P2 (session 6): the FAR-TREE crowns. Beyond the instanced trees' full-detail range every tree of the
// forest is still drawn — the same plants (vegetation.ts cellPlants: same positions, species, sizes, lean, yaw,
// colours, snow, char, leaf fall) — as a cheap hull fitted to the tree's own LOD-2 mesh: a lathe through the crown's
// silhouette (5 sides, 2 rings; 4 sides, 1 ring for the smallest on screen) plus a 3-sided trunk. The hull carries the
// vegetation material's attributes (aCard 0.5 = solid foliage, lit and tinted like leaves; aCard 0 = bark), so the
// same shader lights, tints, snows and shadows it, and the cross-fades share its object-space chunks.
import { BufferGeometry, DataTexture, Float32BufferAttribute, FloatType, NearestFilter, RGBAFormat, type Texture } from 'three';
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
  // PERF s12: the near crown seen from afar is its texel colour lit through its own depth (sprays in front of shaded
  // sprays, the floor between): measured on the babel forest at 500 m, near crowns vs hulls (ftc-near / ftc-far), the
  // hull read paler and bluer at the same lighting. The crown-depth shading in the far shader takes the value down;
  // this takes out the hull's cast toward blue-grey (foliage only; bark keeps its own colour)
  if (leafy) { cr *= 0.86; cb *= 0.68; }
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
  // PERF item 3 (session 10): a CANONICAL layout — the same vertex slots and the same index list for every kind and
  // variant of a lod — so all far trees of a lod draw from one shared index buffer, each instance's hull read from a
  // table texture by its hull id (farHullTable). Slots: 0 the bottom point, then the rings (ring j, side s at
  // 1 + j·S + s), the top point, and for lod 0 the trunk (3 at the foot, 3 up in the crown). A hull without a trunk
  // folds those six onto the bottom point: zero-area triangles, no fragments. Same triangles and the same per-vertex
  // values as the deduplicated soup this replaced (a crown vertex had one normal, colour and card in every face).
  const ringP = (j: number, s: number) => { const a = (s / S) * Math.PI * 2, [y, r] = rings[j]; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; };
  vtx(cx, y0, cz, true);
  for (let j = 0; j < rings.length; j++) for (let s = 0; s < S; s++) { const q = ringP(j, s); vtx(q[0], q[1], q[2], true); }
  vtx(cx, y1, cz, true);
  const nb0 = 1, top = 1 + rings.length * S, L = rings.length - 1;
  const idx: number[] = [];
  const ri = (j: number, s: number) => nb0 + j * S + (s % S);
  for (let s = 0; s < S; s++) {
    // bottom cap (faces down), bands between the rings, top fan (counter-clockwise seen from outside)
    idx.push(0, ri(0, s), ri(0, s + 1));
    for (let j = 0; j < L; j++) idx.push(ri(j, s), ri(j + 1, s), ri(j + 1, s + 1), ri(j, s), ri(j + 1, s + 1), ri(j, s + 1));
    idx.push(ri(L, s), top, ri(L, s + 1));
  }
  if (lod === 0) {
    // the trunk (where the crown stands clear of the ground: a 3-sided prism up into the crown)
    const trunk = leafy && y0 > 0.08 && trunkR > 0;
    const tr = trunkR * 1.1, ty = y0 + span * 0.15;
    const tb = top + 1;
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      if (trunk) vtx(bx + Math.cos(a) * tr, 0, bz + Math.sin(a) * tr, false); else vtx(cx, y0, cz, false);
    }
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2;
      if (trunk) vtx(cx + Math.cos(a) * tr * 0.6, ty, cz + Math.sin(a) * tr * 0.6, false); else vtx(cx, y0, cz, false);
    }
    for (let s = 0; s < 3; s++) { const s1 = (s + 1) % 3; idx.push(tb + s, tb + 3 + s, tb + 3 + s1, tb + s, tb + 3 + s1, tb + s1); }
  }
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('aCrown', new Float32BufferAttribute(acrown, 1));
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('aWind', new Float32BufferAttribute(aw, 1));
  g.setAttribute('aLeafUv', new Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setAttribute('aCard', new Float32BufferAttribute(acard, 1));
  g.computeBoundingSphere();
  return g;
}

/** PERF item 3: vertices of the canonical hull of each lod (lod 0: bottom, 3 rings x 5, top, 6 trunk; lod 1: 1 + 2 x 4 + 1) */
export const FAR_HULL_VERTS = [23, 10] as const;
/** texels per hull vertex in the table: (pos.xyz, n.x) (n.yz, colour.rg) (colour.b, wind, card, crown) */
export const FAR_HULL_TEXELS = 3;

/**
 * PERF item 3 (session 10): every far hull in one table texture — row `key * 2 + lod` (key = kind x variants + variant)
 * holds that hull's canonical vertices (FAR_HULL_TEXELS texels each); kinds `skip` leaves out (shrubs, kelp: the far
 * layer draws trees only) stay zero. The far trees of a lod then draw as ONE instanced mesh over the shared canonical
 * index list, each instance fetching its own hull's vertices by its hull id (the vertex id is the canonical slot), so
 * the ~66 far buckets (one per kind, variant and lod) become one per lod (per distance band). Also returns the
 * template geometry of each lod (the canonical index; position = slot 0's hull, never read by the far shader).
 */
export function farHullTable(kinds: readonly TreeKind[], variants: number, skip: (kind: TreeKind) => boolean, leafTex: Texture | null): { tex: DataTexture; tpl: [BufferGeometry, BufferGeometry] } {
  const W = FAR_HULL_VERTS[0] * FAR_HULL_TEXELS, H = kinds.length * variants * 2;
  const data = new Float32Array(W * H * 4);
  let tpl: [BufferGeometry, BufferGeometry] | null = null;
  for (let k = 0; k < kinds.length; k++) {
    if (skip(kinds[k])) continue;
    for (let v = 0; v < variants; v++) for (const lod of [0, 1] as const) {
      const g = farCrownGeometry(kinds[k], v, lod, leafTex);
      const P = g.getAttribute('position').array, N = g.getAttribute('normal').array, C = g.getAttribute('color').array;
      const Wd = g.getAttribute('aWind').array, K = g.getAttribute('aCard').array, Rc = g.getAttribute('aCrown').array;
      const nv = P.length / 3;
      if (nv !== FAR_HULL_VERTS[lod]) throw new Error(`far hull ${kinds[k]} lod ${lod}: ${nv} vertices, the canonical layout has ${FAR_HULL_VERTS[lod]}`);
      const row = ((k * variants + v) * 2 + lod) * W * 4;
      for (let i = 0; i < nv; i++) {
        const o = row + i * FAR_HULL_TEXELS * 4;
        data.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], C[i * 3], C[i * 3 + 1], C[i * 3 + 2], Wd[i], K[i], Rc[i]], o);
      }
      if (!tpl) tpl = [null, null] as unknown as [BufferGeometry, BufferGeometry];
      if (!tpl[lod]) {
        const t = new BufferGeometry();
        t.setIndex(g.getIndex()!.clone());
        t.setAttribute('position', g.getAttribute('position').clone());
        // (a mesh without a normal attribute is flat-shaded by three: a different program, no vNormal)
        t.setAttribute('normal', g.getAttribute('normal').clone());
        tpl[lod] = t;
      }
      g.dispose();
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
  tex.minFilter = NearestFilter; tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, tpl: tpl! };
}
